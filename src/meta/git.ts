/**
 * One git question asked of one checkout, answered as trimmed text.
 *
 * Skill scripts and tools each wrote this as a local helper, and they had drifted in the two
 * places a helper this small can: some spelled the executable as bare `git` and paid the Darwin
 * xcrun shim on every call, which `hostTool` exists to skip, and some left the capture unbounded, so
 * a runaway listing ended as a short read rather than as a refusal that says it filled its cap.
 * Until 15 October it was a skill module, which production code cannot import, so the run
 * registry and the campaign command each spelled git again, and listed the worktrees twice.
 */
import { hostTool } from "./host-tool.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "./subprocess.ts";

/** A worktree as git lists it: its path, its commit and its branch, where it has each. */
export interface Worktree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
}

/** `git -C <repo> <args>` as its exact stdout, for bytes that are measured: a file's content at a
 *  revision, whose trailing newline is part of its size. Throws with git's stderr on any failure. */
export function gitOutput(repo: string, ...args: readonly string[]): string {
  return runTextSyncOrThrow([hostTool("git"), "-C", repo, ...args], { maxBuffer: CAPTURE_MAX_BYTES });
}

/** The same output trimmed, for an answer rather than a payload. */
export function gitText(repo: string, ...args: readonly string[]): string {
  return gitOutput(repo, ...args).trim();
}

/** The same question where "no" is an answer — an unknown commit, a key nobody set — as null. */
export function gitMaybe(repo: string, ...args: readonly string[]): string | null {
  try {
    return gitText(repo, ...args);
  } catch {
    return null;
  }
}

/** The worktrees of the repository `repo` lies in, each with its commit and branch, the main one
 *  first, from one listing. */
export const worktreeList = (repo: string): Worktree[] =>
  gitText(repo, "worktree", "list", "--porcelain")
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const field = (key: string) =>
        lines.find((line) => line.startsWith(`${key} `))?.slice(key.length + 1) ?? null;
      return {
        path: field("worktree") ?? "",
        head: field("HEAD"),
        branch: field("branch")?.slice("refs/heads/".length) ?? null,
      };
    });

/** The paths of `worktreeList`, the main one first. */
export const worktrees = (repo: string): string[] => worktreeList(repo).map(({ path }) => path);

/** The main worktree of the repository `repo` lies in, which holds what all its worktrees share. */
export const mainTree = (repo: string): string => worktrees(repo)[0] ?? repo;
