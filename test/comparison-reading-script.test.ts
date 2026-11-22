/**
 * Check sample-size figures against production readers, re-evaluate synthetic comparison
 * reports under the current rules, and draw the next comparison's set. These tests read no
 * campaign logs.
 */
import { describe, expect, it } from "bun:test";
import { drawLines } from "#skills/comparison-reading/scripts/draw.ts";
import { flipP } from "../src/kernel/compare.ts";
import { LOG_FILE, type LogEvent } from "../src/kernel/log.ts";
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

describe("what the next comparison would score", () => {
  /** A task's hidden value, which no line of the draw may carry. */
  const HIDDEN = "hidden-canary-5e4";

  /** A log over a read checker whose Examiner held `held` drafts and released `released`, each task
   *  of the family `familyOf` names for its place, or of none. */
  function exam(held: number, released: number, familyOf?: (at: number) => string | undefined): LogEvent[] {
    const events: LogEvent[] = [];
    const add = (kind: LogEvent["kind"], data: JsonObject) =>
      events.push({ at: `2026-10-30T00:${String(events.length).padStart(2, "0")}:00.000Z`, kind, data });
    add("contract.frozen", { contract: "c1", checker: "k1" });
    add("checker.read", { faults: [] });
    for (let at = 0; at < held + released; at += 1) {
      const [version, taskId] = [`v-${String(at)}`, `task-${String(at)}`];
      const task = {
        taskId,
        ...keyIfDefined("family", familyOf?.(at)),
        publicInput: {},
        hidden: { value: HIDDEN },
      };
      add("task.proposed", { version, taskId, task });
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

  it("reports held-short below the floor without exposing task data", () => {
    const lines = drawLines(exam(5, 2), { target: 24, level: 0.02 });
    expect(lines.find((line) => line.startsWith("admission "))).toContain("refused held-short");
    for (const canary of [HIDDEN, "task-", "v-"]) expect(lines.join("\n")).not.toContain(canary);
  });
});
