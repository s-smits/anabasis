#!/usr/bin/env bun

/**
 * Read a run's terminal plus campaign-wide claims and promotions and print advisory summaries.
 * The claim and promotion lists are not filtered to the selected run. This script changes no
 * verdict; counts come from those recorded files, and deeper inspection belongs to
 * `bun run outcome`.
 *
 * The advisory set is the measured lesson of the 2026-08-27 campaign audit: a budget-limited
 * terminal is closed evidence, and the predecessor checker threw on it.
 *
 * The contest-saturation advisory was removed on 2026-09-04 with the paired contest itself. A
 * candidate is now adopted on its own admitted battery, so a held promotion is read through its
 * own clauses rather than through a comparison against a current condition.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { PREDICTIONS_DIR, ledgerPath, ledgerView } from "./prediction.mjs";
import { campaignCommandLine, safeguardCounts } from "./status.mjs";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

function readJson(path) {
  try {
    return { value: readJsonFile(path), error: null };
  } catch (error) {
    return { value: null, error: `${path}: ${error.message}` };
  }
}

function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name));
}

/** Refusal clauses of one recorded claim file, tolerant of string and object clause rows. */
export function claimClauses(claim) {
  const clauses = claim?.claim?.clauses;
  if (!Array.isArray(clauses)) return [];
  return clauses.map((row) => (isString(row) ? row : row?.clause)).filter((row) => isString(row));
}

/** A controller run directory is one that holds an opening or a terminal; newest by mtime. */
function runFileMtime(runDir) {
  for (const name of ["terminal.json", "opening.json"]) {
    if (existsSync(join(runDir, name))) return statSync(join(runDir, name)).mtimeMs;
  }
  return null;
}

/** Gather the recorded inputs one advisory pass needs; unreadable files become recorded errors. */
export function readCampaign(campaignDir, runId, predictionsDir = PREDICTIONS_DIR) {
  const controllerDir = join(campaignDir, "controller");
  const runs = existsSync(controllerDir)
    ? readdirSync(controllerDir)
        .filter((name) => runFileMtime(join(controllerDir, name)) !== null)
        .sort((a, b) => runFileMtime(join(controllerDir, a)) - runFileMtime(join(controllerDir, b)))
    : [];
  const run = runId ?? runs.at(-1) ?? null;
  const errors = [];
  const readOptional = (path) => {
    if (!existsSync(path)) return null;
    const result = readJson(path);
    if (result.error !== null) errors.push(result.error);
    return result.value;
  };
  /** Every JSON file under one campaign directory that parses; the rest become recorded errors. */
  const readEvery = (name) => {
    const values = [];
    for (const path of listJsonFiles(join(campaignDir, name))) {
      const result = readJson(path);
      if (result.error === null) values.push(result.value);
      else errors.push(result.error);
    }
    return values;
  };
  const runDir = run === null ? null : join(controllerDir, run);
  const claims = readEvery("claims");
  const promotions = readEvery("promotions");
  const safeguardLog = run === null ? null : join(campaignDir, "safeguards", run, "SAFEGUARDS_LOG.txt");
  return {
    run,
    opening: runDir === null ? null : readOptional(join(runDir, "opening.json")),
    terminal: runDir === null ? null : readOptional(join(runDir, "terminal.json")),
    claims,
    promotions,
    safeguards:
      safeguardLog !== null && existsSync(safeguardLog)
        ? safeguardCounts(readFileSync(safeguardLog, "utf8"))
        : { names: [], malformed: 0 },
    predictions: run === null ? [] : ledgerView(ledgerPath(run, predictionsDir)),
    errors,
  };
}

/** Advisories that hold whether the run is open or closed: fired safeguards and open predictions. */
function evidenceAdvisories(evidence, add) {
  const fired = evidence.safeguards?.names ?? [];
  if (fired.length > 0) {
    add(
      "safeguards",
      "info",
      `safeguards fired: ${fired.map(([name, count]) => `${name} x${count}`).join(", ")} — each line is a lead, never a verdict; decide from recorded rows (bun run outcome --safeguards counts them against the inventory)`,
    );
  }
  const open = (evidence.predictions ?? []).filter((row) => row.outcome === "open");
  if (open.length > 0) {
    add(
      "predictions-open",
      "hold",
      `${open.length} frozen prediction(s) not yet adjudicated: ${open.map((row) => row.id).join(", ")} — adjudicate each (prediction.mjs adjudicate) before choosing the next move`,
    );
  }
}

/** The pure advisory pass over gathered evidence; exported so hostile tests need no filesystem. */
export function buildAdvisories(evidence) {
  const advisories = [];
  const add = (code, level, text) => advisories.push({ code, level, text });
  for (const error of evidence.errors) add("unreadable", "advice", `unreadable recorded file: ${error}`);
  if (evidence.run !== null) evidenceAdvisories(evidence, add);

  if (evidence.run === null) {
    add(
      "terminal",
      "hold",
      "no controller run directory with an opening or terminal found; nothing to close",
    );
    return advisories;
  }
  if (evidence.terminal === null) {
    add(
      "terminal",
      "hold",
      evidence.opening === null
        ? `${evidence.run}: neither opening.json nor terminal.json readable; startup is unconfirmed`
        : `${evidence.run}: opening.json present, terminal.json absent — the run is open or interrupted; do not audit it as complete (bun run triage)`,
    );
    return advisories;
  }

  const terminal = evidence.terminal;
  const abort = terminal.abortClause ?? null;
  add(
    "terminal",
    "info",
    `${evidence.run}: closed terminal, outcome "${terminal.outcome ?? "unstated"}"${abort === null ? "" : `, abortClause "${abort}" — a typed abort is a valid closed terminal, not an error`}`,
  );

  const denominator = terminal.denominator ?? null;
  if (denominator !== null && denominator.state === "absent") {
    add("denominators", "info", "no battery was admitted: no case denominator");
  } else if (denominator !== null && denominator.state === "invalid") {
    add("denominators", "hold", `case denominator invalid: ${denominator.error}`);
  } else if (denominator !== null) {
    add(
      "denominators",
      "info",
      `verified ${denominator.verified}, unaccepted ${denominator.unaccepted}, non-results ${denominator.nonResults} (total ${denominator.total})`,
    );
    if (denominator.verified === 0 && denominator.total > 0) {
      add(
        "zero-verified",
        "advice",
        "zero verified cases: no capability rate or difficulty evidence; inspect unaccepted attempts and typed non-results before choosing the next move",
      );
    }
  }

  if (evidence.claims.length > 0) {
    const refused = evidence.claims.filter((claim) => claim?.claim?.ok === false);
    if (refused.length === evidence.claims.length) {
      const clauses = new Set(refused.flatMap((claim) => claimClauses(claim)));
      add(
        "claims-refused",
        "advice",
        `all ${refused.length} campaign claims refused; clauses: ${[...clauses].sort().join(", ") || "unstated"}`,
      );
    }
  }

  const held = evidence.promotions.filter((row) => row?.decision === "held");
  if (held.length > 0) {
    const clauses = [
      ...new Set(held.flatMap((row) => (row.clauses ?? []).map((clause) => String(clause).split(":")[0]))),
    ].sort();
    add(
      "promotion-held",
      "advice",
      `${held.length} campaign promotion(s) held; clauses: ${clauses.join(", ") || "unstated"} — a candidate is adopted on its own admitted battery; read each promotion's exact identity and clauses`,
    );
  }

  const budget = terminal.providerResourceBudget ?? null;
  if (budget !== null && isNumber(budget.used) && budget.used > 0 && isNumber(budget.byRole?.review)) {
    const share = budget.byRole.review / budget.used;
    if (share > 0.4) {
      add(
        "review-share",
        "advice",
        `review consumed ${budget.byRole.review}/${budget.used} turns (${Math.round(share * 100)}%): before paying the same census again, weigh the measured economics — 2 of 351 review turns changed a decision on the audited campaign`,
      );
    }
  }

  return advisories;
}

function nextCommands(campaignDir, run) {
  return [
    `bun run outcome ${campaignDir} ${run} --scorecard`,
    `bun run outcome ${campaignDir} ${run} --scan`,
    `bun run outcome ${campaignDir} ${run} --judge`,
    `bun run outcome ${campaignDir} ${run} --cases --result fail`,
  ];
}

if (import.meta.main) {
  const values = campaignCommandLine("campaign", "--campaign is required");
  const evidence = readCampaign(values.campaign, values.run);
  const advisories = buildAdvisories(evidence);
  if (values.json) {
    console.log(JSON.stringify({ run: evidence.run, advisories }, null, 2));
    runtimeProcess.exit(0);
  }
  for (const advisory of advisories) console.log(`[${advisory.level}] ${advisory.code}: ${advisory.text}`);
  if (evidence.run !== null && evidence.terminal !== null) {
    console.log("\nnext (from the measured worktree):");
    for (const command of nextCommands(values.campaign, evidence.run)) console.log(`  ${command}`);
  }
  runtimeProcess.exit(0);
}
