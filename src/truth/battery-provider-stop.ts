/**
 * The battery's consecutive-provider stop rule. A provider outage or usage limit can affect every
 * live case at once, so, as the Judge does for its paid calls, after
 * BATTERY_PROVIDER_STOP_CONSECUTIVE consecutive provider-kind solver
 * non-results, no further case is scheduled. Every unscheduled task still records a typed provider
 * non-result naming the stop, so the denominator stays complete. A single provider failure never
 * stops scheduling. A non-provider result resets the count, and active cases finish normally.
 */
import { mapWithConcurrencyLimit } from "../run/session-pool.ts";
import { type SolvedCase, unattemptedCase } from "./solve-case.ts";
import type { BuildTask } from "./tasks.ts";

export const BATTERY_PROVIDER_STOP_CONSECUTIVE = 5;

/** Every case the stop rule never scheduled records this prefix, so a reader of the recorded
 *  rows counts them without re-deriving the rule or reading scheduler-local state. */
export const NEVER_ATTEMPTED_PREFIX = "not attempted: the battery stopped scheduling";

type BatteryStop = { consecutive: number; stoppedAfter: string | null };

export async function solveBatteryWithProviderStop(
  tasks: readonly BuildTask[],
  solveOne: (task: BuildTask, index: number) => Promise<SolvedCase>,
  concurrency: number,
  onSolved?: (solvedCase: SolvedCase, index: number) => Promise<void>,
  onWorkersSettled?: () => void,
): Promise<SolvedCase[]> {
  const stop: BatteryStop = { consecutive: 0, stoppedAfter: null };
  return mapWithConcurrencyLimit(
    tasks,
    concurrency,
    async (task, index) => {
      if (stop.stoppedAfter !== null) {
        return unattemptedCase(
          task,
          `${NEVER_ATTEMPTED_PREFIX} after ${BATTERY_PROVIDER_STOP_CONSECUTIVE} consecutive provider non-results (last attempted task "${stop.stoppedAfter}")`,
        );
      }
      const solvedCase = await solveOne(task, index);
      if (solvedCase.solved.nonResult?.kind === "provider") {
        stop.consecutive += 1;
        if (stop.consecutive >= BATTERY_PROVIDER_STOP_CONSECUTIVE) stop.stoppedAfter = task.taskId;
      } else {
        stop.consecutive = 0;
      }
      return solvedCase;
    },
    onSolved,
    onWorkersSettled,
  );
}
