// The runs pulse says what a run's log gained since the last look: milestones, solves that ended
// without a result, failed turns gathered into one line, a quiet that starts and ends, and a
// process gone before its run was done. A first look says the status alone.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { pulse, type Run, writers } from "../tools/runs/pulse.ts";

const round: Run = { name: "r1", tree: "/wt", path: "/wt/.ana/d2/r1/log.jsonl", end: "comparison.reported" };
const START = Date.parse("2026-10-08T12:00:00Z");
const at = (minute: number) => new Date(START + minute * 60_000).toISOString();
const event = (minute: number, kind: EventKind, data: JsonObject): LogEvent => ({
  at: at(minute),
  kind,
  data,
});
const usage = (total: number) => ({ cost: { total } });

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
  it("says the status alone at a first look", () => {
    const look = pulse(round, built, true, undefined, START + 5 * 60_000);
    expect(look.status).toBe("r1  build turn 1 · solves 1 non-result · $0.75 · 1m since the last event");
    expect(look.said).toEqual([]);
    expect(look.seen).toEqual({ lines: 5, open: true, quiet: false });
    // A seed's counts are its source's and a script's, so its line says what it is.
    const seeded = pulse({ ...round, seed: true }, built, false, undefined, START + 5 * 60_000);
    expect(seeded.status.startsWith("r1 (a seed)  closed · ")).toBe(true);
  });

  it("says what came since the last look, by the solve's task", () => {
    const look = pulse(round, built, true, { lines: 1, open: true, quiet: false }, START + 5 * 60_000);
    expect(look.said).toEqual([
      "· mass-03 started on openai-codex/gpt-6.1-sol",
      "⚠ mass-03 ended without a result, provider: WebSocket closed 1000 in 4m, $0.25",
      "⚠ 1 failed turn: WebSocket closed 1000",
    ]);
  });

  it("says a quiet once when it starts and once when it ends", () => {
    const later = START + 30 * 60_000;
    const quiet = pulse(round, built, true, { lines: 5, open: true, quiet: false }, later);
    expect(quiet.said).toEqual(["⚠ quiet for 26m"]);
    expect(pulse(round, built, true, quiet.seen, later).said).toEqual([]);
    const woken = [
      ...built,
      event(30, "build.turn", { session: "r1-b", turn: 2, error: null, usage: usage(0.5) }),
    ];
    expect(pulse(round, woken, true, quiet.seen, later).said).toEqual(["· not quiet any more"]);
  });

  it("says a process gone before its report, and not one that reported", () => {
    const gone = pulse(round, built, false, { lines: 5, open: true, quiet: false }, START + 5 * 60_000);
    expect(gone.status).toStartWith("r1  closed");
    expect(gone.said).toEqual(["⚠ the process is gone before comparison.reported"]);
    const reported = [...built, event(5, "comparison.reported", { reading: "held" })];
    const done = pulse(round, reported, false, { lines: 5, open: true, quiet: false }, START + 6 * 60_000);
    expect(done.status).toStartWith("r1  reported held");
    expect(done.said).toEqual(["◆ reported held"]);
    // An Examiner session writes no report: its own end is the run's, and a round's report before it
    // is not.
    const examining = [...reported, event(6, "exam.started", { session: "x-1" })];
    const seen = { lines: 7, open: true, quiet: false };
    expect(pulse(round, examining, false, seen, START + 7 * 60_000).said).toEqual([
      "⚠ the process is gone before exam.finished",
    ]);
    const examined = [...examining, event(7, "exam.finished", { session: "x-1", ended: "finished" })];
    expect(pulse(round, examined, false, seen, START + 8 * 60_000).said).toEqual(["◆ exam x-1 ended"]);
    // A report with tasks set aside on rejections nobody has settled, one its cap cut, and one
    // that scored nothing, are each something to look at.
    const says = (data: JsonObject) =>
      pulse(
        round,
        [...built, event(5, "comparison.reported", data)],
        false,
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

  it("reads a checkpoint by its own start, in a log that holds an earlier comparison's report", () => {
    // A campaign's log holds many comparisons. A checkpoint starts no session, so only its own
    // start says that the report before it is another's.
    const earlier = [...built, event(5, "comparison.reported", { reading: "no-step" })];
    const solving = [
      ...earlier,
      event(6, "comparison.started", { session: "g0" }),
      event(7, "solve.started", { solve: "s9", task: "mass-04", model: "claude/claude-opus-5" }),
    ];
    const seen = { lines: 8, open: true, quiet: false };
    expect(pulse(round, solving, true, seen, START + 8 * 60_000).status).toStartWith("r1  solving");
    // Gone with that solve unfinished and no report of its own, it is said to be gone.
    const gone = pulse(round, solving, false, seen, START + 9 * 60_000);
    expect(gone.status).toStartWith("r1  closed");
    expect(gone.said).toEqual(["⚠ the process is gone before comparison.reported"]);
    // Its own report ends it.
    const ended = [
      ...solving,
      event(8, "solve.finished", { solve: "s9", ending: { outcome: "pass" } }),
      event(9, "comparison.reported", { session: "g0", reading: "not-scored", capped: true }),
    ];
    const done = pulse(round, ended, false, { ...seen, lines: 10 }, START + 10 * 60_000);
    expect(done.status).toStartWith("r1  reported not-scored");
    expect(done.said).toEqual([]);
  });

  it("reads a comparison gone on from its log as solving, after another's report", () => {
    // g0 was stopped, g1 ran whole, and g0 goes on: it writes no second start, so its solves after
    // g1's report are what says the run has not reported.
    const resumed = [
      event(0, "comparison.started", { session: "g0" }),
      event(1, "comparison.started", { session: "g1" }),
      event(2, "comparison.reported", { session: "g1", reading: "no-step" }),
      event(3, "solve.started", { solve: "s7", task: "mass-05", model: "claude/claude-opus-5" }),
    ];
    const seen = { lines: 4, open: true, quiet: false };
    expect(pulse(round, resumed, true, seen, START + 4 * 60_000).status).toStartWith("r1  solving");
    expect(pulse(round, resumed, false, seen, START + 4 * 60_000).said).toEqual([
      "⚠ the process is gone before comparison.reported",
    ]);
    const ended = [
      ...resumed,
      event(4, "solve.finished", { solve: "s7", ending: { outcome: "pass" } }),
      event(5, "comparison.reported", { session: "g0", reading: "step" }),
    ];
    expect(pulse(round, ended, false, { ...seen, lines: 6 }, START + 6 * 60_000).status).toStartWith(
      "r1  reported step",
    );
  });

  it("folds the same line twice into one, as a comparison's two harnesses start a task", () => {
    const twice = [
      ...built,
      event(5, "solve.started", { solve: "s2", task: "wind-01", model: "claude/claude-opus-5" }),
      event(5, "solve.started", { solve: "s3", task: "wind-01", model: "claude/claude-opus-5" }),
    ];
    const look = pulse(round, twice, true, { lines: 5, open: true, quiet: false }, START + 6 * 60_000);
    expect(look.said).toEqual(["· wind-01 started on claude/claude-opus-5 (×2)"]);
    expect(look.status).toContain("2 running");
  });

  it("knows a campaign's log is written by a round or an Examiner session of its name, in its worktree", () => {
    const running = [
      { pid: 1, cwd: "/wt", args: ["bun", "tools/d2/round.ts", "--name", "r1", "--session", "b-1"] },
      { pid: 2, cwd: "/wt", args: ["bun", "tools/d1b/examine.ts", "--name", "r1", "--session", "x-1"] },
      { pid: 3, cwd: "/wt", args: ["bun", "tools/d2/round.ts", "--name", "r10"] },
      { pid: 4, cwd: "/other", args: ["bun", "tools/d2/round.ts", "--name", "r1"] },
      { pid: 5, cwd: "/wt", args: ["bun", "tools/m0/live-solve.ts", "--task", "r1", "--cycle", "c01"] },
      // A rehearsal is a round on a seed. The script runner that started it holds no log open.
      { pid: 6, cwd: "/wt", args: ["bun", "tools/runs/cli.ts", "rehearse", "--name", "r1"] },
      { pid: 7, cwd: "/wt", args: ["bun", "run", "runs", "rehearse", "--name", "r1"] },
      { pid: 8, cwd: "/wt", args: ["bun", "tools/runs/cli.ts", "pulse", "--name", "r1"] },
    ];
    expect(writers(round, running).map(({ pid }) => pid)).toEqual([1, 2, 6]);
    const solve: Run = { ...round, name: "r1-c01-opus-1234", end: "solve.finished" };
    expect(writers(solve, running).map(({ pid }) => pid)).toEqual([5]);
  });
});
