/**
 * The tool inventory: which installed executables a candidate snapshot's checks may run. It is
 * derived, never declared. A brief names its tools by adapterId; this resolves each id against the
 * candidate workspace's `.toolchain` tree first and the host search path second, hashes the
 * executable and records where it came from. A missing id is therefore a `tool-missing` finding
 * the Builder can act on by installing the tool, and never a refusal of the check's logic.
 *
 * It replaced a declared registry, `correctness-model/engines.json`, and its admission chain.
 * Left to declare its own engines, a Builder names an interpreter over a script it wrote itself,
 * and a firmware one ships its own `Arduino.h`; the registry then attests the interpreter rather
 * than the check, which lets the author supply the world its own artifact is judged in.
 */
import { keyIfDefined } from "../meta/optional-key.ts";
import {
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  closeSync,
  statSync,
} from "../meta/filesystem.ts";
import { containsPath } from "../meta/path-containment.ts";
import { basename, dirname, isAbsolute, join, relative, resolve } from "../meta/path.ts";
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { compareCodeUnits, hashJsonValue } from "../meta/stable-json.ts";
import { toolchainPathDirs } from "./wall-policy.ts";
import { commandSearchPath, toolTreeSearchDirs } from "./solve-command-isolation.ts";
import type { ToolEntry, ToolInventory } from "./verifier-port.ts";

/** A tool id is a plain command name: no path separators, so it cannot address a file. */
export const TOOL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/;

/** Distinct packages kept per tool. Reporting, not identity: a list this long already says the
 *  interpreter is a whole distribution rather than one installed tool. */
const MAX_PACKAGES = 256;

/** Shells whose `exec` line a wrapper script hands its process over with. */
const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh"]);
/** Wrappers followed from a tool to the program that finally runs; a wrapper over a pip launcher
 *  over a venv's python is two. */
const EXEC_HOPS = 4;
/** A shell script longer than this is a program rather than a wrapper, and is not read for `exec`. */
const WRAPPER_BYTES = 64 * 1024;
/** One shell word as written: quoted runs, escapes and plain characters up to an unquoted space or
 *  operator. */
const SHELL_WORD = String.raw`(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s'"\\;&|<>()])+`;
/** A simple command's first two words after its `NAME=value` prefixes. */
const EXEC_LINE = new RegExp(
  String.raw`^\s*(?:[A-Za-z_]\w*=(?:${SHELL_WORD})?\s+)*(${SHELL_WORD})\s+(${SHELL_WORD})`,
);
/** A line that opens a compound command, a subshell, a function or a here-document, so a later line
 *  may run conditionally or be text rather than a command. */
const NOT_TOP_LEVEL = /^\s*(?:if|case|for|select|while|until|function)\b|^\s*[({]|\(\)\s*\{?\s*$|<</;
/** A line whose quotes all close on it. */
const CLOSED_QUOTES = /^(?:[^'"\\]|\\.|'[^']*'|"(?:[^"\\]|\\.)*")*$/;

/** Tool-tree files larger than this count by size, time and inode in the session key, and are
 *  read in chunks of this size when their bytes are hashed. */
const TREE_HASHED_BYTES = 1 << 20;
/** What a run of an installed tool rewrites by itself: bytecode, the user caches under the Builder's
 *  `home/`, and the compile counter Arduino keeps in `inventory.yaml`. */
const RUN_WRITTEN = /^home\/(\.cache|Library\/Caches)(\/|$)|(^|\/)(__pycache__|inventory\.yaml)(\/|$)/;
/** File digests by tree root, path, size, mtime, inode and ctime, so a later walk rereads only what
 *  moved. The ctime is there because a process can put a file's mtime back after rewriting it, and
 *  nothing but the kernel can set a ctime; the root is there because it is taken out of the bytes. */
const treeFileDigests = new Map<string, string>();

/** Which count a walk takes: `local` for this host's session condition, `portable` for the
 *  identity a record carries between machines and between copies of the same tree. */
type TreeSide = "local" | "portable";

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

/** Up to `bytes` bytes from the start of a file as text, or null when it cannot be read. */
function readHead(path: string, bytes: number): string | null {
  const head = new Uint8Array(bytes);
  try {
    const fd = openSync(path, "r");
    try {
      return new TextDecoder().decode(head.subarray(0, readSync(fd, head, 0, bytes, 0)));
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** The command a `#!` line runs: an absolute path, or the name `env` forwards to. Null for a binary
 *  or unreadable bytes. */
function shebangCommand(path: string): string | null {
  const line = readHead(path, 256)?.split("\n")[0]?.replace(/\r$/, "") ?? "";
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

/** The text of one shell word: its quoted runs unquoted, or null when the shell would expand it —
 *  a parameter, a command substitution, a glob or a tilde — since only running the shell says what
 *  that word becomes. An expansion inside double quotes counts even when escaped. */
function literalWord(word: string): string | null {
  let text = "";
  for (const [piece] of word.matchAll(/'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^'"\\]+/g)) {
    if (piece.startsWith("\\")) text += piece.slice(1);
    else if (piece.startsWith("'")) text += piece.slice(1, -1);
    else if (/[$`]/.test(piece) || (!piece.startsWith('"') && /[*?[~]/.test(piece))) return null;
    else text += piece.startsWith('"') ? piece.slice(1, -1).replace(/\\(["\\])/g, "$1") : piece;
  }
  return text;
}

/** The program a shell script hands its process to: the operand of the first line naming `exec`,
 *  when that line is an `exec` command every earlier line leaves unconditional and its operand is a
 *  literal absolute path. Null whenever only running the shell would say: an `exec` behind `&&`, in
 *  an `if` or a function, after a here-document or an open quote, a program named through a
 *  variable or found by a search, `env`'s included, a script with no `exec`, and one longer than a
 *  wrapper. */
function execTarget(path: string): string | null {
  const text = readHead(path, WRAPPER_BYTES + 1);
  if (text === null || Buffer.byteLength(text) > WRAPPER_BYTES) return null;
  const lines = text.split("\n").filter((line) => !/^\s*(#|$)/.test(line));
  const at = lines.findIndex((line) => /\bexec\b/.test(line));
  const words = EXEC_LINE.exec(lines[at] ?? "");
  const nested = lines.slice(0, at + 1).some((line) => NOT_TOP_LEVEL.test(line) || !CLOSED_QUOTES.test(line));
  if (words === null || nested || literalWord(words[1] ?? "") !== "exec") return null;
  const target = literalWord(words[2] ?? "");
  return target !== null && isAbsolute(target) && basename(target) !== "env" ? target : null;
}

/** The command a script finally runs as: its shebang command, followed through every shell wrapper
 *  whose `exec` line names a literal program, to that program's own shebang command or, for a
 *  binary, the program itself. A wrapper over a pip launcher over a venv's python runs as that
 *  python, and the `sh` in front of both decides nothing. Null for a binary. */
function runnerCommand(path: string): string | null {
  let script = path;
  let command = shebangCommand(script);
  for (let hop = 0; hop < EXEC_HOPS && command !== null && SHELLS.has(basename(command)); hop += 1) {
    const target = execTarget(script);
    if (target === null || !isExecutableFile(target)) break;
    const next = shebangCommand(target);
    if (next === null) return target;
    script = target;
    command = next;
  }
  return command;
}

/** Binary or script, read from the first bytes: a `#!` line, followed through any shell wrapper to
 *  the program it execs, names the interpreter that will actually run, and that name is the
 *  provenance a claim reader needs. Unreadable bytes count as a binary; the digest still binds
 *  them. */
export function toolProvenance(path: string): Pick<ToolEntry, "kind" | "interpreter"> {
  const command = runnerCommand(path);
  if (command === null) return { kind: "binary", interpreter: null };
  return { kind: "script", interpreter: command === "" ? null : basename(command) };
}

/** The bytes of the interpreter a script tool will run under, found the way the verifier cell finds
 *  it: an absolute shebang names its file, `env` searches the cell's own path, and a shell wrapper's
 *  literal `exec` names the program it hands over to (`runnerCommand`). A script's own
 *  digest does not move when its interpreter changes underneath it: a census can grade one half of
 *  its rows under `python3` 3.9 and the other under 3.14 without the tool digest moving at all, and
 *  the tool digest alone calls both of those one environment. Undefined when the interpreter cannot
 *  be found, which the run itself then reports. */
export function interpreterDigest(path: string, toolTree: string | null): string | undefined {
  const found = interpreterPath(path, toolTree);
  return found === undefined ? undefined : sha256OfFile(found);
}

function interpreterPath(path: string, toolTree: string | null): string | undefined {
  const command = runnerCommand(path);
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
 * ignore it. It also stays out of every identity hash, because it reads directory names rather than
 * bytes; a `pip install` into the tool tree moves the entry's `treeDigest` instead.
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

/**
 * The tool tree's own content, which a tool entry's own digest leaves out: a wrapper `exec python3
 * "$ROOT/libexec/check.py"` keeps its digest while `check.py`, a config it passes, or a package in a
 * venv under `home/` is repaired underneath it. Every file counts by its path and its bytes, and a
 * link by where it points. `RUN_WRITTEN` stays out, so running a tool in the
 * Builder shell is not an edit; a gate run writes nothing here, since the verifier cell only reads
 * the tree.
 *
 * `portable` counts every file by its bytes, whatever its size, because it is the identity the
 * verifier host re-checks for drift and `verifierEnvironmentHash` records: an engine binary, a
 * shared library or a data file behind an unchanged shim can change without changing its length.
 * `local`, the session's gate-cache key, counts a file larger than 1 MiB by size, time and inode
 * instead, which catches a rebuild on this host without reading it. Each process reads a file's
 * bytes once while its metadata stands; over a firmware tree of 70,000 files and 8.7 GB, the large
 * files add about six seconds warm to the eleven the small ones already cost.
 *
 * Both count a file with the tree's own real path taken out of its bytes (`rootlessDigest`), since
 * that path is the one thing a copy of the tree is meant to change: a reseed copies `.toolchain`
 * into the next workspace and rewrites every launcher, activation script and wrapper to name it.
 */
function toolTreeCounts(toolTree: string, side: TreeSide): Array<[string, string]> {
  const root = realpathSync.native(toolTree);
  return readdirSync(toolTree, { recursive: true, withFileTypes: true }).flatMap(
    (entry): Array<[string, string]> => {
      const path = join(entry.parentPath, entry.name);
      const rel = relative(toolTree, path);
      if (entry.isDirectory() || RUN_WRITTEN.test(rel)) return [];
      if (entry.isSymbolicLink()) return [[rel, linkCount(path, toolTree, root)]];
      return [[rel, entry.isFile() ? fileCount(path, side, root) : "special"]];
    },
  );
}

function fileCount(path: string, side: TreeSide, root: string): string {
  const { size, mtimeNs, ctimeNs, ino } = statSync(path, { bigint: true });
  const seen = `${size}:${mtimeNs}:${ino}`;
  if (side === "local" && size > TREE_HASHED_BYTES) return seen;
  const key = `${root}\0${path}\0${seen}:${ctimeNs}`;
  const digest = treeFileDigests.get(key) ?? rootlessDigest(path, root);
  treeFileDigests.set(key, digest);
  return digest;
}

/**
 * sha256 over a file read in 1 MiB chunks, so a toolchain archive of hundreds of megabytes is never
 * held whole, with every occurrence of `root` taken out. A file that never names the root counts by
 * its plain sha256. One that does counts by the bytes around each occurrence and the offset it was
 * taken from, which puts back exactly the file it came from, so a copy that moved, dropped or added
 * an occurrence, or changed any other byte, counts differently. A copy naming the tree it was copied
 * from names another root, and its bytes count as they stand.
 */
function rootlessDigest(path: string, root: string): string {
  const needle = Buffer.from(root);
  const bytes = Buffer.alloc(TREE_HASHED_BYTES + needle.length);
  const kept = new Bun.CryptoHasher("sha256");
  const offsets = new Bun.CryptoHasher("sha256");
  let carried = 0;
  let hashed = 0;
  let found = 0;
  const fd = openSync(path, "r");
  try {
    for (;;) {
      const read = readSync(fd, bytes, carried, TREE_HASHED_BYTES, null);
      const view = bytes.subarray(0, carried + read);
      let start = 0;
      for (let hit = view.indexOf(needle, start); hit !== -1; hit = view.indexOf(needle, start)) {
        kept.update(view.subarray(start, hit));
        hashed += hit - start;
        offsets.update(`${hashed},`);
        found += 1;
        start = hit + needle.length;
      }
      // Hold back a tail too short to hold the root, since the next read may complete it.
      const end = read === 0 ? view.length : Math.max(start, view.length - needle.length + 1);
      kept.update(view.subarray(start, end));
      hashed += end - start;
      if (read === 0) break;
      carried = view.length - end;
      bytes.copyWithin(0, end, view.length);
    }
  } finally {
    closeSync(fd);
  }
  const digest = kept.digest("hex");
  return found === 0 ? digest : sha256(`rooted:${digest}:${offsets.digest("hex")}`);
}

/** A link inside the tree counts by the tree path it names, so a copy whose absolute links were
 *  moved counts the same; one leaving the tree counts by the file it reaches, never its host path. */
function linkCount(path: string, toolTree: string, root: string): string {
  const target = resolve(dirname(path), readlinkSync(path));
  if (containsPath(target, toolTree)) return `link:${relative(toolTree, target)}`;
  try {
    return statSync(target).isFile()
      ? `external:${fileCount(target, "portable", root)}`
      : "external:not-a-file";
  } catch {
    return "external:unresolved";
  }
}

function treeDigestOf(toolTree: string, side: TreeSide): string {
  const rows = toolTreeCounts(toolTree, side).map(([rel, count]) => `${rel}\0${count}`);
  return hashJsonValue(rows.sort(compareCodeUnits));
}

/** The tree digest this host's session keys its gate cache and no-op strikes on. */
export function toolTreeDigest(toolTree: string): string {
  return treeDigestOf(toolTree, "local");
}

/** The tree digest a workspace-toolchain entry carries as `treeDigest`, which the host re-checks
 *  before a run and `verifierEnvironmentHash` covers. */
export function portableToolTreeDigest(toolTree: string): string {
  return treeDigestOf(toolTree, "portable");
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
  let treeDigest: string | undefined;
  for (const id of ids) {
    if (!TOOL_ID_RE.test(id)) continue;
    const entry = resolveOne(id, searchDirs, input.toolTree);
    if (entry === null) missing.push(id);
    else inventory[id] = entry;
    // A workspace tool is its whole tree: the wrapper the id names is often a shim over a script
    // beside it, and that script decides the verdict. One walk serves every such entry.
    if (entry?.source === "workspace-toolchain" && input.toolTree !== null) {
      treeDigest ??= portableToolTreeDigest(input.toolTree);
      entry.treeDigest = treeDigest;
      // The entry file as the tree counts one, which is the same file under another tree path.
      entry.portableDigest = fileCount(entry.path, "portable", realpathSync.native(input.toolTree));
    }
  }
  return { inventory, missing, invalid };
}
