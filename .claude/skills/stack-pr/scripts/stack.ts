#!/usr/bin/env bun
/**
 * The open stacks as their edges, and each one's top.
 *
 *   bun .claude/skills/stack-pr/scripts/stack.ts [--branch <branch>]
 *
 * Several stacks may be open, each a chain of pull requests whose bottom is based on `main` and
 * which lands alone (operator, 27 October). A stack's top is the end of its chain, not the highest
 * number: a side branch off the middle carries a higher one, and is listed apart, since it cannot
 * land without the pull requests beneath it. `--branch` says where one branch sits: its parent, and
 * what is stacked on it, which decides whether it may still be rewritten. The reading is GitHub's at
 * this moment and the stack moves, so run it again before a branch, a pull request and a push.
 * Each line ends in the pull request's importance label (`I0` to `I3`), or `unranked` where it
 * carries none or several, which `bun run land` refuses. Under them it names each pull request whose
 * head holds another's without standing on it (`doubled.ts`), which `land` refuses as well.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { doubledLines } from "#tools/runtime/doubled.ts";
import { ranksOf } from "#tools/runtime/land.ts";
import { openPulls, type Pull } from "#tools/runtime/pulls.ts";

/** The stacks: each the longest chain of open pull requests left, bottom first, longest first, and
 *  the pull requests on no such chain. A chain starts on a base that is no open pull request's head,
 *  which is `main` or a branch that has landed. Of two chains as long, the one of the lower number
 *  comes first, so the reading does not change with the order GitHub lists them in. */
export function chains(pulls: readonly Pull[]) {
  const longest = (free: readonly Pull[], bases: readonly string[], seen: ReadonlySet<string>): Pull[] => {
    const children = free
      .filter((pull) => bases.includes(pull.baseRefName) && !seen.has(pull.headRefName))
      .sort((a, b) => a.number - b.number);
    let found: Pull[] = [];
    for (const child of children) {
      const rest = [child, ...longest(free, [child.headRefName], new Set([...seen, child.headRefName]))];
      if (rest.length > found.length) found = rest;
    }
    return found;
  };
  const heads = new Set(pulls.map((pull) => pull.headRefName));
  const roots = [...new Set(pulls.map((pull) => pull.baseRefName))].filter((base) => !heads.has(base));
  const stacks: Pull[][] = [];
  let free = pulls;
  for (
    let line = longest(free, roots, new Set(roots));
    line.length > 0;
    line = longest(free, roots, new Set(roots))
  ) {
    stacks.push(line);
    free = free.filter((pull) => !line.includes(pull));
  }
  return { stacks, sides: free };
}

const said = (pull: Pull) => {
  const [rank, ...more] = ranksOf(pull);
  const label = rank === undefined || more.length > 0 ? "unranked" : rank.slice("importance:".length);
  return `#${String(pull.number)}  ${pull.headRefName}  on ${pull.baseRefName}  ${pull.headRefOid.slice(0, 7)}  ${label}`;
};

const topOf = (line: readonly Pull[]) => {
  const top = line.at(-1);
  return top === undefined
    ? ""
    : `top: #${String(top.number)} ${top.headRefName} at ${top.headRefOid.slice(0, 7)}`;
};

/** What is said of the open pull requests, or of one branch among them. */
export function told(pulls: readonly Pull[], branch: string | null): string[] {
  const { stacks, sides } = chains(pulls);
  if (branch === null) {
    if (stacks.length === 0) return ["no pull request is open"];
    return [
      ...stacks.flatMap((line) => [...line.map(said), topOf(line)]),
      ...(sides.length === 0
        ? []
        : ["off the middle of a stack:", ...sides.map((pull) => `  ${said(pull)}`)]),
    ];
  }
  const own = pulls.find((pull) => pull.headRefName === branch);
  if (own === undefined) throw new CommandFailure(`no open pull request has the head ${branch}`);
  const children = pulls.filter((pull) => pull.baseRefName === branch);
  const mine = stacks.find((line) => line.includes(own));
  return [
    said(own),
    mine === undefined ? "off the middle of a stack" : `on the stack whose ${topOf(mine)}`,
    children.length === 0
      ? "nothing is stacked on it: its commits may still be folded"
      : `stacked on it: ${children.map((pull) => `#${String(pull.number)}`).join(", ")}. It takes new commits only`,
  ];
}

if (import.meta.main) {
  await runCommand(
    { name: "stack", usage: "stack.ts [--branch <branch>]", options: { branch: "text" } },
    (args: CommandArgs) => {
      const open = openPulls(runtimeProcess.cwd());
      const repeating = doubledLines(runtimeProcess.cwd(), open);
      console.log(told(open, args.value("branch")).join("\n"));
      if (repeating.length > 0) console.log(["repeating another's commits:", ...repeating].join("\n  "));
    },
  );
}
