#!/usr/bin/env bun

/**
 * One falsifiable prediction per moved variable, frozen before the launch and adjudicated from
 * recorded evidence at close. The ledger is append-only JSONL: freezing writes one `frozen` row
 * whose id is the digest of the prediction core, and adjudication writes a second row naming that
 * id. The ledger alone cannot prove when a row was written or that nobody edited it, so compare the
 * frozen timestamp with the run opening and keep Git history.
 */
import { type ExitWith, exitWith, parseCommandOrDie, requiredOption } from "../../main/cli.ts";
import { sha256 } from "#src/meta/digest.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { dirname, join } from "#src/meta/path.ts";
import { canonicalJson } from "#src/meta/stable-json.ts";

/** `notes/predictions/<runId>.jsonl` in the repository that owns this skill: operator notes, local
 *  and ignored, so a clean clone has no directory until the first freeze makes it. */
export const PREDICTIONS_DIR = join(import.meta.dir, "..", "..", "..", "..", "notes", "predictions");

const DIRECTIONS = ["up", "down", "none"];
/** AGENTS.md resolves a prediction four ways; a run that left the variable untested is `untriggered`. */
const OUTCOMES = ["sufficed", "partial", "refuted", "untriggered"];

export interface PredictionCore {
  claim: string;
  movedVariable: string;
  direction: string;
  falsifier: string;
  source: string;
  run: string | null;
}

/** A `frozen` row carries the core, an `adjudicated` row the outcome and its evidence. */
interface LedgerRow extends Partial<PredictionCore> {
  type: string;
  id: string;
  at: string;
  outcome?: string;
  evidence?: string;
}

export const ledgerPath = (runId: string, dir = PREDICTIONS_DIR): string => join(dir, `${runId}.jsonl`);

export const predictionId = (core: PredictionCore): string => sha256(canonicalJson(core)).slice(0, 16);

/** Every row names its type, id and time; a line that does not is refused with its number rather
 *  than skipped, because a skipped row is a prediction that silently stops being open. */
function readLedger(path: string): LedgerRow[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n");
  return lines.flatMap((line, index) => {
    if (line.trim() === "") return [];
    const row = parseJsonAs<Partial<LedgerRow> | null>(line);
    if (!isString(row?.type) || !isString(row.id) || !isString(row.at)) {
      throw new Error(`${path}:${index + 1}: ledger row lacks a type, id or time`);
    }
    return [{ ...row, type: row.type, id: row.id, at: row.at }];
  });
}

function append(path: string, row: LedgerRow): LedgerRow {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
  return row;
}

/** Freeze one prediction; a byte-identical duplicate is refused, so a claim is frozen once. */
export function freezePrediction(path: string, core: PredictionCore, now: string): LedgerRow {
  if (!DIRECTIONS.includes(core.direction)) {
    throw new Error(`direction must be one of ${DIRECTIONS.join(", ")}`);
  }
  if (!/^[0-9a-f]{7,40}$/.test(core.source)) throw new Error("source must be a git commit hex prefix");
  const id = predictionId(core);
  if (readLedger(path).some((row) => row.type === "frozen" && row.id === id)) {
    throw new Error(`prediction ${id} is already frozen; a claim is frozen exactly once`);
  }
  return append(path, { type: "frozen", id, at: now, ...core });
}

/** Adjudicate one frozen prediction from recorded evidence; a second adjudication is refused. */
export function adjudicatePrediction(
  path: string,
  id: string,
  outcome: string,
  evidence: string,
  now: string,
): LedgerRow {
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(", ")}`);
  const rows = readLedger(path);
  if (!rows.some((row) => row.type === "frozen" && row.id === id)) {
    throw new Error(`no frozen prediction ${id} in ${path}`);
  }
  if (rows.some((row) => row.type === "adjudicated" && row.id === id)) {
    throw new Error(`prediction ${id} is already adjudicated; the ledger is append-only`);
  }
  return append(path, { type: "adjudicated", id, at: now, outcome, evidence });
}

/** Each frozen row with its outcome, or `open` while no adjudication names it. */
export function ledgerView(
  path: string,
): Array<LedgerRow & { outcome: string; adjudicatedAt: string | null }> {
  const rows = readLedger(path);
  const verdicts = new Map(rows.filter((row) => row.type === "adjudicated").map((row) => [row.id, row]));
  return rows
    .filter((row) => row.type === "frozen")
    .map((row) => {
      const verdict = verdicts.get(row.id);
      return {
        ...row,
        outcome: verdict?.outcome ?? "open",
        adjudicatedAt: verdict?.at ?? null,
      };
    });
}

if (import.meta.main) {
  const die: ExitWith = exitWith("prediction.ts");
  const ledger = ["run", "ledger"];
  const { command, single } = parseCommandOrDie(die, {
    freeze: { values: [...ledger, "claim", "moved-variable", "direction", "falsifier", "source"] },
    adjudicate: { values: [...ledger, "id", "outcome", "evidence"] },
    list: { values: ledger },
  });
  const required = requiredOption(die, single);
  // Every command reads or writes one ledger: the run's, unless a path is given outright.
  const path =
    single.get("ledger") ?? ledgerPath(single.get("run") ?? die("give --run <runId> or --ledger <path>"));
  const now = new Date().toISOString();
  try {
    if (command === "freeze") {
      const core: PredictionCore = {
        claim: required("claim"),
        movedVariable: required("moved-variable"),
        direction: required("direction"),
        falsifier: required("falsifier"),
        source: required("source"),
        run: single.get("run") ?? null,
      };
      console.log(`frozen ${freezePrediction(path, core, now).id}`);
    } else if (command === "adjudicate") {
      const id = required("id");
      const outcome = required("outcome");
      adjudicatePrediction(path, id, outcome, required("evidence"), now);
      console.log(`adjudicated ${id}: ${outcome}`);
    } else {
      for (const row of ledgerView(path)) {
        console.log(
          `${row.id} [${row.outcome}] ${row.claim} (moved: ${row.movedVariable}, ${row.direction}; source ${row.source})`,
        );
      }
    }
  } catch (error) {
    die(errorMessage(error));
  }
}
