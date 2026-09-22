/**
 * Cross-iteration Builder memory: what this campaign already tried and lost, so a restarted
 * session can see that it is repeating itself. It states what happened, never what to author.
 *
 * Memory is built from structural evidence fields (ordinals, outcomes, failing stage, attempt
 * counts) plus the (code, path) pairs of earlier findings, each projected through
 * `projectFindingForAuthor`. Feedback claims, evidence and finding detail never enter.
 */
import { readFileSync } from "../meta/filesystem.ts";
import { basename, dirname, join } from "../meta/path.ts";
import { ITERATION_FILE, listIterationDirs } from "../builder/campaign-iterations.ts";
import { campaignEpochOrder } from "./campaign-epoch.ts";
import type { ContractFinding } from "../truth/brief.ts";
import { controllerValidatedFindings, projectFindingForAuthor } from "../truth/brief.ts";
import type { IterationEvidence } from "./campaign-types.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isNumber, isRecord } from "../meta/json-shape.ts";
import { parseExperimentSubmission } from "./experiment-proposal.ts";

/** The code every memory finding carries in the Builder's opening advisory. */
export const ITERATION_MEMORY_CODE = "prior-iteration-memory";

/** Completed iterations the memory looks back over. */
const LOOKBACK = 4;

/** Bound historical reminders; current blocking feedback has its own complete delivery. */
const MAX_REFUSALS = 12;

/** A completed pass with its memory label: `NN` in this epoch, `epoch-<key>/NN` in an earlier one,
 *  since ordinals restart at 01 in every epoch. */
type CompletedPass = { evidence: IterationEvidence; label: string };

/**
 * Whether a parsed record has the fields this reader walks: its ordinal, attempts and feedback
 * findings. A record that parses but lacks them is absent memory, like an unreadable one.
 */
function summarisable(iteration: IterationEvidence): boolean {
  const rows = iteration.feedback;
  if (!isNumber(iteration.ordinal) || !isRecord(iteration.attempts) || !Array.isArray(rows)) {
    return false;
  }
  return rows.every((row) => {
    const findings = isRecord(row) ? row.findings : null;
    return findings === undefined || (Array.isArray(findings) && findings.every(isRecord));
  });
}

/** One epoch's completed evidence, oldest first. */
function readEpoch(dir: string): IterationEvidence[] {
  const evidence: IterationEvidence[] = [];
  for (const name of listIterationDirs(dir)) {
    try {
      const iteration = parseJsonAs<IterationEvidence>(readFileSync(join(dir, name, ITERATION_FILE), "utf8"));
      if (summarisable(iteration)) evidence.push(iteration);
    } catch {
      // A missing or half-written record is absent memory.
    }
  }
  return evidence.sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * Completed passes of this epoch and of every epoch recorded before it, oldest first and bounded
 * to the lookback window. A damaged epoch record leaves this epoch reading only itself.
 */
function readCompleted(campaignDir: string): CompletedPass[] {
  const root = dirname(campaignDir);
  const own = basename(campaignDir);
  let order: string[] = [];
  try {
    order = campaignEpochOrder(root);
  } catch {
    // Memory only forgets the earlier epochs.
  }
  const earlier = order.slice(0, Math.max(order.indexOf(own), 0));
  return [...earlier, own]
    .flatMap((epoch) =>
      readEpoch(join(root, epoch)).map((evidence) => ({
        evidence,
        label: `${epoch === own ? "" : `${epoch}/`}${String(evidence.ordinal).padStart(2, "0")}`,
      })),
    )
    .slice(-LOOKBACK);
}

/** One line per completed pass: its outcome, failing stage, session retries, and its proposal's
 *  gap, change, target and admitted scope. */
function summarise({ evidence, label }: CompletedPass): string {
  const where = evidence.stage ? ` at ${evidence.stage}` : "";
  const focus = evidence.focusOwner ? `, part ${evidence.focusOwner}` : "";
  const retried = Object.entries(evidence.attempts)
    .filter(([, count]) => count > 1)
    .map(([session, count]) => `${session} x${count}`);
  const retries = retried.length === 0 ? "" : ` (retried ${retried.join(", ")})`;
  const proposal = parseExperimentSubmission(evidence.experimentProposal);
  const target =
    proposal === null
      ? ""
      : `, target ${proposal.target.comparator} ${proposal.target.verifiedPasses} verified passes`;
  const admitted =
    evidence.experimentScope === undefined
      ? "not admitted"
      : `admitted as ${evidence.experimentScope.actual}`;
  const proposed =
    proposal === null
      ? ""
      : `; proposed ${proposal.scope} scope, gap "${clip(proposal.gap)}", change "${clip(proposal.change)}"${target}; ${admitted}`;
  return `${label} ${evidence.outcome}${where}${focus}${retries}${proposed}`;
}

const clip = (text: string): string => (text.length > 240 ? `${text.slice(0, 240)}…` : text);

/**
 * Distinct author-projected labels from every owner in a pass. Projection keeps unmarked
 * findings at their fixed public labels without exposing protected detail.
 */
function refusalsOf(evidence: IterationEvidence): string[] {
  const labels = new Set<string>();
  for (const feedback of evidence.feedback) {
    for (const finding of feedback.findings ?? []) {
      const projected = projectFindingForAuthor(finding);
      labels.add(`[${projected.code}] ${projected.path}`);
    }
  }
  return [...labels];
}

/** The memory handed to a restarted session; empty before the first completed iteration. */
export function iterationMemoryFindings(campaignDir: string): ContractFinding[] {
  const completed = readCompleted(campaignDir);
  if (completed.length === 0) return [];
  const lines = [`Earlier build attempts: ${completed.map(summarise).join("; ")}.`];
  const seen = new Map<string, string[]>();
  // Walk newest first so sort ties favour recent passes; prepending keeps each pass list in order.
  for (const pass of completed.toReversed()) {
    for (const refusal of refusalsOf(pass.evidence)) {
      seen.set(refusal, [pass.label, ...(seen.get(refusal) ?? [])]);
    }
  }
  // Most-repeated first, so the cut keeps recurring errors ahead of one-offs.
  const refusals = [...seen.entries()].sort(([, a], [, b]) => b.length - a.length).slice(0, MAX_REFUSALS);
  if (refusals.length > 0) {
    const rendered = refusals.map(([refusal, passes]) => `${refusal} in ${passes.join(", ")}`).join("; ");
    const omitted = seen.size - refusals.length;
    lines.push(
      `Earlier errors: ${rendered}.${omitted > 0 ? ` ${String(omitted)} further distinct earlier error(s) omitted.` : ""} Do not repeat these errors.`,
    );
  }
  return controllerValidatedFindings([
    { code: ITERATION_MEMORY_CODE, path: "campaign", detail: lines.join("\n") },
  ]);
}
