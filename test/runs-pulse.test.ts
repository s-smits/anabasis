// The runs pulse reports ended processes, promotions and campaign endings.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { leftOut, pulse as pulseOf } from "../tools/runs/pulse.ts";
import { overview } from "../tools/wri/read.ts";
import type { Run } from "../tools/runs/registry.ts";

const round: Run = { name: "r1", tree: "/wt", path: "/wt/.ana/d2/r1/log.jsonl", end: "comparison.reported" };
const START = Date.parse("2026-10-08T12:00:00Z");
const event = (minute: number, kind: EventKind, data: JsonObject): LogEvent => ({
  at: new Date(START + minute * 60_000).toISOString(),
  kind,
  data,
});
/** What a look that read `lines` events of an open run remembers. */
const lookedAt = (lines: number) => ({ lines, open: true, quiet: false });

const built = [event(0, "build.started", { session: "r1-b" })];
/** A look that reads the investigation's triggers in this process, as `wri.ts read` would print them. */
const pulse = (
  run: Run,
  log: readonly LogEvent[],
  process: "open" | "closed",
  before: Parameters<typeof pulseOf>[3],
  now: number,
) => pulseOf(run, log, process, before, { now, alarms: () => overview(log).triggers });

describe("the runs pulse", () => {
  it("reports missing processes and each session's own ending", () => {
    const gone = pulse(round, built, "closed", lookedAt(built.length), START + 5 * 60_000);
    expect(gone.status).toMatch(/^r1\s+closed/);
    expect(gone.said).toHaveLength(1);
    expect(gone.said[0]).toMatch(/^⚠.*comparison[.]reported/);
    const reported = [...built, event(5, "comparison.reported", { reading: "held" })];
    const done = pulse(round, reported, "closed", lookedAt(built.length), START + 6 * 60_000);
    expect(done.status).toMatch(/^r1\s+closed.*held/);
    expect(done.said).toHaveLength(1);
    expect(done.said[0]).toMatch(/^◆.*held/);
    const examining = [...reported, event(6, "exam.started", { session: "x-1" })];
    const seen = lookedAt(examining.length);
    expect(pulse(round, examining, "closed", seen, START).said[0]).toMatch(/^⚠.*exam[.]finished/);
    const examined = [...examining, event(7, "exam.finished", { session: "x-1", ended: "finished" })];
    const finished = pulse(round, examined, "closed", seen, START).said;
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatch(/^◆.*x-1/);
    const waited = [
      ...examined,
      event(8, "campaign.waited", { task: "t-1", load: 40, cores: 12, ms: 60_000 }),
      event(9, "campaign.waited", { for: "provider", until: "2026-10-15T21:00:00.000Z", ms: 7_200_000 }),
      event(10, "campaign.ended", { ending: "finished", why: "3 conversations in a row made no move" }),
    ];
    const said = pulse(round, waited, "closed", lookedAt(examined.length), START + 11 * 60_000).said;
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
    expect(pulse(round, log, "open", lookedAt(1), START + 2 * 60_000).said).toEqual([
      "⚠ 2 solves waited over 15m for the load, the longest 30m at load 7.0 on 4 cores",
    ]);
    expect(pulse(round, log.slice(0, 2), "open", lookedAt(1), START + 2 * 60_000).said).toEqual([]);
  });

  it("reads a campaign the Builder leads as done only at its ending", () => {
    const examined = [
      event(0, "campaign.opened", { project: "p" }),
      event(1, "exam.started", { session: "x-1" }),
      event(2, "exam.finished", { session: "x-1", ended: "finished" }),
    ];
    const seen = lookedAt(examined.length);
    const gone = pulse(round, examined, "closed", seen, START + 3 * 60_000).said;
    expect(gone).toEqual(["⚠ the process is gone before campaign.ended"]);
    const ended = [...examined, event(3, "campaign.ended", { ending: "budget", why: "spent" })];
    expect(pulse(round, ended, "closed", seen, START + 4 * 60_000).said).toEqual([
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
    const said = pulse(round, log, "open", lookedAt(2), START + 5 * 60_000).said;
    expect(said).toEqual(["⚠ 2 turns served by another model: claude-opus-5 for claude/claude-opus-5-5"]);
    expect(pulse(round, log, "open", lookedAt(4), START + 5 * 60_000).said).toEqual([]);
  });

  it("reads a solve and a wait of a process gone before the last launch as over", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-runs-pulse-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const continued: Run = { ...round, tree: root, path: join(root, "r1", "log.jsonl") };
    mkdirSync(join(root, "r1"));
    const relaunched = new Date(START + 3 * 60_000).toISOString();
    writeFileSync(join(root, "r1", "launch-run-2.json"), JSON.stringify({ at: relaunched }));
    const log = [
      ...built,
      event(1, "solve.started", { solve: "s-1-1", task: "t-1" }),
      event(2, "campaign.waited", { for: "provider", until: "2026-11-01T11:00:00.000Z", ms: 1 }),
      event(3, "build.finished", { session: "r1-b", ended: "killed" }),
      event(3, "build.started", { session: "r1-b2" }),
    ];
    const later = START + 25 * 60_000;
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
    const baseline = pulse(round, first, "open", undefined, START + 2 * 60_000);
    expect(baseline.said).toEqual([]);
    const second = [...first, crashed(2, "x-2")];
    const moved = pulse(round, second, "open", baseline.seen, START + 3 * 60_000);
    expect(moved.said.filter((line) => line.includes("SESSION CRASHED"))).toEqual([
      "⚠ economy: SESSION CRASHED (lane 30): x-1, x-2",
    ]);
    const solved = [...second, event(3, "solve.started", { solve: "s-1", task: "t-1" })];
    const again = pulse(round, solved, "open", moved.seen, START + 4 * 60_000);
    expect(again.said.some((line) => line.includes("SESSION CRASHED"))).toBe(false);
  });

  it("says only the new one of a trigger that fires once for each comparison", () => {
    const compared = (minute: number, session: string) => [
      event(minute, "comparison.started", { session, tasks: ["v-1", "v-2"] }),
      event(minute + 1, "comparison.reported", { session, reading: "no-step", versions: ["v-1"] }),
    ];
    const moved = (said: readonly string[]) => said.filter((line) => line.includes("SCORED SET MOVED"));
    const one = [...built, ...compared(1, "g-1")];
    const first = pulse(round, one, "open", undefined, START + 3 * 60_000);
    const two = [...one, ...compared(3, "g-2")];
    const second = pulse(round, two, "open", first.seen, START + 5 * 60_000);
    expect(moved(second.said)).toEqual([
      "⚠ honesty: SCORED SET MOVED (lane 22): g-2: 1 of 2 tasks it began with are not in its tally",
    ]);
    const grown = [...two, event(5, "build.started", { session: "b-2" })];
    expect(moved(pulse(round, grown, "open", second.seen, START + 6 * 60_000).said)).toEqual([]);
  });

  it("announces and counts promotions only where recorded", () => {
    const promoted = [
      ...built,
      event(5, "comparison.reported", { reading: "step" }),
      event(6, "harness.promoted", { harness: "0a1b2c3d4e5f", from: "starter", rests: "g1" }),
    ];
    const look = pulse(round, promoted, "open", lookedAt(built.length), START + 7 * 60_000);
    expect(look.said).toHaveLength(3);
    expect(look.said[0]).toMatch(/^◆.*step/);
    expect(look.said[1]).toMatch(/^◆.*0a1b2c3d/);
    expect(look.said[2]).toMatch(/^◆ climb: PROMOTION UNCONFIRMED/);
    expect(look.status).toContain("1 promoted");
    expect(pulse(round, built, "open", undefined, START + 5 * 60_000).status).not.toContain("promoted");
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
    const said = pulse(round, ended, "closed", lookedAt(2), START + 3 * 60_000).said;
    expect(said).toHaveLength(1);
    for (const fact of ["◆", "environment", "the provider failed"]) expect(said[0]).toContain(fact);
    const gone = pulse(round, drafting, "closed", lookedAt(2), START + 3 * 60_000).said;
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatch(/^⚠.*campaign[.]ended/);
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
