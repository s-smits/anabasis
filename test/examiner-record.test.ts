// What a writing session hears of its campaign's past (`heard`): the last comparison the reference
// stood in, from its side, then every task under the reference's outcome on it, with its turns,
// measures and checks ruled at fault, then the promotion; at a wake, only what came since.
import { beforeAll, describe, expect, it } from "bun:test";
import { taskHistory } from "../src/examiner/record.ts";
import { examine } from "../src/examiner/session.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { isNumber, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { condition, finish, propose, seat } from "./helpers/examiner-seat.ts";

const TASK_ADMISSION = "task.gate";
const PROPOSED = "task.proposed";
const TASK_STATE = "task.state";
const SOLVER = "solver-canary-7f3a";
const PASS: Ending = { outcome: "pass" };
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
const WALLED: Ending = { outcome: "fail", kind: "wall-ended" };
const VALID = "a valid answer on record";
const NONE = "no valid answer on record";
type Told = ReturnType<typeof taskHistory>;

function logged() {
  const events: LogEvent[] = [];
  const add = (kind: EventKind, data: JsonObject) =>
    events.push({ at: "2026-11-04T00:00:00.000Z", kind, data });
  let solves = 0;
  return {
    events,
    add,
    hold: (ids: readonly string[], family = "fixture") => {
      for (const taskId of ids) {
        const task = { taskId, family, publicInput: {}, hidden: null };
        add(PROPOSED, { version: `v-${taskId}`, taskId, task });
        add(TASK_ADMISSION, { version: `v-${taskId}`, gate: 1, outcome: "passed" });
      }
    },
    refuse: (taskId: string, reason: string) => {
      const task = { taskId, family: "fixture", publicInput: {}, hidden: null };
      add(PROPOSED, { version: `v-${taskId}`, taskId, task });
      add(TASK_ADMISSION, { version: `v-${taskId}`, gate: 1, outcome: "refused", reason });
      add(TASK_STATE, { version: `v-${taskId}`, state: "refused" });
    },
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
    reported: (
      session: string,
      [old, fresh]: readonly [string, string],
      ids: readonly string[],
      more: {
        aside?: readonly string[];
        differences?: readonly number[];
        noise?: JsonObject;
        objective?: JsonObject;
      } = {},
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
        ...keyIfDefined("objective", more.objective),
      }),
  };
}
const fixture = (taskId: string) => ({ taskId, family: "fixture" });
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
    const told = taskHistory(log.events, tasks);
    const order = [
      "Failed every",
      "Passed some",
      "Passed every",
      "Not yet compared",
      "Awaiting human review",
      "Quarantined",
      "practice",
    ];
    expect(told.groups.map(({ heading }) => order.findIndex((word) => heading.includes(word)))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    const none = block(told, "Failed every");
    expect(Object.keys(none)).toEqual(["none", "unsolved"]);
    for (const [line, facts] of [
      [none.none, [VALID, "won there by the harness it was compared with on validity"]],
      [none.unsolved, [NONE, "tied there"]],
      [block(told, "Passed some").some, ["in 7 turns", "won there by the harness it was compared with"]],
      [block(told, "Passed every").every, ["in 3, 3 turns", "tied there"]],
      [block(told, "Not yet compared").new, [NONE]],
      [block(told, "Awaiting human review").aside, [NONE]],
      [block(told, "Quarantined").faulted, []],
    ] as const) {
      expect(line).toBeDefined();
      for (const fact of facts) expect(line).toContain(fact);
    }
    for (const { lines } of told.groups) {
      for (const line of lines) expect(line).not.toMatch(/valid in (every|some|no) solve|not yet compared/u);
    }
    expect(block(told, "practice")).toEqual({ practice: "practice (fixture)" });
    expect(JSON.stringify(told)).not.toContain("refused (fixture)");
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
    const told = taskHistory(log.events, tasks);
    const at = (text: string) => opening.indexOf(JSON.stringify(text).slice(1, -1));
    const places = [told.stood ?? "", ...told.groups.map(({ heading }) => heading)].map(at);
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
    const told = taskHistory(log.events, tasks);
    for (const fact of [
      "c-1",
      "scored 3 tasks",
      "reference won 0, candidate won 1, 2 tied",
      "Reference passed every attempt on 1, some on 1, none on 1",
      "1 excluded pending review",
      "Reference A/A control differed on 2 of 3 tasks; 0 of 3 comparison margins were larger than any A/A margin",
    ]) {
      expect(told.stood).toContain(fact);
    }
    const first = log.events.length;
    log.solved("c-0", "b", "h3", [false, false], [9, 9]);
    log.solved("c-0", "b", "h4", [true, true]);
    log.reported("c-0", ["h3", "h4"], ["b"], { differences: [600] });
    const control = log.events.splice(first);
    const held = log.events.findLastIndex(({ kind }) => kind === TASK_ADMISSION) + 1;
    expect(taskHistory(log.events.toSpliced(held, 0, ...control), tasks).stood).toBe(told.stood);
    expect(taskHistory([...log.events, ...control], tasks).stood).toBe(told.stood);
    expect(JSON.stringify(told)).not.toMatch(/\bh[1-4]\b/u);
  });

  it("reads the tally from the fresh side where the reference was promoted on that comparison, and tells no A/A of the side it replaced", () => {
    const log = compared();
    log.reported("c-1", ["h1", "h2"], ["a", "b", "c"], {
      differences: [600, 300, -600],
      noise: { differences: [0, 600, -120] },
    });
    log.add("harness.promoted", { harness: "h2", from: "h1", rests: [{ comparison: "c-1" }] });
    const told = taskHistory(log.events, ["a", "b", "c"].map(fixture));
    expect(told.stood).toContain("reference won 2, candidate won 1, 0 tied");
    expect(told.stood).toContain("Reference passed every attempt on 2, some on 0, none on 1");
    expect(told.stood).not.toContain("differed");
  });

  it("counts the comparison margins larger than any A/A margin of the reference against itself", () => {
    const cases = [
      [[700, 50, -650], 2],
      [[600, -600, 0], 0],
      [[601, -601, 599], 2],
    ] as const;
    for (const [differences, beyond] of cases) {
      const log = compared();
      log.reported("c-1", ["h1", "h2"], ["a", "b", "c"], {
        differences,
        noise: { differences: [0, 600, -120] },
      });
      expect(taskHistory(log.events, ["a", "b", "c"].map(fixture)).stood).toContain(
        `; ${String(beyond)} of 3 comparison margins were larger than any A/A margin`,
      );
    }
  });

  it("asks for retirement only when at least ten tasks all passed every attempt and the objective decided none", () => {
    const cue = "retire easy tasks with retire_tasks";
    const cases = [
      [10, [true, true], [true, true], true],
      [9, [true, true], [true, true], false],
      [10, [true, false], [true, true], false],
      [10, [0.2, 0.2], [0.9, 0.9], false],
    ] as const;
    for (const [size, first, rest, asked] of cases) {
      const ids = Array.from({ length: size }, (_, nth) => `k${String(nth)}`);
      const log = logged();
      log.hold(ids);
      for (const [nth, id] of ids.entries()) {
        log.solved("c-1", id, "h1", nth === 0 ? first : [true, true]);
        log.solved("c-1", id, "h2", nth === 0 ? rest : [true, true]);
      }
      log.reported("c-1", ["h1", "h2"], ids, { objective: { direction: "higher", scale: "unit" } });
      expect([
        size,
        first,
        rest,
        (taskHistory(log.events, ids.map(fixture)).stood ?? "").includes(cue),
      ]).toEqual([size, first, rest, asked]);
    }
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
    const told = taskHistory(log.events, ["capped", "spread"].map(fixture));
    expect(block(told, "Passed every").capped).toContain("in 6, 6 turns; measured 1, 1");
    expect(block(told, "Passed some").spread).toContain("in 4 turns; measured 0.875");
    expect(block(told, "Passed every").capped).not.toContain("author");
    for (const unsaid of ["0.25", "0.5", "0.125", "0.375", "harder"]) {
      expect(JSON.stringify(told)).not.toContain(unsaid);
    }
  });
});

describe("a check ruled at fault on a task", () => {
  it("is named on the task's line, open or in practice, and an earned, unclear or overruled one names none", () => {
    const log = logged();
    log.hold(["open", "practice", "solver-fail"]);
    log.add(TASK_STATE, { version: "v-practice", state: "released" });
    const ruled = (task: string, ruling: string, check: string | null) =>
      log.add("referee.finding", { solve: `s-${task}-${ruling}`, task, ruling, check, reason: SOLVER });
    ruled("open", "check-defect", "check-manifest");
    ruled("open", "check-defect", "check-manifest");
    ruled("practice", "check-defect", "check-unit");
    ruled("solver-fail", "solver-fail", null);
    ruled("solver-fail", "unclear", null);
    const later = { solve: "s-later", task: "solver-fail", reason: SOLVER };
    log.add("referee.finding", { ...later, ruling: "check-defect", check: "check-later" });
    log.add("referee.finding", { ...later, ruling: "solver-fail", check: null });
    const told = taskHistory(log.events, ["open", "practice", "solver-fail"].map(fixture));
    const fault = "ruled at fault on an answer to it: ";
    expect(block(told, "Not yet compared").open).toEndWith(`; ${fault}check-manifest`);
    expect(block(told, "practice").practice).toBe(`practice (fixture); ${fault}check-unit`);
    expect(block(told, "Not yet compared")["solver-fail"]).not.toContain(fault);
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
      const lines = block(
        taskHistory(log.events, ["cleared", "blamed", "kept"].map(fixture)),
        "Not yet compared",
      );
      return ["cleared", "blamed", "kept"].map((task) => lines[task]?.includes(fault) === true);
    };
    expect(named()).toEqual([true, false, true]);
    log.reported("g-1", ["h1", "h2"], []);
    log.add("comparison.reported", {
      ...log.events.findLast(({ kind }) => kind === "comparison.reported")?.data,
      settled: { labels: { "s-cleared": "solver-fail", "s-blamed": "check-defect" } },
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
    const told = taskHistory(log.events, ["old", "new"].map(fixture));
    expect(told.promoted).toContain("g-9");
    expect(told.promoted).toContain("1 of the 2 tasks");
    expect(told.promoted).toContain("confirmation comparison against the starter has not run yet");
    const afterStarter = [
      ...log.events,
      {
        at: log.events[0]?.at ?? "2026-11-26T00:00:00.000Z",
        kind: "comparison.started" as const,
        data: { session: "g-10", old: "h2", fresh: "h1", starter: "h1" },
      },
      {
        at: log.events[0]?.at ?? "2026-11-26T00:00:00.000Z",
        kind: "comparison.reported" as const,
        data: {
          session: "g-10",
          old: "h2",
          fresh: "h1",
          starter: "h1",
          reading: "no-step",
          scored: { differences: [-1, -1, -1, -1, -1, -1] },
          level: 0.02,
        },
      },
    ];
    expect(taskHistory(afterStarter, ["old", "new"].map(fixture)).promoted).not.toContain(
      "confirmation comparison against the starter has not run yet",
    );
    expect(told.refused).toEqual([
      "it names no base: bent (fixture), twisted (fixture)",
      "its hidden values are missing: short (fixture)",
    ]);
    const unpromoted = taskHistory(
      log.events.filter(({ kind }) => kind !== "harness.promoted"),
      ["old", "new"].map(fixture),
    );
    expect(unpromoted.promoted).toBeNull();
    // A conversation that last heard before the promotion is told it at its wake, and one that
    // heard after it is not told it again.
    const at = log.events.findIndex(({ kind }) => kind === "harness.promoted");
    const woken = taskHistory(log.events, ["old", "new"].map(fixture), at - 1);
    expect(woken.promoted).toContain("g-9");
    expect(taskHistory(log.events, ["old", "new"].map(fixture), at).promoted).toBeNull();
    expect(woken.refused).toEqual([]);
  });
});

describe("a draft a pre-v0.14 session tried on the reference", () => {
  it("is told on no line: session-tagged solves in older logs never reach the wake message", () => {
    const log = logged();
    log.hold(["tried"]);
    const before = taskHistory(log.events, [fixture("tried")]);
    log.add("exam.started", { session: "x-1" });
    log.add("solve.started", { solve: "x-1-p1", task: "tried", comparison: "x-1" });
    log.add("verdict", { solve: "x-1-p1", task: "tried", kind: "pass", answer: { answer: SOLVER } });
    log.add("solve.finished", { solve: "x-1-p1", ending: PASS, turns: 4, billed: 1 });
    expect(taskHistory(log.events, [fixture("tried")])).toEqual(before);
  });
});

describe("a wake", () => {
  it("tells a comparison and a promotion that reported while the ask before it wrote, and tells them once", async () => {
    const s = seat("write", [propose(2), propose(3), propose(4)]);
    const log = logged();
    const onRecord = () => {
      for (const { kind, data } of log.events.splice(0)) append(s.log, kind, data);
    };
    log.hold(["run", "mixed"]);
    log.solved("b-1", "mixed", "h1", [true, true]);
    log.solved("b-1", "mixed", "h2", [false, false]);
    log.reported("b-1", ["h1", "h2"], ["mixed"]);
    onRecord();
    const tasks = ["run", "mixed"].map((id) => ({ ...fixture(id), publicInput: {}, hidden: null }));
    const later = (id: string) => ({ ...s.request, id, tasks, wanted: 1 });
    const asks = [later("x-2"), later("x-3")];
    await examine({
      ...s.request,
      tasks,
      wanted: 1,
      opened: () => {
        log.solved("b-2", "run", "h1", [false, false]);
        log.solved("b-2", "run", "h2", [true, true]);
        log.reported("b-2", ["h1", "h2"], ["run"]);
        log.add("harness.promoted", { harness: "h2", from: "h1", rests: [{ comparison: "b-2" }] });
        onRecord();
      },
      rest: async () => asks.shift() ?? null,
    });
    const wakes = s
      .of("exam.call")
      .flatMap(({ text }) => (isString(text) && text.includes("The host asks for more tasks") ? [text] : []));
    expect(wakes).toHaveLength(2);
    const [first, second] = wakes;
    expect(first).toContain("b-2");
    expect(first).toContain("run (fixture)");
    const promotion = taskHistory(read(s.log), [fixture("run")]).promoted ?? "no promotion line";
    expect(first).toContain(promotion);
    expect(second).not.toContain(promotion);
    // What the opening told stays out of the wake, and the next wake repeats nothing.
    expect(first).not.toContain("mixed (fixture)");
    expect(second).not.toContain("b-2");
    expect(second).not.toContain("run (fixture)");
  });

  it("tells a wake every comparison the reference stood in since, and an opening only the last", () => {
    const log = logged();
    log.hold(["run", "mixed"]);
    const since = log.events.length;
    log.reported("g-3", ["h1", "h2"], ["run"], { differences: [600] });
    log.reported("g-4", ["h2", "h3"], ["mixed"], { differences: [600] });
    log.reported("g-5", ["h1", "h3"], ["mixed"], { differences: [-300] });
    const tasks = ["run", "mixed"].map(fixture);
    const woken = taskHistory(log.events, tasks, since).stood ?? "";
    const told = woken.split("\n\n");
    expect(told.map((line) => line.split(",")[0])).toEqual(["Comparison g-3", "Comparison g-5"]);
    expect(told[0]).toContain("reference won 0, candidate won 1");
    expect(told[1]).toContain("reference won 1, candidate won 0");
    expect(woken).not.toContain("g-4");
    const opening = taskHistory(log.events, tasks).stood ?? "";
    expect(opening).toStartWith(
      "The last comparison the reference harness stood in, g-5, scored 0 tasks: reference ",
    );
    expect(opening).not.toContain("g-3");
  });

  it("tells only the comparisons reported after the conversation was last told, and the tasks they scored", () => {
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
    const woken = taskHistory(log.events, tasks, since);
    expect(woken.stood).toContain("b-2");
    expect(woken.stood).not.toContain("b-1");
    const lines = woken.groups.flatMap((group) => group.lines);
    expect(lines.map((line) => line.split(" ")[0])).toEqual(["run"]);
    expect(lines).toEqual(taskHistory(log.events, [fixture("run")]).groups.flatMap((group) => group.lines));
    expect(lines[0]).toEndWith("; ruled at fault on an answer to it: check-unit");
    const quiet = taskHistory(log.events, tasks, log.events.length);
    expect(quiet).toMatchObject({
      stood: null,
      revisionCue: null,
      reviews: null,
      groups: [],
      promoted: null,
      refused: [],
    });
  });
});

describe("a resumed comparison at a wake", () => {
  it("tells no task of a comparison first reported before the conversation was last told, as it tells no reading", () => {
    const log = logged();
    log.hold(["run"]);
    log.solved("b-1", "run", "h1", [true, true]);
    log.solved("b-1", "run", "h2", [false, false]);
    log.reported("b-1", ["h1", "h2"], ["run"]);
    const since = log.events.length;
    log.reported("b-1", ["h1", "h2"], ["run"]);
    expect(taskHistory(log.events, [fixture("run")], since)).toMatchObject({
      stood: null,
      revisionCue: null,
      reviews: null,
      groups: [],
      promoted: null,
      refused: [],
    });
  });
});

describe("the largest family of a comparison the reference stood in", () => {
  it("is counted over the tasks that comparison scored, whatever else the exam holds", () => {
    const log = logged();
    log.hold(["a", "b", "c", "unscored"], "wide");
    log.hold(["d"], "narrow");
    for (const task of ["a", "b", "c", "d"]) {
      log.solved("c-1", task, "h1", [true, true]);
      log.solved("c-1", task, "h2", [true, true]);
    }
    log.reported("c-1", ["h1", "h2"], ["a", "b", "c", "d"]);
    const told = taskHistory(log.events, []).stood;
    expect(told).toContain("scored 4 tasks");
    expect(told).toContain("Largest family: 3 tasks.");
    // The exam holds four of that family and then five: a count over the exam would say so.
    log.hold(["later"], "wide");
    expect(taskHistory(log.events, []).stood).toBe(told);
  });
});

describe("the author's answer to a task", () => {
  it("is told by its best measure beside the reference's, so that a closed gap reads as a fact", () => {
    const log = logged();
    log.hold(["closed", "open"]);
    for (const [version, measure] of [
      ["v-closed", 0.9],
      ["v-closed", 0.95],
      ["v-open", 0.5],
    ] as const) {
      log.add("task.feasible", { version, session: "x-1", objective: { measure, direction: "higher" } });
    }
    log.solved("c-1", "closed", "h1", [0.94, 0.94]);
    log.solved("c-1", "closed", "h2", [0.25, 0.25]);
    log.solved("c-1", "open", "h1", [false, false]);
    log.solved("c-1", "open", "h2", [false, false]);
    log.reported("c-1", ["h1", "h2"], ["closed", "open"]);
    const told = taskHistory(log.events, ["closed", "open"].map(fixture));
    expect(block(told, "Passed every").closed).toContain(
      "measured 0.94, 0.94; the author's answer measured 0.95",
    );
    // A task the reference answered in no solve has no measure of its own to set the author's beside.
    expect(JSON.stringify(told)).not.toContain("measured 0.5");
  });
});

describe("a task the reference passed every attempt on", () => {
  it("reports its turns against the solve's budget under Passed every attempt", () => {
    const log = logged();
    log.add("campaign.setting", { modelTurns: 20, minutes: 30, solves: 2 });
    log.hold(["shut", "open"]);
    for (const comparison of ["c-1", "c-2"]) {
      log.solved(comparison, "shut", "h1", [true, true], [6, 7]);
      log.solved(comparison, "shut", "h2", [true, true]);
      log.solved(comparison, "open", "h1", [true, false]);
      log.solved(comparison, "open", "h2", [true, true]);
      log.reported(comparison, ["h1", "h2"], ["shut", "open"]);
    }
    const told = taskHistory(log.events, ["shut", "open"].map(fixture));
    expect(block(told, "Passed every").shut).toContain("in 6, 7 of 20 turns");
    expect(block(told, "Passed every").open).toBeUndefined();
    expect(block(told, "Passed some").open).toBeDefined();
  });

  it("reports mean per-item rubric scores with best author baselines and surfaces all faulty rubric modes", () => {
    const log = logged();
    log.hold(["graded", "missed", "broken"]);
    log.add("task.feasible", {
      version: "v-graded",
      session: "x-1",
      objective: { measure: 0.6, direction: "higher", scores: { accuracy: 0.6, calibration: 0.6 } },
    });
    log.add("task.feasible", {
      version: "v-graded",
      session: "x-1",
      objective: { measure: 0.95, direction: "higher", scores: { accuracy: 1, calibration: 0.8 } },
    });
    const ran = condition("v-graded", "h1");
    log.add("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    for (const [idx, scores] of [
      { accuracy: 1, calibration: 0.2 },
      { accuracy: 0.8, calibration: 0.6 },
    ].entries()) {
      const solve = `rs-${String(idx + 1)}`;
      log.add("solve.started", { solve, condition: conditionId(ran), comparison: "c-r" });
      log.add("verdict", {
        solve,
        task: "graded",
        kind: "pass",
        answer: { answer: SOLVER },
        objective: 0.7,
        scores,
      });
      log.add("solve.finished", { solve, ending: PASS, turns: 5 });
    }
    log.solved("c-r", "graded", "h2", [0.5, 0.5]);
    log.solved("c-r", "missed", "h1", [false, false]);
    log.solved("c-r", "missed", "h2", [false, false]);
    for (const [suffix, reason] of [
      ["ret", "score calibration returned 1.5 (expected finite number in [0, 1])"],
      ["miss", "score accuracy is missing from the check program"],
    ] as const) {
      log.add("verdict", {
        solve: `rs-fault-${suffix}`,
        task: "broken",
        kind: "faulty",
        check: "objective",
        reason,
      });
    }
    log.add(TASK_STATE, { version: "v-broken", state: "disputed" });
    log.reported("c-r", ["h1", "h2"], ["graded", "missed"]);
    const told = taskHistory(log.events, ["graded", "missed", "broken"].map(fixture));
    expect(block(told, "Passed every").graded).toContain(
      "rubric accuracy=0.9 (author 1), calibration=0.4 (author 0.8)",
    );
    expect(block(told, "Failed every").missed).not.toContain("rubric");
    expect(block(told, "Quarantined").broken).toContain(
      "ruled at fault on an answer to it: objective (calibration), objective (accuracy)",
    );
    expect(told.stood).toContain("Reference item means: accuracy=0.9, calibration=0.4.");
  });

  it("surfaces revisionCue on check-defect clusters and excludes checker-only faulty verdicts", () => {
    const log = logged();
    log.hold(["a", "b", "c"]);
    log.add("referee.finding", { solve: "s-a", task: "a", ruling: "check-defect", check: "check-a" });
    log.add("verdict", { solve: "s-c", task: "c", kind: "faulty", check: "objective", reason: "score bad" });
    expect(taskHistory(log.events, ["a", "b", "c"].map(fixture)).revisionCue).toBeNull();
    log.add("referee.finding", { solve: "s-b", task: "b", ruling: "check-defect", check: "check-b" });
    const told = taskHistory(log.events, ["a", "b", "c"].map(fixture));
    expect(told.revisionCue).toContain("2 tasks hold Referee-ruled check defects (check-a, check-b)");
    expect(told.revisionCue).toContain('revise_exam (kind "repair")');
  });

  it("shows one baseStarter solve as starterTrace, a valid one where any passed, and no Builder harness solve", () => {
    const log = logged();
    log.hold(["t1", "t2"]);
    log.add("comparison.started", { session: "g-1", starter: "h1", old: "h1", fresh: "h-built" });
    log.solved("g-1", "t1", "h1", [true, false], [3, 5]);
    log.add("solve.call", { solve: "t-1", tool: "bash", args: { command: "python3 solve.py" } });
    log.add("solve.call", { solve: "t-2", tool: "bash", args: { command: "cat  notes.txt" } });
    log.solved("g-1", "t1", "h-built", [true], [1]);
    log.add("solve.call", { solve: "t-3", tool: "bash", args: { command: "SECRET_BUILDER_CMD" } });
    log.solved("g-1", "t2", "h1", [false, false], [4, 6]);
    const [first, second] = taskHistory(log.events, [fixture("t1"), fixture("t2")]).metrics.tasks;
    expect([first?.starterTrace, second?.starterTrace]).toEqual([
      { valid: true, turns: 3, tools: { bash: 1 }, firstCommands: ["python3 solve.py"] },
      { valid: false, turns: 6, tools: {}, firstCommands: [] },
    ]);
    expect(JSON.stringify([first, second])).not.toContain("SECRET_BUILDER_CMD");
  });
});
