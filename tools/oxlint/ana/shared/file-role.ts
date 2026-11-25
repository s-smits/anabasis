/** Paths arrive absolute; compare on the repository-relative tail so a worktree name cannot matter. */
export function repoRelative(filename: string): string {
  // A worktree under `.claude/worktrees/<name>/` is a whole checkout, so the search starts past
  // it; otherwise `/.claude/` is the earliest root and every file there loses its own tree.
  const posix = filename.replaceAll("\\", "/").replace(/^.*\/\.claude\/worktrees\/[^/]+\//u, "/");
  let earliest = -1;
  for (const root of ["/src/", "/tools/", "/vendor/", "/test/", "/starters/", "/packages/", "/.claude/"]) {
    const at = posix.indexOf(root);
    if (at !== -1 && (earliest === -1 || at < earliest)) earliest = at;
  }
  return earliest === -1 ? posix : posix.slice(earliest + 1);
}

/** Includes the helpers test files import. */
export function isTestFile(filename: string): boolean {
  const path = repoRelative(filename);
  return path.startsWith("test/") || path.includes(".test.");
}

export function isOneOf(filename: string, owners: readonly string[]): boolean {
  const path = repoRelative(filename);
  return owners.includes(path);
}

export function isUnder(filename: string, directory: string): boolean {
  return repoRelative(filename).startsWith(directory.endsWith("/") ? directory : `${directory}/`);
}
