/** How many of a set of tasks each family holds, read from the Examiner's proposals, for every skill
 *  script that weighs how far a set is independent evidence. It names no family. */
import { proposalsOf } from "#src/kernel/history.ts";
import type { LogEvent } from "#src/kernel/log.ts";

/** The family sizes of `tasks` (versions), largest first, and how many name no family. */
export function familySizes(events: readonly LogEvent[], tasks: readonly string[]) {
  const named = new Map(proposalsOf(events).map(({ version, family }) => [version, family]));
  const kin = Map.groupBy(tasks, (task) => named.get(task) ?? null);
  const sizes = [...kin].flatMap(([family, some]) => (family === null ? [] : [some.length]));
  return { sizes: sizes.toSorted((one, other) => other - one), unnamed: kin.get(null)?.length ?? 0 };
}
