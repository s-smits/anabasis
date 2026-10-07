/**
 * Shared path-containment checks: true when a resolved or realpathed path is the root itself or
 * lies under it. The isolation and admission guards each used to write this out, which is nine
 * chances to forget the separator that makes `/srv/shared` stop containing `/srv/sharedx`. The
 * check here is lexical, so it decides containment of a path someone else has already resolved and
 * is not a symlink defence on its own.
 *
 * Kept apart from `meta/path`, which holds only `node:path` re-exports; these two need a local
 * binding of `sep` rather than being re-exported.
 */
import { sep } from "./path.ts";

/** Host-separator containment for paths on this platform's filesystem. */
export function containsPath(path: string, root: string): boolean {
  if (path === root) return true;
  if (root === sep) return path.startsWith(sep);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  return path.startsWith(boundary);
}

/** Containment for POSIX paths. Seatbelt profiles and Bubblewrap arguments spell their paths with
 *  "/" whatever the caller's platform is, so this check keeps their format independent of the
 *  host's separator. */
export function posixContainsPath(path: string, root: string): boolean {
  if (path === root) return true;
  if (root === "/") return path.startsWith("/");
  const boundary = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(boundary);
}
