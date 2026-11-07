#!/usr/bin/env bun
/**
 * Move this checkout to the top of the open stack, on a branch named after it, or to `main` where
 * no pull request is open.
 *
 *   bun run follow
 *   bun run follow -- --if-safe    # move only where `hazards` finds nothing, else say why and stay
 *
 * The top is the last pull request of GitHub's open native stack (`gh api .../stacks`), or, where
 * GitHub holds none, the end of a chain of bases (`stack.ts`). Of several open stacks it follows
 * the one that holds the oldest open pull request and leaves the later ones alone, as `bun run
 * land` lands that one first (operator, 27 October). Until then it took the stack with the most
 * open pull requests, so a later stack that grew longer took the checkout off the cycle's stack.
 * The checkout lands on `stack-pr<top>`, tracking the top's branch, and an earlier `stack-pr<N>` branch is deleted. On
 * 18 October the main checkout sat on `stack-pr197` after the stack was restacked onto a newer
 * main and grew to #199, four commits ahead and six behind, where a fast-forward no longer reaches.
 *
 * Where no pull request is open the checkout lands on `main`, tracking `origin/main`, which holds
 * whatever landed, and the `stack-pr<N>` it left is deleted. Until 19 October it refused there
 * with "no pull request is open" and moved nothing, so a checkout on the last stack's branch stayed
 * behind `main` once that stack merged; on 19 October none was open.
 *
 * The branch is reset to the top: what matters is on GitHub, so a commit made on it is not kept.
 * Changes to tracked files are stashed and popped back on the new top, by the stash's own commit,
 * so that a stash another worktree pushed meanwhile is never the one popped. A switch git refuses
 * pops them back where they were. A branch another worktree has checked out is refused before
 * anything moves: git before 2.42, as on the Linux runner (2.34), resets it under that worktree.
 */
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { lstatSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { ghOrThrow, openPulls, type Pull } from "#tools/runtime/pulls.ts";
import { chains } from "./stack.ts";

/** Where GitHub lists the repository's native stacks. */
export const STACKS = "repos/{owner}/{repo}/stacks";

/** One of GitHub's native stacks, as `GET` on `STACKS` lists it. */
export interface NativeStack {
  readonly number: number;
  readonly open: boolean;
  readonly pull_requests: readonly {
    readonly number: number;
    readonly state: string;
    readonly head: { readonly ref: string };
  }[];
}

/** The pull request a checkout follows, and every open one beneath it, bottom first. */
export interface Top {
  readonly number: number;
  readonly branch: string;
  readonly pulls: readonly number[];
}

const STACK_BRANCH = /^stack-pr\d+$/;
/** A git operation under way leaves one of these in the git folder; a move then would cut it. */
const UNDER_WAY = [
  "index.lock",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
  "rebase-merge",
  "rebase-apply",
];
/** Work a switch would pull files from under: git itself, or Bun landing, checking or installing.
 *  A watcher such as `runs loadwatch`, alive for days, holds its code in memory and is no reason. */
const WORKING = /^\S*git\b|\b(land|gate|test|typecheck|lint|install|preflight|simplify)\b|tools\/runtime\//;
/** A file touched this recently means someone is editing here now. */
const QUIET_MS = 10 * 60_000;

/** The top of the open native stack that holds the oldest open pull request, or undefined where
 *  GitHub holds no open one. A pull request of `pulls` stacked on that top before anyone linked it
 *  is the top: on 6 November follow stopped at #657 while #658 stood on it, unlinked. */
export function nativeTop(stacks: readonly NativeStack[], pulls: readonly Pull[] = []): Top | undefined {
  const oldest = stacks
    .flatMap((stack) => {
      const open = stack.pull_requests.filter((pull) => pull.state === "open");
      return stack.open && open.length > 0
        ? [{ open, first: Math.min(...open.map((pull) => pull.number)) }]
        : [];
    })
    .toSorted((a, b) => a.first - b.first)[0];
  const top = oldest?.open.at(-1);
  if (oldest === undefined || top === undefined) return undefined;
  const linked = oldest.open.map((pull) => pull.number);
  const line = chains(pulls).stacks.find((stack) => stack.some((pull) => pull.number === top.number)) ?? [];
  const above = line.slice(line.findIndex((pull) => pull.number === top.number) + 1);
  const end = above.at(-1);
  return end === undefined
    ? { number: top.number, branch: top.head.ref, pulls: linked }
    : {
        number: end.number,
        branch: end.headRefName,
        pulls: [...linked, ...above.map((pull) => pull.number)],
      };
}

function topNow(root: string): Top | undefined {
  const stacks = parseJsonAs<NativeStack[]>(ghOrThrow(root, ["api", STACKS]));
  const open = openPulls(root);
  const native = nativeTop(stacks, open);
  if (native !== undefined) return native;
  const line = chains(open).stacks.toSorted((a, b) => (a[0]?.number ?? 0) - (b[0]?.number ?? 0))[0] ?? [];
  const top = line.at(-1);
  if (top === undefined) return undefined;
  return { number: top.number, branch: top.headRefName, pulls: line.map((pull) => pull.number) };
}

/** What `lsof` says of the processes whose working folder is `root`, as their command lines. */
function workingIn(root: string): string[] {
  const listed = runSync(["lsof", "-a", "-d", "cwd", "-c", "bun", "-c", "git", "-Fpn"]);
  if (listed.exitCode === null) return [];
  const pids: string[] = [];
  let pid = "";
  for (const line of decodeOutput(listed.stdout).split("\n")) {
    if (line.startsWith("p")) pid = line.slice(1);
    else if (line === `n${root}`) pids.push(pid);
  }
  if (pids.length === 0) return [];
  const commands = decodeOutput(runSync(["ps", "-o", "command=", "-p", pids.join(",")]).stdout);
  return commands.split("\n").filter((command) => WORKING.test(command));
}

/** Why moving the checkout at `root` to `upstream` now could lose or disturb work, one reason a
 *  line, or none where the move is safe. The hourly pass of ana.follow moves the checkout only then,
 *  and leaves stashing, saving and clearing to its three daily passes (operator, 6 November 2026:
 *  follow hourly, but never cost local work or block more than it must). Uncommitted changes are no
 *  reason in themselves, since `follow` carries them: only where they would not merge onto the new
 *  top. Each check reads git or the file system and moves nothing. */
export function hazards(root: string, name: string, upstream: string, now = Date.now()): string[] {
  const found: string[] = [];
  const changedAt = (at: string): number | null => {
    try {
      return lstatSync(at).mtimeMs;
    } catch {
      return null;
    }
  };
  const gitDir = gitText(root, "rev-parse", "--absolute-git-dir");
  const under = UNDER_WAY.filter((marker) => changedAt(join(gitDir, marker)) !== null);
  // The checks below take the index, which a git operation under way holds.
  if (under.length > 0) return [`a git operation is under way here (${under.join(", ")})`];
  const was = gitMaybe(root, "symbolic-ref", "--short", "-q", "HEAD");
  if (was !== null && was !== name && was !== "main" && !STACK_BRANCH.test(was)) {
    found.push(`the checkout is on ${was}, which follow does not own`);
  }
  const listed = (...args: string[]) =>
    gitText(root, ...args, "-z")
      .split("\0")
      .filter(Boolean);
  const untracked = listed("ls-files", "-o", "--exclude-standard");
  const touched = [
    ...new Set([...listed("ls-files", "-m"), ...untracked, ...listed("diff", "--cached", "--name-only")]),
  ].filter((path) => now - (changedAt(join(root, path)) ?? -Infinity) < QUIET_MS);
  if (touched.length > 0) {
    found.push(`edited in the last ${String(QUIET_MS / 60_000)} minutes: ${touched.slice(0, 5).join(", ")}`);
  }
  // A switch overwrites an ignored file, so only an untracked one it would refuse to lose is in the way.
  const added = new Set(listed("diff", "--name-only", "--no-renames", "--diff-filter=A", "HEAD", upstream));
  const inWay = untracked.filter((path) => added.has(path));
  if (inWay.length > 0) found.push(`files the top adds are here already: ${inWay.slice(0, 5).join(", ")}`);
  const changes = gitText(root, "stash", "create");
  if (changes !== "") {
    const merges = gitMaybe(
      root,
      "merge-tree",
      "--write-tree",
      "--no-messages",
      "--merge-base=HEAD",
      upstream,
      changes,
    );
    if (merges === null) {
      const theirs = new Set(listed("diff", "--name-only", "--no-renames", "HEAD", upstream));
      const both = listed("diff", "--name-only", "--no-renames", "HEAD", changes).filter((path) =>
        theirs.has(path),
      );
      found.push(`uncommitted changes would conflict with the top: ${both.slice(0, 5).join(", ")}`);
    }
  }
  const working = workingIn(gitText(root, "rev-parse", "--show-toplevel"));
  if (working.length > 0) {
    found.push(`work is running here: ${working.map((command) => command.slice(0, 80)).join("; ")}`);
  }
  return found;
}

/** Move the checkout at `root` to `top`, or to `main` where no pull request is open, fetched
 *  already, and say what moved. */
export function follow(root: string, top: Top | undefined): string[] {
  const name = top === undefined ? "main" : `stack-pr${String(top.number)}`;
  const upstream = `origin/${top?.branch ?? "main"}`;
  const target = top === undefined ? upstream : `#${String(top.number)} ${top.branch}`;
  const was = gitMaybe(root, "symbolic-ref", "--short", "-q", "HEAD");
  const from = gitText(root, "rev-parse", "HEAD");
  const to = gitText(root, "rev-parse", upstream);
  const here = gitText(root, "rev-parse", "--show-toplevel");
  const held = gitText(root, "worktree", "list", "--porcelain")
    .split("\n\n")
    .map((entry) => entry.split("\n"))
    .find((lines) => lines.includes(`branch refs/heads/${name}`) && lines[0] !== `worktree ${here}`);
  if (held !== undefined) {
    throw new CommandFailure(`${name} is checked out in ${held[0]?.slice(9) ?? "another worktree"}`);
  }
  const stashes = (): string[] => gitText(root, "stash", "list", "--format=%H").split("\n");
  const before = stashes();
  gitText(root, "stash", "push", "-q", "-m", `follow: ${was ?? from.slice(0, 7)} to ${name}`);
  const saved = stashes()[0] ?? "";
  const stashed = saved !== "" && !before.includes(saved);
  const at = (): string => `stash@{${String(stashes().indexOf(saved))}}`;
  try {
    gitText(root, "switch", "-q", "--track", "-C", name, upstream);
  } catch (error) {
    if (stashed) gitText(root, "stash", "pop", "-q", at());
    throw error;
  }
  const said = [
    from === to && was === name
      ? `${name} is already at ${target} (${to.slice(0, 7)})`
      : `${name} at ${target} (${to.slice(0, 7)}), was ${was ?? "detached"} at ${from.slice(0, 7)}`,
    top === undefined ? "no pull request is open" : `holds #${top.pulls.join(", #")}`,
  ];
  if (was !== null && was !== name && STACK_BRANCH.test(was)) {
    gitText(root, "branch", "-D", was);
    said.push(`deleted ${was}`);
  }
  if (stashed) {
    if (gitMaybe(root, "stash", "pop", "-q", at()) === null) {
      throw new CommandFailure(`your changes conflict with ${name}: resolve them, then drop ${at()}`);
    }
    said.push("your uncommitted changes are back");
  }
  if (gitMaybe(root, "diff", "--quiet", from, to, "--", "bun.lock") === null) {
    runSync(["bun", "install", "--frozen-lockfile"], { cwd: root });
    said.push("bun.lock moved: ran bun install --frozen-lockfile");
  }
  return said;
}

if (import.meta.main) {
  await runCommand(
    { name: "follow", usage: "bun run follow [-- --if-safe]", options: { "if-safe": "flag" } },
    (args) => {
      const root = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
      gitText(root, "fetch", "-q", "--prune", "origin");
      const top = topNow(root);
      const name = top === undefined ? "main" : `stack-pr${String(top.number)}`;
      const upstream = `origin/${top?.branch ?? "main"}`;
      const moves =
        gitMaybe(root, "symbolic-ref", "--short", "-q", "HEAD") !== name ||
        gitText(root, "rev-parse", "HEAD") !== gitText(root, "rev-parse", upstream);
      const unsafe = args.flag("if-safe") && moves ? hazards(root, name, upstream) : [];
      if (unsafe.length > 0) {
        console.log(
          [`skip: not moving to ${name} at ${upstream} this time`, ...unsafe.map((why) => `  ${why}`)].join(
            "\n",
          ),
        );
        return;
      }
      console.log(follow(root, top).join("\n"));
    },
  );
}
