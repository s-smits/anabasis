/**
 * Whether a declared check ever actually ran.
 *
 * hw1 is the case this exists for. Its correctness model read `hidden` as an object and skipped the
 * expected values on all 16 cases; every case passed, and the run wrote a ready claim, although the
 * declared answer-key comparison had assessed nothing. Only artifact shape had been checked. A
 * declaration cannot establish execution, so the battery has to record which checks fired and the
 * claim has to read those counts.
 *
 * The readings that must not fire are as important as the one that must. A check with no verified
 * case to run on was never given an opportunity; a battery where nothing reached the verifier has
 * no execution to report; and an external check's firing lives in its own grounding clauses.
 * Reading any of those as an unreachable answer key would blame the harness for the environment.
 */
import { describe, expect, it } from "bun:test";
import type { ScoredCase } from "../src/claim/claim-evidence.ts";
import { NO_EXTERNAL_EXECUTION } from "../src/truth/grounding.ts";
import {
  INTRINSIC_C1,
  INTRINSIC_C2,
  RESONANCE,
  clauseDetail,
  clauseNames,
  createClaim,
  discriminatedChecks,
  greenEvidence,
  qiskitExecution,
} from "./helpers/claim-evidence.ts";

const NEVER_FIRED = "TRUTH_CHECK_NEVER_FIRED";

/** Both intrinsic checks declared and attributed, so only the firing read can block. */
const twoIntrinsicChecks = {
  grounding: { declared: [INTRINSIC_C1, INTRINSIC_C2], execution: NO_EXTERNAL_EXECUTION },
  discrimination: { claimable: true, findings: [], attributedCheckIds: { c1: 3, c2: 1 } },
};

describe("a declared check that fired on no verified case", () => {
  it("blocks and names the check, with no in-loop remedy", () => {
    const result = createClaim(
      greenEvidence({
        truthCheckFiring: {
          firedByCheck: { c1: 0 },
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: { c1: 4 },
          verifierVerifiedCount: 4,
        },
      }),
    );
    expect(clauseNames(result)).toContain(NEVER_FIRED);
    if (result.ok) return;
    const clause = result.clauses.find((c) => c.clause === NEVER_FIRED);
    expect(clause?.detail).toContain("c1");
    expect(clause?.detail).toContain("0 of 4");
    // A verified battery whose declared check never executed cannot be repaired by rerunning it.
    expect(clause?.repairable).toBe(false);
  });

  it("clears as soon as the check fired once", () => {
    const fired = createClaim(
      greenEvidence({
        truthCheckFiring: {
          firedByCheck: { c1: 1 },
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: { c1: 4 },
          verifierVerifiedCount: 4,
        },
      }),
    );
    expect(fired.ok).toBe(true);
  });

  it("names only the checks that never fired", () => {
    const result = createClaim(
      greenEvidence({
        ...twoIntrinsicChecks,
        truthCheckFiring: {
          firedByCheck: { c1: 4, c2: 0 },
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: { c1: 4, c2: 4 },
          verifierVerifiedCount: 4,
        },
      }),
    );
    expect(clauseNames(result)).toContain(NEVER_FIRED);
    expect(clauseDetail(result, NEVER_FIRED)).toContain("c2");
    expect(clauseDetail(result, NEVER_FIRED)).not.toContain("c1");
  });
});

describe("readings that would blame the harness for the environment", () => {
  it("does not flag a check that applied to no verified case", () => {
    // In truss-opus-20260905T221340355Z-aa0ebb-i05 every one of the six tasks the two diagnosis
    // checks applied to was a provider non-result, and the clause blamed the harness for checks
    // that had no case to fire on.
    const firing = (applicableByCheck: Record<string, number>) =>
      greenEvidence({
        ...twoIntrinsicChecks,
        truthCheckFiring: {
          firedByCheck: { c1: 4, c2: 0 },
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck,
          verifierVerifiedCount: 4,
        },
      });
    expect(clauseNames(createClaim(firing({ c1: 4, c2: 0 })))).not.toContain(NEVER_FIRED);
    // Two applicable cases and no firing is the real defect again.
    const flagged = createClaim(firing({ c1: 4, c2: 2 }));
    expect(clauseNames(flagged)).toContain(NEVER_FIRED);
    expect(clauseDetail(flagged, NEVER_FIRED)).toContain("c2");
  });

  it("does not flag an external check absent from the firing record", () => {
    // Firing telemetry tracks the intrinsic AST, and the external grounding clauses own whether
    // that adapter ran. An external check missing from firedByCheck must not read as never-fired.
    const score: ScoredCase[] = ["t1", "t2", "t3", "t4"].map((caseId) => ({
      caseId,
      passed: caseId !== "t4",
      truthVerified: true,
      checkIds: ["c1", "resonance"],
    }));
    const result = createClaim(
      greenEvidence({
        grounding: {
          declared: [INTRINSIC_C1, RESONANCE],
          execution: qiskitExecution(["t1", "t2", "t3", "t4"]),
        },
        truthCheckFiring: {
          firedByCheck: { c1: 4 },
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: { c1: 4 },
          verifierVerifiedCount: 4,
        },
        discrimination: discriminatedChecks("resonance"),
      }),
      score,
    );
    expect(clauseNames(result)).not.toContain(NEVER_FIRED);
    expect(result.ok).toBe(true);
  });

  it("stays inert when no artifact reached the correctness model", () => {
    // The all-unaccepted shape: nothing was truth-verified, so a check cannot have fired. The
    // empty-denominator clause owns that refusal.
    const result = createClaim(
      greenEvidence({
        runStatus: { state: "terminal", reason: "complete", verified: 0, nonResults: {} },
        truthCheckFiring: {
          firedByCheck: { c1: 0 },
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: { c1: 0 },
          verifierVerifiedCount: 0,
        },
      }),
      [],
    );
    expect(clauseNames(result)).not.toContain(NEVER_FIRED);
    expect(clauseNames(result)).toContain("empty-denominator");
  });

  it("stays inert when scored attempts exist but none was graded", () => {
    // runStatus.verified counts scored attempts, unaccepted ones included; verifierVerifiedCount
    // counts the artifacts that actually reached the verifier. Zero of those is no opportunity.
    const result = createClaim(
      greenEvidence({
        runStatus: { state: "terminal", reason: "complete", verified: 4, nonResults: {} },
        truthCheckFiring: {
          firedByCheck: { c1: 0 },
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: { c1: 0 },
          verifierVerifiedCount: 0,
        },
      }),
    );
    expect(clauseNames(result)).not.toContain(NEVER_FIRED);
  });
});

describe("a checkId named __proto__ cannot read a count off the prototype chain", () => {
  // checkIds are validated only as strings, so a Builder can author "__proto__". The live path
  // passes these count records as null-prototype maps, but the Record<string, number> boundary also
  // admits ordinary objects — evidence round-tripped through JSON.parse, or written by hand. On
  // those, reading a never-recorded "__proto__" off the prototype chain returns Object.prototype:
  // not nullish, not 0, so a never-observed check would read as observed and the claim would fail
  // open. The fixtures use JSON.parse because an object literal { "__proto__": n } sets the
  // prototype instead of creating the key.
  const declared = [
    { checkId: "__proto__", grounding: { kind: "intrinsic" as const, primitive: "relationalJoin" } },
  ];
  const grounding = { declared, execution: NO_EXTERNAL_EXECUTION };
  const score: ScoredCase[] = ["t1", "t2", "t3", "t4"].map((caseId) => ({
    caseId,
    passed: caseId !== "t4",
    truthVerified: true,
    checkIds: ["__proto__"],
  }));

  it("blocks when the firing record has no own key for it", () => {
    const result = createClaim(
      greenEvidence({
        grounding,
        // Attributed, so the discrimination clause stays quiet and the firing read is isolated.
        discrimination: { claimable: true, findings: [], attributedCheckIds: JSON.parse('{"__proto__": 1}') },
        truthCheckFiring: {
          firedByCheck: {},
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: JSON.parse('{"__proto__": 4}'),
          verifierVerifiedCount: 4,
        },
      }),
      score,
    );
    expect(clauseNames(result)).toContain(NEVER_FIRED);
    expect(clauseDetail(result, NEVER_FIRED)).toContain("__proto__");
  });

  it("blocks when the attribution record has no own key for it", () => {
    const result = createClaim(
      greenEvidence({
        grounding,
        discrimination: { claimable: true, findings: [], attributedCheckIds: {} },
        // Fired, so the never-fired clause stays quiet and the attribution read is isolated.
        truthCheckFiring: {
          firedByCheck: JSON.parse('{"__proto__": 4}'),
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: JSON.parse('{"__proto__": 4}'),
          verifierVerifiedCount: 4,
        },
      }),
      score,
    );
    expect(clauseNames(result)).toContain("intrinsic-grounding-uncovered");
  });

  it("counts a recorded own key correctly and does not block", () => {
    const result = createClaim(
      greenEvidence({
        grounding,
        discrimination: { claimable: true, findings: [], attributedCheckIds: JSON.parse('{"__proto__": 2}') },
        truthCheckFiring: {
          firedByCheck: JSON.parse('{"__proto__": 4}'),
          executedByCheck: {},
          blockingByCheck: {},
          applicableByCheck: JSON.parse('{"__proto__": 4}'),
          verifierVerifiedCount: 4,
        },
      }),
      score,
    );
    expect(clauseNames(result)).not.toContain(NEVER_FIRED);
    expect(result.ok).toBe(true);
  });
});
