/**
 * The tool inventory: which installed executables a candidate snapshot's checks may run. It is
 * derived, never declared. A brief names tools by adapterId; this resolves each id against the
 * candidate workspace's `.toolchain` tree first and the host search path second, hashes the
 * executable, and records where it came from. A missing id is a `verifier-required` fact the
 * Builder can act on (install the tool); it is never a refusal of the check's logic.
 *
 * This replaces `correctness-model/engines.json` and its admission chain (2026-09-03). Of the 306
 * engine declarations written in the first three September days, every one named an interpreter
 * over a Builder-written script, and the firmware ones shipped their own `Arduino.h`; a declared
 * registry attested the interpreter, not the check, and let the author supply the world the
 * artifact was judged in.
 */
import { keyIfDefined } from "../meta/optional-key.ts";
import { openSync, readSync, closeSync, statSync } from "../meta/filesystem.ts";
import { basename, isAbsolute, join, resolve } from "../meta/path.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { toolchainPathDirs } from "./wall-policy.ts";
import { commandSearchPath, toolTreeSearchDirs } from "./solve-command-isolation.ts";
import type { ToolEntry, ToolInventory } from "./verifier-port.ts";

/** A tool id is a plain command name: no path separators, so it cannot address a file. */
export const TOOL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/;

interface ResolveToolInventoryInput {
  toolIds: readonly string[];
  /** The candidate workspace's `.toolchain` tree; null when the workspace has none. */
  toolTree: string | null;
  /** Host search path; defaults to the wall's toolchain directories plus the process PATH. */
  pathDirs?: readonly string[];
}

interface ResolvedToolInventory {
  inventory: ToolInventory;
  /** Declared ids that resolved to no executable, sorted. */
  missing: string[];
  /** Declared ids that are not plain command names, sorted. */
  invalid: string[];
}

/** The command a `#!` line runs: an absolute path, or the name `env` forwards to. Null for a binary
 *  or unreadable bytes. */
function shebangCommand(path: string): string | null {
  const head = new Uint8Array(256);
  let read = 0;
  try {
    const fd = openSync(path, "r");
    try {
      read = readSync(fd, head, 0, head.byteLength, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  const line = new TextDecoder().decode(head.subarray(0, read)).split("\n")[0]?.replace(/\r$/, "") ?? "";
  if (!line.startsWith("#!")) return null;
  const words = line
    .slice(2)
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  // `env` forwards to the first word that is neither one of its flags (`-S`, `-i`, `--`) nor a
  // `NAME=value` assignment; the 2026-09-05 replay over 43 recorded tool shapes met none of these,
  // but a synthetic `#!/usr/bin/env -S PYTHONUNBUFFERED=1 python3` read the assignment as the
  // interpreter.
  return basename(words[0] ?? "") === "env"
    ? (words.find(
        (word, index) => index > 0 && !word.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word),
      ) ?? "")
    : (words[0] ?? "");
}

/** Binary or script, read from the first bytes: a `#!` line names the interpreter that will
 *  actually run, and that name is the provenance a claim reader needs. Unreadable bytes count as a
 *  binary; the digest still binds them. */
export function toolProvenance(path: string): Pick<ToolEntry, "kind" | "interpreter"> {
  const command = shebangCommand(path);
  if (command === null) return { kind: "binary", interpreter: null };
  return { kind: "script", interpreter: command === "" ? null : basename(command) };
}

/** The bytes of the interpreter a script tool will run under, found the way the verifier cell finds
 *  it: an absolute shebang names its file, and `env` searches the cell's own path. eaf98f
 *  (2026-09-14) graded 148 census rows with a script whose tool digest never moved while its
 *  `python3` changed from 3.9 to 3.14 underneath it; the tool digest alone called both one
 *  environment. Undefined when the interpreter cannot be found, which the run itself then reports. */
export function interpreterDigest(path: string, toolTree: string | null): string | undefined {
  const command = shebangCommand(path);
  if (command === null || command === "") return undefined;
  const dirs = isAbsolute(command) ? [""] : commandSearchPath(toolTree).split(":");
  const found = dirs.map((dir) => (dir === "" ? command : join(dir, command))).find(isExecutableFile);
  return found === undefined ? undefined : sha256OfFile(found);
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function resolveOne(
  id: string,
  searchDirs: ReadonlyArray<{ dir: string; source: ToolEntry["source"] }>,
  toolTree: string | null,
): ToolEntry | null {
  for (const { dir, source } of searchDirs) {
    // A multicall executable selects its operation by name. A realpath hardlink alias can
    // turn /usr/bin/cc into /usr/bin/git; hash the selected path without renaming it.
    const path = resolve(dir, id);
    if (!isExecutableFile(path)) continue;
    const entry: ToolEntry = {
      id,
      path,
      digest: sha256OfFile(path),
      source,
      ...toolProvenance(path),
      ...keyIfDefined("interpreterDigest", interpreterDigest(path, toolTree)),
    };
    return entry;
  }
  return null;
}

/** Resolve every declared tool id once. The tool tree wins over the host path so a Builder that
 *  installed a newer compiler measures against it; the entry says which one was taken. */
export function resolveToolInventory(input: ResolveToolInventoryInput): ResolvedToolInventory {
  const ids = [...new Set(input.toolIds)].sort(compareCodeUnits);
  const invalid = ids.filter((id) => !TOOL_ID_RE.test(id));
  const treeDirs = input.toolTree === null ? [] : toolTreeSearchDirs(input.toolTree);
  const envDirs = (Bun.env.PATH ?? "").split(":").filter((dir) => dir !== "" && isAbsolute(dir));
  const searchDirs = [
    ...treeDirs.map((dir) => ({ dir, source: "workspace-toolchain" as const })),
    // `toolchainPathDirs()` stays inside the `??`: a caller that supplies its own directories is
    // measuring a tree this process must not read.
    ...(input.pathDirs ?? [...new Set([...toolchainPathDirs(), ...envDirs])]).map((dir) => ({
      dir,
      source: "host" as const,
    })),
  ];
  const inventory: ToolInventory = Object.create(null);
  const missing: string[] = [];
  for (const id of ids) {
    if (!TOOL_ID_RE.test(id)) continue;
    const entry = resolveOne(id, searchDirs, input.toolTree);
    if (entry === null) missing.push(id);
    else inventory[id] = entry;
  }
  return { inventory, missing, invalid };
}
