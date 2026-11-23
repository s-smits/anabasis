/**
 * Keeping harnesses: `harness/` frozen beside a campaign's states, and a kept harness copied into
 * a Builder's home.
 */
import type { LogEvent } from "../kernel/log.ts";
import { CORRECTNESS_MODEL_DIR, TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
import { selectedCodingTools } from "../tools/coding.ts";
import { short } from "../campaign/move.ts";
import { namesOf } from "../campaign/names.ts";

/** `harness/` frozen: a copy kept under its digest, and what a solve would open it as. */
export interface HarnessSnapshot {
  readonly dir: string;
  readonly harness: Harness;
}

/** What freezing reads and keeps of a Builder session; `Bench` (`tools.ts`) is one. */
export interface Freezing {
  readonly request: { readonly states: string };
  /** The Builder's home, which holds `harness/` and `practice/`. */
  readonly home: string;
  /** The last copy kept of `harness/.toolchain`, and the stamp the tree had when it was copied. */
  tree: { readonly stamp: string; readonly dir: string } | null;
  /** The last harness snapshot this session kept, including one made for a comparison.
   *  Null until a state is kept; freezing establishes no practice result. */
  opened: HarnessSnapshot | null;
}

/** The harness's tool tree, as a path in the Builder's home. */
export const HOME_TOOL_TREE = `harness/${TOOL_TREE_DIR}`;

/** A tool tree larger than this is a helper a handover links to instead of copying (the operator's
 *  choice): an installed Python stack runs to hundreds of megabytes, and a campaign hands over at
 *  each ending. */
const LINKED_TREE_BYTES = 100 * 1024 * 1024;

/** Copy the kept state `state` to `into`, its programs as files and its correctness model left out.
 *  With `trees`, a tool tree over `LINKED_TREE_BYTES` is copied once to `trees/<its name>` and
 *  `.toolchain` links there, as a kept state's does to the tree beside it: the digest and the wall
 *  both read a tree where it really is (`keptTreeContent`, `commandReadAllows`). */
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
  const bytes = pathsUnder(tree).reduce((sum, path) => sum + lstatSync(join(tree, path)).size, 0);
  if (trees === undefined || bytes <= LINKED_TREE_BYTES) {
    cpSync(tree, join(into, TOOL_TREE_DIR), copy);
    return;
  }
  // A tree kept under a name never changes (`keptTree`), so a copy there is reused, and one is only
  // there whole: an interrupted copy is left under another name.
  const shared = join(trees, basename(tree));
  if (!existsSync(shared)) {
    cpSync(tree, `${shared}.part`, copy);
    renameSync(`${shared}.part`, shared);
  }
  symlinkSync(relative(into, shared), join(into, TOOL_TREE_DIR));
}

/** Copy into `home/kept` each harness the log names and `states` keeps, other than `parent` and
 *  those already there: a campaign tool calls it again, so a conversation's folder gains what was
 *  kept after it opened. The folder is there when it holds nothing, as the Builder is told it is. */
export function seedKept(home: string, states: string, events: readonly LogEvent[], parent: string): void {
  mkdirSync(join(home, "kept"), { recursive: true });
  for (const digest of namesOf(events).keys()) {
    const state = join(states, digest);
    const into = join(home, "kept", short(digest));
    if (digest !== parent && existsSync(state) && !existsSync(into)) copyHarness(state, into);
  }
}

/** The parent's tool tree, where it really is; null when the parent has none. Every caller copies
 *  it as the host, outside every wall, into a seat's home or a handover, so the tree lies in the
 *  harness or beside it, as a kept state's does: a link to anywhere would let an imported
 *  harness's `.toolchain` hand any folder the host reads to the next Builder. */
export function parentToolTree(parent: string): string | null {
  const tree = join(parent, TOOL_TREE_DIR);
  if (!existsSync(tree)) return null;
  const real = realpathSync(tree);
  if (!containsPath(real, realpathSync(dirname(parent)))) {
    throw new Error(`${parent}: its ${TOOL_TREE_DIR} links outside the folder it lies in`);
  }
  return real;
}

/** Refuses links and executable scripts in a frozen copy of `<under>` that name the session's
 *  ephemeral home: a launcher an install wrote with its own absolute path, a console script's
 *  interpreter, or an absolute link into the tree. Shared with drafted exam `.toolchain/` staging. */
export function refuseNamingHome(dir: string, home: string, under: string): void {
  const forms = [...new Set([home, realpathSync(home)])];
  const named = pathsUnder(dir).filter((path) => {
    const full = join(dir, path);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) return forms.some((form) => readlinkSync(full).includes(form));
    if (!stat.isFile() || (stat.mode & 0o111) === 0) return false;
    const bytes = readFileSync(full);
    return bytes.subarray(0, 2).toString() === "#!" && forms.some((form) => bytes.includes(form));
  });
  if (named.length > 0) {
    throw new Error(
      `${named.map((path) => join(under, path)).join(", ")} name your home, and frozen tools run from elsewhere: a launcher finds its files from its own path, as "$(dirname "$0")" does, and a link names its target relatively`,
    );
  }
}

/** Remove a tree copy no kept state's `.toolchain` names, which is what the last copy becomes once
 *  the tree has changed and nothing was frozen under it. A `check_harness` call keeps nothing and
 *  makes one all the same, and a domain's tree can run to hundreds of megabytes, so a check after
 *  each tree edit would leave one each. */
function dropUnlinked(states: string, dir: string): void {
  const named = join("..", basename(dir));
  const links = readdirSync(states).map((name) => join(states, name, TOOL_TREE_DIR));
  const linked = (link: string) =>
    lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true && readlinkSync(link) === named;
  if (!links.some(linked)) rmSync(dir, { recursive: true, force: true });
}

/** A copy of `harness/.toolchain` beside the states, for a frozen harness to link to; the last one
 *  kept while the tree's stamp holds. One domain's tree is 316 MB, which a copy at every freeze
 *  would spend again on each check and practice. Null when the harness has no tree.
 *
 *  The tree is the directory itself, inside the home. A link there is refused: the freeze would
 *  copy what the link named, the repository with its logs among what it could name, into the tree
 *  every later solve reads. */
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
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  bench.tree = { stamp, dir };
  return dir;
}

/**
 * `source`, a harness directory, copied into a fresh folder among `states` as a state is kept:
 * its files less its own `.toolchain`, links as they are, and its programs named by a link to
 * `tree` beside it, so both go where the campaign's folder goes. The caller opens the copy and
 * keeps it or removes it. Shared with the import of a harness built elsewhere
 * (`tools/d2/import.ts`), which keeps one the same way.
 */
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

/**
 * `harness/` as it stands, copied beside the kept states and opened as a solve would open it, then
 * handed to `use`. Throws, with the harness's own error, when a solve could not: a harness that
 * does not open fails every task before its first turn, and one frozen so would be scored at a
 * full round's cost to say only that. Links are
 * copied as they are: a stored state carries links that resolve to nothing, and following one would
 * copy what it points at. The copy is removed once `use` returns or throws, unless `use` moved it
 * away: only a state a solve ran with, or the session's last, is kept (`snapshot`).
 */
export async function frozen<T>(bench: Freezing, use: (kept: HarnessSnapshot) => T | Promise<T>): Promise<T> {
  const { states } = bench.request;
  mkdirSync(states, { recursive: true });
  let dir: string | null = null;
  let opened = false;
  try {
    dir = stagedState(join(bench.home, "harness"), states, keptTree(bench), "freezing-");
    refuseNamingHome(dir, bench.home, "harness");
    const harness = await openHarness(dir);
    // A preset no solve serves fails every solve, and is refused here before one is spent on it.
    selectedCodingTools(harness.presets);
    opened = true;
    return await use({ dir, harness });
  } catch (error) {
    if (opened) throw error;
    // The copy's own path is the host's, and says where the states and the log beside them are.
    const why = errorMessage(error).replaceAll(dir ?? states, "harness");
    throw new Error(`the harness does not open: ${why}`, { cause: error });
  } finally {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Freeze `harness/` and keep the copy under its digest in the caller's `states`, so every harness a
 * practice solve ran with can be opened again.
 */
export async function snapshot(bench: Freezing): Promise<HarnessSnapshot> {
  return await frozen(bench, ({ dir, harness }) => {
    const kept = join(dirname(dir), harness.digest);
    try {
      renameSync(dir, kept);
    } catch (error) {
      // A state already kept under this digest, by this session or one beside it, is the same harness.
      if (!existsSync(kept)) throw error;
    }
    bench.opened = {
      dir: kept,
      harness: { ...harness, toolTree: harness.toolTree === null ? null : join(kept, TOOL_TREE_DIR) },
    };
    return bench.opened;
  });
}

/** The digest of `harness/` as it stands, or why it does not open: frozen once, the copy removed. */
export async function harnessNow(bench: Freezing): Promise<string | Error> {
  return await frozen(bench, ({ harness }) => harness.digest).catch(asError);
}
