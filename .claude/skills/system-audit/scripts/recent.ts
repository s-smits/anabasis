#!/usr/bin/env bun
/**
 * The recent real campaigns a system audit reads, each as a fixed snapshot: its log's path, its
 * whole events when read, its last event, the hash of those lines and the commits its launches ran.
 * It writes nothing and calls no model: `recent.ts [--limit 12] [--min-events 50] [--json]`.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { lastAt } from "#skills/main/logs.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { sha256 } from "#src/meta/digest.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { compareCodeUnits } from "#src/meta/stable-json.ts";
import { receipts } from "#tools/runs/receipt.ts";
import { isCampaign, readable, wholeLines } from "#tools/runs/registry.ts";

const USAGE = `usage:
  bun .claude/skills/system-audit/scripts/recent.ts [--limit 12] [--min-events 50] [--json]`;

const LIMIT = 12;
const MIN_EVENTS = 50;

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
