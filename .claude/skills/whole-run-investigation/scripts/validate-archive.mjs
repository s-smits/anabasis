#!/usr/bin/env bun
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import { sha256 } from "#src/meta/digest.ts";
import { dirname, isAbsolute, relative, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import {
  canonical,
  digestRows,
  GIT_SHA,
  identity,
  launchIdentity,
  ledgerProjection,
  lifecycle,
  pointers,
  procedureIdentity,
  requiredArray,
  requiredRecord,
  requiredString,
  scanPathFields,
  safeguardReconciliation,
  sectionPointers,
  SHA256,
  sourceSafeguardCallers,
  stateEvidence,
  terminalAccounting,
  terminalOutcome,
  verifyPointerFiles,
} from "./archive-shape.mjs";
import { ANGLE_COUNT, angleNumbers, DETERMINISTIC_ROWS, DIGEST_VERDICTS } from "./catalogue-shape.mjs";
import { hasText } from "#src/meta/text.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

/** The archive's own JSON, and the runtime log whose filename is never a safeguard identity. */
const REVIEW_FILE = "review.json";
const SAFEGUARDS_LOG_STEM = "SAFEGUARDS_LOG";
const SAFEGUARDS_LOG_FILE = `${SAFEGUARDS_LOG_STEM}.txt`;
export const ARCHIVE_FILES = ["main_synthesis.md", "luna_syntheses.md", "digest.md", REVIEW_FILE];
const ARCHIVE_FILE_SET = new Set(ARCHIVE_FILES);
const PREDICTION_STATUSES = new Set(["sufficed", "partial", "refuted", "untriggered", "inconclusive"]);
const SAFEGUARD_STATUSES = new Set(["opportunity", "fired", "not-fired", "no-opportunity", "inconclusive"]);
const ANGLE_STATES = new Set([
  "pass",
  "fail",
  "risk",
  "N/A",
  "stale",
  "unobservable",
  "deferred",
  "inconclusive",
]);
const SESSION_STATES = new Set([
  "complete",
  "partial",
  "failed",
  "held",
  "inactive",
  "not-applicable",
  "inconclusive",
]);
const FROZEN_PREDICTION_FIELDS = [
  "id",
  "claim",
  "expectedEffect",
  "trigger",
  "falsifier",
  "owner",
  "sourceRevision",
  "runId",
  "epoch",
  "bundle",
  "taskSet",
];
const RUNTIME_RECEIPT_STATES = new Set(["present", "absent", "not-applicable", "inconclusive"]);
const RUNTIME_ACTION_STATES = new Set([
  "diagnostic-only",
  "routed",
  "held",
  "not-applicable",
  "inconclusive",
]);
const ROUTE_STATES = new Set(["routed", "held", "not-routed", "inconclusive"]);
const RUNTIME_BACKTRACK_STATES = new Set(["preserved", "not-needed", "required", "inconclusive"]);

/** The five fields that name one measured condition. Every row that binds itself to the archive's
 *  identity carries the same five. */
const IDENTITY_FIELDS = ["sourceRevision", "runId", "epoch", "bundle", "taskSet"];

const NO_RECEIPT = { path: null, receipt: null };

const CASE_KINDS = ["verified", "unaccepted", "nonResult"];

export class ArchiveValidationError extends Error {
  constructor(issues) {
    super(issues.join("; "));
    this.name = "ArchiveValidationError";
    this.issues = issues;
  }
}

/** Whether an archive's ids are the current catalogue's, exactly and in order. */
function sameList(observed, current) {
  return JSON.stringify(observed) === JSON.stringify(current);
}

function reviewCoverage(review, identityRow, issues) {
  const rows = requiredArray(review.deterministicRows, "deterministicRows", issues);
  const rowIds = rows.map((value, index) => {
    const row = requiredRecord(value, `deterministicRows[${index}]`, issues);
    if (!row) return "";
    const id = requiredString(row.id, `deterministicRows[${index}].id`, issues);
    requiredString(row.state, `deterministicRows[${index}].state`, issues);
    pointers(row.evidencePointers, `deterministicRows[${index}].evidencePointers`, issues);
    return id;
  });
  if (!sameList(rowIds, DETERMINISTIC_ROWS)) {
    issues.push(
      `deterministicRows must contain ${DETERMINISTIC_ROWS[0]}-${DETERMINISTIC_ROWS.at(-1)} exactly once and in order`,
    );
  }
  const verdicts = requiredArray(review.digestVerdicts, "digestVerdicts", issues);
  const verdictIds = verdicts.map((value, index) => {
    const row = requiredRecord(value, `digestVerdicts[${index}]`, issues);
    if (!row) return "";
    const id = requiredString(row.id, `digestVerdicts[${index}].id`, issues);
    requiredString(row.state, `digestVerdicts[${index}].state`, issues);
    pointers(row.evidencePointers, `digestVerdicts[${index}].evidencePointers`, issues);
    return id;
  });
  if (!sameList(verdictIds, DIGEST_VERDICTS)) {
    issues.push(`digestVerdicts must contain the ${DIGEST_VERDICTS.length} canonical verdicts in order`);
  }
  const angles = requiredArray(review.angleStates, "angleStates", issues);
  const angleIds = angles.map((value, index) => {
    const row = requiredRecord(value, `angleStates[${index}]`, issues);
    if (!row) return 0;
    if (!isNumber(row.angle) || !Number.isInteger(row.angle)) {
      issues.push(`angleStates[${index}].angle must be an integer`);
    }
    const angle = Number(row.angle);
    const state = requiredString(row.state, `angleStates[${index}].state`, issues);
    if (state && !ANGLE_STATES.has(state)) issues.push(`angleStates[${index}].state is unsupported`);
    requiredString(row.session, `angleStates[${index}].session`, issues);
    const mode = requiredString(row.mode, `angleStates[${index}].mode`, issues);
    if (mode && !new Set(["targeted", "exhaustive"]).has(mode)) {
      issues.push(`angleStates[${index}].mode is unsupported`);
    }
    const angleIdentity = requiredRecord(row.identity, `angleStates[${index}].identity`, issues);
    if (angleIdentity) {
      for (const key of ["sourceRevision", "runId", "epoch", "bundle", "taskSet"]) {
        requiredString(
          angleIdentity[key],
          `angleStates[${index}].identity.${key}`,
          issues,
          key === "sourceRevision" ? GIT_SHA : null,
        );
        if (identityRow && angleIdentity[key] !== identityRow[key]) {
          issues.push(`angleStates[${index}].identity.${key} differs from archive identity`);
        }
      }
    }
    const angleDenominator = requiredRecord(row.denominator, `angleStates[${index}].denominator`, issues);
    if (angleDenominator) {
      const denominatorState = requiredString(
        angleDenominator.state,
        `angleStates[${index}].denominator.state`,
        issues,
      );
      if (
        denominatorState &&
        !new Set(["recorded", "sealed", "absent", "unknown", "inconclusive"]).has(denominatorState)
      ) {
        issues.push(`angleStates[${index}].denominator.state is unsupported`);
      }
      requiredString(angleDenominator.reason, `angleStates[${index}].denominator.reason`, issues);
      pointers(
        angleDenominator.evidencePointers,
        `angleStates[${index}].denominator.evidencePointers`,
        issues,
      );
    }
    requiredString(row.reason, `angleStates[${index}].reason`, issues);
    pointers(row.evidencePointers, `angleStates[${index}].evidencePointers`, issues);
    return angle;
  });
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
    const state = requiredString(row.state, `sessionStates[${index}].state`, issues);
    if (state && !SESSION_STATES.has(state)) issues.push(`sessionStates[${index}].state is unsupported`);
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
  const applicability = requiredString(row.applicability, "sessionStates.session_30.applicability", issues);
  if (applicability && !new Set(["applicable", "not-applicable", "inconclusive"]).has(applicability)) {
    issues.push("sessionStates.session_30.applicability is unsupported");
  }
  requiredString(row.contract, "sessionStates.session_30.contract", issues);
  if (row.contract !== "CL-F") issues.push("sessionStates.session_30.contract must be CL-F");
  const witness = requiredRecord(row.readinessWitness, "sessionStates.session_30.readinessWitness", issues);
  if (!witness) return;
  const sourceFile = requiredString(
    witness.sourceFile,
    "sessionStates.session_30.readinessWitness.sourceFile",
    issues,
  );
  if (
    sourceFile &&
    (isAbsolute(sourceFile) ||
      sourceFile.includes("\\") ||
      sourceFile.includes("..") ||
      sourceFile.startsWith("."))
  ) {
    issues.push("sessionStates.session_30.readinessWitness.sourceFile must be a safe source-relative path");
  }
  const producerSymbol = requiredString(
    witness.producerSymbol,
    "sessionStates.session_30.readinessWitness.producerSymbol",
    issues,
  );
  const consumerSymbol = requiredString(
    witness.consumerSymbol,
    "sessionStates.session_30.readinessWitness.consumerSymbol",
    issues,
  );
  requiredString(
    witness.sourceRevision,
    "sessionStates.session_30.readinessWitness.sourceRevision",
    issues,
    GIT_SHA,
  );
  requiredString(
    witness.sourceDigest,
    "sessionStates.session_30.readinessWitness.sourceDigest",
    issues,
    SHA256,
  );
  if (identityRow && witness.sourceRevision !== identityRow.sourceRevision) {
    issues.push("sessionStates.session_30.readinessWitness.sourceRevision differs from measured source");
  }
  if (sourceFile && identityRow?.worktree) {
    const sourcePath = resolve(identityRow.worktree, sourceFile);
    if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
      issues.push(
        "sessionStates.session_30.readinessWitness.sourceFile is absent from the measured worktree",
      );
    } else {
      const sourceText = readFileSync(sourcePath, "utf8");
      if (witness.sourceDigest !== sha256(sourceText)) {
        issues.push(
          "sessionStates.session_30.readinessWitness.sourceDigest does not match the measured source file",
        );
      }
      const hasSymbol = (symbol) =>
        symbol &&
        new RegExp(
          `(?:export\\s+)?(?:async\\s+)?function\\s+${symbol}\\b|(?:export\\s+)?(?:const|let|var)\\s+${symbol}\\s*[=:]`,
        ).test(sourceText);
      if (producerSymbol && !hasSymbol(producerSymbol)) {
        issues.push(
          "sessionStates.session_30.readinessWitness.producerSymbol is absent from the measured source file",
        );
      }
      if (consumerSymbol && !hasSymbol(consumerSymbol)) {
        issues.push(
          "sessionStates.session_30.readinessWitness.consumerSymbol is absent from the measured source file",
        );
      }
    }
  }
  requiredString(witness.vocabulary, "sessionStates.session_30.readinessWitness.vocabulary", issues);
  if (
    isString(witness.vocabulary) &&
    !new Set([
      "source-ready-no-level-decisions",
      "source-ready-level-decisions",
      "source-not-ready",
      "unobservable",
    ]).has(witness.vocabulary)
  ) {
    issues.push("sessionStates.session_30.readinessWitness.vocabulary is unsupported");
  }
  if (
    !isNumber(witness.difficultyDecisionCount) ||
    !Number.isInteger(witness.difficultyDecisionCount) ||
    witness.difficultyDecisionCount < 0
  ) {
    issues.push(
      "sessionStates.session_30.readinessWitness.difficultyDecisionCount must be a non-negative integer",
    );
  }
  pointers(witness.evidencePointers, "sessionStates.session_30.readinessWitness.evidencePointers", issues);
  if (applicability === "applicable" && witness.vocabulary === "unobservable") {
    issues.push("applicable CL-F requires a source-readiness vocabulary witness");
  }
  if (witness.vocabulary === "source-ready-no-level-decisions" && witness.difficultyDecisionCount !== 0) {
    issues.push("source-ready-no-level-decisions requires zero level decisions");
  }
}

export function predictionFrozenHash(row) {
  const frozen = {};
  for (const key of FROZEN_PREDICTION_FIELDS) frozen[key] = row[key];
  return sha256(canonical(frozen));
}

/** The receipt bytes the campaign wrote for one adjudication. The declared file must be absolute
 *  and outside the four-file archive, its bytes must hash to the declared digest, and what it
 *  holds must be JSON. Each failure is an issue, and the receipt then reads as absent. */
function campaignReceipt(receiptRef, archiveDir, label, issues) {
  const path = requiredString(receiptRef.file, `${label}.campaignEvent.receipt.file`, issues);
  const receiptHash = requiredString(
    receiptRef.sha256,
    `${label}.campaignEvent.receipt.sha256`,
    issues,
    SHA256,
  );
  if (!path) return NO_RECEIPT;
  if (!isAbsolute(path)) {
    issues.push(`${label}.campaignEvent.receipt.file must be absolute`);
    return { path, receipt: null };
  }
  if (path === archiveDir || path.startsWith(`${archiveDir}/`)) {
    issues.push(`${label}.campaignEvent.receipt.file must be outside the four-file archive`);
  }
  try {
    const actual = realpathSync(path);
    if (actual === archiveDir || actual.startsWith(`${archiveDir}/`)) {
      issues.push(`${label}.campaignEvent.receipt.file must be outside the four-file archive`);
    }
    if (!lstatSync(actual).isFile()) {
      issues.push(`${label}.campaignEvent.receipt.file must name a regular file`);
      return { path, receipt: null };
    }
    const bytes = readFileSync(actual);
    if (receiptHash && sha256(bytes) !== receiptHash) {
      issues.push(`${label}.campaignEvent.receipt.sha256 does not match procedure-owned receipt bytes`);
    }
    return { path, receipt: capturedJsonParse(bytes.toString("utf8")) };
  } catch (error) {
    issues.push(`${label}.campaignEvent.receipt is unreadable or not valid JSON: ${error.message}`);
    return { path, receipt: null };
  }
}

/** The receipt's own content read against the WRI row it resolves: the same prediction,
 *  status and frozen claim, a dependency walk that matches the row's, and a projection digest
 *  over both. */
function receiptAgreesWithRow(receipt, row, event, label, issues) {
  if (
    receipt.schema !== "superloop-backtrack-event/v1" ||
    receipt.producer !== "run-improvement-campaign" ||
    receipt.authoritative !== true
  ) {
    issues.push(`${label}.campaignEvent.receipt must be the authoritative procedure backtrack event`);
  }
  if (receipt.predictionId !== row.id || receipt.status !== row.status) {
    issues.push(`${label}.campaignEvent.receipt prediction/status differs from the WRI row`);
  }
  const receiptFrozenHash = requiredString(
    receipt.frozenHash,
    `${label}.campaignEvent.receipt.frozenHash`,
    issues,
    SHA256,
  );
  if (receiptFrozenHash && receiptFrozenHash !== row.frozenHash) {
    issues.push(`${label}.campaignEvent.receipt frozenHash differs from the WRI row`);
  }
  const freeze = requiredRecord(receipt.freeze, `${label}.campaignEvent.receipt.freeze`, issues);
  if (freeze) {
    for (const key of FROZEN_PREDICTION_FIELDS) {
      requiredString(
        freeze[key],
        `${label}.campaignEvent.receipt.freeze.${key}`,
        issues,
        key === "sourceRevision" ? GIT_SHA : null,
      );
      if (freeze[key] !== row[key]) {
        issues.push(`${label}.campaignEvent.receipt.freeze.${key} differs from the WRI row`);
      }
    }
  }
  const consumer = requiredRecord(receipt.consumer, `${label}.campaignEvent.receipt.consumer`, issues);
  if (consumer?.predictionId !== undefined && consumer.predictionId !== row.id) {
    issues.push(`${label}.campaignEvent.receipt.consumer predictionId differs from the WRI row`);
  }
  if (consumer?.status !== undefined && consumer.status !== row.status) {
    issues.push(`${label}.campaignEvent.receipt.consumer status differs from the WRI row`);
  }
  if (receipt.ticketCoreSha256 !== event.ticketCoreSha256) {
    issues.push(`${label}.campaignEvent.ticketCoreSha256 does not bind the procedure receipt`);
  }
  if (
    !Array.isArray(receipt.dependents) ||
    receipt.dependents.some((id) => !isString(id)) ||
    new Set(receipt.dependents).size !== receipt.dependents.length
  ) {
    issues.push(`${label}.campaignEvent.receipt dependents must be a unique string list`);
  }
  const walk = asRecord(row.dependencyWalk);
  if (
    walk &&
    Array.isArray(receipt.dependents) &&
    JSON.stringify(receipt.dependents) !== JSON.stringify(walk.dependents)
  ) {
    issues.push(`${label}.campaignEvent.receipt dependents do not close the WRI dependency walk`);
  }
  const receiptWalk = requiredRecord(
    receipt.dependencyWalk,
    `${label}.campaignEvent.receipt.dependencyWalk`,
    issues,
  );
  if (receiptWalk) receiptDependencyWalk(receipt, receiptWalk, walk, label, issues);
  const projection = {
    predictionId: row.id,
    status: row.status,
    casualties: walk?.casualties ?? [],
    survivors: walk?.survivors ?? [],
    dependents: receipt.dependents ?? [],
  };
  const projectionHash = requiredString(
    event.projectionSha256,
    `${label}.campaignEvent.projectionSha256`,
    issues,
    SHA256,
  );
  if (projectionHash && projectionHash !== sha256(canonical(projection))) {
    issues.push(
      `${label}.campaignEvent.projectionSha256 does not match the recomputed dependency projection`,
    );
  }
}

/** The receipt's dependency walk against the WRI row's: the same three lists, casualties and
 *  survivors disjoint, and a partition naming every dependent exactly once. */
function receiptDependencyWalk(receipt, receiptWalk, walk, label, issues) {
  for (const key of ["casualties", "survivors", "promotions"]) {
    const values = requiredArray(
      receiptWalk[key],
      `${label}.campaignEvent.receipt.dependencyWalk.${key}`,
      issues,
    );
    if (values.some((item) => !isString(item)) || new Set(values).size !== values.length) {
      issues.push(`${label}.campaignEvent.receipt.dependencyWalk.${key} must be a unique string list`);
    }
  }
  if (walk) {
    if (!Array.isArray(walk.promotions)) {
      issues.push(`${label}.dependencyWalk.promotions must be recorded when a campaign event is present`);
    }
    for (const key of ["casualties", "survivors"]) {
      if (JSON.stringify(receiptWalk[key]) !== JSON.stringify(walk[key])) {
        issues.push(`${label}.campaignEvent.receipt dependency walk ${key} does not match the WRI walk`);
      }
    }
    if (
      walk.promotions !== undefined &&
      JSON.stringify(receiptWalk.promotions) !== JSON.stringify(walk.promotions)
    ) {
      issues.push(`${label}.campaignEvent.receipt dependency walk promotions do not match the WRI walk`);
    }
  }
  const dependents = Array.isArray(receipt.dependents) ? receipt.dependents : [];
  const casualties = Array.isArray(receiptWalk.casualties) ? receiptWalk.casualties : [];
  const survivors = Array.isArray(receiptWalk.survivors) ? receiptWalk.survivors : [];
  const promotions = Array.isArray(receiptWalk.promotions) ? receiptWalk.promotions : [];
  const survivorSet = new Set(survivors);
  if (casualties.some((id) => survivorSet.has(id))) {
    issues.push(`${label}.campaignEvent.receipt dependency walk casualties and survivors must be disjoint`);
  }
  const partition = new Set([...casualties, ...survivors]);
  if (partition.size !== dependents.length || dependents.some((id) => !partition.has(id))) {
    issues.push(`${label}.campaignEvent.receipt dependency walk must partition every dependent exactly once`);
  }
  if (promotions.some((id) => !partition.has(id))) {
    issues.push(
      `${label}.campaignEvent.receipt dependency walk promotions must name a dependent in the partition`,
    );
  }
}

function predictionCampaignEvent(row, identityRow, archiveDir, label, issues) {
  const event = requiredRecord(row.campaignEvent, `${label}.campaignEvent`, issues);
  if (!event) return;
  if (event.authority !== "campaign") issues.push(`${label}.campaignEvent.authority must be campaign`);
  if (event.origin !== "campaign-ledger") {
    issues.push(`${label}.campaignEvent.origin must be campaign-ledger; WRI cannot author a resolution`);
  }
  const receiptId = requiredString(event.receiptId, `${label}.campaignEvent.receiptId`, issues);
  const kind =
    event.kind === undefined ? null : requiredString(event.kind, `${label}.campaignEvent.kind`, issues);
  if (
    hasText(kind) &&
    !new Set(["sufficed", "partial", "refutation", "untriggered", "inconclusive", "adjudication"]).has(kind)
  ) {
    issues.push(`${label}.campaignEvent.kind is unsupported; use the procedure adjudication kind`);
  }
  requiredString(event.ticketCoreSha256, `${label}.campaignEvent.ticketCoreSha256`, issues, SHA256);
  const eventIdentity = requiredRecord(event.identity, `${label}.campaignEvent.identity`, issues);
  for (const key of eventIdentity === null ? [] : IDENTITY_FIELDS) {
    requiredString(
      eventIdentity[key],
      `${label}.campaignEvent.identity.${key}`,
      issues,
      key === "sourceRevision" ? GIT_SHA : null,
    );
    if (identityRow && eventIdentity[key] !== identityRow[key]) {
      issues.push(`${label}.campaignEvent.identity.${key} differs from measured identity`);
    }
  }
  const receiptRef = requiredRecord(event.receipt, `${label}.campaignEvent.receipt`, issues);
  const { path: receiptPath, receipt } =
    receiptRef === null ? NO_RECEIPT : campaignReceipt(receiptRef, archiveDir, label, issues);
  if (receipt !== null) receiptAgreesWithRow(receipt, row, event, label, issues);
  pointers(event.evidencePointers, `${label}.campaignEvent.evidencePointers`, issues);
  if (row.status === "refuted" && hasText(kind) && !["refutation", "adjudication"].includes(kind)) {
    issues.push(`${label} refutation requires a campaign refutation event`);
  }
  if (row.status === "partial" && hasText(kind) && !["partial", "adjudication"].includes(kind)) {
    issues.push(`${label} partial result requires a campaign partial event`);
  }
  if (receiptId && (!hasText(receiptPath) || receipt === null)) {
    issues.push(`${label}.campaignEvent requires readable procedure-owned receipt bytes`);
  }
}

/** A recorded or sealed denominator's counts: each a non-negative integer, and a total that
 *  reconciles with the three case kinds. */
function denominatorCounts(denominator, label, issues) {
  const countRow = requiredRecord(denominator.row.counts, `${label}.denominator.counts`, issues);
  if (!countRow) return;
  const keys = ["total", ...CASE_KINDS];
  for (const key of keys) {
    if (!isNumber(countRow[key]) || !Number.isInteger(countRow[key]) || countRow[key] < 0) {
      issues.push(`${label}.denominator.counts.${key} must be a non-negative integer`);
    }
  }
  const total = CASE_KINDS.reduce((sum, key) => sum + Number(countRow[key]), 0);
  if (keys.every((key) => isNumber(countRow[key])) && countRow.total !== total) {
    issues.push(`${label}.denominator counts do not reconcile`);
  }
}

function predictionRows(review, identityRow, archiveDir, stage, issues) {
  const rows = requiredArray(review.predictions, "predictions", issues);
  const ids = new Set();
  rows.forEach((value, index) => {
    const label = `predictions[${index}]`;
    const row = requiredRecord(value, label, issues);
    if (!row) return;
    const id = requiredString(row.id, `${label}.id`, issues);
    if (id && ids.has(id)) issues.push(`duplicate prediction id: ${id}`);
    if (id) ids.add(id);
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
    // A row without a campaign receipt is advisory: its prediction was frozen in launch prose, so
    // it can be neither eligible nor a campaign closure.
    const advisory = row.campaignEvent === undefined;
    if (!isBoolean(row.eligible)) issues.push(`${label}.eligible must be boolean`);
    if (advisory) {
      if (row.eligible !== false) {
        issues.push(`${label} eligible prediction requires a canonical campaign event receipt`);
      }
      requiredString(row.advisoryReason, `${label}.advisoryReason`, issues);
      if (row.closureState !== "not-campaign-closure") {
        issues.push(`${label}.closureState must state that campaign closure was not established`);
      }
    } else {
      predictionCampaignEvent(row, identityRow, archiveDir, label, issues);
    }
    pointers(row.decidingEvidence, `${label}.decidingEvidence`, issues);
    const successors = requiredArray(row.successor, `${label}.successor`, issues);
    const dependsOn = requiredArray(row.dependsOn, `${label}.dependsOn`, issues);
    const consumedBy = requiredArray(row.consumedBy, `${label}.consumedBy`, issues);
    if (consumedBy.length > 1) issues.push(`${label}.consumedBy may name at most one consuming run`);
    successors.forEach((item, itemIndex) => requiredString(item, `${label}.successor[${itemIndex}]`, issues));
    dependsOn.forEach((item, itemIndex) => requiredString(item, `${label}.dependsOn[${itemIndex}]`, issues));
    consumedBy.forEach((item, itemIndex) =>
      requiredString(item, `${label}.consumedBy[${itemIndex}]`, issues),
    );
    requiredString(row.backtrackEvent, `${label}.backtrackEvent`, issues);
    if (status === "refuted" && row.backtrackEvent === "none") {
      issues.push(`${label} refutation requires a backtrack event`);
    }
    const eligibility = stateEvidence(
      row.eligibility,
      `${label}.eligibility`,
      new Set(["eligible", "ineligible", "unknown"]),
      issues,
    );
    if (eligibility) {
      requiredString(eligibility.row.nextEligibleRunId, `${label}.eligibility.nextEligibleRunId`, issues);
    }
    if (advisory && eligibility && !["ineligible", "unknown"].includes(eligibility.state)) {
      issues.push(`${label} advisory eligibility must be ineligible or unknown`);
    }
    const opportunity = stateEvidence(
      row.opportunity,
      `${label}.opportunity`,
      new Set(["present", "absent", "absent-before-opening", "unknown"]),
      issues,
    );
    const trigger = stateEvidence(
      row.triggerEvidence,
      `${label}.triggerEvidence`,
      new Set(["triggered", "not-triggered", "unknown"]),
      issues,
    );
    const effect = stateEvidence(
      row.effectEvidence,
      `${label}.effectEvidence`,
      new Set(["observed", "not-observed", "partial", "unknown"]),
      issues,
    );
    const denominator = stateEvidence(
      row.denominator,
      `${label}.denominator`,
      new Set(["recorded", "sealed", "absent", "absent-before-opening", "unknown"]),
      issues,
    );
    if (opportunity?.state === "absent-before-opening" && stage !== "preopening") {
      issues.push(`${label} may use absent-before-opening only in a preopening archive`);
    }
    if (denominator?.state === "absent-before-opening" && stage !== "preopening") {
      issues.push(`${label}.denominator may use absent-before-opening only in a preopening archive`);
    }
    if (denominator?.state === "recorded" || denominator?.state === "sealed") {
      denominatorCounts(denominator, label, issues);
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
    if (row.eligible === true && eligibility?.state === "ineligible") {
      issues.push(`${label} eligible disagrees with eligibility state ineligible`);
    }
    if (row.eligible === false && eligibility?.state === "eligible") {
      issues.push(`${label} ineligible disagrees with eligibility state eligible`);
    }
    const walk = requiredRecord(row.dependencyWalk, `${label}.dependencyWalk`, issues);
    if (walk) {
      if (!isBoolean(walk.walked)) issues.push(`${label}.dependencyWalk.walked must be boolean`);
      if (!isBoolean(walk.closed)) issues.push(`${label}.dependencyWalk.closed must be boolean`);
      const casualties = requiredArray(walk.casualties, `${label}.dependencyWalk.casualties`, issues);
      const survivors = requiredArray(walk.survivors, `${label}.dependencyWalk.survivors`, issues);
      const dependents = requiredArray(walk.dependents, `${label}.dependencyWalk.dependents`, issues);
      casualties.forEach((item, itemIndex) =>
        requiredString(item, `${label}.dependencyWalk.casualties[${itemIndex}]`, issues),
      );
      survivors.forEach((item, itemIndex) =>
        requiredString(item, `${label}.dependencyWalk.survivors[${itemIndex}]`, issues),
      );
      dependents.forEach((item, itemIndex) =>
        requiredString(item, `${label}.dependencyWalk.dependents[${itemIndex}]`, issues),
      );
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
  });
}

function runtimeReceipt(value, label, status, opportunity, issues) {
  const row = requiredRecord(value, label, issues);
  if (!row) {
    if (opportunity === "present" && status !== "inconclusive") {
      issues.push(
        `${label} is missing while a safeguard opportunity was present; status must be inconclusive`,
      );
    }
    return null;
  }
  const state = requiredString(row.state, `${label}.state`, issues);
  if (state && !RUNTIME_RECEIPT_STATES.has(state)) issues.push(`${label}.state is unsupported`);
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
  } else if (
    opportunity === "present" &&
    ["absent", "not-applicable"].includes(state) &&
    status !== "inconclusive"
  ) {
    issues.push(`${label} is missing while a safeguard opportunity was present; status must be inconclusive`);
  }
  return { row, state };
}

function runtimeDefinitionHashes(identityRow) {
  const hashes = new Map();
  if (!identityRow?.worktree || !existsSync(resolve(identityRow.worktree, "src"))) return hashes;
  for (const [file, ids] of sourceSafeguardCallers(identityRow.worktree)) {
    const path = resolve(identityRow.worktree, file);
    if (!existsSync(path) || !lstatSync(path).isFile()) continue;
    const digest = sha256(readFileSync(path));
    for (const id of ids) hashes.set(id, digest);
  }
  return hashes;
}

function safeguardRows(review, identityRow, issues) {
  const rows = requiredArray(review.safeguards, "safeguards", issues);
  const allIds = new Set();
  const runtimeIds = new Set();
  const definitionHashes = runtimeDefinitionHashes(identityRow);
  let runtimeCount = 0;
  rows.forEach((value, index) => {
    const label = `safeguards[${index}]`;
    const row = requiredRecord(value, label, issues);
    if (!row) return;
    const id = requiredString(row.id, `${label}.id`, issues);
    if (id === SAFEGUARDS_LOG_STEM || id === SAFEGUARDS_LOG_FILE) {
      issues.push(`${label}.id must be an immutable safeguard id, not the ${SAFEGUARDS_LOG_STEM} filename`);
    }
    if (id && allIds.has(id)) issues.push(`duplicate safeguard id: ${id}`);
    if (id) allIds.add(id);
    const kind = requiredString(row.kind, `${label}.kind`, issues);
    if (kind && kind !== "runtime-log-only") issues.push(`${label}.kind is unsupported`);
    if (kind === "runtime-log-only") {
      runtimeCount += 1;
      if (id) runtimeIds.add(id);
      const sensor = requiredString(row.sensor, `${label}.sensor`, issues);
      if (
        sensor === SAFEGUARDS_LOG_STEM ||
        sensor === SAFEGUARDS_LOG_FILE ||
        sensor?.endsWith(`/${SAFEGUARDS_LOG_FILE}`)
      ) {
        issues.push(`${label}.sensor must not use the ${SAFEGUARDS_LOG_STEM} filename as a sensor identity`);
      }
      const version = requiredString(row.version, `${label}.version`, issues);
      if (row.definitionVersion !== undefined && version && row.definitionVersion !== version) {
        issues.push(`${label}.definitionVersion must equal version when present`);
      }
      const definitionHash = requiredString(
        row.definitionSha256,
        `${label}.definitionSha256`,
        issues,
        SHA256,
      );
      if (definitionHash && definitionHashes.has(id) && definitionHash !== definitionHashes.get(id)) {
        issues.push(`${label}.definitionSha256 does not match the measured safeguard definition`);
      }
    }
    const status = requiredString(row.status, `${label}.status`, issues);
    if (status && !SAFEGUARD_STATUSES.has(status)) issues.push(`${label}.status is unsupported`);
    requiredString(row.owner, `${label}.owner`, issues);
    pointers(row.evidencePointers, `${label}.evidencePointers`, issues);
    const binding = requiredRecord(row.evidenceBinding, `${label}.evidenceBinding`, issues);
    if (binding) {
      for (const key of IDENTITY_FIELDS) {
        requiredString(
          binding[key],
          `${label}.evidenceBinding.${key}`,
          issues,
          key === "sourceRevision" ? GIT_SHA : null,
        );
        if (identityRow && binding[key] !== identityRow[key]) {
          issues.push(`${label}.evidenceBinding.${key} differs from archive identity`);
        }
      }
    }
    const opportunity = stateEvidence(
      row.opportunity,
      `${label}.opportunity`,
      new Set(["present", "absent", "unknown"]),
      issues,
    );
    const firing = stateEvidence(
      row.firing,
      `${label}.firing`,
      new Set(["fired", "not-fired", "inconclusive", "not-applicable"]),
      issues,
    );
    if (status === "fired" && firing?.state !== "fired") {
      issues.push(`${label} status fired disagrees with firing state`);
    }
    if (kind === "runtime-log-only") {
      const opportunityState = opportunity?.state ?? "unknown";
      const receipts = ["logReceipt", "stderrReceipt", "processReceipt"].map((name) =>
        runtimeReceipt(row[name], `${label}.${name}`, status, opportunityState, issues),
      );
      if (
        opportunityState === "present" &&
        receipts.some(
          (receipt) => receipt === null || ["absent", "not-applicable"].includes(receipt.state),
        ) &&
        status !== "inconclusive"
      ) {
        issues.push(
          `${label} has a missing runtime receipt for a present opportunity; status must be inconclusive`,
        );
      }
      const action = requiredRecord(row.action, `${label}.action`, issues);
      if (action) {
        const actionState = requiredString(action.state, `${label}.action.state`, issues);
        if (actionState && !RUNTIME_ACTION_STATES.has(actionState)) {
          issues.push(`${label}.action.state is unsupported`);
        }
        const actionOwner = requiredString(action.owner, `${label}.action.owner`, issues);
        if (actionOwner && actionOwner !== row.owner) issues.push(`${label}.action.owner differs from owner`);
        pointers(action.evidencePointers, `${label}.action.evidencePointers`, issues);
        if (actionState === "not-applicable" && opportunityState !== "absent") {
          issues.push(`${label}.action may be not-applicable only with no opportunity`);
        }
      }
      const backtrack = requiredRecord(row.backtrack, `${label}.backtrack`, issues);
      if (backtrack) {
        const backtrackState = requiredString(backtrack.state, `${label}.backtrack.state`, issues);
        if (backtrackState && !RUNTIME_BACKTRACK_STATES.has(backtrackState)) {
          issues.push(`${label}.backtrack.state is unsupported`);
        }
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
      const routeState = requiredString(route.state, `${label}.route.state`, issues);
      if (routeState && !ROUTE_STATES.has(routeState)) issues.push(`${label}.route.state is unsupported`);
      if (firing?.state === "fired" && routeState !== "routed") {
        issues.push(`${label} fired safeguard must be routed to its owner`);
      }
    }
    const retirement = requiredRecord(row.retirement, `${label}.retirement`, issues);
    if (retirement) {
      if (!isBoolean(retirement.retired)) issues.push(`${label}.retirement.retired must be boolean`);
      if (
        !isNumber(retirement.eligibleIterations) ||
        !Number.isInteger(retirement.eligibleIterations) ||
        retirement.eligibleIterations < 0
      ) {
        issues.push(`${label}.retirement.eligibleIterations must be a non-negative integer`);
      }
      if (!isBoolean(retirement.backtrackPreserved)) {
        issues.push(`${label}.retirement.backtrackPreserved must be boolean`);
      }
      pointers(retirement.backtrackPointers, `${label}.retirement.backtrackPointers`, issues, {
        atLeastOne: false,
      });
      const independentReview =
        retirement.retired === true
          ? requiredRecord(retirement.independentReview, `${label}.retirement.independentReview`, issues)
          : asRecord(retirement.independentReview);
      if (independentReview) {
        if (independentReview.reviewed !== true) {
          issues.push(`${label}.retirement.independentReview.reviewed must be true`);
        }
        pointers(
          independentReview.evidencePointers,
          `${label}.retirement.independentReview.evidencePointers`,
          issues,
        );
      }
      if (
        retirement.retired === true &&
        (retirement.eligibleIterations < 2 ||
          retirement.backtrackPreserved !== true ||
          retirement.backtrackPointers.length === 0 ||
          independentReview?.reviewed !== true)
      ) {
        issues.push(`${label} cannot retire before two eligible iterations with preserved backtracking`);
      }
    }
  });
  const helperAvailable = identityRow?.worktree
    ? existsSync(resolve(identityRow.worktree, "src/meta/safeguard.ts"))
    : false;
  if (runtimeCount === 0 && helperAvailable) {
    issues.push("at least one runtime-log-only safeguard reconciliation row is required");
  }
  safeguardCensus(review, identityRow, runtimeIds, issues);
}

function safeguardCensus(review, identityRow, runtimeIds, issues) {
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
  if (identityRow) {
    if (sourceRevision && sourceRevision !== identityRow.sourceRevision) {
      issues.push("safeguardCensus.sourceRevision differs from measured source");
    }
    if (sourceDigest && sourceDigest !== identityRow.sourceDigest) {
      issues.push("safeguardCensus.sourceDigest differs from measured source");
    }
  }
  const helperAvailable = identityRow?.worktree
    ? existsSync(resolve(identityRow.worktree, "src/meta/safeguard.ts"))
    : false;
  if (!helperAvailable) {
    if (census.availability !== "unobservable") {
      issues.push("safeguardCensus.availability must be unobservable when the measured helper is absent");
    }
    const absentCallers = requiredArray(census.callerFiles, "safeguardCensus.callerFiles", issues);
    const absentIds = requiredArray(census.ids, "safeguardCensus.ids", issues);
    if (absentCallers.length > 0) {
      issues.push("safeguardCensus.callerFiles must be empty when the measured helper is absent");
    }
    if (absentIds.length > 0) {
      issues.push("safeguardCensus.ids must be empty when the measured helper is absent");
    }
    if (runtimeIds.size > 0) {
      issues.push("runtime safeguard rows must be empty when the measured helper is absent");
    }
    pointers(census.evidencePointers, "safeguardCensus.evidencePointers", issues);
    return;
  }
  const definitionFile = requiredString(census.definitionFile, "safeguardCensus.definitionFile", issues);
  if (definitionFile === SAFEGUARDS_LOG_STEM || definitionFile === SAFEGUARDS_LOG_FILE) {
    issues.push(`safeguardCensus.definitionFile must name the measured source, not ${SAFEGUARDS_LOG_STEM}`);
  }
  if (definitionFile && definitionFile !== "src/meta/safeguard.ts") {
    issues.push("safeguardCensus.definitionFile must name src/meta/safeguard.ts");
  }
  const derivation = requiredString(census.derivation, "safeguardCensus.derivation", issues);
  if (derivation && derivation !== "source-callers-v1") {
    issues.push("safeguardCensus.derivation is unsupported");
  }
  const callerFiles = requiredArray(census.callerFiles, "safeguardCensus.callerFiles", issues);
  const derivedIds = new Set();
  const seenFiles = new Set();
  callerFiles.forEach((value, index) => {
    const label = `safeguardCensus.callerFiles[${index}]`;
    const file = requiredRecord(value, label, issues);
    if (!file) return;
    const relativeFile = requiredString(file.relativeFile, `${label}.relativeFile`, issues);
    if (
      relativeFile &&
      (isAbsolute(relativeFile) ||
        relativeFile.includes("\\") ||
        relativeFile.includes("..") ||
        relativeFile.startsWith("."))
    ) {
      issues.push(`${label}.relativeFile must be a safe source-relative path`);
    }
    if (relativeFile && seenFiles.has(relativeFile)) {
      issues.push(`duplicate safeguard census source file: ${relativeFile}`);
    }
    if (relativeFile) seenFiles.add(relativeFile);
    const fileHash = requiredString(file.sha256, `${label}.sha256`, issues, SHA256);
    const idsForFile = requiredArray(file.ids, `${label}.ids`, issues);
    const declaredIds = new Set();
    idsForFile.forEach((id, idIndex) => {
      const valueId = requiredString(id, `${label}.ids[${idIndex}]`, issues);
      if (valueId) {
        if (declaredIds.has(valueId)) issues.push(`${label}.ids repeats ${valueId}`);
        declaredIds.add(valueId);
        derivedIds.add(valueId);
      }
    });
    if (!identityRow || !relativeFile) return;
    const sourcePath = resolve(identityRow.worktree, relativeFile);
    if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
      issues.push(`${label}.relativeFile is absent from the measured worktree`);
      return;
    }
    const bytes = readFileSync(sourcePath);
    if (fileHash && fileHash !== sha256(bytes)) {
      issues.push(`${label}.sha256 does not match the measured source bytes`);
    }
    const extracted = new Set(
      [...bytes.toString("utf8").matchAll(/safeguardTriggered\s*\(\s*["'`]([^"'`]+)["'`]/g)].map(
        (match) => match[1],
      ),
    );
    if (JSON.stringify([...declaredIds].sort()) !== JSON.stringify([...extracted].sort())) {
      issues.push(`${label}.ids must be derived from its exact safeguardTriggered callers`);
    }
  });
  if (!seenFiles.has(definitionFile)) {
    issues.push("safeguardCensus.callerFiles must include the measured safeguard definition file");
  }
  const ids = requiredArray(census.ids, "safeguardCensus.ids", issues);
  const unique = new Set();
  ids.forEach((value, index) => {
    const id = requiredString(value, `safeguardCensus.ids[${index}]`, issues);
    if (id === SAFEGUARDS_LOG_STEM || id === SAFEGUARDS_LOG_FILE) {
      issues.push(`safeguardCensus.ids must not contain the ${SAFEGUARDS_LOG_STEM} filename`);
    }
    if (id && unique.has(id)) issues.push(`duplicate safeguardCensus id: ${id}`);
    if (id) unique.add(id);
  });
  if (identityRow?.worktree && existsSync(`${identityRow.worktree}/src`)) {
    const sourceCallers = sourceSafeguardCallers(identityRow.worktree);
    if (JSON.stringify([...sourceCallers.keys()].sort()) !== JSON.stringify([...seenFiles].sort())) {
      issues.push("safeguardCensus.callerFiles must enumerate every measured source caller exactly");
    }
    const sourceIds = new Set(
      sourceCallers
        .values()
        .flatMap((callerIds) => [...callerIds])
        .toArray(),
    );
    if (sourceIds.size !== unique.size || [...sourceIds].some((id) => !unique.has(id))) {
      issues.push("safeguardCensus.ids must equal every literal safeguard id in the measured source");
    }
  }
  if (unique.size !== runtimeIds.size || [...unique].some((id) => !runtimeIds.has(id))) {
    issues.push("safeguardCensus.ids must equal the runtime safeguard rows exactly");
  }
  if (derivedIds.size !== unique.size || [...derivedIds].some((id) => !unique.has(id))) {
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
    const row = asRecord(value);
    if (!row) {
      issues.push(`learningHandoff.experimentProposals[${index}] must be an object`);
      return;
    }
    for (const key of ["id", "owner", "expectedEffect", "falsifier", "disposition"]) {
      requiredString(row[key], `learningHandoff.experimentProposals[${index}].${key}`, issues);
    }
    if (row.disposition === "promote" || row.disposition === "launch" || row.disposition === "merge") {
      issues.push("WRI proposal cannot carry promotion or launch authority");
    }
    pointers(row.evidencePointers, `learningHandoff.experimentProposals[${index}].evidencePointers`, issues);
  });
}

function advisoryProjection(review, name, issues) {
  const row = requiredRecord(review[name], name, issues);
  if (!row) return;
  const state = requiredString(row.state, `${name}.state`, issues);
  if (state && !new Set(["bound", "not-used", "unavailable"]).has(state)) {
    issues.push(`${name}.state is unsupported`);
  }
  if (row.authority !== "advisory") issues.push(`${name}.authority must be exactly advisory`);
  requiredString(row.reason, `${name}.reason`, issues);
  pointers(row.evidencePointers, `${name}.evidencePointers`, issues);
  if (row.copiedReports !== undefined) {
    issues.push(`${name}.copiedReports is not an archive projection field`);
  }
  if (state === "not-used" && isString(row.reason) && row.reason.toLowerCase().includes("closed")) {
    issues.push(`${name}.reason must not claim campaign closure`);
  }
}

function readArchive(archiveDir, issues) {
  if (!isAbsolute(archiveDir)) issues.push("archive path must be absolute");
  if (!existsSync(archiveDir) || !lstatSync(archiveDir).isDirectory()) {
    issues.push(`archive directory does not exist: ${archiveDir}`);
    return null;
  }
  const entries = readdirSync(archiveDir, { withFileTypes: true });
  const names = entries.map((entry) => entry.name);
  for (const name of ARCHIVE_FILES) if (!names.includes(name)) issues.push(`archive is missing ${name}`);
  for (const name of names) {
    if (!ARCHIVE_FILE_SET.has(name)) issues.push(`archive contains forbidden extra file: ${name}`);
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) issues.push(`archive entry is a symlink: ${entry.name}`);
    else if (!entry.isFile()) issues.push(`archive entry is not a regular file: ${entry.name}`);
  }
  if (issues.length > 0 || !names.includes(REVIEW_FILE)) return null;
  try {
    return readJsonFile(`${archiveDir}/${REVIEW_FILE}`);
  } catch (error) {
    issues.push(`${REVIEW_FILE} is not valid JSON: ${error.message}`);
    return null;
  }
}

export function validateArchiveDirectory(archivePath) {
  const archiveDir = resolve(archivePath);
  const issues = [];
  const review = readArchive(archiveDir, issues);
  if (review === null) throw new ArchiveValidationError(issues);
  const reviewRecord = requiredRecord(review, REVIEW_FILE, issues);
  if (!reviewRecord) throw new ArchiveValidationError(issues);
  if (reviewRecord.schema !== "wri-archive/v1") issues.push(`${REVIEW_FILE} schema must be wri-archive/v1`);
  const identityRow = identity(reviewRecord, issues);
  const stage = lifecycle(reviewRecord, issues);
  procedureIdentity(reviewRecord, identityRow, issues);
  ledgerProjection(reviewRecord, identityRow, issues);
  launchIdentity(reviewRecord, stage, issues);
  digestRows(reviewRecord, issues);
  terminalAccounting(reviewRecord, issues);
  terminalOutcome(reviewRecord, asRecord(reviewRecord.terminalAccounting), issues);
  reviewCoverage(reviewRecord, identityRow, issues);
  predictionRows(reviewRecord, identityRow, archiveDir, stage, issues);
  safeguardRows(reviewRecord, identityRow, issues);
  safeguardReconciliation(reviewRecord, identityRow, issues);
  rejectAuthority(reviewRecord, issues);
  advisoryProjection(reviewRecord, "metaReview", issues);
  advisoryProjection(reviewRecord, "conditionManifest", issues);
  sectionPointers(reviewRecord, issues);
  scanPathFields(reviewRecord, REVIEW_FILE, issues);
  verifyPointerFiles(reviewRecord, REVIEW_FILE, archiveDir, issues);
  const primary = requiredRecord(reviewRecord.primaryReview, "primaryReview", issues);
  if (primary) {
    requiredString(primary.assertion, "primaryReview.assertion", issues);
    if (primary.protectedEvidenceChecked !== true) {
      issues.push("primaryReview.protectedEvidenceChecked must be true");
    }
    pointers(primary.evidencePointers, "primaryReview.evidencePointers", issues);
  }
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

function outputInsideArchive(archiveDir, outputPath) {
  const path = resolve(outputPath);
  const child = relative(archiveDir, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

export function writeArchive({ archiveDir, mainSynthesis, lunaSyntheses, digest, review }) {
  const target = resolve(archiveDir);
  if (existsSync(target)) throw new Error("refusing to overwrite an existing WRI archive");
  const files = {
    "main_synthesis.md": mainSynthesis,
    "luna_syntheses.md": lunaSyntheses,
    "digest.md": digest,
  };
  for (const [name, value] of Object.entries(files)) {
    if (!isString(value) || value.length === 0) throw new Error(`${name} must contain text`);
  }
  if (!asRecord(review)) throw new Error("review must be an object");
  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(`${target}.staging-`);
  try {
    for (const [name, value] of Object.entries(files)) writeFileSync(`${staging}/${name}`, value, "utf8");
    writeFileSync(`${staging}/review.json`, `${JSON.stringify(review, null, 2)}\n`, "utf8");
    const result = validateArchiveDirectory(staging);
    renameSync(staging, target);
    return { ...result, archiveDir: target };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs() {
  const values = new Map();
  for (let index = 2; index < Bun.argv.length; index += 1) {
    const name = Bun.argv[index];
    if (!["--archive", "--out"].includes(name)) throw new Error(`unknown argument: ${name}`);
    if (values.has(name)) throw new Error(`duplicate argument: ${name}`);
    const value = Bun.argv[index + 1];
    if (!value || value.startsWith("--") || !isAbsolute(value)) {
      throw new Error(`${name} must receive an absolute path`);
    }
    values.set(name, value);
    index += 1;
  }
  if (!values.has("--archive")) {
    throw new Error(
      "usage: validate-archive.mjs --archive <absolute directory> [--out <absolute json outside archive>]",
    );
  }
  const archiveDir = resolve(values.get("--archive"));
  const out = values.get("--out") ? resolve(values.get("--out")) : null;
  if (hasText(out) && outputInsideArchive(archiveDir, out)) {
    throw new Error("--out must be outside the four-file archive");
  }
  return { archiveDir, out };
}

if (import.meta.main) {
  try {
    const args = parseArgs();
    const result = validateArchiveDirectory(args.archiveDir);
    if (hasText(args.out)) writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    else console.log(JSON.stringify(result));
  } catch (error) {
    if (error instanceof ArchiveValidationError) {
      console.error(`validate-archive: ${error.message}`);
      runtimeProcess.exitCode = 1;
    } else {
      console.error(`validate-archive: ${error.message}`);
      runtimeProcess.exitCode = 2;
    }
  }
}
