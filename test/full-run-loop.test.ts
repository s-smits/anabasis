/**
 * The controller loop in src/run/full-run.ts, driven with a measure-only double over one adopted
 * product. The file owns four decisions: it opens a run and closes it once whatever fails; it fixes
 * the manifest size and slot pins before round one; it reads the endings in one order — the loop's
 * own terminal, then the operator's time boundary, then the round cap; and it records the round
 * before it breaks. One round's table is in full-run-round.test.ts, and the whole loop over real
 * build, gate and measurement stages in full-run-scripted-loop.test.ts.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { type FullRunArgs, type FullRunDeps, runFullRun, slugForDirectInput } from "../src/run/full-run.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import { fullRunExitStatus } from "../src/run/loop-terminal.ts";
import { operatorBackendsPath } from "../src/backends/resolve.ts";
import {
  publishProductVersion,
  selectInitialProduct,
  selectedProductDir,
} from "../src/run/product-versions.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import type { AskManifest } from "../src/run/ask-manifest.ts";
import { writeFixtureThresholds } from "./helpers/thresholds.ts";
import { double, rejectionOf, required } from "./helpers/doubles.ts";

interface Drive {
  runId: string;
  expectedTasks: number;
}

const PROMPT = "Build a harness for bridge-truss design tasks.";
const SLUG = slugForDirectInput(PROMPT, EMPTY_USER_CONTEXT.digest);

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository root with the frozen policy and one adopted product, so a round measures without building. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-fullrun-loop-"));
  scratch.push(root);
  writeFixtureThresholds(root);
  const source = join(root, "domains", SLUG);
  for (const [path, content] of Object.entries({
    "agent/index.ts": "export const agent = 1;\n",
    "agent/tools-spec.json": '{"tools":[]}',
    "correctness-model/evaluator.ts": "export const rule = 1;\n",
    "correctness-model/tasks.json": '["fixture-task"]',
  })) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), content);
  }
  const fingerprint = fingerprintSlug(source, { slug: SLUG });
  if (!fingerprint.ok) throw new Error("the fixture product has no fingerprint");
  publishProductVersion({ repoRoot: root, slug: SLUG, id: "current", acceptedSnapshot: source, fingerprint });
  selectInitialProduct(root, SLUG, "current");
  return root;
}

/** A measure step whose battery writes no claim, so every round counts one blocked battery and the
 *  loop's own environment-blocked ending fires on round three. A build is a fixture failure. */
function measuringDeps(drives: Drive[] = [], batteryStarts = 1): FullRunDeps {
  return double({
    build: async () => {
      throw new Error("this fixture measures an adopted product; it must not build");
    },
    drive: async (
      manifest: AskManifest,
      options: { runId: string; onBatteryStart?: (id: string) => void },
    ) => {
      drives.push({ runId: options.runId, expectedTasks: manifest.expectedTasks });
      for (let i = 0; i < batteryStarts; i++) options.onBatteryStart?.(options.runId);
      return double({
        runId: options.runId,
        verdicts: { measured: true, claimCreated: true, ready: false },
        claim: null,
      });
    },
    analyse: async () => double({ judges: null, admission: null }),
  });
}

function launch(over: Partial<FullRunArgs>): FullRunArgs {
  return { prompt: PROMPT, project: SLUG, runId: "r1", ...over };
}

function recordedTerminal(root: string) {
  return JSON.parse(readFileSync(join(root, "campaigns", SLUG, "controller", "r1", "terminal.json"), "utf8"));
}

describe("opening and closing the run", () => {
  it("refuses a launch with no explicit provider turn cap, and names the flag", async () => {
    // Injected deps are the one exemption, because a deterministic controller test makes no provider call.
    const error = await rejectionOf(runFullRun(launch({}), repo()));
    expect(error.message).toBe("fullrun requires an explicit positive --provider-turn-budget");
  });

  it("records an aborted terminal for a failure after the launch opened, so a dead campaign says why", async () => {
    const root = repo();
    writeFileSync(join(selectedProductDir(root, SLUG), "version.json"), '{"schema":"product-version/v9"}');
    const error = await rejectionOf(runFullRun(launch({ maxIterations: 1 }), root, measuringDeps()));
    expect(error.message).toContain("product version is missing, altered, or unregistered");
    const recorded = recordedTerminal(root);
    expect(recorded.outcome).toBe("aborted");
    expect(recorded.terminalReason).toContain(error.message);
  });

  it("refuses a battery size the frozen policy does not admit, before any round runs", async () => {
    const drives: Drive[] = [];
    const error = await rejectionOf(
      runFullRun(launch({ expectedTasks: 0, maxIterations: 1 }), repo(), measuringDeps(drives)),
    );
    expect(error.message).toContain("--expected-tasks 0 is outside [5, 60]");
    expect(drives).toEqual([]);
  });

  it("writes the three slot selections before the loop, durable for the next run", async () => {
    const root = repo();
    const backendSelections = { builder: "claude", built: "claude", review: "claude" } as const;
    await runFullRun(launch({ maxIterations: 1, backendSelections }), root, measuringDeps());
    const written = JSON.parse(readFileSync(operatorBackendsPath(root, SLUG), "utf8"));
    expect(written).toMatchObject({
      builder: { kind: "claude" },
      built: { kind: "claude" },
      review: { kind: "claude" },
    });
  });
});

describe("the endings, and what each round leaves behind", () => {
  it("fires the operator's round cap after the completed round, with every round recorded before the break", async () => {
    const root = repo();
    const drives: Drive[] = [];
    const outcome = await runFullRun(
      launch({ maxIterations: 2, expectedTasks: 8 }),
      root,
      measuringDeps(drives),
    );
    // One manifest size for the whole campaign, and one distinct id per round under the controller's.
    expect(drives.map((drive) => drive.expectedTasks)).toEqual([8, 8]);
    const ids = outcome.rounds.map((round) => round.runId);
    expect(ids[0]).toBe("r1");
    expect(ids).toEqual(drives.map((drive) => drive.runId));
    expect(new Set(ids).size).toBe(2);

    const last = required(outcome.rounds.at(-1), "last round");
    expect(outcome.terminal).toBe(
      "operator-interrupted: round cap 2 reached after completed round 2 (--max-iterations sets it)",
    );
    expect(fullRunExitStatus(outcome.terminal)).toBe(3);
    expect(last.terminal).toBe(outcome.terminal);
    expect(outcome.build).toBe(last.build);
    expect(outcome.measure?.runId).toBe(last.runId);

    const recorded = recordedTerminal(root);
    expect(recorded.iterations.at(-1)).toMatchObject({ runId: last.runId, measured: true });
    // A round that did not end the run cites nothing, by absence rather than by an empty list.
    expect(outcome.rounds[0]).not.toHaveProperty("terminalEvidence");
    expect(recorded.iterations[0]).not.toHaveProperty("terminalEvidence");
    // The terminal carries no copy of what the iterations and the case rows already say.
    expect(recorded).not.toHaveProperty("denominator");
    expect(recorded).not.toHaveProperty("lastIteration");
  });

  it("lets the loop's own terminal win over the operator's cap on the round they both fire", async () => {
    // Reading the cap first would report every run that settles on its last permitted round as interrupted.
    const outcome = await runFullRun(launch({ maxIterations: 3 }), repo(), measuringDeps());
    expect(outcome.rounds).toHaveLength(3);
    expect(outcome.terminal).toStartWith("environment-blocked: 3 consecutive batteries");
  });

  it("ends after the completed round once the time boundary has elapsed, with that battery recorded", async () => {
    const outcome = await runFullRun(launch({ stopAfterMs: 0, maxIterations: 5 }), repo(), measuringDeps());
    expect(outcome.rounds.map((round) => [round.runId, round.measured])).toEqual([["r1", true]]);
    expect(outcome.terminal).toBe(
      "operator-interrupted: time boundary 0 ms reached after completed round 1 (--stop-after-ms sets it)",
    );
  });

  it("records one measured round when its battery start is reported twice", async () => {
    const drives: Drive[] = [];
    const outcome = await runFullRun(launch({ maxIterations: 1 }), repo(), measuringDeps(drives, 2));
    expect(drives).toHaveLength(1);
    expect(outcome.rounds.map((round) => [round.runId, round.measured])).toEqual([["r1", true]]);
  });
});
