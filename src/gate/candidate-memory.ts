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
// Gate audit 2026-09-25 (docs/gate-audit.md, repeated-findings-stall): commented out (unsure): one refusal repeated over changed bytes is repair in progress, not a proven stall
// import type { AuthorRepairFinding } from "../author/campaign-types.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
// import {
//   type ToolNonResultCounts,
//   ToolNonResultStrikes,
//   chargeSealedNonResult,
// } from "../author/tool-non-result.ts";
import { POLICY } from "../critic/policy.ts";
import { type ContractFinding, controllerValidatedFinding } from "../truth/brief.ts";
import { createValidationMemory } from "./validation-pipeline.ts";

/** The session memory a resumed campaign restores from its recorded iterations. */
type MemoryCarry = {
  lastBlockedCandidateId: string | null;
  lastBlockedCandidateStrikes: number;
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
  // toolNonResultRefusals: Readonly<ToolNonResultCounts>;
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

// Gate audit 2026-09-25 (docs/gate-audit.md, repeated-findings-stall): commented out (unsure): one refusal repeated over changed bytes is repair in progress, not a proven stall
// /** How many gates-blocked iterations in a row, this one included, recorded `findingsHash`. */
// export function findingsRepeatRun(
//   priorBlockedFindingsHashes: readonly string[],
//   findingsHash: string,
// ): number {
//   const differs = priorBlockedFindingsHashes.findLastIndex((hash) => hash !== findingsHash);
//   return priorBlockedFindingsHashes.length - differs;
// }
//
// /** The steering between the second identical diagnosis and the ceiling. Without it a session can
//  *  record one findings hash round after round on as many different trees, with nothing telling the
//  *  author the diagnosis has not moved, so each round reads as a fresh refusal. Projected where it
//  *  is rendered. */
// export function repeatedFindingsFinding(repeats: number): AuthorRepairFinding {
//   const ceiling = POLICY.loop.stalledFindingsRepeats;
//   return {
//     ...controllerValidatedFinding({
//       code: "authoring-repeated-findings",
//       path: "submit",
//       detail: `the findings above are the same as for the previous ${repeats - 1} refused authoring pass(es) — repeat ${repeats} of ${ceiling}. Re-read each finding's detail and path and change what it names; the round ends at ${ceiling} identical diagnoses in a row`,
//     }),
//     severity: "advisory",
//   };
// }

/** The session's last words on a terminal stall. */
function authoringStalledFinding(strikes: number) {
  return controllerValidatedFinding({
    code: "authoring-stalled",
    path: "submit",
    detail: `the same candidate and verifier condition was refused ${strikes + 1} times in a row; proposal or memory edits do not change that condition. The refusal above is final and the round ends here`,
  });
}

/** The between-strikes steering for a resubmitted refused condition. */
function noopSubmitFinding(strike: number) {
  return controllerValidatedFinding({
    code: "authoring-noop-submit",
    path: "submit",
    detail: `unchanged candidate and verifier condition — attempt ${strike} of ${POLICY.loop.noopSubmitStrikes}. EXPERIMENT.json and memory edits do not change that condition. Repair the candidate files or installed verifier named by the refusal; the round ends at ${POLICY.loop.noopSubmitStrikes}`,
  });
}

export class CandidateMemory<R extends Refusal> {
  /** One refusal per submission condition, for a session returning to an earlier candidate. */
  private readonly refusals = new Map<string, R>();
  /** Gate runs, preview results and F2 stage results for this session. */
  readonly validation = createValidationMemory();
  private readonly noop: NoopStrikes;
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
  // /** Refused control censuses charged to each tool id across the whole campaign. */
  // private readonly toolNonResults: ToolNonResultStrikes;
  // /** Gate-run directories already charged: a run preview and submit share is charged once. */
  // private readonly charged = new Set<string>();
  /** Set when a strike reaches its ceiling. */
  stalled = false;

  constructor(carry: MemoryCarry) {
    this.noop = new NoopStrikes(carry.lastBlockedCandidateId, carry.lastBlockedCandidateStrikes);
    // Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
    // this.toolNonResults = new ToolNonResultStrikes(carry.toolNonResultRefusals);
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

  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
  // /** One strike per executed gate run whose host recorded a no-verdict result in `runDir`. */
  // chargeToolNonResult(runDir: string) {
  //   if (this.charged.has(runDir)) return null;
  //   this.charged.add(runDir);
  //   return chargeSealedNonResult(this.toolNonResults, runDir);
  // }
}
