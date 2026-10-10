// A campaign has one reading: each step's handover, folded once from its log, and the moves that
// may start next. The operator's view prints it whole, the Builder's opening message is the same
// rows through the Builder's filter, and the next move is the admission a launch would be given.
import { afterAll, describe, expect, it } from "bun:test";
import { admission, sessionAdmission, supplyOf, type Wanted } from "../src/builder/admission.ts";
import { campaignOf, type Handover, nextMoves } from "../src/builder/handover.ts";
import { comparisonsTold, failsTold } from "../src/builder/past.ts";
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
const WANTED: Wanted = {
  target: 12,
  solves: 2,
  level: 0.1,
  trigger: 0.25,
  builds: true,
  cap: { dollars: 600, reserve: 10 },
  restarted: [],
};
const ASKED = { reference: "promoted", comparison: WANTED, session: { cap: WANTED.cap } };
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
      noise: false,
      budgets: [{ turns: 12 }],
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
      { step: "examiner", id: "x-1", ended: "finished", proposed: 3, held: 2, refused: 1, billed: 2.25 },
      {
        step: "builder",
        id: "b-1",
        ended: "finished",
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
        budgets: 1,
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
        budgets: 1,
        cap: 100,
        modelTurns: null,
        reading: null,
        tally: null,
        valid: null,
        decided: null,
        aside: 0,
        rulings: { earned: 0, "check-defect": 0, unclear: 0 },
        billed: 0,
      },
    ]);
    // The set-up is the supply the admission reads, and the harnesses are the log's own folds.
    expect(read1.supply).toEqual(supplyOf(c.events()));
    expect([read1.reference, read1.latest]).toEqual([null, HA]);
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
        budgets: 0,
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
        diagnosis: { owner: "solver", confidence: "low", cause: "It guessed." },
      },
    ]);
    // One pass under a later harness is weak evidence, a second repairs, and a later fail under a
    // third harness is its own entry and marks the first as failing again.
    c.solved("p1", HB, "pass");
    expect(fails()[0]).toMatchObject({ standing: "passed-once", under: HB });
    c.solved("p1", HB, "pass");
    expect(fails()[0]).toMatchObject({ standing: "repaired", under: HB });
    const again = c.solved("p1", STARTER, "fail");
    c.record("diagnosis.recorded", { solve: again, abstain: "no contrast" });
    expect(fails()).toMatchObject([
      { solve: open, standing: "failing-again", under: STARTER },
      { solve: again, standing: "open", under: null, diagnosis: "abstained" },
    ]);
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
    expect(failsTold(fails, TASKS)).toEqual([
      `- ${open ?? ""}, t-1, harness aaaaaaaa: fail (rejected); open: passed once under harness bbbbbbbb. Diagnosis (owner solver, confidence low): It guessed.`,
    ]);
    // A task this session may not practise on is no line of its opening.
    expect(failsTold(fails, new Map([["p9", "t-9"]]))).toEqual([]);
    c.solved("p1", HB, "pass");
    expect(failsTold(campaignOf(c.events()).fails, TASKS)[0]).toContain("; repaired under harness bbbbbbbb.");
    const again = c.solved("p1", STARTER, "fail");
    c.record("diagnosis.recorded", { solve: again, abstain: "no contrast" });
    const told = failsTold(campaignOf(c.events()).fails, TASKS);
    expect(told[0]).toContain("; failing again under harness 00000000.");
    expect(told[1]).toBe(
      `- ${again}, t-1, harness 00000000: fail (rejected); open. The Diagnoser abstained.`,
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
    const told = comparisonsTold(campaignOf(c.events()).steps);
    expect(told).toEqual([
      "- Harness aaaaaaaa against harness 00000000, one comparison over 4 tasks: 4 won, 0 lost, 0 tied, which reads a step.",
      "- Harness bbbbbbbb against harness 00000000, one comparison over 4 tasks: 1 won, 0 lost, 3 tied, which reads no step.",
      "- Harness bbbbbbbb against harness aaaaaaaa, one comparison over 4 tasks: 4 won, 0 lost, 0 tied, which reads no step: it did not hold against the starting harness of the campaign.",
      "- Harness bbbbbbbb against harness aaaaaaaa, one comparison over 4 tasks: 4 won, 0 lost, 0 tied, which reads a step, not yet read against the starting harness of the campaign.",
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
    const view = viewLines("truss", reading, nextMoves(c.events(), ASKED)).join("\n");
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

describe("the moves that may start next", () => {
  const move = (c: ReturnType<typeof campaign>, named: string, asked = ASKED) =>
    nextMoves(c.events(), asked).find((each) => each.move === named);

  // Fix row F13: the view names the same next move that the launcher admits, because both ask the
  // one admission.
  it("are a round and a session by itself as their admissions read them", () => {
    const c = campaign();
    c.setUp();
    const supply = supplyOf(c.events());
    expect(move(c, "a round")).toMatchObject(admission(supply, WANTED));
    expect(move(c, "a Builder session by itself")).toMatchObject(sessionAdmission(supply, ASKED.session));
    // With no cap named, both are refused in the admission's own words.
    const capless = { ...ASKED, comparison: { ...WANTED, cap: null }, session: { cap: null } };
    expect(move(c, "a round", capless)?.refusals).toEqual(admission(supply, capless.comparison).refusals);
    expect(move(c, "a round", capless)?.may).toBe(false);
    expect(move(c, "a round")?.may).toBe(true);
    // On a checker nobody has read, nothing that solves may start.
    const unread = campaign();
    unread.record("task.proposed", { version: "p1" });
    unread.record("task.gate", { version: "p1", gate: 1, outcome: "passed" });
    unread.record("task.state", { version: "p1", state: "released" });
    expect(move(unread, "a Builder session by itself")?.refusals.join("\n")).toContain("never been read");
    expect(move(unread, "an Examiner session")).toMatchObject({ may: true, refusals: [] });
  });

  // live-1, 2026-10-09: every task of its one comparison tied, so the round and the checkpoint were
  // refused, and the session beside them read "may start" with nothing joining the two. Here the
  // round is refused for having no held-out task, which the session does not need either.
  it("say of a session by itself that no comparison could follow it, where a round is refused", () => {
    const whole = campaign();
    whole.setUp();
    expect(move(whole, "a Builder session by itself")?.notes.join("\n")).not.toContain("is refused");
    const c = campaign();
    c.record("task.proposed", { version: "p1" });
    c.record("task.gate", { version: "p1", gate: 1, outcome: "passed" });
    c.record("task.state", { version: "p1", state: "released" });
    c.record("checker.read", { contract: "c", checks: "k", faults: [] });
    expect(move(c, "a round")).toMatchObject({ may: false });
    const alone = move(c, "a Builder session by itself");
    expect(alone?.may).toBe(true);
    expect(alone?.notes.at(-1)).toBe(
      "a comparison of the harness it leaves is refused as the log stands, for the reasons a round is given",
    );
    // A session that is itself refused says its own refusal and no more.
    const capless = { ...ASKED, comparison: { ...WANTED, cap: null }, session: { cap: null } };
    expect(move(c, "a Builder session by itself", capless)?.notes.join("\n")).not.toContain("is refused");
  });

  it("are a checkpoint once a session has left a harness that is not the reference", () => {
    const c = campaign();
    c.setUp();
    expect(move(c, "a checkpoint")).toMatchObject({
      may: false,
      refusals: [
        "no Builder session has left a harness that is not the reference harness: there is nothing to compare",
      ],
    });
    c.built("b-1", STARTER, HA, []);
    expect(move(c, "a checkpoint")).toMatchObject({
      may: true,
      ...admission(supplyOf(c.events()), { ...WANTED, builds: false }),
    });
    // Promoted, the latest harness is the reference, and there is again nothing to compare.
    c.record("harness.promoted", { harness: HA, from: STARTER, rests: [] });
    expect(move(c, "a checkpoint")?.may).toBe(false);
  });

  it("are a settling where a comparison set tasks aside, and a promotion where one read a step", () => {
    const c = campaign();
    c.setUp();
    c.built("b-1", STARTER, HA, []);
    expect(move(c, "settling")).toBeUndefined();
    expect(move(c, "a promotion")).toBeUndefined();
    c.compared(
      "b-1",
      { old: STARTER, fresh: HA },
      { ...tallied("not-scored", 0, 0), scored: null, aside: HELD },
    );
    expect(move(c, "settling")).toMatchObject({
      may: true,
      notes: ["comparison b-1 set 4 tasks aside for a person's labels: tools/d2/settle.ts --session b-1"],
    });
    c.compared("g-1", { old: STARTER, fresh: HA }, tallied("step", 4, 0));
    // A promotion is the operator's word, and the plan gives it after a repeat on fresh solves.
    expect(move(c, "a promotion")).toMatchObject({
      may: true,
      notes: [
        `harness ${HA.slice(0, 8)} read a step against the reference harness in 1 comparison (g-1): the plan promotes a step once it has been repeated on fresh solves, and the word is the operator's (tools/d2/promote.ts)`,
      ],
    });
    c.compared("g-2", { old: STARTER, fresh: HA }, tallied("step", 4, 0));
    expect(move(c, "a promotion")?.notes[0]).toContain("in 2 comparisons (g-1, g-2)");
    c.record("harness.promoted", { harness: HA, from: STARTER, rests: ["g-1", "g-2"] });
    expect(move(c, "a promotion")).toBeUndefined();
  });

  it("are a stop where the plan's stop rule has stopped the campaign", () => {
    const c = campaign();
    c.setUp();
    // A campaign whose patience is the plan's three; the default is six (`PATIENCE`).
    c.record("campaign.opened", { budget: null, limit: null, sessions: 1, patience: 3 });
    expect(move(c, "stop")).toBeUndefined();
    for (const [index, harness] of [HA, HB, "c".repeat(64)].entries()) {
      const id = `b-${String(index + 1)}`;
      c.built(id, STARTER, harness, []);
      c.compared(id, { old: STARTER, fresh: harness }, tallied("no-step", 1, 3));
    }
    expect(move(c, "stop")).toMatchObject({
      may: true,
      notes: [
        "3 checkpoints since the last step: the campaign's patience is spent (docs/plan.md, Phase 5; --patience)",
      ],
    });
    expect(move(c, "a round")?.may).toBe(false);
  });
});

describe("the operator's view", () => {
  it("prints the set-up, each step's handover and each move, a line each", () => {
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
    const lines = viewLines("truss", campaignOf(c.events()), nextMoves(c.events(), ASKED));
    expect(lines.slice(0, 5)).toEqual([
      "truss",
      "  set-up      4 held out · 1 released for practice · 0 wait for a label · 0 exhausted · checker read, 0 faults, not frozen · reference: the starter",
      "  x-1         Examiner session, finished: 3 proposed, 2 held out, 1 refused · $2.25",
      "  b-1         Builder session, finished: from 00000000 it left aaaaaaaa, 2 practice solves · $7.00",
      "  b-1         comparison of aaaaaaaa with 00000000 on 4 tasks, 2 solves a side at 0.1: 4 won, 0 lost, 0 tied, which reads step · tasks with 0, 1, 2 valid answers: reference 4/0/0, new 0/0/4 · 1 rejection ruled earned · $3.50",
    ]);
    expect(lines).toContain("  practice    1 failed practice solve: 1 open");
    expect(lines).toContain("next");
    expect(lines.join("\n")).toMatch(/ {2}a round {9}may start/);
    expect(lines.join("\n")).toMatch(/ {2}a promotion {5}the operator's/);
  });
});
