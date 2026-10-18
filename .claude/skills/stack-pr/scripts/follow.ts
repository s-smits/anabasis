#!/usr/bin/env bun
/**
 * Move this checkout to the top of the open stack, on a branch named after it.
 *
 *   bun run follow
 *
 * The top is the last pull request of GitHub's open native stack (`gh api .../stacks`), or, where
 * GitHub holds none, the end of the longest chain of bases (`stack.ts`). The checkout lands on
 * `stack-pr<top>`, tracking the top's branch, and an earlier `stack-pr<N>` branch is deleted. On
 * 18 October the main checkout sat on `stack-pr197` after the stack was restacked onto a newer
 * main and grew to #199, four commits ahead and six behind, where a fast-forward no longer reaches.
 *
 * The branch is reset to the top: what matters is on GitHub, so a commit made on it is not kept.
 * Changes to tracked files are stashed and popped back on the new top, by the stash's own commit,
 * so that a stash another worktree pushed meanwhile is never the one popped.
 */
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { runSync } from "#src/meta/subprocess.ts";
import { ghOrThrow, openPulls } from "#tools/runtime/land.ts";
import { chain } from "./stack.ts";

/** One of GitHub's native stacks, as `GET repos/{owner}/{repo}/stacks` lists it. */
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

function topNow(root: string): Top {
  const stacks = parseJsonAs<NativeStack[]>(ghOrThrow(root, ["api", "repos/{owner}/{repo}/stacks"]));
  const native = nativeTop(stacks);
  if (native !== undefined) return native;
  const { line } = chain(openPulls(root));
  const top = line.at(-1);
  if (top === undefined) throw new CommandFailure("no pull request is open");
  return { number: top.number, branch: top.headRefName, pulls: line.map((pull) => pull.number) };
}

/** Move the checkout at `root` to `top`, fetched already, and say what moved. */
export function follow(root: string, top: Top): string[] {
  const name = `stack-pr${String(top.number)}`;
  const upstream = `origin/${top.branch}`;
  const was = gitMaybe(root, "symbolic-ref", "--short", "-q", "HEAD");
  const from = gitText(root, "rev-parse", "HEAD");
  const to = gitText(root, "rev-parse", upstream);
  const stashes = (): string[] => gitText(root, "stash", "list", "--format=%H").split("\n");
  const before = stashes();
  gitText(root, "stash", "push", "-q", "-m", `follow: ${was ?? from.slice(0, 7)} to ${name}`);
  const saved = stashes()[0] ?? "";
  const stashed = saved !== "" && !before.includes(saved);
  gitText(root, "switch", "-q", "--track", "-C", name, upstream);
  const said = [
    from === to && was === name
      ? `${name} is already at #${String(top.number)} ${top.branch} (${to.slice(0, 7)})`
      : `${name} at #${String(top.number)} ${top.branch} (${to.slice(0, 7)}), was ${was ?? "detached"} at ${from.slice(0, 7)}`,
    `holds #${top.pulls.join(", #")}`,
  ];
  if (was !== null && was !== name && STACK_BRANCH.test(was)) {
    gitText(root, "branch", "-D", was);
    said.push(`deleted ${was}`);
  }
  if (stashed) {
    const at = `stash@{${String(stashes().indexOf(saved))}}`;
    if (gitMaybe(root, "stash", "pop", "-q", at) === null) {
      throw new CommandFailure(`your changes conflict with ${name}: resolve them, then drop ${at}`);
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
