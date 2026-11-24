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

const own = new Map<number, string>();

function recordOf(pid: number, tz: "utc" | "ambient" = "utc"): string {
  const env = tz === "utc" ? { ...runtimeProcess.env, TZ: "UTC", LC_ALL: "C" } : runtimeProcess.env;
  const start = decodeOutput(runSync(["/bin/ps", "-o", "lstart=", "-p", String(pid)], { env }).stdout).trim();
  return start === "" ? "" : `${String(pid)} ${hostname()} ${start}`;
}

function ownRecord(): string {
  const { pid } = runtimeProcess;
  const cached = own.get(pid);
  if (cached !== undefined && cached !== "") return cached;
  const record = recordOf(pid);
  if (record !== "") own.set(pid, record);
  return record;
}

const matchesRecord = (record: string, live: string): boolean =>
  live !== "" && (record === live || record.startsWith(`${live} `));

export function recordIn(file: string): string {
  try {
    return readlinkSync(file);
  } catch {
    return "";
  }
}

export function holderOf(file: string): { readonly pid: number; readonly note: string } | null {
  const record = recordIn(file);
  if (record === "") return null;
  const pid = Number.parseInt(record, 10);
  const utc = recordOf(pid, "utc");
  if (utc === "") return null;
  if (matchesRecord(record, utc)) return { pid, note: record.slice(utc.length + 1) };
  const ambient = recordOf(pid, "ambient");
  if (matchesRecord(record, ambient)) return { pid, note: record.slice(ambient.length + 1) };
  return null;
}

export const held = (file: string): boolean => holderOf(file) !== null;

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

export function dropCutWrites(folder: string, named: RegExp, { deep = false } = {}): void {
  for (const name of readdirSync(folder, { recursive: deep, encoding: "utf8" })) {
    const pid = named.exec(name)?.[1];
    if (pid !== undefined && recordOf(Number(pid)) === "") rmSync(join(folder, name), { force: true });
  }
}

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
