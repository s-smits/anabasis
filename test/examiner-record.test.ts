// What a writing session hears of its campaign's past (`heard`): the last comparison the reference
// stood in, from its side, then every task under the reference's outcome on it, with the
// reference's turns and measures and the checks ruled at fault on it, then the promotion; and, at a
// wake, only what came since.
import { beforeAll, describe, expect, it } from "bun:test";
import { heard } from "../src/examiner/record.ts";
import { examine } from "../src/examiner/session.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, type LogEvent } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { isNumber, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
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
    /** Each task proposed whole and held out. */
    hold: (ids: readonly string[]) => {
      for (const taskId of ids) {
        const task = { taskId, family: "fixture", publicInput: {}, hidden: null };
        add(PROPOSED, { version: `v-${taskId}`, taskId, task });
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
    /** A solve each of `valid` under `harness` in `comparison`, null for one its deadline cut and a
     *  number for a pass the objective measured so; each took the turns given, and 11 where none is. */
    solved: (
      comparison: string,
      taskId: string,
      harness: string,
      valid: readonly (boolean | number | null)[],
      turns: readonly number[] = [],
    ) => {
      const ran = condition(`v-${taskId}`, harness);
      add("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
      for (const [nth, pass] of valid.entries()) {
        solves += 1;
        const solve = `t-${String(solves)}`;
        add("solve.started", { solve, condition: conditionId(ran), comparison });
        if (pass !== null) {
          const objective = isNumber(pass) ? pass : undefined;
          const kind = pass === false ? "fail" : "pass";
          add("verdict", {
            solve,
            task: taskId,
            kind,
            answer: { answer: SOLVER },
            ...keyIfDefined("objective", objective),
          });
        }
        add("solve.finished", {
          solve,
          ending: pass === null ? WALLED : pass === false ? REJECTED : PASS,
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
    // With no objective declared, no line tells a measure.
    expect(JSON.stringify(told)).not.toContain("measured");
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
    const places = [told.last ?? "", ...told.groups.map(({ heading }) => heading)].map(at);
    expect(places).not.toContain(-1);
    expect(places).toEqual(places.toSorted((a, b) => a - b));
    for (const line of told.groups.flatMap(({ lines }) => lines)) expect(at(line)).toBeGreaterThan(-1);
    for (const absent of ["h1", "h2", SOLVER, "too easy", "| family |", "gate 1 of", "said at its finish"]) {
      expect(opening).not.toContain(absent);
    }
    expect(opening).toContain("it names no base: bent (fixture)");
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

describe("the reference's measures on a task", () => {
  it("are told beside its turns, from the reference's side alone, so that a ceiling reads as a fact", () => {
    const log = logged();
    log.hold(["capped", "spread"]);
    log.solved("c-1", "capped", "h1", [1, 1], [6, 6]);
    log.solved("c-1", "capped", "h2", [0.25, 0.5]);
    log.solved("c-1", "spread", "h1", [0.875, false], [4, 9]);
    log.solved("c-1", "spread", "h2", [0.125, 0.375]);
    log.reported("c-1", ["h1", "h2"], ["capped", "spread"]);
    const told = heard(log.events, ["capped", "spread"].map(fixture));
    expect(block(told, "every solve").capped).toContain("in 6, 6 turns; measured 1, 1");
    expect(block(told, "some solves").spread).toContain("in 4 turns; measured 0.875");
    // The other harness's measures, and a target, are told nowhere.
    for (const unsaid of ["0.25", "0.5", "0.125", "0.375", "harder"]) {
      expect(JSON.stringify(told)).not.toContain(unsaid);
    }
  });
});

describe("a check ruled at fault on a task", () => {
  it("is named on the task's line, open or in practice, and an earned, unclear or overruled one names none", () => {
    const log = logged();
    log.hold(["open", "practice", "earned"]);
    log.add(TASK_STATE, { version: "v-practice", state: "released" });
    const ruled = (task: string, ruling: string, check: string | null) =>
      log.add("referee.finding", { solve: `s-${task}-${ruling}`, task, ruling, check, reason: SOLVER });
    ruled("open", "check-defect", "check-manifest");
    ruled("open", "check-defect", "check-manifest");
    ruled("practice", "check-defect", "check-unit");
    ruled("earned", "earned", null);
    ruled("earned", "unclear", null);
    // A solve's later ruling stands over its earlier one.
    const later = { solve: "s-later", task: "earned", reason: SOLVER };
    log.add("referee.finding", { ...later, ruling: "check-defect", check: "check-later" });
    log.add("referee.finding", { ...later, ruling: "earned", check: null });
    const told = heard(log.events, ["open", "practice", "earned"].map(fixture));
    const fault = "ruled at fault on an answer to it: ";
    expect(block(told, "Not yet compared").open).toEndWith(`; ${fault}check-manifest`);
    expect(block(told, "practice").practice).toBe(`practice (fixture); ${fault}check-unit`);
    expect(block(told, "Not yet compared").earned).not.toContain(fault);
    // The ruling's reason stays unread.
    expect(JSON.stringify(told)).not.toContain(SOLVER);
  });

  it("reads a person's label over the ruling, so a check labelled faithful is no longer named", () => {
    const log = logged();
    log.hold(["cleared", "blamed", "kept"]);
    const finding = (task: string, ruling: string, check: string) =>
      log.add("referee.finding", { solve: `s-${task}`, task, ruling, check });
    finding("cleared", "check-defect", "check-cleared");
    finding("blamed", "unclear", "check-blamed");
    finding("kept", "check-defect", "check-kept");
    const fault = "ruled at fault on an answer to it: ";
    const named = () => {
      const lines = block(heard(log.events, ["cleared", "blamed", "kept"].map(fixture)), "Not yet compared");
      return ["cleared", "blamed", "kept"].map((task) => lines[task]?.includes(fault) === true);
    };
    expect(named()).toEqual([true, false, true]);
    // A settled report rewrites its comparison's last, and the label stands over the ruling.
    log.reported("g-1", ["h1", "h2"], []);
    log.add("comparison.reported", {
      ...log.events.findLast(({ kind }) => kind === "comparison.reported")?.data,
      settled: { labels: { "s-cleared": "earned", "s-blamed": "check-defect" } },
    });
    expect(named()).toEqual([false, true, true]);
  });
});

describe("after a promotion", () => {
  it("says the reference was promoted and how many tasks were held before then, and at an opening alone the drafts the gate has refused since", () => {
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
    // At a wake the promotion is told where it came after the conversation last wrote.
    const at = log.events.findIndex(({ kind }) => kind === "harness.promoted");
    const woken = heard(log.events, ["old", "new"].map(fixture), at);
    expect(woken.promoted).toContain("g-9");
    expect(heard(log.events, ["old", "new"].map(fixture), at + 1).promoted).toBeNull();
    // A conversation still open heard each refusal from the gate.
    expect(woken.refused).toEqual([]);
  });
});

describe("a draft its author tried on the reference", () => {
  it("is told on no line: try_reference's reply tells each try once", () => {
    const log = logged();
    log.hold(["tried"]);
    const before = heard(log.events, [fixture("tried")]);
    log.add("exam.started", { session: "x-1" });
    log.add("solve.started", { solve: "x-1-p1", task: "tried", comparison: "x-1" });
    log.add("verdict", { solve: "x-1-p1", task: "tried", kind: "pass", answer: { answer: SOLVER } });
    log.add("solve.finished", { solve: "x-1-p1", ending: PASS, turns: 4, billed: 1 });
    expect(heard(log.events, [fixture("tried")])).toEqual(before);
  });
});

describe("a wake", () => {
  it("tells only the comparisons reported after the conversation last wrote, and the tasks they scored", () => {
    const log = logged();
    log.hold(["run", "mixed"]);
    for (const task of ["run", "mixed"]) {
      log.solved("b-1", task, "h1", [true, true]);
      log.solved("b-1", task, "h2", [false, false]);
    }
    log.reported("b-1", ["h1", "h2"], ["run", "mixed"]);
    const since = log.events.length;
    log.solved("b-2", "run", "h1", [true, false]);
    log.solved("b-2", "run", "h2", [false, false]);
    log.reported("b-2", ["h1", "h2"], ["run"]);
    log.add("referee.finding", { solve: "s-run", task: "run", ruling: "check-defect", check: "check-unit" });
    const tasks = ["run", "mixed"].map(fixture);
    const woken = heard(log.events, tasks, since);
    expect(woken.last).toContain("b-2");
    const lines = woken.groups.flatMap((group) => group.lines);
    expect(lines.map((line) => line.split(" ")[0])).toEqual(["run"]);
    // A task the wake names reads as its line at an opening would.
    expect(lines).toEqual(heard(log.events, [fixture("run")]).groups.flatMap((group) => group.lines));
    expect(lines[0]).toEndWith("; ruled at fault on an answer to it: check-unit");
    // Nothing reported since: no reading, no task.
    expect(heard(log.events, tasks, log.events.length)).toEqual({
      last: null,
      groups: [],
      promoted: null,
      refused: [],
    });
  });
});
