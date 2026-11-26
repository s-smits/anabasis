import { afterAll, describe, expect, it } from "bun:test";
import { newsOf, readingOf, told } from "#skills/system-path-simulation/scripts/live-seat.ts";
import { append, read, type LogEvent } from "../src/kernel/log.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";

const ROOT = resolve(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "ana-live-seat-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("live-seat draft visibility", () => {
  it("reads draft sessions, tool calls, audits, freeze events, and live news", () => {
    const events: LogEvent[] = [
      { at: "2026-11-26T00:00:00.000Z", kind: "draft.started", data: { session: "d-1" } },
      {
        at: "2026-11-26T00:01:00.000Z",
        kind: "draft.call",
        data: { session: "d-1", tool: "draft_exam", args: { target: "jobstat" }, isError: false, text: "" },
      },
      {
        at: "2026-11-26T00:01:30.000Z",
        kind: "solve.started",
        data: { solve: "draft-s-1", comparison: "d-1" },
      },
      { at: "2026-11-26T00:01:45.000Z", kind: "solve.finished", data: { solve: "draft-s-1" } },
      {
        at: "2026-11-26T00:02:00.000Z",
        kind: "referee.draft",
        data: { session: "d-1", pass: 1, verdict: "defects", billed: 0.5 },
      },
      { at: "2026-11-26T00:02:30.000Z", kind: "referee.draft.refused", data: { session: "d-1" } },
      {
        at: "2026-11-26T00:03:00.000Z",
        kind: "referee.draft",
        data: { session: "d-1", pass: 2, verdict: "sound", billed: 0.4 },
      },
      { at: "2026-11-26T00:03:30.000Z", kind: "exam.drafted", data: { session: "d-1" } },
      {
        at: "2026-11-26T00:04:00.000Z",
        kind: "draft.finished",
        data: { session: "d-1", ended: "finished", billed: 1.1 },
      },
      { at: "2026-11-26T00:04:30.000Z", kind: "contract.frozen", data: { contract: "c-1" } },
    ];
    const reading = readingOf(events, 0, ["jobstat"]);
    expect(reading.sessions).toEqual(["d-1"]);
    expect(reading.ended).toEqual(["finished"]);
    expect(reading.drafted).toBe(1);
    expect(reading.audits).toEqual({ defects: 1, sound: 1 });
    expect(reading.frozen).toBe(1);
    expect(reading.calls).toEqual({ draft_exam: 1 });
    expect(reading.mentions).toEqual({ jobstat: 1 });
    expect(reading.billed).toBeCloseTo(2, 6);
    expect(told(reading)).toContain("exam drafted 1, audits defects 1, sound 1, frozen 1");
    expect(told(reading).some((line) => line.startsWith("comparisons "))).toBe(false);
    expect(reading.solves).toEqual({ started: 0, finished: 0 });
    expect(newsOf(events, 0)).toEqual([
      "draft audit defects pass 1",
      "draft audit refused",
      "draft audit sound pass 2",
      "exam drafted",
      "d-1 ended finished",
      "contract frozen",
    ]);

    const writingOnly: LogEvent[] = [
      { at: "2026-11-26T00:00:00.000Z", kind: "exam.started", data: { session: "x-1" } },
      {
        at: "2026-11-26T00:00:30.000Z",
        kind: "solve.started",
        data: { solve: "gate-s-1", comparison: "x-1" },
      },
      { at: "2026-11-26T00:00:45.000Z", kind: "solve.finished", data: { solve: "gate-s-1" } },
      { at: "2026-11-26T00:01:00.000Z", kind: "exam.finished", data: { session: "x-1", ended: "finished" } },
    ];
    expect(told(readingOf(writingOnly, 0, [])).some((line) => line.startsWith("exam drafted"))).toBe(false);
    expect(told(readingOf(writingOnly, 0, [])).some((line) => line.startsWith("comparisons "))).toBe(false);

    const compEvents: LogEvent[] = [
      { at: "2026-11-26T00:00:00.000Z", kind: "comparison.started", data: { session: "g-5" } },
      { at: "2026-11-26T00:01:00.000Z", kind: "solve.started", data: { solve: "s-1", comparison: "g-5" } },
      { at: "2026-11-26T00:02:00.000Z", kind: "solve.started", data: { solve: "s-2", comparison: "g-5" } },
      { at: "2026-11-26T00:03:00.000Z", kind: "solve.finished", data: { solve: "s-1", billed: 0.7 } },
      {
        at: "2026-11-26T00:04:00.000Z",
        kind: "referee.finding",
        data: { solve: "s-1", ruling: "check-defect", billed: 0.3 },
      },
      {
        at: "2026-11-26T00:05:00.000Z",
        kind: "comparison.reported",
        data: { session: "g-5", reading: "no-step" },
      },
    ];
    const compReading = readingOf(compEvents, 0, []);
    expect(compReading.comparisons).toEqual(["g-5"]);
    expect(compReading.solves).toEqual({ started: 2, finished: 1 });
    expect(compReading.rulings).toEqual({ "check-defect": 1 });
    expect(compReading.reported).toBe(1);
    expect(told(compReading)).toContain("comparisons g-5 (reported 1), solves 1/2, rulings check-defect 1");
    expect(newsOf(compEvents, 0)).toEqual(["ruling check-defect on s-1", "g-5 reported no-step"]);
  });

  it("composes a tools/eval/draft.ts prompt without seating a model or writing log events", () => {
    const tree = join(tmp, "tree");
    mkdirSync(tree, { recursive: true });
    execTextSync("git", ["-C", tree, "init", "-q"]);
    cpSync(join(ROOT, "tools"), join(tree, "tools"), { recursive: true });
    for (const entry of ["src", "node_modules", "package.json", "tsconfig.json"]) {
      symlinkSync(join(ROOT, entry), join(tree, entry));
    }
    const seed = join(tree, ".ana", "d2", "sim-draft-prompt");
    mkdirSync(seed, { recursive: true });
    writeFileSync(join(seed, "seed.json"), JSON.stringify({ from: "src", events: 1 }));
    const log = join(seed, "log.jsonl");
    append(log, "campaign.opened", {
      project: "p",
      prompt: "Statistical data analysis over multi-table datasets.",
      judged: false,
      seats: {
        builder: { model: "claude/claude-opus-5-5", effort: "medium" },
        examiner: { model: "claude/claude-opus-5-5", effort: "medium" },
        reviewer: { model: "claude/claude-opus-5-5", effort: "medium" },
      },
      solver: { model: "claude/claude-opus-5-5", effort: "medium" },
    });
    const out = execTextSync(process.execPath, [
      join(ROOT, ".claude/skills/system-path-simulation/scripts/live-seat.ts"),
      "prompt",
      "--tree",
      tree,
      "--name",
      "sim-draft-prompt",
      "--",
      "tools/eval/draft.ts",
      "--session",
      "d-1",
      "--examiner",
      "claude/claude-opus-5-5",
    ]);
    expect(out).toContain("=== SYSTEM");
    expect(out).toContain("=== OPENING");
    expect(out).toContain("=== TOOL draft_exam");
    expect(read(log)).toHaveLength(1);
  });
});
