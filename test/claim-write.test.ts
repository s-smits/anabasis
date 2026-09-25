/**
 * What a measured round is allowed to write down.
 *
 * A run id is one safe path segment at every entrypoint that names a run directory. Execution binds
 * to the task set that was recorded, not to one in process memory. And `writeRunClaim` takes a run
 * id and nothing else: it rebuilds the claim from the recorded battery, refuses a tree or a record
 * that changed underneath it, and records a claim-time witness that could not run — a tool
 * non-result, or source that drifted from the process's frozen identity — as a finding beside a
 * score it still writes.
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { sha256 } from "../src/meta/digest.ts";
import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { join } from "../src/meta/path.ts";
import { RUN_MANIFEST_NAME } from "../src/claim/evidence-log.ts";
import type { SolvabilityEvidence } from "../src/claim/readiness.ts";
import { type WrittenRunClaim, writeRunClaim } from "../src/run/claim-write.ts";
import { driveBattery, loadRecordedTasks } from "../src/run/run-driver.ts";
import * as sourceIdentity from "../src/run/source-identity.ts";
import { SOLVABILITY_READINESS_POLICY } from "../src/truth/solvability.ts";
import { VerifierExecutionNonResult } from "../src/truth/verifier-nonresult.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { double } from "./helpers/doubles.ts";
import { MATCHING_BRIEF, MATCHING_TASKS, scriptedMatchingSolver } from "./helpers/matching-fixture.ts";
import { fullFakeHost, probeEvidence } from "./helpers/measure-doubles.ts";
import { DRIVER_ID, measure, measureScratch, scaffoldRepo } from "./helpers/measure-repo.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import { SCRIPTED_CONDITION, SCRIPTED_THRESHOLD_DIGEST } from "./helpers/verification-runner-fixtures.ts";

const SLUG = "bridge-truss";

afterAll(cleanupScratch);

const SCRATCH_ROOT = measureScratch();

const verification = {
  solver: scriptedMatchingSolver(),
  backendPin: "scripted/none",
  condition: SCRIPTED_CONDITION,
  thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
  capabilities: [],
};

/** A battery recorded over the matching fixture in its own repo, and a writer for claims about it,
 *  each write under its own claims and analysis directories. */
async function recordedBattery(name: string, prepare: (slugDir: string) => void = () => undefined) {
  const repo = scaffoldRepo(join(SCRATCH_ROOT, name), { toolsSpec: true });
  const slugDir = join(repo, "domains", SLUG);
  const campaign = join(repo, "campaigns", SLUG);
  prepare(slugDir);
  mkdirSync(campaign, { recursive: true });
  const runId = `${name}-1`;
  await driveBattery({
    slug: SLUG,
    slugDir,
    runId,
    builderId: DRIVER_ID,
    recordPath: join(campaign, "case-record.jsonl"),
    verification,
    isolation: null,
    tasks: loadRecordedTasks(slugDir),
  });
  const write = (
    tag: string,
    extra: Partial<Parameters<typeof writeRunClaim>[0]> = {},
  ): Promise<WrittenRunClaim> =>
    writeRunClaim({
      slug: SLUG,
      slugDir,
      claimsDir: join(campaign, `claims-${tag}`),
      limitMarginPath: join(campaign, `analysis-${tag}`, `${runId}-limit-margin.json`),
      runId,
      isolation: "contractual",
      toolRetryWaitMs: 0,
      ...extra,
    });
  return { slugDir, runId, write };
}

describe("a run id is one safe path segment wherever it names a run directory", () => {
  const repo = scaffoldRepo(join(SCRATCH_ROOT, "hostile-runid"), { toolsSpec: true });
  const entrypoints: Array<[string, (runId: string) => Promise<void>]> = [
    [
      "measureHarness",
      async (runId) => {
        await measure({ runId, repoRoot: repo, processEnv: {} });
      },
    ],
    [
      "driveBattery",
      async (runId) => {
        await driveBattery({
          slug: "matching",
          slugDir: join(SCRATCH_ROOT, "never-created"),
          runId,
          builderId: "hostile",
          recordPath: join(SCRATCH_ROOT, "never.jsonl"),
          verification,
          isolation: null,
          tasks: MATCHING_TASKS,
        });
      },
    ],
    [
      "writeRunClaim",
      async (runId) => {
        await writeRunClaim({
          slug: SLUG,
          slugDir: join(SCRATCH_ROOT, "never-created"),
          claimsDir: join(SCRATCH_ROOT, "never-claims"),
          limitMarginPath: join(SCRATCH_ROOT, "never-margin.json"),
          runId,
          isolation: "contractual",
        });
      },
    ],
  ];
  it.each(entrypoints)("%s refuses a traversal before touching the tree", async (_, enter) => {
    for (const hostile of ["../escape", "a/b", String.raw`a\b`, "..", ".hidden", ""]) {
      await expect(enter(hostile)).rejects.toThrow(/not a safe single path segment/);
    }
  });
});

it("refuses a substituted task array when correctness-model/tasks.json is recorded", async () => {
  const repo = scaffoldRepo(join(SCRATCH_ROOT, "task-subst"), { toolsSpec: true });
  await expect(
    measure({
      runId: "subst",
      repoRoot: repo,
      processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
      tasks: MATCHING_TASKS.slice(0, 1),
      solver: scriptedMatchingSolver(),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(false),
    }),
  ).rejects.toThrow(/differ from correctness-model\/tasks\.json/);
});

describe("a claim written from a recorded battery", () => {
  let battery: Awaited<ReturnType<typeof recordedBattery>>;
  beforeAll(async () => {
    // The deciding check runs `cat` through the host, so the claim has a required tool to ground.
    battery = await recordedBattery("recorded", (slugDir) => {
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
    });
  }, 60_000);

  it("states the recorded score, its authored grounding and the host-attested tool runs", async () => {
    const created = await battery.write("green");
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

  it("records a claim-time tool non-result as a finding, retrying only an environment-owned kind", async () => {
    // An inventory entry whose executable is absent: the host cannot re-hash it, so execution
    // returns `verifierUnavailable` without starting the tool.
    const verifier = createVerifierHost({
      inventory: {
        candidate: {
          id: "candidate",
          path: join(SCRATCH_ROOT, "absent-tool"),
          digest: "0".repeat(64),
          source: "host",
          kind: "binary",
          interpreter: null,
        },
      },
      requireOsSandbox: false,
    });
    const failingProbe = (outcome: "verifierUnavailable" | "timeout") => {
      const calls = { count: 0 };
      const probeSolvability = async (): Promise<never> => {
        calls.count += 1;
        const scope = verifier.openSubject({
          checks: null,
          runId: battery.runId,
          phase: "solvability",
          subjectId: "family:bridge-01",
          attempt: 1,
          artifact: {},
          publicTask: null,
        });
        const run = await scope.port.run({ toolId: "candidate", checkId: "parts-assigned" });
        await scope.close();
        throw new VerifierExecutionNonResult({ ...run.evidence, outcome, timedOut: outcome === "timeout" });
      };
      return { calls, probeSolvability };
    };

    const unavailable = failingProbe("verifierUnavailable");
    const created = await battery.write("unavailable", { probeSolvability: unavailable.probeSolvability });
    expect(created.statement).toMatchObject({ n: 4, passed: 4 });
    expect(created.readiness?.clauses.map((clause) => clause.clause)).toContain("no-solvability-witness");
    expect(unavailable.calls.count).toBe(2);
    expect(created.solvabilityFindings).toHaveLength(1);
    expect(created.solvabilityFindings[0]).toMatchObject({ path: "correctness-model/evaluator.ts" });
    expect(created.solvabilityFindings[0]?.detail).toMatch(
      /solvability witness at claim time: tool run verifierUnavailable after 2 attempts/,
    );
    // The detail crosses to the author verbatim, so the task id the subject names must not.
    expect(created.solvabilityFindings[0]?.detail).not.toContain("family:bridge-01");
    const recorded = JSON.parse(readFileSync(created.evidencePath, "utf8"));
    expect([recorded.claim.ok, recorded.solvability, recorded.solvabilityFindings.length]).toEqual([
      true,
      null,
      1,
    ]);

    // An author-owned kind is the evaluator's own tool over the artifact; a second run says nothing new.
    const timeout = failingProbe("timeout");
    const timedOut = await battery.write("timeout", { probeSolvability: timeout.probeSolvability });
    expect(timeout.calls.count).toBe(1);
    expect(timedOut.solvabilityFindings[0]?.detail).toMatch(/tool run timeout after 1 attempt\./);
  }, 60_000);

  it.each<[string, Array<string | null>, number]>([
    ["before probing", ["drifted"], 0],
    ["mid-probe", [null, "drifted"], 1],
  ])(
    "refuses the witness when source drifted %s, and still writes the score",
    async (moment, drift, probes) => {
      const reads = [...drift];
      const frozen = spyOn(sourceIdentity, "sourceStillFrozen").mockImplementation(
        () => reads.shift() ?? null,
      );
      let probeCalls = 0;
      try {
        const created = await battery.write(`drift-${probes}`, {
          probeSolvability: async () => {
            probeCalls += 1;
            return { evidence: double<SolvabilityEvidence>({}), findings: [] };
          },
        });
        expect(created.statement).toMatchObject({ n: 4, passed: 4 });
        expect(probeCalls).toBe(probes);
        expect(created.readiness?.clauses.map((clause) => clause.clause)).toContain("no-solvability-witness");
        expect(created.solvabilityFindings).toEqual([
          expect.objectContaining({
            code: "SOLVABILITY_SOURCE_DRIFT",
            detail: expect.stringContaining(`refused ${moment}`),
          }),
        ]);
      } finally {
        frozen.mockRestore();
      }
    },
    60_000,
  );
});

describe("the write refuses a battery whose recorded bytes no longer stand behind the score", () => {
  it.each<[string, (slugDir: string, runId: string) => void, RegExp]>([
    [
      "a tree mutated between verification and claim writing",
      (slugDir) => writeFileSync(join(slugDir, "agent", "tools.ts"), "// mutated after verification\n"),
      /changed between verification and claim writing/,
    ],
    [
      // Re-recorded as a writer without firing counts would have: the manifest still attests the
      // bytes, so only the claim writer's own requirement can refuse it.
      "a recorded battery that carries no firing counts",
      (slugDir, runId) => {
        const runDir = join(slugDir, "runs", runId);
        const { truthCheckFiring: _dropped, ...rest } = parseJsonAs<JsonObject>(
          readFileSync(join(runDir, "battery.json"), "utf8"),
        );
        const bytes = JSON.stringify(rest);
        writeFileSync(join(runDir, "battery.json"), bytes);
        const manifest = parseJsonAs<{ files: Record<string, string> }>(
          readFileSync(join(runDir, RUN_MANIFEST_NAME), "utf8"),
        );
        manifest.files["battery.json"] = sha256(bytes);
        writeFileSync(join(runDir, RUN_MANIFEST_NAME), JSON.stringify(manifest));
      },
      /recorded battery carries no truthCheckFiring/,
    ],
  ])(
    "%s",
    async (name, tamper, message) => {
      const { slugDir, runId, write } = await recordedBattery(name.split(" ").slice(0, 3).join("-"));
      tamper(slugDir, runId);
      await expect(write("refused")).rejects.toThrow(message);
    },
    60_000,
  );
});
