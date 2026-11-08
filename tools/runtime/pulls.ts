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
