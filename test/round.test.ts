// One round on stand-ins: the real session on the faux provider with a host write for the walled
// one, and solves that end as a table says. What is under test is the order of a round, which
// solves it counts and which it makes, what it leaves out of a comparison, its cap, and its reading.
// A lone retained loss no longer regresses: buffer-pr197-opus-m1, 18 October 2026.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { passesIn, predicted, swapped, toLabel } from "../src/builder/comparison.ts";
import {
  type CheckpointRequest,
  checkpoint,
  type RoundRequest,
  refuseTerms,
  round,
  scoredSet,
  settleReading,
} from "../src/builder/round.ts";
import {
  type BuildRequest,
  type Built,
  type Practised,
  session,
  sessionOnce,
  spent,
} from "../src/builder/session.ts";
import type { Bench } from "../src/builder/tools.ts";
import { type Condition, recordCondition, settingId } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { latestBuilt, poolOf, stopRule } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { ranUnder } from "../src/kernel/solves.ts";
import { taskStates } from "../src/kernel/task.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import type { RefereeFinding, Ruling } from "../src/review/referee.ts";
import { text, tool } from "../src/solve/answer.ts";
import { openHarness } from "../src/solve/harness.ts";
import { roundSolves } from "./helpers/logged-round.ts";
import { tallied } from "./helpers/tally.ts";

const COMPARISON_REPORTED = "comparison.reported";
const COMPARISON_STARTED = "comparison.started";
/** What a report holds of the comparison read at one budget, here one in turns. */
const TASK_STATE = "task.state";
/** What a stand-in solve throws to stop a run part-way. */
const STOPS = "the run stops";

type Side = "old" | "fresh" | "starter";
/** How a solve ended, with what it used where a case reads that. */
interface Used {
  readonly ending: Ending;
  readonly turns?: number;
  /** What the verifier measured of a valid answer, where the check program has an objective. */
  readonly objective?: number;
}
/** How a solve of `version` under a harness ends, by how many came before it. A table that tells
 *  two new harnesses apart reads the digest. */
type Table = (version: string, side: Side, nth: number, digest: string) => Ending | Used;

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const CONTRACT: Contract = {
  answerFormat: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  conventions: "",
  rules: [{ id: "R1", statement: "The answer is the base times six." }],
  scope: "Fixture.",
};
const LIMITS = {
  wallSeconds: 600,
  turns: 12,
  shellDefaultSeconds: 30,
  shellMaxSeconds: 60,
  concurrency: 1,
  practiceSolves: 3,
};
const HELD = ["s1", "s2", "s3", "s4"];
/** The family each task is proposed in: s3, s4 and s5 are the second, so that no four of the five
 *  untie in one family. */
const FAMILIES = new Map([
  ["p1", "f1"],
  ["s1", "f1"],
  ["s2", "f1"],
]);
const PASS: Ending = { outcome: "pass" };
/** An answer a check rejected: what a reviewer or a person rules on. */
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
/** A solve that reached its limits with no answer: not valid, and nothing for anyone to rule on. */
const LATE: Ending = { outcome: "fail", kind: "wall-ended" };
/** A solve that ended by itself with no answer, its limits not reached. */
const UNANSWERED: Ending = { outcome: "fail", kind: "no-answer" };
/** What the stand-in bills a solve. */
const BILLED = 2;
const NOT_SCORED = "not-scored";
const NO_STEP = "no-step";
/** A solve a login at its session limit turned away, after its reruns. */
const LIMITED: Ending = { outcome: "non-result", kind: "provider", reason: "You've hit your session limit" };
/** Two tasks' solves in the order a comparison of two solves a side starts them: each task's
 *  first harness in turn mirrored, and the next task's the other way round. */
const MIRRORED: Side[] = ["old", "fresh", "fresh", "old", "fresh", "old", "old", "fresh"];
const scratches: string[] = [];
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const edit = call("write", { path: "harness/agent/BUILT_AGENTS.md", content: "Multiply first.\n" });
const again = call("write", {
  path: "harness/agent/BUILT_AGENTS.md",
  content: "Multiply first, then check.\n",
});
const third = call("write", { path: "harness/agent/BUILT_AGENTS.md", content: "Third.\n" });
const finish = call("finish", { note: "A shorter guide." });

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/**
 * A scratch with the fixture harness as the reference harness and the Builder's parent, as a
 * campaign stands after a promotion, the same harness under another guide as the starter, and a
 * log in which p1 is released for practice and s1 to s5 are held out. A case of the plan's first
 * round names the starter as both. `responses` are the Builder's turns; `table` ends the solves.
 */
async function setup(responses: FauxResponseStep[], table: Table) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-round-")));
  scratches.push(scratch);
  const parent = join(scratch, "parent");
  const lesser = join(scratch, "starter");
  const log = join(scratch, "log.jsonl");
  cpSync(FIXTURE, parent, { recursive: true });
  cpSync(FIXTURE, lesser, { recursive: true });
  writeFileSync(join(lesser, "agent", "BUILT_AGENTS.md"), "No guide.\n");
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  for (const version of ["p1", ...HELD, "s5"]) {
    record("task.proposed", { version, family: FAMILIES.get(version) ?? "f2" });
    record("task.gate", gatePassed(version));
  }
  record(TASK_STATE, { version: "p1", state: "released" });
  /** The host's code as a condition names it, which an edit between two rounds moves. */
  const code = { value: "h1" };
  const old = (await openHarness(parent)).digest;
  const starter = { dir: lesser, digest: (await openHarness(lesser)).digest };
  const condition = (task: string, harness: string): Condition => ({
    contract: "c1",
    harness,
    task,
    model: "faux/faux-solver",
    effort: "medium",
    prices: { "faux/faux-solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    runtime: {},
    compaction: "off",
    solverTools: harness,
    verifierTools: "t1",
    sandbox: "p1",
    limits: LIMITS,
    host: code.value,
    side: "test",
  });
  const sideOf = (digest: string): Side =>
    digest === old ? "old" : digest === starter.digest ? "starter" : "fresh";
  /** Every solve asked for, in order. */
  const asked: { version: string; side: Side }[] = [];
  const counts = new Map<string, number>();
  const solve = async (version: string, digest: string, comparison?: string): Promise<Practised> => {
    const side = sideOf(digest);
    const key = `${version} ${digest}`;
    const nth = counts.get(key) ?? 0;
    counts.set(key, nth + 1);
    asked.push({ version, side });
    const ended = table(version, side, nth, digest);
    const { ending, turns = 10, objective }: Used = "ending" in ended ? ended : { ending: ended };
    const id = `r-${String(asked.length)}-${String(read(log).length)}`;
    record("solve.started", {
      solve: id,
      condition: recordCondition(log, condition(version, digest)),
      ...keyIfDefined("comparison", comparison),
    });
    if (ending === PASS) {
      record("verdict", {
        solve: id,
        task: version,
        kind: "pass",
        answer: { answer: "42" },
        ...keyIfDefined("objective", objective),
      });
    }
    if (ending === REJECTED) {
      const answer = { answer: "41" };
      record("verdict", { solve: id, task: version, kind: "fail", answer, blocking: ["check-a"] });
    }
    // What the provider wrote for the solve: nothing, when it turned the solve away.
    const output = ending === LIMITED ? 0 : 900;
    record("solve.finished", { solve: id, ending, tokens: { output }, turns, billed: BILLED, seconds: 60 });
    return { solve: id, ending };
  };
  const faux = fauxProvider({
    models: [
      {
        id: "faux-builder",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const build: BuildRequest = {
    id: "b-1",
    parent,
    reference: starter.dir,
    states: join(scratch, "states"),
    memory: join(scratch, "memory"),
    tasks: [{ version: "p1", task: { taskId: "t-p1", family: "fixture", publicInput: { base: 7 } } }],
    contract: CONTRACT,
    resources: [],
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    solve: { ...LIMITS, wallSeconds: 480 },
    solver: { model: "faux/solver", effort: "high" },
    models: () => models,
    log,
    repoRoot: scratch,
    practise: async (task, _dir, digest) => solve(task.version, digest),
  };
  /** pi's walled write, stood in for: the same tool name and paths, writing as the host. */
  const walled = (bench: Bench) => [
    tool({
      name: "write",
      label: "write",
      description: "Writes a file in the home.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, args) => {
        const file = join(bench.home, args.path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, args.content);
        return text("Wrote it.");
      },
    }),
  ];
  let sessions = 0;
  const builder = async (request: BuildRequest): Promise<Built> => {
    sessions += 1;
    const home = join(scratch, `home-${String(sessions)}`);
    const host = join(scratch, `host-${String(sessions)}`);
    mkdirSync(home);
    mkdirSync(host);
    return await session(request, { home, host }, walled);
  };
  const request: RoundRequest = {
    session: build,
    builder,
    reference: { dir: parent, digest: old },
    starter,
    tasks: HELD,
    retained: [],
    // Read when a round is asked for, so that a test that moves the host's code moves this too.
    get setting() {
      return settingId(condition("any", "any"));
    },
    solves: 2,
    level: 0.1,
    defects: 3,
    concurrency: 1,
    solve: (version, harness, comparison) => solve(version, harness.digest, comparison),
  };
  const of = (kind: EventKind) =>
    read(log)
      .filter((event) => event.kind === kind)
      .map(({ data }) => data);
  /** The round's finished solves. */
  const solved = () => of("solve.finished").filter(({ solve: id }) => isString(id) && id.startsWith("r-"));
  /** The same round under another session id, its session starting from `from` when one is named. */
  const next = (id: string, from = parent): RoundRequest => ({
    ...request,
    setting: request.setting,
    session: { ...build, id, parent: from },
  });
  /** A comparison with no session, of the starter against the reference harness unless told. */
  const compare = (id: string, more: Partial<CheckpointRequest> = {}): CheckpointRequest => {
    const { session: _session, builder: _builder, reference, ...terms } = request;
    return { ...terms, setting: request.setting, log, id, old: reference, fresh: starter, ...more };
  };
  return {
    request,
    next,
    compare,
    solve,
    log,
    old,
    parent,
    starter,
    asked,
    of,
    solved,
    code,
    sessions: () => sessions,
  };
}

/** The new harness answers every task within its limits, and the reference harness and the
 *  starter none: the plan's own case, a valid answer against no answer, which needs no ruling. */
const step: Table = (_version, side) => (side === "fresh" ? PASS : LATE);
/** The same with an answer a check rejects where there was none, which someone has to rule on. */
const rejecting: Table = (_version, side) => (side === "fresh" ? PASS : side === "old" ? REJECTED : LATE);

/** A task's first gate passed, as the log holds it. */
const gatePassed = (version: string) => ({ version, gate: 1, outcome: "passed" });

/** Whether a round stopped, task by task, at the first solve of the last task it reached: the
 *  third of three in a row that had no solve run (`SILENT`, `round.ts`). */
const stoppedAtFirst = (asked: readonly { readonly version: string }[]) => {
  const last = asked.at(-1)?.version;
  return asked.filter(({ version }) => version === last).length === 1;
};

/** A Referee that logs its rulings as `src/review/referee.ts` does: `ruled` names the tasks it
 *  rules otherwise than earned. */
const referee =
  (log: string, ruled: Readonly<Record<string, Ruling>> = {}) =>
  async (solve: string, version: string): Promise<RefereeFinding> => {
    const ruling = ruled[version] ?? "earned";
    append(log, "referee.finding", { solve, ruling });
    return {
      ruling,
      check: ruling === "earned" ? null : "check-7",
      rule: "R1",
      field: "answer",
      reason: "r",
      probes: [],
    };
  };

describe("a round", () => {
  it("runs the session, then solves the reference and the new harness in turn on every task, and reports what it compared", async () => {
    const s = await setup([edit, finish], step);
    const report = await round(s.request);
    expect(report.fresh).not.toBe(s.old);
    const tested = { wins: 4, losses: 0, ties: 0, p: 0.0625 };
    const began = read(s.log).findIndex(({ kind }) => kind === COMPARISON_STARTED);
    expect(s.of(COMPARISON_REPORTED)).toEqual([
      {
        session: "b-1",
        tasks: 4,
        solves: 2,
        level: 0.1,
        setting: s.request.setting,
        broken: null,
        reviewFaults: [],
        old: s.old,
        fresh: report.fresh,
        starter: s.starter.digest,
        // Each task won by two pairs for each valid answer more, of the four a side's two solves make.
        scored: { ...tested, differences: [4, 4, 4, 4], unsolved: 0 },
        // Nothing is exhausted yet, so every task is on the frontier, where the step is read, and
        // the retained set is unmeasured: four untied tasks detect a harness that wins 95% of
        // them, four times in five, and an attempt at their margins promotes equal harnesses 5 in 256.
        frontier: {
          ...tested,
          tasks: HELD,
          aside: [],
          differences: [4, 4, 4, 4],
          of: HELD,
          detectable: 0.95,
          falseRate: 1 / 16,
        },
        retained: "unmeasured",
        // Each family's tallies, from the same rows, sum to the whole.
        families: {
          f1: { frontier: { wins: 2, losses: 0, ties: 0 }, retained: { wins: 0, losses: 0, ties: 0 } },
          f2: { frontier: { wins: 2, losses: 0, ties: 0 }, retained: { wins: 0, losses: 0, ties: 0 } },
        },
        overlap: null,
        // Each harness by itself: the reference answered no task validly, the new one all, twice.
        // Every task is informative for the reference: a valid answer to each is on record, the
        // new harness's, so the reference's failing them is room (`informative`, 15 October).
        valid: { old: [4, 0, 0], fresh: [0, 0, 4], informative: { old: 4, fresh: 0 } },
        billed: { old: BILLED, fresh: BILLED },
        noise: null,
        counted: null,
        objective: null,
        // The turns each harness's valid answers took, by task: in no tally.
        turns: Object.fromEntries(HELD.map((task) => [task, { old: null, fresh: 10 }])),
        versions: HELD,
        disputed: [],
        aside: [],
        short: [],
        flagged: [],
        withdrawn: [],
        capped: false,
        reading: "step",
        // Until a person answers the comparison's packet, which no promotion waits for.
        settled: "unsettled",
        // The cost bar, read and gating nothing (the plan's W): this comparison the first attempt
        // of set-up's epoch.
        worth: {
          bars: { cost: 3 },
          cost: { attempts: 1, sessions: 1, dollars: expect.any(Number), met: true },
        },
      },
    ]);
    // Four tasks, two harnesses, two solves. A task's solves run together, so that what drifts
    // over the comparison's hours falls between tasks, which the test does not read; within a
    // task the harness that goes first is mirrored, and from one task to the next. The starter is
    // solved on none: until 2026-10-11 a step was held to it on the tallied tasks.
    expect(s.asked.map(({ side }) => side)).toEqual(Array(2).fill(MIRRORED).flat());
    const runs = Array.from({ length: 4 }, (_, at) => s.asked.slice(4 * at, 4 * at + 4));
    expect(runs.every((run) => run.every(({ version }) => version === run[0]?.version))).toBe(true);
    expect(new Set(runs.map((run) => run[0]?.version))).toEqual(new Set(HELD));
    expect(s.asked.some(({ side }) => side === "starter")).toBe(false);
    expect(s.of("build.started")[0]).toMatchObject({ tasks: ["p1"] });
    // What it compares was on record before its first solve: the harnesses, the terms and the tasks.
    expect(s.of(COMPARISON_STARTED)).toEqual([
      {
        session: "b-1",
        old: s.old,
        fresh: report.fresh,
        starter: s.starter.digest,
        setting: s.request.setting,
        solves: 2,
        level: 0.1,
        cap: null,
        tasks: HELD,
        retained: [],
      },
    ]);
    const kinds = read(s.log).map(({ kind }) => kind);
    // After the session's own practice, and before any solve of a held-out task.
    expect(began).toBeGreaterThan(kinds.indexOf("build.finished"));
    expect(kinds.slice(began).filter((kind) => kind === "solve.started")).toHaveLength(16);
    expect(latestBuilt(read(s.log))).toBe(report.fresh);
    expect(stopRule(read(s.log))).toEqual({ checkpoints: 1, sinceStep: 0, stop: false });
    // The comparison moved no task: every scored task is held out still.
    expect(HELD.map((version) => taskStates(read(s.log)).get(version))).toEqual(Array(4).fill("held"));
    // Run again, a finished round says what it said: no session, no solve, no second report.
    expect(await round(s.request)).toEqual(report);
    expect(s.sessions()).toBe(1);
    expect(s.asked).toHaveLength(16);
    expect(s.of(COMPARISON_REPORTED)).toHaveLength(1);
  });

  it("calls two valid answers even, counts a solver's flag as its side's fail, and reports the turns of each valid answer in no test", async () => {
    {
      // v1's batteries mostly passed whole. Nothing here weighs one valid answer against another: no
      // objective is built until validity is seen to leave too many ties.
      const s = await setup([edit, finish], (version) => (version === "s1" ? LATE : PASS));
      expect(await round(s.request)).toMatchObject({
        // Three ties between valid answers, and one on a task no harness answered.
        scored: { wins: 0, losses: 0, ties: 4, p: 1, unsolved: 1 },
        reading: NO_STEP,
      });
      expect(s.asked).toHaveLength(16);
    }
    {
      const FLAG: Ending = { outcome: "flagged", reason: "the task is malformed" };
      // The new harness answers s2 to s4, which the reference fails, and fails s1, which the
      // reference answers.
      const against =
        (s1: Ending): Table =>
        (version, side) => {
          if (version === "s1") return side === "fresh" ? s1 : PASS;
          return side === "fresh" ? PASS : LATE;
        };
      const lost = await round((await setup([edit, finish], against(LATE))).request);
      expect(lost).toMatchObject({ scored: { wins: 3, losses: 1 }, short: [], flagged: [] });
      // Flagged in place of failed, s1 is lost all the same, and the report names it apart.
      expect(await round((await setup([edit, finish], against(FLAG))).request)).toMatchObject({
        scored: lost.scored,
        versions: lost.versions,
        short: [],
        flagged: ["s1"],
      });
      // A task both sides flag costs neither: it ties.
      const both = await setup([edit, finish], (version, side) =>
        version === "s1" ? FLAG : side === "fresh" ? PASS : LATE,
      );
      expect(await round(both.request)).toMatchObject({
        scored: { wins: 3, losses: 0, ties: 1 },
        flagged: ["s1"],
      });
    }
    {
      // The same validity twice, the new harness's answers taking 4 turns in one run and 20 in the other.
      const run = async (fast: number) => {
        const s = await setup([edit, finish], (version, side) =>
          version === "s1" ? LATE : { ending: PASS, turns: side === "fresh" ? fast : 12 },
        );
        return await round(s.request);
      };
      const [quick, slow] = [await run(4), await run(20)];
      const tested = ({ scored, frontier, noise, reading }: typeof quick) => ({
        scored,
        frontier,
        noise,
        reading,
      });
      expect(tested(quick)).toEqual(tested(slow));
      expect(quick.turns).toMatchObject({ s1: { old: null, fresh: null }, s2: { old: 12, fresh: 4 } });
      expect(slow.turns).toMatchObject({ s2: { old: 12, fresh: 20 } });
    }
  });

  it("sets two valid answers apart by the objective the comparison fixed, and says how many it decided", async () => {
    // Every solve but s1's is valid under both harnesses. The new harness's answers are lighter on
    // s2 and s3, the same on s4 within a billionth, and s1 nobody answers.
    const mass = (version: string, side: Side): number =>
      (side === "fresh" ? { s2: 8, s3: 9, s4: 10 + 1e-10 }[version] : 10) ?? 10;
    const s = await setup([edit, finish], (version, side) =>
      version === "s1" ? LATE : { ending: PASS, objective: mass(version, side) },
    );
    const objective = { direction: "lower" } as const;
    expect(await round({ ...s.request, objective })).toMatchObject({
      scored: { wins: 2, losses: 0, ties: 2, p: 0.25, unsolved: 1 },
      objective: { ...objective, decided: 2 },
      reading: NO_STEP,
    });
    // The rule is a term of the comparison, fixed at its start, and the report carries it with
    // the count, so a reader of the report pairs as the comparison did.
    expect(s.of(COMPARISON_STARTED)[0]).toMatchObject({ objective });
    expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ objective: { ...objective, decided: 2 } });
  });

  it("solves both harnesses afresh at every comparison, to the same reading at four solves side by side", async () => {
    {
      // The reference harness answers s1 in its first two solves and never again.
      const s = await setup([edit, finish, again, finish], (version, side, nth) =>
        version === "s1" && side === "old" && nth >= 2 ? LATE : PASS,
      );
      expect(await round(s.request)).toMatchObject({ scored: { wins: 0, ties: 4 } });
      // A second round from the same parent solves the reference harness again, beside its own child,
      // and reads those solves: the two that answered s1 are the first comparison's.
      const two = await round(s.next("b-2"));
      expect(two).toMatchObject({ scored: { wins: 1, losses: 0, ties: 3 }, reading: NO_STEP });
      expect(s.asked).toHaveLength(32);
      expect(s.asked.slice(16).filter(({ side }) => side === "old")).toHaveLength(8);
      // Each round stays what it reported, whatever was solved since.
      expect(await round(s.next("b-2"))).toEqual(two);
      expect(s.sessions()).toBe(2);
    }
    {
      const s = await setup([edit, finish], step);
      const report = await round({ ...s.request, concurrency: 4 });
      expect(report).toMatchObject({
        scored: { wins: 4, losses: 0, ties: 0 },
        short: [],
        reading: "step",
      });
      expect(s.asked).toHaveLength(16);
      expect(s.solved()).toHaveLength(16);
    }
  });

  it("compares with the reference harness whatever harness the session started from, and reports no change, solving nothing, where the session left its parent or a harness no solve could open", async () => {
    {
      const original = readFileSync(join(FIXTURE, "agent", "BUILT_AGENTS.md"), "utf8");
      const back = call("write", { path: "harness/agent/BUILT_AGENTS.md", content: original });
      const s = await setup([edit, finish, again, finish, back, finish], () => PASS);
      const one = await round(s.request);
      // The Builder goes on from its latest harness, and the comparison is against the first.
      const latest = join(s.request.session.states, one.fresh ?? "");
      const two = await round(s.next("b-2", latest));
      expect(two.old).toBe(s.old);
      expect(two.fresh).not.toBe(one.fresh);
      expect(s.of("build.started")[1]).toMatchObject({ parent: one.fresh });
      expect(latestBuilt(read(s.log))).toBe(two.fresh);
      // A session that leaves the reference harness itself has left nothing to compare it with.
      const three = await round(s.next("b-3", join(s.request.session.states, two.fresh ?? "")));
      expect(three).toMatchObject({ old: s.old, fresh: null, scored: null, reading: "no-change" });
      expect(s.asked).toHaveLength(32);
    }
    {
      const s = await setup([finish], step);
      expect(await round(s.request)).toMatchObject({ fresh: null, scored: null, reading: "no-change" });
      expect(s.asked).toEqual([]);
      expect(s.of(COMPARISON_REPORTED)).toMatchObject([
        { session: "b-1", old: s.old, fresh: null, scored: null, broken: null, reading: "no-change" },
      ]);
    }
    {
      const s = await setup(
        // The first finish says the harness does not open, once; the second ends the session so.
        [call("write", { path: "harness/agent/tools-spec.json", content: "{}" }), finish, finish],
        step,
      );
      expect(await round(s.request)).toMatchObject({ fresh: null, reading: "no-change" });
      expect(JSON.stringify(s.of(COMPARISON_REPORTED)[0]?.broken)).toContain(
        "agent/tools-spec.json needs presets",
      );
      expect(s.asked).toEqual([]);
    }
  });

  it("goes on from its log with the tasks and the terms it began with: no second session, only the solves it lacks, and other terms refused under its id", async () => {
    {
      let stop = 10;
      const s = await setup([edit, finish], (version, side, nth, digest) => {
        stop -= 1;
        if (stop === 0) throw new Error(STOPS);
        return step(version, side, nth, digest);
      });
      await expect(round(s.request)).rejects.toThrow(STOPS);
      // Its solves so far were made for two solves a side and no cap.
      await expect(round({ ...s.request, solves: 3 })).rejects.toThrow(
        "comparison b-1 began on other terms (solves), and its solves so far were made for those",
      );
      await expect(round({ ...s.request, cap: { dollars: 500, reserve: 10 } })).rejects.toThrow(
        "other terms (cap)",
      );
      await expect(round({ ...s.request, level: 0.05 })).rejects.toThrow("other terms (level)");
      // It began with no objective, and its pairs were read on validity alone.
      await expect(round({ ...s.request, objective: { direction: "lower" } })).rejects.toThrow(
        "other terms (objective)",
      );
      // A term the start recorded and a continuation drops has moved too.
      let left = 10;
      const t = await setup([edit, finish], (version, side, nth, digest) => {
        left -= 1;
        if (left === 0) throw new Error(STOPS);
        return step(version, side, nth, digest);
      });
      const objective = { direction: "lower" } as const;
      await expect(round({ ...t.request, objective, prediction: "a step" })).rejects.toThrow(STOPS);
      await expect(round(t.request)).rejects.toThrow("other terms (objective, prediction)");
      // It began with no prediction, and takes none now that some of its solves can be seen.
      await expect(round({ ...s.request, prediction: "a step, 4 to 0" })).rejects.toThrow(
        "other terms (prediction)",
      );
      // Asked again with a longer list, it scores the tasks it began with: the set was fixed before
      // any result could be seen.
      const report = await round({ ...s.request, tasks: [...HELD, "s5"] });
      expect(report).toMatchObject({ versions: HELD, scored: { wins: 4 }, reading: "step" });
      expect(s.asked.some(({ version }) => version === "s5")).toBe(false);
      expect(s.of(COMPARISON_STARTED)).toHaveLength(1);
      expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ tasks: 4 });
    }
    {
      let stop = 10;
      const s = await setup([edit, finish], (version, side, nth, digest) => {
        stop -= 1;
        if (stop === 0) throw new Error("the verifier could not decide s2, so the run stops");
        return step(version, side, nth, digest);
      });
      await expect(round(s.request)).rejects.toThrow("the verifier could not decide s2");
      expect(s.of(COMPARISON_REPORTED)).toEqual([]);
      expect(spent(read(s.log), "b-1")).toBeNull();
      const before = s.asked.length;
      expect(before).toBe(10);
      const report = await round(s.request);
      expect(report).toMatchObject({ scored: { wins: 4, losses: 0 }, reading: "step" });
      expect(s.sessions()).toBe(1);
      expect(s.of("build.started")).toHaveLength(1);
      // Nine solves were counted before the stop: seven of the sixteen were left.
      expect(s.asked.slice(before)).toHaveLength(7);
    }
  });

  it("sets a task aside on a rejection not ruled a true fail, and leaves out one whose check could not run", async () => {
    const s = await setup([edit, finish], (version, side, nth, digest) => {
      if (version === "s2" && side === "fresh") {
        return { outcome: "non-result", kind: "check", reason: "check-9: threw" };
      }
      // The reference harness runs to its limits on s4: nothing for anyone to recompute.
      if (version === "s4" && side === "old") return LATE;
      return rejecting(version, side, nth, digest);
    });
    const refereed: string[] = [];
    const ruled = referee(s.log, { s1: "check-defect" });
    const failedOnce = new Set<string>();
    const reading = async (solve: string, version: string): Promise<RefereeFinding> => {
      refereed.push(version);
      if (version === "s3" && !failedOnce.has(solve)) {
        failedOnce.add(solve);
        throw new Error("the reader failed");
      }
      return await ruled(solve, version);
    };
    const report = await round({ ...s.request, referee: reading });
    // s2's check could not run and s1's rejections are ruled a check defect. s3's reader failed
    // once on each, and each was put to it again before the report and ruled earned. Two tasks
    // are left, which no sign test at 0.10 can pass.
    expect(report).toMatchObject({
      scored: { wins: 2, losses: 0, p: 0.25 },
      // Were the rejections of s1 to stand, the new harness would have won that as well.
      counted: { wins: 3, losses: 0, p: 0.125 },
      versions: ["s3", "s4"],
      disputed: ["s2"],
      aside: ["s1"],
      reading: NO_STEP,
    });
    // Only the task whose check could not run is disputed for good. A ruling sets a task aside for
    // this comparison, and a person decides what becomes of it.
    const states = taskStates(read(s.log));
    expect([states.get("s1"), states.get("s2"), states.get("s3")]).toEqual(["held", "disputed", "held"]);
    expect(s.of(TASK_STATE).filter(({ state }) => state === "disputed")).toMatchObject([
      { version: "s2", reason: "its own check could not run on an answer" },
    ]);
    // A disputed task is solved no further: the new harness's solve of s2 whose check could not run
    // is its last, and its only one, whichever harness the slot put first.
    const disputed = s.asked.filter(({ version }) => version === "s2");
    expect(disputed.at(-1)).toEqual({ version: "s2", side: "fresh" });
    expect(disputed.filter(({ side }) => side === "fresh")).toHaveLength(1);
    // Only a rejected answer is read: the two of s1 and of s3, s3's twice, and neither of s4's
    // late solves; and the reference's of s2 where it ran before the dispute.
    expect(refereed.filter((version) => version !== "s2").toSorted()).toEqual([
      "s1",
      "s1",
      "s3",
      "s3",
      "s3",
      "s3",
    ]);
    expect(refereed.filter((version) => version === "s2")).toHaveLength(disputed.length - 1);
    expect(s.of(COMPARISON_REPORTED)[0]?.reviewFaults).toHaveLength(2);
  });

  it("puts a rejection the Referee gave no answer on to it again, and stops before the report while one has none", async () => {
    // buffer-a's g-5 (12 October): a Referee call the provider's session limit cut was logged
    // unclear, set a won task aside in the report, and no later run put it again.
    /** A Referee that gives no answer, logged as `src/review/referee.ts` logs one. */
    const silent =
      (log: string) =>
      async (solve: string): Promise<RefereeFinding> => {
        append(log, "referee.finding", { solve, ruling: null, error: "the session limit is reached" });
        return { ruling: null, check: null, rule: null, field: null, reason: "r", probes: [] };
      };
    // Silent on each rejection the first time it is asked: each is asked again before the report,
    // and the step is read on all four tasks.
    const s = await setup([edit, finish], rejecting);
    const asked = new Set<string>();
    const once = async (solve: string, version: string): Promise<RefereeFinding> => {
      if (asked.has(solve)) return await referee(s.log)(solve, version);
      asked.add(solve);
      return await silent(s.log)(solve);
    };
    expect(await round({ ...s.request, referee: once })).toMatchObject({
      scored: { wins: 4, losses: 0 },
      aside: [],
      versions: HELD,
    });
    // The reference's eight rejections, two a task, each asked twice.
    expect(asked.size).toBe(8);
    // Silent every time: the comparison stops with no report, goes on from its log, asks again,
    // and reads the step once the Referee answers.
    const t = await setup([edit, finish], rejecting);
    await expect(round({ ...t.request, referee: silent(t.log) })).rejects.toThrow(
      "the Referee gave no ruling on",
    );
    expect(t.of(COMPARISON_REPORTED)).toEqual([]);
    expect(await round({ ...t.request, referee: referee(t.log) })).toMatchObject({
      scored: { wins: 4, losses: 0 },
      aside: [],
    });
  });

  it("sets every rejection aside where no reviewer is seated, which reads not scored and is no test that found no gain, and reads it once a person has labelled them", async () => {
    {
      // The plan's first round is read this way: hand labels stand in for the Judge.
      const s = await setup([edit, finish], rejecting);
      const report = await round(s.request);
      expect(report).toMatchObject({
        scored: { wins: 0, losses: 0, ties: 0, p: 1 },
        counted: { wins: 4, losses: 0, p: 0.0625 },
        versions: [],
        aside: HELD,
        reading: NOT_SCORED,
      });
      expect(s.asked).toHaveLength(16);
      const asked = toLabel(read(s.log), "b-1");
      expect(asked.aside).toHaveLength(8);
      expect(asked.others).toEqual([]);
      const settled = settleReading(
        s.log,
        "b-1",
        new Map(asked.aside.map((solve) => [solve, "earned"] as const)),
      );
      // The labels restore every task, and the test clears its level: a settling makes no solve.
      expect(settled).toMatchObject({
        scored: { wins: 4, losses: 0 },
        counted: null,
        versions: HELD,
        aside: [],
        reading: "step",
        settled: { labelled: 8, defects: 0, disputed: [], restored: HELD },
      });
      expect(s.asked).toHaveLength(16);
      // The new harness is then compared with the starter in a comparison of its own.
      const fresh = { dir: join(s.request.session.states, settled.fresh ?? ""), digest: settled.fresh ?? "" };
      expect(await checkpoint(s.compare("g5", { old: s.starter, fresh }))).toMatchObject({
        scored: { wins: 4, losses: 0 },
        reading: "step",
      });
    }
    {
      const s = await setup([edit, finish], rejecting);
      const report = await round(s.request);
      expect(report).toMatchObject({ scored: { wins: 0, losses: 0, ties: 0, p: 1 }, versions: [] });
      expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ tasks: 4, reading: NOT_SCORED });
      // It tallied nothing, and is no checkpoint of the stop rule.
      expect(stopRule(read(s.log))).toMatchObject({ checkpoints: 0 });
    }
  });

  it("settles a comparison on a person's labels, a label standing over a ruling, and writes its report once more", async () => {
    {
      const ruledOn = async () => {
        const s = await setup([edit, finish, again, finish], rejecting);
        const report = await round({ ...s.request, referee: referee(s.log, { s1: "check-defect" }) });
        expect(report).toMatchObject({
          scored: { wins: 3, losses: 0, p: 0.125 },
          counted: { wins: 4, losses: 0 },
          versions: ["s2", "s3", "s4"],
          aside: ["s1"],
          reading: NO_STEP,
          settled: "unsettled",
        });
        // The two rejections of s1 are what a person is asked to label; the other six are ruled.
        const asked = toLabel(read(s.log), "b-1");
        expect(asked.aside).toHaveLength(2);
        expect(asked.others).toHaveLength(6);
        return { s, asked };
      };
      const labelled = (solves: readonly string[], label: Ruling) =>
        new Map(solves.map((solve) => [solve, label] as const));

      // Labelled a check defect, the task is disputed for good and stays out of the comparison.
      const defect = await ruledOn();
      expect(() => settleReading(defect.s.log, "b-1", labelled(["r-0-0"], "earned"))).toThrow(
        "is no rejected answer",
      );
      expect(() =>
        settleReading(defect.s.log, "b-1", new Map(), new Map([[defect.asked.aside[0] ?? "", "sound"]])),
      ).toThrow("is no answer that passed in comparison b-1");
      const settled = settleReading(defect.s.log, "b-1", labelled(defect.asked.aside, "check-defect"));
      expect(settled).toMatchObject({
        scored: { wins: 3, losses: 0, p: 0.125 },
        versions: ["s2", "s3", "s4"],
        disputed: ["s1"],
        aside: [],
        counted: null,
        reading: NO_STEP,
        settled: { labelled: 2, defects: 2, disputed: ["s1"], restored: [] },
      });
      expect(taskStates(read(defect.s.log)).get("s1")).toBe("disputed");
      // The round's own report stays, and the settled one is the last: the round says it when run again.
      expect(defect.s.of(COMPARISON_REPORTED)).toHaveLength(2);
      expect(defect.s.of(COMPARISON_REPORTED)[1]).toMatchObject({ tasks: 4, solves: 2, level: 0.1 });
      expect(await round(defect.s.request)).toEqual(settled);
      // The labels are on record with the report, and the same labels read it back. A comparison is
      // settled once: other labels for it, or none, are refused and write nothing.
      expect(settled.settled).toMatchObject({
        labels: Object.fromEntries(labelled(defect.asked.aside, "check-defect")),
        passes: {},
      });
      expect(settleReading(defect.s.log, "b-1", labelled(defect.asked.aside, "check-defect"))).toEqual(
        settled,
      );
      expect(() => settleReading(defect.s.log, "b-1", labelled(defect.asked.aside, "earned"))).toThrow(
        "comparison b-1 is settled already, and these labels are not the ones it was settled on",
      );
      expect(() => settleReading(defect.s.log, "b-1", new Map())).toThrow("is settled already");
      expect(defect.s.of(COMPARISON_REPORTED)).toHaveLength(2);
      // The settled 3-0 reads no step at 0.10 (p 0.125), and left room: a move that showed no gain.
      expect(stopRule(read(defect.s.log))).toMatchObject({ checkpoints: 1, sinceStep: 1 });

      // Labelled earned, the rejections stand on a person's word and the task is restored: the same
      // whether the labels come at once or after a later round has solved the same tasks.
      const earned = await ruledOn();
      await round(earned.s.next("b-2"));
      append(earned.s.log, TASK_STATE, { version: "s4", state: "released" });
      expect(settleReading(earned.s.log, "b-1", labelled(earned.asked.aside, "earned"))).toMatchObject({
        scored: { wins: 4, losses: 0 },
        versions: HELD,
        disputed: [],
        aside: [],
        reading: "step",
        settled: { labelled: 2, defects: 0, disputed: [], restored: ["s1"] },
      });
      expect(taskStates(read(earned.s.log)).get("s1")).toBe("held");

      // A task set aside on a rejection no label reaches stays out of this comparison, as one
      // labelled unclear does. A pass's label is recorded and moves no tally.
      const partial = await ruledOn();
      const [one = ""] = partial.asked.aside;
      const [valid = ""] = passesIn(read(partial.s.log), "b-1");
      expect(
        settleReading(partial.s.log, "b-1", labelled([one], "earned"), new Map([[valid, "wrong"]])),
      ).toMatchObject({
        scored: { wins: 3, losses: 0 },
        aside: ["s1"],
        settled: { labelled: 1, defects: 0, restored: [], passes: { [valid]: "wrong" } },
      });

      // Labelled unclear, the task stays out of this comparison and is disputed nowhere.
      const unclear = await ruledOn();
      expect(settleReading(unclear.s.log, "b-1", labelled(unclear.asked.aside, "unclear"))).toMatchObject({
        scored: { wins: 3 },
        aside: ["s1"],
        disputed: [],
        settled: { labelled: 2, defects: 0, restored: [] },
      });

      // A person's label stands over the Referee's ruling: a rejection it ruled earned, labelled a
      // check defect, disputes its task.
      const over = await ruledOn();
      const [other = ""] = over.asked.others;
      const labels = new Map<string, Ruling>([
        ...labelled(over.asked.aside, "earned"),
        [other, "check-defect"],
      ]);
      // The task of the first rejection the Referee ruled earned, as the comparison's order put it.
      const gone = ranUnder(read(over.s.log)).find(({ id }) => id === other)?.under.task ?? "";
      expect(["s2", "s3", "s4"]).toContain(gone);
      expect(settleReading(over.s.log, "b-1", labels)).toMatchObject({
        scored: { wins: 3, losses: 0 },
        versions: HELD.filter((version) => version !== gone),
        disputed: [gone],
        settled: { labelled: 3, defects: 1, disputed: [gone], restored: ["s1"] },
      });

      // A task a person refused as infeasible after the comparison stays refused: a label that calls
      // its rejection a check defect is kept, moves no state, and leaves the task set aside.
      const refused = await ruledOn();
      append(refused.s.log, TASK_STATE, { version: "s1", state: "refused" });
      expect(
        settleReading(refused.s.log, "b-1", labelled(refused.asked.aside, "check-defect")),
      ).toMatchObject({
        versions: ["s2", "s3", "s4"],
        aside: ["s1"],
        disputed: [],
        settled: { labelled: 2, defects: 2, disputed: [] },
      });
      expect(taskStates(read(refused.s.log)).get("s1")).toBe("refused");
    }
    {
      const s = await setup([edit, finish], rejecting);
      await round({ ...s.request, referee: referee(s.log) });
      expect(toLabel(read(s.log), "b-1").aside).toEqual([]);
      expect(s.of(COMPARISON_REPORTED)).toHaveLength(1);
      // Every rejection ruled a true fail is still drawn into the packet, and a label stands over it.
      const [one = ""] = toLabel(read(s.log), "b-1").others;
      expect(settleReading(s.log, "b-1", new Map([[one, "check-defect"]]))).toMatchObject({
        disputed: ["s1"],
        settled: { labelled: 1, defects: 1 },
      });
    }
  });

  it("reads a settled comparison again with its labels in place of the verdicts they overturn", async () => {
    const settledOn = async (
      labels: (asked: ReturnType<typeof toLabel>, log: string) => Parameters<typeof settleReading>,
    ) => {
      const s = await setup([edit, finish, again, finish], rejecting);
      await round({ ...s.request, referee: referee(s.log, { s1: "check-defect" }) });
      expect(swapped(read(s.log), "b-1")).toBeNull();
      settleReading(...labels(toLabel(read(s.log), "b-1"), s.log));
      return swapped(read(s.log), "b-1");
    };
    // The reference's rejections of s1 labelled earned: they stand as fails, s1 is a win, and the
    // 3-0 that read no step reads a step at 4-0. The decision flips: its packet was too small.
    expect(
      await settledOn(({ aside }, log) => [
        log,
        "b-1",
        new Map(aside.map((solve) => [solve, "earned"] as const)),
      ]),
    ).toMatchObject({ decided: NO_STEP, swapped: "step", scored: { wins: 4, losses: 0 } });
    // Every rejection labelled a check defect reads as a valid answer, and every pass labelled
    // wrong as a fail: the reference wins all four, and the decision holds.
    expect(
      await settledOn(({ aside, others }, log) => [
        log,
        "b-1",
        new Map([...aside, ...others].map((solve) => [solve, "check-defect"] as const)),
        new Map(passesIn(read(log), "b-1").map((solve) => [solve, "wrong"] as const)),
      ]),
    ).toMatchObject({ decided: NO_STEP, swapped: NO_STEP, scored: { wins: 0, losses: 4, ties: 0 } });
  });

  it("keeps a ruling across a stop, and puts to the Referee again the rejections an earlier run left unruled", async () => {
    {
      let stop = 10;
      const s = await setup([edit, finish], (version, side, nth, digest) => {
        stop -= 1;
        if (stop === 0) throw new Error(STOPS);
        return rejecting(version, side, nth, digest);
      });
      await expect(round({ ...s.request, referee: referee(s.log, { s1: "check-defect" }) })).rejects.toThrow(
        STOPS,
      );
      // Run again, with a Referee that rules every rejection earned: what the first run ruled stands.
      expect(await round({ ...s.request, referee: referee(s.log) })).toMatchObject({
        aside: ["s1"],
        versions: ["s2", "s3", "s4"],
      });
    }
    {
      let stop = 10;
      const s = await setup([edit, finish], (version, side, nth, digest) => {
        stop -= 1;
        if (stop === 0) throw new Error(STOPS);
        return rejecting(version, side, nth, digest);
      });
      // The first run's reader fails on every rejection, so each is left with no ruling.
      const failing = async (): Promise<RefereeFinding> => {
        throw new Error("the reader is down");
      };
      await expect(round({ ...s.request, referee: failing })).rejects.toThrow(STOPS);
      const left = read(s.log).filter(({ kind }) => kind === "verdict").length;
      expect(s.of("referee.finding")).toEqual([]);
      // Run again with a reader that answers: the earlier rejections are ruled, and no task is set
      // aside for want of a ruling the comparison could have had.
      const report = await round({ ...s.request, referee: referee(s.log) });
      expect(report).toMatchObject({ scored: { wins: 4, losses: 0 }, aside: [], versions: HELD });
      expect(left).toBeGreaterThan(0);
      expect(s.of("referee.finding")).toHaveLength(8);
    }
  });

  it("stops, to go on from its log, when no solve of three tasks in a row ran: a provider that answers none, or a wall that refuses every solve", async () => {
    {
      // exam-1, 2026-10-08: the login reached its session limit mid-run and every solve after it
      // ended in three seconds. A round that solved on would have reported every task short.
      // A task's four solves run together: five answered are one task and one solve of the next.
      let left = 5;
      const s = await setup([edit, finish], (version, side, nth, digest) => {
        left -= 1;
        return left < 0 ? LIMITED : step(version, side, nth, digest);
      });
      await expect(round(s.request)).rejects.toThrow(
        "no solve of 3 tasks in a row ran, so the comparison stops: You've hit your session limit",
      );
      expect(s.of(COMPARISON_REPORTED)).toEqual([]);
      // One task answered, the next once: then that one, and two more in a row, had no solve run.
      expect(stoppedAtFirst(s.asked)).toBe(true);
      expect(new Set(s.asked.map(({ version }) => version)).size).toBe(4);
      // The limit lifted: the round goes on, with the session it had and the five solves it counted.
      left = 99;
      const report = await round(s.request);
      expect(report).toMatchObject({ scored: { wins: 4, losses: 0 }, short: [], reading: "step" });
      expect(s.sessions()).toBe(1);

      // A solve the provider cut after it had written something is a non-result of that task alone.
      const cut: Ending = { outcome: "non-result", kind: "provider", reason: "WebSocket closed 1000" };
      const worked = await setup([edit, finish], (version, side, nth, digest) =>
        side === "fresh" ? cut : step(version, side, nth, digest),
      );
      expect(await round(worked.request)).toMatchObject({ short: HELD, versions: [], reading: NOT_SCORED });
    }
    {
      // sim-t10, 10 October: a probe folder another user owned refused the wall on every solve, and
      // the rehearsal ran 56 of them to sandbox-crash before it was killed.
      const unwalled: Ending = {
        outcome: "non-result",
        kind: "sandbox-crash",
        reason: "the wall does not hold on this host, so a solve is not started",
      };
      const s = await setup([edit, finish], () => unwalled);
      await expect(round(s.request)).rejects.toThrow(
        "no solve of 3 tasks in a row ran, so the comparison stops: the wall does not hold on this host",
      );
      expect(s.of(COMPARISON_REPORTED)).toEqual([]);
      // Task by task, each solve asked for once more: two tasks' solves and the third's first.
      expect(stoppedAtFirst(s.asked)).toBe(true);
      expect(new Set(s.asked.map(({ version }) => version)).size).toBe(3);
      expect(s.asked).toHaveLength(17);
    }
  });

  it("stops at the first solve a limit that names its reset ended, and asks for that solve no more", async () => {
    // buffer-147-fork, 13 October: a weekly limit ended 14 solves of one task, and it read short.
    const weekly: Ending = {
      outcome: "non-result",
      kind: "provider",
      reason: "You've hit your weekly limit · resets 3pm (Europe/Amsterdam)",
    };
    let left = 5;
    const s = await setup([edit, finish], (version, side, nth, digest) => {
      left -= 1;
      return left < 0 ? weekly : step(version, side, nth, digest);
    });
    await expect(round(s.request)).rejects.toThrow(
      `the provider's limit ended a solve, so the comparison stops: ${weekly.reason}`,
    );
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
    expect(s.asked).toHaveLength(6);
    // The limit lifted: the round goes on from its log, and no task is short.
    left = 99;
    expect(await round(s.request)).toMatchObject({ scored: { wins: 4, losses: 0 }, short: [] });
  });

  it("reports a task short when its solves end in nothing countable, and tallies the rest", async () => {
    const s = await setup([edit, finish], (version, side, nth, digest) =>
      version === "s4" && side === "fresh"
        ? { outcome: "non-result", kind: "sandbox-crash", reason: "x" }
        : step(version, side, nth, digest),
    );
    expect(await round(s.request)).toMatchObject({
      scored: { wins: 3, losses: 0 },
      versions: ["s1", "s2", "s3"],
      short: ["s4"],
      reading: NO_STEP,
    });
    // Each of s4's two solves under the new harness is asked for again once, at once and in its
    // own place, so the task's solves stay together: none waits for the end of the comparison.
    const ran = s.asked.flatMap(({ version }, at) => (version === "s4" ? [at] : []));
    expect(ran).toHaveLength(6);
    expect((ran.at(-1) ?? 0) - (ran[0] ?? 0)).toBe(5);
    expect(s.asked.filter(({ version, side }) => version === "s4" && side === "fresh")).toHaveLength(4);
  });

  it("leaves out and names a task a person released or refused while the comparison ran or was stopped, and disputes no task a person refused", async () => {
    {
      // A comparison that could not report would lose every solve it paid for.
      let solved = 0;
      const s = await setup([edit, finish], (version, side, nth, digest) => {
        solved += 1;
        // A person releases one task for practice and refuses another as infeasible, mid-run.
        const moved = { 6: ["s4", "released"], 7: ["s3", "refused"] }[solved];
        if (moved !== undefined) {
          append(s.log, TASK_STATE, { version: moved[0] ?? "", state: moved[1] ?? "" });
        }
        return step(version, side, nth, digest);
      });
      expect(await round(s.request)).toMatchObject({
        scored: { wins: 2, losses: 0 },
        versions: ["s1", "s2"],
        withdrawn: ["s3", "s4"],
        short: [],
        reading: NO_STEP,
      });
      // No solve of either task was started after it left the set.
      const after = s.asked.slice(7).map(({ version }) => version);
      expect(after.filter((version) => version === "s3" || version === "s4")).toEqual([]);
    }
    {
      let solved = 0;
      let refused = "";
      const s = await setup([], (version, side, nth, digest) => {
        solved += 1;
        if (solved === 6) throw new Error(STOPS);
        // The first solve after the stop is of a task whose check cannot run on an answer, in a solve
        // that ends after a person refused that task.
        if (solved > 6 && refused === "") {
          refused = version;
          append(s.log, TASK_STATE, { version, state: "refused" });
          return { outcome: "non-result", kind: "check", reason: "the check crashed" };
        }
        return step(version, side, nth, digest);
      });
      await expect(checkpoint(s.compare("g0"))).rejects.toThrow(STOPS);
      append(s.log, TASK_STATE, { version: "s4", state: "released" });
      // Asked for again as it began, with the task that is now practice among its tasks.
      const report = await checkpoint(s.compare("g0"));
      const withdrawn = [refused, "s4"].toSorted();
      expect(report).toMatchObject({
        versions: HELD.filter((version) => !withdrawn.includes(version)),
        withdrawn,
        disputed: [],
      });
      expect(taskStates(read(s.log)).get(refused)).toBe("refused");
      expect(s.asked.slice(6).some(({ version }) => version === "s4")).toBe(false);
      // Under another id the same tasks are refused, as any new comparison's would be.
      await expect(checkpoint(s.compare("g1"))).rejects.toThrow(`task ${refused} is refused`);
    }
  });

  it("stops on more check defects than it allows, and says so in place of a reading", async () => {
    const s = await setup([edit, finish], () => REJECTED);
    const ruled = { s1: "check-defect", s2: "check-defect", s3: "check-defect" } as const;
    const objective = { direction: "lower" } as const;
    const report = await round({ ...s.request, referee: referee(s.log, ruled), defects: 1, objective });
    // A comparison that stopped keeps the rule it fixed, and decided nothing by it.
    expect(report).toMatchObject({
      scored: null,
      aside: ["s1", "s2"],
      disputed: [],
      capped: false,
      reading: "check-defects",
      objective: { ...objective, decided: 0 },
    });
    // The round stopped at the first solve of the second task with a check defect, and no more.
    const reached = [...new Set(s.asked.map(({ version }) => version))];
    const last = reached.at(-1) ?? "";
    expect(reached.filter((version) => version in ruled)).toHaveLength(2);
    expect(last in ruled).toBe(true);
    expect(s.asked.filter(({ version }) => version === last)).toHaveLength(1);
    expect(stopRule(read(s.log))).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
  });

  it("counts towards the stop only the comparisons that left room: three harnesses without a step stop at the patience, and none counts where nobody answered or every answer was valid", async () => {
    {
      // Either harness answers each task on one of its two solves: nothing separates them, and the
      // reference harness is valid on half its solves, which leaves a harness room to gain.
      // A harness's solves of a task are counted across the rounds, so every other one passes.
      const half: Table = (_version, _side, nth) => (nth % 2 === 0 ? PASS : LATE);
      const s = await setup([edit, finish, again, finish, third, finish], half);
      for (const [index, id] of ["b-1", "b-2", "b-3"].entries()) {
        const report = await round(s.next(id));
        expect(report).toMatchObject({ scored: { wins: 0, losses: 0, ties: 4 }, reading: NO_STEP });
        // The campaign's patience is six by default, so three harnesses without a step do not stop
        // it; with an opening of patience three, as the plan had it, the third does.
        expect(stopRule(read(s.log))).toEqual({ checkpoints: index + 1, sinceStep: index + 1, stop: false });
        const three = {
          at: "2026-10-09T00:00:00.000Z",
          kind: "campaign.opened",
          data: { patience: 3 },
        } as const;
        expect(stopRule([three, ...read(s.log)])).toMatchObject({ stop: id === "b-3" });
      }
      // Sixteen solves a comparison, and no starter solve where none read a step.
      expect(s.asked).toHaveLength(48);
    }
    {
      // Two of four tasks answered by both on every solve, two by nobody.
      const two: Table = (version) => (version === "s1" || version === "s2" ? PASS : LATE);
      const s = await setup([edit, finish, again, finish, third, finish], two);
      for (const id of ["b-1", "b-2", "b-3"]) {
        expect(await round(s.next(id))).toMatchObject({
          scored: { wins: 0, losses: 0, ties: 4, unsolved: 2 },
          valid: { old: [2, 0, 2], fresh: [2, 0, 2], informative: { old: 0, fresh: 0 } },
          reading: NO_STEP,
        });
      }
      expect(stopRule(read(s.log))).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    }
    {
      const s = await setup([edit, finish, again, finish, third, finish], () => PASS);
      for (const id of ["b-1", "b-2", "b-3"]) {
        expect(await round(s.next(id))).toMatchObject({
          scored: { wins: 0, losses: 0, ties: 4 },
          valid: { old: [0, 0, 4], fresh: [0, 0, 4] },
          reading: NO_STEP,
        });
      }
      expect(stopRule(read(s.log))).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    }
  });

  // Tasks nobody answers are no room, and neither are tasks the reference answers in every solve:
  // none is informative for it (`informative`), so a harness that gained nothing there showed no
  // want of a gain. From 10 to 12 October the reference's half share of valid solves was room.
  // Fix row F48: where the reference harness is valid on every solve, no harness could have shown
  // a gain, and the answer is another budget or other tasks. Such a comparison stops nothing.
  it("refuses, before any session, a set it could not score", async () => {
    const s = await setup([edit, finish], step);
    await expect(round({ ...s.request, tasks: [...HELD, "p1"] })).rejects.toThrow(
      "task p1 is a practice task, and a round scores no task its session saw",
    );
    await expect(round({ ...s.request, tasks: [...HELD, "s1"] })).rejects.toThrow("task s1 is listed twice");
    append(s.log, TASK_STATE, { version: "s5", state: "released" });
    await expect(round({ ...s.request, tasks: ["s5"] })).rejects.toThrow(
      "task s5 is released, and only a held-out task is scored",
    );
    await expect(round({ ...s.request, tasks: ["s9"] })).rejects.toThrow(
      "task s9 is not proposed, and only a held-out task is scored",
    );
    // The eight truss rounds of 2026-10-08 asked for no task, ran their sessions and scored nothing.
    await expect(round({ ...s.request, tasks: [] })).rejects.toThrow("no task to score");
    // The retained set is part of the scored set the draw gave: a task named beside it is no task of it.
    await expect(round({ ...s.request, retained: ["s9"] })).rejects.toThrow(
      "retained task s9 is not among the tasks to score",
    );
    await expect(checkpoint(s.compare("g0", { tasks: [] }))).rejects.toThrow("no task to score");
    expect(s.of(COMPARISON_STARTED)).toEqual([]);
    // A flag misread on a command line is no number, and a round that ran no solve would say it had.
    await expect(round({ ...s.request, concurrency: Number("four") })).rejects.toThrow("whole numbers");
    await expect(round({ ...s.request, solves: 0 })).rejects.toThrow("whole numbers");
    await expect(round({ ...s.request, level: 10 })).rejects.toThrow("level lies between 0 and 1");
    await expect(round({ ...s.request, cap: { dollars: Number("many"), reserve: 10 } })).rejects.toThrow(
      "a cap and its reserve are dollars",
    );
    await expect(round({ ...s.request, cap: { dollars: 100, reserve: 0 } })).rejects.toThrow("a cap and its");
    expect(s.sessions()).toBe(0);
    // A task another comparison set aside is no refusal: the comparison leaves it out and names it.
    append(s.log, TASK_STATE, { version: "s2", state: "disputed" });
    expect(() => refuseTerms(s.request, { log: s.log, id: "b-9", practised: new Set() })).not.toThrow();
  });

  it("compares nothing a killed or a crashed session froze", async () => {
    const s = await setup([edit, finish], step);
    const killed = new AbortController();
    killed.abort();
    await expect(
      round({ ...s.request, session: { ...s.request.session, kill: killed.signal } }),
    ).rejects.toThrow("session b-1 was killed, so what it froze is not compared");
    // Run again, the round reads the same from the log and runs no second session.
    await expect(round(s.request)).rejects.toThrow("session b-1 was killed");
    expect(spent(read(s.log), "b-1")).toContain("a round under a new session id starts again");
    expect(s.sessions()).toBe(1);
    expect(s.asked).toEqual([]);
    // A turn the provider failed leaves half a session too.
    const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" });
    const crashed = await setup([edit, failed], step);
    await expect(round(crashed.request)).rejects.toThrow(
      "session b-1 crashed, so what it froze is not compared",
    );
    expect(crashed.asked).toEqual([]);
    expect(crashed.of(COMPARISON_REPORTED)).toEqual([]);
  });
});

describe("a checkpoint with no session", () => {
  it("runs the plan's first round: the Builder forks the starter, and its harness is compared with the starter", async () => {
    // The starter answers s4 in both solves, the second late, and s3 in one; the new harness
    // answers everything early.
    const s = await setup([edit, finish], (version, side, nth) => {
      if (side !== "starter") return { ending: PASS, turns: 5 };
      if (version === "s4") return { ending: PASS, turns: nth === 0 ? 5 : 11 };
      return version === "s3" && nth === 0 ? { ending: PASS, turns: 11 } : LATE;
    });
    const first: RoundRequest = {
      ...s.request,
      setting: s.request.setting,
      session: { ...s.request.session, parent: s.starter.dir },
      reference: s.starter,
    };
    const report = await round(first);
    expect(report).toMatchObject({
      old: s.starter.digest,
      starter: s.starter.digest,
      scored: { wins: 3, losses: 0, ties: 1, p: 0.125 },
      // How the starter does by itself is read from the same comparison: no valid answer on two
      // tasks, one on a third, two on the fourth. That is the plan's first gate.
      valid: { old: [2, 1, 1], fresh: [0, 0, 4] },
      reading: NO_STEP,
    });
    expect(s.of("build.started")[0]).toMatchObject({ parent: s.starter.digest });
    // Four tasks, two harnesses, two solves: no solve under any other harness.
    expect(s.asked).toHaveLength(16);
    expect(s.asked.every(({ side }) => side !== "old")).toBe(true);
    // The first round is a checkpoint of the stop rule: its harness is one a session built, and
    // its 3-0 (p 0.125) left room and showed no gain.
    expect(stopRule(read(s.log))).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
    // One harness on both sides is no comparison.
    await expect(checkpoint(s.compare("aa", { fresh: { dir: s.parent, digest: s.old } }))).rejects.toThrow(
      "a comparison sets two harnesses against each other, and both sides are",
    );
  });

  // Fix row F46: a settling reads the comparison's terms back from its start. A comparison that
  // began with shorter budgets reported rows this source reads no longer, and the settled report
  // would drop them in place of the report the comparison began with.
  it("refuses to settle a comparison that began with shorter budgets, and leaves its report as written", async () => {
    const s = await setup([edit, finish], rejecting);
    await round(s.request);
    const labels = new Map(toLabel(read(s.log), "b-1").aside.map((solve) => [solve, "earned"] as const));
    // The same comparison as a source of 10 October began it: read also at 12 turns.
    const older = join(dirname(s.log), "older.jsonl");
    for (const { kind, data } of read(s.log)) {
      const began = kind === COMPARISON_STARTED ? { budgets: [{ turns: 12 }] } : {};
      append(older, kind, { ...data, ...began });
    }
    expect(() => settleReading(older, "b-1", labels)).toThrow(
      "comparison b-1 began with 1 shorter budgets, which this source reads no longer: its report stands as it was written",
    );
    expect(read(older).filter(({ kind }) => kind === COMPARISON_REPORTED)).toHaveLength(1);
    expect(settleReading(s.log, "b-1", labels)).not.toHaveProperty("budgets");
  });

  it("writes the operator's prediction with the terms, before the first solve, and keeps it", async () => {
    const s = await setup([], step);
    const prediction = "no step: the starter is valid on most of these at this budget";
    const report = await checkpoint(s.compare("g0", { prediction }));
    const events = read(s.log);
    const began = events.findIndex(({ kind }) => kind === COMPARISON_STARTED);
    expect(events[began]?.data.prediction).toBe(prediction);
    expect(began).toBeLessThan(events.findIndex(({ kind }) => kind === "solve.started"));
    expect(predicted(events, "g0")).toBe(prediction);
    // A comparison that predicted nothing has none, and its start holds no such key. The prediction
    // decides nothing: both read what their tallies read.
    const plain = await checkpoint(s.compare("g1"));
    expect(report.reading).toBe(plain.reading);
    expect(predicted(read(s.log), "g1")).toBeNull();
    expect(s.of(COMPARISON_STARTED)[1]).not.toHaveProperty("prediction");
  });

  it("reads the reference harness against itself as it reads two harnesses, on its own solves at four a side", async () => {
    // The plan's section 4b: at four solves a side every comparison carries its A/A, the
    // reference's four solves of a task split by slot two against two, read as the test is. The
    // reference answers s1 in its first two solves and not after; the starter answers nothing.
    const s = await setup([], (version, side, nth) => {
      if (side === "starter") return LATE;
      return version === "s1" && nth >= 2 ? LATE : PASS;
    });
    const report = await checkpoint(s.compare("g2", { solves: 4 }));
    expect(report).toMatchObject({
      // The test reads all four of the reference's solves against the starter's four.
      scored: { wins: 0, losses: 4, ties: 0, differences: [-8, -16, -16, -16] },
      // The first and last slot against the two between tie the reference with itself on s1, and
      // two of its four solves of s1 that disagree are four of its six pairs.
      noise: { wins: 0, losses: 0, ties: 4, p: 1, flips: 1 / 6 },
    });
    // No solve was made for it: four a side on each of four tasks.
    expect(s.asked.filter(({ side }) => side === "old")).toHaveLength(16);
    expect(s.asked.filter(({ side }) => side === "starter")).toHaveLength(16);
    // Two solves a side split one against one, too few for an A/A.
    expect((await checkpoint(s.compare("g3"))).noise).toBeNull();
  });

  it("reads no step on either tier where the reference meets itself, and carries no margin", async () => {
    // The A/A rehearsal of the overhaul plan's P2: every solve of the reference is valid, and its
    // objective 10 or 10.4 by turns, which halves mirrored in time hold one of each on every task.
    const s = await setup([], (_version, side, nth) =>
      side === "starter" ? LATE : { ending: PASS, objective: nth % 2 === 0 ? 10 : 10.4 },
    );
    const objective = { direction: "lower" } as const;
    const report = await checkpoint({ ...s.compare("g2", { solves: 4 }), objective });
    // The objective tells its answers apart, pairing by pairing, and decides no
    // task: on validity and on the objective alike, the reference ties itself.
    expect(report.noise).toMatchObject({ wins: 0, losses: 0, ties: 4, p: 1, flips: 0 });
    // Until 18 October the A/A set the next comparison's margin from this spread, 0.4 in 10.4;
    // there has been no margin since 19 October, and the report carries none.
    expect(report.noise).not.toHaveProperty("margin");
  });

  it("reads a step on the frontier despite one unsupported retained loss, on sets fixed before its first solve", async () => {
    // The reference answers s1 in every solve and nothing else; the starter breaks s1 and answers
    // the four tasks held out below.
    const s = await setup([], (version, side) => ((version === "s1") === (side === "old") ? PASS : LATE));
    // The fixture compares a kept harness with a different starter: make the kept one the reference.
    append(s.log, "harness.promoted", { harness: s.old, from: s.starter.digest, rests: [] });
    for (const version of ["s6", "s7", "s8", "s9"]) {
      append(s.log, "task.proposed", { version, family: version < "s8" ? "f3" : "f4" });
      append(s.log, "task.gate", gatePassed(version));
    }
    // Two comparisons in which the reference answered s1 in every solve exhaust it, and the hash
    // keeps a third of the exhausted, here s1 itself, in the draw as retained. s2 to s5 were held
    // out before the promotion and the reference stood in no comparison of them: retained too.
    await checkpoint(s.compare("g1", { tasks: ["s1"] }));
    await checkpoint(s.compare("g2", { tasks: ["s1"] }));
    const tasks = ["s1", "s6", "s7", "s8", "s9"];
    expect(poolOf(read(s.log)).retained.toSorted()).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    // One draw gives the scored set and the retained tasks in it, one for each three frontier
    // tasks, and the start records both.
    const drawn = scoredSet(read(s.log), 12, "c");
    expect(drawn.retained).toHaveLength(2);
    expect(drawn.tasks).toEqual(expect.arrayContaining(["s6", "s7", "s8", "s9", ...drawn.retained]));
    const report = await checkpoint(s.compare("g3", { tasks, retained: ["s1"] }));
    expect(s.of(COMPARISON_STARTED).at(-1)).toMatchObject({ tasks, retained: ["s1"] });
    expect(report).toMatchObject({
      frontier: { tasks: ["s6", "s7", "s8", "s9"], aside: [], wins: 4, losses: 0, ties: 0, p: 0.0625 },
      retained: { tasks: ["s1"], aside: [], wins: 0, losses: 1, ties: 0, differences: [-4] },
      // The comparison before it of the same two harnesses scored s1 as well.
      overlap: { with: "g2", tasks: ["s1"] },
      reading: "step",
    });
  });

  it("reads a step whose untied tasks all fall in one family of the two or more its set holds as a step", async () => {
    const s = await setup([], (version, side) => (side === "old" && version !== "s1" ? LATE : PASS));
    for (const version of ["s6", "s7", "s8", "s9"]) {
      append(s.log, "task.proposed", { version, family: "f3" });
      append(s.log, "task.gate", gatePassed(version));
    }
    const report = await checkpoint(s.compare("g1", { tasks: ["s1", "s6", "s7", "s8", "s9"] }));
    expect(report).toMatchObject({
      frontier: { wins: 4, losses: 0, ties: 1, p: 0.0625 },
      families: {
        f1: { frontier: { wins: 0, losses: 0, ties: 1 } },
        f3: { frontier: { wins: 4, losses: 0, ties: 0 } },
      },
      // Until 16 October it read `narrow`, which never fired on record.
      reading: "step",
    });
  });

  it("stops at its dollar cap, reads not scored and is finished, whatever lanes it runs in", async () => {
    const s = await setup([], () => PASS);
    // Each solve is billed two dollars and held at three before it starts: the sixth would take
    // ten billed and three reserved past eleven.
    const report = await checkpoint(s.compare("g0", { cap: { dollars: 11, reserve: 3 } }));
    expect(report).toMatchObject({ scored: null, versions: [], capped: true, reading: NOT_SCORED });
    expect(s.asked).toHaveLength(5);
    expect(s.of(COMPARISON_STARTED)[0]).toMatchObject({ cap: { dollars: 11, reserve: 3 } });
    // It is no checkpoint of the stop rule, and run again it says what it said and buys nothing.
    expect(stopRule(read(s.log))).toMatchObject({ checkpoints: 0 });
    expect(await checkpoint(s.compare("g0", { cap: { dollars: 11, reserve: 3 } }))).toEqual(report);
    expect(s.asked).toHaveLength(5);
    // Four lanes start no more than one does. A lane that cannot afford a solve while others are
    // in flight steps aside and leaves the job, and the cap is reached when none is in flight.
    const wide = await setup([], () => PASS);
    const cut = await checkpoint(wide.compare("g0", { cap: { dollars: 11, reserve: 3 }, concurrency: 4 }));
    expect(cut).toMatchObject({ capped: true, reading: NOT_SCORED });
    expect(wide.asked).toHaveLength(5);
    // A cap that holds every solve but not four reserves at once cuts nothing: the lanes take turns.
    const tight = await setup([], () => PASS);
    expect(
      await checkpoint(tight.compare("g0", { cap: { dollars: 35, reserve: 3 }, concurrency: 4 })),
    ).toMatchObject({ scored: { ties: 4 }, capped: false });
    expect(tight.asked).toHaveLength(16);
    // A cap that holds the whole comparison cuts nothing.
    const roomy = await setup([], () => PASS);
    expect(await checkpoint(roomy.compare("g0", { cap: { dollars: 35, reserve: 3 } }))).toMatchObject({
      scored: { ties: 4 },
      capped: false,
    });
    expect(roomy.asked).toHaveLength(16);
  });

  it("counts its own solves and its own spend, whatever another comparison did while it was stopped", async () => {
    let stop = 6;
    const s = await setup([], () => {
      stop -= 1;
      if (stop === 0) throw new Error(STOPS);
      return PASS;
    });
    const cap = { dollars: 35, reserve: 3 };
    await expect(checkpoint(s.compare("g-a", { cap }))).rejects.toThrow(STOPS);
    // Another comparison of the same two harnesses runs whole on the same tasks.
    expect(await checkpoint(s.compare("g-b", { cap }))).toMatchObject({ scored: { ties: 4 } });
    const between = s.asked.length;
    // Gone on with, the first makes every solve it still lacks, and its cap holds them: the other
    // comparison's solves are neither its solves nor its spend.
    expect(await checkpoint(s.compare("g-a", { cap }))).toMatchObject({
      scored: { ties: 4 },
      capped: false,
      short: [],
    });
    expect(s.asked.length - between).toBe(16 - 5);
    const mine = read(s.log).filter(
      ({ kind, data }) => kind === "solve.started" && data.comparison === "g-a",
    );
    expect(mine).toHaveLength(16);
  });

  it("stops on a solve that does not name it, which no reading would count", async () => {
    const s = await setup([], () => PASS);
    const unnamed = s.compare("g0");
    // The caller's solve forgets to hand the comparison on.
    const request = {
      ...unnamed,
      solve: (version: string, harness: { digest: string }) => s.solve(version, harness.digest),
    };
    await expect(checkpoint(request)).rejects.toThrow("does not name comparison g0 at its start");
    expect(s.asked).toHaveLength(1);
  });

  it("counts a round's cap from its session's first event, so the session's spend is under it", async () => {
    const s = await setup([edit, finish], step);
    const report = await round({ ...s.request, cap: { dollars: 3, reserve: 3 } });
    // The session billed something, and with it one reserve is past the cap: no solve starts.
    expect(Number(s.of("build.finished")[0]?.billed)).toBeGreaterThan(0);
    expect(report).toMatchObject({ scored: null, capped: true, reading: NOT_SCORED });
    expect(s.asked).toEqual([]);
  });
});

describe("a session with no comparison after it", () => {
  const practise = call("practice", { tasks: ["t-p1"] });

  // The plan's checkpoint (`docs/plan.md`, Phase 5): several sessions, then one comparison. Until
  // 2026-10-09 a session ran only inside a round, so two sessions were two paid comparisons.
  it("runs twice, the second from what the first left, and one checkpoint compares what they leave", async () => {
    const s = await setup([edit, practise, finish, again, finish], step);
    const { session: build, builder } = s.request;
    const first = await sessionOnce(build, builder);
    const kept = first.kept;
    if (kept === null) throw new Error("the first session left no harness");
    const second = await sessionOnce({ ...build, id: "b-2", parent: kept.dir }, builder);
    expect(second.kept?.digest).not.toBe(kept.digest);
    expect(latestBuilt(read(s.log))).toBe(second.kept?.digest ?? "");
    // Two sessions are on record and no comparison: the one solve asked for was the practice.
    expect(s.of("build.finished").map(({ session: id, ended }) => [id, ended])).toEqual([
      ["b-1", "finished"],
      ["b-2", "finished"],
    ]);
    expect(s.of(COMPARISON_STARTED)).toEqual([]);
    expect(s.asked).toEqual([{ version: "p1", side: "fresh" }]);
    // Asked for again, a session is read from the log and not run a second time.
    expect(await sessionOnce({ ...build, id: "b-2", parent: kept.dir }, builder)).toEqual(second);
    expect(s.sessions()).toBe(2);
    // The one comparison is of the last harness with the reference, on tasks no session saw.
    const report = await checkpoint(s.compare("g-1", { fresh: second.kept ?? s.starter }));
    expect(report).toMatchObject({ reading: "step", fresh: second.kept?.digest, old: s.old });
    expect(s.of(COMPARISON_STARTED)).toHaveLength(1);
    expect(stopRule(read(s.log))).toMatchObject({ checkpoints: 1, sinceStep: 0, stop: false });
  });

  it("refuses a second run of a session that did not end whole, as a round does", async () => {
    const s = await setup([edit, finish], step);
    const { session: build, builder } = s.request;
    append(s.log, "build.started", { session: "b-1", parent: s.old });
    await expect(sessionOnce(build, builder)).rejects.toThrow(
      "session b-1 started and never finished; a round does not run a second session under one id",
    );
    await expect(sessionOnce({ ...build, parent: s.starter.dir }, builder)).rejects.toThrow(
      "session b-1 started from another harness",
    );
    expect(s.sessions()).toBe(0);
  });

  it("starts no practice solve its dollar cap holds no reserve for, and says so as a count", async () => {
    // The stand-in bills a solve $2. A cap of $5 with a reserve of $2 holds two solves: before the
    // third the log holds $4, and a reserve more would pass the cap. The session's own count
    // would have allowed it.
    const s = await setup([edit, practise, practise, practise, finish], step);
    const { session: build, builder } = s.request;
    await sessionOnce({ ...build, cap: { dollars: 5, reserve: BILLED } }, builder);
    const said = s
      .of("build.call")
      .flatMap(({ tool: name, text: told }) => (name === "practice" && isString(told) ? [told] : []));
    expect(said).toHaveLength(3);
    expect(said[0]).toContain("1 practice solve left.");
    expect(said[1]).toContain("No practice solve is left:");
    expect(said[2]).toContain("only 0 practice solves left, and this asks for 1");
    // The Builder is told a count, and no sum of money.
    expect(said.join("\n")).not.toContain("$");
    expect(s.asked).toHaveLength(2);
    expect(s.of("build.finished")[0]).toMatchObject({ practiceSolves: 2, ended: "finished" });
    // Under no cap, the same session spends its own count.
    const free = await setup([edit, practise, practise, practise, finish], step);
    await sessionOnce(free.request.session, free.request.builder);
    expect(free.asked).toHaveLength(3);
  });

  it("holds a round's session to the round's cap", async () => {
    const s = await setup([edit, practise, practise, finish], step);
    const report = await round({ ...s.request, cap: { dollars: 3, reserve: BILLED } });
    // One practice solve is afforded and the second is not. The comparison then finds the cap
    // spent before its first solve, and scores nothing.
    expect(s.of("build.finished")[0]).toMatchObject({ practiceSolves: 1 });
    expect(report).toMatchObject({ reading: NOT_SCORED, capped: true });
  });
});
describe("the scored set", () => {
  const at = "2026-10-09T00:00:00.000Z";
  const heldOut = (versions: readonly string[], family?: string): LogEvent[] =>
    versions.flatMap((version) => [
      { at, kind: "task.proposed", data: { version, ...keyIfDefined("family", family) } } as const,
      { at, kind: "task.gate", data: gatePassed(version) } as const,
    ]);
  const held = ["v1", "v2", "v3", "v4", "v5", "v6"];
  /** The tasks a draw of `target` scores, under one contract. */
  const drawn = (events: readonly LogEvent[], target: number) =>
    scoredSet(events, target, "contract-a").tasks;

  it("is drawn from the held-out tasks by the contract alone, so no result chooses it, and is all of them where the campaign holds fewer than were asked for", () => {
    const first = drawn(heldOut(held), 4);
    expect(first).toHaveLength(4);
    expect(drawn(heldOut(held.toReversed()), 4)).toEqual(first);
    expect(scoredSet(heldOut(held), 4, "contract-b").tasks).not.toEqual(first);
    // A task written since takes a place by its own rank and moves no other task's.
    expect(drawn(heldOut([...held, "v7"]), 7).filter((version) => version !== "v7")).toEqual(
      drawn(heldOut(held), 6),
    );
    // A practice task is no held-out task.
    const released = [
      ...heldOut(held),
      { at, kind: TASK_STATE, data: { version: "v3", state: "released" } } as const,
    ];
    expect(drawn(released, 12)).not.toContain("v3");
    expect(drawn(heldOut(held), 12).toSorted()).toEqual(held);
    // Nothing is retained before the reference has closed a task twice.
    expect(scoredSet(heldOut(held), 12, "contract-a").retained).toEqual([]);
    expect(scoredSet([], 12, "contract-a")).toEqual({ tasks: [], retained: [] });
  });

  it("draws a task an old ladder held as any held-out task, since the ladder was retired on 16 October", () => {
    const laddered = [
      ...heldOut(held),
      { at, kind: "task.proposed", data: { version: "l1" } } as const,
      { at, kind: "task.gate", data: { version: "l1", gate: 1, outcome: "ladder" } } as const,
      { at, kind: TASK_STATE, data: { version: "l1", state: "ladder" } } as const,
    ];
    expect(drawn(laddered, 12).toSorted()).toEqual([...held, "l1"].toSorted());
  });

  it("takes the newest epoch's tasks first, and reads the epochs before the reference never stood in as retained", () => {
    // The simulated climb of 10 October: after two promotions a draw over every epoch at once
    // took two or three tasks the reference failed out of 19, and three comparisons read one win
    // short. The tasks written since the last promotion are the exam, so they come first, whole.
    const climbed: LogEvent[] = [
      ...heldOut(held),
      { at, kind: "harness.promoted", data: { harness: "h1" } } as const,
      ...heldOut(["v7", "v8"]),
    ];
    // The tasks held before the promotion, which h1 stood in no comparison of, were written for
    // the harness it replaced: retained, one for each three frontier tasks, by their own hash.
    // Until 16 October one task in four of the set was kept for them as frontier, and after each
    // of buffer-159-opus's promotions they tied with both sides valid in every solve.
    expect(poolOf(climbed)).toMatchObject({ frontier: ["v7", "v8"], retained: held });
    const newest = scoredSet(climbed, 4, "contract-a");
    expect(newest.tasks.slice(0, 2).toSorted()).toEqual(["v7", "v8"]);
    expect(newest.tasks).toHaveLength(3);
    expect(newest.retained).toEqual(newest.tasks.slice(2));
    expect(held).toContain(newest.retained[0] ?? "");
    // Within the newest epoch the hash still chooses, so no result does.
    expect(drawn(climbed, 1).slice(0, 1)).toEqual(drawn(heldOut(["v7", "v8"]), 1));
    // A target past the held-out count scores the frontier whole and its share of the retained.
    expect(drawn(climbed, 12)).toHaveLength(3);
    // A frontier that fills the target scores its retained share beside it: until 16 October the
    // share was what the frontier left of the target, and here it left none.
    const full = scoredSet(climbed, 2, "contract-a");
    expect(full.tasks.slice(0, 2).toSorted()).toEqual(["v7", "v8"]);
    expect(full.retained).toHaveLength(1);
    expect(full.tasks).toHaveLength(3);
    // A task of the epoch before that the reference stood in and left open is frontier still.
    const stood: LogEvent[] = [
      ...climbed,
      {
        at,
        kind: "comparison.reported",
        data: {
          session: "g-1",
          old: "h1",
          fresh: "h2",
          versions: ["v1"],
          scored: { wins: 0, losses: 0, ties: 1 },
        },
      } as const,
    ];
    expect(poolOf(stood).frontier.toSorted()).toEqual(["v1", "v7", "v8"]);
    // A task released in the newest epoch leaves room for no older one: the frontier is v7 alone.
    const released: LogEvent[] = [
      ...climbed,
      { at, kind: TASK_STATE, data: { version: "v8", state: "released" } } as const,
    ];
    const after = drawn(released, 4);
    expect(after[0]).toBe("v7");
    expect(after).toHaveLength(2);
  });

  it("scores every frontier task, and of the retained tasks one for each three frontier tasks", () => {
    // Nine tasks the reference answered in every solve, three it answered in none: all nine are
    // retained, and the set takes one of them. Until 16 October the hash kept three of the nine
    // and the set took all three, topping a set short of frontier up with tasks that can only tie.
    const closed = Array.from({ length: 9 }, (_, nth) => `c${String(nth)}`);
    const open = ["f1", "f2", "f3"];
    const outcomes = Object.fromEntries([
      ...closed.map((version) => [version, "PP PP"]),
      ...open.map((version) => [version, "FF PP"]),
    ]);
    const { events, terms } = roundSolves("g-1", ["h0", "h1"], outcomes);
    const report = {
      at,
      kind: "comparison.reported",
      data: { session: "g-1", old: "h0", fresh: "h1", starter: "h0", ...tallied(3, 0, 9), ...terms },
    } as const;
    const logged = [...heldOut([...closed, ...open]), ...events, report];
    expect(poolOf(logged).retained).toHaveLength(9);
    const set = scoredSet(logged, 12, "contract-a");
    expect(set.tasks.filter((version) => open.includes(version)).toSorted()).toEqual(open);
    expect(set.retained).toHaveLength(1);
    expect(set.tasks).toHaveLength(4);
  });

  it("takes the tasks held out since the last comparison began first within an epoch, then the rest by hash", () => {
    // esp32-141-m3b, 12 October: an epoch starts only at a promotion, so the tasks an Examiner wrote
    // after a comparison that left no room were drawn by the hash among the ones it had scored,
    // and g-3 scored 4 of the 7 written for it.
    const first = drawn(heldOut(held), 4);
    const started = { at, kind: "comparison.started", data: { session: "g-1", tasks: first } } as const;
    const written = ["v7", "v8", "v9"];
    const events: LogEvent[] = [...heldOut(held), started, ...heldOut(written)];
    const next = drawn(events, 4);
    expect(next.slice(0, 3).toSorted()).toEqual(written);
    expect(next.slice(3)).toEqual(drawn(heldOut(held), 1));
    // A task held out before that comparison began, scored by it or not, is no newer than another.
    expect(drawn([...events, { ...started, data: { session: "g-2", tasks: next } }], 9)).toEqual(
      drawn(heldOut([...held, ...written]), 9),
    );
  });

  it("keeps a task whose solves were cut at their limits, and leaves out one with no valid answer after two comparisons and the tasks the reference closed twice, until a person keeps the first", async () => {
    {
      // A cut solve says the budget was short, and nothing of the task.
      const s = await setup([edit, finish, again, finish], (version) => (version === "s1" ? LATE : PASS));
      await round(s.request);
      await round(s.next("b-2"));
      expect(poolOf(read(s.log)).awaiting).toEqual([]);
      expect(scoredSet(read(s.log), 12, "c").tasks).toContain("s1");
    }
    const s = await setup([edit, finish, again, finish], (version) => (version === "s1" ? UNANSWERED : PASS));
    // The fixture compares a kept harness with a different starter: make the kept one the reference.
    append(s.log, "harness.promoted", { harness: s.old, from: s.starter.digest, rests: [] });
    await round(s.request);
    expect(poolOf(read(s.log)).awaiting).toEqual([]);
    expect(scoredSet(read(s.log), 12, "c").tasks).toContain("s1");
    await round(s.next("b-2"));
    // s2 to s4 were answered by both harnesses in every solve of both comparisons: exhausted, and
    // retained as a check on regression. Until 16 October two thirds of them left the draw.
    // s5, held out before the promotion and never scored, is retained beside them, and with no
    // frontier task left the draw takes none.
    const pool = poolOf(read(s.log));
    expect(pool).toMatchObject({ awaiting: ["s1"], frontier: [] });
    expect(pool.retained.toSorted()).toEqual(["s2", "s3", "s4", "s5"]);
    expect(pool.exhausted.toSorted()).toEqual(["s2", "s3", "s4"]);
    expect(scoredSet(read(s.log), 12, "c")).toEqual({ tasks: [], retained: [] });
    // Named for a comparison all the same, it is refused: the draw leaves it out, and a name
    // was the one way past that (2026-10-09).
    await expect(round(s.next("b-3"))).rejects.toThrow(
      "task s1 waits for a person's label, and is not scored until it has one: tools/d2/prepare.ts --keep or --infeasible",
    );
    append(s.log, TASK_STATE, {
      version: "s1",
      state: "held",
      reason: "a person read the task as feasible",
    });
    expect(scoredSet(read(s.log), 12, "c").tasks).toContain("s1");
  });
});
