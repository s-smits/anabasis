/**
 * The battery stops scheduling after five consecutive provider non-results, the same rule the Judge
 * census applies to its own calls. A provider outage or usage limit takes every live case at once,
 * so paying for the rest of the battery buys only more of the same non-result.
 *
 * Each task it never schedules still records a typed provider non-result naming the stop, so the
 * denominator stays whole and the round reads as operational rather than short. Any other result
 * resets the count, and cases already in flight finish normally.
 */
import { mapWithConcurrencyLimit } from "../run/session-pool.ts";
import { type SolvedCase, unattemptedCase } from "./solve-case.ts";
import type { BuildTask } from "./tasks.ts";

export const BATTERY_PROVIDER_STOP_CONSECUTIVE = 5;

/** The prefix of every never-scheduled case's non-result, so a reader of the recorded rows counts
 *  them without re-deriving the rule. */
export const NEVER_ATTEMPTED_PREFIX = "not attempted: the battery stopped scheduling";

export function solveBatteryWithProviderStop(
  tasks: readonly BuildTask[],
  solveOne: (task: BuildTask, index: number) => Promise<SolvedCase>,
  concurrency: number,
  onSolved?: (solvedCase: SolvedCase, index: number) => Promise<void>,
  onWorkersSettled?: () => void,
): Promise<SolvedCase[]> {
  let consecutive = 0;
  let stoppedAfter: string | null = null;
  const solveUnlessStopped = async (task: BuildTask, index: number): Promise<SolvedCase> => {
    if (stoppedAfter !== null) {
      return unattemptedCase(
        task,
        `${NEVER_ATTEMPTED_PREFIX} after ${BATTERY_PROVIDER_STOP_CONSECUTIVE} consecutive provider non-results (last attempted task "${stoppedAfter}")`,
      );
    }
    const solvedCase = await solveOne(task, index);
    consecutive = solvedCase.solved.nonResult?.kind === "provider" ? consecutive + 1 : 0;
    if (consecutive >= BATTERY_PROVIDER_STOP_CONSECUTIVE) stoppedAfter = task.taskId;
    return solvedCase;
  };
  return mapWithConcurrencyLimit(tasks, concurrency, solveUnlessStopped, onSolved, onWorkersSettled);
}
