// The Examiner hears task outcomes, the reference measurement and task admissions from its log.
// Shared opening evidence stays readonly; other comparisons and task admission histories stay independent.
import { beforeAll, describe, expect, it } from "bun:test";
import { heard } from "../src/examiner/record.ts";
import { examine } from "../src/examiner/session.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, type LogEvent } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
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
const VALID = "an answer on record";
const NONE = "no answer on record";

/** A log built by hand: tasks held out by id, solves of them under a harness, task admissions and reports. */
function logged() {
  const events: LogEvent[] = [];
  const add = (kind: EventKind, data: JsonObject) =>
    events.push({ at: "2026-10-26T00:00:00.000Z", kind, data });
  let solves = 0;
  return {
    events,
    add,
    hold: (...ids: string[]) => {
      for (const taskId of ids) {
        add(PROPOSED, { version: `v-${taskId}`, taskId });
        add(TASK_ADMISSION, { version: `v-${taskId}`, gate: 1, outcome: "passed" });
      }
    },
    /** A draft proposed whole, and its task admission's word on it. */
    recordAdmission: (taskId: string, admission: JsonObject) => {
      add(PROPOSED, {
        version: `v-${taskId}`,
        taskId,
        task: { taskId, family: "fixture", publicInput: {}, hidden: null },
      });
      add(TASK_ADMISSION, { version: `v-${taskId}`, gate: 1, ...admission });
      if (admission.outcome === "refused") add(TASK_STATE, { version: `v-${taskId}`, state: "refused" });
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
    reported: (
      session: string,
      [old, fresh]: readonly [string, string],
      ids: readonly string[],
      aside: readonly string[] = [],
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
        aside: aside.map((id) => `v-${id}`),
      }),
  };
}
const fixture = (taskId: string) => ({ taskId, family: "fixture" });
/** Each task's clauses by its id, preserving their order and repeated outcomes. */
const byTask = (lines: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    lines.map((said) => [said.split(" (fixture): ")[0] ?? "", said.split(" (fixture): ")[1] ?? ""] as const),
  );

describe("the reference outcomes delivered at session opening", () => {
  const log = logged();
  const tasks = ["some", "none", "every", "unsolved", "practice", "aside", "new", "faulted", "refused"].map(
    fixture,
  );
  beforeAll(() => {
    log.hold(...tasks.map(({ taskId }) => taskId));
    log.solved("b-1", "some", "h1", [true, false], [7, 1]);
    log.solved("b-1", "some", "h2", [true, true]);
    log.solved("b-1", "none", "h1", [false, false]);
    log.solved("b-1", "none", "h2", [true, true]);
    log.solved("b-1", "every", "h1", [true, true], [3, 3]);
    log.solved("b-1", "every", "h2", [true, true]);
    log.solved("b-1", "unsolved", "h1", [false, false]);
    log.solved("b-1", "unsolved", "h2", [false, false]);
    log.reported("b-1", ["h1", "h2"], ["some", "none", "every", "unsolved"], ["aside"]);
    log.add(TASK_STATE, { version: "v-practice", state: "released" });
    log.add(TASK_STATE, { version: "v-faulted", state: "disputed" });
    log.add(TASK_STATE, { version: "v-refused", state: "refused" });
  });

  it("tells each task on one line: the reference's outcome and the turns its valid answers took, who won and on which measure, and whether an answer is on record", () => {
    // h1, the comparison's old side, is the reference: each line is its outcome, with the turns of
    // its valid answers there, and nothing of h2's solves but who won. A refused task has no line,
    // and the practice tasks are one.
    const { lines } = heard(log.events, tasks);
    const told = byTask(lines.slice(0, -1));
    expect(Object.keys(told)).toEqual(["some", "none", "every", "unsolved", "aside", "new", "faulted"]);
    for (const [id, facts] of [
      ["some", ["some solves", "7 turns", "other harness", "validity"]],
      ["none", ["no solve", VALID, "other harness", "validity"]],
      ["every", ["every solve", "3, 3 turns", "tied"]],
      ["unsolved", ["no solve", NONE, "tied"]],
      ["aside", ["disputed", "not settled", NONE]],
      ["new", ["not yet compared", NONE]],
      ["faulted", ["disputed", "at fault"]],
    ] as const) {
      for (const fact of facts) expect(told[id]).toContain(fact);
    }
    expect(lines.at(-1)).toContain("practice (fixture)");
  });

  it("opens a session with the lines and then the measurement, naming no harness, no answer and no verdict of the author's work", async () => {
    const s = seat("write", [finish, finish]);
    for (const event of log.events) append(s.log, event.kind, event.data);
    await examine({ ...s.request, tasks: tasks.map((task) => ({ ...task, publicInput: {}, hidden: null })) });
    const opening = s.sent[0] ?? "";
    // What `heard` reads of the log reaches the opening whole: each task's line, then the measurement.
    const told = heard(log.events, tasks);
    const at = (text: string) => opening.indexOf(JSON.stringify(text).slice(1, -1));
    const lines = told.lines.map(at);
    expect(lines).not.toContain(-1);
    expect(at(String(told.measured))).toBeGreaterThan(Math.max(...lines));
    for (const absent of ["h1", "h2", SOLVER, "too easy", "| family |"]) {
      expect(opening).not.toContain(absent);
    }
  });
});

describe("the reference measurement and task admissions", () => {
  it("measures the reference across the exam in the last comparison it stood in, never one between two other harnesses", () => {
    const log = logged();
    const tasks = ["a", "b", "c"].map(fixture);
    log.hold("a", "b", "c", "d");
    const first = log.events.length;
    log.solved("c-1", "a", "h1", [true, false]);
    log.solved("c-1", "a", "h2", [true, true]);
    log.solved("c-1", "b", "h1", [true, true]);
    log.solved("c-1", "b", "h2", [true, true]);
    log.solved("c-1", "c", "h1", [false, false]);
    log.solved("c-1", "c", "h2", [false, false]);
    log.reported("c-1", ["h1", "h2"], ["a", "b", "c"], ["d"]);
    const told = heard(log.events, tasks);
    // Tasks by every, some or none of their solves valid, with the task set aside counted beside them.
    expect(told.measured).toContain("every solve on 1 of 3 tasks");
    expect(told.measured).toContain("some on 1");
    expect(told.measured).toContain("none on 1");
    expect(told.measured).toContain("1 more was set aside");
    // A comparison between two other harnesses, before or after, is none of the reference's.
    const from = log.events.length;
    log.solved("c-0", "b", "h3", [false, false], [9, 9]);
    log.solved("c-0", "b", "h4", [true, true]);
    log.reported("c-0", ["h3", "h4"], ["b"]);
    const control = log.events.splice(from);
    expect(heard(log.events.toSpliced(first, 0, ...control), tasks)).toEqual(told);
    // Nothing told names a harness.
    expect(JSON.stringify(told)).not.toMatch(/\bh[1-4]\b/u);
  });

  it("puts a held draft's task admission on its line, groups the drafts it refused having read them, and keeps the task admissions that measured nothing apart", () => {
    const log = logged();
    log.add("exam.started", { session: "x-1" });
    log.solved("x-1", "twice", "h-any", [true, true], [12, 14]);
    log.recordAdmission("twice", { outcome: "passed", reference: { valid: 2, solves: 3, billed: 0 } });
    log.recordAdmission("short", { outcome: "passed", reference: { valid: 1, solves: 2, billed: 0 } });
    log.recordAdmission("early", {
      outcome: "passed",
      reference: { valid: 1, solves: 2, ran: 2, billed: 0, gap: 0.1 },
    });
    log.recordAdmission("every", {
      outcome: "refused",
      reason: "answered in 3 of 3",
      reference: { valid: 3, solves: 3, billed: 0 },
    });
    log.recordAdmission("also", {
      outcome: "refused",
      reason: "answered in 3 of 3",
      reference: { valid: 3, solves: 3, billed: 0, gap: -0.02 },
    });
    // Refused on two readings, or for want of the reserve, measured nothing: each may be proposed again.
    log.recordAdmission("cut", {
      outcome: "refused",
      reason: "gate-level reason",
      reference: { valid: 0, solves: 1, ran: 3, billed: 0 },
    });
    log.recordAdmission("reserve", {
      outcome: "refused",
      reason: "no reserve, so it is not measured",
      reference: null,
    });
    // A version's last task admission decides: one refused unmeasured and held on a later task admission is held.
    log.recordAdmission("again", {
      outcome: "refused",
      reason: "gate-level reason",
      reference: { valid: 1, solves: 1, billed: 0 },
    });
    log.add(TASK_ADMISSION, {
      version: "v-again",
      outcome: "passed",
      reference: { valid: 1, solves: 2, ran: 2 },
    });
    const told = heard(log.events, ["twice", "short", "early"].map(fixture));
    // A valid solve at the task admission shows an answer on record, which is then not said again.
    const lines = byTask(told.lines);
    for (const line of Object.values(lines)) {
      expect(line).toContain("not yet compared");
      expect(line).not.toContain(VALID);
    }
    expect(lines.twice).toContain("gate 2 of 3 valid, in 12, 14 turns");
    expect(lines.short).toContain("gate 1 of 3 valid, 1 giving no reading");
    expect(lines.early).toContain("gate 1 of 2 valid");
    expect(lines.early).toContain("yours 10% better");
    expect(told.refused).toHaveLength(1);
    for (const fact of ["3 of 3", "every (fixture)", "also (fixture", "2% worse"]) {
      expect(told.refused[0]).toContain(fact);
    }
    expect(told.interrupted).toHaveLength(2);
    for (const [index, facts] of [
      [0, ["cut (fixture)", "not measured", "0 of 1", "3 attempted", "gate-level reason"]],
      [1, ["reserve (fixture)", "not measured", "no reserve"]],
    ] as const) {
      for (const fact of facts) expect(told.interrupted[index]).toContain(fact);
    }
    // Held 4, all on validity, none on an answer of the author's or on the objective; 2 refused.
    expect(told.measured).toContain("held out 4 drafts");
    expect(told.measured).toContain("4 on validity");
    expect(told.measured).toContain("0 on an answer of yours");
    expect(told.measured).toContain("0 on the objective alone");
    expect(told.measured).toContain("refused 2 drafts");
  });
});

describe("task admissions after a promotion", () => {
  it("after a promotion, tells nothing that the replaced reference's task admissions read", () => {
    const log = logged();
    log.add("exam.started", { session: "x-1" });
    log.solved("x-1", "old", "h1", [true], [9]);
    log.recordAdmission("old", { outcome: "passed", reference: { valid: 1, solves: 3, billed: 0 } });
    log.recordAdmission("closed", {
      outcome: "refused",
      reason: "answered in 0 of 3",
      reference: { valid: 0, solves: 3, billed: 0 },
    });
    log.solved("x-1", "interrupted", "h1", [true, true], [937, 941]);
    log.recordAdmission("interrupted", {
      outcome: "refused",
      reason: "taking 937, 941 turns, measuring 947, yours 37% better, so it is not measured",
      reference: { valid: 2, solves: 2, ran: 3, billed: 0, gap: 0.37 },
    });
    log.add("harness.promoted", { harness: "h2", from: "h1", rests: [] });
    log.solved("x-1", "new", "h2", [true, true], [12, 14]);
    log.recordAdmission("new", { outcome: "passed", reference: { valid: 2, solves: 3, billed: 0 } });
    const told = heard(log.events, ["old", "new"].map(fixture));
    // "old" keeps its answer on record and loses its task admission's count and turns, which were h1's.
    const lines = byTask(told.lines);
    expect(lines.old).toContain("not yet compared");
    expect(lines.old).toContain(VALID);
    expect(lines.old).not.toContain("gate");
    expect(lines.new).toContain("not yet compared");
    expect(lines.new).toContain("gate 2 of 3 valid, in 12, 14 turns");
    expect(told.refused).toEqual([]);
    expect(told.interrupted).toHaveLength(1);
    for (const fact of ["interrupted (fixture)", "not measured", "replaced reference"]) {
      expect(told.interrupted[0]).toContain(fact);
    }
    expect(JSON.stringify(told)).not.toMatch(/937|941|947|37%|\b9 turns/u);
    // The promotion is told, with the listed tasks held out under the harness it replaced.
    expect(told.promoted).toContain("promoted");
    expect(told.promoted).toContain("1 of the 2 tasks");
    // With no promotion every task admission is the current reference's.
    const unpromoted = heard(
      log.events.filter(({ kind }) => kind !== "harness.promoted"),
      ["old", "new"].map(fixture),
    );
    expect(unpromoted.promoted).toBeNull();
    expect(byTask(unpromoted.lines).old).toContain("gate 1 of 3 valid");
    expect(byTask(unpromoted.lines).old).toContain("in 9 turns");
    expect(unpromoted.refused).toHaveLength(1);
    expect(unpromoted.refused[0]).toContain("0 of 3");
    expect(unpromoted.refused[0]).toContain("closed (fixture)");
  });
});

describe("the reference comparison history", () => {
  it("tells a task's last three comparisons with the reference, newest first, with its run of closures, from the reference's side alone", () => {
    const build = (other: readonly (boolean | null)[]) => {
      const log = logged();
      log.hold("run", "mixed", "once", "elsewhere");
      // Four consecutive closures, a mixed history and a single comparison.
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
      expect(heard(log.events, [fixture("run")]).legend).toContain('"Last comparisons"');
      // A task last compared between two other harnesses, with nothing more to say, is an id in
      // one line with the others like it.
      log.solved("b-5", "elsewhere", "h3", [true, true]);
      log.solved("b-5", "elsewhere", "h4", [false, false]);
      log.reported("b-5", ["h3", "h4"], ["elsewhere"]);
      return heard(log.events, ["run", "mixed", "once", "elsewhere"].map(fixture)).lines;
    };
    const lines = build([false, false]);
    const told = byTask(lines.slice(0, -1));
    expect(told.run).toContain("every solve, in 11, 11 turns");
    expect(told.run).toContain("last 3 comparisons: every, every, every");
    expect(told.run).toContain("last 4 in a row closed");
    expect(told.mixed).toContain("every solve, in 11, 11 turns");
    expect(told.mixed).toContain("last 3 comparisons: every, none (a solve cut at a limit), every");
    expect(told.mixed).toContain("last closed");
    expect(told.once).toContain("some solves, in 11 turns");
    expect(told.once).not.toContain("last");
    expect(lines.at(-1)).toContain("two other harnesses");
    expect(lines.at(-1)).toContain(VALID);
    expect(lines.at(-1)).toContain("elsewhere (fixture)");
    // The history is read from the reference's side alone, whatever the other harness did.
    expect(byTask(build([true, null]).slice(0, -1)).mixed).toContain(
      "last 3 comparisons: every, none (a solve cut at a limit), every",
    );
  });
});
