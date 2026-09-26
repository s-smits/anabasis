/**
 * Restore campaign progress from recorded iterations. This file reads the history the authoring
 * loop uses; it makes no build or verification decision of its own. Progress survives a process
 * restart because the next iteration number, the unresolved findings and the repetition counts all
 * come from the campaign directory rather than from anything held in memory.
 */
import { existsSync, mkdirSync, readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { ITERATION_FILE, iterationOrdinal, listIterationDirs } from "../builder/campaign-iterations.ts";
import { type CampaignEpochEvidence, writeCompleted } from "./campaign-epoch.ts";
import type { CampaignClause, CampaignFeedback, IterationEvidence } from "./campaign-types.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export interface CampaignMemory {
  clause: CampaignClause | null;
  /** Latest completed child tree. Null means no evidence can prove a repair baseline. */
  workspaceCommit: string | null;
  /** The last candidate and tool condition that reached the gates and stayed blocked, with its
   *  spent strikes. Only a gate-settled refusal leaves iteration evidence, so a bundle-stage
   *  refusal stays session-local by design. */
  lastBlockedCandidateId: string | null;
  lastBlockedCandidateStrikes: number;
  /** How often each workspace commit has been recorded as an unchanged candidate: a settled
   *  iteration whose child tree equals its own round entry. The round then refuses it as
   *  `candidate-unchanged` without measuring it, so the strike costs one whole authoring session
   *  and leaves no trace inside the next one. Keyed by commit and never reset, because the evidence
   *  is per tree: one commit can collect the clause twenty times over as many controller
   *  invocations, where a per-session or trailing-run counter sees one sighting each time. A commit
   *  the Builder actually moves takes its own key. */
  unchangedCandidateCommits: Record<string, number>;
  carried: CampaignFeedback[];
}

/** Next free ordinal from the on-disk campaign history; no scheduler state exists anywhere
 *  else. */
export function nextOrdinal(campaignDir: string): number {
  return Math.max(0, ...listIterationDirs(campaignDir).map((name) => iterationOrdinal(name) ?? 0)) + 1;
}

/** The one reading of "this settled iteration changed nothing": a completed gate settlement whose
 *  fingerprinted child tree is its own round entry, with no path added and none deleted. The
 *  round's `candidate-unchanged` refusal reads the same three fields on the same evidence. */
export function unchangedCandidateCommit(evidence: IterationEvidence): string | null {
  const change = evidence.workspaceChange;
  if (evidence.outcome !== "fingerprinted") return null;
  if (change === undefined || change.baseCommit !== change.commit) return null;
  return change.changedPaths.length === 0 && change.deletedPaths.length === 0 ? change.commit : null;
}

/** Add one completed iteration to the per-commit unchanged count, for the replay and the running
 *  invocation alike. */
function countUnchanged(
  counts: Readonly<Record<string, number>>,
  evidence: IterationEvidence,
): Record<string, number> {
  const commit = unchangedCandidateCommit(evidence);
  return commit === null ? { ...counts } : { ...counts, [commit]: (counts[commit] ?? 0) + 1 };
}

/** Strikes already spent on the commit this campaign would resubmit: the replayed tally extended
 *  by the iterations of the running invocation, read at that invocation's newest recorded commit.
 *  Zero when the newest iteration moved the tree, which is the whole point of the per-commit
 *  key. */
export function unchangedCandidateSubmissions(
  memory: CampaignMemory,
  iterations: readonly IterationEvidence[],
): number {
  const counts = iterations.reduce(countUnchanged, memory.unchangedCandidateCommits);
  const commit = iterations.at(-1)?.workspaceChange?.commit ?? memory.workspaceCommit;
  return commit === null ? 0 : (counts[commit] ?? 0);
}

/** Settled iteration DIRECTORIES, oldest first. The directory rather than the record file,
 *  because the replay reads two recorded files out of it: the iteration record and the census
 *  gate's no-verdict record beside it. */
function completedIterationDirs(campaignDir: string): string[] {
  return listIterationDirs(campaignDir)
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

/** The blocking findings still unresolved after one iteration. Every recorded iteration is a
 *  complete gate settlement, so its own blocking rows replace the older findings. */
export function settleUnresolved(evidence: IterationEvidence): CampaignFeedback[] {
  const byKey = new Map<string, CampaignFeedback>();
  for (const row of evidence.feedback) {
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
    unchangedCandidateCommits: {},
    carried: [],
  };
}

function replay(dirs: string[]): CampaignMemory {
  const memory = emptyMemory(null);
  for (const dir of dirs) {
    const evidence = readIteration(join(dir, ITERATION_FILE));
    memory.carried = settleUnresolved(evidence);
    memory.workspaceCommit = evidence.workspaceChange?.commit ?? null;
    memory.unchangedCandidateCommits = countUnchanged(memory.unchangedCandidateCommits, evidence);
    // Only a blocked pass moves the blocked-candidate streak; a fingerprinted one leaves it be.
    if (evidence.outcome !== "gates-blocked") continue;
    const candidateId = evidence.candidateConditionId ?? evidence.submissionConditionId ?? null;
    memory.lastBlockedCandidateStrikes =
      candidateId !== null && candidateId === memory.lastBlockedCandidateId
        ? memory.lastBlockedCandidateStrikes + 1
        : 0;
    memory.lastBlockedCandidateId = candidateId;
  }
  return memory;
}

/** Exact-epoch build and gate feedback for the run decision, or null when none remains. The author
 *  loop replays this same queue, so the controller does not copy it into the measured campaign
 *  record. */
export function latestPreAdoptionFeedback(epoch: CampaignEpochEvidence): CampaignFeedback[] | null {
  const feedback = replay(completedIterationDirs(epoch.dir)).carried;
  return feedback.length === 0 ? null : feedback;
}

/** Resume from disk. A directory without iteration.json holds unfinished work from an invocation
 *  that never recorded its result: it is skipped when restoring memory, its files and its reserved
 *  iteration number are preserved, and it is not reported as completed. An existing record that
 *  cannot be parsed blocks the restart with `improvement-memory-missing`, because its history
 *  cannot safely be treated as absent. A different campaign binding refuses reuse in the same way,
 *  since its iterations describe another condition. */
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
    return replay(completedIterationDirs(campaignDir));
  } catch {
    return emptyMemory("improvement-memory-missing");
  }
}
