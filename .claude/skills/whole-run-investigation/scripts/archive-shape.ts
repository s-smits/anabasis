// The WRI archive's declared shape: its four files, the headings and anchors of the primary's
// synthesis, the frozen prediction fields, the identity fields and the closed state sets. The
// scaffold writes against these declarations and the validator checks against the same ones, so
// the two cannot drift into accepting different archives. The field primitives and the envelope
// checks (identity, lifecycle, digests, terminal accounting, pointers) live here beside them.
import { sha256 } from "#src/meta/digest.ts";
import { asRecord, isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { isAbsolute } from "#src/meta/path.ts";
import { canonicalJson } from "#src/meta/stable-json.ts";
import { GIT_SHA, SHA256 } from "./catalogue-shape.ts";

export const ARCHIVE_SCHEMA = "wri-archive/v2";
export const ARCHIVE_FILES = ["main_synthesis.md", "luna_syntheses.md", "digest.md", "review.json"] as const;
export const [MAIN, LUNA, DIGEST, REVIEW] = ARCHIVE_FILES;
export const ARCHIVE_PATHS: ReadonlySet<string> = new Set<string>(ARCHIVE_FILES);
/** The schema of the ledger projection `review.json` carries, written by the scaffold and checked here. */
export const LEDGER_PROJECTION_SCHEMA = "superloop-ledger-projection/v1";
/** The measured worktree's safeguard helper, relative to its root: the file the safeguard census
 *  is derived from and the one its `definitionFile` names. */
export const SAFEGUARD_DEFINITION_FILE = "src/meta/safeguard.ts";

/** The sections of `main_synthesis.md`, written once as a skeleton for the primary to fill. */
export const MAIN_HEADINGS = [
  "## Identity and evidence",
  "## Recorded result",
  "## Findings",
  "## Deterministic rows",
  "## Independent reviews and limits",
  "## Climb meaning and continuity",
  "## Prediction ledger",
  "## Safeguards",
  "### Safeguards T0",
  "### Safeguards T1",
  "## Terminal accounting",
  "## Source proof and replacement decision",
  "## What to do next",
  "### Patch",
  "### Consolidate",
  "### Overhaul",
];
/** Anchors into `main_synthesis.md`: each is the GitHub slug of its `MAIN_HEADINGS` row. */
export const ANCHOR = {
  ledger: "#prediction-ledger",
  reviews: "#independent-reviews-and-limits",
  safeguards: "#safeguards",
  safeguardsT0: "#safeguards-t0",
  safeguardsT1: "#safeguards-t1",
  terminal: "#terminal-accounting",
};

/** The fields a prediction freezes before launch; `frozenHash` binds exactly these. */
export const FROZEN_PREDICTION_FIELDS = [
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
/** The five fields that name one measured condition. Every row that binds itself to the archive's
 *  identity carries the same five. */
export const IDENTITY_FIELDS: readonly IdentityField[] = [
  "sourceRevision",
  "runId",
  "epoch",
  "bundle",
  "taskSet",
];
const IDENTITY_PATTERNS = new Map<string, RegExp>([
  ["sourceRevision", GIT_SHA],
  ["runGitHash", GIT_SHA],
  ["sourceDigest", SHA256],
]);

/** A safeguard route the primary adjudicated; `inconclusive` is what the scaffold writes without one. */
export const ADJUDICATED_ROUTES: ReadonlySet<string> = new Set(["routed", "held", "not-routed"]);
export const ROUTE_STATES: ReadonlySet<string> = new Set([...ADJUDICATED_ROUTES, "inconclusive"]);

const RECEIPTS = [
  "ticket",
  "prompt",
  "project",
  "task",
  "condition",
  "cap",
  "preflight",
  "cas",
  "opening",
  "terminal",
];
/** A tier reconciliation also binds the source digest, against the measured identity. */
const MEASURED_IDENTITY_FIELDS: readonly IdentityField[] = [
  "runId",
  "sourceRevision",
  "sourceDigest",
  "epoch",
  "bundle",
  "taskSet",
];
/** Issues a check appends to, one sentence each. */
export type Issues = string[];
/** The archive's own identity fields, each the string the review recorded or "" when refused. */
export interface ArchiveIdentity {
  readonly runId: string;
  readonly sourceRevision: string;
  readonly runGitHash: string;
  readonly sourceDigest: string;
  readonly worktree: string;
  readonly epoch: string;
  readonly bundle: string;
  readonly taskSet: string;
}
export type IdentityField = keyof ArchiveIdentity;
/** One state-bearing row and the state it declared. */
export interface StateEvidence {
  row: JsonObject;
  state: string;
}

export function predictionFrozenHash(row: Readonly<Record<string, JsonValue | undefined>>): string {
  const frozen: Record<string, JsonValue | undefined> = {};
  for (const key of FROZEN_PREDICTION_FIELDS) frozen[key] = row[key];
  return sha256(canonicalJson(frozen));
}

/** The GitHub slug of one heading's text. */
export function headingSlug(heading: string): string {
  return heading
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9 -]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export function requiredString(
  value: unknown,
  label: string,
  issues: Issues,
  pattern: RegExp | null = null,
): string {
  if (!isString(value) || value.trim().length === 0) {
    issues.push(`${label} must be a non-empty string`);
    return "";
  }
  if (pattern !== null && !pattern.test(value)) issues.push(`${label} has an invalid identity`);
  return value;
}
export function requiredRecord(value: unknown, label: string, issues: Issues): JsonObject | null {
  const row = asRecord(value);
  if (!row) issues.push(`${label} must be an object`);
  return row;
}
export function requiredArray(value: unknown, label: string, issues: Issues): readonly unknown[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return [];
  }
  return value;
}
/** A required string drawn from a closed set; `showValue` names the refused value in the issue. */
export function oneOf(
  value: unknown,
  label: string,
  states: ReadonlySet<string>,
  issues: Issues,
  showValue = false,
): string {
  const state = requiredString(value, label, issues);
  if (state && !states.has(state)) issues.push(`${label} is unsupported${showValue ? `: ${state}` : ""}`);
  return state;
}
export function nonNegativeInt(value: unknown, label: string, issues: Issues): void {
  if (!isNumber(value) || !Number.isInteger(value) || value < 0) {
    issues.push(`${label} must be a non-negative integer`);
  }
}
export function requiredStrings(value: unknown, label: string, issues: Issues): readonly unknown[] {
  const rows = requiredArray(value, label, issues);
  rows.forEach((item, index) => requiredString(item, `${label}[${index}]`, issues));
  return rows;
}
/** Each named identity field is present, well formed and equal to the archive's own. */
export function boundIdentity(
  row: JsonObject,
  label: string,
  identityRow: ArchiveIdentity | null,
  issues: Issues,
  measured = false,
): void {
  const against = measured ? "measured" : "archive";
  for (const key of measured ? MEASURED_IDENTITY_FIELDS : IDENTITY_FIELDS) {
    requiredString(row[key], `${label}.${key}`, issues, IDENTITY_PATTERNS.get(key) ?? null);
    if (identityRow && row[key] !== identityRow[key]) {
      issues.push(`${label}.${key} differs from ${against} identity`);
    }
  }
}
export function safeArchivePath(value: unknown): boolean {
  return (
    isString(value) &&
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes("\\") &&
    !value.includes("..") &&
    value.split("/").every((part) => part.length > 0 && part !== ".") &&
    ARCHIVE_PATHS.has(value)
  );
}
export function pointer(value: unknown, label: string, issues: Issues): void {
  const row = requiredRecord(value, label, issues);
  if (!row) return;
  const path = requiredString(row.path, `${label}.path`, issues);
  if (path && !safeArchivePath(path)) issues.push(`${label}.path must name one of the four archive files`);
  const anchor = requiredString(row.anchor, `${label}.anchor`, issues);
  if (anchor && !anchor.startsWith("#")) issues.push(`${label}.anchor must start with #`);
  requiredString(row.sha256, `${label}.sha256`, issues, SHA256);
}
export function pointers(
  value: unknown,
  label: string,
  issues: Issues,
  { atLeastOne = true }: { atLeastOne?: boolean } = {},
): void {
  const rows = requiredArray(value, label, issues);
  if (atLeastOne && rows.length === 0) issues.push(`${label} must contain an evidence pointer`);
  rows.forEach((row, index) => pointer(row, `${label}[${index}]`, issues));
}
export function stateEvidence(
  value: unknown,
  label: string,
  states: ReadonlySet<string>,
  issues: Issues,
): StateEvidence | null {
  const row = requiredRecord(value, label, issues);
  if (!row) return null;
  const state = oneOf(row.state, `${label}.state`, states, issues, true);
  pointers(row.evidencePointers, `${label}.evidencePointers`, issues);
  return { row, state };
}

export function identity(review: JsonObject, issues: Issues): ArchiveIdentity | null {
  const row = requiredRecord(review.identity, "identity", issues);
  if (!row) return null;
  const field = (key: IdentityField): string =>
    requiredString(row[key], `identity.${key}`, issues, IDENTITY_PATTERNS.get(key) ?? null);
  const result: ArchiveIdentity = {
    runId: field("runId"),
    sourceRevision: field("sourceRevision"),
    runGitHash: field("runGitHash"),
    sourceDigest: field("sourceDigest"),
    worktree: field("worktree"),
    epoch: field("epoch"),
    bundle: field("bundle"),
    taskSet: field("taskSet"),
  };
  if (result.worktree && !isAbsolute(result.worktree)) {
    issues.push("identity.worktree must be an absolute recorded worktree");
  }
  return result;
}
export function lifecycle(review: JsonObject, issues: Issues): string | null {
  const row = requiredRecord(review.lifecycle, "lifecycle", issues);
  return row
    ? oneOf(row.stage, "lifecycle.stage", new Set(["preopening", "live", "terminal"]), issues)
    : null;
}
export function procedureIdentity(
  review: JsonObject,
  identityRow: ArchiveIdentity | null,
  issues: Issues,
): void {
  const row = requiredRecord(review.procedureIdentity, "procedureIdentity", issues);
  if (!row) return;
  requiredString(row.name, "procedureIdentity.name", issues);
  requiredString(row.version, "procedureIdentity.version", issues);
  const fields = ["sourceRevision", "sourceDigest", "worktree"] as const;
  const own = {
    sourceRevision: requiredString(row.sourceRevision, "procedureIdentity.sourceRevision", issues, GIT_SHA),
    sourceDigest: requiredString(row.sourceDigest, "procedureIdentity.sourceDigest", issues, SHA256),
    worktree: requiredString(row.worktree, "procedureIdentity.worktree", issues),
  };
  if (own.worktree && !isAbsolute(own.worktree)) issues.push("procedureIdentity.worktree must be absolute");
  if (!isBoolean(row.sameTree)) issues.push("procedureIdentity.sameTree must be boolean");
  if (identityRow && row.sameTree === false && fields.every((key) => own[key] === identityRow[key])) {
    issues.push("procedureIdentity must differ from product identity when sameTree is false");
  }
  if (row.sameTree === true && identityRow) {
    for (const key of fields) {
      if (own[key] && own[key] !== identityRow[key]) {
        issues.push(`procedureIdentity.${key} differs from archive identity while sameTree is true`);
      }
    }
  }
  const digest = requiredString(row.sha256, "procedureIdentity.sha256", issues, SHA256);
  if (digest && own.sourceDigest && digest !== own.sourceDigest) {
    issues.push("procedureIdentity.sha256 must be the single procedure source digest");
  }
  if (Object.hasOwn(row, "manifestSha256")) {
    issues.push("procedureIdentity.manifestSha256 is an unsupported duplicate; use procedureIdentity.sha256");
  }
  if (row.state === "bound") boundReceiptIdentities(row, "procedureIdentity", issues);
  pointer(row.pointer, "procedureIdentity.pointer", issues);
}
export function ledgerProjection(
  review: JsonObject,
  identityRow: ArchiveIdentity | null,
  issues: Issues,
): void {
  const row = requiredRecord(review.ledgerProjection, "ledgerProjection", issues);
  if (!row) return;
  if (row.schema !== LEDGER_PROJECTION_SCHEMA) {
    issues.push("ledgerProjection schema is not canonical");
  }
  if (row.authority !== "projection-only") issues.push("ledgerProjection must be projection-only");
  if (row.mutable !== false) issues.push("ledgerProjection.mutable must be false");
  const revision = requiredString(row.sourceRevision, "ledgerProjection.sourceRevision", issues, GIT_SHA);
  if (identityRow && revision && revision !== identityRow.sourceRevision) {
    issues.push("ledgerProjection.sourceRevision differs from archive identity");
  }
  requiredString(row.sha256, "ledgerProjection.sha256", issues, SHA256);
  pointer(row.pointer, "ledgerProjection.pointer", issues);
}
function boundReceiptIdentities(row: JsonObject, label: string, issues: Issues): void {
  for (const name of RECEIPTS) {
    const receipt = requiredRecord(row[name], `${label}.${name}`, issues);
    if (!receipt) continue;
    requiredString(receipt.id, `${label}.${name}.id`, issues);
    requiredString(receipt.sha256, `${label}.${name}.sha256`, issues, SHA256);
  }
}
export function launchIdentity(review: JsonObject, stage: string | null, issues: Issues): void {
  const row = requiredRecord(review.launchIdentity, "launchIdentity", issues);
  if (!row) return;
  const state = oneOf(
    row.state,
    "launchIdentity.state",
    new Set(["bound", "incomplete", "unavailable"]),
    issues,
  );
  if (state === "unavailable" && stage !== "preopening") {
    issues.push("launchIdentity.unavailable is valid only before opening");
  }
  if (state === "bound") {
    requiredString(row.sha256, "launchIdentity.sha256", issues, SHA256);
    pointer(row.pointer, "launchIdentity.pointer", issues);
    boundReceiptIdentities(row, "launchIdentity", issues);
  } else requiredString(row.reason, "launchIdentity.reason", issues);
}
export function digestRows(review: JsonObject, issues: Issues): void {
  const digests = requiredRecord(review.digests, "digests", issues);
  if (!digests) return;
  for (const name of ["snapshot", "manifest", "sessions", "reports"]) {
    const row = requiredRecord(digests[name], `digests.${name}`, issues);
    if (!row) continue;
    requiredString(row.sha256, `digests.${name}.sha256`, issues, SHA256);
    pointer(row.pointer, `digests.${name}.pointer`, issues);
  }
}
export function terminalOutcome(review: JsonObject, accounting: JsonObject | null, issues: Issues): void {
  const row = requiredRecord(review.terminal, "terminal", issues);
  if (!row) return;
  const outcome = oneOf(
    row.outcome,
    "terminal.outcome",
    new Set(["completed", "aborted", "incomplete"]),
    issues,
  );
  const capability = oneOf(
    row.capabilityResult,
    "terminal.capabilityResult",
    new Set(["recorded", "absent", "inconclusive"]),
    issues,
  );
  const denominatorState = asRecord(accounting?.denominator)?.state;
  if (capability === "recorded" && denominatorState !== "recorded") {
    issues.push("terminal.capabilityResult recorded requires a recorded capability denominator");
  }
  if (capability === "absent" && denominatorState === "recorded") {
    issues.push("terminal.capabilityResult absent cannot carry a recorded capability denominator");
  }
  if (outcome === "completed" && capability === "absent" && accounting?.state === "recorded") {
    issues.push(
      "completed controller outcome with absent capability result cannot have recorded terminal accounting",
    );
  }
}
/** A denominator's counts: each a non-negative integer, and a total the three case kinds reconcile. */
export function denominatorCounts(row: JsonObject, label: string, issues: Issues): boolean {
  const keys = ["total", "verified", "unaccepted", "nonResult"];
  for (const key of keys) nonNegativeInt(row[key], `${label}.${key}`, issues);
  const { total, verified, unaccepted, nonResult } = row;
  return !(
    isNumber(total) &&
    isNumber(verified) &&
    isNumber(unaccepted) &&
    isNumber(nonResult) &&
    total !== verified + unaccepted + nonResult
  );
}
export function terminalAccounting(review: JsonObject, issues: Issues): void {
  const row = requiredRecord(review.terminalAccounting, "terminalAccounting", issues);
  if (!row) return;
  const label = "terminalAccounting";
  const state = oneOf(row.state, `${label}.state`, new Set(["recorded", "incomplete"]), issues, true);
  const denominator = requiredRecord(row.denominator, `${label}.denominator`, issues);
  if (!denominator) return;
  const denominatorState = requiredString(denominator.state, `${label}.denominator.state`, issues);
  if (state === "recorded" && denominatorState !== "recorded") {
    issues.push("recorded terminal accounting requires a recorded denominator");
  }
  if (state && state !== "recorded" && denominatorState === "recorded") {
    issues.push("unfinished terminal accounting cannot claim a recorded denominator");
  }
  if (denominatorState === "recorded") {
    if (!denominatorCounts(denominator, `${label}.denominator`, issues)) {
      issues.push("terminalAccounting denominator does not reconcile");
    }
  } else if (denominatorState === "absent") requiredString(row.reason, `${label}.reason`, issues);
  else if (denominatorState === "invalid") {
    requiredString(denominator.reason, `${label}.denominator.reason`, issues);
    requiredString(row.reason, `${label}.reason`, issues);
  } else if (denominatorState) {
    issues.push("terminalAccounting.denominator.state must be recorded, absent or invalid");
  }
  pointer(row.evidencePointer, `${label}.evidencePointer`, issues);
  const optional = (value: JsonValue | undefined, name: string): void => {
    if (value !== null) nonNegativeInt(value, `${label}.${name}`, issues);
  };
  optional(row.outerCap, "outerCap");
  nonNegativeInt(row.completedRounds, `${label}.completedRounds`, issues);
  if (isNumber(row.outerCap) && isNumber(row.completedRounds) && row.completedRounds > row.outerCap) {
    issues.push("terminalAccounting.completedRounds cannot exceed outerCap");
  }
  const calls = requiredRecord(row.authorCalls, `${label}.authorCalls`, issues);
  if (calls) {
    if (calls.budget !== "uncapped") nonNegativeInt(calls.budget, `${label}.authorCalls.budget`, issues);
    for (const key of ["opening", "terminal", "delta"]) {
      nonNegativeInt(calls[key], `${label}.authorCalls.${key}`, issues);
    }
    const { opening, terminal, delta } = calls;
    if (isNumber(opening) && isNumber(terminal) && isNumber(delta) && terminal - opening !== delta) {
      issues.push("terminalAccounting.authorCalls.delta does not reconcile opening and terminal");
    }
  }
  const counts = requiredRecord(row.counts, `${label}.counts`, issues);
  if (counts) {
    optional(counts.raw, "counts.raw");
    optional(counts.real, "counts.real");
    nonNegativeInt(counts.controller, `${label}.counts.controller`, issues);
    if (
      isNumber(row.completedRounds) &&
      isNumber(counts.controller) &&
      row.completedRounds !== counts.controller
    ) {
      issues.push("terminalAccounting.completedRounds must equal terminalAccounting.counts.controller");
    }
  }
  const parents = requiredRecord(row.parents, `${label}.parents`, issues);
  if (parents) {
    for (const key of ["lastCandidate", "adopted", "accepted"]) {
      requiredString(parents[key], `${label}.parents.${key}`, issues);
    }
  }
  for (const key of [
    "realAuthoringIterations",
    "candidateSubmits",
    "controllerTerminalRows",
    "recordedSubmitRows",
  ]) {
    optional(row[key], key);
  }
  if (
    isNumber(row.candidateSubmits) &&
    isNumber(row.controllerTerminalRows) &&
    isNumber(row.recordedSubmitRows) &&
    row.recordedSubmitRows !== row.candidateSubmits + row.controllerTerminalRows
  ) {
    issues.push(
      "terminalAccounting.recordedSubmitRows must equal candidateSubmits plus controllerTerminalRows",
    );
  }
}
/** Every literal `safeguardTriggered(...)` id under the worktree's `src`, by source-relative file. */
export function sourceSafeguardCallers(worktree: string): Map<string, Set<string>> {
  const callers = new Map<string, Set<string>>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:ts|mts|js|mjs)$/.test(entry.name)) {
        const ids = [
          ...readFileSync(path, "utf8").matchAll(/safeguardTriggered\s*\(\s*["'`]([^"'`]+)["'`]/g),
        ].map((match) => match[1] ?? "");
        if (ids.length > 0) callers.set(path.slice(worktree.length + 1), new Set(ids));
      }
    }
  };
  const source = `${worktree}/src`;
  if (existsSync(source)) visit(source);
  return callers;
}
export function scanPathFields(value: unknown, label: string, issues: Issues): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPathFields(item, `${label}[${index}]`, issues));
    return;
  }
  const row = asRecord(value);
  if (!row) return;
  for (const [key, item] of Object.entries(row)) {
    if ((key === "path" || key.endsWith("Path")) && (!isString(item) || !safeArchivePath(item))) {
      issues.push(`${label}.${key} must be a safe path inside the four-file archive`);
    }
    scanPathFields(item, `${label}.${key}`, issues);
  }
}
function headingAnchor(text: string, anchor: string): boolean {
  const target = anchor
    .slice(1)
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].some((match) => headingSlug(match[1] ?? "") === target);
}
export function verifyPointerFiles(value: unknown, label: string, archiveDir: string, issues: Issues): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => verifyPointerFiles(item, `${label}[${index}]`, archiveDir, issues));
    return;
  }
  const row = asRecord(value);
  if (!row) return;
  if (
    isString(row.path) &&
    isString(row.anchor) &&
    isString(row.sha256) &&
    safeArchivePath(row.path) &&
    existsSync(`${archiveDir}/${row.path}`)
  ) {
    const bytes = readFileSync(`${archiveDir}/${row.path}`);
    if (sha256(bytes) !== row.sha256) issues.push(`${label}.sha256 does not match ${row.path}`);
    if (!headingAnchor(bytes.toString("utf8"), row.anchor)) {
      issues.push(`${label}.anchor is absent from ${row.path}`);
    }
  }
  for (const [key, item] of Object.entries(row)) {
    verifyPointerFiles(item, `${label}.${key}`, archiveDir, issues);
  }
}
export function safeguardReconciliation(
  review: JsonObject,
  identityRow: ArchiveIdentity | null,
  issues: Issues,
): void {
  const row = requiredRecord(review.safeguardReconciliation, "safeguardReconciliation", issues);
  if (!row) return;
  if (row.bytesVerified !== true) issues.push("safeguardReconciliation.bytesVerified must be true");
  pointer(row.t0, "safeguardReconciliation.t0", issues);
  pointer(row.t1, "safeguardReconciliation.t1", issues);
  const t0 = asRecord(row.t0);
  const t1 = asRecord(row.t1);
  if (t0 && t1 && ["path", "anchor", "sha256"].every((key) => t0[key] === t1[key])) {
    issues.push("safeguardReconciliation T0 and T1 must have distinct evidence identities");
  }
  for (const name of ["t0", "t1"]) {
    const label = `safeguardReconciliation.${name}Identity`;
    const tierIdentity = requiredRecord(row[`${name}Identity`], label, issues);
    if (!tierIdentity) continue;
    if (tierIdentity.complete !== true) issues.push(`${label}.complete must be true`);
    boundIdentity(tierIdentity, label, identityRow, issues, true);
  }
}
export function sectionPointers(review: JsonObject, issues: Issues): void {
  const sections = requiredRecord(review.sectionPointers, "sectionPointers", issues);
  if (!sections) return;
  for (const name of ["predictionLedger", "safeguards", "terminalAccounting"]) {
    pointer(sections[name], `sectionPointers.${name}`, issues);
  }
}
