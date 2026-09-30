/**
 * One recorded run, read the way every review script needs it: the run a folder names, its opening
 * with a concrete source identity, and the checkout whose readers read it.
 *
 * A run's records are read by the source that wrote them. A newer tree's readers refuse an older
 * run's records outright (a `product-version/v1` directory under a reader of v2 only) or read them
 * as something else, so the checkout is the opening's `source.commit`, clean, with its own
 * dependencies installed. The selection itself belongs to `resolveRunSelector` in
 * tools/runs/discover.ts, and the identity check to `sourceIdentityIsValid`; this module joins them
 * and owns the checkout.
 */
import { readJsonFile } from "#src/meta/completed-json.ts";
import { existsSync, lstatSync } from "#src/meta/filesystem.ts";
import { hostTool } from "#src/meta/host-tool.ts";
import { asRecord, type JsonObject } from "#src/meta/json-shape.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import {
  type ControllerEvidence,
  readControllerEvidence,
  sourceIdentityIsValid,
} from "#src/run/controller-evidence.ts";
import { controllerEvidenceDir, OPENING_FILE } from "#src/run/controller-lineage.ts";
import { digestExecutableRoots, type SourceIdentity } from "#src/run/source-identity.ts";
import { WORKTREE_SCRIPT } from "#tools/dependency-identity.ts";
import { parseWorktreeList, readLaunchRecord, resolveRunSelector } from "#tools/runs/discover.ts";

const GIT_SHA = /^[0-9a-f]{40}$/;
const SKILL_REPO = resolve(import.meta.dirname, "..", "..", "..");
// The opening hashed the pin file as committed, so a checkout's recapture does the same, and a
// locally bumped pin is not a dirty source.
const PIN_FILE = ".bun-version";
/** The directory the launcher gives each run's worktree, `ana-run-<runId>`. */
const RUN_TREE = "ana-run-";

export interface RecordedRun {
  campaign: string;
  runId: string;
  /** How the run was chosen: the folder's own run, `--run`, or the latest opening. */
  chosen: string;
  controllerDir: string;
  openingPath: string;
  opening: JsonObject;
  source: SourceIdentity;
  /**
   * The controller's own strict reading of this run: `readControllerEvidence`, which binds the
   * terminal to this opening, recomputes the denominator from the case rows and checks every
   * battery seal. Null exactly when that reading refused the run, which `controllerError` says; a
   * review of a damaged run still proceeds, and names the damage instead of re-reading the files
   * leniently and reporting counts the controller would not stand behind.
   */
  controller: ControllerEvidence | null;
  controllerError: string | null;
}

type Git = (cmd: readonly string[], dir: string) => string;

export interface CheckoutWhere {
  /** The checkout the reader named, used when it can read the run. */
  repo?: string | null;
  /** The run being read: its own worktree is a candidate, another run's never is. */
  runId?: string | null;
  skillRepo?: string;
  git?: Git;
}

/** The checkout whose readers read a run, how it was chosen and the ones passed over on the way;
 *  or, when none can be had, the commit and every reason. */
export type SourceCheckout =
  | { state: "resolved"; repo: string; chosen: string; passed: string[] }
  | { state: "source-unresolved"; commit: string; passed: string[] };

/** A chosen checkout whose recaptured identity matched the run's source. */
export interface MeasuredCheckout {
  repo: string;
  chosen: string;
  observed: SourceIdentity;
}

/**
 * The run `folder` names (a campaign, its controller directory or one run's directory), or `run`
 * inside it, with an opening that is this run's and carries a concrete source identity.
 */
export function openRecordedRun(folder: string, run: string | null = null): RecordedRun {
  const { campaign, runId, chosen } = resolveRunSelector(folder, run);
  const controllerDir = controllerEvidenceDir(resolve(campaign), runId);
  const openingPath = join(controllerDir, OPENING_FILE);
  if (!existsSync(openingPath)) throw new Error(`no opening.json for the requested run: ${openingPath}`);
  const opening = asRecord(readJsonFile(openingPath));
  if (opening === null) throw new Error(`${openingPath}: not a JSON object`);
  if (opening.runId !== runId) {
    throw new Error(
      `opening runId ${JSON.stringify(opening.runId ?? null)} differs from requested run ${runId}`,
    );
  }
  const source = opening.source;
  if (!sourceIdentityIsValid(source)) {
    throw new Error(`opening source identity is not concrete at ${openingPath}`);
  }
  let controller: ControllerEvidence | null = null;
  let controllerError: string | null = null;
  try {
    controller = readControllerEvidence(resolve(campaign), runId);
  } catch (error) {
    controllerError = errorMessage(error);
  }
  return {
    campaign: resolve(campaign),
    runId,
    chosen,
    controllerDir,
    openingPath,
    opening,
    source,
    controller,
    controllerError,
  };
}

const gitIn: Git = (cmd, dir) =>
  runTextSyncOrThrow(cmd[0] === "git" ? [hostTool("git"), ...cmd.slice(1)] : [...cmd], {
    cwd: dir,
    maxBuffer: CAPTURE_MAX_BYTES,
  }).trim();

/** Tracked changes beside the committed tree, the pin aside. Optional locks are off, so asking
 *  never rewrites the index of a tree that is not the reader's own. */
const trackedChanges = (dir: string, git: Git): string =>
  git(
    [
      "git",
      "--no-optional-locks",
      "status",
      "--porcelain",
      "--untracked-files=no",
      "--",
      ".",
      `:!${PIN_FILE}`,
    ],
    dir,
  );

/**
 * Why `dir` cannot run the readers of `commit`, or null when it can: its HEAD is the commit, its
 * tracked files are the commit's, and every dependency its own manifest declares is installed in a
 * node_modules of its own. A missing dependency is what refused the read of truss-sol-…-198d70,
 * whose run worktree had never been prepared; checking the manifest costs one stat per package.
 */
function unusable(dir: string, commit: string, git: Git): string | null {
  let head: string;
  try {
    head = git(["git", "rev-parse", "HEAD"], dir);
  } catch {
    return "not a Git checkout";
  }
  if (head !== commit) return `HEAD is ${head.slice(0, 12)}, not ${commit.slice(0, 12)}`;
  if (trackedChanges(dir, git) !== "") return "tracked files differ from the commit";
  const modules = join(dir, "node_modules");
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) {
    return "node_modules is a link to another tree";
  }
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return "no package.json at its root";
  const declared = Object.keys(asRecord(asRecord(readJsonFile(manifest))?.dependencies) ?? {});
  const missing = declared.filter((name) => !existsSync(join(modules, name, "package.json")));
  return missing.length === 0 ? null : `dependencies not installed: ${missing.join(", ")}`;
}

/** The run a worktree was launched for, by its launch receipt or its launcher-given name; null for
 *  a checkout no run owns. */
function runOf(dir: string): string | null {
  const name = basename(dir);
  return readLaunchRecord(dir)?.runId ?? (name.startsWith(RUN_TREE) ? name.slice(RUN_TREE.length) : null);
}

/**
 * The checkout whose readers read a run measured at `commit`, chosen the same way every time:
 * `repo` when it can read it; else a registered worktree of the commit that can, the read's own
 * review worktree `ana-wri-<sha8>` first and the run's own worktree last, because that tree is the
 * run's evidence and a sibling run's worktree is never read at all; else the review worktree,
 * created beside the main checkout when absent and prepared by `scripts/worktree.sh setup` from its
 * own lock. A checkout found is read as it is: nothing prepares, installs into or fetches for it.
 * A commit whose object the repository does not hold is `source-unresolved`, with every reason.
 */
export function resolveSourceCheckout(
  commit: string,
  { repo = null, runId = null, skillRepo = SKILL_REPO, git = gitIn }: CheckoutWhere = {},
): SourceCheckout {
  if (!GIT_SHA.test(commit)) throw new Error(`run source commit is not a full sha: ${commit}`);
  const passed: string[] = [];
  const given = repo === null ? null : resolve(repo);
  const unusableAs = (how: string, dir: string): boolean => {
    const why = unusable(dir, commit, git);
    if (why !== null) passed.push(`${how} ${dir}: ${why}`);
    return why !== null;
  };
  if (given !== null && !unusableAs("--repo", given)) {
    return { state: "resolved", repo: given, chosen: "--repo", passed };
  }
  let listed: { path: string; head: string | null }[] = [];
  try {
    listed = parseWorktreeList(git(["git", "worktree", "list", "--porcelain"], skillRepo));
  } catch (error) {
    passed.push(`worktrees of ${skillRepo}: ${errorMessage(error)}`);
  }
  const main = listed[0]?.path ?? skillRepo;
  const review = join(dirname(main), `ana-wri-${commit.slice(0, 8)}`);
  const rank = (dir: string): number => (dir === review ? 0 : runOf(dir) === null ? 1 : 2);
  const found = listed
    .filter((row) => row.head === commit && row.path !== given)
    .map((row) => row.path)
    .filter((dir) => runOf(dir) === null || runOf(dir) === runId)
    .sort((a, b) => rank(a) - rank(b));
  const usable = found.find((dir) => !unusableAs("existing checkout", dir));
  if (usable !== undefined) return { state: "resolved", repo: usable, chosen: "existing checkout", passed };
  try {
    git(["git", "cat-file", "-e", `${commit}^{commit}`], skillRepo);
  } catch {
    return {
      state: "source-unresolved",
      commit,
      passed: [...passed, `commit object ${commit} is not in ${main}`],
    };
  }
  if (!existsSync(review)) git(["git", "worktree", "add", "--detach", review, commit], skillRepo);
  git([join(skillRepo, WORKTREE_SCRIPT), "setup", review], skillRepo);
  if (unusableAs("prepared review worktree", review)) return { state: "source-unresolved", commit, passed };
  return { state: "resolved", repo: review, chosen: "prepared review worktree", passed };
}

/** What a read says when no checkout can read the run's measured source. */
export function sourceUnresolved({ commit, passed }: { commit: string; passed: readonly string[] }): string {
  return [
    `source-unresolved: ${commit}: no checkout of the run's measured source can read it`,
    ...passed.map((reason) => `  passed over ${reason}`),
  ].join("\n");
}

/**
 * The checkout that measured `source`, with its identity recaptured and required to match: the
 * same HEAD, the same digest over the executable roots and the same dirty flag. A review read
 * through a different tree's readers is a review of a different condition.
 */
export function measuredCheckout(source: SourceIdentity, where: CheckoutWhere = {}): MeasuredCheckout {
  const found = resolveSourceCheckout(source.commit, where);
  if (found.state === "source-unresolved") throw new Error(sourceUnresolved(found));
  const { repo, chosen } = found;
  const git = where.git ?? gitIn;
  const observed: SourceIdentity = {
    commit: git(["git", "rev-parse", "HEAD"], repo),
    sourceDigest: digestExecutableRoots(repo, [PIN_FILE]),
    dirty: trackedChanges(repo, git) !== "",
  };
  if (observed.commit !== source.commit) {
    throw new Error(`run source commit ${source.commit} does not match worktree HEAD ${observed.commit}`);
  }
  if (observed.sourceDigest !== source.sourceDigest) {
    throw new Error(
      `run source digest ${source.sourceDigest} does not match the recaptured worktree digest ${observed.sourceDigest}`,
    );
  }
  if (observed.dirty !== source.dirty) {
    throw new Error(
      `run source dirty flag ${source.dirty} does not match the recaptured worktree state ${observed.dirty}`,
    );
  }
  return { repo, chosen, observed };
}
