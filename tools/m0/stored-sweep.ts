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
import { backends } from "#src/backends/models.ts";
import { dollars, freezePrices, type PriceTable } from "#src/kernel/meter.ts";
import type { Counted } from "#src/kernel/solve.ts";
import type { Verdict } from "#src/kernel/verify.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";

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
  /** v1's verdict, as the new verifier would spell it. */
  readonly expected: Verdict;
  /** How the solve ended, as this host types it. */
  readonly ending: Counted;
  readonly turns: readonly StoredTurn[];
}

/** A row and its two dollar readings. */
interface Priced {
  readonly row: Row;
  readonly billed: number;
  readonly metered: number;
}

const VERIFIED = new Set(["verified-pass", "verified-fail"]);

/** The rows v1's verifier decided, and how many it did not (unaccepted, over budget, a non-result). */
export function sweepRows(root: string, sweep: string) {
  const lines = readFileSync(join(root, "grades", sweep, "grades.tsv"), "utf8")
    .trim()
    .split("\n")
    .slice(1);
  const rows: Row[] = [];
  let apart = 0;
  for (const line of lines) {
    const [number = "", taskId = "", kind = "", blocking = ""] = line.split("\t");
    if (!VERIFIED.has(kind)) {
      apart += 1;
      continue;
    }
    const expected: Verdict =
      kind === "verified-pass"
        ? { kind: "pass" }
        : { kind: "fail", blocking: blocking.split(",").filter(Boolean) };
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
      ending: endingOf(stored, turns, expected),
      turns,
    });
  }
  return { rows, apart };
}

/** A stored solve's ending. v1 recorded no kinds, so they are read back from what the solve left. */
function endingOf(stored: StoredSolve, turns: readonly StoredTurn[], expected: Verdict): Counted {
  if (expected.kind === "pass") return { outcome: "pass" };
  if (stored.timedOut || turns.some((turn) => turn.status === "open")) {
    return { outcome: "fail", kind: "wall-ended" };
  }
  if (!stored.answerPresent || !stored.answerParses) return { outcome: "fail", kind: "no-answer" };
  return { outcome: "fail", kind: "rejected" };
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

/** The list prices of the models the rows ran, frozen from the backends this system runs on. */
function rowPrices(rows: readonly Row[]): PriceTable {
  const models = backends();
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
