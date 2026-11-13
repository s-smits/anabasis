// What a look says of each new event of a run, and the step that event leaves owed.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { leftOut, pulse as pulseOf } from "../tools/runs/pulse.ts";
import { overview } from "../tools/wri/read.ts";
import type { Run } from "../tools/runs/registry.ts";
import { chainLog, objectiveLog } from "./helpers/starter-chain.ts";

const round: Run = { name: "r1", tree: "/wt", path: "/wt/.ana/d2/r1/log.jsonl", end: "comparison.reported" };
/** A run the investigation's trigger is never read on: one solve, which climbs nothing. */
const lone: Run = { ...round, end: "solve.finished" };
/** A run a process writes, and one nothing writes or keeps. */
const OPEN = { writing: true, kept: false };
const CLOSED = { writing: false, kept: false };
const START = Date.parse("2026-10-08T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A minute after every event of the chain's fixture, so that no look reads it as quiet. */
const CHAINED = Date.parse("2026-10-30T00:01:00Z");
const event = (minute: number, kind: EventKind, data: JsonObject): LogEvent => ({
  at: new Date(START + minute * MINUTE).toISOString(),
  kind,
  data,
});
/** What a look that read `lines` events of an open run remembers. */
const lookedAt = (lines: number) => ({ lines, open: true, quiet: false });

const built = [event(0, "build.started", { session: "r1-b" })];
/** A look that reads the investigation's triggers in this process, as `wri.ts read` would print them,
 *  as the look does each time the readers' rows move. */
const pulse = (
  run: Run,
  log: readonly LogEvent[],
  process: "open" | "closed",
  before: Parameters<typeof pulseOf>[3],
  now: number,
) => pulseOf(run, log, process === "open" ? OPEN : CLOSED, before, { now, alarms: overview(log).triggers });
/** The index of the `nth` event of `kind` in `log`. */
const nthOf = (log: readonly LogEvent[], kind: EventKind, nth: number) =>
  log.flatMap((each, index) => (each.kind === kind ? [index] : []))[nth] ?? -1;

describe("the runs pulse", () => {
  it("reports missing processes and each session's own ending", () => {
    const gone = pulse(round, built, "closed", lookedAt(built.length), START + 5 * MINUTE);
    expect(gone.status).toMatch(/^r1\s+closed/);
    expect(gone.said).toHaveLength(1);
    expect(gone.said[0]).toMatch(/^⚠.*comparison[.]reported/);
    const reported = [...built, event(5, "comparison.reported", { reading: "held" })];
    const done = pulse(round, reported, "closed", lookedAt(built.length), START + 6 * MINUTE);
    expect(done.status).toMatch(/^r1\s+closed.*held/);
    expect(done.said).toHaveLength(1);
    expect(done.said[0]).toMatch(/^◆.*held/);
    const examining = [...reported, event(6, "exam.started", { session: "x-1" })];
    const seen = lookedAt(examining.length);
    expect(pulse(round, examining, "closed", seen, START).said[0]).toMatch(/^⚠.*exam[.]finished/);
    const examined = [...examining, event(7, "exam.finished", { session: "x-1", ended: "finished" })];
    const finished = pulse(round, examined, "closed", seen, START).said;
    expect(finished).toEqual(["◆ exam x-1 ended"]);
    const waited = [
      ...examined,
      event(8, "campaign.waited", { task: "t-1", load: 40, cores: 12, ms: 60_000 }),
      event(9, "campaign.waited", { for: "provider", until: "2026-10-15T21:00:00.000Z", ms: 7_200_000 }),
      event(10, "campaign.ended", { ending: "finished", why: "3 conversations in a row made no move" }),
    ];
    const said = pulse(round, waited, "closed", lookedAt(examined.length), START + 11 * MINUTE).said;
    expect(said).toHaveLength(2);
    for (const fact of ["⚠", "120m", "provider", "2026-10-15T21:00:00.000Z"]) expect(said[0]).toContain(fact);
    for (const fact of ["◆", "finished", "3 conversations in a row made no move"]) {
      expect(said[1]).toContain(fact);
    }
  });

  it("warns of each kind of non-result once with its repeats, and of no other solve", () => {
    const finished = (solve: string, ending: JsonObject) => event(1, "solve.finished", { solve, ending });
    const killed = { outcome: "non-result", kind: "killed", reason: "the solve was cancelled" };
    const log = [
      ...built,
      event(1, "solve.started", { solve: "s-1", task: "ex-001" }),
      event(1, "solve.started", { solve: "s-2", task: "ex-002" }),
      finished("s-1", { outcome: "pass" }),
      finished("s-2", { outcome: "fail" }),
      finished("s-3", { outcome: "flagged", reason: "the task asks two things" }),
      finished("s-4", { ...killed, cancelledBy: "admission" }),
      finished("s-5", { ...killed, cancelledBy: "caller" }),
      finished("s-6", { ...killed, cancelledBy: "caller" }),
    ];
    expect(pulse(round, log, "open", lookedAt(1), START).said).toEqual([
      "⚠ a solve ended without a result, killed: the solve was cancelled (×2)",
    ]);
  });

  it("warns of solves that waited on the load for over a quarter of an hour", () => {
    const waited = (ms: number, load: number) =>
      event(1, "campaign.waited", { task: "t-1", load, cores: 4, ms });
    const log = [...built, waited(60_000, 5), waited(20 * 60_000, 6.5), waited(30 * 60_000, 7)];
    expect(pulse(round, log, "open", lookedAt(1), START + 2 * MINUTE).said).toEqual([
      "⚠ 2 solves waited over 15m for the load, the longest 30m at load 7.0 on 4 cores",
    ]);
    expect(pulse(round, log.slice(0, 2), "open", lookedAt(1), START + 2 * MINUTE).said).toEqual([]);
  });

  it("reads a campaign the Builder leads as done only at its ending", () => {
    const examined = [
      event(0, "campaign.opened", { project: "p" }),
      event(1, "exam.started", { session: "x-1" }),
      event(2, "exam.finished", { session: "x-1", ended: "finished" }),
    ];
    const seen = lookedAt(examined.length);
    const gone = pulse(round, examined, "closed", seen, START + 3 * MINUTE).said;
    expect(gone).toEqual(["⚠ the process is gone before campaign.ended"]);
    const ended = [...examined, event(3, "campaign.ended", { ending: "budget", why: "spent" })];
    expect(pulse(round, ended, "closed", seen, START + 4 * MINUTE).said).toEqual([
      "◆ the campaign ended budget: spent",
    ]);
  });

  it("warns of turns another model served than their seat asked for, and of no others", () => {
    const turn = (minute: number, kind: EventKind, id: JsonObject, responseModel: string) =>
      event(minute, kind, { ...id, turn: 1, responseModel, error: null });
    const log = [
      event(0, "exam.started", { session: "x-1", model: "claude/claude-opus-5-5" }),
      event(0, "solve.started", { solve: "s-1", model: "claude/claude-opus-5-5" }),
      turn(1, "exam.turn", { session: "x-1" }, "claude-opus-5"),
      turn(2, "solve.turn", { solve: "s-1" }, "claude-opus-5"),
      turn(3, "solve.turn", { solve: "s-1" }, "claude-opus-5-5-20261001"),
      turn(4, "referee.turn", { reader: "r-1" }, "claude-sonnet-5-5"),
    ];
    const said = pulse(round, log, "open", lookedAt(2), START + 5 * MINUTE).said;
    expect(said).toEqual(["⚠ 2 turns served by another model: claude-opus-5 for claude/claude-opus-5-5"]);
    expect(pulse(round, log, "open", lookedAt(4), START + 5 * MINUTE).said).toEqual([]);
  });

  it("reads a solve and a wait of a process gone before the last launch as over", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-runs-pulse-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const continued: Run = { ...round, tree: root, path: join(root, "r1", "log.jsonl") };
    mkdirSync(join(root, "r1"));
    const relaunched = new Date(START + 3 * MINUTE).toISOString();
    writeFileSync(join(root, "r1", "launch-run-2.json"), JSON.stringify({ at: relaunched }));
    const log = [
      ...built,
      event(1, "solve.started", { solve: "s-1-1", task: "t-1" }),
      event(2, "campaign.waited", { for: "provider", until: "2026-11-01T11:00:00.000Z", ms: 1 }),
      event(3, "build.finished", { session: "r1-b", ended: "killed" }),
      event(3, "build.started", { session: "r1-b2" }),
    ];
    const later = START + 25 * MINUTE;
    const now = pulse(continued, log, "open", lookedAt(log.length), later);
    expect(now.status).toContain("1 unfinished");
    expect(now.status).not.toContain("running");
    expect(now.said.some((line) => line.startsWith("⚠ quiet"))).toBe(true);
    // The same log with no launch kept: the solve and the wait are the writing process's.
    const kept = pulse(round, log, "open", lookedAt(log.length), later);
    expect(kept.status).toContain("1 running");
    expect(kept.said.some((line) => line.startsWith("⚠ quiet"))).toBe(false);
  });

  it("marks suspect reports and carries their reading and counts", () => {
    for (const [data, severity, facts] of [
      [{ reading: "no-step", aside: ["v1", "v2"] }, "⚠", ["no-step", "2"]],
      [{ reading: "not-scored", capped: true, aside: [] }, "⚠", ["not-scored", "cap"]],
      [
        { reading: "starter-unread", capped: true, scored: { wins: 4, losses: 0, ties: 0 }, aside: [] },
        "⚠",
        ["starter-unread", "cap", "test stands"],
      ],
      [{ reading: "step", aside: [] }, "◆", ["step"]],
      [
        { reading: "no-step", settled: { labelled: 3, defects: 2 } },
        "◆",
        ["no-step", "3 labelled", "2 a check defect"],
      ],
      [{ reading: "not-scored", unflagged: null }, "⚠", ["not-scored"]],
    ] satisfies [JsonObject, string, string[]][]) {
      const look = pulse(
        round,
        [...built, event(5, "comparison.reported", data)],
        "closed",
        lookedAt(built.length),
        START,
      );
      expect(look.said).toHaveLength(1);
      expect(look.said[0]).toStartWith(severity);
      for (const fact of facts) expect(look.said[0]).toContain(fact);
    }
  });

  it("says of a build's harness only what its event holds", () => {
    // A session a stop cut is ended on record by the host (`endCut`), whose event holds neither
    // `changed` nor `broken`; a session that ended itself writes both.
    for (const [data, line] of [
      [{ session: "r1-b", ended: "killed", crash: null }, "◆ build ended at killed"],
      [
        { session: "r1-b", ended: "finished", changed: false, broken: null },
        "◆ build ended at finished and left the harness as it was",
      ],
      [
        { session: "r1-b", ended: "wall", changed: true, broken: "no guide" },
        "◆ build ended at wall and changed the harness, broken: no guide",
      ],
    ] satisfies [JsonObject, string][]) {
      const look = pulse(
        round,
        [...built, event(5, "build.finished", data)],
        "closed",
        lookedAt(built.length),
        START,
      );
      expect(look.said[0]).toBe(line);
    }
  });

  it("reads a report in its factors, and marks one whose A/A cleared the level or whose supply is under the floor", () => {
    const report = (noise: JsonObject, informative: number) => ({
      reading: "no-step",
      tasks: 8,
      level: 0.02,
      aside: [],
      valid: { old: [0, 0, 8], fresh: [0, 0, 8], informative: { old: informative, fresh: 0 } },
      noise,
      worth: { bars: { cost: 3 }, cost: { attempts: 2, dollars: 40 } },
    });
    const said = (data: JsonObject) =>
      pulse(round, [...built, event(5, "comparison.reported", data)], "closed", lookedAt(1), START).said[0] ??
      "";
    const quiet = { differences: [1, -1, 0, 0, 0, 0, 0, 0], unbilled: [1, -1, 0, 0, 0, 0, 0, 0] };
    expect(said(report(quiet, 9))).toMatch(
      /^◆ reported no-step · supply 9 of 8 informative, floor 8 · A\/A 1-1-6 · attempt 2 of 3/,
    );
    // The A/A is read as a step is, on the scores without the bill, and in either direction.
    const swept = [-1, -1, -1, -1, -1, -1, -1, 0];
    expect(said(report({ differences: swept, unbilled: swept }, 9))).toMatch(
      /^⚠.*A\/A 0-7-1 cleared the level/,
    );
    const billOnly = { differences: [1, 1, 1, 1, 1, 1, 1, 0], unbilled: [0, 0, 0, 0, 0, 0, 0, 0] };
    expect(said(report(billOnly, 9))).toMatch(/^◆.*A\/A 0-0-8 ·/);
    expect(said(report(quiet, 0))).toMatch(/^⚠.*supply 0 of 8 informative, floor 8/);
    // Past the bar as the report's own `met` reads it: set-up's epoch meets it at any count.
    const costing = (attempts: number, met: boolean) => ({
      ...report(quiet, 9),
      worth: { bars: { cost: 3 }, cost: { attempts, dollars: 40, met } },
    });
    expect(said(costing(4, true))).toMatch(/^◆.*attempt 4 of 3/);
    expect(said(costing(4, false))).toMatch(/^⚠.*attempt 4 of 3/);
  });

  it("says an investigation alarm once when it fires or moves, and remembers the ones a first look found", () => {
    const crashed = (minute: number, session: string) =>
      event(minute, "exam.finished", { session, ended: "crashed" });
    const first = [...built, crashed(1, "x-1")];
    const baseline = pulse(round, first, "open", undefined, START + 2 * MINUTE);
    expect(baseline.said).toEqual([]);
    // A session the provider's limit ended is waited out, and is no alarm.
    const limit = event(2, "build.finished", {
      session: "b-9",
      ended: "crashed",
      crash: "You've hit your weekly limit · resets Oct 15 at 9pm (Europe/Amsterdam)",
    });
    const second = [...first, limit, crashed(2, "x-2")];
    const moved = pulse(round, second, "open", baseline.seen, START + 3 * MINUTE);
    expect(moved.said.filter((line) => line.includes("SESSION CRASHED"))).toEqual([
      "⚠ economy: SESSION CRASHED (lane 24): x-1, x-2",
    ]);
    const solved = [...second, event(3, "solve.started", { solve: "s-1", task: "t-1" })];
    const again = pulse(round, solved, "open", moved.seen, START + 4 * MINUTE);
    expect(again.said.some((line) => line.includes("SESSION CRASHED"))).toBe(false);
  });

  it("says only the new one of a trigger that fires once for each comparison", () => {
    const compared = (minute: number, session: string) => [
      event(minute, "comparison.started", { session, tasks: ["v-1", "v-2"] }),
      event(minute + 1, "comparison.reported", { session, reading: "no-step", versions: ["v-1"] }),
    ];
    const moved = (said: readonly string[]) => said.filter((line) => line.includes("SCORED SET MOVED"));
    const one = [...built, ...compared(1, "g-1")];
    const first = pulse(round, one, "open", undefined, START + 3 * MINUTE);
    const two = [...one, ...compared(3, "g-2")];
    const second = pulse(round, two, "open", first.seen, START + 5 * MINUTE);
    expect(moved(second.said)).toEqual([
      "⚠ honesty: SCORED SET MOVED (lane 5): g-2: 1 of 2 tasks it began with are not in its tally",
    ]);
    const grown = [...two, event(5, "build.started", { session: "b-2" })];
    expect(moved(pulse(round, grown, "open", second.seen, START + 6 * MINUTE).said)).toEqual([]);
  });

  it("says a promotion once in the climb's own line, counts it in the status, and leaves the unconfirmed trigger to that line", () => {
    const promoted = [
      ...built,
      event(5, "comparison.reported", { reading: "step" }),
      event(6, "harness.promoted", { harness: "0a1b2c3d4e5f", from: "starter", rests: "g1" }),
    ];
    const look = pulse(
      round,
      promoted,
      "open",
      { ...lookedAt(built.length), triggers: {} },
      START + 7 * MINUTE,
    );
    expect(look.said).toEqual([
      "◆ reported step",
      "◆ promotion 1, harness 0a1b2c3d; a pause should wait for its starter comparison, or it stays unconfirmed for good",
    ]);
    expect(look.status).toContain("1 promoted, 0 confirmed");
    expect(pulse(round, promoted, "open", look.seen, START + 8 * MINUTE).said).toEqual([]);
    expect(pulse(round, built, "open", undefined, START + 5 * MINUTE).status).not.toContain("promoted");
  });

  it("says a starter comparison under its report, and ready to pause with its command at the second read and not the first", () => {
    const log = chainLog("won");
    const said = (from: number, to: number) =>
      pulse(round, log.slice(0, to), "open", lookedAt(from), CHAINED).said;
    const first = nthOf(log, "harness.promoted", 0);
    expect(said(first, first + 1)).toEqual([
      "◆ promotion 1, harness bbbbbbbb; a pause should wait for its starter comparison, or it stays unconfirmed for good",
    ]);
    const read = nthOf(log, "comparison.reported", 1);
    const one = said(read, read + 1);
    expect(one).toHaveLength(2);
    expect(one[0]).toContain("reported no-step");
    // Seven tasks won again and three written since lost: no step for the reference, so one to look at.
    expect(one[1]).toStartWith(
      "  ⚠ starter comparison g-2 after promotion 1 (bbbbbbbb) read no step for the reference: won 7, lost 3, tied 0, not confirmed",
    );
    const second = said(log.length - 1, log.length);
    expect(second).toHaveLength(3);
    expect(second[1]).toStartWith(
      "  ◆ starter comparison g-4 after promotion 2 (cccccccc) read a step for the reference: won 10, lost 0, tied 0, confirmed",
    );
    expect(second[2]).toBe("  ⚠ ready to pause, 2 promotions read: bun run runs pause r1 --yes");
    // One look over the whole climb says each line once and in the log's order.
    const whole = said(first, log.length);
    const order = [
      "promotion 1,",
      "comparison g-2 after",
      "promotion 2,",
      "comparison g-4 after",
      "ready to pause",
    ];
    const found = order.map((part) => whole.findIndex((line) => line.includes(part)));
    expect(found).toEqual(found.toSorted((a, b) => a - b));
    expect(found).not.toContain(-1);
    expect(whole.filter((line) => line.includes("ready to pause"))).toHaveLength(1);
    const whole2 = pulse(round, log, "open", lookedAt(log.length), CHAINED);
    expect(whole2.said).toEqual([]);
    expect(whole2.status).toContain("2 promoted, 1 confirmed");
    // The nearest hostile case: a second read that confirms nothing is still a second read.
    const lost = chainLog("lost");
    const unconfirmed = pulse(round, lost, "open", lookedAt(lost.length - 1), CHAINED);
    expect(unconfirmed.said[1]).toMatch(/^ {2}⚠ starter comparison g-4 after promotion 2 .*, not confirmed/);
    expect(unconfirmed.said[2]).toContain("ready to pause, 2 promotions read");
    expect(unconfirmed.status).toContain("2 promoted, 0 confirmed");
  });

  it("says the investigation's trigger once when it turns, with its command, and never for a lone solve, a seed or a state that never read it", () => {
    const log = [
      event(0, "campaign.opened", { project: "p" }),
      event(1, "comparison.reported", { reading: "no-step", scored: { wins: 3, losses: 1 } }),
    ];
    const due = (said: readonly string[]) => said.filter((line) => line.includes("investigation due"));
    // A live run is paused after its next comparison before its investigation opens; a stopped one opens.
    const command = "bun run runs pause r1 --after reported --yes";
    const opens = "bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open r1";
    const waiting = { ...lookedAt(log.length), due: false };
    const early = pulse(round, log, "open", waiting, START + 2 * HOUR);
    expect(due(early.said)).toEqual([]);
    expect(early.seen.due).toBe(false);
    const late = pulse(round, log, "open", early.seen, START + 13 * HOUR);
    expect(due(late.said)).toEqual([`⚠ investigation due, 13.0 h since its opening: ${command}`]);
    // Its hours grow at every look, and it is said at the one that found it due.
    expect(due(pulse(round, log, "open", late.seen, START + 14 * HOUR).said)).toEqual([]);
    // A first look and a state from before the trigger was read only remember it.
    for (const before of [undefined, lookedAt(log.length)]) {
      const remembered = pulse(round, log, "open", before, START + 13 * HOUR);
      expect(due(remembered.said)).toEqual([]);
      expect(remembered.seen.due).toBe(true);
    }
    expect(due(pulse(lone, log, "open", waiting, START + 13 * HOUR).said)).toEqual([]);
    expect(due(pulse({ ...round, seed: true }, log, "open", waiting, START + 13 * HOUR).said)).toEqual([]);
    // A campaign nothing writes or keeps is due once it compared; one its keeper holds runs on.
    const at = { now: START + 2 * HOUR };
    expect(due(pulseOf(round, log, CLOSED, waiting, at).said)).toEqual([
      `⚠ investigation due, closed: ${opens}`,
    ]);
    expect(due(pulseOf(round, log, { writing: false, kept: true }, waiting, at).said)).toEqual([]);
  });

  it("says the exam's milestones in counts, warns of a checker read or a freeze with a fault, and carries no text of the exam", () => {
    const HIDDEN = "a-hidden-value";
    const drafted = event(1, "exam.drafted", {
      session: "d-1",
      draft: {
        checks: [{ id: HIDDEN }, { id: HIDDEN }, { id: HIDDEN }],
        tasks: [{ text: HIDDEN }, { text: HIDDEN }],
        rules: [{ text: HIDDEN }],
        scope: HIDDEN,
      },
    });
    const read = (faults: string[]) =>
      event(2, "checker.read", {
        checks: HIDDEN,
        contract: HIDDEN,
        controls: 24,
        stored: 0,
        rows: [{ id: HIDDEN }, { id: HIDDEN }, { id: HIDDEN }],
        historicalRows: [],
        doNothing: { answer: { value: HIDDEN }, tasks: 5, rejected: 5 },
        admitted: [HIDDEN],
        faults,
      });
    const frozen = (extra: JsonObject) =>
      event(3, "contract.frozen", { checks: HIDDEN, contract: HIDDEN, admitted: [HIDDEN], ...extra });
    const examined = event(4, "exam.finished", {
      session: "x-1",
      ended: "finished",
      seconds: 720,
      billed: 3.4,
      held: ["v1", "v2", "v3"],
      proposed: 5,
      refused: [{ reason: HIDDEN }, { reason: HIDDEN }],
      note: HIDDEN,
    });
    const said = (log: readonly LogEvent[]) =>
      pulse(round, log, "open", lookedAt(1), START + 5 * MINUTE).said;
    const sound = said([...built, drafted, read([]), frozen({}), examined]);
    expect(sound).toEqual([
      "◆ the exam is drafted: 3 checks, 2 tasks",
      "◆ the checker read: 3 checks, 1 admitted, 24 controls, the do-nothing answer rejected on 5 of 5 tasks",
      "◆ the contract is frozen, 1 check admitted",
      "◆ exam x-1 ended in 12m, $3.40: held 3 of 5 proposed, 2 refused",
    ]);
    const faulty = said([...built, read([HIDDEN, HIDDEN]), frozen({ despite: HIDDEN, faults: 2 })]);
    expect(faulty).toEqual([
      "⚠ the checker read with 2 faults: 3 checks, 1 admitted, 24 controls, the do-nothing answer rejected on 5 of 5 tasks",
      "⚠ the contract is frozen despite 2 faults, 1 check admitted",
    ]);
    expect([...sound, ...faulty].join("\n")).not.toContain(HIDDEN);
  });

  it("says at a comparison's start what it can read: its solves a side and the results that clear its level", () => {
    const tasks = Array.from({ length: 24 }, (_, nth) => `v-${String(nth)}`);
    const terms = { session: "g-3", old: "a", fresh: "b", starter: "s", level: 0.02, solves: 2, tasks };
    const said = (data: JsonObject) =>
      pulse(round, [...built, event(1, "comparison.started", data)], "open", lookedAt(1), START + 2 * MINUTE)
        .said;
    expect(said({ ...terms, retained: tasks.slice(0, 3) })).toEqual([
      "· comparison g-3 started, 2 solves a side, 3 tasks retained: 24 held-out tasks can be scored; at --level 0.02 the smallest results that read a step are 6-0, 8-1, 10-2, each task won or lost by as many pairs",
    ]);
    expect(said({ ...terms, fresh: "s", retained: [] })[0]).toStartWith(
      "· comparison g-3 started against the starter, 2 solves a side: 24 held-out tasks",
    );
    // Fewer tasks than a step takes: a comparison that cannot read one is one to look at.
    expect(said({ ...terms, tasks: tasks.slice(0, 4), retained: [] })[0]).toMatch(
      /^⚠ comparison g-3 started, 2 solves a side: 4 held-out tasks.*cannot read a step$/,
    );
    // A start from before its terms were logged says only that it began.
    expect(said({ session: "g-1", tasks: ["v-1"] })).toEqual(["· comparison g-1 started"]);
  });

  it("says a chain that loses to the starter and an objective step inside its A/A as readings at a report", () => {
    const said = (log: readonly LogEvent[]) =>
      pulse(round, log, "open", { ...lookedAt(log.length - 1), triggers: {} }, START + 7 * MINUTE).said;
    expect(
      said(chainLog("lost")).filter((line) =>
        line.startsWith("◆ climb: CHAIN AGAINST THE STARTER (lane 28)"),
      ),
    ).toHaveLength(1);
    expect(said(chainLog("won")).some((line) => line.includes("CHAIN AGAINST THE STARTER"))).toBe(false);
    expect(
      said(objectiveLog(0.05)).filter((line) =>
        line.startsWith("◆ honesty: MARGINS INSIDE THE NOISE (lane 29)"),
      ),
    ).toHaveLength(1);
  });

  it("recognises a campaign ending while drafting and warns for an unfinished draft", () => {
    const drafting = [
      event(0, "campaign.opened", { project: "p" }),
      event(1, "draft.started", { session: "d-1" }),
    ];
    const ended = [
      ...drafting,
      event(2, "campaign.ended", { ending: "environment", why: "the provider failed" }),
    ];
    const said = pulse(round, ended, "closed", lookedAt(2), START + 3 * MINUTE).said;
    expect(said).toHaveLength(1);
    for (const fact of ["◆", "environment", "the provider failed"]) expect(said[0]).toContain(fact);
    const gone = pulse(round, drafting, "closed", lookedAt(2), START + 3 * MINUTE).said;
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatch(/^⚠.*campaign[.]ended/);
  });

  it("reads where the run stands once, with its keeper, and remembers it beside the cursor", () => {
    const log = [...built, event(1, "solve.started", { solve: "s-1", task: "t-1" })];
    const kept = { writing: false, kept: true };
    const stands = (life: typeof OPEN, now: number) => pulseOf(round, log, life, lookedAt(1), { now });
    expect(stands(kept, START + 2 * MINUTE).state).toEqual({ kind: "kept" });
    expect(stands(kept, START + 2 * MINUTE).seen.state).toBe("kept");
    expect(stands(CLOSED, START + 2 * MINUTE).state).toEqual({ kind: "stopped" });
    // A keeper leaves a written run's quiet as it is: it is said once, and the state carries the keeper.
    const quiet = stands({ writing: true, kept: true }, START + 30 * MINUTE);
    expect(quiet.state).toMatchObject({ kind: "quiet", kept: true });
    expect(quiet.said).toEqual(["⚠ quiet for 29m"]);
    expect(quiet.seen).toMatchObject({ lines: log.length, open: true, quiet: true, state: "quiet" });
    expect(stands(OPEN, START + 2 * MINUTE).state).toEqual({ kind: "live", kept: false });
  });

  it("says nothing of the triggers where the rows did not move, and keeps what it last read of them", () => {
    const crashed = [...built, event(1, "exam.finished", { session: "x-1", ended: "crashed" })];
    const before = { ...lookedAt(built.length), triggers: { "SESSION CRASHED": "" } };
    const still = pulseOf(round, crashed, OPEN, before, { now: START + 2 * MINUTE });
    expect(still.said.some((line) => line.includes("SESSION CRASHED"))).toBe(false);
    expect(still.seen.triggers).toEqual(before.triggers);
    // A reading trigger is said when the rows move, whatever event the look ends on.
    const chain = chainLog("lost");
    const moved = pulse(
      round,
      [...chain, event(9, "build.started", { session: "b-9" })],
      "open",
      {
        ...lookedAt(chain.length),
        triggers: {},
      },
      START + 7 * MINUTE,
    );
    expect(moved.said.filter((line) => line.startsWith("◆ climb: CHAIN AGAINST THE STARTER"))).toHaveLength(
      1,
    );
  });

  it("carries the readers' cursor and what it said from the last look", () => {
    const before = { ...lookedAt(1), rowsAt: 7, said: ["a1"], moments: [], due: false };
    const look = pulseOf(lone, built, OPEN, before, { now: START + MINUTE });
    expect(look.seen).toMatchObject({ rowsAt: 7, said: ["a1"], moments: [], due: false });
  });

  it("counts omitted runs and names the archive's newest", () => {
    const lines = leftOut(2, 39, [
      { name: "buffer-a", days: 1.4, promoted: 3 },
      { name: "buffer-b", days: 2.9, promoted: 0 },
    ]);
    expect(lines[0]).toMatch(/2.*closed/);
    expect(lines[1]).toContain("39");
    expect(lines[1]).toMatch(/buffer-a[^;]*1d[^;]*3x/);
    expect(lines[1]).toMatch(/buffer-b[^;]*2d/);
    expect(leftOut(0, 0, [])).toEqual([]);
    expect(leftOut(1, 0, [])).toHaveLength(1);
  });
});
