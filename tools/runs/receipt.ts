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
 *
 *   bun run runs source <name> [--holds <commit>]...
 *
 * `source` says each run's commit, whether its tree was clean, the load it started under, where the
 * commit is published and whether it holds a named fix: the first two checks of "was the mechanism
 * live in run X" (attribution-and-proof), what an outside reader can open (oracle-handover) and
 * whether a patch can reach a live run (run-improvement-campaign). It prints no flag and no path a
 * receipt holds. Until 15 October it was a skill script that took the campaign's folder.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { readNamed } from "./registry.ts";

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
  /** The login it ran as (`runs launch --login`), absent before 15 October and where none was named. */
  readonly login?: string;
}

const RECEIPT = /^launch-(.+)\.json$/;
/** The refs `source` names of one commit before it counts the rest. */
const SHOWN = 3;

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

/** The lines `source` says of the runs beside `log`, read against repository `repo`. */
export function sources(log: string, repo: string, fixes: readonly string[]): string[] {
  const launches = receipts(log);
  if (launches.length === 0) {
    return ["no launch receipt: every round here was started by hand, and its commit is on no record"];
  }
  return launches.flatMap((launch) => {
    // The remote branches and the tags that hold the commit: where an outside reader can open it,
    // and a tag `run/<name>/<n>` (run-management) keeps it after its branch is rewritten. None for a
    // commit never pushed, and for one this repository does not hold.
    const refs = ["--format=%(refname:lstrip=2)", "refs/remotes", "refs/tags"];
    const branches = (gitMaybe(repo, "for-each-ref", "--contains", launch.commit, ...refs) ?? "")
      .split("\n")
      .filter((line) => line !== "" && !line.endsWith("/HEAD"));
    const more = branches.length > SHOWN ? ` and ${String(branches.length - SHOWN)} more` : "";
    const published =
      branches.length === 0 ? "on no remote branch" : `on ${branches.slice(0, SHOWN).join(", ")}${more}`;
    return [
      `${launch.session}  ${launch.at}  ${launch.commit.slice(0, 9)}  ${launch.dirty ? "with uncommitted changes" : "clean"}  load ${launch.load.toFixed(1)} on ${String(launch.cores)} cores  bun ${launch.bun ?? "unknown"}`,
      `  published ${published}`,
      // Whether the commit holds the fix among its ancestors: false for a fix it does not hold and
      // for either commit unknown here, which is why a restacked fix is asked for by its replayed
      // commit.
      ...fixes.map(
        (fix) =>
          `  ${gitMaybe(repo, "merge-base", "--is-ancestor", fix, launch.commit) === null ? "does not hold" : "holds"} ${fix.slice(0, 9)}`,
      ),
    ];
  });
}

/** `bun run runs source`. */
export function source(args: readonly string[]): void {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { holds: { type: "string", multiple: true, default: [] } },
  });
  const [name] = positionals;
  if (name === undefined) throw new Error("usage: bun run runs source <name> [--holds <commit>]...");
  const run = readNamed(name);
  console.log(sources(run.path, run.tree, values.holds).join("\n"));
}
