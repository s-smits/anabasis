/** Process-liveness inspection and bounded stderr tailing shared by `state.ts`, `view`, `pulse`,
 *  and remote record snapshots. */
import { existsSync, lstatSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { boundText } from "#src/meta/bounded-text.ts";
import { remember } from "./pulse-readers.ts";
import { HERE, keepers, type Run, type Running, writers } from "./registry.ts";

interface Observation {
  readonly open: boolean;
  /** Whether a keeper was attached on the remote host; omitted in observations written by older checkouts. */
  readonly kept?: boolean;
  readonly stderr: string | null;
  /** Log byte length when the last `"whole"` snapshot completed; used to skip unchanged closed runs. */
  readonly wholeBytes?: number;
}
const OBSERVATION = "observation.json";

/** Liveness of a run: whether a writer process is active and whether a `runs keep` supervisor is
 *  attached. Derived from the latest fetched observation for remote snapshots and from `running`
 *  for local runs. */
export interface Life {
  readonly writing: boolean;
  readonly kept: boolean;
}

/** Reads only the bounded tail of the most recent regular `launch-*.err` file, ignoring symlinks
 *  and avoiding reading an entire growing log into memory. */
export async function stderrTail(log: string): Promise<string | null> {
  const folder = dirname(log);
  const newest = readdirSync(folder)
    .filter((file) => /^launch-.*\.err$/.test(file))
    .map((file) => ({ path: join(folder, file), stat: lstatSync(join(folder, file)) }))
    .filter((file) => file.stat.isFile())
    .toSorted((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
  if (newest === undefined) return null;
  const tail = await Bun.file(newest.path)
    .slice(Math.max(0, newest.stat.size - 8192), newest.stat.size)
    .text();
  return boundText(tail, 2048, "tail", 20).shown;
}

/** Atomically writes observation metadata to a new inode, preserving any earlier hardlinked snapshot. */
export const keepObservation = (folder: string, observation: Observation) =>
  remember(join(folder, OBSERVATION), capturedJsonStringify(observation));

/** Reads the cached observation metadata inside `folder`, or null if absent. */
export function observationAt(folder: string): Observation | null {
  const stored = join(folder, OBSERVATION);
  return existsSync(stored) ? parseJsonAs<Observation>(readFileSync(stored, "utf8")) : null;
}

/** Reads the cached remote liveness observation for a fetched peer campaign, or returns null for
 *  local runs so local PIDs are never confused with remote liveness. */
export function observationOf(run: Run): Observation | null {
  const remote = run.archived !== undefined && run.archived !== HERE;
  return remote ? observationAt(dirname(run.path)) : null;
}

/** Determines whether `run` currently has a live writer or keeper process. */
export function lifeOf(run: Run, running: readonly Running[]): Life {
  const seen = observationOf(run);
  return seen === null
    ? { writing: writers(run, running).length > 0, kept: keepers(run.name, running).length > 0 }
    : { writing: seen.open, kept: seen.kept === true };
}

/** Returns true if `run` may still append to its log. Shared authoritative liveness predicate used
 *  by capacity checks, `retire`, `copy`, and investigations. */
export const stillRunning = (run: Run, running: readonly Running[]): boolean => {
  const { writing, kept } = lifeOf(run, running);
  return writing || kept;
};
