#!/usr/bin/env bun
/**
 * The open stack as its edges, and its top.
 *
 *   bun .claude/skills/stack-pr/scripts/stack.ts [--branch <branch>]
 *
 * The top is the end of the longest chain of open pull requests, not the highest number: a side branch
 * off the middle carries a higher one. `--branch` says where one branch sits: its parent, and what
 * is stacked on it, which decides whether it may still be rewritten. The reading is GitHub's at
 * this moment and the stack moves, so run it again before a branch, a pull request and a push.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { openPulls, type Pull } from "#tools/runtime/land.ts";

/** The stack: the longest chain of open pull requests, bottom first, and the pull requests on no
 *  such chain. A chain starts on a base that is no open pull request's head, which is `main` or a
 *  branch that has landed. Of two chains as long, the one of the lower number is the stack, so the
 *  reading does not change with the order GitHub lists them in. */
export function chain(pulls: readonly Pull[]) {
  const longest = (bases: readonly string[], seen: ReadonlySet<string>): Pull[] => {
    const children = pulls
      .filter((pull) => bases.includes(pull.baseRefName) && !seen.has(pull.headRefName))
      .sort((a, b) => a.number - b.number);
    let found: Pull[] = [];
    for (const child of children) {
      const rest = [child, ...longest([child.headRefName], new Set([...seen, child.headRefName]))];
      if (rest.length > found.length) found = rest;
    }
    return found;
  };
  const heads = new Set(pulls.map((pull) => pull.headRefName));
  const roots = [...new Set(pulls.map((pull) => pull.baseRefName))].filter((base) => !heads.has(base));
  const line = longest(roots, new Set(roots));
  return { line, sides: pulls.filter((pull) => !line.includes(pull)) };
}

const said = (pull: Pull) =>
  `#${String(pull.number)}  ${pull.headRefName}  on ${pull.baseRefName}  ${pull.headRefOid.slice(0, 7)}`;

/** What is said of the open pull requests, or of one branch among them. */
export function told(pulls: readonly Pull[], branch: string | null): string[] {
  const { line, sides } = chain(pulls);
  if (branch === null) {
    const top = line.at(-1);
    return [
      ...line.map(said),
      top === undefined
        ? "no pull request is open"
        : `top: #${String(top.number)} ${top.headRefName} at ${top.headRefOid.slice(0, 7)}`,
      ...(sides.length === 0 ? [] : ["beside the stack:", ...sides.map((pull) => `  ${said(pull)}`)]),
    ];
  }
  const own = pulls.find((pull) => pull.headRefName === branch);
  if (own === undefined) throw new CommandFailure(`no open pull request has the head ${branch}`);
  const children = pulls.filter((pull) => pull.baseRefName === branch);
  return [
    said(own),
    line.includes(own) ? "on the stack" : "beside the stack",
    children.length === 0
      ? "nothing is stacked on it: its commits may still be folded"
      : `stacked on it: ${children.map((pull) => `#${String(pull.number)}`).join(", ")}. It takes new commits only`,
  ];
}

if (import.meta.main) {
  await runCommand(
    { name: "stack", usage: "stack.ts [--branch <branch>]", options: { branch: "text" } },
    (args: CommandArgs) => {
      console.log(told(openPulls(runtimeProcess.cwd()), args.value("branch")).join("\n"));
    },
  );
}
