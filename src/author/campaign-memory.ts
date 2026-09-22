/**
 * Restores campaign progress from recorded iterations, so the next iteration number, unresolved
 * findings and repetition counts survive a restart. It makes no build or verification decision.
 */
import { existsSync, mkdirSync, readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { ITERATION_FILE, listIterationDirs } from "../builder/campaign-iterations.ts";
import { type CampaignEpochEvidence, writeCompleted } from "./campaign-epoch.ts";
import type { CampaignClause, CampaignFeedback, IterationEvidence } from "./campaign-types.ts";
import { type ToolNonResultCounts, chargedTrialRunDirs, replayNonResultRefusals } from "./tool-non-result.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export interface CampaignMemory {
  clause: CampaignClause | null;
  /** Latest completed child tree. Null means no evidence can prove a repair baseline. */
  workspaceCommit: string | null;
  /** Last candidate condition that reached the gates and stayed blocked, with its spent strikes.
   *  Bundle-stage refusals leave no iteration evidence, so they stay session-local. */
  lastBlockedCandidateId: string | null;
  lastBlockedCandidateStrikes: number;
  /** The unbroken trailing run of gates-blocked findings hashes, oldest first, for the stall
   *  detector. Any other outcome resets it. */
  trailingBlockedFindingsHashes: string[];
  /** The trailing run of pre-fingerprint refusals; a gate settlement resets it. */
  trailingBuildFailureHashes: string[];
  /** Refused control censuses already charged to each declared engine id, so a restarted
   *  invocation continues the count instead of receiving a fresh allowance. */
  toolNonResultRefusals: ToolNonResultCounts;
  /** How often each workspace commit was recorded as an unchanged candidate. Keyed by commit and
   *  never reset, so the count survives sessions and invocations; a moved tree takes a new key. */
  unchangedCandidateCommits: Record<string, number>;
  carried: CampaignFeedback[];
}

function ordinalOf(name: string): number | null {
  const ordinal = Number(/^(\d+)-/.exec(name)?.[1]);
  return Number.isFinite(ordinal) ? ordinal : null;
}

/** Next free ordinal from the on-disk campaign history. */
export function nextOrdinal(campaignDir: string): number {
  return Math.max(0, ...listIterationDirs(campaignDir).map((name) => ordinalOf(name) ?? 0)) + 1;
}

/** A trailing findings run over one outcome, extended by a matching iteration and reset by any
 *  other. Shared by the disk replay and the in-session extension. */
const trailOf =
  (outcome: IterationEvidence["outcome"]) =>
  (trail: readonly string[], evidence: IterationEvidence): string[] =>
    evidence.outcome === outcome && evidence.findingsHash !== null ? [...trail, evidence.findingsHash] : [];

export const extendTrailingBlockedFindings = trailOf("gates-blocked");

/** The commit of a fingerprinted iteration that changed nothing since its round entry, else null. */
export function unchangedCandidateCommit(evidence: IterationEvidence): string | null {
  const change = evidence.workspaceChange;
  if (evidence.outcome !== "fingerprinted") return null;
  if (change === undefined || change.baseCommit !== change.commit) return null;
  return change.changedPaths.length === 0 && change.deletedPaths.length === 0 ? change.commit : null;
}

/** Adds one completed iteration to the per-commit unchanged count. */
function countUnchanged(
  counts: Readonly<Record<string, number>>,
  evidence: IterationEvidence,
): Record<string, number> {
  const commit = unchangedCandidateCommit(evidence);
  return commit === null ? { ...counts } : { ...counts, [commit]: (counts[commit] ?? 0) + 1 };
}

/** Strikes already spent on the commit this campaign would resubmit: the replayed tally plus the
 *  running invocation's iterations, read at the newest recorded commit. */
export function unchangedCandidateSubmissions(
  memory: CampaignMemory,
  iterations: readonly IterationEvidence[],
): number {
  const counts = iterations.reduce(countUnchanged, memory.unchangedCandidateCommits);
  const commit = iterations.at(-1)?.workspaceChange?.commit ?? memory.workspaceCommit;
  return commit === null ? 0 : (counts[commit] ?? 0);
}

/** Settled iteration directories, oldest first; the replay reads more than one file from each. */
function completedIterationDirs(campaignDir: string): string[] {
  return listIterationDirs(campaignDir)
    .filter((name) => ordinalOf(name) !== null)
    .sort((a, b) => (ordinalOf(a) ?? 0) - (ordinalOf(b) ?? 0))
    .map((name) => join(campaignDir, name))
    .filter((dir) => existsSync(join(dir, ITERATION_FILE)));
}

function readIteration(file: string): IterationEvidence {
  let evidence: IterationEvidence;
  try {
    evidence = parseJsonAs<IterationEvidence>(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: unreadable completed iteration (${errorMessage(error)})`, { cause: error });
  }
  if (!Array.isArray(evidence.feedback)) {
    throw new Error(`${file}: completed iteration has no feedback array`);
  }
  // `stampSubmissionCondition` stamps every record before its one writer writes it.
  const { submissionConditionId, candidateConditionId } = evidence;
  if (!isString(submissionConditionId) || submissionConditionId.length === 0) {
    throw new Error(`${file}: completed iteration states no submission condition`);
  }
  if (
    candidateConditionId !== undefined &&
    (!isString(candidateConditionId) || candidateConditionId.length === 0)
  ) {
    throw new Error(`${file}: completed iteration has an invalid submission condition`);
  }
  return evidence;
}

/** The blocking findings still unresolved after one iteration; shared by the in-process path and
 *  the disk replay. A gate settlement replaces older findings; a failed build keeps them. */
export function settleUnresolved(
  pending: CampaignFeedback[],
  evidence: IterationEvidence,
): CampaignFeedback[] {
  const settled = evidence.outcome === "fingerprinted" || evidence.outcome === "gates-blocked";
  const byKey = new Map<string, CampaignFeedback>();
  for (const row of [...(settled ? [] : pending), ...evidence.feedback]) {
    if (row.severity === "blocking") byKey.set(`${row.owner}\0${row.claim}\0${row.evidence}`, row);
  }
  return [...byKey.values()];
}

function emptyMemory(clause: CampaignClause | null): CampaignMemory {
  return {
    clause,
    workspaceCommit: null,
    lastBlockedCandidateId: null,
    lastBlockedCandidateStrikes: 0,
    trailingBlockedFindingsHashes: [],
    trailingBuildFailureHashes: [],
    toolNonResultRefusals: {},
    unchangedCandidateCommits: {},
    carried: [],
  };
}

function replay(dirs: string[], chargedTrialRuns: readonly string[] = []): CampaignMemory {
  const memory = emptyMemory(null);
  const extendTrailingBuildFailures = trailOf("build-failed");
  for (const dir of dirs) {
    const evidence = readIteration(join(dir, ITERATION_FILE));
    memory.carried = settleUnresolved(memory.carried, evidence);
    memory.workspaceCommit = evidence.workspaceChange?.commit ?? null;
    memory.trailingBlockedFindingsHashes = extendTrailingBlockedFindings(
      memory.trailingBlockedFindingsHashes,
      evidence,
    );
    memory.trailingBuildFailureHashes = extendTrailingBuildFailures(
      memory.trailingBuildFailureHashes,
      evidence,
    );
    memory.unchangedCandidateCommits = countUnchanged(memory.unchangedCandidateCommits, evidence);
    // Other outcomes do not reset the strike count, matching the in-session counter.
    if (evidence.outcome !== "gates-blocked") continue;
    const candidateId = evidence.candidateConditionId ?? evidence.submissionConditionId ?? null;
    memory.lastBlockedCandidateStrikes =
      candidateId !== null && candidateId === memory.lastBlockedCandidateId
        ? memory.lastBlockedCandidateStrikes + 1
        : 0;
    memory.lastBlockedCandidateId = candidateId;
  }
  // Engine ids come from the census gate's recorded fields, never from feedback text.
  memory.toolNonResultRefusals = replayNonResultRefusals([...dirs, ...chargedTrialRuns]);
  return memory;
}

/** The epoch's unresolved build and gate feedback, or null when none remains. */
export function latestPreAdoptionFeedback(epoch: CampaignEpochEvidence): CampaignFeedback[] | null {
  const feedback = replay(completedIterationDirs(epoch.dir)).carried;
  return feedback.length === 0 ? null : feedback;
}

/** Resumes from disk. An iteration directory without a record is unfinished work: skipped, but
 *  its files and ordinal are kept. An unreadable record or a different campaign binding returns
 *  empty memory with a refusing clause. */
export function resumeCampaignMemory(campaignDir: string, slug: string, kickoffHash: string): CampaignMemory {
  const bindingFile = join(campaignDir, "campaign.json");
  if (!existsSync(bindingFile)) {
    mkdirSync(campaignDir, { recursive: true });
    writeCompleted(bindingFile, { domain: slug, kickoffHash });
    return emptyMemory(null);
  }
  try {
    const binding = parseJsonAs<{ domain?: unknown; kickoffHash?: unknown }>(
      readFileSync(bindingFile, "utf8"),
    );
    if (binding.domain !== slug || binding.kickoffHash !== kickoffHash) {
      return emptyMemory("campaign-binding-mismatch");
    }
  } catch {
    return emptyMemory("campaign-binding-mismatch");
  }
  try {
    return replay(completedIterationDirs(campaignDir), chargedTrialRunDirs(campaignDir));
  } catch {
    return emptyMemory("improvement-memory-missing");
  }
}
