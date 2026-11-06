/**
 * The open pull requests, as GitHub lists them, and the `gh` runner that reads them: one reader for
 * `land`, `doubled.ts` and the stack scripts. They left `land.ts` on 30 October 2026 so that
 * `doubled.ts`, which `land` calls, could read them without importing `land` back. A commit status
 * is posted here too (`postStatus`), for `land` and the pre-push hook, which spelled the same
 * `gh api` call apart until 5 November 2026.
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

/** A commit status as GitHub's statuses API takes it; `link` is the target its Details opens. */
export interface Status {
  readonly context: string;
  readonly state: string;
  readonly description: string;
  readonly link?: string | undefined;
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
