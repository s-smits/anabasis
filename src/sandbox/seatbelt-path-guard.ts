import { posixContainsPath } from "../meta/path-containment.ts";
import { ancestorDirectories } from "./policy.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";

const MOVE_OPS = ["file-write-unlink", "file-write-create"] as const;

export function covers(root: string, target: string): boolean {
  return posixContainsPath(target, root);
}

export function sbRule(verb: string, form: "subpath" | "literal", paths: readonly string[]): string[] {
  return paths.length === 0
    ? []
    : [`(${verb}`, ...paths.map((path) => `  (${form} ${capturedJsonStringify(path)})`), ")"];
}

export function moveBlockingRules(protectedRoots: readonly string[]): string[] {
  const roots = [...new Set(protectedRoots)].toSorted();
  if (roots.length === 0) return [];
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
