/**
 * Operator-owned backend choices for one project.
 *
 * `.harness/backends/<project>.json` is the only mutable source: the runtime resolver reads it and
 * this module validates and atomically updates it. Nothing else moves, which is the point -- an
 * operator changing the backend for a future run must leave generated domains and historical run
 * evidence exactly as they were recorded.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync } from "../meta/filesystem.ts";
import { dirname } from "../meta/path.ts";
// The project registry decides whether a project exists. This dependency (backends -> run) is
// deliberate: it lets the selection check read that registry instead of inferring existence from
// output directories, an inference that misses a freshly registered project with no output yet and
// refuses its launch flags.
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
  // Write an explicit disabled marker. The resolver layers default.json under a project file per
  // slot, so an absent review slot means "nobody chose" and takes the standing default; only this
  // marker carries an operator's off decision through a later write to some other slot, and it is
  // what separates a chosen off from a silent one.
  if (selection === "disabled") return { ...prior, review: { disabled: true } };
  const next = { ...prior };
  if (selection === "inherit") {
    next.review = { inherit: true };
  } else {
    next[slot] = { kind: selection };
  }
  return next;
}

/** The flag-side admission for one slot selection: the same vocabulary and support rows the write
 *  side enforces, exported so a CLI refuses a typo before a run acquires any state. The vocabulary
 *  is kind-level -- "codex", never "codex/gpt-5.5" -- because models are resolver-owned per kind,
 *  and a model inside a pin would be a second owner for that fact. */
export function admitBackendSelection(slot: ProjectBackendSlot, value: string): ProjectBackendSelection {
  const selection =
    /* SAFETY: the assertion on the next line throws unless the value is one of the admitted
     *  selections, so this function returns only admitted ones. */
    value as ProjectBackendSelection;
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
