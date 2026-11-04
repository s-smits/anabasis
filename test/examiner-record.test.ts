// What a writing session hears of its campaign's past (`heard`): the last comparison the reference
// stood in, from its side, then every task under the reference's outcome on it, with its author's
// claim where the task is still open, then the promotion and the drafts the gate refused.
import { beforeAll, describe, expect, it } from "bun:test";
import { heard, triedAs } from "../src/examiner/record.ts";
import { examine } from "../src/examiner/session.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { contentOf, proposalsOf, writtenTasks } from "../src/kernel/history.ts";
import { append, type EventKind, type LogEvent } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { condition, finish, seat } from "./helpers/examiner-seat.ts";

const TASK_ADMISSION = "task.gate";
const PROPOSED = "task.proposed";
const TASK_STATE = "task.state";
/** A solver-side secret no Examiner may be shown: the text of a measured solve's answer. */
const SOLVER = "solver-canary-7f3a";
const PASS: Ending = { outcome: "pass" };
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
const WALLED: Ending = { outcome: "fail", kind: "wall-ended" };
const VALID = "a valid answer on record";
const NONE = "no valid answer on record";
/** What an author said of its draft when it put it. */
const CLAIM = { grade: 4, stops: "A solver that pools the strata misses the stated variance." };
type Told = ReturnType<typeof heard>;

/** A log built by hand: tasks held out by id, solves of them under a harness, and reports. */
function logged() {
  const events: LogEvent[] = [];
  const add = (kind: EventKind, data: JsonObject) =>
    events.push({ at: "2026-11-04T00:00:00.000Z", kind, data });
  let solves = 0;
  return {
    events,
    add,
    /** Each task proposed whole and held out, with `claim` where its author put one. */
    hold: (ids: readonly string[], claim: JsonObject | null = null) => {
      for (const taskId of ids) {
        const task = { taskId, family: "fixture", publicInput: {}, hidden: null };
        add(PROPOSED, { version: `v-${taskId}`, taskId, task, ...keyIfNotNull("claim", claim) });
        add(TASK_ADMISSION, { version: `v-${taskId}`, gate: 1, outcome: "passed" });
      }
    },
    /** A draft the gate refused for `reason`. */
    refuse: (taskId: string, reason: string) => {
      const task = { taskId, family: "fixture", publicInput: {}, hidden: null };
      add(PROPOSED, { version: `v-${taskId}`, taskId, task });
      add(TASK_ADMISSION, { version: `v-${taskId}`, gate: 1, outcome: "refused", reason });
      add(TASK_STATE, { version: `v-${taskId}`, state: "refused" });
    },
    /** A solve each of `valid` under `harness` in `comparison`, null for one its deadline cut; each
     *  took the turns given, and 11 where none is. */
    solved: (
      comparison: string,
      taskId: string,
      harness: string,
      valid: readonly (boolean | null)[],
      turns: readonly number[] = [],
    ) => {
      const ran = condition(`v-${taskId}`, harness);
      add("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
      for (const [nth, pass] of valid.entries()) {
        solves += 1;
        const solve = `t-${String(solves)}`;
        add("solve.started", { solve, condition: conditionId(ran), comparison });
        if (pass !== null) {
          add("verdict", { solve, kind: pass ? "pass" : "fail", answer: { answer: SOLVER } });
        }
        add("solve.finished", {
          solve,
          ending: pass === null ? WALLED : pass ? PASS : REJECTED,
          turns: turns[nth] ?? 11,
        });
      }
    },
    /** A comparison's report: its harnesses, its tasks, those set aside, its scores (positive where
     *  the fresh side won) and its A/A. */
    reported: (
      session: string,
      [old, fresh]: readonly [string, string],
      ids: readonly string[],
      more: { aside?: readonly string[]; differences?: readonly number[]; noise?: JsonObject } = {},
    ) =>
      add("comparison.reported", {
        session,
        reading: "no-step",
        old,
        fresh,
        starter: "h1",
        solves: 2,
        setting: settingId(condition("any", "any")),
        versions: ids.map((id) => `v-${id}`),
        aside: (more.aside ?? []).map((id) => `v-${id}`),
        scored: { differences: [...(more.differences ?? ids.map(() => 0))] },
        noise: more.noise ?? null,
      }),
  };
}
const fixture = (taskId: string) => ({ taskId, family: "fixture" });
/** The block whose heading holds `word`, its lines by task id. */
function block(told: Told, word: string): Record<string, string> {
  const found = told.groups.filter(({ heading }) => heading.includes(word));
  expect(found).toHaveLength(1);
  return Object.fromEntries(
    (found[0]?.lines ?? []).map((line) => [line.split(" (fixture)")[0] ?? "", line] as const),
  );
}

describe("the tasks a writing session hears", () => {
  const log = logged();
  const tasks = ["some", "none", "every", "unsolved", "practice", "aside", "new", "faulted", "refused"].map(
    fixture,
  );
  beforeAll(() => {
    log.hold(tasks.map(({ taskId }) => taskId));
    log.solved("b-1", "some", "h1", [true, false], [7, 1]);
    log.solved("b-1", "some", "h2", [true, true]);
    log.solved("b-1", "none", "h1", [false, false]);
    log.solved("b-1", "none", "h2", [true, true]);
    log.solved("b-1", "every", "h1", [true, true], [3, 3]);
    log.solved("b-1", "every", "h2", [true, true]);
    log.solved("b-1", "unsolved", "h1", [false, false]);
    log.solved("b-1", "unsolved", "h2", [false, false]);
    log.reported("b-1", ["h1", "h2"], ["some", "none", "every", "unsolved"], {
      aside: ["aside"],
      differences: [300, 600, 0, 0],
    });
    log.add(TASK_STATE, { version: "v-practice", state: "released" });
    log.add(TASK_STATE, { version: "v-faulted", state: "disputed" });
    log.add(TASK_STATE, { version: "v-refused", state: "refused" });
  });

  it("groups each task under the reference's outcome, with the turns its valid answers took, who won and on which measure, and whether a valid answer is on record", () => {
    // h1, the comparison's old side, is the reference. A refused task is in no block.
    const told = heard(log.events, tasks);
    const order = [
      "no solve",
      "some solves",
      "every solve",
      "Not yet compared",
      "Set aside",
      "at fault",
      "practice",
    ];
    expect(told.groups.map(({ heading }) => order.findIndex((word) => heading.includes(word)))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    const none = block(told, "no solve");
    expect(Object.keys(none)).toEqual(["none", "unsolved"]);
    for (const [line, facts] of [
      [none.none, [VALID, "won there by the harness it was compared with on validity"]],
      [none.unsolved, [NONE, "tied there"]],
      [block(told, "some solves").some, ["in 7 turns", "won there by the harness it was compared with"]],
      [block(told, "every solve").every, ["in 3, 3 turns", "tied there"]],
      [block(told, "Not yet compared").new, [NONE]],
      [block(told, "Set aside").aside, [NONE]],
      [block(told, "at fault").faulted, []],
    ] as const) {
      expect(line).toBeDefined();
      for (const fact of facts) expect(line).toContain(fact);
    }
    // Each heading says what its block means once, and no line repeats it.
    for (const { lines } of told.groups) {
      for (const line of lines) expect(line).not.toMatch(/valid in (every|some|no) solve|not yet compared/u);
    }
    expect(block(told, "practice")).toEqual({ practice: "practice (fixture)" });
    expect(JSON.stringify(told)).not.toContain("refused (fixture)");
  });

  it("opens a session with the last comparison, then the tasks, then the refusals, naming no harness, no answer and no verdict of the author's work", async () => {
    const s = seat("write", [finish, finish]);
    for (const event of log.events) append(s.log, event.kind, event.data);
    append(s.log, PROPOSED, {
      version: "v-bent",
      taskId: "bent",
      task: { ...fixture("bent"), publicInput: {} },
    });
    append(s.log, TASK_ADMISSION, {
      version: "v-bent",
      gate: 1,
      outcome: "refused",
      reason: "it names no base",
    });
    append(s.log, TASK_STATE, { version: "v-bent", state: "refused" });
    await examine({ ...s.request, tasks: tasks.map((task) => ({ ...task, publicInput: {}, hidden: null })) });
    const opening = s.sent[0] ?? "";
    const told = heard(log.events, tasks);
    const at = (text: string) => opening.indexOf(JSON.stringify(text).slice(1, -1));
    const places = [told.last ?? "", ...told.groups.map(({ heading }) => heading), "it names no base"].map(
      at,
    );
    expect(places).not.toContain(-1);
    expect(places).toEqual(places.toSorted((a, b) => a - b));
    for (const line of told.groups.flatMap(({ lines }) => lines)) expect(at(line)).toBeGreaterThan(-1);
    for (const absent of ["h1", "h2", SOLVER, "too easy", "| family |", "gate 1 of", "said at its finish"]) {
      expect(opening).not.toContain(absent);
    }
  });
});

describe("the last comparison the reference stood in", () => {
  /** Three tasks the reference h1 answered in some, every and no solve, one set aside, and a
   *  comparison in which h2 won `a`. */
  const compared = () => {
    const log = logged();
    log.hold(["a", "b", "c", "d"]);
    log.solved("c-1", "a", "h1", [true, false]);
    log.solved("c-1", "a", "h2", [true, true]);
    log.solved("c-1", "b", "h1", [true, true]);
    log.solved("c-1", "b", "h2", [true, true]);
    log.solved("c-1", "c", "h1", [false, false]);
    log.solved("c-1", "c", "h2", [false, false]);
    return log;
  };

  it("tells its tally from the reference's side, every, some and none of its solves valid, the tasks set aside and its own solves set against each other", () => {
    const log = compared();
    log.reported("c-1", ["h1", "h2"], ["a", "b", "c"], {
      aside: ["d"],
      differences: [300, 0, 0],
      noise: { differences: [0, 600, -120] },
    });
    const tasks = ["a", "b", "c"].map(fixture);
    const told = heard(log.events, tasks);
    for (const fact of [
      "c-1",
      "scored 3 tasks",
      "the reference harness won 0, the harness it was compared with won 1, and 2 tied",
      "valid in every solve on 1 of them, in some on 1 and in none on 1",
      "1 more was set aside",
      "differed on 2 of the 3",
    ]) {
      expect(told.last).toContain(fact);
    }
    // A comparison between two other harnesses, before or after, is none of the reference's.
    const first = log.events.length;
    log.solved("c-0", "b", "h3", [false, false], [9, 9]);
    log.solved("c-0", "b", "h4", [true, true]);
    log.reported("c-0", ["h3", "h4"], ["b"], { differences: [600] });
    const control = log.events.splice(first);
    const held = log.events.findLastIndex(({ kind }) => kind === TASK_ADMISSION) + 1;
    expect(heard(log.events.toSpliced(held, 0, ...control), tasks).last).toBe(told.last);
    expect(heard([...log.events, ...control], tasks).last).toBe(told.last);
    expect(JSON.stringify(told)).not.toMatch(/\bh[1-4]\b/u);
  });

  it("reads the tally from the fresh side where the reference was promoted on that comparison, and tells no A/A of the side it replaced", () => {
    const log = compared();
    log.reported("c-1", ["h1", "h2"], ["a", "b", "c"], {
      differences: [600, 300, -600],
      noise: { differences: [0, 600, -120] },
    });
    log.add("harness.promoted", { harness: "h2", from: "h1", rests: [{ comparison: "c-1" }] });
    const told = heard(log.events, ["a", "b", "c"].map(fixture));
    expect(told.last).toContain(
      "the reference harness won 2, the harness it was compared with won 1, and 0 tied",
    );
    expect(told.last).toContain("valid in every solve on 2 of them, in some on 0 and in none on 1");
    expect(told.last).not.toContain("differed");
  });

  it("is null before any comparison", () => {
    const log = logged();
    log.hold(["a"]);
    expect(heard(log.events, [fixture("a")]).last).toBeNull();
    expect(heard([], []).last).toBeNull();
  });
});

describe("what an author said of its draft", () => {
  it("is told on a line whose task is open, not yet compared or on the frontier, and on no task the reference has closed", () => {
    const log = logged();
    log.hold(["open", "closed", "new"], CLAIM);
    log.hold(["unclaimed"]);
    for (const comparison of ["c-1", "c-2"]) {
      log.solved(comparison, "open", "h1", [true, false]);
      log.solved(comparison, "open", "h2", [true, true]);
      log.solved(comparison, "closed", "h1", [true, true]);
      log.solved(comparison, "closed", "h2", [true, true]);
      log.reported(comparison, ["h1", "h2"], ["open", "closed"]);
    }
    const told = heard(log.events, ["open", "closed", "new", "unclaimed"].map(fixture));
    const said = `, graded 4 by its author: "${CLAIM.stops}"`;
    expect(block(told, "some solves").open).toStartWith(`open (fixture)${said}; `);
    expect(block(told, "Not yet compared").new).toStartWith(`new (fixture)${said}`);
    expect(block(told, "every solve").closed).not.toContain("graded");
    // A proposal written before claims were logged reads as one without a claim.
    expect(block(told, "Not yet compared").unclaimed).toBe(`unclaimed (fixture); ${NONE}`);
    expect(proposalsOf(log.events).map(({ claim }) => claim)).toEqual([CLAIM, CLAIM, CLAIM, null]);
    // The claim stands beside the task, never inside it.
    for (const task of [
      ...proposalsOf(log.events).map(({ task: whole }) => whole),
      ...writtenTasks(log.events),
    ]) {
      expect(task).not.toHaveProperty("claim");
    }
  });
});

describe("after a promotion", () => {
  it("says the reference was promoted and how many tasks were held before then, and tells only the refusals since, by reason", () => {
    const log = logged();
    log.hold(["old"]);
    log.refuse("before", "it names no base");
    log.add("harness.promoted", { harness: "h2", from: "h1", rests: [{ comparison: "g-9" }] });
    log.hold(["new"]);
    log.refuse("bent", "it names no base");
    log.refuse("twisted", "it names no base");
    log.refuse("short", "its hidden values are missing");
    const told = heard(log.events, ["old", "new"].map(fixture));
    expect(told.promoted).toContain("g-9");
    expect(told.promoted).toContain("1 of the 2 tasks");
    expect(told.refused).toEqual([
      "it names no base: bent (fixture), twisted (fixture)",
      "its hidden values are missing: short (fixture)",
    ]);
    const unpromoted = heard(
      log.events.filter(({ kind }) => kind !== "harness.promoted"),
      ["old", "new"].map(fixture),
    );
    expect(unpromoted.promoted).toBeNull();
    expect(unpromoted.refused[0]).toContain("before (fixture), bent (fixture)");
  });
});

describe("a draft its author tried on the reference", () => {
  it("is told with the current reference's tries on its line, under the content's id or the task's own, and none of a reference a promotion replaced", () => {
    const log = logged();
    const drafted = { taskId: "drafted", family: "fixture", publicInput: { base: 1 }, hidden: null };
    const { taskId: _unnamed, ...content } = drafted;
    const tried = (session: string, solve: string, task: string, ending: Ending, turns: number) => {
      log.add("solve.started", { solve, task, comparison: session });
      if (ending.outcome === "pass") log.add("verdict", { solve, kind: "pass", answer: { answer: SOLVER } });
      log.add("solve.finished", { solve, ending, turns, billed: 1 });
    };
    log.add("exam.started", { session: "x-1" });
    tried("x-1", "x-1-p1", triedAs(contentOf(content)), PASS, 9);
    log.hold(["old"]);
    log.add("harness.promoted", { harness: "h2", from: "h1", rests: [{ comparison: "g-9" }] });
    log.add("exam.started", { session: "x-2" });
    // Tried before it was put, then put and held; and a held task tried under its own id.
    tried("x-2", "x-2-p1", triedAs(contentOf(content)), PASS, 4);
    tried("x-2", "x-2-p2", triedAs(contentOf(content)), REJECTED, 12);
    tried("x-2", "x-2-p3", "old", { outcome: "non-result", kind: "provider", reason: "overloaded" }, 0);
    log.add(PROPOSED, { version: "v-drafted", taskId: "drafted", task: drafted });
    log.add(TASK_ADMISSION, { version: "v-drafted", gate: 1, outcome: "passed" });
    const tasks = [fixture("old"), drafted];
    const lines = block(heard(log.events, tasks), "Not yet compared");
    expect(lines.drafted).toEndWith("; tried at writing: valid in 1 of 2, in 4 turns");
    // A solve that could not run is no try.
    expect(lines.old).not.toContain("tried at writing");
    // Without the promotion, the replaced reference's try is the current one's too.
    const unpromoted = heard(
      log.events.filter(({ kind }) => kind !== "harness.promoted"),
      tasks,
    );
    expect(block(unpromoted, "Not yet compared").drafted).toEndWith("valid in 2 of 3, in 4, 9 turns");
    expect(JSON.stringify(heard(log.events, tasks))).not.toContain(SOLVER);
  });
});

describe("a task's comparisons with the reference", () => {
  it("are told newest first with the run that closed it, from the reference's side alone, and a task last compared between two other harnesses by its id", () => {
    const build = (other: readonly (boolean | null)[]) => {
      const log = logged();
      log.hold(["run", "mixed", "once", "elsewhere"]);
      for (const comparison of ["b-1", "b-2", "b-3", "b-4"]) {
        log.solved(comparison, "run", "h1", [true, true]);
        log.solved(comparison, "run", "h2", other);
      }
      for (const [comparison, valid] of [
        ["b-1", [true, true]],
        ["b-2", [false, null]],
        ["b-3", [true, true]],
      ] as const) {
        log.solved(comparison, "mixed", "h1", valid);
        log.solved(comparison, "mixed", "h2", other);
      }
      log.solved("b-1", "once", "h1", [true, false]);
      log.solved("b-1", "once", "h2", other);
      log.reported("b-1", ["h1", "h2"], ["run", "mixed", "once"]);
      log.reported("b-2", ["h1", "h2"], ["run", "mixed"]);
      log.reported("b-3", ["h1", "h2"], ["run", "mixed"]);
      log.reported("b-4", ["h1", "h2"], ["run"]);
      log.solved("b-5", "elsewhere", "h3", [true, true]);
      log.solved("b-5", "elsewhere", "h4", [false, false]);
      log.reported("b-5", ["h3", "h4"], ["elsewhere"]);
      return heard(log.events, ["run", "mixed", "once", "elsewhere"].map(fixture));
    };
    const told = build([false, false]);
    const every = block(told, "every solve");
    expect(every.run).toContain("in 11, 11 turns");
    expect(every.run).toContain("last 3 comparisons, newest first: every, every, every");
    expect(every.run).toContain("the last 4 in a row closed it");
    expect(every.mixed).toContain(
      "last 3 comparisons, newest first: every, none (a solve cut at a limit), every",
    );
    expect(every.mixed).toContain("the last closed it");
    expect(block(told, "some solves").once).not.toContain("last");
    expect(block(told, "two other harnesses")).toEqual({ elsewhere: "elsewhere (fixture)" });
    // Whatever the other harness did, the history reads the same.
    expect(block(build([true, null]), "every solve").mixed).toBe(every.mixed);
  });
});
