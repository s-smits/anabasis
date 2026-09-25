/**
 * The controller loop in src/run/full-run.ts, and nothing else.
 *
 * That file owns four decisions and no others. It opens a run and closes it exactly once,
 * whatever fails. It fixes the things a campaign must share across rounds — the manifest size,
 * the slot pins, the verifier lifetime — before the first round starts. It reads the endings in
 * one order: the loop's own terminal, then the operator's time boundary, then the operator's
 * round cap. And it records the round before it breaks, so the battery in flight is in the
 * evidence whatever ended the run.
 *
 * Everything else belongs to a named neighbour and is tested there: argument admission and the
 * launch lock in full-run-launch.ts, one round's sequence in full-run-round.ts, the ending
 * vocabulary in loop-terminal.ts, the move in next-move.ts, the recorded rows in
 * controller-evidence.ts. A test here that needs one of them supplies it as a double rather
 * than rebuilding the campaign around it.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import {
  type FullRunDeps,
  roundCapTerminal,
  runFullRun,
  slugForDirectInput,
  softBoundaryTerminal,
} from "../src/run/full-run.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import { fullRunExitStatus, loopTerminalCode } from "../src/run/loop-terminal.ts";
import { operatorBackendsPath } from "../src/backends/resolve.ts";
import {
  selectedProductDir,
  publishProductVersion,
  selectInitialProduct,
} from "../src/run/product-versions.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import type { AskManifest } from "../src/run/ask-manifest.ts";
import { writeFixtureThresholds } from "./helpers/thresholds.ts";
import { double, rejectionOf, required } from "./helpers/doubles.ts";

const PROMPT = "Build a harness for bridge-truss design tasks.";
const SLUG = slugForDirectInput(PROMPT, EMPTY_USER_CONTEXT.digest);

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository root with the frozen policy every round reads and one adopted product, so the
 *  loop has something to measure without a build step. */
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

/** A measure step that records its battery and returns a claim-created verdict, so the round
 *  settles without a build. `calls` receives one line per step the loop actually drove. */
function measuringDeps(calls: string[], onDrive?: (runId: string) => void): FullRunDeps {
  return double({
    build: async () => {
      calls.push("build");
      throw new Error("this fixture measures an adopted product; it must not build");
    },
    drive: async (
      _manifest: AskManifest,
      options: { runId: string; onBatteryStart?: (id: string) => void },
    ) => {
      calls.push(`drive:${options.runId}`);
      options.onBatteryStart?.(options.runId);
      onDrive?.(options.runId);
      return double({
        runId: options.runId,
        verdicts: { measured: true, claimCreated: true, ready: false },
        claim: null,
      });
    },
    analyse: async () => {
      calls.push("analyse");
      return double({ judges: null, admission: null });
    },
  });
}

describe("opening and closing the run exactly once", () => {
  it("refuses a launch with no explicit provider turn cap, and names the flag", async () => {
    // The CLI boundary: a production launch states its cap. Injected deps are the one exemption,
    // because a deterministic controller test makes no provider call.
    const error = await rejectionOf(runFullRun({ prompt: PROMPT, project: SLUG, runId: "r1" }, repo()));
    expect(error.message).toContain("--provider-turn-budget");
  });

  it("records a terminal for every failure after the launch opened, so a dead campaign says why", async () => {
    // The terminal is what a continuation reads. A run that aborts between the launch and its
    // first round currently writes none: closeControllerRun prepares one only once the opening
    // exists, and the opening is written inside round one. So a campaign whose retained product
    // the loop cannot read dies with an exit status and no recorded reason — measured on 105 of
    // the 109 retained versions on one machine, all of them with intact product bytes.
    const root = repo();
    writeFileSync(join(selectedProductDir(root, SLUG), "version.json"), '{"schema":"product-version/v9"}');
    const error = await rejectionOf(
      runFullRun({ prompt: PROMPT, project: SLUG, runId: "r1", maxIterations: 1 }, root, measuringDeps([])),
    );
    expect(error.message).toContain("product version is missing, altered, or unregistered");
    const terminal = join(root, "campaigns", SLUG, "controller", "r1", "terminal.json");
    const recorded = JSON.parse(readFileSync(terminal, "utf8"));
    expect(recorded.outcome).toBe("aborted");
    expect(recorded.terminalReason).toContain(error.message);
  });
});

describe("what the campaign fixes before its first round", () => {
  it("sizes the manifest once, so every round of the campaign measures the same battery", async () => {
    const root = repo();
    const sizes: unknown[] = [];
    const deps = double<FullRunDeps>({
      ...measuringDeps([]),
      drive: async (
        manifest: AskManifest,
        options: { runId: string; onBatteryStart?: (id: string) => void },
      ) => {
        sizes.push(manifest.expectedTasks);
        options.onBatteryStart?.(options.runId);
        return double({
          runId: options.runId,
          verdicts: { measured: true, claimCreated: true, ready: false },
          claim: null,
        });
      },
    });
    await runFullRun(
      { prompt: PROMPT, project: SLUG, runId: "r1", expectedTasks: 8, maxIterations: 2 },
      root,
      deps,
    );
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBe(8);
  });

  it("refuses a battery size the frozen policy does not admit, before any round runs", async () => {
    const root = repo();
    const calls: string[] = [];
    const error = await rejectionOf(
      runFullRun(
        { prompt: PROMPT, project: SLUG, runId: "r1", expectedTasks: 0, maxIterations: 1 },
        root,
        measuringDeps(calls),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it("writes the three slot selections before the loop, durable for the next run", async () => {
    const root = repo();
    await runFullRun(
      {
        prompt: PROMPT,
        project: SLUG,
        runId: "r1",
        maxIterations: 1,
        backendSelections: { builder: "claude", built: "claude", review: "claude" },
      },
      root,
      measuringDeps([]),
    );
    const written = JSON.parse(readFileSync(operatorBackendsPath(root, SLUG), "utf8"));
    for (const slot of ["builder", "built", "review"] as const) {
      expect(written[slot]).toEqual({ kind: "claude" });
    }
  });
});

describe("the order the endings are read in", () => {
  it("fires the round cap only when the operator set one, naming the flag and the completed round", () => {
    expect(roundCapTerminal(13, Infinity)).toBeNull();
    expect(roundCapTerminal(2, 3)).toBeNull();
    const terminal = required(roundCapTerminal(3, 3), "round cap terminal");
    expect(loopTerminalCode(terminal)).toBe("operator-interrupted");
    expect(terminal).toContain("--max-iterations");
    expect(terminal).toContain("completed round 3");
  });

  it("reads the time boundary after a round records, so the battery in flight always finishes", () => {
    expect(softBoundaryTerminal(1, 5_000, undefined)).toBeNull();
    expect(softBoundaryTerminal(1, 999, 1_000)).toBeNull();
    const terminal = required(softBoundaryTerminal(2, 1_000, 1_000), "soft boundary terminal");
    expect(loopTerminalCode(terminal)).toBe("operator-interrupted");
    expect(terminal).toContain("--stop-after-ms");
    expect(terminal).toContain("completed round 2");
  });

  it("gives an operator interruption its own exit status, distinct from a completed run and a failure", () => {
    expect(fullRunExitStatus(required(roundCapTerminal(1, 1), "cap"))).toBe(3);
    expect(fullRunExitStatus("completed: the campaign settled its question")).toBe(0);
    expect(fullRunExitStatus("stopped: nothing left to try")).toBe(1);
  });

  it("lets the loop's own terminal win over the operator's cap on the round they both fire", async () => {
    // A run that settles on its last permitted round keeps the loop's ending. Reading the cap
    // first would report every finished rehearsal as interrupted, and a rehearsal script could
    // not tell an unfinished campaign from a completed one.
    const root = repo();
    const outcome = await runFullRun(
      { prompt: PROMPT, project: SLUG, runId: "r1", maxIterations: 3 },
      root,
      measuringDeps([]),
    );
    expect(outcome.rounds).toHaveLength(3);
    expect(loopTerminalCode(required(outcome.terminal, "terminal"))).toBe("environment-blocked");
  });

  it("ends after the completed round once the time boundary has elapsed, with that battery recorded", async () => {
    const root = repo();
    const outcome = await runFullRun(
      { prompt: PROMPT, project: SLUG, runId: "r1", stopAfterMs: 0, maxIterations: 5 },
      root,
      measuringDeps([]),
    );
    expect(outcome.rounds).toHaveLength(1);
    expect(outcome.rounds[0]?.measured).toBe(true);
    expect(loopTerminalCode(required(outcome.terminal, "terminal"))).toBe("operator-interrupted");
  });
});

describe("what each round leaves behind", () => {
  it("gives every round a distinct id under one controller identity", async () => {
    const root = repo();
    const outcome = await runFullRun(
      { prompt: PROMPT, project: SLUG, runId: "r1", maxIterations: 3 },
      root,
      measuringDeps([]),
    );
    const ids = outcome.rounds.map((round) => round.runId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("r1");
  });

  it("records the round before it breaks, so the last battery is in the evidence", async () => {
    const root = repo();
    const outcome = await runFullRun(
      { prompt: PROMPT, project: SLUG, runId: "r1", maxIterations: 2 },
      root,
      measuringDeps([]),
    );
    const last = required(outcome.rounds.at(-1), "last round");
    expect(last.terminal).not.toBeNull();
    expect(last.measured).toBe(true);
    const recorded = JSON.parse(
      readFileSync(join(root, "campaigns", SLUG, "controller", "r1", "terminal.json"), "utf8"),
    );
    expect(recorded.iterations.at(-1)).toMatchObject({ runId: last.runId, measured: true });
    // The terminal carries no copy of what the iterations and the case rows already say.
    expect(recorded).not.toHaveProperty("denominator");
    expect(recorded).not.toHaveProperty("lastIteration");
  });

  it("records one measured round when its battery start is reported twice", async () => {
    const root = repo();
    let batteries = 0;
    const deps = double<FullRunDeps>({
      ...measuringDeps([]),
      drive: async (_manifest: AskManifest, options: { runId: string; onBatteryStart?: () => void }) => {
        batteries += 1;
        options.onBatteryStart?.();
        options.onBatteryStart?.();
        return double({
          runId: options.runId,
          verdicts: { measured: true, claimCreated: true, ready: false },
          claim: null,
        });
      },
    });
    const outcome = await runFullRun(
      { prompt: PROMPT, project: SLUG, runId: "r1", maxIterations: 1 },
      root,
      deps,
    );
    expect(batteries).toBe(1);
    expect(outcome.rounds.map((round) => [round.runId, round.measured])).toEqual([["r1", true]]);
  });

  it("cites evidence only on a terminal with something to cite", async () => {
    const root = repo();
    const outcome = await runFullRun(
      { prompt: PROMPT, project: SLUG, runId: "r1", maxIterations: 2 },
      root,
      measuringDeps([]),
    );
    // A round that did not end the run cites nothing, and says so by absence rather than by an
    // empty list, which reads as "cited nothing" in the recorded row.
    expect(outcome.rounds[0]).not.toHaveProperty("terminalEvidence");
    const recorded = JSON.parse(
      readFileSync(join(root, "campaigns", SLUG, "controller", "r1", "terminal.json"), "utf8"),
    );
    expect(recorded.iterations[0]).not.toHaveProperty("terminalEvidence");
  });

  it("reports the final round's fields and the final round's terminal", async () => {
    const root = repo();
    const seen: string[] = [];
    const outcome = await runFullRun(
      { prompt: PROMPT, project: SLUG, runId: "r1", maxIterations: 2 },
      root,
      measuringDeps([], (runId) => seen.push(runId)),
    );
    expect(seen).toHaveLength(2);
    expect(outcome.measure?.runId).toBe(seen.at(-1));
    expect(outcome.terminal).toBe(required(outcome.rounds.at(-1), "last round").terminal);
    expect(outcome.build).toBe(required(outcome.rounds.at(-1), "last round").build);
  });
});
