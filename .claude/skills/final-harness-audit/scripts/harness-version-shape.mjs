import { taskSetFacts, taskTransitionFacts } from "./harness-task-facts.mjs";
import { isString } from "#src/meta/json-shape.ts";

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
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function kindOf(path) {
  const extension = path.includes(".") ? path.split(".").at(-1).toLowerCase() : "";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (DATA_EXTENSIONS.has(extension)) return "data";
  if (["md", "txt"].includes(extension)) return "prose";
  return "other";
}

function emptyKinds() {
  return { code: 0, data: 0, prose: 0, other: 0 };
}

function fileRows(git, workspace, commit) {
  const listed = git(workspace, ["ls-tree", "-r", "-z", "--name-only", commit, "--", ...PRODUCT_ROOTS]);
  return listed
    .split("\0")
    .filter(Boolean)
    .sort()
    .map((path) => {
      const text = git(workspace, ["show", `${commit}:${path}`]);
      return {
        path,
        kind: kindOf(path),
        bytes: new TextEncoder().encode(text).byteLength,
        nonBlankLines: text.split("\n").filter((line) => line.trim() !== "").length,
      };
    });
}

function byRoot(rows) {
  const roots = {};
  for (const row of rows) {
    const root = row.path.split("/")[0] ?? ".";
    const value = roots[root] ?? { files: 0, nonBlankLines: 0 };
    value.files += 1;
    value.nonBlankLines += row.nonBlankLines;
    roots[root] = value;
  }
  return Object.fromEntries(Object.entries(roots).sort(([a], [b]) => compareText(a, b)));
}

export function productTreeFacts(git, workspace, commit) {
  const rows = fileRows(git, workspace, commit);
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

function numstatRows(git, workspace, base, commit) {
  if (!isString(base) || base === "" || base === commit) return [];
  const output = git(workspace, [
    "diff",
    "--numstat",
    "--no-renames",
    base,
    commit,
    "--",
    ...PRODUCT_ROOTS,
  ]).trim();
  if (output === "") return [];
  return output.split("\n").map((line) => {
    const [added, deleted, path] = line.split("\t");
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

export function productDiffFacts(git, workspace, base, commit) {
  const rows = numstatRows(git, workspace, base, commit);
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

export function taskTextAt(git, workspace, commit) {
  try {
    return git(workspace, ["show", `${commit}:correctness-model/tasks.json`]);
  } catch {
    return null;
  }
}

export function checkpointFacts(git, workspace, row, starterCommit, previousCheckpoint) {
  const taskText = taskTextAt(git, workspace, row.commit);
  const previousTaskText =
    previousCheckpoint === null ? null : taskTextAt(git, workspace, previousCheckpoint.commit);
  return {
    productTree: productTreeFacts(git, workspace, row.commit),
    fromWorkspaceBase: productDiffFacts(git, workspace, row.baseCommit, row.commit),
    fromStarter: productDiffFacts(git, workspace, starterCommit, row.commit),
    fromPreviousCheckpoint:
      previousCheckpoint === null
        ? null
        : productDiffFacts(git, workspace, previousCheckpoint.commit, row.commit),
    taskSet:
      taskText === null ? { state: "unobservable", reason: "tasks.json is absent" } : taskSetFacts(taskText),
    taskTransition:
      taskText === null || previousTaskText === null ? null : taskTransitionFacts(previousTaskText, taskText),
  };
}
