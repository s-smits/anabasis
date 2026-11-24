import { type AssistantMessage, isContextOverflow } from "@earendil-works/pi-ai";
import { isString, type JsonValue } from "../meta/json-shape.ts";

type CancellationOrigin = "session-wall" | "campaign-budget" | "caller" | "invocation" | "admission";

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

interface LastTurn {
  readonly stopReason?: JsonValue | undefined;
  readonly errorMessage?: JsonValue | undefined;
}

export const SILENT_SECONDS = 10 * 60;

export class Cancellation extends Error {
  readonly cancelledBy: CancellationOrigin;

  constructor(cancelledBy: CancellationOrigin) {
    super(`work cancelled by ${cancelledBy}`);
    this.cancelledBy = cancelledBy;
  }
}

export function checkCouldNotRun(ending: Ending): boolean {
  return ending.outcome === "non-result" && ending.kind === "check";
}

export function windowEnded(last: LastTurn): boolean {
  const { stopReason, errorMessage } = last;
  if (stopReason === "length") return true;
  if (stopReason !== "error" || !isString(errorMessage)) return false;
  // SAFETY: without a context window `isContextOverflow` reads only `stopReason`, `errorMessage`, and `provider`.
  return isContextOverflow({ stopReason, errorMessage } as AssistantMessage);
}

export function providerFailed(last: LastTurn): boolean {
  return last.stopReason === "error" && !windowEnded(last);
}

export function nonRetryableProvider(reason: string): boolean {
  return /disabled Claude subscription access|Provider is not configured|requires more credits|model is not supported/u.test(
    reason,
  );
}

export function unanswered(stopped: {
  readonly wallEnded: boolean;
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
  if (last !== undefined && providerFailed(last)) {
    const reason = isString(last.errorMessage) ? last.errorMessage : "the provider failed the turn";
    return { outcome: "non-result", kind: "provider", reason };
  }
  if (last !== undefined && windowEnded(last)) return { outcome: "fail", kind: "context-ended" };
  return { outcome: "fail", kind: stopped.turnsEnded ? "turns-ended" : "no-answer" };
}
