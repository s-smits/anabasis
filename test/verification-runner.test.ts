/**
 * What `makeVerify` refuses before it spends a solve.
 *
 * Every case here is a pre-solve gate: an invalid brief, an unclaimable control census, a bundle
 * whose bytes moved after the fingerprint, and a generated worker that no longer matches the
 * conformance receipt the build recorded. Each asserts that the solver was never invoked, because
 * the cost of the refusal arriving late is a paid battery — run w16 paid 50 solves before the
 * worker-binding check moved ahead of the solve loop.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { createBundleSnapshot } from "../src/claim/bundle-snapshot.ts";
import { CONFORMANCE_PROBE_POLICY, type ConformanceEvidence } from "../src/claim/conformance-evidence.ts";
import type { BackendStartupEvidence } from "../src/run/model-preflight.ts";
import { createGeneratedToolStarter } from "../src/solve/generated-tool-worker.ts";
import { validateBrief } from "../src/truth/brief-validator.ts";
import { loadBuiltControllerInterface } from "../src/truth/contracts.ts";
import { makeVerify } from "../src/truth/verification-runner.ts";
import { type Solver, withSolverBuiltStarterFactory } from "../src/truth/solve.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  ACCEPTS,
  BRIEF,
  EVALUATOR_SOURCE,
  PUBLIC_SCHEMA,
  REJECTS,
  TASKS,
  TOOLS_SOURCE,
  fingerprintOf,
  laxVerifierSlug,
  removeScratchRoot,
  scratch,
  scriptedSolver,
  SCRIPTED_CONDITION,
  SCRIPTED_THRESHOLD_DIGEST,
} from "./helpers/verification-runner-fixtures.ts";

afterAll(removeScratchRoot);

/** The fixture bundle, written to a fresh scratch slug: evaluator, generated tools and controls. */
function bundleSlug(): string {
  const slugDir = scratch();
  mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
  mkdirSync(join(slugDir, "agent"), { recursive: true });
  writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), EVALUATOR_SOURCE);
  writeFileSync(join(slugDir, "agent/tools.ts"), TOOLS_SOURCE);
  writeFileSync(
    join(slugDir, "correctness-model/controls.json"),
    JSON.stringify({ accept: ACCEPTS, reject: REJECTS }),
  );
  return slugDir;
}

describe("a bundle that cannot be executed never reaches the solver", () => {
  it.concurrent("refuses a brief whose check path is invalid, before projection or any solve", async () => {
    const slugDir = laxVerifierSlug();
    const brief = structuredClone(BRIEF);
    brief.truthChecks[0]!.execution.artifactPaths = ["$.assignments[01]"];
    writeFileSync(join(slugDir, "correctness-model/brief.json"), JSON.stringify(brief));
    const validation = validateBrief(brief);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.findings.map((finding) => finding.code)).toContain("brief-check-path-invalid");
    }

    let solves = 0;
    const evaluate = makeVerify({
      solver: async () => {
        solves++;
        throw new Error("invalid brief reached solver");
      },
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: [],
      runId: "legacy-invalid-path",
    });
    await expect(
      evaluate({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks: TASKS.tasks }),
    ).rejects.toThrow("bundle snapshot brief failed validation:");
    expect(solves).toBe(0);
    expect(existsSync(join(slugDir, "runs/legacy-invalid-path/battery.json"))).toBe(false);
  });

  it.concurrent("refuses a fingerprint matching neither the snapshot nor the tree before the bundle loads", async () => {
    const slugDir = bundleSlug();
    const fingerprint = fingerprintOf(slugDir);
    // Changed after fingerprinting with no snapshot created: execution must refuse rather than
    // grade bytes nobody admitted.
    writeFileSync(join(slugDir, "agent/tools.ts"), `${TOOLS_SOURCE}\n// drifted`);
    await expect(
      makeVerify({
        solver: scriptedSolver(),
        backendPin: "scripted/none",
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: ["web-search:off"],
        runId: "run-bundleSnapshot-drift",
      })({ slug: "matching", slugDir, fingerprint, tasks: TASKS.tasks }),
    ).rejects.toThrow(/EXECUTED_BUNDLE_DRIFT/);
  }, 60_000);

  it.concurrent("grades the snapshot's agent bytes after the workspace writer changed underneath it", async () => {
    const slugDir = bundleSlug();
    const fingerprint = fingerprintOf(slugDir);
    // Snapshot first, as submit does.
    /* SAFETY: fingerprintOf returns the same evidence the production caller passes here; the
       parameter type is stated structurally rather than by name. */
    createBundleSnapshot(slugDir, fingerprint);
    // Now change the generated writer. The callback is controller-replaced, so passing cases alone
    // would not distinguish the two source versions: the recorded hash is the only witness.
    writeFileSync(
      join(slugDir, "agent/tools.ts"),
      TOOLS_SOURCE.replace(
        "draft.setArtifact({ assignments: assignments(draft) });",
        "draft.setArtifact({ assignments: [] });",
      ),
    );
    const report = await makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-bundleSnapshot-witness",
    })({ slug: "matching", slugDir, fingerprint, tasks: TASKS.tasks });

    expect(report.score.map((row) => row.passed)).toEqual([true, true, true]);
    const battery = JSON.parse(
      readFileSync(join(slugDir, "runs/run-bundleSnapshot-witness/battery.json"), "utf8"),
    );
    expect(battery.bundleSnapshot.agentHash).toBe(fingerprint.agentHash);
  }, 60_000);
});

describe("an unclaimable control census ends the run before the paid loop", () => {
  const backendStartup: BackendStartupEvidence = {
    slug: "matching",
    builder: { kind: "claude", model: "builder-model", reasoningEffort: "medium", source: "default" },
    built: { kind: "claude", model: "built-model", reasoningEffort: "high", source: "default" },
    review: {
      enabled: true,
      kind: "claude",
      model: "judge-model",
      reasoningEffort: "high",
      source: "operator",
    },
    operatorConfig: ".harness/backends/default.json",
    source: null,
    hostRuntime: {
      schema: "host-runtime-identity/v1",
      name: "bun",
      version: Bun.version,
      platform: runtimeProcess.platform,
      arch: runtimeProcess.arch,
      executableSha256: "a".repeat(64),
    },
    modelSelections: {
      builder: { resolvedModel: "builder-model", effort: "medium", source: "pi-provider-catalogue" },
      built: { resolvedModel: "built-model", effort: "high", source: "pi-provider-catalogue" },
      review: { resolvedModel: "judge-model", effort: "high", source: "pi-provider-catalogue" },
    },
  };

  it.concurrent("writes the skip as readable evidence, spends no solve and no judge turn", async () => {
    // The slug is assembled directly: the build loop's control probe would normally block a lax
    // verifier before evaluation, and drift between probe time and evaluation time is the case
    // this guards.
    const slugDir = laxVerifierSlug();
    let judgeInvocations = 0;
    const report = await makeVerify({
      solver: async () => {
        throw new Error("the paid solver loop must not run under unclaimable discrimination evidence");
      },
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      backendStartup,
      capabilities: ["web-search:off"],
      runId: "run-early-exit",
      judge: {
        pin: "scripted/judge-v1",
        invoke: async () => {
          judgeInvocations += 1;
          return {
            verdict: true,
            abstained: false,
            rationale: "census verdict",
            rules: [],
            error: null,
            errorKind: null,
            turns: 1,
          };
        },
      },
    })({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks: TASKS.tasks });

    expect(report.score).toEqual([]);
    expect(report.evidence.runStatus).toMatchObject({ state: "terminal", verified: 0 });
    expect(report.evidence.runStatus.reason).toContain("skipped");
    expect(report.evidence.discrimination.claimable).toBe(false);

    // The battery evidence still lands: the skip is a readable fact, not a missing file. The
    // startup identities are recorded beside it, so a reader knows which condition was skipped.
    const runDir = join(slugDir, "runs/run-early-exit");
    const battery = JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8"));
    expect(battery.cases).toEqual([]);
    expect(battery.discrimination.claimable).toBe(false);
    expect(JSON.parse(readFileSync(join(runDir, "backends.json"), "utf8"))).toEqual(backendStartup);

    // The judge phase is conditional on eligible battery subjects. The early exit produced none,
    // so no paid review turn happened and no synthetic driver call was written.
    expect(judgeInvocations).toBe(0);
    expect(existsSync(join(runDir, "judge-driver-conformance.json"))).toBe(false);
    expect(battery.judge).toMatchObject({
      judge: "unvalidated",
      censusSize: { controls: 0, battery: 0, total: 0 },
      disagreementRate: null,
      decision: "non-result",
    });
  }, 30_000);
});

describe("the generated worker the battery runs is the one the build recorded", () => {
  it.concurrent("refuses a stale receipt with zero solves, then evaluates once the receipt matches", async () => {
    const slugDir = bundleSlug();
    let solverCalls = 0;
    const base = scriptedSolver();
    const solver: Solver = async (task, toolset, submitted) => {
      solverCalls += 1;
      if (toolset.preparationNonResult) throw new Error(`PREP: ${toolset.preparationNonResult.message}`);
      const outcome = await base(task, toolset, submitted);
      await toolset.close?.();
      return outcome;
    };
    // The binding's subject is the real confined worker, so the starter must be the production
    // generated-tool starter rather than the in-process draft fallback.
    withSolverBuiltStarterFactory(solver, async (bundleSnapshotDir, task, submission, publicArtifactSchema) =>
      createGeneratedToolStarter({
        slugDir: bundleSnapshotDir,
        task,
        submission,
        contract: await loadBuiltControllerInterface(bundleSnapshotDir),
        publicArtifactSchema,
      }),
    );

    const stale = {
      schema: "tool-conformance/v4",
      toolsSpecHash: "tools-spec",
      taskSetHash: "tasks",
      probePolicy: CONFORMANCE_PROBE_POLICY,
      publicArtifactSchemaHash: PUBLIC_SCHEMA.sha256,
      verifierEnvironmentHash: null,
      worker: {
        schema: "generated-tool-worker/v3",
        generatedSourceDigest: "stale-source",
        workerPolicyIdentity: "stale-policy",
        registrationDigest: "stale-registration",
        toolSchemaDigest: "stale-tool-schema",
        artifactWriterNames: [],
      },
    } satisfies ConformanceEvidence;
    const evalWith = (runId: string, conformance: ConformanceEvidence) =>
      makeVerify({
        solver,
        backendPin: "scripted/none",
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: ["web-search:off"],
        runId,
        conformance,
      })({
        slug: "matching",
        slugDir,
        fingerprint: fingerprintOf(slugDir),
        tasks: TASKS.tasks,
      });

    const refusedReport = await evalWith("run-worker-binding-mismatch", stale);
    expect(solverCalls).toBe(0);
    expect(refusedReport.score).toEqual([]);
    expect(refusedReport.evidence.runStatus).toMatchObject({ verified: 0, nonResults: { protocol: 3 } });

    const caseDir = join(slugDir, "runs/run-worker-binding-mismatch/cases/t1");
    expect(JSON.parse(readFileSync(join(caseDir, "case-result.json"), "utf8"))).toMatchObject({
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "protocol",
      runtimeNonResult: "production generated-tool worker differs from the build-time conformance binding",
    });
    expect(existsSync(join(caseDir, "artifact.json"))).toBe(false);
    expect(existsSync(join(caseDir, "verifier.json"))).toBe(false);

    // The refusal's observed side is exactly what a refreshed receipt needs.
    const binding = JSON.parse(readFileSync(join(caseDir, "worker-binding.json"), "utf8"));
    expect(binding.expected.worker.toolSchemaDigest).toBe("stale-tool-schema");
    expect(binding.observed.publicArtifactSchemaHash).toBe(PUBLIC_SCHEMA.sha256);
    expect(binding.observed.worker).not.toBeNull();
    const matching = {
      ...stale,
      /* SAFETY: `binding.observed.worker` was asserted non-null above and is written by
         generatedToolWorkerBinding, the same producer conformance receipts record. */
      worker: binding.observed.worker as ConformanceEvidence["worker"],
    } satisfies ConformanceEvidence;
    const verified = await evalWith("run-worker-binding-match", matching);
    expect(solverCalls).toBe(TASKS.tasks.length);
    expect(verified.score.map((row) => row.caseId).sort()).toEqual(["t1", "t2", "t3"]);

    // A stale probe policy alone refuses, even with a matching worker binding.
    const stalePolicy = await evalWith("run-worker-stale-conformance-policy", {
      ...matching,
      /* SAFETY: deliberately the WRONG policy id. The type admits only the current constant,
         which is exactly what this test needs to violate to prove staleness is detected. */
      probePolicy: "falsifier-conformance/v13" as typeof CONFORMANCE_PROBE_POLICY,
    });
    expect(solverCalls).toBe(TASKS.tasks.length);
    expect(stalePolicy.evidence.runStatus).toMatchObject({ verified: 0, nonResults: { protocol: 3 } });
  }, 60_000);
});
