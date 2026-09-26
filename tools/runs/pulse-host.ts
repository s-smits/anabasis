/**
 * What `runs pulse` reads from the host at the moment of a look rather than from recorded evidence:
 * the command a run's controller is waiting on, and the readings kept between two looks.
 *
 * A quiet Builder is the question a watcher asks most, and the checkpoint cannot answer it: a
 * checkpoint is written when a tool call returns, so a Builder whose own optimizer runs for twenty
 * minutes and one whose session has stalled read the same. The process table tells them apart. And
 * `--once` used to start from nothing on every call, so a watcher looking every few minutes was
 * told where each run stood and never what had moved; the readings now persist in a file.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { isNumber, isRecord } from "../../src/meta/json-shape.ts";
import { dirname } from "../../src/meta/path.ts";

/** A command a run's controller has been waiting on, outside the model session and itself. */
export interface Busy {
  command: string;
  forMs: number;
}

interface ProcessRow {
  pid: number;
  parent: number;
  forMs: number;
  command: string;
}

/**
 * The controller's own Bun processes and the model CLI are the loop itself, not work it waits on,
 * and a zombie is work that already ended. Only the executable counts: a Builder's
 * `sh -lc .toolchain/bun gen.ts | tail -3` is work, and matching `bun` anywhere left only its `tail`.
 */
const LOOP = /^(\S*\/)?(bun|codex)(\s|$)|claude-agent-sdk|<defunct>/;

/** The Darwin reaper prelude `stageCommandIsolation` wraps a command in, up to the command itself. */
const REAPER = /^\S*sh -c trap 'd\(\)\{.*?' EXIT(?:\\012|\n)\((?:\\012|\n)/s;

/** What one look leaves for the next: the free disk and each watched run's reading. */
export interface PulseMemory<Reading> {
  freeGiB: number | null;
  readings: Record<string, Reading>;
}

/** `ps` elapsed time, `[[dd-]hh:]mm:ss`, in milliseconds. */
export function elapsedMs(etime: string): number {
  const [days, clock] = etime.includes("-") ? etime.split("-", 2) : ["0", etime];
  const [seconds = 0, minutes = 0, hours = 0] = (clock ?? "").split(":").map(Number).toReversed();
  return (((Number(days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

/** Parse `ps -axo pid=,ppid=,etime=,args=`. */
export function parseProcessTable(text: string): ProcessRow[] {
  return text.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (match === null) return [];
    const [, pid = "", parent = "", etime = "", command = ""] = match;
    return [{ pid: Number(pid), parent: Number(parent), forMs: elapsedMs(etime), command }];
  });
}

export async function readProcessTable(): Promise<ProcessRow[]> {
  try {
    const ps = Bun.spawn(["ps", "-axo", "pid=,ppid=,etime=,args="], { stdout: "pipe", stderr: "ignore" });
    return parseProcessTable(await new Response(ps.stdout).text());
  } catch {
    return [];
  }
}

/**
 * The longest-running command under `pid` that is neither Bun nor the model CLI, taken at the top of
 * its own subtree, so a Builder's `sh -lc …` is named rather than the interpreter it started.
 */
export function busyUnder(table: readonly ProcessRow[], pid: number | null): Busy | null {
  if (pid === null) return null;
  const under = new Set([pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of table) {
      if (!under.has(row.pid) && under.has(row.parent)) {
        under.add(row.pid);
        grew = true;
      }
    }
  }
  const work = table.filter((row) => row.pid !== pid && under.has(row.pid) && !LOOP.test(row.command));
  const tops = work.filter((row) => !work.some((other) => other.pid === row.parent));
  const oldest = tops.toSorted((a, b) => b.forMs - a.forMs)[0];
  return oldest === undefined ? null : { command: shown(oldest.command), forMs: oldest.forMs };
}

/** The command as the Builder wrote it: no reaper prelude, and `ps`'s escaped newlines as `⏎`. */
function shown(command: string): string {
  return command
    .replace(REAPER, "")
    .replace(/(?:\\012|\n)\)$/, "")
    .replaceAll(/\\012|\n/g, " ⏎ ");
}

/**
 * A missing, unreadable or foreign file is a first look, which prints status lines and no events.
 * So is one run's reading that `isReading` refuses: a file written by an older pulse, or edited by
 * hand, would otherwise hand the delta reader a baseline it throws on, and keep it for every look.
 */
export function loadMemory<Reading>(
  path: string,
  isReading: (value: unknown) => value is Reading,
): PulseMemory<Reading> {
  try {
    const kept = existsSync(path) ? parseJsonAs<unknown>(readFileSync(path, "utf8")) : null;
    if (isRecord(kept) && isRecord(kept.readings)) {
      const readings = Object.fromEntries(
        Object.entries(kept.readings).flatMap(([runId, reading]) =>
          isReading(reading) ? [[runId, reading] as const] : [],
        ),
      );
      return { freeGiB: isNumber(kept.freeGiB) ? kept.freeGiB : null, readings };
    }
  } catch {
    // Unparseable JSON reads as a first look, like a file of another shape.
  }
  return { freeGiB: null, readings: {} };
}

/** Best effort, after the look was printed: a full disk costs the next look its events, not this one. */
export function saveMemory<Reading>(path: string, memory: PulseMemory<Reading>): string | null {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(memory));
    renameSync(`${path}.tmp`, path);
    return null;
  } catch (error) {
    return `pulse could not keep this look for the next one: ${String(error)}`;
  }
}
