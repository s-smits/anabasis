/**
 * One pass of the readers that name a moment over the logs a look names, for
 * `tools/runs/pulse-readers.ts`, which starts it by this command, since production imports no helper.
 * It calls no paid model, writes no event and decides nothing: each reader's output goes to the host's
 * store, for every observer of the host to read.
 *
 *   bun tools/wri/pass.ts --store <dir> --budget <ms> <log> [<log> ...]
 *
 * A reader runs on a log only where an event of one of its kinds (`at`, `derive.ts`) lies in the
 * bytes past what it last read, found by a scan of those bytes for the kind's text instead of a parse:
 * the largest closed log is 96 MB, which a parse would read at every pass. It takes the logs as given
 * and each log's due readers in the list's order, one reader at a time. A reader whose last run would
 * not fit what is left waits for a later pass, one the limit cuts keeps its last result, and the pass
 * stops where the load leaves no room. A second pass that finds the lock held leaves at once, which is
 * what settles several looks that started one at one moment.
 */
import { closeSync, openSync, readSync, statSync } from "#src/meta/filesystem.ts";
import { resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { endPass, keepReaders, keepResult, resultOf, room, underLock } from "#tools/runs/pulse-readers.ts";
import { READERS, type Reader, readerOutput } from "./derive.ts";

type Ended = Parameters<typeof endPass>[1];

/** One reader on one log that a moment has moved past. */
export interface Due {
  readonly log: string;
  readonly reader: Reader;
  /** How long it last took, 0 where it never ran. */
  readonly ms: number;
}

/** The bytes of `log` from `from` to `to`. */
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

/** What `readers` owe on `logs`: on each log in turn, the readers with a moment past what they read,
 *  in the list's order. The scan starts where the reader that has read least stopped. */
export function dueOf(store: string, logs: readonly string[], readers: readonly Reader[]): Due[] {
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

/** Run `queue` until it is done, the budget is spent or the load leaves no room. */
export async function runQueue(
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

/** Read one log with one reader and keep what it said. A reader its limit cut read nothing, so its
 *  last result stands and only its time moves. */
async function readInto(store: string, repo: string, { log, reader }: Due, timeoutMs: number): Promise<void> {
  const started = performance.now();
  const { size } = statSync(log);
  const { text, ok, cut } = await readerOutput(reader, log, repo, timeoutMs);
  const ms = Math.round(performance.now() - started);
  const kept = resultOf(store, log, reader.name);
  const read = cut ? { size: kept?.size ?? -1, ok: kept?.ok ?? false } : { size, ok };
  keepResult(store, log, reader.name, { ...read, at: Date.now(), ms }, cut ? null : text);
}

/** One pass over `logs`, unless another holds the host. */
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
    const ended = await runQueue(dueOf(store, logs, readers), {
      budgetMs,
      room: roomNow,
      now: () => performance.now(),
      // A spawn takes a whole number of milliseconds and refuses any other.
      read: (due, timeoutMs) => readInto(store, repo, due, Math.ceil(timeoutMs)),
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
