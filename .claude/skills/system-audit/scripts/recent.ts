#!/usr/bin/env bun
/**
 * The recent real campaigns a system audit reads, each as a fixed snapshot: its log's path, how many
 * whole events it held when read, its last event, the hash of those lines and the commits its
 * launches ran. It reads: it writes nothing of a campaign's and calls no model.
 *
 *   bun .claude/skills/system-audit/scripts/recent.ts [--limit 12] [--min-events 50] [--json]
 *
 * The campaigns are the registry's `readable` set, the worktrees' and one archived copy of each name,
 * so a host's copy that `runs fetch` or the gather job keeps is read once. Seeds, rehearsals and live
 * seats are left out: a seed carries `seed.json`, and a log that does not open with
 * `campaign.opened` is no campaign's, and one under `--min-events` ended before it did any work (a
 * refused login or provider leaves about 14). Newest last event first: a file's time is no guide,
 * since the gather job and `retire` rewrite an archive copy whose campaign ended days before. The
 * order reads each log's tail only, as 176 logs hold 1.7 GB.
 *
 * On 29 October two audit batches each wrote this inventory by hand: 213 candidates with copies of
 * one campaign under several paths, and a note telling every session to deduplicate them and to
 * record each log's event count, last time and hash itself, because live logs grow while they are
 * read. This prints those identities once, so every session cites the same snapshot.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { sha256 } from "#src/meta/digest.ts";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { compareCodeUnits } from "#src/meta/stable-json.ts";
import { receipts } from "#tools/runs/receipt.ts";
import { isCampaign, readable, wholeLines } from "#tools/runs/registry.ts";

const USAGE = `usage:
  bun .claude/skills/system-audit/scripts/recent.ts [--limit 12] [--min-events 50] [--json]`;

const LIMIT = 12;
const MIN_EVENTS = 50;
/** Enough of a log's end to hold its last whole event; a longer one is read whole. */
const TAIL = 1 << 16;

interface Snapshot {
  readonly name: string;
  /** `here` for a worktree's campaign, else the archive folder it was read from. */
  readonly from: string;
  readonly path: string;
  readonly events: number;
  readonly lastAt: string;
  readonly lastKind: string;
  /** sha256 of the whole lines read, the identity a report cites beside `events`. */
  readonly sha256: string;
  /** The commits its launches ran, oldest first, each once. */
  readonly commits: readonly string[];
}

/** When the last whole event of the log at `path` was appended, read from its tail, or from the
 *  whole log where one event is longer than the tail. */
export function lastAt(path: string): string {
  const fd = openSync(path, "r");
  try {
    const start = Math.max(0, fstatSync(fd).size - TAIL);
    const buffer = Buffer.alloc(TAIL);
    const tail = buffer.subarray(0, readSync(fd, buffer, 0, TAIL, start)).toString("utf8");
    const lines = (start > 0 && tail.split("\n").length > 2 ? tail : wholeLines(path)).split("\n");
    const last = lines.at(-2);
    return last === undefined || last === "" ? "" : parseJsonAs<LogEvent>(last).at;
  } finally {
    closeSync(fd);
  }
}

export function snapshotOf(name: string, from: string, path: string, least: number): Snapshot | null {
  const text = wholeLines(path);
  const lines = text.split("\n").slice(0, -1);
  const [first] = lines;
  const last = lines.at(-1);
  if (first === undefined || last === undefined || lines.length < least) return null;
  if (parseJsonAs<LogEvent>(first).kind !== "campaign.opened") return null;
  const { at, kind } = parseJsonAs<LogEvent>(last);
  const commits = [...new Set(receipts(path).map(({ commit }) => commit))];
  return {
    name,
    from,
    path,
    events: lines.length,
    lastAt: at,
    lastKind: kind,
    sha256: sha256(text),
    commits,
  };
}

function main(args: CommandArgs): void {
  const limit = args.int("limit") ?? LIMIT;
  const least = args.int("min-events") ?? MIN_EVENTS;
  const candidates = readable()
    .filter((run) => isCampaign(run) && run.seed !== true && existsSync(run.path))
    .map((run) => ({ run, at: lastAt(run.path) }))
    .toSorted((one, other) => compareCodeUnits(other.at, one.at));
  const snapshots: Snapshot[] = [];
  for (const { run } of candidates) {
    if (snapshots.length >= limit) break;
    const snapshot = snapshotOf(run.name, run.archived ?? "here", run.path, least);
    if (snapshot !== null) snapshots.push(snapshot);
  }
  if (args.flag("json")) {
    console.log(capturedJsonStringify(snapshots, null, 2));
    return;
  }
  for (const { name, from, path, events, lastAt: last, lastKind, sha256: hash, commits } of snapshots) {
    const ran = commits.map((commit) => commit.slice(0, 9)).join(",") || "no receipt";
    console.log(
      `${name}  ${from}  ${events} events to ${last} (${lastKind})  sha256 ${hash.slice(0, 12)}  ran ${ran}`,
    );
    console.log(`  ${path}`);
  }
}

if (import.meta.main) {
  await runCommand(
    { name: "recent", usage: USAGE, options: { limit: "int", "min-events": "int", json: "flag" } },
    main,
  );
}
