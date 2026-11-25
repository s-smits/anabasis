/**
 * Incremental background runner for event-triggered readers, started by
 * `tools/runs/pulse-readers.ts`. It calls no model, writes no log event and decides nothing:
 *
 *   bun tools/wri/pass.ts --store <dir> --budget <ms> <log> [<log> ...]
 *
 * It scans only the bytes appended since the least-advanced reader's offset for the kinds readers
 * wait on (`at`, `derive.ts`), so a large closed log is not parsed for nothing, and runs due readers
 * in turn within `--budget` while the load leaves room. Another pass holding the lock ends it at once.
 */
import { closeSync, openSync, readSync, statSync } from "#src/meta/filesystem.ts";
import { resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { endPass, keepReaders, keepResult, resultOf, room, underLock } from "#tools/runs/pulse-readers.ts";
import { READERS, type Reader, readerOutput, type Source, sourceOf } from "./derive.ts";

type Ended = Parameters<typeof endPass>[1];

interface Due {
  readonly log: string;
  readonly reader: Reader;
  readonly ms: number;
}

function bytesOf(log: string, from: number, to: number): Buffer {
  const bytes = Buffer.alloc(Math.max(0, to - from));
  const handle = openSync(log, "r");
  try {
    readSync(handle, bytes, 0, bytes.length, from);
  } finally {
    closeSync(handle);
  }
  return bytes;
}

function dueOf(store: string, logs: readonly string[], readers: readonly Reader[]): Due[] {
  const timed = readers.filter(({ at }) => at !== undefined);
  return logs.flatMap((log) => {
    const read = timed.map((reader) => ({ reader, kept: resultOf(store, log, reader.name) }));
    const from = Math.max(0, Math.min(...read.map(({ kept }) => kept?.size ?? 0)));
    const { size } = statSync(log);
    if (read.length === 0 || from >= size) return [];
    const bytes = bytesOf(log, from, size);
    const last = new Map<string, number>();
    const lastOf = (kind: string) => {
      if (!last.has(kind)) last.set(kind, bytes.lastIndexOf(`"kind":"${kind}"`));
      return last.get(kind) ?? -1;
    };
    return read.flatMap(({ reader, kept }) => {
      const past = Math.max(0, kept?.size ?? 0);
      const due = reader.at?.some((kind) => lastOf(kind) >= 0 && from + lastOf(kind) >= past) === true;
      return due ? [{ log, reader, ms: kept?.ms ?? 0 }] : [];
    });
  });
}

async function runQueue(
  queue: readonly Due[],
  ways: {
    readonly budgetMs: number;
    readonly room: () => boolean;
    readonly now: () => number;
    readonly read: (due: Due, timeoutMs: number) => Promise<void>;
  },
): Promise<Ended> {
  const started = ways.now();
  let ended: Ended = "finished";
  for (const due of queue) {
    const spent = ways.now() - started;
    if (spent >= ways.budgetMs) return "budget";
    const left = ways.budgetMs - spent;
    if (due.ms > left) {
      ended = "budget";
      continue;
    }
    if (!ways.room()) return "load";
    await ways.read(due, left);
  }
  return ended;
}

/** A reader its limit cut read nothing, so its last result stands and only its time moves. */
async function readInto(store: string, source: Source, reader: Reader, timeoutMs: number): Promise<void> {
  const { log } = source;
  const started = performance.now();
  const { text, ok, cut, size } = await readerOutput(reader, source, timeoutMs);
  const ms = Math.round(performance.now() - started);
  const kept = resultOf(store, log, reader.name);
  const read = cut ? { size: kept?.size ?? -1, ok: kept?.ok ?? false } : { size, ok };
  keepResult(store, log, reader.name, { ...read, at: Date.now(), ms }, cut ? null : text);
}

export async function passOver(
  store: string,
  logs: readonly string[],
  {
    budgetMs,
    roomNow = room,
    readers = READERS,
  }: {
    readonly budgetMs: number;
    readonly roomNow?: () => boolean;
    readonly readers?: readonly Reader[];
  },
): Promise<void> {
  const repo = resolve(import.meta.dir, "..", "..");
  await underLock(store, async () => {
    keepReaders(store, readers);
    const sources = new Map(logs.map((log) => [log, sourceOf(log, repo)]));
    const ended = await runQueue(dueOf(store, logs, readers), {
      budgetMs,
      room: roomNow,
      now: () => performance.now(),
      // A spawn takes a whole number of milliseconds and refuses any other.
      read: ({ log, reader }, timeoutMs) =>
        readInto(store, sources.get(log) ?? sourceOf(log, repo), reader, Math.ceil(timeoutMs)),
    });
    endPass(store, ended);
  });
}

async function main(): Promise<void> {
  const { values, positionals: logs } = parseArgs({
    args: runtimeProcess.argv.slice(2),
    allowPositionals: true,
    options: { store: { type: "string" }, budget: { type: "string" } },
  });
  const store = values.store ?? "";
  if (store === "" || values.budget === undefined) throw new Error("name --store and --budget");
  await passOver(store, logs, { budgetMs: Number(values.budget) });
}

if (import.meta.main) await main();
