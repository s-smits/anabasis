// One folder in, everything the deterministic collection needs out. The operator points at a
// campaign, its controller directory or one controller/<runId> folder; this module names the run
// (the latest opening when several exist) and finds or prepares a clean checkout at the run's
// recorded source commit, so the collect command needs no --campaign, --run or --repo.
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

const GIT_SHA = /^[0-9a-f]{40}$/;
const SKILL_REPO = resolve(import.meta.dirname, "..", "..", "..", "..");

const gitText = (cmd, cwd) => runTextSyncOrThrow(cmd, { cwd }).trim();

function readOpening(campaign, runId) {
  const path = join(campaign, "controller", runId, "opening.json");
  if (!existsSync(path)) return null;
  try {
    return readJsonFile(path);
  } catch {
    return null;
  }
}

/** Campaign and run from one folder: `<campaign>`, `<campaign>/controller` or `<campaign>/controller/<runId>`.
 *  @param {string | null} [explicitRun] --run, which must agree when the folder already names one */
export function resolveRunTarget(folder, explicitRun = null) {
  const target = resolve(folder);
  if (!existsSync(target)) throw new Error(`no such folder: ${target}`);
  if (basename(dirname(target)) === "controller" && existsSync(join(target, "opening.json"))) {
    const runId = basename(target);
    if (explicitRun !== null && explicitRun !== runId) {
      throw new Error(`folder names run ${runId} but --run says ${explicitRun}`);
    }
    return { campaign: dirname(dirname(target)), runId, chosen: "folder" };
  }
  const campaign = basename(target) === "controller" ? dirname(target) : target;
  const controller = join(campaign, "controller");
  if (!existsSync(controller)) throw new Error(`no controller directory under ${campaign}`);
  if (explicitRun !== null) return { campaign, runId: explicitRun, chosen: "--run" };
  const runs = readdirSync(controller)
    .map((runId) => ({ runId, opening: readOpening(campaign, runId) }))
    .filter((row) => row.opening !== null)
    .sort(
      (a, b) =>
        String(b.opening.writtenAt ?? "").localeCompare(String(a.opening.writtenAt ?? "")) ||
        b.runId.localeCompare(a.runId),
    );
  if (runs.length === 0) throw new Error(`no run with an opening.json under ${controller}`);
  return {
    campaign,
    runId: runs[0].runId,
    chosen: runs.length === 1 ? "only run" : `latest of ${runs.length} runs by opening writtenAt`,
  };
}

function cleanHeadAt(dir, commit, git) {
  try {
    return (
      git(["git", "rev-parse", "HEAD"], dir) === commit &&
      git(["git", "status", "--porcelain", "--untracked-files=no", "--", ".", ":!.bun-version"], dir) === ""
    );
  } catch {
    return false;
  }
}

/**
 * A clean prepared checkout whose HEAD is `commit`: the caller's --repo, else the current
 * directory, else any worktree of the skill's repository, else a detached worktree created under
 * ~/.cache/hb4/wri-source and prepared with one frozen install under the Bun on PATH.
 *
 * @param {{ repo?: string | null, cwd?: string, skillRepo?: string, cache?: string,
 *           git?: (args: string[], dir: string) => string }} [where]
 */
export function resolveSourceCheckout(
  commit,
  {
    repo = null,
    cwd = resolve("."),
    skillRepo = SKILL_REPO,
    cache = join(homedir(), ".cache", "hb4", "wri-source"),
    git = gitText,
  } = {},
) {
  if (!GIT_SHA.test(commit)) throw new Error(`run source commit is not a full sha: ${commit}`);
  if (repo !== null) return { repo: resolve(repo), chosen: "--repo" };
  if (cleanHeadAt(cwd, commit, git)) return { repo: cwd, chosen: "current directory" };
  const listed = git(["git", "worktree", "list", "--porcelain"], skillRepo).split("\n");
  for (const line of listed.filter((row) => row.startsWith("worktree "))) {
    const dir = line.slice("worktree ".length);
    if (cleanHeadAt(dir, commit, git)) return { repo: dir, chosen: "existing worktree" };
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
  git(["bun", "install", "--frozen-lockfile"], dir);
  return { repo: dir, chosen: "new detached worktree" };
}
