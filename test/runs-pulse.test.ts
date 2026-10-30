// The runs pulse reports ended processes, promotions and campaign endings.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { leftOut, pulse } from "../tools/runs/pulse.ts";
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

  it("announces and counts promotions only where recorded", () => {
    const promoted = [
      ...built,
      event(5, "comparison.reported", { reading: "step" }),
      event(6, "harness.promoted", { harness: "0a1b2c3d4e5f", from: "starter", rests: "g1" }),
    ];
    const look = pulse(round, promoted, "open", lookedAt(built.length), START + 7 * 60_000);
    expect(look.said).toHaveLength(2);
    expect(look.said[0]).toMatch(/^◆.*step/);
    expect(look.said[1]).toMatch(/^◆.*0a1b2c3d/);
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
    expect(gone[0]).toMatch(/^⚠.*comparison[.]reported/);
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
