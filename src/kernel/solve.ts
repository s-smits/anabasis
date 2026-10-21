/**
 * A solve's ending: every solve ends in exactly one, and the log records which.
 *
 * A pass is an answer the verifier accepted. A fail is any other ending the solver owns, by kind:
 * the verifier rejected the submitted answer, the host's wall ended the solve, the model's context
 * ran out, the model's own turns ran out where the solve is given a number of them, the solve
 * stopped without submitting one, at the prompt cap or by giving up, or the harness's tools could
 * not be bundled or listed, so it never began. A broken harness is the
 * harness's own fail: a non-result would be rerun into the same break and then dropped, and the
 * harness would leave the score with it. A context
 * that outgrows the model is the solver's own ending, never the provider's, though the provider
 * reports it as an error. On 7 October every solver checked its
 * answer with the grading engine before submitting, so rejected answers are expected to be the rare
 * kind, and a report that counts fails without their kinds would hide where supply comes from.
 *
 * A non-result is an ending the solver does not own: the provider failed the turn (it refused, was
 * overloaded or closed the connection, as a Sol solve's did on 8 October with "WebSocket closed
 * 1000"), the sandbox crashed, the run was killed, files or tools moved during the solve, the task's own check failed on the answer
 * (it threw or returned no verdict), or the verifier could not decide. It is never counted as a pass
 * or a fail. One from the solve's side is run again, up to three times with backoff. A faulty check
 * is the task's defect: the task is dropped and the run goes on. One from the verifier stops the
 * run, since a broken verifier makes one of every check: a relative tree path once turned every
 * verdict of a regrade into one.
 *
 * A flag is the solver's word that the task is malformed, given in `submit`'s place of an answer
 * (`src/solve/answer.ts`), with why. It is its own outcome, reported apart, and in every tally the
 * flagging side's own fail (`passed`, `src/kernel/solves.ts`), for rule 7's reason for a broken
 * harness: counted nowhere, a flag would take a task its harness was losing out of the tally. So a
 * task that really is malformed costs nothing, both sides flag it and it ties, and a harness that
 * flags a task the other side answers loses it. It is not run again inside the solve, since the
 * solver chose it. Added on 12 October (the overhaul plan's M3, research 06): offered such an
 * outcome, solvers that cheated on impossible tasks in 54% of them did so in 9% (ImpossibleBench).
 */
import { type AssistantMessage, isContextOverflow } from "@earendil-works/pi-ai";
import { isString, type JsonValue } from "../meta/json-shape.ts";

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
      readonly kind: "provider" | "sandbox-crash" | "killed" | "moved-files" | "check" | "verifier";
      readonly reason: string;
    };

/** A solve's last turn, as the agent holds it or as its `solve.turn` event records it. */
interface LastTurn {
  readonly stopReason?: JsonValue | undefined;
  readonly errorMessage?: JsonValue | undefined;
}

/**
 * Whether the model's window ended a solve's last turn: a reply cut at its length, or a context
 * that outgrew the model, which the provider reports as an error. The one reading of it: `judge`
 * (`src/solve/run.ts`) asks it of the last turn it holds, and the pool (`taskRecords`,
 * `src/kernel/reports.ts`) of the last `solve.turn` the log records, its `stopReason` and its
 * `error`. A solve the window ended is cut, whatever its turns: the solver is told its turns and
 * never its window. Until 19 October `judge` read spent turns first and wrote `turns-ended` for a
 * window filled on the last allowed turn, so a log of before holds such solves, and the pool reads
 * them by their last turn as it reads the ones written since.
 */
export function windowEnded(last: LastTurn): boolean {
  const { stopReason, errorMessage } = last;
  if (stopReason === "length") return true;
  if (stopReason !== "error" || !isString(errorMessage)) return false;
  // SAFETY: without a context window pi reads a message's stop reason, its error and its provider
  // alone (`isContextOverflow`, pi-ai's utils/overflow.ts); a missing provider matches no pattern.
  return isContextOverflow({ stopReason, errorMessage } as AssistantMessage);
}

/**
 * Whether the provider failed a solve's last turn: an error that is not the window's. `judge` ends
 * such a solve a non-result (`provider`), and the pool reads one a log holds as `turns-ended` as a
 * cut: until 14 October `judge` wrote `turns-ended` for a provider failure on the last allowed
 * turn (`src/solve/run.ts`), and a log of before must read as it did.
 */
export function providerFailed(last: LastTurn): boolean {
  return last.stopReason === "error" && !windowEnded(last);
}

/**
 * How a solve that left no answer ended: the wall's, its last turn's (the provider's failure or the
 * window's), its spent turns', or no answer. The one reading of it, which `judge`
 * (`src/solve/run.ts`) asks once an answer, a flag, a crash and a broken harness are ruled out, and
 * which any other runner of a solve asks of the solve it ran, so that both read one ending alike.
 */
export function unanswered(stopped: {
  readonly wallEnded: boolean;
  readonly turnsEnded: boolean;
  readonly last: LastTurn | undefined;
}): Extract<Ending, { readonly kind: string }> {
  const { last } = stopped;
  if (stopped.wallEnded) return { outcome: "fail", kind: "wall-ended" };
  // A last turn the provider failed is the provider's, though it was the last the solve was
  // allowed: until 14 October it was read as the solver's loss at its turns (`turns-ended`). A
  // context the solver filled is its own, and comes as an error too.
  if (last !== undefined && providerFailed(last)) {
    const reason = isString(last.errorMessage) ? last.errorMessage : "the provider failed the turn";
    return { outcome: "non-result", kind: "provider", reason };
  }
  // A full context or a cut reply is the window's, the last allowed turn included (`windowEnded`).
  if (last !== undefined && windowEnded(last)) return { outcome: "fail", kind: "context-ended" };
  return { outcome: "fail", kind: stopped.turnsEnded ? "turns-ended" : "no-answer" };
}
