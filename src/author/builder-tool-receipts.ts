import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { asRecord } from "../meta/json-shape.ts";
import type { PiTool } from "../backends/pi-session.ts";
import { BuilderExecutionRecorder } from "./builder-execution.ts";
import { hasText } from "../meta/text.ts";
import { MOVE_TO_AUTHORING, NO_SUBMIT_REMINDER_MS, stopFact } from "./builder-continuation.ts";
import { availableParallelism, loadavg } from "../meta/os.ts";

/** The session the receipts are written against: who records, which turn is open, how a checkpoint
 *  is taken, whether the session has closed, and the optional hooks. */
type BuilderToolReceiptSession = {
  readonly recorder: BuilderExecutionRecorder;
  readonly activeTurn: () => number;
  readonly checkpoint: () => void;
  readonly closed: () => Closure | null;
  readonly afterTool?: (() => Promise<string | null>) | undefined;
  readonly clock?: ((clearPreview: boolean) => string | null) | undefined;
};

/** Why a session's tools now refuse: its build settled, or an answer agent's wall passed. */
type Closure = "accepted" | "terminal-refusal" | "wall";

function closedResult(reason: Closure): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: capturedJsonStringify({
          status: "terminal-closed",
          reason,
          nextAction:
            reason === "wall"
              ? "Your wall has passed: end your turn now, and the controller takes the correctness model as it stands."
              : "No further tool action belongs to the accepted or finally refused build.",
        }),
      },
    ],
    details: { receipt: { outcome: "terminal-closed", reason } },
  };
}

/** Elapsed session time, at most once per half hour, and once, after `NO_SUBMIT_REMINDER_MS`
 *  without a submit, the continuation's ask to author. It exists because a Claude Builder session
 *  runs as one turn, so a turn boundary may not come for hours. A session can author for three
 *  hours before its first submit, and without this clock the continuation says nothing in all that
 *  time. The half-hour line carries the host load beside the minutes, because a round sharing its
 *  host with other campaigns can see its compiles and previews run several times slower, and a
 *  Builder that cannot see the load reads that as its own tool being slow or flaky.
 *
 *  A clear preview changes what the no-submit facts mean. Asking a Builder that holds one to "move
 *  to authoring" is simply false, and a Builder with a clear preview and no submit is the case that
 *  ran longest: rounds kept reshaping a candidate for hours after the gate had already cleared it.
 *  So the clock remembers the last clear `correctness_check` and states how long ago it was, while
 *  no submit has followed, in place of the authoring ask. `submits` is the round's submit count
 *  rather than whether it has submitted at all, so a refused submit made before that clear preview
 *  does not silence it.
 *
 *  A run with a hard stop states it beside each mark (`stopFact`): the minutes since the round
 *  opened are not the minutes left, and a Builder told only the first read them as the second. The
 *  minutes so far and the marks run on the monotonic clock (`now`), which a host clock step cannot
 *  move; the stop is an epoch instant, so the minutes left to it are read off the wall clock
 *  (`wall`) at the mark. */
export function sessionClock(
  submits: () => number = () => 0,
  stopAt: number | null = null,
  now: () => number = () => performance.now(),
  load: () => string = hostLoad,
  wall: () => number = () => Date.now(),
): (clearPreview: boolean) => string | null {
  const opened = now();
  let marks = 0;
  let asked = false;
  let clear: { at: number; submits: number } | null = null;
  return (clearPreview) => {
    const at = now();
    if (clearPreview) clear = { at, submits: submits() };
    const elapsed = at - opened;
    const minutes = Math.floor(elapsed / 60_000);
    const since =
      clear === null || submits() > clear.submits
        ? null
        : `The last clear correctness_check was ${String(Math.floor((at - clear.at) / 60_000))} min ago, and no candidate has been submitted since.`;
    const lines: string[] = [];
    if (Math.floor(minutes / 30) > marks) {
      marks = Math.floor(minutes / 30);
      lines.push(`Round clock: ${String(minutes)} min since this round opened; ${load()}.`);
      if (stopAt !== null) lines.push(stopFact(stopAt, wall()));
      if (since !== null) lines.push(since);
    }
    if (!asked && elapsed >= NO_SUBMIT_REMINDER_MS && submits() === 0) {
      asked = true;
      if (since === null) lines.push(`No candidate has been submitted yet. ${MOVE_TO_AUTHORING}`);
      else if (!lines.includes(since)) lines.push(since);
    }
    return lines.length === 0 ? null : lines.join("\n");
  };
}

/** The host's one-minute load average against its cores, as the clock states it. */
function hostLoad(): string {
  return `host load average ${(loadavg()[0] ?? 0).toFixed(1)} on ${String(availableParallelism())} cores`;
}

/** Wait for `pending` unless `signal` aborts first; an aborted wait resolves so the caller can
 *  refuse dispatch on its own ownership check. */
function raceAbort(pending: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
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

/** Intercept host dispatch rather than infer intent from provider totals. The boundary is narrow
 *  on purpose: each registered schema is preserved and only recorder-approved arguments are kept.
 *  Every backend's workspace operation is a host tool, so a call's completion is the one boundary
 *  at which `afterTool` can run -- after the tool, never inside it -- and its advice rides that
 *  tool's own result back to the model. */
export function withCustomToolReceipts(
  tools: readonly PiTool[],
  session: BuilderToolReceiptSession,
): PiTool[] {
  const { recorder, activeTurn, checkpoint, closed, afterTool } = session;
  const clock = session.clock ?? sessionClock();
  let active = 0;
  let reviewing: Promise<string | null> | null = null;
  // A call refused because the round closed states no time; the clock reads only for open calls.
  const settle = async (
    name: string,
    turn: number,
    open: boolean,
    result?: AgentToolResult<unknown>,
  ): Promise<string | null> => {
    active -= 1;
    const clear = name === "correctness_check" && asRecord(result?.details)?.status === "clear";
    const time = open ? clock(clear) : null;
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
        // Ownership is fixed at arrival. A call queued behind a review belongs to the turn that
        // issued it, so if that turn is cancelled or advances while the call waits, the call is
        // refused rather than executed and attributed to the successor turn.
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
        let result: AgentToolResult<unknown>;
        const closure = closed();
        try {
          result =
            closure !== null && name !== "submit"
              ? closedResult(closure)
              : await execute(toolCallId, args, signal);
        } catch (error) {
          recorder.customToolFinished(sequence, "threw");
          const advice = await settle(name, turn, closure === null);
          checkpoint();
          if (hasText(advice)) throw new Error(`${errorMessage(error)}\n${advice}`, { cause: error });
          throw error;
        }
        // Finished before the review, as a throw is. Booking it afterwards charges the review's own
        // minutes to the tool, which can be most of a long call's recorded duration. The receipt is
        // in `details`.
        recorder.customToolFinished(sequence, "returned", result);
        const advice = await settle(name, turn, closure === null, result);
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
