#!/usr/bin/env bun
// Validate one four-file WRI archive against the shape `archive-shape.mjs` declares.
//
//   bun validate-archive.mjs --archive <abs archive dir> [--out <abs file outside it>]
//
// A refused archive exits 1; an archive the validator could not read at all exits 2.
import { existsSync, lstatSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isBoolean, isString } from "#src/meta/json-shape.ts";
import { sha256 } from "#src/meta/digest.ts";
import { isAbsolute, relative, resolve } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { SAFEGUARDS_LOG_FILE } from "#src/meta/safeguard.ts";
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { emitReport } from "#skills/main/output.ts";
import {
  ARCHIVE_FILES,
  ARCHIVE_PATHS,
  ARCHIVE_SCHEMA,
  boundIdentity,
  denominatorCounts,
  digestRows,
  FROZEN_PREDICTION_FIELDS,
  identity,
  launchIdentity,
  ledgerProjection,
  lifecycle,
  nonNegativeInt,
  oneOf,
  pointers,
  predictionFrozenHash,
  procedureIdentity,
  REVIEW,
  requiredArray,
  requiredRecord,
  requiredString,
  requiredStrings,
  ROUTE_STATES,
  safeguardReconciliation,
  scanPathFields,
  sectionPointers,
  sourceSafeguardCallers,
  stateEvidence,
  terminalAccounting,
  terminalOutcome,
  verifyPointerFiles,
} from "./archive-shape.mjs";
import {
  ANGLE_COUNT,
  angleNumbers,
  DETERMINISTIC_ROWS,
  DIGEST_VERDICTS,
  GIT_SHA,
  SHA256,
} from "./catalogue-shape.mjs";

/** The runtime log, whose filename is never a safeguard identity. */
const SAFEGUARDS_LOG_STEM = SAFEGUARDS_LOG_FILE.replace(/\.txt$/, "");
const isLogName = (value) => value === SAFEGUARDS_LOG_STEM || value === SAFEGUARDS_LOG_FILE;
const states = (...values) => new Set(values);
const ANGLE_STATES = states(
  "pass",
  "fail",
  "risk",
  "N/A",
  "stale",
  "unobservable",
  "deferred",
  "inconclusive",
);
const SESSION_STATES = states(
  "complete",
  "partial",
  "failed",
  "held",
  "inactive",
  "not-applicable",
  "inconclusive",
);
const PREDICTION_STATUSES = states("sufficed", "partial", "refuted", "untriggered", "inconclusive");
const SAFEGUARD_STATUSES = states("opportunity", "fired", "not-fired", "no-opportunity", "inconclusive");
const RUNTIME_RECEIPT_STATES = states("present", "absent", "not-applicable", "inconclusive");
const RUNTIME_ACTION_STATES = states("diagnostic-only", "routed", "held", "not-applicable", "inconclusive");
const RUNTIME_BACKTRACK_STATES = states("preserved", "not-needed", "required", "inconclusive");
const READINESS_VOCABULARY = states(
  "source-ready-no-level-decisions",
  "source-ready-level-decisions",
  "source-not-ready",
  "unobservable",
);

export class ArchiveValidationError extends Error {
  constructor(issues) {
    super(issues.join("; "));
    this.name = "ArchiveValidationError";
    this.issues = issues;
  }
}

/** A source-relative path that cannot leave the measured worktree or name a hidden file there. */
function safeSourcePath(path) {
  return !isAbsolute(path) && !path.includes("\\") && !path.includes("..") && !path.startsWith(".");
}

/** The bytes of one regular file in the measured worktree, or null when it is absent. */
function measuredFile(identityRow, file) {
  const path = resolve(identityRow.worktree, file);
  return existsSync(path) && lstatSync(path).isFile() ? readFileSync(path) : null;
}

/** Whether the measured worktree carries the safeguard helper a runtime census is derived from. */
function measuredHelperAvailable(identityRow) {
  return Boolean(identityRow?.worktree) && existsSync(resolve(identityRow.worktree, "src/meta/safeguard.ts"));
}

const sameList = (observed, current) => JSON.stringify(observed) === JSON.stringify(current);
const sameSet = (left, right) => left.size === right.size && [...left].every((id) => right.has(id));

/** One ordered list of `{id, state, evidencePointers}` rows, returning the ids it carried. */
function idRows(value, name, issues) {
  return requiredArray(value, name, issues).map((item, index) => {
    const row = requiredRecord(item, `${name}[${index}]`, issues);
    if (!row) return "";
    const id = requiredString(row.id, `${name}[${index}].id`, issues);
    requiredString(row.state, `${name}[${index}].state`, issues);
    pointers(row.evidencePointers, `${name}[${index}].evidencePointers`, issues);
    return id;
  });
}

function angleRow(value, index, identityRow, issues) {
  const label = `angleStates[${index}]`;
  const row = requiredRecord(value, label, issues);
  if (!row) return 0;
  if (!Number.isInteger(row.angle)) issues.push(`${label}.angle must be an integer`);
  oneOf(row.state, `${label}.state`, ANGLE_STATES, issues);
  requiredString(row.session, `${label}.session`, issues);
  oneOf(row.mode, `${label}.mode`, states("targeted", "exhaustive"), issues);
  const angleIdentity = requiredRecord(row.identity, `${label}.identity`, issues);
  if (angleIdentity) boundIdentity(angleIdentity, `${label}.identity`, identityRow, issues);
  const denominator = requiredRecord(row.denominator, `${label}.denominator`, issues);
  if (denominator) {
    const denominatorStates = states("recorded", "absent", "unknown", "inconclusive");
    oneOf(denominator.state, `${label}.denominator.state`, denominatorStates, issues);
    requiredString(denominator.reason, `${label}.denominator.reason`, issues);
    pointers(denominator.evidencePointers, `${label}.denominator.evidencePointers`, issues);
  }
  requiredString(row.reason, `${label}.reason`, issues);
  pointers(row.evidencePointers, `${label}.evidencePointers`, issues);
  return Number(row.angle);
}

function reviewCoverage(review, identityRow, issues) {
  if (!sameList(idRows(review.deterministicRows, "deterministicRows", issues), DETERMINISTIC_ROWS)) {
    issues.push(
      `deterministicRows must contain ${DETERMINISTIC_ROWS[0]}-${DETERMINISTIC_ROWS.at(-1)} exactly once and in order`,
    );
  }
  if (!sameList(idRows(review.digestVerdicts, "digestVerdicts", issues), DIGEST_VERDICTS)) {
    issues.push(`digestVerdicts must contain the ${DIGEST_VERDICTS.length} canonical verdicts in order`);
  }
  const angles = requiredArray(review.angleStates, "angleStates", issues);
  const angleIds = angles.map((value, index) => angleRow(value, index, identityRow, issues));
  if (!sameList(angleIds, angleNumbers())) {
    issues.push(`angleStates must contain angles 1-${ANGLE_COUNT} exactly once and in order`);
  }
  const sessions = requiredArray(review.sessionStates, "sessionStates", issues);
  const sessionIds = new Set();
  sessions.forEach((value, index) => {
    const row = requiredRecord(value, `sessionStates[${index}]`, issues);
    if (!row) return;
    const id = requiredString(row.id, `sessionStates[${index}].id`, issues);
    if (id && sessionIds.has(id)) issues.push(`duplicate session state: ${id}`);
    if (id) sessionIds.add(id);
    oneOf(row.state, `sessionStates[${index}].state`, SESSION_STATES, issues);
    pointers(row.evidencePointers, `sessionStates[${index}].evidencePointers`, issues);
  });
  if (!sessionIds.has("session_30")) issues.push("sessionStates must include session_30");
  const session30 = sessions.find((value) => asRecord(value)?.id === "session_30");
  if (session30) session30Readiness(session30, identityRow, issues);
}

/** `session_30` is the source-readiness session: contract CL-F, plus a witness naming the source
 *  file, revision and digest it was read at and the producer and consumer symbols it found
 *  there. The measured worktree is opened to check that those two symbols are really in it. */
function session30Readiness(session30, identityRow, issues) {
  const row = asRecord(session30);
  const label = "sessionStates.session_30";
  const applicabilities = states("applicable", "not-applicable", "inconclusive");
  const applicability = oneOf(row.applicability, `${label}.applicability`, applicabilities, issues);
  requiredString(row.contract, `${label}.contract`, issues);
  if (row.contract !== "CL-F") issues.push(`${label}.contract must be CL-F`);
  const witnessLabel = `${label}.readinessWitness`;
  const witness = requiredRecord(row.readinessWitness, witnessLabel, issues);
  if (!witness) return;
  const sourceFile = requiredString(witness.sourceFile, `${witnessLabel}.sourceFile`, issues);
  if (sourceFile && !safeSourcePath(sourceFile)) {
    issues.push(`${witnessLabel}.sourceFile must be a safe source-relative path`);
  }
  const symbols = {
    producerSymbol: requiredString(witness.producerSymbol, `${witnessLabel}.producerSymbol`, issues),
    consumerSymbol: requiredString(witness.consumerSymbol, `${witnessLabel}.consumerSymbol`, issues),
  };
  requiredString(witness.sourceRevision, `${witnessLabel}.sourceRevision`, issues, GIT_SHA);
  requiredString(witness.sourceDigest, `${witnessLabel}.sourceDigest`, issues, SHA256);
  if (identityRow && witness.sourceRevision !== identityRow.sourceRevision) {
    issues.push(`${witnessLabel}.sourceRevision differs from measured source`);
  }
  const bytes = sourceFile && identityRow?.worktree ? measuredFile(identityRow, sourceFile) : undefined;
  if (bytes === null) issues.push(`${witnessLabel}.sourceFile is absent from the measured worktree`);
  if (bytes) {
    const sourceText = bytes.toString("utf8");
    if (witness.sourceDigest !== sha256(sourceText)) {
      issues.push(`${witnessLabel}.sourceDigest does not match the measured source file`);
    }
    for (const [key, symbol] of Object.entries(symbols)) {
      // The symbol must be declared as a function or a binding, not merely mentioned.
      const declaration = new RegExp(
        `(?:export\\s+)?(?:async\\s+)?function\\s+${symbol}\\b|(?:export\\s+)?(?:const|let|var)\\s+${symbol}\\s*[=:]`,
      );
      if (symbol && !declaration.test(sourceText)) {
        issues.push(`${witnessLabel}.${key} is absent from the measured source file`);
      }
    }
  }
  oneOf(witness.vocabulary, `${witnessLabel}.vocabulary`, READINESS_VOCABULARY, issues);
  nonNegativeInt(witness.difficultyDecisionCount, `${witnessLabel}.difficultyDecisionCount`, issues);
  pointers(witness.evidencePointers, `${witnessLabel}.evidencePointers`, issues);
  if (applicability === "applicable" && witness.vocabulary === "unobservable") {
    issues.push("applicable CL-F requires a source-readiness vocabulary witness");
  }
  if (witness.vocabulary === "source-ready-no-level-decisions" && witness.difficultyDecisionCount !== 0) {
    issues.push("source-ready-no-level-decisions requires zero level decisions");
  }
}

/** A refuted prediction's dependency walk: walked, closed, and naming its survivors. */
function dependencyWalk(value, label, status, issues) {
  const walk = requiredRecord(value, `${label}.dependencyWalk`, issues);
  if (!walk) return;
  if (!isBoolean(walk.walked)) issues.push(`${label}.dependencyWalk.walked must be boolean`);
  if (!isBoolean(walk.closed)) issues.push(`${label}.dependencyWalk.closed must be boolean`);
  requiredStrings(walk.casualties, `${label}.dependencyWalk.casualties`, issues);
  const survivors = requiredStrings(walk.survivors, `${label}.dependencyWalk.survivors`, issues);
  requiredStrings(walk.dependents, `${label}.dependencyWalk.dependents`, issues);
  pointers(walk.evidencePointers, `${label}.dependencyWalk.evidencePointers`, issues, {
    atLeastOne: status === "refuted",
  });
  if (status === "refuted" && (walk.walked !== true || walk.closed !== true)) {
    issues.push(`${label} refutation requires a closed dependency walk`);
  }
  if (status === "refuted" && survivors.length === 0) {
    issues.push(`${label} refutation requires an explicit survivor closure`);
  }
}

function predictionRow(value, label, stage, issues) {
  const row = requiredRecord(value, label, issues);
  if (!row) return "";
  for (const key of FROZEN_PREDICTION_FIELDS) {
    requiredString(row[key], `${label}.${key}`, issues, key === "sourceRevision" ? GIT_SHA : null);
  }
  requiredString(row.frozenHash, `${label}.frozenHash`, issues, SHA256);
  if (isString(row.frozenHash) && row.frozenHash !== predictionFrozenHash(row)) {
    issues.push(`${label}.frozenHash does not bind the frozen claim`);
  }
  const status = requiredString(row.status, `${label}.status`, issues);
  if (status && !PREDICTION_STATUSES.has(status)) {
    issues.push(`${label}.status cannot remain pending or use an unknown value`);
  }
  // Every row is advisory: its prediction was frozen in launch prose, and no campaign writes a
  // receipt that could make it eligible or a campaign closure.
  if (!isBoolean(row.eligible)) issues.push(`${label}.eligible must be boolean`);
  if (row.eligible !== false) {
    issues.push(`${label} eligible prediction requires a campaign receipt, and no campaign writes one`);
  }
  requiredString(row.advisoryReason, `${label}.advisoryReason`, issues);
  if (row.closureState !== "not-campaign-closure") {
    issues.push(`${label}.closureState must state that campaign closure was not established`);
  }
  pointers(row.decidingEvidence, `${label}.decidingEvidence`, issues);
  const successors = requiredArray(row.successor, `${label}.successor`, issues);
  const dependsOn = requiredArray(row.dependsOn, `${label}.dependsOn`, issues);
  const consumedBy = requiredArray(row.consumedBy, `${label}.consumedBy`, issues);
  if (consumedBy.length > 1) issues.push(`${label}.consumedBy may name at most one consuming run`);
  for (const [name, items] of Object.entries({ successor: successors, dependsOn, consumedBy })) {
    items.forEach((item, itemIndex) => requiredString(item, `${label}.${name}[${itemIndex}]`, issues));
  }
  requiredString(row.backtrackEvent, `${label}.backtrackEvent`, issues);
  if (status === "refuted" && row.backtrackEvent === "none") {
    issues.push(`${label} refutation requires a backtrack event`);
  }
  predictionEvidence(row, label, status, stage, issues);
  dependencyWalk(row.dependencyWalk, label, status, issues);
  return row.id;
}

/** The four state-evidence rows of one prediction, and the status each one constrains. */
function predictionEvidence(row, label, status, stage, issues) {
  const evidence = (name, ...values) =>
    stateEvidence(row[name], `${label}.${name}`, states(...values), issues);
  const eligibility = evidence("eligibility", "eligible", "ineligible", "unknown");
  if (eligibility) {
    requiredString(eligibility.row.nextEligibleRunId, `${label}.eligibility.nextEligibleRunId`, issues);
    if (!["ineligible", "unknown"].includes(eligibility.state)) {
      issues.push(`${label} advisory eligibility must be ineligible or unknown`);
    }
  }
  const opportunity = evidence("opportunity", "present", "absent", "absent-before-opening", "unknown");
  const trigger = evidence("triggerEvidence", "triggered", "not-triggered", "unknown");
  const effect = evidence("effectEvidence", "observed", "not-observed", "partial", "unknown");
  const denominator = evidence("denominator", "recorded", "absent", "absent-before-opening", "unknown");
  if (opportunity?.state === "absent-before-opening" && stage !== "preopening") {
    issues.push(`${label} may use absent-before-opening only in a preopening archive`);
  }
  if (denominator?.state === "absent-before-opening" && stage !== "preopening") {
    issues.push(`${label}.denominator may use absent-before-opening only in a preopening archive`);
  }
  if (denominator?.state === "recorded") {
    const counts = requiredRecord(denominator.row.counts, `${label}.denominator.counts`, issues);
    if (counts && !denominatorCounts(counts, `${label}.denominator.counts`, issues)) {
      issues.push(`${label}.denominator counts do not reconcile`);
    }
  }
  if (["sufficed", "partial", "refuted"].includes(status) && trigger?.state === "not-triggered") {
    issues.push(`${label} has a decided status but its trigger evidence says not-triggered`);
  }
  if (status === "untriggered" && trigger?.state === "triggered") {
    issues.push(`${label} is untriggered but its trigger evidence says triggered`);
  }
  if (status === "sufficed" && effect?.state !== "observed") {
    issues.push(`${label} sufficed requires observed effect evidence`);
  }
  if (status === "refuted" && effect?.state === "observed") {
    issues.push(`${label} refuted cannot carry observed effect evidence`);
  }
}

function predictionRows(review, stage, issues) {
  const ids = new Set();
  requiredArray(review.predictions, "predictions", issues).forEach((value, index) => {
    const id = predictionRow(value, `predictions[${index}]`, stage, issues);
    if (isString(id) && id.trim() && ids.has(id)) issues.push(`duplicate prediction id: ${id}`);
    if (isString(id) && id.trim()) ids.add(id);
  });
}

function runtimeReceipt(value, label, status, opportunity, issues) {
  const missingMessage = `${label} is missing while a safeguard opportunity was present; status must be inconclusive`;
  const row = requiredRecord(value, label, issues);
  if (!row) {
    if (opportunity === "present" && status !== "inconclusive") issues.push(missingMessage);
    return null;
  }
  const state = oneOf(row.state, `${label}.state`, RUNTIME_RECEIPT_STATES, issues);
  if (!isBoolean(row.complete)) issues.push(`${label}.complete must be boolean`);
  pointers(row.evidencePointers, `${label}.evidencePointers`, issues);
  if (state === "present") {
    if (row.complete !== true) issues.push(`${label}.complete must be true for a present receipt`);
    requiredString(row.sha256, `${label}.sha256`, issues, SHA256);
  } else if (state === "not-applicable") {
    if (row.complete !== false) issues.push(`${label}.complete must be false for a not-applicable receipt`);
    pointers(row.decidingEvidence, `${label}.decidingEvidence`, issues);
    if (opportunity !== "absent") {
      issues.push(`${label} may be N/A only when the recorded opportunity is absent`);
    }
  } else if (opportunity === "present" && state === "absent" && status !== "inconclusive") {
    issues.push(missingMessage);
  }
  return { row, state };
}

/** Each measured safeguard id with the digest of the source file that calls it. */
function runtimeDefinitionHashes(identityRow, sourceCallers) {
  const hashes = new Map();
  for (const [file, ids] of sourceCallers) {
    const bytes = measuredFile(identityRow, file);
    if (bytes === null) continue;
    const digest = sha256(bytes);
    for (const id of ids) hashes.set(id, digest);
  }
  return hashes;
}

/** The receipts, action, backtrack and firing of one runtime-log-only safeguard. */
function runtimeSafeguard(row, label, opportunityState, firing, issues) {
  const status = row.status;
  const receipts = ["logReceipt", "stderrReceipt", "processReceipt"].map((name) =>
    runtimeReceipt(row[name], `${label}.${name}`, status, opportunityState, issues),
  );
  if (
    opportunityState === "present" &&
    receipts.some((receipt) => receipt === null || ["absent", "not-applicable"].includes(receipt.state)) &&
    status !== "inconclusive"
  ) {
    issues.push(
      `${label} has a missing runtime receipt for a present opportunity; status must be inconclusive`,
    );
  }
  const action = requiredRecord(row.action, `${label}.action`, issues);
  if (action) {
    const actionState = oneOf(action.state, `${label}.action.state`, RUNTIME_ACTION_STATES, issues);
    const actionOwner = requiredString(action.owner, `${label}.action.owner`, issues);
    if (actionOwner && actionOwner !== row.owner) issues.push(`${label}.action.owner differs from owner`);
    pointers(action.evidencePointers, `${label}.action.evidencePointers`, issues);
    if (actionState === "not-applicable" && opportunityState !== "absent") {
      issues.push(`${label}.action may be not-applicable only with no opportunity`);
    }
  }
  const backtrack = requiredRecord(row.backtrack, `${label}.backtrack`, issues);
  if (backtrack) {
    const backtrackState = oneOf(
      backtrack.state,
      `${label}.backtrack.state`,
      RUNTIME_BACKTRACK_STATES,
      issues,
    );
    pointers(backtrack.evidencePointers, `${label}.backtrack.evidencePointers`, issues, {
      atLeastOne: status === "fired",
    });
    if (status === "fired" && !["preserved", "required"].includes(backtrackState)) {
      issues.push(`${label} fired safeguard requires preserved backtracking`);
    }
  }
  if (firing?.state === "not-applicable") {
    if (opportunityState !== "absent") issues.push(`${label}.firing may be N/A only with no opportunity`);
    pointers(firing.row.decidingEvidence, `${label}.firing.decidingEvidence`, issues);
  }
}

/** A safeguard retires only after two eligible iterations with preserved backtracking and an
 *  independent review. */
function retirement(value, label, issues) {
  const row = requiredRecord(value, `${label}.retirement`, issues);
  if (!row) return;
  if (!isBoolean(row.retired)) issues.push(`${label}.retirement.retired must be boolean`);
  nonNegativeInt(row.eligibleIterations, `${label}.retirement.eligibleIterations`, issues);
  if (!isBoolean(row.backtrackPreserved)) {
    issues.push(`${label}.retirement.backtrackPreserved must be boolean`);
  }
  pointers(row.backtrackPointers, `${label}.retirement.backtrackPointers`, issues, { atLeastOne: false });
  const reviewLabel = `${label}.retirement.independentReview`;
  const review =
    row.retired === true
      ? requiredRecord(row.independentReview, reviewLabel, issues)
      : asRecord(row.independentReview);
  if (review) {
    if (review.reviewed !== true) issues.push(`${reviewLabel}.reviewed must be true`);
    pointers(review.evidencePointers, `${reviewLabel}.evidencePointers`, issues);
  }
  if (
    row.retired === true &&
    (row.eligibleIterations < 2 ||
      row.backtrackPreserved !== true ||
      row.backtrackPointers.length === 0 ||
      review?.reviewed !== true)
  ) {
    issues.push(`${label} cannot retire before two eligible iterations with preserved backtracking`);
  }
}

function safeguardRow(value, label, identityRow, definitionHashes, issues) {
  const row = requiredRecord(value, label, issues);
  if (!row) return null;
  const id = requiredString(row.id, `${label}.id`, issues);
  if (isLogName(id)) {
    issues.push(`${label}.id must be an immutable safeguard id, not the ${SAFEGUARDS_LOG_STEM} filename`);
  }
  const kind = requiredString(row.kind, `${label}.kind`, issues);
  const runtime = kind === "runtime-log-only";
  if (kind && !runtime) issues.push(`${label}.kind is unsupported`);
  if (runtime) {
    const sensor = requiredString(row.sensor, `${label}.sensor`, issues);
    if (isLogName(sensor) || sensor.endsWith(`/${SAFEGUARDS_LOG_FILE}`)) {
      issues.push(`${label}.sensor must not use the ${SAFEGUARDS_LOG_STEM} filename as a sensor identity`);
    }
    requiredString(row.version, `${label}.version`, issues);
    const definitionHash = requiredString(row.definitionSha256, `${label}.definitionSha256`, issues, SHA256);
    if (definitionHash && definitionHashes.has(id) && definitionHash !== definitionHashes.get(id)) {
      issues.push(`${label}.definitionSha256 does not match the measured safeguard definition`);
    }
  }
  const status = oneOf(row.status, `${label}.status`, SAFEGUARD_STATUSES, issues);
  requiredString(row.owner, `${label}.owner`, issues);
  pointers(row.evidencePointers, `${label}.evidencePointers`, issues);
  const binding = requiredRecord(row.evidenceBinding, `${label}.evidenceBinding`, issues);
  if (binding) boundIdentity(binding, `${label}.evidenceBinding`, identityRow, issues);
  const opportunity = stateEvidence(
    row.opportunity,
    `${label}.opportunity`,
    states("present", "absent", "unknown"),
    issues,
  );
  const firingStates = states("fired", "not-fired", "inconclusive", "not-applicable");
  const firing = stateEvidence(row.firing, `${label}.firing`, firingStates, issues);
  if (status === "fired" && firing?.state !== "fired") {
    issues.push(`${label} status fired disagrees with firing state`);
  }
  if (runtime) runtimeSafeguard(row, label, opportunity?.state ?? "unknown", firing, issues);
  const coverage = requiredRecord(row.coverage, `${label}.coverage`, issues);
  if (coverage) {
    for (const key of ["complete", "t0", "t1"]) {
      if (coverage[key] !== true) issues.push(`${label}.coverage.${key} must be true`);
    }
  }
  const route = requiredRecord(row.route, `${label}.route`, issues);
  if (route) {
    const routeOwner = requiredString(route.owner, `${label}.route.owner`, issues);
    if (routeOwner && routeOwner !== row.owner) issues.push(`${label}.route.owner differs from owner`);
    const routeState = oneOf(route.state, `${label}.route.state`, ROUTE_STATES, issues);
    if (firing?.state === "fired" && routeState !== "routed") {
      issues.push(`${label} fired safeguard must be routed to its owner`);
    }
  }
  retirement(row.retirement, label, issues);
  return { id, runtime };
}

function safeguardRows(review, identityRow, issues) {
  // One walk of the measured source serves the definition digests and the census.
  const sourceCallers = identityRow?.worktree ? sourceSafeguardCallers(identityRow.worktree) : new Map();
  const definitionHashes = runtimeDefinitionHashes(identityRow, sourceCallers);
  const allIds = new Set();
  const runtimeIds = new Set();
  let runtimeCount = 0;
  requiredArray(review.safeguards, "safeguards", issues).forEach((value, index) => {
    const row = safeguardRow(value, `safeguards[${index}]`, identityRow, definitionHashes, issues);
    if (!row) return;
    if (row.id && allIds.has(row.id)) issues.push(`duplicate safeguard id: ${row.id}`);
    if (row.id) allIds.add(row.id);
    if (!row.runtime) return;
    runtimeCount += 1;
    if (row.id) runtimeIds.add(row.id);
  });
  if (runtimeCount === 0 && measuredHelperAvailable(identityRow)) {
    issues.push("at least one runtime-log-only safeguard reconciliation row is required");
  }
  safeguardCensus(review, identityRow, runtimeIds, sourceCallers, issues);
}

/** With no measured safeguard helper the census is unobservable and every id list is empty. */
function absentCensus(census, runtimeIds, issues) {
  if (census.availability !== "unobservable") {
    issues.push("safeguardCensus.availability must be unobservable when the measured helper is absent");
  }
  for (const key of ["callerFiles", "ids"]) {
    if (requiredArray(census[key], `safeguardCensus.${key}`, issues).length > 0) {
      issues.push(`safeguardCensus.${key} must be empty when the measured helper is absent`);
    }
  }
  if (runtimeIds.size > 0) {
    issues.push("runtime safeguard rows must be empty when the measured helper is absent");
  }
  pointers(census.evidencePointers, "safeguardCensus.evidencePointers", issues);
}

/** One census caller file: its ids, and its bytes and callers as the measured worktree has them. */
function censusCallerFile(value, label, identityRow, sourceCallers, issues) {
  const file = requiredRecord(value, label, issues);
  if (!file) return null;
  const relativeFile = requiredString(file.relativeFile, `${label}.relativeFile`, issues);
  if (relativeFile && !safeSourcePath(relativeFile)) {
    issues.push(`${label}.relativeFile must be a safe source-relative path`);
  }
  const fileHash = requiredString(file.sha256, `${label}.sha256`, issues, SHA256);
  const declaredIds = new Set();
  requiredArray(file.ids, `${label}.ids`, issues).forEach((id, idIndex) => {
    const valueId = requiredString(id, `${label}.ids[${idIndex}]`, issues);
    if (!valueId) return;
    if (declaredIds.has(valueId)) issues.push(`${label}.ids repeats ${valueId}`);
    declaredIds.add(valueId);
  });
  if (!identityRow || !relativeFile) return { relativeFile, declaredIds };
  const bytes = measuredFile(identityRow, relativeFile);
  if (bytes === null) {
    issues.push(`${label}.relativeFile is absent from the measured worktree`);
    return { relativeFile, declaredIds };
  }
  if (fileHash && fileHash !== sha256(bytes)) {
    issues.push(`${label}.sha256 does not match the measured source bytes`);
  }
  if (!sameList([...declaredIds].sort(), [...(sourceCallers.get(relativeFile) ?? [])].sort())) {
    issues.push(`${label}.ids must be derived from its exact safeguardTriggered callers`);
  }
  return { relativeFile, declaredIds };
}

function safeguardCensus(review, identityRow, runtimeIds, sourceCallers, issues) {
  const census = requiredRecord(review.safeguardCensus, "safeguardCensus", issues);
  if (!census) return;
  if (census.complete !== true) issues.push("safeguardCensus.complete must be true");
  const sourceRevision = requiredString(
    census.sourceRevision,
    "safeguardCensus.sourceRevision",
    issues,
    GIT_SHA,
  );
  const sourceDigest = requiredString(census.sourceDigest, "safeguardCensus.sourceDigest", issues, SHA256);
  if (identityRow && sourceRevision && sourceRevision !== identityRow.sourceRevision) {
    issues.push("safeguardCensus.sourceRevision differs from measured source");
  }
  if (identityRow && sourceDigest && sourceDigest !== identityRow.sourceDigest) {
    issues.push("safeguardCensus.sourceDigest differs from measured source");
  }
  if (!measuredHelperAvailable(identityRow)) {
    absentCensus(census, runtimeIds, issues);
    return;
  }
  const definitionFile = requiredString(census.definitionFile, "safeguardCensus.definitionFile", issues);
  if (isLogName(definitionFile)) {
    issues.push(`safeguardCensus.definitionFile must name the measured source, not ${SAFEGUARDS_LOG_STEM}`);
  }
  if (definitionFile && definitionFile !== "src/meta/safeguard.ts") {
    issues.push("safeguardCensus.definitionFile must name src/meta/safeguard.ts");
  }
  oneOf(census.derivation, "safeguardCensus.derivation", states("source-callers-v1"), issues);
  const derivedIds = new Set();
  const seenFiles = new Set();
  requiredArray(census.callerFiles, "safeguardCensus.callerFiles", issues).forEach((value, index) => {
    const label = `safeguardCensus.callerFiles[${index}]`;
    const file = censusCallerFile(value, label, identityRow, sourceCallers, issues);
    if (!file) return;
    for (const id of file.declaredIds) derivedIds.add(id);
    if (file.relativeFile && seenFiles.has(file.relativeFile)) {
      issues.push(`duplicate safeguard census source file: ${file.relativeFile}`);
    }
    if (file.relativeFile) seenFiles.add(file.relativeFile);
  });
  if (!seenFiles.has(definitionFile)) {
    issues.push("safeguardCensus.callerFiles must include the measured safeguard definition file");
  }
  const unique = new Set();
  requiredArray(census.ids, "safeguardCensus.ids", issues).forEach((value, index) => {
    const id = requiredString(value, `safeguardCensus.ids[${index}]`, issues);
    if (isLogName(id)) {
      issues.push(`safeguardCensus.ids must not contain the ${SAFEGUARDS_LOG_STEM} filename`);
    }
    if (id && unique.has(id)) issues.push(`duplicate safeguardCensus id: ${id}`);
    if (id) unique.add(id);
  });
  if (!sameList([...sourceCallers.keys()].sort(), [...seenFiles].sort())) {
    issues.push("safeguardCensus.callerFiles must enumerate every measured source caller exactly");
  }
  if (!sameSet(new Set(sourceCallers.values().flatMap((ids) => [...ids])), unique)) {
    issues.push("safeguardCensus.ids must equal every literal safeguard id in the measured source");
  }
  if (!sameSet(unique, runtimeIds)) {
    issues.push("safeguardCensus.ids must equal the runtime safeguard rows exactly");
  }
  if (!sameSet(derivedIds, unique)) {
    issues.push("safeguardCensus.ids must equal ids derived from the measured source and callers");
  }
  pointers(census.evidencePointers, "safeguardCensus.evidencePointers", issues);
}

function rejectAuthority(review, issues) {
  if (review.authority !== "advisory") issues.push("WRI authority must be exactly advisory");
  const handoff = requiredRecord(review.learningHandoff, "learningHandoff", issues);
  if (!handoff) return;
  if (handoff.authority !== "advisory") issues.push("learningHandoff authority must be exactly advisory");
  for (const key of ["hypotheses", "rivalSets", "experimentProposals"]) {
    requiredArray(handoff[key], `learningHandoff.${key}`, issues);
  }
  pointers(handoff.evidencePointers, "learningHandoff.evidencePointers", issues, { atLeastOne: false });
  const proposals = Array.isArray(handoff.experimentProposals) ? handoff.experimentProposals : [];
  proposals.forEach((value, index) => {
    const label = `learningHandoff.experimentProposals[${index}]`;
    const row = requiredRecord(value, label, issues);
    if (!row) return;
    for (const key of ["id", "owner", "expectedEffect", "falsifier", "disposition"]) {
      requiredString(row[key], `${label}.${key}`, issues);
    }
    if (["promote", "launch", "merge"].includes(row.disposition)) {
      issues.push("WRI proposal cannot carry promotion or launch authority");
    }
    pointers(row.evidencePointers, `${label}.evidencePointers`, issues);
  });
}

function advisoryProjection(review, name, issues) {
  const row = requiredRecord(review[name], name, issues);
  if (!row) return;
  const state = oneOf(row.state, `${name}.state`, states("bound", "not-used", "unavailable"), issues);
  if (row.authority !== "advisory") issues.push(`${name}.authority must be exactly advisory`);
  requiredString(row.reason, `${name}.reason`, issues);
  pointers(row.evidencePointers, `${name}.evidencePointers`, issues);
  if (state === "not-used" && isString(row.reason) && row.reason.toLowerCase().includes("closed")) {
    issues.push(`${name}.reason must not claim campaign closure`);
  }
}

function primaryReview(review, issues) {
  const primary = requiredRecord(review.primaryReview, "primaryReview", issues);
  if (!primary) return;
  requiredString(primary.assertion, "primaryReview.assertion", issues);
  if (primary.protectedEvidenceChecked !== true) {
    issues.push("primaryReview.protectedEvidenceChecked must be true");
  }
  pointers(primary.evidencePointers, "primaryReview.evidencePointers", issues);
}

function readArchive(archiveDir, issues) {
  if (!isAbsolute(archiveDir)) issues.push("archive path must be absolute");
  if (!existsSync(archiveDir) || !lstatSync(archiveDir).isDirectory()) {
    issues.push(`archive directory does not exist: ${archiveDir}`);
    return null;
  }
  const entries = readdirSync(archiveDir, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  for (const name of ARCHIVE_FILES) if (!names.has(name)) issues.push(`archive is missing ${name}`);
  for (const entry of entries) {
    if (!ARCHIVE_PATHS.has(entry.name)) {
      issues.push(`archive contains forbidden extra file: ${entry.name}`);
    }
    if (entry.isSymbolicLink()) issues.push(`archive entry is a symlink: ${entry.name}`);
    else if (!entry.isFile()) issues.push(`archive entry is not a regular file: ${entry.name}`);
  }
  if (issues.length > 0 || !names.has(REVIEW)) return null;
  try {
    return readJsonFile(`${archiveDir}/${REVIEW}`);
  } catch (error) {
    issues.push(`${REVIEW} is not valid JSON: ${error.message}`);
    return null;
  }
}

export function validateArchiveDirectory(archivePath) {
  const archiveDir = resolve(archivePath);
  const issues = [];
  const review = readArchive(archiveDir, issues);
  const reviewRecord = review === null ? null : requiredRecord(review, REVIEW, issues);
  if (!reviewRecord) throw new ArchiveValidationError(issues);
  if (reviewRecord.schema !== ARCHIVE_SCHEMA) issues.push(`${REVIEW} schema must be ${ARCHIVE_SCHEMA}`);
  const identityRow = identity(reviewRecord, issues);
  const stage = lifecycle(reviewRecord, issues);
  procedureIdentity(reviewRecord, identityRow, issues);
  ledgerProjection(reviewRecord, identityRow, issues);
  launchIdentity(reviewRecord, stage, issues);
  digestRows(reviewRecord, issues);
  terminalAccounting(reviewRecord, issues);
  terminalOutcome(reviewRecord, asRecord(reviewRecord.terminalAccounting), issues);
  reviewCoverage(reviewRecord, identityRow, issues);
  predictionRows(reviewRecord, stage, issues);
  safeguardRows(reviewRecord, identityRow, issues);
  safeguardReconciliation(reviewRecord, identityRow, issues);
  rejectAuthority(reviewRecord, issues);
  advisoryProjection(reviewRecord, "metaReview", issues);
  advisoryProjection(reviewRecord, "conditionManifest", issues);
  sectionPointers(reviewRecord, issues);
  scanPathFields(reviewRecord, REVIEW, issues);
  verifyPointerFiles(reviewRecord, REVIEW, archiveDir, issues);
  primaryReview(reviewRecord, issues);
  if (issues.length > 0) throw new ArchiveValidationError(issues);
  return {
    schema: "wri-archive-validation/v1",
    valid: true,
    archiveDir,
    files: ARCHIVE_FILES.map((name) => ({ name, bytes: readFileSync(`${archiveDir}/${name}`).byteLength })),
    runId: reviewRecord.identity.runId,
    sourceRevision: reviewRecord.identity.sourceRevision,
    predictionCount: reviewRecord.predictions.length,
    safeguardCount: reviewRecord.safeguards.length,
  };
}

function validateCommand(args) {
  const archiveDir = args.required("archive");
  const out = args.value("out");
  if (out !== null) {
    const child = relative(archiveDir, resolve(out));
    if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) {
      args.die("--out must be outside the four-file archive");
    }
  }
  let result;
  try {
    result = validateArchiveDirectory(archiveDir);
  } catch (error) {
    throw new CommandFailure(errorMessage(error), error instanceof ArchiveValidationError ? 1 : 2);
  }
  emitReport(result, { json: true, out });
}

if (import.meta.main) {
  await runCommand(
    {
      name: "validate-archive",
      usage: "usage: bun validate-archive.mjs --archive <abs archive dir> [--out <abs file outside it>]",
      options: { archive: "abs", out: "abs" },
    },
    validateCommand,
  );
}
