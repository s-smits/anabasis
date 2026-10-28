/**
 * A kept harness copied into a Builder's home: the one a session starts from as `harness/`, and
 * every other one the campaign kept as `kept/<head of its digest>`, as the Builder's readings of
 * past comparisons and fails name it (`short`, `past.ts`). Until 19 October a session was handed
 * the harness it starts from and nothing else of what the campaign built, so a remedy an earlier
 * session froze and a later one dropped could not be read again. Harness² (arXiv 2610.14224) keeps
 * such a library of kept harnesses for its editors, and removing it cost 3.1 and 1.8 points in
 * its table 3.
 *
 * It is a folder and no tool, and the Builder is told it is there and nothing more (operator,
 * 19 October: the way back is left open and not promoted). Every kept harness is copied whole and
 * the Builder searches them with its own shell, which runs Python (operator, 20 October): the
 * first form chose the newest that fit in a quarter of the disk image, which went with #241.
 * `reset_harness`, the tool that put `harness/agent` back as the session found it, was called
 * 0 times in 1,261 Builder calls and went on 15 October.
 *
 * A kept state's tool tree is a link to the copy kept of it, so the tree is copied from where it
 * is. A v1 state carries its correctness model, whose exam holds every task's hidden values, at
 * its root and again in each `.bundle-snapshots` entry; no harness reads it, and the checks are the
 * host's, so the Builder is given no copy of it at any depth.
 */
import type { LogEvent } from "../kernel/log.ts";
import { CORRECTNESS_MODEL_DIR, TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, symlinkSync } from "../meta/filesystem.ts";
import { basename, join, relative, resolve } from "../meta/path.ts";
import { pathsUnder } from "../harness/open.ts";
import { short } from "../campaign/move.ts";
import { namesOf } from "../campaign/names.ts";
import { parentToolTree } from "./tools.ts";

/** A tool tree larger than this is a helper a handover links to instead of copying (operator, 27
 *  October): an installed Python stack ran to 469 MB, and a campaign hands over at each ending. */
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

/** Copy into `home/kept` each harness the log names and `states` keeps, other than `parent`. The
 *  folder is there when it holds nothing, as the Builder is told it is. */
export function seedKept(home: string, states: string, events: readonly LogEvent[], parent: string): void {
  mkdirSync(join(home, "kept"), { recursive: true });
  for (const digest of namesOf(events).keys()) {
    const state = join(states, digest);
    if (digest !== parent && existsSync(state)) copyHarness(state, join(home, "kept", short(digest)));
  }
}
