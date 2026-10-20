/**
 * Where the server finds its campaigns, and each log read once a change.
 *
 * A campaign is one log, `.ana/d2/<name>/log.jsonl`. By default the server lists every one in the
 * repository's worktrees, as `bun run runs pulse` does (`runs`, `tools/runs/registry.ts`); started with
 * `--repo <dir>` it lists the ones under that one directory, a fixture's or another checkout's, so
 * that the page can be pointed at either.
 *
 * A seed is left out wherever it lies: a copy of another campaign cut at a recorded position and
 * rehearsed with a script in each seat (`seed.json` beside its log, `bun run runs seed`), which
 * proves a path and no climb (`AGENTS.md`, section 10, item 9). On 19 October 538 of the 633 logs
 * in this repository's worktrees were seeds, most of them the campaign command's own tests
 * (`test-hb-*`), and they buried the 95 real campaigns in the picker. A seed's key opens nothing.
 *
 * The list is polled every few seconds and a host may hold thirty logs of several megabytes, so a
 * log is read and folded again only where its size or its modification time moved since the last
 * read, and the events stay in memory for the detail endpoints (`Log`, `folds.ts`). A log is read
 * whole by the kernel's reader, which refuses a line that is no event; a log whose last line is
 * torn is an append in flight, read without that line by the pulse's reader (`logEvents`), and the
 * answer says so. A log that cannot be read is an issue beside the list, never a row that vanished
 * without a word.
 */
import { LOG_FILE, read } from "../../../../src/kernel/log.ts";
import { sha256 } from "../../../../src/meta/digest.ts";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from "../../../../src/meta/filesystem.ts";
import { basename, join, resolve } from "../../../../src/meta/path.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import { logEvents, processes, type Run, runs, SEED_FILE, writers } from "../../../../tools/runs/registry.ts";
import type { Issue } from "../models.ts";
import { type Reading, Unanswerable } from "./context.ts";
import type { Log } from "./folds.ts";

/** One campaign found: the pulse's `Run`, with the key the page names it by and the label of its
 *  worktree. */
export interface Found extends Run {
  readonly key: string;
  readonly label: string;
}

/** A log as last read: the events, or why they could not be read, and what the reading noticed. */
interface Loaded {
  readonly log: Log | null;
  readonly issues: readonly Issue[];
}

/** Whether a run's process is there, as the pulse names the two states. */
export type Process = "open" | "closed";

/** The campaigns one listing found, and what it could not list. */
interface Listed {
  readonly runs: readonly Run[];
  readonly issues: readonly Issue[];
}

/** The campaigns found under one root, and when. */
interface Looked {
  readonly at: number;
  readonly where: string;
  readonly found: readonly Found[];
  readonly issues: readonly Issue[];
}

/** The processes that write logs, and when they were listed; null where they could not be. */
interface Scanned {
  readonly at: number;
  readonly running: ReturnType<typeof processes> | null;
}

/** A campaign a key named, its log as read, and what the reading noticed. */
interface Opened {
  readonly found: Found;
  readonly log: Log;
  readonly issues: readonly Issue[];
}

/** What a log was read at, so that an unchanged one is not read again. */
interface Kept {
  readonly size: number;
  readonly mtimeMs: number;
  readonly loaded: Loaded;
}

/** The campaigns found and the processes that write logs, kept this long: the list is polled every
 *  few seconds, and a listing runs `git worktree list`, `ps` and `lsof`. */
const LOOK_MS = 2_000;
const NEWLINE = 0x0a;

const kept = new Map<string, Kept>();
let looked: Looked | null = null;
let scanned: Scanned | null = null;

/** Where a log is said to be in an issue: its worktree's label and its path inside it. */
export const sourceOf = ({ label, name }: Pick<Found, "label" | "name">): string =>
  `${label}/.ana/d2/${name}/${LOG_FILE}`;

/** The campaigns under one directory, as `runs` lists those of each worktree. */
function underDirectory(tree: string): Listed {
  const d2 = join(tree, ".ana", "d2");
  if (!existsSync(d2)) {
    return {
      runs: [],
      issues: [{ level: "warning", source: d2, message: "no .ana/d2 folder here, so no campaign" }],
    };
  }
  try {
    const found = readdirSync(d2).flatMap((name): Run[] => {
      const path = join(d2, name, LOG_FILE);
      return existsSync(path)
        ? [{ name, tree, path, end: "comparison.reported", seed: existsSync(join(d2, name, SEED_FILE)) }]
        : [];
    });
    return { runs: found, issues: [] };
  } catch (error) {
    return { runs: [], issues: [{ level: "error", source: d2, message: errorMessage(error) }] };
  }
}

/** Every campaign's log the repository's worktrees hold. The pulse lists the worktrees of the
 *  repository the server runs in, which is the one it was started for unless it was moved. */
function inWorktrees(repo: string): Listed {
  try {
    const listed = runs().filter((run) => run.end === "comparison.reported");
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

/** The key of each run: its worktree's folder name and its own, with a short hash of the
 *  worktree's path where two worktrees share a folder name. */
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

/** Every campaign the server can read, and what could not be listed. */
export function campaignsFound(reading: Pick<Reading, "repo" | "trees">): Looked {
  const where = `${reading.trees} ${reading.repo}`;
  const now = Date.now();
  if (looked?.where === where && now - looked.at < LOOK_MS) return looked;
  const listed = reading.trees === "directory" ? underDirectory(reading.repo) : inWorktrees(reading.repo);
  const found = keyed(listed.runs.filter((run) => run.seed !== true));
  looked = { at: now, where, found, issues: listed.issues };
  return looked;
}

/** Whether a process writes `found`'s log (`writers`): `open` while one does, as the pulse says it,
 *  and null where the processes could not be listed. */
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

/** Whether the file at `path`, of `size` bytes, ends inside a line. */
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

/** `found`'s log as it stands, read again only where its size or its time moved. */
export function loaded(found: Found): Loaded {
  const source = sourceOf(found);
  let size: number;
  let mtimeMs: number;
  try {
    ({ size, mtimeMs } = statSync(found.path));
  } catch (error) {
    return { log: null, issues: [{ level: "error", source, message: errorMessage(error) }] };
  }
  const was = kept.get(found.path);
  if (was?.size === size && was.mtimeMs === mtimeMs) return was.loaded;
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
  kept.set(found.path, { size, mtimeMs, loaded: fresh });
  return fresh;
}

/** The campaign `key` names and its log, or a 404 where none does; a log that cannot be read is
 *  refused with what was wrong. */
export function campaignAt(reading: Reading, key: string): Opened {
  const found = campaignsFound(reading).found.find((each) => each.key === key);
  if (found === undefined) throw new Unanswerable(404, `no campaign ${key} here`);
  const { log, issues } = loaded(found);
  if (log === null) {
    throw new Error(`${sourceOf(found)} cannot be read: ${issues.map(({ message }) => message).join("; ")}`);
  }
  return { found, log, issues };
}
