/**
 * Where this machine's runs are.
 *
 * A run leaves its evidence in two trees that nothing joins today. The main checkout's campaign
 * tree owns `controller/<runId>/opening.json` and the terminal beside it; the detached worktree the
 * launcher created owns `.scratch/quick-run/launch.json`, which alone names the service, the log and
 * the preset the run was launched from. Answering "what is running" meant reading both by hand.
 * This module enumerates the recorded runs and joins each to its worktree by run id.
 *
 * Read-only. Nothing here writes, signals a process or opens the controller ledger.
 */
import { campaignRoot } from "../../src/meta/campaign-root.ts";
import { controllerEvidenceDir, OPENING_FILE, TERMINAL_FILE } from "../../src/run/controller-lineage.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "../../src/meta/filesystem.ts";
import { basename, dirname, join, resolve } from "../../src/meta/path.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { isString } from "../../src/meta/json-shape.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";

/** One recorded controller run: the evidence paths are derived from the one campaign-path owner. */
export interface RunLocation {
  runId: string;
  slug: string;
  campaignDir: string;
  openingPath: string;
  terminalPath: string;
}

/** The launcher's own receipt for a run, as far as it is still on disk. */
export interface LaunchRecord {
  runId: string;
  dir: string;
  service: string | null;
  log: string | null;
  preset: string | null;
  condition: string | null;
  budget: string | null;
  project: string | null;
  argv: string[];
}

/** The worktree-relative receipt `launch-run/scripts/launch.ts` writes for each run it starts. */
export const LAUNCH_RECEIPT_PATH = ".scratch/quick-run/launch.json";

type RawLaunch = {
  runId?: unknown;
  dir?: unknown;
  service?: unknown;
  log?: unknown;
  preset?: unknown;
  condition?: unknown;
  budget?: unknown;
  project?: unknown;
  argv?: unknown;
};

/** The run one operator-named folder selects, and how it was chosen. */
export interface RunSelection {
  campaign: string;
  runId: string;
  chosen: string;
}

/** One registered worktree as `git worktree list --porcelain` names it. */
interface WorktreeEntry {
  path: string;
  /** Null for a bare entry, which has no checked-out commit. */
  head: string | null;
  /** The full ref (`refs/heads/...`), or null for a detached head. */
  branch: string | null;
}

/**
 * The checkout that owns the campaign tree. Run worktrees symlink `campaigns` into it, so every
 * subcommand resolves the same root from wherever the operator happens to stand — the launcher
 * resolves the main checkout the same way.
 */
export function mainCheckout(cwd: string): string {
  const result = runSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`${cwd} is not inside a git checkout: ${decodeOutput(result.stderr).trim()}`);
  }
  return dirname(decodeOutput(result.stdout).trim());
}

/**
 * A campaign tree collects stray files beside its directories — a `.DS_Store` among the slugs is
 * routine — so a path under one of them stats ENOTDIR rather than returning nothing. Both answers
 * mean the same thing here: there is no directory to walk.
 */
function isDirectory(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** Every run one campaign recorded an opening for, in no particular order. */
export function campaignRuns(campaignDir: string): RunLocation[] {
  const controller = join(campaignDir, "controller");
  if (!isDirectory(controller)) return [];
  const runs: RunLocation[] = [];
  for (const runId of readdirSync(controller)) {
    const dir = controllerEvidenceDir(campaignDir, runId);
    const openingPath = join(dir, OPENING_FILE);
    if (!existsSync(openingPath)) continue;
    runs.push({
      runId,
      slug: basename(campaignDir),
      campaignDir,
      openingPath,
      terminalPath: join(dir, TERMINAL_FILE),
    });
  }
  return runs;
}

/** Every run the campaign tree recorded an opening for, in no particular order. */
export function recordedRuns(repoRoot: string): RunLocation[] {
  const root = campaignRoot(repoRoot);
  if (!isDirectory(root)) return [];
  const runs: RunLocation[] = [];
  for (const slug of readdirSync(root)) runs.push(...campaignRuns(join(root, slug)));
  return runs;
}

/** The instant an opening says it was written, or null when the file holds no such record. */
export function openedAt(location: RunLocation): string | null {
  try {
    const opening = parseJsonAs<{ writtenAt?: unknown }>(readFileSync(location.openingPath, "utf8"));
    return isString(opening.writtenAt) ? opening.writtenAt : null;
  } catch {
    return null;
  }
}

/**
 * A campaign's runs newest first by the instant each opening recorded, the run id breaking a tie.
 * Directory order is not chronology: `run-9` sorts after `run-10` by name, and a relaunch suffix
 * sorts after the id it continued whichever was opened first. An opening with no readable
 * `writtenAt` has no place in the order and is left out rather than guessed at.
 */
function runsByOpening(campaignDir: string): RunLocation[] {
  const dated: Array<{ run: RunLocation; at: string }> = [];
  for (const run of campaignRuns(campaignDir)) {
    const at = openedAt(run);
    if (at !== null) dated.push({ run, at });
  }
  dated.sort(
    (left, right) => right.at.localeCompare(left.at) || right.run.runId.localeCompare(left.run.runId),
  );
  return dated.map(({ run }) => run);
}

/** The campaign's most recently opened run, or null when none recorded a readable opening. */
export function latestRun(campaignDir: string): RunLocation | null {
  return runsByOpening(campaignDir)[0] ?? null;
}

/** Every campaign's run by this id. A run id is unique inside one campaign only, so the caller
 *  decides what two matches mean. */
export function findRun(repoRoot: string, runId: string): RunLocation[] {
  return recordedRuns(repoRoot).filter((run) => run.runId === runId);
}

/**
 * Campaign and run from one folder: `<campaign>`, `<campaign>/controller` or
 * `<campaign>/controller/<runId>`. An explicit run must agree with a folder that already names one,
 * and a campaign folder alone selects its latest run by opening instant.
 */
export function resolveRunSelector(folder: string, explicitRun: string | null = null): RunSelection {
  const target = resolve(folder);
  if (!existsSync(target)) throw new Error(`no such folder: ${target}`);
  if (basename(dirname(target)) === "controller" && existsSync(join(target, OPENING_FILE))) {
    const runId = basename(target);
    if (explicitRun !== null && explicitRun !== runId) {
      throw new Error(`folder names run ${runId} but --run says ${explicitRun}`);
    }
    return { campaign: dirname(dirname(target)), runId, chosen: "folder" };
  }
  const campaign = basename(target) === "controller" ? dirname(target) : target;
  const controller = join(campaign, "controller");
  if (!isDirectory(controller)) throw new Error(`no controller directory under ${campaign}`);
  if (explicitRun !== null) return { campaign, runId: explicitRun, chosen: "--run" };
  const runs = runsByOpening(campaign);
  const latest = runs[0];
  if (latest === undefined) throw new Error(`no run with a dated opening.json under ${controller}`);
  return {
    campaign,
    runId: latest.runId,
    chosen: runs.length === 1 ? "only run" : `latest of ${runs.length} runs by opening writtenAt`,
  };
}

function stringOrNull(value: unknown): string | null {
  return isString(value) ? value : null;
}

/** One launcher receipt, or null when the directory holds none this reader can trust. */
export function readLaunchRecord(dir: string): LaunchRecord | null {
  const path = join(dir, LAUNCH_RECEIPT_PATH);
  if (!existsSync(path)) return null;
  let raw: RawLaunch;
  try {
    raw = parseJsonAs<RawLaunch>(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!isString(raw.runId) || raw.runId === "") return null;
  const argv = Array.isArray(raw.argv) ? raw.argv.filter(isString) : [];
  return {
    runId: raw.runId,
    dir: isString(raw.dir) ? raw.dir : dir,
    service: stringOrNull(raw.service),
    log: stringOrNull(raw.log),
    preset: stringOrNull(raw.preset),
    condition: stringOrNull(raw.condition),
    budget: stringOrNull(raw.budget),
    project: stringOrNull(raw.project),
    argv,
  };
}

/** The porcelain listing, parsed once for every reader that needs the fleet. */
export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const rows: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), head: null, branch: null };
      rows.push(current);
    } else if (current !== null && line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (current !== null && line.startsWith("branch ")) current.branch = line.slice("branch ".length);
  }
  return rows;
}

/** Every worktree registered to the repository at `repoRoot`; none when Git cannot list them. */
export function listWorktrees(repoRoot: string): WorktreeEntry[] {
  const result = runSync(["git", "worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.exitCode === 0 ? parseWorktreeList(decodeOutput(result.stdout)) : [];
}

/**
 * Every launcher receipt this machine still has, one per directory holding one. Both the
 * registered worktrees and the launcher's default parent directory are searched: a worktree
 * removed from Git may still hold the receipt of a run whose evidence is worth reading, and a run
 * launched with `--output-dir` lives outside the default parent.
 *
 * A list rather than a map keyed by run id. The controller admits a run id inside one campaign,
 * so two campaigns may hold the same one — `fullrun --run <id>` under a second `--project` is all
 * it takes — and a map kept whichever receipt the directory walk reached first. `rows.ts` owns the
 * join, where the campaign each run belongs to is in view.
 */
export function launchRecords(repoRoot: string): LaunchRecord[] {
  const parent = dirname(repoRoot);
  const siblings: string[] = [];
  for (const entry of isDirectory(parent) ? readdirSync(parent) : []) {
    if (entry.startsWith("ana-run-")) siblings.push(join(parent, entry));
  }
  const records: LaunchRecord[] = [];
  const seen = new Set<string>();
  for (const dir of [...listWorktrees(repoRoot).map((tree) => tree.path), ...siblings]) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const record = readLaunchRecord(dir);
    if (record !== null) records.push(record);
  }
  return records;
}
