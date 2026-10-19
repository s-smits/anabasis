/**
 * The other harnesses a campaign has kept, copied into a Builder's home as `kept/`, one folder a
 * harness under the head of its digest, as the Builder's readings of past comparisons and fails
 * name it (`short`, `past.ts`). A session is handed the harness it starts from in `harness/` and
 * nothing else of what the campaign built: until 19 October a remedy an earlier session froze and
 * a later one dropped could not be read again, and a session could not go back to a harness that
 * did better than the one it was given. Harness² (arXiv 2610.14224) keeps such a library of
 * adopted harnesses for its editors, and removing it cost 3.1 and 1.8 points in its table 3.
 *
 * It is a folder and no tool, and the Builder is told it is there and nothing more (operator,
 * 19 October: the way back is left open and not promoted). `reset_harness`, the tool that put
 * `harness/agent` back as the session found it, was called 0 times in 1,261 Builder calls and went
 * on 15 October. A copy is the session's own, as `harness/` is: nothing in it reaches a kept state,
 * and only `harness/` is frozen.
 *
 * The harnesses are those the log names (`namesOf`): a session's frozen harness, a checkpoint, an
 * import, a promotion and the starter, newest first. A state only a practice solve ran is left out.
 * Every copy, with its programs, comes out of the session's disk, so the copies stop at a quarter of
 * it: the three kept states of truss-fresh-opus held 489 MB with their programs, and the disk is
 * 2 GiB. A harness that does not fit is left out whole, since one without its programs would not
 * be the harness its digest names.
 */
import type { LogEvent } from "../kernel/log.ts";
import { CORRECTNESS_MODEL_DIR, TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import { cpSync, existsSync, lstatSync, mkdirSync } from "../meta/filesystem.ts";
import { basename, join, resolve } from "../meta/path.ts";
import { pathsUnder } from "../solve/harness.ts";
import { short } from "./move.ts";
import { namesOf } from "./names.ts";
import { parentToolTree } from "./tools.ts";

/** Where the copies go in the home. */
const KEPT_DIR = "kept";

/** The bytes of every file and link under `dir`, links not followed. A directory's own size is the
 *  file system's record of its entries, and is left out. */
function bytesUnder(dir: string): number {
  let sum = 0;
  for (const path of pathsUnder(dir)) {
    const entry = lstatSync(join(dir, path));
    if (!entry.isDirectory()) sum += entry.size;
  }
  return sum;
}

/**
 * Copy into `home` each harness the log names, kept in `states`, other than `parent`, newest
 * first while the copies fit in a quarter of `diskBytes`. A v1 state's correctness model, which
 * holds every task's hidden values, is left out at any depth, as the session leaves it out of
 * `harness/`. Returns the folders written, by digest.
 */
export function seedKept(run: {
  readonly home: string;
  readonly states: string;
  readonly events: readonly LogEvent[];
  readonly parent: string;
  readonly diskBytes: number;
}): string[] {
  const battery = basename(CORRECTNESS_MODEL_DIR);
  const room = Math.floor(run.diskBytes / 4);
  const named = [...namesOf(run.events).keys()]
    .toReversed()
    .filter((digest) => digest !== run.parent && existsSync(join(run.states, digest)));
  // The folder is there when it holds nothing, as the Builder is told it is.
  mkdirSync(join(run.home, KEPT_DIR), { recursive: true });
  let used = 0;
  const written: string[] = [];
  for (const digest of named) {
    const source = join(run.states, digest);
    const tree = parentToolTree(source);
    const own = resolve(source, TOOL_TREE_DIR);
    const size = bytesUnder(source) + (tree === null ? 0 : bytesUnder(tree));
    if (used + size > room) continue;
    used += size;
    const into = join(run.home, KEPT_DIR, short(digest));
    cpSync(source, into, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (each) => resolve(each) !== own && basename(each) !== battery,
    });
    if (tree !== null) cpSync(tree, join(into, TOOL_TREE_DIR), { recursive: true, verbatimSymlinks: true });
    written.push(digest);
  }
  return written;
}
