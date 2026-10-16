// Whether a paid comparison may start is a fact of the campaign's log and of what the comparison
// asks for. One function decides it, and the launcher and the commands both ask that function: a
// command started by hand is refused where a launch of it would be.
import { afterAll, describe, expect, it } from "bun:test";
import {
  admitComparison,
  admitSession,
  Refused,
  refusals,
  type Supply,
  supplyOf,
  type Wanted,
} from "../src/builder/admission.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { sizeLines } from "../src/kernel/size.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { conditionOf, roundSolves } from "./helpers/logged-round.ts";

const AT = "2026-10-09T00:00:00.000Z";
/** Eight held-out tasks, and each one's outcomes as `spell` gives them by its place. */
const EIGHT = ["a", "b", "c", "d", "e", "f", "g", "h"];
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
  patience: 3,
  builds: true,
  cap: { dollars: 600, reserve: 10 },
};
const PAST = "going on past the plan's stop rule, 3 moves that could have shown a gain after the last step";
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
  const condition = conditionOf("v", "h1", limits);
  const id = conditionId(condition);
  return {
    events: [
      event("condition.recorded", { id, condition: requireJsonValue(condition) }),
      event("solve.started", { solve, condition: id }),
    ],
    setting: settingId(condition),
  };
}
/** Comparison `session` of `old` against `fresh`, as a round logs it: its solves, as `roundSolves`
 *  spells them, then its report. */
function roundLogged(
  session: string,
  [old, fresh]: readonly [string, string],
  outcomes: Readonly<Record<string, string>>,
  more: Partial<typeof LIMITS> = {},
): LogEvent[] {
  const { events, terms } = roundSolves(session, [old, fresh], outcomes, more);
  const scored = { wins: 0, losses: 0, ties: terms.versions.length };
  return [...events, reported(session, { old, fresh, starter: "h0", scored, ...terms })];
}
/** The codes the gate refuses a comparison on this supply with, at the size `asked` names. */
const codes = (supply: Supply, asked: Partial<Wanted> = {}) =>
  refusals(supply, { ...WANTED, ...asked }).map(({ code }) => code);
const READ = event("checker.read", { contract: "c", checks: "k", faults: [] });
const root = mkdtempSync(join(tmpdir(), "ana-admission-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let logs = 0;
/** A log file of `events`. */
function logOf(events: readonly LogEvent[]): string {
  const log = join(root, `log-${String((logs += 1))}.jsonl`);
  for (const { kind, data } of events) append(log, kind, data);
  return log;
}
/** Four held-out tasks, with whatever `more` adds. */
const four = (more: readonly LogEvent[] = []) =>
  logOf([...["v1", "v2", "v3", "v4"].flatMap(heldOut), ...more]);
/** A comparison `g-1` about to start against the starter, and a session `b-2` with none after it. */
const ASKED = {
  id: "g-1",
  reference: "starter",
  wanted: WANTED,
  own: () => undefined,
  seats: "paid",
} as const;
const SESSION = { id: "b-2", wanted: { cap: WANTED.cap }, seats: "paid" } as const;
/** A campaign of patience three whose three comparisons could each have shown a gain and showed
 *  none: the plan's stop rule has stopped it. */
const STOPPED = [
  event("campaign.opened", { budget: null, limit: null, sessions: 1, patience: 3 }),
  READ,
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
];
/** Each of the eight tasks with its outcomes, as `spell` gives them by its place. */
const eight = (spell: (place: number) => string) =>
  Object.fromEntries(EIGHT.map((task, place) => [task, spell(place)]));

describe("what a log holds for the next comparison", () => {
  const [here, longer] = [solvedUnder("s-1", LIMITS), solvedUnder("s-2", { ...LIMITS, turns: 48 })];

  // The stop rule's own cases are its owner's (`test/reports.test.ts`).
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

  it("takes the untied share from the last comparison that tallied a task, whatever setting id it carries", () => {
    // Six of the eight tasks closed by the reference in the last one, four of the six retired and
    // two retained (`poolOf`): two to win, and the frontier holds those two alone.
    const log = [
      ...EIGHT.flatMap(heldOut),
      ...roundLogged(
        "b-1",
        ["h0", "h1"],
        eight(() => "FF PP"),
      ),
      ...roundLogged(
        "b-2",
        ["h0", "h2"],
        eight((place) => (place < 6 ? "PP PP" : "FF PP")),
      ),
      // One the cap cut, and one with every task set aside, tallied nothing and say nothing of it.
      reported("b-3", { old: "h0", scored: null, versions: [], capped: true, setting: here.setting }),
      reported("b-4", {
        old: "h0",
        scored: { wins: 0, losses: 0, ties: 0 },
        versions: [],
        setting: here.setting,
      }),
    ];
    expect(supplyOf(log)).toMatchObject({ held: 2, untied: 1 });
    // A setting id names the host's code too, and a campaign runs at one setting: solves under
    // another id, as after a tree moved to a new commit, leave the share where it was. Until
    // 2026-10-11 they read no share, and the next comparison counted every task.
    const moved = [...log, ...longer.events];
    expect(supplyOf(moved)).toMatchObject({ held: 2, untied: 1 });
    // A comparison under the other id is the last one, and its share is the one read: the six it
    // found open again count, and of its two closed tasks one retired and one is retained (`poolOf`).
    const again = roundLogged(
      "b-5",
      ["h0", "h3"],
      eight((place) => (place < 6 ? "FF PP" : "PP PP")),
      { turns: 48 },
    );
    expect(supplyOf([...moved, ...again])).toMatchObject({ held: 6, untied: 1 });
  });

  it("counts the tasks the harness to be compared with left to win, whatever the last comparison untied", () => {
    // After a step read 7-0-4 the harness that won was valid in every solve on 8 of the 11 tasks,
    // so a round made against it had 3 to win where the tally said 7 (2026-10-09). The other way
    // round, a task nobody answered yet is one a changed harness may win: until 10 October no
    // more were counted than the last comparison untied, and a simulated climb read 0 to win on
    // six tasks written for room.
    const spelled = ["PP PP", "PF PP", "FF PP", "FF PP", "FF PP", "FF PP", "FF PF", "FF FF"];
    const stepped = [
      ...EIGHT.flatMap(heldOut),
      ...roundLogged(
        "g-1",
        ["h0", "h1"],
        eight((place) => spelled[place] ?? ""),
      ),
    ];
    // The reference's one closed task is retained, so the frontier is the seven it left open; of
    // those the new harness closed five.
    expect(supplyOf(stepped)).toMatchObject({ held: 7, untied: 1 });
    expect(supplyOf(stepped, "h1").untied).toBeCloseTo(2 / 7, 10);
    // `latest` is the harness the last whole session left. One that comparison did not solve has
    // no record in it.
    const built = event("build.finished", {
      session: "b-1",
      changed: true,
      harness: "h1",
      ended: "finished",
    });
    expect(supplyOf([built, ...stepped], "latest").untied).toBeCloseTo(2 / 7, 10);
    // A harness no comparison read has no share on record, and every task counts.
    expect(supplyOf(stepped, "h9").untied).toBeNull();
    // The campaign's reference harness is the starter until one is promoted, and that one after.
    expect(supplyOf(stepped, "promoted")).toMatchObject({ held: 7, untied: 1 });
    const promotion = event("harness.promoted", { harness: "h1", from: "h0", rests: [] });
    expect(supplyOf([...stepped, promotion], "promoted")).toMatchObject({ held: 2, untied: 1 });
    expect(supplyOf([...stepped, promotion])).toMatchObject({ held: 2, untied: 1 });
  });

  it("takes the share from the reference's last comparison, whatever harness it reads", () => {
    // recode-151 (15 October): g-3 and g-4 each read a harness no comparison had set beside the
    // reference, were admitted on a share of every task, and read nothing for $5.57 over 2.19 h.
    const control = roundLogged(
      "c-1",
      ["h0", "p1"],
      eight((place) => ["PP PP", "PP PF"][place] ?? "FF FF"),
    );
    const log = [...EIGHT.flatMap(heldOut), ...control];
    // Either side of it: the reference closed two tasks, one retired and one retained (`poolOf`),
    // and the six left may be won, the ones nobody answered among them.
    expect(supplyOf(log, "p1")).toMatchObject({ held: 6, untied: 1 });
    expect(supplyOf(log, "h0")).toMatchObject({ held: 6, untied: 1 });
    const pair = roundLogged(
      "c-2",
      ["p1", "h1"],
      eight((place) => ["PP PP", "PF PP"][place] ?? "FF PP"),
    );
    // Its last comparison is the reference's share, whatever the harness a command reads beside it:
    // until 15 October one never set beside it had none, and every task counted.
    expect(supplyOf([...log, ...pair], "p1")).toMatchObject({ held: 6, untied: 1 });
    expect(supplyOf([...log, ...pair], "h1").untied).toBe(0);
    const later = roundLogged(
      "c-3",
      ["h0", "p1"],
      eight(() => "FF FF"),
    );
    expect(supplyOf([...log, ...pair, ...later], "p1")).toMatchObject({ held: 8, untied: 1 });
  });

  it("reads no comparison the reference stood on neither side of, where no harness is named beside it", () => {
    // The stack review (12 October): a control of two other harnesses after a promotion read
    // every task untied, and the decision table built where it should have asked for tasks.
    const log = [
      ...EIGHT.flatMap(heldOut),
      ...roundLogged(
        "g-1",
        ["h0", "h1"],
        eight((place) => (place === 7 ? "FF FF" : "FF PP")),
      ),
      event("harness.promoted", { harness: "h1", from: "h0", rests: [] }),
    ];
    // The control's own new harness answers the one task nobody had, which so waits for no label.
    const control = roundLogged(
      "c-1",
      ["h0", "p1"],
      eight((place) => (place === 7 ? "FF PF" : "FF FF")),
    );
    // The promoted harness closed seven, retained three of them and retired four (`poolOf`): one
    // task is left to win, short of what a first reading takes.
    for (const events of [log, [...log, ...control]]) {
      expect(supplyOf(events)).toMatchObject({ held: 1, untied: 1 });
      expect(codes(supplyOf(events), { target: 8 })).toEqual(["held-short", "unread"]);
    }
  });

  it("counts as held out since only the tasks held out after that comparison, not the ones it did not draw", () => {
    // The one task the reference closed is retained, and the frontier holds none.
    const before = [...heldOut("v"), ...roundLogged("b-1", ["h0", "h1"], { v: "PP PP" })];
    expect(supplyOf(before)).toMatchObject({ held: 0, untied: null, since: 0 });
    expect(supplyOf([...before, ...heldOut("w"), ...heldOut("x")])).toMatchObject({ held: 2, since: 2 });
    // esp32 (12 October): five tasks an earlier comparison had tied, with the reference valid in
    // every solve, were counted whole as held out since, and the supply read 4.6 untied of 12.
    const tied = (tasks: readonly string[]) => Object.fromEntries(tasks.map((task) => [task, "PP PP"]));
    const first = Array.from({ length: 12 }, (_, at) => `t${String(at + 1)}`);
    const written = ["t13", "t14", "t15", "t16", "t17"];
    const log = [
      ...first.flatMap(heldOut),
      ...roundLogged("g-1", ["h0", "h1"], tied(first)),
      ...written.flatMap(heldOut),
      ...roundLogged("g-2", ["h0", "h2"], tied([...written, ...first.slice(0, 7)])),
      ...heldOut("t18"),
    ];
    const supply = supplyOf(log);
    // The tied tasks are retired or retained (`poolOf`), and the one held out since is the frontier.
    expect(supply).toMatchObject({ held: 1, untied: null, since: 1 });
    expect(codes(supply)).toEqual(["held-short", "unread"]);
  });

  it("takes the share over the tasks that may still be scored, once the reference's closed ones retire", () => {
    // The stack review (12 October): two comparisons in which the reference answered a to d in
    // every solve and e and f in one of two retire two of a to d, by the contract's hash. Of the
    // four left two are untied, which a first reading at the trigger needs; the share over all six
    // read a third, and the comparison was refused.
    const twice = { a: "PP PP", b: "PP PP", c: "PP PP", d: "PP PP", e: "PF PP", f: "PF PP" };
    const log = [
      event("checker.read", { contract: "c", checks: "k", faults: [] }),
      ...Object.keys(twice).flatMap(heldOut),
      ...roundLogged("g-1", ["h0", "h1"], twice),
      ...roundLogged("g-2", ["h0", "h2"], twice),
    ];
    const supply = supplyOf(log);
    expect(supply).toMatchObject({ held: 2, exhausted: 2, untied: 1, since: 0 });
    expect(codes(supply, { target: 4 })).toEqual([]);
  });

  it("counts a task the objective still separates as untied, though the reference answered it in every solve", () => {
    // Both sides answer every task in every solve: closed on validity alone. On `a` the new
    // harness's answers measure the better by more than the margin, so the next harness can still
    // win it, as `exhausted` spares it. Until 12 October the supply read validity alone: 0 untied
    // here, and the comparison refused.
    const { events, terms } = roundSolves(
      "o-1",
      ["h0", "h1"],
      eight(() => "PP PP"),
    );
    const starts = events.flatMap(({ kind, data }) =>
      kind === "solve.started" && isString(data.solve) ? [data.solve] : [],
    );
    // Task a's four solves come first: the old harness's two, then the new's.
    const measures = [10, 10, 5, 5];
    const verdicts = starts
      .slice(0, 4)
      .map((solve, at) =>
        event("verdict", { solve, kind: "pass", answer: {}, objective: measures[at] ?? 0 }),
      );
    const log = [
      ...EIGHT.flatMap(heldOut),
      ...events,
      ...verdicts,
      reported("o-1", {
        old: "h0",
        fresh: "h1",
        starter: "h0",
        scored: { wins: 1, losses: 0, ties: 7 },
        ...terms,
        objective: { direction: "lower", margin: 0.01 },
      }),
    ];
    expect(supplyOf(log)).toMatchObject({ held: 1, untied: 1 });
  });
});

describe("what the gate refuses, by its code", () => {
  const whys = (supply: Supply, asked: Partial<Wanted> = {}) =>
    refusals(supply, { ...WANTED, ...asked }).map(({ why }) => why);

  it("no-held: a log with no held-out task to score", () => {
    expect(refusals({ ...SETS, held: 0, released: 0 }, WANTED)).toEqual([
      { code: "no-held", why: expect.stringContaining("holds no held-out task") },
    ]);
    expect(codes(SETS)).toEqual([]);
  });

  // As exam-1 stood on 2026-10-08, with one task to score. It was a note then, and eight rounds ran.
  it("held-short: fewer tasks than a first reading takes, which could not buy a repeat", () => {
    // Since 10 October a first reading at or under the trigger buys the repeat, and 2-0 clears
    // 0.25: one task cannot, where three could not read a step at 0.10 before.
    expect(refusals({ ...SETS, held: 1 }, WANTED)).toEqual([
      {
        code: "held-short",
        why: "1 held-out task can be scored, and at --trigger 0.25 a first reading takes 2, all won: this comparison cannot buy a repeat. Run an Examiner session (tools/d1b/examine.ts) for more held-out tasks",
      },
    ]);
    expect(whys(SETS, { target: 1 })).toEqual([
      expect.stringContaining("and ask for a --target of 2 or more"),
    ]);
    expect(whys({ ...SETS, held: 3 }, { trigger: 0.1 })).toEqual([
      expect.stringContaining("a first reading takes 4"),
    ]);
    expect(codes({ ...SETS, held: 2 })).toEqual([]);
  });

  it("untied-short: the campaign's own tie share leaves too few untied tasks", () => {
    // The last comparison left a tenth of its tasks untied. Twelve then leave about one, where a
    // first reading takes two (a quarter, three, was too few at 0.10 until 10 October).
    const tied = { ...SETS, held: 12, untied: 0.1 };
    expect(refusals(tied, WANTED)).toEqual([
      {
        code: "untied-short",
        why: "the campaign's last comparison left 10% of its tasks for this one to untie: the rest tied there, or this one's reference harness was valid on them in every solve. At that share 12 scored tasks leave about 1.2 untied, where at --trigger 0.25 a first reading takes 2, all won: this comparison could hardly buy a repeat. Run an Examiner session (tools/d1b/examine.ts) for more held-out tasks, or change the budget so that fewer tasks tie",
      },
    ]);
    expect(codes({ ...tied, untied: 0.25 })).toEqual([]);
    expect(codes({ ...tied, untied: null })).toEqual([]);
    // A task held out since that comparison has no share on record and is counted whole. A round
    // that tied nine of nine left no later one able to start, whatever an Examiner session added.
    const allTied = { ...tied, untied: 0 };
    expect(whys({ ...allTied, since: 1 })).toEqual([
      expect.stringContaining("12 scored tasks, the 1 held out since counted whole, leave about 1.0 untied"),
    ]);
    expect(codes({ ...allTied, since: 2 })).toEqual([]);
  });

  it("unread: a checker nobody has read, for a comparison and for a session with practice to judge", () => {
    // The reading was made late and by hand in the first live rounds, after the solves were paid.
    expect(refusals({ ...SETS, faults: null }, WANTED)).toEqual([
      {
        code: "unread",
        why: expect.stringContaining("the campaign's checker has never been read: run tools/c/accept.ts"),
      },
    ]);
    // One read with faults and not frozen is said, and refuses nothing.
    expect(codes({ ...SETS, faults: 35 })).toEqual([]);
    const released = [...heldOut("p1"), event("task.state", { version: "p1", state: "released" })];
    expect(() => admitSession(logOf(released), SESSION)).toThrow(
      "the campaign's checker has never been read: run tools/c/accept.ts, which puts every control and the do-nothing answer to the checks and says what each check has been seen to do. A practice solve is judged by the same checks",
    );
    // With nothing to practise on, no check judges anything of the session.
    expect(admitSession(four(), SESSION).at(-1)).toBe(
      "no task is released: the Builder has nothing to practise on",
    );
  });

  // The plan stops a campaign after as many moves as its patience that could have shown a gain and
  // showed none. Until 2026-10-09 four commands printed that reading and none acted on it.
  it("stopped: a campaign past its patience, unless the operator says why it goes on", () => {
    const stopped = { ...SETS, stop: { checkpoints: 3, sinceStep: 3, stop: true } };
    expect(refusals(stopped, WANTED)).toEqual([
      {
        code: "stopped",
        why: 'the campaign has had 3 moves that could have shown a gain since its last step, and none did: its patience is spent (docs/plan.md, row F48; --patience). To go on all the same, pass --past-stop "<why>", which is logged',
      },
    ]);
    expect(codes(stopped, { pastStop: "the budget was set anew" })).toEqual([]);
    // A session is refused the same way, and goes on the same way with its reason said.
    const log = four(STOPPED);
    expect(() => admitSession(log, SESSION)).toThrow("its patience is spent");
    const past = { ...SESSION, wanted: { ...SESSION.wanted, pastStop: "a new budget" } };
    expect(admitSession(log, past).at(-1)).toBe(`${PAST}: a new budget`);
  });

  it("no-cap: a comparison or a session with no dollar cap", () => {
    const log = four([READ]);
    expect(() => admitComparison(log, { ...ASKED, wanted: { ...WANTED, cap: null } })).toThrow(
      "no --cap is named: a comparison is launched under a dollar cap, and one the cap cuts short reads not-scored",
    );
    // Typed, so that a led Builder reads the admission's reason and no other error's (14 October).
    expect(() => admitComparison(log, { ...ASKED, wanted: { ...WANTED, cap: null } })).toThrow(Refused);
    expect(() => admitSession(log, { ...SESSION, wanted: { cap: null } })).toThrow(
      "no --cap is named: a session is launched under a dollar cap, and no practice solve starts that a reserve for it would take past the cap",
    );
  });

  it("unrecorded: a first record of the setting that is another than the log's solves ran under", () => {
    const why = "the campaign's log records no setting yet, and this command names another";
    const log = four([READ]);
    expect(() => admitComparison(log, { ...ASKED, wanted: { ...WANTED, unrecorded: why } })).toThrow(why);
    expect(() => admitSession(log, { ...SESSION, wanted: { ...SESSION.wanted, unrecorded: why } })).toThrow(
      why,
    );
  });
});

describe("what a start's reader is told", () => {
  it("says the sets and the size, and what the cap, the checker, the labels and the practice leave open", () => {
    const sets = "4 held out · 0 released for practice · 4 to score";
    const unreleased = "no task is released: the Builder has nothing to practise on";
    expect(admitComparison(four([READ]), ASKED)).toEqual([sets, ...sizeLines(4, WANTED), unreleased]);
    const told = (more: readonly LogEvent[], wanted: Partial<Wanted> = {}) =>
      admitComparison(four(more), { ...ASKED, wanted: { ...WANTED, ...wanted } });
    expect(told([READ], { builds: false }).join("\n")).not.toContain("practise");
    // A target caps the scored set as few held-out tasks do.
    expect(told([READ], { target: 3 })[0]).toBe("4 held out · 0 released for practice · 3 to score");
    // Four tasks, two harnesses, two solves: sixteen solves, and a cap of $120 reserves twelve.
    expect(told([READ], { cap: { dollars: 120, reserve: 10 } }).at(-1)).toBe(
      "the cap of $120 holds a reserve of $10 for 12 solves, and the comparison's test alone makes 16, after a session whose spend the same cap holds: it is cut short and reads not-scored unless its solves bill well under their reserve",
    );
    expect(told([READ], { cap: { dollars: 160, reserve: 10 } }).join("\n")).not.toContain("holds a reserve");
    // A checker read with faults and not frozen is said until the operator freezes it.
    const faulty = event("checker.read", { contract: "c", checks: "k", faults: ["one", "two"] });
    expect(told([faulty])).toContain(
      "the checker's last reading holds 2 fault(s) and the operator has not frozen it: a rejection here may be the check's own (tools/c/accept.ts)",
    );
    const frozen = event("contract.frozen", { contract: "c", checks: "k" });
    expect(told([faulty, frozen]).join("\n")).not.toContain("fault");
    // The tasks left out of the scored set are said: the ones the reference closed.
    const twice = { a: "PP PP", b: "PP PP", c: "PP PP", d: "PP PP", e: "PF PP", f: "PF PP" };
    const retired = logOf([
      READ,
      ...Object.keys(twice).flatMap(heldOut),
      ...roundLogged("g-1", ["h0", "h1"], twice),
      ...roundLogged("g-2", ["h0", "h2"], twice),
    ]);
    expect(admitComparison(retired, { ...ASKED, id: "g-3", wanted: { ...WANTED, target: 4 } })).toContain(
      "2 held-out task(s) were answered by the reference harness in every solve of their last comparison, with no objective telling two valid answers apart, and are not scored: they can only tie again or be lost",
    );
    // A session with no comparison after it scores nothing, and is told what it may practise on.
    const released = [READ, ...heldOut("p1"), event("task.state", { version: "p1", state: "released" })];
    const alone =
      "1 released for practice · no comparison follows this session: tools/d2/checkpoint.ts compares what the campaign's sessions leave";
    const session = (practiceSolves: number) =>
      admitSession(logOf(released), {
        ...SESSION,
        wanted: { cap: { dollars: 150, reserve: 10 }, practiceSolves },
      });
    expect(admitSession(logOf(released), SESSION)).toEqual([alone]);
    expect(session(15)).toEqual([alone]);
    expect(session(24)).toEqual([
      alone,
      "the cap of $150 holds a reserve of $10 for 15 practice solves, and the session's limit is 24: the Builder is told the fewer, which falls by less than one a solve while solves bill under their reserve",
    ]);
  });
});

describe("a command about to start", () => {
  it("is refused as a launch of it would be, every refusal at once, unless it is a rehearsal or has begun", () => {
    const log = four();
    expect(() => admitComparison(log, ASKED)).toThrow(
      "the campaign's checker has never been read: run tools/c/accept.ts",
    );
    expect(() => admitComparison(log, { ...ASKED, wanted: { ...WANTED, cap: null } })).toThrow(
      /no --cap is named[^]*checker has never been read/,
    );
    // A rehearsal is exempt by name: a script is paid nothing, and walks any path.
    expect(admitComparison(log, { ...ASKED, seats: "scripted" })).toEqual([]);
    expect(admitSession(log, { ...SESSION, seats: "scripted" })).toEqual([]);
    // One the log holds the start of goes on: it was admitted when it began. Another id's start
    // admits nothing for this one.
    const begun = four([event("comparison.started", { session: "g-1" })]);
    expect(admitComparison(begun, ASKED)).toEqual([]);
    expect(() => admitComparison(begun, { ...ASKED, id: "g-2" })).toThrow("never been read");
    // Fix row F42: a session that ran by itself left a start under its id, and until 2026-10-09 a
    // round started by hand under that id compared with no check, on an unread checker. The
    // session itself goes on from its own start, and a comparison's start admits no session.
    const alone = four([
      event("build.started", { session: "b-2" }),
      event("build.finished", { session: "b-2", ended: "finished" }),
    ]);
    expect(() => admitComparison(alone, { ...ASKED, id: "b-2" })).toThrow("never been read");
    expect(admitSession(alone, SESSION)).toEqual([]);
    expect(admitSession(four([event("comparison.started", { session: "b-2" })]), SESSION)).not.toEqual([]);
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
    expect(() => admitComparison(four(), { ...ASKED, own })).toThrow("never been read");
    expect(asks).toEqual([]);
    // Past the stop rule on the operator's reason, refused terms leave no override in the log.
    const stopped = four(STOPPED);
    const past = { ...ASKED, id: "b-4", own, wanted: { ...WANTED, pastStop: "new tasks since" } };
    const before = read(stopped).length;
    expect(() => admitComparison(stopped, past)).toThrow("task t-9 is not proposed");
    expect(asks).toEqual(["own"]);
    expect(read(stopped)).toHaveLength(before);
    // A rehearsal is admitted unasked, and its own terms still hold it.
    expect(() => admitComparison(stopped, { ...past, seats: "scripted" })).toThrow("task t-9");
  });

  it("logs the operator's reason when it goes on past the stop rule, once", () => {
    const log = four(STOPPED);
    const fourth = { ...ASKED, id: "b-4" };
    expect(() => admitComparison(log, fourth)).toThrow("its patience is spent");
    expect(read(log).some(({ kind }) => kind === "stop.overridden")).toBe(false);
    const past = { ...fourth, wanted: { ...WANTED, pastStop: "new tasks since" } };
    expect(admitComparison(log, past).at(-1)).toBe(`${PAST}: new tasks since`);
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
