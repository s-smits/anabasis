import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { sha256 } from "../src/meta/digest.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { RUN_MANIFEST_NAME } from "../src/claim/evidence-log.ts";
import { loadRecordedTasks, driveBattery } from "../src/run/run-driver.ts";
import { writeRunClaim } from "../src/run/claim-write.ts";
import { SOLVABILITY_READINESS_POLICY } from "../src/truth/solvability.ts";
import { VerifierExecutionNonResult } from "../src/truth/verifier-nonresult.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { MATCHING_BRIEF, MATCHING_TASKS, scriptedMatchingSolver } from "./helpers/matching-fixture.ts";
import { fullFakeHost, probeEvidence } from "./helpers/measure-doubles.ts";
import { DRIVER_ID, measure, measureScratch, scaffoldRepo } from "./helpers/measure-repo.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import { SCRIPTED_CONDITION, SCRIPTED_THRESHOLD_DIGEST } from "./helpers/verification-runner-fixtures.ts";

/**
 * What a measured round is allowed to write down. A run id is admitted once and never reused
 * across products; execution binds to the task set that was recorded, not to the one in process
 * memory; and the claim is reconstructed from the battery's own rows so a crashed or resumed
 * round states the same score as an uninterrupted one.
 */

afterAll(cleanupScratch);

const SCRATCH_ROOT = measureScratch();

describe("run identity admission", () => {
  it.concurrent("refuses a runId containing path traversal before measurement begins", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "hostile-runid"), { toolsSpec: true });
    for (const hostile of ["../escape", "a/b", String.raw`a\b`, "..", ".hidden", ""]) {
      await expect(measure({ runId: hostile, repoRoot: repo, processEnv: {} })).rejects.toThrow(
        /not a safe single path segment/,
      );
    }
  });

  it.concurrent("holds in shared driveBattery too — the one owner of run identity", async () => {
    await expect(
      driveBattery({
        slug: "matching",
        slugDir: join(SCRATCH_ROOT, "never-created"),
        runId: "../../etc",
        builderId: "hostile",
        recordPath: join(SCRATCH_ROOT, "never.jsonl"),
        verification: {
          solver: scriptedMatchingSolver(),
          backendPin: "scripted/none",
          condition: SCRIPTED_CONDITION,
          thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
          capabilities: [],
        },
        isolation: null,
        tasks: MATCHING_TASKS,
      }),
    ).rejects.toThrow(/not a safe single path segment/);
  });
});

describe("execution binds to the recorded task set", () => {
  it.concurrent("refuses a substituted task array when correctness-model/tasks.json is recorded", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "task-subst"), { toolsSpec: true });
    const easier = MATCHING_TASKS.slice(0, 1);
    await expect(
      measure({
        runId: "subst",
        repoRoot: repo,
        processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
        tasks: easier,
        solver: scriptedMatchingSolver(),
        createVerifier: () => fullFakeHost(),
        isolationProbe: () => probeEvidence(false),
      }),
    ).rejects.toThrow(/differ from correctness-model\/tasks\.json/);
  });
});

describe("the claim write binds to the executed bundleSnapshot", () => {
  // Keep this complete battery and claim replay outside the other in-file batteries' concurrency.
  it("reconstructs score and evidence from the recorded battery instead of process memory", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "recorded-claim-input"), { toolsSpec: true });
    const slugDir = join(repo, "domains", "bridge-truss");
    const brief = structuredClone(MATCHING_BRIEF);
    const check = brief.truthChecks[0];
    if (check === undefined) throw new Error("fixture needs a deciding check");
    check.execution.requiredToolIds = ["cat"];
    writeFileSync(join(slugDir, "correctness-model/brief.json"), JSON.stringify(brief));
    const evaluator = join(slugDir, "correctness-model/evaluator.ts");
    writeFileSync(
      evaluator,
      readFileSync(evaluator, "utf8")
        .replace("import type { EvaluationRequest }", "import type { EvaluationRequest, CheckRuntime }")
        .replace(
          '"parts-assigned": ({artifact, hidden}: Request): boolean => {',
          '"parts-assigned": async ({artifact, hidden}: Request, runtime?: CheckRuntime): Promise<boolean> => {\n    if (!runtime) throw new Error("tool runtime missing");\n    const echoed = await runtime.tools.run({ toolId: "cat", stdin: JSON.stringify(artifact) });\n    if (echoed.exitCode !== 0 || echoed.stdout !== JSON.stringify(artifact)) return false;',
        ),
    );
    mkdirSync(join(repo, "campaigns", "bridge-truss"), { recursive: true });
    const { report } = await driveBattery({
      slug: "bridge-truss",
      slugDir,
      runId: "recorded-input-1",
      builderId: DRIVER_ID,
      recordPath: join(repo, "campaigns", "bridge-truss", "case-record.jsonl"),
      verification: {
        solver: scriptedMatchingSolver(),
        backendPin: "scripted/none",
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: "t".repeat(64),
        capabilities: [],
      },
      isolation: null,
      tasks: loadRecordedTasks(slugDir),
    });
    report.score = [{ caseId: "falsified", passed: false, truthVerified: true, checkIds: [] }];
    report.evidence.backendPin = "falsified/pin";
    report.evidence.discrimination = { claimable: false, findings: [], attributedCheckIds: {} };

    const created = await writeRunClaim({
      slug: "bridge-truss",
      slugDir,
      claimsDir: join(repo, "campaigns", "bridge-truss", "claims"),
      limitMarginPath: join(
        repo,
        "campaigns",
        "bridge-truss",
        "analysis",
        `${report.runId}-limit-margin.json`,
      ),
      runId: report.runId,
      isolation: "contractual",
    });

    expect(created.created).toBe(true);
    expect(created.statement).toMatchObject({ n: 4, passed: 4, backendPin: "scripted/none" });
    expect(created.statement?.groundings).toContainEqual({
      checkId: "parts-assigned",
      kind: "authored",
      adapterId: null,
      requiredToolIds: ["cat"],
    });
    expect(created.statement?.externalCheckCoverage).toContainEqual(
      expect.objectContaining({ checkId: "parts-assigned", toolId: "cat", attestedLaunches: 4 }),
    );
    expect(JSON.parse(readFileSync(created.evidencePath, "utf8")).solvability.policy).toBe(
      SOLVABILITY_READINESS_POLICY,
    );
  }, 60_000);

  it.concurrent("refuses to attach an old score to a tree mutated between verification and claim writing", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "mutate-write"), { toolsSpec: true });
    const slugDir = join(repo, "domains", "bridge-truss");
    mkdirSync(join(repo, "campaigns", "bridge-truss"), { recursive: true });
    const { report } = await driveBattery({
      slug: "bridge-truss",
      slugDir,
      runId: "mutate-1",
      builderId: DRIVER_ID,
      recordPath: join(repo, "campaigns", "bridge-truss", "case-record.jsonl"),
      verification: {
        solver: scriptedMatchingSolver(),
        backendPin: "scripted/none",
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: [],
      },
      isolation: null,
      tasks: loadRecordedTasks(slugDir),
    });
    // The live tree changes AFTER verification: the write must refuse, never name new bytes
    // beside the old score.
    writeFileSync(join(slugDir, "agent", "tools.ts"), "// mutated after verification\n");
    await expect(
      writeRunClaim({
        slug: "bridge-truss",
        slugDir,
        claimsDir: join(repo, "campaigns", "bridge-truss", "claims"),
        limitMarginPath: join(
          repo,
          "campaigns",
          "bridge-truss",
          "analysis",
          `${report.runId}-limit-margin.json`,
        ),
        runId: report.runId,
        isolation: "contractual",
      }),
    ).rejects.toThrow(/changed between verification and claim writing/);
  });

  it.concurrent("refuses a recorded battery that carries no firing counts", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "no-firing-write"), { toolsSpec: true });
    const slugDir = join(repo, "domains", "bridge-truss");
    mkdirSync(join(repo, "campaigns", "bridge-truss"), { recursive: true });
    const { report } = await driveBattery({
      slug: "bridge-truss",
      slugDir,
      runId: "no-firing-1",
      builderId: DRIVER_ID,
      recordPath: join(repo, "campaigns", "bridge-truss", "case-record.jsonl"),
      verification: {
        solver: scriptedMatchingSolver(),
        backendPin: "scripted/none",
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: [],
      },
      isolation: null,
      tasks: loadRecordedTasks(slugDir),
    });
    // Re-record the battery as a writer without firing counts would have: the manifest still
    // attests the bytes, so only the claim writer's own requirement can refuse it.
    const runDir = join(slugDir, "runs", report.runId);
    const { truthCheckFiring: _dropped, ...battery } = parseJsonAs<JsonObject>(
      readFileSync(join(runDir, "battery.json"), "utf8"),
    );
    const bytes = JSON.stringify(battery);
    writeFileSync(join(runDir, "battery.json"), bytes);
    const manifest = parseJsonAs<{ files: Record<string, string> }>(
      readFileSync(join(runDir, RUN_MANIFEST_NAME), "utf8"),
    );
    manifest.files["battery.json"] = sha256(bytes);
    writeFileSync(join(runDir, RUN_MANIFEST_NAME), JSON.stringify(manifest));
    await expect(
      writeRunClaim({
        slug: "bridge-truss",
        slugDir,
        claimsDir: join(repo, "campaigns", "bridge-truss", "claims"),
        limitMarginPath: join(
          repo,
          "campaigns",
          "bridge-truss",
          "analysis",
          `${report.runId}-limit-margin.json`,
        ),
        runId: report.runId,
        isolation: "contractual",
      }),
    ).rejects.toThrow(/recorded battery carries no truthCheckFiring/);
  });

  // truss-run13-sol-0903 (2026-09-03): 25/25 verified, then the claim-time witness's tool run
  // failed once and the thrown non-result closed the run as controller-unclassified with no claim.
  it.concurrent("records a claim-time tool non-result as a finding and still creates the score", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "no-verdict-write"), { toolsSpec: true });
    const slugDir = join(repo, "domains", "bridge-truss");
    mkdirSync(join(repo, "campaigns", "bridge-truss"), { recursive: true });
    const { report } = await driveBattery({
      slug: "bridge-truss",
      slugDir,
      runId: "no-verdict-1",
      builderId: DRIVER_ID,
      recordPath: join(repo, "campaigns", "bridge-truss", "case-record.jsonl"),
      verification: {
        solver: scriptedMatchingSolver(),
        backendPin: "scripted/none",
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: "t".repeat(64),
        capabilities: [],
      },
      isolation: null,
      tasks: loadRecordedTasks(slugDir),
    });
    // A recorded inventory entry whose executable is not there: the host cannot re-hash it before
    // spawning, so execution returns `verifierUnavailable` without starting the tool.
    const verifier = createVerifierHost({
      inventory: {
        candidate: {
          id: "candidate",
          path: join(SCRATCH_ROOT, "no-verdict-write", "absent-tool"),
          digest: "0".repeat(64),
          source: "host",
          kind: "binary",
          interpreter: null,
        },
      },
      requireOsSandbox: false,
    });
    let probeCalls = 0;
    const created = await writeRunClaim({
      slug: "bridge-truss",
      slugDir,
      claimsDir: join(repo, "campaigns", "bridge-truss", "claims"),
      limitMarginPath: join(
        repo,
        "campaigns",
        "bridge-truss",
        "analysis",
        `${report.runId}-limit-margin.json`,
      ),
      runId: report.runId,
      isolation: "contractual",
      toolRetryWaitMs: 0,
      probeSolvability: async () => {
        probeCalls += 1;
        const scope = verifier.openSubject({
          checks: null,
          runId: report.runId,
          phase: "solvability",
          subjectId: "family:bridge-01",
          attempt: 1,
          artifact: {},
          publicTask: null,
        });
        const run = await scope.port.run({ toolId: "candidate", checkId: "parts-assigned" });
        await scope.close();
        throw new VerifierExecutionNonResult(run.evidence);
      },
    });
    expect(created.created).toBe(true);
    expect(created.statement).toMatchObject({ n: 4, passed: 4 });
    expect(created.readiness?.ready).toBe(false);
    expect(created.readiness?.clauses.map((clause) => clause.clause)).toContain("no-solvability-witness");
    expect(created.solvabilityFindings).toHaveLength(1);
    expect(created.solvabilityFindings[0]).toMatchObject({ path: "correctness-model/evaluator.ts" });
    expect(created.solvabilityFindings[0]?.detail).toMatch(
      /solvability witness at claim time: tool run verifierUnavailable after 2 attempts/,
    );
    // An environment-owned kind earns one fresh execution, as in the census gate and the control
    // runner: run59-opus-0904 lost a 25/25 climb to a single re-attestation refusal on /usr/bin/cc.
    expect(probeCalls).toBe(2);
    // A solvability subject is a task id, and this detail is controller-validated: it crosses to
    // the author verbatim. Tool id, check id and host-measured facts cross; the task does not.
    expect(created.solvabilityFindings[0]?.detail).not.toContain("family:bridge-01");
    const recorded = JSON.parse(readFileSync(created.evidencePath, "utf8"));
    expect(recorded.claim.ok).toBe(true);
    expect(recorded.solvability).toBeNull();
    expect(recorded.solvabilityFindings).toHaveLength(1);

    // An author-owned kind is the tool the evaluator chose over the artifact's inputs; a second
    // run would say nothing new, so it is recorded on the first attempt.
    let timeoutCalls = 0;
    const timedOut = await writeRunClaim({
      slug: "bridge-truss",
      slugDir,
      claimsDir: join(repo, "campaigns", "bridge-truss", "claims-timeout"),
      limitMarginPath: join(
        repo,
        "campaigns",
        "bridge-truss",
        "analysis-timeout",
        `${report.runId}-limit-margin.json`,
      ),
      runId: report.runId,
      isolation: "contractual",
      toolRetryWaitMs: 0,
      probeSolvability: async () => {
        timeoutCalls += 1;
        const scope = verifier.openSubject({
          checks: null,
          runId: report.runId,
          phase: "solvability",
          subjectId: "family:bridge-01",
          attempt: 1,
          artifact: {},
          publicTask: null,
        });
        const run = await scope.port.run({ toolId: "candidate", checkId: "parts-assigned" });
        await scope.close();
        throw new VerifierExecutionNonResult({ ...run.evidence, outcome: "timeout", timedOut: true });
      },
    });
    expect(timeoutCalls).toBe(1);
    expect(timedOut.solvabilityFindings[0]?.detail).toMatch(/tool run timeout after 1 attempt\./);
  }, 60_000);
});
