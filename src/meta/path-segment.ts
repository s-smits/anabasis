/**
 * The one predicate behind every path-segment admission check. Project, run and observation ids
 * are used verbatim in controller-owned paths, so the charset excludes separators and leading dots,
 * and `..` is refused explicitly.
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

/** Names the controller derives beside an operator-selected project or run id; an external base
 *  identity may not claim them. */
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
