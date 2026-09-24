/**
 * One recorded run, read the way every review script needs it: the run a folder names, its opening
 * with a concrete source identity, and a clean checkout proved to hold that source.
 *
 * Each script that reviews a run used to do these steps itself, and they had drifted. One compared
 * the checkout's HEAD but not its digest, one read the opening without checking that its run id was
 * the run it had been asked for, and each spelled its own refusals. The selection itself belongs to
 * `resolveRunSelector` in tools/runs/discover.ts, and the identity check to `sourceIdentityIsValid`;
 * this module joins them and owns the checkout.
 */
import { readJsonFile } from "#src/meta/completed-json.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { hostTool } from "#src/meta/host-tool.ts";
import { asRecord, type JsonObject } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { join, resolve } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import {
  type ControllerEvidence,
  readControllerEvidence,
  sourceIdentityIsValid,
} from "#src/run/controller-evidence.ts";
import { controllerEvidenceDir, OPENING_FILE } from "#src/run/controller-lineage.ts";
import { digestExecutableRoots, type SourceIdentity } from "#src/run/source-identity.ts";
import { parseWorktreeList, resolveRunSelector } from "#tools/runs/discover.ts";

const GIT_SHA = /^[0-9a-f]{40}$/;
const SKILL_REPO = resolve(import.meta.dirname, "..", "..", "..");
// The opening hashed the pin file as committed, so a checkout's recapture does the same, and a
// locally bumped pin is not a dirty source.
const PIN_FILE = ".bun-version";

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
  repo?: string | null;
  cwd?: string;
  skillRepo?: string;
  cache?: string;
  git?: Git;
}

/** A checkout chosen to hold a commit, and how it was chosen. */
export interface SourceCheckout {
  repo: string;
  chosen: string;
}

/** A chosen checkout whose recaptured identity matched the run's source. */
export interface MeasuredCheckout extends SourceCheckout {
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

function cleanHeadAt(dir: string, commit: string, git: Git): boolean {
  try {
    return (
      git(["git", "rev-parse", "HEAD"], dir) === commit &&
      git(["git", "status", "--porcelain", "--untracked-files=no", "--", ".", `:!${PIN_FILE}`], dir) === ""
    );
  } catch {
    return false;
  }
}

/**
 * A clean prepared checkout whose HEAD is `commit`: the caller's `repo`, else the current
 * directory, else any worktree of the skill's repository, else a detached worktree created under
 * ~/.cache/hb4/wri-source. A worktree this selects or creates is prepared by
 * `scripts/worktree.sh setup`, the one owner of dependency preparation, which does nothing when the
 * tree is already prepared.
 */
export function resolveSourceCheckout(
  commit: string,
  {
    repo = null,
    cwd = resolve("."),
    skillRepo = SKILL_REPO,
    cache = join(homedir(), ".cache", "hb4", "wri-source"),
    git = gitIn,
  }: CheckoutWhere = {},
): SourceCheckout {
  if (!GIT_SHA.test(commit)) throw new Error(`run source commit is not a full sha: ${commit}`);
  if (repo !== null) return { repo: resolve(repo), chosen: "--repo" };
  if (cleanHeadAt(cwd, commit, git)) return { repo: cwd, chosen: "current directory" };
  const prepare = (dir: string): string =>
    git([join(skillRepo, "scripts", "worktree.sh"), "setup", dir], skillRepo);
  const listed = parseWorktreeList(git(["git", "worktree", "list", "--porcelain"], skillRepo));
  for (const { path } of listed) {
    if (!cleanHeadAt(path, commit, git)) continue;
    prepare(path);
    return { repo: path, chosen: "existing worktree" };
  }
  const dir = join(cache, commit.slice(0, 12));
  if (!existsSync(dir)) {
    try {
      git(["git", "cat-file", "-e", `${commit}^{commit}`], skillRepo);
    } catch {
      git(["git", "fetch", "--quiet", "origin", commit], skillRepo);
    }
    git(["git", "worktree", "add", "--detach", dir, commit], skillRepo);
  }
  if (!cleanHeadAt(dir, commit, git)) throw new Error(`${dir} is not a clean checkout of ${commit}`);
  prepare(dir);
  return { repo: dir, chosen: "new detached worktree" };
}

/**
 * The checkout that measured `source`, with its identity recaptured and required to match: the
 * same HEAD, the same digest over the executable roots and the same dirty flag. A review read
 * through a different tree's readers is a review of a different condition.
 */
export function measuredCheckout(source: SourceIdentity, where: CheckoutWhere = {}): MeasuredCheckout {
  const { repo, chosen } = resolveSourceCheckout(source.commit, where);
  const git = where.git ?? gitIn;
  const observed: SourceIdentity = {
    commit: git(["git", "rev-parse", "HEAD"], repo),
    sourceDigest: digestExecutableRoots(repo, [PIN_FILE]),
    dirty:
      git(["git", "status", "--porcelain", "--untracked-files=no", "--", ".", `:!${PIN_FILE}`], repo) !== "",
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
