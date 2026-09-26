import { gitOutput } from "#skills/main/git.ts";
import { taskSetFacts, taskTransitionFacts } from "./harness-task-facts.ts";
import { isString, type JsonValue } from "#src/meta/json-shape.ts";
import type { TaskSetFacts, TaskTransitionFacts } from "./harness-task-facts.ts";

type Kind = "code" | "data" | "prose" | "other";
type KindCounts = Record<Kind, number>;
type FileRow = { path: string; kind: Kind; bytes: number; nonBlankLines: number };
type RootCounts = Record<string, { files: number; nonBlankLines: number }>;
type NumstatRow = { path: string; kind: Kind; added: number | null; deleted: number | null; binary: boolean };
export type ProductTreeFacts = {
  files: number;
  bytes: number;
  nonBlankLines: number;
  linesByKind: KindCounts;
  byRoot: RootCounts;
  largestFiles: FileRow[];
  largestCodeFiles: FileRow[];
};
export type ProductDiffFacts = {
  base: JsonValue;
  filesChanged: number;
  added: number;
  deleted: number;
  binaryFiles: number;
  addedByKind: KindCounts;
  deletedByKind: KindCounts;
  paths: NumstatRow[];
};
/** The two fields of a version row a checkpoint reads. */
export type CheckpointSubject = { commit: string; baseCommit: JsonValue };
export type CheckpointFacts = {
  productTree: ProductTreeFacts;
  fromWorkspaceBase: ProductDiffFacts;
  fromStarter: ProductDiffFacts;
  fromPreviousCheckpoint: ProductDiffFacts | null;
  taskSet: TaskSetFacts;
  taskTransition: TaskTransitionFacts | null;
};

const PRODUCT_ROOTS = ["agent", "correctness-model"];
const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hh",
  "hpp",
  "js",
  "jsx",
  "mjs",
  "mts",
  "py",
  "ts",
  "tsx",
]);
const DATA_EXTENSIONS = new Set(["json", "jsonl", "toml", "yaml", "yml"]);
const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

function kindOf(path: string): Kind {
  const extension = path.includes(".") ? (path.split(".").at(-1) ?? "").toLowerCase() : "";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (DATA_EXTENSIONS.has(extension)) return "data";
  if (["md", "txt"].includes(extension)) return "prose";
  return "other";
}

function emptyKinds(): KindCounts {
  return { code: 0, data: 0, prose: 0, other: 0 };
}

function fileRows(workspace: string, commit: string): FileRow[] {
  const listed = gitOutput(workspace, "ls-tree", "-r", "-z", "--name-only", commit, "--", ...PRODUCT_ROOTS);
  return listed
    .split("\0")
    .filter(Boolean)
    .sort()
    .map((path) => {
      const text = gitOutput(workspace, "show", `${commit}:${path}`);
      return {
        path,
        kind: kindOf(path),
        bytes: new TextEncoder().encode(text).byteLength,
        nonBlankLines: text.split("\n").filter((line) => line.trim() !== "").length,
      };
    });
}

function byRoot(rows: readonly FileRow[]): RootCounts {
  const roots: RootCounts = {};
  for (const row of rows) {
    const root = row.path.split("/")[0] ?? ".";
    const value = roots[root] ?? { files: 0, nonBlankLines: 0 };
    value.files += 1;
    value.nonBlankLines += row.nonBlankLines;
    roots[root] = value;
  }
  return Object.fromEntries(Object.entries(roots).sort(([a], [b]) => compareText(a, b)));
}

export function productTreeFacts(workspace: string, commit: string): ProductTreeFacts {
  const rows = fileRows(workspace, commit);
  const byKind = emptyKinds();
  for (const row of rows) byKind[row.kind] += row.nonBlankLines;
  const bySize = [...rows].sort((a, b) => b.nonBlankLines - a.nonBlankLines || compareText(a.path, b.path));
  return {
    files: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    nonBlankLines: rows.reduce((sum, row) => sum + row.nonBlankLines, 0),
    linesByKind: byKind,
    byRoot: byRoot(rows),
    largestFiles: bySize.slice(0, 8),
    largestCodeFiles: bySize.filter((row) => row.kind === "code").slice(0, 8),
  };
}

function numstatRows(workspace: string, base: JsonValue, commit: string): NumstatRow[] {
  if (!isString(base) || base === "" || base === commit) return [];
  const output = gitOutput(
    workspace,
    "diff",
    "--numstat",
    "--no-renames",
    base,
    commit,
    "--",
    ...PRODUCT_ROOTS,
  ).trim();
  if (output === "") return [];
  return output.split("\n").map((line) => {
    const [added, deleted, path = ""] = line.split("\t");
    const binary = added === "-" || deleted === "-";
    return {
      path,
      kind: kindOf(path),
      added: binary ? null : Number(added),
      deleted: binary ? null : Number(deleted),
      binary,
    };
  });
}

export function productDiffFacts(workspace: string, base: JsonValue, commit: string): ProductDiffFacts {
  const rows = numstatRows(workspace, base, commit);
  const addedByKind = emptyKinds();
  const deletedByKind = emptyKinds();
  for (const row of rows) {
    if (row.added !== null) addedByKind[row.kind] += row.added;
    if (row.deleted !== null) deletedByKind[row.kind] += row.deleted;
  }
  return {
    base,
    filesChanged: rows.length,
    added: rows.reduce((sum, row) => sum + (row.added ?? 0), 0),
    deleted: rows.reduce((sum, row) => sum + (row.deleted ?? 0), 0),
    binaryFiles: rows.filter((row) => row.binary).length,
    addedByKind,
    deletedByKind,
    paths: rows.sort(
      (a, b) =>
        (b.added ?? 0) + (b.deleted ?? 0) - ((a.added ?? 0) + (a.deleted ?? 0)) ||
        compareText(a.path, b.path),
    ),
  };
}

export function taskTextAt(workspace: string, commit: string): string | null {
  try {
    return gitOutput(workspace, "show", `${commit}:correctness-model/tasks.json`);
  } catch {
    return null;
  }
}

export function checkpointFacts(
  workspace: string,
  row: CheckpointSubject,
  starterCommit: string,
  previousCheckpoint: CheckpointSubject | null,
): CheckpointFacts {
  const taskText = taskTextAt(workspace, row.commit);
  const previousTaskText =
    previousCheckpoint === null ? null : taskTextAt(workspace, previousCheckpoint.commit);
  return {
    productTree: productTreeFacts(workspace, row.commit),
    fromWorkspaceBase: productDiffFacts(workspace, row.baseCommit, row.commit),
    fromStarter: productDiffFacts(workspace, starterCommit, row.commit),
    fromPreviousCheckpoint:
      previousCheckpoint === null ? null : productDiffFacts(workspace, previousCheckpoint.commit, row.commit),
    taskSet:
      taskText === null ? { state: "unobservable", reason: "tasks.json is absent" } : taskSetFacts(taskText),
    taskTransition:
      taskText === null || previousTaskText === null ? null : taskTransitionFacts(previousTaskText, taskText),
  };
}
