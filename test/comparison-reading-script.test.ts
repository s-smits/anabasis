/**
 * Check sample-size figures against production readers, re-evaluate synthetic comparison
 * reports under the current rules, and draw the next comparison's set. These tests read no
 * campaign logs.
 */
import { describe, expect, it } from "bun:test";
import { drawLines, drawOf } from "#skills/comparison-reading/scripts/draw.ts";
import { sideGap } from "#tools/wri/pairs.ts";
import { scoresRead, sizeOf } from "#skills/comparison-reading/scripts/size.ts";
import { rowsOf, zoneRows } from "#skills/comparison-reading/scripts/reading.ts";
import { epochLine, epochsOf, starterReads } from "../src/campaign/climb.ts";
import { flipP } from "../src/kernel/compare.ts";
import { clearing } from "../src/kernel/size.ts";
import { type EventKind, LOG_FILE, type LogEvent } from "../src/kernel/log.ts";
import { mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined, keyIfNotNull } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { roundSolves } from "./helpers/logged-round.ts";

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

describe("a promotion's starter read, split by what its tasks had been through", () => {
  const gate = (version: string, session?: string): LogEvent[] => [
    {
      at: AT,
      kind: "task.proposed",
      data: {
        version,
        taskId: version,
        task: { taskId: version, family: "fixture", publicInput: {}, hidden: null },
        ...keyIfDefined("session", session),
      },
    },
    { at: AT, kind: "task.gate", data: { version, gate: 1, outcome: "passed" } },
  ];
  const comparison = (
    session: string,
    sides: readonly [string, string],
    outcomes: Readonly<Record<string, string>>,
    tested: { reading: string; differences: readonly number[] },
  ): LogEvent[] => {
    const { events, terms } = roundSolves(session, sides, outcomes);
    const [old, fresh] = sides;
    return [
      { at: AT, kind: "comparison.started", data: { session, old, fresh, starter: STARTER } },
      ...events,
      {
        at: AT,
        kind: "comparison.reported",
        data: {
          session,
          old,
          fresh,
          starter: STARTER,
          level: 0.02,
          reading: tested.reading,
          noise: null,
          scored: set(tested.differences, null),
          ...terms,
        },
      },
    ];
  };
  const chose = Array.from({ length: 7 }, (_, nth) => `chose-${String(nth)}`);
  const log: LogEvent[] = [
    ...[...chose, "undrawn"].flatMap((task) => gate(task)),
    // The reference won its own promotion on seven tasks, from the new side.
    ...comparison("g-1", [STARTER, NEW], Object.fromEntries(chose.map((task) => [task, "FF PP"])), {
      reading: "step",
      differences: scores(7, 0),
    }),
    { at: AT, kind: "harness.promoted", data: { harness: NEW, from: STARTER, rests: [] } },
    ...gate("lost", "x-1"),
    ...gate("tied", "x-2"),
    // Then the starter, on the new side, loses those seven again and the task never drawn, and the
    // reference loses one written since: 8 to 1 clears the level, and 1 to 1 does not.
    ...comparison(
      "g-2",
      [NEW, STARTER],
      {
        ...Object.fromEntries(chose.map((task) => [task, "PP FF"])),
        undrawn: "PP FF",
        lost: "FF PP",
        tied: "PP PP",
      },
      { reading: "step", differences: [...scores(1, 8), 0] },
    ),
  ];

  it("names the read's sides and sets the tasks that chose the harness apart from the rest", () => {
    const [read] = starterReads(log);
    expect(starterReads(log)).toHaveLength(1);
    expect(read).toMatchObject({
      session: "g-2",
      reference: NEW,
      starter: STARTER,
      stored: { wins: 8, losses: 1, ties: 1 },
      confirmed: true,
    });
    expect(read?.origins["read at the promotion"].whole).toEqual({ wins: 7, losses: 0, ties: 0 });
    expect(read?.origins["written before, not chosen on"].whole).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(read?.origins["written after"]).toEqual({
      whole: { wins: 0, losses: 1, ties: 1 },
      validity: { wins: 0, losses: 1, ties: 0 },
      rest: { wins: 0, losses: 0, ties: 1 },
    });
  });

  it("gives each writing session its own tally where one origin holds two sessions' tasks", () => {
    expect(starterReads(log)[0]?.authors).toEqual([
      { session: "the opening exam", tally: { wins: 8, losses: 0, ties: 0 } },
      { session: "x-1", tally: { wins: 0, losses: 1, ties: 0 } },
      { session: "x-2", tally: { wins: 0, losses: 0, ties: 1 } },
    ]);
  });

  it("prints a writing session's tally under its read", () => {
    const folder = mkdtempSync(join(tmpdir(), "starter-reads-"));
    writeFileSync(join(folder, LOG_FILE), `${log.map((event) => capturedJsonStringify(event)).join("\n")}\n`);
    const reads = join(import.meta.dir, "..", ".claude/skills/comparison-reading/scripts/starter-reads.ts");
    const out = decodeOutput(runSync([capturedExecPath, reads, folder]).stdout);
    expect(out).toContain("  written by the opening exam: 8-0-0\n");
    expect(out).toContain("  written by x-1: 0-1-0\n");
    expect(out).toContain("  written by x-2: 0-0-1\n");
  });

  it("reads the tasks written after alone, too few to read a step though the whole tally confirms it", () => {
    expect(starterReads(log)[0]?.after).toBe("too few");
  });

  /** A promotion on the seven chosen tasks, then a starter read of those, of `before` tasks written
   *  before it and drawn only now, and of `after` tasks written after it, each with its outcomes. */
  const logOf = (before: number, after: Readonly<Record<string, string>>): LogEvent[] => {
    const undrawn = Array.from({ length: before }, (_, nth) => `undrawn-${String(nth)}`);
    const outcomes = {
      ...Object.fromEntries([...chose, ...undrawn].map((task) => [task, "PP FF"])),
      ...after,
    };
    return [
      ...[...chose, ...undrawn].flatMap((task) => gate(task)),
      ...comparison("g-1", [STARTER, NEW], Object.fromEntries(chose.map((task) => [task, "FF PP"])), {
        reading: "step",
        differences: scores(7, 0),
      }),
      { at: AT, kind: "harness.promoted", data: { harness: NEW, from: STARTER, rests: [] } },
      ...Object.keys(after).flatMap((task) => gate(task, "x-1")),
      ...comparison("g-2", [NEW, STARTER], outcomes, { reading: "step", differences: scores(7 + before, 0) }),
    ];
  };
  const readOf = (before: number, after: Readonly<Record<string, string>>) =>
    starterReads(logOf(before, after))[0]?.after;
  /** The climb's line of the epoch a log's first promotion opens, with the log's starter reads. */
  const climbLine = (events: readonly LogEvent[]) =>
    epochsOf(events).map((epoch) => epochLine(epoch, undefined, starterReads(events)))[1];
  const six = (outcome: string) =>
    Object.fromEntries(Array.from({ length: 6 }, (_, nth) => [`after-${String(nth)}`, outcome]));

  it("reads a step on six tasks written after and won, and a step for the starter on six lost", () => {
    expect(readOf(0, six("PP FF"))).toBe("a step");
    expect(readOf(0, six("FF PP"))).toBe("a step for the starter");
    expect(readOf(0, { ...six("PP FF"), lost: "FF PP", other: "FF PP" })).toBe("no step");
  });

  it("reads no step from six tasks written before the promotion and won, which leaving out the chosen tasks alone would", () => {
    expect(readOf(6, {})).toBe("too few");
    expect(readOf(6, { lost: "FF PP" })).toBe("too few");
  });

  it("says the tasks written after apart on the climb line with the sessions that wrote them, and nothing where the read held none", () => {
    expect(climbLine(log)).toContain(
      "against the starter 8 won, 1 lost, 1 tied, a step, so its promotion is confirmed, of which 0 won, 1 lost, 1 tied on the tasks 2 Examiner sessions wrote after it, alone too few;",
    );
    expect(climbLine(logOf(0, six("FF PP")))).toContain(
      "of which 0 won, 6 lost, 0 tied on the tasks 1 Examiner session wrote after it, alone a step for the starter;",
    );
    // A read whose every task was written before the promotion has no such slice to say.
    expect(climbLine(logOf(6, {}))).toContain("0 won, 13 lost, 0 tied, no step;");
    // A caller without the reads prints the pooled tally alone, as every line did before.
    expect(epochsOf(log).map((epoch) => epochLine(epoch))[1]).toContain(
      "1 tied, a step, so its promotion is confirmed;",
    );
  });

  it("finds no read before a starter comparison reports, and none in a log with no promotion", () => {
    const promotedAt = log.findIndex(({ kind }) => kind === "harness.promoted");
    expect(starterReads(log.slice(0, promotedAt + 1))).toEqual([]);
    expect(starterReads(log.slice(0, promotedAt))).toEqual([]);
  });

  it("says so and exits clean on a log with no promotion, since the derived readers run it on every log", () => {
    const folder = mkdtempSync(join(tmpdir(), "starter-reads-"));
    const promotedAt = log.findIndex(({ kind }) => kind === "harness.promoted");
    const unpromoted = log.slice(0, promotedAt).map((event) => capturedJsonStringify(event));
    writeFileSync(join(folder, LOG_FILE), `${unpromoted.join("\n")}\n`);
    const reads = join(import.meta.dir, "..", ".claude/skills/comparison-reading/scripts/starter-reads.ts");
    const ran = runSync([capturedExecPath, reads, folder]);
    expect(ran.exitCode).toBe(0);
    expect(decodeOutput(ran.stdout)).toContain("no promotion");
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

  it("tests nothing where nothing was tallied, and reads an older report on the scores it holds", () => {
    const empty = bySession.get("g-3");
    expect([empty?.scored, empty?.reread, empty?.tallied, empty?.apart.aside]).toEqual([null, null, 0, 1]);
    const older = bySession.get("g-5");
    expect([older?.reread, older?.unbilled, older?.scored?.wins]).toEqual(["step", null, 7]);
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
    // These reports tally no pair, so the TSV across logs holds its header alone.
    const zone = runSync([capturedExecPath, script, "--zone", folder, folder]);
    const header = decodeOutput(zone.stdout).trim().split("\n");
    expect([header.length, header[0]?.startsWith("campaign\tcomparison\t")]).toEqual([1, true]);
    expect(runSync([capturedExecPath, script, folder, folder]).exitCode).not.toBe(0);
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

describe("how far a comparison's sides stood from the best on record", () => {
  /** A task whose two solves a side measured these, read by `direction`. */
  const task = (
    name: string,
    direction: "lower" | "higher",
    old: readonly (number | null)[],
    fresh: readonly (number | null)[],
  ) => ({
    task: name,
    old: old.map((one) => one !== null),
    fresh: fresh.map((one) => one !== null),
    objective: { direction, old, fresh },
  });
  const bests = new Map([
    ["low", 100],
    ["high", 200],
    ["zero", 0],
  ]);

  it("reads a reference far from the best and a candidate at it, whichever way the objective runs", () => {
    const pairs = [
      task("low", "lower", [200, 200], [100, 100]),
      task("high", "higher", [100, 100], [200, 200]),
    ];
    expect(sideGap(pairs, "old", bests)).toEqual({ ratio: 2, atBest: 0, read: 2, unread: 0 });
    expect(sideGap(pairs, "fresh", bests)).toEqual({ ratio: 1, atBest: 2, read: 2, unread: 0 });
  });

  it("counts a reference already at the best within the floor, and one just past it as not", () => {
    const at = sideGap([task("low", "lower", [101, 101], [])], "old", bests);
    const past = sideGap([task("low", "lower", [102, 102], [])], "old", bests);
    expect([at.atBest, past.atBest]).toEqual([1, 0]);
  });

  it("leaves out a side with no valid answer, and counts one a ratio cannot read", () => {
    const pairs = [
      task("low", "lower", [null, null], [100, null]),
      task("none", "lower", [100, 100], [100, 100]),
      task("zero", "lower", [100, 100], [100, 100]),
      task("high", "higher", [0, -3], [200, 200]),
    ];
    expect(sideGap(pairs, "old", bests)).toEqual({ ratio: null, atBest: 0, read: 0, unread: 3 });
    expect(sideGap(pairs, "fresh", bests).read).toBe(2);
  });
});

describe("where a comparison's tasks sat for the reference", () => {
  const event = (minutes: number, kind: EventKind, data: JsonObject): LogEvent => ({
    at: new Date(Date.UTC(2026, 9, 31, 0, minutes)).toISOString(),
    kind,
    data,
  });
  const reported = (
    session: string,
    harnesses: readonly [string, string],
    terms: JsonObject,
    more: JsonObject,
  ) =>
    event(9, "comparison.reported", {
      session,
      old: harnesses[0],
      fresh: harnesses[1],
      starter: "h1",
      reading: "no-step",
      scored: { wins: 0, losses: 0, ties: 0 },
      ...terms,
      ...more,
    });
  const held = (...tasks: readonly string[]) =>
    tasks.flatMap((task) => [
      event(0, "task.proposed", { version: task, taskId: task }),
      event(0, "task.gate", { version: task, gate: 1, outcome: "passed" }),
    ]);
  // A verdict for each solve of `events`, in order, carrying its objective.
  const measured = (events: readonly LogEvent[], measures: readonly number[]) =>
    events
      .filter(({ kind }) => kind === "solve.started")
      .map(({ data }, index) =>
        event(8, "verdict", {
          solve: data.solve ?? "",
          kind: "pass",
          answer: {},
          objective: measures[index] ?? 0,
        }),
      );

  it("counts the reference's tasks and what untied them, beside the A/A's untied tasks", () => {
    const outcomes = { all: "PP PP", some: "PF PP", none: "FF PP", neither: "FF FF" };
    const { events, terms } = roundSolves("g-1", ["h1", "h2"], outcomes);
    const noise = { differences: [0, 0.6, -0.6, 0], wins: 1, losses: 1, ties: 2, p: 1 };
    const log = [
      ...held(...Object.keys(outcomes)),
      ...events,
      reported("g-1", ["h1", "h2"], terms, { noise }),
    ];
    expect(zoneRows("c", log)).toEqual([
      [
        "c",
        "g-1",
        "candidate",
        "0",
        "no-step",
        "4",
        "2",
        "1",
        "1",
        "0.38",
        "2",
        "0",
        "2",
        "0.50",
        "2",
        "0.50",
      ],
    ]);
  });

  it("ties a task whose objective points round to nothing, as the comparison's report does", () => {
    const { events, terms } = roundSolves("g-1", ["h1", "h2"], { near: "PP PP" });
    const log = [
      ...held("near"),
      ...events,
      ...measured(events, [100, 112, 106, 106]),
      reported("g-1", ["h1", "h2"], terms, { objective: { direction: "lower" } }),
    ];
    expect(zoneRows("c", log)[0]?.slice(10, 13)).toEqual(["0", "0", "1"]);
  });

  it("calls a task untied on the objective only past its floor, and only with validity tied", () => {
    const { events, terms } = roundSolves("g-1", ["h1", "h2"], { apart: "PP PP" });
    const close = roundSolves("g-2", ["h1", "h2"], { close: "PP PP" });
    const objective = { objective: { direction: "lower" } };
    const log = [
      ...held("apart", "close"),
      ...events,
      ...measured(events, [10, 10, 5, 5]),
      reported("g-1", ["h1", "h2"], terms, objective),
      ...close.events,
      ...measured(close.events, [10, 10, 10.01, 10.01]),
      reported("g-2", ["h1", "h2"], close.terms, objective),
    ];
    const untied = zoneRows("c", log).map((row) => row.slice(10, 13));
    expect(untied).toEqual([
      ["0", "1", "0"],
      ["0", "0", "1"],
    ]);
    // No best is on record for either task, so each side's valid answers are counted and left unread.
    const unread = { ratio: null, atBest: 0, read: 0, unread: 1 };
    expect(rowsOf(log, null, null).map(({ gap }) => gap)).toEqual([
      { old: unread, fresh: unread },
      { old: unread, fresh: unread },
    ]);
  });

  it("names a starter comparison by its sides and its epoch by the promotions before it", () => {
    const { events, terms } = roundSolves("g-1", ["h2", "h1"], { task: "PP PF" });
    const log = [
      ...held("task"),
      event(1, "harness.promoted", { harness: "h2" }),
      ...events,
      reported("g-1", ["h2", "h1"], terms, {}),
    ];
    expect(zoneRows("c", log)[0]?.slice(2, 4)).toEqual(["starter", "1"]);
  });

  it("leaves the A/A blank where a comparison held none, and a comparison that tallied nothing out", () => {
    const { events, terms } = roundSolves("g-1", ["h1", "h2"], { task: "PP PP" });
    const log = [
      ...held("task"),
      ...events,
      reported("g-1", ["h1", "h2"], terms, {}),
      reported("g-2", ["h1", "h2"], terms, { scored: null }),
    ];
    const rows = zoneRows("c", log);
    expect(rows.map((row) => row[1])).toEqual(["g-1"]);
    expect(rows[0]?.slice(14)).toEqual(["", ""]);
    // Without an objective neither comparison has a gap, and one that tallied nothing has no zone.
    const read = rowsOf(log, null, null).map(({ zone, gap }) => [zone === null, gap]);
    expect(read).toEqual([
      [false, null],
      [true, null],
    ]);
  });
});
