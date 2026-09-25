/**
 * A Built solver's trace, as the Builder may read it: how long the solve took against its wall,
 * how many tool calls and how much it cost, then one line per turn and per tool call.
 *
 * A trace is the solver's own record of what it did — the turns it spoke, the tools it called and
 * the previews of what they returned — so it holds no verifier output, no hidden expectation and no
 * reference artifact. It is read here from JSON on disk or from the solve that just ran, and it is
 * parsed field by field rather than asserted, so a field this reader does not name never reaches
 * the text.
 */
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { truncateLine } from "./pi-coding/truncate.ts";

/** What one solve spent, read off its trace. Minutes sum each turn's elapsed time, or the time an
 *  open turn had run when the trace was taken; cost is null when no turn reported one, because an
 *  unreported cost is unknown rather than free. */
export type SolveEffort = {
  minutes: number | null;
  toolCalls: number;
  costUsd: number | null;
};

const records = (value: unknown) => (Array.isArray(value) ? value.map(asRecord) : []);

export function traceEffort(trace: unknown): SolveEffort {
  const root = asRecord(trace);
  const turns = records(root?.turns);
  const spans = turns.flatMap((turn) => {
    const ms = isNumber(turn?.timingMs) ? turn.timingMs : turn?.observedMs;
    return isNumber(ms) ? [ms] : [];
  });
  const costs = turns.flatMap((turn) => (isNumber(turn?.costUsd) ? [turn.costUsd] : []));
  return {
    minutes: spans.length === 0 ? null : round1(spans.reduce((sum, ms) => sum + ms, 0) / 60_000),
    toolCalls: records(root?.toolCalls).length,
    costUsd: costs.length === 0 ? null : Math.round(costs.reduce((sum, cost) => sum + cost, 0) * 100) / 100,
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** "37.2 of 120 solve minutes (31%), 14 tool calls, $0.42" — the effort sentence every reader of a
 *  solve uses, so a rehearsal and a measured case read the same way. */
export function effortPhrase(effort: SolveEffort, wallMinutes: number): string {
  const minutes =
    effort.minutes === null
      ? `unrecorded minutes of a ${wallMinutes}-minute solve wall`
      : `${effort.minutes} of ${wallMinutes} solve minutes (${Math.round((effort.minutes / wallMinutes) * 100)}%)`;
  const cost = effort.costUsd === null ? "cost unreported" : `$${effort.costUsd.toFixed(2)}`;
  return `${minutes}, ${effort.toolCalls} tool call${effort.toolCalls === 1 ? "" : "s"}, ${cost}`;
}

const clip = (text: string) => truncateLine(text.replaceAll(/\s+/g, " ").trim()).text;

/** The trace as lines: a header naming the solve and its effort, then the solve in capture order. */
export function solverTraceLines(heading: string, trace: unknown, wallMinutes: number): string[] {
  const root = asRecord(trace);
  const lines = [`${heading}: passed in ${effortPhrase(traceEffort(trace), wallMinutes)}.`];
  const calls = records(root?.toolCalls);
  for (const turn of records(root?.turns)) {
    const number = isNumber(turn?.turn) ? turn.turn : 0;
    if (isString(turn?.assistantPreview) && turn.assistantPreview.trim() !== "") {
      lines.push(`turn ${number} said: ${clip(turn.assistantPreview)}`);
    }
    for (const call of calls.filter((row) => row?.turn === number)) {
      const name = isString(call?.toolName) ? call.toolName : "tool";
      const seconds = isNumber(call?.timingMs) ? ` ${round1(call.timingMs / 1000)}s` : "";
      const failed = call?.isError === true ? " (error)" : "";
      const preview = isString(call?.resultPreview) ? `: ${clip(call.resultPreview)}` : "";
      lines.push(`turn ${number} call ${name}${seconds}${failed}${preview}`);
    }
  }
  if (root?.truncated === true) lines.push("The trace hit its capture bound; later calls are not recorded.");
  return lines;
}
