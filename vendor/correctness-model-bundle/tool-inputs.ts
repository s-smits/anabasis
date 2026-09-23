/** Which bytes a check may hand to an installed tool. An `external` check declares that tool as the
 *  instrument that decides it, so the bytes it feeds the tool have to come from the artifact or the
 *  public input it was given: a check free to construct its own operand is running the author's
 *  algorithm through an installed interpreter, which is authored computation wearing an external
 *  check's name. So an external request's files and stdin must each be a string that appears at some
 *  path of the declared inputs, and an `authored` check, which never claimed otherwise, may build
 *  what it likes. The same binding runs in the author's local evaluation and again in the host, and
 *  the host's run is the one that counts. */
import { canonicalJson } from "../../src/meta/stable-json.ts";
import { capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import type { ToolRunRequest } from "../../src/verify/verifier-port.ts";

/** Bytes can occur at several declared paths; preserve every possible source in the receipt. */
function collectLeaves(value: unknown, root: string, into: Map<string, string[]>): void {
  const visit = (node: unknown, path: string): void => {
    if (isString(node)) {
      const paths = into.get(node);
      if (paths === undefined) into.set(node, [path]);
      else paths.push(path);
    } else if (Array.isArray(node)) node.forEach((item, index) => visit(item, `${path}[${String(index)}]`));
    else if (isRecord(node)) {
      for (const [key, item] of Object.entries(node)) {
        const suffix = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${capturedJsonStringify(key)}]`;
        visit(item, `${path}${suffix}`);
      }
    }
  };
  visit(value, root);
  for (const json of new Set([capturedJsonStringify(value), canonicalJson(value)])) {
    if (json !== undefined) into.set(json, [...(into.get(json) ?? []), root]);
  }
}

export function toolInputLeaves(
  artifact: unknown,
  publicTask: unknown,
  hidden?: unknown,
): Map<string, string[]> {
  const leaves = new Map<string, string[]>();
  collectLeaves(artifact, "artifact:$", leaves);
  if (publicTask !== null) collectLeaves(publicTask, "task:$", leaves);
  if (hidden !== undefined) collectLeaves(hidden, "hidden:$", leaves);
  return leaves;
}

/** Authored checks may construct operands; external evidence keeps its declared-byte binding.
 * The selected check owns the mode, never the request. Cells, tools and receipts remain host-owned. */
export function toolInputViolation(
  request: ToolRunRequest,
  leaves: ReadonlyMap<string, string[]>,
  kind: "authored" | "external" = "external",
): string | null {
  if (request.files !== undefined && !isRecord(request.files)) {
    return "files must be a record of text contents";
  }
  for (const [name, content] of Object.entries(request.files ?? {})) {
    if (!isString(content)) return `file "${name}" must contain text`;
    if (kind === "external" && !leaves.has(content)) {
      return `file "${name}" is not a string leaf or JSON of the declared artifact/public input`;
    }
  }
  const stdin = request.stdin ?? null;
  return stdin !== null && (!isString(stdin) || (kind === "external" && !leaves.has(stdin)))
    ? "stdin is not a string leaf of the artifact or public task"
    : null;
}
