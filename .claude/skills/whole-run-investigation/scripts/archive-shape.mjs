import { asRecord, isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { isAbsolute } from "#src/meta/path.ts";

export const SHA256 = /^[0-9a-f]{64}$/;
export const GIT_SHA = /^[0-9a-f]{40}$/;
const ARCHIVE_PATHS = new Set(["main_synthesis.md", "luna_syntheses.md", "digest.md", "review.json"]);

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
/** @param {RegExp | null} [pattern] */
export function requiredString(value, label, issues, pattern = null) {
  if (!isString(value) || value.trim().length === 0) {
    issues.push(`${label} must be a non-empty string`);
    return "";
  }
  if (pattern !== null && !pattern.test(value)) issues.push(`${label} has an invalid identity`);
  return value;
}
export function requiredRecord(value, label, issues) {
  const row = asRecord(value);
  if (!row) issues.push(`${label} must be an object`);
  return row;
}
export function requiredArray(value, label, issues) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return [];
  }
  return value;
}
export function safeArchivePath(value) {
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
export function pointer(value, label, issues) {
  const row = requiredRecord(value, label, issues);
  if (!row) return;
  const path = requiredString(row.path, `${label}.path`, issues);
  if (path && !safeArchivePath(path)) issues.push(`${label}.path must name one of the four archive files`);
  const anchor = requiredString(row.anchor, `${label}.anchor`, issues);
  if (anchor && !anchor.startsWith("#")) issues.push(`${label}.anchor must start with #`);
  requiredString(row.sha256, `${label}.sha256`, issues, SHA256);
}
export function pointers(value, label, issues, { atLeastOne = true } = {}) {
  const rows = requiredArray(value, label, issues);
  if (atLeastOne && rows.length === 0) issues.push(`${label} must contain an evidence pointer`);
  rows.forEach((row, index) => pointer(row, `${label}[${index}]`, issues));
}
export function stateEvidence(value, label, states, issues) {
  const row = requiredRecord(value, label, issues);
  if (!row) return null;
  const state = requiredString(row.state, `${label}.state`, issues);
  if (state && !states.has(state)) issues.push(`${label}.state is unsupported: ${state}`);
  pointers(row.evidencePointers, `${label}.evidencePointers`, issues);
  return { row, state };
}
export function identity(review, issues) {
  const row = requiredRecord(review.identity, "identity", issues);
  if (!row) return null;
  const result = {
    runId: requiredString(row.runId, "identity.runId", issues),
    sourceRevision: requiredString(row.sourceRevision, "identity.sourceRevision", issues, GIT_SHA),
    runGitHash: requiredString(row.runGitHash, "identity.runGitHash", issues, GIT_SHA),
    sourceDigest: requiredString(row.sourceDigest, "identity.sourceDigest", issues, SHA256),
    worktree: requiredString(row.worktree, "identity.worktree", issues),
    epoch: requiredString(row.epoch, "identity.epoch", issues),
    bundle: requiredString(row.bundle, "identity.bundle", issues),
    taskSet: requiredString(row.taskSet, "identity.taskSet", issues),
  };
  if (result.worktree && !isAbsolute(result.worktree)) {
    issues.push("identity.worktree must be an absolute recorded worktree");
  }
  return result;
}
export function lifecycle(review, issues) {
  const row = requiredRecord(review.lifecycle, "lifecycle", issues);
  if (!row) return null;
  const stage = requiredString(row.stage, "lifecycle.stage", issues);
  if (stage && !new Set(["preopening", "live", "terminal"]).has(stage)) {
    issues.push("lifecycle.stage is unsupported");
  }
  return stage;
}
export function procedureIdentity(review, identityRow, issues) {
  const row = requiredRecord(review.procedureIdentity, "procedureIdentity", issues);
  if (!row) return;
  requiredString(row.name, "procedureIdentity.name", issues);
  requiredString(row.version, "procedureIdentity.version", issues);
  const revision = requiredString(row.sourceRevision, "procedureIdentity.sourceRevision", issues, GIT_SHA);
  const sourceDigest = requiredString(row.sourceDigest, "procedureIdentity.sourceDigest", issues, SHA256);
  const worktree = requiredString(row.worktree, "procedureIdentity.worktree", issues);
  if (worktree && !isAbsolute(worktree)) issues.push("procedureIdentity.worktree must be absolute");
  if (!isBoolean(row.sameTree)) issues.push("procedureIdentity.sameTree must be boolean");
  if (
    identityRow &&
    row.sameTree === false &&
    revision === identityRow.sourceRevision &&
    sourceDigest === identityRow.sourceDigest &&
    worktree === identityRow.worktree
  ) {
    issues.push("procedureIdentity must differ from product identity when sameTree is false");
  }
  if (row.sameTree === true && identityRow) {
    if (revision && revision !== identityRow.sourceRevision) {
      issues.push("procedureIdentity.sourceRevision differs from archive identity while sameTree is true");
    }
    if (sourceDigest && sourceDigest !== identityRow.sourceDigest) {
      issues.push("procedureIdentity.sourceDigest differs from archive identity while sameTree is true");
    }
    if (worktree && worktree !== identityRow.worktree) {
      issues.push("procedureIdentity.worktree differs from archive identity while sameTree is true");
    }
  }
  const digest = requiredString(row.sha256, "procedureIdentity.sha256", issues, SHA256);
  if (digest && sourceDigest && digest !== sourceDigest) {
    issues.push("procedureIdentity.sha256 must be the single procedure source digest");
  }
  if (Object.prototype.hasOwnProperty.call(row, "manifestSha256")) {
    issues.push("procedureIdentity.manifestSha256 is an unsupported duplicate; use procedureIdentity.sha256");
  }
  if (row.state === "bound") boundReceiptIdentities(row, "procedureIdentity", issues);
  pointer(row.pointer, "procedureIdentity.pointer", issues);
}
export function ledgerProjection(review, identityRow, issues) {
  const row = requiredRecord(review.ledgerProjection, "ledgerProjection", issues);
  if (!row) return;
  if (row.schema !== "superloop-ledger-projection/v1") {
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
function boundReceiptIdentities(row, label, issues) {
  for (const name of [
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
  ]) {
    const receipt = requiredRecord(row[name], `${label}.${name}`, issues);
    if (!receipt) continue;
    requiredString(receipt.id, `${label}.${name}.id`, issues);
    requiredString(receipt.sha256, `${label}.${name}.sha256`, issues, SHA256);
  }
}

export function launchIdentity(review, stage, issues) {
  const row = requiredRecord(review.launchIdentity, "launchIdentity", issues);
  if (!row) return;
  const state = requiredString(row.state, "launchIdentity.state", issues);
  if (state && !new Set(["bound", "incomplete", "unavailable"]).has(state)) {
    issues.push("launchIdentity.state is unsupported");
  }
  if (state === "unavailable" && stage !== "preopening") {
    issues.push("launchIdentity.unavailable is valid only before opening");
  }
  if (state === "bound") {
    requiredString(row.sha256, "launchIdentity.sha256", issues, SHA256);
    pointer(row.pointer, "launchIdentity.pointer", issues);
    boundReceiptIdentities(row, "launchIdentity", issues);
  } else requiredString(row.reason, "launchIdentity.reason", issues);
}
export function digestRows(review, issues) {
  const digests = requiredRecord(review.digests, "digests", issues);
  if (!digests) return;
  for (const name of ["snapshot", "manifest", "sessions", "reports"]) {
    const row = requiredRecord(digests[name], `digests.${name}`, issues);
    if (!row) continue;
    requiredString(row.sha256, `digests.${name}.sha256`, issues, SHA256);
    pointer(row.pointer, `digests.${name}.pointer`, issues);
  }
}
export function terminalOutcome(review, accounting, issues) {
  const row = requiredRecord(review.terminal, "terminal", issues);
  if (!row) return;
  const outcome = requiredString(row.outcome, "terminal.outcome", issues);
  if (outcome && !new Set(["completed", "held", "aborted", "no-result", "incomplete"]).has(outcome)) {
    issues.push("terminal.outcome is unsupported");
  }
  const storedCapability = requiredString(row.capabilityResult, "terminal.capabilityResult", issues);
  const capability = storedCapability === "sealed" ? "recorded" : storedCapability;
  const storedDenominatorState = accounting?.denominator?.state;
  const denominatorState = storedDenominatorState === "sealed" ? "recorded" : storedDenominatorState;
  const accountingState = accounting?.state === "sealed" ? "recorded" : accounting?.state;
  if (capability && !new Set(["recorded", "absent", "inconclusive"]).has(capability)) {
    issues.push("terminal.capabilityResult is unsupported");
  }
  if (capability === "recorded" && denominatorState !== "recorded") {
    issues.push("terminal.capabilityResult recorded requires a recorded capability denominator");
  }
  if (capability === "absent" && denominatorState === "recorded") {
    issues.push("terminal.capabilityResult absent cannot carry a recorded capability denominator");
  }
  if (outcome === "completed" && capability === "absent" && accountingState === "recorded") {
    issues.push(
      "completed controller outcome with absent capability result cannot have recorded terminal accounting",
    );
  }
}
export function terminalAccounting(review, issues) {
  const row = requiredRecord(review.terminalAccounting, "terminalAccounting", issues);
  if (!row) return;
  const states = new Set(["recorded", "no-result", "held", "incomplete"]);
  const storedState = requiredString(row.state, "terminalAccounting.state", issues);
  const state = storedState === "sealed" ? "recorded" : storedState;
  if (state && !states.has(state)) issues.push(`terminalAccounting.state is unsupported: ${state}`);
  const denominator = requiredRecord(row.denominator, "terminalAccounting.denominator", issues);
  if (!denominator) return;
  const storedDenominatorState = requiredString(
    denominator.state,
    "terminalAccounting.denominator.state",
    issues,
  );
  const denominatorState = storedDenominatorState === "sealed" ? "recorded" : storedDenominatorState;
  if (state === "recorded" && denominatorState !== "recorded") {
    issues.push("recorded terminal accounting requires a recorded denominator");
  }
  if (state && state !== "recorded" && denominatorState === "recorded") {
    issues.push("unfinished terminal accounting cannot claim a recorded denominator");
  }
  if (denominatorState === "recorded") {
    for (const key of ["total", "verified", "unaccepted", "nonResult"]) {
      if (!isNumber(denominator[key]) || !Number.isInteger(denominator[key]) || denominator[key] < 0) {
        issues.push(`terminalAccounting.denominator.${key} must be a non-negative integer`);
      }
    }
    const { total, verified, unaccepted, nonResult } = denominator;
    if (
      isNumber(total) &&
      isNumber(verified) &&
      isNumber(unaccepted) &&
      isNumber(nonResult) &&
      total !== verified + unaccepted + nonResult
    ) {
      issues.push("terminalAccounting denominator does not reconcile");
    }
  } else if (denominatorState === "absent") requiredString(row.reason, "terminalAccounting.reason", issues);
  else if (denominatorState) issues.push("terminalAccounting.denominator.state must be recorded or absent");
  pointer(row.evidencePointer, "terminalAccounting.evidencePointer", issues);
  const nonNegative = (value, label) => {
    if (!isNumber(value) || !Number.isInteger(value) || value < 0) {
      issues.push(`${label} must be a non-negative integer`);
    }
  };
  const optional = (value, label) => {
    if (value !== null) nonNegative(value, label);
  };
  optional(row.outerCap, "terminalAccounting.outerCap");
  nonNegative(row.completedRounds, "terminalAccounting.completedRounds");
  if (isNumber(row.outerCap) && isNumber(row.completedRounds) && row.completedRounds > row.outerCap) {
    issues.push("terminalAccounting.completedRounds cannot exceed outerCap");
  }
  const calls = requiredRecord(row.authorCalls, "terminalAccounting.authorCalls", issues);
  if (calls) {
    if (calls.budget !== "uncapped") nonNegative(calls.budget, "terminalAccounting.authorCalls.budget");
    for (const key of ["opening", "terminal", "delta"]) {
      nonNegative(calls[key], `terminalAccounting.authorCalls.${key}`);
    }
    if (
      isNumber(calls.opening) &&
      isNumber(calls.terminal) &&
      isNumber(calls.delta) &&
      calls.terminal - calls.opening !== calls.delta
    ) {
      issues.push("terminalAccounting.authorCalls.delta does not reconcile opening and terminal");
    }
  }
  const counts = requiredRecord(row.counts, "terminalAccounting.counts", issues);
  if (counts) {
    optional(counts.raw, "terminalAccounting.counts.raw");
    optional(counts.real, "terminalAccounting.counts.real");
    nonNegative(counts.controller, "terminalAccounting.counts.controller");
    if (
      isNumber(row.completedRounds) &&
      isNumber(counts.controller) &&
      row.completedRounds !== counts.controller
    ) {
      issues.push("terminalAccounting.completedRounds must equal terminalAccounting.counts.controller");
    }
  }
  const parents = requiredRecord(row.parents, "terminalAccounting.parents", issues);
  if (parents) {
    for (const key of ["lastCandidate", "adopted", "accepted"]) {
      requiredString(parents[key], `terminalAccounting.parents.${key}`, issues);
    }
  }
  for (const key of [
    "realAuthoringIterations",
    "candidateSubmits",
    "controllerTerminalRows",
    "recordedSubmitRows",
  ]) {
    optional(row[key], `terminalAccounting.${key}`);
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
export function sourceSafeguardCallers(worktree) {
  const callers = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:ts|mts|js|mjs)$/.test(entry.name)) {
        const ids = [
          ...readFileSync(path, "utf8").matchAll(/safeguardTriggered\s*\(\s*["'`]([^"'`]+)["'`]/g),
        ].map((match) => match[1]);
        if (ids.length > 0) callers.set(path.slice(worktree.length + 1), new Set(ids));
      }
    }
  };
  const source = `${worktree}/src`;
  if (existsSync(source)) visit(source);
  return callers;
}
export function scanPathFields(value, label, issues) {
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
export function headingAnchor(text, anchor) {
  const target = anchor
    .slice(1)
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].some(
    (match) =>
      match[1]
        .replace(/[`*_]/g, "")
        .replace(/[^a-z0-9 -]/gi, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase() === target,
  );
}
export function verifyPointerFiles(value, label, archiveDir, issues) {
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
    if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== row.sha256) {
      issues.push(`${label}.sha256 does not match ${row.path}`);
    }
    if (!headingAnchor(bytes.toString("utf8"), row.anchor)) {
      issues.push(`${label}.anchor is absent from ${row.path}`);
    }
  }
  for (const [key, item] of Object.entries(row)) {
    verifyPointerFiles(item, `${label}.${key}`, archiveDir, issues);
  }
}
export function safeguardReconciliation(review, identityRow, issues) {
  const row = requiredRecord(review.safeguardReconciliation, "safeguardReconciliation", issues);
  if (!row) return;
  if ((row.bytesVerified ?? row.sealedBytes) !== true) {
    issues.push("safeguardReconciliation.bytesVerified must be true");
  }
  pointer(row.t0, "safeguardReconciliation.t0", issues);
  pointer(row.t1, "safeguardReconciliation.t1", issues);
  if (
    asRecord(row.t0) &&
    asRecord(row.t1) &&
    row.t0.path === row.t1.path &&
    row.t0.anchor === row.t1.anchor &&
    row.t0.sha256 === row.t1.sha256
  ) {
    issues.push("safeguardReconciliation T0 and T1 must have distinct evidence identities");
  }
  for (const name of ["t0", "t1"]) {
    const tierIdentity = requiredRecord(
      row[`${name}Identity`],
      `safeguardReconciliation.${name}Identity`,
      issues,
    );
    if (!tierIdentity) continue;
    if (tierIdentity.complete !== true) {
      issues.push(`safeguardReconciliation.${name}Identity.complete must be true`);
    }
    for (const key of ["runId", "sourceRevision", "sourceDigest", "epoch", "bundle", "taskSet"]) {
      requiredString(
        tierIdentity[key],
        `safeguardReconciliation.${name}Identity.${key}`,
        issues,
        key === "sourceRevision" ? GIT_SHA : key === "sourceDigest" ? SHA256 : null,
      );
      if (identityRow && tierIdentity[key] !== identityRow[key]) {
        issues.push(`safeguardReconciliation.${name}Identity.${key} differs from measured identity`);
      }
    }
  }
}
export function sectionPointers(review, issues) {
  const sections = requiredRecord(review.sectionPointers, "sectionPointers", issues);
  if (!sections) return;
  for (const name of ["predictionLedger", "safeguards", "terminalAccounting"]) {
    pointer(sections[name], `sectionPointers.${name}`, issues);
  }
}
