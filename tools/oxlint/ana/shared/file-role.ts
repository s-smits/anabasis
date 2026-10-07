/**
 * Which part of the repository a file belongs to.
 *
 * Several of these rules speak to one part only: a test-strength rule has nothing to say about
 * production, a runtime-surface rule must not report the wrapper that owns the surface, and an
 * ownership rule must not report the owner. Each rule deciding its own scope from a path string
 * is how two rules end up disagreeing about what "the owner" is, so the question is answered
 * here once and every rule asks it the same way.
 */

/**
 * Paths arrive absolute; compare on the repository-relative tail so a worktree name cannot matter.
 *
 * The earliest root wins, not the first one named. `packages/ui/src/server/api.ts` contains both
 * `/packages/` and `/src/`, and taking `/src/` made the UI package read as controller source —
 * which is how eleven of its files first came back as isolation defects.
 */
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

/** A file whose job is to be run by the test runner, including the helpers those files import. */
export function isTestFile(filename: string): boolean {
  const path = repoRelative(filename);
  return path.startsWith("test/") || path.includes(".test.");
}

/** Exactly one of the named repository-relative paths, so an owner exemption names a file. */
export function isOneOf(filename: string, owners: readonly string[]): boolean {
  const path = repoRelative(filename);
  return owners.includes(path);
}

/** Anywhere beneath a repository-relative directory, for a whole tree that owns something. */
export function isUnder(filename: string, directory: string): boolean {
  return repoRelative(filename).startsWith(directory.endsWith("/") ? directory : directory + "/");
}

/** A component file. A component rendered once from one parent is not a helper with one caller. */
export function isComponentFile(filename: string): boolean {
  return filename.endsWith(".tsx");
}
