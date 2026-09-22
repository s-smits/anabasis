#!/usr/bin/env bun

/**
 * One falsifiable prediction per moved variable, frozen before the launch and adjudicated from
 * recorded evidence at close. The ledger is append-only JSONL: freezing writes one `frozen` row
 * whose id is the digest of the prediction core, adjudication writes a second row naming that
 * id. This helper appends rather than rewriting rows. Compare the frozen timestamp with the
 * run opening and retain Git history; the ledger alone cannot prove when a supplied timestamp
 * was recorded or that nobody edited the file outside this helper.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { canonicalJson } from "#src/meta/stable-json.ts";

/** The one ledger location: `notes/predictions/<runId>.jsonl` in the repository that owns this
 *  skill. Producer and consumers resolve it here rather than each spelling a path. Until
 *  2026-09-18 the freeze command wrote here while status and closure read a campaign-local
 *  `predictions.jsonl` no producer ever wrote, so a run closed reporting no open predictions while
 *  its frozen rows sat unadjudicated. The campaign tree is controller-owned anyway; the ledger
 *  belongs with the operator's notes, which are local and ignored, so a clean clone has no
 *  directory until the first freeze makes it. */
export const PREDICTIONS_DIR = join(import.meta.dir, "..", "..", "..", "..", "notes", "predictions");

const DIRECTIONS = new Set(["up", "down", "none"]);
const OUTCOMES = new Set(["sufficed", "partial", "refuted", "untriggered", "inconclusive"]);

export function ledgerPath(runId, dir = PREDICTIONS_DIR) {
  return join(dir, `${runId}.jsonl`);
}

export function predictionId(core) {
  return new Bun.CryptoHasher("sha256").update(canonicalJson(core)).digest("hex").slice(0, 16);
}

export function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => capturedJsonParse(line));
}

/** Freeze one prediction; refuses a byte-identical duplicate so a claim is frozen exactly once. */
export function freezePrediction(path, core, now) {
  if (!DIRECTIONS.has(core.direction)) {
    throw new Error(`direction must be one of ${[...DIRECTIONS].join(", ")}`);
  }
  if (!/^[0-9a-f]{7,40}$/.test(core.source)) throw new Error("source must be a git commit hex prefix");
  const id = predictionId(core);
  const rows = readLedger(path);
  if (rows.some((row) => row.type === "frozen" && row.id === id)) {
    throw new Error(`prediction ${id} is already frozen; a claim is frozen exactly once`);
  }
  const row = { type: "frozen", id, at: now, ...core };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
  return row;
}

/** Adjudicate one frozen prediction from recorded evidence; a second adjudication is refused. */
export function adjudicatePrediction(path, id, outcome, evidence, now) {
  if (!OUTCOMES.has(outcome)) throw new Error(`outcome must be one of ${[...OUTCOMES].join(", ")}`);
  const rows = readLedger(path);
  if (!rows.some((row) => row.type === "frozen" && row.id === id)) {
    throw new Error(`no frozen prediction ${id} in ${path}`);
  }
  if (rows.some((row) => row.type === "adjudicated" && row.id === id)) {
    throw new Error(`prediction ${id} is already adjudicated; the ledger is append-only`);
  }
  const row = { type: "adjudicated", id, at: now, outcome, evidence };
  appendFileSync(path, `${JSON.stringify(row)}\n`);
  return row;
}

export function ledgerView(path) {
  const rows = readLedger(path);
  const verdicts = new Map(rows.filter((row) => row.type === "adjudicated").map((row) => [row.id, row]));
  return rows
    .filter((row) => row.type === "frozen")
    .map((row) => ({
      ...row,
      outcome: verdicts.get(row.id)?.outcome ?? "open",
      adjudicatedAt: verdicts.get(row.id)?.at ?? null,
    }));
}

function parseArgs(argv, names) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    const name = key?.startsWith("--") ? key.slice(2) : "";
    if (!names.has(name) || value === undefined || name in values) {
      throw new Error(`unexpected or duplicate argument ${key}`);
    }
    values[name] = value;
  }
  return values;
}

/** Every command reads or writes exactly one ledger: the run's, unless a path is given outright. */
function ledgerOf(values) {
  if (values.ledger !== undefined) return values.ledger;
  if (values.run === undefined) {
    throw new Error("give --run <runId> (its ledger is notes/predictions/<runId>.jsonl) or --ledger <path>");
  }
  return ledgerPath(values.run);
}

function requireArgs(values, names) {
  for (const name of names) if (values[name] === undefined) throw new Error(`missing --${name}`);
}

if (import.meta.main) {
  const [command, ...rest] = runtimeProcess.argv.slice(2);
  const now = new Date().toISOString();
  try {
    if (command === "freeze") {
      const values = parseArgs(
        rest,
        new Set(["ledger", "claim", "moved-variable", "direction", "falsifier", "source", "run"]),
      );
      requireArgs(values, ["claim", "moved-variable", "direction", "falsifier", "source"]);
      const row = freezePrediction(
        ledgerOf(values),
        {
          claim: values.claim,
          movedVariable: values["moved-variable"],
          direction: values.direction,
          falsifier: values.falsifier,
          source: values.source,
          run: values.run ?? null,
        },
        now,
      );
      console.log(`frozen ${row.id}`);
    } else if (command === "adjudicate") {
      const values = parseArgs(rest, new Set(["ledger", "run", "id", "outcome", "evidence"]));
      requireArgs(values, ["id", "outcome", "evidence"]);
      adjudicatePrediction(ledgerOf(values), values.id, values.outcome, values.evidence, now);
      console.log(`adjudicated ${values.id}: ${values.outcome}`);
    } else if (command === "list") {
      const values = parseArgs(rest, new Set(["ledger", "run"]));
      for (const row of ledgerView(ledgerOf(values))) {
        console.log(
          `${row.id} [${row.outcome}] ${row.claim} (moved: ${row.movedVariable}, ${row.direction}; source ${row.source})`,
        );
      }
    } else {
      throw new Error("usage: prediction.mjs freeze|adjudicate|list --run <runId> ...");
    }
  } catch (error) {
    console.error(String(error.message));
    runtimeProcess.exit(1);
  }
}
