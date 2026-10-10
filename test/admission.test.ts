// Whether a paid comparison may start is a fact of the campaign's log and of what the comparison
// asks for. One function decides it, and the launcher and the commands both ask that function: a
// command started by hand is refused where a launch of it would be.
import { afterAll, describe, expect, it } from "bun:test";
import {
  admission,
  admitComparison,
  admitSession,
  sessionAdmission,
  type Supply,
  supplyOf,
  type Wanted,
} from "../src/builder/admission.ts";
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
  exhausted: 0,
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
  trigger: 0.25,
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
      exhausted: 0,
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
    // Six of the eight tasks closed by the reference in the last one: two to win.
    const closed = (count: number) => ({ valid: { old: [8 - count, 0, count], fresh: [0, 0, 8] } });
    const log = [
      ...here.events,
      reported("b-1", { ...tallied(6, 0, here.setting), ...closed(0) }),
      reported("b-2", { ...tallied(1, 1, here.setting), ...closed(6) }),
      // One the cap cut, and one with every task set aside, tallied nothing and say nothing of it.
      reported("b-3", { scored: null, versions: [], capped: true, setting: here.setting }),
      reported("b-4", { scored: { wins: 0, losses: 0, ties: 0 }, versions: [], setting: here.setting }),
    ];
    expect(supplyOf(log).untied).toBe(0.25);
    // A comparison made under other limits says nothing of the solver the log's last solves were.
    const moved = [...log, ...longer.events];
    expect(supplyOf(moved).untied).toBeNull();
    expect(
      supplyOf([...moved, reported("b-5", { ...tallied(4, 0, longer.setting), ...closed(4) })]).untied,
    ).toBe(0.5);
    // A report with no count of valid solves closes nothing: every task may be won.
    expect(supplyOf([...moved, reported("b-6", tallied(0, 0, longer.setting))]).untied).toBe(1);
  });

  it("counts the tasks the harness to be compared with left to win, whatever the last comparison untied", () => {
    // After a step read 7-0-4 the harness that won was valid in every solve on 8 of the 11 tasks,
    // so a round made against it had 3 to win where the tally said 7 (2026-10-09). The other way
    // round, a task nobody answered yet is one a changed harness may win: until 10 October no
    // more were counted than the last comparison untied, and a simulated climb read 0 to win on
    // six tasks written for room.
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
    expect(supplyOf(stepped).untied).toBe(0.875);
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
    // A harness the comparison did not read closed nothing on record.
    expect(supplyOf(stepped, "h9").untied).toBe(1);
    // The campaign's reference harness is the starter until one is promoted, and that one after.
    expect(supplyOf(stepped, "promoted").untied).toBe(0.875);
    const promotion = event("harness.promoted", { harness: "h1", from: "h0", rests: [] });
    expect(supplyOf([...stepped, promotion], "promoted").untied).toBe(0.25);
    expect(supplyOf([...stepped, promotion]).untied).toBe(0.25);
  });

  it("takes the share from the last comparison of the pair, where the command names the harness it reads", () => {
    // t-4 (10 October): the control of the promoted harness's programs against the starter tied
    // 7 of 8, 6 answered by neither, and the whole harness against those programs was refused on
    // that share.
    const control = reported("c-1", {
      ...tallied(0, 1, here.setting),
      old: "h0",
      fresh: "p1",
      starter: "h0",
      valid: { old: [6, 0, 2], fresh: [6, 1, 1] },
    });
    const log = [...here.events, control];
    // The same pair again: the reference closed two tasks, and six may be won, the ones nobody
    // answered among them.
    expect(supplyOf(log, "p1", undefined, "h0").untied).toBeCloseTo(7 / 8, 10);
    expect(supplyOf(log, "h0", undefined, "p1").untied).toBeCloseTo(6 / 8, 10);
    // Another harness against those programs: no comparison of that pair, so no share.
    expect(supplyOf(log, "p1", undefined, "h1").untied).toBeNull();
    // With no harness named, the last comparison under the setting stands, as before.
    expect(supplyOf(log, "p1").untied).toBeCloseTo(7 / 8, 10);
    const pair = reported("c-2", {
      ...tallied(5, 0, here.setting),
      old: "p1",
      fresh: "h1",
      starter: "h0",
      valid: { old: [6, 1, 1], fresh: [0, 0, 8] },
    });
    expect(supplyOf([...log, pair, control], "p1", undefined, "h1").untied).toBeCloseTo(7 / 8, 10);
  });

  it("counts the tasks held out since that comparison, and the ones that wait for a label", () => {
    const before = [
      ...heldOut("v"),
      ...here.events,
      reported("b-1", { ...tallied(0, 0, here.setting), valid: { old: [0, 0, 8], fresh: [0, 0, 8] } }),
    ];
    expect(supplyOf(before)).toMatchObject({ held: 1, untied: 0, since: 0 });
    expect(supplyOf([...before, ...heldOut("w"), ...heldOut("x")])).toMatchObject({ held: 3, since: 2 });
  });

  it("reads the plan's stop rule: the checkpoints since the last step", () => {
    const checkpoint = (session: string, harness: string, reading: string) => [
      event("build.finished", { session, ended: "finished", harness, changed: true }),
      reported(session, { old: "h0", fresh: harness, starter: "h0", ...tallied(1, 1, "s"), reading }),
    ];
    // A campaign whose patience is the plan's three; the default is six (`PATIENCE`).
    const three = event("campaign.opened", {
      budget: null,
      limit: null,
      sessions: 1,
      patience: 3,
    });
    const two = [three, ...checkpoint("b-1", "h1", "no-step"), ...checkpoint("b-2", "h2", "no-step")];
    expect(supplyOf(two).stop).toEqual({ checkpoints: 2, sinceStep: 2, stop: false });
    expect(supplyOf([...two, ...checkpoint("b-3", "h3", "no-step")]).stop.stop).toBe(true);
    expect(supplyOf([...two, ...checkpoint("b-3", "h3", "step")]).stop).toMatchObject({ sinceStep: 0 });
    // By default the campaign bears six.
    const patient = two.slice(1);
    expect(supplyOf([...patient, ...checkpoint("b-3", "h3", "no-step")]).stop.stop).toBe(false);
  });
});

describe("whether a comparison may start", () => {
  it("lets one start that can read a step, and says its sets and its size", () => {
    expect(admission(SETS, WANTED)).toEqual({
      refusals: [],
      notes: [
        "4 held out · 1 released for practice · 4 to score",
        ...sizeLines(4, { solves: 2, level: 0.1, trigger: 0.25 }),
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
  it("refuses fewer tasks than a first reading takes: it could not buy a repeat", () => {
    // Since 10 October a first reading at or under the trigger buys the repeat, and 2-0 clears
    // 0.25: one task cannot, where three could not read a step at 0.10 before.
    const small = admission({ ...SETS, held: 1 }, WANTED);
    expect(small.refusals).toEqual([
      "1 held-out task can be scored, and at --trigger 0.25 a first reading takes 2, all won: this comparison cannot buy a repeat. Run an Examiner session (tools/d1b/examine.ts) for more held-out tasks",
    ]);
    expect(small.notes).toEqual(["1 held out · 1 released for practice · 1 to score"]);
    expect(admission(SETS, { ...WANTED, target: 1 }).refusals).toEqual([
      expect.stringContaining("and ask for a --target of 2 or more"),
    ]);
    expect(admission({ ...SETS, held: 3 }, { ...WANTED, trigger: 0.1 }).refusals).toEqual([
      expect.stringContaining("a first reading takes 4"),
    ]);
  });

  it("refuses a comparison the campaign's own tie share leaves too few untied tasks of", () => {
    // The last comparison left a tenth of its tasks untied. Twelve then leave about one, where a
    // first reading takes two (a quarter, three, was too few at 0.10 until 10 October).
    const tied = { ...SETS, held: 12, untied: 0.1 };
    expect(admission(tied, WANTED).refusals).toEqual([
      "the campaign's last comparison left 10% of its tasks for this one to untie: the rest tied there, or this one's reference harness was valid on them in every solve. At that share 12 scored tasks leave about 1.2 untied, where at --trigger 0.25 a first reading takes 2, all won: this comparison could hardly buy a repeat. Run an Examiner session (tools/d1b/examine.ts) for more held-out tasks, or change the budget so that fewer tasks tie",
    ]);
    expect(admission({ ...tied, untied: 0.25 }, WANTED).refusals).toEqual([]);
    expect(admission({ ...tied, untied: null }, WANTED).refusals).toEqual([]);
    // A task held out since that comparison has no share on record and is counted whole. A round
    // that tied nine of nine left no later one able to start, whatever an Examiner session added.
    const allTied = { ...tied, untied: 0 };
    expect(admission({ ...allTied, since: 1 }, WANTED).refusals).toEqual([
      expect.stringContaining("12 scored tasks, the 1 held out since counted whole, leave about 1.0 untied"),
    ]);
    expect(admission({ ...allTied, since: 2 }, WANTED).refusals).toEqual([]);
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

  // The plan stops a campaign after three moves that could have shown a gain and showed none.
  // Until 2026-10-09 four commands printed that reading and none acted on it.
  it("refuses the launch after three moves without a gain, unless the operator says why it goes on", () => {
    const stopped = { ...SETS, stop: { checkpoints: 3, sinceStep: 3, stop: true } };
    expect(admission(stopped, WANTED).refusals).toEqual([
      'the campaign has had 3 moves that could have shown a gain since its last step, and none did: its patience is spent (docs/plan.md, row F48; --patience). To go on all the same, pass --past-stop "<why>", which is logged',
    ]);
    const past = admission(stopped, { ...WANTED, pastStop: "the budget was set anew" });
    expect(past.refusals).toEqual([]);
    expect(past.notes.at(-1)).toBe(
      "going on past the plan's stop rule, 3 moves that could have shown a gain after the last step: the budget was set anew",
    );
    // A reason given where the rule does not stop the campaign says nothing.
    expect(admission(SETS, { ...WANTED, pastStop: "just in case" }).notes.join("\n")).not.toContain("stop");
  });

  it("refuses a first record of the setting that is another than the log's solves ran under", () => {
    const why = "the campaign's log records no setting yet, and this command names another";
    expect(admission(SETS, { ...WANTED, unrecorded: why }).refusals).toEqual([why]);
    expect(sessionAdmission(SETS, { cap: WANTED.cap, unrecorded: why }).refusals).toEqual([why]);
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
  const asked = { id: "g-1", reference: "starter", wanted: WANTED, own: () => undefined };

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
      ...sizeLines(4, { solves: 2, level: 0.1, trigger: 0.25 }),
      "no task is released: the Builder has nothing to practise on",
    ]);
  });

  it("exempts a rehearsal by name: a script is paid nothing, and walks any path", () => {
    expect(admitComparison(logOf(), { ...asked, seats: "scripted" })).toEqual([]);
  });

  it("goes on with a comparison the log holds the start of: it was admitted when it began", () => {
    const begun = logOf([event("comparison.started", { session: "g-1" })]);
    expect(admitComparison(begun, { ...asked, seats: "paid" })).toEqual([]);
    // Another id's start admits nothing for this one.
    expect(() => admitComparison(begun, { ...asked, id: "g-2", seats: "paid" })).toThrow("never been read");
  });

  // Fix row F42: a session that ran by itself left a start under its id, and until 2026-10-09 a
  // round started by hand under that id compared with no check, on an unread checker.
  it("is asked the whole check under the id of a session that ran by itself", () => {
    const alone = logOf([
      event("build.started", { session: "b-2" }),
      event("build.finished", { session: "b-2", ended: "finished" }),
    ]);
    expect(() => admitComparison(alone, { ...asked, id: "b-2", seats: "paid" })).toThrow("never been read");
    // The session itself goes on from its own start, and a comparison's start admits no session.
    const session = { id: "b-2", wanted: { cap: WANTED.cap }, seats: "paid" } as const;
    expect(admitSession(alone, session)).toEqual([]);
    const compared = logOf([event("comparison.started", { session: "b-2" })]);
    expect(admitSession(compared, session)).not.toEqual([]);
  });

  // Fix row F44: a command's own refusals come after the admission's and before anything is
  // written, so a command refused on either leaves the log as it was.
  it("asks the comparison's own terms after its refusals and before it writes anything", () => {
    const asks: string[] = [];
    const own = () => {
      asks.push("own");
      throw new Error("task t-9 is not proposed, and only a held-out task is scored");
    };
    // The admission refuses first, and the terms are not asked.
    expect(() => admitComparison(logOf(), { ...asked, own, seats: "paid" })).toThrow("never been read");
    expect(asks).toEqual([]);
    // Past the stop rule on the operator's reason, refused terms leave no override in the log.
    const stopped = logOf([
      read1,
      ...["b-1", "b-2", "b-3"].flatMap((id) => [
        event("build.finished", { session: id, ended: "finished", harness: `h-${id}`, changed: true }),
        reported(id, {
          old: "h0",
          fresh: `h-${id}`,
          starter: "h0",
          scored: { wins: 1, losses: 1, ties: 2 },
          versions: ["v1", "v2", "v3", "v4"],
          setting: "s",
          reading: "no-step",
        }),
      ]),
    ]);
    const past = { ...asked, id: "b-4", own, wanted: { ...WANTED, pastStop: "new tasks since" } };
    const before = read(stopped).length;
    expect(() => admitComparison(stopped, { ...past, seats: "paid" })).toThrow("task t-9 is not proposed");
    expect(asks).toEqual(["own"]);
    expect(read(stopped)).toHaveLength(before);
    // A rehearsal is admitted unasked, and its own terms still hold it.
    expect(() => admitComparison(stopped, { ...past, seats: "scripted" })).toThrow("task t-9");
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
    const three = event("campaign.opened", {
      budget: null,
      limit: null,
      sessions: 1,
      patience: 3,
    });
    const log = logOf([three, read1, ...["b-1", "b-2", "b-3"].flatMap((id) => checkpoint(id, `h-${id}`))]);
    const fourth = { ...asked, id: "b-4", seats: "paid" } as const;
    expect(() => admitComparison(log, fourth)).toThrow("its patience is spent");
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

// The plan's checkpoint is several Builder sessions and then one comparison. A session run by
// itself scores nothing, so it is asked less: its cap, a checker that has been read, the stop rule.
describe("whether a session with no comparison may start", () => {
  const CAP = { dollars: 150, reserve: 10 };
  const root = mkdtempSync(join(tmpdir(), "ana-admission-session-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("starts on a read checker under a cap, and says that nothing is compared", () => {
    expect(sessionAdmission(SETS, { cap: CAP })).toEqual({
      refusals: [],
      notes: [
        "1 released for practice · no comparison follows this session: tools/d2/checkpoint.ts compares what the campaign's sessions leave",
      ],
    });
    // A cap that holds fewer reserves than the session may practise is said, and refuses nothing.
    expect(sessionAdmission(SETS, { cap: CAP, practiceSolves: 24 })).toEqual({
      refusals: [],
      notes: [
        expect.any(String),
        "the cap of $150 holds a reserve of $10 for 15 practice solves, and the session's limit is 24: the Builder is told the fewer, which falls by less than one a solve while solves bill under their reserve",
      ],
    });
    expect(sessionAdmission(SETS, { cap: CAP, practiceSolves: 15 }).notes).toHaveLength(1);
    // What refuses a comparison for want of tasks to score does not refuse a session.
    const none = { ...SETS, held: 0, untied: 0 };
    expect(admission(none, WANTED).refusals).toHaveLength(1);
    expect(sessionAdmission(none, { cap: CAP }).refusals).toEqual([]);
  });

  it("refuses one with no cap, on a checker nobody has read, or after the stop rule", () => {
    expect(sessionAdmission(SETS, { cap: null }).refusals).toEqual([
      "no --cap is named: a session is launched under a dollar cap, and no practice solve starts that a reserve for it would take past the cap",
    ]);
    expect(sessionAdmission({ ...SETS, faults: null }, { cap: CAP }).refusals).toEqual([
      expect.stringContaining(
        "the campaign's checker has never been read: run tools/c/accept.ts, which puts every control and the do-nothing answer to the checks and says what each check has been seen to do. A practice solve is judged by the same checks",
      ),
    ]);
    // With nothing to practise on, no check judges anything of the session.
    const bare = { ...SETS, released: 0, faults: null };
    expect(sessionAdmission(bare, { cap: CAP })).toMatchObject({
      refusals: [],
      notes: [expect.any(String), "no task is released: the Builder has nothing to practise on"],
    });
    const stopped = { ...SETS, stop: { checkpoints: 3, sinceStep: 3, stop: true } };
    expect(sessionAdmission(stopped, { cap: CAP }).refusals).toEqual([
      expect.stringContaining("its patience is spent"),
    ]);
    const past = sessionAdmission(stopped, { cap: CAP, pastStop: "a new budget" });
    expect(past.refusals).toEqual([]);
    expect(past.notes.at(-1)).toBe(
      "going on past the plan's stop rule, 3 moves that could have shown a gain after the last step: a new budget",
    );
  });

  it("is asked by the command before its first event, and a rehearsal's is exempt", () => {
    const log = join(root, "log.jsonl");
    for (const { kind, data } of [
      ...heldOut("p1"),
      event("task.state", { version: "p1", state: "released" }),
    ]) {
      append(log, kind, data);
    }
    const asked = { id: "b-2", wanted: { cap: CAP } };
    expect(() => admitSession(log, { ...asked, seats: "paid" })).toThrow("checker has never been read");
    expect(admitSession(log, { ...asked, seats: "scripted" })).toEqual([]);
    append(log, "checker.read", { contract: "c", checks: "k", faults: [] });
    expect(admitSession(log, { ...asked, seats: "paid" })).toEqual([
      "1 released for practice · no comparison follows this session: tools/d2/checkpoint.ts compares what the campaign's sessions leave",
    ]);
    // One the log holds a start of goes on: it was admitted when it began.
    append(log, "build.started", { session: "b-2" });
    append(log, "checker.read", { contract: "c", checks: "k2", faults: null });
    expect(admitSession(log, { ...asked, seats: "paid" })).toEqual([]);
  });
});
