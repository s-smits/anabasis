/**
 * The one record of who holds what on this host: a link whose target names the process holding it,
 * by pid, host and start time. The run CLI's locks are such links, and so is the claim on a seat's
 * root or a folder of the host's scratch (`src/wall/seat-root.ts`), which says whose it is once its
 * claimant is gone. It is held while that process lives, however long it holds, and taken over once the
 * process is gone or its pid names a later process. The record is written once, as a link, so a
 * reader at any instant reads it whole or not at all. The pulse's pass and a fetch of one copy each
 * take one (`pulse-readers.ts`, `snapshots.ts`), and a controller's preparation follows the rule in
 * shell (`code.ts`). A landing holds its clone the same way (`holdAlone`, `landing.ts`), with a note
 * after the record that says what it lands.
 */
import {
  closeSync,
  existsSync,
  lockExclusiveSync,
  openSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "./filesystem.ts";
import { hostname } from "./os.ts";
import { dirname, join } from "./path.ts";
import { runtimeProcess } from "./process.ts";
import { decodeOutput, runSync } from "./subprocess.ts";

/** This process's own record by its pid, asked of `ps` once (`ownRecord`). */
const own = new Map<number, string>();

/** The record the process `pid` of this host would hold a lock by, `<pid> <host> <start>`, or ""
 *  where none has that pid. `ps` is named by its full path, since the host fakes put their own first
 *  on the path. `utc` pins `TZ=UTC LC_ALL=C` (default); `false` queries ambient TZ to recognize
 *  live locks written by pre-UTC commits on non-UTC hosts. */
function recordOf(pid: number, tz: "utc" | "ambient" = "utc"): string {
  const env = tz === "utc" ? { ...runtimeProcess.env, TZ: "UTC", LC_ALL: "C" } : runtimeProcess.env;
  const start = decodeOutput(runSync(["/bin/ps", "-o", "lstart=", "-p", String(pid)], { env }).stdout).trim();
  return start === "" ? "" : `${String(pid)} ${hostname()} ${start}`;
}

/** This process's own record, asked of `ps` once: its start does not change, and a campaign takes a
 *  claim for every solve and every check, each of which would otherwise start a `ps`. */
function ownRecord(): string {
  const { pid } = runtimeProcess;
  const cached = own.get(pid);
  if (cached !== undefined && cached !== "") return cached;
  const record = recordOf(pid);
  if (record !== "") own.set(pid, record);
  return record;
}

/** Whether `record` matches `live` (exact match or followed by a space-delimited note). */
const matchesRecord = (record: string, live: string): boolean =>
  live !== "" && (record === live || record.startsWith(`${live} `));

/** The record `file` holds, or "" where it is no link. */
export function recordIn(file: string): string {
  try {
    return readlinkSync(file);
  } catch {
    return "";
  }
}

/** The live process that holds `file` and the note it wrote after its record, or null where none
 *  does: the record must name a process of this host still with that start (UTC or ambient TZ). */
export function holderOf(file: string): { readonly pid: number; readonly note: string } | null {
  const record = recordIn(file);
  if (record === "") return null;
  const pid = Number.parseInt(record, 10);
  const utc = recordOf(pid, "utc");
  if (matchesRecord(record, utc)) return { pid, note: record.slice(utc.length + 1) };
  const ambient = recordOf(pid, "ambient");
  if (matchesRecord(record, ambient)) return { pid, note: record.slice(ambient.length + 1) };
  return null;
}

/** Whether a live process holds `file`. */
export const held = (file: string): boolean => holderOf(file) !== null;

/** Take `file`, in a folder that exists, for this process where no live process holds it, and say
 *  whether it did. A `note` follows the record, for whoever finds the lock held. */
export function hold(file: string, note = ""): boolean {
  const mine = ownRecord();
  if (mine === "") return false;
  const guard = openSync(dirname(file), "r");
  try {
    lockExclusiveSync(guard);
    if (held(file)) return false;
    rmSync(file, { force: true });
    symlinkSync([mine, ...(note === "" ? [] : [note])].join(" "), file);
    return true;
  } finally {
    closeSync(guard);
  }
}

/** Remove each file in `folder` (and below, with `deep`) whose name carries its writer's pid, the
 *  first group of `named`, where no process of this host has that pid: a write a kill cut, which
 *  no live writer still fills however slowly it writes. */
export function dropCutWrites(folder: string, named: RegExp, { deep = false } = {}): void {
  for (const name of readdirSync(folder, { recursive: deep, encoding: "utf8" })) {
    const pid = named.exec(name)?.[1];
    if (pid !== undefined && recordOf(Number(pid)) === "") rmSync(join(folder, name), { force: true });
  }
}

/** Give `file` up, where this exact process record holds it, serialized by the folder lock. */
export function release(file: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) return;
  let guard: number;
  try {
    guard = openSync(dir, "r");
  } catch {
    return;
  }
  try {
    lockExclusiveSync(guard);
    const record = recordIn(file);
    if (matchesRecord(record, ownRecord())) rmSync(file, { force: true });
  } finally {
    closeSync(guard);
  }
}
