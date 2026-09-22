/**
 * Restore campaign progress from recorded iterations. This file reads the history used by
 * the authoring loop; it does not make separate build or verification decisions.
 * Progress survives a process restart because the next iteration number, unresolved findings
 * and repetition counts come from the campaign directory.
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
  /** Last candidate/tool condition that reached gates and remained blocked, with its
   *  spent strikes. Only gate-settled
   *  refusals leave iteration evidence, so bundle-stage refusals stay session-local by design. */
  lastBlockedCandidateId: string | null;
  lastBlockedCandidateStrikes: number;
  /** The unbroken trailing run of gates-blocked findings hashes, oldest first. The stall
   *  detector counts repeats over it: run w11 recorded one findingsHash 14 iterations in a row
   *  while tree churn moved every fingerprint, and the loop spent $296 on a diagnosis it had
   *  already made. Any other outcome resets the run. */
  trailingBlockedFindingsHashes: string[];
  /** Separate pre-fingerprint refusal streak. A gate settlement resets this authoring bound. */
  trailingBuildFailureHashes: string[];
  /** Refused control censuses this campaign has already charged to each Builder-declared engine
   *  id, read from the census gate's records. Restores the per-engine count so a
   *  restarted invocation continues it instead of receiving a fresh allowance:
   *  run25-sol-0830 spread eleven no-verdict refusals over four invocations. */
  toolNonResultRefusals: ToolNonResultCounts;
  /** How often each workspace commit has been recorded as an unchanged candidate: a settled
   *  iteration whose child tree equals its own round entry. The round then refuses it as
   *  `candidate-unchanged` without measuring it, so the strike costs one whole authoring session
   *  and leaves no trace inside the next one. Keyed by commit and never reset, because the
   *  evidence is per tree: truss-run1-sol-0830 recorded the clause 21 times on commit `52e0d68c`
   *  across 14 controller invocations, and a per-session or trailing-run counter saw one sighting
   *  every time. A commit the Builder actually moves takes its own key. */
  unchangedCandidateCommits: Record<string, number>;
  carried: CampaignFeedback[];
}

function ordinalOf(name: string): number | null {
  const ordinal = Number(/^(\d+)-/.exec(name)?.[1]);
  return Number.isFinite(ordinal) ? ordinal : null;
}

/** Next free ordinal from the on-disk campaign history (no scheduler state anywhere else). */
export function nextOrdinal(campaignDir: string): number {
  return Math.max(0, ...listIterationDirs(campaignDir).map((name) => ordinalOf(name) ?? 0)) + 1;
}

/** A trailing findings run over one outcome, extended by a matching iteration and reset by any
 * other. One rule for the disk replay and the in-session extension, so they never disagree. */
const trailOf =
  (outcome: IterationEvidence["outcome"]) =>
  (trail: readonly string[], evidence: IterationEvidence): string[] =>
    evidence.outcome === outcome && evidence.findingsHash !== null ? [...trail, evidence.findingsHash] : [];

export const extendTrailingBlockedFindings = trailOf("gates-blocked");

/** The one reading of "this settled iteration changed nothing": a completed gate settlement whose
 * fingerprinted child tree is its own round entry with no path added or deleted. The round's
 * `candidate-unchanged` refusal reads the same three fields on the same evidence. */
export function unchangedCandidateCommit(evidence: IterationEvidence): string | null {
  const change = evidence.workspaceChange;
  if (evidence.outcome !== "fingerprinted") return null;
  if (change === undefined || change.baseCommit !== change.commit) return null;
  return change.changedPaths.length === 0 && change.deletedPaths.length === 0 ? change.commit : null;
}

/** Add one completed iteration to the per-commit unchanged count, for the replay and the running invocation alike. */
function countUnchanged(
  counts: Readonly<Record<string, number>>,
  evidence: IterationEvidence,
): Record<string, number> {
  const commit = unchangedCandidateCommit(evidence);
  return commit === null ? { ...counts } : { ...counts, [commit]: (counts[commit] ?? 0) + 1 };
}

/** Strikes already spent on the commit this campaign would resubmit: the replayed tally extended
 * by the iterations of the running invocation, read at that invocation's newest recorded commit.
 * Zero when the newest iteration moved the tree, which is the whole point of the per-commit key. */
export function unchangedCandidateSubmissions(
  memory: CampaignMemory,
  iterations: readonly IterationEvidence[],
): number {
  const counts = iterations.reduce(countUnchanged, memory.unchangedCandidateCommits);
  const commit = iterations.at(-1)?.workspaceChange?.commit ?? memory.workspaceCommit;
  return commit === null ? 0 : (counts[commit] ?? 0);
}

/** Settled iteration DIRECTORIES, oldest first. The directory rather than the record file,
 *  because the replay reads two recorded files from it: the iteration record and the census gate's
 *  no-verdict record beside it. */
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

/** Applied in-process after each iteration and replayed from disk on
 * restart, so the two paths cannot drift. A complete gate settlement (fingerprinted or gates-blocked)
 * replaces older findings; a failed build cannot establish that any earlier finding was fixed. */
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
    // No reset on other outcomes: the in-session counter is only touched by gate settlements, so
    // a build-failed pass between two identical blocked sets does not break the streak there and
    // must not break it here.
    if (evidence.outcome !== "gates-blocked") continue;
    const candidateId = evidence.candidateConditionId ?? evidence.submissionConditionId ?? null;
    memory.lastBlockedCandidateStrikes =
      candidateId !== null && candidateId === memory.lastBlockedCandidateId
        ? memory.lastBlockedCandidateStrikes + 1
        : 0;
    memory.lastBlockedCandidateId = candidateId;
  }
  // Read the engine ID from the census gate's record rather than extracting it from feedback
  // text. The counter that can end a campaign must use the host's recorded fields.
  memory.toolNonResultRefusals = replayNonResultRefusals([...dirs, ...chargedTrialRuns]);
  return memory;
}

/** Exact-epoch build/gate feedback for the run decision. The author loop replays this same
 * queue, so the controller does not copy it into the measured campaign record. */
export function latestPreAdoptionFeedback(epoch: CampaignEpochEvidence): CampaignFeedback[] | null {
  const feedback = replay(completedIterationDirs(epoch.dir)).carried;
  return feedback.length === 0 ? null : feedback;
}

/** Resume from disk. A directory without iteration.json contains unfinished work from an
 * invocation that never recorded its result. Skip it when restoring memory, preserve its
 * files and reserved iteration number, and do not report it as completed. An existing record
 * that cannot be parsed blocks the restart: its history cannot safely be treated as absent.
 * This preserves the earlier missingRecordOnEvidencedRestart rule. A different campaign
 * binding also refuses reuse, because its iterations describe another condition. */
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
