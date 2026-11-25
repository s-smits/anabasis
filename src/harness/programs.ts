import { CORRECTNESS_MODEL_DIR } from "../meta/bundle-layout.ts";
import { readdirSync, readHeadSync, realpathSync, statSync } from "../meta/filesystem.ts";
import { containsPath } from "../meta/path-containment.ts";
import { dirname, join } from "../meta/path.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { toolTreeSearchDirs } from "../sandbox/isolation.ts";

const HEAD_BYTES = 4096;
const NUL = String.fromCodePoint(0);
const SHEBANG = /^#!.*\n?/u;
const OPENING = /^\s*(?:((?:[ \t]*(?:#|\/\/).*\n?)+)|"""([\s\S]*?)"""|'''([\s\S]*?)'''|\/\*([\s\S]*?)\*\/)/u;
const MARK = /^[ \t]*(?:#|\/\/|\*) ?/u;

interface Program {
  readonly name: string;
  readonly at: string;
  readonly account: string | null;
}

function canRun(path: string): boolean {
  try {
    const entry = statSync(path);
    return entry.isFile() && (entry.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function programsAt(toolTree: string | null): { name: string; at: string }[] {
  const found = new Map<string, string>();
  for (const dir of toolTree === null ? [] : toolTreeSearchDirs(toolTree)) {
    for (const name of readdirSync(dir).toSorted(compareCodeUnits)) {
      if (!found.has(name) && canRun(join(dir, name))) found.set(name, join(dir, name));
    }
  }
  return [...found].map(([name, at]) => ({ name, at }));
}

export function installedPrograms(toolTree: string | null): string[] {
  return programsAt(toolTree).map(({ name }) => name);
}

function accountAt(at: string, tree: string): string | null {
  try {
    const real = realpathSync(at);
    const closed = real.slice(tree.length).includes(`/${CORRECTNESS_MODEL_DIR}`);
    if (!statSync(real).isFile() || !containsPath(real, tree) || closed) return null;
    const head = readHeadSync(real, HEAD_BYTES).toString("utf8");
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

export function programsOf(toolTree: string | null): Program[] {
  const found = programsAt(toolTree);
  const tree = toolTree === null || found.length === 0 ? "" : realpathSync(toolTree);
  const libFiles = new Map<string, readonly string[]>();
  const filesIn = (lib: string) => {
    let entries = libFiles.get(lib);
    if (entries === undefined) {
      entries =
        statSync(lib, { throwIfNoEntry: false })?.isDirectory() === true
          ? readdirSync(lib).toSorted(compareCodeUnits)
          : [];
      libFiles.set(lib, entries);
    }
    return entries;
  };
  return found.map(({ name, at }) => {
    const lib = join(dirname(dirname(at)), "lib");
    const beside = filesIn(lib).find((file) => file.replaceAll("_", "-").startsWith(`${name}.`));
    const account = accountAt(at, tree) ?? (beside === undefined ? null : accountAt(join(lib, beside), tree));
    return { name, at, account };
  });
}
