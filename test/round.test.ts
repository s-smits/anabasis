// One round on stand-ins: the real session on the faux provider with a host write for the walled
// one, and solves that end as a table says. What is under test is the order of a round, what it
// reads from its log when it is run again, what it leaves out of a comparison, and its reading.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type RoundRequest, round, settleReading, stopRule, toLabel } from "../src/builder/round.ts";
import { type BuildRequest, type Built, type Practised, session } from "../src/builder/session.ts";
import type { Bench } from "../src/builder/tools.ts";
import { type Condition, recordCondition, settingId } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { taskStates } from "../src/kernel/task.ts";
import { returning } from "../src/kernel/wall.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import type { RefereeFinding } from "../src/review/referee.ts";
import { text, tool } from "../src/solve/answer.ts";
import { openHarness } from "../src/solve/harness.ts";

const COMPARISON_REPORTED = "comparison.reported";

/** How a solve of `version` under the old or the new harness ends, by how many came before it. A
 *  table that tells more than two harnesses apart reads the digest. */
type Table = (version: string, fresh: boolean, nth: number, digest: string) => Ending;

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
  diskBytes: 64 * 1024 * 1024,
  practiceSolves: 3,
};
const SCORED = ["s1", "s2", "s3", "s4"];
const CANDIDATES = ["c1", "c2", "c3", "c4"];
const ANCHOR = ["a1", "a2", "a3"];
const PASS: Ending = { outcome: "pass" };
const FAIL: Ending = { outcome: "fail", kind: "rejected" };
/** A solve a login at its session limit turned away, after its reruns. */
const LIMITED: Ending = { outcome: "non-result", kind: "provider", reason: "You've hit your session limit" };
const scratches: string[] = [];
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const edit = call("write_file", { path: "agent/BUILT_AGENTS.md", content: "Multiply first.\n" });
const again = call("write_file", { path: "agent/BUILT_AGENTS.md", content: "Multiply first, then check.\n" });
const finish = call("finish", { note: "A shorter guide." });

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/**
 * A scratch with the fixture harness as the parent and a log in which p1 is released, s1 to s4 are
 * admitted, c1 to c4 are feasible and held, and a1 to a3 are the anchor's. `responses` are the
 * Builder's turns; `table` ends the solves. The request scores s1 to s4 and screens nothing.
 */
async function setup(responses: FauxResponseStep[], table: Table, more: readonly string[] = []) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-round-")));
  scratches.push(scratch);
  const parent = join(scratch, "parent");
  const log = join(scratch, "log.jsonl");
  cpSync(FIXTURE, parent, { recursive: true });
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  for (const version of ["p1", ...SCORED, ...more, ...CANDIDATES, ...ANCHOR]) {
    record("task.proposed", { version });
    for (const gate of [1, 2, 3, 4]) record("task.gate", { version, gate, outcome: "passed", controls: "d" });
  }
  record("anchor.drawn", { tasks: ANCHOR });
  record("task.state", { version: "p1", state: "released" });
  for (const version of [...SCORED, ...more]) record("task.state", { version, state: "admitted" });
  /** The host's code as a condition names it, which an edit between two rounds moves. */
  const code = { value: "h1" };
  const old = (await openHarness(parent)).digest;
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
  // What earlier rounds left on record: three fails of each admitted task under the parent. They
  // are the parent's side of this round's screening, so the round admits those tasks again with no
  // solve of its own, and counts none of these.
  for (const version of [...SCORED, ...more]) {
    for (const nth of [1, 2, 3]) {
      const solve = `earlier-${version}-${String(nth)}`;
      record("solve.started", { solve, condition: recordCondition(log, condition(version, old)) });
      record("solve.finished", { solve, ending: FAIL, seconds: 60 });
    }
  }
  /** Every solve asked for, in order. */
  const asked: { version: string; fresh: boolean }[] = [];
  const counts = new Map<string, number>();
  const solve = async (version: string, _dir: string, digest: string): Promise<Practised> => {
    const fresh = digest !== old;
    const key = `${version} ${String(fresh)}`;
    const nth = counts.get(key) ?? 0;
    counts.set(key, nth + 1);
    asked.push({ version, fresh });
    const ending = table(version, fresh, nth, digest);
    const id = `r-${String(asked.length)}-${String(read(log).length)}`;
    record("solve.started", { solve: id, condition: recordCondition(log, condition(version, digest)) });
    // What the provider wrote for the solve: nothing, when it turned the solve away.
    const output = ending === LIMITED ? 0 : 900;
    record("solve.finished", { solve: id, ending, tokens: { output }, seconds: fresh ? 30 : 60 });
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
    states: join(scratch, "states"),
    tasks: [{ version: "p1", task: { taskId: "t-p1", family: "fixture", publicInput: { base: 7 } } }],
    contract: CONTRACT,
    resources: [],
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    models: () => models,
    log,
    repoRoot: scratch,
    practise: async (task, dir, digest) => solve(task.version, dir, digest),
  };
  /** The walled write, stood in for: the same tool name, writing as the host. */
  const walled = (bench: Bench) => [
    tool({
      name: "write_file",
      label: "write",
      description: "Writes a file under harness/.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, args) => {
        const file = join(bench.home, "harness", args.path);
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
    candidates: SCORED,
    anchor: ANCHOR,
    target: 4,
    // Read when a round is asked for, so that a test that moves the host's code moves this too.
    get setting() {
      return settingId(condition("any", "any"));
    },
    screening: { solves: 3, fails: 2 },
    solves: 2,
    level: 0.1,
    anchorLevel: 0.1,
    anchorFloor: 1,
    defects: 3,
    concurrency: 1,
    solve,
    refereeDecides: true,
  };
  const of = (kind: EventKind) =>
    read(log)
      .filter((event) => event.kind === kind)
      .map(({ data }) => data);
  /** The round's own finished solves, without the ones on record before it. */
  const solved = () => of("solve.finished").filter(({ solve: id }) => isString(id) && id.startsWith("r-"));
  return { request, log, old, asked, of, solved, code, sessions: () => sessions };
}

/** The new harness passes every scored task the old one fails; the anchor moves with neither. */
const step = (version: string, fresh: boolean, nth: number): Ending => {
  if (version.startsWith("s")) return fresh ? PASS : FAIL;
  if (version === "a1") return nth === 0 ? PASS : FAIL;
  return PASS;
};

/** An advising Referee that rules every fail of s1 a check defect and logs its rulings, as
 *  `src/review/referee.ts` does. */
const logging =
  (log: string) =>
  async (solve: string, version: string): Promise<RefereeFinding> => {
    const ruling = version === "s1" ? "check-defect" : "earned";
    append(log, "referee.finding", { solve, ruling });
    return { ruling, check: null, rule: "R1", field: "answer", reason: "r", probes: [] };
  };

describe("a round", () => {
  it("runs the session, solves every task under both harnesses in turn, and reads a step", async () => {
    const s = await setup([edit, finish], step);
    const report = await round(s.request);
    expect(report.fresh).not.toBe(s.old);
    expect(report).toMatchObject({
      old: s.old,
      scored: { wins: 4, losses: 0, ties: 0, p: 0.0625 },
      anchor: { wins: 0, losses: 0, ties: 3, informative: 1, reading: "held" },
      disputed: [],
      short: [],
      reading: "step",
    });
    // Seven tasks, two harnesses, two solves: no more, and neither harness first throughout.
    expect(s.asked).toHaveLength(28);
    expect(s.asked.slice(0, 4)).toEqual([
      { version: "s1", fresh: false },
      { version: "s1", fresh: true },
      { version: "s2", fresh: true },
      { version: "s2", fresh: false },
    ]);
    expect(s.of("build.started")[0]).toMatchObject({ tasks: ["p1"] });
    expect(s.of(COMPARISON_REPORTED)).toEqual([
      {
        session: "b-1",
        target: 4,
        solves: 2,
        screening: { solves: 3, fails: 2 },
        level: 0.1,
        broken: null,
        reviewFaults: [],
        old: s.old,
        fresh: report.fresh,
        scored: {
          wins: 4,
          losses: 0,
          ties: 0,
          p: 0.0625,
          points: 100,
          upper: 100,
          seconds: { old: 60, fresh: 30 },
        },
        anchor: { wins: 0, losses: 0, ties: 3, informative: 1, reading: "held" },
        versions: SCORED,
        disputed: [],
        flagged: [],
        unflagged: null,
        short: [],
        unscreened: [],
        counted: "step",
        reading: "step",
        settled: null,
      },
    ]);
    expect(stopRule(read(s.log))).toMatchObject({ sessions: 1, tasks: 4, points: 100, stop: false });
    expect(s.of("anchor.scored")[0]).toMatchObject({
      session: "b-1",
      reading: "held",
      informative: 1,
      tasks: 3,
    });
    // Run again, a finished round says what it said: no session, no solve, no second report.
    expect(await round(s.request)).toEqual(report);
    expect(s.sessions()).toBe(1);
    expect(s.asked).toHaveLength(28);
    expect(s.of(COMPARISON_REPORTED)).toHaveLength(1);
  });

  it("moves the exam with the harness: a task the new parent passes retires, and one it still fails is carried", async () => {
    // Two rounds, the second from the harness the first left. The first parent fails every scored
    // task. The first child passes s1 to s3 and still fails s4; the second child passes all four.
    // The table learns the first child's digest from the first solve under a harness not the setup's.
    const children: string[] = [];
    const s = await setup([edit, finish, again, finish], (version, fresh, _nth, digest) => {
      if (!version.startsWith("s")) return PASS;
      if (!fresh) return FAIL;
      if (children.length === 0) children.push(digest);
      return version === "s4" && digest === children[0] ? FAIL : PASS;
    });
    const one = await round(s.request);
    expect([one.fresh]).toEqual(children);
    // The parent's three fails on record admitted each task with no screening solve.
    expect(s.of("task.state").filter((moved) => moved.session === "b-1")).toEqual(
      SCORED.map((version) => ({ version, state: "admitted", session: "b-1", carried: true })),
    );
    expect(one).toMatchObject({ scored: { wins: 3, losses: 0, ties: 1 }, versions: SCORED });
    const before = s.asked.length;
    const two = await round({
      ...s.request,
      session: {
        ...s.request.session,
        id: "b-2",
        parent: join(s.request.session.states, one.fresh ?? ""),
      },
    });
    expect(two.old).toBe(one.fresh ?? "");
    const states = taskStates(read(s.log));
    // s1 to s3: the new parent's two passes on record were topped up to three and the child solved
    // three, all passes, so the campaign has got past them. s4: the new parent's two fails on record
    // admitted it again with no screening solve.
    expect(SCORED.map((version) => states.get(version))).toEqual([
      "too-easy",
      "too-easy",
      "too-easy",
      "admitted",
    ]);
    expect(s.of("task.state").filter((moved) => moved.session === "b-2")).toContainEqual({
      version: "s4",
      state: "admitted",
      session: "b-2",
      carried: true,
    });
    // Only s4 is scored, on solves made after this round admitted it: the parent's earlier fails
    // placed it and are counted nowhere.
    expect(two).toMatchObject({
      versions: ["s4"],
      scored: { wins: 1, losses: 0, ties: 0 },
      unscreened: [],
    });
    // Three tasks at one top-up and three child solves, s4 at two scoring solves a harness, and the
    // anchor's three at two a harness.
    expect(s.asked.length - before).toBe(3 * 4 + 4 + 12);
  });

  it("goes on from its log when a solve stopped it: the session is not run again, nor a counted solve", async () => {
    let stop = 10;
    const s = await setup([edit, finish], (version, fresh, nth) => {
      stop -= 1;
      if (stop === 0) throw new Error("the verifier could not decide s3, so the run stops");
      return step(version, fresh, nth);
    });
    await expect(round(s.request)).rejects.toThrow("the verifier could not decide s3");
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
    const report = await round(s.request);
    expect(report).toMatchObject({ scored: { wins: 4, losses: 0 }, reading: "step" });
    expect(s.sessions()).toBe(1);
    expect(s.of("build.started")).toHaveLength(1);
    // Nine solves counted before the stop, the tenth thrown, and nineteen after it.
    expect(s.solved()).toHaveLength(28);
    expect(s.asked).toHaveLength(29);
  });

  it("leaves out a task the Referee rules a check defect on, and one whose check could not run", async () => {
    const s = await setup([edit, finish], (version, fresh, nth) =>
      version === "a2" && fresh
        ? { outcome: "non-result", kind: "check", reason: "check-9: threw" }
        : step(version, fresh, nth),
    );
    const refereed: string[] = [];
    const referee = async (_solve: string, version: string): Promise<RefereeFinding> => {
      refereed.push(version);
      if (version === "s3") throw new Error("the reader failed");
      return {
        ruling: version === "s1" ? "check-defect" : "earned",
        check: version === "s1" ? "check-7" : null,
        rule: version === "s1" ? null : "R1",
        field: version === "s1" ? null : "answer",
        reason: "r",
        probes: [],
      };
    };
    const report = await round({ ...s.request, referee });
    // Three scored tasks are left, which no sign test at 0.10 can pass: the step is not read.
    expect(report).toMatchObject({
      scored: { wins: 3, losses: 0, p: 0.125 },
      disputed: ["s1", "a2"],
      reading: "no-step",
    });
    const states = taskStates(read(s.log));
    expect([states.get("s1"), states.get("a2"), states.get("s2")]).toEqual([
      "disputed",
      "disputed",
      "admitted",
    ]);
    // A disputed task is solved no further: s1 once, under the old harness, and never again.
    expect(s.asked.filter(({ version }) => version === "s1")).toEqual([{ version: "s1", fresh: false }]);
    expect(refereed.filter((version) => version === "s1")).toHaveLength(1);
    // A fail the Referee could not read stands, and the host is told.
    expect(s.of(COMPARISON_REPORTED)[0]?.reviewFaults).toHaveLength(2);
    expect(s.of("task.state").filter(({ state }) => state === "disputed")).toMatchObject([
      { version: "s1", reason: "the Referee ruled a check defect: check-7" },
      { version: "a2", reason: "its own check could not run on an answer" },
    ]);
  });

  it("lets an advising Referee flag a task and decide nothing", async () => {
    const s = await setup([edit, finish], step);
    const referee = async (_solve: string, version: string): Promise<RefereeFinding> => ({
      ruling: version === "s1" ? "check-defect" : "earned",
      check: version === "s1" ? "check-7" : null,
      rule: version === "s1" ? null : "R1",
      field: version === "s1" ? null : "answer",
      reason: "r",
      probes: [],
    });
    const report = await round({ ...s.request, referee, refereeDecides: false });
    // The fail stands and the task is counted: a person reads it before the reading is read. The
    // second reading leaves the flagged task out, and three wins clear no test at 0.10: the step
    // rests on the one fail a reviewer laid to a check, and the round claims neither reading.
    expect(report).toMatchObject({
      scored: { wins: 4, losses: 0 },
      disputed: [],
      flagged: ["s1"],
      unflagged: {
        scored: { wins: 3, losses: 0, p: 0.125 },
        anchor: { reading: "held" },
        reading: "no-step",
      },
      counted: "step",
      reading: "flags-decide",
    });
    expect(taskStates(read(s.log)).get("s1")).toBe("admitted");
    expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({
      flagged: ["s1"],
      unflagged: { reading: "no-step" },
      reading: "flags-decide",
    });
  });

  it("keeps a flag across a stop: the first run's ruling is in the log and is reported", async () => {
    let stop = 10;
    const s = await setup([edit, finish], (version, fresh, nth) => {
      stop -= 1;
      if (stop === 0) throw new Error("the run stops");
      return step(version, fresh, nth);
    });
    const earned = { check: null, rule: "R1", field: "answer", reason: "r", probes: [] };
    // The Referee logs its ruling, as `src/review/referee.ts` does.
    const flagging = async (solve: string, version: string): Promise<RefereeFinding> => {
      const ruling = version === "s1" ? "check-defect" : "earned";
      append(s.log, "referee.finding", { solve, ruling });
      return { ...earned, ruling };
    };
    await expect(round({ ...s.request, referee: flagging, refereeDecides: false })).rejects.toThrow(
      "the run stops",
    );
    // Run again, with a Referee that flags nothing: what the first run flagged is still flagged.
    const report = await round({
      ...s.request,
      referee: async () => ({ ...earned, ruling: "earned" }),
      refereeDecides: false,
    });
    expect(report).toMatchObject({
      flagged: ["s1"],
      unflagged: { reading: "no-step" },
      counted: "step",
      reading: "flags-decide",
    });
  });

  it("settles a reading the flags decide on a person's labels, and writes the report once more", async () => {
    const flagged = async (labelled: "check-defect" | "earned") => {
      const s = await setup([edit, finish], step);
      const report = await round({ ...s.request, referee: logging(s.log), refereeDecides: false });
      expect(report).toMatchObject({
        flagged: ["s1"],
        counted: "step",
        reading: "flags-decide",
        settled: null,
      });
      // The two fails of s1 under the old harness are what a person is asked to label.
      const asked = toLabel(read(s.log), "b-1");
      expect(asked.flagged).toHaveLength(2);
      const [one = "", two = ""] = asked.flagged;
      // One label is not enough, and an unclear one settles nothing.
      expect(() => settleReading(s.log, "b-1", new Map([[one, labelled]]))).toThrow("1 of 2 flagged fails");
      expect(() =>
        settleReading(
          s.log,
          "b-1",
          new Map([
            [one, labelled],
            [two, "unclear"],
          ]),
        ),
      ).toThrow("1 of 2 flagged fails");
      expect(() => settleReading(s.log, "b-1", new Map([["r-0-0", labelled]]))).toThrow(
        "is no refused answer",
      );
      return {
        s,
        settled: settleReading(
          s.log,
          "b-1",
          new Map([
            [one, labelled],
            [two, labelled],
          ]),
        ),
      };
    };
    // Labelled a check defect, the task is disputed and leaves the comparison: three wins clear no
    // test at 0.10.
    const defect = await flagged("check-defect");
    expect(defect.settled).toMatchObject({
      scored: { wins: 3, losses: 0, p: 0.125 },
      versions: ["s2", "s3", "s4"],
      disputed: ["s1"],
      flagged: [],
      unflagged: null,
      counted: "no-step",
      reading: "no-step",
      settled: { labelled: 2, defects: 2, disputed: ["s1"] },
    });
    expect(taskStates(read(defect.s.log)).get("s1")).toBe("disputed");
    // The round's own report stays, and the settled one is the last: the round says it when run again.
    expect(defect.s.of(COMPARISON_REPORTED).map(({ reading }) => reading)).toEqual([
      "flags-decide",
      "no-step",
    ]);
    expect(defect.s.of(COMPARISON_REPORTED)[1]).toMatchObject({ target: 4, solves: 2, level: 0.1 });
    expect(await round(defect.s.request)).toEqual(defect.settled);
    expect(settleReading(defect.s.log, "b-1", new Map())).toEqual(defect.settled);
    expect(stopRule(read(defect.s.log))).toMatchObject({ sessions: 1, tasks: 3 });
    // Labelled earned, the fails stand on a person's word and the step is read.
    const earned = await flagged("earned");
    expect(earned.settled).toMatchObject({
      scored: { wins: 4, losses: 0 },
      disputed: [],
      flagged: [],
      counted: "step",
      reading: "step",
      settled: { labelled: 2, defects: 0, disputed: [] },
    });
    expect(taskStates(read(earned.s.log)).get("s1")).toBe("admitted");
  });

  it("reads a round that scored no task as not scored, which is not a test that found no gain", async () => {
    const s = await setup([edit, finish], step);
    const report = await round({ ...s.request, target: 0 });
    expect(report).toMatchObject({
      scored: { wins: 0, losses: 0, ties: 0, p: 1 },
      versions: [],
      reading: "not-scored",
    });
    expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ target: 0, reading: "not-scored" });
    // It counts among the sessions of the three-session rule, with no task to pool.
    expect(stopRule(read(s.log))).toMatchObject({ sessions: 1, tasks: 0, stop: false });
  });

  it("stops, to go on from its log, when the provider answers no solve of three tasks in a row", async () => {
    // exam-1, 2026-10-08: the login reached its session limit mid-run and every solve after it
    // ended in three seconds. A round that solved on would have reported every task short.
    let left = 9;
    const s = await setup([edit, finish], (version, fresh, nth) => {
      left -= 1;
      return left < 0 ? LIMITED : step(version, fresh, nth);
    });
    await expect(round(s.request)).rejects.toThrow(
      "the provider answered no solve of 3 tasks in a row, so the round stops: You've hit your session limit",
    );
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
    expect(s.asked.length).toBeLessThan(28);
    // The limit lifted: the round goes on, with the session it had and the nine solves it counted.
    left = 99;
    const report = await round(s.request);
    expect(report).toMatchObject({ scored: { wins: 4, losses: 0 }, short: [], reading: "step" });
    expect(s.sessions()).toBe(1);
    expect(s.solved().filter(({ ending }) => ending !== undefined)).toHaveLength(s.asked.length);

    // A solve the provider cut after it had written something is a non-result of that task alone.
    const cut: Ending = { outcome: "non-result", kind: "provider", reason: "WebSocket closed 1000" };
    const worked = await setup([edit, finish], (version, fresh, nth) =>
      fresh ? cut : step(version, fresh, nth),
    );
    expect(await round(worked.request)).toMatchObject({ short: expect.arrayContaining(SCORED) });
  });

  it("reports a task short when its solves end in nothing countable, and leaves it out", async () => {
    const s = await setup([edit, finish], (version, fresh, nth) =>
      version === "s4" && fresh
        ? { outcome: "non-result", kind: "sandbox-crash", reason: "x" }
        : step(version, fresh, nth),
    );
    const report = await round(s.request);
    expect(report).toMatchObject({ scored: { wins: 3, losses: 0 }, short: ["s4"], reading: "no-step" });
    // Two passes over what was unsolved, each asking for s4's two solves under the new harness.
    expect(s.asked.filter(({ version, fresh }) => version === "s4" && fresh)).toHaveLength(4);
  });

  it("screens candidates under both harnesses after the session, and scores what either fails", async () => {
    // Screening is each task's first three solves a harness, scoring its fourth and fifth.
    const table: Table = (version, fresh, nth) => {
      // c1: the old harness fails it twice in screening, and fails it in scoring too.
      if (version === "c1") return fresh || nth === 2 ? PASS : FAIL;
      // c3: the old harness's only fails end at the wall.
      if (version === "c3" && !fresh && nth < 2) return { outcome: "fail", kind: "wall-ended" };
      // c4: the new harness fails it twice in screening and passes it after.
      if (version === "c4" && fresh && nth < 2) return FAIL;
      return PASS;
    };
    const s = await setup([edit, finish], table);
    const report = await round({ ...s.request, candidates: CANDIDATES, target: 2 });
    const states = taskStates(read(s.log));
    expect(CANDIDATES.map((version) => states.get(version))).toEqual([
      "admitted",
      "too-easy",
      "wall-bound",
      "admitted",
    ]);
    // The wall-bound verdict names the setting and the limits its solves ran under, so that a
    // longer wall returns the task to the pool and nothing else does (`src/kernel/limits.ts`).
    const verdicts = s.of("task.state");
    expect(verdicts.find((moved) => moved.state === "wall-bound")).toMatchObject({
      version: "c3",
      setting: s.request.setting,
      limits: LIMITS,
    });
    expect(returning(read(s.log), LIMITS)).toEqual([]);
    expect(returning(read(s.log), { ...LIMITS, wallSeconds: 2 * LIMITS.wallSeconds })).toEqual(["c3"]);
    // No other verdict names limits: only this one rests on them.
    expect(verdicts.filter((moved) => moved.limits !== undefined)).toHaveLength(1);
    // Two at a time while two are wanted, then one at a time: no candidate past the set's need.
    const order = s.asked.map(({ version }) => version).filter((version) => version.startsWith("c"));
    expect(order.slice(0, 12).every((version) => version === "c1" || version === "c2")).toBe(true);
    expect(order.slice(12, 18).every((version) => version === "c3")).toBe(true);
    expect(order.slice(18, 24).every((version) => version === "c4")).toBe(true);
    // A screening solve never counts in a score: c1 is a win on its two scoring solves alone, and
    // c4, which the new harness failed only in screening, is a tie.
    expect(report).toMatchObject({
      versions: ["c1", "c4"],
      scored: { wins: 1, losses: 0, ties: 1, p: 0.5, points: 50 },
      unscreened: [],
      reading: "no-step",
    });
    expect(order).toHaveLength(24 + 8);
    expect(verdicts.filter((moved) => moved.session === "b-1")).toHaveLength(4);
    // Run again, it screens nothing and solves nothing.
    expect(await round({ ...s.request, candidates: CANDIDATES, target: 2 })).toEqual(report);
    expect(s.asked.filter(({ version }) => version.startsWith("c"))).toHaveLength(32);
  });

  it("leaves a candidate held when its screening solves did not all count", async () => {
    const s = await setup([edit, finish], (version, fresh, nth) =>
      version === "c1" && fresh && nth === 0
        ? { outcome: "non-result", kind: "provider", reason: "x" }
        : FAIL,
    );
    const report = await round({ ...s.request, candidates: ["c1", "c2"], target: 1 });
    expect(report).toMatchObject({ unscreened: ["c1"], versions: ["c2"] });
    expect(taskStates(read(s.log)).get("c1")).toBe("held");
  });

  it("stops on more check defects than the plan allows, and says so in place of a reading", async () => {
    const s = await setup([edit, finish], () => FAIL);
    const referee = async (): Promise<RefereeFinding> => ({
      ruling: "check-defect",
      check: "check-7",
      rule: null,
      field: null,
      reason: "r",
      probes: [],
    });
    const report = await round({ ...s.request, referee, defects: 1 });
    expect(report).toMatchObject({ scored: null, disputed: ["s1", "s2"], reading: "check-defects" });
    // The round stopped at the second dispute: one solve of each of two tasks, and no more.
    expect(s.asked).toEqual([
      { version: "s1", fresh: false },
      { version: "s2", fresh: true },
    ]);
    expect(s.of(COMPARISON_REPORTED)).toMatchObject([
      { disputed: ["s1", "s2"], scored: null, reading: "check-defects" },
    ]);
    expect(stopRule(read(s.log))).toMatchObject({ sessions: 0, stop: false });
  });

  it("reads the three-session rule from the log: each round counts its own solves, and three flat rounds stop", async () => {
    // Every task passes once and fails once under either harness: no gain anywhere. Eight scored
    // tasks a round, so three rounds pool the 24 the rule's bound is trusted on.
    const flat: Table = (_version, _fresh, nth) => (nth % 2 === 0 ? PASS : FAIL);
    const more = ["s5", "s6", "s7", "s8"];
    const s = await setup([edit, finish, edit, finish, edit, finish], flat, more);
    for (const [index, id] of ["b-1", "b-2", "b-3"].entries()) {
      // The host's code is edited between rounds, as it will be: each round's solves name another
      // host, so the second and third read none of the parent's solves on record and screen every
      // task again under both harnesses. One fail in three keeps a task here.
      s.code.value = `h${String(index + 1)}`;
      const report = await round({
        ...s.request,
        candidates: [...SCORED, ...more],
        target: 8,
        screening: { solves: 3, fails: 1 },
        session: { ...s.request.session, id },
      });
      expect(report).toMatchObject({
        scored: { wins: 0, losses: 0, ties: 8, points: 0, upper: 0 },
        reading: "no-step",
      });
      expect(stopRule(read(s.log))).toMatchObject({
        sessions: index + 1,
        tasks: 8 * (index + 1),
        points: 0,
        stop: id === "b-3",
      });
    }
    // The second and third rounds counted no solve of the first, though the harnesses were the same.
    // Each round made its 44 counted solves, and the two under other host code their 48 screening
    // solves besides: the first round's parent side was on record under its own.
    expect(s.sessions()).toBe(3);
    expect(s.asked).toHaveLength(3 * 2 * 2 * 11 + 2 * 2 * 3 * 8);
    // Read again after its scored tasks were released for practice, the rule reads the same rounds.
    for (const version of SCORED) append(s.log, "task.state", { version, state: "released" });
    expect(stopRule(read(s.log))).toMatchObject({ sessions: 3, tasks: 24, stop: true });
    // And a finished round, run again after later rounds, still says what it said.
    const first = await round({ ...s.request, candidates: [...SCORED, ...more], target: 8 });
    expect(first).toMatchObject({ scored: { ties: 8 }, reading: "no-step" });
    expect(s.asked).toHaveLength(3 * 2 * 2 * 11 + 2 * 2 * 3 * 8);
  });

  it("stops neither on a bound over too few tasks nor on three sessions with no task", async () => {
    const flat: Table = (_version, _fresh, nth) => (nth % 2 === 0 ? PASS : FAIL);
    const few = await setup([edit, finish, edit, finish, edit, finish], flat);
    for (const id of ["b-1", "b-2", "b-3"]) {
      await round({ ...few.request, session: { ...few.request.session, id } });
    }
    // Twelve tied tasks bound the gain at nothing, on evidence too thin to end an experiment.
    expect(stopRule(read(few.log))).toMatchObject({ sessions: 3, tasks: 12, upper: 0, stop: false });
    const idle = await setup([finish, finish, finish], flat);
    for (const id of ["b-1", "b-2", "b-3"]) {
      const report = await round({ ...idle.request, session: { ...idle.request.session, id } });
      expect(report.reading).toBe("no-change");
    }
    expect(stopRule(read(idle.log))).toMatchObject({ sessions: 3, tasks: 0, stop: false });
  });

  it("counts a task once when its own admissions are handed back as scored, and an anchor dispute as the anchor's", async () => {
    // The round is stopped while scoring, after it admitted c1 and c2 and disputed the anchor's a2.
    let stop = 0;
    const s = await setup([edit, finish], (version, fresh, nth) => {
      if (version === "a2") return { outcome: "non-result", kind: "check", reason: "check-9: threw" };
      if (version.startsWith("c") && nth < 3) return fresh ? PASS : FAIL;
      stop += 1;
      if (stop === 8) throw new Error("the verifier could not decide, so the run stops");
      return fresh ? PASS : FAIL;
    });
    const asked = { ...s.request, candidates: ["c1", "c2"], target: 2, defects: 0 };
    await expect(round(asked)).rejects.toThrow("the verifier could not decide");
    expect(taskStates(read(s.log)).get("a2")).toBe("disputed");
    // Run again as a command would ask: the admitted tasks as scored, the anchor without its disputed task.
    const report = await round({ ...asked, anchor: ["a1", "a3"] });
    expect(report).toMatchObject({
      versions: ["c1", "c2"],
      scored: { wins: 2, losses: 0, p: 0.25 },
      disputed: ["a2"],
      reading: "no-step",
    });
    expect(s.of(COMPARISON_REPORTED)).toHaveLength(1);
  });

  it("runs four solves side by side to the same reading", async () => {
    const s = await setup([edit, finish], step);
    const report = await round({ ...s.request, concurrency: 4 });
    expect(report).toMatchObject({
      scored: { wins: 4, losses: 0, ties: 0 },
      anchor: { ties: 3, informative: 1 },
      short: [],
      reading: "step",
    });
    expect(s.asked).toHaveLength(28);
    expect(s.solved()).toHaveLength(28);
  });

  it("stops screening when a whole batch cannot be screened, and leaves the rest held", async () => {
    // The new harness breaks on every task, so its fail says nothing of any one of them.
    const s = await setup([edit, finish], (_version, fresh) =>
      fresh ? { outcome: "fail", kind: "broken-harness", reason: "no tools" } : FAIL,
    );
    const report = await round({ ...s.request, candidates: CANDIDATES, target: 2 });
    expect(report).toMatchObject({ unscreened: ["c1", "c2"], versions: [], scored: { wins: 0, losses: 0 } });
    expect(s.asked.filter(({ version }) => version === "c3" || version === "c4")).toEqual([]);
    expect(CANDIDATES.map((version) => taskStates(read(s.log)).get(version))).toEqual(Array(4).fill("held"));
  });

  it("reads a lost anchor apart from a step, and an anchor too thin to test apart from both", async () => {
    // The new harness passes the scored tasks and fails every anchor task the old one passes.
    const traded: Table = (version, fresh) => (version.startsWith("s") === fresh ? PASS : FAIL);
    // Three losses and no win is p = 0.125: lost when the guard is asked at 0.2, as a guard may be.
    const lost = await setup([edit, finish], traded);
    expect(await round({ ...lost.request, anchorLevel: 0.2 })).toMatchObject({
      scored: { wins: 4, p: 0.0625 },
      anchor: { losses: 3, wins: 0, informative: 3, reading: "lost" },
      reading: "anchor-lost",
    });
    // An anchor both harnesses pass throughout can show neither a win nor a loss.
    const thin = await setup([edit, finish], (version, fresh) =>
      version.startsWith("s") && !fresh ? FAIL : PASS,
    );
    expect(await round(thin.request)).toMatchObject({
      anchor: { informative: 0, reading: "not-tested" },
      reading: "anchor-not-tested",
    });
  });

  it("reports no change, and solves nothing, when the session left the harness it started from", async () => {
    const s = await setup([finish], step);
    expect(await round(s.request)).toMatchObject({ fresh: null, scored: null, reading: "no-change" });
    expect(s.asked).toEqual([]);
    expect(s.of(COMPARISON_REPORTED)).toMatchObject([
      { session: "b-1", old: s.old, fresh: null, scored: null, broken: null, reading: "no-change" },
    ]);
  });

  it("refuses, before any session, a set it could not score", async () => {
    const s = await setup([edit, finish], step);
    await expect(round({ ...s.request, candidates: [...SCORED, "p1"] })).rejects.toThrow(
      "task p1 is a practice task, and a round scores no task its session saw",
    );
    await expect(round({ ...s.request, candidates: [...SCORED, "a1"] })).rejects.toThrow(
      "task a1 is listed twice",
    );
    await expect(round({ ...s.request, candidates: ["a1"], anchor: [] })).rejects.toThrow(
      "task a1 is the anchor's, and an anchor task is never screened",
    );
    append(s.log, "task.state", { version: "c1", state: "too-easy" });
    await expect(round({ ...s.request, candidates: ["c1"] })).rejects.toThrow(
      "task c1 is too-easy, and a task to screen is held or admitted",
    );
    await expect(round({ ...s.request, anchor: ["s1"], candidates: [] })).rejects.toThrow(
      "task s1 is admitted, and an anchor task is held",
    );
    // A flag misread on a command line is no number, and a round that ran no solve would say it had.
    await expect(round({ ...s.request, concurrency: Number("four") })).rejects.toThrow("whole numbers");
    await expect(round({ ...s.request, screening: { solves: 1, fails: 2 } })).rejects.toThrow(
      "screening needs at least as many solves as the fails that admit",
    );
    await expect(round({ ...s.request, level: 10 })).rejects.toThrow("level lies between 0 and 1");
    expect(s.sessions()).toBe(0);
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

  it("reports a session that left a harness no solve could open, and compares nothing", async () => {
    const s = await setup(
      [call("write_file", { path: "agent/tools-spec.json", content: "{}" }), finish],
      step,
    );
    expect(await round(s.request)).toMatchObject({ fresh: null, reading: "no-change" });
    expect(JSON.stringify(s.of(COMPARISON_REPORTED)[0]?.broken)).toContain(
      "agent/tools-spec.json needs presets",
    );
    expect(s.asked).toEqual([]);
  });
});
