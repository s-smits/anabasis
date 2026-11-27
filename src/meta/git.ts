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

export function changedLines(repo: string, ...range: readonly string[]): Map<string, Set<number>> {
  const diff = gitOutput(
    repo,
    "-c",
    "core.quotePath=false",
    "diff",
    "--unified=0",
    "--no-color",
    "--no-prefix",
    "--no-ext-diff",
    "--output-indicator-old=<",
    "--output-indicator-new=>",
    ...range,
  );
  const changed = new Map<string, Set<number>>();
  let file = "";
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) file = row.slice(4).replace(/\t$/u, "");
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/u.exec(row);
    if (hunk === null) continue;
    const start = Number(hunk[1]);
    for (let line = start; line < start + Number(hunk[2] ?? 1); line += 1) {
      changed.set(file, (changed.get(file) ?? new Set<number>()).add(line));
    }
  }
  return changed;
}
