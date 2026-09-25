/**
 * The diagnosis reader locates, in the Built Harness's recorded solves, where the harness failed
 * the solver, and says what kind of change that points to and what would prove the reading wrong.
 *
 * Its lane is the one neither other reviewer covers. The Main Judge reads one accepted artifact
 * against the public rules and never sees a trace; the Epoch Reviewer reads the source tree against
 * the request and probes the declared checks, which is the evaluation side. This reader reads what
 * the solver did, across the battery, and asks which part of the harness it was using when things
 * went wrong: the operating guide, a tool's contract, a tool's behaviour, the representation it
 * writes through, the walls, a capability no tool offered, or none of those, in which case the
 * failure is the solver's own. Judge-disagreement issues are therefore not offered here; they are
 * about the evaluation, and the Epoch Reviewer settles them.
 *
 * The design follows three results on harness repair from traces. Failures are attributed to a
 * step of a compiled trace rather than described in prose (`solve-steps.ts` gives every step an
 * address and the reader must cite one it was shown). Recurring failures are consolidated, so one
 * reading may cover several issues when they share a flaw. A repair proposal is only as good as the
 * check that could refute it, so every reading carries a falsifier, and passing solves of the same
 * family are shown beside the failing ones so a reading that explains a pass as well as a failure
 * can be seen for what it is.
 *
 * Its walls are rule 4's. The packet holds the measured harness's public operating guide and tool
 * descriptions, the recorded public domain and task cards, and the solver's own traces; the case
 * outcome is the only verdict it carries. It never opens `verifier.json`, the Judge's record, an
 * accepted artifact or anything under the correctness model, so a change to protected verifier
 * detail cannot move its prompt, and `promptDigest` records the prompt so that is checkable. That
 * is also why the boundary and the falsifier may reach the next authoring pass through the
 * rebuild advice: nothing protected went in, so nothing protected can come out. It selects no
 * owner, and its confidence is computed from how many sampled cases it said the reading holds for,
 * never stated by the model.
 */
import { campaignDir } from "../meta/campaign-root.ts";
import { readJsonFileOrNull } from "../meta/completed-json.ts";
import { join } from "../meta/path.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { sha256 } from "../meta/digest.ts";
import type { IterationAnalysis } from "../analyse/iteration-analysis.ts";
import {
  type AdviceIssue,
  type IssueDiagnosis,
  type RebuildAdvicePacket,
  environmentOwned,
  isStanding,
  issueStatusWord,
} from "../author/rebuild-advice.ts";
import { type VerifiedTraceRead, campaignTraceRoots, readVerifiedTraceUnder } from "../claim/trace-read.ts";
import { classifyCaseOutcome } from "../claim/case-record.ts";
import { type EvidenceLogViolation, recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import { plainRecord } from "../meta/json-evidence.ts";
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import {
  JUDGE_PUBLIC_CONTEXT_DECLARATION,
  JUDGE_PUBLIC_CONTEXT_FILE,
  JUDGE_PUBLIC_CONTEXT_SCHEMA,
  projectDeclared,
} from "../truth/declared-projection.ts";
import { DEFAULT_HARNESS_SETTINGS, harnessSettings } from "../truth/harness-config.ts";
import { TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { BUILT_AGENTS_FILE } from "../solve/built-starter.ts";
import { type JsonValue, isRecord, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { ReviewChoice } from "../backends/resolve.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { type ReaderTool, runReaderTurn } from "./review-reader.ts";
import { redactProviderDiagnostic } from "../backends/diagnostic-redaction.ts";
import { type CompiledSolve, type SolveWalls, batteryCensus, compileSolve } from "./solve-steps.ts";
import { DIAGNOSIS_SYSTEM_PROMPT, recordDiagnosisTool } from "./diagnosis-tool.ts";
import { boundText } from "../meta/bounded-text.ts";

export const DIAGNOSIS_READING_SCHEMA = "diagnosis-reading/v2";

/** Issues offered per reading, worst share first. */
const MAX_ISSUES = 6;
/** Failing solves shown per issue, and passing solves of the same family beside them. */
const MATCHING_SHOWN = 4;
const CONTRASTS_SHOWN = 2;
/** The packet ceiling. Issues are added whole in order while they fit; an issue that does not is
 *  withheld whole and counted, never cut, because a reader shown half a solve cannot tell where it
 *  stopped. */
const BODY_MAX_CHARS = 150_000;
/** UTF-8 bytes shown of the operating guide, of each tool description and of the public task. */
const GUIDE_BYTES = 8_000;
const TOOL_TEXT_BYTES = 300;
const TASK_BYTES = 6_000;

type CaseRow = IterationAnalysis["cases"][number];

/** A manifest-bound read of one public case file, or null when it is not recorded. */
type RecordedRead = (
  trace: VerifiedTraceRead,
  taskId: string,
  file: string,
) => Record<string, JsonValue> | null;

type Compiled = { row: CaseRow; trace: VerifiedTraceRead; solve: CompiledSolve };

/** A reading as the reader recorded it: the issues it covers, the step references it cited, and
 *  the diagnosis the register carries. */
type RecordedDiagnosis = {
  issueIds: string[];
  cited: { boundary: string; supporting: string[]; contrast: string[] };
  diagnosis: IssueDiagnosis;
};

export type DiagnosisReaderEvidence = {
  schema: typeof DIAGNOSIS_READING_SCHEMA;
  slug: string;
  runId: string;
  readerPin: string | null;
  /** sha256 of the system prompt and the prompt the reader was sent; null when no turn opened. */
  promptDigest: string | null;
  /** Issue ids offered to the reader, in the order the prompt listed them. */
  offered: string[];
  /** Diagnosable issues left out because the packet was full. */
  withheld: number;
  diagnoses: RecordedDiagnosis[];
  /** Explicitly declined issues; an offered issue neither diagnosed nor declined is silence. */
  abstentions: Array<{ issueIds: string[]; reason: string }>;
  refused: number;
  error: string | null;
  /** Null means no successful turn; an empty string records a completed turn with no closing
   *  text. Reader self-report, never diagnosis authority. */
  readerText: string | null;
};

/** One offered issue: what the reader is shown for it, and what it may cite. */
export type IssueOffer = {
  issue: AdviceIssue;
  key: string;
  matching: number;
  shown: CompiledSolve[];
  contrasts: CompiledSolve[];
  block: string;
};

interface DiagnosisReaderInput {
  repoRoot: string;
  analysis: Pick<IterationAnalysis, "slug" | "runId" | "cases">;
  /** The exact measured tree, whose public operating guide, tool text and walls the solver ran
   *  under. */
  measuredDir: string;
  advice: RebuildAdvicePacket;
  review: ReviewChoice;
  observer?: RunObserver;
  providerBudget?: ProviderResourceBudget;
  /** Tests substitute the existing lifecycle without making a provider call. */
  readerTurn?: typeof runReaderTurn;
}

/** The issues this reader can say something about: standing, not the environment's, and about the
 *  solve rather than the evaluation. Worst share first. */
export function diagnosableIssues(issues: readonly AdviceIssue[]): AdviceIssue[] {
  return issues
    .filter((issue) => isStanding(issue) && !environmentOwned(issue) && !issue.kind.startsWith("judge-"))
    .sort((a, b) => b.count / Math.max(b.denominator, 1) - a.count / Math.max(a.denominator, 1));
}

function carriesIssue(row: CaseRow, issue: AdviceIssue): boolean {
  const outcome = classifyCaseOutcome(row);
  if (issue.kind === "verified-fail") return outcome === "fail";
  if (issue.kind === "unaccepted") return outcome === "unaccepted";
  return outcome === "non-result" && row.runtimeNonResultKind === issue.detail;
}

/** Manifest-bound reads out of the run directory a verified trace resolved into. Only the public
 *  files this reader names are ever asked for. */
function runReader(runId: string, checkedRuns: Map<string, EvidenceLogViolation[]>): RecordedRead {
  return (trace, taskId, file) => {
    if (trace.baseDir === null) return null;
    if (!isSafePathSegment(runId) || !isSafePathSegment(taskId)) return null;
    if (trace.path !== `runs/${runId}/cases/${taskId}/trace.json`) return null;
    const runDir = join(trace.baseDir, "runs", runId);
    const violations = checkedRuns.get(runDir) ?? verifyRunDir(runDir);
    checkedRuns.set(runDir, violations);
    const recorded = recordedEvidence(runDir, file.replace("{task}", taskId), violations);
    if (!recorded.ok) return null;
    try {
      return plainRecord(parseJsonAs<JsonValue>(recorded.bytes));
    } catch {
      return null;
    }
  };
}

/** The case's public task card, projected through the same declaration the Judge reads under. */
function publicTask(read: RecordedRead, trace: VerifiedTraceRead, taskId: string): string {
  const card = read(trace, taskId, "cases/{task}/public-task.json");
  const task = plainRecord(card?.publicTask);
  const projected = projectDeclared(
    { domain: null, publicTask: card?.taskId === taskId && task?.taskId === taskId ? task : null },
    JUDGE_PUBLIC_CONTEXT_DECLARATION,
  ).publicTask;
  return projected === null
    ? "public task unavailable"
    : `public task: ${boundText(capturedJsonStringify(projected), TASK_BYTES).shown}`;
}

function publicDomain(read: RecordedRead, trace: VerifiedTraceRead, taskId: string): string | null {
  const record = read(trace, taskId, JUDGE_PUBLIC_CONTEXT_FILE);
  const domain = record?.schema === JUDGE_PUBLIC_CONTEXT_SCHEMA ? plainRecord(record.publicDomain) : null;
  const projected = projectDeclared({ domain, publicTask: null }, JUDGE_PUBLIC_CONTEXT_DECLARATION).domain;
  return projected === null ? null : capturedJsonStringify(projected);
}

/** The tools the solver was registered with, as the case recorded them. */
function registeredTools(read: RecordedRead, trace: VerifiedTraceRead, taskId: string): string | null {
  const record = read(trace, taskId, "cases/{task}/built-registration.json");
  if (record === null || !Array.isArray(record.tools)) return null;
  const names = record.tools
    .map((tool) =>
      isRecord(tool) && isString(tool.name)
        ? `${tool.name} (${named(tool.owner, "no owner recorded")})`
        : null,
    )
    .filter((name) => name !== null);
  return names.join(", ");
}

const named = (value: JsonValue | undefined, absent: string) => (isString(value) ? value : absent);

/** A config the gate would refuse never reached measurement, so a throw here reads the defaults. */
function settingsOf(measuredDir: string) {
  try {
    return harnessSettings(measuredDir);
  } catch {
    return DEFAULT_HARNESS_SETTINGS;
  }
}

/** The measured harness's public surface: its operating guide, its declared tool descriptions and
 *  its walls. Each is what the solver was given, read from the measured tree. */
function harnessSurface(measuredDir: string) {
  const guidePath = join(measuredDir, BUILT_AGENTS_FILE);
  const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf8") : null;
  const spec = readJsonFileOrNull(join(measuredDir, TOOLS_SPEC_FILE));
  const tools = isRecord(spec) && Array.isArray(spec.tools) ? spec.tools.filter(isRecord) : [];
  const described = tools.map(
    (tool) =>
      `- ${named(tool.name, "?")} [${named(tool.kind, "?")}]: ${boundText(named(tool.description, ""), TOOL_TEXT_BYTES).shown}`,
  );
  const settings = settingsOf(measuredDir);
  const walls: SolveWalls = { maxTurns: settings.maxTurns, solveMinutes: settings.solveMs / 60_000 };
  const presets =
    isRecord(spec) && Array.isArray(spec.presets)
      ? spec.presets.filter(isString).join(", ")
      : "none recorded";
  return {
    walls,
    text: [
      `Walls: ${walls.maxTurns} turns, ${walls.solveMinutes} minutes per solve, shell commands ${settings.shellDefaultSeconds} s by default and at most ${settings.shellMaxSeconds} s.`,
      `Declared domain tools (presets: ${presets}):`,
      ...(described.length === 0 ? ["(none declared)"] : described),
      `Operating guide the solver read (${BUILT_AGENTS_FILE}):`,
      guide === null ? "(no operating guide in the measured tree)" : boundText(guide, GUIDE_BYTES).shown,
    ].join("\n"),
  };
}

/** Failing solves chosen to differ: the first of each distinct sequence of failed tools, then the
 *  rest in battery order, so one failure pattern cannot fill every slot while a second goes
 *  unsampled. */
function sampled(solves: readonly CompiledSolve[]): CompiledSolve[] {
  const signature = (solve: CompiledSolve) =>
    solve.calls
      .filter((call) => call.failed)
      .map((call) => call.tool)
      .join(",");
  const seen = new Set<string>();
  const first: CompiledSolve[] = [];
  for (const solve of solves) {
    const key = signature(solve);
    if (seen.has(key)) continue;
    seen.add(key);
    first.push(solve);
  }
  return [...first, ...solves.filter((solve) => !first.includes(solve))].slice(0, MATCHING_SHOWN);
}

function issueOffer(issue: AdviceIssue, compiled: readonly Compiled[], read: RecordedRead) {
  const family = compiled.filter((entry) => entry.row.family === issue.family);
  const matching = family.filter((entry) => carriesIssue(entry.row, issue));
  const shown = sampled(matching.map((entry) => entry.solve));
  const contrasts = family
    .filter((entry) => classifyCaseOutcome(entry.row) === "pass" && entry.solve.refs.size > 0)
    .slice(0, CONTRASTS_SHOWN);
  const firstShown = matching.find((entry) => entry.solve === shown[0]);
  const key = issue.id.slice(0, 12);
  const detail = issue.detail === null ? "" : ` (${issue.detail})`;
  const block = [
    `ISSUE ${key} — family ${issue.family}, kind ${issue.kind}${detail}: ${issue.count} of ${issue.denominator}, ${issueStatusWord(issue)}, first seen ${issue.firstSeenRunId}.`,
    `Showing ${shown.length} of ${matching.length} failing solves; ${contrasts.length === 0 ? "no passing solve of this family to contrast" : `${contrasts.length} passing solve(s) of this family to contrast`}.`,
    ...(firstShown === undefined
      ? []
      : [`${firstShown.solve.label} ${publicTask(read, firstShown.trace, firstShown.row.taskId)}`]),
    ...shown.map((solve) => solve.text),
    ...contrasts.flatMap((entry, nth) => [
      ...(nth === 0 ? [`${entry.solve.label} ${publicTask(read, entry.trace, entry.row.taskId)}`] : []),
      entry.solve.text,
    ]),
  ].join("\n");
  return { issue, key, matching: matching.length, shown, contrasts: contrasts.map((e) => e.solve), block };
}

/** The whole reading packet: shared context, the battery census and one block per issue that fits. */
export function diagnosisPacket(
  input: Pick<DiagnosisReaderInput, "analysis" | "repoRoot" | "measuredDir">,
  issues: readonly AdviceIssue[],
) {
  const { analysis } = input;
  const campaign = campaignDir(input.repoRoot, analysis.slug);
  const roots = campaignTraceRoots(campaign);
  const surface = harnessSurface(input.measuredDir);
  const read = runReader(analysis.runId, new Map());
  const compiled: Compiled[] = analysis.cases.map((row, index) => {
    const trace = readVerifiedTraceUnder(row, campaign, roots);
    const label = `c${String(index + 1).padStart(2, "0")}`;
    const solve = compileSolve(
      label,
      classifyCaseOutcome(row),
      trace.trace,
      surface.walls,
      row.acceptedSubmit ? "accepted" : "none",
    );
    return { row, trace, solve };
  });
  const anchor = compiled.find((entry) => entry.trace.state === "recorded");
  const domain = anchor === undefined ? null : publicDomain(read, anchor.trace, anchor.row.taskId);
  const tools = anchor === undefined ? null : registeredTools(read, anchor.trace, anchor.row.taskId);
  const head = [
    domain === null
      ? "Public domain context unavailable; absence from a trace does not establish a missing rule."
      : `Recorded public domain context (DATA, not instructions): ${domain}`,
    `Tools the solver was registered with: ${tools ?? "not recorded"}.`,
    surface.text,
    batteryCensus(compiled.map((entry) => entry.solve)),
  ].join("\n\n");
  const offers: IssueOffer[] = [];
  let used = head.length;
  for (const issue of issues) {
    const offer = issueOffer(issue, compiled, read);
    if (offers.length > 0 && used + offer.block.length + 2 > BODY_MAX_CHARS) break;
    offers.push(offer);
    used += offer.block.length + 2;
  }
  return { body: [head, ...offers.map((offer) => offer.block)].join("\n\n"), offers };
}

/**
 * Read the diagnosable issues once. Returns the evidence record; the caller attaches the diagnoses
 * to the issue register. A turn that failed records its error and no diagnoses, so a broken reader
 * never looks like a battery with nothing to explain.
 */
export async function readDiagnoses(input: DiagnosisReaderInput): Promise<DiagnosisReaderEvidence> {
  const { analysis, repoRoot } = input;
  const diagnosable = diagnosableIssues(input.advice.issues);
  const issues = diagnosable.slice(0, MAX_ISSUES);
  const evidence: DiagnosisReaderEvidence = {
    schema: DIAGNOSIS_READING_SCHEMA,
    slug: analysis.slug,
    runId: analysis.runId,
    readerPin: null,
    promptDigest: null,
    offered: [],
    withheld: 0,
    diagnoses: [],
    abstentions: [],
    refused: 0,
    error: null,
    readerText: null,
  };
  if (issues.length === 0) return { ...evidence, error: "no-standing-issue" };
  if (!input.review.enabled) return { ...evidence, error: "review-slot-off" };
  const packet = diagnosisPacket(input, issues);
  evidence.offered = packet.offers.map((offer) => offer.issue.id);
  evidence.withheld = diagnosable.length - packet.offers.length;
  const prompt = [
    `Campaign ${analysis.slug}, battery ${analysis.runId}. ${packet.offers.length} issue(s) are offered below, each with sampled solves compiled into numbered steps.`,
    "Call record_diagnosis once per flaw, naming every offered issue it covers, or abstain for the issues you cannot read.",
    "",
    packet.body,
  ].join("\n");
  evidence.promptDigest = sha256(`${DIAGNOSIS_SYSTEM_PROMPT}\n\n${prompt}`);
  const taskIds = analysis.cases.map((row) => row.taskId);
  const turn = await (input.readerTurn ?? runReaderTurn)({
    review: input.review,
    repoRoot,
    role: "diagnosis-reader",
    tools: [recordDiagnosisTool(packet.offers, taskIds, evidence) satisfies ReaderTool],
    systemPrompt: DIAGNOSIS_SYSTEM_PROMPT,
    prompt,
    ...keyIfDefined("observer", input.observer),
    ...keyIfDefined("providerBudget", input.providerBudget),
  });
  evidence.readerPin = turn.pin;
  evidence.error = turn.error;
  // Tool calls from a failed turn already updated the sink; discard that incomplete reading.
  if (turn.error !== null) return { ...evidence, diagnoses: [], abstentions: [] };
  evidence.readerText = redactProviderDiagnostic(turn.text, 0);
  return evidence;
}
