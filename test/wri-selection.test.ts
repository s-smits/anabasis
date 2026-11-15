/**
 * The sign draws of a starter read (comparison-reading's `selection.ts`), the per-task rows
 * `starterReads` gives, and what `starter-reads.ts` prints of them. Invented data only.
 */
import { describe, expect, it } from "bun:test";
import { starterReads } from "../src/campaign/climb.ts";
import { flipP, readsStep } from "../src/kernel/compare.ts";
import { LOG_FILE, type LogEvent } from "../src/kernel/log.ts";
import { mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { stepCount } from "#skills/comparison-reading/scripts/selection.ts";
import { roundSolves } from "./helpers/logged-round.ts";

const STARTER = "a".repeat(64);
const NEW = "b".repeat(64);
const AT = "2026-10-30T00:00:00.000Z";

const chose = Array.from({ length: 7 }, (_, nth) => `chose-${String(nth)}`);

/** Every sign draw of the untied `free`, each asked of `readsStep` with `fixed` as scored. */
function brute(fixed: readonly number[], free: readonly number[], level: number): number {
  const untied = free.filter((one) => one !== 0).map(Math.abs);
  let confirm = 0;
  for (let draw = 0; draw < 2 ** untied.length; draw += 1) {
    const signs = untied.map((size, at) => (Math.floor(draw / 2 ** at) % 2 === 1 ? size : -size));
    if (readsStep([...fixed, ...signs], level)) confirm += 1;
  }
  return confirm;
}

/** A fixed pseudo-random sequence of whole margins, some repeated and some zero. */
function margins(count: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const size = [0, 40, 40, 120, 300, 600, 600, 75][state % 8] ?? 0;
    return state % 3 === 0 ? -size : size;
  });
}

describe("how many sign draws of the tasks written after read a step", () => {
  it("agrees with every draw asked of readsStep, at each size brute force reaches", () => {
    for (let free = 0; free <= 14; free += 1) {
      for (const [seed, level] of [
        [free + 1, 0.02],
        [free + 101, 0.1],
      ] as const) {
        const fixed = margins(10, seed * 7);
        const after = margins(free, seed);
        const counted = stepCount(fixed, after, level);
        expect(Number(counted.confirm)).toBe(brute(fixed, after, level));
        expect(counted.draws).toBe(2n ** BigInt(after.filter((one) => one !== 0).length));
      }
    }
  });

  it("keeps a tied task written after a tie in every draw rather than giving it two signs", () => {
    const counted = stepCount([600, 600, 600, 600, 600], [600, 0, 0], 0.02);
    expect([counted.free, counted.draws, counted.confirm]).toEqual([1, 2n, 1n]);
  });

  it("takes the test's threshold over every untied size, not over the fixed tasks' alone", () => {
    // Six fixed wins of 100 read a step alone (1 in 64), but beside one large task lost they do not.
    const fixed = [100, 100, 100, 100, 100, 100];
    expect(readsStep(fixed, 0.02)).toBe(true);
    expect(flipP([...fixed, -900])).toBeGreaterThan(0.02);
    expect(stepCount(fixed, [900], 0.02).confirm).toBe(1n);
  });

  it("counts one draw for a read with no untied task written after, as its other tasks read", () => {
    expect(stepCount([600, 600, 600, 600, 600, 600], [], 0.02)).toEqual({ free: 0, draws: 1n, confirm: 1n });
    expect(stepCount([600, -600], [0, 0], 0.02)).toEqual({ free: 0, draws: 1n, confirm: 0n });
  });
});

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

/** A comparison of `sides` whose solves `outcomes` spells, its report holding `more`. */
function comparison(
  session: string,
  sides: readonly [string, string],
  outcomes: Readonly<Record<string, string>>,
  reading: string,
  more: JsonObject = { level: 0.02 },
): LogEvent[] {
  const { events, terms } = roundSolves(session, sides, outcomes);
  const [old, fresh] = sides;
  return [
    { at: AT, kind: "comparison.started", data: { session, old, fresh, starter: STARTER } },
    ...events,
    {
      at: AT,
      kind: "comparison.reported",
      data: { session, old, fresh, starter: STARTER, reading, noise: null, scored: {}, ...terms, ...more },
    },
  ];
}

const promotion: LogEvent[] = [
  ...chose.flatMap((task) => gate(task)),
  ...comparison("g-1", [STARTER, NEW], Object.fromEntries(chose.map((task) => [task, "FF PP"])), "step"),
  { at: AT, kind: "harness.promoted", data: { harness: NEW, from: STARTER, rests: [] } },
];
const won = Object.fromEntries(chose.map((task) => [task, "PP FF"]));

/** The promotion, then a starter read of the chosen tasks and of `after`, written by its writers. */
function readLog(after: Readonly<Record<string, readonly [string, string]>>, more?: JsonObject): LogEvent[] {
  const outcomes = {
    ...won,
    ...Object.fromEntries(Object.entries(after).map(([task, [spelled]]) => [task, spelled])),
  };
  return [
    ...promotion,
    ...Object.entries(after).flatMap(([task, [, writer]]) => gate(task, writer)),
    ...comparison("g-2", [NEW, STARTER], outcomes, "step", more),
  ];
}

const mixed = readLog({
  "w-0": ["PP FF", "x-1"],
  "w-1": ["PP FF", "x-1"],
  "l-0": ["FF PP", "x-2"],
  "t-0": ["PP PP", "x-2"],
});

describe("a starter read's rows", () => {
  it("gives each scored task its origin, writer and the reference's margin, summing to its origin's tally", () => {
    const [read] = starterReads(mixed);
    const rows = read?.rows ?? [];
    expect(rows.map(({ task, origin, writer }) => [task, origin, writer])).toContainEqual([
      "l-0",
      "written after",
      "x-2",
    ]);
    expect(rows.filter(({ origin }) => origin === "read at the promotion")).toHaveLength(7);
    const after = rows.filter(({ origin }) => origin === "written after");
    expect(after.filter(({ margin }) => margin > 0)).toHaveLength(
      read?.origins["written after"].whole.wins ?? -1,
    );
    expect(after.filter(({ margin }) => margin < 0)).toHaveLength(
      read?.origins["written after"].whole.losses ?? -1,
    );
    expect(read?.levelled).toBe(true);
  });
});

/** What the script prints of `log`, with `flags`. */
function printed(log: readonly LogEvent[], ...flags: string[]): string {
  const folder = mkdtempSync(join(tmpdir(), "starter-reads-"));
  writeFileSync(join(folder, LOG_FILE), `${log.map((event) => capturedJsonStringify(event)).join("\n")}\n`);
  const script = join(import.meta.dir, "..", ".claude/skills/comparison-reading/scripts/starter-reads.ts");
  const ran = runSync([capturedExecPath, script, folder, ...flags]);
  expect(ran.exitCode).toBe(0);
  return decodeOutput(ran.stdout);
}

describe("what starter-reads prints of a read's make-up", () => {
  it("counts the sign draws of the untied tasks written after, and each slice by majority", () => {
    const out = printed(mixed);
    expect(out).toContain("sign draws of the 3 untied tasks written after: ");
    expect(out).toContain("with every one tied, the other tasks alone confirm");
    expect(out).toMatch(/written after, by x-1: 2-0-0; by majority the reference/);
    expect(out).toMatch(/written after, by x-2: 0-1-1; by majority the starter/);
    // The slices are one conversation's batches, so no p across them is printed (lane 31's question).
    expect(out).not.toMatch(/chi-square|\bp 0\.\d/);
  });

  it("tells a read with no task written after from one whose tasks written after all tied", () => {
    expect(printed(readLog({}))).toContain("no task written after was scored; the other tasks alone confirm");
    const tied = printed(readLog({ "t-0": ["PP PP", "x-1"], "t-1": ["FF FF", "x-1"] }));
    expect(tied).toContain("all 2 tasks written after tied, so no sign draw");
    expect(tied).not.toMatch(/NaN|Infinity/);
  });

  it("counts no sign draw where the report records no level, rather than reading one at 0", () => {
    const out = printed(readLog({ "w-0": ["PP FF", "x-1"] }, {}));
    expect(out).toContain("the report records no level, so no sign draw is counted");
    expect(out).toContain("over the 0 reads with a recorded level");
  });

  it("gives one row a task with each solve's ending, a settled wrong pass told from a pass", () => {
    const log = readLog({ "w-0": ["PP FF", "x-1"] });
    const conditions = new Map(
      log.flatMap(({ kind, data }) =>
        kind === "condition.recorded" ? [[data.id, capturedJsonStringify(data.condition)] as const] : [],
      ),
    );
    const wrong = log.find(
      ({ kind, data }) =>
        kind === "solve.started" &&
        data.comparison === "g-2" &&
        (conditions.get(data.condition) ?? "").includes('"task":"w-0"') &&
        (conditions.get(data.condition) ?? "").includes(NEW),
    )?.data.solve;
    const settled = log.map((event) =>
      event.kind === "comparison.reported" && event.data.session === "g-2"
        ? {
            ...event,
            data: { ...event.data, settled: { passes: { [isString(wrong) ? wrong : ""]: "wrong" } } },
          }
        : event,
    );
    const out = printed(settled, "--tasks");
    expect(out).toMatch(
      /w-0 {2}after {2}x-1 {2}(pass settled wrong,pass|pass,pass settled wrong) {2}rejected,rejected/,
    );
  });
});
