/**
 * The one lock of the run CLI: a link whose target names the process holding it, by pid, host and
 * start time. It is held while that process lives, however long it holds, and taken over once the
 * process is gone or its pid names a later process. The record is written once, as a link, so a
 * reader at any instant reads it whole or not at all. The pulse's pass and a fetch of one copy each
 * take one (`pulse-readers.ts`, `snapshots.ts`), and a controller's preparation follows the rule in
 * shell (`code.ts`).
 *
 * Only processes of the host that keeps the folder take these locks, so a record that names another
 * host came with a copied folder and holds nothing. A process that holds a lock is refused it again
 * like any other taker: the pass takes its one lock once, and a fetch waits by polling, so a second
 * refresh of one copy in the process waits for the first to release it.
 *
 * Until 9 November each lock was hand-rolled: the pass's lapsed two `PASS_MS` after it was taken
 * whether or not the pass still ran, so a pass slower than a minute lost it to a second pass; a
 * preparation's lapsed after five minutes though a cold install could take longer; and a fetch's
 * left its stage behind when it was killed. Taking a lock over is the one step two processes could
 * race at, so it runs under a `flock` of the folder, which closes with the process.
 */
import {
  closeSync,
  lockExclusiveSync,
  openSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "#src/meta/filesystem.ts";
import { hostname } from "#src/meta/os.ts";
import { dirname } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";

/** The record the process `pid` of this host would hold a lock by, `<pid> <host> <start>`, or ""
 *  where none has that pid. `ps` is named by its full path, since the host fakes put their own first
 *  on the path. */
function recordOf(pid: number): string {
  const start = decodeOutput(runSync(["/bin/ps", "-o", "lstart=", "-p", String(pid)]).stdout).trim();
  return start === "" ? "" : `${String(pid)} ${hostname()} ${start}`;
}

/** The record `file` holds, or "" where it is no link. */
function recordIn(file: string): string {
  try {
    return readlinkSync(file);
  } catch {
    return "";
  }
}

/** Whether a live process holds `file`: the one its record names, still with that start. */
export function held(file: string): boolean {
  const record = recordIn(file);
  return record !== "" && record === recordOf(Number.parseInt(record, 10));
}

/** Take `file`, in a folder that exists, for this process where no live process holds it, and say
 *  whether it did. */
export function hold(file: string): boolean {
  const guard = openSync(dirname(file), "r");
  try {
    lockExclusiveSync(guard);
    if (held(file)) return false;
    rmSync(file, { force: true });
    symlinkSync(recordOf(runtimeProcess.pid), file);
    return true;
  } finally {
    closeSync(guard);
  }
}

/** Give `file` up, where this process holds it. */
export function release(file: string): void {
  if (Number.parseInt(recordIn(file), 10) === runtimeProcess.pid) rmSync(file, { force: true });
}
