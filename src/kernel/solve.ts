/**
 * A solve's ending: every solve ends in exactly one, and the log records which.
 *
 * A pass is an answer the verifier accepted. A fail is any other ending the solver owns, by kind:
 * the verifier rejected the submitted answer, the host's wall ended the solve, the model's context
 * ran out, the solve stopped without submitting one, at the turn cap or by giving up, or the
 * harness's tools could not be bundled or listed, so it never began. A broken harness is the
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
 */
export type Ending =
  | { readonly outcome: "pass" }
  | { readonly outcome: "fail"; readonly kind: "rejected" | "wall-ended" | "context-ended" | "no-answer" }
  | { readonly outcome: "fail"; readonly kind: "broken-harness"; readonly reason: string }
  | {
      readonly outcome: "non-result";
      readonly kind: "provider" | "sandbox-crash" | "killed" | "moved-files" | "check" | "verifier";
      readonly reason: string;
    };
