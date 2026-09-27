/**
 * The battery stops scheduling after five consecutive provider non-results, the same rule the Judge
 * census applies to its own calls. A provider outage or usage limit takes every live case at once,
 * so paying for the rest of the battery buys only more of the same non-result. It also stops at the
 * first case whose turn the controller refused, because the run's spent budget or its stop refuses
 * every later turn too; that stop is the controller's, so it is named apart from a provider stop.
 *
 * Each task it never schedules still records a typed non-result naming the stop, so the
 * denominator stays whole and the round reads as operational rather than short. Any other result
 * resets the provider count, and cases already in flight finish normally.
 *
 * A reused case is a recorded solve graded again rather than a provider call, so it neither
 * advances nor resets the count, and a stop never turns it into an unattempted row: the recorded
 * solve exists whatever the provider is doing now.
 */
import { mapWithConcurrencyLimit } from "../run/session-pool.ts";
import { type SolvedCase, unattemptedCase } from "./solve-case.ts";
import { type SolverNonResult, TURN_PERMIT_REFUSED_PREFIX } from "./solve.ts";
import type { BuildTask } from "./tasks.ts";

export const BATTERY_PROVIDER_STOP_CONSECUTIVE = 5;

/** The prefix of every never-scheduled case's non-result, so a reader of the recorded rows counts
 *  them without re-deriving the rule. */
export const NEVER_ATTEMPTED_PREFIX = "not attempted: the battery stopped scheduling";

/** The never-attempted reason of a battery the controller stopped by refusing a turn permit. */
export const TURN_REFUSED_STOP_PREFIX = `${NEVER_ATTEMPTED_PREFIX} after the controller refused a Built turn permit`;

/** What the pool reports as it goes, and which tasks it grades from a recorded solve. */
interface BatteryPoolHooks {
  onSolved?: (solvedCase: SolvedCase, index: number) => Promise<void>;
  onWorkersSettled?: () => void;
  reused?: (task: BuildTask) => boolean;
}

export function solveBatteryWithProviderStop(
  tasks: readonly BuildTask[],
  solveOne: (task: BuildTask, index: number) => Promise<SolvedCase>,
  concurrency: number,
  hooks: BatteryPoolHooks = {},
): Promise<SolvedCase[]> {
  let consecutive = 0;
  let stopped: SolverNonResult | null = null;
  const solveUnlessStopped = async (task: BuildTask, index: number): Promise<SolvedCase> => {
    if (hooks.reused?.(task) === true) return solveOne(task, index);
    if (stopped !== null) return unattemptedCase(task, stopped);
    const solvedCase = await solveOne(task, index);
    const { nonResult } = solvedCase.solved;
    const last = `(last attempted task "${task.taskId}")`;
    if (nonResult?.message.startsWith(TURN_PERMIT_REFUSED_PREFIX) === true) {
      stopped ??= { kind: "runtime", message: `${TURN_REFUSED_STOP_PREFIX} ${last}` };
    }
    consecutive = nonResult?.kind === "provider" ? consecutive + 1 : 0;
    if (consecutive >= BATTERY_PROVIDER_STOP_CONSECUTIVE) {
      stopped ??= {
        kind: "provider",
        message: `${NEVER_ATTEMPTED_PREFIX} after ${BATTERY_PROVIDER_STOP_CONSECUTIVE} consecutive provider non-results ${last}`,
      };
    }
    return solvedCase;
  };
  return mapWithConcurrencyLimit(
    tasks,
    concurrency,
    solveUnlessStopped,
    hooks.onSolved,
    hooks.onWorkersSettled,
  );
}
