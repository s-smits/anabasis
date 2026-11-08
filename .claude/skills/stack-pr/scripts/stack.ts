#!/usr/bin/env bun
/**
 * The open stacks as their edges, and each one's top.
 *
 *   bun .claude/skills/stack-pr/scripts/stack.ts [--branch <branch>]
 *
 * Several stacks may be open, each a chain of pull requests whose bottom is based on the trunk (`main`) and
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
import { gitMaybe } from "#src/meta/git.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { doubledLines } from "#tools/runtime/doubled.ts";
import { ranksOf } from "#tools/runtime/land.ts";
import { chains, openPulls, type Pull, trunkOf } from "#tools/runtime/pulls.ts";

/** The trunk's head commit as this clone last fetched it, as every reader of the trunk names it. */
export const trunkHead = (trunk: string): string => `origin/${trunk}^{commit}`;

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

/** A line for each stack whose bottom stands on a branch that is not the trunk, or misses its head,
 *  naming the one command that replays it. On 6 November #632 stood on a branch that had merged,
 *  and `land` found it only when asked to land. */
export function offMain(root: string, pulls: readonly Pull[], trunk: string): string[] {
  const head = gitMaybe(root, "rev-parse", "--verify", "-q", trunkHead(trunk));
  if (head === null) return [];
  return chains(pulls).stacks.flatMap((line) => {
    const [bottom, top] = [line[0], line.at(-1)];
    if (bottom === undefined || top === undefined) return [];
    const holds = gitMaybe(root, "merge-base", "--is-ancestor", head, bottom.headRefOid) !== null;
    if (bottom.baseRefName === trunk && holds) return [];
    const why =
      bottom.baseRefName === trunk
        ? `misses ${trunk} at ${head.slice(0, 7)}`
        : `stands on ${bottom.baseRefName}`;
    return [
      `off ${trunk}: #${String(bottom.number)} ${why}; replay the stack with ` +
        `bun .claude/skills/stack-pr/scripts/republish.ts --onto-main ${String(top.number)} --yes`,
    ];
  });
}

if (import.meta.main) {
  await runCommand(
    { name: "stack", usage: "stack.ts [--branch <branch>]", options: { branch: "text" } },
    (args: CommandArgs) => {
      const root = runtimeProcess.cwd();
      const open = openPulls(root);
      const repeating = doubledLines(root, open);
      console.log(told(open, args.value("branch")).join("\n"));
      for (const line of offMain(root, open, trunkOf(root))) console.log(line);
      if (repeating.length > 0) console.log(["repeating another's commits:", ...repeating].join("\n  "));
    },
  );
}
