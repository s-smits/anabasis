// Whether a paid comparison may start is a fact of the campaign's log and of what the comparison
// asks for. One function decides it, and the launcher and the commands both ask that function: a
// command started by hand is refused where a launch of it would be.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  admitComparison,
  admitSession,
  Refused,
  refusals,
  type Supply,
  supplyOf,
  type Wanted,
} from "../src/campaign/admission.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { sizeLines } from "../src/kernel/size.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { roundSolves } from "./helpers/logged-round.ts";

const CLOSED = { a: "PP PP", b: "PP PP", c: "PP PP", d: "PP PP", e: "PF PP", f: "PF PP" };
const AT = "2026-10-09T00:00:00.000Z";
/** Eight held-out tasks, and each one's outcomes as `spell` gives them by its place. */
const EIGHT = ["a", "b", "c", "d", "e", "f", "g", "h"];
const GOING = { checkpoints: 0, sinceStep: 0, stop: false };
/** A campaign whose checker was read with no fault and is not frozen, before any comparison. */
const SETS: Supply = {
  held: 6,
  awaiting: 0,
  exhausted: 0,
  released: 1,
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
};
const LIMITS = {
  wallSeconds: 7200,
  turns: 24,
  shellDefaultSeconds: 300,
  shellMaxSeconds: 900,
  concurrency: 4,
};
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const heldOut = (version: string): LogEvent[] => [
  event("task.proposed", { version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
const reported = (session: string, more: JsonObject) => event("comparison.reported", { session, ...more });
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
/** Six held-out tasks, with whatever `more` adds. */
const six = (more: readonly LogEvent[] = []) =>
  logOf([...["v1", "v2", "v3", "v4", "v5", "v6"].flatMap(heldOut), ...more]);
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
const closed = [
  READ,
  ...Object.keys(CLOSED).flatMap(heldOut),
  ...roundLogged("g-1", ["h0", "h1"], CLOSED),
  ...roundLogged("g-2", ["h0", "h2"], CLOSED),
];
const released = [...heldOut("p1"), event("task.state", { version: "p1", state: "released" })];
let checked = "";
let unchecked = "";
let practice = "";
beforeAll(() => {
  checked = six([READ]);
  unchecked = six();
  practice = logOf([READ, ...released]);
});

describe("what a log holds for the next comparison", () => {
  it("counts the frontier: the reference's closed tasks and, after a promotion, those it never stood in are read apart", () => {
    // After a step read 7-0-4 the harness that won was valid in every solve on 8 of the 11 tasks,
    // so a round made against it had 3 to win where the tally said 7 (2026-10-09). The frontier
    // leaves out what the reference closed, which the untied share read a second time until
    // 16 October.
    const spelled = ["PP PP", "PF PP", "FF PP", "FF PP", "FF PP", "FF PP", "FF PF", "FF FF"];
    const stepped = [
      ...EIGHT.flatMap(heldOut),
      ...roundLogged(
        "g-1",
        ["h0", "h1"],
        Object.fromEntries(EIGHT.map((task, place) => [task, spelled[place] ?? ""])),
      ),
    ];
    // The reference's one closed task is retained, so the frontier is the seven it left open.
    expect(supplyOf(stepped)).toMatchObject({ held: 7 });
    // Once h1 is promoted it closed five of them, and is left two.
    const promotion = event("harness.promoted", { harness: "h1", from: "h0", rests: [] });
    expect(supplyOf([...stepped, promotion])).toMatchObject({ held: 2 });
  });

  it("counts the tasks that may still be scored, once the reference's closed ones retire", () => {
    // The stack review (12 October): two comparisons in which the reference answered a to d in
    // every solve and e and f in one of two close a to d, which stay as retained tasks: two are
    // left on the frontier, where a step at 0.10 takes four, and at 0.25 two. Until 16 October two
    // of the four left the draw by the contract's hash.
    const supply = supplyOf(closed);
    expect(supply).toMatchObject({ held: 2, exhausted: 4 });
    for (const level of [0.1, 0.25]) {
      expect(codes(supply, { target: 4, level })).toEqual(["held-short"]);
    }
  });
});

describe("what the gate refuses, by its code", () => {
  it("held-short: leaves room for one set-aside task and one tie before a paid comparison starts", () => {
    const wanted = { ...WANTED, level: 0.02 };
    for (const held of [6, 7, 8]) {
      const log = logOf([READ, ...EIGHT.slice(0, held).flatMap(heldOut)]);
      if (held < 8) {
        expect(codes(supplyOf(read(log)), wanted)).toEqual(["held-short"]);
        expect(() => admitComparison(log, { ...ASKED, wanted })).toThrow(Refused);
      } else {
        expect(codes(supplyOf(read(log)), wanted)).toEqual([]);
        expect(admitComparison(log, { ...ASKED, wanted })[0]).toMatch(/^8\D+0\D+8\D*$/);
      }
    }
    expect(codes({ ...SETS, held: 8 }, { ...wanted, target: 6 })).toEqual(["held-short"]);
  });

  it("no-held: a log with no held-out task to score", () => {
    expect(codes({ ...SETS, held: 0, released: 0 })).toEqual(["no-held"]);
    expect(codes(SETS)).toEqual([]);
  });

  it("unread: a checker nobody has read, for a comparison and for a session with practice to judge", () => {
    expect(codes({ ...SETS, faults: null })).toEqual(["unread"]);
    // One read with faults and not frozen is said, and refuses nothing.
    expect(codes({ ...SETS, faults: 35 })).toEqual([]);
    expect(() => admitSession(logOf(released), SESSION)).toThrow(Refused);
    expect(admitSession(unchecked, SESSION)).toHaveLength(2);
    expect(admitSession(unchecked, SESSION).at(-1)).toContain("no task");
    expect(supplyOf(read(unchecked)).released).toBe(0);
  });

  // The plan stops a campaign after as many moves as its patience that could have shown a gain and
  // showed none. Until 2026-10-09 four commands printed that reading and none acted on it.
  it("stopped: a campaign past its patience, unless the operator says why it goes on", () => {
    const stopped = { ...SETS, stop: { checkpoints: 3, sinceStep: 3, stop: true } };
    expect(codes(stopped)).toEqual(["stopped"]);
    expect(refusals(stopped, WANTED)[0]?.why.match(/\d+/g)).toEqual(["3"]);
    expect(codes(stopped, { pastStop: "the budget was set anew" })).toEqual([]);
    // A session is refused the same way, and goes on the same way with its reason said.
    const log = six(STOPPED);
    expect(() => admitSession(log, SESSION)).toThrow(Refused);
    const past = { ...SESSION, wanted: { ...SESSION.wanted, pastStop: "a new budget" } };
    expect(admitSession(log, past).at(-1)).toMatch(/\b3\b.*a new budget/);
    admitSession(log, past);
    expect(
      read(log)
        .filter(({ kind }) => kind === "stop.overridden")
        .map(({ data }) => data),
    ).toEqual([{ session: "b-2", reason: "a new budget", checkpoints: 3, sinceStep: 3 }]);
  });
});

describe("what a start's reader is told", () => {
  it("says the sets and the size, and what the cap, the checker, the labels and the practice leave open", () => {
    const notes = admitComparison(checked, ASKED);
    expect(notes[0]).toMatch(/^6\D+0\D+6\D*$/);
    expect(notes.slice(1, -1)).toEqual(sizeLines(6, WANTED));
    expect(notes).toHaveLength(sizeLines(6, WANTED).length + 2);
    const told = (wanted: Partial<Wanted> = {}) =>
      admitComparison(checked, { ...ASKED, wanted: { ...WANTED, ...wanted } });
    expect(told({ builds: false })).toHaveLength(notes.length - 1);
    expect(told({ target: 4, level: 0.25 })[0]).toMatch(/^6\D+0\D+4\D*$/);
    const cap = told({ cap: { dollars: 120, reserve: 10 } }).at(-1);
    expect(cap?.match(/\d+/g)).toEqual(["120", "10", "12", "24"]);
    expect(cap).toContain("not-scored");
    expect(told({ cap: { dollars: 240, reserve: 10 } })).toEqual(notes);
    const faulty = event("checker.read", { contract: "c", checks: "k", faults: ["one", "two"] });
    const frozen = event("contract.frozen", { contract: "c", checks: "k" });
    for (const [extra, isFrozen, warningCounts] of [
      [[faulty], false, [["2"]]],
      [[faulty, frozen], true, []],
    ] as const) {
      const log = six(extra);
      expect(supplyOf(read(log))).toMatchObject({ faults: 2, frozen: isFrozen });
      const said = admitComparison(log, ASKED);
      expect(said.slice(0, notes.length)).toEqual(notes);
      expect<readonly (readonly string[] | null)[]>(
        said.slice(notes.length).map((line) => line.match(/\d+/g)),
      ).toEqual(warningCounts);
    }
    const retired = logOf([...closed, ...["g", "h"].flatMap(heldOut)]);
    expect(supplyOf(read(retired)).exhausted).toBe(4);
    const retained = admitComparison(retired, {
      ...ASKED,
      id: "g-3",
      wanted: { ...WANTED, target: 4, level: 0.25 },
    }).find((line) => line.includes("retained"));
    expect(retained?.match(/\d+/g)).toEqual(["4"]);
    const alone = admitSession(practice, SESSION);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatch(/^1\b/);
    expect(alone[0]).toContain("tools/d2/checkpoint.ts");
    for (const [practiceSolves, warningCounts] of [
      [15, []],
      [24, [["150", "10", "15", "24"]]],
    ] as const) {
      const said = admitSession(practice, {
        ...SESSION,
        wanted: { cap: { dollars: 150, reserve: 10 }, practiceSolves },
      });
      expect(said[0]).toBe(alone[0]);
      expect<readonly (readonly string[] | null)[]>(said.slice(1).map((line) => line.match(/\d+/g))).toEqual(
        warningCounts,
      );
    }
  });
});

describe("a command about to start", () => {
  it("is refused as a launch of it would be, every refusal at once, unless it is a rehearsal or has begun", () => {
    const log = unchecked;
    expect(() => admitComparison(log, ASKED)).toThrow(Refused);
    expect(() => admitComparison(log, { ...ASKED, wanted: { ...WANTED, cap: null } })).toThrow(
      /--cap[^]*tools\/c\/accept\.ts/,
    );
    // A rehearsal is exempt by name: a script is paid nothing, and walks any path.
    expect(admitComparison(log, { ...ASKED, seats: "scripted" })).toEqual([]);
    expect(admitSession(log, { ...SESSION, seats: "scripted" })).toEqual([]);
    // One the log holds the start of goes on: it was admitted when it began. Another id's start
    // admits nothing for this one.
    const begun = six([event("comparison.started", { session: "g-1" })]);
    expect(admitComparison(begun, ASKED)).toEqual([]);
    expect(() => admitComparison(begun, { ...ASKED, id: "g-2" })).toThrow(Refused);
    // Fix row F42: a session that ran by itself left a start under its id, and until 2026-10-09 a
    // round started by hand under that id compared with no check, on an unread checker. The
    // session itself goes on from its own start, and a comparison's start admits no session.
    const alone = six([
      event("build.started", { session: "b-2" }),
      event("build.finished", { session: "b-2", ended: "finished" }),
    ]);
    expect(() => admitComparison(alone, { ...ASKED, id: "b-2" })).toThrow(Refused);
    expect(admitSession(alone, SESSION)).toEqual([]);
    expect(admitSession(six([event("comparison.started", { session: "b-2" })]), SESSION)).not.toEqual([]);
  });
});
