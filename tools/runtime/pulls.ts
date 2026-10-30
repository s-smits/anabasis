/**
 * The open pull requests, as GitHub lists them, and the `gh` runner that reads them: one reader for
 * `land`, `doubled.ts` and the stack scripts. They left `land.ts` on 30 October 2026 so that
 * `doubled.ts`, which `land` calls, could read them without importing `land` back.
 */
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";

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
