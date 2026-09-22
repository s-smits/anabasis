import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { type JsonValue, asRecord } from "../meta/json-shape.ts";
import type { PiTool } from "../backends/pi-session.ts";
import { BuilderExecutionRecorder } from "./builder-execution.ts";
import { hasText } from "../meta/text.ts";
import { MOVE_TO_AUTHORING, NO_SUBMIT_REMINDER_MS } from "./builder-continuation.ts";

interface BuilderToolEvents {
  started(turn: number, tool: string, args: Record<string, JsonValue> | undefined): void;
  ended(turn: number, tool: string, threw: boolean): void;
}

/** The session the receipts are written against: who records, which turn is open, how a checkpoint
 *  is taken, whether the session has closed, and the optional hooks. */
type BuilderToolReceiptSession = {
  readonly recorder: BuilderExecutionRecorder;
  readonly activeTurn: () => number;
  readonly checkpoint: () => void;
  readonly closed: () => "accepted" | "terminal-refusal" | null;
  readonly events?: BuilderToolEvents | undefined;
  readonly afterTool?: (() => Promise<string | null>) | undefined;
  readonly clock?: (() => string | null) | undefined;
};

function closedResult(reason: "accepted" | "terminal-refusal"): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: capturedJsonStringify({
          status: "terminal-closed",
          reason,
          nextAction: "No further tool action belongs to the accepted or finally refused build.",
        }),
      },
    ],
    details: { receipt: { outcome: "terminal-closed", reason } },
  };
}

/** Elapsed session time, at most once per half hour, and once, after `NO_SUBMIT_REMINDER_MS`
 *  without a submit, the ask to author. A session may run for hours without a turn boundary. */
export function sessionClock(
  submitted: () => boolean = () => true,
  now: () => number = () => performance.now(),
): () => string | null {
  const opened = now();
  let marks = 0;
  let asked = false;
  return () => {
    const elapsed = now() - opened;
    const minutes = Math.floor(elapsed / 60_000);
    const lines: string[] = [];
    if (Math.floor(minutes / 30) > marks) {
      marks = Math.floor(minutes / 30);
      lines.push(`Round clock: ${String(minutes)} min since this round opened.`);
    }
    if (!asked && elapsed >= NO_SUBMIT_REMINDER_MS && !submitted()) {
      asked = true;
      lines.push(`No candidate has been submitted yet. ${MOVE_TO_AUTHORING}`);
    }
    return lines.length === 0 ? null : lines.join("\n");
  };
}

/** Wait for `pending` unless `signal` aborts first; an aborted wait resolves so the caller can
 *  refuse dispatch on its own ownership check. `awaitTurnRetry` shares it: its reset wait runs for
 *  hours and ends the same way, by asking its own gates once the race settles. */
export function raceAbort(pending: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return pending.then(
      () => undefined,
      () => undefined,
    );
  }
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done, { once: true });
    pending.then(done, done);
  });
}

/** Wraps host dispatch to record each call, keeping every registered schema and only
 *  recorder-approved arguments. `afterTool` runs after each completed call, and its advice joins
 *  that tool's result. */
export function withCustomToolReceipts(
  tools: readonly PiTool[],
  session: BuilderToolReceiptSession,
): PiTool[] {
  const { recorder, activeTurn, checkpoint, closed, events, afterTool } = session;
  const clock = session.clock ?? sessionClock();
  let active = 0;
  let reviewing: Promise<string | null> | null = null;
  // A call refused because the round closed states no time; the clock reads only for open calls.
  const settle = async (name: string, turn: number, open: boolean): Promise<string | null> => {
    active -= 1;
    const time = open ? clock() : null;
    const review = await reviewAfter(name, turn);
    return [review, time].filter(Boolean).join("\n") || null;
  };
  const reviewAfter = async (name: string, turn: number): Promise<string | null> => {
    if (active !== 0 || afterTool === undefined) return null;
    const started = Date.now();
    // An advisory failure must not relabel completed work: the tool result goes back unchanged.
    reviewing = Promise.resolve()
      .then(afterTool)
      .catch(() => {
        recorder.authoringReviewed(turn, name, null, Date.now() - started);
        return null;
      });
    try {
      const advice = await reviewing;
      // A review that ran and found nothing still held the session; only one not due returns null.
      if (advice !== null) recorder.authoringReviewed(turn, name, advice.length, Date.now() - started);
      return advice;
    } finally {
      reviewing = null;
    }
  };
  return tools.map((tool): AgentTool => {
    const execute =
      /* SAFETY: pi validates each call's arguments against this tool's own parameters before it dispatches, so the wrapper forwards exactly the arguments the tool declared. */ tool.execute.bind(
        tool,
      ) as AgentTool["execute"];
    const { name } = tool;
    return {
      ...tool,
      execute: async (toolCallId: string, args: unknown, signal?: AbortSignal) => {
        // Ownership is fixed at arrival: a queued call whose turn ended or advanced is refused.
        const turn = activeTurn();
        // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- `reviewing` is reset by the review this awaits and `signal.aborted` by the caller's abort, neither of which the rule can see from here.
        while (reviewing !== null && signal?.aborted !== true) await raceAbort(reviewing, signal);
        if (signal?.aborted === true || activeTurn() !== turn) {
          throw new Error(`${name} call was cancelled before dispatch (turn ${turn} closed)`, {
            cause: signal?.reason,
          });
        }
        active += 1;
        // Pi hands every tool an object its parameters admitted; the record keeps it as JSON.
        const recorded = asRecord(args) ?? undefined;
        const sequence = recorder.customToolStarted(name, recorded, turn);
        events?.started(turn, name, recorded);
        let result: AgentToolResult<unknown>;
        const closure = closed();
        try {
          result =
            closure !== null && name !== "submit"
              ? closedResult(closure)
              : await execute(toolCallId, args, signal);
        } catch (error) {
          recorder.customToolFinished(sequence, "threw");
          events?.ended(turn, name, true);
          const advice = await settle(name, turn, closure === null);
          checkpoint();
          if (hasText(advice)) throw new Error(`${errorMessage(error)}\n${advice}`, { cause: error });
          throw error;
        }
        // Finished before the review, as a throw is, so review time is not booked as tool time.
        recorder.customToolFinished(sequence, "returned", result);
        events?.ended(turn, name, false);
        const advice = await settle(name, turn, closure === null);
        // Public advice rides the completed result as one more text block.
        if (hasText(advice)) {
          result = { ...result, content: [...result.content, { type: "text", text: advice }] };
        }
        checkpoint();
        return result;
      },
    };
  });
}
