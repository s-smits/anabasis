/**
 * D1b's supply reading of a log, with no session and no model:
 *
 *   bun tools/d1b/supply.ts --log .ana/d2/truss/log.jsonl
 *
 * It prints what `examine.ts` prints when a session ends (`src/examiner/supply.ts`): the tasks the
 * Examiner sessions wrote, the word each was told, what each gate refused and why, and the plan's
 * supply rule. A log on disk can be read again whenever the reading learns to count something more,
 * which is how a reason that was not counted when the sessions ran is read without running them
 * again.
 */
import { supply } from "#src/examiner/supply.ts";
import { read } from "#src/kernel/log.ts";
import { parseArgs } from "#src/meta/process.ts";

const { values } = parseArgs({ options: { log: { type: "string" } } });
if (values.log === undefined) throw new Error("name --log");
console.log(JSON.stringify(supply(read(values.log)), null, 2));
