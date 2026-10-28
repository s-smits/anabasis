/**
 * What an Examiner is told of its campaign's past at a session's opening (`heard`,
 * `src/examiner/record.ts`): a line a task, one measurement of the reference harness across the
 * exam, and the drafts its gates refused. Each case builds a log by hand and reads the told text.
 */
import { describe, expect, it } from "bun:test";
import { heard } from "../src/examiner/record.ts";
import { examine } from "../src/examiner/session.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, type LogEvent } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { condition, finish, seat } from "./helpers/examiner-seat.ts";

const GATE = "task.gate";
const PROPOSED = "task.proposed";
const TASK_STATE = "task.state";
/** A solver-side secret no Examiner may be shown: the text of a measured solve's answer. */
const SOLVER = "solver-canary-7f3a";
const PASS: Ending = { outcome: "pass" };
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
const WALLED: Ending = { outcome: "fail", kind: "wall-ended" };
const VALID = "an answer on record";
const NONE = "no answer on record";

/** A log built by hand: tasks held out by id, solves of them under a harness, gates and reports. */
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
        add(GATE, { version: `v-${taskId}`, gate: 1, outcome: "passed" });
      }
    },
    /** A draft proposed whole, and its gate's word on it. */
    gated: (taskId: string, gate: JsonObject) => {
      add(PROPOSED, {
        version: `v-${taskId}`,
        taskId,
        task: { taskId, family: "fixture", publicInput: {}, hidden: null },
      });
      add(GATE, { version: `v-${taskId}`, gate: 1, ...gate });
      if (gate.outcome === "refused") add(TASK_STATE, { version: `v-${taskId}`, state: "refused" });
    },
    /** A solve each of `valid` under `harness` in `comparison`, null for one its wall cut; each
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
const byTask = (lines: readonly string[]) =>
  Object.fromEntries(
    lines.map((said) => [said.split(" (fixture): ")[0], said.split(" (fixture): ")[1] ?? ""]),
  );

describe("what an Examiner is told of its campaign's past", () => {
  it("takes a task's outcome and valid-answer turns from the same comparison, including a historical ladder report", () => {
    const log = logged();
    log.hold("kept");
    log.solved("b-1", "kept", "h1", [true, true], [3, 3]);
    log.solved("b-1", "kept", "h2", [true, true]);
    log.reported("b-1", ["h1", "h2"], ["kept"]);
    log.solved("b-2", "kept", "h1", [true, false], [7, 1]);
    log.solved("b-2", "kept", "h2", [true, true]);
    log.reported("b-2", ["h1", "h2"], ["kept"]);
    const ordinary = heard(log.events, [fixture("kept")]).lines;
    const latest = log.events.at(-1);
    if (latest === undefined) throw new Error("missing comparison report");
    latest.data.ladder = true;
    const lines = heard(log.events, [fixture("kept")]).lines;
    const [line] = lines;
    expect(line).toContain("valid in some solves");
    expect(line).toContain("in 7 turns");
    expect(line).not.toContain("in 3, 3 turns");
    expect(lines).toEqual(ordinary);
  });

  it("distinguishes histories with the same outcomes in a different order", () => {
    const build = (history: readonly (readonly boolean[])[]) => {
      const log = logged();
      log.hold("kept");
      for (const [nth, valid] of history.entries()) {
        const comparison = `b-${String(nth)}`;
        log.solved(comparison, "kept", "h1", valid);
        log.solved(comparison, "kept", "h2", [true, true]);
        log.reported(comparison, ["h1", "h2"], ["kept"]);
      }
      return byTask(heard(log.events, [fixture("kept")], false).lines);
    };
    const first = build([
      [true, false],
      [false, false],
      [true, true],
    ]);
    const second = build([
      [false, false],
      [true, false],
      [true, true],
    ]);
    expect(first).not.toEqual(second);
    expect(first.kept).toContain("last 3 comparisons: every, none, some");
    expect(second.kept).toContain("last 3 comparisons: every, some, none");
  });

  it("tells each task on one line: the reference's outcome and the turns its valid answers took, who won and on which measure, and whether an answer is on record", () => {
    const log = logged();
    const tasks = ["some", "none", "every", "unsolved", "practice", "aside", "new", "faulted", "refused"].map(
      fixture,
    );
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
    // h1, the comparison's old side, is the reference: each line is its outcome, with the turns of
    // its valid answers there, and nothing of h2's solves but who won. A refused task has no line,
    // and the practice tasks are one.
    const { lines } = heard(log.events, tasks);
    const told = byTask(lines.slice(0, -1));
    expect(Object.keys(told)).toEqual(["some", "none", "every", "unsolved", "aside", "new", "faulted"]);
    expect(told.some).toContain("some solves, in 7 turns");
    expect(told.some).toContain("other harness on validity");
    expect(told.none).toContain("no solve");
    expect(told.none).toContain(VALID);
    expect(told.none).toContain("other harness on validity");
    expect(told.every).toContain("every solve, in 3, 3 turns");
    expect(told.every).toContain("tied");
    expect(told.unsolved).toContain("no solve");
    expect(told.unsolved).toContain(NONE);
    expect(told.unsolved).toContain("tied");
    expect(told.aside).toContain("disputed");
    expect(told.aside).toContain("not settled");
    expect(told.aside).toContain(NONE);
    expect(told.new).toContain("not yet compared");
    expect(told.new).toContain(NONE);
    expect(told.faulted).toContain("disputed");
    expect(told.faulted).toContain("at fault");
    expect(lines.at(-1)).toContain("practice (fixture)");
  });

  it("explains in its legend only the clauses some line carries", () => {
    const log = logged();
    log.hold("plain");
    log.solved("b-1", "plain", "h1", [true, true]);
    log.solved("b-1", "plain", "h2", [true, true]);
    log.reported("b-1", ["h1", "h2"], ["plain"]);
    const bare = heard(log.events, [fixture("plain")]).legend;
    expect(bare).not.toContain('"Gate"');
    expect(bare).not.toContain('"Last comparisons"');
    expect(bare).not.toContain("bill alone");
    log.add("exam.started", { session: "x-1" });
    log.gated("drawn", { outcome: "passed", reference: { valid: 1, solves: 2, billed: 0 } });
    expect(heard(log.events, ["plain", "drawn"].map(fixture)).legend).toContain('"Gate"');
  });

  it("says a win the objective decided, and room only where an answer on record beats one of the reference's own by the floor", () => {
    const lines = (measures: number[], results = true) => {
      const log = logged();
      log.hold("close");
      log.solved("b-1", "close", "h1", [true, true]);
      log.solved("b-1", "close", "h2", [true, true]);
      log.reported("b-1", ["h1", "h2"], ["close"]);
      for (const { kind, data } of log.events) {
        if (kind === "verdict") data.objective = measures.shift() ?? null;
        if (kind === "comparison.reported") data.objective = { direction: "lower" };
      }
      return heard(log.events, [fixture("close")], results).lines;
    };
    const [won] = lines([100, 100, 90, 90]);
    expect(won).toContain("won there by the other harness on the objective");
    // The other harness's better answers are its result on the task, and no room for the reference.
    expect(won).not.toContain("better than one of its own");
    expect(lines([100, 95, 90, 90])[0]).toContain(`${VALID} 5% better than one of its own`);
    // Under the floor (1%) the gap decides no pair, and is told as none.
    expect(lines([100, 99.5, 90, 90])[0]).not.toContain("better than one of its own");
  });

  it("with exam-results off and feasibility unchanged, reads the same whatever the other harness did, and names no winner", () => {
    // Two logs alike on the reference's side, h1, and apart on h2's: in the first h2 fails where
    // in the second it answers, and so wins.
    const build = (other: boolean) => {
      const log = logged();
      log.hold("run", "once", "one");
      for (const comparison of ["b-1", "b-2"]) {
        log.solved(comparison, "run", "h1", [true, true], [4, 5]);
        log.solved(comparison, "run", "h2", [other, null]);
        log.reported(comparison, ["h1", "h2"], ["run"]);
      }
      log.solved("b-3", "once", "h1", [true, false]);
      log.solved("b-3", "once", "h2", [other, other]);
      log.solved("b-3", "one", "h1", [false, false]);
      log.solved("b-3", "one", "h2", [other, true]);
      log.reported("b-3", ["h1", "h2"], ["once", "one"]);
      return log.events;
    };
    const tasks = ["run", "once", "one"].map(fixture);
    const [lost, won] = [build(false), build(true)].map((events) => heard(events, tasks, false));
    expect(won).toEqual(lost);
    expect(JSON.stringify(won)).not.toContain("won there");
    expect(won?.legend).not.toContain("who won");
    // With the term on, the same logs tell apart.
    expect(heard(build(true), tasks).lines).not.toEqual(heard(build(false), tasks).lines);
  });

  it("with exam-results off, permits the feasibility exception, also recorded by task.feasible, when the other harness supplies the first valid answer", () => {
    const build = (other: boolean) => {
      const log = logged();
      log.hold("unanswered");
      log.solved("b-1", "unanswered", "h1", [false, false]);
      log.solved("b-1", "unanswered", "h2", [other, false], [37, 41]);
      log.reported("b-1", ["h1", "h2"], ["unanswered"]);
      return log;
    };
    const tasks = [fixture("unanswered")];
    const log = build(false);
    const unknown = heard(log.events, tasks, false);
    const feasible = heard(build(true).events, tasks, false);
    expect(unknown.lines[0]).toContain(NONE);
    expect(feasible).toEqual({
      ...unknown,
      lines: unknown.lines.map((line) => line.replace(NONE, VALID)),
    });
    // An author's passing answer reveals the same permitted fact, without any other-side success.
    log.add("task.feasible", { version: "v-unanswered", session: "x-1", answer: { answer: SOLVER } });
    expect(heard(log.events, tasks, false)).toEqual(feasible);
    expect(JSON.stringify(feasible)).not.toMatch(/won there|37|41|solver-canary/u);
  });

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

  it("puts a held draft's gate on its line, groups the drafts it refused having read them, and keeps the gates that measured nothing apart", () => {
    const log = logged();
    log.add("exam.started", { session: "x-1" });
    log.solved("x-1", "twice", "h-any", [true, true], [12, 14]);
    log.gated("twice", { outcome: "passed", reference: { valid: 2, solves: 3, billed: 0 } });
    log.gated("short", { outcome: "passed", reference: { valid: 1, solves: 2, billed: 0 } });
    log.gated("early", {
      outcome: "passed",
      reference: { valid: 1, solves: 2, ran: 2, billed: 0, gap: 0.1 },
    });
    log.gated("every", {
      outcome: "refused",
      reason: "answered in 3 of 3",
      reference: { valid: 3, solves: 3, billed: 0 },
    });
    log.gated("also", {
      outcome: "refused",
      reason: "answered in 3 of 3",
      reference: { valid: 3, solves: 3, billed: 0, gap: -0.02 },
    });
    // Refused on two readings, or for want of the reserve, measured nothing: each may be proposed again.
    log.gated("cut", {
      outcome: "refused",
      reason: "gate-level reason",
      reference: { valid: 0, solves: 1, ran: 3, billed: 0 },
    });
    log.gated("reserve", {
      outcome: "refused",
      reason: "no reserve, so it is not measured",
      reference: null,
    });
    // A version's last gate decides: one refused unmeasured and held on a later gate is held.
    log.gated("again", {
      outcome: "refused",
      reason: "gate-level reason",
      reference: { valid: 1, solves: 1, billed: 0 },
    });
    log.add(GATE, { version: "v-again", outcome: "passed", reference: { valid: 1, solves: 2, ran: 2 } });
    const told = heard(log.events, ["twice", "short", "early"].map(fixture));
    // A valid solve at the gate shows an answer on record, which is then not said again.
    const lines = byTask(told.lines);
    for (const line of Object.values(lines)) {
      expect(line).toContain("not yet compared");
      expect(line).not.toContain(VALID);
    }
    expect(lines.twice).toContain("gate 2 of 3 valid, in 12, 14 turns");
    expect(lines.short).toContain("gate 1 of 3 valid, 1 giving no reading");
    expect(lines.early).toContain("gate 1 of 2 valid");
    expect(lines.early).toContain("yours 10% better");
    expect(told.refused).toEqual([
      "the reference harness valid in 3 of 3 solves: every (fixture), also (fixture, yours 2% worse than its best)",
    ]);
    expect(told.interrupted).toEqual([
      "cut (fixture): gate not measured; 0 of 1 measured solves valid; 3 attempted; gate-level reason",
      "reserve (fixture): gate not measured; no reserve, so it is not measured",
    ]);
    // Held 4, all on validity, none on an answer of the author's or on the objective; 2 refused.
    expect(told.measured).toContain("held out 4 drafts");
    expect(told.measured).toContain("4 on validity");
    expect(told.measured).toContain("0 on an answer of yours");
    expect(told.measured).toContain("0 on the objective alone");
    expect(told.measured).toContain("refused 2 drafts");
  });

  it("after a promotion, tells nothing that the replaced reference's gates read", () => {
    const log = logged();
    log.add("exam.started", { session: "x-1" });
    log.solved("x-1", "old", "h1", [true], [9]);
    log.gated("old", { outcome: "passed", reference: { valid: 1, solves: 3, billed: 0 } });
    log.gated("closed", {
      outcome: "refused",
      reason: "answered in 0 of 3",
      reference: { valid: 0, solves: 3, billed: 0 },
    });
    log.solved("x-1", "interrupted", "h1", [true, true], [937, 941]);
    log.gated("interrupted", {
      outcome: "refused",
      reason: "taking 937, 941 turns, measuring 947, yours 37% better, so it is not measured",
      reference: { valid: 2, solves: 2, ran: 3, billed: 0, gap: 0.37 },
    });
    log.add("harness.promoted", { harness: "h2", from: "h1", rests: [] });
    log.solved("x-1", "new", "h2", [true, true], [12, 14]);
    log.gated("new", { outcome: "passed", reference: { valid: 2, solves: 3, billed: 0 } });
    const told = heard(log.events, ["old", "new"].map(fixture));
    // "old" keeps its answer on record and loses its gate's count and turns, which were h1's.
    const lines = byTask(told.lines);
    expect(lines.old).toContain("not yet compared");
    expect(lines.old).toContain(VALID);
    expect(lines.old).not.toContain("gate");
    expect(lines.new).toContain("not yet compared");
    expect(lines.new).toContain("gate 2 of 3 valid, in 12, 14 turns");
    expect(told.refused).toEqual([]);
    expect(told.interrupted).toEqual(["interrupted (fixture): gate not measured; used a replaced reference"]);
    expect(JSON.stringify(told)).not.toMatch(/937|941|947|37%|\b9 turns/u);
    // The promotion is told, with the listed tasks held out under the harness it replaced.
    expect(told.promoted).toContain(
      "The reference harness was promoted. 1 of the 2 tasks listed were held out before then",
    );
    // With no promotion every gate is the current reference's.
    const unpromoted = heard(
      log.events.filter(({ kind }) => kind !== "harness.promoted"),
      ["old", "new"].map(fixture),
    );
    expect(unpromoted.promoted).toBeNull();
    expect(byTask(unpromoted.lines).old).toContain("gate 1 of 3 valid");
    expect(byTask(unpromoted.lines).old).toContain("in 9 turns");
    expect(unpromoted.refused).toEqual(["the reference harness valid in 0 of 3 solves: closed (fixture)"]);
  });

  it("tells a task's last three comparisons with the reference, newest first, with its run of closures, from the reference's side alone", () => {
    const build = (other: readonly (boolean | null)[]) => {
      const log = logged();
      log.hold("run", "mixed", "once", "elsewhere");
      // `run`: closed by the reference in four comparisons running; `mixed`: every, none with one
      // solve cut at its wall, every; `once`: one comparison, which is its outcome and no history.
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
      return heard(log.events, ["run", "mixed", "once", "elsewhere"].map(fixture), false).lines;
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
    expect(build([true, null])).toEqual(lines);
  });

  it("says nothing it cannot count: a task the log does not hold, and no task at all", () => {
    const empty = heard([], []);
    expect(empty).toEqual({
      legend: empty.legend,
      lines: [],
      promoted: null,
      measured: null,
      refused: [],
      interrupted: [],
    });
    // A task the log does not hold yet, as a pack's is before `prepare.ts`, is not yet compared.
    const line = byTask(heard([], [fixture("e-1")]).lines)["e-1"];
    expect(line).toContain("not yet compared");
    expect(line).toContain(NONE);
  });

  it("opens a session with the lines and then the measurement, naming no harness, no answer and no verdict of the author's work", async () => {
    const log = logged();
    const tasks = ["some", "every"].map(fixture);
    log.hold("some", "every");
    log.solved("b-1", "some", "h1", [true, false]);
    log.solved("b-1", "some", "h2", [true, true]);
    log.solved("b-1", "every", "h1", [true, true]);
    log.solved("b-1", "every", "h2", [true, true]);
    log.reported("b-1", ["h1", "h2"], ["some", "every"]);
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
