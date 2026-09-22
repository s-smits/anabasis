/** One persistent Builder turn: record it and choose the next prompt. */
import type { AgentSession, AgentTurnEvent, AgentTurnResult, TurnUsage } from "../backends/backend-types.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import { observeBuilderTurn } from "../observe/model-turn-observer.ts";
import type { ContractFinding } from "../truth/brief.ts";
import type { CandidateCheckOutcome } from "./candidate-check.ts";
import { BuildAgentTurnNonResult, runModelAttempt } from "./build-agent.ts";
import type { ModelAttemptGate } from "../run/campaign-budget.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import {
  continuePrompt,
  STALLED_TURNS,
  toolFailureNote,
  unchangedAuthoringNote,
} from "./builder-continuation.ts";
import { authoringIdentity } from "./author-first.ts";
import type { BuilderExecutionRecorder } from "./builder-execution.ts";
import { awaitTurnRetry, type TurnRetryContext } from "./turn-retry.ts";
import { keyIfDefined } from "../meta/optional-key.ts";

const LIVENESS_CHECKPOINT_MS = 60_000;

/** Turn timeout when none was supplied, overriding the session's one-hour default. Each turn gets
 *  up to twenty-four hours, and the review schedule never cancels a turn. */
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
  /** The session driver owns its transcript projection; this callback keeps it complete even
   *  when this loop classifies a failed turn before it can return. */
  onTurnCompleted?(turn: number, result: AgentTurnResult): void;
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
}

/** The turn's event sink, including at most one liveness checkpoint per minute. */
export function turnEventRecorder(
  recorder: BuilderExecutionRecorder,
  checkpoint: () => void,
): (event: AgentTurnEvent) => void {
  let lastLivenessMs = 0;
  return (event) => {
    if (event.type === "tool_started" || event.type === "tool_ended") {
      // Both edges reach the recorder, so a checkpoint keeps a tally a killed turn cannot settle.
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
      // Interrupted and failed turns settle before the provider's account arrives, so their usage
      // is the transport's estimate.
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

/** One provider attempt. Review cadence is campaign-scoped, so retries cannot reset it. */
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

export async function runBuilderTurn(input: BuilderTurnInput): Promise<{ prompt: string }> {
  const { state } = input;
  state.activeTurn = input.turn;
  observeBuilderTurn(input.observer, { prompt: input.prompt, turn: input.turn });
  for (let retried = 0; ; retried += 1) {
    const result = await runBuilderAttempt(input);
    input.recorder.turnCompleted(result);
    observeTurnTools(input.observer, input.turn, result.toolCalls);
    input.checkpoint();
    input.onTurnCompleted?.(input.turn, result);
    if (result.status !== "completed") {
      const errors = result.errorMessages ?? [];
      if (state.accepted === null && !state.terminal) {
        if (await awaitTurnRetry(turnRetryContext(input), retried, result.status, errors)) continue;
        throw new BuildAgentTurnNonResult("builder", result.status, errors, input.turn);
      }
    }
    countIdleTurn(state, result.toolCalls);
    return { prompt: nextTurnPrompt(input, result) };
  }
}

/** `STALLED_TURNS` consecutive turns without a successful tool call end the round as
 *  `no-progress`. An unknown tally leaves the count alone, and a settled round stays settled. */
function countIdleTurn(state: BuilderTurnState, calls: AgentTurnResult["toolCalls"]): void {
  if (calls === undefined) return;
  state.idleTurns = calls.total > calls.failed ? 0 : state.idleTurns + 1;
  if (state.idleTurns < STALLED_TURNS || state.accepted !== null || state.terminal) return;
  state.terminal = true;
  state.terminalClause = "no-progress";
}

/** The prompt for the next turn: the continuation for the session's progress, last turn's tool
 *  failures, and whether the owned files are still as the session found them. The last is stated
 *  as a fact only; nothing counts it and nothing ends on it. */
function nextTurnPrompt(input: BuilderTurnInput, result: AgentTurnResult): string {
  const { state, authoring } = input;
  // "Unchanged" compares against the session's opening, not this turn's, over the paths this
  // round owns.
  const owned = authoringIdentity(authoring) === authoring.openingIdentity ? "unchanged" : "changed";
  const goal = {
    kickoff: input.kickoff,
    attempts: state.attempts,
    activeTurn: state.activeTurn,
    maxTurns: input.maxTurns,
    elapsedMs: Date.now() - input.openedAtMs,
  };
  return [
    continuePrompt(goal),
    toolFailureNote(result.toolCalls),
    unchangedAuthoringNote(owned, authoring.paths),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}
