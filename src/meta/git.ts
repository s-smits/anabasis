import { hostTool } from "./host-tool.ts";
import { basename, dirname } from "./path.ts";
import { runtimeProcess } from "./process.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "./subprocess.ts";

export interface Worktree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
}

export function gitOutput(repo: string, ...args: readonly string[]): string {
  return runTextSyncOrThrow([hostTool("git"), "-C", repo, ...args], { maxBuffer: CAPTURE_MAX_BYTES });
}

export function gitText(repo: string, ...args: readonly string[]): string {
  return gitOutput(repo, ...args).trim();
}

export function gitMaybe(repo: string, ...args: readonly string[]): string | null {
  try {
    return gitText(repo, ...args);
  } catch {
    return null;
  }
}

export const repoRoot = (cwd = runtimeProcess.cwd()): string => gitText(cwd, "rev-parse", "--show-toplevel");

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

export const worktrees = (repo: string): string[] => worktreeList(repo).map(({ path }) => path);

export function mainTree(repo: string): string {
  const common = gitText(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return basename(common) === ".git" ? dirname(common) : (worktrees(repo)[0] ?? repo);
}

export function addedLines(repo: string, ...args: readonly string[]): Map<string, Set<number>> {
  const flags = ["--unified=0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"];
  const changed = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  let header = false;
  for (const row of gitOutput(repo, "-c", "core.quotePath=false", "diff", ...flags, ...args).split("\n")) {
    if (row.startsWith("diff --git ")) [header, lines] = [true, undefined];
    if (header && row.startsWith("+++ b/")) {
      lines = new Set();
      changed.set(row.slice(6).replace(/\t$/u, ""), lines);
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/u.exec(row);
    if (hunk === null) continue;
    header = false;
    const start = Number(hunk[1]);
    for (let line = start; line < start + Number(hunk[2] ?? 1); line += 1) lines?.add(line);
  }
  return changed;
}
