import { keyIfDefined } from "../meta/optional-key.ts";
import { BUILDER_TOOLS } from "../builder/builder-tool-interface.ts";
import { asRecord, isBoolean, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";

/** The controller's tool list, the same on every backend. Any other reported tool name is a
 *  provider-side tool such as web search. It derives from `BUILDER_TOOLS`, the same catalogue the
 *  session's entry gate records as `catalogued`, so these counts stay in agreement with the tools a
 *  session actually had rather than with a second list of them. */
export const CUSTOM_TOOL_NAMES: ReadonlySet<string> = new Set<string>(BUILDER_TOOLS);

export interface BuilderCustomToolCall {
  /** Dispatch order across the session, independent of whether calls complete out of order. */
  sequence: number;
  turn: number;
  tool: string;
  /** A declared action when recognised, the sole action when implicit, or `unknown`. */
  action: string;
  /** Public identifiers only. Raw arguments, paths, queries, URLs, commands, contents and result
   *  text never enter this record. */
  target: {
    taskId?: string;
    taskIdDigest?: string;
    runId?: string;
    runIdDigest?: string;
    family?: string;
    familyDigest?: string;
    contextId?: string;
    feedbackGroup?: number;
    feedbackField?: string;
    callCount?: number;
    toolNames?: string[];
  };
  /** Milliseconds from session start. The recorder states it on every call, so a live row always
   *  has one; null remains for the outcome reader, which reads recorded sessions where a call's end
   *  arrived without its start. */
  startedAtMs: number | null;
  durationMs: number | null;
  /** Dispatch mechanics only. A returned tool result may itself report blocked or non-result. */
  dispatchOutcome: "returned" | "threw" | "in-flight";
  /** Controller-authored, detail-free meaning of the returned result. Absent on a call that threw
   *  or is still in flight, and on a result that carries no receipt, because the only source is the
   *  receipt: it is never inferred from the model-visible prose beside it, which the model wrote
   *  and could say anything. */
  semantic?: BuilderCustomToolSemantic;
}

export interface BuilderCustomToolSemantic {
  outcome:
    | "completed"
    | "incomplete"
    | "clear"
    | "findings"
    | "blocked"
    | "failed"
    | "non-result"
    | "accepted"
    | "refused"
    | "terminal-closed";
  stage?: string;
  reason?: string;
  resultDigest?: string;
  /** Host-authored verifier-workshop action identity, distinct from this session's call sequence. */
  workshopSequence?: number;
  subjectDigest?: string;
  candidateId?: string;
  /** The candidate's bytes and installed tool tree together (`conditionKey`), so a refusal cleared
   *  by a tool repair over unchanged bytes reads as a different condition, not as no edit. */
  conditionId?: string;
  /** The gate stages a correctness_check ran to a verdict, `census` standing for a gates stage
   *  that skipped the reference solve. */
  stagesRun?: string[];
  /** Each blocking code as `<stage>:<code>`, so a reader knows which stage must run again before
   *  the code's absence answers it. */
  stagedCodes?: string[];
  artifactDigest?: string;
  findings?: number;
  /** Turns the rehearsed solve took. */
  turns?: number;
  /** The rehearsal's aggregate verdict -- the one bit rule 4 lets a rehearsal return -- so a later
   *  census can read whether the Builder measured its own battery before submitting, and what it
   *  saw when it did. */
  truthVerdict?: string;
  repeated?: boolean;
  submitted?: boolean;
  /** The distinct blocking finding codes a correctness_check returned, sorted. A submit attempt
   *  records its codes on its own row; a preview recorded only their count, so which gate refused a
   *  tree, and how often, could not be read back from a session that repaired it before submit. */
  findingCodes?: string[];
  /** Finding-code delta of a correctness_check against the previous check or submit. */
  carried?: number;
  resolved?: number;
  introduced?: number;
}

type CustomTarget = BuilderCustomToolCall["target"];

/** Distinct codes kept per receipt. Codes are controller vocabulary, so a check returning more than
 *  this many distinct ones is already unreadable as a list. */
const MAX_FINDING_CODES = 64;

const CUSTOM_TOOL_ACTIONS = {
  bash: ["execute"],
  context: ["overview", "cited", "page"],
  edit: ["edit"],
  find: ["find"],
  grep: ["grep"],
  harness_inspect: ["readiness", "task", "coverage", "feedback"],
  harness_reset: ["reset"],
  harness_trial: ["run"],
  ls: ["list"],
  public_source: ["fetch"],
  read: ["read"],
  submit: ["submit"],
  correctness_check: ["run"],
  verifier_workshop: ["inspect", "read", "write", "run", "export"],
  write: ["write"],
} as const;

const SEMANTIC_OUTCOMES: readonly BuilderCustomToolSemantic["outcome"][] = [
  "completed",
  "incomplete",
  "clear",
  "findings",
  "blocked",
  "failed",
  "non-result",
  "accepted",
  "refused",
  "terminal-closed",
];

export function bareCustomToolName(name: string): string {
  return name.startsWith("mcp__harness__") ? name.slice("mcp__harness__".length) : name;
}

function boundedIdentity(value: JsonValue | undefined, field: "taskId" | "runId" | "family"): CustomTarget {
  if (!isString(value) || value.length === 0) return {};
  if (value.length <= 256) return { [field]: value };
  return { [`${field}Digest`]: hashJsonValue(value) };
}

function feedbackTarget(args: Record<string, JsonValue> | undefined): CustomTarget {
  const target: CustomTarget = {
    ...keyIfDefined(
      "feedbackGroup",
      isNumber(args?.group) && Number.isFinite(args.group) ? Math.trunc(args.group) : undefined,
    ),
  };
  if (args?.field === "code" || args?.field === "path" || args?.field === "detail") {
    target.feedbackField = args.field;
  }
  return target;
}

/** The deliberately narrow projection used by both direct host dispatch and the transport-event
 *  path. It names the intent without copying argument values, which may carry user context or
 *  checker source. */
export function customCallIntent(tool: string, args: Record<string, JsonValue> | undefined) {
  // The context tool names its intent by depth, and a call that states none asks the default.
  const actionArg = tool === "context" ? (args?.depth ?? "cited") : args?.action;
  // Own-property lookup only: a declared name, never one the prototype supplies.
  const allowed: readonly string[] =
    Object.entries(CUSTOM_TOOL_ACTIONS).find(([name]) => name === tool)?.[1] ?? [];
  const implicit = allowed.length === 1 ? allowed[0] : undefined;
  const action = isString(actionArg) && allowed.includes(actionArg) ? actionArg : (implicit ?? "unknown");
  const target: CustomTarget = {
    ...boundedIdentity(args?.taskId, "taskId"),
    ...boundedIdentity(args?.runId, "runId"),
    ...boundedIdentity(args?.family, "family"),
  };
  if (tool === "context" && isString(args?.id) && args.id.length <= 256) target.contextId = args.id;
  if (tool === "harness_inspect") Object.assign(target, feedbackTarget(args));
  return { action, target };
}

/** The declared outcome a value spells, or null when it spells none of them. Two readers ask: this
 *  file, to build a semantic from a live tool result, and the outcome reader in
 *  tools/outcome/builder-execution-current.ts, to check a recorded row against the same
 *  vocabulary. */
export function declaredSemanticOutcome(value: unknown): BuilderCustomToolSemantic["outcome"] | null {
  if (!isString(value)) return null;
  return SEMANTIC_OUTCOMES.find((known) => known === value) ?? null;
}

/** Copy only the declared controller receipt fields. The tool text beside them may contain user
 *  context, source code, verifier output or repair prose, and is deliberately never parsed here. */
export function semanticFromResult(result: unknown): BuilderCustomToolSemantic | undefined {
  const receipt = asRecord(asRecord(asRecord(result)?.details)?.receipt);
  if (receipt === null) return undefined;
  const outcome = declaredSemanticOutcome(receipt.outcome);
  if (outcome === null) return undefined;
  const semantic: BuilderCustomToolSemantic = { outcome };
  for (const key of [
    "stage",
    "reason",
    "resultDigest",
    "subjectDigest",
    "candidateId",
    "conditionId",
    "artifactDigest",
    "truthVerdict",
  ] as const) {
    const value = receipt[key];
    if (isString(value)) semantic[key] = value;
  }
  for (const key of ["findings", "turns", "carried", "resolved", "introduced"] as const) {
    const value = receipt[key];
    if (isNumber(value) && Number.isFinite(value)) semantic[key] = Math.max(0, Math.trunc(value));
  }
  const { workshopSequence } = receipt;
  if (isNumber(workshopSequence) && Number.isSafeInteger(workshopSequence) && workshopSequence > 0) {
    semantic.workshopSequence = workshopSequence;
  }
  for (const key of ["repeated", "submitted"] as const) {
    const value = receipt[key];
    if (isBoolean(value)) semantic[key] = value;
  }
  const codes = receipt.findingCodes;
  if (Array.isArray(codes) && codes.length > 0) {
    semantic.findingCodes = codes.filter(isString).slice(0, MAX_FINDING_CODES);
  }
  for (const key of ["stagesRun", "stagedCodes"] as const) {
    const value = receipt[key];
    if (Array.isArray(value)) semantic[key] = value.filter(isString).slice(0, MAX_FINDING_CODES);
  }
  return semantic;
}
