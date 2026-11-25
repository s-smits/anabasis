/**
 * Where the server finds its campaigns, and each log read once a change. By default it lists every
 * `.ana/d2/<name>/log.jsonl` in the repository's worktrees, as `bun run runs pulse` does (`runs`,
 * `tools/runs/registry.ts`); with `--repo <dir>`, those under that directory. A seed (`seed.json`
 * beside its log) is left out wherever it lies: it proves a path and no climb, and the campaign
 * command's own tests leave many. A log is read and folded again only where its size or
 * modification time moved (`stampOf`); the list keeps row facts alone (`campaigns.ts`), and only
 * the `KEEP` logs a detail endpoint read last keep their events, since keeping every log's events
 * would hold gigabytes. A log whose last line is torn is an append in flight, read without that
 * line (`logEvents`), and the answer says so; a log that cannot be read is an issue beside the
 * list.
 */
import { LOG_FILE, read } from "../../../../src/kernel/log.ts";
import { sha256 } from "../../../../src/meta/digest.ts";
import { closeSync, existsSync, openSync, readSync, statSync } from "../../../../src/meta/filesystem.ts";
import { basename, join, resolve } from "../../../../src/meta/path.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import {
  CAMPAIGNS,
  campaignsIn,
  isCampaign,
  logEvents,
  processes,
  type Run,
  readable,
  writers,
} from "../../../../tools/runs/registry.ts";
import type { Issue } from "../models.ts";
import { type Reading, Unanswerable } from "./context.ts";
import type { Log } from "./folds.ts";

export interface Found extends Run {
  readonly key: string;
  readonly label: string;
}

interface Loaded {
  readonly log: Log | null;
  readonly issues: readonly Issue[];
}

export type Process = "open" | "closed";

interface Listed {
  readonly runs: readonly Run[];
  readonly issues: readonly Issue[];
}

interface Looked {
  readonly at: number;
  readonly where: string;
  readonly found: readonly Found[];
  readonly issues: readonly Issue[];
}

interface Scanned {
  readonly at: number;
  readonly running: ReturnType<typeof processes> | null;
}

interface Opened {
  readonly found: Found;
  readonly log: Log;
  readonly issues: readonly Issue[];
}

interface Kept {
  readonly size: number;
  readonly mtimeMs: number;
  readonly loaded: Loaded;
}

/** The campaigns found and the processes that write logs, kept this long: a listing runs `git
 *  worktree list`, `ps` and `lsof`. */
const LOOK_MS = 2000;
const NEWLINE = 0x0a;
/** The logs whose events are kept: the page polls the one selected, and a few more cover a switch back. */
const KEEP = 4;

const kept = new Map<string, Kept>();
let looked: Looked | null = null;
let scanned: Scanned | null = null;

export const sourceOf = ({ label, name }: Pick<Found, "label" | "name">): string =>
  `${label}/${CAMPAIGNS}/${name}/${LOG_FILE}`;

function underDirectory(tree: string): Listed {
  const d2 = join(tree, CAMPAIGNS);
  if (!existsSync(d2)) {
    return {
      runs: [],
      issues: [{ level: "warning", source: d2, message: "no .ana/d2 folder here, so no campaign" }],
    };
  }
  try {
    return { runs: campaignsIn(d2, tree), issues: [] };
  } catch (error) {
    return { runs: [], issues: [{ level: "error", source: d2, message: errorMessage(error) }] };
  }
}

function inWorktrees(repo: string): Listed {
  try {
    const listed = readable().filter(isCampaign);
    const trees = new Set(listed.map((run) => resolve(run.tree)));
    const issues: Issue[] =
      listed.length > 0 && !trees.has(resolve(repo))
        ? [
            {
              level: "warning",
              source: repo,
              message: "the worktrees listed are not this repository's: the server runs in another checkout",
            },
          ]
        : [];
    return { runs: listed, issues };
  } catch (error) {
    return {
      runs: [],
      issues: [
        {
          level: "error",
          source: repo,
          message: `the worktrees could not be listed: ${errorMessage(error)}`,
        },
      ],
    };
  }
}

/** Each run's key: its worktree's folder name and its own, with a short hash of the worktree's path
 *  where two worktrees share a folder name. */
function keyed(found: readonly Run[]): Found[] {
  const labels = new Map<string, Set<string>>();
  for (const { tree } of found) {
    labels.set(basename(tree), (labels.get(basename(tree)) ?? new Set()).add(tree));
  }
  return found.map((run) => {
    const plain = basename(run.tree);
    const label = (labels.get(plain)?.size ?? 0) > 1 ? `${plain}-${sha256(run.tree).slice(0, 6)}` : plain;
    return { ...run, key: `${label}/${run.name}`, label };
  });
}

export function campaignsFound(reading: Pick<Reading, "repo" | "trees" | "now">): Looked {
  const where = `${reading.trees} ${reading.repo}`;
  const now = (reading.now ?? Date.now)();
  if (looked?.where === where && now - looked.at < LOOK_MS) return looked;
  const listed = reading.trees === "directory" ? underDirectory(reading.repo) : inWorktrees(reading.repo);
  const found = keyed(listed.runs.filter((run) => run.seed !== true));
  looked = { at: now, where, found, issues: listed.issues };
  return looked;
}

/** Whether a process writes `found`'s log (`writers`): `open` while one does, and null where the
 *  processes could not be listed. */
export function writing(found: Found): Process | null {
  const now = Date.now();
  if (scanned === null || now - scanned.at >= LOOK_MS) {
    let running: ReturnType<typeof processes> | null;
    try {
      running = processes();
    } catch {
      // Without `ps` or `lsof` no run reads as running; the list says so once (`campaigns.ts`).
      running = null;
    }
    scanned = { at: now, running };
  }
  if (scanned.running === null) return null;
  return writers(found, scanned.running).length > 0 ? "open" : "closed";
}

function torn(path: string, size: number): boolean {
  if (size === 0) return false;
  const fd = openSync(path, "r");
  try {
    const last = Buffer.alloc(1);
    return readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== NEWLINE;
  } finally {
    closeSync(fd);
  }
}

export function stampOf(found: Found): string | null {
  try {
    const { size, mtimeMs } = statSync(found.path);
    return `${String(size)}:${String(mtimeMs)}`;
  } catch {
    return null;
  }
}

/** `found`'s log, read again only where its size or time moved, and kept among the `KEEP` read last
 *  for a detail endpoint, never for the list alone. */
export function loaded(found: Found, use: "detail" | "list" = "detail"): Loaded {
  const source = sourceOf(found);
  let size: number;
  let mtimeMs: number;
  try {
    ({ size, mtimeMs } = statSync(found.path));
  } catch (error) {
    return { log: null, issues: [{ level: "error", source, message: errorMessage(error) }] };
  }
  const was = kept.get(found.path);
  if (was?.size === size && was.mtimeMs === mtimeMs) {
    if (use === "detail") {
      kept.delete(found.path);
      kept.set(found.path, was);
    }
    return was.loaded;
  }
  let fresh: Loaded;
  try {
    fresh = torn(found.path, size)
      ? {
          log: { events: logEvents(found.path) },
          issues: [
            {
              level: "warning",
              source,
              message:
                "the last line is torn: an append in flight, or one a crash cut. It is read without that line",
            },
          ],
        }
      : { log: { events: read(found.path) }, issues: [] };
  } catch (error) {
    fresh = { log: null, issues: [{ level: "error", source, message: errorMessage(error) }] };
  }
  kept.delete(found.path);
  if (use === "detail") kept.set(found.path, { size, mtimeMs, loaded: fresh });
  for (const path of [...kept.keys()].slice(0, Math.max(0, kept.size - KEEP))) kept.delete(path);
  return fresh;
}

export function campaignAt(reading: Reading, key: string): Opened {
  const found = campaignsFound(reading).found.find((each) => each.key === key);
  if (found === undefined) throw new Unanswerable(404, `no campaign ${key} here`);
  const { log, issues } = loaded(found);
  if (log === null) {
    throw new Error(`${sourceOf(found)} cannot be read: ${issues.map(({ message }) => message).join("; ")}`);
  }
  return { found, log, issues };
}
