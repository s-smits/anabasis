// The two digest blocks that read what the Builder did with its rehearsal instrument and what the
// retained version actually holds. Block 6 joins every `harness_trial` call in an epoch's
// execution record to the candidate its accepted submit froze, through the `candidateId` both
// rows carry, and compares the rehearsal passes on those bytes with the target the submit
// declared (lane 11; a rehearsal that reached no verdict is lane 9's). Block 6b checks that each retained version's `.toolchain` is a real
// directory and that each claim's verifier tools were hashed as binaries rather than as the
// wrapper script in front of one (lane 2).
//
// Both read recorded JSON and the filesystem shape alone; neither opens a rehearsal trace or a
// tool. The lead is arithmetic and the lane owns the reading.

import { existsSync, lstatSync, readdirSync, readlinkSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import {
  asRecord,
  isNumber,
  isRecord,
  isString,
  type JsonObject,
  type JsonValue,
} from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { jsonText } from "./run-overview.ts";

/** The slice of a Builder execution record the rehearsal ledger reads. It reads the rows leniently,
 *  as recorded, so each is narrowed where it is read. */
export interface RehearsalRecord {
  customCalls?: readonly unknown[];
  customCallsOmitted?: unknown;
  submits?: readonly unknown[];
}

export interface RehearsalEntry {
  epoch: string;
  file: string;
  record: RehearsalRecord;
}

export interface RehearsalExecutions {
  records: readonly RehearsalEntry[];
  unavailable?: readonly string[] | null;
}

export interface RehearsalLedgerInput {
  executions: RehearsalExecutions;
  epochDirs?: readonly string[] | null;
}

export interface ToolchainInput {
  campaign: string;
}

interface Trial {
  sequence: JsonValue | undefined;
  taskId: string | null;
  candidateId: string | null;
  verdict: string;
}

interface AcceptedSubmit {
  sequence: JsonValue | undefined;
  candidateId: string | null;
}

/** A record's rehearsal calls and the submits it accepted. */
interface RehearsalCalls {
  trials: Trial[];
  submits: AcceptedSubmit[];
}

interface DeclaredTarget {
  comparator: string;
  verifiedPasses: number;
}

interface EpochRehearsal extends RehearsalEntry {
  epochDir: string | null;
}

/** A recorded call sequence as a template literal would print it. */
function sequenceText(sequence: JsonValue | undefined): string {
  return `${sequence === undefined ? sequence : jsonText(sequence)}`;
}

// --- 6: rehearsal ledger ----------------------------------------------------------------------
/** The harness_trial and accepted-submit rows of one execution record, in call order. */
function rehearsalCalls(record: RehearsalRecord): RehearsalCalls {
  const calls = Array.isArray(record.customCalls) ? record.customCalls : [];
  const trials: Trial[] = [];
  const submits: AcceptedSubmit[] = [];
  for (const call of calls) {
    if (!isRecord(call)) continue;
    const semantic: JsonObject = asRecord(call.semantic) ?? {};
    if (call.tool === "harness_trial") {
      const taskId = asRecord(call.target)?.taskId;
      trials.push({
        sequence: call.sequence,
        taskId: isString(taskId) ? taskId : null,
        candidateId: isString(semantic.candidateId) ? semantic.candidateId : null,
        verdict: isString(semantic.truthVerdict) ? semantic.truthVerdict : "unrecorded",
      });
    } else if (call.tool === "submit" && semantic.outcome === "accepted") {
      submits.push({
        sequence: call.sequence,
        candidateId: isString(semantic.candidateId) ? semantic.candidateId : null,
      });
    }
  }
  return { trials, submits };
}

/** The target the last accepted submit declared, from the `submits[]` proposal the record keeps. */
function declaredTarget(record: RehearsalRecord): DeclaredTarget | null {
  const submits = Array.isArray(record.submits) ? record.submits : [];
  const accepted = submits.findLast((row) => isRecord(row) && row.outcome === "accepted");
  const target = asRecord(asRecord(asRecord(accepted)?.experimentProposal)?.target);
  return target !== null && isString(target.comparator) && isNumber(target.verifiedPasses)
    ? { comparator: target.comparator, verifiedPasses: target.verifiedPasses }
    : null;
}

/** How many rehearsal case directories the epoch holds, so a record that omitted custom calls can
 *  still be compared against the rehearsals that actually ran. */
function rehearsalCaseCount(epochDir: string): number {
  const dir = join(epochDir, "rehearsals");
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const name of readdirSync(dir)) {
    const cases = join(dir, name, "cases");
    if (existsSync(cases)) count += readdirSync(cases).length;
  }
  return count;
}

function epochRehearsalLines({ epoch, file, record, epochDir }: EpochRehearsal): string[] {
  const lines: string[] = [];
  const { trials, submits } = rehearsalCalls(record);
  const notRun = trials.filter((trial) => trial.verdict === "not-run").length;
  const passes = trials.filter((trial) => trial.verdict === "pass").length;
  const omitted = isNumber(record.customCallsOmitted) ? record.customCallsOmitted : 0;
  lines.push(
    `${epoch}/${file}: rehearsals ${trials.length} (pass ${passes}, not-run ${notRun}) · accepted submits ${submits.length}` +
      (omitted > 0 ? ` · ${omitted} custom call(s) omitted from the record` : ""),
  );
  const onDisk = epochDir === null ? null : rehearsalCaseCount(epochDir);
  if (onDisk !== null && onDisk !== trials.length) {
    lines.push(`  rehearsal case directories ${onDisk} against ${trials.length} recorded call(s)`);
  }
  if (notRun > 0) {
    lines.push(`  REHEARSAL NOT-RUN (lane 9): ${notRun} of ${trials.length} rehearsals reached no verdict`);
  }
  const rehearsed = new Set(trials.map((trial) => trial.candidateId).filter((id) => id !== null));
  const target = declaredTarget(record);
  for (const submit of submits) {
    if (submit.candidateId === null) {
      lines.push(
        `  accepted submit at call ${sequenceText(submit.sequence)}: no candidateId recorded, rehearsal join unobservable`,
      );
      continue;
    }
    if (!rehearsed.has(submit.candidateId)) {
      lines.push(
        `  SUBMITTED BYTES NEVER REHEARSED (lane 11): ${epoch} candidate ${submit.candidateId.slice(0, 16)} · ${trials.length} rehearsal(s) on other bytes`,
      );
    }
    // Distinct tasks that passed on the frozen bytes are verified passes the battery will find
    // again, since the rehearsal grades what the measured solver submitted unaided.
    const passedTasks = new Set(
      trials
        .filter((trial) => trial.candidateId === submit.candidateId && trial.verdict === "pass")
        .map((trial) => trial.taskId ?? `call ${sequenceText(trial.sequence)}`),
    );
    if (target === null) continue;
    if (target.comparator === "at-most" && passedTasks.size > target.verifiedPasses) {
      lines.push(
        `  REHEARSAL CONTRADICTS TARGET (lane 11): ${epoch} declared at-most ${target.verifiedPasses} verified passes; ${passedTasks.size} rehearsal pass(es) on the submitted bytes already exceed it (${passedTasks.size} > ${target.verifiedPasses})`,
      );
    } else {
      lines.push(
        `  target ${target.comparator} ${target.verifiedPasses} · rehearsal passes on the submitted bytes ${passedTasks.size} · not contradicted`,
      );
    }
  }
  return lines;
}

/**
 * Section 6. `executions` is the digest's own reading of every current-schema execution record,
 * `{records: [{epoch, file, record}], unavailable}`; `epochDirs` lets the block count the rehearsal
 * directories each epoch actually wrote.
 */
export function rehearsalLedgerLines({ executions, epochDirs }: RehearsalLedgerInput): string[] {
  const lines = ["", "## 6 rehearsal ledger (harness_trial calls vs accepted submit)"];
  const dirs = new Map((epochDirs ?? []).map((dir) => [basename(dir), dir]));
  if (executions.records.length === 0) {
    lines.push("no builder-execution records: rehearsal use unobservable");
  }
  for (const { epoch, file, record } of executions.records) {
    lines.push(...epochRehearsalLines({ epoch, file, record, epochDir: dirs.get(epoch) ?? null }));
  }
  for (const reason of executions.unavailable ?? []) lines.push(`execution record refused: ${reason}`);
  return lines;
}

// --- 6b: toolchain retention ------------------------------------------------------------------
function versionToolchainLines(campaign: string): string[] {
  const lines: string[] = [];
  const versions = join(campaign, "versions");
  if (!existsSync(versions)) {
    lines.push("no retained versions");
    return lines;
  }
  for (const id of readdirSync(versions).sort()) {
    const toolchain = join(versions, id, ".toolchain");
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(toolchain);
    } catch {
      lines.push(`versions/${id}/.toolchain: absent`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(toolchain);
      lines.push(`VERSION TOOLCHAIN IS A SYMLINK (lane 2): versions/${id}/.toolchain → ${target}`);
      // A link into an epoch workspace stops resolving once that workspace is reset or trashed,
      // and the version then names tools it can no longer run.
      if (!existsSync(toolchain)) {
        lines.push(
          `VERSION TOOLCHAIN DANGLING (lane 2): versions/${id}/.toolchain → ${target} resolves to nothing`,
        );
      }
      continue;
    }
    lines.push(`versions/${id}/.toolchain: ${stat.isDirectory() ? "real directory" : "not a directory"}`);
  }
  return lines;
}

function claimToolLines(campaign: string): string[] {
  const lines: string[] = [];
  const claims = join(campaign, "claims");
  if (!existsSync(claims)) {
    lines.push("no claims recorded");
    return lines;
  }
  for (const name of readdirSync(claims)
    .filter((file) => file.endsWith(".json"))
    .sort()) {
    const runId = name.replace(/\.json$/, "");
    // The file wraps the claim: `{claim: {statement: {verifierTools}}}`.
    const record = readJsonFileOrNull(join(claims, name));
    const tools = asRecord(asRecord(asRecord(record)?.claim)?.statement)?.verifierTools;
    if (!Array.isArray(tools)) {
      lines.push(`${runId}: claim carries no verifierTools`);
      continue;
    }
    const scripts = tools.flatMap((tool) => (isRecord(tool) && tool.kind === "script" ? [tool] : []));
    lines.push(
      `${runId}: verifier tools ${tools.length} · binaries ${tools.length - scripts.length} · scripts ${scripts.length}`,
    );
    // The digest of a wrapper script proves the wrapper's bytes and says nothing about the
    // interpreter or the package it dispatches to. A workspace tool also carries `treeDigest`,
    // the whole tool tree the host re-checks before each run, which covers what the wrapper
    // dispatches to there; only a script without one is attested by its own bytes alone.
    for (const tool of scripts.filter((entry) => !isString(entry.treeDigest))) {
      lines.push(
        `WRAPPER-ONLY TOOL DIGEST (lane 2): ${runId} ${jsonText(tool.toolId ?? "?")} (${jsonText(tool.source ?? "?")}, interpreter ${jsonText(tool.interpreter ?? "?")})`,
      );
    }
  }
  return lines;
}

/** Section 6b: what the retained versions and claims say about the tools the verifier ran. */
export function toolchainRetentionLines({ campaign }: ToolchainInput): string[] {
  return [
    "",
    "## 6b toolchain retention (versions/*/.toolchain, claims verifierTools)",
    ...versionToolchainLines(campaign),
    ...claimToolLines(campaign),
  ];
}
