/**
 * Cross-iteration Builder memory: what this campaign already tried and lost, delivered through the
 * one channel a repair pass already carries.
 *
 * The controller knows before the model does. Each evidence hashes its failure as `findingsHash`,
 * but without this a session that produces a repeat is never told it is repeating: a restarted
 * session receives the last iteration's findings for its owner and nothing else, so an A→B→A
 * oscillation reads to it as a first attempt, and a guard tripped two iterations ago is tripped
 * again.
 *
 * Code owns the fact and the model owns the response, so this owner states what happened and never
 * what to author instead.
 *
 * The isolation holds because memory is built from structural evidence fields — ordinals,
 * outcomes, the stage a build died at, session attempt counts — plus the (code, path) pairs an
 * owner has already produced, each one through `projectFindingForAuthor`, which fails closed on
 * anything a controller validator did not write. `CampaignFeedback.claim` and `.evidence` name
 * protected host evidence such as the F2 census and verifier stdout, so neither enters, and
 * finding detail does not either: an identifier and its path are enough to say "you already
 * produced this".
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

/** Completed iterations the memory looks back over. Four covers an epoch's usual budget without
 *  turning a session prompt into a transcript. */
const LOOKBACK = 4;

/** Bound historical reminders; current blocking feedback has its own complete delivery. */
const MAX_REFUSALS = 12;

/** A completed pass with its memory label: `NN` in this epoch, `epoch-<key>/NN` in an earlier one,
 *  since ordinals restart at 01 in every epoch. */
type CompletedPass = { evidence: IterationEvidence; label: string };

/**
 * An evidence this reader can walk: the ordinal it sorts by, the attempts `summarise` enumerates,
 * and the feedback rows `refusalsOf` reads findings out of.
 *
 * `parseJsonAs` casts rather than checks, and the ordinal was the only field anything looked at, so
 * a record left short by an interrupted write reached `Object.entries(undefined)` and threw past
 * the catch below, taking the whole opening advisory with it over one unreadable pass. That catch
 * already says what an unreadable pass is: absent memory. This says the same about a pass that
 * parses and cannot be summarised.
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
      // A missing or half-written evidence is absent memory; an unreadable pass is never
      // guessed at.
    }
  }
  return evidence.sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * Completed passes of this epoch and of every epoch recorded before it, oldest first and bounded
 * to the lookback window. One epoch per experiment leaves one pass per epoch, so a reader bound to
 * its own epoch would deliver nothing at all. A damaged epoch record, which the controller refuses,
 * leaves this epoch reading only itself.
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

/** One line per completed pass: what it ended as, where it died, how hard its sessions worked and
 *  what it proposed. A recorded proposal runs to about 2,000 bytes with its digest, so the line
 *  keeps the parts that answer a repeat: the gap and change say what was tried, the target what was
 *  expected, and the admitted scope what the bytes actually did. */
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

/**
 * The memory a repair pass hands the session it is about to restart. Empty when the campaign has no
 * completed iteration yet, so a first build's prompt carries no memory section at all. Both the
 * timeline and the refusal history span the campaign rather than the epoch.
 */
export function iterationMemoryFindings(campaignDir: string): ContractFinding[] {
  const completed = readCompleted(campaignDir);
  if (completed.length === 0) return [];
  const lines = [`Earlier build attempts: ${completed.map(summarise).join("; ")}.`];
  const seen = new Map<string, string[]>();
  // Newest pass first, so the sort's stable ties resolve towards the pass that just ran; each
  // older label is prepended, which keeps every entry's own pass list chronological as it
  // renders.
  for (const pass of completed.toReversed()) {
    for (const refusal of refusalsOf(pass.evidence)) {
      seen.set(refusal, [pass.label, ...(seen.get(refusal) ?? [])]);
    }
  }
  // Most-repeated first, and the stable sort leaves ties in the newest-first order above. Cutting
  // in insertion order instead drops a refusal made in three consecutive passes behind twelve
  // one-offs from the oldest pass, and the line renders as if nothing were missing while the repeat
  // count sits unread in the map's value. A label several passes carry is a habit; one pass's label
  // is an incident, and the habit is what this line means. The other bounded lists cut the same
  // way: `diagnosableIssues` sorts by rate first, the advice packet's issue block by count.
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
