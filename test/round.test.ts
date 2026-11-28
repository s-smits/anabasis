// One round on stand-ins: the real session on the faux provider with a host write for the walled one,
// and solves that end as a table says. Under test: a round's order, which solves it counts and makes,
// what it leaves out of a comparison, its cap and its reading.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  fixedIn,
  judgingLeft,
  overlapOf,
  passesIn,
  predicted,
  swapped,
  toLabel,
} from "../src/campaign/comparison.ts";
import type { PassLabel } from "../src/audit/agreement.ts";
import {
  type CheckpointRequest,
  checkpoint,
  type Judging,
  frontierOverlap,
  OVERLAP_LIMIT,
  refuseTerms,
  scoredSet,
} from "../src/campaign/round.ts";
import { settleReading } from "../src/campaign/settle.ts";
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
import { draw, informative, pairsOf } from "../src/kernel/compare.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { stopRule } from "../src/campaign/admission.ts";
import { lastReports, latestBuilt, pairsReported, poolOf } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { passed, ranUnder } from "../src/kernel/solves.ts";
import { taskSets, taskStates } from "../src/kernel/task.ts";
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
import type { AuditFinding, Ruling } from "../src/audit/auditor.ts";
import { text, tool } from "../src/tools/answer.ts";
import { openHarness } from "../src/harness/open.ts";
import { arrayWith, copies, objectWith } from "./helpers/matchers.ts";

const COMPARISON_REPORTED = "comparison.reported";
const COMPARISON_STARTED = "comparison.started";
const TASK_STATE = "task.state";
const STOPS = "the run stops";

type Side = "old" | "fresh" | "starter";
interface Used {
  readonly ending: Ending;
  readonly turns?: number;
  readonly objective?: number;
}
/** How a solve of `version` under a harness ends, by how many came before it; a table telling two
 *  new harnesses apart reads the digest. */
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
const FAMILIES = new Map([
  ["p1", "f1"],
  ["s1", "f1"],
  ["s2", "f1"],
]);
const PASS: Ending = { outcome: "pass" };
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
const LATE: Ending = { outcome: "fail", kind: "wall-ended" };
const UNANSWERED: Ending = { outcome: "fail", kind: "no-answer" };
const BILLED = 2;
const NOT_SCORED = "not-scored";
const NO_STEP = "no-step";
const LIMITED: Ending = { outcome: "non-result", kind: "provider", reason: "You've hit your session limit" };
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
 * A scratch with the fixture harness as reference and the Builder's parent, as after a promotion,
 * the same harness under another guide as the starter, and a log with p1 released and s1 to s5 held
 * out, or a copy of the log `from`. `responses` are the Builder's turns; `table` ends the solves.
 */
async function setup(responses: FauxResponseStep[], table: Table, from?: string) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-round-")));
  scratches.push(scratch);
  const parent = join(scratch, "parent");
  const lesser = join(scratch, "starter");
  const better = join(scratch, "made");
  const log = join(scratch, "log.jsonl");
  for (const [dir, guide] of [
    [parent, null],
    [lesser, "No guide.\n"],
    [better, "Multiply first.\n"],
  ] as const) {
    cpSync(FIXTURE, dir, { recursive: true });
    if (guide !== null) writeFileSync(join(dir, "agent", "BUILT_AGENTS.md"), guide);
  }
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  if (from === undefined) {
    for (const version of ["p1", ...HELD, "s5"]) {
      record("task.proposed", { version, family: FAMILIES.get(version) ?? "f2" });
      record("task.gate", passedPackageCheck(version));
    }
    record(TASK_STATE, { version: "p1", state: "released" });
  } else cpSync(from, log);
  const code = { value: "h1", bun: Bun.version };
  const old = (await openHarness(parent)).digest;
  const starter = { dir: lesser, digest: (await openHarness(lesser)).digest };
  const made = { dir: better, digest: (await openHarness(better)).digest };
  const condition = (task: string, harness: string): Condition => ({
    contract: "c1",
    harness,
    task,
    model: "faux/faux-solver",
    effort: "medium",
    prices: { "faux/faux-solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    runtime: { bun: code.bun },
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
  const walled = (bench: Bench) => [
    tool({
      name: "write",
      description: "Writes a file in the home.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (args) => {
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
  const request: Omit<CheckpointRequest, "log" | "id" | "old" | "fresh"> & {
    readonly session: BuildRequest;
    readonly builder: (request: BuildRequest) => Promise<Built>;
    readonly reference: CheckpointRequest["old"];
  } = {
    session: build,
    builder,
    reference: { dir: parent, digest: old },
    starter,
    tasks: HELD,
    retained: [],
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
  const solved = () => of("solve.finished").filter(({ solve: id }) => isString(id) && id.startsWith("r-"));
  const compare = (id: string, more: Partial<CheckpointRequest> = {}): CheckpointRequest => {
    const { session: _session, builder: _builder, reference, ...terms } = request;
    return { ...terms, setting: request.setting, log, id, old: reference, fresh: starter, ...more };
  };
  const paired = (id: string, more: Partial<CheckpointRequest> = {}) => compare(id, { fresh: made, ...more });
  /** A session from `start`, then the comparison of its harness with the reference under the
   *  session's id, as a campaign runs them: one cap and one kill hold both. */
  const built = async (id = "b-1", more: Partial<CheckpointRequest> = {}, start = parent) => {
    const { kept } = await sessionOnce(
      { ...build, id, parent: start, cap: more.cap, ...keyIfDefined("kill", more.kill) },
      builder,
    );
    if (kept === null) throw new Error(`session ${id} left no harness`);
    return await checkpoint(compare(id, { fresh: kept, ...more }));
  };
  return {
    request,
    built,
    compare,
    paired,
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

const step: Table = (_version, side) => (side === "fresh" ? PASS : LATE);
const rejecting: Table = (_version, side) => (side === "fresh" ? PASS : side === "old" ? REJECTED : LATE);

async function compared(table: Table, more: Partial<CheckpointRequest> = {}) {
  const s = await setup([], table);
  return { s, report: await checkpoint(s.paired("g0", more)) };
}

const passedPackageCheck = (version: string) => ({ version, gate: 1, outcome: "passed" });

const stoppedAtFirst = (asked: readonly { readonly version: string }[]) => {
  const last = asked.at(-1)?.version;
  return asked.filter(({ version }) => version === last).length === 1;
};

const referee =
  (log: string, ruled: Readonly<Record<string, Ruling>> = {}) =>
  async (solve: string, version: string): Promise<AuditFinding> => {
    const ruling = ruled[version] ?? "solver-fail";
    append(log, "referee.finding", { solve, ruling });
    return {
      ruling,
      check: ruling === "solver-fail" ? null : "check-7",
      rule: "R1",
      field: "answer",
      reason: "r",
      probes: [],
    };
  };

function countedStarts(request: CheckpointRequest, task: string) {
  return ranUnder(read(request.log)).filter(
    (solve) => solve.start.comparison === request.id && solve.under.task === task && passed(solve) !== null,
  );
}

function expectMirrored(request: CheckpointRequest) {
  const events = read(request.log);
  const { pairs, short } = pairsOf(
    events,
    request.tasks,
    {
      ...request,
      old: request.old.digest,
      fresh: request.fresh.digest,
      comparison: request.id,
      judge: undefined,
    },
    request.solves,
  );
  expect(short).toEqual([]);
  expect(pairs).toHaveLength(request.tasks.length);
  const order = draw(request.tasks, request.tasks.length, request.id);
  for (const pair of pairs) {
    if (pair.solves === undefined) throw new Error("the pair has no counted solve ids");
    const selected = new Set([...pair.solves.old, ...pair.solves.fresh]);
    const actual = countedStarts(request, pair.task)
      .filter(({ id }) => selected.has(id))
      .map(({ under }) => under.harness);
    const expected = Array.from({ length: request.solves }, (_, at) =>
      (order.indexOf(pair.task) + at) % 2 === 0
        ? [request.old.digest, request.fresh.digest]
        : [request.fresh.digest, request.old.digest],
    ).flat();
    expect(actual).toEqual(expected);
  }
}

describe("a task's ordered solves", () => {
  it.each(["load", "backoff", "reset"])(
    "holds a task through a deferred %s while other tasks advance",
    async (wait) => {
      const release = Promise.withResolvers<void>();
      const advanced = Promise.withResolvers<void>();
      const order = draw(HELD, HELD.length, "g-order");
      const first = order[0] ?? "";
      let failed = false;
      const s = await setup([], (version) => {
        if (version !== first || wait === "load" || failed) return PASS;
        failed = true;
        return {
          outcome: "non-result",
          kind: "provider",
          reason: wait === "reset" ? "limit reached|1792886400" : "connection lost",
        };
      });
      const calls = new Map<string, number>();
      const active = new Map<string, number>();
      let running = 0;
      let peak = 0;
      let taskPeak = 0;
      const request = s.compare("g-order", {
        solves: 4,
        concurrency: 4,
        solve: async (version, harness, comparison) => {
          running += 1;
          peak = Math.max(peak, running);
          active.set(version, (active.get(version) ?? 0) + 1);
          taskPeak = Math.max(taskPeak, active.get(version) ?? 0);
          const nth = calls.get(version) ?? 0;
          calls.set(version, nth + 1);
          try {
            if (version === first && nth === 0) {
              if (wait !== "load") {
                await s.solve(version, harness.digest, comparison);
              }
              await release.promise;
            }
            const result = await s.solve(version, harness.digest, comparison);
            if (version !== first && nth === 7) advanced.resolve();
            return result;
          } finally {
            running -= 1;
            active.set(version, (active.get(version) ?? 0) - 1);
          }
        },
      });
      const work = checkpoint(request);
      try {
        await advanced.promise;
        expect(countedStarts(request, first)).toEqual([]);
      } finally {
        release.resolve();
        await work;
      }
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(4);
      expect(taskPeak).toBe(1);
      expectMirrored(request);
      expect(s.of("solve.started")).toHaveLength(wait === "load" ? 32 : 33);
    },
  );

  it.each([1, 2])(
    "retries a non-result at its slot and stops the task after %s refusals",
    async (failures) => {
      const first = draw(HELD, HELD.length, "g-outer")[0] ?? "";
      let calls = 0;
      const s = await setup([], (version) => {
        if (version !== first) return PASS;
        calls += 1;
        return calls > 1 && calls <= 1 + failures
          ? { outcome: "non-result", kind: "provider", reason: "connection lost" }
          : PASS;
      });
      const request = s.compare("g-outer", { solves: 4, concurrency: 4 });
      const report = await checkpoint(request);
      if (failures === 1) {
        expect(report.short).toEqual([]);
        expectMirrored(request);
      } else {
        expect(report.short).toEqual([first]);
        expect(calls).toBe(3);
        expect(countedStarts(request, first).map(({ under }) => under.harness)).toEqual([s.old]);
      }
    },
  );

  it.each(["kill", "withdraw", "reserve"])("rechecks %s before retrying a partial task", async (stop) => {
    const kill = new AbortController();
    const first = draw(HELD, HELD.length, "g-partial")[0] ?? "";
    let calls = 0;
    const s = await setup([], (version) => {
      if (version !== first) return PASS;
      calls += 1;
      if (calls !== 2) return PASS;
      if (stop === "kill") kill.abort();
      if (stop === "withdraw") append(s.log, TASK_STATE, { version, state: "released" });
      return { outcome: "non-result", kind: "provider", reason: "connection lost" };
    });
    const request = s.compare("g-partial", {
      solves: 4,
      kill: kill.signal,
      ...keyIfDefined("cap", stop === "reserve" ? { dollars: 5, reserve: 3 } : undefined),
    });
    const work = checkpoint(request);
    if (stop === "kill") await expect(work).rejects.toThrow("the comparison was killed");
    else expect(await work).toMatchObject(stop === "reserve" ? { capped: true } : { withdrawn: [first] });
    expect(calls).toBe(2);
    expect(countedStarts(request, first).map(({ under }) => under.harness)).toEqual([s.old]);
  });

  it("returns a partial task for another worker when reserve is temporarily held", async () => {
    const s = await setup([], () => PASS);
    const release = Promise.withResolvers<void>();
    const progressed = Promise.withResolvers<void>();
    const first = draw(HELD, HELD.length, "g-reserve")[0] ?? "";
    let calls = 0;
    let held = false;
    const request = s.compare("g-reserve", {
      solves: 4,
      concurrency: 4,
      cap: { dollars: 70, reserve: 20 },
      solve: async (version, harness, comparison) => {
        if (version === first && !held) {
          held = true;
          await release.promise;
        }
        const result = await s.solve(version, harness.digest, comparison);
        calls += 1;
        if (calls === 16) progressed.resolve();
        return result;
      },
    });
    const work = checkpoint(request);
    try {
      await progressed.promise;
      expect(countedStarts(request, first)).toEqual([]);
    } finally {
      release.resolve();
      await work;
    }
    expect(s.asked).toHaveLength(26);
    for (const task of HELD) {
      const starts = countedStarts(request, task);
      const at = draw(HELD, HELD.length, request.id).indexOf(task);
      const mirror = Array.from({ length: 4 }, (_, slot) =>
        (at + slot) % 2 === 0 ? [s.old, s.starter.digest] : [s.starter.digest, s.old],
      ).flat();
      expect(starts.map(({ under }) => under.harness)).toEqual(mirror.slice(0, starts.length));
    }
  });

  it.each(["throw", "exhaust"])("continues an unequal counted prefix left by %s", async (stop) => {
    const first = draw(HELD, HELD.length, "g-continue")[0] ?? "";
    let calls = 0;
    let stopping = true;
    const s = await setup([], (version) => {
      if (!stopping) return PASS;
      if (version !== first) throw new Error(STOPS);
      calls += 1;
      if (calls === 1) return PASS;
      if (stop === "throw") throw new Error(STOPS);
      return { outcome: "non-result", kind: "provider", reason: "connection lost" };
    });
    const request = s.compare("g-continue", { solves: 4 });
    await expect(checkpoint(request)).rejects.toThrow(STOPS);
    expect(countedStarts(request, first).map(({ under }) => under.harness)).toEqual([s.old]);
    expect(calls).toBe(stop === "throw" ? 2 : 3);
    stopping = false;
    expect(await checkpoint(request)).toMatchObject({ short: [] });
    expectMirrored(request);
  });
});

describe("a round", () => {
  it("runs the session, then solves the reference and the new harness in turn on every task, and reports what it compared", async () => {
    const s = await setup([edit, finish], step);
    const report = await s.built();
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
        // Each task won by two pairs for each valid answer more. Four untied tasks detect a harness
        // that wins 95% of them four times in five, and an attempt at their margins promotes equal
        // harnesses 1 in 16.
        scored: {
          ...tested,
          differences: [1000, 1000, 1000, 1000],
          unsolved: 0,
          detectable: 0.95,
          falseRate: 1 / 16,
        },
        frontier: {
          ...tested,
          tasks: HELD,
          aside: [],
          differences: [1000, 1000, 1000, 1000],
          of: HELD,
        },
        retained: "unmeasured",
        families: {
          f1: { frontier: { wins: 2, losses: 0, ties: 0 } },
          f2: { frontier: { wins: 2, losses: 0, ties: 0 } },
        },
        overlap: null,
        // Every task is informative for the reference: the new harness's valid answer to each is on
        // record, so the reference's failing them is room (`informative`).
        valid: { old: [4, 0, 0], fresh: [0, 0, 4], informative: { old: 4, fresh: 0 } },
        billed: { old: BILLED, fresh: BILLED },
        noise: objectWith({ wins: 0, losses: 0, ties: 4, flips: 0 }),
        counted: null,
        objective: null,
        points: { validity: 4000, objective: 0 },
        turns: Object.fromEntries(HELD.map((task) => [task, { old: null, fresh: 10 }])),
        versions: HELD,
        disputed: [],
        aside: [],
        short: [],
        flagged: [],
        withdrawn: [],
        capped: false,
        reading: "step",
        settled: "unsettled",
      },
    ]);
    // A worker runs each task's mirror in order, and the next task's mirror starts the other way round;
    // the starter is solved on none.
    expect(s.asked.map(({ side }) => side)).toEqual(copies(2, MIRRORED).flat());
    const runs = Array.from({ length: 4 }, (_, at) => s.asked.slice(4 * at, 4 * at + 4));
    expect(runs.every((run) => run.every(({ version }) => version === run[0]?.version))).toBe(true);
    expect(new Set(runs.map((run) => run[0]?.version))).toEqual(new Set(HELD));
    expect(s.asked.some(({ side }) => side === "starter")).toBe(false);
    expect(s.of("build.started")[0]).toMatchObject({ tasks: ["p1"] });
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
    expect(began).toBeGreaterThan(kinds.indexOf("build.finished"));
    expect(kinds.slice(began).filter((kind) => kind === "solve.started")).toHaveLength(16);
    expect(latestBuilt(read(s.log))).toBe(report.fresh);
    expect(stopRule(read(s.log))).toEqual({ checkpoints: 1, sinceStep: 0, stop: false });
    expect(HELD.map((version) => taskStates(read(s.log)).get(version))).toEqual(copies(4, "held"));
    expect(await s.built()).toEqual(report);
    expect(s.sessions()).toBe(1);
    expect(s.asked).toHaveLength(16);
    expect(s.of(COMPARISON_REPORTED)).toHaveLength(1);
  });

  it("runs the plan's first round: the Builder forks the starter, and its harness is compared with the starter", async () => {
    const s = await setup([edit, finish], (version, side, nth) => {
      if (side !== "starter") return { ending: PASS, turns: 5 };
      if (version === "s4") return { ending: PASS, turns: nth === 0 ? 5 : 11 };
      return version === "s3" && nth === 0 ? { ending: PASS, turns: 11 } : LATE;
    });
    const report = await s.built("b-1", { old: s.starter }, s.starter.dir);
    expect(report).toMatchObject({
      old: s.starter.digest,
      starter: s.starter.digest,
      scored: { wins: 3, losses: 0, ties: 1, p: 0.125 },
      valid: { old: [2, 1, 1], fresh: [0, 0, 4] },
      reading: NO_STEP,
    });
    expect(s.of("build.started")[0]).toMatchObject({ parent: s.starter.digest });
    expect(s.asked).toHaveLength(16);
    expect(s.asked.every(({ side }) => side !== "old")).toBe(true);
    expect(stopRule(read(s.log))).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
    await expect(checkpoint(s.compare("aa", { fresh: { dir: s.parent, digest: s.old } }))).rejects.toThrow(
      "a comparison sets two harnesses against each other, and both sides are",
    );
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
    const plain = await checkpoint(s.compare("g1"));
    expect(report.reading).toBe(plain.reading);
    expect(predicted(read(s.log), "g1")).toBeNull();
    expect(s.of(COMPARISON_STARTED)[1]).not.toHaveProperty("prediction");
  });

  it("reports a task short when its solves end in nothing countable, and tallies the rest", async () => {
    const { s, report } = await compared((version, side, nth, digest) =>
      version === "s4" && side === "fresh"
        ? { outcome: "non-result", kind: "sandbox-crash", reason: "x" }
        : step(version, side, nth, digest),
    );
    expect(report).toMatchObject({
      scored: { wins: 3, losses: 0 },
      versions: ["s1", "s2", "s3"],
      short: ["s4"],
      reading: NO_STEP,
    });
    const ran = s.asked.flatMap(({ version }, at) => (version === "s4" ? [at] : []));
    expect(ran).toHaveLength(2);
    expect((ran.at(-1) ?? 0) - (ran[0] ?? 0)).toBe(1);
    expect(s.asked.filter(({ version, side }) => version === "s4" && side === "fresh")).toHaveLength(2);
  });

  it("sets every rejection aside where no reviewer is seated, which reads not scored and is no test that found no gain, and reads it once a person has labelled them", async () => {
    const s = await setup([edit, finish], rejecting);
    const report = await s.built();
    expect(report).toMatchObject({
      scored: { wins: 0, losses: 0, ties: 0, p: 1 },
      counted: { wins: 4, losses: 0, p: 0.0625 },
      versions: [],
      aside: HELD,
      reading: NOT_SCORED,
    });
    expect(s.asked).toHaveLength(16);
    expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ tasks: 4, reading: NOT_SCORED });
    expect(stopRule(read(s.log))).toMatchObject({ checkpoints: 0 });
    const asked = toLabel(read(s.log), "b-1");
    expect(asked.aside).toHaveLength(8);
    expect(asked.others).toEqual([]);
    const settled = settleReading(
      s.log,
      "b-1",
      new Map(asked.aside.map((solve) => [solve, "solver-fail"] as const)),
    );
    expect(settled).toMatchObject({
      scored: { wins: 4, losses: 0 },
      counted: null,
      versions: HELD,
      aside: [],
      reading: "step",
      settled: { labelled: 8, defects: 0, disputed: [], restored: HELD },
    });
    expect(s.asked).toHaveLength(16);
    const fresh = { dir: join(s.request.session.states, settled.fresh ?? ""), digest: settled.fresh ?? "" };
    expect(await checkpoint(s.compare("g5", { old: s.starter, fresh }))).toMatchObject({
      scored: { wins: 4, losses: 0 },
      reading: "step",
    });
  });

  it("compares nothing a killed or a crashed session froze", async () => {
    const s = await setup([edit, finish], step);
    const killed = new AbortController();
    killed.abort();
    await expect(s.built("b-1", { kill: killed.signal })).rejects.toThrow(
      "session b-1 was killed, so what it froze is not compared",
    );
    await expect(s.built()).rejects.toThrow("session b-1 was killed");
    expect(spent(read(s.log), "b-1")).toContain("a round under a new session id starts again");
    expect(s.sessions()).toBe(1);
    expect(s.asked).toEqual([]);
    const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" });
    const crashed = await setup([edit, failed], step);
    await expect(crashed.built()).rejects.toThrow("session b-1 crashed, so what it froze is not compared");
    expect(crashed.asked).toEqual([]);
    expect(crashed.of(COMPARISON_REPORTED)).toEqual([]);
  });

  it("calls two valid answers even, counts a solver's flag as its side's fail, and reports the turns of each valid answer in no test", async () => {
    {
      const { s, report } = await compared((version) => (version === "s1" ? LATE : PASS));
      expect(report).toMatchObject({
        scored: { wins: 0, losses: 0, ties: 4, p: 1, unsolved: 1 },
        reading: NO_STEP,
      });
      expect(s.asked).toHaveLength(16);
    }
    {
      const FLAG: Ending = { outcome: "flagged", reason: "the task is malformed" };
      const against =
        (s1: Ending): Table =>
        (version, side) => {
          if (version === "s1") return side === "fresh" ? s1 : PASS;
          return side === "fresh" ? PASS : LATE;
        };
      const { report: lost } = await compared(against(LATE));
      expect(lost).toMatchObject({ scored: { wins: 3, losses: 1 }, short: [], flagged: [] });
      expect((await compared(against(FLAG))).report).toMatchObject({
        scored: lost.scored,
        versions: lost.versions,
        short: [],
        flagged: ["s1"],
      });
      const both = await compared((version, side) =>
        version === "s1" ? FLAG : side === "fresh" ? PASS : LATE,
      );
      expect(both.report).toMatchObject({
        scored: { wins: 3, losses: 0, ties: 1 },
        flagged: ["s1"],
      });
    }
    {
      const run = async (fast: number) =>
        (
          await compared((version, side) =>
            version === "s1" ? LATE : { ending: PASS, turns: side === "fresh" ? fast : 12 },
          )
        ).report;
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

  it("scores two valid answers by the objective, and reports the points of each measure", async () => {
    const mass = (version: string, side: Side): number =>
      (side === "fresh" ? { s2: 8, s3: 9, s4: 10 + 1e-10 }[version] : 10) ?? 10;
    const objective = { direction: "lower" } as const;
    const { s, report } = await compared(
      (version, side) => (version === "s1" ? LATE : { ending: PASS, objective: mass(version, side) }),
      { objective },
    );
    const gained = Math.round(1000 * (0.2 + 0.1));
    expect(report).toMatchObject({
      scored: { wins: 2, losses: 0, ties: 2, p: 0.25, unsolved: 1 },
      objective,
      points: { validity: 0, objective: gained },
      reading: NO_STEP,
    });
    expect(s.of(COMPARISON_STARTED)[0]).toMatchObject({ objective });
  });

  it("solves both harnesses afresh at every comparison, to the same reading at four solves side by side", async () => {
    {
      const { s, report } = await compared((version, side, nth) =>
        version === "s1" && side === "old" && nth >= 2 ? LATE : PASS,
      );
      expect(report).toMatchObject({ scored: { wins: 0, ties: 4 } });
      const two = await checkpoint(s.paired("g-2"));
      expect(two).toMatchObject({ scored: { wins: 1, losses: 0, ties: 3 }, reading: NO_STEP });
      expect(s.asked).toHaveLength(32);
      expect(s.asked.slice(16).filter(({ side }) => side === "old")).toHaveLength(8);
      expect(await checkpoint(s.paired("g-2"))).toEqual(two);
      expect(s.asked).toHaveLength(32);
    }
    {
      const { s, report } = await compared(step, { concurrency: 4 });
      expect(report).toMatchObject({
        scored: { wins: 4, losses: 0, ties: 0 },
        short: [],
        reading: "step",
      });
      expect(s.asked).toHaveLength(16);
      expect(s.solved()).toHaveLength(16);
    }
  });

  it("refuses an unfinished comparison under a Bun-only changed setting before another solve or append", async () => {
    let left = 10;
    const s = await setup([], (version, side, nth, digest) => {
      left -= 1;
      if (left === 0) throw new Error(STOPS);
      return step(version, side, nth, digest);
    });
    await expect(checkpoint(s.paired("g0"))).rejects.toThrow(STOPS);
    const before = readFileSync(s.log, "utf8");
    const solves = s.asked.length;
    s.code.bun = "0.0.1";
    await expect(checkpoint(s.paired("g0"))).rejects.toThrow("other terms (setting)");
    expect(readFileSync(s.log, "utf8")).toBe(before);
    expect(s.asked).toHaveLength(solves);
  });

  it("goes on from its log with the tasks and the terms it began with: no second session, only the solves it lacks, and other terms refused under its id", async () => {
    const stopping = (): Table => {
      let left = 10;
      return (version, side, nth, digest) => {
        left -= 1;
        if (left === 0) throw new Error(STOPS);
        return step(version, side, nth, digest);
      };
    };
    const s = await setup([edit, finish], stopping());
    await expect(s.built()).rejects.toThrow(STOPS);
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
    expect(spent(read(s.log), "b-1")).toBeNull();
    expect(s.asked).toHaveLength(10);
    await expect(s.built("b-1", { solves: 3 })).rejects.toThrow(
      "comparison b-1 began on other terms (solves), and its solves so far were made for those",
    );
    for (const [term, more] of [
      ["cap", { cap: { dollars: 500, reserve: 10 } }],
      ["level", { level: 0.05 }],
      ["objective", { objective: { direction: "lower" } }],
      ["prediction", { prediction: "a step, 4 to 0" }],
    ] as const) {
      await expect(s.built("b-1", more)).rejects.toThrow(`other terms (${term})`);
    }
    const t = await setup([], stopping());
    const begun = { objective: { direction: "lower" }, prediction: "a step" } as const;
    await expect(checkpoint(t.paired("g0", begun))).rejects.toThrow(STOPS);
    await expect(checkpoint(t.paired("g0"))).rejects.toThrow("other terms (objective, prediction)");
    const report = await s.built("b-1", { tasks: [...HELD, "s5"] });
    expect(report).toMatchObject({ versions: HELD, scored: { wins: 4 }, reading: "step" });
    expect(s.asked.some(({ version }) => version === "s5")).toBe(false);
    expect(s.asked.slice(10)).toHaveLength(7);
    expect(s.sessions()).toBe(1);
    expect(s.of("build.started")).toHaveLength(1);
    expect(s.of(COMPARISON_STARTED)).toHaveLength(1);
    expect(s.of(COMPARISON_REPORTED)[0]).toMatchObject({ tasks: 4 });
  });

  it("sets a task aside on a rejection not ruled a true fail, and leaves out one whose check could not run", async () => {
    const s = await setup([], (version, side, nth, digest) => {
      if (version === "s2" && side === "fresh") {
        return { outcome: "non-result", kind: "check", reason: "check-9: threw" };
      }
      if (version === "s4" && side === "old") return LATE;
      return rejecting(version, side, nth, digest);
    });
    const refereed: string[] = [];
    const ruled = referee(s.log, { s1: "check-defect" });
    const failedOnce = new Set<string>();
    const reading = async (solve: string, version: string): Promise<AuditFinding> => {
      refereed.push(version);
      if (version === "s3" && !failedOnce.has(solve)) {
        failedOnce.add(solve);
        throw new Error("the reader failed");
      }
      return await ruled(solve, version);
    };
    const report = await checkpoint(s.paired("g0", { referee: reading }));
    expect(report).toMatchObject({
      scored: { wins: 2, losses: 0, p: 0.25 },
      counted: { wins: 3, losses: 0, p: 0.125 },
      versions: ["s3", "s4"],
      disputed: [],
      short: ["s2"],
      aside: ["s1"],
      reading: NO_STEP,
    });
    // A ruling sets a task aside for this comparison alone, since a check that disputed its task for
    // good would let a candidate's held-out answer move a count its Builder reads (rule 3).
    expect(taskSets(read(s.log)).held).toEqual([...HELD, "s5"]);
    expect(s.of(TASK_STATE).filter(({ state }) => state === "disputed")).toEqual([]);
    // The new harness's solve of s2 whose check could not run is its last and only one, whichever
    // harness the slot put first.
    const disputed = s.asked.filter(({ version }) => version === "s2");
    expect(disputed.at(-1)).toEqual({ version: "s2", side: "fresh" });
    expect(disputed.filter(({ side }) => side === "fresh")).toHaveLength(1);
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

  it("disputes a task for good where its own check could not run on the reference's answer", async () => {
    const s = await setup([], (version, side, nth, digest) =>
      version === "s2" && side === "old"
        ? { outcome: "non-result", kind: "check", reason: "check-9: threw" }
        : rejecting(version, side, nth, digest),
    );
    const report = await checkpoint(s.paired("g0", { referee: referee(s.log, {}) }));
    expect(report).toMatchObject({ disputed: ["s2"], short: [] });
    expect(taskSets(read(s.log)).held).toEqual(["s1", "s3", "s4", "s5"]);
    expect(s.of(TASK_STATE).filter(({ state }) => state === "disputed")).toMatchObject([
      { version: "s2", reason: "its own check could not run on an answer" },
    ]);
    expect(s.asked.filter(({ version, side }) => version === "s2" && side === "old")).toHaveLength(1);
  });

  it("puts a rejection the Referee gave no answer on to it again, and stops before the report while one has none", async () => {
    // A Referee call cut by the provider's session limit must not be logged unclear, setting a won task
    // aside with no later run putting it again.
    const silent =
      (log: string) =>
      async (solve: string): Promise<AuditFinding> => {
        append(log, "referee.finding", { solve, ruling: null, error: "the session limit is reached" });
        return { ruling: null, check: null, rule: null, field: null, reason: "r", probes: [] };
      };
    const s = await setup([], rejecting);
    const asked = new Set<string>();
    const once = async (solve: string, version: string): Promise<AuditFinding> => {
      if (asked.has(solve)) return await referee(s.log)(solve, version);
      asked.add(solve);
      return await silent(s.log)(solve);
    };
    expect(await checkpoint(s.paired("g0", { referee: once }))).toMatchObject({
      scored: { wins: 4, losses: 0 },
      aside: [],
      versions: HELD,
    });
    expect(asked.size).toBe(8);
    const t = await setup([], rejecting);
    await expect(checkpoint(t.paired("g0", { referee: silent(t.log) }))).rejects.toThrow(
      "put to the Referee again (the session limit is reached)",
    );
    expect(t.of(COMPARISON_REPORTED)).toEqual([]);
    expect(await checkpoint(t.paired("g0", { referee: referee(t.log) }))).toMatchObject({
      scored: { wins: 4, losses: 0 },
      aside: [],
    });
  });

  describe("settled on a person's labels", () => {
    let first: Awaited<ReturnType<typeof setup>>;
    let report: Awaited<ReturnType<typeof checkpoint>>;
    let asked: ReturnType<typeof toLabel>;
    beforeAll(async () => {
      first = await setup([edit, finish], rejecting);
      report = await first.built("b-1", { referee: referee(first.log, { s1: "check-defect" }) });
      asked = toLabel(read(first.log), "b-1");
    });
    const ruledOn = async () => setup([again, finish], rejecting, first.log);
    const labelled = (solves: readonly string[], label: Ruling) =>
      new Map(solves.map((solve) => [solve, label] as const));
    const passes = (log: string, label: PassLabel) =>
      new Map(passesIn(read(log), "b-1").map((solve) => [solve, label] as const));

    it("asks a person to label what the Referee set aside, and a label stands over a ruling", async () => {
      expect(report).toMatchObject({
        scored: { wins: 3, losses: 0, p: 0.125 },
        counted: { wins: 4, losses: 0 },
        versions: ["s2", "s3", "s4"],
        aside: ["s1"],
        reading: NO_STEP,
        settled: "unsettled",
      });
      expect(asked.aside).toHaveLength(2);
      expect(asked.others).toHaveLength(6);

      const defect = await ruledOn();
      expect(() => settleReading(defect.log, "b-1", labelled(["r-0-0"], "solver-fail"))).toThrow(
        "is no rejected answer",
      );
      expect(() =>
        settleReading(defect.log, "b-1", new Map(), new Map([[asked.aside[0] ?? "", "sound"]])),
      ).toThrow("is no answer that passed in comparison b-1");
      const settled = settleReading(defect.log, "b-1", labelled(asked.aside, "check-defect"));
      expect(settled).toMatchObject({
        scored: { wins: 3, losses: 0, p: 0.125 },
        versions: ["s2", "s3", "s4"],
        disputed: ["s1"],
        aside: [],
        counted: null,
        reading: NO_STEP,
        settled: { labelled: 2, defects: 2, disputed: ["s1"], restored: [] },
      });
      expect(taskStates(read(defect.log)).get("s1")).toBe("disputed");
      expect(defect.of(COMPARISON_REPORTED)).toHaveLength(2);
      expect(defect.of(COMPARISON_REPORTED)[1]).toMatchObject({ tasks: 4, solves: 2, level: 0.1 });
      expect(await checkpoint(defect.paired("b-1"))).toEqual(settled);
      expect(defect.sessions()).toBe(0);
      expect(settled.settled).toMatchObject({
        labels: Object.fromEntries(labelled(asked.aside, "check-defect")),
        passes: {},
      });
      expect(settleReading(defect.log, "b-1", labelled(asked.aside, "check-defect"))).toEqual(settled);
      expect(() => settleReading(defect.log, "b-1", labelled(asked.aside, "solver-fail"))).toThrow(
        "comparison b-1 is settled already, and these labels are not the ones it was settled on",
      );
      expect(() => settleReading(defect.log, "b-1", new Map())).toThrow("is settled already");
      expect(defect.of(COMPARISON_REPORTED)).toHaveLength(2);
      expect(stopRule(read(defect.log))).toMatchObject({ checkpoints: 1, sinceStep: 1 });

      const earned = await ruledOn();
      await earned.built("b-2");
      append(earned.log, TASK_STATE, { version: "s4", state: "released" });
      expect(settleReading(earned.log, "b-1", labelled(asked.aside, "solver-fail"))).toMatchObject({
        scored: { wins: 4, losses: 0 },
        versions: HELD,
        disputed: [],
        aside: [],
        reading: "step",
        settled: { labelled: 2, defects: 0, disputed: [], restored: ["s1"] },
      });
      expect(taskStates(read(earned.log)).get("s1")).toBe("held");

      const over = await ruledOn();
      const [other = ""] = asked.others;
      const labels = new Map<string, Ruling>([
        ...labelled(asked.aside, "solver-fail"),
        [other, "check-defect"],
      ]);
      const gone = ranUnder(read(over.log)).find(({ id }) => id === other)?.under.task ?? "";
      expect(["s2", "s3", "s4"]).toContain(gone);
      expect(settleReading(over.log, "b-1", labels)).toMatchObject({
        scored: { wins: 3, losses: 0 },
        versions: HELD.filter((version) => version !== gone),
        disputed: [gone],
        settled: { labelled: 3, defects: 1, disputed: [gone], restored: ["s1"] },
      });

      const refused = await ruledOn();
      append(refused.log, TASK_STATE, { version: "s1", state: "refused" });
      expect(settleReading(refused.log, "b-1", labelled(asked.aside, "check-defect"))).toMatchObject({
        versions: ["s2", "s3", "s4"],
        aside: ["s1"],
        disputed: [],
        settled: { labelled: 2, defects: 2, disputed: [] },
      });
      expect(taskStates(read(refused.log)).get("s1")).toBe("refused");
    });

    it.each([
      [
        "one rejection earned and one pass wrong",
        "one",
        "wrong-one",
        { scored: { wins: 3, losses: 0 }, aside: ["s1"], settled: { labelled: 1, defects: 0, restored: [] } },
      ],
      ["every pass wrong", "none", "wrong", { scored: { wins: 0, losses: 0, ties: 3 }, reading: NO_STEP }],
      ["every pass sound", "none", "sound", { scored: { wins: 3, losses: 0 } }],
      [
        "both rejections unclear",
        "unclear",
        "none",
        {
          scored: { wins: 3 },
          aside: ["s1"],
          disputed: [],
          settled: { labelled: 2, defects: 0, restored: [] },
        },
      ],
    ] as const)("settles %s", async (_case, rejections, verdicts, expected) => {
      const { log } = await ruledOn();
      const [one = ""] = asked.aside;
      const [valid = ""] = passesIn(read(log), "b-1");
      const given = {
        one: labelled([one], "solver-fail"),
        none: new Map<string, Ruling>(),
        unclear: labelled(asked.aside, "unclear"),
      }[rejections];
      const judged = {
        "wrong-one": new Map<string, PassLabel>([[valid, "wrong"]]),
        wrong: passes(log, "wrong"),
        sound: passes(log, "sound"),
        none: new Map<string, PassLabel>(),
      }[verdicts];
      const settled = settleReading(log, "b-1", given, judged);
      expect(settled).toMatchObject(expected);
      expect(settled.settled).toMatchObject({ passes: Object.fromEntries(judged) });
    });

    it("reads a settled comparison again with its labels in place of the verdicts they overturn", async () => {
      const swappedOn = async (
        labels: ReadonlyMap<string, Ruling>,
        judged?: (log: string) => Map<string, PassLabel>,
      ) => {
        const { log } = await ruledOn();
        expect(swapped(read(log), "b-1")).toBeNull();
        settleReading(log, "b-1", labels, judged?.(log));
        return swapped(read(log), "b-1");
      };
      expect(await swappedOn(labelled(asked.aside, "solver-fail"))).toMatchObject({
        decided: NO_STEP,
        swapped: "step",
        scored: { wins: 4, losses: 0 },
      });
      expect(
        await swappedOn(labelled([...asked.aside, ...asked.others], "check-defect"), (log) =>
          passes(log, "wrong"),
        ),
      ).toMatchObject({ decided: NO_STEP, swapped: NO_STEP, scored: { wins: 0, losses: 4, ties: 0 } });
    });
  });

  it("draws every rejection ruled a true fail into the packet, where a label stands over it", async () => {
    const s = await setup([], rejecting);
    const report = await checkpoint(s.paired("g0", { referee: referee(s.log) }));
    expect(report).toMatchObject({ aside: [], scored: { wins: 4 } });
    expect(toLabel(read(s.log), "g0").aside).toEqual([]);
    const [one = ""] = toLabel(read(s.log), "g0").others;
    const task = ranUnder(read(s.log)).find(({ id }) => id === one)?.under.task;
    expect(settleReading(s.log, "g0", new Map([[one, "check-defect"]]))).toMatchObject({
      disputed: [task],
      settled: { labelled: 1, defects: 1 },
    });
  });

  it("stops, to go on from its log, when no solve of three tasks in a row ran: a provider that answers none, or a wall that refuses every solve", async () => {
    {
      // A login at its session limit ends every later solve in seconds, so a round that solved on would
      // report every task short. A task's four solves run together: five answered are one task and one
      // solve of the next.
      let left = 5;
      const s = await setup([edit, finish], (version, side, nth, digest) => {
        left -= 1;
        return left < 0 ? LIMITED : step(version, side, nth, digest);
      });
      await expect(s.built()).rejects.toThrow(
        "no solve of 3 tasks in a row ran, so the comparison stops: You've hit your session limit",
      );
      expect(s.of(COMPARISON_REPORTED)).toEqual([]);
      expect(stoppedAtFirst(s.asked)).toBe(true);
      expect(new Set(s.asked.map(({ version }) => version)).size).toBe(4);
      left = 99;
      const report = await s.built();
      expect(report).toMatchObject({ scored: { wins: 4, losses: 0 }, short: [], reading: "step" });
      expect(s.sessions()).toBe(1);

      const cut: Ending = { outcome: "non-result", kind: "provider", reason: "WebSocket closed 1000" };
      const worked = await compared((version, side, nth, digest) =>
        side === "fresh" ? cut : step(version, side, nth, digest),
      );
      expect(worked.report).toMatchObject({ short: HELD, versions: [], reading: NOT_SCORED });
    }
    {
      // A probe folder another user owns refuses the wall on every solve, and a rehearsal would run
      // dozens to sandbox-crash before it was killed.
      const unwalled: Ending = {
        outcome: "non-result",
        kind: "sandbox-crash",
        reason: "the wall does not hold on this host, so a solve is not started",
      };
      const s = await setup([], () => unwalled);
      await expect(checkpoint(s.paired("g0"))).rejects.toThrow(
        "no solve of 3 tasks in a row ran, so the comparison stops: the wall does not hold on this host",
      );
      expect(s.of(COMPARISON_REPORTED)).toEqual([]);
      expect(stoppedAtFirst(s.asked)).toBe(true);
      expect(new Set(s.asked.map(({ version }) => version)).size).toBe(3);
      expect(s.asked).toHaveLength(5);
    }
  });

  it("stops short of three silent tasks where the provider answered and then wrote nothing to the last solve, and reports a task alone silent from the start", async () => {
    // A provider that refuses the model on the last task must not have the comparison report no-step
    // one task short instead of waiting to be run again.
    let left = 12;
    const s = await setup([], (version, side, nth, digest) => {
      left -= 1;
      return left < 0 ? LIMITED : step(version, side, nth, digest);
    });
    await expect(checkpoint(s.paired("g0"))).rejects.toThrow("then wrote nothing for its last 1 task");
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
    expect(await checkpoint(s.paired("g0"))).toMatchObject({ short: [expect.any(String)] });
    let calls = 0;
    const back = await setup([], (version, side, nth, digest) => {
      calls += 1;
      return calls > 12 && calls <= 14 ? LIMITED : step(version, side, nth, digest);
    });
    await expect(checkpoint(back.paired("g0"))).rejects.toThrow("then wrote nothing");
    expect(await checkpoint(back.paired("g0"))).toMatchObject({ short: [], scored: { wins: 4, losses: 0 } });
  });

  it("stops a comparison at the first refusal no retry clears", async () => {
    for (const reason of [
      "Claude Code: Your organization has disabled Claude subscription access for Claude Code",
      "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
    ]) {
      const permanent: Ending = { outcome: "non-result", kind: "provider", reason };
      let calls = 0;
      const s = await setup([], (version, side, nth, digest) => {
        calls += 1;
        return calls > 2 ? permanent : step(version, side, nth, digest);
      });
      await expect(checkpoint(s.paired("g0"))).rejects.toThrow("no retry clears");
      expect(calls).toBe(3);
    }
  });

  it("enforces the campaign's total opening budget beside the comparison's own cap", async () => {
    const s = await setup([], (version, side, nth, digest) => step(version, side, nth, digest));
    // Campaign total $5 with a $2 reserve, another seat already billed $4: $1 left, under the reserve,
    // though the comparison's own cap is $100.
    append(s.log, "campaign.opened", { budget: { dollars: 5, reserve: 2 } });
    append(s.log, "exam.turn", { session: "x-1", turn: 1, usage: { cost: { total: 4 } } });
    const report = await checkpoint({ ...s.paired("g0"), cap: { dollars: 100, reserve: 2 } });
    expect(report).toMatchObject({ reading: "not-scored", capped: true });
  });

  it("keeps a kill as the reason when a reset wait returns its provider ending", async () => {
    const kill = new AbortController();
    const s = await setup([], () => {
      kill.abort();
      return {
        outcome: "non-result",
        kind: "provider",
        reason: `limit reached|${String(Math.ceil(Date.now() / 1000) + 3600)}`,
      };
    });
    await expect(checkpoint(s.compare("g-killed", { kill: kill.signal }))).rejects.toThrow(
      "the comparison was killed",
    );
    expect(s.asked).toHaveLength(1);
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
  });

  it("keeps a kill as the reason when it reaches a solve queued in the solve queue", async () => {
    const kill = new AbortController();
    const s = await setup([], () => PASS);
    const request = s.compare("g-queued", {
      kill: kill.signal,
      solve: async (_version, _harness, _comparison, signal) => {
        kill.abort();
        signal.throwIfAborted();
        throw new Error("the solve queue let a killed solve start");
      },
    });
    await expect(checkpoint(request)).rejects.toThrow("the comparison was killed");
    expect(s.of(COMPARISON_REPORTED)).toEqual([]);
  });

  it("leaves out and names a task a person released or refused while the comparison ran or was stopped, and disputes no task a person refused", async () => {
    {
      let solved = 0;
      const s = await setup([], (version, side, nth, digest) => {
        solved += 1;
        const moved = { 6: ["s4", "released"], 7: ["s3", "refused"] }[solved];
        if (moved !== undefined) {
          append(s.log, TASK_STATE, { version: moved[0] ?? "", state: moved[1] ?? "" });
        }
        return step(version, side, nth, digest);
      });
      expect(await checkpoint(s.paired("g0"))).toMatchObject({
        scored: { wins: 2, losses: 0 },
        versions: ["s1", "s2"],
        withdrawn: ["s3", "s4"],
        short: [],
        reading: NO_STEP,
      });
      const after = s.asked.slice(7).map(({ version }) => version);
      expect(after.filter((version) => version === "s3" || version === "s4")).toEqual([]);
    }
    {
      let solved = 0;
      let refused = "";
      const s = await setup([], (version, side, nth, digest) => {
        solved += 1;
        if (solved === 6) throw new Error(STOPS);
        if (solved > 6 && refused === "") {
          refused = version;
          append(s.log, TASK_STATE, { version, state: "refused" });
          return { outcome: "non-result", kind: "check", reason: "the check crashed" };
        }
        return step(version, side, nth, digest);
      });
      await expect(checkpoint(s.compare("g0"))).rejects.toThrow(STOPS);
      append(s.log, TASK_STATE, { version: "s4", state: "released" });
      const report = await checkpoint(s.compare("g0"));
      const withdrawn = [refused, "s4"].toSorted();
      expect(report).toMatchObject({
        versions: HELD.filter((version) => !withdrawn.includes(version)),
        withdrawn,
        disputed: [],
      });
      expect(taskStates(read(s.log)).get(refused)).toBe("refused");
      expect(s.asked.slice(6).some(({ version }) => version === "s4")).toBe(false);
      await expect(checkpoint(s.compare("g1"))).rejects.toThrow(`task ${refused} is refused`);
    }
  });

  it("stops on more check defects than it allows, and says so in place of a reading", async () => {
    const s = await setup([edit, finish], () => REJECTED);
    const ruled = { s1: "check-defect", s2: "check-defect", s3: "check-defect" } as const;
    const objective = { direction: "lower" } as const;
    const report = await s.built("b-1", { referee: referee(s.log, ruled), defects: 1, objective });
    expect(report).toMatchObject({
      scored: null,
      aside: ["s1", "s2"],
      disputed: [],
      capped: false,
      reading: "check-defects",
      objective: { ...objective, decided: 0 },
    });
    const reached = [...new Set(s.asked.map(({ version }) => version))];
    const last = reached.at(-1) ?? "";
    expect(reached.filter((version) => version in ruled)).toHaveLength(2);
    expect(last in ruled).toBe(true);
    expect(s.asked.filter(({ version }) => version === last)).toHaveLength(1);
    expect(stopRule(read(s.log))).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
  });

  it("counts towards the stop only the comparisons that left room: three harnesses without a step stop at the improvement patience, and none counts where nobody answered or every answer was valid", async () => {
    {
      // Either harness answers each task on one of its two solves, so the reference is valid on half
      // its solves, which leaves room. A harness's solves of a task count across rounds, so every other
      // one passes.
      const half: Table = (_version, _side, nth) => (nth % 2 === 0 ? PASS : LATE);
      const s = await setup([edit, finish, again, finish, third, finish], half);
      for (const [index, id] of ["b-1", "b-2", "b-3"].entries()) {
        const report = await s.built(id);
        expect(report).toMatchObject({ scored: { wins: 0, losses: 0, ties: 4 }, reading: NO_STEP });
        // Patience is six by default (`PATIENCE`), so three harnesses without a step stop nothing here.
        expect(stopRule(read(s.log))).toEqual({ checkpoints: index + 1, sinceStep: index + 1, stop: false });
        const three = {
          at: "2026-10-09T00:00:00.000Z",
          kind: "campaign.opened",
          data: { patience: 3 },
        } as const;
        expect(stopRule([three, ...read(s.log)])).toMatchObject({ stop: id === "b-3" });
      }
      expect(s.asked).toHaveLength(48);
    }
    for (const [answered, valid] of [
      [
        ["s1", "s2"],
        [2, 0, 2],
      ],
      [HELD, [0, 0, 4]],
    ] as const) {
      const s = await setup([edit, finish], (version) =>
        answered.some((one) => one === version) ? PASS : LATE,
      );
      expect(await s.built()).toMatchObject({
        scored: { wins: 0, losses: 0, ties: 4, unsolved: 4 - answered.length },
        valid: { old: valid, fresh: valid, informative: { old: 0, fresh: 0 } },
        reading: NO_STEP,
      });
      expect(stopRule(read(s.log))).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    }
  });

  it("refuses, before any solve, a set it could not score", async () => {
    const s = await setup([edit, finish], step);
    append(s.log, TASK_STATE, { version: "s5", state: "released" });
    for (const [more, refused] of [
      [{ tasks: [...HELD, "s1"] }, "task s1 is listed twice"],
      [{ tasks: ["s5"] }, "task s5 is released, and only a held-out task is scored"],
      [{ tasks: ["s9"] }, "task s9 is not proposed, and only a held-out task is scored"],
      [{ tasks: [] }, "no task to score"],
      [{ retained: ["s9"] }, "retained task s9 is not among the tasks to score"],
      [{ concurrency: Number("four") }, "whole numbers"],
      [{ solves: 0 }, "whole numbers"],
      [{ level: 10 }, "level lies between 0 and 1"],
      [{ cap: { dollars: Number("many"), reserve: 10 } }, "a cap and its reserve are dollars"],
      [{ cap: { dollars: 100, reserve: 0 } }, "a cap and its reserve are dollars"],
    ] as const) {
      await expect(checkpoint(s.compare("g0", more))).rejects.toThrow(refused);
    }
    expect(s.of(COMPARISON_STARTED)).toEqual([]);
    append(s.log, TASK_STATE, { version: "s2", state: "disputed" });
    expect(() => refuseTerms(s.request, { log: s.log, id: "b-9" })).not.toThrow();
  });
});

describe("a standalone comparison", () => {
  it("reads the reference harness against itself as it reads two harnesses, on its own solves", async () => {
    const s = await setup([], (version, side, nth) => {
      if (side === "starter") return LATE;
      return version === "s1" && nth >= 1 ? LATE : PASS;
    });
    const report = await checkpoint(s.compare("g2"));
    expect(report).toMatchObject({
      scored: { wins: 0, losses: 4, ties: 0, differences: [-500, -1000, -1000, -1000] },
      noise: { ties: 3, flips: 1 / 4 },
    });
    expect((report.noise?.wins ?? 0) + (report.noise?.losses ?? 0)).toBe(1);
    expect(s.asked.filter(({ side }) => side === "old")).toHaveLength(8);
    expect(s.asked.filter(({ side }) => side === "starter")).toHaveLength(8);
    expect((await checkpoint(s.compare("g3", { solves: 1 }))).noise).toBeNull();
  });

  it("reads the frontier and the retained tasks in one test, on sets fixed before its first solve", async () => {
    // Read as one test, 4-1 by as many pairs is no step, not a 4-0 frontier step with the retained loss
    // in a second test. The reference answers s1 in every solve and nothing else.
    const s = await setup([], (version, side) => ((version === "s1") === (side === "old") ? PASS : LATE));
    append(s.log, "harness.promoted", { harness: s.old, from: s.starter.digest, rests: [] });
    for (const version of ["s6", "s7", "s8", "s9"]) {
      append(s.log, "task.proposed", { version, family: version < "s8" ? "f3" : "f4" });
      append(s.log, "task.gate", passedPackageCheck(version));
    }
    await checkpoint(s.compare("g1", { tasks: ["s1"] }));
    await checkpoint(s.compare("g2", { tasks: ["s1"] }));
    const tasks = ["s1", "s6", "s7", "s8", "s9"];
    expect(poolOf(read(s.log)).retained.toSorted()).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    const drawn = scoredSet(read(s.log), 12, "c");
    expect(drawn.retained).toHaveLength(2);
    expect(drawn.tasks).toEqual(arrayWith(["s6", "s7", "s8", "s9", ...drawn.retained]));
    const report = await checkpoint(s.compare("g3", { tasks, retained: ["s1"] }));
    expect(s.of(COMPARISON_STARTED).at(-1)).toMatchObject({ tasks, retained: ["s1"] });
    expect(report).toMatchObject({
      frontier: { tasks: ["s6", "s7", "s8", "s9"], aside: [], wins: 4, losses: 0, ties: 0, p: 0.0625 },
      retained: { tasks: ["s1"], aside: [], wins: 0, losses: 1, ties: 0, differences: [-1000] },
      overlap: { with: "g2", tasks: ["s1"] },
      scored: { wins: 4, losses: 1, ties: 0, p: 0.1875 },
      reading: "no-step",
    });
  });

  it("names the attempt before it under the same reference, whatever its candidate, and never one of another kind or reference", () => {
    // A new candidate on the tasks an earlier one drew must not read null, which would hide that its
    // test counted them as fresh draws.
    const tasks = Array.from({ length: 8 }, (_, nth) => `t${String(nth)}`);
    const events: LogEvent[] = [];
    const began = (id: string, old: string, fresh: string, drawn: readonly string[]) => {
      events.push({
        at: "2026-11-15T00:00:00.000Z",
        kind: "comparison.started",
        data: {
          session: id,
          old,
          fresh,
          starter: "s0",
          setting: "x",
          solves: 2,
          level: 0.02,
          tasks: [...drawn],
        },
      });
      const fixed = fixedIn(events, id);
      return fixed === null ? undefined : overlapOf(events, fixed);
    };
    expect(began("g-1", "s0", "h1", tasks)).toBeNull();
    expect(began("g-2", "s0", "h2", [...tasks.slice(1), "t9"])).toEqual({
      with: "g-1",
      tasks: tasks.slice(1),
    });
    expect(began("g-3", "s0", "h2", tasks)).toEqual({ with: "g-2", tasks: tasks.slice(1) });
    expect(began("g-4", "h2", "s0", tasks)).toBeNull();
    expect(began("g-5", "h2", "h3", tasks)).toBeNull();
    expect(began("g-6", "h2", "h4", ["t0"])).toEqual({ with: "g-5", tasks: ["t0"] });
    expect(began("g-7", "h2", "s0", ["t0", "t1"])).toEqual({ with: "g-4", tasks: ["t0", "t1"] });
  });

  it("stops at its dollar cap, reads not scored and is finished, whatever lanes it runs in", async () => {
    // Each solve is billed $2 and held at $3 before it starts: at a cap of $11 the sixth would pass it.
    // Four lanes start no more than one: a lane that cannot afford a solve while others are in flight
    // steps aside, and the cap is reached when none is in flight.
    for (const [dollars, concurrency, solves] of [
      [11, 1, 5],
      [11, 4, 5],
      [35, 4, 16],
      [35, 1, 16],
    ] as const) {
      const cap = { dollars, reserve: 3 };
      const { s, report } = await compared(() => PASS, { cap, concurrency });
      expect(s.asked).toHaveLength(solves);
      if (solves === 16) {
        expect(report).toMatchObject({ scored: { ties: 4 }, capped: false });
        continue;
      }
      expect(report).toMatchObject({ scored: null, versions: [], capped: true, reading: NOT_SCORED });
      expect(s.of(COMPARISON_STARTED)[0]).toMatchObject({ cap });
      expect(stopRule(read(s.log))).toMatchObject({ checkpoints: 0 });
      expect(await checkpoint(s.paired("g0", { cap, concurrency }))).toEqual(report);
      expect(s.asked).toHaveLength(solves);
    }
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
    expect(await checkpoint(s.compare("g-b", { cap }))).toMatchObject({ scored: { ties: 4 } });
    const between = s.asked.length;
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
    const request = {
      ...unnamed,
      solve: (version: string, harness: { digest: string }) => s.solve(version, harness.digest),
    };
    await expect(checkpoint(request)).rejects.toThrow("does not name comparison g0 at its start");
    expect(s.asked).toHaveLength(1);
  });
});

describe("a session with no comparison after it", () => {
  const practise = call("practice", { tasks: ["t-p1"] });

  // Several sessions, then one comparison, so that two sessions are not two paid comparisons.
  it("runs twice, the second from what the first left, and one standalone comparison compares what they leave", async () => {
    const s = await setup([edit, practise, finish, again, finish], step);
    const { session: build, builder } = s.request;
    const first = await sessionOnce(build, builder);
    const kept = first.kept;
    if (kept === null) throw new Error("the first session left no harness");
    const second = await sessionOnce({ ...build, id: "b-2", parent: kept.dir }, builder);
    expect(second.kept?.digest).not.toBe(kept.digest);
    expect(latestBuilt(read(s.log))).toBe(second.kept?.digest ?? "");
    expect(s.of("build.finished").map(({ session: id, ended }) => [id, ended])).toEqual([
      ["b-1", "finished"],
      ["b-2", "finished"],
    ]);
    expect(s.of(COMPARISON_STARTED)).toEqual([]);
    expect(s.asked).toEqual([{ version: "p1", side: "fresh" }]);
    expect(await sessionOnce({ ...build, id: "b-2", parent: kept.dir }, builder)).toEqual(second);
    expect(s.sessions()).toBe(2);
    const report = await checkpoint(s.compare("g-1", { fresh: second.kept ?? s.starter }));
    expect(report).toMatchObject({ reading: "step", fresh: second.kept?.digest, old: s.old });
    expect(s.of(COMPARISON_STARTED)).toHaveLength(1);
    expect(stopRule(read(s.log))).toMatchObject({ checkpoints: 1, sinceStep: 0, stop: false });
  });

  it("starts no practice solve its dollar cap holds no reserve for, and says so as a count", async () => {
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
    expect(said.join("\n")).not.toContain("$");
    expect(s.asked).toHaveLength(2);
    expect(s.of("build.finished")[0]).toMatchObject({ practiceSolves: 2, ended: "finished" });
    const free = await setup([edit, practise, practise, practise, finish], step);
    await sessionOnce(free.request.session, free.request.builder);
    expect(free.asked).toHaveLength(3);
  });

  it("holds a session and the comparison after it to one cap", async () => {
    const s = await setup([edit, practise, practise, finish], step);
    const report = await s.built("b-1", { cap: { dollars: 3, reserve: BILLED } });
    expect(s.of("build.finished")[0]).toMatchObject({ practiceSolves: 1 });
    expect(report).toMatchObject({ reading: NOT_SCORED, capped: true });
  });
});
describe("the scored set", () => {
  const at = "2026-10-09T00:00:00.000Z";
  const heldOut = (versions: readonly string[], family?: string): LogEvent[] =>
    versions.flatMap((version) => [
      { at, kind: "task.proposed", data: { version, ...keyIfDefined("family", family) } } as const,
      { at, kind: "task.gate", data: passedPackageCheck(version) } as const,
    ]);
  const held = ["v1", "v2", "v3", "v4", "v5", "v6"];
  const drawn = (events: readonly LogEvent[], target: number) =>
    scoredSet(events, target, "contract-a").tasks;

  it("is drawn from the held-out tasks by the contract alone, so no result chooses it, and is all of them where the campaign holds fewer than were asked for", () => {
    const first = drawn(heldOut(held), 4);
    expect(first).toHaveLength(4);
    expect(drawn(heldOut(held.toReversed()), 4)).toEqual(first);
    expect(scoredSet(heldOut(held), 4, "contract-b").tasks).not.toEqual(first);
    expect(drawn(heldOut([...held, "v7"]), 7).filter((version) => version !== "v7")).toEqual(
      drawn(heldOut(held), 6),
    );
    const released = [
      ...heldOut(held),
      { at, kind: TASK_STATE, data: { version: "v3", state: "released" } } as const,
    ];
    expect(drawn(released, 12)).not.toContain("v3");
    expect(drawn(heldOut(held), 12).toSorted()).toEqual(held);
    expect(scoredSet(heldOut(held), 12, "contract-a").retained).toEqual([]);
    expect(scoredSet([], 12, "contract-a")).toEqual({ tasks: [], retained: [] });
  });

  it("takes the newest epoch's tasks first, and reads every task held before the promotion as retained", () => {
    // After two promotions a draw over every epoch at once would take two or three tasks the reference
    // failed out of 19; the tasks written since the last promotion are the exam, so they come first,
    // whole.
    const climbed: LogEvent[] = [
      ...heldOut(held),
      { at, kind: "harness.promoted", data: { harness: "h1" } } as const,
      ...heldOut(["v7", "v8"]),
    ];
    // Tasks held before the promotion were written for the harness h1 replaced: retained, one for each
    // three frontier tasks, by their hash. Kept as frontier, one task in four would tie with both sides
    // always valid.
    expect(poolOf(climbed)).toMatchObject({ frontier: ["v7", "v8"], retained: held });
    const newest = scoredSet(climbed, 4, "contract-a");
    expect(newest.tasks.slice(0, 2).toSorted()).toEqual(["v7", "v8"]);
    expect(newest.tasks).toHaveLength(3);
    expect(newest.retained).toEqual(newest.tasks.slice(2));
    expect(held).toContain(newest.retained[0] ?? "");
    expect(drawn(climbed, 1).slice(0, 1)).toEqual(drawn(heldOut(["v7", "v8"]), 1));
    expect(drawn(climbed, 12)).toHaveLength(3);
    // A frontier that fills the target scores its retained share beside it, not what the frontier
    // leaves of the target, which here is none.
    const full = scoredSet(climbed, 2, "contract-a");
    expect(full.tasks.slice(0, 2).toSorted()).toEqual(["v7", "v8"]);
    expect(full.retained).toHaveLength(1);
    expect(full.tasks).toHaveLength(3);
    // A task of the epoch before that the reference stood in is retained too: it chose the reference.
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
    expect(poolOf(stood).frontier.toSorted()).toEqual(["v7", "v8"]);
    const released: LogEvent[] = [
      ...climbed,
      { at, kind: TASK_STATE, data: { version: "v8", state: "released" } } as const,
    ];
    const after = drawn(released, 4);
    expect(after[0]).toBe("v7");
    expect(after).toHaveLength(2);
  });

  it("scores every frontier task, and of the retained tasks one for each three frontier tasks", () => {
    // Nine tasks from before a promotion, three written after: the nine are retained and the set
    // takes one. Taking three of the nine would top a short frontier up with prior-epoch tasks.
    const prior = Array.from({ length: 9 }, (_, nth) => `c${String(nth)}`);
    const open = ["f1", "f2", "f3"];
    const logged: LogEvent[] = [
      ...heldOut(prior),
      { at, kind: "harness.promoted", data: { harness: "h1", from: "h0", rests: [] } },
      ...heldOut(open),
    ];
    expect(poolOf(logged).retained).toHaveLength(9);
    const set = scoredSet(logged, 12, "contract-a");
    expect(set.tasks.filter((version) => open.includes(version)).toSorted()).toEqual(open);
    expect(set.retained).toHaveLength(1);
    expect(set.tasks).toHaveLength(4);
    // The retained draw turns with each comparison begun, so the same retained task does not head
    // every comparison.
    const begun = (id: string) => ({ at, kind: "comparison.started", data: { session: id } }) as const;
    const picks = new Set(
      ["g-3", "g-4", "g-5", "g-6", "g-7"].map((_, nth, ids) =>
        scoredSet([...logged, ...ids.slice(0, nth + 1).map(begun)], 12, "contract-a").retained.join(","),
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("takes the tasks held out since the last comparison began first within an epoch, then the rest by hash", () => {
    // An epoch starts only at a promotion, so tasks written after a comparison that left no room would
    // otherwise be drawn by the hash among those it scored.
    const first = drawn(heldOut(held), 4);
    const started = { at, kind: "comparison.started", data: { session: "g-1", tasks: first } } as const;
    const written = ["v7", "v8", "v9"];
    const events: LogEvent[] = [...heldOut(held), started, ...heldOut(written)];
    const next = drawn(events, 4);
    expect(next.slice(0, 3).toSorted()).toEqual(written);
    expect(next.slice(3)).toEqual(drawn(heldOut(held), 1));
    expect(drawn([...events, { ...started, data: { session: "g-2", tasks: next } }], 9)).toEqual(
      drawn(heldOut([...held, ...written]), 9),
    );
  });

  it("takes the families in turn, one at most two in five of the set where three or more are held, unless the others cannot fill it", () => {
    const family = (name: string, count: number) =>
      heldOut(
        Array.from({ length: count }, (_, n) => `${name}${String(n)}`),
        name,
      );
    const familyOf = (version: string) => version.replace(/\d+$/u, "");
    const share = (events: readonly LogEvent[], target: number) =>
      Map.groupBy(drawn(events, target), familyOf);
    // Six of one family and two each of two others: at a target of five, two of the large one.
    const many = [...family("a", 6), ...family("b", 2), ...family("c", 2)];
    const five = share(many, 5);
    expect(five.get("a")).toHaveLength(2);
    expect([...five.values()].flat()).toHaveLength(5);
    // Where the large family alone was held out since the last comparison began, it comes first and
    // would take the whole set: the cap leaves it two.
    const began = { at, kind: "comparison.started", data: { session: "g-1" } } as const;
    const newest = share([...family("b", 2), ...family("c", 2), began, ...family("a", 6)], 5);
    expect(newest.get("a")).toHaveLength(2);
    expect([...newest.values()].flat()).toHaveLength(5);
    // The others hold four, so a set of eight takes the rest of the large family to fill it.
    expect(share(many, 8).get("a")).toHaveLength(4);
    expect(share([...family("a", 6), ...family("b", 2)], 5).get("a")).toHaveLength(3);
    expect(drawn([...family("c", 2), ...family("b", 2), ...family("a", 6)], 5).toSorted()).toEqual(
      drawn(many, 5).toSorted(),
    );
  });

  it("draws the tasks held out since first and fills the rest from older epochs, whichever sides it compares", () => {
    // A starter comparison does not score only the tasks held out since: those are above the new
    // reference's grade, and the reference lost them in starter comparisons on record.
    const started = { at, kind: "comparison.started", data: { session: "g-1", tasks: held } } as const;
    const climbed: LogEvent[] = [
      ...heldOut(held),
      started,
      { at, kind: "harness.promoted", data: { harness: "h1" } } as const,
      ...heldOut(["v7", "v8"]),
    ];
    const { tasks } = scoredSet(climbed, 24, "contract-a");
    expect(tasks).toHaveLength(3);
    expect(tasks.slice(0, 2).toSorted()).toEqual(["v7", "v8"]);
  });

  it("keeps a task whose solves were cut at their limits, and leaves out one with no valid answer after two comparisons and the tasks the reference closed twice, until a person keeps the first", async () => {
    {
      const s = await setup([], (version) => (version === "s1" ? LATE : PASS));
      append(s.log, "harness.promoted", { harness: s.old, from: s.starter.digest, rests: [] });
      await checkpoint(s.paired("g-1"));
      await checkpoint(s.paired("g-2"));
      expect(poolOf(read(s.log)).awaiting).toEqual([]);
      expect(poolOf(read(s.log)).scorable).toContain("s1");
    }
    const s = await setup([], (version) => (version === "s1" ? UNANSWERED : PASS));
    append(s.log, "harness.promoted", { harness: s.old, from: s.starter.digest, rests: [] });
    await checkpoint(s.paired("g-1"));
    expect(poolOf(read(s.log)).awaiting).toEqual([]);
    expect(poolOf(read(s.log)).scorable).toContain("s1");
    await checkpoint(s.paired("g-2"));
    // s2 to s5 were held before the promotion, so they are retained as regression checks;
    // with no frontier task left the draw takes none.
    const pool = poolOf(read(s.log));
    expect(pool).toMatchObject({ awaiting: ["s1"], frontier: [] });
    expect(pool.retained.toSorted()).toEqual(["s2", "s3", "s4", "s5"]);
    expect(scoredSet(read(s.log), 12, "c")).toEqual({ tasks: [], retained: [] });
    // Named for a comparison all the same, it is refused: a name would otherwise be the one way past
    // the draw.
    await expect(checkpoint(s.paired("g-3"))).rejects.toThrow(
      "task s1 waits for a person's label, and is not scored until it has one: tools/campaign/prepare.ts --keep or --infeasible",
    );
    append(s.log, TASK_STATE, {
      version: "s1",
      state: "held",
      reason: "a person read the task as feasible",
    });
    expect(poolOf(read(s.log)).scorable).toContain("s1");
  });

  it("measures projected frontier overlap against the immediately preceding candidate no-step comparison in the epoch", () => {
    const base = heldOut(held);
    expect(frontierOverlap(base, 5, "contract-a", "S")).toBeNull();
    const picked = scoredSet(base, 5, "contract-a");
    const started = {
      at,
      kind: "comparison.started",
      data: {
        session: "g-1",
        old: "S",
        fresh: "h1",
        starter: "S",
        tasks: picked.tasks,
        retained: picked.retained,
      },
    } as const;
    const reportedNoStep = {
      at,
      kind: COMPARISON_REPORTED,
      data: { session: "g-1", old: "S", fresh: "h1", starter: "S", reading: NO_STEP, versions: picked.tasks },
    } as const;
    const samePool: LogEvent[] = [...base, started, reportedNoStep];
    expect(frontierOverlap(samePool, 5, "contract-a", "S")).toEqual({
      ratio: 1,
      overlap: 5,
      total: 5,
      priorSession: "g-1",
    });
    // Adding 2 fresh tasks reduces overlap on target=5 to 3/5 (60% < 80%).
    const withTwoFresh = frontierOverlap([...samePool, ...heldOut(["n1", "n2"])], 5, "contract-a", "S");
    expect(withTwoFresh).toMatchObject({ overlap: 3, total: 5, priorSession: "g-1" });
    expect(withTwoFresh?.ratio).toBeLessThan(OVERLAP_LIMIT);
    expect(
      frontierOverlap([...samePool, ...heldOut(["n1", "n2", "n3", "n4", "n5"])], 5, "contract-a", "S"),
    ).toMatchObject({ ratio: 0, overlap: 0, total: 5 });
    const starterReport = {
      at,
      kind: COMPARISON_REPORTED,
      data: { session: "g-1", old: "h1", fresh: "S", starter: "S", reading: NO_STEP, versions: picked.tasks },
    } as const;
    expect(frontierOverlap([...base, started, starterReport], 5, "contract-a", "h1")).toBeNull();
    const stepReport = {
      at,
      kind: COMPARISON_REPORTED,
      data: { session: "g-1", old: "S", fresh: "h1", starter: "S", reading: "step", versions: picked.tasks },
    } as const;
    expect(frontierOverlap([...base, started, stepReport], 5, "contract-a", "S")).toBeNull();
    expect(
      frontierOverlap(
        [...samePool, { at, kind: "harness.promoted", data: { harness: "h1" } }],
        5,
        "contract-a",
        "h1",
      ),
    ).toBeNull();
  });
});

describe("a judged comparison", () => {
  const judging = (log: string, better: string, broken = new Set<string>()): Judging => {
    const harnessOf = (solve: string) => ranUnder(read(log)).find(({ id }) => id === solve)?.under.harness;
    return {
      weights: { code: 0, judge: 1 },
      reviewer: "faux/faux-judge",
      pair: async (version, { comparison, first, second }) => {
        if (broken.delete(first)) throw new Error("the judge's login is at its limit");
        const sign = Number(harnessOf(first) === better) - Number(harnessOf(second) === better);
        append(log, "referee.pair", {
          comparison,
          task: version,
          solve: first,
          old: second,
          reader: "j",
          judge: sign,
          holistic: sign,
        });
      },
    };
  };
  const pairs = (log: string) => read(log).filter(({ kind }) => kind === "referee.pair").length;

  it("reads a step that the judge alone carries, holds its A/A at zero, and locks its terms", async () => {
    const all: Table = () => PASS;
    const plain = await compared(all);
    expect(plain.report.reading).toBe(NO_STEP);
    const s = await setup([], all);
    const fresh = s.paired("g-judged").fresh.digest;
    const report = await checkpoint(s.paired("g-judged", { judge: judging(s.log, fresh) }));
    expect(report.reading).toBe("step");
    expect(report.noise?.differences.every((difference) => difference === 0)).toBe(true);
    const fixed = fixedIn(read(s.log), "g-judged");
    expect(fixed?.judge).toEqual({ code: 0, judge: 1 });
    expect(fixed === null ? null : judgingLeft(read(s.log), fixed)).toEqual([]);
    expect(pairs(s.log)).toBe(HELD.length * 3);
    const reported = lastReports(read(s.log)).filter((one) => one.session === "g-judged");
    const later = reported.flatMap((one) => pairsReported(read(s.log), one));
    expect(later).toHaveLength(HELD.length);
    for (const pair of later) {
      expect(pair.judged?.votes.length).toBeGreaterThan(0);
      expect(informative(pair, "old", new Set())).toBe(true);
    }
  });

  it("stops before its report when a vote is missing, and goes on from its log without solving again", async () => {
    const s = await setup([], () => PASS);
    const fresh = s.paired("g-resume").fresh.digest;
    const once = new Set<string>();
    const broken = judging(s.log, fresh, once);
    let armed = true;
    const request = s.paired("g-resume", {
      judge: {
        ...broken,
        pair: async (version, asked, kill) => {
          if (armed) once.add(asked.first);
          armed = false;
          await broken.pair(version, asked, kill);
        },
      },
    });
    await expect(checkpoint(request)).rejects.toThrow("the judge gave no vote on 1 pair,");
    const solvesBefore = s.asked.length;
    const judgedBefore = pairs(s.log);
    const report = await checkpoint(s.paired("g-resume", { judge: judging(s.log, fresh) }));
    expect(s.asked).toHaveLength(solvesBefore);
    expect(pairs(s.log)).toBe(judgedBefore + 1);
    expect(report.reading).toBe("step");
  });

  it("stops asking after three silent pairs, and after the first refusal no retry clears", async () => {
    const asked = [];
    for (const [at, said] of ["the judge's session ended", "the model is not supported"].entries()) {
      const s = await setup([], () => PASS);
      const judge = judging(s.log, s.paired(`g-silent-${String(at)}`).fresh.digest);
      let calls = 0;
      const silent: Judging = {
        ...judge,
        pair: async () => {
          calls += 1;
          throw new Error(said);
        },
      };
      await expect(checkpoint(s.paired(`g-silent-${String(at)}`, { judge: silent }))).rejects.toThrow(
        "the judge gave no vote on",
      );
      asked.push(calls);
    }
    const [quiet = 0, refused = 0] = asked;
    expect(quiet).toBeGreaterThanOrEqual(3);
    expect(quiet).toBeLessThan(HELD.length * 3);
    expect(refused).toBeLessThan(quiet);
  });

  it("reads a comparison whose last vote spends the budget down, and stops on a kill while judging", async () => {
    const s = await setup([], () => PASS);
    append(s.log, "campaign.opened", { budget: { dollars: 1000, reserve: 2 } });
    const fresh = s.paired("g-spent").fresh.digest;
    const judge = judging(s.log, fresh);
    let left = HELD.length * 3;
    const spending: Judging = {
      ...judge,
      pair: async (version, asked, kill) => {
        await judge.pair(version, asked, kill);
        left -= 1;
        if (left === 0) {
          append(s.log, "referee.brief", { comparison: "g-spent", task: version, reader: "j", billed: 999 });
        }
      },
    };
    const drained = await checkpoint(s.paired("g-spent", { judge: spending }));
    expect(drained).toMatchObject({ reading: "step" });
    expect(drained.capped).not.toBe(true);
    const k = await setup([], () => PASS);
    const kill = new AbortController();
    const killing: Judging = {
      ...judging(k.log, k.paired("g-kill").fresh.digest),
      pair: async () => {
        kill.abort();
        throw new Error("aborted");
      },
    };
    const request = k.paired("g-kill", { judge: killing, kill: kill.signal });
    await expect(checkpoint(request)).rejects.toThrow("the comparison was killed");
    const resumed = await checkpoint(
      k.paired("g-kill", { judge: judging(k.log, k.paired("g-kill").fresh.digest) }),
    );
    expect(resumed.reading).toBe("step");
  });

  it("records report-only A/A noise.spread diagnostics without altering a clearing step reading", async () => {
    const s = await setup([], (_version, side, nth) => {
      const oldScore = nth === 0 ? 0.5 : 0.7;
      return { ending: PASS, objective: side === "old" ? oldScore : 0.68 };
    });
    const six = ["t1", "t2", "t3", "t4", "t5", "t6"];
    for (const version of six) {
      append(s.log, "task.proposed", { version, taskId: version, family: version });
      append(s.log, "task.gate", { version, gate: 1, outcome: "passed" });
    }
    const req = s.paired("g-spread", {
      level: 0.02,
      objective: { direction: "higher", scale: "unit" },
      solves: 2,
      tasks: six,
    });
    const reported = await checkpoint(req);
    expect(reported.reading).toBe("step");
    expect(reported.noise?.spread).toBeDefined();
    expect(reported.noise?.spread?.max).toBeGreaterThan(0);
    expect(reported.noise?.spread?.zeroedStep).toBe(false);
    expect(reported.noise?.spread?.zeroedP).toBeGreaterThan(0.02);
  });
});
