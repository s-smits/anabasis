/**
 * Drives one Builder round in the domain workspace. The Builder works with tools confined to the
 * workspace and submits through the `submit` tool, which runs the candidate checks and returns
 * author-projected findings; it may repair and resubmit within the round. A round given the run's
 * conversation (builder-conversation.ts) continues the previous round's session.
 *
 * The pi session executes the host tools itself; this driver owns only the turn loop. A turn ending
 * on max_tokens consumes a turn without becoming a non-result, because the deliverable is files and
 * an accepted submit. A failed or aborted turn throws for the outer classifier.
 *
 * The toolkit arrives assembled, so setup checks can refuse startup before any model work.
 */
import type { PiTool } from "../backends/pi-session.ts";
import { BuilderAuthorFeedback } from "../builder/author-feedback.ts";
import { SessionTranscriptSink } from "../builder/session-transcript.ts";
import { authoringIdentity, PRIMARY_AUTHOR_PATHS } from "./author-first.ts";
import type { FingerprintEvidence } from "../claim/fingerprint.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import type { ContractFinding } from "../truth/brief.ts";
import { BuildAgentTurnNonResult, openBuildSession } from "./build-agent.ts";
import { CampaignBudgetExhausted } from "../run/campaign-budget.ts";
import type { ModelAttemptGate } from "../run/campaign-budget.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { type BuilderExecutionEvidence, BuilderExecutionRecorder } from "./builder-execution.ts";
import { sessionClock, withCustomToolReceipts } from "./builder-tool-receipts.ts";
import { STALLED_TURNS } from "./builder-continuation.ts";
import { builderMemoryBlock } from "./builder-memory.ts";
import { builderSystemPrompt } from "./builder-start-prompt.ts";
import {
  BuilderConversation,
  type ConversationRound,
  type OpenSession,
  type PreviousRound,
  type RoundEnding,
} from "./builder-conversation.ts";
import type { CandidateSnapshot } from "./candidate-check.ts";
import { BUILDER_TURN_SETTLE_MS, runBuilderTurn, turnEventRecorder } from "./builder-turn-loop.ts";
import { realpathSync } from "../meta/filesystem.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { type BuilderSubmitOutcome, makeSubmitTool } from "../gate/submit-tool.ts";
export type { BuilderSubmitOutcome } from "../gate/submit-tool.ts";
export {
  BUILDER_WORKSPACE_CARD,
  builderSystemPrompt,
} from "./builder-start-prompt.ts";

interface BuilderSessionInput {
  slug: string;
  /** The operator's ask, verbatim. */
  kickoff: string;
  workspace: string;
  /** Controller-admitted repair evidence, already projected for the Builder. */
  advisory?: string;
  /** The operator's cap (`--max-builder-turns`), applied both to model turns and to refused
   *  submits, since one turn may hold many tool calls. Absent, the round has no cap. */
  maxTurns?: number;
  /** Whether the Builder slot has public web search; the system prompt states it. */
  webSearch?: boolean;
  /** How this round's workspace was prepared; told to a resumed conversation when the workspace
   *  changed. */
  seed?: WorkspaceSeed;
}

/** A new workspace from the adopted product or from the starter, or one an earlier pass created. */
export type WorkspaceSeed = "adopted" | "starter" | "resumed";

/** The line a resumed conversation opens with, since the model never saw how its last round
 *  ended. */
const ENDED: Record<RoundEnding, string> = {
  accepted: "Your last submit was accepted, and the controller took that candidate forward.",
  "terminal-refusal": "The last round ended on a final submit refusal.",
  "turn-bound": "The last round reached its turn limit without an accepted submit.",
  "no-progress": `The last round ended after ${STALLED_TURNS} turns in a row without a successful tool call.`,
  "budget-limited": "The last round ended when the run's model budget ran out.",
  "turn-non-result":
    "The last round ended when a model turn failed on the provider's side, after its retries.",
};

const SEEDED: Record<WorkspaceSeed, string> = {
  adopted: "a new workspace seeded from the adopted product",
  starter: "a new workspace from the starter, with nothing from the previous workspace in it",
  resumed: "a workspace an earlier pass worked in, with its in-flight edits kept",
};

export interface BuilderSessionDeps {
  /** The campaign's review of the authoring tree, asked after every completed host tool call while
   *  the session is authoring; its public advice rides that tool's result. */
  afterTool?: () => Promise<string | null>;
  /** Opens the Builder slot's host session; a continued conversation reconfigures its own instead. */
  open: OpenSession;
  /** Records what this round's session exposes, before the round begins. */
  recordSession?(tools: readonly PiTool[], systemPrompt: string): void;
  /** The run's one Builder conversation. Absent, the round opens and closes its own session. */
  conversation?: BuilderConversation;
  /** The composed candidate-isolated toolkit. */
  tools: readonly PiTool[];
  /** The controller-owned submit path, pre-bound over candidate validation and adoption gates. */
  submit: (input: { turn: number }) => BuilderSubmitOutcome | Promise<BuilderSubmitOutcome>;
  turnTimeoutMs?: number;
  observer?: RunObserver;
  /** Settles the session's execution record; called once on every exit, a thrown turn included. */
  onExecution?(evidence: BuilderExecutionEvidence): void;
  /** Persists an in-flight snapshot after every controller-hosted tool return and each turn, since
   *  a killed process never reaches `onExecution` and one turn may run for hours. */
  onCheckpoint?(evidence: BuilderExecutionEvidence): void;
  /** Shared with harness_inspect, so the latest submit refusal stays readable there. */
  feedback?: BuilderAuthorFeedback;
  /** Directory for the controller-event transcript. Its pointer is written as the session opens,
   *  so a killed host still leaves one. Undefined disables the writer. */
  transcriptDir?: string;
  /** One shared token per Builder provider call. */
  attemptGate?: ModelAttemptGate;
  /** Charged at the same Builder turn boundary as `attemptGate`. */
  providerBudget?: ProviderResourceBudget;
  /** Wait used for the transient-failure backoff; tests replace it. */
  waitMs?: (ms: number) => Promise<void>;
}

interface BuilderSessionOutcome {
  ok: boolean;
  fingerprint: FingerprintEvidence | null;
  turns: number;
  validationAttempts: number;
  /** A controller/environment refusal ended the loop instead of consuming further turns. */
  terminal: boolean;
  /** Typed session terminal for an author that never reached submit. */
  terminalClause: "no-progress" | "budget-limited" | null;
  /** The last refusal's author-projected findings; empty when accepted or never submitted. */
  findings: ContractFinding[];
}

/** Everything a closing round needs to settle its session and evidence. */
type SessionClosing = {
  readonly round: ConversationRound;
  readonly transcriptSink: SessionTranscriptSink;
  readonly recorder: BuilderExecutionRecorder;
  readonly deps: BuilderSessionDeps;
  readonly state: SessionState;
  /** What the turn loop threw, or null when it returned. */
  readonly failure: { error: unknown } | null;
};

/** The mutable validation state the submit tool closes over, one per round. */
interface SessionState {
  accepted: CandidateSnapshot | null;
  attempts: number;
  lastRefusal: ContractFinding[];
  activeTurn: number;
  terminal: boolean;
  terminalClause: "no-progress" | "budget-limited" | null;
  submitBound: boolean;
  idleTurns: number;
}

/** What one round's roster and turn loop share. */
interface RoundContext {
  readonly deps: BuilderSessionDeps;
  readonly state: SessionState;
  readonly recorder: BuilderExecutionRecorder;
  readonly transcriptSink: SessionTranscriptSink;
  readonly checkpoint: () => void;
  /** The operator's turn cap; absent, the round has none. */
  readonly maxTurns: number | undefined;
}

/** Session cleanup failed after the model path settled. When a turn also threw, that error stays
 *  the outward one and this fault is kept only in the evidence. */
class BuilderSessionLifecycleError extends Error {
  readonly kind = "evidence-unavailable" as const;
  readonly phase = "session-dispose" as const;

  constructor() {
    super("Builder session evidence unavailable: session disposal failed");
    this.name = "BuilderSessionLifecycleError";
  }
}

/** The workspace's physical path, since the isolation grants physical roots and the controller's
 *  spelling may pass through a symlink. An unresolvable path keeps its spelling. */
function physicalWorkspace(workspace: string): string {
  try {
    return realpathSync(workspace);
  } catch {
    return workspace;
  }
}

function workspaceSentence(input: BuilderSessionInput, previous: PreviousRound | null): string {
  const at = `Work in ${physicalWorkspace(input.workspace)} (project ${input.slug})`;
  if (previous === null) return `${at}. Read STARTER.md and the file tree.`;
  if (previous.workspace === input.workspace) return `${at}, the same workspace as last round.`;
  return `${at}: ${SEEDED[input.seed ?? "resumed"]}. Paths into the previous workspace no longer apply; relative paths start at this root.`;
}

function roundPrompt(input: BuilderSessionInput, previous: PreviousRound | null): string {
  // A fresh session reads back the Builder's own notes; a continued conversation already holds
  // them. The notes come first so the controller's statements for this round follow and outrank
  // them.
  const memory = previous === null ? builderMemoryBlock(input.workspace) : "";
  const rows = [
    ...(previous === null ? [] : [`A new round opens in this conversation. ${ENDED[previous.ending]}`]),
    ...(memory === "" ? [] : [memory]),
    `The user's request, unchanged:\n${input.kickoff}`,
    workspaceSentence(input, previous),
    // An operator cap is stated so it can steer; the pace is stated as an action because one
    // session may run as a single turn.
    `${input.maxTurns === undefined ? "" : `Round limit: ${input.maxTurns} assistant turns. `}Build and check the candidate, and submit once you are confident` +
      ` that a clear preview and your own checks are sufficient evidence that it works; further polish belongs to the` +
      ` next round.`,
  ];
  if (input.advisory !== undefined && input.advisory.trim() !== "") {
    rows.push(`Authoring context:\n${input.advisory}`);
  }
  return rows.join("\n\n");
}

function freshSessionState(): SessionState {
  return {
    accepted: null,
    attempts: 0,
    lastRefusal: [],
    activeTurn: 0,
    terminal: false,
    terminalClause: null,
    submitBound: false,
    idleTurns: 0,
  };
}

/** Why hosted tool calls are refused: a settled round ends at its turn's boundary, so later calls
 *  in that turn's batch are refused with this reason. */
function settledClosure(state: SessionState): "accepted" | "terminal-refusal" | null {
  if (state.accepted !== null) return "accepted";
  return state.terminal ? "terminal-refusal" : null;
}

/** How a round that returned ended. A refusal at the operator's submit bound reads as the turn
 *  bound. */
function settledEnding(state: SessionState): Exclude<RoundEnding, "turn-non-result"> {
  if (state.accepted !== null) return "accepted";
  if (state.terminalClause !== null) return state.terminalClause;
  return state.terminal && !state.submitBound ? "terminal-refusal" : "turn-bound";
}

/** How the round ended, for the conversation's next round, or null to close the session. A turn
 *  the provider failed after retries leaves a session that can be prompted again; any other throw
 *  leaves an unclassified state. */
function conversationEnding(state: SessionState, failure: { error: unknown } | null): RoundEnding | null {
  if (failure === null) return settledEnding(state);
  const { error } = failure;
  return error instanceof BuildAgentTurnNonResult && error.status === "failed" ? "turn-non-result" : null;
}

/** The exit class written on the settled execution record. */
function classifyExit(
  state: SessionState,
  failure: SessionClosing["failure"],
): "recorded" | "turn-non-result" | Exclude<RoundEnding, "accepted" | "turn-non-result"> {
  if (state.accepted !== null) return "recorded";
  if (failure !== null) return "turn-non-result";
  const ending = settledEnding(state);
  return ending === "accepted" ? "recorded" : ending;
}

async function finishBuilderSession(
  closing: SessionClosing,
): Promise<BuilderSessionLifecycleError | undefined> {
  const { round, transcriptSink, recorder, deps, state, failure } = closing;
  transcriptSink.settle();
  try {
    // A round with no run conversation closes its own session.
    await round.end(deps.conversation === undefined ? null : conversationEnding(state, failure));
  } catch {
    deps.onExecution?.(
      recorder.finish("evidence-unavailable", { kind: "evidence-unavailable", phase: "session-dispose" }),
    );
    return new BuilderSessionLifecycleError();
  }
  deps.onExecution?.(recorder.finish(classifyExit(state, failure)));
  return undefined;
}

async function runSessionTurn(
  input: Parameters<typeof runBuilderTurn>[0],
): Promise<Awaited<ReturnType<typeof runBuilderTurn>> | null> {
  try {
    return await runBuilderTurn(input);
  } catch (error) {
    if (!(error instanceof CampaignBudgetExhausted)) throw error;
    input.state.terminal = true;
    input.state.terminalClause = "budget-limited";
    return null;
  }
}

function sessionOutcome(state: SessionState, turns: number): BuilderSessionOutcome {
  const { accepted } = state;
  return {
    ok: accepted !== null,
    fingerprint: accepted?.ok === true ? accepted.fingerprint : null,
    turns,
    validationAttempts: state.attempts,
    terminal: state.terminal,
    terminalClause: state.terminalClause,
    findings: accepted === null ? state.lastRefusal : [],
  };
}

/** The round's hosted tools: the toolkit plus the submit tool, every call receipted. */
function roundRoster(context: RoundContext, feedback: BuilderAuthorFeedback): PiTool[] {
  const { deps, state, recorder, transcriptSink, checkpoint, maxTurns } = context;
  // A settled round gets no review: its bytes are frozen and the round ends with this turn.
  const { afterTool } = deps;
  const submit = makeSubmitTool({
    submit: deps.submit,
    state,
    recorder,
    feedback,
    ...keyIfDefined("maxTurns", maxTurns),
  });
  return withCustomToolReceipts([...deps.tools, submit], {
    recorder,
    activeTurn: () => state.activeTurn,
    checkpoint,
    closed: () => settledClosure(state),
    events: transcriptSink.toolEvents(),
    clock: sessionClock(() => state.attempts > 0),
    afterTool:
      afterTool === undefined
        ? undefined
        : async () => (state.accepted !== null || state.terminal ? null : afterTool()),
  });
}

/** Runs turns until the round settles or reaches the operator's cap; returns the completed turns. */
async function runRoundTurns(
  context: RoundContext,
  session: ConversationRound["session"],
  input: BuilderSessionInput,
  firstPrompt: string,
): Promise<number> {
  const { deps, state, recorder, transcriptSink, checkpoint, maxTurns } = context;
  // The continuation states elapsed time, which a turn count does not measure.
  const openedAtMs = Date.now();
  const deadline = deps.turnTimeoutMs === undefined ? null : performance.now() + deps.turnTimeoutMs;
  const onTurnEvent = turnEventRecorder(recorder, checkpoint);
  // Captured at open; the next-turn note compares the owned paths against it.
  const paths = PRIMARY_AUTHOR_PATHS;
  const openingIdentity = authoringIdentity({ workspace: input.workspace, paths });
  const authoring = { workspace: input.workspace, paths, openingIdentity };
  let turns = 0;
  let prompt = firstPrompt;
  const cap = maxTurns ?? Number.POSITIVE_INFINITY;
  while (turns < cap && state.accepted === null && !state.terminal) {
    const next = await runSessionTurn({
      session,
      state,
      recorder,
      prompt,
      turn: turns + 1,
      onTurnEvent,
      checkpoint,
      kickoff: input.kickoff,
      ...keyIfDefined("maxTurns", maxTurns),
      openedAtMs,
      // Called by the turn loop before it can throw.
      onTurnCompleted: (turn, result) => transcriptSink.turnCompleted(turn, result),
      ...keyIfDefined("observer", deps.observer),
      // The session cap spans turns, so each turn receives what is left of it.
      turnTimeoutMs:
        deadline === null ? BUILDER_TURN_SETTLE_MS : Math.max(1, Math.ceil(deadline - performance.now())),
      ...keyIfDefined("attemptGate", deps.attemptGate),
      ...keyIfDefined("providerBudget", deps.providerBudget),
      ...keyIfDefined("waitMs", deps.waitMs),
      authoring,
    });
    if (next === null) break;
    turns += 1;
    prompt = next.prompt;
    transcriptSink.prompt(state.activeTurn + 1, prompt);
  }
  return turns;
}

/** Runs one Builder round until it settles: an accepted submit, a final refusal, `STALLED_TURNS`
 *  turns without a successful tool call, the budget, a thrown turn, or the operator's `maxTurns`. */
export async function runBuilderSession(
  input: BuilderSessionInput,
  deps: BuilderSessionDeps,
): Promise<BuilderSessionOutcome> {
  const state = freshSessionState();
  const recorder = new BuilderExecutionRecorder();
  const transcriptSink = new SessionTranscriptSink();
  const checkpoint = (): void => deps.onCheckpoint?.(recorder.finish("in-flight"));
  const context = { deps, state, recorder, transcriptSink, checkpoint, maxTurns: input.maxTurns };
  const roster = roundRoster(context, deps.feedback ?? new BuilderAuthorFeedback());
  const systemPrompt = builderSystemPrompt(input.webSearch === true);
  deps.recordSession?.(roster, systemPrompt);
  const conversation = deps.conversation ?? new BuilderConversation();
  const round = await openBuildSession(() =>
    conversation.begin(roster, systemPrompt, input.workspace, deps.open),
  );
  const { session } = round;
  recorder.openedOn(session.backend);
  let turns = 0;
  let failure: { error: unknown } | null = null;
  let lifecycleError: BuilderSessionLifecycleError | undefined;
  try {
    const prompt = roundPrompt(input, round.previous);
    transcriptSink.prompt(1, prompt);
    transcriptSink.open(session.sessionId, session.backend, deps.transcriptDir, round.openedIn);
    turns = await runRoundTurns(context, session, input, prompt);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    lifecycleError = await finishBuilderSession({ round, transcriptSink, recorder, deps, state, failure });
  }
  if (lifecycleError !== undefined) throw lifecycleError;
  return sessionOutcome(state, turns);
}
