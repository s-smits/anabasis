/**
 * What an epoch review records, and what earlier reviews prove.
 *
 * A review is evidence before it is advice. It names the measured condition it read, the source it
 * was shown and the findings it recorded, and every later decision reads those bytes alone rather
 * than the reviewer's prose, so anything a finding cannot carry in a recorded field is lost at the
 * boundary.
 *
 * `record_finding` is the reviewer's only writing tool, which makes the second half of this file
 * the whole contract between a reading session and the campaign record. Each refusal there is a
 * rule: a claim must name public identities the measured brief declares, cite passages
 * `read_source` actually returned, and carry a demonstration before it may block.
 *
 * The two halves belong in one file because the host applies the rules only it can apply, and each
 * half needs the other to do it. Reuse asks whether this exact condition and procedure have
 * already been read to completion. Recurrence asks how many distinct conditions named one defect
 * before — the fact a reviewer seeing a single condition cannot observe, and the fact
 * `admitSeverity` decides on. `defectIdentity` is what joins the two, which is why it is not
 * exported: nothing outside this file may form a defect identity by some other rule.
 */
import { existsSync, readdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { AnalysisFinding } from "../analyse/iteration-analysis.ts";
import type { AdviceIssue } from "../author/rebuild-advice.ts";
import { readCompleted } from "../author/campaign-epoch.ts";
import {
  BUILDER_OWNED,
  ownerTier,
  ownerWritableFiles,
  routableOwner,
  routableOwnerOf,
} from "../author/feedback-routing.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { mentionsTask } from "../meta/identifier-scan.ts";
import { plainRecord } from "../meta/json-evidence.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { type JsonValue, isString } from "../meta/json-shape.ts";
import { keyIfNotNull, keysIf } from "../meta/optional-key.ts";
import { type ReaderTool, readerParameters, readerToolText } from "./review-reader.ts";
import {
  type ProbeState,
  type ReviewProbeRow,
  probeBackedRows,
  probeCitationRefusal,
} from "./review-probe.ts";
import { type ReviewVerifierEvidence, type SourceReadState, deliveredSource } from "./review-sources.ts";
import { BRIEF_FILE } from "../meta/bundle-layout.ts";
import { readJsonFile } from "../meta/completed-json.ts";

export const EPOCH_REVIEW_SCHEMA = "epoch-review/v4";
/** Product identity; review procedure belongs to the review request. */
export type MeasuredCondition = {
  /** Null when the recorded fields cannot establish a measured condition. */
  digest: string | null;
  /** Null for a bundle with no task set; an incomplete condition cannot establish recurrence. */
  taskSetHash: string | null;
  agentHash: string;
  correctnessModelHash: string;
  builtPin: string;
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
  /** Repository-relative artifacts of the contested cases whose pages the reviewer opened. This is
   *  private settlement evidence, so only counts and families derived from it cross to authoring;
   *  the artifact bytes themselves are what the verifier decided on, and handing them back to the
   *  author is evaluator coaching. Empty when the review opened none or never ran. */
  contestedReads: string[];
  /** What the host returned against the inventory, in files and characters. These count the host
   *  side of the exchange alone: neither transport delivery nor the model actually reading a page
   *  is proved by them, so a complete coverage row establishes that the source was offered, not
   *  that the review saw it. */
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
  /** What the review executed, absent when it executed nothing. Private, like the reviewer's prose:
   *  a row names the checks that one changed field moved, and which check reacts to which field is
   *  exactly the verifier detail an author must not read. */
  probes?: ReviewProbeRow[];
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
const MAX_FINDINGS = 6;
const CLAIM_MAX_CHARS = 1_200;
export type ReviewState = SourceReadState & {
  probes: ProbeState;
  findings: AnalysisFinding[];
  disputes: Array<{ issueId: string; reason: string }>;
  admission: ReviewAdmission;
};
/** The public identities a finding may carry, read from the measured brief. A brief that is absent
 *  or unreadable declares nothing, so every identity is refused rather than guessed. */
type BriefIdentities = { schemaRoots: readonly string[]; checkIds: readonly string[] };

type FindingArgs = ReturnType<typeof findingArgs>;

/** Minimum demonstration length for a blocking finding. The review instructions had always asked
 *  the reviewer to demonstrate a violation before blocking on it, but nothing in the host checked
 *  that it had: in run truss-opus-20260907T210000000Z-6bf0e9 round 3 a blocking finding said in so
 *  many words that it could not construct a concrete passing layout and should be treated as
 *  advice, and it still decided the next move. A length floor turns that instruction into a field
 *  the host can see. It proves only that text was supplied, never that the argument in it holds;
 *  the citations rule and the one-reopen cap carry the rest, and an unsupported suspicion is
 *  supposed to stay advisory. */
const DEMONSTRATION_MIN_CHARS = 40;

const CITATIONS_UNBOUND =
  "citations must quote 1–4 passages actually returned by read_source; read the source and retry";
const SEVERITY_REQUIRED = "severity must explicitly be advisory or blocking";

/** Everything one `record_finding` call offers, as the rules below read it. The raw `args` stay
 *  beside the parsed values because two rules ask whether a field was supplied at all, which a
 *  parsed value can no longer answer once an absent field and an empty one have both become null.
 *  `citations` is null in two different situations — none was supplied, and none quoted a page
 *  `read_source` returned — and the rule that inspects `args.citations` is what tells them apart,
 *  so that a reviewer who cited nothing and a reviewer who cited a hallucinated page get different
 *  refusals. */
interface FindingCase {
  parsed: FindingArgs;
  args: Record<string, JsonValue>;
  owner: ReturnType<typeof routableOwnerOf>;
  citations: string | null;
  state: ReviewState;
  identities: BriefIdentities;
  taskIds: readonly string[];
}

type FindingRule = (subject: FindingCase) => string | null;

type FindingSeverity = "advisory" | "blocking";
type FindingVerdict = { why: string } | { severity: FindingSeverity };

/** The public identities a finding may name, and how often each defect identity recurred. */
type FindingPriors = {
  readonly identities?: BriefIdentities | undefined;
  readonly recurring?: ReadonlyMap<string, number> | undefined;
};

export function measuredConditionOf({
  agentHash,
  correctnessModelHash,
  taskSetHash,
  builtPin,
  verifierIdentity,
}: Omit<MeasuredCondition, "digest">): MeasuredCondition {
  const fields = { agentHash, correctnessModelHash, taskSetHash, builtPin, verifierIdentity };
  return {
    ...fields,
    digest: Object.values(fields).every((value) => isString(value) && value.trim() !== "")
      ? hashJsonValue(fields)
      : null,
  };
}

/** The completed reviews recorded for this campaign. An unreadable review proves nothing either
 *  way, so it is left out here and each caller decides without it: that means a corrupt file never
 *  suppresses a fresh review and never contributes a recurrence count. */
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

/** Whether a complete review already covered this condition, this reviewer and these obligations.
 *  Reuse has to match on all three, because the obligations are what the review had to settle
 *  beyond its source: a new contested artifact or a newly standing issue arriving under an
 *  unchanged product is new work, and skipping it would leave the one component that reads the
 *  measured tree against the original request silent about the part that changed. An unreadable
 *  earlier review proves nothing about coverage, so it does not count as one and the review runs
 *  again rather than being skipped over. */
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
        review.coverage?.complete === true &&
        review.condition?.digest === condition.digest &&
        review.reviewerPin === expected.reviewerPin &&
        review.reviewerEffort === expected.reviewerEffort &&
        review.requestDigest === expected.requestDigest &&
        review.obligationsDigest === expected.obligationsDigest,
    )
  );
}

/** The public identity of a defect: its declared check, or the place inside the artifact when the
 *  reviewer named no check. Null when it named neither, because two unnamed defects cannot be told
 *  apart and pretending otherwise merges them.
 *
 *  The declared check wins over the path because the artifact location of one defect may differ
 *  between two reviews of it. Run truss-opus-20260907T160200000Z-bdd329 showed the cost of the
 *  narrower rule: two consecutive reviews named check `change-budget`, the first at artifact path
 *  `members` and the second at no path at all, and an identity built from check-and-path read one
 *  check named twice as two separate defects that had each occurred once.
 *
 *  A bare declared root is one of the unnamed cases, which is why the path must contain a dot.
 *  `schemaPath` requires only that the first segment be a declared `artifactSchema` root, so a
 *  domain whose schema has a single root offers the reviewer one bare word with which to name any
 *  place in the artifact at all. Across the recorded corpus 5,406 findings named a bare root
 *  against 3,196 naming a path below one, and in every campaign where an unnamed-check harness
 *  defect fell back to a path the bare roots collapsed to a single constant. Run 17f9de is what
 *  that costs: 2,448 findings on the one root `files`, so a floating-point rule, a header contract
 *  and a pin binding all shared one identity, and a new I2C finding arrived already carrying two
 *  recurrences it had nothing to do with and was demoted by them. The same collapse forces the
 *  opposite error at a single recurrence, which is how a harness that had just passed 25 of 25 was
 *  reset. A word that names the whole artifact identifies no defect in it. */
function defectIdentity(finding: {
  checkId?: string | null;
  artifactSchemaPath?: string | null;
}): string | null {
  const path = finding.artifactSchemaPath ?? null;
  return finding.checkId ?? (path?.includes(".") === true ? path : null);
}

/** How many distinct earlier conditions, each fully reviewed, named each defect identity. A
 *  reviewer sees one condition and cannot observe that history; the host can, and `admitSeverity`
 *  is the consumer that needs it, which is why the count lives here rather than in the prompt.
 *  Rereviews of the current condition, duplicate findings within one review and replay files all
 *  add no vote, because the question is how many separate measured conditions named the defect.
 *
 *  Any kind that makes a positive claim counts as a naming, not only `harness-defect`: run
 *  truss-opus-20260907T160200000Z-bdd329 recorded check `change-budget` as a harness defect and
 *  then, in the next review, as hardness, and the second naming is still the same check being
 *  reported a second time. `diagnosis-uncertain` is the one kind excluded, because it is the
 *  reviewer saying it could not attribute what it saw. Counting it once let a
 *  `diagnosis-uncertain` on `determinate-stable-topology` in one round force a harness defect on
 *  the same check to blocking in the next, over a battery that had just passed 25 of 25 and on a
 *  claim that itself said no bypassing case could be constructed from the read bytes. An
 *  observation the reviewer could not attribute is not a first naming; the next positive claim
 *  about that check is. */
export function recurringDefects(analysisDir: string, current: MeasuredCondition): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  const currentKey = current.digest;
  if (currentKey === null) return new Map();
  for (const review of completedReviews(analysisDir)) {
    const priorKey = review.condition == null ? null : measuredConditionOf(review.condition).digest;
    if (review.coverage?.complete !== true || priorKey === null || priorKey === currentKey) continue;
    for (const finding of review.findings) {
      if (finding.kind === "diagnosis-uncertain") continue;
      const identity = defectIdentity(finding);
      if (identity === null) continue;
      const conditions = seen.get(identity) ?? new Set<string>();
      conditions.add(priorKey);
      seen.set(identity, conditions);
    }
  }
  return new Map([...seen].map(([identity, conditions]) => [identity, conditions.size]));
}

/** Admit the reviewer's chosen severity under the limits only the host can apply. Nothing here
 *  narrows the repair the Builder may then make: the continuation decides scope, and this function
 *  decides the admitted severity alone.
 *
 *  Only a harness defect is limited at all, and one review may reopen at most one authoring area,
 *  because a second blocking defect in a single reading is a reason to inspect the review rather
 *  than to reopen twice. An agent-tier defect on first occurrence stays advisory because a
 *  reviewer reading source can only suspect, and a suspicion once discarded an entire working
 *  product: in truss-opus-20260907T160200000Z-bdd329 round 4 a first tools-spec finding reset a
 *  harness that had just passed 25 of 25. A first finding still reaches authoring, as advice
 *  carrying its recorded owner.
 *
 *  The escalation is therefore once per defect identity and not more. Opus run 23a1bc named
 *  `target-compiles` in three consecutive reviews; both later findings were forced blocking and
 *  each rebuilt a 25-of-25 harness, while the defect persisted because the public projection
 *  supplied only its check name. Repeating the same forced repair had not resolved it, so after
 *  two prior occurrences the finding is kept as advice: it keeps its owner and stays an issue the
 *  next experiment may act on, which bounds the host's escalation without declaring the defect
 *  fixed.
 *
 *  A probe-backed defect is exempt from the first-occurrence agent-tier floor, because a finding
 *  citing a probe is not a suspicion. The candidate's own declared checks ran over its own accept
 *  control and over one changed field, and the row records what they decided. The reviewer still
 *  owes the demonstration, the citations and the one-reopen cap; what it no longer owes is a second
 *  measured condition proving that an executed result was real. */
function admitSeverity(
  kind: string,
  proposedOwner: ReturnType<typeof routableOwnerOf>,
  chosen: FindingSeverity,
  host: { blockingAlready: boolean; recurrences: number; demonstrated: boolean; probeBacked: boolean },
): FindingSeverity {
  if (kind !== "harness-defect") return chosen;
  if (host.blockingAlready) return "advisory";
  if (!host.demonstrated) return "advisory";
  if (host.recurrences >= 2) return "advisory";
  if (host.recurrences === 1) return "blocking";
  if (host.probeBacked) return chosen;
  return proposedOwner !== null && ownerTier(proposedOwner) === "agent" ? "advisory" : chosen;
}

const FINDING_KINDS = [
  "harness-defect",
  "curriculum-defect",
  "controller-defect",
  "hardness",
  "diagnosis-uncertain",
] as const;

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
  const record = plainRecord(args);
  const read = (key: string) => (record !== null && isString(record[key]) ? record[key] : "");
  const optional = (key: string) => {
    const value = read(key).trim();
    return value === "" ? null : value;
  };
  const chosen = read("severity");
  const severity: FindingSeverity | null = chosen === "advisory" || chosen === "blocking" ? chosen : null;
  return {
    kind: read("kind"),
    claim: read("claim").trim(),
    owner: optional("owner"),
    severity,
    demonstration: optional("demonstration"),
    disputes: read("disputesIssue"),
    checkId: optional("checkId"),
    artifactSchemaPath: optional("artifactSchemaPath"),
    publicInputPath: optional("publicInputPath"),
    unobserved: record?.unobserved === true,
  };
}

/** Source quotations establish what was available, not whether the model's inference is right. */
function findingCitations(args: Record<string, JsonValue>, state: SourceReadState): string | null {
  const { citations } = args;
  if (!Array.isArray(citations) || citations.length === 0 || citations.length > 4) return null;
  const bound = citations.map((value) => boundQuote(value, state));
  return bound.every((row) => row !== null) ? bound.join("\n") : null;
}

/** One citation as `path: "quote"`, or null when it quotes no page `read_source` returned. */
function boundQuote(value: JsonValue, state: SourceReadState): string | null {
  const row = plainRecord(value);
  if (!isString(row?.path) || !isString(row.quote)) return null;
  const { path, quote } = row;
  if (quote.trim() === "" || quote.length > 800) return null;
  const returned =
    deliveredSource(state, path).record?.pages.some((page) => page.text.includes(quote)) === true;
  return returned ? `${path}: ${capturedJsonStringify(quote)}` : null;
}

function demonstrated(demonstration: string | null): boolean {
  return demonstration !== null && demonstration.length >= DEMONSTRATION_MIN_CHARS;
}

/** Reopening an owner and suspending a standing issue require the same source-bound case. */
const blockingEvidence: FindingRule = ({ parsed, citations }) => {
  const claimed =
    (parsed.kind === "harness-defect" && parsed.severity === "blocking") || parsed.disputes !== "";
  if (!claimed) return null;
  if (!demonstrated(parsed.demonstration)) {
    return "blocking or disputing requires a concrete case in `demonstration`; otherwise record advisory without disputesIssue";
  }
  return citations === null
    ? "blocking or disputing requires citations from read_source; otherwise record advisory without disputesIssue"
    : null;
};

/** Only the evaluation side may argue that a standing issue belongs to the evaluation. */
const disputeEligibility: FindingRule = ({ parsed, owner }) => {
  if (parsed.disputes === "") return null;
  const evaluationSide =
    parsed.kind === "curriculum-defect" ||
    (parsed.kind === "harness-defect" && owner !== null && ownerTier(owner) === "rebuild");
  return evaluationSide
    ? null
    : "this finding cannot dispute an issue: only curriculum or evaluation-side defects may suspend diagnosis; omit disputesIssue and retry";
};

/** What a curriculum defect owes: the public input path the fresh battery should move. The claim
 *  itself never crosses to authoring, so a curriculum defect that names no identity projects as
 *  "the epoch review reported curriculum-defect in the public contract; inspect that contract for
 *  a mismatch", which names nothing the task author can act on. Run
 *  truss-opus-20260907T210000000Z-6bf0e9 recorded three curriculum defects across its three
 *  rounds, each of them saying that one parameterised template solves the whole task set, and the
 *  author received that same empty sentence all three times while the batteries stayed at 24/24,
 *  24/24 and 25/25. A public input path is a public authoring identity, so unlike the claim it
 *  crosses whole. */
const curriculumInput: FindingRule = ({ parsed }) =>
  parsed.kind === "curriculum-defect" && parsed.publicInputPath === null
    ? "a curriculum-defect must name, in `publicInputPath`, the public task input the fresh battery should vary; without it the finding reaches the task author as an empty sentence"
    : null;

const schemaPath: FindingRule = ({ parsed, identities }) => {
  if (parsed.artifactSchemaPath === null) return null;
  const segments = parsed.artifactSchemaPath.split(".");
  if (segments.includes("")) return "artifactSchemaPath must be a dotted path without empty segments";
  const root = segments[0] ?? "";
  return identities.schemaRoots.includes(root)
    ? null
    : `artifactSchemaPath root ${root} is not a declared artifactSchema root`;
};

const publicInput: FindingRule = ({ parsed, taskIds }) => {
  if (parsed.publicInputPath === null) return null;
  if (!parsed.publicInputPath.startsWith("$.")) return "publicInputPath must start with $.";
  const path = parsed.publicInputPath;
  return taskIds.some((taskId) => mentionsTask(path, taskId))
    ? "publicInputPath may not name an individual task"
    : null;
};

/**
 * Every rule `record_finding` applies, in the order it applies them. This list is the whole
 * contract between a reading session and the campaign record, and it replaced four predicates and
 * eight inline tests inside `execute`, which had measured 21 against the ceiling of 22 and so had
 * no room left for the next rule anyone wanted to add. Order is behaviour, because the first rule
 * with a reason is the reason the reviewer sees and retries against, so a rule moves up or down
 * this list only deliberately.
 */
const FINDING_RULES: readonly FindingRule[] = [
  ({ state }) =>
    state.findings.length >= MAX_FINDINGS ? `a review records at most ${MAX_FINDINGS} findings` : null,
  ({ parsed }) =>
    FINDING_KINDS.some((known) => known === parsed.kind) && parsed.claim !== ""
      ? null
      : "kind and claim are required",
  ({ parsed }) =>
    parsed.claim.length > CLAIM_MAX_CHARS
      ? `claim must be at most ${CLAIM_MAX_CHARS} characters; shorten it and retry`
      : null,
  ({ parsed }) => (parsed.severity === null ? SEVERITY_REQUIRED : null),
  ({ parsed, taskIds }) =>
    taskIds.some((taskId) => mentionsTask(parsed.claim, taskId))
      ? "a claim may not name an individual task; write about the family"
      : null,
  ({ parsed, owner }) =>
    parsed.kind === "harness-defect" && owner === null ? "a harness-defect must name a routable owner" : null,
  ({ args, citations }) => (args.citations !== undefined && citations === null ? CITATIONS_UNBOUND : null),
  blockingEvidence,
  disputeEligibility,
  ({ parsed, state, args }) => probeCitationRefusal(parsed.kind, state.probes, args.probeIds),
  curriculumInput,
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
];

/** The first rule that has a reason, or the severity the reviewer chose. */
function findingVerdict(subject: FindingCase): FindingVerdict {
  for (const rule of FINDING_RULES) {
    const why = rule(subject);
    if (why !== null) return { why };
  }
  // A rule above already refused a missing severity, so this repeat exists to carry that fact into
  // the type rather than to decide anything. Both spellings read the same constant, which is how
  // they are kept from drifting apart if the refusal text is ever reworded.
  return subject.parsed.severity === null
    ? { why: SEVERITY_REQUIRED }
    : { severity: subject.parsed.severity };
}

/** The finding as the campaign record keeps it. The demonstration, the citations and the probe
 *  numbers all stay inside the one protected `claim` string that already carries the reviewer's
 *  prose, rather than becoming three more fields that every reader of a finding would have to
 *  learn and every projection would have to remember to withhold. What each cited probe executed
 *  is the exception and gets its own field, because it is the one part of that prose the author is
 *  allowed to read and the projection had no other way to reach it. */
function recordedFinding(
  subject: FindingCase,
  admitted: FindingSeverity,
  probes: readonly ReviewProbeRow[],
  evidencePath: string,
): AnalysisFinding {
  const { parsed, citations, owner } = subject;
  return {
    kind: /* SAFETY: the second rule proved `kind` is one of FINDING_KINDS, every member of which is an AnalysisFindingKind. */ parsed.kind as AnalysisFinding["kind"],
    claim:
      (parsed.demonstration === null
        ? parsed.claim
        : `${parsed.claim}\n\nDemonstration: ${parsed.demonstration}`) +
      (citations === null ? "" : `\n\nSource citations:\n${citations}`) +
      (probes.length === 0 ? "" : `\n\nExecuted probes: ${probes.map((row) => row.id).join(", ")}`),
    evidence: evidencePath,
    proposedOwner: owner,
    ...keysIf(admitted === "advisory", () => ({ severity: "advisory" as const })),
    ...keyIfNotNull("checkId", parsed.checkId),
    ...keyIfNotNull("artifactSchemaPath", parsed.artifactSchemaPath),
    ...keyIfNotNull("publicInputPath", parsed.publicInputPath),
    ...keysIf(parsed.unobserved, () => ({ unobserved: true as const })),
    ...keysIf(probes.length > 0, () => ({
      probes: probes.map(({ controlId, path, movedCheckIds }) => ({ controlId, path, movedCheckIds })),
    })),
  };
}

/** The schema the reviewer reads; the rules above are what the host applies to what it returns. */
function findingParameters(owners: readonly string[], surfaces: string, disputable: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "claim", "severity"],
    properties: {
      kind: { type: "string", enum: [...FINDING_KINDS] },
      claim: { type: "string", minLength: 1, maxLength: CLAIM_MAX_CHARS },
      owner: {
        type: "string",
        enum: [...owners],
        description: `Required for harness-defect: name the root contract at fault, not a limit on the repair. Direct ownership: ${surfaces}. The Builder may make a broader repair; the controller determines evaluation-only or build attribution from the candidate bytes. A tests finding starts battery re-authoring with the harness fixed.`,
      },
      severity: {
        type: "string",
        enum: ["advisory", "blocking"],
        description:
          "Choose blocking for a demonstrated violation of the request or a declared requirement with a repairable owner, supported by demonstration and citations; advisory for uncertainty, scope observations or hardness. A partial repair does not close a remaining required-property gap. Record the strongest defect first: the host may reopen at most one owner and returns the admitted severity after applying recurrence and owner constraints.",
      },
      demonstration: {
        type: "string",
        description:
          "Required to record or escalate a harness-defect as blocking, or to dispute an issue: the concrete input or artifact the opened source mishandles and the declared requirement it violates. Explain the strongest alternative interpretation and what observation would refute your claim. A source-derived case is not an executed result; say which it is. Without a concrete case, record advice without disputing an issue.",
      },
      citations: {
        type: "array",
        minItems: 1,
        maxItems: 4,
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
              maxLength: 800,
              description: "An exact quotation from one returned page, without a continuation notice.",
            },
          },
        },
      },
      disputesIssue: {
        type: "string",
        enum: [...disputable],
        description:
          "The 12-character id of a standing issue this finding argues belongs to the evaluation. Only curriculum-defect or harness-defect with an evaluation-side owner may dispute an issue; omit this field for solving-agent defects, hardness and uncertainty.",
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
          "The probe_check numbers whose executed result this finding rests on. Cite only probes that ran: a probe-backed harness-defect may be admitted blocking on its first occurrence.",
      },
      publicInputPath: {
        type: "string",
        description:
          "A `$.`-prefixed JSON path into the public task input the finding is about. Required for curriculum-defect: name the input the fresh battery should vary, because the claim itself does not reach the task author and this path is the whole of what it will read.",
      },
    },
  };
}

/** The `record_finding` tool. It is exported for its own test, like the diagnosis tool: the
 *  refusals and the one-blocking-defect cap are the contract worth proving, and driving them
 *  through a live review session would prove the transport instead and cost a model call to do it. */
export function recordFindingTool(
  offered: readonly AdviceIssue[],
  taskIds: readonly string[],
  evidencePath: string,
  state: ReviewState,
  priors: FindingPriors = {},
): ReaderTool {
  const identities = priors.identities ?? { schemaRoots: [], checkIds: [] };
  const recurring = priors.recurring ?? new Map<string, number>();
  const byPrefix = new Map(offered.map((issue) => [issue.id.slice(0, 12), issue.id] as const));
  const owners = [...BUILDER_OWNED].filter(routableOwner);
  // Each owner's writable files, so the reviewer can see what an owner actually covers before
  // choosing one. This exposes the file ownership that already exists rather than copying routing
  // policy into the tool description, and the private finding still stays out of feedback.
  const surfaces = owners
    .map((owner) => `${owner}: ${ownerWritableFiles(owner).join(", ") || "no direct file"}`)
    .join("; ");
  return {
    name: "record_finding",
    label: "Record a finding",
    description:
      "Record one finding supported by evidence about the measured harness. Use harness-defect with an owner when opened source shows a defect in a component the Builder owns; curriculum-defect when the task set is what is wrong; hardness when the tasks are simply harder than the harness. Set disputesIssue when this finding argues that a standing issue comes from the evaluation rather than the harness, which suspends that issue for the next authoring pass. The claim stays in controller evidence; the next Builder receives typed findings with public identities and the relevant published requirements. Fill checkId, artifactSchemaPath and publicInputPath whenever you know them so the next authoring pass can locate the affected contract. Write the claim about the family or contract and never name a task.",
    parameters: readerParameters(findingParameters(owners, surfaces, [...byPrefix.keys()])),
    execute: (_id: string, args: Record<string, JsonValue>) => {
      const parsed = findingArgs(args);
      const subject: FindingCase = {
        parsed,
        args,
        owner: routableOwnerOf(parsed.owner),
        citations: findingCitations(args, state),
        state,
        identities,
        taskIds,
      };
      const verdict = findingVerdict(subject);
      if ("why" in verdict) {
        if (verdict.why === CITATIONS_UNBOUND) state.admission.citationRefusals += 1;
        state.refused += 1;
        return Promise.resolve(readerToolText(`refused: ${verdict.why}`));
      }
      // One review may reopen at most one authoring area as blocking, so a finding recorded after
      // a blocking harness-defect is admitted advisory however strong its own case is. A second
      // blocking defect in one reading is a reason to inspect the review, not to reopen twice.
      const blockingAlready = state.findings.some(
        (row) => row.kind === "harness-defect" && row.severity === undefined,
      );
      const identity = defectIdentity(parsed);
      const recurrences =
        parsed.kind === "harness-defect" && identity !== null ? (recurring.get(identity) ?? 0) : 0;
      const probes = probeBackedRows(state.probes, args.probeIds);
      const admitted = admitSeverity(parsed.kind, subject.owner, verdict.severity, {
        blockingAlready,
        recurrences,
        demonstrated: demonstrated(parsed.demonstration) && subject.citations !== null,
        probeBacked: probes.length > 0,
      });
      state.findings.push(recordedFinding(subject, admitted, probes, evidencePath));
      if (admitted !== verdict.severity) {
        state.admission.severityAdjusted.push({
          owner: subject.owner,
          requested: verdict.severity,
          admitted,
        });
      }
      const issueId = byPrefix.get(parsed.disputes);
      if (issueId !== undefined && !state.disputes.some((row) => row.issueId === issueId)) {
        state.disputes.push({ issueId, reason: parsed.claim.slice(0, 300) });
      }
      return Promise.resolve(
        readerToolText(
          `recorded ${parsed.kind} as ${admitted}${issueId === undefined ? "" : `, disputing issue ${parsed.disputes}`}`,
        ),
      );
    },
  };
}
