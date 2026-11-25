/**
 * A word the operator leaves for a running campaign: one `campaign.word` event the campaign reads
 * at the next move's boundary (`pendingSignals`, `src/campaign/signal.ts`), never waited for. `--stop
 * "<why>"` ends it (ending `operator`; run again, it goes on from the log), `--tasks "<why>"` has
 * an Examiner write tasks before anything else is built or compared, and `--budget <dollars>` sets
 * the total from there on. No seat reads a word or its reason. This command and the campaign both
 * append to one log; each append is one whole-line write.
 *
 *   bun tools/campaign/signal.ts --name buffer --stop "the host is needed for something else"
 *   bun tools/campaign/signal.ts --name buffer --tasks "the last three batches all tied"
 *   bun tools/campaign/signal.ts --name buffer --budget 250
 */
import { openingOf } from "#src/campaign/opening.ts";
import { ANSWERED, type Answered } from "#src/campaign/signal.ts";
import { append, read } from "#src/kernel/log.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { campaignLog } from "./campaign.ts";

const OPTIONS = {
  name: { type: "string" },
  stop: { type: "string" },
  tasks: { type: "string" },
  budget: { type: "string" },
} as const;

export function wordCommand(args: readonly string[]): Answered {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, stop, tasks, budget } = values;
  // One flag per kind of word (`ANSWERED`).
  const [word, ...more] = ANSWERED.filter((kind) => values[kind] !== undefined);
  if (name === undefined || word === undefined || more.length > 0) {
    throw new Error('name --name and one word: --stop "<why>", --tasks "<why>" or --budget <dollars>');
  }
  const log = campaignLog(name);
  if (!existsSync(log) || openingOf(read(log)) === null) {
    throw new Error(
      `campaign ${name} has no opening on record, so no command of its own reads a word left for it: tools/campaign/harness-builder.ts opens one`,
    );
  }
  const dollars = budget === undefined ? undefined : Number(budget);
  if (dollars !== undefined && (!Number.isFinite(dollars) || dollars <= 0)) {
    throw new Error(`--budget ${String(budget)}: the campaign's total is a number of dollars above nothing`);
  }
  append(log, "campaign.word", {
    word,
    ...keyIfDefined("why", (stop ?? tasks)?.trim()),
    ...keyIfDefined("dollars", dollars),
  });
  console.log(`left for campaign ${name}: ${word}. It is read at the next move's boundary`);
  return word;
}

if (import.meta.main) {
  wordCommand(Bun.argv.slice(2));
  runtimeProcess.exitCode = 0;
}
