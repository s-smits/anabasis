/**
 * The climb across rounds, with no provider. One adopted product is measured three times while a
 * scripted Builder makes only the battery harder, and the solver's competence stays fixed: it
 * uppercases an input of at most two characters and gets a longer one wrong. So the pass rate falls
 * because the tasks moved, which is the whole claim a climb makes.
 *
 * Everything but the two model seats is production: the real selector, the real experiment
 * attribution from accepted bytes, the real census, solvability and adoption path, and the real
 * recorded evidence the next round reads.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { BuilderCommandGuardResult } from "../src/builder/command-guard.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import { campaignDir } from "../src/meta/campaign-root.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { analyseStep } from "../src/run/analyse-step.ts";
import { claimsDirFor } from "../src/run/claim-write.ts";
import type { DifficultyDecisionEvidence } from "../src/run/difficulty-decision.ts";
import { type FullRunDeps, parseFullRunArgs, runFullRun, slugForDirectInput } from "../src/run/full-run.ts";
import { buildHarness } from "../src/run/harness-build.ts";
import { measureHarness } from "../src/run/harness-measure.ts";
import { measuredProductDir } from "../src/run/product-versions.ts";
import type { Solver } from "../src/truth/solve.ts";
import { readRecordedBatteryRecord } from "../src/truth/battery-record.ts";
import { required } from "./helpers/doubles.ts";
import { builtSession, fullFakeHost, probeEvidence } from "./helpers/measure-doubles.ts";
import { type ScriptedTurn, scriptedBuilderRuntime } from "./helpers/scripted-builder-runtime.ts";
import { writeFixtureThresholds } from "./helpers/thresholds.ts";
import { scriptedUppercaseSolver, uppercaseFixture } from "./helpers/uppercase-fixture.ts";

const PROMPT = "Build a harness that uppercases one public input.";
const TASKS = 6;
const SLUG = slugForDirectInput(PROMPT, EMPTY_USER_CONTEXT.digest);
/** One character past what the scripted solver can uppercase. */
const CEILING = 2;
/** Every input within the ceiling: the first battery the harness passes whole. */
const EASY = ["a", "ab", "c", "cd", "e", "ef"];
/** Two of six past the ceiling, one in each family. */
const HARDER = ["a", "abc", "c", "cd", "e", "efg"];
/** Four of six past it. */
const HARDEST = ["a", "abc", "cde", "cd", "efg", "ghi"];
/** Two more batteries the harness passes whole, distinct from EASY and from each other: a climb
 *  that keeps reading the same side of the aim. */
const EASY_AGAIN = ["b", "bc", "d", "de", "f", "fg"];
const EASY_ONCE_MORE = ["g", "gh", "h", "hi", "i", "ij"];

const scratch: string[] = [];
const guard: BuilderCommandGuardResult = {
  state: "skipped",
  path: null,
  dcgVersion: null,
  binarySha256: null,
  skippedReason: "explicit-off",
};

/** One accepted candidate, as the submit receipt names it. */
interface Accepted {
  outcome: string;
  candidateId: string;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(): string {
  mkdirSync(join(import.meta.dir, "..", ".scratch"), { recursive: true });
  const root = mkdtempSync(join(import.meta.dir, "..", ".scratch", "ana-climb-loop-"));
  scratch.push(root);
  writeFixtureThresholds(root);
  writeFileSync(join(root, ".env"), "CODEX_BUILT_MODEL=gpt-5.5\n");
  return root;
}

/** A fixed competence: the answer is right while the input fits, and wrong past it. The solver
 *  still submits, so a miss is a verified failure rather than an unaccepted attempt. */
const boundedSolver: Solver = async (task, toolset, submitted) => {
  /* SAFETY: every task of the uppercase bundle carries this public input. */
  const { input } = task.publicInput as { input: string };
  const flub = input.length > CEILING ? new Set([task.taskId]) : new Set<string>();
  return scriptedUppercaseSolver(flub)(task, toolset, submitted);
};

const measureBounded: FullRunDeps["drive"] = (manifest, options) =>
  measureHarness(manifest, {
    ...options,
    solver: boundedSolver,
    createVerifier: () => fullFakeHost(),
    isolationProbe: () => probeEvidence(true),
    sessionProbe: async () => builtSession(),
    judge: null,
  });

function scriptedDeps(turn: ScriptedTurn): FullRunDeps {
  // One runtime for the run: the Builder conversation keeps its session across rounds.
  const builderRuntime = scriptedBuilderRuntime(turn);
  return {
    ensureDcg: () => guard,
    build: (manifest, options) => buildHarness(manifest, { ...options, builderRuntime }),
    drive: measureBounded,
    analyse: analyseStep,
  };
}

function args(root: string, runId: string, maxIterations: number) {
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
      "2",
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

/** The battery alone: the same six task slots and their bound controls over new public inputs. The
 *  product around them — brief, checks, reference solve, agent — is untouched, which is what makes
 *  the round a task-only experiment. */
function writeBattery(workspace: string, inputs: readonly string[]): void {
  const put = (path: string, value: JsonValue) => writeFileSync(join(workspace, path), JSON.stringify(value));
  put(
    "correctness-model/tasks.json",
    inputs.map((input, index) => ({
      taskId: `t${index}`,
      family: index < 2 ? "first" : "second",
      intendedFeatures: { hiddenChecks: { min: 0, max: 0 } },
      publicInput: { input, length: input.length },
      difficultyAxisPath: "$.length",
      hidden: [],
    })),
  );
  put("correctness-model/controls.json", {
    accept: Array.from({ length: 25 }, (_, i) => ({
      id: `accept-${i}`,
      taskId: `t${i % inputs.length}`,
      artifact: { answer: inputs[i % inputs.length]!.toUpperCase() },
    })),
    reject: Array.from({ length: 25 }, (_, i) => ({
      id: `reject-${i}`,
      taskId: `t${i % inputs.length}`,
      artifact: { answer: "" },
      mutationClass: "hollow",
      expectedCheckId: "answer",
    })),
  });
}

function writeProposal(workspace: string, change: string, verifiedPasses: number): void {
  writeFileSync(
    join(workspace, "EXPERIMENT.json"),
    JSON.stringify({
      scope: "tasks",
      gap: "the measured battery says nothing about inputs the solver has not been asked to uppercase",
      change,
      expectedResult: "fewer verified passes on the same product, from the longer inputs alone",
      target: { comparator: "at-most", verifiedPasses },
    }),
  );
}

/** Round one authors the product; every later round changes only its battery. Each round counts
 *  its turns from one, so `turn === 1` marks the round boundary. */
function climbScript(harder: readonly (readonly string[])[], submits: Accepted[]): ScriptedTurn {
  let round = -1;
  return async (ctx) => {
    if (ctx.turn === 1) round += 1;
    const say = async (note: string) => {
      const result = await ctx.call("submit", {});
      /* SAFETY: the host's submit tool returns this receipt shape on every outcome. */
      submits.push((result as { details: { receipt: Accepted } }).details.receipt);
      return note;
    };
    if (round === 0) {
      uppercaseFixture(ctx.workspace, false, false, TASKS);
      writeBattery(ctx.workspace, EASY);
      return await say("submitted the uppercase bundle");
    }
    const inputs = harder[round - 1] ?? harder.at(-1);
    if (inputs === undefined) throw new Error("the climb script ran out of batteries");
    writeBattery(ctx.workspace, inputs);
    const past = inputs.filter((input) => input.length > CEILING).length;
    writeProposal(ctx.workspace, `lengthen ${past} of the ${TASKS} inputs past two characters`, TASKS - past);
    return await say("submitted a harder battery on the adopted product");
  };
}

const passesOf = (root: string, runId: string): boolean[] => {
  const dir = required(measuredProductDir(root, SLUG, runId), `no product version is bound to ${runId}`);
  return readRecordedBatteryRecord(join(dir, "runs", runId), runId).cases.map((row) => row.pass === true);
};

/** The selector answer each authoring round read, by the round that recorded it. */
function decisionsOf(root: string): Record<string, string> {
  const dir = join(campaignDir(root, SLUG), "difficulty-decisions");
  return Object.fromEntries(
    readdirSync(dir).map((name) => {
      const recorded = parseJsonAs<DifficultyDecisionEvidence>(readFileSync(join(dir, name), "utf8"));
      const { decision } = recorded.difficulty;
      return [recorded.runId, decision.action === "placed" ? decision.placement.zone : decision.action];
    }),
  );
}

/** Every phase row the run recorded, as `phase state` against its count. */
function phaseCensus(root: string): Record<string, number> {
  const dir = join(campaignDir(root, SLUG), "observability");
  const counts = new Map<string, number>();
  for (const name of readdirSync(dir).sort()) {
    for (const line of readFileSync(join(dir, name), "utf8").trim().split("\n")) {
      const row = parseJsonAs<{ type?: string; phase?: string; state?: string }>(line);
      if (row.type !== "phase-transition") continue;
      const key = `${row.phase} ${row.state}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

/** Phase spans the stream opened without recording how they ended, by file, phase and subject. */
function unsettledSpans(root: string): string[] {
  const dir = join(campaignDir(root, SLUG), "observability");
  const depth = new Map<string, number>();
  for (const name of readdirSync(dir).sort()) {
    for (const line of readFileSync(join(dir, name), "utf8").trim().split("\n")) {
      const row = parseJsonAs<{ type?: string; phase?: string; state?: string; subjectId?: string }>(line);
      if (row.type !== "phase-transition") continue;
      const key = `${name} ${row.phase}${row.subjectId === undefined ? "" : ` ${row.subjectId}`}`;
      depth.set(key, (depth.get(key) ?? 0) + (row.state === "started" ? 1 : -1));
    }
  }
  return [...depth].flatMap(([key, open]) => (open > 0 ? [key] : [])).sort();
}

/** What the stream says the controller read before each rebuild, oldest first. */
function climbClaims(root: string): string[] {
  const dir = join(campaignDir(root, SLUG), "observability");
  return readdirSync(dir)
    .sort()
    .flatMap((name) => readFileSync(join(dir, name), "utf8").trim().split("\n"))
    .map((line) => parseJsonAs<{ owner?: string; claim?: string }>(line))
    .filter((row) => row.owner === "climb")
    .map((row) => row.claim ?? "");
}

describe("the climb: one product, three batteries, one fixed competence", () => {
  it("measures a falling pass rate from the tasks alone, and attributes each round to its bytes", async () => {
    const root = scratchRepo();
    const submits: Accepted[] = [];
    const { repoRoot, ...runArgs } = args(root, "climb", 3);
    const outcome = await runFullRun(
      runArgs,
      repoRoot,
      scriptedDeps(climbScript([HARDER, HARDEST], submits)),
    );

    // One authored product, then two rounds that reopen it and keep it.
    expect(outcome.rounds.map((round) => [round.move, round.build, round.promotion])).toEqual([
      ["build", "adopted", null],
      ["rebuild", "candidate", "promoted"],
      ["rebuild", "candidate", "promoted"],
    ]);
    expect(outcome.rounds.map((round) => round.buildClauses)).toEqual([[], [], []]);
    expect(outcome.rounds.map((round) => [round.runId, round.measured])).toEqual([
      ["climb", true],
      ["climb-i02", true],
      ["climb-i03", true],
    ]);
    const batteries = outcome.rounds.map((round) => round.runId);

    // The competence never moved, so every miss is an input past the ceiling and nothing else.
    for (const [index, inputs] of [EASY, HARDER, HARDEST].entries()) {
      const runId = required(batteries[index], `battery ${index}`);
      expect(passesOf(root, runId)).toEqual(inputs.map((input) => input.length <= CEILING));
    }
    // 6 of 6, then 4, then 2 — the whole claim a climb makes.
    expect(batteries.map((runId) => passesOf(root, runId).filter(Boolean).length)).toEqual([6, 4, 2]);

    // Accepted bytes, not the loop's name for the round, decide the attribution: the agent and
    // correctness-model halves of the candidate identity hold across all three, so rounds two and
    // three are task-only experiments however they were labelled.
    expect(submits.map((receipt) => receipt.outcome)).toEqual(["accepted", "accepted", "accepted"]);
    const product = submits.map((receipt) => receipt.candidateId.split("-").slice(0, 2).join("-"));
    expect(new Set(product).size).toBe(1);
    expect(new Set(submits.map((receipt) => receipt.candidateId)).size).toBe(3);

    // Each authoring round read the previous battery's placement, and the answer followed the
    // measurement down: 6 of 6 is significantly too easy, 4 of 6 is inside the band and below its
    // aim. The zone is what the note and the history read; the action only says a placement exists.
    expect(decisionsOf(root)).toEqual({ "climb-i02": "too-easy", "climb-i03": "under-aim" });

    // The same two answers reach the observation stream a live reader watches. It carried the bare
    // word "rebuild" and never the score that rebuild answered, so the run's most consequential
    // decision arrived as a verb with no evidence behind it.
    // The second row reads the changed subset, 0 of 2, not the whole battery's 4 of 6: the same
    // deciding sample the note quotes, so stream and note cannot tell two stories about one battery.
    expect(climbClaims(root)).toEqual([
      "placed: 6/6, Wilson interval [0.610, 1.000] against target range [0.2, 0.5]: significantly too easy",
      "placed: 0/2, Wilson interval [0.000, 0.658] against target range [0.2, 0.5]: in range, below the aim",
    ]);

    // Every span this run opened also settled. Run c1d2a7 opened five build spans and 28 case spans
    // and closed none of them, because only the failure paths closed: a reader of a live stream saw
    // beginnings, no outcomes and no durations, and a closed build step meant the build had failed.
    expect(unsettledSpans(root)).toEqual([]);

    // The census a reviewer reads. `build completed` appears because success closes the span now,
    // `adopt completed` once because only the first round adopted a tree, and `claim completed`
    // three times because each round's verdict on its own battery is a row and not a stderr line.
    // `judge` and `measure-on` are absent by condition: this run disables the Judge and scripts the
    // solver. A phase the enum declares and no row carries reads to the WRI census as a step that
    // never ran, which is why the three producerless names left the enum.
    //
    // `grade deferred` is counted rather than fixed: it is one row per solve that finished while
    // an earlier case was still solving, and how many do that is the pool's scheduling, not this
    // run's shape. Pinning it would make a timing difference read as a defect. Every other phase
    // stays exact, which is what this canary is for.
    const { "grade deferred": heldForTheirTurn = 0, ...census } = phaseCensus(root);
    expect(heldForTheirTurn).toBeLessThanOrEqual(18);
    expect(census).toEqual({
      "admission completed": 3,
      "adopt completed": 1,
      "analyse completed": 3,
      "analyse started": 3,
      "build completed": 3,
      "build started": 3,
      "claim completed": 3,
      "controls completed": 3,
      "controls started": 3,
      "grade completed": 3,
      "grade started": 3,
      "input completed": 1,
      "next completed": 2,
      "solve completed": 3,
      "solve started": 3,
    });

    // The first battery's claim is what a later round compares against, so it must exist and stand.
    const claim = parseJsonAs<{ claim: { ok: boolean } }>(
      readFileSync(join(claimsDirFor(root, SLUG), "climb.json"), "utf8"),
    );
    expect(claim.claim.ok).toBe(true);
  }, 300_000);

  /** The other ending: three batteries the product passes whole, so every placement reads the same
   *  side of the aim and the fourth round stops instead of paying for a fourth. Truss 4c67fc ended
   *  this way on 2026-09-20 and run 662762 the day before, and in both campaigns the placement
   *  that ended the run existed in no difficulty-decisions file: the round guarded the record on
   *  its own move, so the one reading that changed the campaign's course was the one it dropped. */
  it("records the placement a round stopped on, though that round authors nothing", async () => {
    const root = scratchRepo();
    const submits: Accepted[] = [];
    const { repoRoot, ...runArgs } = args(root, "hold", 4);
    const outcome = await runFullRun(
      runArgs,
      repoRoot,
      scriptedDeps(climbScript([EASY_AGAIN, EASY_ONCE_MORE], submits)),
    );

    // Three measured rounds, all 6 of 6, then a round that reads the streak and stops before it
    // opens a session. The stop carries its reason as the round's clause, so nothing authored.
    expect(outcome.rounds.map((round) => [round.move, round.build])).toEqual([
      ["build", "adopted"],
      ["rebuild", "candidate"],
      ["rebuild", "candidate"],
      ["stop", "stopped"],
    ]);
    expect(outcome.rounds.filter((round) => round.measured).map((round) => round.runId)).toEqual([
      "hold",
      "hold-i02",
      "hold-i03",
    ]);
    expect(outcome.rounds.at(-1)?.buildClauses.join(" ")).toContain(
      "3 consecutive rounds ended above the aim",
    );

    // The record the run turns on: every round that read a placement wrote it down, the stopping
    // round included. Its file is the campaign's only durable evidence that the reading happened.
    expect(decisionsOf(root)).toEqual({
      "hold-i02": "too-easy",
      "hold-i03": "too-easy",
      "hold-i04": "too-easy",
    });
  }, 300_000);
});
