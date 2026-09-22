import { mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { buildWalls, renderWalls } from "../.claude/skills/whole-run-investigation/scripts/walls.mjs";

interface Case {
  taskId: string;
  outcome: string;
  bound: string;
  elapsedMinutes: number | null;
  timeShare: number | null;
  turns: number | null;
  turnShare: number | null;
  toolCalls: number | null;
  errors: string[];
}
interface Battery {
  runId: string;
  cases: number;
  walls: {
    source: string;
    settings: { solveMs: number; maxTurns: number };
    moved: { key: string; declared: number; seeded: number }[];
  };
  bounds: Record<string, number>;
  outcomes: Record<string, number>;
  time: { median: number | null; max: number | null };
  toolCalls: { median: number | null; max: number | null };
  boundedWithoutPass: string[];
  rows: Case[];
}
interface Report {
  state: string;
  reason: string | null;
  batteries: Battery[];
}

const RUN = "run-20260919T000000000Z-aaaaaa";
const OTHER = "run-20260919T060000000Z-bbbbbb";
const CONFIG = ["solver:", "  solve_minutes: 60", "  max_turns: 4", "gate:", "  check_seconds: 600", ""].join(
  "\n",
);

interface Spec {
  taskId: string;
  minutes: number;
  seconds?: number;
  turns: number | null;
  accepted?: boolean;
  pass?: boolean | null;
  nonResult?: string | null;
  errors?: string[];
}

const PRESSED: Spec[] = [
  {
    taskId: "at-wall",
    minutes: 58,
    turns: 1,
    pass: false,
    errors: ["Pi Built worker exceeded its bounded solve time"],
  },
  { taskId: "quick", minutes: 6, turns: 1, pass: true },
  { taskId: "gave-up", minutes: 9, turns: 1, accepted: false },
  { taskId: "turns", minutes: 20, turns: 4, accepted: false },
  { taskId: "never", minutes: 0, seconds: 5, turns: 0, nonResult: "provider" },
];

/** One campaign holding a battery's bundle, its case rows and the per-case results. */
function campaign(batteries: { runId: string; config: string | null; cases: Spec[] }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-walls-"));
  const lines: string[] = [];
  let seq = 0;
  for (const battery of batteries) {
    if (battery.config !== null) {
      mkdirSync(join(dir, "versions", battery.runId, "agent"), { recursive: true });
      writeFileSync(join(dir, "versions", battery.runId, "agent", "config.yaml"), battery.config);
    }
    for (const spec of battery.cases) {
      const start = Date.parse("2026-09-19T10:00:00.000Z");
      const end = start + spec.minutes * 60_000 + (spec.seconds ?? 0) * 1000;
      seq += 1;
      lines.push(
        JSON.stringify({
          seq,
          row: {
            runId: battery.runId,
            taskId: spec.taskId,
            family: "one",
            acceptedSubmit: spec.accepted ?? true,
            pass: spec.pass ?? null,
            truthOk: spec.pass ?? null,
            runtimeNonResult: spec.nonResult ?? null,
            solverStartedAt: new Date(start).toISOString(),
            solverEndedAt: new Date(end).toISOString(),
          },
        }),
      );
      if (spec.turns !== null) {
        const caseDir = join(dir, "versions", battery.runId, "runs", battery.runId, "cases", spec.taskId);
        mkdirSync(caseDir, { recursive: true });
        writeFileSync(
          join(caseDir, "case-result.json"),
          JSON.stringify({
            solver: { completedTurns: spec.turns, toolCalls: spec.turns * 3, errors: spec.errors ?? [] },
          }),
        );
      }
    }
  }
  writeFileSync(join(dir, "case-record.jsonl"), lines.join("\n") + "\n");
  return dir;
}

describe("solve budget against the declared walls", () => {
  it("classes each case by the budget it reached and names the walls the bundle moved", () => {
    const dir = campaign([{ runId: RUN, config: CONFIG, cases: PRESSED }]);
    const report: Report = buildWalls({ campaign: dir });
    const battery = report.batteries[0]!;
    expect(battery.walls.settings).toMatchObject({ solveMs: 3_600_000, maxTurns: 4 });
    expect(battery.walls.moved.map((row) => row.key).sort()).toEqual(["maxTurns", "solveMs"]);
    // A case short of every wall is reported by what it did — `submitted` or `no-submit` — because
    // no recorded field says a solve that finished and submitted was cut short.
    expect(battery.bounds).toEqual({
      "time-bound": 1,
      submitted: 1,
      "no-submit": 1,
      "turn-bound": 1,
      unstarted: 1,
    });
    expect(battery.outcomes).toEqual({ fail: 1, pass: 1, unaccepted: 2, "non-result": 1 });
    expect(battery.rows.map((row) => [row.taskId, row.bound, row.timeShare])).toEqual([
      ["at-wall", "time-bound", 0.967],
      ["quick", "submitted", 0.1],
      ["gave-up", "no-submit", 0.15],
      ["turns", "turn-bound", 0.333],
      ["never", "unstarted", 0.001],
    ]);
    expect(battery.boundedWithoutPass).toEqual(["at-wall", "turns"]);
    // Tool calls, not a turn share: one turn of twenty-four is what an uninterrupted solve records.
    expect(battery.toolCalls).toEqual({ median: 3, max: 12 });
    const text: string = renderWalls(report);
    expect(text).toContain("moved from the seeded default: solveMs 7200000 to 3600000, maxTurns 24 to 4");
    expect(text).toContain("tool calls: median 3, max 12");
    expect(text).not.toContain("turns used");
    // The wall reading quotes the host's own sentence rather than resting on the elapsed share.
    expect(text).toContain(
      'at a wall: at-wall time-bound, 58 min (96.7%), 1 turn(s) of 4, 3 tool calls, fail, "Pi Built worker exceeded its bounded solve time"',
    );
    expect(text).toContain(
      "turns turn-bound, 20 min (33.3%), 4 turn(s) of 4, 12 tool calls, unaccepted, no solver error recorded",
    );
    expect(text).toContain(
      "at-wall, turns reached a wall without passing: that verdict rests on a truncated solve",
    );
  });

  it("states plainly when no case came near a wall, and reads the seeded walls when the bundle is gone", () => {
    const dir = campaign([
      { runId: RUN, config: null, cases: [{ taskId: "quick", minutes: 6, turns: 1, pass: true }] },
    ]);
    const report: Report = buildWalls({ campaign: dir });
    const battery = report.batteries[0]!;
    expect(battery.walls.moved).toEqual([]);
    expect(battery.walls.source).toContain("bundle is absent");
    expect(battery.rows[0]!.turnShare).toBe(0.042);
    expect(renderWalls(report)).toContain("no case reached a declared wall");
  });

  it("selects one battery of several and reports no case row rather than an empty campaign", () => {
    const dir = campaign([
      { runId: RUN, config: CONFIG, cases: PRESSED },
      { runId: OTHER, config: CONFIG, cases: [{ taskId: "quick", minutes: 6, turns: 1, pass: true }] },
    ]);
    expect(buildWalls({ campaign: dir }).batteries.map((battery: Battery) => battery.runId)).toEqual([
      RUN,
      OTHER,
    ]);
    const one: Report = buildWalls({ campaign: dir, runId: OTHER });
    expect(one.batteries.map((battery) => [battery.runId, battery.cases])).toEqual([[OTHER, 1]]);
    const none: Report = buildWalls({ campaign: dir, runId: "run-20260919T070000000Z-cccccc" });
    expect(none.state).toBe("unavailable");
    expect(renderWalls(none)).toContain("recorded no case row");
  });
});
