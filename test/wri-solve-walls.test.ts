import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { bindProductMeasurement } from "../src/run/product-versions.ts";
import type { CaseRecordRow, TracePointer } from "../src/claim/case-record.ts";
import type { NonResultKind } from "../src/claim/record-events.ts";
import { caseRecordRow, writeCaseRecord } from "./helpers/case-record-row.ts";
import { publishProduct } from "./helpers/digest-battery.ts";
import {
  type WallBattery as Battery,
  type WallsReport as Report,
  buildWalls,
  renderWalls,
} from "../.claude/skills/whole-run-investigation/scripts/walls.ts";
import { required } from "./helpers/doubles.ts";
import { CASE_TRACE_SCHEMA } from "../src/backends/trace-capture.ts";

const SLUG = "walls";
const RUN = "run-20260919T000000000Z-aaaaaa";
const OTHER = "run-20260919T060000000Z-bbbbbb";
const CONFIG = [
  "solver:",
  "  solve_seconds: 3600",
  "  shell_command_seconds: 300",
  "gate:",
  "  check_seconds: 600",
  "",
].join("\n");

interface Spec {
  taskId: string;
  minutes: number;
  seconds?: number;
  turns: number | null;
  accepted?: boolean;
  pass?: boolean | null;
  nonResult?: NonResultKind | null;
  errors?: string[];
  /** Bash calls the shell's own timeout cut, written into the case's trace; absent writes none. */
  cuts?: number;
}

const QUICK: Spec = { taskId: "quick", minutes: 6, turns: 1, pass: true };

const PRESSED: Spec[] = [
  {
    taskId: "at-wall",
    minutes: 58,
    turns: 1,
    pass: false,
    errors: ["Pi Built worker exceeded its bounded solve time"],
  },
  { taskId: "passed-at-wall", minutes: 59, turns: 1, pass: true },
  QUICK,
  { taskId: "gave-up", minutes: 9, turns: 1, accepted: false },
  { taskId: "turns", minutes: 20, turns: 4, accepted: false },
  { taskId: "never", minutes: 0, seconds: 5, turns: 0, nonResult: "provider" },
];

/** The verdict fields in the one shape the case-record writer admits for each outcome. */
function verdictOf(spec: Spec): Partial<CaseRecordRow> {
  if (spec.nonResult !== undefined && spec.nonResult !== null) {
    return {
      acceptedSubmit: spec.accepted ?? true,
      truthOk: null,
      pass: null,
      runtimeNonResult: spec.nonResult,
      runtimeNonResultKind: spec.nonResult,
    };
  }
  if (spec.accepted === false) return { acceptedSubmit: false, truthOk: null, pass: false };
  return { acceptedSubmit: true, truthOk: spec.pass ?? false, pass: spec.pass ?? false };
}

afterAll(cleanupScratch);

/** One bash call as the trace records it: an error row keeps its result excerpt. */
const bashCall = (seq: number, excerpt: string | null) => ({
  seq,
  turn: 1,
  toolName: "bash",
  isError: excerpt !== null,
  resultPreview: excerpt ?? "ok",
  resultExcerpt: excerpt,
});

/** A case trace holding `spec.cuts` commands Pi's timer killed, one that failed on its own exit and
 *  one that ran, under the run root the case record's pointer names. */
function trace(runRoot: string, runId: string, spec: Spec): TracePointer {
  const path = `runs/${runId}/cases/${spec.taskId}/trace.json`;
  const cut = "partial output\n\nCommand timed out after 120 seconds";
  const calls = [
    ...Array.from({ length: spec.cuts ?? 0 }, (_, at) => bashCall(at + 1, cut)),
    bashCall(98, "Command exited with code 1"),
    bashCall(99, null),
  ];
  const text = JSON.stringify({
    schema: CASE_TRACE_SCHEMA,
    turns: [],
    toolCalls: calls,
    truncated: false,
    droppedRawEvents: 0,
  });
  mkdirSync(join(runRoot, "runs", runId, "cases", spec.taskId), { recursive: true });
  writeFileSync(join(runRoot, path), text);
  return { path, sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex") };
}

/** A retained product version published the way the controller publishes one, carrying `config`
 *  as its agent/config.yaml, and returned as the directory a battery measuring it runs under. */
function publish(root: string, id: string, config: string): string {
  const source = { repoRoot: root, slug: SLUG, id, acceptedSnapshot: join(root, "accepted", id) };
  return publishProduct(source, {
    "agent/config.yaml": config,
    "correctness-model/evaluator.ts": "export const rule = 1;\n",
    "correctness-model/tasks.json": JSON.stringify([id]),
  });
}

/** One campaign holding each battery's measured product, its case rows and the per-case results. A
 *  battery naming `product` measures the version another battery published, as a task probe does. */
function campaign(
  batteries: { runId: string; config: string | null; product?: string; cases: Spec[] }[],
): string {
  const root = scratchDir("ana-walls-");
  const dir = campaignDir(root, SLUG);
  mkdirSync(dir, { recursive: true });
  const products = new Map<string, string>();
  const rows: CaseRecordRow[] = [];
  for (const battery of batteries) {
    const productId = battery.product ?? battery.runId;
    if (battery.config !== null && !products.has(productId)) {
      products.set(productId, publish(root, productId, battery.config));
    }
    const product = products.get(productId);
    if (product !== undefined) bindProductMeasurement(root, SLUG, battery.runId, product);
    const runRoot = product ?? dir;
    for (const spec of battery.cases) {
      const solverStartedAt = "2026-09-19T10:00:00.000Z";
      const end = Date.parse(solverStartedAt) + spec.minutes * 60_000 + (spec.seconds ?? 0) * 1000;
      const at = { solverStartedAt, solverEndedAt: new Date(end).toISOString() };
      const traces = spec.cuts === undefined ? [] : [trace(runRoot, battery.runId, spec)];
      rows.push(
        caseRecordRow(spec.taskId, "one", { runId: battery.runId, ...verdictOf(spec), ...at, traces }),
      );
      if (spec.turns !== null) {
        const caseDir = join(runRoot, "runs", battery.runId, "cases", spec.taskId);
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
  writeCaseRecord(dir, rows);
  return dir;
}

describe("solve budget against the declared walls", () => {
  it("classes each case by the budget it reached and names the walls the bundle moved", () => {
    const dir = campaign([{ runId: RUN, config: CONFIG, cases: PRESSED }]);
    const report: Report = buildWalls({ campaign: dir });
    const battery = required(report.batteries[0], "the battery");
    expect(battery.walls.settings).toMatchObject({ solveMs: 3_600_000, shellCommandSeconds: 300 });
    expect(battery.walls.moved.map((row) => row.key).sort()).toEqual(["shellCommandSeconds", "solveMs"]);
    // A case short of every wall is reported by what it did — `submitted` or `no-submit` — because
    // no recorded field says a solve that finished and submitted was cut short.
    expect(battery.bounds).toEqual({
      "time-bound": 1,
      "submitted-at-wall": 1,
      submitted: 1,
      "no-submit": 2,
      unstarted: 1,
    });
    expect(battery.outcomes).toEqual({ fail: 1, pass: 2, unaccepted: 2, "non-result": 1 });
    expect(battery.rows.map((row) => [row.taskId, row.bound, row.timeShare])).toEqual([
      ["at-wall", "time-bound", 0.967],
      ["passed-at-wall", "submitted-at-wall", 0.983],
      ["quick", "submitted", 0.1],
      ["gave-up", "no-submit", 0.15],
      ["turns", "no-submit", 0.333],
      ["never", "unstarted", 0.001],
    ]);
    expect(battery.boundedWithoutPass).toEqual(["at-wall"]);
    // Tool calls, not turns: one turn is what an uninterrupted solve records.
    expect(battery.toolCalls).toEqual({ median: 3, max: 12 });
    // Six shares, so the median is the mean of the third and fourth (0.15 and 0.333), not the fourth.
    expect(battery.time.median).toBeCloseTo(0.2415, 6);
    const text: string = renderWalls(report);
    expect(text).toContain(
      "moved from the seeded default: solveMs 7200000 to 3600000, shellCommandSeconds 900 to 300",
    );
    expect(text).toContain("walls: solve 60 min, shell 300 s per command");
    expect(text).toContain("tool calls: median 3, max 12");
    expect(text).not.toContain("turns used");
    // The wall reading quotes the host's own sentence rather than resting on the elapsed share.
    expect(text).toContain(
      'at a wall: at-wall time-bound, 58 min (96.7%), 1 turn(s), 3 tool calls, fail, "Pi Built worker exceeded its bounded solve time"',
    );
    // A pass at the wall is reported at the wall and never as a truncated verdict.
    expect(text).toContain("passed-at-wall submitted-at-wall, 59 min (98.3%), 1 turn(s), 3 tool calls, pass");
    expect(text).toContain("at-wall reached a wall without passing: that verdict rests on a truncated solve");
  });

  it("states plainly when no case came near a wall, and reads the seeded walls when the bundle is gone", () => {
    const dir = campaign([{ runId: RUN, config: null, cases: [QUICK] }]);
    const report: Report = buildWalls({ campaign: dir });
    const battery = required(report.batteries[0], "the battery");
    expect(battery.walls.moved).toEqual([]);
    expect(battery.walls.source).toContain("binds this battery to no retained product");
    expect(battery.rows[0]?.timeShare).toBe(0.05);
    expect(renderWalls(report)).toContain(
      "no case reached a declared wall: this battery's outcomes are not explained by room, though 1 case(s) have no readable trace to show a shell cut",
    );
  });

  // The shell's per-command timeout is a declared wall too, and the one a solve meets most: a case
  // can finish far inside its solve wall with several commands cut, which said nothing reached a wall.
  it("counts the commands the shell wall cut, and stops saying no case reached a wall", () => {
    const dir = campaign([
      {
        runId: RUN,
        config: CONFIG,
        cases: [
          { ...QUICK, cuts: 2 },
          { ...QUICK, taskId: "clean", cuts: 0 },
        ],
      },
    ]);
    const report: Report = buildWalls({ campaign: dir });
    const battery = required(report.batteries[0], "the battery");
    expect(battery.shellCuts).toEqual({ calls: 2, cases: 1, unread: 0 });
    expect(battery.rows.map((row) => [row.taskId, row.shellCuts])).toEqual([
      ["quick", 2],
      ["clean", 0],
    ]);
    const text: string = renderWalls(report);
    expect(text).toContain("shell wall cut: quick 2 command(s), pass");
    expect(text).toContain(
      "no case reached its solve wall, but the shell wall cut 2 command(s) in 1 case(s): room per command is not ruled out",
    );
    expect(text).not.toContain("no case reached a declared wall");
  });

  it("reads a task probe's walls from the product the ledger says it measured, not a directory named after it", () => {
    const dir = campaign([
      { runId: RUN, config: CONFIG, cases: [QUICK] },
      { runId: OTHER, config: null, product: RUN, cases: [{ taskId: "probe", minutes: 30, turns: 4 }] },
    ]);
    const probe: Battery = required(
      buildWalls({ campaign: dir, runId: OTHER }).batteries[0],
      "the probe battery",
    );
    expect(probe.walls.settings).toMatchObject({ solveMs: 3_600_000 });
    expect(probe.walls.source).toBe("the measured product's agent/config.yaml");
    expect(probe.rows.map((row) => [row.taskId, row.timeShare, row.turns])).toEqual([["probe", 0.5, 4]]);
  });

  // No backwards compatibility: a product recorded under the earlier schema is a record, and its
  // config is reported unread rather than parsed around.
  it("reports the walls of a product whose config the current schema refuses as unread", () => {
    const dir = campaign([{ runId: RUN, config: "solver:\n  solve_minutes: 60\n", cases: [QUICK] }]);
    const report: Report = buildWalls({ campaign: dir });
    const battery = required(report.batteries[0], "the battery");
    expect(battery.walls.settings).toBeNull();
    expect(battery.rows.map((row) => [row.bound, row.timeShare])).toEqual([["submitted", null]]);
    expect(renderWalls(report)).toContain("walls: unread; the current schema refuses");
  });

  it("reads the walls of a product an earlier source recorded, which the controller would not continue", () => {
    const dir = campaign([{ runId: RUN, config: CONFIG, cases: [QUICK] }]);
    const manifest = join(dir, "versions", RUN, "version.json");
    writeFileSync(
      manifest,
      readFileSync(manifest, "utf8").replace("product-version/v2", "product-version/v1"),
    );
    const battery: Battery = required(buildWalls({ campaign: dir, runId: RUN }).batteries[0], "the battery");
    expect(battery.walls.settings).toMatchObject({ solveMs: 3_600_000 });
    expect(battery.walls.source).toBe("the measured product's agent/config.yaml");
  });

  it("selects one battery of several and reports no case row rather than an empty campaign", () => {
    const dir = campaign([
      { runId: RUN, config: CONFIG, cases: PRESSED },
      { runId: OTHER, config: CONFIG, cases: [QUICK] },
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
