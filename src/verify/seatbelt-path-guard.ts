/**
 * A Seatbelt denial names a path string. This file handles two ways that string can fail to
 * protect the intended bytes:
 *
 * 1. Path form. `/var/folders/...` and `/private/var/folders/...` are the same directory, and the kernel
 *    matches the canonical one. A denial naming only the symlink form can miss the protected
 *    read. `canonicalForms` in `wall-policy.ts` returns both.
 * 2. Location. A confined process that can rename an ancestor of a denied path moves the protected
 *    bytes to a path no rule mentions. `moveBlockingRules` denies those renames.
 *
 * The rename rules are copied, with the two departures named below, from `generateMoveBlockingRules`
 * in anthropic-experimental/sandbox-runtime, `src/sandbox/macos-sandbox-utils.ts`, Apache-2.0,
 * pinned at 295f0e1af832131efe40db22f2c65a57f461d849 (@anthropic-ai/sandbox-runtime 0.0.67).
 *
 * Why the rules exist. `(deny file-read* (subpath P))` names P as a string, so a confined process
 * that can rename an ancestor of P relocates the protected bytes to a path no rule mentions and
 * reads them there. Measured against a profile without these rules: a direct read of the canary is
 * refused, renaming the denied directory itself is refused, and renaming its parent succeeds and
 * returns the canary at exit 0. These rules refuse that last rename.
 *
 * The hole belongs to the allow-by-default posture the command wall needs, so that a command
 * reaches the network and the host's programs (`solve-command-isolation.ts`). The verifier
 * isolation never had it: `darwin-seatbelt.ts` is deny-by-default and allows writes only under its
 * private workdir, so a rename elsewhere has no allow to match and needs no rule of this kind.
 *
 * Two deliberate departures from upstream:
 * - No `(with message ...)` log tag. Upstream tags its rules so a log stream can attribute
 *   violations, and the tag carries a per-session random suffix. Nothing here reads that stream,
 *   and a random tag would make two launches of one policy differ in their bytes.
 * - Literal paths only. Every path reaching this isolation is an already-canonicalised absolute
 *   root, so upstream's glob branch would be dead code here, carrying its own escaping risk for a
 *   spelling nothing emits.
 */
import { posixContainsPath } from "../meta/path-containment.ts";
import { ancestorDirectories } from "./wall-policy.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";

/** Whether a deny rooted at `root` reaches `target`. SBPL paths are always "/"-separated. */
export function covers(root: string, target: string): boolean {
  return posixContainsPath(target, root);
}

/** One SBPL rule block: a verb and its path filters, or nothing when no path applies. Every profile
 *  in this family emits through here, so the solve and verifier isolations cannot drift apart on
 *  quoting or on what an empty path list means. */
export function sbRule(verb: string, form: "subpath" | "literal", paths: readonly string[]): string[] {
  return paths.length === 0
    ? []
    : [`(${verb}`, ...paths.map((path) => `  (${form} ${capturedJsonStringify(path)})`), ")"];
}

/** Upstream's pair. `file-write-unlink` covers the rename's source and `file-write-create` its
 *  destination, so neither moving a protected path away nor putting a symlink in its place is
 *  available. */
const MOVE_OPS = ["file-write-unlink", "file-write-create"] as const;

/** Every directory a rename could relocate a protected root through. `/` is dropped: it is not
 *  renameable and naming it would deny the root inode itself. */
export function guardedAncestors(protectedRoots: readonly string[]): string[] {
  const ancestors = protectedRoots.flatMap((root) => ancestorDirectories(root));
  return [...new Set(ancestors)].filter((path) => path !== "/").sort();
}

/**
 * Deny rules that keep `protectedRoots` reachable only at the paths the read denies name. Sorted
 * and de-duplicated because these lines are part of the hashed profile: two runs with the same
 * roots must emit the same bytes.
 */
export function moveBlockingRules(protectedRoots: readonly string[]): string[] {
  const roots = [...new Set(protectedRoots)].sort();
  if (roots.length === 0) return [];
  const ancestors = guardedAncestors(roots);
  return MOVE_OPS.flatMap((op) => [
    `(deny ${op}`,
    ...roots.map((path) => `  (subpath ${capturedJsonStringify(path)})`),
    ...ancestors.map((path) => `  (literal ${capturedJsonStringify(path)})`),
    ")",
  ]);
}
