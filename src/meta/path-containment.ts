/**
 * Shared path-containment checks: true when a resolved or realpathed path is the root itself or
 * lies under it. The check is lexical, so it is not a symlink defence on its own.
 */
import { sep } from "./path.ts";

/** Host-separator containment for paths on this platform's filesystem. */
export function containsPath(path: string, root: string): boolean {
  if (path === root) return true;
  if (root === sep) return path.startsWith(sep);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  return path.startsWith(boundary);
}

/** Containment for POSIX paths, as Seatbelt profiles and Bubblewrap arguments use on any host. */
export function posixContainsPath(path: string, root: string): boolean {
  if (path === root) return true;
  if (root === "/") return path.startsWith("/");
  const boundary = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(boundary);
}
