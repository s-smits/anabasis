/**
 * Shared path-containment checks: true when a resolved or realpathed path is
 * the root itself or lies under it. Previously hand-written at nine isolation and admission
 * guards; a lexical check here is not a symlink defence on its own.
 *
 * Kept separate from meta/path because that module contains only node:path
 * re-exports and these functions need a local binding.
 */
import { sep } from "./path.ts";

/** Host-separator containment for paths on this platform's filesystem. */
export function containsPath(path: string, root: string): boolean {
  if (path === root) return true;
  if (root === sep) return path.startsWith(sep);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  return path.startsWith(boundary);
}

/** Containment for POSIX paths. Seatbelt profiles and Bubblewrap arguments use "/"
 *  separators regardless of the caller's platform, so this check keeps their path format
 *  independent of the host's separator. */
export function posixContainsPath(path: string, root: string): boolean {
  if (path === root) return true;
  if (root === "/") return path.startsWith("/");
  const boundary = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(boundary);
}
