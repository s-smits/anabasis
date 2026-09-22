/**
 * Operator-owned backend choices for one project. `.harness/backends/<project>.json` is the only
 * mutable source: the resolver reads it and this module validates and atomically updates it.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync } from "../meta/filesystem.ts";
import { dirname } from "../meta/path.ts";
// The project registry, not an output directory, decides whether a project exists.
import { recordedProjects } from "../run/project-registry.ts";
import { type JsonValue, isRecord } from "../meta/json-shape.ts";
import {
  type ProjectBackendSelection,
  type ProjectBackendSlot,
  assertProjectBackendSelection,
  operatorBackendsPath,
} from "./project-backend-policy.ts";
import { readJsonFile, writeAtomic } from "../meta/completed-json.ts";
export {
  type ProjectBackendChoice,
  type ProjectBackendSelection,
  type ProjectBackendSlot,
  backendSupportsSlot,
  defaultBackendFor,
  operatorBackendsPath,
  projectBackendChoices,
  requireSlotSupport,
} from "./project-backend-policy.ts";

type JsonObject = Record<string, JsonValue>;

function readOperatorObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  const parsed: unknown = readJsonFile(path);
  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed;
}

function nextOperatorObject(prior: JsonObject, slot: ProjectBackendSlot, selection: ProjectBackendSelection) {
  // An absent review slot takes the standing default, so an off decision needs an explicit marker.
  if (selection === "disabled") return { ...prior, review: { disabled: true } };
  const next = { ...prior };
  if (selection === "inherit") {
    next.review = { inherit: true };
  } else {
    next[slot] = { kind: selection };
  }
  return next;
}

/** Admit one slot selection from a CLI flag with the write side's own rules, so a typo is refused
 *  before a run acquires state. Selections name a kind only; models are resolver-owned. */
export function admitBackendSelection(slot: ProjectBackendSlot, value: string): ProjectBackendSelection {
  const selection =
    /* SAFETY: the assertion on the next line throws unless the value is an admitted selection. */ value as ProjectBackendSelection;
  assertProjectBackendSelection(slot, selection);
  return selection;
}

export function setProjectBackendSelection(
  repoRoot: string,
  projectId: string,
  slot: ProjectBackendSlot,
  selection: ProjectBackendSelection,
): string {
  const path = operatorBackendsPath(repoRoot, projectId);
  if (!recordedProjects(repoRoot).includes(projectId)) {
    throw new Error(`unknown project ${capturedJsonStringify(projectId)}`);
  }
  assertProjectBackendSelection(slot, selection);
  const next = nextOperatorObject(readOperatorObject(path), slot, selection);
  mkdirSync(dirname(path), { recursive: true });
  // The trailing newline is why this is not `writeCompleted`: the file is operator-edited.
  writeAtomic(path, `${capturedJsonStringify(next, null, 2)}\n`);
  return path;
}
