// The runs pulse reports ended processes, promotions and campaign endings.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { leftOut, pulse } from "../tools/runs/pulse.ts";
import type { Run } from "../tools/runs/registry.ts";

const round: Run = { name: "r1", tree: "/wt", path: "/wt/.ana/d2/r1/log.jsonl", end: "comparison.reported" };
const START = Date.parse("2026-10-08T12:00:00Z");
const at = (minute: number) => new Date(START + minute * 60_000).toISOString();
const event = (minute: number, kind: EventKind, data: JsonObject): LogEvent => ({
  at: at(minute),
  kind,
  data,
});
const usage = (total: number) => ({ cost: { total } });
/** What a look that read `lines` events of an open run remembers. */
const lookedAt = (lines: number) => ({ lines, open: true, quiet: false });

const built: LogEvent[] = [
  event(0, "build.started", { session: "r1-b", model: "claude/claude-opus-5" }),
  event(1, "build.turn", { session: "r1-b", turn: 1, error: null, usage: usage(0.5) }),
  event(2, "solve.started", { solve: "s1", task: "mass-03", model: "openai-codex/gpt-6.1-sol" }),
  event(3, "solve.turn", { solve: "s1", turn: 1, error: "WebSocket closed 1000", usage: usage(0.25) }),
  event(4, "solve.finished", {
    solve: "s1",
    ending: { outcome: "non-result", kind: "provider", reason: "WebSocket closed 1000" },
    billed: 0.25,
    seconds: 240,
  }),
];

describe("the runs pulse", () => {
  it("says a process gone before its report, and not one that reported", () => {
    const gone = pulse(round, built, "closed", lookedAt(5), START + 5 * 60_000);
    expect(gone.status).toStartWith("r1  closed");
    expect(gone.said).toEqual(["⚠ the process is gone before comparison.reported"]);
    const reported = [...built, event(5, "comparison.reported", { reading: "held" })];
    const done = pulse(round, reported, "closed", lookedAt(5), START + 6 * 60_000);
    expect(done.status).toStartWith("r1  closed, reported held");
    expect(done.said).toEqual(["◆ reported held"]);
    // An Examiner session writes no report: its own end is the run's, and a round's report before it
    // is not.
    const examining = [...reported, event(6, "exam.started", { session: "x-1" })];
    const seen = lookedAt(7);
    expect(pulse(round, examining, "closed", seen, START + 7 * 60_000).said).toEqual([
      "⚠ the process is gone before exam.finished",
    ]);
    const examined = [...examining, event(7, "exam.finished", { session: "x-1", ended: "finished" })];
    expect(pulse(round, examined, "closed", seen, START + 8 * 60_000).said).toEqual(["◆ exam x-1 ended"]);
    // A wait for the provider and a campaign's ending are said; a wait on the load, one a solve,
    // is not. Until 15 October neither was, and a run waiting out a limit read as quiet.
    const waited = [
      ...examined,
      event(8, "campaign.waited", { task: "t-1", load: 40, cores: 12, ms: 60_000 }),
      event(9, "campaign.waited", { for: "provider", until: "2026-10-15T21:00:00.000Z", ms: 7_200_000 }),
      event(10, "campaign.ended", { ending: "finished", why: "3 conversations in a row made no move" }),
    ];
    expect(pulse(round, waited, "closed", { ...seen, lines: 8 }, START + 11 * 60_000).said).toEqual([
      "⚠ waited 120m for the provider until 2026-10-15T21:00:00.000Z",
      "◆ the campaign ended finished: 3 conversations in a row made no move",
    ]);
    // A report with tasks set aside on rejections nobody has settled, one its cap cut, and one
    // that scored nothing, are each something to look at.
    const says = (data: JsonObject) =>
      pulse(
        round,
        [...built, event(5, "comparison.reported", data)],
        "closed",
        { ...done.seen, lines: 5 },
        START,
      ).said;
    expect(says({ reading: "no-step", aside: ["v1", "v2"] })).toEqual([
      "⚠ reported no-step, with 2 task(s) set aside on rejections no person has settled",
    ]);
    expect(says({ reading: "not-scored", capped: true, aside: [] })).toEqual([
      "⚠ reported not-scored: its dollar cap cut it short",
    ]);
    // A cap that cut the starter's solves left the test standing.
    expect(
      says({ reading: "starter-unread", capped: true, scored: { wins: 4, losses: 0, ties: 0 }, aside: [] }),
    ).toEqual([
      "⚠ reported starter-unread: its dollar cap cut the starter's solves short, and its test stands",
    ]);
    expect(says({ reading: "step", aside: [] })).toEqual(["◆ reported step"]);
    expect(says({ reading: "no-step", settled: { labelled: 2, defects: 2 } })).toEqual([
      "◆ settled by hand as no-step: 2 labelled, 2 a check defect",
    ]);
    expect(says({ reading: "not-scored", unflagged: null })).toEqual(["⚠ reported not-scored"]);
  });

  it("says a promotion, and counts the promotions on the status line", () => {
    const promoted = [
      ...built,
      event(5, "comparison.reported", { reading: "step" }),
      event(6, "harness.promoted", { harness: "0a1b2c3d4e5f", from: "starter", rests: "g1" }),
    ];
    const look = pulse(round, promoted, "open", lookedAt(5), START + 7 * 60_000);
    expect(look.said).toEqual(["◆ reported step", "◆ promoted 0a1b2c3d to the reference"]);
    expect(look.status).toContain("1 promoted");
    expect(pulse(round, built, "open", undefined, START + 5 * 60_000).status).not.toContain("promoted");
  });

  it("reads a campaign that ended while drafting its exam as done, and one that stopped as gone", () => {
    const drafting = [
      event(0, "campaign.opened", { project: "p" }),
      event(1, "draft.started", { session: "d-1" }),
    ];
    const seen = lookedAt(2);
    const ended = [
      ...drafting,
      event(2, "campaign.ended", { ending: "environment", why: "the provider failed" }),
    ];
    expect(pulse(round, ended, "closed", seen, START + 3 * 60_000).said).toEqual([
      "◆ the campaign ended environment: the provider failed",
    ]);
    expect(pulse(round, drafting, "closed", seen, START + 3 * 60_000).said).toEqual([
      "⚠ the process is gone before comparison.reported",
    ]);
  });

  it("says under the status rows the closed runs it leaves out, and the archive's newest", () => {
    const newest = [
      { name: "buffer-a", days: 1.4, promoted: 3 },
      { name: "buffer-b", days: 2.9, promoted: 0 },
    ];
    const lines = leftOut(2, 39, newest);
    expect(lines[0]).toContain("2 closed runs quiet over a day");
    expect(lines[1]).toContain("39 campaigns in the archive");
    expect(lines[1]).toContain("buffer-a · 1d · 3x promotion; buffer-b · 2d");
    // Nothing left out says nothing, so a machine with no archive prints no line for it.
    expect(leftOut(0, 0, [])).toEqual([]);
    expect(leftOut(1, 0, [])).toHaveLength(1);
  });
});
