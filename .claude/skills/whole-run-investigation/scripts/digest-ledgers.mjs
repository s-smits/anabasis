// Deterministic ledgers the digest appends after its product blocks: which checks the controls
// exercise but measured submissions never fail (lanes 5 and 6), whether the Judge census could be
// valid at all (lane 16), per-family pass counts hidden by one aggregate, whether any battery
// repeated a condition (lane 20), where each battery landed on the band and whether the declared
// target was met (lane 10), which role spent the provider allowance and whether a battery was
// censored by provider non-results (lane 24), whether admitted findings had a repair route and
// whether an advisory finding keeps coming back (lane 14), the Builder memory byte cap (lane 26)
// and served-model attestation.
//
// Each function returns digest lines. They read recorded JSON only, quote no verifier, finding or
// memory text, and print leads with a fixed trigger name the catalogue references: the capitalised
// text before the first colon is what run-overview groups on and brief prints. The lead is
// arithmetic; the semantic verdict stays with the lane that reads it.

import { boundText } from "#src/meta/bounded-text.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import { wilsonInterval } from "#src/claim/estimation.ts";
import { MEMORY_CAP_BYTES, MEMORY_FILE, WORKSPACE_DIR } from "#src/author/builder-memory.ts";
import { isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { authorSessionOwner } from "#src/analyse/finding-owner.ts";
import { DIFFICULTY_DECISION_SCHEMA } from "#src/run/difficulty-decision.ts";
import { EPOCH_REVIEW_SCHEMA } from "#src/review/epoch-review-findings.ts";
import { JUDGE_REVIEWS_SCHEMA } from "#src/analyse/judge-reviews.ts";
import { classifyCaseOutcome, familyTally, outcomeTally } from "#src/claim/case-record.ts";
import { PROVIDER_ALLOWANCE } from "#src/truth/runtime-blocker.ts";
import { controllerRunOfBattery } from "#src/run/controller-battery-record-policy.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { openRecordedRun } from "../../main/run.ts";

export function pad(value, width) {
  const text = String(value);
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

function interval(passes, n) {
  const bounds = wilsonInterval(passes, n);
  return bounds === null ? "[-,-]" : `[${bounds.lower.toFixed(2)},${bounds.upper.toFixed(2)}]`;
}

const minutes = (ms) => Math.round(ms / 6_000) / 10;

// --- 4b: difficulty decisions and band placement ----------------------------------------------
/** The recorded placement of the battery a decision read, or null when the decision placed none. */
function placementOf(decision) {
  const placement = decision?.placement;
  if (!isRecord(placement)) return null;
  const aim = Array.isArray(placement.aim) ? placement.aim : null;
  return {
    passes: isNumber(placement.passes) ? placement.passes : null,
    n: isNumber(placement.n) ? placement.n : null,
    zone: isString(placement.zone) ? placement.zone : null,
    aim: aim?.length === 2 && aim.every(isNumber) ? aim : null,
    toAim: isNumber(placement.toAim) ? placement.toAim : null,
  };
}

/** The readout rows a decision carries, keeping the fields the ledger prints: the battery's counts,
 *  the zone it read and the target it declared with the result the controller recorded against it. */
function readoutRowsOf(counters) {
  return (Array.isArray(counters.rows) ? counters.rows : [])
    .filter((row) => isRecord(row) && isString(row.runId))
    .map((row) => ({
      runId: row.runId,
      passed: isNumber(row.passed) ? row.passed : null,
      verified: isNumber(row.verified) ? row.verified : null,
      zone: isString(row.zone) ? row.zone : null,
      target: isRecord(row.target) ? row.target : null,
    }));
}

/**
 * Difficulty decisions in file order; `runId` on each record names the battery the decision
 * authored, and `evidence[].runId` the batteries it read. `refused` carries one line per record
 * this reader would not open, because the digest is read as an inventory of the run: a battery
 * whose decision predates the current schema would otherwise be indistinguishable from a battery
 * that never had a decision recorded at all, which is the more alarming of the two.
 */
export function readDifficultyDecisions(campaign) {
  const rows = [];
  const refused = [];
  const dir = join(campaign, "difficulty-decisions");
  if (!existsSync(dir)) return { rows, refused };
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()) {
    const record = readJsonFileOrNull(join(dir, name));
    if (record === null) {
      refused.push(`${name}: unreadable`);
      continue;
    }
    if (record.schema !== DIFFICULTY_DECISION_SCHEMA) {
      refused.push(`${name}: ${isString(record.schema) ? record.schema : "no schema"}`);
      continue;
    }
    const counters = isRecord(record.difficulty) ? record.difficulty : null;
    if (counters === null) {
      refused.push(`${name}: ${DIFFICULTY_DECISION_SCHEMA} without a difficulty reading`);
      continue;
    }
    const decision = isRecord(counters.decision) ? counters.decision : {};
    rows.push({
      runId: isString(record.runId) ? record.runId : name,
      action: isString(decision.action) ? decision.action : null,
      placement: placementOf(decision),
      // Where the decision placed the battery it read, repeated at the top level because the
      // check-informativeness block keys its perfect-battery lead on it.
      zone: placementOf(decision)?.zone ?? null,
      allowance: isRecord(counters.allowance) ? counters.allowance : null,
      rows: readoutRowsOf(counters),
      admitted: isNumber(counters.admitted) ? counters.admitted : null,
      excluded: Array.isArray(counters.excluded) ? counters.excluded.length : 0,
      evidenceRunIds: (Array.isArray(decision.evidence) ? decision.evidence : [])
        .map((row) => row?.runId)
        .filter((value) => isString(value)),
    });
  }
  return { rows, refused };
}

/** Which side of the aim a placement sits on: `toAim` is the count the battery has to move by, so a
 *  negative reading is a battery above the aim. A placement without it falls back to the zone. */
function sideOf(placement) {
  if (placement === null) return null;
  if (placement.toAim !== null && placement.toAim !== 0) return placement.toAim < 0 ? "above" : "below";
  if (placement.zone === "too-easy" || placement.zone === "over-aim") return "above";
  if (placement.zone === "under-aim" || placement.zone === "too-hard") return "below";
  return null;
}

function decisionLine(row) {
  const placement = row.placement;
  const head = `${row.runId}: action ${row.action ?? "?"}`;
  const placed =
    placement === null
      ? ""
      : ` ${placement.zone ?? "?"} · ${placement.passes ?? "?"}/${placement.n ?? "?"}` +
        ` aim [${placement.aim === null ? "?" : placement.aim.join(",")}] toAim ${placement.toAim ?? "?"}`;
  const allowance =
    row.allowance === null
      ? ""
      : ` · allowance ${row.allowance.rounds ?? "?"} round(s) ${row.allowance.side ?? "?"} over ${row.allowance.products ?? "?"} product(s)`;
  return `${head}${placed} · admitted ${row.admitted ?? "-"} excluded ${row.excluded}${allowance}`;
}

/** The longest run of consecutive placements on one off-aim side, ending at its last member. */
function offAimStreaks(rows) {
  const streaks = [];
  let current = null;
  for (const row of rows) {
    const side = sideOf(row.placement);
    if (side !== null && current?.side === side) {
      current.runIds.push(row.runId);
      continue;
    }
    if (current !== null && current.runIds.length >= 2) streaks.push(current);
    current = side === null ? null : { side, runIds: [row.runId] };
  }
  if (current !== null && current.runIds.length >= 2) streaks.push(current);
  return streaks;
}

/**
 * Section 4b: one line per decision this reader opened, the declared target of every battery the
 * decisions carry a readout row for, then one line per record it refused. The section reads the
 * placement the controller recorded and never re-derives one, so a lead here disagrees with the
 * controller only when the record does.
 */
export function bandPlacementLines({ rows, refused }) {
  const lines = ["", "## 4b band placement (difficulty decisions)"];
  // Absence proves only that no placement was recorded. The controller may still have chosen
  // build or rebuild, so the digest does not say "never ran"; the controller decision reasons in
  // section 1 say what it chose.
  if (rows.length === 0 && refused.length === 0) {
    lines.push(
      "no recorded difficulty decisions: no placement was recorded; read the controller decision reasons for the selected move",
    );
  }
  for (const row of rows) lines.push(decisionLine(row));
  // Every decision restates the whole readout, so the last decision naming a battery owns its row.
  const targets = new Map();
  for (const row of rows) {
    for (const readout of row.rows) if (readout.target !== null) targets.set(readout.runId, readout);
  }
  for (const readout of targets.values()) {
    const target = readout.target;
    lines.push(
      `  ${readout.runId}: target ${target.comparator ?? "?"} ${target.verifiedPasses ?? "?"} · passed ${readout.passed ?? "?"}/${readout.verified ?? "?"} · ${target.result ?? "?"}`,
    );
    if (target.result === "missed") {
      lines.push(
        `  TARGET MISSED (lane 10): ${readout.runId} declared ${target.comparator ?? "?"} ${target.verifiedPasses ?? "?"} verified passes and measured ${readout.passed ?? "?"}, missed by ${target.missedBy ?? "?"}`,
      );
    }
  }
  for (const streak of offAimStreaks(rows)) {
    lines.push(
      `OFF-AIM STREAK (lane 10): ${streak.runIds.length} consecutive placements ${streak.side} the aim (${streak.runIds.join(", ")})`,
    );
  }
  for (const line of refused) lines.push(`refused, not ${DIFFICULTY_DECISION_SCHEMA} — ${line}`);
  return lines;
}

/** Verified, passed, unaccepted and non-result counts per battery in case-record order, overall and
 *  per family, through the case record's own `outcomeTally` and `familyTally`. The provider count
 *  beside them is the one the censoring lead reads. */
export function batteryTallies(caseRows) {
  const byRun = new Map();
  for (const row of caseRows) byRun.set(row.runId, [...(byRun.get(row.runId) ?? []), row]);
  return [...byRun].map(([runId, rows]) => ({
    runId,
    ...outcomeTally(rows.map(classifyCaseOutcome)),
    providerNonResult: rows.filter(
      (row) => classifyCaseOutcome(row) === "non-result" && row.runtimeNonResultKind === "provider",
    ).length,
    families: familyTally(rows),
  }));
}

// --- 1c: check informativeness ---------------------------------------------------------------
export function checkInformativenessLines({
  checks,
  rejectRows,
  perCheck,
  gradedOracleFiles,
  tallies,
  decisions,
}) {
  const lines = ["", "## 1c check informativeness (controls reach vs shipping trips)"];
  if (checks.length === 0) {
    lines.push("no declared checks");
    return lines;
  }
  lines.push("checkId                    class            rejCtl decoyCls joinTgt shipRej");
  const classes = { "shipping-tested": 0, "reach-only": 0, unreached: 0 };
  for (const check of checks) {
    const isolating = rejectRows.filter((row) => row.expectedCheckId === check.id);
    const shipping = perCheck.get(check.id)?.rejections ?? 0;
    const cls = shipping > 0 ? "shipping-tested" : isolating.length > 0 ? "reach-only" : "unreached";
    classes[cls] += 1;
    const decoys = new Set(isolating.map((row) => row.decoyClass).filter((value) => isString(value)));
    const joins = isolating.filter((row) => isString(row.targetsJoin) && row.targetsJoin.length > 0).length;
    lines.push(
      `${pad(check.id, 27)}${pad(cls, 17)}${pad(isolating.length, 7)}${pad(decoys.size, 9)}${pad(joins, 8)}${shipping}`,
    );
  }
  lines.push(
    `classes over ${gradedOracleFiles} graded rows: shipping-tested ${classes["shipping-tested"]} · reach-only ${classes["reach-only"]} · unreached ${classes.unreached}`,
  );
  // A reach-only check is only a lead: the controls prove the check can fire, and shipping work
  // never made it fire. Whether it constrains a free variable of the design, or only restates
  // what any well-formed submission satisfies, is lane 6's execution question.
  if (classes["reach-only"] > 0 && gradedOracleFiles >= 10) {
    lines.push(
      `REACH-ONLY CHECKS (lane 6): ${classes["reach-only"]} check(s) fire on controls and never on ${gradedOracleFiles} graded rows`,
    );
  }
  // The decision that read this battery placed it over the aim, and the battery still came out
  // perfect: a limit was not measured there, whichever of the two over-aim zones it landed in.
  const overAim = new Set(
    decisions
      .filter((decision) => decision.zone === "too-easy" || decision.zone === "over-aim")
      .map((decision) => decision.runId),
  );
  const perfect = tallies.filter(
    (tally) => overAim.has(tally.runId) && tally.verified > 0 && tally.passed === tally.verified,
  );
  if (perfect.length > 0) {
    lines.push(
      `PERFECT BATTERY OVER AIM (lane 5): ${perfect.map((tally) => `${tally.runId} ${tally.passed}/${tally.verified}`).join(", ")}`,
    );
  }
  lines.push(
    "margins: not recorded — verifier rows carry pass/fail receipts only; a margin distribution needs lane 5's own execution",
  );
  return lines;
}

// --- 2b: Judge census -------------------------------------------------------------------------
/**
 * The run's recorded Judge reviews, one per `analysis/<runId>-judges.json`, in name order. The
 * writer (`runJudgeReviews`) records `JUDGE_REVIEWS_SCHEMA` and nothing else, so a record under any
 * other schema is refused by name rather than read field by field: it predates the census and
 * `contested` shapes both readers of this function take as written.
 */
export function readJudgeReviews(campaign) {
  const rows = [];
  const refused = [];
  const dir = join(campaign, "analysis");
  if (!existsSync(dir)) return { rows, refused };
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith("-judges.json"))
    .sort()) {
    const record = readJsonFileOrNull(join(dir, name));
    if (
      record?.schema !== JUDGE_REVIEWS_SCHEMA ||
      !isString(record.runId) ||
      !Array.isArray(record.contested)
    ) {
      refused.push(`${name}: ${isString(record?.schema) ? record.schema : "unreadable or no schema"}`);
      continue;
    }
    rows.push(record);
  }
  return { rows, refused };
}

/** Judge/verifier disagreement per battery, from the census each review records, with the vetoes
 *  the review's exit counted. The census holds no controls by construction — `src/truth/judge.ts`
 *  records no control count — so this block reads the battery subjects offered alone. */
export function judgeCensusLines({ judgeReviews }) {
  const lines = ["", "## 2b judge census (analysis/*-judges.json)"];
  const { rows, refused } = judgeReviews;
  if (rows.length === 0 && refused.length === 0) {
    lines.push("no judge census recorded: lane 16 has no census to read");
    return lines;
  }
  let withDisagreement = 0;
  for (const judges of rows) {
    // `census` is null when the battery recorded none; the review still records its exit.
    const evidence = judges.census?.evidence ?? null;
    const exit = judges.exit ?? {};
    const vetoes = isNumber(exit.vetoed) ? ` · vetoes ${exit.vetoed}` : "";
    if (evidence === null) {
      lines.push(`${judges.runId}: no census recorded · exit ${exit.kind ?? "?"}${vetoes}`);
      continue;
    }
    const battery = isNumber(evidence.offered) ? evidence.offered : null;
    const disagreements = isNumber(evidence.disagreements) ? evidence.disagreements : null;
    const denominator = isNumber(evidence.disagreementDenominator) ? evidence.disagreementDenominator : null;
    if ((disagreements ?? 0) > 0) withDisagreement += 1;
    lines.push(
      `${judges.runId}: judge ${evidence.judge ?? "?"} · census battery ${battery ?? "?"}` +
        ` · disagreements ${disagreements ?? "?"}/${denominator ?? "?"} · exit ${exit.kind ?? "?"}${vetoes}`,
    );
  }
  for (const line of refused) lines.push(`refused, not ${JUDGE_REVIEWS_SCHEMA} — ${line}`);
  lines.push(
    withDisagreement > 0
      ? `CENSUS WITH DISAGREEMENT (lane 16): ${withDisagreement} census(es)`
      : "lane 16: no census recorded a Judge/verifier disagreement",
  );
  return lines;
}

// --- 3b: family-wise coverage -----------------------------------------------------------------
export function familyCoverageLines({ tallies }) {
  const lines = ["", "## 3b family-wise coverage (case-record.jsonl, Wilson 95%)"];
  const graded = tallies.filter((tally) => tally.verified > 0);
  if (tallies.length === 0) {
    lines.push("no case rows");
    return lines;
  }
  const leads = [];
  let unobserved = 0;
  for (const tally of tallies) {
    const aggregate = wilsonInterval(tally.passed, tally.verified);
    lines.push(
      `${tally.runId}: ${tally.passed}/${tally.verified} ${interval(tally.passed, tally.verified)} over ${tally.families.size} famil${tally.families.size === 1 ? "y" : "ies"}`,
    );
    for (const [family, bucket] of [...tally.families.entries()].sort()) {
      if (bucket.verified === 0) {
        unobserved += 1;
        lines.push(
          `  ${pad(family, 24)}no verified evidence · unaccepted ${bucket.unaccepted} · non-results ${bucket.nonResults}`,
        );
        continue;
      }
      const familyBounds = wilsonInterval(bucket.passed, bucket.verified);
      const flags = [];
      if (bucket.passed === bucket.verified) flags.push("all-pass");
      if (bucket.passed === 0) flags.push("all-fail");
      if (
        aggregate !== null &&
        familyBounds !== null &&
        tally.families.size > 1 &&
        aggregate.lower > familyBounds.upper
      ) {
        flags.push("AGGREGATE HIDES FAMILY");
        leads.push(
          `${tally.runId} ${family} ${bucket.passed}/${bucket.verified} sits below the aggregate floor ${aggregate.lower.toFixed(2)}`,
        );
      }
      lines.push(
        `  ${pad(family, 24)}${pad(`${bucket.passed}/${bucket.verified}`, 8)}${pad(interval(bucket.passed, bucket.verified), 14)}${flags.join(" ")}`,
      );
    }
  }
  for (let index = 1; index < graded.length; index += 1) {
    const previous = graded[index - 1];
    const current = graded[index];
    for (const [family, bucket] of current.families) {
      const before = previous.families.get(family);
      if (!before || before.verified === 0 || bucket.verified === 0) continue;
      if (before.passed === 0 && bucket.passed === 0) {
        leads.push(
          `FAMILY UNMOVED all-fail: ${family} ${before.passed}/${before.verified} → ${bucket.passed}/${bucket.verified} (${previous.runId} → ${current.runId})`,
        );
      }
      if (before.passed === before.verified && bucket.passed === bucket.verified) {
        leads.push(
          `FAMILY UNMOVED all-pass: ${family} ${before.passed}/${before.verified} → ${bucket.passed}/${bucket.verified} (${previous.runId} → ${current.runId})`,
        );
      }
    }
  }
  if (tallies.every((tally) => tally.families.size === 1)) {
    lines.push("single family per battery: no family axis to cover, unobservable by construction");
  }
  for (const lead of leads) lines.push(lead.startsWith("FAMILY") ? lead : `AGGREGATE HIDES FAMILY: ${lead}`);
  if (unobserved > 0) {
    lines.push(`UNOBSERVED FAMILIES: ${unobserved} battery/family rows have no capability evidence`);
  }
  if (unobserved === 0 && leads.length === 0 && graded.some((tally) => tally.families.size > 1)) {
    lines.push("no family hidden by the aggregate and no family unmoved across consecutive batteries");
  }
  return lines;
}

// --- 3c: repeated-condition census ------------------------------------------------------------
/** Batteries grouped by the task set they measured and the Built pin that solved them. The task
 *  set is the manifest-verified battery's own `bundleSnapshot.taskSetHash`; a battery with no
 *  verified record has no observable task set and is listed apart rather than joined on a blank. */
export function repeatedConditionLines({ caseRows, batteryOf }) {
  const lines = ["", "## 3c repeated-condition census (taskSetHash × backendPin)"];
  const conditions = new Map();
  const unobservable = new Set();
  for (const row of caseRows) {
    const taskSet = batteryOf(row.runId)?.bundleSnapshot?.taskSetHash;
    if (!isString(taskSet)) {
      unobservable.add(row.runId);
      continue;
    }
    const key = [taskSet, row.backendPin ?? "?"].join(" · ");
    const runs = conditions.get(key) ?? new Set();
    runs.add(row.runId);
    conditions.set(key, runs);
  }
  if (conditions.size === 0 && unobservable.size === 0) {
    lines.push("no case rows");
    return lines;
  }
  let repeated = 0;
  for (const [key, runs] of conditions) {
    const [taskSet, pin] = key.split(" · ");
    lines.push(
      `task set ${String(taskSet).slice(0, 9)} · pin ${pin}: ${runs.size} batter${runs.size === 1 ? "y" : "ies"}`,
    );
    if (runs.size > 1) {
      repeated += 1;
      lines.push(`  REPEATED CONDITION (lane 20): ${[...runs].join(", ")}`);
    }
  }
  for (const runId of unobservable) {
    lines.push(`${runId}: task set unobservable — no manifest-verified battery record`);
  }
  if (repeated === 0) {
    lines.push("no repeated battery condition: the stability question is unobservable by construction");
  }
  return lines;
}

// --- 4c: role spend and censoring -------------------------------------------------------------
/** One run through `openRecordedRun`, or the reason its opening or terminal was refused. */
function recordedRunOrRefusal(campaign, runId) {
  try {
    return { run: openRecordedRun(campaign, runId), refusal: null };
  } catch (error) {
    return { run: null, refusal: errorMessage(error) };
  }
}

/**
 * The run's provider spend, from the terminal snapshot the controller reader joined to its
 * opening. The opening snapshot is taken before the first turn, so standing in for a missing
 * terminal it would print a live or cut-short run as having spent nothing of its cap.
 */
function spendLines(run, controller) {
  if (controller.state !== "recorded") {
    return [`${run}: no terminal recorded — provider spend unobservable until the controller settles`];
  }
  const budget = controller.providerResourceBudget?.terminal ?? null;
  if (budget === null) return [`${run}: no provider resource budget recorded`];
  const { byRole: roles, usage } = budget;
  const lines = [
    `${run}: provider turns ${budget.used} of cap ${budget.cap} · builder ${roles.builder} · built ${roles.built} · review ${roles.review}` +
      ` · reported ${usage.reportedTurns} unreported ${usage.unreportedTurns} · tokens ${usage.totalTokens ?? "null"} · costUsd ${usage.costUsd ?? "null"}`,
  ];
  if (roles.review > roles.built) {
    lines.push(`  REVIEW TURNS EXCEED SOLVER TURNS (lane 24): review ${roles.review} > built ${roles.built}`);
  }
  return lines;
}

/** The waits the Builder's transport recorded, one row per retried turn. A row whose reason is the
 *  provider's own allowance clause is the explicit wait AGENTS.md calls an operational interruption;
 *  every other reason is printed as the retry it was, for the lane to investigate. */
function allowanceWaitLines(executions) {
  const lines = [];
  for (const { epoch, file, record } of executions.records) {
    const retries = Array.isArray(record.turnRetries) ? record.turnRetries : [];
    if (retries.length === 0) continue;
    const waited = retries.reduce((sum, row) => sum + (isNumber(row.waitMs) ? row.waitMs : 0), 0);
    lines.push(`${epoch}/${file}: turn retries ${retries.length} · waited ${minutes(waited)} min in total`);
    for (const row of retries) {
      const where = `turn ${row.turn ?? "?"} attempt ${row.attempt}/${row.of} ${row.status}`;
      const wait = `waited ${minutes(row.waitMs)} min`;
      lines.push(
        PROVIDER_ALLOWANCE.test(row.reason)
          ? `  EXPLICIT ALLOWANCE WAIT (lane 24): ${epoch}/${file} ${where} ${wait} (explicit allowance)`
          : `  turn retry: ${epoch}/${file} ${where} ${wait} (other reason; not proof of exhaustion)`,
      );
    }
  }
  return lines;
}

function controllerSpendLines(campaign) {
  const lines = [];
  const controllerDir = join(campaign, "controller");
  const runDirs = existsSync(controllerDir)
    ? readdirSync(controllerDir)
        .map((name) => join(controllerDir, name))
        .filter((path) => existsSync(join(path, "terminal.json")) || existsSync(join(path, "opening.json")))
        .sort()
    : [];
  if (runDirs.length === 0) lines.push("no controller records");
  for (const dir of runDirs) {
    const runId = basename(dir);
    const { run, refusal } = recordedRunOrRefusal(campaign, runId);
    const controllerError = refusal ?? run.controllerError;
    if (controllerError !== null) {
      lines.push(`${runId}: CONTROLLER EVIDENCE REFUSED — ${controllerError}`);
      continue;
    }
    const controller = run.controller;
    lines.push(...spendLines(runId, controller));
    if (controller.state !== "recorded") continue;
    for (const step of controller.absentSteps) {
      lines.push(`  absent step "${boundText(String(step).split(/[—:]/)[0], 40).shown}"`);
    }
    lines.push(`  terminal: ${controller.terminalReason.split(":")[0]}`);
  }
  return lines;
}

/** A battery is censored by the provider-typed non-results its rows record, and by nothing read
 *  out of free text: the writer types the kind, so a row it typed otherwise is not a provider
 *  failure however its message reads. */
function censoringLines({ tallies, batteryOf, decisions }) {
  const lines = [];
  const censored = [];
  for (const tally of tallies) {
    if (tally.providerNonResult === 0) continue;
    const battery = batteryOf(tally.runId);
    const cases = Array.isArray(battery?.cases) ? battery.cases : [];
    const provider = cases.filter((row) => row?.runtimeNonResultKind === "provider");
    const instants = (key) =>
      provider
        .map((row) => row.solver?.[key])
        .filter((value) => isString(value))
        .sort();
    censored.push(tally.runId);
    lines.push(
      `${tally.runId}: graded ${tally.verified} · provider non-results ${tally.providerNonResult}` +
        ` · first ${instants("startedAt")[0] ?? "?"} last ${instants("endedAt").at(-1) ?? "?"}` +
        ` · CENSORED (provider non-results; the typed kind is the evidence, the message is not)`,
    );
  }
  if (censored.length === 0) {
    lines.push("no provider-typed non-results in the case rows; missing rows leave censoring unobservable");
  }
  for (const decision of decisions) {
    const hit = decision.evidenceRunIds.filter((runId) => censored.includes(runId));
    if (hit.length > 0) {
      lines.push(
        `DECISION ON CENSORED BATTERY (lane 24): ${decision.runId} ${decision.action ?? "?"} read ${hit.join(", ")}`,
      );
    }
  }
  return lines;
}

export function roleSpendLines({ campaign, tallies, batteryOf, decisions, executions }) {
  return [
    "",
    "## 4c role spend and censoring (controller terminal, builder turn retries, battery non-results)",
    ...controllerSpendLines(campaign),
    ...allowanceWaitLines(executions ?? { records: [] }),
    ...censoringLines({ tallies, batteryOf, decisions }),
  ];
}

// --- 4d: admission and review ledger ----------------------------------------------------------
function admissionLines(dir, admissions) {
  const lines = [];
  let unrouted = 0;
  let admittedTotal = 0;
  for (const name of admissions) {
    const record = readJsonFileOrNull(join(dir, name));
    const admitted = Array.isArray(record?.admitted) ? record.admitted : [];
    const refused = Array.isArray(record?.refused) ? record.refused : [];
    const owners = new Map();
    for (const finding of admitted) {
      const owner = isString(finding?.proposedOwner) ? finding.proposedOwner : "(none)";
      owners.set(owner, (owners.get(owner) ?? 0) + 1);
    }
    unrouted += owners.get("(none)") ?? 0;
    admittedTotal += admitted.length;
    const feedbackOwners = new Set(
      (Array.isArray(record?.feedback) ? record.feedback : [])
        .map((row) => row?.owner)
        .filter((value) => isString(value)),
    );
    lines.push(
      `${name.replace(/-admission\.json$/, "")}: admitted ${admitted.length} (${[...owners.entries()].map(([owner, count]) => `${owner} ${count}`).join(", ") || "-"})` +
        ` · refused ${refused.length} · feedback owners {${[...feedbackOwners].join(",")}} · policy ${record?.policy ?? "?"}`,
    );
  }
  if (unrouted > 0) {
    lines.push(
      `FINDINGS WITHOUT PROPOSED OWNER (lane 14): ${unrouted} of ${admittedTotal} admitted findings name no owner; the actual route is in admission feedback`,
    );
  }
  return lines;
}

function reviewLines(dir, reviews) {
  const lines = [];
  const recurrence = new Map();
  let unidentified = 0;
  for (const name of reviews) {
    const record = readJsonFileOrNull(join(dir, name));
    const label = name.replace(/-epoch-review\.json$/, "");
    if (record?.schema !== EPOCH_REVIEW_SCHEMA || !Array.isArray(record.findings)) {
      lines.push(`${label}: epoch review refused, not ${EPOCH_REVIEW_SCHEMA}`);
      continue;
    }
    const findings = record.findings.filter((finding) => isRecord(finding));
    // The router decides, not the field: a curriculum finding names no owner and routes to `tests`.
    const unroutable = findings.filter((finding) => authorSessionOwner(finding) === null).length;
    lines.push(
      `${label}: epoch review ${record.status ?? "?"} · findings ${findings.length} · unrouted ${unroutable} · reads ${Array.isArray(record.reads) ? record.reads.length : "?"}`,
    );
    // Recurrence is counted over measured-iteration reviews alone: an authoring checkpoint reads
    // the same bytes a later measured review reads, so counting both would double every finding.
    if (name.startsWith("authoring-")) continue;
    for (const finding of findings) {
      if (finding.severity !== "advisory") continue;
      // A finding recurs under its kind and the declared check it names. One naming no check has
      // no identity here, since a bare artifact root collapses every finding of one kind onto one
      // word.
      if (!isString(finding.checkId)) {
        unidentified += 1;
        continue;
      }
      const key = `${finding.kind} ${finding.checkId}`;
      recurrence.set(key, [...new Set([...(recurrence.get(key) ?? []), label])]);
    }
  }
  for (const [key, labels] of recurrence) {
    if (labels.length < 2) continue;
    lines.push(
      `ADVISORY FINDING RECURS UNROUTED (lane 14): ${key} advisory in ${labels.length} measured reviews (${labels.join(", ")})`,
    );
  }
  if (unidentified > 0) {
    lines.push(`advisory findings naming no check: ${unidentified} (no recurrence identity)`);
  }
  return lines;
}

export function admissionLedgerLines({ campaign }) {
  const lines = ["", "## 4d admission and epoch-review ledger (counts and owners only)"];
  const dir = join(campaign, "analysis");
  const names = existsSync(dir) ? readdirSync(dir).sort() : [];
  const admissions = names.filter(
    (name) => name.endsWith("-admission.json") && name !== "latest-admission.json",
  );
  const reviews = names.filter((name) => name.endsWith("-epoch-review.json"));
  if (admissions.length === 0 && reviews.length === 0) {
    lines.push("no admission or epoch-review records");
    return lines;
  }
  return [...lines, ...admissionLines(dir, admissions), ...reviewLines(dir, reviews)];
}

// --- 4e: builder memory cap -------------------------------------------------------------------
export function builderMemoryLines({ epochDirs }) {
  const lines = ["", `## 4e builder memory (${MEMORY_FILE} bytes vs ${MEMORY_CAP_BYTES}-byte cap)`];
  let found = 0;
  for (const dir of epochDirs) {
    const path = join(dir, WORKSPACE_DIR, MEMORY_FILE);
    if (!existsSync(path)) continue;
    found += 1;
    const bytes = statSync(path).size;
    const text = readFileSync(path, "utf8");
    const curationMarkers = (text.match(/^## /gm) ?? []).length;
    lines.push(`${basename(dir)}: ${bytes} bytes · ${curationMarkers} section heading(s)`);
    if (bytes > MEMORY_CAP_BYTES) {
      lines.push(
        `MEMORY OVER READ CAP (lane 26): ${basename(dir)} the reader keeps the newest ${MEMORY_CAP_BYTES} bytes and drops ${bytes - MEMORY_CAP_BYTES}`,
      );
    }
  }
  if (found === 0) lines.push("no workspace memory file recorded");
  return lines;
}

// --- 5b: served-model attestation -------------------------------------------------------------
/** `runtime-model-identity/v2` is the only identity `pi-session.ts` writes, and the claim's own
 *  census (`inspectIdentity`) reads any other shape as incomplete, so this reader does the same. */
function identityAttestation(identity) {
  if (identity?.schema !== "runtime-model-identity/v2") return { attested: false, model: null };
  const model = identity.provider?.model ?? null;
  const resultId = identity.provider?.resultId ?? null;
  return { attested: isString(model) && isString(resultId), model };
}

export function servedModelLines({ campaign, tallies, batteryOf }) {
  const lines = ["", "## 5b served-model attestation (battery cases[].solver.runtimeIdentities)"];
  if (tallies.length === 0) {
    lines.push("no case rows");
    return lines;
  }
  for (const tally of tallies) {
    const { run } = recordedRunOrRefusal(campaign, controllerRunOfBattery(tally.runId));
    const pinned = run?.opening.modelSlots?.built?.model;
    const configured = isString(pinned) ? pinned : null;
    const battery = batteryOf(tally.runId);
    const cases = Array.isArray(battery?.cases) ? battery.cases : null;
    if (cases === null) {
      lines.push(`${tally.runId}: battery record unavailable — attestation unobservable`);
      continue;
    }
    let attested = 0;
    let unattested = 0;
    let noTurn = 0;
    const served = new Map();
    for (const row of cases) {
      const solver = row?.solver ?? {};
      const identities = Array.isArray(solver.runtimeIdentities) ? solver.runtimeIdentities : [];
      if ((solver.completedTurns ?? 0) === 0 && identities.length === 0) {
        noTurn += 1;
        continue;
      }
      const readings = identities.map(identityAttestation);
      if (readings.length === 0 || !readings.every((reading) => reading.attested)) {
        unattested += 1;
        continue;
      }
      attested += 1;
      for (const reading of readings) served.set(reading.model, (served.get(reading.model) ?? 0) + 1);
    }
    const servedText = [...served.entries()].map(([model, count]) => `${model} ×${count}`).join(", ") || "-";
    lines.push(
      `${tally.runId}: attested ${attested} · unattested ${unattested} · no completed turn ${noTurn} · configured ${configured ?? "?"} · served {${servedText}}`,
    );
    const foreign = [...served.keys()].filter((model) => configured !== null && model !== configured);
    if (foreign.length > 0) {
      lines.push(
        `  SERVED MODEL MISMATCH: provider attested ${foreign.join(", ")} against configured ${configured}`,
      );
    }
    if (unattested > 0) {
      lines.push(
        `  UNATTESTED ROWS: ${unattested} case(s) carry no provider receipt; refuse row-level model comparison for them`,
      );
    }
  }
  return lines;
}
