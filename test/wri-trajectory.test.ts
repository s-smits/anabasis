import { describe, expect, test } from "bun:test";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import {
  clockOf,
  gradesIn,
  longestGap,
  meanTo,
  ownPrograms,
  qualityOf,
  reachHeld,
  trajectoryOf,
} from "#tools/wri/trajectory.ts";

const HOUR = 3_600_000;
const START = Date.parse("2026-11-01T00:00:00.000Z");
const at = (hours: number) => new Date(START + hours * HOUR).toISOString();
const event = (hours: number, kind: EventKind, data: JsonObject = {}): LogEvent => ({
  at: at(hours),
  kind,
  data,
});

describe("work hours", () => {
  test("a recorded wait that overlaps a silence leaves the clock once", () => {
    const events = [
      event(0, "campaign.opened"),
      event(0.25, "solve.started"),
      event(0.5, "solve.finished"),
      event(0.75, "solve.started"),
      event(1, "campaign.waited", { for: "provider", ms: HOUR }),
      event(1.75, "solve.finished"),
      event(2, "solve.started"),
    ];
    // The hour from 1 to 2 is the provider's, and the silence from 1 to 1.75 lies inside it.
    expect(clockOf(events)(at(2))).toBeCloseTo(1);
  });

  test("a silence of half an hour leaves the clock, and a shorter one stays", () => {
    const events = [
      event(0, "solve.started"),
      event(0.25, "solve.finished"),
      event(1.25, "solve.started"),
      event(1.5, "solve.finished"),
    ];
    expect(clockOf(events)(at(1.5))).toBeCloseTo(0.5);
  });

  test("an hour of steady events stays whole", () => {
    const events = [
      event(0, "solve.started"),
      event(0.25, "solve.finished"),
      event(0.5, "solve.started"),
      event(0.75, "solve.finished"),
      event(1, "solve.started"),
    ];
    expect(clockOf(events)(at(1))).toBeCloseTo(1);
  });
});

describe("what a harness wrote", () => {
  const file = (path: string, bytes = 100) => ({ path, bytes });

  test("programs count and an installed tree does not", () => {
    const own = ownPrograms([
      file("bin/check"),
      file("lib/model.py"),
      file("python/py/lib/os.py"),
      file("pylib/numpy/__init__.py"),
      file("pylib/numpy-2.0.dist-info/RECORD"),
      file("bun/bun", 90_000_000),
    ]);
    expect(own).toEqual(["bin/check", "lib/model.py"]);
  });

  test("a harness's own folder named like a package stays without an install mark", () => {
    expect(ownPrograms([file("lib/numpy/own.py")])).toEqual(["lib/numpy/own.py"]);
  });
});

describe("reach held", () => {
  const grade = (task: string) => ({ easy: 2, hard: 5, ungraded: undefined })[task];

  test("the highest grade where most solves are valid", () => {
    const tasks = new Map([
      ["easy", { valid: 2, results: 2 }],
      ["hard", { valid: 2, results: 2 }],
    ]);
    expect(reachHeld(tasks, grade)).toBe(5);
  });

  test("half is not most, and a single solve is too few", () => {
    const half = new Map([
      ["easy", { valid: 2, results: 2 }],
      ["hard", { valid: 1, results: 2 }],
    ]);
    expect(reachHeld(half, grade)).toBe(2);
    expect(reachHeld(new Map([["hard", { valid: 1, results: 1 }]]), grade)).toBeNull();
  });

  test("an ungraded task reads as unknown, never as held", () => {
    expect(reachHeld(new Map([["ungraded", { valid: 2, results: 2 }]]), grade)).toBeNull();
  });
});

describe("quality", () => {
  test("a broken or fitted version counts 0 whatever it holds", () => {
    expect(qualityOf(1, 6)).toBe(0);
    expect(qualityOf(0, 6)).toBe(0);
  });

  test("the Starter counts its reach beside a soundness of 0, and no reach reads as unknown", () => {
    expect(qualityOf(null, 4)).toBe(2);
    expect(qualityOf(5, 3)).toBe(4);
    expect(qualityOf(5, null)).toBeNull();
  });
});

describe("over the hours", () => {
  const run = (promotions: number[], work: number) => ({
    promotions: promotions.map((hour, nth) => ({ harness: `h${String(nth)}`, hour, confirmed: null })),
    work,
    starter: "s",
  });
  const value = (harness: string | null) => ({ s: 0, h0: 4, h1: 6 })[harness ?? ""] ?? null;

  test("the mean weighs each harness by the hours it was the reference", () => {
    expect(meanTo(run([2, 6], 8), 8, value)).toBeCloseTo((4 * 4 + 6 * 2) / 8);
  });

  test("a run stopped early holds its last reference to the horizon", () => {
    expect(meanTo(run([2], 4), 8, value)).toBeCloseTo((4 * 6) / 8);
  });

  test("a race reads above a slow start early and level with it late", () => {
    const race = run([1], 10);
    const slow = run([6], 10);
    expect(meanTo(race, 4, value)).toBeGreaterThan(meanTo(slow, 4, value) ?? 0);
    expect((meanTo(race, 24, value) ?? 0) - (meanTo(slow, 24, value) ?? 0)).toBeLessThan(
      (meanTo(race, 4, value) ?? 0) - (meanTo(slow, 4, value) ?? 0),
    );
  });

  test("the longest gap counts the stretch after the last promotion", () => {
    expect(longestGap(run([1, 2], 10))).toBeCloseTo(8);
    expect(longestGap(run([], 3))).toBeCloseTo(3);
  });

  test("a stretch with no value leaves the mean unknown", () => {
    expect(meanTo(run([2], 4), 8, () => null)).toBeNull();
  });
});

describe("grades", () => {
  test("rows are read among other lines, and a digest by its first eight characters", () => {
    const { tasks, versions } = gradesIn(
      [
        "## Grade rows",
        "task\trun\tex-1\t4",
        "not a row",
        "version\trun\tabcdef0123456\t5",
        "task\trun\tex-2\tnone",
      ].join("\n"),
    );
    expect(tasks.get("run\tex-1")).toBe(4);
    expect(tasks.has("run\tex-2")).toBe(false);
    expect(versions.get("run\tabcdef01")).toBe(5);
  });
});

describe("a campaign's trajectory", () => {
  const STARTER = "s".repeat(64);
  const BUILT = `b${"0".repeat(63)}`;
  const reported = (hours: number, session: string, old: string, fresh: string, scored: number[]) =>
    event(hours, "comparison.reported", {
      session,
      old,
      fresh,
      starter: STARTER,
      level: 0.02,
      reading: "no-step",
      scored: { differences: scored },
      noise: { differences: [] },
      points: { validity: scored.reduce((sum, one) => sum + one, 0), objective: 0 },
    });
  const events = [
    event(0, "campaign.opened"),
    event(0.25, "comparison.started", { session: "g-1", old: STARTER, fresh: BUILT, starter: STARTER }),
    reported(0.5, "g-1", STARTER, BUILT, [100, 100]),
    event(0.75, "harness.promoted", { harness: BUILT }),
    event(1, "comparison.started", { session: "g-2", old: BUILT, fresh: STARTER, starter: STARTER }),
    reported(1.25, "g-2", BUILT, STARTER, [-50, -50]),
  ];

  test("the lead over the Starter reads the same way whichever side it sat", () => {
    const { readings } = trajectoryOf("run", events, null);
    expect(readings.map(({ lead }) => lead)).toEqual([100, 50]);
  });

  test("a comparison's own hours run from its start to its report", () => {
    expect(trajectoryOf("run", events, null).readings[0]?.took).toBeCloseTo(0.25);
  });

  test("a log with no ending says none, and a promotion carries its hour", () => {
    const run = trajectoryOf("run", events, null);
    expect(run.ending).toBeNull();
    expect(run.promotions[0]?.hour).toBeCloseTo(0.75);
  });
});
