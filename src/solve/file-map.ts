/**
 * The declared open file map: a public artifact field whose keys are safe relative POSIX file
 * paths and whose values are text file contents. The Builder declares it with "fileMap": true on
 * an artifactSchema field; control filenames stay examples and never become the allowed key set.
 * public-artifact-schema.ts uses these rules when compiling the field; the shell and public
 * artifact validator use the same path and content checks.
 */
import { isString, typeName, type JsonValue } from "../meta/json-shape.ts";

import type {
  PublicArtifactFieldInput,
  PublicArtifactSchemaIssue,
  PublicArtifactSchemaNode,
} from "./public-artifact-schema.ts";

export const FILE_MAP_MAX_ENTRIES = 512;
export const FILE_MAP_MAX_PATH_CHARS = 512;
export const FILE_MAP_EXPECTED = "a map from safe relative POSIX file paths to string file contents";

/** Replaces each declared fileMap field's control-inferred shape with the open file-map node. */
export function applyFileMapFields(
  declaredFields: readonly PublicArtifactFieldInput[],
  properties: Record<string, PublicArtifactSchemaNode>,
): void {
  for (const field of declaredFields) {
    if (field.fileMap === undefined) continue;
    if (field.fileMap !== true) {
      throw new Error(`public artifact schema field "${field.name}" fileMap must be the literal true`);
    }
    if (field.allowedValues !== undefined) {
      throw new Error(
        `public artifact schema field "${field.name}" cannot declare both fileMap and allowedValues`,
      );
    }
    properties[field.name] = { kind: "file-map" };
  }
}

/** Names what is wrong with a file-map key, or null for a safe relative POSIX file path. The
 *  shell's file exchange validates its own paths through this, so what a command may hand back
 *  and what the public artifact accepts are one rule rather than two that can drift. */
export function pathProblem(key: string): string | null {
  if (key === "") return "an empty path";
  if (key.length > FILE_MAP_MAX_PATH_CHARS) {
    return `a path longer than ${FILE_MAP_MAX_PATH_CHARS} characters`;
  }
  if (key.includes("\0") || key.includes("\\")) return "a path with NUL or backslash";
  if (key.startsWith("/")) return "an absolute path";
  const segments = key.split("/");
  if (segments.includes("")) return "a path with an empty segment";
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return 'a path with a "." or ".." segment';
  }
  return null;
}

export function fileMapIssues(
  files: Record<string, JsonValue>,
  path: string,
  childPath: (path: string, key: string) => string,
): PublicArtifactSchemaIssue[] {
  const issues: PublicArtifactSchemaIssue[] = [];
  const keys = Object.keys(files);
  if (keys.length > FILE_MAP_MAX_ENTRIES) {
    issues.push({ path, expected: `at most ${FILE_MAP_MAX_ENTRIES} files`, actual: `${keys.length} files` });
  }
  for (const key of keys) {
    const problem = pathProblem(key);
    if (problem !== null) {
      issues.push({
        path: childPath(path, key),
        expected: "a safe relative POSIX file path",
        actual: problem,
      });
    } else if (keys.some((other) => other.startsWith(`${key}/`))) {
      issues.push({
        path: childPath(path, key),
        expected: "a path that is not both a file and a directory",
        actual: "a file whose path is also a directory of another file",
      });
    }
    if (!isString(files[key])) {
      issues.push({
        path: childPath(path, key),
        expected: "string file contents",
        actual: typeName(files[key]),
      });
    }
  }
  return issues;
}
