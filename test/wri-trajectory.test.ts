import { describe, expect, test } from "bun:test";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import {
  clockOf,
  gradesIn,
  longestGap,
  ownPrograms,
  trajectoryOf,
  trajectoryText,
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

describe("over the hours", () => {
  const run = (promotions: number[], work: number) => ({
    promotions: promotions.map((hour, nth) => ({
      harness: `h${String(nth)}`,
      hour,
      read: false,
      confirmed: null,
    })),
    work,
  });

  test("the longest gap counts the stretch after the last promotion", () => {
    expect(longestGap(run([1, 2], 10))).toBeCloseTo(8);
    expect(longestGap(run([], 3))).toBeCloseTo(3);
  });
});

describe("grades", () => {
  test("task rows are read among other lines, and a version's row and a word for a grade are passed over", () => {
    const tasks = gradesIn(
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
    expect(tasks.size).toBe(1);
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

  test("a promotion no starter comparison followed reads as never read, apart from one read and missed", () => {
    expect(trajectoryOf("run", events.slice(0, 4), null).promotions[0]?.read).toBe(false);
    expect(trajectoryOf("run", events, null).promotions[0]?.read).toBe(true);
  });

  test("a log that stops inside a comparison says so, and a reported one does not", () => {
    const open = event(1.5, "comparison.started", { session: "g-3", old: BUILT, fresh: BUILT });
    expect(trajectoryOf("run", [...events, open], null).cut).toBe("g-3");
    expect(trajectoryOf("run", events, null).cut).toBeNull();
  });

  test("the second gap is also read without the starter comparisons that sat in it", () => {
    const later = [...events, event(1.5, "harness.promoted", { harness: `c${"0".repeat(63)}` })];
    const text = trajectoryText([{ name: "run", log: "/nowhere/log.jsonl", events: later }], {
      grades: null,
      hours: [1],
    });
    const cells = text
      .split("\n")
      .find((line) => line.startsWith("| run | 11-01"))
      ?.split(" | ");
    // The first promotion at 0.75, the second at 1.5, and a starter comparison of 0.25 between them.
    expect(cells?.slice(9, 11)).toEqual(["1.0", "0.7"]);
  });
});
