/**
 * The programs a harness installed: by the names that run them, for the solver's prompt, the
 * Examiner's shell and the Builder's preview; and each with what it says of itself, for the page.
 *
 * 0 of the 193 harnesses kept in this repository's worktrees by 19 October declared a tool in
 * `agent/tools.ts`: each gave the solver its computation as programs under `.toolchain/`, named in
 * its guide's prose alone. A program's account is what opens its file past a shebang: comment lines,
 * a docstring or a block comment, or, for a launcher that says nothing, the account of the file of
 * its name under `lib/`. Of the 1,386 programs kept by 19 October, comment lines alone gave 446 an
 * account and this reading 1,281; 42 of the rest are binaries.
 *
 * Nothing here runs a program or reads past `HEAD_BYTES` of it, and an account is read only from a
 * file inside the tree and outside `correctness-model/`: a program linked to a host file, or to the
 * exam side's copy a v1 harness carries, would otherwise show that file's head on the page.
 */
import { CORRECTNESS_MODEL_DIR } from "../meta/bundle-layout.ts";
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "../meta/filesystem.ts";
import { containsPath } from "../meta/path-containment.ts";
import { dirname, join } from "../meta/path.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { toolTreeSearchDirs } from "../verify/solve-command-isolation.ts";

/** The bytes of a program read for its account. */
const HEAD_BYTES = 4096;
const NUL = String.fromCodePoint(0);
const SHEBANG = /^#!.*\n?/u;
/** What opens a file: a run of `#` or `//` lines, a Python docstring, or a block comment. */
const OPENING = /^\s*(?:((?:[ \t]*(?:#|\/\/).*\n?)+)|"""([\s\S]*?)"""|'''([\s\S]*?)'''|\/\*([\s\S]*?)\*\/)/u;
/** A comment's mark at the start of one of its lines. */
const MARK = /^[ \t]*(?:#|\/\/|\*) ?/u;

export interface Program {
  /** The name that runs it, where the first program of that name on PATH lies, and its account. */
  readonly name: string;
  readonly at: string;
  readonly account: string | null;
}

/** Whether a command could run this entry by name: a venv's sourced `activate` siblings are mode
 *  644, and a broken link runs nothing. */
function canRun(path: string): boolean {
  try {
    const entry = statSync(path);
    return entry.isFile() && (entry.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Each program by name and path, from the directories a command's PATH holds, in its order; of
 *  two of one name, the first is the one that runs. */
function programsAt(toolTree: string | null): { name: string; at: string }[] {
  const found = new Map<string, string>();
  for (const dir of toolTree === null ? [] : toolTreeSearchDirs(toolTree)) {
    for (const name of readdirSync(dir).sort(compareCodeUnits)) {
      if (!found.has(name) && canRun(join(dir, name))) found.set(name, join(dir, name));
    }
  }
  return [...found].map(([name, at]) => ({ name, at }));
}

/** The programs a harness installed, by the names that run them, as v1 listed them. Without the
 *  list, every case of one truss run wrote its own solver in the host's python3 beside the
 *  Builder's interpreter. */
export function installedPrograms(toolTree: string | null): string[] {
  return programsAt(toolTree).map(({ name }) => name);
}

/** What the file at `at` says of itself at its head; null for a binary, a head that says nothing, a
 *  file outside `tree`, or one in the exam side's copy a harness imported from v1 carries. */
function accountAt(at: string, tree: string): string | null {
  try {
    const real = realpathSync(at);
    const closed = real.slice(tree.length).includes(`/${CORRECTNESS_MODEL_DIR}`);
    if (!statSync(real).isFile() || !containsPath(real, tree) || closed) return null;
    const fd = openSync(real, "r");
    const buffer = Buffer.alloc(HEAD_BYTES);
    let head: string;
    try {
      head = buffer.subarray(0, readSync(fd, buffer, 0, HEAD_BYTES, 0)).toString("utf8");
    } finally {
      closeSync(fd);
    }
    const opening = head.includes(NUL) ? null : OPENING.exec(head.replace(SHEBANG, ""));
    const said = opening?.slice(1).find((part) => part !== undefined) ?? "";
    const text = said
      .split("\n")
      .map((line) => line.replace(MARK, ""))
      .join("\n")
      .trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/** Each program a harness installed, with its account. */
export function programsOf(toolTree: string | null): Program[] {
  const found = programsAt(toolTree);
  const tree = toolTree === null || found.length === 0 ? "" : realpathSync(toolTree);
  return found.map(({ name, at }) => {
    const lib = join(dirname(dirname(at)), "lib");
    const beside =
      statSync(lib, { throwIfNoEntry: false })?.isDirectory() === true
        ? readdirSync(lib)
            .sort(compareCodeUnits)
            .find((file) => file.replaceAll("_", "-").startsWith(`${name}.`))
        : undefined;
    const account = accountAt(at, tree) ?? (beside === undefined ? null : accountAt(join(lib, beside), tree));
    return { name, at, account };
  });
}
