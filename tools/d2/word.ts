/**
 * A word the operator leaves for a campaign that is running:
 *
 *   bun tools/d2/word.ts --name buffer --stop "the host is needed for something else"
 *   bun tools/d2/word.ts --name buffer --tasks "the last three batches all tied"
 *   bun tools/d2/word.ts --name buffer --budget 250
 *
 * Until 2026-10-09 the operator could steer a campaign only by running a command, which meant
 * stopping the one that ran (`docs/plan.md`, row F50). A word is one event in the campaign's log
 * (`campaign.word`). The campaign command reads it at the next move's boundary
 * (`pendingWords`, `src/builder/word.ts`), so it changes the move after the one that is running
 * and nothing in it, and it is never waited for: a campaign with no word left goes on.
 *
 *   --stop    the campaign ends there on the operator's word (`campaign.ended`, ending
 *             `operator`). Run again, its command goes on from the log.
 *   --tasks   an Examiner session writes other tasks before anything else is built or compared.
 *   --budget  the campaign's total in dollars from there on: what is left of it caps each move.
 *
 * Until 20 October `--cause` released a campaign its A/A control had ended; an older log may hold
 * such a word, which nothing reads now.
 *
 * Each takes effect once: the event that acts on a word names it. Nothing here reaches a seat. A
 * word is the operator's to the campaign's controller, and no Builder, Examiner, solver or
 * reviewer reads it or its reason.
 *
 * Two processes write one log here, this command and the campaign's. An append is one write of
 * one line at the log's end, which a local filesystem keeps whole.
 */
import { openingOf } from "#src/builder/opening.ts";
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

/** `bun tools/d2/word.ts`. Returns the word it left. */
export function wordCommand(args: readonly string[]): string {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, stop, tasks, budget } = values;
  const given = [stop, tasks, budget].filter((each) => each !== undefined).length;
  if (name === undefined || given !== 1) {
    throw new Error('name --name and one word: --stop "<why>", --tasks "<why>" or --budget <dollars>');
  }
  const log = campaignLog(name);
  if (!existsSync(log) || openingOf(read(log)) === null) {
    throw new Error(
      `campaign ${name} has no opening on record, so no command of its own reads a word left for it: tools/d2/harness-builder.ts opens one`,
    );
  }
  const dollars = budget === undefined ? undefined : Number(budget);
  if (dollars !== undefined && (!Number.isFinite(dollars) || dollars <= 0)) {
    throw new Error(`--budget ${String(budget)}: the campaign's total is a number of dollars above nothing`);
  }
  const word =
    [
      ["stop", stop],
      ["tasks", tasks],
    ].find(([, why]) => why !== undefined)?.[0] ?? "budget";
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
