// One round on stand-ins: the real session on the faux provider with a host write for the walled
// one, and solves that end as a table says. What is under test is the order of a round, which
// solves it counts and which it makes, what it leaves out of a comparison, its cap, and its reading.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  type CheckpointRequest,
  checkpoint,
  type RoundRequest,
  round,
  scoredSet,
  settleReading,
  spent,
  toLabel,
} from "../src/builder/round.ts";
import { type BuildRequest, type Built, type Practised, session } from "../src/builder/session.ts";
import type { Bench } from "../src/builder/tools.ts";
import { type Condition, recordCondition, settingId } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { awaitingLabel, latestBuilt, stopRule } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
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

const COMPARISON_REPORTED = "comparison.reported";
const TASK_STATE = "task.state";
/** What a stand-in solve throws to stop a run part-way. */
const STOPS = "the run stops";

type Side = "old" | "fresh" | "baseline";
/** How a solve ended, with what it used where a case reads that. */
interface Used {
  readonly ending: Ending;
  readonly turns?: number;
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
  diskBytes: 64 * 1024 * 1024,
  practiceSolves: 3,
};
const HELD = ["s1", "s2", "s3", "s4"];
const PASS: Ending = { outcome: "pass" };
/** An answer a check rejected: what a reviewer or a person rules on. */
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
/** A solve that reached its limits with no answer: not valid, and nothing for anyone to rule on. */
const LATE: Ending = { outcome: "fail", kind: "wall-ended" };
/** What the stand-in bills a solve. */
const BILLED = 2;
const BASELINE_UNREAD = "baseline-unread";
const NOT_SCORED = "not-scored";
const NO_STEP = "no-step";
/** A solve a login at its session limit turned away, after its reruns. */
const LIMITED: Ending = { outcome: "non-result", kind: "provider", reason: "You've hit your session limit" };
const scratches: string[] = [];
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const edit = call("write_file", { path: "agent/BUILT_AGENTS.md", content: "Multiply first.\n" });
const again = call("write_file", { path: "agent/BUILT_AGENTS.md", content: "Multiply first, then check.\n" });
const third = call("write_file", { path: "agent/BUILT_AGENTS.md", content: "Third.\n" });
const finish = call("finish", { note: "A shorter guide." });

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/**
 * A scratch with the fixture harness as the reference harness and the Builder's parent, the same
 * harness under another guide as the baseline, and a log in which p1 is released for practice and
 * s1 to s5 are held out. `responses` are the Builder's turns; `table` ends the solves.
 */
async function setup(responses: FauxResponseStep[], table: Table) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-round-")));
  scratches.push(scratch);
  const parent = join(scratch, "parent");
  const lesser = join(scratch, "baseline");
  const log = join(scratch, "log.jsonl");
  cpSync(FIXTURE, parent, { recursive: true });
  cpSync(FIXTURE, lesser, { recursive: true });
  writeFileSync(join(lesser, "agent", "BUILT_AGENTS.md"), "No guide.\n");
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  for (const version of ["p1", ...HELD, "s5"]) {
    record("task.proposed", { version });
    record("task.gate", { version, gate: 1, outcome: "passed" });
  }
  record(TASK_STATE, { version: "p1", state: "released" });
  /** The host's code as a condition names it, which an edit between two rounds moves. */
  const code = { value: "h1" };
  const old = (await openHarness(parent)).digest;
  const baseline = { dir: lesser, digest: (await openHarness(lesser)).digest };
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
    digest === old ? "old" : digest === baseline.digest ? "baseline" : "fresh";
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
    const { ending, turns = 10 }: Used = "ending" in ended ? ended : { ending: ended };
    const id = `r-${String(asked.length)}-${String(read(log).length)}`;
    record("solve.started", {
      solve: id,
      condition: recordCondition(log, condition(version, digest)),
      ...keyIfDefined("comparison", comparison),
    });
    if (ending === PASS) {
      record("verdict", { solve: id, task: version, kind: "pass", answer: { answer: "42" } });
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
    practise: async (task, _dir, digest) => solve(task.version, digest),
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
    reference: { dir: parent, digest: old },
    baseline,
    tasks: HELD,
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
  /** A comparison with no session, of the baseline against the reference harness unless told. */
  const compare = (id: string, more: Partial<CheckpointRequest> = {}): CheckpointRequest => {
    const { session: _session, builder: _builder, reference, ...terms } = request;
    return { ...terms, setting: request.setting, log, id, old: reference, fresh: baseline, ...more };
  };
  return {
    request,
    next,
    compare,
    solve,
    log,
    old,
    parent,
    baseline,
    asked,
    of,
    solved,
    code,
    sessions: () => sessions,
  };
}

/** The new harness answers every task within its limits, and the reference harness and the
 *  baseline none: the plan's own case, a valid answer against no answer, which needs no ruling. */
const step: Table = (_version, side) => (side === "fresh" ? PASS : LATE);
/** The same with an answer a check rejects where there was none, which someone has to rule on. */
const rejecting: Table = (_version, side) => (side === "fresh" ? PASS : side === "old" ? REJECTED : LATE);

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
  it("runs the session, solves the reference and the new harness in turn, and holds a step to the baseline", async () => {
    const s = await setup([edit, finish], step);
    const report = await round(s.request);
    expect(report.fresh).not.toBe(s.old);
    const tested = { wins: 4, losses: 0, ties: 0, p: 0.0625 };
    const began = read(s.log).findIndex(({ kind }) => kind === "comparison.started");
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
        baseline: s.baseline.digest,
        scored: { ...tested, unsolved: 0 },
        budgets: [],
        spread: {
          turns: { tasks: 8, median: 1, most: 1 },
          prompts: null,
          cpu: null,
          seconds: { tasks: 8, median: 1, most: 1 },
        },
        billed: { old: BILLED, fresh: BILLED },
        against: tested,
        noise: null,
        counted: null,
        versions: HELD,
        disputed: [],
        aside: [],
        short: [],
        withdrawn: [],
        capped: false,
        reading: "step",
        settled: null,
      },
    ]);
    // Four tasks, two harnesses, two solves, neither harness first throughout. The baseline is
    // solved after them, since the test cleared its level and a step is held to it.
    expect(s.asked).toHaveLength(24);
    expect(s.asked.slice(0, 6)).toEqual([
      { version: "s1", side: "old" },
      { version: "s1", side: "fresh" },
      { version: "s2", side: "fresh" },
      { version: "s2", side: "old" },
      { version: "s3", side: "old" },
      { version: "s3", side: "fresh" },
    ]);
    expect(s.asked.slice(0, 16).some(({ side }) => side === "baseline")).toBe(false);
    expect(s.asked.slice(16).every(({ side }) => side === "baseline")).toBe(true);
    expect(s.of("build.started")[0]).toMatchObject({ tasks: ["p1"] });
    // What it compares was on record before its first solve: the harnesses, the terms and the tasks.
    expect(s.of("comparison.started")).toEqual([
      {
        session: "b-1",
        old: s.old,
        fresh: report.fresh,
        baseline: s.baseline.digest,
        setting: s.request.setting,
        solves: 2,
        level: 0.1,
        noise: false,
        budgets: [],
        cap: null,
        tasks: HELD,
      },
    ]);
    const kinds = read(s.log).map(({ kind }) => kind);
    // After the session's own practice, and before any solve of a held-out task.
    expect(began).toBeGreaterThan(kinds.indexOf("build.finished"));
    expect(kinds.slice(began).filter((kind) => kind === "solve.started")).toHaveLength(24);
    expect(latestBuilt(read(s.log))).toBe(report.fresh);
    expect(stopRule(read(s.log))).toEqual({ checkpoints: 1, sinceStep: 0, stop: false });
    // The comparison moved no task: every scored task is held out still.
    expect(HELD.map((version) => taskStates(read(s.log)).get(version))).toEqual(Array(4).fill("held"));
    // Run again, a finished round says what it said: no session, no solve, no second report.
    expect(await round(s.request)).toEqual(report);
    expect(s.sessions()).toBe(1);
    expect(s.asked).toHaveLength(24);
    expect(s.of(COMPARISON_REPORTED)).toHaveLength(1);
  });

  it("calls two valid answers even, and leaves the baseline unsolved where no step is read", async () => {
    // v1's batteries mostly passed whole. Nothing here weighs one valid answer against another: no
    // objective is built until validity is seen to leave too many ties.
    const s = await setup([edit, finish], (version) => (version === "s1" ? LATE : PASS));
    expect(await round(s.request)).toMatchObject({
      // Three ties between valid answers, and one on a task no harness answered.
      scored: { wins: 0, losses: 0, ties: 4, p: 1, unsolved: 1 },
      against: null,
      reading: NO_STEP,
    });
    expect(s.asked).toHaveLength(16);
    expect(s.asked.some(({ side }) => side === "baseline")).toBe(false);
  });

  it("reads a win over the reference that loses to the baseline as below the baseline, and no step", async () => {
    // The reference harness answers nothing, the new one once in two solves, the baseline always.
    const below: Table = (_version, side, nth) => {
      if (side === "old") return LATE;
      return side === "baseline" || nth === 0 ? PASS : LATE;
    };
    const s = await setup([edit, finish], below);
    expect(await round(s.request)).toMatchObject({
      scored: { wins: 4, losses: 0, p: 0.0625 },
      against: { wins: 0, losses: 4 },
      reading: "below-baseline",
    });
    // As many wins as losses against the baseline is enough: the gate asks for no fewer.
    const even = await setup([edit, finish], (version, side, nth) => {
      if (side === "old") return LATE;
      const ahead = version === "s1" || version === "s2";
      return (side === "fresh") === ahead || nth === 0 ? PASS : LATE;
    });
    expect(await round(even.request)).toMatchObject({ against: { wins: 2, losses: 2 }, reading: "step" });
  });

  it("has no second test to make where the reference harness is the baseline", async () => {
    const s = await setup([edit, finish], step);
    const report = await round({ ...s.request, baseline: { dir: s.parent, digest: s.old } });
    expect(report).toMatchObject({ scored: { wins: 4, losses: 0 }, against: null, reading: "step" });
    expect(s.asked).toHaveLength(16);
    expect(s.asked.some(({ side }) => side === "baseline")).toBe(false);
  });

  it("compares with the reference harness, whatever harness the session started from", async () => {
    const original = readFileSync(join(FIXTURE, "agent", "BUILT_AGENTS.md"), "utf8");
    const back = call("write_file", { path: "agent/BUILT_AGENTS.md", content: original });
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
  });

  it("solves both harnesses afresh at every comparison, and counts no solve made before it began", async () => {
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
  });

  it("goes on with the tasks and the terms it began with, and refuses other terms under its id", async () => {
    let stop = 10;
    const s = await setup([edit, finish], (version, side, nth, digest) => {
      stop -= 1;
      if (stop === 0) throw new Error(STOPS);
      return step(version, side, nth, digest);
    });
    await expect(round(s.request)).rejects.toThrow(STOPS);
    // Its solves so far were made for two solves a side, no budget to be read at and no cap.
    await expect(round({ ...s.request, solves: 3 })).rejects.toThrow(
      "comparison b-1 began on other terms (solves), and its solves so far were made for those",
    );
    await expect(round({ ...s.request, budgets: [{ turns: 5 }] })).rejects.toThrow("other terms (budgets)");
    await expect(round({ ...s.request, cap: { dollars: 500, reserve: 10 } })).rejects.toThrow(
      "other terms (cap)",
    );
    await expect(round({ ...s.request, noise: true, level: 0.05 })).rejects.toThrow(
      "other terms (level, noise)",
    );
    // Asked again with a longer list, it scores the tasks it began with: the set was fixed before
    // any result could be seen.
    const report = await round({ ...s.request, tasks: [...HELD, "s5"] });
    expect(report).toMatchObject({ versions: HELD, scored: { wins: 4 }, reading: "step" });
    expect(s.asked.some(({ version }) => version === "s5")).toBe(false);
    expect(s.of("comparison.started")).toHaveLength(1);
    expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ tasks: 4 });
  });

  it("goes on from its log when a solve stopped it: the session is not run again, nor a counted solve", async () => {
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
    expect(report).toMatchObject({ scored: { wins: 4, losses: 0 }, against: { wins: 4 }, reading: "step" });
    expect(s.sessions()).toBe(1);
    expect(s.of("build.started")).toHaveLength(1);
    // Nine solves were counted before the stop: seven of the sixteen were left, and the baseline's.
    expect(s.asked.slice(before)).toHaveLength(7 + 8);
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
    const reading = async (solve: string, version: string): Promise<RefereeFinding> => {
      refereed.push(version);
      if (version === "s3") throw new Error("the reader failed");
      return await ruled(solve, version);
    };
    const report = await round({ ...s.request, referee: reading });
    // s2's check could not run, s1's rejections are ruled a check defect and s3's are ruled by
    // nobody. One task is left, which no sign test at 0.10 can pass.
    expect(report).toMatchObject({
      scored: { wins: 1, losses: 0, p: 0.5 },
      // Were the rejections of s1 and s3 to stand, the new harness would have won those as well.
      counted: { wins: 3, losses: 0, p: 0.125 },
      versions: ["s4"],
      disputed: ["s2"],
      aside: ["s1", "s3"],
      reading: NO_STEP,
    });
    // Only the task whose check could not run is disputed for good. A ruling sets a task aside for
    // this comparison, and a person decides what becomes of it.
    const states = taskStates(read(s.log));
    expect([states.get("s1"), states.get("s2"), states.get("s3")]).toEqual(["held", "disputed", "held"]);
    expect(s.of(TASK_STATE).filter(({ state }) => state === "disputed")).toMatchObject([
      { version: "s2", reason: "its own check could not run on an answer" },
    ]);
    // A disputed task is solved no further: s2 once, and never again.
    expect(s.asked.filter(({ version }) => version === "s2")).toEqual([{ version: "s2", side: "fresh" }]);
    // Only a rejected answer is read: the two of s1 and of s3, and neither of s4's late solves.
    expect(refereed.toSorted()).toEqual(["s1", "s1", "s3", "s3"]);
    expect(s.of(COMPARISON_REPORTED)[0]?.reviewFaults).toHaveLength(2);
  });

  it("sets every rejection aside where no reviewer is seated, and reads it once a person has labelled them", async () => {
    // The plan's first experiment is read this way: hand labels stand in for the Judge.
    const s = await setup([edit, finish], rejecting);
    const report = await round(s.request);
    expect(report).toMatchObject({
      scored: { wins: 0, losses: 0, ties: 0, p: 1 },
      counted: { wins: 4, losses: 0, p: 0.0625 },
      versions: [],
      aside: HELD,
      against: null,
      reading: NOT_SCORED,
    });
    // No test cleared its level, so the baseline was not solved.
    expect(s.asked).toHaveLength(16);
    const asked = toLabel(read(s.log), "b-1");
    expect(asked.aside).toHaveLength(8);
    expect(asked.others).toEqual([]);
    const settled = settleReading(
      s.log,
      "b-1",
      new Map(asked.aside.map((solve) => [solve, "earned"] as const)),
    );
    // The labels restore every task, and the test clears its level with no baseline solve to hold
    // it to: a settling makes no solve.
    expect(settled).toMatchObject({
      scored: { wins: 4, losses: 0 },
      counted: null,
      versions: HELD,
      aside: [],
      against: null,
      reading: BASELINE_UNREAD,
      settled: { labelled: 8, defects: 0, disputed: [], restored: HELD },
    });
    expect(s.asked).toHaveLength(16);
    // The new harness is then compared with the baseline in a comparison of its own.
    const fresh = { dir: join(s.request.session.states, settled.fresh ?? ""), digest: settled.fresh ?? "" };
    expect(await checkpoint(s.compare("g5", { old: s.baseline, fresh }))).toMatchObject({
      scored: { wins: 4, losses: 0 },
      reading: "step",
    });
  });

  it("settles a comparison on a person's labels, and writes its report once more", async () => {
    const ruledOn = async () => {
      const s = await setup([edit, finish, again, finish], rejecting);
      const report = await round({ ...s.request, referee: referee(s.log, { s1: "check-defect" }) });
      expect(report).toMatchObject({
        scored: { wins: 3, losses: 0, p: 0.125 },
        counted: { wins: 4, losses: 0 },
        versions: ["s2", "s3", "s4"],
        aside: ["s1"],
        reading: NO_STEP,
        settled: null,
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
    const [one = ""] = defect.asked.aside;
    expect(() => settleReading(defect.s.log, "b-1", labelled([one], "earned"))).toThrow(
      "1 of 2 rejections that set a task aside carry no label",
    );
    expect(() => settleReading(defect.s.log, "b-1", labelled(["r-0-0"], "earned"))).toThrow(
      "is no rejected answer",
    );
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
    expect(settled.settled?.labels).toEqual(Object.fromEntries(labelled(defect.asked.aside, "check-defect")));
    expect(settleReading(defect.s.log, "b-1", labelled(defect.asked.aside, "check-defect"))).toEqual(settled);
    expect(() => settleReading(defect.s.log, "b-1", labelled(defect.asked.aside, "earned"))).toThrow(
      "comparison b-1 is settled already, and these labels are not the ones it was settled on",
    );
    expect(() => settleReading(defect.s.log, "b-1", new Map())).toThrow("is settled already");
    expect(defect.s.of(COMPARISON_REPORTED)).toHaveLength(2);
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
      reading: BASELINE_UNREAD,
      settled: { labelled: 2, defects: 0, disputed: [], restored: ["s1"] },
    });
    expect(taskStates(read(earned.s.log)).get("s1")).toBe("held");

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
    expect(settleReading(over.s.log, "b-1", labels)).toMatchObject({
      scored: { wins: 3, losses: 0 },
      versions: ["s1", "s3", "s4"],
      disputed: ["s2"],
      settled: { labelled: 3, defects: 1, disputed: ["s2"], restored: ["s1"] },
    });

    // A task a person refused as infeasible after the comparison stays refused: a label that calls
    // its rejection a check defect is kept, moves no state, and leaves the task set aside.
    const refused = await ruledOn();
    append(refused.s.log, TASK_STATE, { version: "s1", state: "refused" });
    expect(settleReading(refused.s.log, "b-1", labelled(refused.asked.aside, "check-defect"))).toMatchObject({
      versions: ["s2", "s3", "s4"],
      aside: ["s1"],
      disputed: [],
      settled: { labelled: 2, defects: 2, disputed: [] },
    });
    expect(taskStates(read(refused.s.log)).get("s1")).toBe("refused");
  });

  it("settles nothing where no label is given: a comparison with no task set aside stays open to labels", async () => {
    const s = await setup([edit, finish], rejecting);
    await round({ ...s.request, referee: referee(s.log) });
    expect(toLabel(read(s.log), "b-1").aside).toEqual([]);
    expect(() => settleReading(s.log, "b-1", new Map())).toThrow(
      "comparison b-1 has no rejection that set a task aside, and no label is given",
    );
    expect(s.of(COMPARISON_REPORTED)).toHaveLength(1);
    // A label over a ruling can still settle it afterwards.
    const [one = ""] = toLabel(read(s.log), "b-1").others;
    expect(settleReading(s.log, "b-1", new Map([[one, "check-defect"]]))).toMatchObject({
      disputed: ["s1"],
      settled: { labelled: 1, defects: 1 },
    });
  });

  it("keeps a ruling across a stop: the first run's is in the log and is read from there", async () => {
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
  });

  it("puts to the Referee, when it goes on, the rejections an earlier run left unruled", async () => {
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
  });

  it("reads a round whose tasks are all set aside as not scored, which is not a test that found no gain", async () => {
    const s = await setup([edit, finish], rejecting);
    const report = await round(s.request);
    expect(report).toMatchObject({ scored: { wins: 0, losses: 0, ties: 0, p: 1 }, versions: [] });
    expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ tasks: 4, reading: NOT_SCORED });
    // It tallied nothing, and is no checkpoint of the stop rule.
    expect(stopRule(read(s.log))).toMatchObject({ checkpoints: 0 });
  });

  it("stops, to go on from its log, when the provider answers no solve of three tasks in a row", async () => {
    // exam-1, 2026-10-08: the login reached its session limit mid-run and every solve after it
    // ended in three seconds. A round that solved on would have reported every task short.
    let left = 9;
    const s = await setup([edit, finish], (version, side, nth, digest) => {
      left -= 1;
      return left < 0 ? LIMITED : step(version, side, nth, digest);
    });
    await expect(round(s.request)).rejects.toThrow(
      "the provider answered no solve of 3 tasks in a row, so the comparison stops: You've hit your session limit",
    );
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
    expect(s.asked.length).toBeLessThan(16);
    // The limit lifted: the round goes on, with the session it had and the nine solves it counted.
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
    // Two passes over what was unsolved, each asking for s4's two solves under the new harness.
    expect(s.asked.filter(({ version, side }) => version === "s4" && side === "fresh")).toHaveLength(4);
  });

  it("leaves out and names a task a person released or refused while the comparison ran", async () => {
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
  });

  it("goes on after a task left the set while it was stopped, and disputes no task a person refused", async () => {
    let solved = 0;
    let refused = false;
    const s = await setup([], (version, side, nth, digest) => {
      solved += 1;
      if (solved === 6) throw new Error(STOPS);
      // The check of s3 cannot run on an answer, in a solve that ends after a person refused s3.
      if (solved > 6 && version === "s3" && !refused) {
        refused = true;
        append(s.log, TASK_STATE, { version: "s3", state: "refused" });
        return { outcome: "non-result", kind: "check", reason: "the check crashed" };
      }
      return step(version, side, nth, digest);
    });
    await expect(checkpoint(s.compare("g0"))).rejects.toThrow(STOPS);
    append(s.log, TASK_STATE, { version: "s4", state: "released" });
    // Asked for again as it began, with the task that is now practice among its tasks.
    const report = await checkpoint(s.compare("g0"));
    expect(report).toMatchObject({ versions: ["s1", "s2"], withdrawn: ["s3", "s4"], disputed: [] });
    expect(taskStates(read(s.log)).get("s3")).toBe("refused");
    expect(s.asked.slice(6).some(({ version }) => version === "s4")).toBe(false);
    // Under another id the same tasks are refused, as any new comparison's would be.
    await expect(checkpoint(s.compare("g1"))).rejects.toThrow("task s3 is refused");
  });

  it("stops on more check defects than it allows, and says so in place of a reading", async () => {
    const s = await setup([edit, finish], () => REJECTED);
    const ruled = { s1: "check-defect", s2: "check-defect", s3: "check-defect" } as const;
    const report = await round({ ...s.request, referee: referee(s.log, ruled), defects: 1 });
    expect(report).toMatchObject({
      scored: null,
      aside: ["s1", "s2"],
      disputed: [],
      capped: false,
      reading: "check-defects",
    });
    // The round stopped at the second task with a check defect: three solves, and no more.
    expect(s.asked).toEqual([
      { version: "s1", side: "old" },
      { version: "s1", side: "fresh" },
      { version: "s2", side: "fresh" },
    ]);
    expect(stopRule(read(s.log))).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
  });

  it("stops the campaign after three comparisons without a step", async () => {
    // Every answer is valid: nothing separates any two harnesses.
    const s = await setup([edit, finish, again, finish, third, finish], () => PASS);
    for (const [index, id] of ["b-1", "b-2", "b-3"].entries()) {
      const report = await round(s.next(id));
      expect(report).toMatchObject({ scored: { wins: 0, losses: 0, ties: 4 }, reading: NO_STEP });
      expect(stopRule(read(s.log))).toEqual({
        checkpoints: index + 1,
        sinceStep: index + 1,
        stop: id === "b-3",
      });
    }
    // Sixteen solves a comparison, and no baseline solve where none read a step.
    expect(s.asked).toHaveLength(48);
  });

  it("runs four solves side by side to the same reading", async () => {
    const s = await setup([edit, finish], step);
    const report = await round({ ...s.request, concurrency: 4 });
    expect(report).toMatchObject({
      scored: { wins: 4, losses: 0, ties: 0 },
      against: { wins: 4, losses: 0, ties: 0 },
      short: [],
      reading: "step",
    });
    expect(s.asked).toHaveLength(24);
    expect(s.solved()).toHaveLength(24);
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
    await expect(checkpoint(s.compare("g0", { tasks: [] }))).rejects.toThrow("no task to score");
    expect(s.of("comparison.started")).toEqual([]);
    // A flag misread on a command line is no number, and a round that ran no solve would say it had.
    await expect(round({ ...s.request, concurrency: Number("four") })).rejects.toThrow("whole numbers");
    await expect(round({ ...s.request, solves: 0 })).rejects.toThrow("whole numbers");
    await expect(round({ ...s.request, level: 10 })).rejects.toThrow("level lies between 0 and 1");
    await expect(round({ ...s.request, cap: { dollars: Number("many"), reserve: 10 } })).rejects.toThrow(
      "a cap and its reserve are dollars",
    );
    await expect(round({ ...s.request, cap: { dollars: 100, reserve: 0 } })).rejects.toThrow("a cap and its");
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

describe("a checkpoint with no session", () => {
  it("sets the minimal baseline against the harness the campaign starts with, the plan's first experiment", async () => {
    // The bare solver answers one task of four within its limits, and the existing harness all.
    const s = await setup([], (version, side) => (side === "baseline" && version !== "s4" ? LATE : PASS));
    const report = await checkpoint(s.compare("g0"));
    expect(report).toMatchObject({
      old: s.old,
      fresh: s.baseline.digest,
      // The gate reads the untied tasks: three of four here, all of them the existing harness's.
      scored: { wins: 0, losses: 3, ties: 1, p: 1, unsolved: 0 },
      against: null,
      reading: NO_STEP,
    });
    // Two harnesses, four tasks, two solves, and no Builder session in the log.
    expect(s.asked).toHaveLength(16);
    expect(s.of("build.started")).toEqual([]);
    expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ session: "g0", tasks: 4 });
    expect(await checkpoint(s.compare("g0"))).toEqual(report);
    expect(s.asked).toHaveLength(16);
    // One harness on both sides is no comparison.
    await expect(checkpoint(s.compare("aa", { fresh: { dir: s.parent, digest: s.old } }))).rejects.toThrow(
      "a comparison sets two harnesses against each other, and both sides are",
    );
  });

  it("reads the same solves at the budgets it fixed before its first solve", async () => {
    // Both arms answer everything within the full limit: the harness in twenty turns, the bare
    // solver in eight and then ten.
    const s = await setup([], (_version, side, nth) => ({
      ending: PASS,
      turns: side === "old" ? 20 : 8 + 2 * nth,
    }));
    const budgets = [{ turns: 12 }, { turns: 9 }, { turns: 5 }];
    const report = await checkpoint(s.compare("g0", { budgets }));
    expect(report).toMatchObject({
      scored: { wins: 0, losses: 0, ties: 4 },
      budgets: [
        // At twelve turns the harness has no answer yet, and at nine the bare solver has one of two.
        { turns: 12, wins: 4, losses: 0, ties: 0, p: 0.0625 },
        { turns: 9, wins: 4, losses: 0, ties: 0, p: 0.0625 },
        // At five nobody has answered, which is four ties and no evidence.
        { turns: 5, wins: 0, losses: 0, ties: 4, p: 1 },
      ],
      // Between two solves of one arm on one task the turns moved by a quarter at most.
      spread: { turns: { tasks: 8, median: 1.125, most: 1.25 } },
      billed: { old: BILLED, fresh: BILLED },
      // The reading is the full limit's: a budget is read, and decides nothing here.
      reading: NO_STEP,
    });
    expect(s.of("comparison.started")[0]).toMatchObject({ budgets });
  });

  it("reads the reference harness against itself beside the test, on solves of its own", async () => {
    // The plan's A/A comparison. The harness answers s1 in its first two solves and not after.
    const s = await setup([], (version, side, nth) => {
      if (side === "baseline") return LATE;
      return version === "s1" && nth >= 2 ? LATE : PASS;
    });
    const report = await checkpoint(s.compare("g2", { noise: true }));
    expect(report).toMatchObject({
      // The test takes the reference harness's first two solves of a task, in the order they started.
      scored: { wins: 0, losses: 4, ties: 0 },
      // Its later two against those: three ties, and one task its own noise split.
      noise: { wins: 0, losses: 1, ties: 3, p: 1 },
      reading: NO_STEP,
    });
    // Four tasks: four solves under the reference harness and two under the baseline, as G2 costs.
    expect(s.asked.filter(({ side }) => side === "old")).toHaveLength(16);
    expect(s.asked.filter(({ side }) => side === "baseline")).toHaveLength(8);
  });

  it("stops at its dollar cap, reads not scored, and is finished", async () => {
    const s = await setup([], () => PASS);
    // Each solve is billed two dollars and held at three before it starts: the sixth would take
    // ten billed and three reserved past eleven.
    const report = await checkpoint(s.compare("g0", { cap: { dollars: 11, reserve: 3 } }));
    expect(report).toMatchObject({ scored: null, versions: [], capped: true, reading: NOT_SCORED });
    expect(s.asked).toHaveLength(5);
    expect(s.of("comparison.started")[0]).toMatchObject({ cap: { dollars: 11, reserve: 3 } });
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

  it("reports its test when the cap cuts the baseline's solves, as unread against the baseline", async () => {
    const s = await setup([edit, finish], step);
    const built = await round(s.next("b-0"));
    const fresh = { dir: join(s.request.session.states, built.fresh ?? ""), digest: built.fresh ?? "" };
    // Sixteen solves of the test at two dollars, and the cap holds one more with its reserve.
    const capped = await checkpoint(s.compare("g1", { fresh, cap: { dollars: 35, reserve: 3 } }));
    expect(capped).toMatchObject({
      scored: { wins: 4, losses: 0 },
      versions: HELD,
      against: null,
      capped: true,
      reading: BASELINE_UNREAD,
    });
    expect(s.asked.filter(({ side }) => side === "baseline")).toHaveLength(8 + 1);
    // It reported, and is finished: the harness is read against the baseline in its own comparison.
    expect(await checkpoint(s.compare("g1", { fresh, cap: { dollars: 35, reserve: 3 } }))).toEqual(capped);
  });

  it("holds a step to the baseline's solves of every tallied task, also after a stop among them", async () => {
    let solved = 0;
    const s = await setup([edit, finish], (version, side, nth, digest) => {
      solved += 1;
      // The seventh of the baseline's eight solves stops the run.
      if (solved === 16 + 7) throw new Error(STOPS);
      // The baseline answers the last task, which a tally of the first three would not hold.
      return side === "baseline" && version === "s4" ? PASS : step(version, side, nth, digest);
    });
    await expect(round(s.request)).rejects.toThrow(STOPS);
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
    const report = await round(s.request);
    expect(report).toMatchObject({ against: { wins: 3, losses: 0, ties: 1 }, reading: "step" });
    // The six it had were not made again.
    expect(s.asked.filter(({ side }) => side === "baseline")).toHaveLength(7 + 2);
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

describe("the scored set", () => {
  const at = "2026-10-09T00:00:00.000Z";
  const heldOut = (versions: readonly string[]): LogEvent[] =>
    versions.flatMap((version) => [
      { at, kind: "task.proposed", data: { version } } as const,
      { at, kind: "task.gate", data: { version, gate: 1, outcome: "passed" } } as const,
    ]);
  const held = ["v1", "v2", "v3", "v4", "v5", "v6"];

  it("is drawn from the held-out tasks by the contract alone, so no result chooses it", () => {
    const drawn = scoredSet(heldOut(held), 4, "contract-a");
    expect(drawn).toHaveLength(4);
    expect(scoredSet(heldOut(held.toReversed()), 4, "contract-a")).toEqual(drawn);
    expect(scoredSet(heldOut(held), 4, "contract-b")).not.toEqual(drawn);
    // A task written since takes a place by its own rank and moves no other task's.
    const grown = scoredSet(heldOut([...held, "v7"]), 7, "contract-a").filter((version) => version !== "v7");
    expect(grown).toEqual(scoredSet(heldOut(held), 6, "contract-a"));
    // A practice task is no held-out task.
    const released = [
      ...heldOut(held),
      { at, kind: TASK_STATE, data: { version: "v3", state: "released" } } as const,
    ];
    expect(scoredSet(released, 12, "contract-a")).not.toContain("v3");
  });

  it("is every held-out task where the campaign holds fewer than were asked for", () => {
    expect(scoredSet(heldOut(held), 12, "contract-a").toSorted()).toEqual(held);
    expect(scoredSet([], 12, "contract-a")).toEqual([]);
  });

  it("leaves out a task no harness answered validly in two comparisons in a row, until a person keeps it", async () => {
    const s = await setup([edit, finish, again, finish], (version) => (version === "s1" ? LATE : PASS));
    await round(s.request);
    expect(awaitingLabel(read(s.log))).toEqual([]);
    expect(scoredSet(read(s.log), 12, "c")).toContain("s1");
    await round(s.next("b-2"));
    expect(awaitingLabel(read(s.log))).toEqual(["s1"]);
    expect(scoredSet(read(s.log), 12, "c").toSorted()).toEqual(["s2", "s3", "s4", "s5"]);
    append(s.log, TASK_STATE, {
      version: "s1",
      state: "held",
      reason: "a person read the task as feasible",
    });
    expect(scoredSet(read(s.log), 12, "c")).toContain("s1");
  });
});
