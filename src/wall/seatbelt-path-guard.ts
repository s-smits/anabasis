/**
 * Seatbelt denials match path strings rather than inodes. This module addresses two failure modes
 * where a path-based denial can fail to protect the intended bytes:
 *
 * 1. Path aliasing. `/var/folders/...` and `/private/var/folders/...` refer to the same directory,
 *    and the kernel evaluates rules against the canonical path. A denial naming only the symlink
 *    form can miss the protected read; `canonicalForms` in `policy.ts` expands both forms.
 * 2. Ancestor relocation. A confined process that can rename an ancestor of a denied path moves
 *    the protected bytes to a path outside the denial rule; `moveBlockingRules` denies those
 *    renames.
 *
 * The rename rules are adapted, with the two departures listed below, from
 * `generateMoveBlockingRules` in `anthropic-experimental/sandbox-runtime`
 * (`295f0e1af:src/sandbox/macos-sandbox-utils.ts`), Apache-2.0, pinned at
 * `295f0e1af832131efe40db22f2c65a57f461d849` (`@anthropic-ai/sandbox-runtime` 0.0.67).
 *
 * Rationale: `(deny file-read* (subpath P))` matches `P` by path string. Without these rules, a
 * confined process is blocked from reading or renaming `P` directly, yet renaming an ancestor of
 * `P` moves the protected subtree to an unlisted path where it becomes readable. Although the
 * command wall denies writes outside the seat root, `userTempRules` permits writes inside
 * `mktemp`-shaped directories in the per-user temporary directory. A denied root located inside
 * such a directory (as in rehearsals and tests) would otherwise have a renameable ancestor;
 * `test/solve-sandbox.test.ts` verifies that this rename is blocked.
 *
 * Deliberate departures from upstream:
 * - No `(with message ...)` log tag. Upstream appends a per-session random suffix for log-stream
 *   attribution, which is unused here and would prevent deterministic profile byte output.
 * - Literal paths only. Every path reaching this module is an already-canonicalised absolute root,
 *   so upstream's glob branch would be unreachable dead code with unnecessary escaping complexity.
 */
import { posixContainsPath } from "../meta/path-containment.ts";
import { ancestorDirectories } from "./policy.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";

/** Upstream operation pair: `file-write-unlink` blocks moving a protected path away, and
 *  `file-write-create` blocks replacing it with a symbolic link. */
const MOVE_OPS = ["file-write-unlink", "file-write-create"] as const;

/** Returns whether a denial rooted at `root` covers `target`. SBPL paths are always POSIX-separated. */
export function covers(root: string, target: string): boolean {
  return posixContainsPath(target, root);
}

/** Emits a single SBPL rule block for a verb and path list, or an empty array when `paths` is
 *  empty. Routing all path-list rules through this helper keeps quoting and empty-list handling
 *  consistent across the command profile. */
export function sbRule(verb: string, form: "subpath" | "literal", paths: readonly string[]): string[] {
  return paths.length === 0
    ? []
    : [`(${verb}`, ...paths.map((path) => `  (${form} ${capturedJsonStringify(path)})`), ")"];
}

/**
 * Generates denial rules ensuring `protectedRoots` remain at the paths named by read denials.
 * Roots and ancestors are sorted and deduplicated so identical inputs produce identical profile
 * bytes for policy hashing.
 */
export function moveBlockingRules(protectedRoots: readonly string[]): string[] {
  const roots = [...new Set(protectedRoots)].toSorted();
  if (roots.length === 0) return [];
  // Include every ancestor directory that a rename could move to relocate a protected root.
  // Exclude `/` because the root inode cannot be renamed and denying it would block root access.
  const ancestors = [...new Set(roots.flatMap((root) => ancestorDirectories(root)))]
    .filter((path) => path !== "/")
    .toSorted();
  return MOVE_OPS.flatMap((op) => [
    `(deny ${op}`,
    ...roots.map((path) => `  (subpath ${capturedJsonStringify(path)})`),
    ...ancestors.map((path) => `  (literal ${capturedJsonStringify(path)})`),
    ")",
  ]);
}
