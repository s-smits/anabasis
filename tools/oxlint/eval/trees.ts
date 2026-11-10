/**
 * The trees the eval reads, materialised once each under a cache folder: a repository at a commit
 * is `git archive`d into its own folder, and a mutant is a copy of that folder with the mutant's
 * edits applied. Nothing is checked out in the repository itself, so its worktrees and branches
 * stay as they were. A folder holds a `.ready` marker once whole, so a killed run leaves a folder
 * the next run rebuilds rather than reads. A foreign repository the corpus names is recorded in
 * `foreign.json` (its name, where it is cloned from and the head whose hits are judged) and cloned
 * once, without blobs, under the cache, so the eval needs no clone passed by hand.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runSync } from "#src/meta/subprocess.ts";
import type { Range, TreeKey } from "./corpus.ts";
import { applyMutant } from "./mutate.ts";

const READY = ".ready";
const EDITED = ".edited.json";
const FOREIGN = join(import.meta.dir, "foreign.json");

/** A foreign repository the eval reads: where it is cloned from, and the head whose hits are judged. */
interface Foreign {
  name: string;
  url: string;
  head: string;
}

/** A materialised tree: its folder, and for a mutant the ranges its edits made. */
export interface Tree {
  root: string;
  edited: Range[];
}

/** The full commit a name resolves to in a repository; throws where it resolves to none. */
export function fullCommit(repo: string, commit: string): string {
  return gitText(repo, "rev-parse", "--verify", `${commit}^{commit}`);
}

/** The foreign repositories `foreign.json` records. */
export function foreignRepos(): Foreign[] {
  const rows = capturedJsonParse(readFileSync(FOREIGN, "utf8"));
  return (Array.isArray(rows) ? rows : []).flatMap((row) =>
    isRecord(row) && isString(row.name) && isString(row.url) && isString(row.head)
      ? [{ name: row.name, url: row.url, head: row.head }]
      : [],
  );
}

/**
 * A blobless clone of a foreign repository under the cache, made once and fetched again only when
 * it lacks the recorded head; `git archive` fetches the blobs each tree needs.
 */
export function clonedRepo(foreign: Foreign, cache: string): string {
  const root = join(cache, "clones", foreign.name);
  if (!existsSync(join(root, READY))) {
    rmSync(root, { recursive: true, force: true });
    const clone = runSync([
      "git",
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--no-checkout",
      foreign.url,
      root,
    ]);
    if (clone.exitCode !== 0) {
      throw new Error(`could not clone ${foreign.url}: ${new TextDecoder().decode(clone.stderr)}`);
    }
    writeFileSync(join(root, READY), foreign.url);
  }
  if (gitMaybe(root, "rev-parse", "--verify", `${foreign.head}^{commit}`) === null) {
    runSync(["git", "-C", root, "fetch", "--quiet", "origin"]);
  }
  return root;
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
