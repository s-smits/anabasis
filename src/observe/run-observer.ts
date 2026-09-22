/**
 * Append-only controller observations of model-visible inputs and lifecycle events. This is
 * telemetry: validators, evaluators, claims, promotion decisions and Builder prompts do not
 * read this file. Missing observations reduce visibility into the run but do not supply or
 * change a verdict.
 *
 * A `response` row existed for the prose review callers whose answer survived only as a parse;
 * those callers were removed on 2026-09-04 and the row went with them. A judge census verdict
 * never had one: `judge/controls/NNNN.json` already records its verdict, rationale and error per
 * subject, and a second copy here would be a second owner of one fact.
 *
 * Rows form a tree. `parentId` identifies the enclosing row: run → case → turn → steering or
 * follow-up. Null places the row directly under the run named by `runId`. Emit a parent first,
 * then use `child(id)` to write its children. `kind` describes the node: a span contains work,
 * a generation represents a model call, and an event records an instant. Consumers can use
 * those categories without enumerating every event type. The emitter also derives severity
 * in `level` from each row's state, giving readers one consistent classification rather than
 * requiring each view to interpret several state vocabularies.
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

/** Only interfaces with a producer today: Builder sessions, the Built solver, and the Judge census
 *  session. A value nothing emits is vocabulary the reader must handle and never sees.
 *
 *  The runtime list is the one owner: the operator projection validates `--contract` against it
 *  rather than repeating the members. */
export const OBSERVED_INTERFACES = ["builder", "built", "judge-census"] as const;
export type ObservedInterface = (typeof OBSERVED_INTERFACES)[number];

/** What a reader may expect of a node: a span nests, a generation is a model call, an event is
 *  an instant. */
type ObservationKind = "span" | "generation" | "event";

/** The one severity axis across every row type. Derived by the emitter, so it cannot disagree
 *  with the state it summarises. */
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
   *  operator. Readers cannot infer that authority from descriptive fields. The old category
   *  field repeated information available from type, phase, contract, hook and owner. */
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
  /** Only steps an emitter reaches. `gates`, `measure-off` and `critic` sat here without a
   *  producer: the gate's decision is the authoring iteration's own `stage`, measurement has run
   *  a single battery since the adviser condition went, and the critic's move is `next`. A name
   *  no row carries reads to a census as a step that never ran. */
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
  /** `deferred` is a step this run holds rather than runs: it already read as a warning in
   *  `levelOf` with no producer at all. The solve pool delivers its results in input order, so a
   *  case that finishes while an earlier one is still solving waits before it is graded, and from
   *  outside that wait was indistinguishable from a stalled verifier — run truss `…4c67fc` closed
   *  its last case span at `Case canopy-skewed-heads submitted` and said nothing further. */
  state: "started" | "completed" | "failed" | "deferred";
  summary: string;
  evidence?: string[];
  /** The case a per-subject phase span covers; absent on the run-wide steps. */
  subjectId?: string;
}

/** One settled authoring iteration, from its already-recorded evidence identities. Run w11 wrote
 *  nine observation rows in 5h35m and was silent for its final 3h10m while 36 iterations settled
 *  `gates-blocked` on one focus owner; a live reader could not see the convergence failure
 *  without opening every iteration.json. Telemetry only: iteration.json stays the evidence. */
interface IterationEvent {
  ordinal: number;
  outcome: string;
  /** The gate stage the iteration settled at, `null` when it reached none. The stderr line has
   *  always named it; without it here a reader sees that 36 iterations were blocked and not
   *  whether they were blocked at one stage or at 36 different ones. */
  stage: string | null;
  focusOwner: string | null;
  findingsHash: string | null;
}

/** One completed model turn's tool tally, emitted at the turn boundary. The per-session
 *  aggregate has no time axis: run 48's evidence could not say when its 30 failed Bash calls
 *  happened or whether they clustered, so the review re-read the raw transcript. Telemetry
 *  only: builder-execution.json stays the evidence. */
interface TurnToolsEvent {
  turn: number;
  toolCalls: number;
  failed: number;
  /** Failed calls by tool name; empty when the turn failed none. */
  failedByName: Record<string, number>;
}

/** Event fields appended after the shared row metadata. Prompt events also include the digest
 *  and length calculated from their text. This union restricts emitters to declared event
 *  shapes; the previous object type accepted arbitrary records. The emitter separately
 *  prevents any event field from replacing shared metadata. */
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
      // A malformed historical row remains visible to the reader. It cannot make sequence reuse.
    }
  }
  return maximum;
}

/** A state that stopped something is an error; a state that refused one is a warning. `deferred`
 *  sat in the warning list with no producer, left behind by a steering hardcode that has gone.
 *  The phase state of that name now has one, and it stays at the default level: a case held
 *  behind an earlier one is how the ordered pool is built to work, so two thirds of a healthy
 *  battery would read as warnings and the real ones would be lost among them. */
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
      // Steering rows carried shadow `mode`/`status` fields no verdict read; the only non-default
      // level ever derived came from a hardcoded "deferred". Telemetry states facts, not severity.
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
  /** The climb reading a rebuild was sized from, when this move recorded one. It is durable in
   *  difficulty-decisions/, which the campaign watcher reads, but a live reader of the stream saw
   *  the word "rebuild" and never the score it answered — the run's most consequential decision
   *  arriving as a bare verb. */
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

/** The one [fullrun] stderr emitter. Every line carries its moment (UTC, seconds) because runs
 *  13/14 liveness triage had to correlate file mtimes by hand — no emitted line said when. The
 *  tag stays first so grep-based watches (`rg "\[fullrun\]"`) keep matching. Telemetry only,
 *  like the stream above: no verdict reads a log line. */
export function fullrunLine(message: string): void {
  console.error(`[fullrun] ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
}

export function campaignProgressOptions(slug: string): CampaignProgressOptionsResult {
  return {
    // The number counts author calls used by the session, so the label states the unit. Run 16 logged
    // "controls ok (attempt 6)" against a per-call cap of 3, because the controls session sums its
    // calls across candidate corpora and patch rounds while every other session's count is one
    // loop's rounds. Both readings agree on "calls"; only "attempt" implied an ordinal.
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
