/**
 * The trees the eval reads, materialised once each under a cache folder: a repository at a commit
 * is `git archive`d into its own folder, and a mutant is a copy of that folder with the mutant's
 * edits applied. Nothing is checked out in the repository itself, so its worktrees and branches
 * stay as they were. A folder holds a `.ready` marker once whole, so a killed run leaves a folder
 * the next run rebuilds rather than reads.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runSync } from "#src/meta/subprocess.ts";
import type { Range, TreeKey } from "./corpus.ts";
import { applyMutant } from "./mutate.ts";

const READY = ".ready";
const EDITED = ".edited.json";

/** A materialised tree: its folder, and for a mutant the ranges its edits made. */
export interface Tree {
  root: string;
  edited: Range[];
}

/** The full commit a name resolves to in a repository; throws where it resolves to none. */
export function fullCommit(repo: string, commit: string): string {
  return gitText(repo, "rev-parse", "--verify", `${commit}^{commit}`);
}

/** A repository's tree at a commit, archived into the cache once. */
function archived(repo: string, name: string, commit: string, cache: string): string {
  const root = join(cache, "trees", `${name}-${commit}`);
  if (existsSync(join(root, READY))) return root;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const tar = `${root}.tar`;
  const archive = runSync(["git", "-C", repo, "archive", "--format=tar", "-o", tar, commit]);
  const unpack = archive.exitCode === 0 ? runSync(["tar", "-xf", tar, "-C", root]) : archive;
  rmSync(tar, { force: true });
  if (unpack.exitCode !== 0) {
    throw new Error(`could not archive ${name} at ${commit}: ${new TextDecoder().decode(unpack.stderr)}`);
  }
  writeFileSync(join(root, READY), commit);
  return root;
}

function editedOf(text: string): Range[] {
  const rows = capturedJsonParse(text);
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!isRecord(row) || !isString(row.file) || !Array.isArray(row.lines)) return [];
    const [start, end] = row.lines;
    return isNumber(start) && isNumber(end) ? [{ file: row.file, lines: [start, end] as const }] : [];
  });
}

/**
 * The tree a key names, built if the cache lacks it. `repos` maps a corpus repository name to the
 * local clone that holds its commits.
 */
export function treeOf(key: TreeKey, repos: ReadonlyMap<string, string>, cache: string): Tree {
  const repo = repos.get(key.repo);
  if (repo === undefined) {
    throw new Error(`no clone given for repository ${key.repo} (pass --repo ${key.repo}=<path>)`);
  }
  const base = archived(repo, key.repo, fullCommit(repo, key.commit), cache);
  if (key.mutant === undefined) return { root: base, edited: [] };
  const root = `${base}#${key.mutant}`;
  if (existsSync(join(root, READY))) {
    return { root, edited: editedOf(readFileSync(join(root, EDITED), "utf8")) };
  }
  rmSync(root, { recursive: true, force: true });
  cpSync(base, root, { recursive: true });
  const edited = applyMutant(key.mutant, root);
  writeFileSync(join(root, EDITED), capturedJsonStringify(edited));
  writeFileSync(join(root, READY), key.mutant);
  return { root, edited };
}
