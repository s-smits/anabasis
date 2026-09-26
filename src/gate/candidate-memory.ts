/**
 * What an authoring session remembers about the candidates it has submitted, and the one owner
 * of the repetition-stop policy that memory enforces.
 *
 * One rule ends repeated work: the in-session no-op counter strikes a byte-identical resubmit of a
 * refused condition (POLICY.loop.noopSubmitStrikes). Each repeat below its ceiling is steered with
 * its count, rather than ending the session, because ending on the first repeat kills sessions
 * whose transcript already records a concrete next move. There is no changed-tree cycle strike and
 * no no-submit strike (operator decision), since a changed tree carrying the same diagnosis is
 * ordinary repair rather than a stall.
 *
 * The count exists because unbounded repetition is expensive rather than merely untidy: an
 * unbounded session will pay for census and F2 a dozen times in one provider turn on bytes it has
 * already checked, or make a hundred submissions. Bounding it wrongly is expensive too: charging a
 * commit for a worker crash it did not cause strikes the same tree twice.
 */
import { POLICY } from "../critic/policy.ts";
import { type ContractFinding, controllerValidatedFinding } from "../truth/brief.ts";
import { createValidationMemory } from "./validation-pipeline.ts";

/** The session memory a resumed campaign restores from its recorded iterations. */
type MemoryCarry = {
  lastBlockedCandidateId: string | null;
  lastBlockedCandidateStrikes: number;
};

type Refusal = { terminal?: boolean; findings: ContractFinding[] };

/**
 * Consecutive-repeat counter for one no-op identity. Any different key resets the count: a changed
 * tree is repair, not a kept refusal. A seed key and count restore strikes already spent before
 * this invocation, so a resumed session continues the count instead of restarting it.
 */
// Gate audit 2026-09-25 (docs/gate-audit.md, noop-submit-strike): kept: a byte-identical resubmit of a refused candidate cannot earn a different verdict
class NoopStrikes {
  constructor(
    private key: string | null,
    private count: number,
  ) {}

  strike(key: string) {
    this.count = key === this.key ? this.count + 1 : 0;
    this.key = key;
    return { count: this.count, terminal: this.count >= POLICY.loop.noopSubmitStrikes };
  }
}

/** The session's last words on a terminal stall. */
function authoringStalledFinding(strikes: number) {
  return controllerValidatedFinding({
    code: "authoring-stalled",
    path: "submit",
    detail: `the same candidate and verifier condition was refused ${strikes + 1} times in a row; proposal or memory edits do not change that condition. The refusal above is final, and the campaign ends here as build-failed`,
  });
}

/** The between-strikes steering for a resubmitted refused condition. */
function noopSubmitFinding(strike: number) {
  return controllerValidatedFinding({
    code: "authoring-noop-submit",
    path: "submit",
    detail: `unchanged candidate and verifier condition — attempt ${strike} of ${POLICY.loop.noopSubmitStrikes}. EXPERIMENT.json and memory edits do not change that condition. Repair the candidate files or installed verifier named by the refusal; at ${POLICY.loop.noopSubmitStrikes} the campaign ends as build-failed`,
  });
}

export class CandidateMemory<R extends Refusal> {
  /** One refusal per submission condition, for a session returning to an earlier candidate. */
  private readonly refusals = new Map<string, R>();
  /** Gate runs, preview results and F2 stage results for this session. */
  readonly validation = createValidationMemory();
  private readonly noop: NoopStrikes;
  /** Set when a strike reaches its ceiling. */
  stalled = false;

  constructor(carry: MemoryCarry) {
    this.noop = new NoopStrikes(carry.lastBlockedCandidateId, carry.lastBlockedCandidateStrikes);
  }

  /** The refusal this exact condition already earned (A → B → A): answering from memory keeps the
   *  repeat cheap, and the strike keeps it bounded. */
  refusalFor(key: string): R | undefined {
    return this.refusals.get(key);
  }

  /** Remember a refusal only when a later resubmit would ask the same question. A terminal refusal
   *  ends the session, and a retryable one (a typed runtime non-result or a host refusal) is not a
   *  verdict on these bytes. */
  remember(key: string, refusal: R, kind: "retryable" | "verdict"): void {
    if (refusal.terminal === true || kind === "retryable") return;
    this.refusals.set(key, refusal);
  }

  /** Every non-terminal refusal passes here with its condition: a first sighting returns unchanged,
   *  a repeat carries its count, and the ceiling makes the refusal final. */
  strike(key: string, refusal: R): R {
    const noop = this.noop.strike(key);
    if (noop.terminal) {
      this.stalled = true;
      return {
        ...refusal,
        terminal: true,
        findings: [...refusal.findings, authoringStalledFinding(noop.count)],
      };
    }
    if (noop.count > 0) return { ...refusal, findings: [...refusal.findings, noopSubmitFinding(noop.count)] };
    return refusal;
  }
}
