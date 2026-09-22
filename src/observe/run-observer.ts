/**
 * Append-only controller observations of model-visible inputs and lifecycle events. This is
 * telemetry: no validator, evaluator, claim, promotion decision or Builder prompt reads it, so a
 * missing observation never changes a verdict.
 *
 * Rows form a tree. `parentId` identifies the enclosing row (run → case → turn → steering or
 * follow-up); null places the row directly under the run. Emit a parent first, then use
 * `child(id)` for its children. `kind` says whether a row is a span, a model call (generation) or
 * an instant (event), and the emitter derives `level` from each row's state.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import { sha256 } from "../meta/digest.ts";
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { stableJson } from "../meta/stable-json.ts";
import { keyIfNotNull } from "../meta/optional-key.ts";
import { isNumber } from "../meta/json-shape.ts";

const OBSERVATION_SCHEMA = "ana-observation/v2";
const OBSERVATION_ENVELOPE_KEYS = new Set([
  "schema",
  "id",
  "seq",
  "at",
  "runId",
  "parentId",
  "kind",
  "level",
  "type",
]);

/** The observed interfaces that have a producer. The operator projection validates `--contract`
 *  against this list. */
export const OBSERVED_INTERFACES = ["builder", "built", "judge-census"] as const;
export type ObservedInterface = (typeof OBSERVED_INTERFACES)[number];

/** What a reader may expect of a node: a span nests, a generation is a model call, an event is
 *  an instant. */
type ObservationKind = "span" | "generation" | "event";

/** The one severity axis across every row type, derived by the emitter from the row's state. */
export type ObservationLevel = "default" | "warning" | "error";

interface PromptEvent {
  contract: ObservedInterface;
  role: string;
  prompt: string;
  phase?: string;
  turn?: number;
  subjectId?: string;
  steeringTypes?: string[];
}

interface SteeringEvent {
  /** Where the statement comes from: code, recorded evidence, a model hypothesis or the
   *  operator. */
  authority: "deterministic" | "evidence-observation" | "model-hypothesis" | "operator" | "unknown";
  claim: string;
  owner?: string;
  evidence?: string[];
}

interface HookEvent {
  /** One hook kind: a controller follows an unsettled turn with fixed text. */
  hookType: "follow-up";
  state: "activated" | "suppressed" | "rejected" | "registered" | "unknown";
  label: string;
  reason?: string;
  triggerDigest?: string;
  renderedDigest?: string;
  evidence?: string[];
}

interface PhaseEvent {
  /** Only steps an emitter reaches. */
  phase:
    | "input"
    | "build"
    | "adopt"
    | "measure-on"
    | "controls"
    | "solve"
    | "grade"
    | "claim"
    | "judge"
    | "analyse"
    | "admission"
    | "next";
  /** `deferred` marks a held step: the solve pool delivers results in input order, so a finished
   *  case may wait for an earlier one before grading, and this tells that wait from a stall. */
  state: "started" | "completed" | "failed" | "deferred";
  summary: string;
  evidence?: string[];
  /** The case a per-subject phase span covers; absent on the run-wide steps. */
  subjectId?: string;
}

/** One settled authoring iteration, from its recorded evidence identities, so a live reader can
 *  see convergence. Telemetry only: iteration.json stays the evidence. */
interface IterationEvent {
  ordinal: number;
  outcome: string;
  /** The gate stage the iteration settled at, `null` when it reached none. */
  stage: string | null;
  focusOwner: string | null;
  findingsHash: string | null;
}

/** One completed model turn's tool tally, emitted at the turn boundary so failures have a time
 *  axis. Telemetry only: builder-execution.json stays the evidence. */
interface TurnToolsEvent {
  turn: number;
  toolCalls: number;
  failed: number;
  /** Failed calls by tool name; empty when the turn failed none. */
  failedByName: Record<string, number>;
}

/** Event fields appended after the shared row metadata; prompt events also carry their text's
 *  digest and length. The emitter refuses any field that would replace the metadata. */
type ObservationBody =
  | (PromptEvent & { promptDigest: string; chars: number })
  | SteeringEvent
  | HookEvent
  | PhaseEvent
  | IterationEvent
  | TurnToolsEvent;

export interface RunObserver {
  readonly runId: string;
  readonly path: string;
  /** Parent row for events emitted through this handle; null means the run itself. */
  readonly parentId: string | null;
  prompt(event: PromptEvent): string;
  steering(event: SteeringEvent): string;
  hook(event: HookEvent): string;
  phase(event: PhaseEvent): string;
  iteration(event: IterationEvent): string;
  turnTools(event: TurnToolsEvent): string;
  /** The same stream, writing under `parentId`. The id comes from the parent's own emit. */
  child(parentId: string): RunObserver;
}

interface ObservedFinding {
  claim: string;
  evidence: string;
  proposedOwner: string | null;
}

interface CampaignProgressOptionsResult {
  onPhase(phase: string, ok: boolean, attempts: number): void;
  onIteration(evidence: {
    ordinal: number;
    dir: string;
    outcome: string;
    stage: string | null;
    focusOwner: string | null;
  }): void;
}

function safeSegment(label: string, value: string): void {
  if (!isSafePathSegment(value)) {
    throw new Error(`${label} ${capturedJsonStringify(value)} is not a safe observation path segment`);
  }
}

function priorSequence(file: string): number {
  if (!existsSync(file)) return 0;
  let maximum = 0;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const value = parseJsonAs<{ seq?: unknown }>(line);
      if (isNumber(value.seq) && Number.isInteger(value.seq)) maximum = Math.max(maximum, value.seq);
    } catch {
      // A malformed row stays for the reader; it does not affect the sequence.
    }
  }
  return maximum;
}

/** A state that stopped something is an error; a state that refused one is a warning. `deferred`
 *  stays at the default level, because a case held behind an earlier one is normal. */
function levelOf(state: string): ObservationLevel {
  if (state === "failed") return "error";
  if (state === "rejected" || state === "suppressed") return "warning";
  return "default";
}

/** The one append path: envelope every event, refuse a body that would shadow the envelope, and
 *  share this closure through child handles. Callers must reuse the stream's owner while live;
 *  a newly opened owner resumes the last recorded sequence after the old one has stopped. */
function appendEmitter(file: string, runId: string) {
  let sequence = priorSequence(file);
  return (
    node: { type: string; kind: ObservationKind; level: ObservationLevel; parentId: string | null },
    event: ObservationBody,
  ): string => {
    for (const key of Object.keys(event)) {
      if (OBSERVATION_ENVELOPE_KEYS.has(key)) throw new Error(`observation event cannot replace ${key}`);
    }
    sequence += 1;
    const id = `${runId}:${sequence}`;
    appendFileSync(
      file,
      `${capturedJsonStringify({
        schema: OBSERVATION_SCHEMA,
        id,
        seq: sequence,
        at: new Date().toISOString(),
        runId,
        parentId: node.parentId,
        kind: node.kind,
        level: node.level,
        type: node.type,
        ...event,
      })}\n`,
    );
    return id;
  };
}

export function createRunObserver(repoRoot: string, slug: string, runId: string): RunObserver {
  safeSegment("slug", slug);
  safeSegment("runId", runId);
  const directory = join(campaignDir(repoRoot, slug), "observability");
  const file = join(directory, `${runId}.jsonl`);
  mkdirSync(directory, { recursive: true });
  const emit = appendEmitter(file, runId);
  const scoped = (parentId: string | null): RunObserver => ({
    runId,
    path: `campaigns/${slug}/observability/${runId}.jsonl`,
    parentId,
    prompt(event) {
      return emit(
        { type: "prompt-ingested", kind: "generation", level: "default", parentId },
        { ...event, promptDigest: sha256(event.prompt), chars: event.prompt.length },
      );
    },
    steering(event) {
      return emit({ type: "steering-ingested", kind: "event", level: "default", parentId }, event);
    },
    hook(event) {
      return emit(
        { type: `hook-${event.state}`, kind: "event", level: levelOf(event.state), parentId },
        event,
      );
    },
    phase(event) {
      return emit({ type: "phase-transition", kind: "span", level: levelOf(event.state), parentId }, event);
    },
    iteration(event) {
      const level: ObservationLevel =
        event.outcome === "build-failed"
          ? "error"
          : event.outcome === "gates-blocked"
            ? "warning"
            : "default";
      return emit({ type: "iteration-settled", kind: "event", level, parentId }, event);
    },
    turnTools(event) {
      return emit(
        {
          type: "turn-tools-tallied",
          kind: "event",
          level: event.failed > 0 ? "warning" : "default",
          parentId,
        },
        event,
      );
    },
    child(id) {
      return scoped(id);
    },
  });
  return scoped(null);
}

export function startFullRunObservation(
  repoRoot: string,
  slug: string,
  runId: string,
  prompt: string,
): RunObserver {
  const observer = createRunObserver(repoRoot, slug, runId);
  const input = observer.child(
    observer.phase({
      phase: "input",
      state: "completed",
      summary: "Direct user prompt and public context admitted",
    }),
  );
  const promptId = input.prompt({
    contract: "builder",
    role: "user-directive",
    prompt,
    phase: "input",
    turn: 0,
    steeringTypes: ["user-directive"],
  });
  input.child(promptId).steering({
    authority: "operator",
    owner: "builder",
    claim: prompt,
  });
  return observer;
}

export function observeNextMove(
  observer: RunObserver,
  decision: { move: string; reason: string },
  /** The climb reading a rebuild was sized from, when this move recorded one, so the stream shows
   *  the score behind the move. */
  difficulty?: { evidence: string; action: string; rationale: string } | null,
): void {
  observer.steering({
    authority: "deterministic",
    owner: "controller",
    claim: `${decision.move}: ${decision.reason}`,
  });
  if (difficulty === undefined || difficulty === null) return;
  observer.steering({
    authority: "evidence-observation",
    owner: "climb",
    claim: `${difficulty.action}: ${difficulty.rationale}`,
    evidence: [difficulty.evidence],
  });
}

export function observePromotion(observer: RunObserver, slug: string, runId: string, decision: string): void {
  observer.phase({
    phase: "next",
    state: "completed",
    summary: `Next step: ${decision}`,
    evidence: [`campaigns/${slug}/promotions/${runId}.json`],
  });
}

export function observeAnalysisResult(
  observer: RunObserver,
  slug: string,
  runId: string,
  result: {
    judges: { findings: ObservedFinding[]; exit: { kind: string } };
    admission: { admitted: ObservedFinding[]; feedback: unknown[] };
  },
): void {
  observer.phase({
    phase: "analyse",
    state: "completed",
    summary: `Analysis completed ${result.judges.findings.length} finding(s), Judge exit ${result.judges.exit.kind}`,
    evidence: [`campaigns/${slug}/analysis/${runId}-judges.json`],
  });
  const admission = observer.child(
    observer.phase({
      phase: "admission",
      state: "completed",
      summary: `Prepared ${result.admission.feedback.length} feedback item(s) for the next build; the run result decides whether to publish them`,
      evidence: [`campaigns/${slug}/analysis/${runId}-admission.json`],
    }),
  );
  const modelFindings = new Set(result.judges.findings.map(stableJson));
  for (const finding of result.admission.admitted) {
    const modelOwned = modelFindings.has(stableJson(finding));
    admission.steering({
      authority: modelOwned ? "model-hypothesis" : "evidence-observation",
      ...keyIfNotNull("owner", finding.proposedOwner),
      claim: finding.claim,
      evidence: [finding.evidence],
    });
  }
}

/** The one [fullrun] stderr emitter. Every line carries a UTC timestamp; the tag stays first so
 *  grep-based watches keep matching. Telemetry only: no verdict reads a log line. */
export function fullrunLine(message: string): void {
  console.error(`[fullrun] ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
}

export function campaignProgressOptions(slug: string): CampaignProgressOptionsResult {
  return {
    // The number is the session's author calls, not an attempt ordinal.
    onPhase: (phase, ok, attempts) =>
      fullrunLine(
        `${slug}: session ${phase} ${ok ? "ok" : "FAILED"} (${attempts} author call${attempts === 1 ? "" : "s"})`,
      ),
    onIteration: (evidence) =>
      fullrunLine(
        `${slug}: iteration ${evidence.ordinal} (${evidence.dir}) ${evidence.outcome}` +
          (evidence.stage === null ? "" : ` at ${evidence.stage}`) +
          (evidence.focusOwner === null ? "" : `, focus ${evidence.focusOwner}`),
      ),
  };
}
