// A campaign has one reading: each step's handover, folded once from its log. The operator's view
// prints it whole, and the Builder's opening message is the same rows through the Builder's filter.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { supplyOf } from "../src/campaign/admission.ts";
import { campaignOf, type Handover, openSteps } from "../src/campaign/summary.ts";
import { formatComparisonHistory, formatPracticeFailures, formatSessionStart } from "../src/builder/past.ts";
import { type Condition, recordCondition, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { billedAll, billedFor } from "../src/kernel/meter.ts";
import { latestBuilt } from "../src/kernel/reports.ts";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { viewLines } from "../tools/runs/view.ts";
import { anyOf } from "./helpers/matchers.ts";

const LIMITS = {
  wallSeconds: 480,
  turns: 24,
  shellDefaultSeconds: 120,
  shellMaxSeconds: 240,
  concurrency: 4,
};
const [STARTER, HA, HB] = ["0".repeat(64), "a".repeat(64), "b".repeat(64)];
const HELD = ["s1", "s2", "s3", "s4"];
const TASKS = new Map([["p1", "t-1"]]);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-handover-")));
let logs = 0;
let seed = "";

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const conditionOf = (task: string, harness: string): Condition => ({
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
});

function campaign() {
  const log = join(scratch, `log-${String(logs++)}.jsonl`);
  if (seed !== "") writeFileSync(log, seed);
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  let solves = 0;
  const solved = (
    task: string,
    harness: string,
    outcome: "pass" | "fail",
    comparison?: string,
    again = 0,
  ) => {
    if (again === 0) solves += 1;
    const solve = `s-${String(solves)}-${String(again + 1)}`;
    record("solve.started", {
      solve,
      condition: recordCondition(log, conditionOf(task, harness)),
      ...keyIfDefined("comparison", comparison),
    });
    record("solve.finished", {
      solve,
      ending: outcome === "pass" ? { outcome } : { outcome, kind: "rejected" },
      turns: 14,
      seconds: 222.4,
      billed: 1.5,
    });
    if (outcome === "fail") record("referee.finding", { solve, ruling: "earned" });
    return solve;
  };
  const began = (id: string) => record("build.started", { session: id, parent: STARTER, tasks: ["p1"] });
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
  return { log, record, solved, began, built, compared, events: () => read(log) };
}

beforeAll(() => {
  const c = campaign();
  for (const version of ["p1", ...HELD]) {
    c.record("task.proposed", { version });
    c.record("task.gate", { version, gate: 1, outcome: "passed" });
  }
  c.record("task.state", { version: "p1", state: "released" });
  c.record("checker.read", { contract: "c", checks: "k", faults: [] });
  seed = readFileSync(c.log, "utf8");
});

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
    const comparison = {
      step: "comparison",
      old: STARTER,
      fresh: HA,
      tasks: 4,
      solves: 2,
      level: 0.1,
      cap: 100,
      modelTurns: null,
      points: null,
      validity: null,
      aside: 0,
      cut: false,
    } as const;
    expect(read1.steps).toEqual([
      {
        step: "examiner",
        id: "x-1",
        ended: "finished",
        cut: false,
        turns: 0,
        last: anyOf(String),
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
        last: anyOf(String),
        parent: STARTER,
        harness: HA,
        unfinished: null,
        changed: true,
        practiceSolves: 2,
        until: 21,
        fails: 1,
        billed: 7,
      },
      {
        ...comparison,
        id: "b-1",
        reading: "step",
        grain: null,
        repeat: null,
        tally: { wins: 4, losses: 0, ties: 0 },
        valid: { old: [4, 0, 0], fresh: [0, 0, 4] },
        rulings: { earned: 1, "check-defect": 0, unclear: 0 },
        billed: 3.5,
        begun: 2,
        solved: 2,
      },
      {
        ...comparison,
        id: "g-1",
        reading: null,
        grain: null,
        repeat: { with: "b-1", tasks: 4 },
        tally: null,
        valid: null,
        rulings: { earned: 0, "check-defect": 0, unclear: 0 },
        billed: 0,
        begun: 0,
        solved: 0,
      },
    ]);
    expect(read1.supply).toEqual(supplyOf(c.events()));
    expect([read1.reference, read1.latest]).toEqual([null, HA]);
  });
});

describe("a led Builder's lifetime and bill", () => {
  it("reads a led Builder as live while an Examiner session and a comparison run inside it", () => {
    const c = campaign();
    c.record("campaign.opened", { led: true });
    c.began("b-1");
    c.record("build.turn", { session: "b-1", turn: 1, usage: { cost: { total: 0.25 } } });
    c.solved("p1", HA, "fail");
    c.solved("p1", HA, "fail", undefined, 1);
    c.record("exam.started", { session: "x-1" });
    c.record("exam.turn", { session: "x-1", turn: 1, usage: { cost: { total: 0.5 } } });
    c.record("exam.finished", { session: "x-1", ended: "finished", billed: 0.5, held: [] });
    c.record("comparison.started", { session: "g-1" });
    c.solved("s1", HA, "pass", "g-1");
    c.record("build.turn", { session: "b-1", turn: 2, usage: { cost: { total: 0.25 } } });
    const live = { id: "b-1", ended: null, cut: false, turns: 2, practiceSolves: 1, billed: 3.5 };
    expect(steps(c, "builder")).toMatchObject([live]);
    expect(openSteps(campaignOf(c.events()).steps)).toContain("b-1");
    c.record("campaign.ended", { ending: "environment" });
    expect(steps(c, "builder")).toMatchObject([{ ...live, cut: true }]);
  });

  // A reading's turns name its reader alone, so an open Builder is not billed every comparison's
  // readings inside its window.
  it("bills an open led Builder the readings of its own practice, and a comparison's to the comparison", () => {
    const c = campaign();
    c.record("campaign.opened", { led: true });
    c.began("b-1");
    const reading = (reader: string, solve: string, billed: number) => {
      c.record("referee.turn", { reader, turn: 1, usage: { cost: { total: billed } } });
      c.record("referee.finding", { solve, reader, ruling: "earned", billed });
    };
    reading("reader-1", c.solved("p1", HA, "fail"), 0.5);
    expect(steps(c, "builder")).toMatchObject([{ id: "b-1", ended: null, billed: 2 }]);
    c.record("comparison.started", { session: "g-1" });
    reading("reader-2", c.solved("s1", HA, "fail", "g-1"), 0.75);
    expect(steps(c, "builder")).toMatchObject([{ id: "b-1", ended: null, billed: 2 }]);
  });

  // An ended session is not billed everything in its span, which could make its steps sum past the
  // campaign's bill.
  it("bills an ended led Builder its own turns and practice alone, and each dollar of the log to one step", () => {
    const c = campaign();
    c.record("campaign.opened", { led: true });
    c.began("b-1");
    c.solved("p1", HA, "fail");
    c.record("exam.started", { session: "x-1" });
    c.solved("d1", STARTER, "pass", "x-1");
    c.record("exam.finished", { session: "x-1", ended: "finished", billed: 0.5, held: [] });
    c.compared("g-1", { old: STARTER, fresh: HA }, tallied("no-step", 0, 4));
    c.record("build.finished", { session: "b-1", ended: "finished", harness: HA, changed: true, billed: 1 });
    const events = c.events();
    expect(steps(c, "builder")).toMatchObject([{ id: "b-1", ended: "finished", billed: 2.5 }]);
    expect(steps(c, "examiner")).toMatchObject([{ id: "x-1", billed: 2 }]);
    expect(steps(c, "comparison")).toMatchObject([{ id: "g-1", billed: 3.5 }]);
    const summed = campaignOf(events).steps.reduce((sum, step) => sum + step.billed, 0);
    expect(summed).toBe(billedAll(events));
    expect(billedFor(events, "b-1")).toBe(8);
  });
});

describe("unfinished comparisons", () => {
  it("reads a comparison with no report as open, with its solves so far, and as cut once the campaign ended", () => {
    const c = campaign();
    c.compared("g-1", { old: STARTER, fresh: HA }, null);
    c.solved("s1", HA, "pass", "g-1");
    c.record("solve.started", { solve: "s-2", condition: "c", comparison: "g-1" });
    const open = { id: "g-1", reading: null, begun: 2, solved: 1 };
    expect(steps(c, "comparison")).toMatchObject([{ ...open, cut: false }]);
    expect(viewLines("truss", campaignOf(c.events()), Date.now())[2]).toMatch(
      /no report.*in progress.*1 solve finished.*1 open.*\$1\.50/u,
    );
    c.record("exam.started", { session: "x-1" });
    c.record("exam.finished", { session: "x-1", ended: "finished", billed: 0, held: [] });
    expect(steps(c, "comparison")).toMatchObject([{ ...open, cut: false }]);
    expect(openSteps(campaignOf(c.events()).steps)).toContain("g-1");
    c.record("campaign.ended", { ending: "no-room" });
    expect(steps(c, "comparison")).toMatchObject([{ ...open, cut: true }]);
    expect(openSteps(campaignOf(c.events()).steps)).toEqual([]);
    expect(viewLines("truss", campaignOf(c.events()), Date.now())[2]).toMatch(
      /no report.*interrupted.*1 solve finished.*1 cut/u,
    );
  });
});

describe("how far a comparison's tasks are independent draws", () => {
  it("says the largest family's share and the attempt before it on the same tasks, naming no family", () => {
    const c = campaign();
    const families = (...sizes: number[]) =>
      Object.fromEntries(
        sizes.map((ties, nth) => [`kin-${String(nth)}`, { frontier: { wins: 0, losses: 0, ties } }]),
      );
    c.compared("g-1", { old: STARTER, fresh: HA }, { ...tallied("no-step", 0, 4), families: families(3, 1) });
    c.compared("g-2", { old: STARTER, fresh: HB }, tallied("step", 4, 0));
    c.compared(
      "g-3",
      { old: STARTER, fresh: HB },
      { ...tallied("no-step", 0, 4), families: families(1, 1, 1, 1) },
    );
    c.compared("g-4", { old: HB, fresh: STARTER }, tallied("no-step", 0, 4));
    const lines = viewLines("truss", campaignOf(c.events()), Date.now()).slice(2);
    expect(lines[0]).toContain("3 of 4 tallied frontier tasks in one family");
    expect(lines[0]).not.toContain("also drawn");
    expect(lines[1]).toContain("4 of 4 tasks also drawn by g-1");
    expect(lines[1]).not.toContain("one family");
    expect(lines[2]).toContain("4 of 4 tasks also drawn by g-2");
    expect(lines[2]).not.toContain("one family");
    expect(lines[3]).not.toMatch(/also drawn|one family/u);
    expect(lines.join("\n")).not.toContain("kin-");
  });
});

describe("practice repair histories", () => {
  it("tracks established practice failures and tells the Builder only its tasks", () => {
    const c = campaign();
    const [open] = c.built("b-1", STARTER, HA, ["fail"]);
    c.record("diagnosis.recorded", {
      solve: open ?? "",
      owner: "solver",
      confidence: "low",
      cause: "It guessed.",
    });
    c.solved("s1", HA, "fail", "g-1");
    const defect = c.solved("p1", HA, "fail");
    c.record("referee.finding", { solve: defect, ruling: "check-defect" });
    for (const ruling of ["unclear", "check-defect", null] as const) {
      const solve = c.solved("p1", HB, "fail");
      c.record("referee.finding", { solve, ruling });
    }
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
    c.solved("p1", HB, "pass");
    expect(fails()[0]).toMatchObject({ standing: "passed-once", under: HB });
    const toldOnce = formatPracticeFailures(fails(), TASKS);
    expect(toldOnce).toHaveLength(1);
    for (const fact of [open, "t-1", "aaaaaaaa", "fail", "rejected", "open", "passed once", "bbbbbbbb"]) {
      expect(toldOnce[0]).toContain(fact);
    }
    expect(toldOnce[0]).not.toContain("It guessed.");
    expect(formatPracticeFailures(fails(), new Map([["p9", "t-9"]]))).toEqual([]);
    c.solved("p1", HB, "pass");
    expect(fails()[0]).toMatchObject({ standing: "repaired", under: HB });
    expect(formatPracticeFailures(fails(), TASKS)[0]).toMatch(/repaired.*bbbbbbbb/u);
    const again = c.solved("p1", STARTER, "fail");
    expect(fails()).toMatchObject([
      { solve: open, standing: "failing-again", under: STARTER },
      { solve: again, standing: "open", under: null },
    ]);
    expect(fails()[1]).not.toHaveProperty("diagnosis");
    const toldAgain = formatPracticeFailures(fails(), TASKS);
    expect(toldAgain).toHaveLength(2);
    expect(toldAgain[0]).toMatch(/failing again.*00000000/u);
    for (const fact of [again, "t-1", "00000000", "fail", "rejected", "open"]) {
      expect(toldAgain[1]).toContain(fact);
    }
    c.solved("p1", STARTER, "pass");
    c.solved("p1", STARTER, "pass");
    expect(fails()[1]).toMatchObject({ standing: "open" });
  });
});

describe("the Builder's filter over that reading", () => {
  // b-2 is told more than a digest, rather than finding by listing harness/ that b-1's crash had
  // left it the starter.
  it("tells where the starting harness came from, and how the last Builder session ended", () => {
    const c = campaign();
    const none = formatSessionStart(campaignOf(c.events()), STARTER, "b-1");
    expect(none).toMatch(/\b00000000\b.*\bno Builder session\b/u);
    expect(none).not.toMatch(/\bb-\d/u);
    c.built("b-1", STARTER, HA, []);
    c.record("build.started", { session: "b-2", parent: HA, tasks: ["p1"] });
    c.record("build.finished", { session: "b-2", ended: "crashed", harness: HB, changed: true });
    const crashed = formatSessionStart(campaignOf(c.events()), HA, "b-3");
    expect(crashed).toMatch(/\baaaaaaaa\b.*\bb-1\b.*\bb-2\b.*\bcrashed\b/su);
    expect(crashed).toContain("Its unfinished tree is in kept/bbbbbbbb/.");
    expect(crashed).not.toContain("reference");
    c.record("harness.promoted", { harness: HA, from: STARTER, rests: [] });
    c.record("build.started", { session: "b-3", parent: HA, tasks: ["p1"] });
    const promoted = formatSessionStart(campaignOf(c.events()), HA, "b-3");
    expect(promoted).toMatch(/\bb-1\b.*\breference harness\b.*\bb-2\b.*\bcrashed\b/su);
    expect(promoted).not.toContain("b-3");
    const behind = formatSessionStart(campaignOf(c.events()), HB, "b-4");
    expect(behind).toContain("The reference harness is harness aaaaaaaa.");
  });

  it("names a session cut before its end as the one that left what it last froze", () => {
    const c = campaign();
    c.record("build.started", { session: "b-1", parent: STARTER, tasks: ["p1"] });
    c.record("build.checkpoint", { session: "b-1", harness: HA });
    c.record("build.checkpoint", { session: "b-1", harness: HB });
    const told = formatSessionStart(campaignOf(c.events()), HB, "b-2");
    expect(told).toMatch(/\bbbbbbbbb\b.*\bb-1\b/u);
    expect(told).not.toContain("no Builder session");
    c.record("build.finished", { session: "b-1", ended: "killed", turns: 9, seconds: 60, billed: 1 });
    const killed = formatSessionStart(campaignOf(c.events()), HB, "b-2");
    expect(killed).toMatch(/\bbbbbbbbb\b.*\bb-1\b.*\bcut\b/su);
    expect(killed).toMatch(/\bonly its notes and the harness above remain\b/u);
    expect(killed).not.toContain("no Builder session");
    // A crashed ending names the harness its tree held past its last checkpoint (`latestBuilt`), so b-2
    // is not told its checkpoint came from no session.
    const crash = campaign();
    crash.record("build.started", { session: "b-1", parent: STARTER, tasks: ["p1"] });
    crash.record("build.checkpoint", { session: "b-1", harness: HA });
    crash.record("build.finished", { session: "b-1", ended: "crashed", harness: HB, changed: true });
    expect(latestBuilt(crash.events())).toBe(HA);
    const opened = formatSessionStart(campaignOf(crash.events()), HA, "b-2");
    expect(opened).toMatch(/\baaaaaaaa\b.*\bb-1\b.*\bcrashed\b/su);
    expect(opened).toContain("Its unfinished tree is in kept/bbbbbbbb/.");
    expect(opened).not.toContain("no Builder session");
    const cut = campaign();
    cut.record("build.started", { session: "b-1", parent: STARTER, tasks: ["p1"] });
    cut.record("build.checkpoint", { session: "b-1", harness: HA });
    cut.record("build.finished", { session: "b-1", ended: "killed", harness: HB, changed: true });
    expect(formatSessionStart(campaignOf(cut.events()), HA, "b-2")).toContain(
      "Its unfinished tree is in kept/bbbbbbbb/.",
    );
    const same = campaign();
    same.record("build.started", { session: "b-1", parent: STARTER, tasks: ["p1"] });
    same.record("build.checkpoint", { session: "b-1", harness: STARTER });
    expect(formatSessionStart(campaignOf(same.events()), STARTER, "b-2")).toContain("no Builder session");
  });

  it("tells each comparison as its tally and its reading, with no task", () => {
    const c = campaign();
    c.compared("b-1", { old: STARTER, fresh: HA }, tallied("step", 4, 0));
    c.compared(
      "g-1",
      { old: STARTER, fresh: HA },
      { ...tallied("not-scored", 0, 0), scored: null, aside: HELD },
    );
    const readings = [
      ["g-2", STARTER, "no-step", 1, 3, /no step/u],
      ["g-3", HA, "below-starter", 4, 0, /no step.*starting harness/u],
      ["g-4", HA, "starter-unread", 4, 0, /a step.*not yet read.*starting harness/u],
      ["g-7", HA, "regressed", 4, 0, /no step.*lost more.*earlier comparisons/u],
      ["g-8", HA, "narrow", 4, 0, /no step yet.*one kind/u],
    ] as const;
    for (const [id, old, reading, wins, ties] of readings) {
      c.compared(id, { old, fresh: HB }, tallied(reading, wins, ties));
    }
    c.compared("g-5", { old: HA, fresh: HB }, null);
    const told = formatComparisonHistory(campaignOf(c.events()).steps);
    expect(told).toHaveLength(6);
    expect(told[0]).toMatch(/aaaaaaaa.*00000000.*4 tasks.*4 won.*0 lost.*0 tied.*a step/u);
    for (const [index, [, old, , wins, ties, meaning]] of readings.entries()) {
      const line = told[index + 1];
      for (const fact of ["bbbbbbbb", old.slice(0, 8), "4 tasks", `${wins} won`, "0 lost", `${ties} tied`]) {
        expect(line).toContain(fact);
      }
      expect(line).toMatch(meaning);
    }
    c.record("campaign.setting", {
      solver: null,
      minutes: 120,
      turns: 24,
      modelTurns: 5,
      tasks: null,
      target: 12,
    });
    c.compared("g-6", { old: HA, fresh: HB }, tallied("no-step", 2, 2));
    expect(formatComparisonHistory(campaignOf(c.events()).steps).at(-1)).toMatch(
      /bbbbbbbb.*aaaaaaaa.*4 tasks.*5 turns.*2 won.*0 lost.*2 tied.*no step/u,
    );
    expect(told.join("\n")).not.toMatch(/s[1-4]\b|0\.0625|valid|earned|\$/);
  });

  it("tells a report that also scored the bill by the tally its step was read on", () => {
    const c = campaign();
    // Three tasks won with the bill tie without it, as an older report stored them, so the line says 1
    // won and 3 tied.
    const billed = tallied("no-step", 4, 0);
    const scored = { wins: 4, losses: 0, ties: 0, p: 0.0625, unsolved: 0, differences: [700, 100, 100, 100] };
    c.compared("g-1", { old: HA, fresh: HB }, { ...billed, scored: { ...scored, unbilled: [600, 0, 0, 0] } });
    const [told] = formatComparisonHistory(campaignOf(c.events()).steps);
    expect(told).toMatch(/1 won, 0 lost, 3 tied, which reads no step/u);
    expect(told).not.toContain("bill");
  });

  // After a no-step of 18 won and 5 lost held by one validity loss, a Builder told the tally alone
  // would practise on, though no practice task could be the one it lost.
  it.each([
    ["fail", "Validity differed on 1 of the 2 tasks"],
    ["pass", "Validity differed on none of the 2 tasks"],
  ] as const)(
    "tells how many tallied tasks validity differed on, naming none, where the old side's s1 is a %s",
    (outcome, said) => {
      const c = campaign();
      const setting = settingId(conditionOf("any", "any"));
      const sides = { old: HA, fresh: HB };
      const versions = ["s1", "s2"];
      c.record("comparison.started", {
        session: "g-1",
        ...sides,
        starter: STARTER,
        setting,
        solves: 1,
        level: 0.1,
        tasks: versions,
      });
      c.solved("s1", HB, "pass", "g-1");
      c.solved("s1", HA, outcome, "g-1");
      c.solved("s2", HB, "pass", "g-1");
      c.solved("s2", HA, "pass", "g-1");
      const wins = outcome === "fail" ? 1 : 0;
      c.record("comparison.reported", {
        session: "g-1",
        ...sides,
        starter: STARTER,
        setting,
        solves: 1,
        versions,
        reading: "no-step",
        scored: { wins, losses: 0, ties: 2 - wins, p: 0.5, unsolved: 0 },
        aside: [],
      });
      const [told] = formatComparisonHistory(campaignOf(c.events()).steps);
      expect(told).toContain(said);
      expect(told).not.toMatch(/\bs[12]\b/u);
    },
  );
});
