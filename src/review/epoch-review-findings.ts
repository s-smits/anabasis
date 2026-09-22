/**
 * What an epoch review records, and what earlier reviews prove.
 *
 * A review records the measured condition it read, the source it was shown and its findings; later
 * decisions read those bytes alone. Earlier reviews answer two questions only the host can: has
 * this condition already been reviewed, and how many distinct conditions named a defect before.
 *
 * `record_finding` is the reviewer's only writing tool. Each of its refusals is a rule: a finding
 * names public identities the measured brief declares, cites passages `read_source` returned, and
 * carries a demonstration before it may block.
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
  /** Contested-case artifacts the reviewer opened. Private: only counts and families derived from
   *  them reach authoring. */
  contestedReads: string[];
  /** Files and characters the host returned against the inventory; they do not prove the model
   *  read them. */
  coverage: {
    files: number;
    opened: number;
    chars: number;
    complete?: boolean;
    truncated?: boolean;
    missing?: string[];
  };
  /** Absent on a review that stopped before reading its source. Private; never reaches authoring. */
  verifier?: ReviewVerifierEvidence;
  findings: AnalysisFinding[];
  /** Issue ids the review argued belong to the evaluation, with the argument. */
  disputes: Array<{ issueId: string; reason: string }>;
  /** Absent on a review that opened no session. */
  admission?: ReviewAdmission;
  /** The probes the review executed, absent when none ran. Private: a row names the checks a
   *  changed field moved, which is verifier detail. */
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

/** Minimum demonstration length for a blocking finding. It proves only that a concrete case was
 *  written down, not that the argument holds. */
const DEMONSTRATION_MIN_CHARS = 40;

const CITATIONS_UNBOUND =
  "citations must quote 1–4 passages actually returned by read_source; read the source and retry";
const SEVERITY_REQUIRED = "severity must explicitly be advisory or blocking";

/** One `record_finding` call as the rules read it. The raw `args` stay beside the parsed values
 *  because some rules ask whether a field was supplied at all. `citations` is null both when none
 *  was supplied and when one quoted no returned page. */
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

/** The completed reviews recorded for this campaign; an unreadable review is left out. */
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

/** Whether a complete review already covered this condition, reviewer and obligations. A new
 *  contested artifact or standing issue under the same condition is new work. */
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

/** The public identity of a defect: its declared check, else an artifact path below a schema
 *  root. The check wins because reviews of one defect may name different locations. A bare root
 *  names the whole artifact and so identifies nothing; with neither, the result is null. */
function defectIdentity(finding: {
  checkId?: string | null;
  artifactSchemaPath?: string | null;
}): string | null {
  const path = finding.artifactSchemaPath ?? null;
  return finding.checkId ?? (path?.includes(".") === true ? path : null);
}

/** How many distinct earlier conditions, each fully reviewed, named each defect identity. Any
 *  positive finding kind counts as a naming; `diagnosis-uncertain` does not, because it says the
 *  reviewer could not attribute what it saw. Reviews of the current condition add no count. */
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

/** The severity the host admits for a finding. Only a harness defect is limited:
 *  - one review reopens at most one owner, and blocking needs a cited demonstration;
 *  - a defect with one prior occurrence escalates to blocking, and one with two or more stays
 *    advisory, since repeating the same forced repair did not resolve it;
 *  - a first occurrence owned by the agent tier stays advisory, because source reading alone can
 *    only suspect, unless an executed probe backs it. */
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

/** `record_finding`'s untyped arguments as named values. */
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

/** A curriculum defect must name the public input the fresh battery should vary: the claim never
 *  reaches authoring, so that path is all the task author reads. */
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
 * Every rule `record_finding` applies, in order. Order is behaviour: the first rule with a reason
 * is the refusal the reviewer sees.
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
  // A rule above already refused a missing severity; this repeat narrows the type.
  return subject.parsed.severity === null
    ? { why: SEVERITY_REQUIRED }
    : { severity: subject.parsed.severity };
}

/** The finding as the campaign record keeps it. Demonstration, citations and probe numbers join
 *  the protected `claim` text; what each cited probe executed is a separate field because the
 *  author may read it. */
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

/** The `record_finding` tool; exported so its refusals can be tested without a review session. */
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
  // Each owner's writable files, so the reviewer sees what an owner covers before choosing it.
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
      // One review may reopen at most one authoring area as blocking.
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
