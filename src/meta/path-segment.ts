/**
 * The one predicate behind every path-segment admission check in the tree.
 *
 * Project ids, run ids and observation ids are used verbatim in controller-owned paths, so the
 * charset deliberately excludes separators and leading dots; the explicit `..` guard then rejects
 * the traversal-shaped names that the admitted character set would otherwise let through.
 */
import { capturedJsonStringify } from "./json-runtime.ts";
export function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..");
}

export function assertPathSegment(label: string, value: string): void {
  if (!isSafePathSegment(value)) {
    throw new Error(
      `${label} ${capturedJsonStringify(value)} is not a safe single path segment — use [A-Za-z0-9._-], starting alphanumeric, no ".."`,
    );
  }
}

/** Names the controller itself derives beside an operator-selected project or run id. A generated
 *  internal id still passes `assertPathSegment`; only an external base identity is kept out of
 *  these namespaces, and it is kept out before any path is opened. */
export function assertExternalPathSegment(label: "project" | "runId", value: string): void {
  assertPathSegment(label, value);
  const reserved =
    label === "project"
      ? value === "default" || value.endsWith(".incoming")
      : value === "latest" || value.endsWith("-install-journal") || /-i\d{2,}$/.test(value);
  if (reserved) {
    throw new Error(`${label} ${capturedJsonStringify(value)} is reserved for controller-derived paths`);
  }
}
