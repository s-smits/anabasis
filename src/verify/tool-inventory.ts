/**
 * The tool inventory: which installed executables a candidate snapshot's checks may run. It is
 * derived, never declared. A brief names its tools by adapterId; this resolves each id against the
 * candidate workspace's `.toolchain` tree first and the host search path second, hashes the
 * executable and records where it came from. A missing id is therefore a `verifier-required` fact
 * the Builder can act on by installing the tool, and never a refusal of the check's logic.
 *
 * It replaced a declared registry, `correctness-model/engines.json`, and its admission chain.
 * Left to declare its own engines, a Builder names an interpreter over a script it wrote itself,
 * and a firmware one ships its own `Arduino.h`; the registry then attests the interpreter rather
 * than the check, which lets the author supply the world its own artifact is judged in.
 */
import { keyIfDefined } from "../meta/optional-key.ts";
import { openSync, readSync, readdirSync, closeSync, statSync } from "../meta/filesystem.ts";
import { basename, dirname, isAbsolute, join, resolve } from "../meta/path.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { toolchainPathDirs } from "./wall-policy.ts";
import { commandSearchPath, toolTreeSearchDirs } from "./solve-command-isolation.ts";
import type { ToolEntry, ToolInventory } from "./verifier-port.ts";

/** A tool id is a plain command name: no path separators, so it cannot address a file. */
export const TOOL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/;

/** Distinct packages kept per tool. Reporting, not identity: a list this long already says the
 *  interpreter is a whole distribution rather than one installed tool. */
const MAX_PACKAGES = 256;

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
  // `NAME=value` assignment. Without that skip, `#!/usr/bin/env -S PYTHONUNBUFFERED=1 python3`
  // reads the assignment as the interpreter.
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
 *  it: an absolute shebang names its file, and `env` searches the cell's own path. A script's own
 *  digest does not move when its interpreter changes underneath it: a census can grade one half of
 *  its rows under `python3` 3.9 and the other under 3.14 without the tool digest moving at all, and
 *  the tool digest alone calls both of those one environment. Undefined when the interpreter cannot
 *  be found, which the run itself then reports. */
export function interpreterDigest(path: string, toolTree: string | null): string | undefined {
  const found = interpreterPath(path, toolTree);
  return found === undefined ? undefined : sha256OfFile(found);
}

function interpreterPath(path: string, toolTree: string | null): string | undefined {
  const command = shebangCommand(path);
  if (command === null || command === "") return undefined;
  const dirs = isAbsolute(command) ? [""] : commandSearchPath(toolTree).split(":");
  return dirs.map((dir) => (dir === "" ? command : join(dir, command))).find(isExecutableFile);
}

/**
 * The Python distributions installed beside a script's interpreter, as `name==version` from each
 * `<prefix>/lib/python*\/site-packages/*.dist-info` directory name, sorted. The prefix is the
 * directory above the interpreter's own, taken without resolving links, because a virtual
 * environment's `bin/python3` is a link to the base interpreter and its packages live beside the
 * link. Empty for a binary tool or a non-Python interpreter.
 *
 * This says what was installed, never what decided a verdict: a wrapper can import a package and
 * ignore it. It also stays out of every identity hash, although a `pip install` changes it with no
 * digest moving, because it reads directory names rather than bytes.
 */
function interpreterPackages(path: string, toolTree: string | null): string[] {
  const interpreter = interpreterPath(path, toolTree);
  if (interpreter === undefined || !basename(interpreter).startsWith("python")) return [];
  const lib = join(dirname(dirname(interpreter)), "lib");
  const packages = new Set<string>();
  for (const version of listDir(lib).filter((name) => name.startsWith("python"))) {
    for (const entry of listDir(join(lib, version, "site-packages"))) {
      const match = /^(.+?)-([^-]+)\.dist-info$/.exec(entry);
      if (match !== null) packages.add(`${match[1]}==${match[2]}`);
    }
  }
  return [...packages].sort(compareCodeUnits).slice(0, MAX_PACKAGES);
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
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
    const packages = interpreterPackages(path, toolTree);
    return {
      id,
      path,
      digest: sha256OfFile(path),
      source,
      ...toolProvenance(path),
      ...keyIfDefined("interpreterDigest", interpreterDigest(path, toolTree)),
      ...keyIfDefined("packages", packages.length === 0 ? undefined : packages),
    };
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
    // `toolchainPathDirs()` stays inside the `??` rather than being merged in: a caller that
    // supplies its own directories is measuring a tree this process must not read, so adding the
    // host's own would put this host's tools into that measurement.
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
