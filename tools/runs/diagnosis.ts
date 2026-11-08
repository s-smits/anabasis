/** A run's life and bounded stderr, shared by the run state (`state.ts`), view, pulse and remote
 *  record snapshots. */
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { boundText } from "#src/meta/bounded-text.ts";
import { HERE, keepers, type Run, type Running, writers } from "./registry.ts";

interface Observation {
  readonly open: boolean;
  readonly stderr: string | null;
}
const OBSERVATION = "observation.json";

/** Whether a process writes a run's log, and whether a `runs keep` would start one again: a peer's
 *  by its last fetch, which sees no keeper, and this machine's by the processes in `running`. */
export interface Life {
  readonly writing: boolean;
  readonly kept: boolean;
}

/** Read only the tail of the newest regular launch stderr, never a link or a whole growing file. */
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

/** Publish observation metadata with a new inode, preserving any previous hardlinked snapshot. */
export async function keepObservation(folder: string, observation: Observation): Promise<void> {
  const temporary = join(folder, `${OBSERVATION}.tmp`);
  await Bun.write(temporary, capturedJsonStringify(observation));
  renameSync(temporary, join(folder, OBSERVATION));
}

/** What the last fetch of a peer's campaign saw there, or null for this machine's own: a snapshot
 *  carries remote liveness, and local pids never decide whether a remote campaign lives. */
export function observationOf(run: Run): Observation | null {
  const stored = join(dirname(run.path), OBSERVATION);
  const remote = run.archived !== undefined && run.archived !== HERE;
  return remote && existsSync(stored) ? parseJsonAs<Observation>(readFileSync(stored, "utf8")) : null;
}

/** Where `run` writes and is kept from, among the processes `running`. */
export function lifeOf(run: Run, running: readonly Running[]): Life {
  const seen = observationOf(run)?.open;
  return seen === undefined
    ? { writing: writers(run, running).length > 0, kept: keepers(run.name, running).length > 0 }
    : { writing: seen, kept: false };
}

/** Whether `run` may still write its log. It is the one reading of a run's life that capacity,
 *  retire, copy and the investigations share. */
export const stillRunning = (run: Run, running: readonly Running[]): boolean => {
  const { writing, kept } = lifeOf(run, running);
  return writing || kept;
};
