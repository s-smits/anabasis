import type { LogEvent } from "../kernel/log.ts";
import { CORRECTNESS_MODEL_DIR, TOOL_TREE_DIR, TOOL_TREE_ENV } from "../meta/bundle-layout.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readHeadSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "../meta/filesystem.ts";
import { containsPath } from "../meta/path-containment.ts";
import { basename, dirname, join, relative, resolve } from "../meta/path.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { type Harness, openHarness, pathsUnder, treeStamp } from "../harness/open.ts";
import { bashSyntaxFault } from "../harness/place.ts";
import { writeStarter } from "../harness/starter.ts";
import { selectedCodingTools } from "../tools/coding.ts";
import { short } from "../campaign/move.ts";
import { namesOf } from "../campaign/names.ts";

export interface HarnessSnapshot {
  readonly dir: string;
  readonly harness: Harness;
}

export interface Freezing {
  readonly request: { readonly states: string };
  readonly home: string;
  tree: { readonly stamp: string; readonly dir: string } | null;
  opened: HarnessSnapshot | null;
}

export const HOME_TOOL_TREE = `harness/${TOOL_TREE_DIR}`;

const LINKED_TREE_BYTES = 100 * 1024 * 1024;

function treeOverLimit(tree: string): boolean {
  let bytes = 0;
  for (const path of pathsUnder(tree)) {
    bytes += lstatSync(join(tree, path)).size;
    if (bytes > LINKED_TREE_BYTES) return true;
  }
  return false;
}

export function copyHarness(state: string, into: string, trees?: string): void {
  const copy = { recursive: true, verbatimSymlinks: true } as const;
  const own = resolve(state, TOOL_TREE_DIR);
  const examDirectory = basename(CORRECTNESS_MODEL_DIR);
  const tree = parentToolTree(state);
  cpSync(state, into, {
    ...copy,
    filter: (each) => resolve(each) !== own && basename(each) !== examDirectory,
  });
  if (tree === null) return;
  if (trees === undefined || !treeOverLimit(tree)) {
    cpSync(tree, join(into, TOOL_TREE_DIR), copy);
    return;
  }
  mkdirSync(trees, { recursive: true });
  const shared = join(trees, basename(tree));
  if (!existsSync(shared)) {
    cpSync(tree, `${shared}.part`, copy);
    renameSync(`${shared}.part`, shared);
  }
  symlinkSync(relative(into, shared), join(into, TOOL_TREE_DIR));
}

export function seedSavedHarnesses(
  home: string,
  states: string,
  events: readonly LogEvent[],
  parent: string,
): void {
  mkdirSync(join(home, "kept"), { recursive: true });
  const trees = join(home, ".kept-trees");
  for (const digest of namesOf(events).keys()) {
    const state = join(states, digest);
    const into = join(home, "kept", short(digest));
    if (digest !== parent && existsSync(state) && !existsSync(into)) copyHarness(state, into, trees);
  }
}

export function parentToolTree(parent: string): string | null {
  const tree = join(parent, TOOL_TREE_DIR);
  if (!existsSync(tree)) return null;
  const real = realpathSync(tree);
  if (!containsPath(real, realpathSync(dirname(parent)))) {
    throw new Error(`${parent}: its ${TOOL_TREE_DIR} links outside the folder it lies in`);
  }
  return real;
}

export function writeProgramsControl(into: string, state: string, digest: string): void {
  const tree = parentToolTree(state);
  if (tree === null) {
    throw new Error(`${digest} installed no program, so the control for its programs is the starter itself`);
  }
  writeStarter(into);
  cpSync(tree, join(into, TOOL_TREE_DIR), { recursive: true, verbatimSymlinks: true });
}

export function refuseNamingHome(dir: string, home: string, under: string): void {
  const forms = [...new Set([home, realpathSync(home)])];
  const named = pathsUnder(dir).filter((path) => {
    const full = join(dir, path);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) return forms.some((form) => readlinkSync(full).includes(form));
    if (!stat.isFile()) return false;
    const checked =
      path === TOOL_TREE_ENV || ((stat.mode & 0o111) !== 0 && readHeadSync(full, 2).toString() === "#!");
    if (!checked) return false;
    const bytes = readFileSync(full);
    return forms.some((form) => bytes.includes(form));
  });
  if (named.length > 0) {
    throw new Error(
      `${named.map((path) => join(under, path)).join(", ")} name your home, and frozen tools run from elsewhere: a launcher finds its files from its own path, as "$(dirname "$0")" does, and a link names its target relatively`,
    );
  }
}

function dropUnlinked(states: string, dir: string): void {
  const named = join("..", basename(dir));
  const links = readdirSync(states).map((name) => join(states, name, TOOL_TREE_DIR));
  const linked = (link: string) =>
    lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true && readlinkSync(link) === named;
  if (!links.some(linked)) rmSync(dir, { recursive: true, force: true });
}

function keptTree(bench: Freezing): string | null {
  const own = join(bench.home, HOME_TOOL_TREE);
  const found = lstatSync(own, { throwIfNoEntry: false });
  if (found === undefined) return null;
  const real = found.isSymbolicLink() ? null : realpathSync(own);
  if (real === null || !containsPath(real, realpathSync(bench.home))) {
    throw new Error(
      `${HOME_TOOL_TREE} is a link, or lies outside your home: the programs are installed in the directory itself, which is copied whole when the harness is frozen`,
    );
  }
  const stamp = treeStamp(real);
  if (bench.tree?.stamp === stamp) return bench.tree.dir;
  if (bench.tree !== null) dropUnlinked(bench.request.states, bench.tree.dir);
  const dir = realpathSync(mkdtempSync(join(bench.request.states, "tree-")));
  try {
    cpSync(real, dir, { recursive: true, verbatimSymlinks: true });
    refuseNamingHome(dir, bench.home, HOME_TOOL_TREE);
    const envFile = join(dir, TOOL_TREE_ENV);
    const envStat = lstatSync(envFile, { throwIfNoEntry: false });
    if (envStat !== undefined) {
      if (envStat.isSymbolicLink() || !envStat.isFile()) {
        throw new Error(`${join(HOME_TOOL_TREE, TOOL_TREE_ENV)} must be a regular file`);
      }
      const syntax = bashSyntaxFault(envFile);
      if (syntax !== null) throw new Error(`${join(HOME_TOOL_TREE, TOOL_TREE_ENV)}: ${syntax}`);
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  bench.tree = { stamp, dir };
  return dir;
}

export function stagedState(source: string, states: string, tree: string | null, prefix: string): string {
  mkdirSync(states, { recursive: true });
  const dir = realpathSync(mkdtempSync(join(states, prefix)));
  try {
    const own = resolve(source, TOOL_TREE_DIR);
    cpSync(source, dir, { recursive: true, verbatimSymlinks: true, filter: (each) => resolve(each) !== own });
    if (!lstatSync(dir).isDirectory()) throw new Error("harness/ is not a directory");
    if (tree !== null) symlinkSync(join("..", basename(tree)), join(dir, TOOL_TREE_DIR));
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function frozen<T>(bench: Freezing, use: (kept: HarnessSnapshot) => T | Promise<T>): Promise<T> {
  const { states } = bench.request;
  mkdirSync(states, { recursive: true });
  let dir: string | null = null;
  let opened = false;
  try {
    dir = stagedState(join(bench.home, "harness"), states, keptTree(bench), "freezing-");
    refuseNamingHome(dir, bench.home, "harness");
    const harness = await openHarness(dir);
    selectedCodingTools(harness.presets);
    opened = true;
    return await use({ dir, harness });
  } catch (error) {
    if (opened) throw error;
    const why = errorMessage(error).replaceAll(dir ?? realpathSync(states), "harness");
    throw new Error(`the harness does not open: ${why}`, { cause: error });
  } finally {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
  }
}

export async function snapshot(bench: Freezing): Promise<HarnessSnapshot> {
  return await frozen(bench, ({ dir, harness }) => {
    const kept = join(dirname(dir), harness.digest);
    try {
      renameSync(dir, kept);
    } catch (error) {
      if (!existsSync(kept)) throw error;
    }
    bench.opened = {
      dir: kept,
      harness: { ...harness, toolTree: harness.toolTree === null ? null : join(kept, TOOL_TREE_DIR) },
    };
    return bench.opened;
  });
}

export async function harnessNow(bench: Freezing): Promise<string | Error> {
  return await frozen(bench, ({ harness }) => harness.digest).catch(asError);
}
