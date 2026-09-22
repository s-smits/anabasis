/**
 * Who may write a claim, and what a written one states.
 *
 * A claim is the only place the system says what a run achieved, so the write itself is the
 * boundary worth guarding: an object literal that typechecks as a Claim, or a constructor reachable
 * through an alias, would let a caller state a result no evidence supports. The brand and the token
 * close the compile-time and runtime halves of that, and the audit probe below is the exact shape
 * that compiled clean before the brand landed.
 *
 * The statement's own counts come from the case list rather than from the caller, because the
 * earlier {n, passed} input admitted passed > n, negative and non-finite scores.
 */
import { describe, expect, it } from "bun:test";
import { Claim } from "../src/claim/claim.ts";
import { type JudgeEvidence, InvalidReviewEvidenceError } from "../src/claim/judge.ts";
import {
  claudeIdentities,
  createClaim,
  greenEvidence,
  judgeWithDisagreements,
} from "./helpers/claim-evidence.ts";
import { double } from "./helpers/doubles.ts";

describe("the write path is the only way to a claim", () => {
  it("refuses the private constructor, and the alias that reaches it", () => {
    // @ts-expect-error — private constructor; if this directive goes unused, the write leaked
    expect(() => new Claim(Symbol("invalid"), {})).toThrow(/Create claims only/);
    // @ts-expect-error — the private constructor refuses this alias too; an unused directive here
    // means the class became publicly constructible and the runtime guard is no longer the last word
    const ConstructorAlias: new (token: symbol, statement: Record<string, never>) => Claim = Claim;
    // Guessing the token's description does not reproduce the module-private symbol.
    expect(() => new ConstructorAlias(Symbol("ana-claim-write"), {})).toThrow(/Create claims only/);
  });

  it("does not accept a receiptless object literal as a Claim", () => {
    // The audit probe: { ok: true, statement } with no `new` and no cast compiled clean before the
    // private brand field landed. If this directive goes unused, the loophole re-opened.
    // @ts-expect-error — a receiptless literal must not typecheck as Claim
    const fake: Claim = { ok: true as const, statement: double({}) };
    expect(fake.ok).toBe(true);
  });

  it("freezes the statement and copies the capabilities the caller passed", () => {
    const evidence = greenEvidence();
    const claim = createClaim(evidence);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(() => {
      // SAFETY: the created statement, whose declared type is opaque; the write is expected to throw
      // because the statement is frozen, so the field named here need not exist.
      (claim.statement as { n: number }).n = 999;
    }).toThrow();
    // A retained array would let the caller edit a written claim's stated condition after the fact.
    evidence.capabilities?.push("web-search:on");
    expect(claim.statement.capabilities).toEqual(["web-search:off"]);
  });
});

describe("what a written claim states", () => {
  it("names the run, the condition and the three bundle hashes", () => {
    const claim = createClaim(greenEvidence());
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.statement).toMatchObject({
      slug: "s1",
      runId: "r1",
      n: 4,
      passed: 3,
      passRate: 0.75,
      vetoed: 0,
      backendPin: "codex/gpt-5.5",
      capabilities: ["web-search:off"],
      buildInputsHash: "h1",
      agentHash: "a".repeat(64),
      correctnessModelHash: "g".repeat(64),
      taskSetHash: "t".repeat(64),
      correctnessModelId: `correctness-model@${"g".repeat(64)}`,
      judge: "off",
      judgeDecision: null,
    });
  });

  it("derives n and passed from the case list, so a caller cannot inflate the score", () => {
    // The old {n, passed} input admitted passed > n, negative and non-finite scores; a case list
    // cannot express any of them.
    const claim = createClaim(greenEvidence());
    if (!claim.ok) throw new Error("the green battery must be claimable");
    expect(claim.statement.n).toBe(4);
    expect(claim.statement.passed).toBe(3);
    expect(claim.statement.passRate).toBe(0.75);
  });

  it("treats an absent prediction sidecar as no record, not as an open one", () => {
    expect(createClaim(greenEvidence({ predictions: null })).ok).toBe(true);
  });

  it("proves the pin from a Claude census and leaves an unsupported transport's pin unverified", () => {
    const proven = createClaim(
      greenEvidence({ backendPin: "claude/claude-opus-4-8", runtimeIdentities: claudeIdentities() }),
    );
    expect(proven.ok).toBe(true);
    if (proven.ok) expect(proven.statement.modelIdentity).toBe("provider-native");
    // A transport with no provider-native evidence producer discloses its pin rather than refusing:
    // the missing census is a fact about the route, not about the scored cases.
    const unsupported = greenEvidence({ backendPin: "openrouter/model" });
    delete unsupported.runtimeIdentities;
    expect(createClaim(unsupported).ok).toBe(true);
  });
});

describe("review evidence the claim carries but never obeys", () => {
  it("discloses a review that disputed half its verified cases, and consumes no clause for it", () => {
    const current = createClaim(greenEvidence({ judge: judgeWithDisagreements() }));
    expect(current.ok).toBe(true);
    if (current.ok) {
      expect(current.statement).toMatchObject({ judge: "unvalidated", judgeDecision: "advisory-comparison" });
    }
  });

  it("throws on contradictory review evidence instead of returning a refusal", () => {
    // A producer that recorded an impossible review is a defect in the producer. A claim clause
    // would invite a repair loop to route around it; the throw stops the write.
    const contradictory: JudgeEvidence = { ...judgeWithDisagreements(), decision: "non-result" };
    expect(() => createClaim(greenEvidence({ judge: contradictory }))).toThrow(InvalidReviewEvidenceError);
  });

  it("refuses a review a control census stood behind, as recorded before 2026-09-14", () => {
    const census: JudgeEvidence = {
      ...judgeWithDisagreements(),
      censusSize: { controls: 4, battery: 4, total: 8 },
      verdicts: { controls: 4, battery: 4, total: 8 },
    };
    expect(() => createClaim(greenEvidence({ judge: census }))).toThrow(/censusSize.controls must be 0/);
  });

  it("binds the review to the battery's own pin and correctness model", () => {
    const crossedPin: JudgeEvidence = {
      ...judgeWithDisagreements(),
      evaluatedPin: "claude/claude-opus-5",
    };
    expect(() => createClaim(greenEvidence({ judge: crossedPin }))).toThrow(
      /does not match battery backendPin/,
    );
    const staleModel: JudgeEvidence = {
      ...judgeWithDisagreements(),
      correctnessModelId: "correctness-model@stale-correctnessModel-hash",
    };
    expect(() => createClaim(greenEvidence({ judge: staleModel }))).toThrow(
      /does not match claim Correctness Model identity/,
    );
  });

  it("re-derives every review figure rather than trusting the stored one", () => {
    const green = judgeWithDisagreements();
    // Abstentions claimed beyond the unanswered census.
    expect(() =>
      createClaim(greenEvidence({ judge: { ...green, abstentions: { controls: 1, battery: 0, total: 1 } } })),
    ).toThrow(/abstention is a designed null/);
    // The evaluated pin rides the evidence, so independence is re-derivable and never asserted:
    // the same pin on both sides derives same-model, and the stored different-family must throw.
    expect(() => createClaim(greenEvidence({ judge: { ...green, evaluatedPin: "scripted/judge" } }))).toThrow(
      /contradicts the evidence's pins/,
    );
    // An independence class no session produces cannot be asserted into the evidence either.
    expect(() => createClaim(greenEvidence({ judge: { ...green, independence: "deterministic" } }))).toThrow(
      /contradicts the evidence's pins/,
    );
  });
});
