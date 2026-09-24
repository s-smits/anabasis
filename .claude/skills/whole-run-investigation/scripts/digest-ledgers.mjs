// Deterministic ledgers added to the digest on 2026-09-08, after the lane audit over 55 archives
// found the same facts hand-counted in model sessions review after review: which checks the
// controls exercise but measured submissions never fail (angle 5/27), whether the Judge census could be valid at
// all (angle 2), per-family pass counts hidden by one aggregate (angle 16), whether any battery
// repeated a condition (angle 18), which role spent the provider allowance and whether a battery
// was censored by explicit exhaustion (angle 28 / row I), whether admitted findings had a repair
// route (angles 9/26), the Builder memory byte cap (angle 24) and served-model attestation (row I).
//
// Each function returns digest lines. They read recorded JSON only, quote no verifier, finding or
// memory text, and print leads with a fixed trigger name the catalogue references. The lead is
// arithmetic; the semantic verdict stays with the primary reviewer.

import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import { wilsonInterval } from "#src/claim/estimation.ts";
import { MEMORY_CAP_BYTES, MEMORY_FILE, WORKSPACE_DIR } from "#src/author/builder-memory.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { authorSessionOwner } from "#src/analyse/finding-owner.ts";
import { DIFFICULTY_DECISION_SCHEMA } from "#src/run/difficulty-decision.ts";
import { JUDGE_REVIEWS_SCHEMA } from "#src/analyse/judge-reviews.ts";
import { classifyCaseOutcome, familyTally, outcomeTally } from "#src/claim/case-record.ts";
import { PROVIDER_ALLOWANCE } from "#src/truth/runtime-blocker.ts";
import { controllerRunOfBattery } from "#src/run/controller-battery-record-policy.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { openRecordedRun } from "../../main/run.ts";

/** AGENTS.md: explicit credit/allowance exhaustion is a normal operational interruption; a generic
 *  429, timeout or crash is not proof of exhaustion and must be investigated as a failure. What
 *  counts as explicit is `PROVIDER_ALLOWANCE`, the clause the controller itself ends authoring
 *  retries on, so this lead cannot call a battery censored on wording the controller would have
 *  investigated. A local copy matched any "credit", "quota" or "exhaust" in a solver's own output. */
const GENERIC_LIMIT = /\b429\b|rate.?limit|too many requests|overloaded/i;

export function exhaustionClass(message) {
  const text = String(message ?? "");
  // The scheduler stops attempting cases after consecutive provider non-results; those rows are
  // marked unattempted. This prefix alone does not establish provider exhaustion.
  if (/^not attempted:/i.test(text)) return "not-attempted";
  if (PROVIDER_ALLOWANCE.test(text)) return "explicit-exhaustion";
  if (GENERIC_LIMIT.test(text)) return "generic-limit";
  return "other";
}

export function pad(value, width) {
  const text = String(value);
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

function interval(passes, n) {
  const bounds = wilsonInterval(passes, n);
  return bounds === null ? "[-,-]" : `[${bounds.lower.toFixed(2)},${bounds.upper.toFixed(2)}]`;
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
    const counters = record.difficulty ?? null;
    if (counters === null) {
      refused.push(`${name}: ${DIFFICULTY_DECISION_SCHEMA} without a difficulty reading`);
      continue;
    }
    rows.push({
      runId: isString(record.runId) ? record.runId : name,
      action: counters.decision?.action ?? null,
      // Where the decision placed the battery it read. `too-easy` is the reading that used to be
      // spelled as the action `climb`, so it is what a climb-shaped trigger asks about now.
      zone: counters.decision?.placement?.zone ?? null,
      admitted: counters.admitted ?? null,
      excluded: Array.isArray(counters.excluded) ? counters.excluded.length : 0,
      evidenceRunIds: (Array.isArray(counters.decision?.evidence) ? counters.decision.evidence : [])
        .map((row) => row?.runId)
        .filter((value) => isString(value)),
    });
  }
  return { rows, refused };
}

/**
 * Section 4b: one line per decision this reader opened, then one line per record it refused. The
 * section used to walk the directory a second time with its own parser, which is how it came to
 * print records the rest of the digest was already refusing — the two readers of one directory
 * disagreed about what counted as a decision, and only this one was on screen.
 */
export function saturationLedgerLines({ rows, refused }) {
  const lines = ["", "## 4b saturation ledger (difficulty decisions)"];
  // Absence proves only that no climb decision was recorded. The selector may still have run and
  // chosen build or rebuild, so the digest does not say "never ran"; the controller decision
  // reasons in section 1 say what it chose.
  if (rows.length === 0 && refused.length === 0) {
    lines.push(
      "no recorded difficulty decisions: no climb decision was recorded; read the controller decision reasons for the selected move",
    );
  }
  for (const row of rows) {
    lines.push(
      `${row.runId}: action ${row.action ?? "?"}${row.zone === null ? "" : ` ${row.zone}`}` +
        ` · admitted ${row.admitted ?? "-"} excluded ${row.excluded}`,
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
  // what any well-formed submission satisfies, is angle 27's execution question.
  if (classes["reach-only"] > 0 && gradedOracleFiles >= 10) {
    lines.push(
      `REACH-ONLY CHECKS (angle 27 trigger): ${classes["reach-only"]} check(s) fire on controls and never on ${gradedOracleFiles} graded rows`,
    );
  }
  // The decision that read this battery called it significantly too easy, and the battery still
  // came out perfect. Until the zones replaced them, the same reading was the action `climb`.
  const climbed = new Set(
    decisions.filter((decision) => decision.zone === "too-easy").map((decision) => decision.runId),
  );
  const perfectAfterClimb = tallies.filter(
    (tally) => climbed.has(tally.runId) && tally.verified > 0 && tally.passed === tally.verified,
  );
  if (perfectAfterClimb.length > 0) {
    lines.push(
      `PERFECT BATTERY AFTER CLIMB (angle 27 trigger): ${perfectAfterClimb.map((tally) => `${tally.runId} ${tally.passed}/${tally.verified}`).join(", ")}`,
    );
  }
  lines.push(
    "margins: not recorded — verifier rows carry pass/fail receipts only; a margin distribution needs angle 27's own execution",
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

/** Judge/verifier disagreement per battery, from the census each review records. The census holds
 *  no controls by construction — `src/truth/judge.ts` records no control count — so this lane reads
 *  the battery subjects offered alone and raises angle 2 on any disagreement. */
export function judgeCensusLines({ judgeReviews }) {
  const lines = ["", "## 2b judge census (analysis/*-judges.json)"];
  const { rows, refused } = judgeReviews;
  if (rows.length === 0 && refused.length === 0) {
    lines.push("no judge census recorded: angle 2 has no opportunity");
    return lines;
  }
  let withDisagreement = 0;
  for (const judges of rows) {
    // `census` is null when the battery recorded none; the review still records its exit.
    const evidence = judges.census?.evidence ?? null;
    if (evidence === null) {
      lines.push(`${judges.runId}: no census recorded · exit ${judges.exit?.kind ?? "?"}`);
      continue;
    }
    const battery = isNumber(evidence.offered) ? evidence.offered : null;
    const disagreements = isNumber(evidence.disagreements) ? evidence.disagreements : null;
    const denominator = isNumber(evidence.disagreementDenominator) ? evidence.disagreementDenominator : null;
    if ((disagreements ?? 0) > 0) withDisagreement += 1;
    lines.push(
      `${judges.runId}: judge ${evidence.judge ?? "?"} · census battery ${battery ?? "?"}` +
        ` · disagreements ${disagreements ?? "?"}/${denominator ?? "?"} · exit ${judges.exit?.kind ?? "?"}`,
    );
  }
  for (const line of refused) lines.push(`refused, not ${JUDGE_REVIEWS_SCHEMA} — ${line}`);
  lines.push(
    withDisagreement > 0
      ? `CENSUS WITH DISAGREEMENT (angle 2 trigger): ${withDisagreement} census(es)`
      : "angle 2: no trigger — no census recorded a Judge/verifier disagreement",
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
    lines.push("single family per battery: no family axis to cover (angle 16 unobservable by construction)");
  }
  for (const lead of leads) lines.push(lead.startsWith("FAMILY") ? lead : `AGGREGATE HIDES FAMILY: ${lead}`);
  if (unobserved > 0) {
    lines.push(`UNOBSERVED FAMILIES: ${unobserved} battery/family rows have no capability evidence`);
  }
  if (unobserved === 0 && leads.length === 0 && graded.some((tally) => tally.families.size > 1)) {
    lines.push(
      "angle 16: no family hidden by the aggregate and no family unmoved across consecutive batteries",
    );
  }
  return lines;
}

// --- 3c: repeated-condition census ------------------------------------------------------------
export function repeatedConditionLines({ caseRows }) {
  const lines = ["", "## 3c repeated-condition census (buildInputsHash × backendPin)"];
  const conditions = new Map();
  for (const row of caseRows) {
    const key = [row.buildInputsHash ?? "?", row.backendPin ?? "?"].join(" · ");
    const runs = conditions.get(key) ?? new Set();
    runs.add(row.runId);
    conditions.set(key, runs);
  }
  if (conditions.size === 0) {
    lines.push("no case rows");
    return lines;
  }
  let repeated = 0;
  for (const [key, runs] of conditions) {
    const [inputs, pin] = key.split(" · ");
    lines.push(
      `inputs ${String(inputs).slice(0, 9)} · pin ${pin}: ${runs.size} batter${runs.size === 1 ? "y" : "ies"}`,
    );
    if (runs.size > 1) {
      repeated += 1;
      lines.push(`  REPEATED CONDITION (angle 18 trigger): ${[...runs].join(", ")}`);
    }
  }
  if (repeated === 0) {
    lines.push(
      "no repeated battery condition: angle 18's stability question is unobservable by construction",
    );
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
    lines.push(
      `  REVIEW TURNS EXCEED SOLVER TURNS (angle 28 trigger): review ${roles.review} > built ${roles.built}`,
    );
  }
  return lines;
}

export function roleSpendLines({ campaign, tallies, batteryOf, decisions }) {
  const lines = ["", "## 4c role spend and censoring (controller terminal, battery non-results)"];
  const controllerDir = join(campaign, "controller");
  const runDirs = existsSync(controllerDir)
    ? readdirSync(controllerDir)
        .map((name) => join(controllerDir, name))
        .filter((path) => existsSync(join(path, "terminal.json")) || existsSync(join(path, "opening.json")))
        .sort()
    : [];
  if (runDirs.length === 0) lines.push("no controller records");
  let explicitExhaustion = 0;
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
      const cls = exhaustionClass(step);
      const head = String(step).split(/[—:]/)[0].trim().slice(0, 40);
      if (cls === "explicit-exhaustion") {
        explicitExhaustion += 1;
        lines.push(
          `  absent step "${head}": EXPLICIT PROVIDER EXHAUSTION — operational interruption, not a harness defect (AGENTS.md)`,
        );
      } else if (cls === "generic-limit") {
        lines.push(
          `  absent step "${head}": generic 429/rate limit — investigate the actual failure; not proof of exhaustion`,
        );
      } else lines.push(`  absent step "${head}": ${cls}`);
    }
    lines.push(`  terminal: ${controller.terminalReason.split(":")[0]}`);
  }
  const censored = [];
  for (const tally of tallies) {
    const battery = batteryOf(tally.runId);
    const cases = Array.isArray(battery?.cases) ? battery.cases : [];
    // Old classifiers missed explicit limits after tool activity. Keep the recorded partition,
    // but inspect provider-origin errors before claiming the battery was not interrupted.
    const limitMessage = (row) =>
      [
        row.runtimeNonResult,
        row.solver?.nonResult?.message,
        ...(Array.isArray(row.solver?.errors) ? row.solver.errors : []),
      ].find((message) => exhaustionClass(message) === "explicit-exhaustion");
    const provider = cases.filter(
      (row) =>
        row?.runtimeNonResultKind === "provider" ||
        (row?.acceptedSubmit !== true && limitMessage(row) !== undefined),
    );
    if (tally.providerNonResult === 0 && provider.length === 0) continue;
    const classes = new Map();
    for (const row of provider) {
      const cls = exhaustionClass(
        limitMessage(row) ?? row.runtimeNonResult ?? row.solver?.nonResult?.message ?? "",
      );
      classes.set(cls, (classes.get(cls) ?? 0) + 1);
    }
    const starts = provider
      .map((row) => row.solver?.startedAt)
      .filter((value) => isString(value))
      .sort();
    const ends = provider
      .map((row) => row.solver?.endedAt)
      .filter((value) => isString(value))
      .sort();
    const explicit = classes.get("explicit-exhaustion") ?? 0;
    const notAttempted = classes.get("not-attempted") ?? 0;
    if (explicit > 0) explicitExhaustion += 1;
    const label =
      explicit > 0 && explicit + notAttempted === provider.length
        ? `CENSORED (explicit exhaustion; ${notAttempted} not attempted after it)`
        : explicit > 0
          ? "CENSORED (mixed: explicit exhaustion and unexplained provider non-results — investigate the rest)"
          : "PROVIDER NON-RESULTS UNEXPLAINED — investigate; a generic failure is not proof of exhaustion";
    censored.push(tally.runId);
    lines.push(
      `${tally.runId}: graded ${tally.verified} · provider non-results ${tally.providerNonResult} (${[...classes.entries()].map(([cls, count]) => `${cls} ${count}`).join(", ") || "battery rows unavailable"})` +
        ` · first ${starts[0] ?? "?"} last ${ends.at(-1) ?? "?"} · ${label}`,
    );
    const mistyped = provider.filter((row) => row.runtimeNonResultKind !== "provider").length;
    if (mistyped > 0) {
      lines.push(
        `  explicit exhaustion outside provider classification: ${mistyped} · recorded grades unchanged`,
      );
    }
  }
  if (censored.length === 0) {
    lines.push(
      "no provider-typed non-results or explicit exhaustion found in available battery rows; missing rows leave censoring unobservable",
    );
  }
  for (const decision of decisions) {
    const hit = decision.evidenceRunIds.filter((runId) => censored.includes(runId));
    if (hit.length > 0) {
      lines.push(
        `DECISION ON CENSORED BATTERY (angle 28 trigger): ${decision.runId} ${decision.action ?? "?"} read ${hit.join(", ")}`,
      );
    }
  }
  if (explicitExhaustion > 0) {
    lines.push(
      "classification: explicit exhaustion censors the denominator; it is not evidence of a harness defect or capability regression",
    );
  }
  return lines;
}

// --- 4d: admission and review ledger ----------------------------------------------------------
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
    const none = owners.get("(none)") ?? 0;
    unrouted += none;
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
  for (const name of reviews) {
    const record = readJsonFileOrNull(join(dir, name));
    const findings = Array.isArray(record?.findings) ? record.findings : [];
    // The router decides, not the field: a curriculum finding names no owner and routes to `tests`.
    const unroutable = findings.filter((finding) => authorSessionOwner(finding).owner === null).length;
    lines.push(
      `${name.replace(/-epoch-review\.json$/, "")}: epoch review ${record?.status ?? "?"} · findings ${findings.length} · unrouted ${unroutable} · reads ${Array.isArray(record?.reads) ? record.reads.length : "?"}`,
    );
  }
  if (unrouted > 0) {
    lines.push(
      `FINDINGS WITHOUT PROPOSED OWNER: ${unrouted} of ${admittedTotal} admitted findings name no owner; angle 26 reads the actual route from feedback before calling them unrouted`,
    );
  }
  return lines;
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
    lines.push(
      `${basename(dir)}: ${bytes} bytes · ${curationMarkers} section heading(s)` +
        (bytes > MEMORY_CAP_BYTES
          ? ` · MEMORY OVER READ CAP (angle 24 trigger): the reader keeps the newest ${MEMORY_CAP_BYTES} bytes and drops ${bytes - MEMORY_CAP_BYTES}`
          : ""),
    );
  }
  if (found === 0) lines.push("no workspace memory file recorded");
  return lines;
}

// --- row I: served-model attestation ----------------------------------------------------------
/** `runtime-model-identity/v2` is the only identity `pi-session.ts` writes, and the claim's own
 *  census (`inspectIdentity`) reads any other shape as incomplete, so this reader does the same. */
function identityAttestation(identity) {
  if (identity?.schema !== "runtime-model-identity/v2") return { attested: false, model: null };
  const model = identity.provider?.model ?? null;
  const resultId = identity.provider?.resultId ?? null;
  return { attested: isString(model) && isString(resultId), model };
}

export function servedModelLines({ campaign, tallies, batteryOf }) {
  const lines = ["", "## 5b served-model attestation (row I: battery cases[].solver.runtimeIdentities)"];
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
