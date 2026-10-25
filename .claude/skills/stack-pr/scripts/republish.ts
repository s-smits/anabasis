#!/usr/bin/env bun
/**
 * Publish a consolidated stack: every pull request's new head in one push, the absorbed pull
 * requests closed, and the native stack linked again.
 *
 *   bun .claude/skills/stack-pr/scripts/republish.ts --head <pr>=<commit> ... [--absorb <pr>=<into>] ...
 *     [--yes] [--no-verify]
 *
 * Without `--yes` it only shows each branch before and after, and the commands it would run. With
 * it, it pushes every moved head atomically, each with a lease on the head GitHub showed, closes each
 * absorbed pull request with a comment naming where its change went, and links the survivors bottom
 * to top. A pull request on the stack that `--head` does not name keeps its head.
 *
 * The consolidation of 25 October did these steps by hand, and each went wrong once or nearly did: zsh
 * read `$sha:refs/...` as a `:r` modifier, macOS's /bin/bash 3.2 has no `mapfile`, and main was
 * rewritten mid-consolidation (same tree, new commits), so a stack built on the old main had to be
 * replayed before it could land. So the script runs git without a shell, refuses before it writes
 * anything unless the bottom holds origin/main's head and each head holds the one beneath it (what
 * `bun run land` will ask), and unstacks before it links, since GitHub refuses a base edit inside a
 * native stack. `--no-verify` passes the operator's word to skip the pre-push hook; the stack stays
 * unproved until `bun run land -- <top> --sanitize`.
 */
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { short } from "#tools/runtime/gate.ts";
import { ghOrThrow, openPulls, type Pull } from "#tools/runtime/land.ts";
import type { NativeStack } from "./follow.ts";
import { chain } from "./stack.ts";

/** One surviving pull request: its new head, and the base the link gives it. */
interface Move {
  readonly pull: Pull;
  readonly to: string;
  readonly base: string;
}

/** What a consolidation publishes, read against GitHub's open pull requests and origin/main. */
interface Consolidation {
  readonly trunk: string;
  readonly moves: readonly Move[];
  readonly absorbed: readonly { readonly pull: Pull; readonly into: number }[];
}

type Verify = "verify" | "no-verify";

const USAGE = "republish.ts --head <pr>=<commit> ... [--absorb <pr>=<into pr>] ... [--yes] [--no-verify]";

const named = (pull: Pull): string => `#${String(pull.number)}`;
const holds = (root: string, older: string, newer: string): boolean =>
  gitMaybe(root, "merge-base", "--is-ancestor", older, newer) !== null;

function commitOf(root: string, pull: Pull, given: string): string {
  const sha = gitMaybe(root, "rev-parse", "--verify", `${given}^{commit}`);
  if (sha === null) throw new CommandFailure(`${named(pull)}: ${given} is no commit here; fetch it first`);
  return sha;
}

/** `<pr>=<value>` pairs, refusing a malformed one or a pull request named twice. */
export function pairs(option: string, given: readonly string[]): Map<number, string> {
  const found = new Map<number, string>();
  for (const pair of given) {
    const match = /^#?(\d+)=(.+)$/.exec(pair);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new CommandFailure(`--${option} takes <pr>=<value>, got ${pair}`);
    }
    const number = Number(match[1]);
    if (found.has(number)) throw new CommandFailure(`--${option} names #${match[1]} twice`);
    found.set(number, match[2]);
  }
  return found;
}

/** The consolidation the heads and absorptions describe, or a refusal that names what does not hold. */
export function planConsolidation(
  root: string,
  pulls: readonly Pull[],
  heads: ReadonlyMap<number, string>,
  absorbed: ReadonlyMap<number, number>,
): Consolidation {
  const { line } = chain(pulls);
  const onStack = (number: number): Pull => {
    const pull = line.find((each) => each.number === number);
    if (pull === undefined) throw new CommandFailure(`#${String(number)} is not on the open stack`);
    return pull;
  };
  for (const number of [...heads.keys(), ...absorbed.keys(), ...absorbed.values()]) onStack(number);
  const gone = line.filter((pull) => absorbed.has(pull.number));
  const kept = line.filter((pull) => !absorbed.has(pull.number));
  for (const pull of gone) {
    if (heads.has(pull.number)) throw new CommandFailure(`${named(pull)} is absorbed and given a head`);
    const into = absorbed.get(pull.number) ?? 0;
    if (!heads.has(into)) {
      throw new CommandFailure(
        `${named(pull)} is absorbed into #${String(into)}, which is given no new head`,
      );
    }
  }
  const trunk = gitText(root, "rev-parse", "--verify", "origin/main^{commit}");
  const bottom = line[0]?.baseRefName ?? "main";
  const moves = kept.map((pull, index): Move => {
    const given = heads.get(pull.number);
    const to = given === undefined ? pull.headRefOid : commitOf(root, pull, given);
    return { pull, to, base: kept[index - 1]?.headRefName ?? bottom };
  });
  const changed = moves.some((move) => move.to !== move.pull.headRefOid) || gone.length > 0;
  if (!changed) throw new CommandFailure("nothing moves: every head is as GitHub shows it");
  for (const [index, move] of moves.entries()) {
    const beneath = moves[index - 1];
    if (beneath === undefined && !holds(root, trunk, move.to)) {
      throw new CommandFailure(
        `${named(move.pull)}'s new head ${short(move.to)} does not hold origin/main at ${short(trunk)}: ` +
          "main moved or was rewritten. Replay the stack with `git rebase --onto origin/main <the main it " +
          "was built on> <top>`, then name the new heads",
      );
    }
    if (beneath !== undefined && !holds(root, beneath.to, move.to)) {
      throw new CommandFailure(
        `${named(move.pull)}'s new head ${short(move.to)} does not hold ` +
          `${named(beneath.pull)}'s ${short(beneath.to)}`,
      );
    }
  }
  return { trunk, moves, absorbed: gone.map((pull) => ({ pull, into: absorbed.get(pull.number) ?? 0 })) };
}

/** The one push that moves every changed head, each with a lease on the head GitHub showed. */
export function pushArgs(plan: Consolidation, verify: Verify): string[] {
  const moved = plan.moves.filter((move) => move.to !== move.pull.headRefOid);
  if (moved.length === 0) return [];
  const branch = (move: Move): string => `refs/heads/${move.pull.headRefName}`;
  return [
    "push",
    "--atomic",
    ...(verify === "no-verify" ? ["--no-verify"] : []),
    ...moved.map((move) => `--force-with-lease=${branch(move)}:${move.pull.headRefOid}`),
    "origin",
    ...moved.map((move) => `${move.to}:${branch(move)}`),
  ];
}

/** Each branch before and after, and what `--yes` would do. */
function shown(plan: Consolidation, verify: Verify): string[] {
  const top = plan.moves.at(-1);
  const push = pushArgs(plan, verify);
  return [
    `origin/main at ${short(plan.trunk)}`,
    ...plan.moves.map((move) => {
      const head =
        move.to === move.pull.headRefOid
          ? `${short(move.to)} kept`
          : `${short(move.pull.headRefOid)} -> ${short(move.to)}`;
      const base =
        move.base === move.pull.baseRefName ? "" : `  base ${move.pull.baseRefName} -> ${move.base}`;
      return `${named(move.pull)}  ${move.pull.headRefName}  ${head}${base}`;
    }),
    ...plan.absorbed.map(
      ({ pull, into }) => `${named(pull)}  ${pull.headRefName}  closed into #${String(into)}`,
    ),
    push.length === 0 ? "nothing to push" : `git ${push.join(" ")}`,
    `gh stack unstack <each open stack holding these>; gh stack link ${plan.moves.map((move) => move.pull.number).join(" ")}`,
    ...(top === undefined || top.to === top.pull.headRefOid
      ? []
      : [
          `the top moves: tell whoever builds on ${short(top.pull.headRefOid)} to rebase --onto ${short(top.to)}`,
        ]),
  ];
}

/** Push, close what was absorbed, and link the survivors again as one native stack. */
export function republish(
  root: string,
  plan: Consolidation,
  verify: Verify,
  gh: (args: readonly string[]) => string,
): string[] {
  const said: string[] = [];
  const push = pushArgs(plan, verify);
  if (push.length > 0) {
    gitText(root, ...push);
    said.push(`pushed ${String(push.filter((arg) => arg.startsWith("--force-with-lease")).length)} heads`);
  }
  const touched = new Set([...plan.moves, ...plan.absorbed].map(({ pull }) => pull.number));
  const stacks = parseJsonAs<NativeStack[]>(gh(["api", "repos/{owner}/{repo}/stacks"])).filter(
    (stack) => stack.open && stack.pull_requests.some((pull) => touched.has(pull.number)),
  );
  for (const stack of stacks) {
    gh(["stack", "unstack", String(stack.number)]);
    said.push(`unstacked ${String(stack.number)}`);
  }
  for (const { pull, into } of plan.absorbed) {
    const at = short(plan.moves.find((move) => move.pull.number === into)?.to ?? "");
    const note = `Closed when the stack was consolidated: this change is now part of #${String(into)} at ${at}.`;
    gh(["pr", "close", String(pull.number), "--comment", note]);
    said.push(`closed ${named(pull)} into #${String(into)}`);
  }
  const survivors = plan.moves.map((move) => String(move.pull.number));
  gh(["stack", "link", ...survivors]);
  said.push(`linked #${survivors.join(", #")}`);
  return said;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "republish",
      usage: USAGE,
      options: { head: "list", absorb: "list", yes: "flag", "no-verify": "flag" },
    },
    (args) => {
      const root = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
      gitText(root, "fetch", "-q", "origin");
      const absorbed = new Map(
        [...pairs("absorb", args.list("absorb"))].map(([pull, into]) => {
          if (!/^#?\d+$/.test(into)) throw new CommandFailure(`--absorb takes <pr>=<pr>, got ${into}`);
          return [pull, Number(into.replace("#", ""))];
        }),
      );
      const plan = planConsolidation(root, openPulls(root), pairs("head", args.list("head")), absorbed);
      const verify: Verify = args.flag("no-verify") ? "no-verify" : "verify";
      console.log(shown(plan, verify).join("\n"));
      if (!args.flag("yes")) return;
      console.log(republish(root, plan, verify, (gh) => ghOrThrow(root, gh)).join("\n"));
    },
  );
}
