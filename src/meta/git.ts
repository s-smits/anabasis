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

export function changedLinesInDiff(diff: string): Map<string, Set<number>> {
  const changed = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  let sawMinus = false;
  let oldLeft = 0;
  for (const row of diff.split("\n")) {
    if (row.startsWith("diff --git ")) {
      sawMinus = false;
      oldLeft = 0;
      continue;
    }
    if (row.startsWith("-") && oldLeft > 0) {
      oldLeft -= 1;
      continue;
    }
    if (row.startsWith("--- ")) {
      sawMinus = true;
      continue;
    }
    if (sawMinus && row.startsWith("+++ ")) {
      sawMinus = false;
      const file = row.slice(4).replace(/\t$/u, "").replace(/^b\//u, "");
      if (file === "/dev/null") {
        lines = undefined;
      } else {
        lines = changed.get(file) ?? new Set<number>();
        changed.set(file, lines);
      }
      continue;
    }
    sawMinus = false;
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(row);
    if (hunk === null || lines === undefined) continue;
    oldLeft = Number(hunk[1] ?? 1);
    const start = Number(hunk[2]);
    const count = Number(hunk[3] ?? 1);
    for (let line = start; line < start + count; line += 1) lines.add(line);
  }
  return changed;
}
