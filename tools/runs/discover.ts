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
import { controllerEvidenceDir } from "../../src/run/controller-lineage.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "../../src/meta/filesystem.ts";
import { dirname, join } from "../../src/meta/path.ts";
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

/** Every run the campaign tree recorded an opening for, in no particular order. */
export function recordedRuns(repoRoot: string): RunLocation[] {
  const root = campaignRoot(repoRoot);
  if (!isDirectory(root)) return [];
  const runs: RunLocation[] = [];
  for (const slug of readdirSync(root)) {
    const campaignDir = join(root, slug);
    const controller = join(campaignDir, "controller");
    if (!isDirectory(controller)) continue;
    for (const runId of readdirSync(controller)) {
      const dir = controllerEvidenceDir(campaignDir, runId);
      const openingPath = join(dir, "opening.json");
      if (!existsSync(openingPath)) continue;
      runs.push({ runId, slug, campaignDir, openingPath, terminalPath: join(dir, "terminal.json") });
    }
  }
  return runs;
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

function worktreeDirs(repoRoot: string): string[] {
  const result = runSync(["git", "worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.exitCode !== 0) return [];
  const dirs: string[] = [];
  for (const line of decodeOutput(result.stdout).split("\n")) {
    if (line.startsWith("worktree ")) dirs.push(line.slice("worktree ".length));
  }
  return dirs;
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
  for (const dir of [...worktreeDirs(repoRoot), ...siblings]) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const record = readLaunchRecord(dir);
    if (record !== null) records.push(record);
  }
  return records;
}
