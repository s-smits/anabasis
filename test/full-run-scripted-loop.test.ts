/**
 * The whole controller loop with no provider: the real controller, the real build stage through the
 * Builder runtime interface with a scripted session, the real submit, census, solvability and adoption
 * path, the real measurement with a scripted solver, the real analysis with the review slot off, and
 * the real selector on the recorded evidence. Only the two model seats are scripted. This proves the
 * mechanism end to end; it says nothing about model behaviour.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { BuilderCommandGuardResult } from "../src/builder/command-guard.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { analyseStep } from "../src/run/analyse-step.ts";
import { claimsDirFor } from "../src/run/claim-write.ts";
import { readControllerEvidence } from "../src/run/controller-evidence.ts";
import { type FullRunDeps, parseFullRunArgs, runFullRun, slugForDirectInput } from "../src/run/full-run.ts";
import { buildHarness } from "../src/run/harness-build.ts";
import { measureHarness } from "../src/run/harness-measure.ts";
import { selectedProductDir } from "../src/run/product-versions.ts";
import { readRecordedBatteryRecord } from "../src/truth/battery-record.ts";
import { builtSession, fullFakeHost, probeEvidence } from "./helpers/measure-doubles.ts";
import { type ScriptedTurn, scriptedBuilderRuntime } from "./helpers/scripted-builder-runtime.ts";
import { writeFixtureThresholds } from "./helpers/thresholds.ts";
import { required } from "./helpers/doubles.ts";
import { scriptedUppercaseSolver, uppercaseFixture } from "./helpers/uppercase-fixture.ts";

const PROMPT = "Build a harness that uppercases one public input.";
/** The controller's battery floor: fewer verified cases cannot inform the difficulty selector. */
const TASKS = 6;
const SLUG = slugForDirectInput(PROMPT, EMPTY_USER_CONTEXT.digest);
const scratch: string[] = [];
const guard: BuilderCommandGuardResult = {
  state: "skipped",
  path: null,
  dcgVersion: null,
  binarySha256: null,
  skippedReason: "explicit-off",
};

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(): string {
  // Inside the checkout so the snapshot's agent/tools.ts resolves @ana/agent-bundle.
  mkdirSync(join(import.meta.dir, "..", ".scratch"), { recursive: true });
  const root = mkdtempSync(join(import.meta.dir, "..", ".scratch", "ana-scripted-loop-"));
  scratch.push(root);
  writeFixtureThresholds(root);
  // The scripted solver reports a Codex identity, so the Built slot is pinned to that provider
  // and its model the way the measurement warranty pins it through the process environment.
  writeFileSync(join(root, ".env"), "CODEX_BUILT_MODEL=gpt-5.5\n");
  return root;
}

/** The two model seats scripted; every other stage is the production function. */
function scriptedDeps(turn: ScriptedTurn, drive: FullRunDeps["drive"] = measureUppercase): FullRunDeps {
  // One runtime for the run: the Builder conversation keeps its session across rounds.
  const builderRuntime = scriptedBuilderRuntime(turn);
  return {
    ensureDcg: () => guard,
    build: (manifest, options) => buildHarness(manifest, { ...options, builderRuntime }),
    drive,
    analyse: analyseStep,
  };
}

const measureUppercase: FullRunDeps["drive"] = (manifest, options) =>
  measureHarness(manifest, {
    ...options,
    solver: scriptedUppercaseSolver(),
    createVerifier: () => fullFakeHost(),
    isolationProbe: () => probeEvidence(true),
    sessionProbe: async () => builtSession(),
    judge: null,
  });

function args(root: string, runId: string, maxIterations: number, maxBuilderTurns = 2) {
  return {
    ...parseFullRunArgs([
      "--prompt",
      PROMPT,
      "--project",
      SLUG,
      "--run",
      runId,
      "--dcg",
      "false",
      "--max-iterations",
      String(maxIterations),
      "--max-builder-turns",
      String(maxBuilderTurns),
      "--expected-tasks",
      String(TASKS),
      "--built-backend",
      "codex",
      "--review-backend",
      "disabled",
    ]),
    repoRoot: root,
  };
}

describe("the whole loop through the Builder runtime interface, with no provider", () => {
  it("builds, adopts, measures and records a round, then reopens the adopted product with a working harness_reset", async () => {
    const root = scratchRepo();
    const starterTools = readFileSync(
      join(import.meta.dir, "../starters/pi-built-harness/agent/tools.ts"),
      "utf8",
    );
    const toolsNow = (workspace: string) => readFileSync(join(workspace, "agent/tools.ts"), "utf8");
    const outcomeOf = (result: { details?: unknown }) =>
      /* SAFETY: harness_reset returns this detail shape on every call. */
      (result.details as { receipt: { outcome: string } }).receipt.outcome;
    const seen: Record<string, string | boolean | number> = {};
    let round = -1;
    const turn: ScriptedTurn = async (ctx) => {
      if (ctx.turn === 1) round += 1;
      if (ctx.turn !== 1) return "nothing further this round";
      if (round === 0) {
        // The smallest admissible bundle, submitted the way a model would on its first turn; a
        // reset outside a reopen is refused and leaves the authored tooling alone.
        uppercaseFixture(ctx.workspace, false, false, TASKS);
        seen.buildReset = outcomeOf(await ctx.call("harness_reset", { scope: "agent" }));
        seen.buildKeptTools = toolsNow(ctx.workspace) !== starterTools;
        await ctx.call("submit", {});
        return "submitted the uppercase bundle";
      }
      // The reopen opens on the adopted bytes; nothing is reset until the Builder asks, and once only.
      seen.seededTools = toolsNow(ctx.workspace) !== starterTools;
      seen.first = outcomeOf(await ctx.call("harness_reset", { scope: "agent" }));
      seen.resetTools = toolsNow(ctx.workspace) === starterTools;
      const tasks: unknown = JSON.parse(
        readFileSync(join(ctx.workspace, "correctness-model/tasks.json"), "utf8"),
      );
      seen.keptTasks = Array.isArray(tasks) ? tasks.length : -1;
      seen.second = outcomeOf(await ctx.call("harness_reset", { scope: "agent" }));
      return "reset the tooling and stopped";
    };
    const drives: string[] = [];
    const { repoRoot, ...runArgs } = args(root, "loop", 2, 1);
    const outcome = await runFullRun(
      runArgs,
      repoRoot,
      scriptedDeps(turn, async (manifest, options) => {
        drives.push(options.runId);
        return measureUppercase(manifest, options);
      }),
    );

    // Round one: a first build the real gates admitted, measured under its own iteration id.
    expect(outcome.rounds.map((row) => [row.move, row.build, row.measured])).toEqual([
      ["build", "adopted", true],
      ["rebuild", "build-failed", false],
    ]);
    expect(outcome.terminal).toStartWith("operator-interrupted: round cap 2 reached");
    const first = required(outcome.rounds[0], "first round");
    expect(drives).toEqual([first.runId]);
    const batteryRunId = first.runId;

    // The adopted product is a retained immutable version holding the scripted bytes.
    const product = selectedProductDir(root, SLUG);
    expect(product.startsWith(join(campaignDir(root, SLUG), "versions"))).toBe(true);
    expect(JSON.parse(readFileSync(join(product, "correctness-model/tasks.json"), "utf8"))).toHaveLength(
      TASKS,
    );

    // The battery: every case verified and passed, read through the recorded-evidence reader.
    const battery = readRecordedBatteryRecord(join(product, "runs", batteryRunId), batteryRunId);
    expect(
      battery.cases.map((row) => [
        row.taskId,
        row.acceptedSubmit,
        row.truthOk,
        row.pass,
        row.runtimeNonResult,
      ]),
    ).toEqual(Array.from({ length: TASKS }, (_, i) => [`t${i}`, true, true, true, null]));
    expect(battery.backendPin).toBe("codex/gpt-5.5");

    // The claim and the analysis are on disk, and the controller evidence names the battery.
    expect(existsSync(join(claimsDirFor(root, SLUG), `${batteryRunId}.json`))).toBe(true);
    expect(existsSync(join(campaignDir(root, SLUG), "analysis", `${batteryRunId}-analysis.json`))).toBe(true);
    const evidence = readControllerEvidence(campaignDir(root, SLUG), "loop");
    if (evidence.state !== "recorded") throw new Error(`controller evidence ${evidence.state}`);
    expect(evidence.outcome).toBe("completed");
    expect(evidence.batteryRunIds).toEqual([batteryRunId]);
    expect(evidence.denominator).toEqual({
      state: "recorded",
      total: TASKS,
      verified: TASKS,
      unaccepted: 0,
      nonResults: 0,
    });

    // Round two reopened the adopted product, where harness_reset works once and then refuses.
    expect(seen).toEqual({
      buildReset: "refused",
      buildKeptTools: true,
      seededTools: true,
      first: "completed",
      resetTools: true,
      keptTasks: TASKS,
      second: "refused",
    });
  }, 120_000);

  it("keeps a session that never submits inadmissible and measures nothing", async () => {
    const root = scratchRepo();
    const prompts: string[] = [];
    const { repoRoot, ...runArgs } = args(root, "idle", 1, 1);
    const outcome = await runFullRun(
      runArgs,
      repoRoot,
      scriptedDeps(
        (ctx) => {
          prompts.push(ctx.prompt);
          return "I read the starter and did nothing";
        },
        async () => {
          throw new Error("an inadmissible build must not be measured");
        },
      ),
    );
    expect(prompts).toHaveLength(1);
    expect(outcome.rounds.map((round) => [round.move, round.build])).toEqual([["build", "build-failed"]]);
    expect(outcome.rounds[0]?.measured).toBe(false);
    expect(existsSync(join(campaignDir(root, SLUG), "versions"))).toBe(false);
    const claims = claimsDirFor(root, SLUG);
    expect(existsSync(claims) ? readdirSync(claims) : []).toEqual([]);
  }, 60_000);
});
