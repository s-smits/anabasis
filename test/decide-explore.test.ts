// The decision table searched rather than sampled. An environment answers each move the production
// `decide` returns with every outcome a seat or a comparison could give it, and a breadth-first
// search from seeds placed at each stage of a campaign asks the table of every log it reaches
// whether the invariants below hold. There is no second model of the table: the environment invents
// only what seats and comparisons write, and the search must reach every row and ending, so it
// cannot pass by exploring nothing. The invariants span moves (the reference's lineage, no second
// draw of one pair, an end within the patience) rather than restating one row.
import { describe, expect, it } from "bun:test";
import { stopRule } from "../src/campaign/admission.ts";
import { decide, practiceDue } from "../src/campaign/decide.ts";
import { groundOf, type Plan } from "../src/campaign/ground.ts";
import type { Decided } from "../src/campaign/move.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  comparedAs,
  endedOf,
  endingOf,
  latestBuilt,
  poolOf,
  referenceOf,
  releaseOrder,
} from "../src/kernel/reports.ts";
import { taskSets } from "../src/kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tallied } from "./helpers/tally.ts";

type Counts = readonly [number, number, number];
interface Reading {
  readonly reading: string;
  readonly tally: Counts;
  readonly old: Counts;
  readonly fresh: Counts;
}
interface State {
  readonly events: readonly LogEvent[];
  readonly decided: Decided;
}

const AT = "2026-11-21T00:00:00.000Z";
const STARTER = "start";
const PROMOTED_EVENT = "harness.promoted";
const REPORTED_EVENT = "comparison.reported";
const PLAN: Plan = {
  patience: 2,
  unprepared: false,
  practice: null,
  wanted: { target: 8, level: 0.1, solves: 2 },
  pastStop: null,
  prompted: false,
  admits: [],
  left: null,
  promotions: null,
};
/** What a comparison can report, as the counts of tasks each side answered validly on none, one or
 *  both of its two solves. The Builder's own comparisons take the first three. */
const READINGS: readonly [Reading, Reading, Reading, Reading, Reading] = [
  { reading: "step", tally: [5, 0, 3], old: [3, 3, 2], fresh: [0, 2, 6] },
  { reading: "no-step", tally: [2, 2, 4], old: [3, 3, 2], fresh: [3, 3, 2] },
  { reading: "no-step", tally: [0, 0, 8], old: [0, 0, 8], fresh: [0, 0, 8] },
  { reading: "no-step", tally: [0, 0, 8], old: [8, 0, 0], fresh: [8, 0, 0] },
  { reading: "not-scored", tally: [0, 0, 0], old: [0, 0, 0], fresh: [0, 0, 0] },
];
/** The comparison a led Builder asks for: its latest harness against the reference. */
const BUILDER_COMPARES = {
  move: "compare",
  fresh: "latest",
  reference: "promoted",
  why: "",
  code: "build",
} as const satisfies Extract<Decided, { move: "compare" }>;

const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const count = (events: readonly LogEvent[], kind: EventKind) =>
  events.filter((one) => one.kind === kind).length;
const heldOut = (version: string) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
const heldVersions = (events: readonly LogEvent[]) =>
  events.flatMap(({ kind, data }) => (kind === "task.gate" && isString(data.version) ? [data.version] : []));

/** The harnesses a comparison move names, as the host resolves them. */
function sidesOf(events: readonly LogEvent[], move: Extract<Decided, { move: "compare" }>) {
  const reference = referenceOf(events) ?? STARTER;
  const resolve = (named: string) =>
    ({ starter: STARTER, latest: latestBuilt(events) ?? reference, promoted: reference })[named] ?? named;
  return { old: resolve(move.reference), fresh: resolve(move.fresh) };
}

function compared(
  events: readonly LogEvent[],
  move: Extract<Decided, { move: "compare" }>,
  readings: readonly Reading[] = READINGS,
) {
  const { old, fresh } = sidesOf(events, move);
  const session = move.id ?? `g${String(events.length)}`;
  const started =
    move.id === undefined ? [event("comparison.started", { session, old, fresh, starter: STARTER })] : [];
  return readings.map(({ reading, tally, old: oldValid, fresh: freshValid }) => [
    ...started,
    event(REPORTED_EVENT, {
      session,
      old,
      fresh,
      starter: STARTER,
      reading,
      ...tallied(...tally),
      versions: heldVersions(events),
      valid: {
        old: [...oldValid],
        fresh: [...freshValid],
        informative: { old: oldValid[1], fresh: freshValid[1] },
      },
      setting: null,
    }),
  ]);
}

/** Every log a seat or a comparison could write in answer to `move`. */
function answers(events: readonly LogEvent[], move: Decided, plan: Plan): LogEvent[][] {
  const id = `s${String(events.length)}`;
  switch (move.move) {
    case "accept": {
      return [
        [event("checker.read", { contract: "c", checks: "k", faults: [] })],
        [event("checker.read", { contract: "c", checks: "k", faults: ["check-a: authored"] })],
      ];
    }
    case "examine": {
      const fresh = Array.from({ length: 6 }, (_, at) => `${id}t${String(at)}`);
      const finished = (more: JsonObject) => event("exam.finished", { session: id, refused: [], ...more });
      return [
        [finished({ held: fresh, proposed: 6, ended: "finished" }), ...fresh.flatMap(heldOut)],
        [finished({ held: [], proposed: 0, ended: "finished" })],
        [finished({ held: [], proposed: 0, ended: "crashed", crash: "overloaded" })],
      ];
    }
    case "build": {
      // A led Builder makes its own moves in its session: it leaves a harness, and may then ask for
      // that harness's comparison, which admission takes or refuses, before or after it has the
      // Examiner hold out more tasks.
      const harness = `h${String(count(events, "build.finished") + 1)}`;
      const built = event("build.finished", { session: id, harness, changed: true, ended: "finished" });
      const crashed = event("build.finished", {
        session: id,
        harness,
        changed: false,
        ended: "crashed",
        crash: "x",
      });
      const examined = Array.from({ length: 6 }, (_, at) => `${id}t${String(at)}`).flatMap(heldOut);
      const asks = (written: readonly LogEvent[], readings: readonly Reading[]) => {
        const left = [...events, ...written];
        if (groundOf(left, plan).refused.size > 0) {
          return [];
        }
        return compared(left, BUILDER_COMPARES, readings).map((more) => [...written, ...more]);
      };
      return [
        [crashed],
        [built],
        ...asks([built], READINGS.slice(0, 3)),
        ...asks([built, ...examined], READINGS.slice(0, 1)),
      ];
    }
    case "compare": {
      return compared(events, move);
    }
    case "promote": {
      return [[event(PROMOTED_EVENT, { harness: move.harness })]];
    }
    case "prepare": {
      return [[event("task.state", { version: heldVersions(events)[0] ?? "none", state: "released" })]];
    }
    // A draft is the Examiner's whole opening session, whose exam the other seeds start from; an
    // ending has no answer.
    case "draft":
    case "end": {
      return [];
    }
  }
}

const reportsOf = (events: readonly LogEvent[]) =>
  events.flatMap(({ kind, data }, at) =>
    kind === REPORTED_EVENT && isString(data.old) && isString(data.fresh)
      ? [{ at, old: data.old, fresh: data.fresh, reading: data.reading, room: roomFor(data) }]
      : [],
  );
const roomFor = (data: JsonObject) => {
  const informative = asRecord(asRecord(data.valid)?.informative)?.old;
  return !isNumber(informative) || informative > 0;
};

/** The sentence an invariant breaks on this log and move, or null where all hold. */
function broken(events: readonly LogEvent[], plan: Plan, decided: Decided): string | null {
  const reference = referenceOf(events) ?? STARTER;
  const reports = reportsOf(events);
  const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED_EVENT);
  // Safety: the operator's stop holds over every row, and the budget's reserve over every move that
  // bills; reading the exam and promoting a step already read bill nothing.
  const stopped = events.some(({ kind, data }) => kind === "campaign.word" && data.word === "stop");
  if (stopped && decided.move !== "end") return "a stop the operator left did not end the campaign";
  const spent = plan.left !== null && plan.left.dollars < plan.left.reserve;
  if (spent && !["end", "promote", "accept"].includes(decided.move)) {
    return `a ${decided.move} was chosen with less left than one solve's reserve`;
  }
  const owed = reports.some(
    ({ at, old, fresh, reading }) =>
      at > promotedAt && old === reference && fresh !== STARTER && reading === "step",
  );
  if (spent && owed && decided.move === "end" && decided.ending === "budget") {
    return "the budget ended the campaign before a step read was promoted";
  }
  // Termination: in one epoch, readings of built harnesses that left room and read no step never
  // outnumber the improvement patience, and readings that left nothing to gain never run past the
  // supply patience, so every path ends.
  const epoch = reports.filter(({ at, fresh }) => at > promotedAt && fresh !== STARTER);
  const fruitless = epoch.filter(({ reading, room }) => reading === "no-step" && room).length;
  if (plan.pastStop === null && fruitless > plan.patience) {
    return `${String(fruitless)} no-steps with room in one epoch, past a patience of ${String(plan.patience)}`;
  }
  const roomless =
    reports.length - 1 - reports.findLastIndex(({ reading, room }) => reading === "step" || room);
  if (roomless > plan.patience + 1) {
    return `${String(roomless)} readings in a row left nothing to gain, past a patience of ${String(plan.patience)}`;
  }
  // Lineage: each reference descends from the last by a step read against it.
  if (decided.move === "promote") {
    const { harness } = decided;
    if (harness === reference || harness === STARTER) {
      return `promoted ${harness}, the reference or the starter`;
    }
    if (
      !reports.some(({ old, fresh, reading }) => fresh === harness && old === reference && reading === "step")
    ) {
      return `promoted ${harness} without a step against the reference ${reference}`;
    }
  }
  if (decided.move === "compare" && decided.id === undefined) {
    const { old, fresh } = sidesOf(events, decided);
    if (old === fresh) return `compared ${old} with itself`;
    if (old !== reference) return `compared against ${old}, which is not the reference ${reference}`;
    // No second draw: a pair is drawn again only where its last reading tested nothing or left no
    // room, never after a step (which promotes) or a no-step with room (the Builder changes it).
    const last = reports.findLast((one) => one.old === old && one.fresh === fresh);
    if (last?.reading === "step") {
      return `compared ${fresh} again after it read a step, instead of promoting it`;
    }
    if (last?.reading === "no-step" && last.room) {
      return `drew ${fresh} against ${old} again after a no-step with room`;
    }
  }
  return null;
}

/** Every log reachable from `start` within `depth` moves, with the move the table chose on each. */
function explore(start: readonly LogEvent[], plan: Plan, depth: number): State[] {
  const seen: State[] = [];
  // The host opens every campaign with its terms, so the stop rule reads the plan's patience.
  let frontier: (readonly LogEvent[])[] = [[event("campaign.opened", { patience: plan.patience }), ...start]];
  for (let step = 0; step <= depth; step += 1) {
    const layer = frontier.map((events) => ({ events, decided: decide(events, plan) }));
    seen.push(...layer);
    frontier = layer.flatMap(({ events, decided }) =>
      answers(events, decided, plan).map((written) => [...events, ...written]),
    );
  }
  return seen;
}

const READ = event("checker.read", { contract: "c", checks: "k", faults: [] });
const OPENED = [READ, ...Array.from({ length: 8 }, (_, at) => `v${String(at)}`).flatMap(heldOut)];
const built = (harness: string) =>
  event("build.finished", { session: `b-${harness}`, harness, changed: true, ended: "finished" });
const firstReading = (reading: Reading) =>
  compared([...OPENED, built("h1")], BUILDER_COMPARES, [reading])[0] ?? [];
const PROMOTED = [
  ...OPENED,
  built("h1"),
  ...firstReading(READINGS[0]),
  event(PROMOTED_EVENT, { harness: "h1" }),
];
const ROOM_LEFT = [...OPENED, built("h1"), ...firstReading(READINGS[1])];
const NO_ROOM = [...OPENED, built("h1"), ...firstReading(READINGS[2])];

const STARTS: readonly { name: string; start: readonly LogEvent[]; plan: Plan; depth: number }[] = [
  { name: "an empty log", start: [], plan: PLAN, depth: 7 },
  { name: "a drafted exam from a prompt", start: [], plan: { ...PLAN, prompted: true }, depth: 3 },
  { name: "an opened exam", start: OPENED, plan: PLAN, depth: 7 },
  { name: "an opened exam with practice owed", start: OPENED, plan: { ...PLAN, practice: 1 }, depth: 4 },
  {
    name: "an opened exam and a cap of one promotion",
    start: OPENED,
    plan: { ...PLAN, promotions: 1 },
    depth: 4,
  },
  { name: "a promotion", start: PROMOTED, plan: PLAN, depth: 7 },
  { name: "a no-step that left room", start: ROOM_LEFT, plan: PLAN, depth: 7 },
  { name: "a no-step that left no room", start: NO_ROOM, plan: PLAN, depth: 7 },
  { name: "a patience of three", start: ROOM_LEFT, plan: { ...PLAN, patience: 3 }, depth: 7 },
  {
    name: "a comparison cut before it reported",
    start: [...OPENED, built("h1"), ...firstReading(READINGS[1]).slice(0, 1)],
    plan: PLAN,
    depth: 3,
  },
  { name: "a spent budget", start: OPENED, plan: { ...PLAN, left: { dollars: 1, reserve: 5 } }, depth: 2 },
  {
    name: "a step read and a spent budget",
    start: [...OPENED, built("h1"), ...firstReading(READINGS[0])],
    plan: { ...PLAN, left: { dollars: 1, reserve: 5 } },
    depth: 2,
  },
  {
    name: "a stop left",
    start: [...PROMOTED, event("campaign.word", { word: "stop" })],
    plan: PLAN,
    depth: 2,
  },
];

const SEARCHED = STARTS.map(({ name, start, plan, depth }) => ({
  name,
  plan,
  depth,
  states: explore(start, plan, depth),
}));
const ALL = SEARCHED.flatMap(({ states }) => states);
// A few logs for each start, row and move, for checks too dear to put to every searched log.
const SAMPLED = SEARCHED.flatMap(({ name, plan, states }) =>
  [...Map.groupBy(states, ({ decided }) => `${name} ${decided.code} ${decided.move}`).values()].flatMap(
    (group) => group.slice(0, 25).map((state) => ({ plan, ...state })),
  ),
);

describe("the folds the table and the operator read", () => {
  it("read a campaign's ending from its last event alone, with an empty reason where it names none", () => {
    const ended = (ending?: string, why?: string) =>
      event("campaign.ended", { ...keyIfDefined("ending", ending), ...keyIfDefined("why", why) });
    const lasts = [
      [],
      [event("campaign.word", { word: "go" })],
      [ended()],
      [ended(undefined, "spent")],
      [ended("budget")],
      [ended("budget", "spent")],
    ];
    for (const before of [[], [ended("stop", "asked")]]) {
      for (const last of lasts) {
        const log = [...before, ...last];
        const { kind, data } = log.at(-1) ?? event("campaign.word", {});
        const { ending, why } = data;
        const expected =
          kind === "campaign.ended" && isString(ending) ? { ending, why: isString(why) ? why : "" } : null;
        expect(endedOf(log)).toEqual(expected);
        expect(endingOf(log)).toBe(expected?.ending ?? null);
      }
    }
  });

  it("list every comparison that measured a harness as the new side, at its first place and its last reading", () => {
    const readings = ["h2", "h3"].flatMap((fresh) =>
      [undefined, "base"].flatMap((old) => [undefined, "step"].map((reading) => ({ fresh, old, reading }))),
    );
    const log = readings.map(({ fresh, old, reading }, at) =>
      event(REPORTED_EVENT, {
        session: `b-${String(at)}`,
        fresh,
        ...keyIfDefined("old", old),
        ...keyIfDefined("reading", reading),
      }),
    );
    const reread = event(REPORTED_EVENT, {
      session: "b-0",
      fresh: "h2",
      old: "base",
      reading: "no-step",
    });
    for (const harness of ["h2", "h3", "h9"]) {
      const expected = readings.flatMap(({ fresh, old, reading }, at) =>
        fresh === harness && old !== undefined && reading !== undefined
          ? [{ comparison: `b-${String(at)}`, against: old, reading }]
          : [],
      );
      expect(comparedAs(log, harness)).toEqual(expected);
      expect(comparedAs([...log, reread], harness)).toEqual(
        harness === "h2"
          ? [{ comparison: "b-0", against: "base", reading: "no-step" }, ...expected]
          : expected,
      );
    }
  });

  it("open the next Builder session on a harness promoted while the session ran, though it restored its parent", () => {
    const finished = (session: string, harness: string, changed: boolean) =>
      event("build.finished", { session, harness, changed, ended: "finished" });
    const frozen = event("build.checkpoint", { session: "b-1", harness: "B" });
    const restored = [finished("b-0", "P", true), frozen, finished("b-1", "P", false)];
    expect(latestBuilt(restored)).toBe("P");
    expect(
      latestBuilt(restored.toSpliced(2, 0, event(PROMOTED_EVENT, { harness: "B", from: STARTER }))),
    ).toBe("B");
  });
});

describe("the decision table, searched", () => {
  for (const { name, plan, depth, states } of SEARCHED) {
    it(`holds every invariant on the ${String(states.length)} logs reachable from ${name} within ${String(depth)} moves`, () => {
      const faults = states.flatMap(({ events, decided }) => {
        const fault = broken(events, plan, decided);
        return fault === null
          ? []
          : [{ fault, last: events.slice(-3).map(({ kind }) => kind), decided: decided.code }];
      });
      expect(faults.slice(0, 3)).toEqual([]);
    });
  }

  // The two rows above every other are put to logs on which each lower row answered, a few for each
  // start, row and move, so that a row moved above them meets a log on which it would answer too.
  it("ends on the operator's stop, and on a spent budget all but a move that bills nothing, wherever each row answered", () => {
    const stop = event("campaign.word", { word: "stop" });
    for (const { plan, events, decided } of SAMPLED) {
      const spent = { ...plan, left: { dollars: 1, reserve: 5 } };
      const stopped = [...events, stop];
      expect(broken(stopped, plan, decide(stopped, plan))).toBeNull();
      const tight = decide(events, spent);
      expect(broken(events, spent, tight)).toBeNull();
      if (decided.move === "accept") expect(tight.move).toBe("accept");
    }
  });

  // What the pool's lists mean, stated from their definitions rather than from how `poolOf` finds
  // them, so a changed rule for which task is easy or doubted passes and a list that drops, repeats
  // or crosses tasks does not. A release of fewer tasks takes the front of a larger one.
  it("partitions the held tasks into the pool's lists, and releases the front of one order from its pool", () => {
    const seen = { retained: 0, practiceFrontier: 0, longOrder: 0 };
    for (const { events } of SAMPLED) {
      const { held } = taskSets(events);
      const pool = poolOf(events);
      seen.retained += Math.sign(pool.retained.length);
      seen.practiceFrontier += Math.sign(pool.practiceFrontier.length);
      const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED_EVENT);
      const inherited = new Set(taskSets(events.slice(0, Math.max(0, promotedAt))).held);
      const leftOut = new Set([...pool.awaiting, ...pool.doubted]);
      expect([...pool.scorable, ...leftOut].toSorted()).toEqual(held.toSorted());
      expect([...pool.frontier, ...pool.retained].toSorted()).toEqual(pool.scorable.toSorted());
      expect(pool.practiceFrontier.filter((task) => inherited.has(task) || leftOut.has(task))).toEqual([]);
      expect(pool.practicePool).toEqual(
        held.filter((task) => !inherited.has(task) && !pool.doubted.includes(task)),
      );
      const order = releaseOrder(events, pool.practicePool, held.length, "seed").map(([task]) => task);
      seen.longOrder += order.length >= 2 ? 1 : 0;
      expect(new Set(order).size).toBe(order.length);
      expect(order.filter((task) => !pool.practicePool.includes(task))).toEqual([]);
      for (const taken of [1, 2]) {
        const fewer = releaseOrder(events, pool.practicePool, taken, "seed").map(([task]) => task);
        expect(fewer).toEqual(order.slice(0, taken));
      }
    }
    // No searched log holds an unruled rejection, so `awaiting` and `doubted` are always empty here.
    expect(Object.values(seen).every((times) => times > 0)).toBe(true);
  });

  it("reaches every row, every kind of move and every ending the table names", () => {
    const rows = new Set(ALL.map(({ decided }) => decided.code));
    expect([...rows].toSorted()).toEqual(
      ["bound", "build", "exam", "no-room", "step", "stop", "tasks", "unfinished", "unread"].toSorted(),
    );
    expect([...new Set(ALL.map(({ decided }) => decided.move))].toSorted()).toEqual([
      "accept",
      "build",
      "compare",
      "draft",
      "end",
      "examine",
      "prepare",
      "promote",
    ]);
    const endings = ALL.flatMap(({ decided }) => (decided.move === "end" ? [decided.ending] : []));
    expect([...new Set(endings)].toSorted()).toEqual([
      "budget",
      "environment",
      "exam",
      "no-room",
      "operator",
      "stop",
    ]);
  });

  // The trade-offs `AGENTS.md` section 1 names, shown to be reachable rather than asserted absent.
  // Each release is one task fewer to compare, so releasing what was owed may lower what is owed
  // next but never raise it: a task held out before the last promotion spends the allowance as a
  // frontier task does, though it leaves the frontier as it was.
  it("never owes more practice in total after releasing the oldest or newest held task it owed", () => {
    let inheritedAfterPromotion = 0;
    for (const { events } of ALL) {
      const due = practiceDue(events, 1000, PLAN.wanted.level);
      const { held } = taskSets(events);
      if (due === null) continue;
      const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED_EVENT);
      for (const version of new Set([held[0], held.at(-1)])) {
        if (version === undefined) continue;
        const released = [...events, event("task.state", { version, state: "released" })];
        const after = practiceDue(released, 1000, PLAN.wanted.level);
        expect(after?.to ?? taskSets(released).released.length).toBeLessThanOrEqual(due.to);
        const inherited = events.findIndex(
          ({ kind, data }) => kind === "task.gate" && data.version === version,
        );
        if (inherited < promotedAt) inheritedAfterPromotion += 1;
      }
    }
    expect(inheritedAfterPromotion).toBeGreaterThan(0);
  });

  it("owes a promotion its starter comparison, which the table asks for once tasks are held out for the new reference", () => {
    const confirmed = ALL.some(({ events, decided }) => {
      const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED_EVENT);
      return promotedAt !== -1 && decided.move === "compare" && decided.fresh === "starter";
    });
    expect(confirmed).toBe(true);
  });

  it("lets a Builder's own comparison read first and promote, leaving the last promotion unconfirmed for good", () => {
    const unconfirmed = ALL.some(({ events, decided }) => {
      const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED_EVENT);
      const epoch = reportsOf(events).filter(({ at }) => at > promotedAt);
      return promotedAt !== -1 && decided.move === "promote" && !epoch.some(({ fresh }) => fresh === STARTER);
    });
    expect(unconfirmed).toBe(true);
  });

  it("subtracts current-epoch non-frontier releases from practice allowance, keeps inherited tasks from triggering empty-campaign examine, and preserves sticky roomful counts in stopRule", () => {
    // 1. Exhausted current-epoch task released after a report spends allowance just like inherited tasks.
    const held = (version: string): LogEvent[] => [
      event("task.proposed", { version }),
      event("task.gate", { version, gate: 1, outcome: "passed" }),
    ];
    const cond = (
      task: string,
      harness: string,
    ): { readonly id: string; readonly setting: string; readonly recorded: LogEvent } => {
      const condition = {
        contract: "c",
        harness,
        task,
        model: "m",
        effort: "high",
        prices: { m: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
        runtime: {},
        compaction: "off" as const,
        solverTools: "s",
        verifierTools: "v",
        sandbox: "p",
        limits: { wallSeconds: 60, turns: 10, shellDefaultSeconds: 10, shellMaxSeconds: 20, concurrency: 1 },
        host: "h",
        side: "test" as const,
      };
      const id = conditionId(condition);
      return { id, setting: settingId(condition), recorded: event("condition.recorded", { id, condition }) };
    };
    const pass = (solve: string, condition: string, comparison: string): LogEvent[] => [
      event("solve.started", { solve, condition, comparison }),
      event("solve.finished", { solve, ending: { outcome: "pass" } }),
    ];
    // At level 0.1, comparisonFloor(0.1) = 4 + 2 = 6; hold 1 already-released task (t-0),
    // 7 frontier tasks, and 1 exhausted task (t-ex), so allowance after g-2 is 7 - 6 = 1.
    const cOld = cond("t-ex", STARTER);
    const cNew = cond("t-ex", "h1");
    const base: LogEvent[] = [
      ...["t-0", "t-ex", "t-1", "t-2", "t-3", "t-4", "t-5", "t-6", "t-7"].flatMap(held),
      event("task.state", { version: "t-0", state: "released" }),
      cOld.recorded,
      cNew.recorded,
      ...pass("s-1", cOld.id, "g-1"),
      ...pass("s-2", cNew.id, "g-1"),
      event(REPORTED_EVENT, {
        session: "g-1",
        old: STARTER,
        fresh: "h1",
        starter: STARTER,
        setting: cOld.setting,
        solves: 1,
        versions: ["t-ex"],
        reading: "no-step",
        scored: { wins: 0, losses: 0, ties: 1, p: 1, unsolved: 0 },
        valid: { old: [0, 1], fresh: [0, 1] },
        aside: [],
      }),
      ...pass("s-3", cOld.id, "g-2"),
      ...pass("s-4", cNew.id, "g-2"),
      event(REPORTED_EVENT, {
        session: "g-2",
        old: STARTER,
        fresh: "h1",
        starter: STARTER,
        setting: cOld.setting,
        solves: 1,
        versions: ["t-ex"],
        reading: "no-step",
        scored: { wins: 0, losses: 0, ties: 1, p: 1, unsolved: 0 },
        valid: { old: [0, 1], fresh: [0, 1] },
        aside: [],
      }),
    ];
    expect(poolOf(base).exhausted).toEqual(["t-ex"]);
    expect(practiceDue(base, 3, 0.1)?.to).toBe(2);
    const afterExhaustedRelease = [...base, event("task.state", { version: "t-ex", state: "released" })];
    // Releasing t-ex spent the single allowance slot even though practiceFrontier stayed at 7.
    expect(practiceDue(afterExhaustedRelease, 3, 0.1)).toBeNull();

    // 2. Post-promotion campaign with practice=0 and only inherited held tasks does not say "holds no task".
    const inheritedOnly: LogEvent[] = [
      event("checker.read", { contract: "c", checks: "k", faults: [] }),
      event("contract.frozen", { contract: "c", checks: "k" }),
      ...held("t-old"),
      event(PROMOTED_EVENT, { harness: "h1", from: STARTER, rests: [] }),
    ];
    const move = decide(inheritedOnly, { ...PLAN, practice: 0 });
    expect(move.why).not.toContain("the campaign holds no task");

    // 3. A second no-room report on the same (fresh, old) pair keeps counts:true from its earlier roomful report.
    const sticky: LogEvent[] = [
      event("build.checkpoint", { session: "b-1", harness: "h1" }),
      event(REPORTED_EVENT, {
        session: "g-1",
        old: STARTER,
        fresh: "h1",
        starter: STARTER,
        versions: ["t-1", "t-2"],
        reading: "no-step",
        scored: { wins: 1, losses: 1, ties: 0, p: 0.75, unsolved: 0 },
        valid: { old: [1, 1, 0], fresh: [1, 1, 0] },
        aside: [],
      }),
      event(REPORTED_EVENT, {
        session: "g-2",
        old: STARTER,
        fresh: "h1",
        starter: STARTER,
        versions: ["t-1", "t-2"],
        reading: "no-step",
        scored: { wins: 0, losses: 0, ties: 2, p: 1, unsolved: 0 },
        valid: { old: [0, 0, 2], fresh: [0, 0, 2] },
        aside: [],
      }),
    ];
    expect(stopRule(sticky)).toMatchObject({ checkpoints: 1, sinceStep: 1 });
  });

  it("keeps prior-epoch tasks out of practicePool and releaseOrder's failed half, and caps small batches at half", () => {
    const cond = (task: string, harness: string) => {
      const condition = {
        contract: "c",
        harness,
        task,
        model: "m",
        effort: "high",
        prices: { m: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
        runtime: {},
        compaction: "off" as const,
        solverTools: "s",
        verifierTools: "v",
        sandbox: "p",
        limits: { wallSeconds: 60, turns: 10, shellDefaultSeconds: 10, shellMaxSeconds: 20, concurrency: 1 },
        host: "h",
        side: "test" as const,
      };
      const id = conditionId(condition);
      return { id, setting: settingId(condition), recorded: event("condition.recorded", { id, condition }) };
    };
    const solve = (id: string, condition: string, comparison: string, outcome: "pass" | "fail") => [
      event("solve.started", { solve: id, condition, comparison }),
      event("solve.finished", {
        solve: id,
        ending: outcome === "pass" ? { outcome: "pass" } : { outcome: "fail", kind: "no-answer" },
      }),
    ];

    // 1. Prior-epoch failed tasks (held and released, earlier comparison order) must neither enter
    // practicePool nor crowd current-epoch failed tasks out of releaseOrder's first half.
    const priorTasks = ["old-1", "old-2", "old-3", "old-4"];
    const epochTasks = ["cur-1", "cur-2", "cur-3", "cur-4"];
    const g1Solves = priorTasks.flatMap((task, index) => {
      const cOld = cond(task, STARTER);
      const cFresh = cond(task, "h1");
      return [
        cOld.recorded,
        cFresh.recorded,
        ...solve(`g1-o-${String(index)}`, cOld.id, "g-1", "fail"),
        ...solve(`g1-f-${String(index)}`, cFresh.id, "g-1", "fail"),
      ];
    });
    const g2Solves = epochTasks.flatMap((task, index) => {
      const cOld = cond(task, "h1");
      const cFresh = cond(task, STARTER);
      return [
        cOld.recorded,
        cFresh.recorded,
        ...solve(`g2-o-${String(index)}`, cOld.id, "g-2", "fail"),
        ...solve(`g2-f-${String(index)}`, cFresh.id, "g-2", "fail"),
      ];
    });
    const setting = cond("old-1", "h1").setting;
    const crossEpoch: LogEvent[] = [
      ...priorTasks.flatMap(heldOut),
      ...g1Solves,
      event(REPORTED_EVENT, {
        session: "g-1",
        old: STARTER,
        fresh: "h1",
        starter: STARTER,
        setting,
        solves: 1,
        versions: priorTasks,
        reading: "step",
        scored: { wins: 4, losses: 0, ties: 0, p: 0.06, unsolved: 0 },
        valid: { old: [4, 0], fresh: [4, 0] },
        aside: [],
      }),
      event("task.state", { version: "old-1", state: "released" }),
      event(PROMOTED_EVENT, { harness: "h1", from: STARTER, rests: [] }),
      ...epochTasks.flatMap(heldOut),
      ...g2Solves,
      event(REPORTED_EVENT, {
        session: "g-2",
        old: "h1",
        fresh: STARTER,
        starter: STARTER,
        setting,
        solves: 1,
        versions: epochTasks,
        reading: "no-step",
        scored: { wins: 0, losses: 0, ties: 4, p: 1, unsolved: 4 },
        valid: { old: [4, 0], fresh: [4, 0] },
        aside: [],
      }),
    ];
    const pool = poolOf(crossEpoch);
    expect(pool.practicePool).toEqual(epochTasks);
    const chosen = releaseOrder(crossEpoch, pool.practicePool, 2, "seed").map(([version]) => version);
    expect(chosen).toEqual(["cur-1", "cur-2"]);

    // 2. Small Examiner batches after a comparison release at most half (rounded down) instead of
    // flipping newTasksLimit to Infinity; a 16-task post-promotion batch still releases full practice.
    const report = (session: string, versions: string[]) =>
      event(REPORTED_EVENT, {
        session,
        old: STARTER,
        fresh: "h1",
        starter: STARTER,
        setting,
        solves: 1,
        versions,
        reading: "no-step",
        scored: { wins: 0, losses: 0, ties: versions.length, p: 1, unsolved: 0 },
        valid: { old: [0, versions.length], fresh: [0, versions.length] },
        aside: [],
      });
    const baseTasks = Array.from({ length: 12 }, (_, index) => `b-${String(index + 1)}`);
    const afterReport: LogEvent[] = [
      ...baseTasks.flatMap(heldOut),
      event("task.state", { version: "b-1", state: "released" }),
      report("g-1", ["b-2"]),
      event("task.state", { version: "b-2", state: "released" }),
    ];
    const plusFive = [...afterReport, ...["n-1", "n-2", "n-3", "n-4", "n-5"].flatMap(heldOut)];
    expect(practiceDue(plusFive, 6, 0.02)?.to).toBe(3);
    const plusSeven = [...plusFive, ...["n-6", "n-7"].flatMap(heldOut)];
    expect(practiceDue(plusSeven, 6, 0.02)?.to).toBe(4);
    const afterPromo: LogEvent[] = [
      ...afterReport,
      event(PROMOTED_EVENT, { harness: "h1", from: STARTER, rests: [] }),
      ...Array.from({ length: 16 }, (_, index) => `p-${String(index + 1)}`).flatMap(heldOut),
    ];
    expect(practiceDue(afterPromo, 6, 0.02)?.to).toBe(8);
  });
});
