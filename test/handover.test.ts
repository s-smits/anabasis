// A campaign has one reading: each step's handover, folded once from its log. The operator's view
// prints it whole, and the Builder's opening message is the same rows through the Builder's filter.
import { afterAll, describe, expect, it } from "bun:test";
import { supplyOf } from "../src/builder/admission.ts";
import { campaignOf, type Handover, openSteps } from "../src/builder/handover.ts";
import { comparisonsTold, failsTold, startTold } from "../src/builder/past.ts";
import { type Condition, recordCondition } from "../src/kernel/condition.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { mkdtempSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { viewLines } from "../tools/runs/view.ts";

const LIMITS = {
  wallSeconds: 480,
  turns: 24,
  shellDefaultSeconds: 120,
  shellMaxSeconds: 240,
  concurrency: 4,
  diskBytes: 1,
};
const [STARTER, HA, HB] = ["0".repeat(64), "a".repeat(64), "b".repeat(64)];
const HELD = ["s1", "s2", "s3", "s4"];
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-handover-")));
let logs = 0;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A log to which a campaign's steps are added as its commands log them. */
function campaign() {
  const log = join(scratch, `log-${String(logs++)}.jsonl`);
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  let solves = 0;
  /** One finished test-side solve, billed a dollar and a half. */
  const solved = (task: string, harness: string, outcome: "pass" | "fail", comparison?: string) => {
    const condition: Condition = {
      contract: "c1",
      harness,
      task,
      model: "faux/solver",
      effort: "medium",
      prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      runtime: {},
      compaction: "off",
      solverTools: "s1",
      verifierTools: "t1",
      sandbox: "p1",
      limits: LIMITS,
      host: "h1",
      side: "test",
    };
    solves += 1;
    const solve = `s-${String(solves)}`;
    record("solve.started", {
      solve,
      condition: recordCondition(log, condition),
      ...keyIfDefined("comparison", comparison),
    });
    record("solve.finished", {
      solve,
      ending: outcome === "pass" ? { outcome } : { outcome, kind: "rejected" },
      turns: 14,
      seconds: 222.4,
      billed: 1.5,
    });
    return solve;
  };
  /** The set-up: one practice task, four held out, a checker read with no fault. */
  const setUp = () => {
    for (const version of ["p1", ...HELD]) {
      record("task.proposed", { version });
      record("task.gate", { version, gate: 1, outcome: "passed" });
    }
    record("task.state", { version: "p1", state: "released" });
    record("checker.read", { contract: "c", checks: "k", faults: [] });
  };
  /** A Builder session that practised as `practice` says and left `harness`. */
  const built = (id: string, parent: string, harness: string, practice: readonly ("pass" | "fail")[]) => {
    record("build.started", { session: id, parent, tasks: ["p1"] });
    const made = practice.map((outcome) => solved("p1", harness, outcome));
    record("build.finished", {
      session: id,
      ended: "finished",
      harness,
      changed: true,
      practiceSolves: practice.length,
      billed: 4,
    });
    return made;
  };
  /** A comparison's start and its report: `fresh` against `old`, tallied as `scored` says. */
  const compared = (id: string, sides: { old: string; fresh: string }, report: JsonObject | null) => {
    record("comparison.started", {
      session: id,
      ...sides,
      starter: STARTER,
      setting: "s",
      solves: 2,
      level: 0.1,
      cap: { dollars: 100, reserve: 10 },
      tasks: HELD,
    });
    if (report === null) return;
    solved("s1", sides.fresh, "pass", id);
    const refused = solved("s1", sides.old, "fail", id);
    record("referee.finding", { solve: refused, ruling: "earned", billed: 0.5 });
    record("comparison.reported", { session: id, ...sides, starter: STARTER, versions: HELD, ...report });
  };
  return { log, record, solved, setUp, built, compared, events: () => read(log) };
}

/** A report that tallied its four tasks. */
const tallied = (reading: string, wins: number, ties: number): JsonObject => ({
  reading,
  scored: { wins, losses: 0, ties, p: 0.0625, unsolved: 0 },
  valid: { old: [4 - ties, 0, ties], fresh: [0, 0, 4] },
  aside: [],
});
const steps = (c: ReturnType<typeof campaign>, step: Handover["step"]) =>
  campaignOf(c.events()).steps.filter((each) => each.step === step);

describe("a campaign's reading", () => {
  it("holds each step's handover once, in the order the steps started", () => {
    const c = campaign();
    c.setUp();
    c.record("exam.started", { session: "x-1" });
    c.record("exam.finished", {
      session: "x-1",
      ended: "finished",
      proposed: 3,
      held: ["e1", "e2"],
      refused: ["e3"],
      billed: 2.25,
    });
    c.built("b-1", STARTER, HA, ["fail", "pass"]);
    c.compared("b-1", { old: STARTER, fresh: HA }, tallied("step", 4, 0));
    c.compared("g-1", { old: STARTER, fresh: HA }, null);
    const read1 = campaignOf(c.events());
    expect(read1.steps).toEqual([
      {
        step: "examiner",
        id: "x-1",
        ended: "finished",
        cut: false,
        turns: 0,
        last: expect.any(String),
        proposed: 3,
        held: 2,
        refused: 1,
        billed: 2.25,
      },
      {
        step: "builder",
        id: "b-1",
        ended: "finished",
        cut: false,
        turns: 0,
        last: expect.any(String),
        parent: STARTER,
        harness: HA,
        changed: true,
        practiceSolves: 2,
        fails: 1,
        // Its own turns, and its two practice solves.
        billed: 7,
      },
      {
        step: "comparison",
        id: "b-1",
        old: STARTER,
        fresh: HA,
        tasks: 4,
        solves: 2,
        level: 0.1,
        cap: 100,
        modelTurns: null,
        reading: "step",
        tally: { wins: 4, losses: 0, ties: 0 },
        valid: { old: [4, 0, 0], fresh: [0, 0, 4] },
        decided: null,
        aside: 0,
        rulings: { earned: 1, "check-defect": 0, unclear: 0 },
        // Its two solves and the Referee's reading, and nothing of the session under the same id.
        billed: 3.5,
        cut: false,
        begun: 2,
        solved: 2,
      },
      // A comparison that began and has not reported is a step all the same: it is what runs now.
      {
        step: "comparison",
        id: "g-1",
        old: STARTER,
        fresh: HA,
        tasks: 4,
        solves: 2,
        level: 0.1,
        cap: 100,
        modelTurns: null,
        reading: null,
        tally: null,
        valid: null,
        decided: null,
        aside: 0,
        rulings: { earned: 0, "check-defect": 0, unclear: 0 },
        billed: 0,
        cut: false,
        begun: 0,
        solved: 0,
      },
    ]);
    // The set-up is the supply the admission reads, and the harnesses are the log's own folds.
    expect(read1.supply).toEqual(supplyOf(c.events()));
    expect([read1.reference, read1.latest]).toEqual([null, HA]);
  });

  // Until 11 October an Examiner session was read from its end alone: buffer-main's x-1, running,
  // read "0 proposed, 0 held out" and $0.00 with seven tasks held out and $8.23 metered.
  it("bills an Examiner session the solves it asked for to try a draft task, ended or open", () => {
    const c = campaign();
    c.setUp();
    c.record("exam.started", { session: "x-1" });
    c.solved("d1", HA, "pass", "x-1");
    expect(steps(c, "examiner")).toMatchObject([{ ended: null, billed: 1.5 }]);
    c.record("exam.finished", {
      session: "x-1",
      ended: "finished",
      proposed: 1,
      held: ["d1"],
      refused: [],
      billed: 2.25,
    });
    expect(steps(c, "examiner")).toMatchObject([{ ended: "finished", billed: 3.75 }]);
  });

  it("reads a session with no end from its own events, and as cut once a later step began", () => {
    const c = campaign();
    c.setUp();
    c.record("exam.started", { session: "x-1" });
    for (const turn of [1, 2, 3]) {
      c.record("exam.turn", { session: "x-1", turn, usage: { cost: { total: 0.5 } } });
    }
    for (const [version, outcome] of [
      ["e1", "passed"],
      ["e2", "passed"],
      ["e3", "refused"],
    ] as const) {
      c.record("task.proposed", { version, session: "x-1" });
      c.record("task.gate", { version, gate: 1, outcome });
    }
    c.record("task.state", { version: "e3", state: "refused", session: "x-1" });
    const open = { id: "x-1", ended: null, turns: 3, proposed: 3, held: 2, refused: 1, billed: 1.5 };
    expect(steps(c, "examiner")).toMatchObject([{ ...open, cut: false }]);
    expect(openSteps(campaignOf(c.events()).steps)).toEqual(["x-1"]);
    // The campaign makes one move at a time: a step begun after x-1 means x-1 will write no end.
    c.record("build.started", { session: "b-1", parent: STARTER, tasks: ["p1"] });
    c.record("build.turn", { session: "b-1", turn: 1, usage: { cost: { total: 0.25 } } });
    c.solved("p1", HA, "fail");
    expect(steps(c, "examiner")).toMatchObject([{ ...open, cut: true }]);
    // The open Builder session: its practice so far, and its own turns beside its solve's dollars.
    expect(steps(c, "builder")).toMatchObject([
      {
        id: "b-1",
        ended: null,
        cut: false,
        turns: 1,
        harness: null,
        practiceSolves: 1,
        fails: 1,
        billed: 1.75,
      },
    ]);
    expect(openSteps(campaignOf(c.events()).steps)).toEqual(["b-1"]);
  });

  // buffer-main's g-1 had four solves in flight on 11 October, and nothing said how far it was.
  it("reads a comparison with no report as open, with its solves so far, and as cut once the campaign ended", () => {
    const c = campaign();
    c.setUp();
    c.compared("g-1", { old: STARTER, fresh: HA }, null);
    c.solved("s1", HA, "pass", "g-1");
    c.record("solve.started", { solve: "s-2", condition: "c", comparison: "g-1" });
    const open = { id: "g-1", reading: null, begun: 2, solved: 1 };
    expect(steps(c, "comparison")).toMatchObject([{ ...open, cut: false }]);
    expect(viewLines("truss", campaignOf(c.events()), Date.now())[2]).toContain(
      "no report yet, open at the log's end: 1 solve ended, 1 open · $1.50",
    );
    c.record("campaign.ended", { ending: "no-room" });
    expect(steps(c, "comparison")).toMatchObject([{ ...open, cut: true }]);
    expect(openSteps(campaignOf(c.events()).steps)).toEqual([]);
    expect(viewLines("truss", campaignOf(c.events()), Date.now())[2]).toContain(
      "no report yet, cut before it: 1 solve ended, 1 cut",
    );
  });

  it("tells a comparison once where a settling wrote its report again, as settled", () => {
    const c = campaign();
    c.setUp();
    c.compared(
      "g-1",
      { old: STARTER, fresh: HA },
      { ...tallied("not-scored", 0, 0), scored: null, aside: HELD },
    );
    c.record("comparison.reported", {
      session: "g-1",
      old: STARTER,
      fresh: HA,
      versions: HELD,
      ...tallied("no-step", 1, 3),
    });
    expect(steps(c, "comparison")).toMatchObject([
      { id: "g-1", reading: "no-step", tally: { wins: 1, losses: 0, ties: 3 }, aside: 0 },
    ]);
  });

  // The logs of 8 October hold reports and no starts: the start was added with the rewrite of the
  // comparison. Such a comparison is a step all the same, with the terms its report holds.
  it("holds a comparison whose log has no start of it, by its report", () => {
    const c = campaign();
    c.setUp();
    c.record("comparison.reported", {
      session: "r-1",
      old: STARTER,
      fresh: HA,
      tasks: 4,
      solves: 2,
      level: 0.1,
      ...tallied("no-step", 1, 3),
    });
    expect(steps(c, "comparison")).toMatchObject([
      {
        id: "r-1",
        old: STARTER,
        fresh: HA,
        tasks: 4,
        solves: 2,
        level: 0.1,
        cap: null,
        reading: "no-step",
        tally: { wins: 1, losses: 0, ties: 3 },
      },
    ]);
  });

  it("holds every failed practice solve with where it stands now, and none of a comparison's", () => {
    const c = campaign();
    c.setUp();
    const [open] = c.built("b-1", STARTER, HA, ["fail"]);
    // A reading of the fail by a Diagnoser, as a log of before 2026-10-11 holds one, is no part of
    // the fail since (`docs/simplify.md`, E1).
    c.record("diagnosis.recorded", {
      solve: open ?? "",
      owner: "solver",
      confidence: "low",
      cause: "It guessed.",
    });
    // A fail of a held-out task's comparison is no practice fail, and neither is one the Referee
    // ruled a check defect.
    c.solved("s1", HA, "fail", "g-1");
    const defect = c.solved("p1", HA, "fail");
    c.record("referee.finding", { solve: defect, ruling: "check-defect" });
    const fails = () => campaignOf(c.events()).fails;
    expect(fails()).toEqual([
      {
        solve: open ?? "",
        task: "p1",
        harness: HA,
        kind: "rejected",
        standing: "open",
        under: null,
      },
    ]);
    // One pass under a later harness is weak evidence, a second repairs, and a later fail under a
    // third harness is its own entry and marks the first as failing again.
    c.solved("p1", HB, "pass");
    expect(fails()[0]).toMatchObject({ standing: "passed-once", under: HB });
    c.solved("p1", HB, "pass");
    expect(fails()[0]).toMatchObject({ standing: "repaired", under: HB });
    const again = c.solved("p1", STARTER, "fail");
    expect(fails()).toMatchObject([
      { solve: open, standing: "failing-again", under: STARTER },
      { solve: again, standing: "open", under: null },
    ]);
    expect(fails()[1]).not.toHaveProperty("diagnosis");
    // A later pass under the fail's own harness says nothing of a repair: the same bytes flip.
    c.solved("p1", STARTER, "pass");
    c.solved("p1", STARTER, "pass");
    expect(fails()[1]).toMatchObject({ standing: "open" });
  });
});

describe("the Builder's filter over that reading", () => {
  const TASKS = new Map([["p1", "t-1"]]);

  it("tells each fail on the session's tasks as a line, and nothing of another task", () => {
    const c = campaign();
    c.setUp();
    const [open] = c.built("b-1", STARTER, HA, ["fail"]);
    c.record("diagnosis.recorded", {
      solve: open ?? "",
      owner: "solver",
      confidence: "low",
      cause: "It guessed.",
    });
    c.solved("p1", HB, "pass");
    const { fails } = campaignOf(c.events());
    // A Diagnoser's reading in a log of before is not told (`docs/simplify.md`, E1).
    expect(failsTold(fails, TASKS)).toEqual([
      `- ${open ?? ""}, t-1, harness aaaaaaaa: fail (rejected); open: passed once under harness bbbbbbbb.`,
    ]);
    // A task this session may not practise on is no line of its opening.
    expect(failsTold(fails, new Map([["p9", "t-9"]]))).toEqual([]);
    c.solved("p1", HB, "pass");
    expect(failsTold(campaignOf(c.events()).fails, TASKS)[0]).toContain("; repaired under harness bbbbbbbb.");
    const again = c.solved("p1", STARTER, "fail");
    const told = failsTold(campaignOf(c.events()).fails, TASKS);
    expect(told[0]).toContain("; failing again under harness 00000000.");
    expect(told[1]).toBe(`- ${again}, t-1, harness 00000000: fail (rejected); open.`);
  });

  // Found in buffer-149, 13 October: b-2 was told only a digest, and found by listing harness/
  // that b-1's crash had left it the starter.
  it("tells where the starting harness came from, and how the last Builder session ended", () => {
    const c = campaign();
    c.setUp();
    const none = startTold(campaignOf(c.events()), STARTER, "b-1");
    expect(none).toBe(
      "You start from harness 00000000, which no Builder session of this campaign left: the Starter Built Harness unless the operator named another.",
    );
    c.built("b-1", STARTER, HA, []);
    c.record("build.started", { session: "b-2", parent: HA, tasks: ["p1"] });
    c.record("build.finished", { session: "b-2", ended: "crashed", harness: HB, changed: true });
    expect(startTold(campaignOf(c.events()), HA, "b-3")).toBe(
      "You start from harness aaaaaaaa, which session b-1 left. The last Builder session, b-2, crashed: its conversation was lost to a provider or host error.",
    );
    c.record("harness.promoted", { harness: HA, from: STARTER, rests: [] });
    // The session's own start is not the last session before it.
    c.record("build.started", { session: "b-3", parent: HA, tasks: ["p1"] });
    expect(startTold(campaignOf(c.events()), HA, "b-3")).toContain(
      "which session b-1 left, now the reference harness. The last Builder session, b-2, crashed",
    );
  });

  it("tells each comparison as its tally and its reading, with no task and no other count", () => {
    const c = campaign();
    c.setUp();
    c.compared("b-1", { old: STARTER, fresh: HA }, tallied("step", 4, 0));
    c.compared(
      "g-1",
      { old: STARTER, fresh: HA },
      { ...tallied("not-scored", 0, 0), scored: null, aside: HELD },
    );
    c.compared("g-2", { old: STARTER, fresh: HB }, tallied("no-step", 1, 3));
    c.compared("g-3", { old: HA, fresh: HB }, tallied("below-starter", 4, 0));
    c.compared("g-4", { old: HA, fresh: HB }, tallied("starter-unread", 4, 0));
    c.compared("g-5", { old: HA, fresh: HB }, null);
    c.compared("g-7", { old: HA, fresh: HB }, tallied("regressed", 4, 0));
    c.compared("g-8", { old: HA, fresh: HB }, tallied("narrow", 4, 0));
    const told = comparisonsTold(campaignOf(c.events()).steps);
    expect(told).toEqual([
      "- Harness aaaaaaaa against harness 00000000, one comparison over 4 tasks: 4 won, 0 lost, 0 tied, which reads a step.",
      "- Harness bbbbbbbb against harness 00000000, one comparison over 4 tasks: 1 won, 0 lost, 3 tied, which reads no step.",
      "- Harness bbbbbbbb against harness aaaaaaaa, one comparison over 4 tasks: 4 won, 0 lost, 0 tied, which reads no step: it did not hold against the starting harness of the campaign.",
      "- Harness bbbbbbbb against harness aaaaaaaa, one comparison over 4 tasks: 4 won, 0 lost, 0 tied, which reads a step, not yet read against the starting harness of the campaign.",
      // The two readings that promote nothing on a step since 12 October, with no task and no family.
      "- Harness bbbbbbbb against harness aaaaaaaa, one comparison over 4 tasks: 4 won, 0 lost, 0 tied, which reads no step: it lost more than it won on tasks earlier comparisons had used up.",
      "- Harness bbbbbbbb against harness aaaaaaaa, one comparison over 4 tasks: 4 won, 0 lost, 0 tied, which reads no step yet: every task it won or lost was of one kind.",
    ]);
    // A comparison made after the budget was set again says the turns its solves were held to:
    // its tally is another setting's, and is not one series with the lines above it.
    c.record("campaign.setting", {
      solver: null,
      minutes: 120,
      turns: 24,
      modelTurns: 5,
      tasks: null,
      target: 12,
    });
    c.compared("g-6", { old: HA, fresh: HB }, tallied("no-step", 2, 2));
    expect(comparisonsTold(campaignOf(c.events()).steps).at(-1)).toBe(
      "- Harness bbbbbbbb against harness aaaaaaaa, one comparison over 4 tasks, each solve held to 5 turns of the solver's: 2 won, 0 lost, 2 tied, which reads no step.",
    );
    // No held-out task, no share of valid answers, no ruling and no cost.
    expect(told.join("\n")).not.toMatch(/s[1-4]\b|0\.0625|valid|earned|\$/);
  });

  // Fix row F16: the Builder's opening had a reader of its own, which is how v1's four readers of
  // one test set began. Both renderings now take their numbers from the same rows.
  it("gives the tally and the fails the operator's view gives", () => {
    const c = campaign();
    c.setUp();
    c.built("b-1", STARTER, HA, ["fail", "fail", "pass"]);
    c.compared("b-1", { old: STARTER, fresh: HA }, tallied("no-step", 2, 2));
    const reading = campaignOf(c.events());
    const view = viewLines("truss", reading, Date.now()).join("\n");
    const told = comparisonsTold(reading.steps);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("2 won, 0 lost, 2 tied");
    expect(view).toContain("2 won, 0 lost, 2 tied");
    const fails = failsTold(reading.fails, TASKS);
    expect(fails).toHaveLength(2);
    expect(view).toContain("2 failed practice solves: 2 open");
    for (const fail of reading.fails) expect(fails.join("\n")).toContain(`- ${fail.solve},`);
  });
});

describe("the operator's view", () => {
  it("says a session with no end is open, with what it did so far and when it last wrote, or cut", () => {
    const c = campaign();
    c.setUp();
    c.record("exam.started", { session: "x-1" });
    c.record("exam.turn", { session: "x-1", turn: 1, usage: { cost: { total: 0.5 } } });
    c.record("task.proposed", { version: "e1", session: "x-1" });
    c.record("task.gate", { version: "e1", gate: 1, outcome: "passed" });
    const examined = (reading: ReturnType<typeof campaignOf>) =>
      reading.steps.find((step) => step.step === "examiner");
    const last = examined(campaignOf(c.events()))?.last ?? "";
    const lines = viewLines("truss", campaignOf(c.events()), Date.parse(last) + 3 * 60_000);
    expect(lines[2]).toBe(
      `  x-1         Examiner session, open at the log's end, 1 turn so far, last wrote at ${last.slice(11, 19)}Z (3 minutes before this reading): 1 proposed, 1 held out, 0 refused · $0.50`,
    );
    c.record("build.started", { session: "b-1", parent: STARTER, tasks: ["p1"] });
    const later = viewLines("truss", campaignOf(c.events()), Date.parse(last));
    expect(later[2]).toContain(
      "Examiner session, cut before its end: a later step began without it: 1 proposed",
    );
    // A Builder session with no end has left no harness yet, and says none.
    expect(later[3]).toStartWith("  b-1         Builder session, open at the log's end, 0 turns so far");
    expect(later[3]).toEndWith(": from 00000000, 0 practice solves · $0.00");
  });

  it("prints the set-up and each step's handover, a line each, and no move beside the table's", () => {
    const c = campaign();
    c.setUp();
    c.record("exam.started", { session: "x-1" });
    c.record("exam.finished", {
      session: "x-1",
      ended: "finished",
      proposed: 3,
      held: ["e1", "e2"],
      refused: ["e3"],
      billed: 2.25,
    });
    c.built("b-1", STARTER, HA, ["fail", "pass"]);
    c.compared("b-1", { old: STARTER, fresh: HA }, tallied("step", 4, 0));
    const lines = viewLines("truss", campaignOf(c.events()), Date.now());
    expect(lines.slice(0, 5)).toEqual([
      "truss",
      "  set-up      4 held out · 1 released for practice · 0 wait for a label · 0 exhausted · checker read, 0 faults, not frozen · reference: the starter",
      "  x-1         Examiner session, finished: 3 proposed, 2 held out, 1 refused · $2.25",
      "  b-1         Builder session, finished: from 00000000 it left aaaaaaaa, 2 practice solves · $7.00",
      "  b-1         comparison of aaaaaaaa with 00000000 on 4 tasks, 2 solves a side at 0.1: 4 won, 0 lost, 0 tied, which reads step · tasks with 0, 1, 2 valid answers: reference 4/0/0, new 0/0/4 · 1 rejection ruled earned · $3.50",
    ]);
    expect(lines).toContain("  practice    1 failed practice solve: 1 open");
    // Fix row F7: a list of moves beside the table's named a promotion on this one step, where the
    // table waits for its repeat. The table's move is printed after this reading, by `view`.
    expect(lines).toHaveLength(6);
    expect(lines.join("\n")).not.toMatch(/promotion|may start/);
  });
});
