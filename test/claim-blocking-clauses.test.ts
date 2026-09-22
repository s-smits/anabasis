/**
 * Why a battery that ran is still not claimable.
 *
 * Every clause here answers one question about the recorded run rather than about the artifacts:
 * did the run finish, did its cases come from one build, is the condition named, can each case be
 * identified, and is enough of the battery actually measured to carry a rate. A claim that skipped
 * any of them would state a number whose denominator nobody can reconstruct.
 *
 * The refusal reports every clause at once, because a repair loop that peels one clause per round
 * pays for a full rerun per defect. `repairable` separates the two remedies: resume or rerun the
 * same product, against fix the product first.
 */
import { describe, expect, it } from "bun:test";
import { NEVER_ATTEMPTED_PREFIX } from "../src/truth/battery-provider-stop.ts";
import { batteryTerminalReason } from "../src/truth/battery-record.ts";
import type { ScoredCase } from "../src/claim/claim-evidence.ts";
import {
  GREEN_SCORE,
  clauseDetail,
  clauseNames,
  codexIdentities,
  createClaim,
  greenEvidence,
} from "./helpers/claim-evidence.ts";

/** A solver block for a case that started no tool call. */
const NO_CALL = { startedToolCalls: 0 };
/** A scored case that passed and was graded, exercising the default intrinsic check. */
const scored = (caseId: string, passed = true): ScoredCase => ({
  caseId,
  passed,
  truthVerified: true,
  checkIds: ["c1"],
});

describe("a run that did not finish, or did not finish once", () => {
  it("blocks a provisional run as not terminal", () => {
    const result = createClaim(
      greenEvidence({ runStatus: { state: "provisional", reason: null, verified: 4, nonResults: {} } }),
    );
    expect(clauseNames(result)).toContain("run-not-terminal");
  });

  it("blocks an interrupted run with a resume remedy, never as a failure", () => {
    const result = createClaim(
      greenEvidence({ runStatus: { state: "interrupted", reason: "SIGINT", verified: 4, nonResults: {} } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const clause = result.clauses.find((c) => c.clause === "run-interrupted");
    expect(clause?.detail).toMatch(/resume/i);
    expect(clause?.detail).not.toMatch(/\bfailed\b/);
    expect(clause?.repairable).toBe(true);
  });

  it("blocks cases that came from more than one build", () => {
    const result = createClaim(greenEvidence({ staleness: { stale: true, hashes: ["h1", "h2"] } }));
    expect(clauseNames(result)).toContain("evidence-stale");
  });

  it("passes a discrimination finding through under its own code", () => {
    const result = createClaim(
      greenEvidence({
        discrimination: {
          claimable: false,
          findings: [
            {
              code: "DISCRIMINATION_REJECT_PASSED",
              message: "a reject control passed its declared check",
            },
          ],
          attributedCheckIds: { c1: 1 },
        },
      }),
    );
    expect(clauseNames(result)).toContain("DISCRIMINATION_REJECT_PASSED");
  });
});

describe("the condition the score was measured under", () => {
  it("blocks an unfingerprinted slug, with no in-loop remedy", () => {
    const result = createClaim(greenEvidence({ bundles: null }));
    expect(clauseNames(result)).toContain("bundle-hashes-missing");
    if (!result.ok) {
      expect(result.clauses.find((c) => c.clause === "bundle-hashes-missing")?.repairable).toBe(false);
    }
  });

  it("blocks a blank task-set hash even when both bundle hashes exist", () => {
    // Without it, changed questions or hidden expectations would read as the same condition.
    const result = createClaim(
      greenEvidence({
        bundles: { agentHash: "a".repeat(64), correctnessModelHash: "g".repeat(64), taskSetHash: "" },
      }),
    );
    expect(clauseNames(result)).toContain("task-set-hash-missing");
  });
});

describe("cases the record cannot be joined to", () => {
  it("blocks a case identity that repeats, and names it", () => {
    const result = createClaim(greenEvidence(), [
      scored("t1"),
      scored("t1"),
      scored("t2"),
      scored("t3", false),
    ]);
    expect(clauseNames(result)).toContain("case-identity-duplicate");
    expect(clauseDetail(result, "case-identity-duplicate")).toContain("t1");
  });

  it("blocks a blank case identity, which no audit could follow", () => {
    const result = createClaim(greenEvidence(), [
      scored("t1"),
      scored("  "),
      scored("t3"),
      scored("t4", false),
    ]);
    expect(clauseNames(result)).toContain("case-identity-missing");
  });

  it("blocks a case list that disagrees with the record's own count", () => {
    const result = createClaim(greenEvidence(), [...GREEN_SCORE, scored("t5", false), scored("t6", false)]);
    expect(clauseNames(result)).toContain("score-denominator-mismatch");
  });

  it("blocks an empty denominator — empty but green is a defect", () => {
    const result = createClaim(
      greenEvidence({ runStatus: { state: "terminal", reason: "complete", verified: 0, nonResults: {} } }),
      [],
    );
    expect(clauseNames(result)).toContain("empty-denominator");
  });
});

describe("how much of the battery was actually measured", () => {
  it("blocks any verifier throw as a suspect correctness model, repairably", () => {
    const result = createClaim(
      greenEvidence({
        runStatus: {
          state: "terminal",
          reason: "complete",
          verified: 4,
          nonResults: { "verifier-throw": 1 },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const clause = result.clauses.find((c) => c.clause === "suspect-correctness-model");
    expect(clause?.repairable).toBe(true);
    expect(clause?.detail).toMatch(/Correctness Model evaluator threw/);
  });

  it("blocks a mostly-unmeasured battery instead of reporting its surviving cases", () => {
    // "2 clean cases, 38 crashes" falsifying at n=2 is the silent-inflation shape: counting the
    // crashes as failures would be equally wrong, so the battery carries no rate at all.
    const result = createClaim(
      greenEvidence({
        runStatus: { state: "terminal", reason: "complete", verified: 2, nonResults: { solver: 2 } },
      }),
      [scored("t1"), scored("t2")],
    );
    expect(clauseNames(result)).toContain("non-result-ratio-excessive");
    if (result.ok) return;
    expect(result.clauses.find((c) => c.clause === "non-result-ratio-excessive")?.repairable).toBe(true);
    // Nothing recorded a provider stop, so the detail keeps the generic environment sentence.
    expect(clauseDetail(result, "non-result-ratio-excessive")).toContain(
      "too many cases could not be measured",
    );
  });

  it("reads a provider-stopped battery's recorded disposition instead of retelling the outage", () => {
    const result = createClaim(
      greenEvidence({
        runStatus: {
          state: "terminal",
          reason: batteryTerminalReason("provider-stopped", [
            { runtimeNonResult: null, solver: { startedToolCalls: 1 } },
            {
              runtimeNonResult: `${NEVER_ATTEMPTED_PREFIX} after 5 consecutive provider non-results`,
              solver: NO_CALL,
            },
            {
              runtimeNonResult: `${NEVER_ATTEMPTED_PREFIX} after 5 consecutive provider non-results`,
              solver: NO_CALL,
            },
          ]),
          verified: 1,
          nonResults: { provider: 2 },
        },
      }),
      [scored("t1")],
    );
    expect(clauseNames(result)).toContain("non-result-ratio-excessive");
    if (result.ok) return;
    expect(result.clauses.find((c) => c.clause === "non-result-ratio-excessive")?.repairable).toBe(true);
    expect(clauseDetail(result, "non-result-ratio-excessive")).toContain(
      "2/3 attempted case(s) were non-results (>25%)",
    );
    expect(clauseDetail(result, "non-result-ratio-excessive")).toContain(
      "provider-stopped: 2 of 3 cases were never attempted",
    );
    expect(clauseDetail(result, "non-result-ratio-excessive")).not.toContain(
      "too many cases could not be measured",
    );
  });

  it("keeps a single flake in a small battery claimable — the threshold needs two", () => {
    // 1 of 3 attempted is over 25%, but one transient must not block a claim.
    const result = createClaim(
      greenEvidence({
        runStatus: { state: "terminal", reason: "complete", verified: 2, nonResults: { solver: 1 } },
        runtimeIdentities: codexIdentities().slice(0, 2),
      }),
      [scored("t1"), scored("t2")],
    );
    expect(result.ok).toBe(true);
  });
});

describe("the whole refusal, not one clause at a time", () => {
  it("reports every blocking clause in one result", () => {
    const result = createClaim(
      greenEvidence({ bundles: null, staleness: { stale: true, hashes: ["h1", "h2"] } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.clauses.length).toBeGreaterThanOrEqual(2);
  });

  it("calls a refusal repairable only when every clause has an in-loop remedy", () => {
    const interrupted = { state: "interrupted" as const, reason: "signal", verified: 4, nonResults: {} };
    const repairable = createClaim(greenEvidence({ runStatus: interrupted }));
    if (!repairable.ok) expect(repairable.repairable).toBe(true);
    // One clause needing a rebuilt product is enough to make the whole refusal unrepairable.
    const hard = createClaim(greenEvidence({ runStatus: interrupted, bundles: null }));
    if (!hard.ok) expect(hard.repairable).toBe(false);
  });

  it("blocks a prediction that carries no closing disposition, and clears with one", () => {
    expect(
      clauseNames(createClaim(greenEvidence({ predictions: [{ id: "p1", outcome: "refuted" }] }))),
    ).toContain("prediction-record-open");
    expect(
      createClaim(greenEvidence({ predictions: [{ id: "p1", outcome: "refuted", disposition: "repair" }] }))
        .ok,
    ).toBe(true);
    // An unexercised prediction needs a retest or a deletion; repairing what never ran closes nothing.
    expect(
      clauseNames(
        createClaim(
          greenEvidence({ predictions: [{ id: "p1", outcome: "unexercised", disposition: "repair" }] }),
        ),
      ),
    ).toContain("prediction-record-open");
  });
});
