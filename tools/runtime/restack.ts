/**
 * The new head of every pull request on a chain once what it stands on has moved, replayed bottom up
 * as stack-pr's section 8 does by hand: each pull request's own commits, from the head it was built
 * on, onto the new head beneath it, by `git replay`, which needs no worktree and moves no ref. One
 * reading serves `bun run land --sanitize | --merge`, which restacks a chain whose parent moved
 * before it proves it, and `republish.ts --onto-main`, which replays a stack once what it stood on
 * has landed. Until 9 November land refused such a chain and someone replayed it by hand.
 */
import { gitMaybe, gitText } from "../../src/meta/git.ts";
import { errorMessage } from "../../src/meta/runtime-values.ts";
import { short } from "./gate.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { gh, openPulls, type Pull } from "./pulls.ts";

/** The newest earlier head of `parent` that `child` holds, or null: the head the child was built on. */
export type FormerHead = (parent: Pull, child: string) => string | null;

/** Every head a pull request has had, newest first, as its timeline records them: the head before
 *  each force push and each commit pushed. */
const HEADS = String.raw`.data.repository.pullRequest.timelineItems.nodes | reverse | .[] | (.beforeCommit.oid // .commit.oid // empty)`;
const TIMELINE =
  "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { " +
  "pullRequest(number: $number) { timelineItems(last: 100, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, PULL_REQUEST_COMMIT]) { " +
  "nodes { ... on HeadRefForcePushedEvent { beforeCommit { oid } } ... on PullRequestCommit { commit { oid } } } } } } }";

/** A chain that `git replay` cannot carry across without a person: a conflict, a dropped commit, or a
 *  rewritten parent none of whose earlier heads the child holds. */
export class Unreplayable extends Error {}

const holds = (root: string, older: string, newer: string): boolean =>
  gitMaybe(root, "merge-base", "--is-ancestor", older, newer) !== null;
const named = (pull: Pull): string => `#${String(pull.number)}`;

/** `from..head` replayed onto `onto`, refused unless every commit came across under its subject. */
function replayed(root: string, pull: Pull, from: string, onto: string): string {
  const head = pull.headRefOid;
  if (from === head) return onto;
  const range = `${from}..${head}`;
  let said: string;
  try {
    said = gitText(root, "replay", "--ref-action=print", "--onto", onto, "--ref", "refs/ana/replay", range);
  } catch (cause) {
    said = errorMessage(cause);
  }
  const to = /^update \S+ ([0-9a-f]{40})/mu.exec(said)?.[1];
  const subjects = (span: string): string => gitText(root, "log", "--reverse", "--format=%s", span);
  const how = `\`git rebase --onto ${short(onto)} ${short(from)} ${pull.headRefName}\``;
  if (to === undefined) {
    throw new Unreplayable(
      `${named(pull)} does not replay cleanly onto ${short(onto)} (${said.trim()}): resolve it with ${how}`,
    );
  }
  if (subjects(range) !== subjects(`${onto}..${to}`)) {
    throw new Unreplayable(
      `replaying ${named(pull)}'s ${range} dropped or changed commits: replay it with ${how}`,
    );
  }
  return to;
}

/**
 * The head of each pull request on `line`, bottom to top, standing on `trunk` and each on the new
 * head beneath it: kept where it already holds that head, else replayed from where it last met it.
 * That is `trunk`'s merge base for the bottom, the old head of a parent this replay moved, and
 * otherwise `formerHead`'s answer, since the merge base below a rewritten parent would carry the
 * parent's old commits across beside its new ones.
 */
export function restacked(
  root: string,
  line: readonly Pull[],
  trunk: string,
  formerHead: FormerHead,
): Map<number, string> {
  const heads = new Map<number, string>();
  let below: { pull: Pull | null; was: string; now: string } = { pull: null, was: trunk, now: trunk };
  for (const pull of line) {
    const head = pull.headRefOid;
    let to = head;
    if (!holds(root, below.now, head)) {
      const parent = below.pull;
      const from = holds(root, below.was, head)
        ? below.was
        : parent === null
          ? gitText(root, "merge-base", trunk, head)
          : formerHead(parent, head);
      if (from === null) {
        throw new Unreplayable(
          `${named(pull)} holds none of the heads GitHub records for the pull request beneath it: ` +
            `replay it with \`git rebase --onto ${short(below.now)} <the head it was built on> ${pull.headRefName}\``,
        );
      }
      to = replayed(root, pull, from, below.now);
    }
    heads.set(pull.number, to);
    below = { pull, was: head, now: to };
  }
  return heads;
}

/** `FormerHead` from GitHub's record of the parent's pushes; about half a second a parent, and asked
 *  only of a parent rewritten under its child. */
export const formerHeadOnGitHub =
  (root: string): FormerHead =>
  (parent, child) => {
    const number = String(parent.number);
    const answer = gh(root, [
      "api",
      "graphql",
      "-F",
      "owner={owner}",
      "-F",
      "name={repo}",
      "-F",
      `number=${number}`,
      "-f",
      `query=${TIMELINE}`,
      "--jq",
      HEADS,
    ]);
    const heads = answer.ok ? answer.out.split("\n").filter((sha) => sha !== parent.headRefOid) : [];
    return heads.find((sha) => holds(root, sha, child)) ?? null;
  };

/** The one push that moves each head in `moves`, atomically, each leased on the head GitHub showed. */
export const leasedPush = (
  moves: readonly { readonly pull: Pull; readonly to: string }[],
  verify: "verify" | "no-verify",
): string[] => [
  "push",
  "--atomic",
  ...(verify === "verify" ? [] : ["--no-verify"]),
  ...moves.map(({ pull }) => `--force-with-lease=refs/heads/${pull.headRefName}:${pull.headRefOid}`),
  "origin",
  ...moves.map(({ pull, to }) => `${to}:refs/heads/${pull.headRefName}`),
];

/** Each pull request of `line` that `restacked` moves onto the trunk's head `trunk`, with its new head. */
export function movesOf(root: string, line: readonly Pull[], trunk: string): { pull: Pull; to: string }[] {
  const heads = restacked(root, line, trunk, formerHeadOnGitHub(root));
  return line.flatMap((pull) => {
    const to = heads.get(pull.number) ?? pull.headRefOid;
    return to === pull.headRefOid ? [] : [{ pull, to }];
  });
}

/** Pushes `moves` in one push leased on the heads read, says the rebase line whoever builds on each
 *  branch owes, and waits until GitHub shows the new heads; gives the push's refusal, or null. */
export function pushMoves(
  root: string,
  moves: readonly { readonly pull: Pull; readonly to: string }[],
  say: (line: string) => void,
): string | null {
  const pushed = runSync(["git", ...leasedPush(moves, "verify")], { cwd: root });
  if (pushed.exitCode !== 0) return decodeOutput(pushed.stderr).trim();
  for (const { pull, to } of moves) {
    say(
      `whoever builds on ${pull.headRefName}: git rebase --onto ${short(to)} ${short(pull.headRefOid)} ${pull.headRefName}`,
    );
  }
  // GitHub shows a pushed head a moment after the push returns.
  const shown = (open: readonly Pull[]): boolean =>
    moves.every(({ pull, to }) => open.find((each) => each.number === pull.number)?.headRefOid === to);
  for (let looks = 0; looks < 30 && !shown(openPulls(root)); looks += 1) Bun.sleepSync(2000);
  return null;
}

/** The lowest of `pulls` whose head or base `open` shows moved or gone, or -1. */
export const movedFrom = (open: readonly Pull[], pulls: readonly Pull[]): number =>
  pulls.findIndex((pull) => {
    const now = open.find((each) => each.number === pull.number);
    return now?.headRefOid !== pull.headRefOid || now.baseRefName !== pull.baseRefName;
  });
