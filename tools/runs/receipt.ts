/**
 * What a run keeps of its start beside the campaign's log, `launch-<session>.json`: the flags, the
 * commit, whether the tree was dirty, the load it started under and the Bun. The log holds the
 * host's code by content and no commit, so this is where a run's commit is on record, and the flags
 * are what a campaign is run again on (`bun run runs continue`).
 *
 * The campaign command keeps one a run, as `launch-run-<n>.json` (`keepReceipt`,
 * `tools/d2/harness-builder.ts`), and `bun run runs launch` writes its output beside it under the
 * same `n` (`nextRun`). Until 10 October the command kept none; until 11 October the launcher kept
 * one for each round, checkpoint or session it started, under that session's id, and a campaign of
 * then holds those. Until 15 October two readers numbered the next run, and one reader left the
 * flags out and another read them again from the file.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";

export interface Receipt {
  readonly at: string;
  readonly pid: number;
  readonly flags: readonly string[];
  /** The env file's path, which the launcher kept until 11 October; null since. */
  readonly envFile: string | null;
  readonly commit: string;
  readonly dirty: boolean;
  readonly load: number;
  readonly cores: number;
  /** The Bun that ran it, absent before 15 October: seats ran a global 1.4.2 under a pin of 1.4.3. */
  readonly bun?: string;
}

const RECEIPT = /^launch-(.+)\.json$/;

/** Keep `receipt` as the run of `session` beside `log`. */
export function writeReceipt(log: string, session: string, receipt: Receipt): void {
  writeFileSync(join(dirname(log), `launch-${session}.json`), `${capturedJsonStringify(receipt, null, 2)}\n`);
}

/** Every receipt beside `log`, oldest first, with the session it was kept under. None for a
 *  campaign whose rounds were started by hand or that has not started. */
export function receipts(log: string): (Receipt & { readonly session: string })[] {
  const folder = dirname(log);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .flatMap((file) => {
      const session = RECEIPT.exec(file)?.[1];
      if (session === undefined) return [];
      return [{ ...parseJsonAs<Receipt>(readFileSync(join(folder, file), "utf8")), session }];
    })
    .toSorted((one, other) => one.at.localeCompare(other.at));
}

/** The session the next run of the campaign command beside `log` keeps its receipt under. */
export function nextRun(log: string): string {
  const kept = receipts(log).filter(({ session }) => session.startsWith("run-")).length;
  return `run-${String(kept + 1)}`;
}
