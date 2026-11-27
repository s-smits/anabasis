import type { CommandArgs } from "#skills/main/cli.ts";
import { conditionsOf, type Limits, settingId } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { ended, ranUnder, rejected, standsOf } from "#src/kernel/solves.ts";

export function trialTerms(args: CommandArgs) {
  const solves = args.int("solves") ?? 1;
  const count = args.int("tasks");
  const level = args.number("level") ?? 0.02;
  const cap = args.number("cap");
  // `args.int` refuses what is not a whole number.
  if (solves < 1) args.die("--solves needs a positive whole number");
  if (count !== null && count < 1) args.die("--tasks needs a positive whole number");
  if (!(level > 0 && level < 1)) args.die("--level must be between 0 and 1");
  return { solves, count, level, cap };
}

/** A trial name may be reused only for the system its log recorded. Historical reads use the
 *  original host setting; additional solves must also match the current seat configuration. */
export function checkTrial(
  events: readonly LogEvent[],
  expected: {
    name: string;
    harness: string;
    contract: string;
    model: string;
    effort: string;
    limits: Limits;
  },
  resumeSetting?: string,
): void {
  let setting = resumeSetting;
  for (const condition of conditionsOf(events).values()) {
    const recorded = settingId(condition);
    setting ??= recorded;
    if (
      recorded !== setting ||
      condition.side !== "test" ||
      condition.harness !== expected.harness ||
      condition.contract !== expected.contract ||
      condition.model !== expected.model ||
      condition.effort !== expected.effort ||
      condition.limits.wallSeconds !== expected.limits.wallSeconds ||
      condition.limits.modelTurns !== expected.limits.modelTurns
    ) {
      throw new Error(
        `trial ${expected.name} records another harness or setting; give a new system its own name`,
      );
    }
  }
}

/** A cut Referee call has no ruling. A later ruling or a hand label settles the rejection. */
export function unruledIn(events: readonly LogEvent[]) {
  const stands = standsOf(events);
  return ended(ranUnder(events)).filter((solve) => rejected(solve.ending) && stands.get(solve.id) == null);
}
