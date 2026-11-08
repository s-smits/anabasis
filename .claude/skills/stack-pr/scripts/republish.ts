#!/usr/bin/env bun
/**
 * Publish a consolidated stack in the order of `--head`, bottom to top.
 *
 *   bun .claude/skills/stack-pr/scripts/republish.ts --head <pr>=<commit> ... [--absorb <pr>=<into>] ...
 *     [--yes] [--no-verify]
 *   bun .claude/skills/stack-pr/scripts/republish.ts --onto-main <pr> [--yes] [--no-verify]
 *   bun .claude/skills/stack-pr/scripts/republish.ts --resume [--yes]
 *
 * With `--yes` the plan is kept in `ana-republish.json` under the common Git directory from the first
 * write to the last, and a run cut short leaves it: a new plan is then refused, and `--resume` runs
 * the kept one again, skipping the detaching and the push where origin holds every new head.
 *
 * `--onto-main` replays the open stack holding <pr> onto origin/main and names every head itself:
 * the repair once what the stack stood on has landed (`replayedHeads`).
 *
 * Without `--yes` it shows each branch before and after, and every operation in order. With it,
 * it unstacks, retargets every survivor to main, pushes moved heads atomically with leases on the
 * heads GitHub showed, sets bases bottom to top, closes absorbed pull requests with a comment naming
 * where their changes went, and relinks. Unnamed survivors follow the named ones in their old order
 * and keep their heads; name every survivor when reordering the whole stack.
 *
 * The consolidation of 25 October did these steps by hand, and each went wrong once or nearly did: zsh
 * read `$sha:refs/...` as a `:r` modifier, macOS's /bin/bash 3.2 has no `mapfile`, and main was
 * rewritten mid-consolidation (same tree, new commits), so a stack built on the old main had to be
 * replayed before it could land. So the script runs git without a shell, refuses before it writes
 * anything unless the bottom holds origin/main's head and each head holds the one beneath it (what
 * `bun run land` will ask). On 25 October pushing reordered heads while their old bases remained
 * attached let GitHub mark #390 and #392 merged into intermediate branches. Unstacking and
 * retargeting must therefore precede the push, as the hostile test of 26 October checks.
 * `--no-verify` passes the operator's word to skip the pre-push hook; the stack stays
 * unproved until `bun run land -- <top> --sanitize`.
 */
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { existsSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { shellQuote } from "#src/wall/isolation.ts";
import { short } from "#tools/runtime/gate.ts";
import {
  ghOrThrow,
  type NativeStack,
  openPulls,
  type Pull,
  STACKS,
  stackHolding,
  trunkOf,
} from "#tools/runtime/pulls.ts";
import { trunkHead } from "./stack.ts";

/** One surviving pull request: its new head and final base. */
interface Move {
  readonly pull: Pull;
  readonly to: string;
  readonly base: string;
}

/** What a consolidation publishes, read against GitHub's open pull requests and the trunk: its name
 *  and its head on origin. */
interface Consolidation {
  readonly trunk: string;
  readonly trunkSha: string;
  readonly moves: readonly Move[];
  readonly absorbed: readonly { readonly pull: Pull; readonly into: number }[];
}

type Verify = "verify" | "no-verify";

const USAGE =
  "republish.ts (--head <pr>=<commit> ... [--absorb <pr>=<into pr>] ... | --onto-main <pr> | --resume) [--yes] [--no-verify]";

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
  trunk: string,
): Consolidation {
  const [first = 0] = [...heads.keys(), ...absorbed.keys()];
  const line = stackHolding(pulls, first) ?? [];
  const onStack = (number: number): Pull => {
    const pull = line.find((each) => each.number === number);
    if (pull === undefined) throw new CommandFailure(`#${String(number)} is not on the open stack`);
    return pull;
  };
  for (const number of [...heads.keys(), ...absorbed.keys(), ...absorbed.values()]) onStack(number);
  const gone = line.filter((pull) => absorbed.has(pull.number));
  const kept = [
    ...[...heads.keys()].map(onStack),
    ...line.filter((pull) => !heads.has(pull.number) && !absorbed.has(pull.number)),
  ];
  for (const pull of gone) {
    if (heads.has(pull.number)) throw new CommandFailure(`${named(pull)} is absorbed and given a head`);
    const into = absorbed.get(pull.number) ?? 0;
    if (!heads.has(into)) {
      throw new CommandFailure(
        `${named(pull)} is absorbed into #${String(into)}, which is given no new head`,
      );
    }
  }
  const trunkSha = gitText(root, "rev-parse", "--verify", trunkHead(trunk));
  const moves = kept.map((pull, index): Move => {
    const given = heads.get(pull.number);
    const to = given === undefined ? pull.headRefOid : commitOf(root, pull, given);
    return { pull, to, base: kept[index - 1]?.headRefName ?? trunk };
  });
  const changed =
    moves.some((move) => move.to !== move.pull.headRefOid || move.base !== move.pull.baseRefName) ||
    gone.length > 0;
  if (!changed) throw new CommandFailure("nothing moves: every head is as GitHub shows it");
  for (const [index, move] of moves.entries()) {
    const beneath = moves[index - 1];
    if (beneath === undefined && !holds(root, trunkSha, move.to)) {
      throw new CommandFailure(
        `${named(move.pull)}'s new head ${short(move.to)} does not hold origin/${trunk} at ${short(trunkSha)}: ` +
          `${trunk} moved or was rewritten. Replay the stack with \`git rebase --onto origin/${trunk} <the ${trunk} it ` +
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
  return {
    trunk,
    trunkSha,
    moves,
    absorbed: gone.map((pull) => ({ pull, into: absorbed.get(pull.number) ?? 0 })),
  };
}

/** The new head of every pull request on `line`, bottom to top: the chain replayed onto origin/main
 *  by `git replay`, which needs no worktree and moves no ref, from where it last met main (the
 *  merge of what it was stacked on), each head mapped to the replayed commit at its place. A chain
 *  that already holds origin/main keeps its heads. On 6 November #632 to #653 stood on a merged
 *  branch, and the fix took an unstack, a base edit, a rebase in a scratch worktree, a hand-built map
 *  of 18 heads and this script; `--onto-main` is that sequence. */
export function replayedHeads(root: string, line: readonly Pull[], trunkName: string): Map<number, string> {
  const top = line.at(-1);
  if (top === undefined) throw new CommandFailure("no open stack to replay");
  const trunk = gitText(root, "rev-parse", "--verify", trunkHead(trunkName));
  if (holds(root, trunk, line[0]?.headRefOid ?? top.headRefOid)) {
    return new Map(line.map((pull) => [pull.number, pull.headRefOid]));
  }
  const from = gitText(root, "merge-base", trunk, top.headRefOid);
  const range = `${from}..${top.headRefOid}`;
  let said: string;
  try {
    said = gitText(root, "replay", "--ref-action=print", "--onto", trunk, "--ref", "refs/ana/replay", range);
  } catch (cause) {
    said = errorMessage(cause);
  }
  const replayed = /^update \S+ ([0-9a-f]{40})/m.exec(said)?.[1];
  if (replayed === undefined) {
    throw new CommandFailure(
      `the chain up to ${named(top)} does not replay cleanly onto origin/${trunkName} at ${short(trunk)} (${said.trim()}): ` +
        `resolve it with \`git rebase --onto origin/${trunkName} ${short(from)} <top>\`, then name the new heads with --head`,
    );
  }
  const commits = (span: string) => gitText(root, "rev-list", "--reverse", span).split("\n").filter(Boolean);
  const subjects = (span: string) => gitText(root, "log", "--reverse", "--format=%s", span);
  const before = commits(range);
  const after = commits(`${trunk}..${replayed}`);
  if (subjects(range) !== subjects(`${trunk}..${replayed}`)) {
    throw new CommandFailure(
      `replaying ${range} dropped or changed commits (${String(before.length)} before, ` +
        `${String(after.length)} after): replay it by hand and name the new heads with --head`,
    );
  }
  return new Map(
    line.map((pull) => {
      const at = before.indexOf(pull.headRefOid);
      const to = after[at];
      if (to === undefined) throw new CommandFailure(`${named(pull)}'s head is not on the chain ${range}`);
      return [pull.number, to];
    }),
  );
}

/** Where a republish keeps its plan from its first write until its last: between the retarget and
 *  the bases set again, the chain of bases it rewrites is broken, so a run cut short there could not
 *  be planned again from GitHub. Until 9 November nothing was kept, and such a stack was mended by hand. */
const recordOf = (root: string): string =>
  join(gitText(root, "rev-parse", "--path-format=absolute", "--git-common-dir"), "ana-republish.json");

/** The plan of a republish cut short in this clone, or null. */
export function keptRepublish(root: string): { plan: Consolidation; verify: Verify } | null {
  const record = recordOf(root);
  return existsSync(record) ? parseJsonAs(readFileSync(record, "utf8")) : null;
}

/** The one push that moves every head origin does not hold yet (`at`, by branch; GitHub's head where
 *  unread), each with a lease on the head GitHub showed. */
export function pushArgs(
  plan: Consolidation,
  verify: Verify,
  at: ReadonlyMap<string, string> = new Map(),
): string[] {
  const moved = plan.moves.filter(
    (move) => move.to !== (at.get(move.pull.headRefName) ?? move.pull.headRefOid),
  );
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

/** Each branch before and after. The publisher below owns the operation order in both modes. */
function shown(plan: Consolidation): string[] {
  const top = plan.moves.at(-1);
  return [
    `origin/${plan.trunk} at ${short(plan.trunkSha)}`,
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
    ...(top === undefined || top.to === top.pull.headRefOid
      ? []
      : [
          `the top moves: tell whoever builds on ${short(top.pull.headRefOid)} to rebase --onto ${short(top.to)}`,
        ]),
  ];
}

/** Show or carry out the same sequence, detaching every surviving base before any head moves. Each
 *  step is safe to repeat, and the detaching and the push are skipped where origin already holds
 *  every new head, so a run cut short is finished by running its kept plan again (`--resume`). */
export function republish(
  root: string,
  plan: Consolidation,
  verify: Verify,
  gh: (args: readonly string[]) => string,
  mode: "publish" | "dry-run" = "publish",
): string[] {
  const said: string[] = [];
  const run = (tool: "git" | "gh", args: readonly string[]) => {
    said.push(`${tool} ${args.map(shellQuote).join(" ")}`);
    if (mode === "dry-run") return;
    if (tool === "git") gitText(root, ...args);
    else gh(args);
  };
  const touched = new Set([...plan.moves, ...plan.absorbed].map(({ pull }) => pull.number));
  const stacks = parseJsonAs<NativeStack[]>(gh(["api", STACKS])).filter(
    (stack) => stack.open && stack.pull_requests.some((pull) => touched.has(pull.number)),
  );
  const record = recordOf(root);
  if (mode === "publish") writeFileSync(record, capturedJsonStringify({ plan, verify }));
  for (const stack of stacks) {
    run("gh", ["stack", "unstack", String(stack.number)]);
  }
  const refs = plan.moves.map((move) => `refs/heads/${move.pull.headRefName}`);
  const held = new Map(
    gitText(root, "ls-remote", "origin", ...refs)
      .split("\n")
      .map((row) => [row.split("\t")[1]?.replace("refs/heads/", "") ?? "", row.split("\t")[0] ?? ""]),
  );
  const push = pushArgs(plan, verify, held);
  if (push.length > 0) {
    for (const { pull } of plan.moves) run("gh", ["pr", "edit", String(pull.number), "--base", plan.trunk]);
    run("git", push);
  }
  for (const { pull, base } of plan.moves) run("gh", ["pr", "edit", String(pull.number), "--base", base]);
  for (const { pull, into } of plan.absorbed) {
    const at = short(plan.moves.find((move) => move.pull.number === into)?.to ?? "");
    const note = `Closed when the stack was consolidated: this change is now part of #${String(into)} at ${at}.`;
    run("gh", ["pr", "close", String(pull.number), "--comment", note]);
  }
  const survivors = plan.moves.map((move) => String(move.pull.number));
  run("gh", ["stack", "link", ...survivors]);
  if (mode === "publish") rmSync(record, { force: true });
  return said;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "republish",
      usage: USAGE,
      options: {
        head: "list",
        absorb: "list",
        "onto-main": "int",
        resume: "flag",
        yes: "flag",
        "no-verify": "flag",
      },
    },
    (args) => {
      const root = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
      const kept = keptRepublish(root);
      const mode = args.flag("yes") ? "publish" : "dry-run";
      if ((kept !== null) !== args.flag("resume")) {
        throw new CommandFailure(
          kept === null
            ? "no republish was cut short in this clone: nothing to resume"
            : `a republish of ${kept.plan.moves.map((move) => named(move.pull)).join(", ")} was cut short after ` +
                `its first write: run again with --resume to finish it, or move ${recordOf(root)} to the Trash to drop it`,
        );
      }
      if (kept !== null) {
        console.log(republish(root, kept.plan, kept.verify, (gh) => ghOrThrow(root, gh), mode).join("\n"));
        return;
      }
      gitText(root, "fetch", "-q", "origin");
      const onto = args.int("onto-main");
      if (onto !== null && args.list("head").length + args.list("absorb").length > 0) {
        throw new CommandFailure(
          "--onto-main works out every head itself: pass it without --head or --absorb",
        );
      }
      const pulls = openPulls(root);
      const trunk = trunkOf(root);
      const line = onto === null ? [] : stackHolding(pulls, onto);
      if (line === undefined) throw new CommandFailure(`#${String(onto)} is not on an open stack`);
      const given = onto === null ? pairs("head", args.list("head")) : replayedHeads(root, line, trunk);
      const absorbed = new Map(
        [...pairs("absorb", args.list("absorb"))].map(([pull, into]) => {
          if (!/^#?\d+$/.test(into)) throw new CommandFailure(`--absorb takes <pr>=<pr>, got ${into}`);
          return [pull, Number(into.replace("#", ""))];
        }),
      );
      const plan = planConsolidation(root, pulls, given, absorbed, trunk);
      const verify: Verify = args.flag("no-verify") ? "no-verify" : "verify";
      console.log(shown(plan).join("\n"));
      console.log(republish(root, plan, verify, (gh) => ghOrThrow(root, gh), mode).join("\n"));
    },
  );
}
