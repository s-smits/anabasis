/**
 * Solve endings (`Ending`, `CancellationOrigin`, `unanswered`), partitioning every solve into:
 * - `pass`: accepted by the verifier;
 * - `fail`: owned by the solver or its harness (`rejected`, `wall-ended`, `turns-ended`,
 *   `context-ended`, `no-answer`, `broken-harness`);
 * - `flagged`: solver reported a malformed task via `submit` (`src/tools/answer.ts`), counted as a
 *   failure for the flagging side (`passed`, `src/kernel/solves.ts`) so genuinely malformed tasks
 *   tie when flagged by both sides;
 * - `non-result`: external failure (`provider`, `sandbox-crash`, `moved-files`, `check`, `verifier`,
 *   `killed`), retried and excluded from all denominators (rule 7).
 */
import { type AssistantMessage, isContextOverflow } from "@earendil-works/pi-ai";
import { isString, type JsonValue } from "../meta/json-shape.ts";

/** Who cancelled a piece of work (`admission` is preserved for historical gate room-solve logs). */
export type CancellationOrigin = "session-wall" | "campaign-budget" | "caller" | "invocation" | "admission";

export type Ending =
  | { readonly outcome: "pass" }
  | {
      readonly outcome: "fail";
      readonly kind: "rejected" | "wall-ended" | "turns-ended" | "context-ended" | "no-answer";
    }
  | { readonly outcome: "fail"; readonly kind: "broken-harness"; readonly reason: string }
  | { readonly outcome: "flagged"; readonly reason: string }
  | {
      readonly outcome: "non-result";
      readonly kind: "provider" | "sandbox-crash" | "moved-files" | "check" | "verifier";
      readonly reason: string;
    }
  | {
      readonly outcome: "non-result";
      readonly kind: "killed";
      readonly reason: string;
      readonly cancelledBy?: CancellationOrigin;
    };

/** A solve's last turn, as the agent holds it or as its `solve.turn` event records it. */
interface LastTurn {
  readonly stopReason?: JsonValue | undefined;
  readonly errorMessage?: JsonValue | undefined;
}

/** Silence threshold (10 minutes with no completed turn or active tool) at deadline expiry before classifying the ending as a `provider` stall rather than `wall-ended` (rule 7). */
export const SILENT_SECONDS = 10 * 60;

/** The host's first cancellation source, carried through parent and invocation signals. */
export class Cancellation extends Error {
  readonly cancelledBy: CancellationOrigin;

  constructor(cancelledBy: CancellationOrigin) {
    super(`work cancelled by ${cancelledBy}`);
    this.cancelledBy = cancelledBy;
  }
}

/** Whether a non-result was caused by the task's check failing to run (`floor`, `src/campaign/round.ts`). */
export function checkCouldNotRun(ending: Ending): boolean {
  return ending.outcome === "non-result" && ending.kind === "check";
}

/** Whether the model's context window ended the last turn (`stopReason === "length"` or a provider context-overflow error; used by `judge` in `src/solver/run.ts` and `taskRecords` in `src/kernel/reports.ts`). */
export function windowEnded(last: LastTurn): boolean {
  const { stopReason, errorMessage } = last;
  if (stopReason === "length") return true;
  if (stopReason !== "error" || !isString(errorMessage)) return false;
  // SAFETY: without a context window pi reads a message's stop reason, its error and its provider
  // alone (`isContextOverflow`, pi-ai's utils/overflow.ts); a missing provider matches no pattern.
  return isContextOverflow({ stopReason, errorMessage } as AssistantMessage);
}

/** Whether the provider failed a solve's last turn with a non-window error (`provider` non-result). */
export function providerFailed(last: LastTurn): boolean {
  return last.stopReason === "error" && !windowEnded(last);
}

/** Whether a provider error message names a permanent account/model refusal that no retry clears. */
export function nonRetryableProvider(reason: string): boolean {
  return /disabled Claude subscription access|Provider is not configured|requires more credits|model is not supported/u.test(
    reason,
  );
}

/** Classify an unanswered solve ending once an answer, flag, crash, and broken harness are ruled out (`judge`, `src/solver/run.ts`). */
export function unanswered(stopped: {
  readonly wallEnded: boolean;
  /** How long the model had been silent, with no tool of its running, when the deadline was reached. */
  readonly silentSeconds: number;
  readonly turnsEnded: boolean;
  readonly last: LastTurn | undefined;
}): Extract<Ending, { readonly kind: string }> {
  const { last } = stopped;
  if (stopped.wallEnded && stopped.silentSeconds >= SILENT_SECONDS) {
    const minutes = String(Math.floor(stopped.silentSeconds / 60));
    return {
      outcome: "non-result",
      kind: "provider",
      reason: `the model sent nothing for ${minutes} minutes`,
    };
  }
  if (stopped.wallEnded) return { outcome: "fail", kind: "wall-ended" };
  // A last turn the provider failed is the provider's, though it was the last the solve was
  // allowed, and not the solver's loss at its turns (`turns-ended`). A context the solver filled
  // is its own, and comes as an error too.
  if (last !== undefined && providerFailed(last)) {
    const reason = isString(last.errorMessage) ? last.errorMessage : "the provider failed the turn";
    return { outcome: "non-result", kind: "provider", reason };
  }
  // A full context or a cut reply is the window's, the last allowed turn included (`windowEnded`).
  if (last !== undefined && windowEnded(last)) return { outcome: "fail", kind: "context-ended" };
  return { outcome: "fail", kind: stopped.turnsEnded ? "turns-ended" : "no-answer" };
}
