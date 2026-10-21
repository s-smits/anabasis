/**
 * What a model seat's loop writes and spends: its trace into the log as each turn and call ends,
 * its compactions, the provider's failure of its last turn, and the one sum of its spend its end
 * records. `src/kernel/trace.ts` reads back what this writes.
 *
 * Until 21 October these lived in the solve's runner (`run.ts`), which the Builder's and the
 * Examiner's sessions imported for them, and the Referee's reader summed its spend for itself. A
 * solve, a Builder session, an Examiner session and a Referee ruling now meter the same way.
 */
import type { AgentEvent, AgentToolResult, PrepareRequest, StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import { CLAUDE_COMPACTED, reportedCost } from "../backends/claude.ts";
import { CALL_RETRIED } from "../backends/models.ts";
import { type Compacted, compactBeforeRequest } from "../backends/pi-compaction.ts";
import { append } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import { type Seat, traceKind, whose } from "../kernel/trace.ts";
import { boundText } from "../meta/bounded-text.ts";
import type { JsonObject, JsonValue } from "../meta/json-shape.ts";

/** Whose trace a log holds: a solve's, a Builder's session, an Examiner's that writes tasks, or
 *  the one in which it drafts the exam. The word prefixes the event kinds (`draft.turn`), which
 *  `src/kernel/trace.ts` reads. */
type Traced = Exclude<Seat, "repair">;

/** The text of a result or a turn the trace keeps: more than pi's own tools return of an output
 *  (50 KB), so the trace holds what the solver read. At 4 KB, as v1 cut its traces, it held the
 *  head of a long result, and whoever read a fail afterwards read less than the solver had. */
const TRACE_TEXT_BYTES = 64 * 1024;

/** What the provider said when it failed a session's last turn, or null. pi's loop ends there
 *  without a throw, and what the session made before it is half a session, as a crash's is. A turn
 *  the session's own wall, kill or halt cut ends the same way and is not that: the caller says. */
export function failedTurn(turns: readonly AssistantMessage[]): string | null {
  const last = turns.at(-1);
  return last?.stopReason === "error" ? (last.errorMessage ?? "the provider failed the turn") : null;
}

/** Every model turn and every tool call into the log, as they end: a solve's as `solve.turn` and
 *  `solve.call` under `solve`, a Builder's or an Examiner's session as `build.`, `exam.` or
 *  `draft.turn` and `.call` under `session`. */
export function traceSink(log: string, of: Traced, id: string, turn: () => number) {
  const named = { [whose(of)]: id };
  const calls = new Map<string, { args: JsonValue; at: number }>();
  return (event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      // SAFETY: arguments a provider parsed from JSON.
      calls.set(event.toolCallId, { args: event.args as JsonValue, at: performance.now() });
    } else if (event.type === "tool_execution_end") {
      const call = calls.get(event.toolCallId);
      calls.delete(event.toolCallId);
      append(log, traceKind(of, "call"), {
        ...named,
        toolCallId: event.toolCallId,
        turn: turn(),
        tool: event.toolName,
        args: call?.args ?? null,
        isError: event.isError,
        // SAFETY: pi passes the tool's result, or the error result it built for the call.
        text: traceText((event.result as AgentToolResult).content),
        ms: call === undefined ? null : performance.now() - call.at,
      });
    } else if (event.type === "turn_end" && event.message.role === "assistant") {
      const { stopReason, errorMessage: error, responseModel, usage, content, diagnostics } = event.message;
      // Claude Code compacts in its own CLI, before the turn; its summary is in the query's cost.
      for (const { type, details } of diagnostics ?? []) {
        if (type !== CLAUDE_COMPACTED) continue;
        // SAFETY: the backend's own diagnostic, numbers and null.
        append(log, traceKind(of, "compacted"), {
          ...named,
          ...(details as JsonObject),
          usages: [],
          error: null,
        });
      }
      append(log, traceKind(of, "turn"), {
        ...named,
        turn: turn(),
        stopReason,
        error: error ?? null,
        responseModel: responseModel ?? null,
        usage: { ...usage },
        text: traceText(content),
        // `retried`, on a turn whose call a pi-served provider made again (`CALL_RETRIED`).
        ...diagnostics?.find(({ type }) => type === CALL_RETRIED)?.details,
      });
    }
  };
}

/** What a seat's model turns and its compactions' summaries spent, as its end records it: its
 *  turns, its tokens, their dollars at `model`'s price, and what Claude Code reported for them.
 *  The one sum a solve's, a Builder's and an Examiner's end carry, which the log's own sum over
 *  the turns of a seat that never ended matches (`unfinished`, `src/kernel/reports.ts`). */
export async function spentBy(
  model: Model<Api>,
  id: string,
  turns: readonly AssistantMessage[],
  summaries: readonly Usage[],
) {
  const tokens = tokensOf([...turns.map((turn) => turn.usage), ...summaries]);
  return {
    turns: turns.length,
    tokens: { ...tokens },
    ...dollars(freezePrices([model]), priceKey(model), tokens),
    reportedCost: await reportedCost(id, turns),
  };
}

/** The `prepareRequest` that compacts pi's own loop through `stream` (`pi-compaction.ts`): each
 *  compaction into the log as `<of>.compacted`, between the turns it came between, and its
 *  summary's usage into `summaries`, which the session's spend counts. */
export function loopCompaction(
  log: string,
  of: Traced,
  id: string,
  stream: StreamFn,
  summaries: Usage[],
): PrepareRequest {
  return compactBeforeRequest(stream, ({ usages, ...compacted }: Compacted) => {
    summaries.push(...usages);
    append(log, traceKind(of, "compacted"), {
      [whose(of)]: id,
      ...compacted,
      usages: usages.map((usage) => ({ ...usage })),
    });
  });
}

function traceText(content: readonly { type: string; text?: string }[]): string {
  const text = content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n");
  return boundText(text, TRACE_TEXT_BYTES).text;
}
