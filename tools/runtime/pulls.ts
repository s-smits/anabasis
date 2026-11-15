/**
 * The open pull requests, as GitHub lists them, and the `gh` runner that reads them: one reader for
 * `land`, `doubled.ts` and the stack scripts. They left `land.ts` on 30 October 2026 so that
 * `doubled.ts`, which `land` calls, could read them without importing `land` back. A commit status
 * is posted here too (`postStatus`), for `land` and the pre-push hook, which spelled the same
 * `gh api` call apart until 5 November 2026, and a landing's statuses go through one board of what
 * GitHub shows (`statusBoard`). The chains of bases they form are read here as well
 * (`chains`, `firstStack`): until 9 November `land`, `follow`, `stack.ts` and `republish.ts` each
 * read the stack's top their own way.
 */
import { gitMaybe } from "../../src/meta/git.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";

/** The check `bun run land` turns green on a pull request's head once every commit up to it has
 *  passed, and the pre-push hook turns pending on each head stacked above a pushed branch. */
export const MERGEABLE_CONTEXT = "mergeable";

/** `gh api`'s filter over the stacks a pull request is in: the open one's number and its members still
 *  open, bottom first. A stack keeps the members a partial merge took, listed closed, and until
 *  5 November they read as part of the next landing, which `stackOf` then refused. */
export const STACK_MEMBERS = String.raw`map(select(.open)) | first // empty | "\(.number) \(.pull_requests | map(select(.state == "open") | .number) | join(","))"`;

/** Each status a GraphQL reading of commits finds, as `statusBoard` spells a status it posts. */
const SHOWN = String.raw`.data.repository[] | select(. != null) | .oid as $sha | (.status.contexts // [])[] | [$sha, .context, (.state | ascii_downcase), .description] | join("\t")`;

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

/** An open pull request, in the fields `gh pr list --json` names. */
export interface Pull {
  readonly number: number;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly headRefOid: string;
  readonly isDraft: boolean;
  readonly labels: readonly { readonly name: string }[];
}

export interface Answer {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

/** The four states GitHub's statuses API takes. */
export type StatusState = "pending" | "success" | "failure" | "error";

/** A commit status as GitHub's statuses API takes it; `link` is the target its Details opens. */
export interface Status {
  readonly context: string;
  readonly state: StatusState;
  readonly description: string;
  readonly link?: string | undefined;
}

/** The statuses a landing posts (`statusBoard`). */
export interface Board {
  readonly read: (shas: readonly string[]) => void;
  readonly post: (sha: string, status: Status) => void;
  readonly settle: () => void;
}

export function gh(root: string, args: readonly string[]): Answer {
  const result = runSync(["gh", ...args], { cwd: root });
  return {
    ok: result.exitCode === 0,
    out: decodeOutput(result.stdout).trim(),
    err: decodeOutput(result.stderr).trim(),
  };
}

export function ghOrThrow(root: string, args: readonly string[]): string {
  const answer = gh(root, args);
  if (!answer.ok) throw new Error(`gh ${args.join(" ")}: ${answer.err}`);
  return answer.out;
}

/** The default branch of the repository `root`'s remote names, as GitHub says now. */
export const trunkOf = (root: string): string =>
  ghOrThrow(root, ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);

/** `gh api`'s form fields, `-f key=value` each, leaving out a field that has no value. */
export const form = (fields: Readonly<Record<string, string | undefined>>): string[] =>
  Object.entries(fields).flatMap(([key, value]) => (value === undefined ? [] : ["-f", `${key}=${value}`]));

// `{owner}/{repo}` is gh's own placeholder for the repository the working directory's remote names.
export const api = (path: string): string => `repos/{owner}/{repo}/${path}`;

/** Posts a commit status on `sha`, and says whether GitHub took it. */
export function postStatus(
  root: string,
  sha: string,
  { context, state, description, link }: Status,
): boolean {
  const fields = form({ state, context, description });
  const path = api(`statuses/${sha}`);
  return gh(root, ["api", "-X", "POST", path, ...fields, "--silent", ...form({ target_url: link })]).ok;
}

/** The statuses a landing posts, as one board of what each commit and context shows. Each commit's
 *  statuses are read in one GraphQL call (`read`): on 30 October a landing over remembered passes
 *  posted 81 statuses one by one, about 0.6 s each, every one shown already, where one reading of
 *  the 64 commits took 0.9 s. A status is posted only where it changes what its commit shows; until
 *  9 November a set of rows seen decided it, so a verdict GitHub showed before the landing turned it
 *  pending was never posted again, and stayed pending. `settle` turns each status the landing left
 *  pending into an error, however the landing ended. Unread, every status is posted. */
export function statusBoard(root: string): Board {
  const shown = new Map<string, string>();
  const asked = new Set<string>();
  const pending = new Set<string>();
  const post = (sha: string, status: Status): void => {
    const key = `${sha}\t${status.context}`;
    const now = `${status.state}\t${status.description}`;
    if (shown.get(key) !== now) {
      if (!postStatus(root, sha, status)) return;
      shown.set(key, now);
    }
    if (status.state === "pending") pending.add(key);
    else pending.delete(key);
  };
  const read = (shas: readonly string[]): void => {
    const objects = shas
      .filter((sha) => !asked.has(sha))
      .map(
        (sha, index) =>
          `c${String(index)}: object(oid: "${sha}") { ... on Commit { oid status { contexts { context state description } } } }`,
      );
    for (const sha of shas) asked.add(sha);
    if (objects.length === 0) return;
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${objects.join(" ")} } }`;
    const args = ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "--jq", SHOWN];
    const answer = gh(root, [...args, "-f", `query=${query}`]);
    for (const row of answer.ok ? answer.out.split("\n") : []) {
      const [sha = "", context = "", ...now] = row.split("\t");
      shown.set(`${sha}\t${context}`, now.join("\t"));
    }
  };
  const settle = (): void => {
    for (const key of pending) {
      const [sha = "", context = ""] = key.split("\t");
      post(sha, { context, state: "error", description: "bun run land ended before proving it; land again" });
    }
  };
  return { read, post, settle };
}

/** The longest chain in `pool` standing on any of `bases`, bottom first, each based on the head of
 *  the one beneath; of two as long, the one through the lower number. `seen` holds the heads
 *  already on the chain, so a loop of bases ends. */
function longest(pool: readonly Pull[], bases: readonly string[], seen: ReadonlySet<string>): Pull[] {
  let found: Pull[] = [];
  for (const child of pool
    .filter((pull) => bases.includes(pull.baseRefName) && !seen.has(pull.headRefName))
    .toSorted((a, b) => a.number - b.number)) {
    const chain = [child, ...longest(pool, [child.headRefName], new Set([...seen, child.headRefName]))];
    if (chain.length > found.length) found = chain;
  }
  return found;
}

/** The open pull requests beneath `pull`, nearest first: each the one whose head the one above it is
 *  based on. */
export function beneath(open: readonly Pull[], pull: Pull): Pull[] {
  const byHead = new Map(open.map((each) => [each.headRefName, each]));
  const found: Pull[] = [];
  for (let below = byHead.get(pull.baseRefName); below !== undefined && below.number !== pull.number; ) {
    if (found.includes(below)) break;
    found.push(below);
    below = byHead.get(below.baseRefName);
  }
  return found;
}

/** The longest chain of open pull requests above `pull`, nearest first. */
export const chainAbove = (open: readonly Pull[], pull: Pull): Pull[] =>
  longest(open, [pull.headRefName], new Set([pull.headRefName]));

/**
 * The stacks, and the pull requests on none: each stack the longest chain left, bottom first,
 * longest first, starting on a base that is no open pull request's head (the trunk, or a branch that
 * has landed). A fork off the middle of a stack is on none, since it cannot land without the pull
 * requests beneath it. This is the one reading of the chain of bases: `land` lands the chain, and
 * GitHub's native stacks are only checked against it (`stackOf`, `land.ts`).
 */
export function chains(open: readonly Pull[]): { stacks: Pull[][]; sides: Pull[] } {
  const heads = new Set(open.map((pull) => pull.headRefName));
  const roots = [...new Set(open.map((pull) => pull.baseRefName))].filter((base) => !heads.has(base));
  const stacks: Pull[][] = [];
  let free = open;
  for (
    let line = longest(free, roots, new Set(roots));
    line.length > 0;
    line = longest(free, roots, new Set(roots))
  ) {
    stacks.push(line);
    free = free.filter((pull) => !line.includes(pull));
  }
  return { stacks, sides: [...free] };
}

/** The stack that holds pull request `number`, bottom first, or undefined for one on none. */
export const stackHolding = (open: readonly Pull[], number: number): Pull[] | undefined =>
  chains(open).stacks.find((line) => line.some((pull) => pull.number === number));

/** The stack `bun run land` lands and `bun run follow` follows first, bottom first: of the stacks of
 *  two or more, else of the lone pull requests, the one that holds the oldest open pull request
 *  (operator, 27 October 2026); empty where none is open. Until 9 November `land` took the lowest
 *  bottom on the trunk and `follow` GitHub's native stack, with its own chain where GitHub held
 *  none, so a lone older pull request or a reordered stack sent them to different tops. */
export function firstStack(open: readonly Pull[]): Pull[] {
  const { stacks } = chains(open);
  const stacked = stacks.filter((line) => line.length > 1);
  const oldest = (line: readonly Pull[]): number => Math.min(...line.map((pull) => pull.number));
  return (stacked.length > 0 ? stacked : stacks).toSorted((a, b) => oldest(a) - oldest(b))[0] ?? [];
}

/** The highest-numbered top of the open stacks, lone pull requests among them, which
 *  `bun run land -- latest` lands; 0 where none is open. */
export const latestTop = (open: readonly Pull[]): number =>
  Math.max(0, ...chains(open).stacks.map((line) => line.at(-1)?.number ?? 0));

/** Every open pull request of the repository `root`'s remote names, as GitHub lists them now. */
export const openPulls = (root: string): Pull[] =>
  parseJsonAs<Pull[]>(
    ghOrThrow(root, [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,headRefName,baseRefName,headRefOid,isDraft,labels",
    ]),
  );

/** The importance labels a pull request carries; a landing asks for exactly one. */
export const ranksOf = (pull: Pull): string[] =>
  pull.labels.map((label) => label.name).filter((name) => /^importance:I[0-3]$/u.test(name));

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
export function stackTold(pulls: readonly Pull[], branch: string | null): string[] {
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
  if (own === undefined) throw new Error(`no open pull request has the head ${branch}`);
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
