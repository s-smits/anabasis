/**
 * A v1 cycle sweep as its run left it on disk: `grades/<sweep>/grades.tsv` for the verdicts,
 * `runs/<sweep>/cNN/<task>/result.json` for the solve, and the case's `trace.json` for its turns.
 * The milestone tools test the new host on these stored solves, so no model session is needed.
 *
 * Dollars come two ways. Billed is what v1 recorded Claude Code reporting a turn cost. Metered is
 * this meter's, which charges cached input at the full price. v1's trace keeps each turn's input
 * with its cached part inside and no split, so billed cannot be recomputed from it; metered needs
 * no split, since it charges the classes alike.
 */
import { claudeExecutable, SWEEP_COMPACT_WINDOW } from "#src/backends/claude.ts";
import { backends } from "#src/backends/models.ts";
import { dollars, freezePrices, type PriceTable } from "#src/kernel/meter.ts";
import type { Ending } from "#src/kernel/solve.ts";
import type { Verdict } from "#src/kernel/verify.ts";
import { cpSync, existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, join } from "#src/meta/path.ts";

/** The fields of v1's `cycle-solve/v1` result read here. */
interface StoredSolve {
  readonly provider: string;
  readonly model: string;
  /** Whether the outer timeout ended the run. The harness's own wall, inside it, leaves a turn open. */
  readonly timedOut: boolean;
  readonly answerPresent: boolean;
  readonly answerParses: boolean;
}

/** The fields of v1's `case-trace/v3` trace read here. A turn the wall cut is left `open`, with its
 *  token counts and cost null: Claude Code reports them only when a turn ends. */
type StoredTurn =
  | {
      readonly status: "ended";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly costUsd: number;
    }
  | { readonly status: "open" };

interface StoredTrace {
  readonly turns: readonly StoredTurn[];
}

export interface Row extends StoredSolve {
  readonly sweep: string;
  /** `cNN`, as the sweep names the cycle's directory. */
  readonly cycle: string;
  readonly taskId: string;
  /** The solve's directory under `runs/`. */
  readonly solve: string;
  /** v1's verdict, as the new verifier would spell it; null when v1's verifier did not decide. */
  readonly expected: Verdict | null;
  /** How the solve ended, as this host types it. */
  readonly ending: Ending;
  readonly turns: readonly StoredTurn[];
}

/** A row and its two dollar readings. */
interface Priced {
  readonly row: Row;
  readonly billed: number;
  readonly metered: number;
}

/** v1's non-result kinds (the sweep's `grade.py`, `solver_kind`), as this host types them. */
const NON_RESULTS: Readonly<Record<string, Extract<Ending, { outcome: "non-result" }>["kind"]>> = {
  "non-result:provider": "refusal",
  "non-result:provider-stall": "refusal",
  "non-result:built": "sandbox-crash",
  "non-result:grader": "verifier",
};

/**
 * Every solve the sweep graded, each typed. v1's verifier decided only some: the rest it graded
 * `unaccepted`, `wall-timeout` or a `non-result:<kind>`, and those are fails and non-results a count
 * by kind must not miss.
 */
export function sweepRows(root: string, sweep: string): Row[] {
  const lines = readFileSync(join(root, "grades", sweep, "grades.tsv"), "utf8")
    .trim()
    .split("\n")
    .slice(1);
  const rows: Row[] = [];
  for (const line of lines) {
    const [number = "", taskId = "", kind = "", blocking = ""] = line.split("\t");
    const expected: Verdict | null =
      kind === "verified-pass"
        ? { kind: "pass" }
        : kind === "verified-fail"
          ? { kind: "fail", blocking: blocking.split(",").filter(Boolean) }
          : null;
    const cycle = `c${number.padStart(2, "0")}`;
    const solve = join(root, "runs", sweep, cycle, taskId);
    const stored = parseJsonAs<StoredSolve>(readFileSync(join(solve, "result.json"), "utf8"));
    const { turns } = parseJsonAs<StoredTrace>(
      readFileSync(join(solve, "harness", "cases", taskId, "trace.json"), "utf8"),
    );
    rows.push({
      ...stored,
      sweep,
      cycle,
      taskId,
      solve,
      expected,
      ending: endingOf(stored, turns, kind, expected),
      turns,
    });
  }
  return rows;
}

/** A stored solve's ending. v1 recorded no fail kinds, so they are read back from what the solve left. */
function endingOf(
  stored: StoredSolve,
  turns: readonly StoredTurn[],
  kind: string,
  expected: Verdict | null,
): Ending {
  if (kind.startsWith("non-result:")) {
    const typed = NON_RESULTS[kind];
    if (typed === undefined) throw new Error(`v1 graded a solve ${kind}, which this reader does not know`);
    return { outcome: "non-result", kind: typed, reason: kind };
  }
  if (expected?.kind === "pass") return { outcome: "pass" };
  if (stored.timedOut || turns.some((turn) => turn.status === "open")) {
    return { outcome: "fail", kind: "wall-ended" };
  }
  if (!stored.answerPresent || !stored.answerParses) return { outcome: "fail", kind: "no-answer" };
  return { outcome: "fail", kind: "rejected" };
}

/** The files of a v1 `correctness-model` that are its battery rather than its check program. */
const BATTERY_FILES = new Set(["tasks.json", "controls.json"]);

/**
 * A v1 bundle's check program, copied to `to` without its battery: the verifier hands a check its
 * whole program, and `tasks.json` and `controls.json` hold every task's hidden values and every
 * control. Returns `to`.
 */
export function checkProgram(bundle: string, to: string): string {
  const filter = (path: string) => !BATTERY_FILES.has(basename(path));
  cpSync(join(bundle, "correctness-model"), to, { recursive: true, filter });
  return to;
}

/**
 * The answer format a solve's record tool took, as v1 recorded it byte for byte in the solve's
 * `built-runtime.json`: the artifact-writer's parameters, which v1 compiled from the brief's prose
 * `artifactSchema` rows (H public-artifact-writer.ts:57-64) and which a v2 contract holds as its
 * answer format.
 */
export function recordedAnswerFormat(row: Row): JsonValue {
  const runtime = parseJsonAs<{
    contractCondition: { tools: { description: string; parameters: JsonValue }[] };
  }>(readFileSync(join(row.solve, "harness", "cases", row.taskId, "built-runtime.json"), "utf8"));
  const writer = runtime.contractCondition.tools.find((tool) =>
    tool.description.startsWith("Role: artifact-writer."),
  );
  if (writer === undefined) throw new Error(`${row.solve} records no artifact-writer`);
  return writer.parameters;
}

/** The answer the solve left, or none when it left no file or one that does not read as JSON. */
export function storedAnswer(row: Row): JsonValue | undefined {
  const path = join(row.solve, "work", "answer.json");
  if (!existsSync(path)) return undefined;
  try {
    return capturedJsonParse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The list prices of the models the rows ran, frozen from the backends this system runs on, set as the
 * sweep ran its Claude solves.
 */
function rowPrices(rows: readonly Row[]): PriceTable {
  const models = backends({
    claude: { executable: claudeExecutable(), compaction: { window: SWEEP_COMPACT_WINDOW }, home: homedir() },
  });
  const named = new Map(rows.map((row) => [`${row.provider}/${row.model}`, row]));
  return freezePrices(
    [...named.values()].map((row) => {
      const model = models.getModel(row.provider, row.model);
      if (model === undefined) throw new Error(`no backend serves ${row.provider}/${row.model}`);
      return model;
    }),
  );
}

/**
 * A stored solve's spend: its billed dollars, as v1 recorded them, and its metered ones. Null when a
 * turn never ended, since what it spent was never reported: that solve's cost is unknown, not zero.
 */
function spend(row: Row, prices: PriceTable) {
  const ended = row.turns.filter((turn) => turn.status === "ended");
  if (ended.length < row.turns.length) return null;
  const sum = (field: "inputTokens" | "outputTokens" | "costUsd") =>
    ended.reduce((total, turn) => total + turn[field], 0);
  const tokens = {
    input: sum("inputTokens"),
    cacheRead: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    output: sum("outputTokens"),
  };
  return { billed: sum("costUsd"), metered: dollars(prices, `${row.provider}/${row.model}`, tokens).metered };
}

/** The rows with both dollar readings, and apart from them the rows whose cost was never reported. */
export function pricedRows(rows: readonly Row[]) {
  const prices = rowPrices(rows);
  const priced: Priced[] = [];
  const unpriced: Row[] = [];
  for (const row of rows) {
    const spent = spend(row, prices);
    if (spent === null) {
      unpriced.push(row);
    } else {
      priced.push({ row, ...spent });
    }
  }
  return { priced, unpriced };
}
