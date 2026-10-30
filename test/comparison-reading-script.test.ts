/**
 * Check sample-size figures against production readers, re-evaluate synthetic comparison
 * reports under the current rules, and draw the next comparison's set. These tests read no
 * campaign logs.
 */
import { describe, expect, it } from "bun:test";
import { drawLines, drawOf } from "#skills/comparison-reading/scripts/draw.ts";
import { scoresRead, sizeOf } from "#skills/comparison-reading/scripts/size.ts";
import { rowsOf } from "#skills/comparison-reading/scripts/reading.ts";
import { flipP } from "../src/kernel/compare.ts";
import { clearing } from "../src/kernel/size.ts";
import { LOG_FILE, type LogEvent } from "../src/kernel/log.ts";
import { mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";

const STARTER = "a".repeat(64);
const NEW = "b".repeat(64);
const AT = "2026-10-30T00:00:00.000Z";
const START: LogEvent = {
  at: AT,
  kind: "comparison.started",
  data: { session: "g-1", old: STARTER, fresh: NEW, starter: STARTER },
};

const script = join(import.meta.dir, "..", ".claude/skills/comparison-reading/scripts/reading.ts");

/** `wins` tasks won and `losses` lost, each by `margin`. */
function scores(wins: number, losses: number, margin = 600): number[] {
  return [...Array.from({ length: wins }, () => margin), ...Array.from({ length: losses }, () => -margin)];
}

/** A tested set as a report records it. */
function set(differences: readonly number[], unbilled: readonly number[] | null): JsonObject {
  const count = (sign: number) => differences.filter((one) => Math.sign(one) === sign).length;
  return {
    wins: count(1),
    losses: count(-1),
    ties: count(0),
    p: flipP(differences),
    differences: [...differences],
    ...keyIfNotNull("unbilled", unbilled === null ? null : [...unbilled]),
  };
}

/** A comparison's report: `differences` on the frontier, `unbilled` beside them, `noise` the A/A. */
function report(
  session: string,
  reading: string,
  tested: { differences: readonly number[]; unbilled: readonly number[] | null; noise?: readonly number[] },
): LogEvent {
  const { differences, unbilled, noise } = tested;
  const tallied = differences.length > 0;
  return {
    at: AT,
    kind: "comparison.reported",
    data: {
      session,
      reading,
      old: STARTER,
      fresh: NEW,
      starter: STARTER,
      level: 0.02,
      solves: 2,
      scored: tallied ? { ...set(differences, unbilled), detectable: 0.8, falseRate: 0.011 } : null,
      frontier: tallied ? set(differences, unbilled) : null,
      retained: "unmeasured",
      noise: noise === undefined ? null : { ...set(noise, noise), flips: 0.1 },
      valid: tallied ? { old: [1, 2, 3], fresh: [0, 1, 5], informative: { old: 2, fresh: 1 } } : null,
      versions: differences.map((_, at) => `t${String(at)}`),
      aside: tallied ? [] : ["t9"],
      short: [],
      disputed: [],
      flagged: [],
      withdrawn: [],
    },
  };
}

describe("the size figures the skill states", () => {
  it("clears the level at the tallies the skill names, and not one win short of any", () => {
    const named = {
      0.02: [
        [6, 0],
        [8, 1],
        [10, 2],
        [12, 3],
      ],
      0.1: [
        [4, 0],
        [6, 1],
        [7, 2],
        [9, 3],
      ],
    } as const;
    for (const [level, tallies] of [
      [0.02, named[0.02]],
      [0.1, named[0.1]],
    ] as const) {
      for (const [wins, losses] of tallies) {
        expect(scoresRead(scores(wins, losses), level, null).p).toBeLessThanOrEqual(level);
        expect(scoresRead(scores(wins - 1, losses), level, null).p).toBeGreaterThan(level);
      }
      // The production's list of clearing tallies is the same, as far as twelve or fifteen tasks hold.
      const fits = clearing(level === 0.02 ? 15 : 12, level).map(({ wins, losses }) => [wins, losses]);
      expect(fits).toStrictEqual(tallies.map(([wins, losses]) => [wins, losses]));
    }
  });

  it("gives the false rate on 24 untied tasks, the sweep and the admission floor at each level", () => {
    const strict = sizeOf(24, 0.02);
    const loose = sizeOf(24, 0.1);
    expect(Math.round(1000 * strict.falseRate) / 10).toBe(1.1);
    expect(Math.round(1000 * loose.falseRate) / 10).toBe(7.6);
    expect([strict.sweep, strict.floor, strict.detectable]).toEqual([6, 8, 0.8]);
    expect([loose.sweep, loose.floor]).toEqual([4, 6]);
    expect(sizeOf(12, 0.02).detectable).toBe(0.87);
  });

  it("reads no step where the bill alone carries the scores past the level", () => {
    const full = scores(6, 0);
    expect(scoresRead(full, 0.02, full).step).toBe(true);
    const billed = scoresRead(full, 0.02, [...scores(5, 0), 0]);
    expect([billed.wins, billed.p <= 0.02, billed.step]).toEqual([6, true, false]);
    expect(scoresRead(full, 0.02, null).step).toBeNull();
    expect(() => scoresRead(full, 0.02, [1])).toThrow();
  });
});

describe("a log's comparisons read again", () => {
  const events: LogEvent[] = [
    START,
    // A step the tree's rule reads as recorded.
    report("g-1", "step", { differences: scores(8, 1), unbilled: scores(8, 1), noise: scores(2, 2) }),
    // A step recorded on the full score, whose unbilled scores do not clear: read otherwise.
    report("g-2", "step", { differences: scores(6, 0), unbilled: [...scores(5, 0), 0] }),
    // Nothing tallied.
    report("g-3", "not-scored", { differences: [], unbilled: [] }),
    // A first report of g-4, then its last, whose A/A loses every task to the other half.
    report("g-4", "step", { differences: scores(6, 0), unbilled: scores(6, 0) }),
    report("g-4", "no-step", { differences: scores(3, 3), unbilled: scores(3, 3), noise: scores(0, 7) }),
    // A report before 26 October holds no unbilled scores.
    report("g-5", "step", { differences: scores(7, 0), unbilled: null }),
  ];
  const rows = rowsOf(events, null, null);
  const bySession = new Map(rows.map((row) => [row.session, row]));

  it("reads each comparison once, by its last report", () => {
    expect(rows.map(({ session }) => session)).toEqual(["g-1", "g-2", "g-3", "g-4", "g-5"]);
    expect(bySession.get("g-4")?.reading).toBe("no-step");
  });

  it("agrees with a recorded step and marks one the bill alone carried", () => {
    expect(bySession.get("g-1")?.reread).toBe("step");
    expect(bySession.get("g-2")?.reread).toBe("no-step");
    expect(bySession.get("g-2")?.unbilled?.wins).toBe(5);
    expect(rows.filter(({ reread, reading }) => reread !== null && reread !== reading).length).toBe(1);
  });

  it("tests nothing where nothing was tallied, and reads no older report again", () => {
    const empty = bySession.get("g-3");
    expect([empty?.scored, empty?.reread, empty?.tallied, empty?.apart.aside]).toEqual([null, null, 0, 1]);
    const older = bySession.get("g-5");
    expect([older?.reread, older?.unbilled, older?.scored?.wins]).toEqual([null, null, 7]);
  });

  it("reads an A/A step in either direction and none where its halves split evenly", () => {
    expect(bySession.get("g-4")?.aa?.either).toBe(true);
    expect(bySession.get("g-1")?.aa?.either).toBe(false);
    expect(bySession.get("g-2")?.aa).toBeNull();
  });

  it("reads every comparison at another level when asked", () => {
    const strict = rowsOf(events, 0.001, "g-1");
    expect(strict.map(({ session, reread }) => [session, reread])).toEqual([["g-1", "no-step"]]);
  });

  it("refuses a comparison the log does not hold, and reads a campaign folder", () => {
    const folder = mkdtempSync(join(tmpdir(), "comparison-reading-"));
    writeFileSync(
      join(folder, LOG_FILE),
      `${events.map((event) => capturedJsonStringify(event)).join("\n")}\n`,
    );
    const whole = runSync([capturedExecPath, script, folder]);
    expect(whole.exitCode).toBe(0);
    const said = decodeOutput(whole.stdout);
    expect(["g-1", "g-2", "g-3", "g-4", "g-5"].every((session) => said.includes(`${session}  `))).toBe(true);
    expect(runSync([capturedExecPath, script, folder, "--comparison", "g-9"]).exitCode).toBe(1);
  });
});

describe("what the next comparison would score", () => {
  /** A task's hidden value, which no line of the draw may carry. */
  const HIDDEN = "hidden-canary-5e4";

  /** A log over a read checker whose Examiner held `held` drafts and released `released`. */
  function exam(held: number, released: number): LogEvent[] {
    const events: LogEvent[] = [];
    const add = (kind: LogEvent["kind"], data: JsonObject) =>
      events.push({ at: `2026-10-30T00:${String(events.length).padStart(2, "0")}:00.000Z`, kind, data });
    add("contract.frozen", { contract: "c1", checker: "k1" });
    add("checker.read", { faults: [] });
    for (let at = 0; at < held + released; at += 1) {
      const [version, taskId] = [`v-${String(at)}`, `task-${String(at)}`];
      add("task.proposed", { version, taskId, task: { taskId, publicInput: {}, hidden: { value: HIDDEN } } });
      add("task.gate", {
        version,
        gate: 1,
        outcome: "passed",
        reference: { valid: 1, solves: 3, billed: 0 },
      });
      add("task.state", { version, state: at < released ? "released" : "held" });
    }
    return events;
  }

  it("draws the available frontier and admits a set at the minimum size", () => {
    const drawn = drawOf(exam(8, 2), 24, "c1");
    expect(drawn.pool).toMatchObject({ scorable: 8, frontier: 8, exhausted: 0, awaiting: 0 });
    expect([drawn.scored, drawn.retained, drawn.epochs]).toStrictEqual([8, 0, 1]);
    expect(drawn.byEpoch).toStrictEqual([{ nth: 1, drawn: 8 }]);
    const lines = drawLines(exam(8, 2), { target: 24, level: 0.02 });
    expect(lines.find((line) => line.startsWith("admission "))).toContain(
      "a floor of 8 frontier tasks; no refusal",
    );
  });

  it("reports held-short below the floor without exposing task data", () => {
    const lines = drawLines(exam(5, 2), { target: 24, level: 0.02 });
    expect(lines.find((line) => line.startsWith("admission "))).toContain("refused held-short");
    for (const canary of [HIDDEN, "task-", "v-"]) expect(lines.join("\n")).not.toContain(canary);
  });
});
