/**
 * Instructions sent to the Builder between turns. Continuation wording and tool-failure notes
 * live here so their timing and tests can be maintained separately from the session loop.
 *
 * The continuation works like Codex's goal continuation (codex-rs/ext/goal, templates/goals/
 * continuation.md): every turn boundary restates the objective and the goal's standing facts, so a
 * long session never has to find its task or its spend in a transcript that compaction may have
 * cut. Completion stays the gate's: Codex lets the model declare its goal complete, and here only a
 * submit the gate accepts does.
 */

/** Completed turns with no submit before the continuation asks for authoring. Fixed rather than a
 *  share of a ceiling: recorded sessions used zero to seven turns (review of 338970480,
 *  2026-09-14), and a round has no turn ceiling unless the operator sets one. */
const NO_SUBMIT_REMINDER_TURNS = 8;

/** Time since the round opened with no submit before the Builder is asked to author, whichever of
 *  this and the turn count comes first. A turn is not a unit of time: a Claude session runs as one
 *  assistant turn, and one recorded truss Builder turn ran 6 h 27 m, so eight turns can be half an
 *  hour or most of a day, and a session that spent a night reading crosses no turn count at all.
 *  Two hours is the Builder's own bash install allowance, so the nudge cannot fire inside one
 *  permitted toolchain install. The same bound drives the one notice inside a running turn
 *  (`sessionClock` in builder-tool-receipts.ts). */
export const NO_SUBMIT_REMINDER_MS = 7_200_000;

/** Consecutive turns without one successful tool call that end the round as `no-progress`.
 *  Codex blocks a goal after three automatic turns without a tool call, or three whose commands
 *  failed with none succeeding (codex-rs/ext/goal/src/accounting.rs); one count covers both. */
export const STALLED_TURNS = 3;

/** The ask once a round has run long without a submit. The continuation states it at a turn
 *  boundary and `sessionClock` inside a running turn, so the two cannot drift apart. */
export const MOVE_TO_AUTHORING =
  "Preserve useful environment work, but move to authoring now: a refused submit returns actionable contract feedback, an unsubmitted candidate returns none.";

/** What the round has spent so far, restated at each turn boundary. */
interface GoalState {
  /** The operator's request, verbatim. */
  readonly kickoff: string;
  readonly attempts: number;
  readonly activeTurn: number;
  /** The operator's turn cap; absent, the round has none. */
  readonly maxTurns: number | undefined;
  /** Zero for a caller that keeps no start time; under a minute is not stated. */
  readonly elapsedMs: number;
}

const persist =
  "Continue towards this round's goal. The goal persists across turns: ending a turn does not end it, and only a submit the gate accepts completes it.";

const progress = `A turn that changes no file, runs no check and learns nothing that changes the next action made no progress; take the next concrete step instead of restating the plan. ${STALLED_TURNS} turns in a row without a successful tool call end the round.`;

/** The goal's facts: how far the round has come, and what is left of a cap when there is one. */
function goalFacts(goal: GoalState): string {
  const whole = Math.floor(goal.elapsedMs / 60_000);
  const minutes = whole < 1 ? "" : `, ${whole} minute${whole === 1 ? "" : "s"}`;
  const submits =
    goal.attempts === 0
      ? "no submit yet"
      : `${goal.attempts} submit${goal.attempts === 1 ? "" : "s"}, the last one refused`;
  const cap =
    goal.maxTurns === undefined
      ? ""
      : ` ${Math.max(0, goal.maxTurns - goal.activeTurn)} of ${goal.maxTurns} turns remain.`;
  return `This round so far: turn ${goal.activeTurn}${minutes}, ${submits}.${cap}`;
}

/** The one action the round's state asks for. A previous submit changes it from "author a
 *  candidate" to "repair and resubmit". No specific file is named: a repair that keeps tasks fixed
 *  must not edit correctness-model/tasks.json, so the permitted files stay the opening's to state. */
function nextAction(goal: GoalState): string {
  const stop = " Do not replace the candidate with an explanation of why you stopped.";
  if (goal.attempts > 0) {
    return `Fix what the last refusal named, and batch the fixes into one coherent candidate before the next correctness_check or submit; do not submit after each small edit.${stop}`;
  }
  const long = goal.activeTurn >= NO_SUBMIT_REMINDER_TURNS || goal.elapsedMs >= NO_SUBMIT_REMINDER_MS;
  if (long) {
    return `${MOVE_TO_AUTHORING}${stop}`;
  }
  return `Finish the candidate and submit it.${stop}`;
}

/** The continuation: the goal, the request unchanged, the round's facts, one action and the
 *  progress rule the loop enforces. */
export function continuePrompt(goal: GoalState): string {
  return [
    persist,
    `The user's request, unchanged:\n${goal.kickoff}`,
    goalFacts(goal),
    nextAction(goal),
    progress,
  ].join("\n\n");
}

/** Public runtime fact for the next turn: the owned files are still as the session found them.
 *  The sixteen-call interrupt that once enforced this ended on 2026-09-14 (never fired in 414
 *  recorded sessions, and it would have cut a session installing its toolchain); the fact stays
 *  as one line the model weighs against its own plan. */
export function unchangedAuthoringNote(owned: "unchanged" | "changed", paths: readonly string[]): string {
  return owned === "unchanged"
    ? `Note: nothing under ${paths.join(" or ")} has changed since this round opened; keep the environment work, and put the candidate in those files.`
    : "";
}

/** Public runtime fact for the next turn: which of the session's own tool calls just failed.
 *  The backend already returned each error in its tool result; this one bounded line saves the
 *  model re-deriving the tally from a long transcript. Run 66's session repeated an identical
 *  prompt for 32 turns with nothing naming the failures. Top three names keep it one line. */
export function toolFailureNote(
  calls: { total: number; failed: number; failedByName: Record<string, number> } | undefined,
): string {
  if (calls === undefined || calls.failed === 0) return "";
  const names = Object.entries(calls.failedByName)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3)
    .map(([name, count]) => `${name} x${count}`)
    .join(", ");
  return `Note: last turn ${calls.failed} of ${calls.total} tool calls failed (${names}) — read those errors before repeating the calls.`;
}
