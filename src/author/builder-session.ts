/**
 * Drives one Builder round in the domain workspace repository. The session receives the Builder
 * contract as its system prompt and works with tools confined to the candidate workspace. It
 * submits through the registered `submit` tool, which runs the candidate checks and returns the
 * findings approved for the author, so the Builder can repair the files and try again inside the
 * same round with the context of its earlier work and refusals intact. A round handed the run's
 * conversation (builder-conversation.ts) continues the session the previous round ended in rather
 * than opening a new one.
 *
 * The pi session executes the host tools itself, so this driver needs no tool-dispatch loop of its
 * own and owns the turn loop alone. A turn ending on max_tokens consumes a turn without becoming a
 * non-result, because the deliverable is files plus an accepted submit and truncating the response
 * text loses neither. A failed or aborted turn still throws, which is what lets the outer
 * classifier decide its cause the same way it decides any other session failure.
 *
 * `campaignBuilderMount` assembles the toolkit and writes the session evidence before this driver
 * opens anything, so every setup check can refuse startup before a single model call is paid for.
 * The session stays responsible for authoring throughout: this driver opens no specialist
 * sub-session and hands the candidate files to no other author.
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
  /** The operator's cap on session work (`--max-builder-turns`), which model turns and refused
   *  submits share. A turn is one prompt and the tool iterations inside it are free, so a session
   *  can author everything within turn 1 and make a dozen refused submits that all record
   *  `turn: 1` without the count moving — which is why the same number also ends the session at
   *  its maxTurns-th refused submit. Absent, the round has no cap, as a Codex goal has none: it
   *  ends on acceptance, a final refusal, `STALLED_TURNS` turns without a successful tool call,
   *  the budget or a thrown turn. */
  maxTurns?: number;
  /** Whether the Builder slot carries public web search. The slot profile decides it and the system
   *  prompt states it, so the session never has to guess whether the tool is there. */
  webSearch?: boolean;
  /** How this round's workspace was prepared, which a resumed conversation is told when the round
   *  works in a different workspace from the last one. */
  seed?: WorkspaceSeed;
}

/** A new workspace from the adopted product or from the starter, or one an earlier pass created. */
export type WorkspaceSeed = "adopted" | "starter" | "resumed";

/** The line a resumed conversation opens with. The model never answered the result that ended its
 *  last round, because acceptance and a final refusal both end the round at that turn's boundary,
 *  so the next round has to say how the last one finished. */
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
   *  the session is still authoring; the public advice it returns rides that tool's result, so the
   *  review reaches the Builder without a turn of its own. */
  afterTool?: () => Promise<string | null>;
  /** Opens the Builder slot's host session; a continued conversation reconfigures its own instead. */
  open: OpenSession;
  /** Record what this round's session exposes, every round and before it begins, whether the round
   *  opens a session or continues the conversation. */
  recordSession?(tools: readonly PiTool[], systemPrompt: string): void;
  /** The run's one Builder conversation. Absent, the round opens its own session and closes it. */
  conversation?: BuilderConversation;
  /** The composed candidate-isolated toolkit; the launch framing tells the Builder how to begin. */
  tools: readonly PiTool[];
  /** The controller-owned submit path, pre-bound over candidate validation and adoption gates. */
  submit: (input: { turn: number }) => BuilderSubmitOutcome | Promise<BuilderSubmitOutcome>;
  turnTimeoutMs?: number;
  observer?: RunObserver;
  /** Settle the session's execution record. Called once, on every exit including a thrown turn,
   *  because a session that failed while authoring still needs a record of the work it did. */
  onExecution?(evidence: BuilderExecutionEvidence): void;
  /** Persist an in-flight snapshot after every controller-hosted tool return and after each turn.
   *  `onExecution` runs in a finally that a re-raised SIGTERM never reaches, so a session killed
   *  mid-authoring leaves no execution evidence at all: the record lives in memory until settle. A
   *  turn is no boundary either, since a session can hold one turn open for hours and a dozen
   *  `correctness_check` calls without submitting, so a per-turn checkpoint would write nothing.
   *  The production caller binds both callbacks to one writer, so the settled record replaces the
   *  last checkpoint in place. */
  onCheckpoint?(evidence: BuilderExecutionEvidence): void;
  /** Shared with harness_inspect in production, so the latest bounded submit refusal stays
   *  navigable there without giving inspection any authority over acceptance. */
  feedback?: BuilderAuthorFeedback;
  /** Directory for the controller-event transcript (`builder-transcript-pointer/v2`). Its pointer
   *  is written as the session opens, because `onExecution` needs the loop to settle first and a
   *  host killed mid-authoring never gets that far. Undefined disables the writer; the production
   *  caller passes the campaign directory. */
  transcriptDir?: string;
  /** One shared token per ordinary Builder provider and model call. */
  attemptGate?: ModelAttemptGate;
  /** Joined to `attemptGate` at the same outer Builder turn boundary. */
  providerBudget?: ProviderResourceBudget;
  /** The boundary for the transient-failure backoff, so a test spends no isolation clock waiting. */
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

/** Session cleanup failed after the model path had already settled. The evidence row names that
 *  lifecycle loss separately, and when a model or session error also exists the original error
 *  remains the outward one, so a cleanup fault never stands in for the failure that caused it. */
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
 *  the isolation grants the physical roots, so a Builder handed the lexical spelling has its first
 *  `cd` refused and spends its opening minutes discovering the physical path instead of authoring.
 *  A path that does not resolve keeps its spelling. */
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
  // SCRATCHPAD.md itself, and without this read-back nothing delivers them, so a fresh session
  // opens on notes that were written and never read. It is unconditional on how the previous round
  // ended, and empty until a pass has written something; builder-memory.ts owns the byte bound and
  // the stale-notes header. A continued conversation already holds everything the notes would
  // repeat, so it reads none.
  //
  // The block goes FIRST, not last. It is model-authored prose that may predate the current
  // binding, and appended after the request, the workspace, the round limit and the previous
  // attempt it would occupy the most recent and most authoritative position in the kickoff.
  // Everything the controller states for THIS round now follows it.
  const memory = previous === null ? builderMemoryBlock(input.workspace) : "";
  const rows = [
    ...(previous === null ? [] : [`A new round opens in this conversation. ${ENDED[previous.ending]}`]),
    ...(memory === "" ? [] : [memory]),
    `The user's request, unchanged:\n${input.kickoff}`,
    workspaceSentence(input, previous),
    // A bound the model cannot observe cannot steer it, so an operator cap is stated rather than
    // merely enforced. A Claude session can run as a single turn, which makes a turn reserve
    // meaningless as a pace signal; left with one, a session authors for hours past its first clear
    // preview without submitting. So the pace is stated as an action instead.
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

/** The closure reason every hosted tool dispatch reads. A settled round ends at the boundary of the
 *  turn that settled it, so a call later in that same turn's batch is refused with this reason
 *  instead of running against bytes the controller has already taken forward. */
function settledClosure(state: SessionState): "accepted" | "terminal-refusal" | null {
  if (state.accepted !== null) return "accepted";
  return state.terminal ? "terminal-refusal" : null;
}

/** How a round that returned ended. A session terminal names its own clause; a final refusal is the
 *  submit gate's, and a refusal at the operator's submit bound reads as the turn bound, since the
 *  same `maxTurns` set both. */
function settledEnding(state: SessionState): Exclude<RoundEnding, "turn-non-result"> {
  if (state.accepted !== null) return "accepted";
  if (state.terminalClause !== null) return state.terminalClause;
  return state.terminal && !state.submitBound ? "terminal-refusal" : "turn-bound";
}

/** How the round ended, for the next round of the conversation, or null to close the session. A
 *  turn the provider failed after its retries leaves a session pi can prompt again, as Codex keeps
 *  a goal through a failed turn and the Claude bridge rebuilds its CLI session after one
 *  (`vendor/pi-claude-bridge/session-continuity.ts`). Anything else that threw leaves a state
 *  nothing has classified, so the conversation closes rather than resuming from it. */
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
 *  clock riding the open results. */
function roundRoster(context: RoundContext, feedback: BuilderAuthorFeedback): PiTool[] {
  const { deps, state, recorder, transcriptSink, checkpoint, maxTurns } = context;
  // A settled round gets no review: acceptance froze its bytes and the round ends with this turn,
  // so advice from the reviewer would reach nobody who could still act on it.
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
  // The session's own start, read once. The continuation states elapsed time because a turn count
  // measures none: a session that reads and installs for a night crosses no turn count at all.
  const openedAtMs = Date.now();
  const deadline = deps.turnTimeoutMs === undefined ? null : performance.now() + deps.turnTimeoutMs;
  const onTurnEvent = turnEventRecorder(recorder, checkpoint);
  // Captured once at open, because the next-turn note compares the owned paths against this
  // identity to see whether the turn authored anything.
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
      // The session driver owns this projection, and the turn loop calls it before it can throw.
      onTurnCompleted: (turn, result) => transcriptSink.turnCompleted(turn, result),
      ...keyIfDefined("observer", deps.observer),
      // The operator's cap applies across the whole session, so each new turn receives only what
      // is left of it rather than a fresh copy.
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
