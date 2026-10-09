// Whether a paid comparison may start is a fact of the campaign's log and of what the comparison
// asks for. One function decides it, and the launcher and the commands both ask that function: a
// command started by hand is refused where a launch of it would be.
import { afterAll, describe, expect, it } from "bun:test";
import { admission, admitComparison, type Supply, supplyOf, type Wanted } from "../src/builder/admission.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { sizeLines } from "../src/kernel/size.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const AT = "2026-10-09T00:00:00.000Z";
const GOING = { checkpoints: 0, sinceStep: 0, stop: false };
/** A campaign whose checker was read with no fault and is not frozen, before any comparison. */
const SETS: Supply = {
  held: 4,
  awaiting: 0,
  released: 1,
  untied: null,
  since: 0,
  faults: 0,
  frozen: false,
  stop: GOING,
};
const WANTED: Wanted = {
  target: 12,
  solves: 2,
  level: 0.1,
  builds: true,
  cap: { dollars: 600, reserve: 10 },
  restarted: [],
};
const LIMITS = {
  wallSeconds: 7200,
  turns: 24,
  shellDefaultSeconds: 300,
  shellMaxSeconds: 900,
  concurrency: 4,
  diskBytes: 1024,
};
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const heldOut = (version: string): LogEvent[] => [
  event("task.proposed", { version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
const reported = (session: string, more: JsonObject) => event("comparison.reported", { session, ...more });
/** A test-side solve under `limits`, which makes theirs the setting of the log's last solves. */
function solvedUnder(solve: string, limits: typeof LIMITS) {
  const condition: Condition = {
    contract: "c1",
    harness: "h1",
    task: "v",
    model: "p/m",
    effort: "high",
    prices: { "p/m": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    runtime: {},
    compaction: "off",
    solverTools: "h1",
    verifierTools: "t1",
    sandbox: "p1",
    limits,
    host: "h",
    side: "test",
  };
  const id = conditionId(condition);
  return {
    events: [
      event("condition.recorded", { id, condition: requireJsonValue(condition) }),
      event("solve.started", { solve, condition: id }),
    ],
    setting: settingId(condition),
  };
}
const tallied = (wins: number, losses: number, setting: string) => ({
  scored: { wins, losses, ties: 8 - wins - losses },
  versions: Array(8).fill("v"),
  setting,
});

describe("what a log holds for the next comparison", () => {
  const [here, longer] = [solvedUnder("s-1", LIMITS), solvedUnder("s-2", { ...LIMITS, turns: 48 })];

  it("is nothing before anything ran: no task, no reading of the checker, no share and no stop", () => {
    expect(supplyOf([])).toEqual({
      held: 0,
      awaiting: 0,
      released: 0,
      untied: null,
      since: 0,
      faults: null,
      frozen: false,
      stop: GOING,
    });
  });

  it("reads the checker's last reading and whether it is frozen", () => {
    const checker = { contract: "c", checks: "k" };
    const reading = (faults: string[]) => event("checker.read", { ...checker, faults });
    expect(supplyOf([reading(["one", "two"]), reading(["one"])])).toMatchObject({ faults: 1, frozen: false });
    expect(supplyOf([reading([]), event("contract.frozen", checker)])).toMatchObject({
      faults: 0,
      frozen: true,
    });
  });

  it("takes the untied share from the last comparison that tallied a task under the log's last setting", () => {
    const log = [
      ...here.events,
      reported("b-1", tallied(6, 0, here.setting)),
      reported("b-2", tallied(1, 1, here.setting)),
      // One the cap cut, and one with every task set aside, tallied nothing and say nothing of it.
      reported("b-3", { scored: null, versions: [], capped: true, setting: here.setting }),
      reported("b-4", { scored: { wins: 0, losses: 0, ties: 0 }, versions: [], setting: here.setting }),
    ];
    expect(supplyOf(log).untied).toBe(0.25);
    // A comparison made under other limits says nothing of the solver the log's last solves were.
    const moved = [...log, ...longer.events];
    expect(supplyOf(moved).untied).toBeNull();
    expect(supplyOf([...moved, reported("b-5", tallied(4, 0, longer.setting))]).untied).toBe(0.5);
  });

  it("counts no more tasks than the harness to be compared with left to win", () => {
    // After a step read 7-0-4 the harness that won was valid in every solve on 8 of the 11 tasks,
    // so a round made against it had 3 to win where the share on record said 7 (2026-10-09).
    const stepped = [
      ...here.events,
      reported("g-1", {
        ...tallied(6, 0, here.setting),
        old: "h0",
        fresh: "h1",
        starter: "h0",
        valid: { old: [6, 1, 1], fresh: [1, 1, 6] },
      }),
    ];
    expect(supplyOf(stepped).untied).toBe(0.75);
    expect(supplyOf(stepped, "h1").untied).toBe(0.25);
    // `latest` is the harness the last whole session left. One that comparison did not solve has
    // no record in it.
    const built = event("build.finished", {
      session: "b-1",
      changed: true,
      harness: "h1",
      ended: "finished",
    });
    expect(supplyOf([built, ...stepped], "latest").untied).toBe(0.25);
    expect(supplyOf(stepped, "h9").untied).toBe(0.75);
    // The campaign's reference harness is the starter until one is promoted, and that one after.
    expect(supplyOf(stepped, "promoted").untied).toBe(0.75);
    const promotion = event("harness.promoted", { harness: "h1", from: "h0", rests: [] });
    expect(supplyOf([...stepped, promotion], "promoted").untied).toBe(0.25);
    expect(supplyOf([...stepped, promotion]).untied).toBe(0.25);
  });

  it("counts the tasks held out since that comparison, and the ones that wait for a label", () => {
    const before = [...heldOut("v"), ...here.events, reported("b-1", tallied(0, 0, here.setting))];
    expect(supplyOf(before)).toMatchObject({ held: 1, untied: 0, since: 0 });
    expect(supplyOf([...before, ...heldOut("w"), ...heldOut("x")])).toMatchObject({ held: 3, since: 2 });
  });

  it("reads the plan's stop rule: the checkpoints since the last step", () => {
    const checkpoint = (session: string, harness: string, reading: string) => [
      event("build.finished", { session, ended: "finished", harness, changed: true }),
      reported(session, { old: "h0", fresh: harness, starter: "h0", ...tallied(1, 1, "s"), reading }),
    ];
    const two = [...checkpoint("b-1", "h1", "no-step"), ...checkpoint("b-2", "h2", "no-step")];
    expect(supplyOf(two).stop).toEqual({ checkpoints: 2, sinceStep: 2, stop: false });
    expect(supplyOf([...two, ...checkpoint("b-3", "h3", "no-step")]).stop.stop).toBe(true);
    expect(supplyOf([...two, ...checkpoint("b-3", "h3", "step")]).stop).toMatchObject({ sinceStep: 0 });
  });
});

describe("whether a comparison may start", () => {
  it("lets one start that can read a step, and says its sets and its size", () => {
    expect(admission(SETS, WANTED)).toEqual({
      refusals: [],
      notes: [
        "4 held out · 1 released for practice · 4 to score",
        ...sizeLines(4, { solves: 2, level: 0.1 }),
      ],
    });
    // A target caps the scored set as few held-out tasks do.
    expect(admission({ ...SETS, held: 20 }, WANTED).notes[0]).toBe(
      "20 held out · 1 released for practice · 12 to score",
    );
  });

  it("refuses a log with no held-out task", () => {
    expect(admission({ ...SETS, held: 0, released: 0 }, WANTED).refusals).toEqual([
      expect.stringContaining("holds no held-out task"),
    ]);
  });

  // As exam-1 stood on 2026-10-08, with one task to score. It was a note then, and eight rounds ran.
  it("refuses fewer tasks than a step takes: it could not read one", () => {
    const small = admission({ ...SETS, held: 3 }, WANTED);
    expect(small.refusals).toEqual([
      "3 held-out tasks can be scored, and at --level 0.1 a step takes 4, all won: this comparison cannot read a step. Run an Examiner session (tools/d1b/examine.ts) for more held-out tasks",
    ]);
    expect(small.notes).toEqual(["3 held out · 1 released for practice · 3 to score"]);
    expect(admission(SETS, { ...WANTED, target: 3 }).refusals).toEqual([
      expect.stringContaining("and ask for a --target of 4 or more"),
    ]);
    expect(admission(SETS, { ...WANTED, level: 0.05 }).refusals).toEqual([
      expect.stringContaining("a step takes 5"),
    ]);
  });

  it("refuses a comparison the campaign's own tie share leaves too few untied tasks of", () => {
    // The last comparison left a quarter of its tasks untied. Twelve then leave about three.
    const tied = { ...SETS, held: 12, untied: 0.25 };
    expect(admission(tied, WANTED).refusals).toEqual([
      "the campaign's last comparison left 25% of its tasks for this one to untie: the rest tied there, or this one's reference harness was valid on them in every solve. At that share 12 scored tasks leave about 3.0 untied, where at --level 0.1 a step takes 4, all won: this comparison could hardly read a step. Run an Examiner session (tools/d1b/examine.ts) for more held-out tasks, or change the budget so that fewer tasks tie",
    ]);
    expect(admission({ ...tied, untied: 0.5 }, WANTED).refusals).toEqual([]);
    expect(admission({ ...tied, untied: null }, WANTED).refusals).toEqual([]);
    // A task held out since that comparison has no share on record and is counted whole. A round
    // that tied nine of nine left no later one able to start, whatever an Examiner session added.
    const allTied = { ...tied, untied: 0 };
    expect(admission({ ...allTied, since: 3 }, WANTED).refusals).toEqual([
      expect.stringContaining("12 scored tasks, the 3 held out since counted whole, leave about 3.0 untied"),
    ]);
    expect(admission({ ...allTied, since: 4 }, WANTED).refusals).toEqual([]);
    // A comparison asked for under another setting than the log's last solves counts every task,
    // since the share on record is that other setting's, and says what the caller found of it.
    const other = admission(tied, { ...WANTED, restarted: ["the tallies on record are another setting's"] });
    expect(other.refusals).toEqual([]);
    expect(other.notes.at(-1)).toBe("the tallies on record are another setting's");
  });

  it("refuses a comparison with no dollar cap, and says when the cap reserves too few solves", () => {
    expect(admission(SETS, { ...WANTED, cap: null }).refusals).toEqual([
      "no --cap is named: a comparison is launched under a dollar cap, and one the cap cuts short reads not-scored",
    ]);
    // Four tasks, two harnesses, two solves: sixteen solves, and a cap of $120 reserves twelve.
    expect(admission(SETS, { ...WANTED, cap: { dollars: 120, reserve: 10 } }).notes.at(-1)).toBe(
      "the cap of $120 holds a reserve of $10 for 12 solves, and the comparison's test alone makes 16, after a session whose spend the same cap holds: it is cut short and reads not-scored unless its solves bill well under their reserve",
    );
    const roomy = admission(SETS, { ...WANTED, cap: { dollars: 160, reserve: 10 } });
    expect(roomy.notes.join("\n")).not.toContain("holds a reserve");
  });

  it("refuses a checker nobody has read, and says so of one read with faults and not frozen", () => {
    // The reading was made late and by hand in the first live rounds, after the solves were paid.
    expect(admission({ ...SETS, faults: null }, WANTED).refusals).toEqual([
      expect.stringContaining("the campaign's checker has never been read: run tools/c/accept.ts"),
    ]);
    const faulty = admission({ ...SETS, faults: 35 }, WANTED);
    expect(faulty.refusals).toEqual([]);
    expect(faulty.notes).toContain(
      "the checker's last reading holds 35 fault(s) and the operator has not frozen it: a rejection here may be the check's own (tools/c/accept.ts)",
    );
    expect(admission({ ...SETS, faults: 35, frozen: true }, WANTED).notes.join("\n")).not.toContain("fault");
  });

  it("says what waits for a label, and that a round's Builder has nothing to practise on", () => {
    expect(admission({ ...SETS, awaiting: 2 }, WANTED).notes).toContain(
      "2 held-out task(s) wait for a person's label and are not scored (tools/d2/prepare.ts)",
    );
    const unreleased = { ...SETS, released: 0 };
    expect(admission(unreleased, WANTED).notes.at(-1)).toContain("nothing to practise on");
    expect(admission(unreleased, { ...WANTED, builds: false }).notes.join("\n")).not.toContain("practise");
  });

  // The plan stops a campaign after three checkpoints without a step. Until 2026-10-09 four
  // commands printed that reading and none acted on it.
  it("refuses the launch after three checkpoints without a step, unless the operator says why it goes on", () => {
    const stopped = { ...SETS, stop: { checkpoints: 3, sinceStep: 3, stop: true } };
    expect(admission(stopped, WANTED).refusals).toEqual([
      'the campaign has had 3 checkpoints since its last step, and the plan stops it at three without one (docs/plan.md, Phase 5). To go on all the same, pass --past-stop "<why>", which is logged',
    ]);
    const past = admission(stopped, { ...WANTED, pastStop: "the budget was set anew" });
    expect(past.refusals).toEqual([]);
    expect(past.notes.at(-1)).toBe(
      "going on past the plan's stop rule, 3 checkpoints after the last step: the budget was set anew",
    );
    // A reason given where the rule does not stop the campaign says nothing.
    expect(admission(SETS, { ...WANTED, pastStop: "just in case" }).notes.join("\n")).not.toContain("stop");
  });
});

describe("a command about to start a comparison", () => {
  const root = mkdtempSync(join(tmpdir(), "ana-admission-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let logs = 0;
  /** A log of four held-out tasks, with whatever `more` adds. */
  const logOf = (more: readonly LogEvent[] = []) => {
    const log = join(root, `log-${String((logs += 1))}.jsonl`);
    for (const { kind, data } of [...["v1", "v2", "v3", "v4"].flatMap(heldOut), ...more]) {
      append(log, kind, data);
    }
    return log;
  };
  const read1 = event("checker.read", { contract: "c", checks: "k", faults: [] });
  const asked = { id: "g-1", reference: "starter", wanted: WANTED };

  it("is refused as a launch of it would be: started by hand on an unread checker, nothing starts", () => {
    const log = logOf();
    expect(() => admitComparison(log, { ...asked, seats: "paid" })).toThrow(
      "the campaign's checker has never been read: run tools/c/accept.ts",
    );
    // Every refusal is said at once, as the launcher says them.
    expect(() => admitComparison(log, { ...asked, wanted: { ...WANTED, cap: null }, seats: "paid" })).toThrow(
      /no --cap is named[^]*checker has never been read/,
    );
    expect(admitComparison(logOf([read1]), { ...asked, seats: "paid" })).toEqual([
      "4 held out · 0 released for practice · 4 to score",
      ...sizeLines(4, { solves: 2, level: 0.1 }),
      "no task is released: the Builder has nothing to practise on",
    ]);
  });

  it("exempts a rehearsal by name: a script is paid nothing, and walks any path", () => {
    expect(admitComparison(logOf(), { ...asked, seats: "scripted" })).toEqual([]);
  });

  it("goes on with a comparison or a session the log holds: it was admitted when it began", () => {
    const begun = logOf([event("comparison.started", { session: "g-1" })]);
    expect(admitComparison(begun, { ...asked, seats: "paid" })).toEqual([]);
    const built = logOf([event("build.started", { session: "g-1" })]);
    expect(admitComparison(built, { ...asked, seats: "paid" })).toEqual([]);
    // Another id's start admits nothing for this one.
    expect(() => admitComparison(begun, { ...asked, id: "g-2", seats: "paid" })).toThrow("never been read");
  });

  it("logs the operator's reason when it goes on past the stop rule, once", () => {
    const checkpoint = (session: string, harness: string) => [
      event("build.finished", { session, ended: "finished", harness, changed: true }),
      reported(session, {
        old: "h0",
        fresh: harness,
        starter: "h0",
        scored: { wins: 1, losses: 1, ties: 2 },
        versions: ["v1", "v2", "v3", "v4"],
        setting: "s",
        reading: "no-step",
      }),
    ];
    const log = logOf([read1, ...["b-1", "b-2", "b-3"].flatMap((id) => checkpoint(id, `h-${id}`))]);
    const fourth = { ...asked, id: "b-4", seats: "paid" } as const;
    expect(() => admitComparison(log, fourth)).toThrow("the plan stops it at three without one");
    expect(read(log).some(({ kind }) => kind === "stop.overridden")).toBe(false);
    const past = { ...fourth, wanted: { ...WANTED, pastStop: "new tasks since" } };
    expect(admitComparison(log, past).at(-1)).toContain("going on past the plan's stop rule");
    const overridden = () =>
      read(log).flatMap(({ kind, data }) => (kind === "stop.overridden" ? [data] : []));
    expect(overridden()).toEqual([
      { session: "b-4", reason: "new tasks since", checkpoints: 3, sinceStep: 3 },
    ]);
    // Asked again before it has begun, it is admitted the same way and logged no second time.
    admitComparison(log, past);
    expect(overridden()).toHaveLength(1);
  });
});
