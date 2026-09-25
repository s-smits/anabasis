/**
 * The climb across rounds, with no provider. One adopted product is measured four times while a
 * scripted Builder makes only the battery harder, and the solver's competence stays fixed: it
 * uppercases an input of at most two characters and gets a longer one wrong. So the pass rate falls
 * because the tasks moved, which is the whole claim a climb makes; and three batteries in a row
 * below the aim leave the fifth round to the Builder, which opens it and measures a fifth battery.
 *
 * Everything but the two model seats is production: the real selector, the real experiment
 * attribution from accepted bytes, the real census, solvability and adoption path, and the real
 * recorded evidence the next round reads.
 */
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
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

/** One accepted candidate, as the submit receipt names it. */
interface Accepted {
  outcome: string;
  candidateId: string;
}

const PROMPT = "Build a harness that uppercases one public input.";
const TASKS = 6;
const SLUG = slugForDirectInput(PROMPT, EMPTY_USER_CONTEXT.digest);
/** One character past what the scripted solver can uppercase. */
const CEILING = 2;
/** The five batteries in order. The first is within the ceiling throughout, so the product passes it
 *  whole; each later one changes only failing inputs, so its changed subset reads below the aim. */
const BATTERIES = [
  ["a", "ab", "c", "cd", "e", "ef"],
  ["a", "abc", "c", "cd", "e", "efg"],
  ["a", "abc", "cde", "cd", "efg", "ghi"],
  ["a", "bcd", "def", "cd", "fgh", "hij"],
  ["a", "bcd", "def", "cde", "fgh", "hij"],
] as const;

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

/** Round one authors the product; every later round changes only its battery and declares the
 *  experiment. Each round counts its turns from one, so `turn === 1` marks the round boundary. */
function climbScript(submits: Accepted[]): ScriptedTurn {
  let round = -1;
  return async (ctx) => {
    if (ctx.turn === 1) round += 1;
    const inputs = required(BATTERIES[round], `battery for round ${round + 1}`);
    if (round === 0) uppercaseFixture(ctx.workspace, false, false, TASKS);
    writeBattery(ctx.workspace, inputs);
    if (round > 0) {
      const past = inputs.filter((input) => input.length > CEILING).length;
      writeFileSync(
        join(ctx.workspace, "EXPERIMENT.json"),
        JSON.stringify({
          scope: "tasks",
          gap: "the measured battery says nothing about inputs the solver has not been asked to uppercase",
          change: `lengthen ${past} of the ${TASKS} inputs past two characters`,
          ...PLAN_FIELDS,
          expectedResult: "fewer verified passes on the same product, from the longer inputs alone",
          target: { comparator: "at-most", verifiedPasses: TASKS - past },
        }),
      );
    }
    const result = await ctx.call("submit", {});
    /* SAFETY: the host's submit tool returns this receipt shape on every outcome. */
    submits.push((result as { details: { receipt: Accepted } }).details.receipt);
    return "submitted";
  };
}

/** Every observation row the run wrote, file by file in name order. */
function observations(root: string): Array<[string, Record<string, string | undefined>]> {
  const dir = join(campaignDir(root, SLUG), "observability");
  return readdirSync(dir)
    .sort()
    .flatMap((name) =>
      readFileSync(join(dir, name), "utf8")
        .trim()
        .split("\n")
        .map((line): [string, Record<string, string | undefined>] => [name, parseJsonAs(line)]),
    );
}

/** Every phase row the run recorded, as `phase state` against its count, and the spans it opened
 *  without recording how they ended, by file, phase and subject. */
function phases(root: string) {
  const counts = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const [name, row] of observations(root)) {
    if (row.type !== "phase-transition") continue;
    const key = `${row.phase} ${row.state}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const span = `${name} ${row.phase}${row.subjectId === undefined ? "" : ` ${row.subjectId}`}`;
    depth.set(span, (depth.get(span) ?? 0) + (row.state === "started" ? 1 : -1));
  }
  return {
    census: Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))),
    unsettled: [...depth].flatMap(([key, open]) => (open > 0 ? [key] : [])).sort(),
  };
}

/** The selector answer each round read, by the round that recorded it. */
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

// Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
// describe("the climb: one product, four batteries, one fixed competence", () => {
//   it("measures a falling pass rate from the tasks alone, attributes each round to its bytes, and stops on the streak", async () => {
describe("the climb: one product, five batteries, one fixed competence", () => {
  it("measures a falling pass rate from the tasks alone, attributes each round to its bytes, and runs on through the streak", async () => {
    const root = scratchRepo();
    const submits: Accepted[] = [];
    const { repoRoot, ...runArgs } = {
      ...parseFullRunArgs([
        "--prompt",
        PROMPT,
        "--project",
        SLUG,
        "--run",
        "climb",
        "--dcg",
        "false",
        "--max-iterations",
        "5",
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
    // One runtime for the run: the Builder conversation keeps its session across rounds.
    const builderRuntime = scriptedBuilderRuntime(climbScript(submits));
    const outcome = await runFullRun(runArgs, repoRoot, {
      ensureDcg: () => guard,
      build: (manifest, options) => buildHarness(manifest, { ...options, builderRuntime }),
      drive: measureBounded,
      analyse: analyseStep,
    });

    // Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
    // // One authored product, three rounds that reopen and keep it, then a round that reads the
    // // streak and stops before it opens a session, carrying its reason as the round's clause.
    // expect(outcome.rounds.map((round) => [round.move, round.build, round.promotion, round.measured])).toEqual(
    //   [
    //     ["build", "adopted", null, true],
    //     ["rebuild", "candidate", "promoted", true],
    //     ["rebuild", "candidate", "promoted", true],
    //     ["rebuild", "candidate", "promoted", true],
    //     ["stop", "stopped", null, false],
    //   ],
    // );
    // expect(outcome.rounds.slice(0, 4).map((round) => round.buildClause)).toEqual([null, null, null, null]);
    // expect(outcome.terminal).toContain(
    //   "3 consecutive rounds ended below the aim",
    // );
    // const batteries = outcome.rounds.slice(0, 4).map((round) => round.runId);
    // expect(batteries).toEqual(["climb", "climb-i02", "climb-i03", "climb-i04"]);
    // One authored product, then four rounds that reopen and keep it: the fifth reads a streak of
    // three batteries below the aim and still opens its session, because the route is the Builder's.
    expect(outcome.rounds.map((round) => [round.move, round.build, round.promotion, round.measured])).toEqual(
      [
        ["build", "adopted", null, true],
        ["rebuild", "candidate", "promoted", true],
        ["rebuild", "candidate", "promoted", true],
        ["rebuild", "candidate", "promoted", true],
        ["rebuild", "candidate", "promoted", true],
      ],
    );
    expect(outcome.rounds.map((round) => round.buildClause)).toEqual([null, null, null, null, null]);
    const batteries = outcome.rounds.map((round) => round.runId);
    expect(batteries).toEqual(["climb", "climb-i02", "climb-i03", "climb-i04", "climb-i05"]);

    // The competence never moved, so every miss is an input past the ceiling and nothing else:
    // 6 of 6, then 4, then 2, the whole claim a climb makes.
    for (const [index, runId] of batteries.entries()) {
      const dir = required(measuredProductDir(root, SLUG, runId), `no product version is bound to ${runId}`);
      const passes = readRecordedBatteryRecord(join(dir, "runs", runId), runId).cases.map(
        (row) => row.pass === true,
      );
      expect(passes).toEqual(required(BATTERIES[index], runId).map((input) => input.length <= CEILING));
    }

    // Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
    // // Accepted bytes, not the loop's name for the round, decide the attribution: the agent and
    // // correctness-model halves of the candidate identity hold across all four, so every later round
    // // is a task-only experiment however it was labelled.
    // expect(submits.map((receipt) => receipt.outcome)).toEqual([
    //   "accepted",
    //   "accepted",
    //   "accepted",
    //   "accepted",
    // ]);
    // const product = submits.map((receipt) => receipt.candidateId.split("-").slice(0, 2).join("-"));
    // expect(new Set(product).size).toBe(1);
    // expect(new Set(submits.map((receipt) => receipt.candidateId)).size).toBe(4);
    //
    // // Every round that read a placement wrote it down, the stopping round included: its file is
    // // the only durable evidence that the reading which ended the run happened.
    // Accepted bytes, not the loop's name for the round, decide the attribution: the agent and
    // correctness-model halves of the candidate identity hold across all five, so every later round
    // is a task-only experiment however it was labelled.
    expect(submits.map((receipt) => receipt.outcome)).toEqual(Array(5).fill("accepted"));
    const product = submits.map((receipt) => receipt.candidateId.split("-").slice(0, 2).join("-"));
    expect(new Set(product).size).toBe(1);
    expect(new Set(submits.map((receipt) => receipt.candidateId)).size).toBe(5);

    // Every round that read a placement wrote it down, the fifth included.
    expect(decisionsOf(root)).toEqual({
      "climb-i02": "too-easy",
      "climb-i03": "under-aim",
      "climb-i04": "under-aim",
      "climb-i05": "under-aim",
    });

    // The same answers reach the observation stream a live reader watches, with the score each
    // answered. A task-only round reads its changed subset (0 of 2, not 4 of 6): the deciding
    // sample the note quotes, so stream and note cannot tell two stories about one battery.
    const climb = observations(root).flatMap(([, row]) => (row.owner === "climb" ? [row.claim] : []));
    expect(climb.slice(0, 2)).toEqual([
      "placed: 6/6, Wilson interval [0.610, 1.000] against target range [0.2, 0.5]: significantly too easy",
      "placed: 0/2, Wilson interval [0.000, 0.658] against target range [0.2, 0.5]: in range, below the aim",
    ]);

    // Every span the run opened also settled, success included: a reader of a live stream sees an
    // outcome and a duration for each beginning. The census is exact except `grade deferred`, one
    // row per solve that finished while an earlier case was still solving — the pool's scheduling,
    // not the run's shape. `judge` and `measure-on` are absent because the Judge is off and the
    // Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
    // // solver scripted. Four rounds build and measure; the stopping round records its build as failed
    // // before any session opens, and only the first round adopts a tree.
    // const { census, unsettled } = phases(root);
    // expect(unsettled).toEqual([]);
    // const { "grade deferred": heldForTheirTurn = 0, ...exact } = census;
    // expect(heldForTheirTurn).toBeLessThanOrEqual(24);
    // expect(exact).toEqual({
    //   "admission completed": 4,
    //   "adopt completed": 1,
    //   "analyse completed": 4,
    //   "analyse started": 4,
    //   "build completed": 4,
    //   "build failed": 1,
    //   "build started": 4,
    //   "claim completed": 4,
    //   "controls completed": 4,
    //   "controls started": 4,
    //   "grade completed": 4,
    //   "grade started": 4,
    //   "input completed": 1,
    //   "next completed": 3,
    //   "solve completed": 4,
    //   "solve started": 4,
    // });
    // solver scripted. All five rounds build and measure, and only the first adopts a tree.
    const { census, unsettled } = phases(root);
    expect(unsettled).toEqual([]);
    const { "grade deferred": heldForTheirTurn = 0, ...exact } = census;
    expect(heldForTheirTurn).toBeLessThanOrEqual(30);
    expect(exact).toEqual({
      "admission completed": 5,
      "adopt completed": 1,
      "analyse completed": 5,
      "analyse started": 5,
      "build completed": 5,
      "build started": 5,
      "claim completed": 5,
      "controls completed": 5,
      "controls started": 5,
      "grade completed": 5,
      "grade started": 5,
      "input completed": 1,
      "next completed": 4,
      "solve completed": 5,
      "solve started": 5,
    });

    // The first battery's claim is what a later round compares against, so it must exist and stand.
    const claim = parseJsonAs<{ claim: { ok: boolean } }>(
      readFileSync(join(claimsDirFor(root, SLUG), "climb.json"), "utf8"),
    );
    expect(claim.claim.ok).toBe(true);
  }, 300_000);
});
