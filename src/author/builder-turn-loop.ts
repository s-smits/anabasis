/** One persistent Builder turn: record it and choose the next prompt. */
import type { AgentSession, AgentTurnEvent, AgentTurnResult, TurnUsage } from "../backends/backend-types.ts";
import { POLICY } from "../critic/policy.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import { observeBuilderTurn } from "../observe/model-turn-observer.ts";
import type { ContractFinding } from "../truth/brief.ts";
import type { CandidateCheckOutcome } from "./candidate-check.ts";
import { BuildAgentTurnNonResult, runModelAttempt } from "./build-agent.ts";
import type { ModelAttemptGate } from "../run/campaign-budget.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { continuePrompt, toolFailureNote, unchangedAuthoringNote } from "./builder-continuation.ts";
import { authoringIdentity } from "./author-first.ts";
import type { BuilderExecutionRecorder } from "./builder-execution.ts";
import { awaitTurnRetry, type TurnRetryContext } from "./turn-retry.ts";
import { keyIfDefined } from "../meta/optional-key.ts";

const LIVENESS_CHECKPOINT_MS = 60_000;

/** Timeout for a Builder turn when no session timeout was supplied. Without it an absent
 *  `turnTimeoutMs` falls to the session's one-hour default cap (`DEFAULT_TURN_CAP_MS` in
 *  pi-session.ts) and ends a long authoring turn as a typed non-result. Each turn gets up to
 *  twenty-four hours instead (operator decision), and the next turn opens a fresh window. The
 *  campaign's review schedule in builder-campaign.ts never cancels a turn, so this is the only
 *  clock over one. */
export const BUILDER_TURN_SETTLE_MS = 86_400_000;

export interface BuilderTurnState {
  accepted: Extract<CandidateCheckOutcome, { ok: true }> | null;
  attempts: number;
  lastRefusal: ContractFinding[];
  activeTurn: number;
  terminal: boolean;
  terminalClause: "no-progress" | "budget-limited" | null;
  /** Consecutive completed turns in which no tool call succeeded. */
  idleTurns: number;
}

interface BuilderTurnInput {
  session: AgentSession;
  state: BuilderTurnState;
  recorder: BuilderExecutionRecorder;
  prompt: string;
  turn: number;
  onTurnEvent: (event: AgentTurnEvent) => void;
  checkpoint: () => void;
  /** The operator's request, which every continuation restates. */
  kickoff: string;
  /** The operator's turn cap; absent, the round has none. */
  maxTurns?: number;
  observer?: RunObserver;
  turnTimeoutMs?: number;
  attemptGate?: ModelAttemptGate;
  providerBudget?: ProviderResourceBudget;
  /** Test interface for the transient-failure backoff, matching `BuildAgentSessions.waitMs`. */
  waitMs?: (ms: number) => Promise<void>;
  /** The owned authoring paths and their identity when the session opened; the next-turn prompt
   *  says when they are still unchanged. */
  authoring: { workspace: string; paths: readonly string[]; openingIdentity: string };
  /** When the session opened, so the continuation can read elapsed time and not only turns. */
  openedAtMs: number;
  /** The round plan's compact view, read afresh at each turn boundary. */
  planView?: () => string;
}

/** The turn's event sink, including at most one liveness checkpoint per minute. */
export function turnEventRecorder(
  recorder: BuilderExecutionRecorder,
  checkpoint: () => void,
): (event: AgentTurnEvent) => void {
  let lastLivenessMs = 0;
  return (event) => {
    if (event.type === "tool_started" || event.type === "tool_ended") {
      // Both edges reach the recorder: the start counts the call and the end says whether it
      // failed and what it returned. A checkpoint taken from either edge therefore records a
      // running tally, which is the only account a killed turn will ever have.
      recorder.turnToolEvent(event);
      if (Date.now() - lastLivenessMs >= LIVENESS_CHECKPOINT_MS) {
        lastLivenessMs = Date.now();
        checkpoint();
      }
    } else if (event.type === "reasoning_text") {
      recorder.reasoning(event.text);
    } else if (event.type === "message_text") {
      recorder.message(event.text);
    } else if ((event.type === "turn_ended" || event.type === "turn_failed") && event.usage !== undefined) {
      // A turn the caller interrupted and a turn that failed both settle before the provider's own
      // account of them arrives, so their usage is whatever the transport had in flight -- an
      // estimate, marked as one here, because a total holding estimates bounds nothing.
      recorder.reportedUsage(
        event.usage,
        event.type === "turn_ended" && event.stopReason !== "aborted" ? "final" : "estimated",
      );
    }
  };
}

function observeTurnTools(
  observer: RunObserver | undefined,
  turn: number,
  calls: AgentTurnResult["toolCalls"],
): void {
  if (observer === undefined || calls === undefined) return;
  observer.turnTools({
    turn,
    toolCalls: calls.total,
    failed: calls.failed,
    failedByName: { ...calls.failedByName },
  });
}

/** One provider attempt. The review cadence is campaign-scoped and keyed to tool boundaries, so
 *  neither a retry nor the outer turn can reset it or turn a timer expiry into an abort. */
async function runBuilderAttempt(input: BuilderTurnInput): Promise<AgentTurnResult> {
  let usage: TurnUsage | undefined;
  return runModelAttempt(
    input.attemptGate,
    "builder",
    () =>
      input.session.runTurn({
        prompt: input.prompt,
        onEvent: (event) => {
          if ((event.type === "turn_ended" || event.type === "turn_failed") && event.usage !== undefined) {
            usage ??= event.usage;
          }
          input.onTurnEvent(event);
        },
        ...keyIfDefined("turnTimeoutMs", input.turnTimeoutMs),
        ...keyIfDefined("signal", input.providerBudget?.cancellationSignal),
      }),
    input.providerBudget,
    () => usage,
  );
}

/** The retry context for this turn: same role, same gates, same recorder as the attempt itself. */
function turnRetryContext(input: BuilderTurnInput): TurnRetryContext {
  return {
    role: "builder",
    turn: input.turn,
    recorder: input.recorder,
    ...keyIfDefined("attemptGate", input.attemptGate),
    ...keyIfDefined("providerBudget", input.providerBudget),
    ...keyIfDefined("wait", input.waitMs),
  };
}

/** The next turn's prompt, and the text this turn returned for a caller that reads it. */
export async function runBuilderTurn(
  input: BuilderTurnInput,
): Promise<{ prompt: string; assistantText: string | undefined }> {
  const { state } = input;
  state.activeTurn = input.turn;
  observeBuilderTurn(input.observer, { prompt: input.prompt, turn: input.turn });
  for (let retried = 0; ; retried += 1) {
    const result = await runBuilderAttempt(input);
    input.recorder.turnCompleted(result);
    observeTurnTools(input.observer, input.turn, result.toolCalls);
    input.checkpoint();
    if (result.status !== "completed") {
      const errors = result.errorMessages ?? [];
      if (state.accepted === null && !state.terminal) {
        if (await awaitTurnRetry(turnRetryContext(input), retried, result.status, errors)) continue;
        throw new BuildAgentTurnNonResult("builder", result.status, errors, input.turn);
      }
    }
    countIdleTurn(state, result.toolCalls);
    return { prompt: nextTurnPrompt(input, result), assistantText: result.assistantText };
  }
}

/** Codex's no-progress rule: a turn in which no tool call succeeded made no progress, and
 *  `POLICY.loop.stalledTurns` of them in a row end the round as `no-progress`. The backend's tally counts the
 *  CLI's own tools as well as the hosted ones; a backend that reports none leaves the count alone,
 *  because an unknown tally is not the same as zero calls. A round that settled in this turn is
 *  left as it settled. The run may retry the build, and the conversation continues either way. */
// Gate audit 2026-09-25 (docs/gate-audit.md, no-progress): kept: turns with no successful tool call change nothing, and the clause is retryable on the same conversation
function countIdleTurn(state: BuilderTurnState, calls: AgentTurnResult["toolCalls"]): void {
  if (calls === undefined) return;
  state.idleTurns = calls.total > calls.failed ? 0 : state.idleTurns + 1;
  if (state.idleTurns < POLICY.loop.stalledTurns || state.accepted !== null || state.terminal) return;
  state.terminal = true;
  state.terminalClause = "no-progress";
}

/** The prompt for the next turn: the continuation for the session's progress, last turn's tool
 *  failures, and whether the owned files are still as the session found them.
 *
 *  The third part is a statement rather than an interrupt. A monitor that counts tool calls over
 *  unchanged owned paths and cuts the turn would cut a session installing a compiler under
 *  .toolchain mid-install, for doing exactly the right thing. The fact behind it is still worth
 *  stating: a Builder that has read and probed for a whole turn without touching agent/ or
 *  correctness-model/ may not have noticed, and the transcript it would have to re-read to notice
 *  is long. So the turn boundary states it once, in one line, and leaves the decision with the
 *  model -- keep installing, or start writing. Nothing counts it and nothing ends on it. */
function nextTurnPrompt(input: BuilderTurnInput, result: AgentTurnResult): string {
  const { state, authoring } = input;
  // "Unchanged" is byte identity against the session's opening, not against this turn's start: a
  // turn that validates files written in an earlier turn is not a turn without authoring.
  // `authoringIdentity` hashes the owned paths, so the note names what the controller opened for
  // this round rather than the workspace at large.
  const owned = authoringIdentity(authoring) === authoring.openingIdentity ? "unchanged" : "changed";
  const goal = {
    kickoff: input.kickoff,
    attempts: state.attempts,
    activeTurn: state.activeTurn,
    maxTurns: input.maxTurns,
    elapsedMs: Date.now() - input.openedAtMs,
    ...keyIfDefined("planView", input.planView?.()),
  };
  return [
    continuePrompt(goal),
    toolFailureNote(result.toolCalls),
    unchangedAuthoringNote(owned, authoring.paths),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}
