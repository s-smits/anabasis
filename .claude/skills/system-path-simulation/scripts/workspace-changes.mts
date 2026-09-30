/**
 * What changed in a segment workspace, minus the files a session always touches.
 *
 * Every live segment asks this same question three times — once inside the handover module that
 * decides whether the next stage opens, once in each prediction's caught/missed clause, and once by
 * hand at adjudication — and each copy has been retyped. The 2026-08-17 conditions are the record of why
 * that is worth one function: the handover module ran `git status --porcelain`, trimmed the whole
 * output, and so removed the leading space of the FIRST line only, whose `slice(3)` then ate a
 * character. The recorded evidence for that run says `EMORY.md`. The bug was in the operator's script,
 * not the product, but it landed in the evidence, which is the worst place for it.
 *
 * As a module, inside a handover:
 *
 *   import { changedPaths } from "../../.claude/skills/system-path-simulation/scripts/workspace-changes.mts";
 *   const changed = changedPaths(ctx.workspace);
 *   if (changed.substantive.length === 0) return { ok: false, reason: "nothing changed" };
 *
 * As a command, for adjudication:
 *
 *   bun .claude/skills/system-path-simulation/scripts/workspace-changes.mts \
 *     /abs/epoch/workspace [--since root|HEAD|<rev>]
 *
 * The command diffs from the workspace's root commit by default, the controller's seeding commit.
 * On 2026-09-30 it came back empty for a firmware condition whose Builder had changed four files:
 * the controller's "salvage: unsettled tree before checkpoint" commits had moved HEAD six times, so
 * a status against HEAD saw a clean tree. `--since HEAD` is the handover's view, which the module
 * function keeps as its default.
 */

import { lstatSync, readFileSync, readlinkSync } from "#src/meta/filesystem.ts";
import { resolve } from "#src/meta/path.ts";
import { exitWith, parseOrDie } from "#skills/main/cli.ts";
import { gitOutput, gitText } from "#skills/main/git.ts";
import { isString } from "#src/meta/json-shape.ts";
import { keyIfNotNull } from "#src/meta/optional-key.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { BUILT_AGENTS_FILE } from "#src/solve/built-starter.ts";

/** These note files can change without a product edit, so the default filtered list omits them.
 *  BUILT_AGENTS.md can also carry meaningful agent instructions: inspect it when that is the
 *  question, or pass an empty exclusion list. The result retains both lists so reports can name
 *  which one they used. */
export const SESSION_NOTE_PATHS = ["MEMORY.md", "SCRATCHPAD.md", BUILT_AGENTS_FILE];

export interface WorkspaceChanges {
  /** Every path git reports as changed, in git's own order. */
  all: string[];
  /** The same list without the excluded note files — the one a prediction should be phrased on. */
  substantive: string[];
  /** sha256 of HEAD, raw status and current changed-path bytes. The legacy name is kept for callers. */
  diffSha: string;
  /** The commit the paths are counted from, when not the status against HEAD. */
  since?: string;
}

interface PorcelainStatus {
  raw: string;
  paths: string[];
}

/** NUL porcelain preserves whitespace, newlines and literal ` -> ` text in paths. For a rename or
 * copy Git emits the destination first and the source as the next NUL field; only the destination
 * is part of the current workspace, while the raw bytes below bind both names into the digest. */
function porcelainStatus(workspace: string): PorcelainStatus {
  const raw = gitOutput(workspace, "status", "--porcelain=v1", "-z", "--untracked-files=all");
  const fields = raw.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === undefined || field === "") continue;
    const status = new Set(field.slice(0, 2));
    paths.push(field.slice(3));
    if (status.has("R") || status.has("C")) index += 1;
  }
  return { raw, paths };
}

/** Every path that differs from `base` in the working tree, committed or not, then every untracked
 *  path. Renames are split into their two sides, so both names are listed. */
function statusSince(workspace: string, base: string): PorcelainStatus {
  const tracked = gitOutput(workspace, "diff", "--name-only", "-z", "--no-renames", base, "--");
  const untracked = gitOutput(workspace, "ls-files", "--others", "--exclude-standard", "-z");
  const paths = [...tracked.split("\0"), ...untracked.split("\0")].filter((path) => path !== "");
  return { raw: `${tracked}\0\0${untracked}`, paths };
}

/** The controller's seeding commit: the workspace's root, which no checkpoint commit moves. */
export function seedCommit(workspace: string): string {
  const roots = gitText(workspace, "rev-list", "--max-parents=0", "HEAD").split("\n");
  const [root] = roots;
  if (roots.length !== 1 || root === undefined || root === "") {
    throw new Error(`${workspace} has ${roots.length} root commits; pass --since <rev>`);
  }
  return root;
}

function hashField(hash: Bun.CryptoHasher, label: string, value: string | Uint8Array): void {
  const bytes = isString(value) ? new TextEncoder().encode(value) : value;
  hash.update(`${label}:${bytes.length}\0`);
  hash.update(bytes);
}

/** `git diff` omits untracked files and, without HEAD, staged changes. Bind the baseline, Git's raw
 * status and the realised bytes at every current path instead. This also distinguishes two conditions
 * that create the same filename with different content, which the previous empty-diff hash did not. */
function workspaceChangeDigest(workspace: string, status: PorcelainStatus, since: string | null): string {
  const hash = new Bun.CryptoHasher("sha256");
  hashField(hash, "format", "workspace-change/v2");
  hashField(hash, "head", gitOutput(workspace, "rev-parse", "HEAD"));
  if (since !== null) hashField(hash, "since", since);
  hashField(hash, "status", status.raw);
  for (const path of [...new Set(status.paths)].sort()) {
    hashField(hash, "path", path);
    const absolute = resolve(workspace, path);
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        hashField(hash, "kind", "symlink");
        hashField(hash, "bytes", readlinkSync(absolute));
      } else if (stat.isFile()) {
        hashField(hash, "kind", "file");
        hashField(hash, "bytes", readFileSync(absolute));
      } else {
        hashField(hash, "kind", stat.isDirectory() ? "directory" : "other");
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      hashField(hash, "kind", "missing");
    }
  }
  return hash.digest("hex");
}

/**
 * Read the workspace's changed paths. `exclude` defaults to the session note files; pass `[]` to
 * count everything. `since` counts from that commit instead of from HEAD, commits included.
 *
 * The parsing is the whole point of having this in one place. NUL-delimited porcelain keeps every
 * legal path byte out of the record delimiter and reports every untracked file rather than folding
 * an untracked directory into one directory row.
 */
export function changedPaths(
  workspace: string,
  exclude: readonly string[] = SESSION_NOTE_PATHS,
  since: string | null = null,
): WorkspaceChanges {
  const status = since === null ? porcelainStatus(workspace) : statusSince(workspace, since);
  const all = status.paths;
  const excluded = new Set(exclude);
  return {
    all,
    substantive: all.filter((path) => !excluded.has(path)),
    diffSha: workspaceChangeDigest(workspace, status, since),
    ...keyIfNotNull("since", since),
  };
}

if (import.meta.main) {
  const die = exitWith("workspace-changes");
  const parsed = parseOrDie(die, { positionals: 1, values: ["since"] });
  const [workspace = ""] = parsed.positionals;
  const since = parsed.single.get("since") ?? "root";
  let base: string | null = null;
  try {
    base =
      since === "HEAD"
        ? null
        : gitText(workspace, "rev-parse", since === "root" ? seedCommit(workspace) : since);
  } catch (error) {
    die(errorMessage(error));
  }
  console.log(JSON.stringify(changedPaths(workspace, SESSION_NOTE_PATHS, base), null, 2));
}
