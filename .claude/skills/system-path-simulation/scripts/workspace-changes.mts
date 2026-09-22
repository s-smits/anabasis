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
 *     /abs/epoch/workspace
 */

import { runSyncOrThrow } from "#src/meta/subprocess.ts";
import { hostTool } from "#src/meta/host-tool.ts";

import { lstatSync, readFileSync, readlinkSync } from "#src/meta/filesystem.ts";
import { resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { isString } from "#src/meta/json-shape.ts";
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
}

interface PorcelainStatus {
  raw: Uint8Array;
  paths: string[];
}

/** NUL porcelain preserves whitespace, newlines and literal ` -> ` text in paths. For a rename or
 * copy Git emits the destination first and the source as the next NUL field; only the destination
 * is part of the current workspace, while the raw bytes below bind both names into the digest. */
function porcelainStatus(workspace: string): PorcelainStatus {
  const raw = runSyncOrThrow([hostTool("git"), "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: workspace,
  });
  const fields = new TextDecoder().decode(raw).split("\0");
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

function hashField(hash: Bun.CryptoHasher, label: string, value: string | Uint8Array): void {
  const bytes = isString(value) ? new TextEncoder().encode(value) : value;
  hash.update(`${label}:${bytes.length}\0`);
  hash.update(bytes);
}

/** `git diff` omits untracked files and, without HEAD, staged changes. Bind the baseline, Git's raw
 * status and the realised bytes at every current path instead. This also distinguishes two conditions
 * that create the same filename with different content, which the previous empty-diff hash did not. */
function workspaceChangeDigest(workspace: string, status: PorcelainStatus): string {
  const hash = new Bun.CryptoHasher("sha256");
  hashField(hash, "format", "workspace-change/v2");
  hashField(hash, "head", runSyncOrThrow([hostTool("git"), "rev-parse", "HEAD"], { cwd: workspace }));
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
 * count everything.
 *
 * The parsing is the whole point of having this in one place. NUL-delimited porcelain keeps every
 * legal path byte out of the record delimiter and reports every untracked file rather than folding
 * an untracked directory into one directory row.
 */
export function changedPaths(
  workspace: string,
  exclude: readonly string[] = SESSION_NOTE_PATHS,
): WorkspaceChanges {
  const status = porcelainStatus(workspace);
  const all = status.paths;
  const excluded = new Set(exclude);
  return {
    all,
    substantive: all.filter((path) => !excluded.has(path)),
    diffSha: workspaceChangeDigest(workspace, status),
  };
}

if (Bun.argv[1] !== undefined && resolve(Bun.argv[1]) === Bun.fileURLToPath(import.meta.url)) {
  const workspace = Bun.argv[2];
  if (workspace === undefined) {
    console.error("workspace-changes: pass the workspace path");
    runtimeProcess.exit(2);
    throw new Error("process exit returned unexpectedly");
  }
  console.log(JSON.stringify(changedPaths(workspace), null, 2));
}
