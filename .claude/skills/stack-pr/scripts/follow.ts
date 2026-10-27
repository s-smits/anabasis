#!/usr/bin/env bun
/**
 * Move this checkout to the top of the open stack, on a branch named after it, or to `main` where
 * no pull request is open.
 *
 *   bun run follow
 *
 * The top is the last pull request of GitHub's open native stack (`gh api .../stacks`), or, where
 * GitHub holds none, the end of the longest chain of bases (`stack.ts`). The checkout lands on
 * `stack-pr<top>`, tracking the top's branch, and an earlier `stack-pr<N>` branch is deleted. On
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
import { runSync } from "#src/meta/subprocess.ts";
import { ghOrThrow, openPulls } from "#tools/runtime/land.ts";
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

/** The top of the open native stack holding the most open pull requests, the lower number of two
 *  as long, or undefined where GitHub holds no open one. */
export function nativeTop(stacks: readonly NativeStack[]): Top | undefined {
  const longest = stacks
    .flatMap((stack) =>
      stack.open ? [{ stack, open: stack.pull_requests.filter((pull) => pull.state === "open") }] : [],
    )
    .toSorted((a, b) => b.open.length - a.open.length || a.stack.number - b.stack.number)[0];
  const top = longest?.open.at(-1);
  if (longest === undefined || top === undefined) return undefined;
  return { number: top.number, branch: top.head.ref, pulls: longest.open.map((pull) => pull.number) };
}

function topNow(root: string): Top | undefined {
  const stacks = parseJsonAs<NativeStack[]>(ghOrThrow(root, ["api", STACKS]));
  const native = nativeTop(stacks);
  if (native !== undefined) return native;
  const line = chains(openPulls(root)).stacks[0] ?? [];
  const top = line.at(-1);
  if (top === undefined) return undefined;
  return { number: top.number, branch: top.headRefName, pulls: line.map((pull) => pull.number) };
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
  await runCommand({ name: "follow", usage: "bun run follow" }, () => {
    const root = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
    gitText(root, "fetch", "-q", "--prune", "origin");
    console.log(follow(root, topNow(root)).join("\n"));
  });
}
