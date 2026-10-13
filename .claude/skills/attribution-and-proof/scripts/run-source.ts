#!/usr/bin/env bun
/**
 * The source each launch of a campaign ran: its commit, whether the tree was clean, the load it
 * started under, where that commit is published, and whether it holds a named fix.
 *
 *   bun .claude/skills/attribution-and-proof/scripts/run-source.ts <campaign folder> [--holds <commit>]...
 *
 * It answers the first two checks of "was the mechanism live in run X" (attribution-and-proof),
 * what an outside reader can open (oracle-handover) and whether a patch can reach a live run
 * (run-improvement-campaign). It reads receipts and Git, and prints no flag and no path a receipt
 * holds.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { gitMaybe, gitText } from "#skills/main/git.ts";
import { join, resolve } from "#src/meta/path.ts";
import { launchesOf } from "#tools/runs/receipt.ts";

const SHOWN = 3;

/** The lines said of campaign `folder`, read against repository `repo`. */
export function told(folder: string, repo: string, fixes: readonly string[]): string[] {
  const launches = launchesOf(join(folder, "log.jsonl"));
  if (launches.length === 0) {
    return ["no launch receipt: every round here was started by hand, and its commit is on no record"];
  }
  return launches.flatMap((launch) => {
    // The remote branches that hold the commit: where an outside reader can open it. None for a
    // commit never pushed, and for one this repository does not hold.
    const branches = (gitMaybe(repo, "branch", "-r", "--contains", launch.commit) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.includes(" -> "));
    const more = branches.length > SHOWN ? ` and ${String(branches.length - SHOWN)} more` : "";
    const published =
      branches.length === 0 ? "on no remote branch" : `on ${branches.slice(0, SHOWN).join(", ")}${more}`;
    return [
      `${launch.session}  ${launch.at}  ${launch.commit.slice(0, 9)}  ${launch.dirty ? "with uncommitted changes" : "clean"}  load ${launch.load.toFixed(1)} on ${String(launch.cores)} cores`,
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

if (import.meta.main) {
  await runCommand(
    {
      name: "run-source",
      usage: "run-source.ts <campaign folder> [--holds <commit>]...",
      options: { holds: "list" },
      positionals: 1,
    },
    (args: CommandArgs) => {
      const folder = resolve(args.positionals[0] ?? "");
      const repo = gitText(folder, "rev-parse", "--show-toplevel");
      console.log(told(folder, repo, args.list("holds")).join("\n"));
    },
  );
}
