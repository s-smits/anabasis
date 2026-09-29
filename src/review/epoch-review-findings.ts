/**
 * What an epoch review records, and what earlier reviews prove.
 *
 * A review is evidence before it is advice. It names the measured condition it read, the source it
 * was shown and the findings it recorded, and every later decision reads those bytes rather than
 * the reviewer's prose, so anything a finding cannot carry in a recorded field is lost.
 *
 * `record_finding` is the reviewer's only writing tool, so the second half of this file is the
 * whole contract between a reading session and the campaign record. Each refusal there is a rule:
 * a claim must name public identities the measured brief declares, cite passages `read_source`
 * actually returned, and carry a demonstration before it may block.
 *
 * Reuse asks whether this exact condition and procedure were already read to completion. A
 * finding's severity reads that finding alone (`blockingEvidence`); what an earlier review said
 * reaches this one only as the previous review's advisory defects and probes, carried as leads.
 */
import { existsSync, readdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import {
  type AnalysisFinding,
  DEMAND_GAPS,
  type FindingPlacement,
  PROBE_DIRECTIONS,
} from "../analyse/iteration-analysis.ts";
import type { AdviceIssue } from "../author/rebuild-advice.ts";
import { readCompleted } from "../author/campaign-epoch.ts";
import { BUNDLE_FILES, type BundleFile, ownerSide } from "../author/feedback-routing.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { mentionsTask } from "../meta/identifier-scan.ts";
import { plainRecord } from "../meta/json-evidence.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { type JsonValue, isBoolean, isString } from "../meta/json-shape.ts";
import { keyIfNotNull, keysIf } from "../meta/optional-key.ts";
import { type ReaderTool, readerParameters, readerToolText } from "./review-reader.ts";
import {
  PROBE_DIRECTION_PARAMETER,
  type ProbeState,
  type ReviewProbeRow,
  probeBackedRows,
  probeShows,
  probeCitationRefusal,
} from "./review-probe.ts";
import { type ReviewVerifierEvidence, type SourceReadState, deliveredSource } from "./review-sources.ts";
import { contractDefect } from "../analyse/finding-owner.ts";
import { BRIEF_FILE, TASKS_FILE } from "../meta/bundle-layout.ts";
import { readJsonFile } from "../meta/completed-json.ts";
import { boundText } from "../meta/bounded-text.ts";
import { type AdvisoryDefect, type AdvisoryDisposition, advisoryDefects } from "./review-carry.ts";

export const EPOCH_REVIEW_SCHEMA = "epoch-review/v7";
/** Product identity; review procedure belongs to the review request. */
export type MeasuredCondition = {
  /** Null when the recorded fields cannot establish a measured condition. */
  digest: string | null;
  /** Null for a bundle with no task set, which leaves the condition without a digest, so no review
   *  of it is ever reused and no earlier task-set finding is shown against it. */
  taskSetHash: string | null;
  agentHash: string;
  correctnessModelHash: string;
  builtPin: string;
  /** The pin names no reasoning effort; null when the cases did not all record one. */
  builtEffort: string | null;
  verifierIdentity: string | null;
};

export type EpochReviewEvidence = {
  schema: typeof EPOCH_REVIEW_SCHEMA;
  slug: string;
  runId: string;
  status: "completed" | "incomplete" | "failed" | "skipped";
  reason: string | null;
  /** Null at an authoring checkpoint: no battery has measured these source bytes. */
  condition: MeasuredCondition | null;
  reviewerPin: string | null;
  /** Configured effort, not served attestation. Unresolved effort cannot bind reuse. */
  reviewerEffort: string | null;
  /** The review procedure's identity: the public request, the review policy and the prompt. */
  requestDigest: string;
  /** What this review had to settle beyond its source: the contested cases with their artifact
   *  bytes, and the standing issues it could dispute. */
  obligationsDigest: string;
  /** Repo-relative paths the reviewer opened, in order; a paged file appears once per call. */
  reads: string[];
  /** Each listed veto or disputed fail a finding settled, one per case, as the finding named it in
   *  `settlesCases`. Private: only counts and families cross to authoring. Nothing is settled by
   *  having been read, or by sharing a check with a finding that named another case. */
  dispositions: CaseDisposition[];
  /** The listed vetoes and disputed fails no finding settled. `status` says how far the reading
   *  got; this says what of the settlement work it left open, which a completed review can too. */
  unsettled: string[];
  /** What the host returned against the inventory, in files and characters. This counts the host
   *  side alone, so a complete coverage row establishes that the source was offered, not that the
   *  review saw it. */
  coverage: {
    files: number;
    opened: number;
    chars: number;
    complete?: boolean;
    truncated?: boolean;
    missing?: string[];
  };
  /** Absent on a review that stopped before reading its source. Host-bound tool provenance is
   *  private, like everything else the verifier produced, so it never reaches authoring. */
  verifier?: ReviewVerifierEvidence;
  findings: AnalysisFinding[];
  /** Issue ids the review argued belong to the evaluation, with the argument. */
  disputes: Array<{ issueId: string; reason: string }>;
  /** Absent on a review that opened no session. */
  admission?: ReviewAdmission;
  /** What the review executed, absent when it executed nothing. Private: which check reacts to
   *  which changed field is verifier detail an author must not read. */
  probes?: ReviewProbeRow[];
  /** Each advisory defect the previous completed review recorded, as this completed review left it
   *  (`advisoryRecord`): the previous battery's review for a measured one, the round's previous
   *  review for an authoring one. Absent where there was none, or this review did not complete. */
  earlierAdvisory?: AdvisoryDisposition[];
  report: string | null;
};

/** What the host did to the reviewer's session: resumed an early finish, refused citations that
 *  quoted no returned page, or admitted a finding at a different severity than it requested. */
type ReviewAdmission = {
  continuations: number;
  citationRefusals: number;
  severityAdjusted: Array<{
    owner: string | null;
    requested: "advisory" | "blocking";
    admitted: "advisory" | "blocking";
  }>;
};
/** A listed contested case as `record_finding` may settle it: which way the verifier and the Judge
 *  disagreed, the checks that decided it, and the name `read_source` delivers its artifact under. */
export type SettlementCase = {
  taskId: string;
  family: string;
  kind: "vetoed" | "disputed";
  checkIds: readonly string[];
  path: string | null;
};
/** One case a finding settled: against the check, by a defect in the evaluation contract, or in the
 *  check's favour, by an observation whose cited probe moved that check. `finding` indexes the
 *  review's `findings`, whose citations and probes are the evidence. */
export type CaseDisposition = Omit<SettlementCase, "checkIds" | "path"> & {
  checkId: string;
  disposition: "against-check" | "check-stands";
  finding: number;
};
/** The direction a defect settling each kind of case against its check must show, when it names one. */
const AGAINST_CHECK = { vetoed: "accepts-invalid", disputed: "rejects-valid" } as const;
const MAX_FINDINGS = 6;
export type ReviewState = SourceReadState & {
  probes: ProbeState;
  dispositions: CaseDisposition[];
  findings: AnalysisFinding[];
  disputes: Array<{ issueId: string; reason: string }>;
  admission: ReviewAdmission;
};
/** The public identities a finding may carry, read from the measured brief. A brief that is absent
 *  or unreadable declares nothing, so every identity is refused rather than guessed. */
type BriefIdentities = { schemaRoots: readonly string[]; checkIds: readonly string[] };

type FindingArgs = ReturnType<typeof findingArgs>;

/** Minimum demonstration length for a blocking finding. The review instructions ask for a
 *  demonstrated violation before blocking, and without a floor nothing in the host checks that one
 *  was supplied: a finding that says in so many words it could not construct a concrete case still
 *  decides the next move. The floor proves only that text was supplied, never that the argument in
 *  it holds; the citations rule carries the rest. */
const DEMONSTRATION_MIN_CHARS = 40;

const CITATIONS_UNBOUND =
  "citations must quote passages actually returned by read_source; read the source and retry";
const SEVERITY_REQUIRED = "severity must explicitly be advisory or blocking";
const DEFECT_AND_CLAIM_REQUIRED = "defect and claim are required";
const DEFECT_OWNER_REQUIRED = "a defect must name the bundle file at fault as its owner";

/** Everything one `record_finding` call offers, as the rules below read it. The raw `args` stay
 *  beside the parsed values because two rules ask whether a field was supplied at all, which a
 *  parsed value can no longer answer once an absent field and an empty one have both become null.
 *  `citations` is null both when none was supplied and when none quoted a page `read_source`
 *  returned; the rule inspecting `args.citations` tells them apart, so citing nothing and citing a
 *  hallucinated page get different refusals. */
interface FindingCase {
  parsed: FindingArgs;
  args: Record<string, JsonValue>;
  owner: BundleFile | null;
  citations: string | null;
  state: ReviewState;
  identities: BriefIdentities;
  taskIds: readonly string[];
  /** The listed vetoes and disputed fails a finding may settle. */
  cases: readonly SettlementCase[];
}

type FindingRule = (subject: FindingCase) => string | null;

type FindingSeverity = "advisory" | "blocking";
type FindingVerdict = { why: string } | { severity: FindingSeverity; placement: FindingPlacement };

/** The public identities a finding may name. */
type FindingPriors = {
  readonly identities?: BriefIdentities | undefined;
  /** The listed vetoes and disputed fails a finding may settle (`caseSettlement`). */
  readonly cases?: readonly SettlementCase[] | undefined;
};

export function measuredConditionOf({
  agentHash,
  correctnessModelHash,
  taskSetHash,
  builtPin,
  builtEffort,
  verifierIdentity,
}: Omit<MeasuredCondition, "digest">): MeasuredCondition {
  const fields = { agentHash, correctnessModelHash, taskSetHash, builtPin, builtEffort, verifierIdentity };
  return {
    ...fields,
    digest: Object.values(fields).every((value) => isString(value) && value.trim() !== "")
      ? hashJsonValue(fields)
      : null,
  };
}

/** The completed reviews recorded for this campaign. An unreadable review proves nothing either
 *  way, so it is left out here and each caller decides without it: that means a corrupt file never
 *  suppresses a fresh review and never contributes an earlier finding or advisory defect. */
function completedReviews(analysisDir: string): EpochReviewEvidence[] {
  if (!existsSync(analysisDir)) return [];
  return readdirSync(analysisDir)
    .filter((name) => name.endsWith("-epoch-review.json"))
    .flatMap((name) => {
      try {
        const review = readCompleted<EpochReviewEvidence>(
          join(analysisDir, name),
          EPOCH_REVIEW_SCHEMA,
          "findings",
          "delete nothing; an unreadable review is inspected, not skipped over",
        );
        return review?.status === "completed" ? [review] : [];
      } catch {
        return [];
      }
    });
}

/** Whether a completed review, the one status meaning a finished turn over full coverage and whose
 *  findings route, already covered this condition, this reviewer and these obligations. All three
 *  must match: a new contested artifact or a newly standing issue under an unchanged product is new
 *  work, and skipping it would leave the one component that reads the measured tree against the
 *  original request silent about what changed. An unreadable review proves no coverage. */
export function conditionAlreadyReviewed(
  analysisDir: string,
  condition: MeasuredCondition,
  expected: Pick<
    EpochReviewEvidence,
    "reviewerPin" | "reviewerEffort" | "requestDigest" | "obligationsDigest"
  >,
): boolean {
  return (
    condition.digest !== null &&
    expected.reviewerPin !== null &&
    isString(expected.reviewerEffort) &&
    expected.reviewerEffort.trim() !== "" &&
    completedReviews(analysisDir).some(
      (review) =>
        review.condition?.digest === condition.digest &&
        review.reviewerPin === expected.reviewerPin &&
        review.reviewerEffort === expected.reviewerEffort &&
        review.requestDigest === expected.requestDigest &&
        review.obligationsDigest === expected.obligationsDigest,
    )
  );
}

/** The task-set findings earlier complete reviews recorded over the task set now under review. A
 *  task-set finding asks the next battery to demand more of the request; when the battery that came
 *  back has the same `taskSetHash`, nothing it said was acted on, and a reviewer who is not shown it
 *  re-derives it from scratch or, worse, reads the unchanged tasks as settled. The current review's
 *  own file is left out, since it is being written. */
export function earlierTaskFindings(
  analysisDir: string,
  current: MeasuredCondition,
  runId: string,
): Array<{ runId: string; findings: AnalysisFinding[] }> {
  if (current.taskSetHash === null) return [];
  return completedReviews(analysisDir)
    .filter((review) => review.runId !== runId && review.condition?.taskSetHash === current.taskSetHash)
    .map((review) => ({
      runId: review.runId,
      findings: review.findings.filter((finding) => finding.owner === TASKS_FILE),
    }))
    .filter((row) => row.findings.length > 0)
    .sort((a, b) => a.runId.localeCompare(b.runId));
}

/** The advisory defects the completed review of battery `runId` recorded, which the next measured
 *  review's record disposes of. None when that review did not complete or there is no such run. */
export function measuredAdvisory(analysisDir: string, runId: string | undefined): AdvisoryDefect[] {
  const review = completedReviews(analysisDir).find((row) => row.runId === runId);
  return review === undefined ? [] : advisoryDefects(review);
}

export function briefIdentities(root: string): BriefIdentities {
  const names = (value: JsonValue | undefined, key: string): string[] =>
    Array.isArray(value)
      ? value.flatMap((row) => {
          const field = plainRecord(row)?.[key];
          return isString(field) ? [field] : [];
        })
      : [];
  try {
    const brief = plainRecord(readJsonFile(join(root, BRIEF_FILE)));
    return { schemaRoots: names(brief?.artifactSchema, "name"), checkIds: names(brief?.truthChecks, "id") };
  } catch {
    return { schemaRoots: [], checkIds: [] };
  }
}

/** The one place `record_finding`'s untyped argument record becomes named values. It is kept out
 *  of the rules below so that each of them reads as the rule it is rather than as field parsing,
 *  and so that a change to how a field is read cannot be made in one rule and missed in another. */
function findingArgs(args: Record<string, JsonValue>) {
  const read = (key: string) => (isString(args[key]) ? args[key] : "");
  const optional = (key: string) => {
    const value = read(key).trim();
    return value === "" ? null : value;
  };
  const chosen = read("severity");
  const severity: FindingSeverity | null = chosen === "advisory" || chosen === "blocking" ? chosen : null;
  return {
    defect: isBoolean(args.defect) ? args.defect : null,
    claim: read("claim").trim(),
    owner: optional("owner"),
    severity,
    demonstration: optional("demonstration"),
    disputes: read("disputesIssue"),
    checkId: optional("checkId"),
    artifactSchemaPath: optional("artifactSchemaPath"),
    publicInputPath: optional("publicInputPath"),
    secondPublicInputPath: optional("secondPublicInputPath"),
    demandGap: DEMAND_GAPS.find((gap) => gap === args.demandGap) ?? null,
    probeDirection: PROBE_DIRECTIONS.find((direction) => direction === args.probeDirection) ?? null,
    settlesCases: [...new Set(Array.isArray(args.settlesCases) ? args.settlesCases.filter(isString) : [])],
    unobserved: args.unobserved === true,
  };
}

/** Source quotations establish what was available, not whether the model's inference is right. How
 *  many there are and how long each runs is the reviewer's choice: what the host holds them to is
 *  that every one quotes a page `read_source` returned. */
function findingCitations(args: Record<string, JsonValue>, state: SourceReadState): string | null {
  const { citations } = args;
  if (!Array.isArray(citations) || citations.length === 0) return null;
  const bound = citations.map((value) => boundQuote(value, state));
  return bound.every((row) => row !== null) ? bound.join("\n") : null;
}

/** One citation as `path: "quote"`, or null when it quotes no page `read_source` returned. */
function boundQuote(value: JsonValue, state: SourceReadState): string | null {
  const row = plainRecord(value);
  if (!isString(row?.path) || !isString(row.quote)) return null;
  const { path, quote } = row;
  if (quote.trim() === "") return null;
  const returned =
    deliveredSource(state, path).record?.pages.some((page) => page.text.includes(quote)) === true;
  return returned ? `${path}: ${capturedJsonStringify(quote)}` : null;
}

/** Reopening an owner and suspending a standing issue require the same source-bound case. */
const blockingEvidence: FindingRule = ({ parsed, citations }) => {
  const claimed = (parsed.defect === true && parsed.severity === "blocking") || parsed.disputes !== "";
  if (!claimed) return null;
  if ((parsed.demonstration?.length ?? 0) < DEMONSTRATION_MIN_CHARS) {
    return "blocking or disputing requires a concrete case in `demonstration`; otherwise record advisory without disputesIssue";
  }
  return citations === null
    ? "blocking or disputing requires citations from read_source; otherwise record advisory without disputesIssue"
    : null;
};

/** Only the evaluation side may argue that a standing issue belongs to the evaluation. */
const disputeEligibility: FindingRule = ({ parsed, owner }) => {
  if (parsed.disputes === "") return null;
  return parsed.defect === true && owner !== null && ownerSide(owner) === "correctness-model"
    ? null
    : "this finding cannot dispute an issue: only a defect owned under correctness-model/ may suspend diagnosis; omit disputesIssue and retry";
};

const schemaPath: FindingRule = ({ parsed, identities }) => {
  if (parsed.artifactSchemaPath === null) return null;
  const segments = parsed.artifactSchemaPath.split(".");
  if (segments.includes("")) return "artifactSchemaPath must be a dotted path without empty segments";
  const root = segments[0] ?? "";
  return identities.schemaRoots.includes(root)
    ? null
    : `artifactSchemaPath root ${root} is not a declared artifactSchema root`;
};

/** Both public input paths are held to one rule: rooted at `$.` and naming no individual task. */
const publicInput: FindingRule = ({ parsed, taskIds }) => {
  for (const [field, path] of [
    ["publicInputPath", parsed.publicInputPath],
    ["secondPublicInputPath", parsed.secondPublicInputPath],
  ] as const) {
    if (path === null) continue;
    if (!path.startsWith("$.")) return `${field} must start with $.`;
    if (taskIds.some((taskId) => mentionsTask(path, taskId))) {
      return `${field} may not name an individual task`;
    }
  }
  return null;
};

/** A demand gap is one of the closed set or nothing: an unrecognised word is refused rather than
 *  dropped, so the reviewer learns the set instead of believing it classified the finding. */
const knownDemandGap: FindingRule = ({ parsed, args }) =>
  args.demandGap !== undefined && parsed.demandGap === null
    ? `demandGap must be one of ${DEMAND_GAPS.join(", ")}`
    : null;

/** A finding settles exactly the listed cases it names, and only in the way its evidence can. A
 *  defect in the evaluation contract settles a case against its check, and must not show the
 *  opposite direction; an observation settles one in the check's favour only with a cited probe
 *  that wrote the Judge's reading into an accept control and moved that check, since without it the
 *  settlement is one model's reading against another's. An agent file or the task set settles
 *  nothing, because neither decided the case. Each named case must be decided by the finding's
 *  check, read with `read_source`, and not already settled by an earlier finding. */
const caseSettlement: FindingRule = ({ parsed, args, owner, state, cases }) => {
  const { checkId, settlesCases } = parsed;
  if (settlesCases.length === 0) return null;
  const against = contractDefect({ defect: parsed.defect, owner });
  if (checkId === null || (parsed.defect === true && !against)) {
    return "settlesCases is for a finding naming the deciding checkId: a defect owned under correctness-model/ other than tasks.json, or an observation";
  }
  if (
    !against &&
    !probeBackedRows(state.probes, args.probeIds).some((row) => row.movedCheckIds.includes(checkId))
  ) {
    return "settling a case in the check's favour requires a cited probe in which writing the Judge's reading into an accept control moved that check";
  }
  for (const taskId of settlesCases) {
    const row = cases.find((listed) => listed.taskId === taskId);
    if (row === undefined) return `settlesCases: ${taskId} is not a listed veto or disputed fail`;
    if (!row.checkIds.includes(checkId)) return `settlesCases: ${checkId} did not decide ${taskId}`;
    if (row.path === null || !state.reads.includes(row.path)) {
      return `settlesCases: read ${taskId}'s artifact with read_source before settling it`;
    }
    if (against && parsed.probeDirection !== null && parsed.probeDirection !== AGAINST_CHECK[row.kind]) {
      return `settlesCases: ${taskId} is a ${row.kind} case, which a ${parsed.probeDirection} finding does not settle`;
    }
    if (state.dispositions.some((settled) => settled.taskId === taskId)) {
      return `settlesCases: ${taskId} is already settled by an earlier finding`;
    }
  }
  return null;
};

/** Every rule `record_finding` applies, in the order it applies them. Holding them as a list is
 *  what keeps `execute` under the complexity ceiling, which inline tests had left no room under.
 *  Order is behaviour: the first rule with a reason is the reason the reviewer sees and retries
 *  against, so a rule moves up or down this list only deliberately. */
const FINDING_RULES: readonly FindingRule[] = [
  ({ state }) =>
    state.findings.length >= MAX_FINDINGS ? `a review records at most ${MAX_FINDINGS} findings` : null,
  ({ parsed }) => (parsed.defect !== null && parsed.claim !== "" ? null : DEFECT_AND_CLAIM_REQUIRED),
  ({ parsed }) => (parsed.severity === null ? SEVERITY_REQUIRED : null),
  ({ parsed, taskIds }) =>
    taskIds.some((taskId) => mentionsTask(parsed.claim, taskId))
      ? "a claim may not name an individual task; write about the family"
      : null,
  ({ parsed, owner }) => (parsed.defect === true && owner === null ? DEFECT_OWNER_REQUIRED : null),
  // An empty list cites nothing, the same as leaving the field out, rather than failing to bind.
  ({ args, citations }) =>
    args.citations !== undefined &&
    !(Array.isArray(args.citations) && args.citations.length === 0) &&
    citations === null
      ? CITATIONS_UNBOUND
      : null,
  blockingEvidence,
  disputeEligibility,
  ({ parsed, owner, state, args }) =>
    probeCitationRefusal({ defect: parsed.defect, owner }, state.probes, args.probeIds),
  ({ parsed }) =>
    parsed.unobserved && parsed.checkId !== null
      ? "an unobserved obligation has no check; name its artifactSchemaPath instead of the nearest checkId"
      : null,
  ({ parsed, identities }) =>
    parsed.checkId !== null && !identities.checkIds.includes(parsed.checkId)
      ? `checkId ${parsed.checkId} is not a declared truthChecks id`
      : null,
  schemaPath,
  publicInput,
  knownDemandGap,
  caseSettlement,
];

/** The first rule that has a reason, or the severity the reviewer chose. */
function findingVerdict(subject: FindingCase): FindingVerdict {
  for (const rule of FINDING_RULES) {
    const why = rule(subject);
    if (why !== null) return { why };
  }
  // Rules above already refused a missing defect or severity and an unowned defect; these repeats
  // carry that into the type rather than deciding anything. Each pair reads one constant so the two
  // cannot drift apart.
  const { defect, severity } = subject.parsed;
  const { owner } = subject;
  if (defect === null) return { why: DEFECT_AND_CLAIM_REQUIRED };
  if (severity === null) return { why: SEVERITY_REQUIRED };
  if (owner !== null) return { severity, placement: { owner, defect } };
  return defect ? { why: DEFECT_OWNER_REQUIRED } : { severity, placement: { owner, defect } };
}

/** The finding as the campaign record keeps it. The demonstration, the citations and the probe
 *  numbers stay inside the one protected `claim` string that already carries the reviewer's prose,
 *  rather than becoming three more fields every projection would have to remember to withhold.
 *  What each cited probe executed is the exception and gets its own field: it is the one part the
 *  author may read, and the projection had no other way to reach it. */
function recordedFinding(
  subject: FindingCase,
  placement: FindingPlacement,
  admitted: FindingSeverity,
  probes: readonly ReviewProbeRow[],
  evidencePath: string,
): AnalysisFinding {
  const { parsed, citations } = subject;
  return {
    ...placement,
    claim:
      (parsed.demonstration === null
        ? parsed.claim
        : `${parsed.claim}\n\nDemonstration: ${parsed.demonstration}`) +
      (citations === null ? "" : `\n\nSource citations:\n${citations}`) +
      (probes.length === 0 ? "" : `\n\nExecuted probes: ${probes.map((row) => row.id).join(", ")}`),
    evidence: evidencePath,
    ...keysIf(admitted === "advisory", () => ({ severity: "advisory" as const })),
    ...keyIfNotNull("checkId", parsed.checkId),
    ...keyIfNotNull("artifactSchemaPath", parsed.artifactSchemaPath),
    ...keyIfNotNull("publicInputPath", parsed.publicInputPath),
    ...keyIfNotNull("secondPublicInputPath", parsed.secondPublicInputPath),
    ...keyIfNotNull("demandGap", parsed.demandGap),
    ...keysIf(parsed.unobserved, () => ({ unobserved: true as const })),
    ...keysIf(probes.length > 0, () => ({
      probes: probes.map(({ controlId, path, movedCheckIds }) => ({ controlId, path, movedCheckIds })),
      ...keyIfNotNull(
        "probeDirection",
        probes.some((row) => probeShows(row, parsed.checkId) === parsed.probeDirection)
          ? parsed.probeDirection
          : null,
      ),
    })),
  };
}

/** The schema the reviewer reads; the rules above are what the host applies to what it returns. */
function findingParameters(disputable: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["defect", "claim", "severity"],
    properties: {
      defect: {
        type: "boolean",
        description:
          "True for a demonstrated defect in the bundle file named as owner; false for an observation, which asks for no repair.",
      },
      claim: { type: "string", minLength: 1 },
      owner: {
        type: "string",
        enum: [...BUNDLE_FILES],
        description:
          "The bundle file the finding is about. Required for a defect: the file at fault, not a limit on the repair. The Builder may make a broader repair; the controller determines evaluation-only or build attribution from the candidate bytes. A correctness-model/tasks.json defect starts battery re-authoring with the harness fixed. Leave it out of an observation no file holds.",
      },
      severity: {
        type: "string",
        enum: ["advisory", "blocking"],
        description:
          "Choose blocking for a demonstrated violation of the request or a declared requirement with a repairable owner, supported by demonstration and citations; advisory for uncertainty, scope observations or hardness. A partial repair does not close a remaining required-property gap. The host returns the admitted severity after applying its evidence rules; neither how often a check was named before nor the order you record findings in changes it.",
      },
      demonstration: {
        type: "string",
        description:
          "Required to record or escalate a defect as blocking, or to dispute an issue: the concrete input or artifact the opened source mishandles and the declared requirement it violates. Explain the strongest alternative interpretation and what observation would refute your claim. A source-derived case is not an executed result; say which it is. Without a concrete case, record advice without disputing an issue.",
      },
      citations: {
        type: "array",
        description:
          "Required for blocking or disputing. Quote deciding source from read_source; quote a published requirement too when the tree contains it. When the original request supplies the obligation, state it in demonstration. Quotes are checked against returned pages and stay private.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "quote"],
          properties: {
            path: {
              type: "string",
              description: "The inventoried path or verifier alias returned by read_source.",
            },
            quote: {
              type: "string",
              minLength: 1,
              description: "An exact quotation from one returned page, without a continuation notice.",
            },
          },
        },
      },
      disputesIssue: {
        type: "string",
        enum: [...disputable],
        description:
          "The 12-character id of a standing issue this finding argues belongs to the evaluation. Only a defect owned under correctness-model/ may dispute an issue; omit this field for an agent/ defect and for an observation.",
      },
      checkId: {
        type: "string",
        description: "The declared truthChecks id the finding is about, exactly as the brief spells it.",
      },
      artifactSchemaPath: {
        type: "string",
        description: "A dotted path under one declared artifactSchema root, e.g. `pins.gpio`.",
      },
      unobserved: {
        type: "boolean",
        description:
          "True when no declared check observes the obligation at all. Leave checkId empty then and name the artifactSchemaPath: the Builder repairs whatever check a finding names. When the obligation relates the artifact to a public input, name that publicInputPath too: the claim does not reach the Builder, so the two paths are all it reads of the gap.",
      },
      probeIds: {
        type: "array",
        items: { type: "number" },
        description:
          "The probe_check numbers whose executed result this finding rests on. Cite only probes that ran.",
      },
      probeDirection: PROBE_DIRECTION_PARAMETER,
      publicInputPath: {
        type: "string",
        description:
          "A `$.`-prefixed JSON path into the public task input the finding is about. The claim does not reach the author, so this path is part of what it reads of the finding.",
      },
      secondPublicInputPath: {
        type: "string",
        description:
          "A second `$.`-prefixed public input path, when the obligation relates two inputs — for instance a load and the limit it must be held to. It crosses to authoring beside the first.",
      },
      demandGap: {
        type: "string",
        enum: [...DEMAND_GAPS],
        description:
          "For a finding about what the tasks fail to demand, which shape it takes: capability-unexercised (the request names a capability no task exercises), sibling-values-only (sibling tasks differ only in published values), limit-cleared-widely (the first reasonable candidate clears a published limit widely), rule-outside-request (a rule no practitioner of the request would hold). It crosses to authoring; the claim does not.",
      },
      settlesCases: {
        type: "array",
        items: { type: "string" },
        description:
          "The task ids of the listed vetoes and disputed fails this finding settles, each decided by its checkId and read with read_source first; a case you name nowhere stays unsettled. A defect owned under correctness-model/ settles them against the check. An observation settles them in the check's favour, as the Judge's error, citing in probeIds the probe that wrote the Judge's reading into an accept control and moved that check; the Judge issue stops standing once every case it counts is settled. Private: the Builder reads only how many cases in which families.",
      },
    },
  };
}

/** The `record_finding` tool. Its own test drives it directly, like the diagnosis tool's: the
 *  refusals and the admitted severity are the contract worth proving, and driving them through a
 *  live review session would prove the transport instead and cost a model call to do it. */
export function recordFindingTool(
  offered: readonly AdviceIssue[],
  taskIds: readonly string[],
  evidencePath: string,
  state: ReviewState,
  priors: FindingPriors = {},
): ReaderTool {
  const identities = priors.identities ?? { schemaRoots: [], checkIds: [] };
  const byPrefix = new Map(offered.map((issue) => [issue.id.slice(0, 12), issue.id] as const));
  return {
    name: "record_finding",
    label: "Record a finding",
    description:
      "Record one finding supported by evidence about the measured harness. Record defect true with the bundle file at fault when opened source shows it violates the request or a declared requirement — correctness-model/tasks.json when the task set is what is wrong. Record defect false for an observation the next pass would act differently for knowing: tasks that are harder than the harness, or evidence you could not decide. Name no owner when no file holds it. Set disputesIssue when this finding argues that a standing issue comes from the evaluation rather than the harness, which suspends that issue for the next authoring pass. The claim stays in controller evidence; the next Builder receives typed findings with public identities and the relevant published requirements. Fill checkId, artifactSchemaPath and publicInputPath whenever you know them so the next authoring pass can locate the affected contract. Write the claim about the family or contract and never name a task.",
    parameters: readerParameters(findingParameters([...byPrefix.keys()])),
    execute: (_id: string, args: Record<string, JsonValue>) => {
      const parsed = findingArgs(args);
      const subject: FindingCase = {
        parsed,
        args,
        owner: BUNDLE_FILES.find((file) => file === parsed.owner) ?? null,
        citations: findingCitations(args, state),
        state,
        identities,
        taskIds,
        cases: priors.cases ?? [],
      };
      const verdict = findingVerdict(subject);
      if ("why" in verdict) {
        if (verdict.why === CITATIONS_UNBOUND) state.admission.citationRefusals += 1;
        state.refused += 1;
        return Promise.resolve(readerToolText(`refused: ${verdict.why}`));
      }
      const probes = probeBackedRows(state.probes, args.probeIds);
      for (const row of probes) row.cited = true;
      // Severity says how strong this finding's own evidence is, and `blockingEvidence` has already
      // held a blocking defect to its demonstration and citations, whichever file owns it. So
      // nothing else moves it: not how often its check was named before, not the findings recorded
      // before it, not its owner's directory and not a cited probe, which runs the declared checks
      // and so can bear on an agent file's defect only by coincidence. An observation is advice.
      const admitted = verdict.placement.defect ? verdict.severity : "advisory";
      state.findings.push(recordedFinding(subject, verdict.placement, admitted, probes, evidencePath));
      const disposition = subject.parsed.defect === true ? "against-check" : "check-stands";
      for (const row of subject.cases.filter((listed) => parsed.settlesCases.includes(listed.taskId))) {
        const { taskId, family, kind } = row;
        state.dispositions.push({
          taskId,
          family,
          kind,
          checkId: parsed.checkId ?? "",
          disposition,
          finding: state.findings.length - 1,
        });
      }
      if (admitted !== verdict.severity) {
        state.admission.severityAdjusted.push({
          owner: subject.owner,
          requested: verdict.severity,
          admitted,
        });
      }
      const issueId = byPrefix.get(parsed.disputes);
      if (issueId !== undefined && !state.disputes.some((row) => row.issueId === issueId)) {
        state.disputes.push({ issueId, reason: boundText(parsed.claim, 300).shown });
      }
      return Promise.resolve(
        readerToolText(
          `recorded ${verdict.placement.defect ? "defect" : "observation"} as ${admitted}${issueId === undefined ? "" : `, disputing issue ${parsed.disputes}`}`,
        ),
      );
    },
  };
}
