import { sep } from "./path.ts";

export function containsPath(path: string, root: string): boolean {
  if (path === root) return true;
  if (root === sep) return path.startsWith(sep);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  return path.startsWith(boundary);
}

export function posixContainsPath(path: string, root: string): boolean {
  if (path === root) return true;
  if (root === "/") return path.startsWith("/");
  const boundary = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(boundary);
}
