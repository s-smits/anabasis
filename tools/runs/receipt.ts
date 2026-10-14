/**
 * What a run keeps of its start beside the campaign's log: `launch-<session>.json`, the flags, the
 * commit, whether the tree was dirty, and the load it started under. The log holds the host's
 * code by content and no commit, so this is where a run's commit is on record. The campaign
 * command keeps one a run, as `launch-run-<n>.json` (`tools/d2/harness-builder.ts`); until
 * 10 October it kept none, and the flag line of the run that recorded a campaign's setting was on
 * no record. Until 11 October `bun run runs launch` wrote one too, for a round, a checkpoint or a
 * session it started; the launcher went, and the campaign command is the one way to start a move
 * (`docs/simplify.md`, D2).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";

export interface Receipt {
  readonly at: string;
  readonly pid: number;
  readonly flags: readonly string[];
  readonly envFile: string | null;
  readonly commit: string;
  readonly dirty: boolean;
  readonly load: number;
  readonly cores: number;
  /** The Bun that ran it, absent before 15 October: seats ran a global 1.4.2 under a pin of 1.4.3. */
  readonly bun?: string;
}

/** Where the run of `session` keeps its receipt and its output, less the extension. */
const kept = (log: string, session: string) => join(dirname(log), `launch-${session}`);

/** Keep `receipt` as the run of `session` beside `log`. */
export function writeReceipt(log: string, session: string, receipt: Receipt): void {
  writeFileSync(`${kept(log, session)}.json`, `${capturedJsonStringify(receipt, null, 2)}\n`);
}

/** Every run whose receipt sits beside `log`, oldest first, less the flags and the env file's path
 *  a receipt also holds. None for a campaign whose rounds were started by hand. */
export function launchesOf(log: string) {
  const folder = dirname(log);
  return readdirSync(folder)
    .flatMap((file) => {
      const session = /^launch-(.+)\.json$/.exec(file)?.[1];
      // A receipt is beside the log for a run, and none for a round started by hand.
      if (session === undefined || !existsSync(`${kept(log, session)}.json`)) return [];
      const {
        at,
        commit,
        dirty,
        load,
        cores,
        bun = "unknown",
      } = parseJsonAs<Receipt>(readFileSync(`${kept(log, session)}.json`, "utf8"));
      return [{ session, at, commit, dirty, load, cores, bun }];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}
