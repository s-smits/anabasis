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
 *   bun run runs source <name> [--holds <commit>]... [--has <text>]...
 *   bun run runs source (--holds <commit> | --has <text>)...
 *
 * `source` says each run's commit, whether its tree was clean, the load it started under, where the
 * commit is published and whether it holds a named fix: the first two checks of "was the mechanism
 * live in run X" (attribution-and-proof), what an outside reader can open (oracle-handover) and
 * whether a patch can reach a live run (run-improvement-campaign). It prints no flag and no path a
 * receipt holds. Until 15 October it was a skill script that took the campaign's folder.
 *
 * Without a name it lists every campaign a reader reads whose every launch carries what is asked
 * (`ranWith`), and `runs replay` takes the same flags. A fix is asked for by its commit (`--holds`),
 * or by text its code holds (`--has`, in `src`, `tools` and `packages`), which a restack that rewrote the fix's commits leaves in
 * place: both #306 runs of 21 October ran an earlier head of #306, which no later head holds. The
 * operator asked on 21 October that runs be compared and triaged only with runs that had the
 * mechanism in question, and a run that lacks it is none of its evidence (AGENTS.md, section 9).
 * Named runs use the same predicate before printing their details. The selector regression tests
 * of 26 October showed that this branch ignored `--has` and printed mixed launches for `--holds`.
 * More than one name is refused: otherwise the first name silently discarded the others.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { compareCodeUnits } from "#src/meta/stable-json.ts";
import { parseArgs } from "#src/meta/process.ts";
import { isCampaign } from "./registry.ts";
import { readAcross, readableAcross } from "./snapshots.ts";

/** What a run is asked to have run with: commits its launch holds, and text its source holds. */
interface Asked {
  readonly holds: readonly string[];
  readonly has: readonly string[];
}

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

/** Where `--has` looks: the code a run executes, and none of the documents that name a mechanism
 *  before it is built. */
const CODE = ["src", "tools", "packages"];
const runOf = (session: string) => Number(/^run-(\d+)$/.exec(session)?.[1] ?? 0);

/** Keep `receipt` as the run of `session` beside `log`. */
export function writeReceipt(log: string, session: string, receipt: Receipt): void {
  writeFileSync(join(dirname(log), `launch-${session}.json`), `${capturedJsonStringify(receipt, null, 2)}\n`);
}

/** Every receipt beside `log`, oldest first, with the session it was kept under. None for a
 *  campaign whose rounds were started by hand or that has not started. Two runs started in one
 *  millisecond are ordered by their number, which `nextRun` gave them in turn. */
export function receipts(log: string): (Receipt & { readonly session: string })[] {
  const folder = dirname(log);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .flatMap((file) => {
      const session = RECEIPT.exec(file)?.[1];
      if (session === undefined) return [];
      return [{ ...parseJsonAs<Receipt>(readFileSync(join(folder, file), "utf8")), session }];
    })
    .toSorted(
      (one, other) => compareCodeUnits(one.at, other.at) || runOf(one.session) - runOf(other.session),
    );
}

/** The receipt of the last run of the campaign command beside `log`, if one kept one. */
export const lastLaunch = (log: string) =>
  receipts(log).findLast(({ session }) => session.startsWith("run-"));

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

/** Whether every launch of the campaign at `log` ran with what `asked` names, read in `repo`: false
 *  for a campaign with no receipt, whose code is on no record, and for a commit unknown here. */
export function ranWith(log: string, repo: string, asked: Asked): boolean {
  const launches = receipts(log);
  return (
    launches.length > 0 &&
    launches.every(
      ({ commit }) =>
        asked.holds.every((fix) => gitMaybe(repo, "merge-base", "--is-ancestor", fix, commit) !== null) &&
        asked.has.every(
          (text) => gitMaybe(repo, "grep", "-q", "-F", "-e", text, commit, "--", ...CODE) !== null,
        ),
    )
  );
}

/** The `--holds` and `--has` flags `source` and `replay` read, with their other arguments. */
export function askedIn(args: readonly string[]): { asked: Asked; names: string[] } {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      holds: { type: "string", multiple: true, default: [] },
      has: { type: "string", multiple: true, default: [] },
    },
  });
  return { asked: values, names: positionals };
}

/** `bun run runs source`. */
export async function source(args: readonly string[]): Promise<void> {
  const { asked, names } = askedIn(args);
  if (names.length > 1) throw new Error("source takes at most one run name");
  const asks = asked.holds.length + asked.has.length > 0;
  const [name] = names;
  if (name !== undefined) {
    const run = await readAcross(name);
    if (!asks || ranWith(run.path, run.tree, asked)) {
      console.log(sources(run.path, run.tree, asked.holds).join("\n"));
    }
    return;
  }
  if (!asks) {
    throw new Error("usage: bun run runs source <name> | (--holds <commit> | --has <text>)...");
  }
  for (const run of (await readableAcross()).filter(
    (one) => isCampaign(one) && ranWith(one.path, one.tree, asked),
  )) {
    console.log(run.name);
  }
}
