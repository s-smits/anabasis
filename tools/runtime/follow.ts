#!/usr/bin/env bun
/**
 * Move this checkout to the top of the open stack, on a branch named after it, or to `main` where
 * no pull request is open.
 *
 *   bun run follow
 *   bun run follow -- --if-safe    # move only where `hazards` finds nothing, else say why and stay
 *
 * The top is the end of the stack `bun run land` lands first, read by the one reader of the chain
 * of bases (`firstStack`, `tools/runtime/pulls.ts`): of the stacks of two or more, the one that holds
 * the oldest open pull request (operator, 27 October). Until 27 October it took the stack with the
 * most open pull requests, so a later stack that grew longer took the checkout off the cycle's
 * stack, and until 9 November it read GitHub's native stacks where `land` read the bases.
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
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { lstatSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { firstStack, openPulls, type Pull, trunkOf } from "./pulls.ts";

/** Where `follow` moves a checkout: its branch, the branch on origin it tracks, how a line names it,
 *  the open pull requests it holds, bottom first, and the trunk, the one branch beside `stack-pr<N>`
 *  that follow owns. */
interface Target {
  readonly trunk: string;
  readonly name: string;
  readonly upstream: string;
  readonly said: string;
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

/** Where `follow` moves a checkout for the open stack `line`, bottom first: `stack-pr<top>` tracking
 *  the top's branch, or the trunk where `line` is empty. The branch is named here alone. */
export function targetOf(line: readonly Pull[], trunk: string): Target {
  const top = line.at(-1);
  return top === undefined
    ? { trunk, name: trunk, upstream: `origin/${trunk}`, said: `origin/${trunk}`, pulls: [] }
    : {
        trunk,
        name: `stack-pr${String(top.number)}`,
        upstream: `origin/${top.headRefName}`,
        said: `#${String(top.number)} ${top.headRefName}`,
        pulls: line.map((pull) => pull.number),
      };
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

/** Why moving the checkout at `root`, its top-level folder, to `target` now could lose or disturb
 *  work, one reason a line, or none where the move is safe. The hourly pass of ana.follow moves the
 *  checkout only then, and leaves stashing, saving and clearing to its three daily passes (operator,
 *  6 November 2026: follow hourly, but never cost local work or block more than it must).
 *  Uncommitted changes are no reason in themselves, since `follow` carries them: only where they
 *  would not merge onto the new top. Each check reads git or the file system and moves nothing. */
export function hazards(root: string, target: Target, now = Date.now()): string[] {
  const { name, upstream } = target;
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
  if (was !== null && was !== name && was !== target.trunk && !STACK_BRANCH.test(was)) {
    found.push(`the checkout is on ${was}, which follow does not own`);
  }
  const listed = (...args: string[]) =>
    gitText(root, ...args, "-z")
      .split("\0")
      .filter(Boolean);
  const touched = [
    ...new Set([
      ...listed("ls-files", "-m"),
      ...listed("ls-files", "-o", "--exclude-standard"),
      ...listed("diff", "--cached", "--name-only"),
    ]),
  ].filter((path) => now - (changedAt(join(root, path)) ?? -Infinity) < QUIET_MS);
  if (touched.length > 0) {
    found.push(`edited in the last ${String(QUIET_MS / 60_000)} minutes: ${touched.slice(0, 5).join(", ")}`);
  }
  // What the top changes, read once: the files it adds, and the files it touches at all.
  const theirs = gitText(root, "diff", "--name-status", "--no-renames", "-z", "HEAD", upstream).split("\0");
  const changedByTop = theirs.filter((_, index) => index % 2 === 1);
  // Any file here at a path the top adds is in the way, ignored ones too: the switch refuses to
  // overwrite those as well, so no ignored local file is lost unseen (landing review, 7 November 2026).
  const inWay = changedByTop.filter(
    (path, index) => theirs[index * 2] === "A" && changedAt(join(root, path)) !== null,
  );
  if (inWay.length > 0) found.push(`files the top adds are here already: ${inWay.slice(0, 5).join(", ")}`);
  const changes = gitText(root, "stash", "create");
  const merges =
    changes === "" ||
    gitMaybe(root, "merge-tree", "--write-tree", "--no-messages", "--merge-base=HEAD", upstream, changes) !==
      null;
  if (!merges) {
    const both = listed("diff", "--name-only", "--no-renames", "HEAD", changes).filter((path) =>
      changedByTop.includes(path),
    );
    found.push(`uncommitted changes would conflict with the top: ${both.slice(0, 5).join(", ")}`);
  }
  const working = workingIn(root);
  if (working.length > 0) {
    found.push(`work is running here: ${working.map((command) => command.slice(0, 80)).join("; ")}`);
  }
  return found;
}

/** Move the checkout at `root`, its top-level folder, to `target`, fetched already, and say what
 *  moved. */
export function follow(root: string, target: Target): string[] {
  const { name, upstream } = target;
  const was = gitMaybe(root, "symbolic-ref", "--short", "-q", "HEAD");
  const from = gitText(root, "rev-parse", "HEAD");
  const to = gitText(root, "rev-parse", upstream);
  const held = gitText(root, "worktree", "list", "--porcelain")
    .split("\n\n")
    .map((entry) => entry.split("\n"))
    .find((lines) => lines.includes(`branch refs/heads/${name}`) && lines[0] !== `worktree ${root}`);
  if (held !== undefined) {
    throw new Error(`${name} is checked out in ${held[0]?.slice(9) ?? "another worktree"}`);
  }
  const stashes = (): string[] => gitText(root, "stash", "list", "--format=%H").split("\n");
  const before = stashes();
  gitText(root, "stash", "push", "-q", "-m", `follow: ${was ?? from.slice(0, 7)} to ${name}`);
  const saved = stashes()[0] ?? "";
  const stashed = saved !== "" && !before.includes(saved);
  const at = (): string => `stash@{${String(stashes().indexOf(saved))}}`;
  try {
    gitText(root, "switch", "-q", "--no-overwrite-ignore", "--track", "-C", name, upstream);
  } catch (error) {
    if (stashed) gitText(root, "stash", "pop", "-q", at());
    throw error;
  }
  const said = [
    from === to && was === name
      ? `${name} is already at ${target.said} (${to.slice(0, 7)})`
      : `${name} at ${target.said} (${to.slice(0, 7)}), was ${was ?? "detached"} at ${from.slice(0, 7)}`,
    target.pulls.length === 0 ? "no pull request is open" : `holds #${target.pulls.join(", #")}`,
  ];
  if (was !== null && was !== name && STACK_BRANCH.test(was)) {
    gitText(root, "branch", "-D", was);
    said.push(`deleted ${was}`);
  }
  if (stashed) {
    if (gitMaybe(root, "stash", "pop", "-q", at()) === null) {
      throw new Error(`your changes conflict with ${name}: resolve them, then drop ${at()}`);
    }
    said.push("your uncommitted changes are back");
  }
  if (gitMaybe(root, "diff", "--quiet", from, to, "--", "bun.lock") === null) {
    runSync(["bun", "install", "--frozen-lockfile"], { cwd: root });
    said.push("bun.lock moved: ran bun install --frozen-lockfile");
  }
  return said;
}

/** What the command prints for `argv`: the move, or under `--if-safe` the reasons it stayed. */
function main(argv: readonly string[]): string[] {
  const { values } = parseArgs({ args: [...argv], options: { "if-safe": { type: "boolean" } } });
  const root = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
  gitText(root, "fetch", "-q", "--prune", "origin");
  const target = targetOf(firstStack(openPulls(root)), trunkOf(root));
  const moves =
    gitMaybe(root, "symbolic-ref", "--short", "-q", "HEAD") !== target.name ||
    gitText(root, "rev-parse", "HEAD") !== gitText(root, "rev-parse", target.upstream);
  const unsafe = values["if-safe"] === true && moves ? hazards(root, target) : [];
  return unsafe.length > 0
    ? [
        `skip: not moving to ${target.name} at ${target.upstream} this time`,
        ...unsafe.map((why) => `  ${why}`),
      ]
    : follow(root, target);
}

if (import.meta.main) {
  try {
    console.log(main(Bun.argv.slice(2)).join("\n"));
  } catch (error) {
    console.error(`follow: ${errorMessage(error).replaceAll("\n", " ")}`);
    runtimeProcess.exit(1);
  }
}
