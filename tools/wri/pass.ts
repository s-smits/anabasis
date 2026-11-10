/**
 * One pass of the deterministic readers over the logs a look names, for `tools/runs/pulse-readers.ts`,
 * which starts it by this command, since production imports no helper. It calls no paid model, writes
 * no event and decides nothing: each reader's output goes to the host's store, for every observer of
 * the host to read.
 *
 *   bun tools/wri/pass.ts --store <dir> --budget <ms> [--no-embed] <log> [<log> ...]
 *
 * It runs one reader at a time: the rows of each log first, up to half its budget, and then whichever
 * result is oldest, so logs that take more than one pass come round and none starves. A reader whose
 * last run would not fit what is left waits for a later pass, one the limit cuts keeps its last
 * result, and the pass stops where the load leaves no room. A reader that goes on from what a cut left
 * (`embeds`) takes any time that is left: a cut records the time it had, about the whole budget, which
 * would never fit again, and a first read's time says nothing of the reads after it. A second pass that
 * finds the lock held leaves at once, which is what settles several looks that started one at one moment.
 */
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { statSync } from "#src/meta/filesystem.ts";
import { resolve } from "#src/meta/path.ts";
import {
  dropLock,
  endPass,
  keepNames,
  keepResult,
  type PassEnding,
  resultOf,
  room,
  takeLock,
} from "#tools/runs/pulse-readers.ts";
import { READERS, type Reader, readerOutput, readersOf } from "./derive.ts";

/** The reader whose triggers the look says itself. */
const HEAD = "rows";

/** One reader on one log that the log has moved past. */
export interface Due {
  readonly log: string;
  readonly reader: Reader;
  /** When it last ran and how long that took, 0 where it never has. */
  readonly at: number;
  readonly ms: number;
}

/** What `readers` owe on `logs`, the most valuable first: the head reader of each log, then the
 *  oldest result, and among those never read the order of `readers`. */
export function queueOf(store: string, logs: readonly string[], readers: readonly Reader[]): Due[] {
  const due = logs.flatMap((log) => {
    const { size } = statSync(log);
    return readers.flatMap((reader, rank) => {
      const kept = resultOf(store, log, reader.name);
      if (kept?.size === size) return [];
      return [
        { log, reader, rank, at: kept?.at ?? 0, ms: kept?.ms ?? 0, head: reader.name === HEAD ? 0 : 1 },
      ];
    });
  });
  return due.toSorted((one, other) => one.head - other.head || one.at - other.at || one.rank - other.rank);
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
): Promise<PassEnding["ended"]> {
  const started = ways.now();
  let ended: PassEnding["ended"] = "finished";
  for (const due of queue) {
    const spent = ways.now() - started;
    if (spent >= ways.budgetMs) return "budget";
    const left = ways.budgetMs - spent;
    const fits = due.reader.embeds === true || due.ms <= left;
    if (!fits || (due.reader.name === HEAD && spent >= ways.budgetMs / 2)) {
      ended = "budget";
      continue;
    }
    if (!ways.room()) return "load";
    await ways.read(due, left);
  }
  return ended;
}

/** Read one log with one reader and keep what it said. A reader its limit cut read nothing, so its
 *  last result stands and only its turn moves: it goes to the back of the queue. */
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
  if (!takeLock(store)) return;
  const repo = resolve(import.meta.dir, "..", "..");
  try {
    keepNames(
      store,
      readers.map(({ name }) => name),
    );
    const ended = await runQueue(queueOf(store, logs, readers), {
      budgetMs,
      room: roomNow,
      now: () => performance.now(),
      // A spawn takes a whole number of milliseconds and refuses any other.
      read: (due, timeoutMs) => readInto(store, repo, due, Math.ceil(timeoutMs)),
    });
    endPass(store, ended);
  } finally {
    dropLock(store);
  }
}

async function main(): Promise<void> {
  const { values, positionals: logs } = parseArgs({
    args: runtimeProcess.argv.slice(2),
    allowPositionals: true,
    options: {
      store: { type: "string" },
      budget: { type: "string" },
      "no-embed": { type: "boolean", default: false },
    },
  });
  const store = values.store ?? "";
  if (store === "" || values.budget === undefined) throw new Error("name --store and --budget");
  await passOver(store, logs, {
    budgetMs: Number(values.budget),
    readers: readersOf(values),
  });
}

if (import.meta.main) await main();
