/**
 * The recorded evidence a claim is written from.
 *
 * Every claim test starts from one battery that should be claimable — four scored cases, three
 * passing, one declared authored check that fired on all four — and changes exactly one fact.
 * That is the shape of the assertions: a clause fires because of the changed fact and nothing
 * else, so the fixture has to be green for a reason each test can name.
 *
 * The identity census carries an agent runtime's session beside the provider's served model and
 * result, which is how a Pi route attests a model it did not serve itself.
 */
import type { Claim, NonClaimable } from "../../src/claim/claim.ts";
import { Claim as ClaimClass } from "../../src/claim/claim.ts";
import type { ClaimCreationInput, ClaimEvidence, ScoredCase } from "../../src/claim/claim-evidence.ts";
import type {
  RuntimeIdentityCaseEvidence,
  RuntimeModelIdentity,
} from "../../src/claim/runtime-model-identity.ts";
import type { JudgeEvidence } from "../../src/claim/judge.ts";
import { NO_EXTERNAL_EXECUTION, type VerifierExecutionEvidence } from "../../src/truth/grounding.ts";

/** Four verified case identities, three passing — matching `greenEvidence()`'s `verified: 4`. Every
 *  case exercises the declared authored check c1; per-case tool coverage applies only to required
 *  tools, so these stay green with no execution evidence. */
export const GREEN_SCORE: ScoredCase[] = [
  { caseId: "t1", passed: true, truthVerified: true, checkIds: ["c1"] },
  { caseId: "t2", passed: true, truthVerified: true, checkIds: ["c1"] },
  { caseId: "t3", passed: true, truthVerified: true, checkIds: ["c1"] },
  { caseId: "t4", passed: false, truthVerified: true, checkIds: ["c1"] },
];

/** The declared check `greenEvidence()` grounds, as the claim writer records a brief's authored check. */
export const AUTHORED_C1 = {
  checkId: "c1",
  grounding: { kind: "authored", assertion: "assignments obey the public slot rules" },
} as const;

/** A second authored check, so a test can separate one declared check's reading from another's. */
export const AUTHORED_C2 = {
  checkId: "c2",
  grounding: { kind: "authored", assertion: "every keyed row matches the expected collection" },
} as const;

/** An externally grounded check: its verdict comes from an installed tool, not from authored code. */
export const RESONANCE = {
  checkId: "resonance",
  grounding: {
    kind: "external-verifier",
    adapterId: "qiskit-adapter",
    assertion: "statevector fidelity within declared tolerance",
  },
} as const;

/** What the host hashed immediately before spawning, and where the executable resolved. A claim
 *  reader sees here whether the tool that judged the artifact was one the Builder installed. */
export const QISKIT_TOOLS: VerifierExecutionEvidence["tools"] = {
  "qiskit-adapter": {
    digest: "d".repeat(64),
    source: "workspace-toolchain",
    kind: "script",
    interpreter: "python3",
  },
};

/** Completed runs of the declared (check, adapter) pair over the named subjects. */
export function qiskitExecution(subjectIds: readonly string[]): VerifierExecutionEvidence {
  return {
    executed: subjectIds.map((subjectId) => ({
      phase: "battery" as const,
      subjectId,
      attempt: 1,
      checkId: "resonance",
      adapterId: "qiskit-adapter",
    })),
    verifierEnvironmentHash: "e".repeat(64),
    tools: QISKIT_TOOLS,
  };
}

/** The behavioural half of grounding: the named checks each attributed a reject control that
 *  failed on exactly them. c1 keeps its own attribution so the default check stays covered. */
export function discriminatedChecks(...checkIds: string[]): ClaimEvidence["discrimination"] {
  const attributed = new Map(checkIds.map((checkId) => [checkId, 2]));
  attributed.set("c1", 1);
  return { claimable: true, findings: [], attributedCheckIds: Object.fromEntries(attributed) };
}

export function greenEvidence(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return {
    runStatus: { state: "terminal", reason: "complete", verified: 4, nonResults: {} },
    staleness: { stale: false, hashes: ["h1"] },
    discrimination: { claimable: true, findings: [], attributedCheckIds: { c1: 1 } },
    backendPin: "codex/gpt-5.5",
    runtimeIdentities: codexIdentities(),
    thresholdManifestDigest: "f".repeat(64),
    capabilities: ["web-search:off"],
    predictions: [{ id: "p1", outcome: "held" }],
    bundles: {
      agentHash: "a".repeat(64),
      correctnessModelHash: "g".repeat(64),
      taskSetHash: "t".repeat(64),
    },
    grounding: { declared: [AUTHORED_C1], execution: NO_EXTERNAL_EXECUTION },
    // c1 fired on all four verified cases, which keeps the never-fired clause inert on the green path.
    truthCheckFiring: {
      firedByCheck: { c1: 4 },
      executedByCheck: {},
      blockingByCheck: {},
      applicableByCheck: { c1: 4 },
      verifierVerifiedCount: 4,
    },
    judge: { judge: "off" },
    ...overrides,
  };
}

export function createClaim(
  evidence: ClaimEvidence,
  score: ScoredCase[] = GREEN_SCORE,
): Claim | NonClaimable {
  const input: ClaimCreationInput = { slug: "s1", runId: "r1", evidence, score };
  return ClaimClass.create(input);
}

/** The clause names a refusal carries, and `[]` for a written claim — what most assertions read. */
export function clauseNames(result: Claim | NonClaimable): string[] {
  return result.ok ? [] : result.clauses.map((c) => c.clause);
}

/** One clause's recorded detail, or "" when the result carries no such clause. */
export function clauseDetail(result: Claim | NonClaimable, name: string): string {
  return result.ok ? "" : (result.clauses.find((c) => c.clause === name)?.detail ?? "");
}

/** A complete census for GREEN_SCORE under a Claude pin: one completed turn per case, a distinct
 *  runtime session and result id per case, the served model reported, and the native session
 *  explicitly absent rather than missing. */
export function claudeIdentities(): RuntimeIdentityCaseEvidence[] {
  return GREEN_SCORE.map((row, index) => ({
    caseId: row.caseId,
    turns: 1,
    completedTurns: 1,
    identities: [
      {
        schema: "runtime-model-identity/v2",
        agentRuntime: { id: "pi-agent-core", version: "0.82.1", sessionId: `pi-session-${index + 1}` },
        provider: {
          id: "anthropic",
          model: "claude-opus-4-8",
          resultId: `pi-result-${index + 1}`,
          nativeSessionId: null,
        },
      },
    ],
  }));
}

/** The same census attested by the codex provider, matching `greenEvidence()`'s pin. */
export function codexIdentities(): RuntimeIdentityCaseEvidence[] {
  return claudeIdentities().map((row) => ({
    ...row,
    identities: row.identities.map((identity) => ({
      ...identity,
      provider: { ...identity.provider, id: "openai-codex", model: "gpt-5.5" },
    })),
  }));
}

export function identityAt(
  rows: RuntimeIdentityCaseEvidence[],
  caseIndex: number,
  turnIndex = 0,
): RuntimeModelIdentity {
  const identity = rows[caseIndex]?.identities[turnIndex];
  if (identity === undefined) throw new Error("test fixture identity is missing");
  return identity;
}

export function identityRowAt(
  rows: RuntimeIdentityCaseEvidence[],
  caseIndex: number,
): RuntimeIdentityCaseEvidence {
  const row = rows[caseIndex];
  if (row === undefined) throw new Error("test fixture identity row is missing");
  return row;
}

/** A battery review with two disagreements in four, in the shape the current producer records. */
export function judgeWithDisagreements(): Exclude<JudgeEvidence, { judge: "off" }> {
  return {
    judge: "unvalidated",
    judgePin: "scripted/judge",
    evaluatedPin: "codex/gpt-5.5",
    correctnessModelId: `correctness-model@${"g".repeat(64)}`,
    offered: 4,
    verdicts: 4,
    abstentions: 0,
    disagreements: 2,
    disagreementDenominator: 4,
    verifierPassJudgeFail: 1,
    vetoed: 0,
  };
}
