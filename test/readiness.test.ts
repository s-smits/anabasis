import { describe, expect, it } from "bun:test";
import type { ClaimStatement } from "../src/claim/claim-evidence.ts";
import { CONFORMANCE_PROBE_POLICY, type ConformanceEvidence } from "../src/claim/conformance-evidence.ts";
import { type ReadinessInput, type SolvabilityEvidence, assessReadiness } from "../src/claim/readiness.ts";

function statement(overrides: Partial<ClaimStatement> = {}): ClaimStatement {
  return {
    slug: "s1",
    runId: "r1",
    externalCheckCoverage: [],
    n: 4,
    passed: 3,
    passRate: 0.75,
    vetoed: 0,
    backendPin: "codex/gpt-5.5",
    thresholdManifestDigest: "f".repeat(64),
    judge: "off",
    judgeDecision: null,
    modelIdentity: "unverified",
    capabilities: ["web-search:off"],
    buildInputsHash: "h1",
    agentHash: "a".repeat(64),
    correctnessModelHash: "g".repeat(64),
    taskSetHash: "t".repeat(64),
    correctnessModelId: `correctness-model@${"g".repeat(64)}`,
    groundings: [{ checkId: "c1", kind: "authored", adapterId: null }],
    verifierTools: [],
    verifierEnvironmentHash: null,
    ...overrides,
  };
}

/** A conformance record fixture with the specification, task set and worker identities. */
const CONFORMANCE: ConformanceEvidence = {
  schema: "tool-conformance/v4",
  toolsSpecHash: "t".repeat(64),
  taskSetHash: "t".repeat(64),
  probePolicy: CONFORMANCE_PROBE_POLICY,
  publicArtifactSchemaHash: "s".repeat(64),
  verifierEnvironmentHash: null,
  worker: {
    schema: "generated-tool-worker/v3",
    generatedSourceDigest: "g".repeat(64),
    workerPolicyIdentity: "worker/v2",
    registrationDigest: "r".repeat(64),
    toolSchemaDigest: "u".repeat(64),
    artifactWriterNames: ["finish"],
  },
};

const SOLVABILITY: SolvabilityEvidence = {
  schema: "solvability/v10",
  policy: "probe/v1",
  correctnessModelHash: "g".repeat(64),
  taskSetHash: "t".repeat(64),
  bundleSnapshotId: "bundleSnapshot-1",
  verifierEnvironmentHash: null,
  operandCommitmentKeyId: "readiness-test-key",
  toolRuns: 0,
  cases: ["task-1", "task-2"].map((taskId) => ({
    taskId,
    fullTaskDigest: `${taskId}-full`,
    publicTaskDigest: `${taskId}-public`,
    artifactDigest: `${taskId}-artifact`,
    artifact: { taskId },
    status: "passed" as const,
    failedCheckIds: [],
    predicateFailures: [],
    referenceSolve: null,
    submissionPath: {
      schema: "solvability-submission-path/v1",
      stages: ["writer-tool-schema", "draft-store", "materialise", "submit", "accept"],
      writerCalls: [{ name: "finish", callId: "f2-writer-1" }],
      draftSeq: 1,
      materialization: {
        writerName: "finish",
        callId: "f2-writer-1",
        sourceSeq: 1,
        artifactDigest: `${taskId}-artifact`,
      },
      submission: {
        attempts: 1,
        publicArtifactSchemaHash: "s".repeat(64),
        artifactDigest: `${taskId}-artifact`,
      },
    },
    error: null,
  })),
};

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    statement: statement(),
    conformance: CONFORMANCE,
    isolation: "contractual",
    solvability: SOLVABILITY,
    taskSetHash: "t".repeat(64),
    evidenceStage: [],
    ...overrides,
  };
}

describe("assessReadiness — readiness assessed separately from the score claim", () => {
  it("matching solvability and conformance records establish readiness and disclose isolation strength", () => {
    const verdict = assessReadiness(input());
    expect(verdict).toEqual({ ready: true, isolation: "contractual", clauses: [] });
    expect(assessReadiness(input({ isolation: "physical" })).isolation).toBe("physical");
  });

  it("a paid battery with zero passes stays unready even with passing reference solves", () => {
    const verdict = assessReadiness(input({ statement: statement({ passed: 0, passRate: 0, n: 6 }) }));
    expect(verdict.ready).toBe(false);
    expect(verdict.clauses.map((clause) => clause.clause)).toContain("paid-agent-zero-pass");
  });

  it("solvability evidence for another task set blocks readiness", () => {
    const mismatch = assessReadiness(input({ solvability: { ...SOLVABILITY, taskSetHash: "x".repeat(64) } }));
    expect(mismatch.clauses.map((c) => c.clause)).toContain("solvability-evidence-mismatch");
  });

  it("solvability evidence must match the measured verifier environment", () => {
    const hash = "e".repeat(64);
    const mismatch = assessReadiness(
      input({
        statement: statement({ verifierEnvironmentHash: hash }),
        solvability: { ...SOLVABILITY, verifierEnvironmentHash: "f".repeat(64) },
      }),
    );
    expect(mismatch.clauses.map((c) => c.clause)).toContain("solvability-verifier-environment-mismatch");
    const agreed = assessReadiness(
      input({
        statement: statement({ verifierEnvironmentHash: hash }),
        solvability: { ...SOLVABILITY, verifierEnvironmentHash: hash },
      }),
    );
    expect(agreed.ready).toBe(true);
  });

  it("a reference solve the host stopped is a non-result, not a failed witness", () => {
    const verdict = assessReadiness(
      input({
        solvability: {
          ...SOLVABILITY,
          cases: SOLVABILITY.cases.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  status: "non-result" as const,
                  nonResultKind: "sandbox" as const,
                  submissionPath: null,
                  error: "stopped",
                }
              : row,
          ),
        },
      }),
    );
    expect(verdict.ready).toBe(false);
    expect(verdict.clauses.map((c) => c.clause)).toEqual(["solvability-non-result"]);
    expect(verdict.clauses[0]?.detail).toContain("1/2 constructive witness case(s) earned no verdict");
    expect(verdict.clauses[0]?.detail).toContain("(sandbox)");
  });

  it.each<[string, Partial<ReadinessInput>, string[]]>([
    ["solvability", { solvability: null }, ["no-solvability-witness"]],
    ["conformance", { conformance: null }, ["conformance-unprobed"]],
    [
      "solvability and conformance",
      { solvability: null, conformance: null },
      ["no-solvability-witness", "conformance-unprobed"],
    ],
  ])("missing %s evidence blocks readiness with one finding each", (_label, overrides, clauses) => {
    const verdict = assessReadiness(input(overrides));
    expect(verdict.ready).toBe(false);
    expect(verdict.clauses.map((c) => c.clause).sort()).toEqual([...clauses].sort());
  });

  it("changed evidence bytes block readiness and identify the affected file", () => {
    const verdict = assessReadiness(
      input({
        evidenceStage: [
          {
            code: "evidence-tampered",
            path: "cases/t1/case-result.json",
            detail: "bytes differ from what the owner wrote",
          },
        ],
      }),
    );
    expect(verdict.ready).toBe(false);
    expect(verdict.clauses.map((c) => c.clause)).toContain("evidence-stage-violated");
    expect(verdict.clauses[0]?.detail).toContain("cases/t1/case-result.json");
    // An executed verification with no findings satisfies this check.
    expect(assessReadiness(input({ evidenceStage: [] })).ready).toBe(true);
  });

  it("run records that have not been checked block readiness", () => {
    const verdict = assessReadiness(input({ evidenceStage: null }));
    expect(verdict.ready).toBe(false);
    expect(verdict.clauses.map((c) => c.clause)).toEqual(["evidence-stage-unverified"]);
  });
});

// Coverage follows executed tools: a declared external check whose tool ran on no verified case of
// the battery is named by readiness through the same grounding-coverage finding used by admission.
describe("declared-but-unlaunched external checks", () => {
  const launched = {
    checkId: "firmware-builds",
    toolId: "avr-gcc",
    attestedLaunches: 3,
    cellProgramLaunches: 0,
    rejects: 1,
    kind: "external" as const,
  };
  const unlaunched = {
    checkId: "control-behaviour",
    toolId: "cc",
    attestedLaunches: 0,
    cellProgramLaunches: 0,
    rejects: 1,
    kind: "external" as const,
  };

  it("a check with zero launches on verified cases is a readiness clause naming the check and tool", () => {
    const verdict = assessReadiness(
      input({ statement: statement({ externalCheckCoverage: [launched, unlaunched] }) }),
    );
    expect(verdict.ready).toBe(false);
    const clause = verdict.clauses.find((c) => c.clause === "external-check-tool-unlaunched");
    expect(clause?.detail).toContain('"control-behaviour"');
    expect(clause?.detail).toContain('"cc"');
    expect(clause?.detail).toContain("verified cases of this battery");
  });

  it("every declared check launched on a verified case adds no clause", () => {
    const verdict = assessReadiness(input({ statement: statement({ externalCheckCoverage: [launched] }) }));
    expect(verdict.clauses.map((c) => c.clause)).not.toContain("external-check-tool-unlaunched");
    expect(verdict.ready).toBe(true);
  });
});
