/** Authoring receives typed findings and the reviewed public obligations, never review prose. */
import { jsonPathTokens } from "../meta/json-evidence.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AnalysisFinding, DemandGap, ProbeDirection } from "../analyse/iteration-analysis.ts";
import { contractDefect } from "../analyse/finding-owner.ts";
import type { ContestedCase } from "../analyse/judge-contested.ts";
import type { Brief } from "../correctness-bundle/brief.ts";
import { publicRuleDecisions } from "../correctness-bundle/public-resources.ts";
import type { EpochReviewEvidence } from "./epoch-review-findings.ts";
import { isBundleFile } from "../author/feedback-routing.ts";
import { adviceIssueId } from "../author/rebuild-advice.ts";
import { BRIEF_FILE, CONTROLS_FILE, EVALUATOR_FILE, TASKS_FILE } from "../meta/bundle-layout.ts";

/** What the reviewed candidate supplies: the public contract, and the contested rows the review
 *  settled against it. */
type ReviewContract = {
  brief: Brief | null;
  vetoed?: readonly ContestedCase[];
  disputed?: readonly ContestedCase[];
  deferAdvisory?: boolean;
};

/** Each recognised shape as the sentence the author reads. The shape is a typed choice from a closed
 *  set, so its sentence is fixed text and crosses where the reviewer's own claim does not. */
const DEMAND_GAP_SENTENCES: Record<DemandGap, string> = {
  "capability-unexercised": "The request names a capability no task in the battery exercises.",
  "sibling-values-only": "Sibling tasks differ only in the values they publish.",
  "limit-cleared-widely": "The first reasonable candidate clears a published limit widely.",
  "solver-tool-reports-margins": "A solver tool reports every margin a declared check reads.",
  "rule-outside-request": "A rule stands that no practitioner of the request would hold.",
};

/** Which way a probe-backed check is wrong, as the author reads it. The moved checks read the same
 *  either way and the two repairs are opposite, so the direction crosses as fixed text keyed by the
 *  typed field; the probe's value, its edit and the reviewer's reading of it stay private. */
const PROBE_DIRECTION_SENTENCES: Record<ProbeDirection, string> = {
  "rejects-valid":
    "The review's probe wrote an answer the published rule allows, and the check refused it: a false rejection, so the repair loosens the check to what the published rule and the original request allow, and does not tighten it or publish the restriction as a new rule.",
  "accepts-invalid":
    "The review's probe wrote an answer the published rule forbids, and the check let it through: a false acceptance, so the repair makes the check refuse what the published rule forbids.",
};

/** A task-set finding's act where its demand gap asks for something other than a difference in what
 *  the tasks demand of an input. Each follows its gap: a limit the first reasonable candidate clears
 *  asks for that limit to bind, which adoption ties to the reference solve, and a sentence telling
 *  the author the finding did not ask for that would negate the gap it was typed with. */
const GAP_ACTS: Partial<Record<DemandGap, string>> = {
  "limit-cleared-widely":
    "make the published limit bind a first reasonable candidate in the fresh battery; adoption solves every task with the reference and refuses a candidate whose reference artifact fails a declared check, so a tighter limit needs a stronger reference search",
  "solver-tool-reports-margins":
    "make the fresh battery's tasks demand a decision that reading a reported margin and adjusting does not reach",
  "rule-outside-request":
    "hold the fresh battery's tasks to what the request itself demands, without the rule it does not hold",
};

/** Whether the finding's owner is the file that holds its check, which is what an obligation line
 *  and a repair order are about. A brief finding naming a check is about the rule the brief
 *  publishes, not the check's code, so it gets neither. */
const holdsCheck = (finding: AnalysisFinding) =>
  finding.owner === EVALUATOR_FILE || finding.owner === CONTROLS_FILE;

/** What the finding asks of its owner. A demonstrated defect is repaired; a defect in the task set
 *  names the public input to move in the fresh battery, not an enforcement the tasks do not own; an
 *  observation asks for nothing. Measured hardness and an undecided reading are both observations,
 *  and neither may read as an order to edit the product: under the ordinary sentence an undecided
 *  reading would reach the Builder as "inspect and repair that contract" followed by the blanket
 *  repair instruction, which is an order built out of an admitted uncertainty.
 *
 *  The task-set sentence says which way to vary, because the vague form does harm. "Vary this in
 *  the fresh battery", read against a published limit, invites the author to move that limit from
 *  one battery to the next, which changes the published magnitudes over a task set that has not
 *  moved and leaves the battery exactly as easy as it was. The variation this finding is about is
 *  across the battery's own tasks, and "let this input differ" was met by permuting values inside
 *  one template, which leaves one condition measured many times, so the sentence asks for a
 *  difference in what the tasks demand rather than in what they publish. A gap in `GAP_ACTS` asks
 *  for something else, and gets its own act. */
function publicAct(finding: AnalysisFinding, deferred: boolean): string {
  if (deferred) return "this is advisory and asks for no change before submit";
  if (!finding.defect) return "this is an observation, not a demonstrated defect, and asks for no repair";
  if (finding.owner === TASKS_FILE) {
    const gapAct = finding.demandGap === undefined ? undefined : GAP_ACTS[finding.demandGap];
    return (
      gapAct ??
      "make the fresh battery's tasks differ in what they ask of this input — which parts it brings together and how they must work — not only in the values published in it"
    );
  }
  if (finding.owner === BRIEF_FILE) {
    return "decide the public rule this concerns in the brief: publish every rule a check enforces, or withhold a construction recipe that hands the solver the answer";
  }
  return "inspect and repair that contract";
}

/** The file where the Builder acts. A finding owned by the task set stays with the tasks, and one
 *  owned by any bundle file but the two that hold a check — the brief above all — stays with its
 *  owner. The rest are placed by the identity they name before their owner: a check lives in the
 *  evaluator and a bare public input in the tasks, because a check finding can move between the
 *  evaluator and its controls from round to round while its identity stays. Moving a brief finding
 *  to its check's file sent the author to repair code whose rule was the thing at fault. */
function publicGroup(finding: AnalysisFinding): string {
  const { owner } = finding;
  if (owner === TASKS_FILE) return TASKS_FILE;
  if (isBundleFile(owner) && !holdsCheck(finding)) return owner;
  if (finding.checkId !== undefined || finding.unobserved === true) return EVALUATOR_FILE;
  if (finding.publicInputPath !== undefined && finding.artifactSchemaPath === undefined) return TASKS_FILE;
  return isBundleFile(owner) ? owner : "unplaced";
}

/** The public sentence for one finding, composed from typed identities alone. A template sentence
 *  that names none of them tells the Builder nothing, and an author with nothing to act on
 *  resubmits unchanged bytes as a probe. The check id, schema path and public input path are public
 *  authoring identities, so they cross; the reviewer's claim is not one and never enters this
 *  sentence. */
function publicFindingClaim(finding: AnalysisFinding, deferred: boolean, brief: Brief | null): string {
  const group = publicGroup(finding);
  const heading = `Epoch review (${group})`;
  const named = [
    ...(finding.checkId === undefined ? [] : [`check \`${finding.checkId}\``]),
    ...(finding.artifactSchemaPath === undefined ? [] : [`artifact path \`${finding.artifactSchemaPath}\``]),
  ].join(" at ");
  const inputPath =
    finding.publicInputPath === undefined
      ? null
      : finding.secondPublicInputPath === undefined
        ? `public input \`${finding.publicInputPath}\``
        : `public inputs \`${finding.publicInputPath}\` and \`${finding.secondPublicInputPath}\``;
  const input = inputPath === null ? "" : ` (${inputPath})`;
  if (finding.unobserved === true && !deferred) {
    // The obligation is unobserved, not the path. "No declared check observes artifact path `x`"
    // is plainly false to an author whose checks all read `x`, and a finding that reads as nonsense
    // is a finding acted on by nobody. So the readers are counted here, which contradicts the bare
    // sentence, and never quoted, which would carry verifier detail across.
    const path = finding.artifactSchemaPath;
    const readers = (brief?.truthChecks ?? []).filter((check) =>
      check.execution.artifactPaths.some((declared) => {
        // Through the validator's own tokeniser, so `$['pins']` reads as `pins` does.
        const read = (jsonPathTokens(declared) ?? []).join("").replace(/^\./, "");
        return (
          path !== undefined && (read === path || path.startsWith(`${read}.`) || read.startsWith(`${path}.`))
        );
      }),
    ).length;
    const where = path === undefined ? "" : ` at artifact path \`${path}\``;
    const gap =
      readers === 0
        ? `no declared check observes the obligation the review traced${where}`
        : `none of the ${String(readers)} declared checks reading artifact path \`${path ?? ""}\` observes the obligation the review traced there`;
    return `${heading}: ${gap}${input}; add a check that observes what the delivered artifact does there.`;
  }
  if (named === "" && inputPath === null) {
    // A gap the review typed is the mechanism, which a guessed "mismatch" would contradict.
    const defectAct = deferred
      ? "it is advisory and asks for no change before submit"
      : finding.demandGap === undefined
        ? "inspect that contract for a mismatch"
        : publicAct(finding, deferred);
    return `${heading}: ${group === "unplaced" ? "no check, path or file named" : "no check or path named"}; ${finding.defect ? defectAct : "it is an observation and asks for no repair"}.`;
  }
  return `${heading}: ${named === "" ? (inputPath ?? "the contract") : `${named}${input}`}; ${publicAct(finding, deferred)}.`;
}

/** The contested rows a finding settles: a contract defect on a check the row names, over an
 *  artifact the reviewer opened. A second case naming the same check is not settled by reading
 *  the first, so the public counts and families come from the opened cases alone. */
function settledRows(
  finding: AnalysisFinding,
  rows: readonly ContestedCase[],
  opened: readonly string[],
): ContestedCase[] {
  if (!contractDefect(finding) || finding.checkId === undefined) return [];
  return rows.filter(
    (row) =>
      row.checkIds.includes(finding.checkId ?? "") && row.artifact !== null && opened.includes(row.artifact),
  );
}

/** The contested rows a `settlesJudge` observation settles in the check's favour: every row naming
 *  the check it cites. The probe it had to cite at record time is what makes that a settlement. */
function judgeRows(finding: AnalysisFinding, rows: readonly ContestedCase[]): ContestedCase[] {
  if (finding.settlesJudge !== true || finding.checkId === undefined) return [];
  return rows.filter((row) => row.checkIds.includes(finding.checkId ?? ""));
}

function familiesOf(rows: readonly ContestedCase[]): string {
  return [...new Set(rows.map((row) => row.family))].sort().join(", ");
}

/** A settled Judge disagreement crosses as its outcome alone: the check stands, and in which
 *  families. The Judge's reason and the probe's values stay private. */
function settlementLines(finding: AnalysisFinding, rows: readonly ContestedCase[]): string[] {
  const judged = judgeRows(finding, rows);
  return judged.length === 0
    ? []
    : [
        `The review settled the Judge's disagreement on ${String(judged.length)} case(s) in ${familiesOf(judged)} in the check's favour: the check stands as declared.`,
      ];
}

/** One finding's public sentence: the claim, then whatever typed context the reviewed contract and
 *  the settled contested rows supply. Every branch here decides what may cross to an authoring
 *  prompt, so it stays one function rather than five that each answer part of that question. */
function publicFinding(
  finding: AnalysisFinding,
  contract: ReviewContract,
  vetoed: readonly ContestedCase[],
  disputed: readonly ContestedCase[],
  opened: readonly string[],
) {
  const deferred = contract.deferAdvisory === true && finding.severity === "advisory";
  const repairable = !deferred && contractDefect(finding);
  const check = contract.brief?.truthChecks.find((candidate) => candidate.id === finding.checkId);
  const rules =
    contract.brief === null || check === undefined
      ? []
      : publicRuleDecisions(contract.brief).filter(
          (rule) => check.citedDecisionIds?.includes(rule.id) === true,
        );
  // Only the reviewed public contract supplies these bytes. Private review prose cannot supply an
  // obligation, a counterexample or a repair instruction.
  //
  // The obligation rides with the repair it was added to bind. A finding that asks for no repair
  // has nothing to bind it to, and quoting the check back at the author who wrote it fills the
  // packet instead: a long assertion beside "asks for no repair" can be most of what the rebuild
  // author reads, and it points at the evaluator in rounds where the tasks were the thing to move.
  // The check id already names the file the author owns.
  const obligation =
    check === undefined || !repairable || !holdsCheck(finding)
      ? []
      : [
          `Declared public obligation: ${capturedJsonStringify({
            assertion: check.assertion,
            rules: rules.map((rule) => ({ id: rule.id, statement: rule.statement })),
          })}`,
        ];
  // A defect the reviewer recorded on a check the Judge had vetoed carries the veto's public
  // shape: how many verified passes, in which families. The Judge's reason and the review's
  // demonstration stay private; the count and the family are what the Builder needs to know which
  // artifacts the check let through.
  const vetoes = settledRows(finding, vetoed, opened);
  const veto =
    vetoes.length === 0
      ? []
      : [
          `The Judge failed ${String(vetoes.length)} verified pass(es) in ${familiesOf(vetoes)} citing this obligation, and the review settled them against the check: it passes an artifact the obligation refuses.`,
        ];
  const disputes = settledRows(finding, disputed, opened);
  const dispute =
    disputes.length === 0
      ? []
      : [
          `The Judge passed ${String(disputes.length)} verified fail(s) in ${familiesOf(disputes)} holding this obligation satisfied, and the review settled them against the check: it refuses an artifact the obligation admits.`,
        ];
  // What the probes executed, for a defect the author is being asked to look at. A defect survives
  // the two-occurrence ceiling on forced blocking when the public projection supplies only its
  // check name: the review has run the checks over its own changed field and the author reads a
  // check id. The three identities here are the class the check id already crosses by — an accept
  // control the Builder wrote, a dotted path under its own artifactSchema root, and its own
  // declared check ids.
  //
  // It rides with an advisory finding too, deferred or not, and that is the case it is for: a
  // probe-backed finding held at advice because the same check has been named twice already.
  // Without this line the round projects that check name a third time, which is the repetition the
  // ceiling exists to stop.
  const probed =
    !finding.defect || (finding.probes ?? []).length === 0
      ? []
      : [
          `Executed against this candidate's own declared checks: ${(finding.probes ?? [])
            .map(
              (probe) =>
                `changing ${probe.path} on accept control ${probe.controlId} ${
                  probe.movedCheckIds.length === 0
                    ? "moved no declared check"
                    : `moved ${[...probe.movedCheckIds].sort().join(", ")}`
                }`,
            )
            .join("; ")}.`,
          ...(finding.probeDirection === undefined
            ? []
            : [PROBE_DIRECTION_SENTENCES[finding.probeDirection]]),
        ];
  // The request is not repeated here. Every prompt that renders these rows states it once under its
  // own heading, and a copy per finding puts it several times into one authoring prompt, in front
  // of each sentence the author has to act on. One duty, one owner (rule 14).
  const context = [...obligation, ...veto, ...dispute];
  // The repair instruction rides only with a demonstrated defect — which, until the request left
  // this list, was every repairable finding, since `context` could not then be empty.
  const repair =
    !repairable || !holdsCheck(finding) || (context.length === 0 && contract.deferAdvisory !== true)
      ? []
      : [
          "Repair the complete public obligation. Retain a valid alternative and a plausible counterexample that distinguish the repair; a neighbouring correction does not establish closure.",
        ];
  return {
    ...finding,
    claim: [
      publicFindingClaim(finding, deferred, contract.brief),
      ...(finding.demandGap === undefined ? [] : [DEMAND_GAP_SENTENCES[finding.demandGap]]),
      ...settlementLines(finding, [...vetoed, ...disputed]),
      ...context,
      ...probed,
      ...repair,
    ].join("\n"),
  };
}

/** Private review prose stays in its recorded evidence; only typed routing reaches authoring.
 *  `deferAdvisory` is the authoring review's reading: an advisory finding asks for no change before
 *  submit and carries no repair order, because a Builder that meets one mid-session repairs it at
 *  once and pays a fresh full check for it, spending gate time on advice that was never asked to be
 *  acted on before submit. */
export function publicEpochReview(
  review: Pick<EpochReviewEvidence, "status" | "findings" | "disputes"> & {
    contestedReads?: readonly string[];
  },
  contract: ReviewContract = { brief: null },
) {
  const vetoed = contract.vetoed ?? [];
  const disputed = contract.disputed ?? [];
  const opened = review.contestedReads ?? [];
  // An unfinished review has not weighed the complete contract, so its observations stay private:
  // neither an owner reopen nor a suspended diagnosis may come from a partial reading. One reading
  // is complete on its own, and that is a vetoed case the reviewer settled against the check after
  // opening the vetoed artifact — a review cut short by a vanished `.toolchain` can still have done
  // that much. The settlement crosses as advice rather than as a reopen, since whatever the review
  // could not read may be what owns the check.
  const settled =
    review.status === "completed"
      ? review.findings
      : review.findings.flatMap((finding) => {
          const read = settledRows(finding, [...vetoed, ...disputed], opened).length > 0;
          return read ? [{ ...finding, severity: "advisory" as const }] : [];
        });
  return {
    findings: settled.map((finding) => publicFinding(finding, contract, vetoed, disputed, opened)),
    disputes:
      review.status === "completed"
        ? review.disputes.map(({ issueId }) => ({
            issueId,
            reason: "The epoch review disputes this issue as an evaluation defect.",
          }))
        : [],
    settledJudge: review.status === "completed" ? settledJudgeIssues(review.findings, vetoed, disputed) : [],
  };
}

/** The Judge issue ids a completed review settled in the check's favour, in the id form the rebuild
 *  advice keys its Judge issues by: one per family and direction. */
function settledJudgeIssues(
  findings: readonly AnalysisFinding[],
  vetoed: readonly ContestedCase[],
  disputed: readonly ContestedCase[],
): string[] {
  const ids = findings.flatMap((finding) => [
    ...judgeRows(finding, vetoed).map((row) =>
      adviceIssueId("judge-failed-verifier-passed", row.family, null),
    ),
    ...judgeRows(finding, disputed).map((row) =>
      adviceIssueId("judge-passed-verifier-failed", row.family, null),
    ),
  ]);
  return [...new Set(ids)].sort();
}

/** Earlier task-set findings over the task set now under review, each in the public form its round's
 *  Builder read. Shown to the reviewer rather than to the author: the author already received them,
 *  and the reviewer is the one reading whether an unchanged battery left them standing. */
export function earlierTaskFindingLines(
  rows: ReadonlyArray<{ runId: string; findings: AnalysisFinding[] }>,
): string[] {
  if (rows.length === 0) return [];
  return [
    "Earlier reviews of this same task set (its taskSetHash is unchanged) recorded these correctness-model/tasks.json findings, as the Builder read them. The tasks did not change since, so read whether each still stands before recording it again:",
    ...rows.flatMap(({ runId, findings }) =>
      publicEpochReview({ status: "completed", findings, disputes: [] }).findings.map(
        (finding) => `- ${runId}: ${finding.claim.replaceAll("\n", " ")}`,
      ),
    ),
  ];
}
