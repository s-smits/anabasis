/**
 * One case solved through the production path: the real Pi built solver, the real confined
 * generated-tool worker, the real submission and the real verifier. The model's responses are
 * scripted; nothing else is replaced.
 *
 * The three cases are the three endings that path has. Accepted bytes reach a verdict and every
 * recorded file agrees. A worker that exited mid-solve produces a typed non-result with no
 * verdict written. And a sandbox the host cannot provide refuses the case rather than running it
 * unconfined.
 */

import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { verifyRunDir } from "../src/claim/evidence-log.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { createGeneratedToolStarter } from "../src/solve/generated-tool-worker.ts";
import { builtStarterFactoryForSolver, withSolverBuiltStarterFactory } from "../src/truth/solve.ts";
import { required } from "./helpers/doubles.ts";
import {
  FIRST_TASK,
  PUBLIC_SCHEMA,
  directPiSlug,
  directPiSolver,
  fingerprintOf,
  removeScratchRoot,
  scriptedVerify,
} from "./helpers/verification-runner-fixtures.ts";

afterAll(removeScratchRoot);

/** One battery of the first fixture task, through the production starter. */
const solveFirstTask = (slugDir: string, solver: ReturnType<typeof directPiSolver>, runId: string) =>
  scriptedVerify(runId, { solver, backendPin: "openrouter/faux-eval-production" })({
    slug: "matching",
    slugDir,
    fingerprint: fingerprintOf(slugDir),
    tasks: [FIRST_TASK],
  });

describe("a case solved through the production Pi path", () => {
  it.concurrent("carries accepted bytes through starter, verifier and recorded evidence", async () => {
    const slugDir = directPiSlug();
    const solver = directPiSolver([
      { id: "declare", name: "declare_part", arguments: { name: "alpha" } },
      { id: "bind", name: "bind_slot", arguments: { assignments: [{ part: "alpha", slot: "s3" }] } },
      { id: "submit", name: "submit", arguments: {} },
      // The first early submit is answered with the time left (submit-time-left.ts); the second sends.
      { id: "submit-again", name: "submit", arguments: {} },
    ]);
    const report = await solveFirstTask(slugDir, solver, "run-direct-pi-eval");
    expect(report.score.map(({ caseId, passed }) => ({ caseId, passed }))).toEqual([
      { caseId: "t1", passed: true },
    ]);

    const caseDir = join(slugDir, "runs/run-direct-pi-eval/cases/t1");
    const final = parseJsonAs<{ accepted: boolean; artifactJson: string }>(
      readFileSync(join(caseDir, "final-submission.json"), "utf8"),
    );
    const artifact = JSON.parse(readFileSync(join(caseDir, "artifact.json"), "utf8"));
    const runtime = parseJsonAs<{
      modelWorker: { termination: unknown };
      generatedTools: { termination: unknown };
    }>(readFileSync(join(caseDir, "built-runtime.json"), "utf8"));
    // The submission record and the graded artifact are the same bytes, not two renderings.
    expect(final.accepted).toBe(true);
    expect(final.artifactJson).toBe(JSON.stringify(artifact));
    expect(existsSync(join(caseDir, "verifier.json"))).toBe(true);
    expect(runtime.modelWorker.termination).toEqual({ status: "normal" });
    expect(runtime.generatedTools.termination).toEqual({ status: "normal" });
    expect(verifyRunDir(join(slugDir, "runs/run-direct-pi-eval"))).toEqual([]);
  }, 60_000);

  it.concurrent("records an exited generated worker as a typed non-result before any verdict", async () => {
    const slugDir = directPiSlug();
    const solver = directPiSolver([{ id: "declare", name: "declare_part", arguments: { name: "alpha" } }]);
    const productionFactory = builtStarterFactoryForSolver(solver);
    if (productionFactory === undefined) throw new Error("Pi solver has no production starter factory");
    let killedPid: number | null = null;
    withSolverBuiltStarterFactory(solver, async (...args) => {
      const toolset = await productionFactory(...args);
      const pid = toolset.generatedWorker?.confinedPid ?? null;
      killedPid = pid;
      if (pid === null) throw new Error("generated worker pid is absent");
      runtimeProcess.kill(pid, "SIGKILL");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          runtimeProcess.kill(pid, 0);
          await Bun.sleep(5);
        } catch {
          break;
        }
      }
      return toolset;
    });

    await expect(solveFirstTask(slugDir, solver, "run-direct-pi-worker-exit")).rejects.toMatchObject({
      runId: "run-direct-pi-worker-exit",
      kinds: ["runtime"],
    });
    const caseDir = join(slugDir, "runs/run-direct-pi-worker-exit/cases/t1");
    expect(JSON.parse(readFileSync(join(caseDir, "case-result.json"), "utf8"))).toMatchObject({
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "runtime",
    });
    const runtime = parseJsonAs<{ generatedTools: { termination: unknown } }>(
      readFileSync(join(caseDir, "built-runtime.json"), "utf8"),
    );
    expect(runtime.generatedTools.termination).toMatchObject({ status: "non-result", kind: "runtime" });
    expect(existsSync(join(caseDir, "verifier.json"))).toBe(false);
    // Signal 0 probes a pid without signalling it; ESRCH says the worker is gone, not merely unreachable.
    expect(() => runtimeProcess.kill(required(killedPid, "the killed worker pid"), 0)).toThrow(/ESRCH/);
    expect(verifyRunDir(join(slugDir, "runs/run-direct-pi-worker-exit"))).toEqual([]);
  }, 60_000);

  it.concurrent("turns a sandbox the host cannot provide into a recorded case non-result", async () => {
    const slugDir = directPiSlug();
    const solver = directPiSolver([]);
    withSolverBuiltStarterFactory(solver, async (bundleSnapshotDir, task, submission) =>
      createGeneratedToolStarter({
        slugDir: bundleSnapshotDir,
        task,
        submission,
        contract: {
          controllerTools: () => [],
          presets: [],
          domainToolAuthorities: [],
          operatingGuide: "Solve from the public input.",
          publishedMargins: [],
        },
        publicArtifactSchema: PUBLIC_SCHEMA,
        workerSupport: {
          ok: false,
          reason: "injected unavailable worker policy",
          platform: runtimeProcess.platform === "linux" ? "linux" : "darwin",
          mechanismId: "none",
          mechanismPath: "/unavailable",
          mechanismDigest: null,
          baselineDigest: null,
        },
      }),
    );

    await expect(solveFirstTask(slugDir, solver, "run-direct-pi-policy-unavailable")).rejects.toMatchObject({
      runId: "run-direct-pi-policy-unavailable",
      kinds: ["sandbox"],
    });
    const caseDir = join(slugDir, "runs/run-direct-pi-policy-unavailable/cases/t1");
    expect(JSON.parse(readFileSync(join(caseDir, "case-result.json"), "utf8"))).toMatchObject({
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "sandbox",
      runtimeNonResult: "injected unavailable worker policy",
    });
    expect(existsSync(join(caseDir, "verifier.json"))).toBe(false);
    expect(verifyRunDir(join(slugDir, "runs/run-direct-pi-policy-unavailable"))).toEqual([]);
  }, 60_000);
});
