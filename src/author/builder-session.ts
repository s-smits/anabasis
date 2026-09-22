/**
 * Drive one Builder round in the domain workspace repository.
 * The session receives the Builder contract in its system prompt and uses tools confined to
 * the candidate workspace. It submits a candidate through the registered `submit` tool,
 * which runs the candidate checks and returns findings approved for the author as its result.
 * The Builder can then repair the files and try again within the same round, keeping the
 * context from its earlier work and refusals. A round given the run's conversation
 * (builder-conversation.ts) continues the session the previous round ended in.
 *
 * The driver controls the turn loop, like the solve side's bounded Pi loop. The pi session
 * executes the host tools itself, so this driver needs no separate tool-dispatch loop. A turn ending
 * on max_tokens consumes a turn without becoming a non-result: the deliverable consists of
 * files and an accepted submit result, so truncating the response text does not itself lose
 * the candidate. A failed or aborted turn still throws, allowing the outer classifier to
 * determine its cause in the same way as other session failures.
 *
 * campaignBuilderMount assembles the toolkit and writes BuilderSessionEvidence before this
 * driver opens the session. Passing that toolkit as input keeps setup checks outside the
 * turn loop, where they can refuse startup before any model work begins.
 * The session remains responsible for authoring; this driver does not open specialist
 * sub-sessions or transfer responsibility for candidate files to another author.
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

export interface BuilderSessionInput {
  slug: string;
  /** The operator's ask, verbatim. */
  kickoff: string;
  workspace: string;
  /** Controller-admitted repair evidence, already projected for the Builder. */
  advisory?: string;
  /** The operator's cap on session work (`--max-builder-turns`): model turns and refused submits
   *  share it. A turn is one prompt and tool iterations inside it are free, so a session may author
   *  everything inside turn 1 (loop-1 2026-08-23: 14 refused submits at `turn: 1`, the turn count
   *  never moved), and the same number also ends the session at its maxTurns-th refused submit.
   *  Absent, the round has no cap, as a Codex goal has none: it ends on acceptance, a final
   *  refusal, `STALLED_TURNS` turns without a successful tool call, the budget or a thrown turn. */
  maxTurns?: number;
  /** Whether the Builder slot carries public web search; the slot profile decides it and the
   *  system prompt states it, so the session never guesses. */
  webSearch?: boolean;
  /** How this round's workspace was prepared, which a resumed conversation is told when the round
   *  works in a different workspace from the last one. */
  seed?: WorkspaceSeed;
}

/** A new workspace from the adopted product or from the starter, or one an earlier pass created. */
export type WorkspaceSeed = "adopted" | "starter" | "resumed";

/** The line a resumed conversation opens with. The model never answered the result that ended its
 *  last round: acceptance and a final refusal end the round at that turn's boundary. */
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
  /** The campaign's review of the authoring tree, asked after every completed host tool call
   *  while the session is still authoring; public advice it returns rides that tool's result. */
  afterTool?: () => Promise<string | null>;
  /** Open the Builder slot's host session; a continued conversation configures its session instead. */
  open: OpenSession;
  /** Record what this round's session exposes, every round and before it begins, whether the round
   *  opens a session or continues the conversation. */
  recordSession?(tools: readonly PiTool[], systemPrompt: string): void;
  /** The run's one Builder conversation. Absent, the round opens its own session and closes it. */
  conversation?: BuilderConversation;
  /** The composed candidate-isolated toolkit; launch framing tells the Builder how to begin. */
  tools: readonly PiTool[];
  /** The controller-owned submit path, pre-bound over candidate validation and adoption gates. */
  submit: (input: { turn: number }) => BuilderSubmitOutcome | Promise<BuilderSubmitOutcome>;
  turnTimeoutMs?: number;
  observer?: RunObserver;
  /** Settle the session's execution record. Called once, on every exit including a thrown turn:
   *  a session that failed during authoring still needs a record of its work. */
  onExecution?(evidence: BuilderExecutionEvidence): void;
  /** Persist an in-flight snapshot after every controller-hosted tool return and each turn.
   *  onExecution runs in a finally a re-raised SIGTERM never reaches — run A's 66-minute session
   *  left zero execution evidence because the record lived only in memory until settle. A turn
   *  is no boundary on Claude: an Opus run (2026-08-23) held one turn open for eleven hours and
   *  twelve correctness_check calls with no submit, so a per-turn checkpoint wrote nothing. The
   *  production caller binds both callbacks to one writer, so the settled record replaces the
   *  last checkpoint in place. */
  onCheckpoint?(evidence: BuilderExecutionEvidence): void;
  /** Shared with harness_inspect in production, so the latest bounded submit refusal remains
   *  navigable without placing acceptance authority in inspection. */
  feedback?: BuilderAuthorFeedback;
  /** Directory for the controller-event transcript (builder-transcript-pointer/v2). Its pointer is
   *  written as the session opens: onExecution needs the loop to settle first, and a host killed
   *  mid-authoring never gets that far. Undefined disables the writer; the
   *  production caller passes the campaign directory. */
  transcriptDir?: string;
  /** One shared token per ordinary Builder provider/model call. */
  attemptGate?: ModelAttemptGate;
  /** Joined to attemptGate at the same outer Builder turn boundary. */
  providerBudget?: ProviderResourceBudget;
  /** Boundary for the transient-failure backoff, so a test spends no isolation clock waiting. */
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

/** One closing round: its hold on the conversation, the two sinks its evidence lands in, the deps
 *  it ran under, its accumulated state and what the turn loop threw, if it threw. */
type SessionClosing = {
  readonly round: ConversationRound;
  readonly transcriptSink: SessionTranscriptSink;
  readonly recorder: BuilderExecutionRecorder;
  readonly deps: BuilderSessionDeps;
  readonly state: SessionState;
  /** What the turn loop threw, or null when it returned. */
  readonly failure: { error: unknown } | null;
};

/** The mutable state one round accumulates; `freshSessionState` owns its initial value. */
type SessionState = ReturnType<typeof freshSessionState>;

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

/** Session cleanup failed after the model path had already settled. The evidence row names that
 * lifecycle loss separately; when a model/session error also exists, the original error remains
 * the outward error and this cleanup fault is retained only in the evidence disposition. */
class BuilderSessionLifecycleError extends Error {
  readonly kind = "evidence-unavailable" as const;
  readonly phase = "session-dispose" as const;

  constructor() {
    super("Builder session evidence unavailable: session disposal failed");
    this.name = "BuilderSessionLifecycleError";
  }
}

/** The workspace as the OS resolves it. The controller names the workspace through its own
 *  checkout, and a run worktree reaches `campaigns/` through a symlink into the main checkout while
 *  the isolation grants the physical roots: in truss-run6-opus-0902 and run47-opus-0902 the
 *  Builder's first `cd` into the lexical spelling was refused and every session spent its first
 *  minute finding the physical path. A path that does not resolve keeps its spelling. */
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
  // Read-back of the Builder's own notes, once per fresh session. The Builder writes MEMORY.md and
  // SCRATCHPAD.md itself; between commit a55b8e44 and this interface nothing read them back, so runs
  // sol-329, w22, w28 and truss-w30 each opened on notes that were written and
  // never delivered. Unconditional on the previous outcome, and empty until a pass has written
  // something. builder-memory.ts owns the bound and the stale-notes header. A continued conversation
  // already holds what the notes would repeat, so it reads none.
  //
  // FIRST, not last. The block is model-authored prose that may predate the current binding;
  // appended after the request, the task condition, the round limit and the previous attempt's
  // checks it occupied the most recent and most authoritative position in the kickoff. Everything
  // the controller states for THIS round now follows it.
  const memory = previous === null ? builderMemoryBlock(input.workspace) : "";
  const rows = [
    ...(previous === null ? [] : [`A new round opens in this conversation. ${ENDED[previous.ending]}`]),
    ...(memory === "" ? [] : [memory]),
    `The user's request, unchanged:\n${input.kickoff}`,
    workspaceSentence(input, previous),
    // A bound the model cannot observe cannot steer it (run w45), so an operator cap is stated. A
    // Claude session runs as one turn, so the pace is stated as an action, not a turn reserve: truss
    // run cc4709 authored for 171 minutes past its first clear preview without submitting (2026-09-16).
    `${input.maxTurns === undefined ? "" : `Round limit: ${input.maxTurns} assistant turns. `}Build and check the candidate, and submit once you are confident` +
      ` that a clear preview and your own checks are sufficient evidence that it works; further polish belongs to the` +
      ` next round. A refused submit returns actionable contract feedback, an unsubmitted candidate returns none.`,
  ];
  if (input.advisory !== undefined && input.advisory.trim() !== "") {
    rows.push(`Authoring context:\n${input.advisory}`);
  }
  return rows.join("\n\n");
}

/** The mutable validation state the submit tool closes over, one per session. */
function freshSessionState() {
  const lastRefusal: ContractFinding[] = [];
  return {
    accepted:
      /* SAFETY: the value is null; the assertion names the field's later type because the surrounding object literal is inferred rather than annotated. */ null as CandidateSnapshot | null,
    attempts: 0,
    lastRefusal,
    activeTurn: 0,
    terminal: false,
    terminalClause: /* SAFETY: the initial state has no terminal; the submit owner assigns its closed clause
     * below. */ null as "no-progress" | "budget-limited" | null,
    submitBound: false,
    idleTurns: 0,
  };
}

/** The closure reason every hosted tool dispatch reads. A settled round ends at the boundary of
 *  the turn that settled it; a call later in that turn's batch is refused with this reason instead
 *  of running. */
function settledClosure(state: SessionState): "accepted" | "terminal-refusal" | null {
  if (state.accepted !== null) return "accepted";
  return state.terminal ? "terminal-refusal" : null;
}

/** How a round that returned ended. A session terminal names its own clause; a final refusal is
 *  the submit gate's, and a refusal at the operator's submit bound reads as the turn bound. */
function settledEnding(state: SessionState): Exclude<RoundEnding, "turn-non-result"> {
  if (state.accepted !== null) return "accepted";
  if (state.terminalClause !== null) return state.terminalClause;
  return state.terminal && !state.submitBound ? "terminal-refusal" : "turn-bound";
}

/** How the round ended, for the next round of the conversation, or null to close the session. A
 *  turn the provider failed after its retries leaves a session pi can prompt again, as Codex keeps
 *  a goal through a failed turn, and the Claude bridge rebuilds its CLI session after one
 *  (`session-continuity.ts`). Anything else that threw leaves a state nothing has classified. */
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

/** The round's hosted tools: the toolkit and the submit tool, every call receipted, and the round
 *  clock riding open results. */
function roundRoster(context: RoundContext, feedback: BuilderAuthorFeedback): PiTool[] {
  const { deps, state, recorder, transcriptSink, checkpoint, maxTurns } = context;
  // A closed build gets no review: acceptance froze its bytes and the round ends with this turn.
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

/** Turn after turn until the round settles: accepted, finally refused, stalled, out of budget or
 *  at the operator's cap. Returns the number of turns that completed. */
async function runRoundTurns(
  context: RoundContext,
  session: ConversationRound["session"],
  input: BuilderSessionInput,
  firstPrompt: string,
): Promise<number> {
  const { deps, state, recorder, transcriptSink, checkpoint, maxTurns } = context;
  // The session's own start, read once: the continuation states elapsed time because a turn count
  // measures none, and a session that reads and installs for a night crosses no turn count.
  const openedAtMs = Date.now();
  const deadline = deps.turnTimeoutMs === undefined ? null : performance.now() + deps.turnTimeoutMs;
  const onTurnEvent = turnEventRecorder(recorder, checkpoint);
  // Captured once at open: the next-turn note compares the owned paths against this identity.
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
      // The session driver owns this projection; the turn loop calls it before it can throw.
      onTurnCompleted: (turn, result) => transcriptSink.turnCompleted(turn, result),
      ...keyIfDefined("observer", deps.observer),
      // The session cap applies across turns, so each new turn receives only what is left of it.
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

/** Run one Builder round until it settles. Like a Codex goal, a round has no turn ceiling of its
 *  own: it ends on an accepted submit, a final refusal, `STALLED_TURNS` turns in a row without a
 *  successful tool call, the budget, a thrown turn, or the operator's `maxTurns` when one is set. */
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
