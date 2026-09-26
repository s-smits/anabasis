/**
 * `Claim.create`: the one write that turns a recorded battery into a statement, or refuses it with
 * every clause at once.
 *
 * Each refusal row changes one fact of `greenEvidence()` and expects exactly the one clause that
 * fact owns, so the row also proves the fixture is green for no other reason. `repairable` is the
 * remedy the clause carries: rerun or resume the same product, against fix the product first.
 * The claimable rows are the nearest shapes each clause must not mistake for its own — a check with
 * no verified case to fire on, a single flake in a small battery, a key named `__proto__`.
 */
import { describe, expect, it } from "bun:test";
import { Claim } from "../src/claim/claim.ts";
import type { ClaimEvidence, ScoredCase } from "../src/claim/claim-evidence.ts";
import type { JudgeEvidence } from "../src/claim/judge.ts";
import { NEVER_ATTEMPTED_PREFIX } from "../src/truth/battery-provider-stop.ts";
import { batteryTerminalReason } from "../src/truth/battery-record.ts";
import { NO_EXTERNAL_EXECUTION } from "../src/truth/grounding.ts";
import {
  AUTHORED_C1,
  AUTHORED_C2,
  GREEN_SCORE,
  RESONANCE,
  clauseNames,
  clauseOf,
  codexIdentities,
  createClaim,
  discriminatedChecks,
  firing,
  greenEvidence,
  judgeWithDisagreements,
  qiskitExecution,
  statementOf,
  terminal,
} from "./helpers/claim-evidence.ts";
import { double } from "./helpers/doubles.ts";

const NEVER_FIRED = "TRUTH_CHECK_NEVER_FIRED";

type Refusal = {
  evidence: Partial<ClaimEvidence>;
  score?: ScoredCase[];
  clause: string;
  repairable: boolean;
  detail?: string;
  notDetail?: RegExp;
};

type Claimable = { evidence: Partial<ClaimEvidence>; score?: ScoredCase[] };

/** A pin on a transport with no identity producer, for the rows whose case list the codex census
 *  would no longer match: model identity is not what those rows are about. */
const UNCENSUSED = { backendPin: "scripted/none" };

/** Two authored checks, both attributed, so only the firing read can separate them. */
const twoAuthoredChecks = {
  grounding: { declared: [AUTHORED_C1, AUTHORED_C2], execution: NO_EXTERNAL_EXECUTION },
  discrimination: { claimable: true, findings: [], attributedCheckIds: { c1: 3, c2: 1 } },
};

const scored = (caseId: string, passed = true): ScoredCase => ({
  caseId,
  passed,
  truthVerified: true,
  checkIds: ["c1"],
});

/** The first `n` green cases, with a census that covers exactly those. */
const firstCases = (n: number) => ({
  score: GREEN_SCORE.slice(0, n),
  runtimeIdentities: codexIdentities().slice(0, n),
});

/** A check a Builder named `__proto__`, declared authored and applied by every case. The count maps
 *  come from JSON.parse, because a literal `{ "__proto__": n }` sets the prototype instead of the key. */
const protoCheck = {
  grounding: {
    declared: [
      {
        checkId: "__proto__",
        grounding: { kind: "authored" as const, assertion: "assignments obey the public slot rules" },
      },
    ],
    execution: NO_EXTERNAL_EXECUTION,
  },
};
const protoScore = GREEN_SCORE.map((row) => ({ ...row, checkIds: ["__proto__"] }));
const protoCounts = (n: number): Record<string, number> => JSON.parse(`{"__proto__": ${n}}`);

const providerStopped = batteryTerminalReason("provider-stopped", [
  { runtimeNonResult: null, solver: { startedToolCalls: 1 } },
  ...[1, 2].map(() => ({
    runtimeNonResult: `${NEVER_ATTEMPTED_PREFIX} after 5 consecutive provider non-results`,
    solver: { startedToolCalls: 0 },
  })),
]);

const REFUSALS = {
  "a provisional run": {
    evidence: { runStatus: { state: "provisional", reason: null, verified: 4, nonResults: {} } },
    clause: "run-not-terminal",
    repairable: true,
  },
  "an interrupted run, worded as a resume and never as a failure": {
    evidence: { runStatus: { state: "interrupted", reason: "SIGINT", verified: 4, nonResults: {} } },
    clause: "run-interrupted",
    repairable: true,
    detail: "(SIGINT). Resume or rerun it",
    notDetail: /\bfailed\b/,
  },
  "cases from more than one build": {
    evidence: { staleness: { stale: true, hashes: ["h1", "h2"] } },
    clause: "evidence-stale",
    repairable: false,
    detail: "[h1, h2]",
  },
  "a discrimination finding, under its own code": {
    evidence: {
      discrimination: {
        claimable: false,
        findings: [{ code: "DISCRIMINATION_ACCEPT_REJECTED", message: "an accept was rejected" }],
        attributedCheckIds: { c1: 1 },
      },
    },
    clause: "DISCRIMINATION_ACCEPT_REJECTED",
    repairable: false,
    detail: "an accept was rejected",
  },
  "an unfingerprinted bundle": {
    evidence: { bundles: null },
    clause: "bundle-hashes-missing",
    repairable: false,
  },
  "a blank task-set hash beside both bundle hashes": {
    evidence: {
      bundles: { agentHash: "a".repeat(64), correctnessModelHash: "g".repeat(64), taskSetHash: " " },
    },
    clause: "task-set-hash-missing",
    repairable: false,
  },
  "a repeated case identity": {
    evidence: UNCENSUSED,
    score: [scored("t1"), scored("t1"), scored("t2"), scored("t3", false)],
    clause: "case-identity-duplicate",
    repairable: false,
    detail: "[t1]",
  },
  "a blank case identity": {
    evidence: UNCENSUSED,
    score: [scored("t1"), scored("  "), scored("t3"), scored("t4", false)],
    clause: "case-identity-missing",
    repairable: false,
  },
  "a case list longer than the record's verified count": {
    evidence: UNCENSUSED,
    score: [...GREEN_SCORE, scored("t5", false)],
    clause: "score-denominator-mismatch",
    repairable: false,
    detail: "claimed n=5, but the run records contain 4",
  },
  "an empty denominator, where no check could have fired": {
    evidence: { ...UNCENSUSED, runStatus: terminal(0), truthCheckFiring: firing({ c1: 0 }, { c1: 0 }, 0) },
    score: [],
    clause: "empty-denominator",
    repairable: true,
  },
  "a verifier throw, as a suspect correctness model": {
    evidence: { runStatus: terminal(4, { "verifier-throw": 1 }) },
    clause: "suspect-correctness-model",
    repairable: true,
    detail: "the Correctness Model evaluator threw for 1 case(s)",
  },
  "a mostly-unmeasured battery, with the generic environment remedy": {
    evidence: { runStatus: terminal(2, { solver: 2 }), runtimeIdentities: firstCases(2).runtimeIdentities },
    score: firstCases(2).score,
    clause: "non-result-ratio-excessive",
    repairable: true,
    detail: "2/4 attempted case(s) were non-results (>25%); too many cases could not be measured",
  },
  "a provider-stopped battery, read from its recorded disposition": {
    evidence: {
      runStatus: terminal(1, { provider: 2 }, providerStopped),
      runtimeIdentities: firstCases(1).runtimeIdentities,
    },
    score: firstCases(1).score,
    clause: "non-result-ratio-excessive",
    repairable: true,
    detail: "provider-stopped: 2 of 3 cases were never attempted",
    notDetail: /too many cases could not be measured/,
  },
  "a declared check that fired on no applicable verified case": {
    evidence: { truthCheckFiring: firing({ c1: 0 }, { c1: 4 }) },
    clause: NEVER_FIRED,
    repairable: false,
    detail: "authored check(s) [c1] ran in 0 of 4 verified case(s)",
  },
  "only the check that never fired, beside one that did": {
    evidence: { ...twoAuthoredChecks, truthCheckFiring: firing({ c1: 4, c2: 0 }, { c1: 4, c2: 2 }) },
    clause: NEVER_FIRED,
    repairable: false,
    detail: "[c2] ran in 0 of 4",
  },
  "a check named __proto__ with no own firing key": {
    evidence: {
      ...protoCheck,
      discrimination: { claimable: true, findings: [], attributedCheckIds: protoCounts(1) },
      truthCheckFiring: firing({}, protoCounts(4)),
    },
    score: protoScore,
    clause: NEVER_FIRED,
    repairable: false,
    detail: "[__proto__]",
  },
  "no grounding at all": { evidence: { grounding: null }, clause: "grounding-missing", repairable: false },
  "a grounding that declares no check": {
    evidence: { grounding: { declared: [], execution: NO_EXTERNAL_EXECUTION } },
    clause: "grounding-missing",
    repairable: false,
  },
  "a refuted prediction with no disposition": {
    evidence: { predictions: [{ id: "p1", outcome: "refuted" }] },
    clause: "prediction-record-open",
    repairable: true,
    detail: 'prediction "p1" is refuted',
  },
  "an unexercised prediction closed by a repair, which closes nothing": {
    evidence: { predictions: [{ id: "p1", outcome: "unexercised", disposition: "repair" }] },
    clause: "prediction-record-open",
    repairable: true,
  },
} satisfies Record<string, Refusal>;

describe("a single changed fact refuses with exactly the clause that owns it", () => {
  it.each(Object.entries<Refusal>(REFUSALS))("%s", (_, row) => {
    const result = createClaim(greenEvidence(row.evidence), row.score);
    expect(clauseNames(result)).toEqual([row.clause]);
    const clause = clauseOf(result, row.clause);
    expect(clause?.repairable).toBe(row.repairable);
    if (row.detail !== undefined) expect(clause?.detail).toContain(row.detail);
    if (row.notDetail !== undefined) expect(clause?.detail).not.toMatch(row.notDetail);
  });
});

const CLAIMABLE = {
  "a check that fired once": { evidence: { truthCheckFiring: firing({ c1: 1 }, { c1: 4 }) } },
  "a silent check that applied to no verified case": {
    evidence: { ...twoAuthoredChecks, truthCheckFiring: firing({ c1: 4, c2: 0 }, { c1: 4, c2: 0 }) },
  },
  "scored attempts none of which reached the verifier": {
    evidence: { truthCheckFiring: firing({ c1: 0 }, { c1: 0 }, 0) },
  },
  "an external check the authored firing record does not carry": {
    evidence: {
      grounding: {
        declared: [AUTHORED_C1, RESONANCE],
        execution: qiskitExecution(["t1", "t2", "t3", "t4"]),
      },
      discrimination: discriminatedChecks("resonance"),
    },
    score: GREEN_SCORE.map((row) => ({ ...row, checkIds: ["c1", "resonance"] })),
  },
  "a check named __proto__ with its own recorded keys": {
    evidence: {
      ...protoCheck,
      discrimination: { claimable: true, findings: [], attributedCheckIds: protoCounts(2) },
      truthCheckFiring: firing(protoCounts(4), protoCounts(4)),
    },
    score: protoScore,
  },
  "a single flake in a small battery, since the ratio needs two non-results": {
    evidence: { runStatus: terminal(2, { solver: 1 }), runtimeIdentities: firstCases(2).runtimeIdentities },
    score: firstCases(2).score,
  },
  "a refuted prediction closed by a repair": {
    evidence: { predictions: [{ id: "p1", outcome: "refuted", disposition: "repair" }] },
  },
  "an absent prediction sidecar, which is no record rather than an open one": {
    evidence: { predictions: null },
  },
} satisfies Record<string, Claimable>;

describe("the nearest shapes each clause must not refuse", () => {
  it.each(Object.entries<Claimable>(CLAIMABLE))("%s", (_, row) => {
    expect(clauseNames(createClaim(greenEvidence(row.evidence), row.score))).toEqual([]);
  });
});

describe("the whole refusal, not one clause at a time", () => {
  it("reports every clause in one result, and is repairable only when each clause is", () => {
    const interrupted = { state: "interrupted" as const, reason: "signal", verified: 4, nonResults: {} };
    const resumable = createClaim(greenEvidence({ runStatus: interrupted }));
    expect(resumable.ok === false && resumable.repairable).toBe(true);
    const hard = createClaim(
      greenEvidence({
        runStatus: interrupted,
        bundles: null,
        staleness: { stale: true, hashes: ["h1", "h2"] },
      }),
    );
    expect(clauseNames(hard)).toEqual(["run-interrupted", "evidence-stale", "bundle-hashes-missing"]);
    expect(hard.ok === false && hard.repairable).toBe(false);
  });
});

describe("the write path is the only way to a claim", () => {
  it("refuses the private constructor, and the alias that reaches it", () => {
    // @ts-expect-error — private constructor; if this directive goes unused, the write leaked
    expect(() => new Claim(Symbol("invalid"), {})).toThrow(/Create claims only/);
    // @ts-expect-error — an unused directive here means the class became publicly constructible
    const ConstructorAlias: new (token: symbol, statement: Record<string, never>) => Claim = Claim;
    // Guessing the token's description does not reproduce the module-private symbol.
    expect(() => new ConstructorAlias(Symbol("ana-claim-write"), {})).toThrow(/Create claims only/);
  });

  it("does not accept a receiptless object literal as a Claim", () => {
    // @ts-expect-error — a receiptless literal must not typecheck as Claim
    const fake: Claim = { ok: true as const, statement: double({}) };
    expect(fake.ok).toBe(true);
  });

  it("states the run, the condition and the three bundle hashes, frozen and counted from the case list", () => {
    const evidence = greenEvidence();
    const statement = statementOf(createClaim(evidence));
    expect(statement).toMatchObject({
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
    expect(Object.isFrozen(statement)).toBe(true);
    // A retained array would let the caller edit a written claim's stated condition afterwards.
    evidence.capabilities.push("web-search:on");
    expect(statement.capabilities).toEqual(["web-search:off"]);
  });
});

describe("review evidence the claim carries but never obeys", () => {
  it("discloses a review that disputed half its verified cases and spends no clause on it", () => {
    expect(statementOf(createClaim(greenEvidence({ judge: judgeWithDisagreements() })))).toMatchObject({
      judge: "unvalidated",
      judgeDecision: "advisory-comparison",
    });
  });

  // A producer that recorded an impossible review is a defect in the producer, so the write throws
  // rather than returning a clause a repair loop could route around.
  const green = judgeWithDisagreements();
  it.each<[string, JudgeEvidence, RegExp]>([
    ["more verdicts than offered", { ...green, verdicts: 5 }, /verdicts exceeds offered/],
    [
      "abstentions beyond the unanswered census",
      { ...green, abstentions: 1 },
      /abstention is a designed null/,
    ],
    [
      "more verifier-pass fails than disagreements",
      { ...green, verifierPassJudgeFail: 3 },
      /within disagreements/,
    ],
    [
      "a review of another pin",
      { ...green, evaluatedPin: "claude/claude-opus-5" },
      /does not match battery backendPin/,
    ],
    [
      "a review of another correctness model",
      { ...green, correctnessModelId: "correctness-model@stale" },
      /does not match claim Correctness Model identity/,
    ],
  ])("throws on %s", (_, judge, message) => {
    expect(() => createClaim(greenEvidence({ judge }))).toThrow(message);
  });
});
