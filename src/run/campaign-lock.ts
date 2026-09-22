/**
 * Whether another controller still owns a campaign.
 *
 * Two fullruns on one campaign interleave epochs, budget, admission and promotion, so the lock is
 * an authority boundary rather than a convenience. The rule that matters runs the other way:
 * undeterminable is never dead. A record this host cannot judge — another machine's, an
 * unparseable file, a pid that is not a pid — keeps the lock held, because breaking it wrongly
 * costs a live run and refusing wrongly costs an operator one deletion.
 */

import { campaignDir, campaignRoot } from "../meta/campaign-root.ts";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "../meta/filesystem.ts";
import { parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isString } from "../meta/json-shape.ts";
import { hostname } from "../meta/os.ts";
import { dirname, join } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorCode } from "../meta/runtime-values.ts";

interface LockLease {
  token: string;
  owns: () => boolean;
  release: () => boolean;
}

/** What a lock file says. Only `pid` and `hostname` decide a break; `token` identifies the lease,
 *  and the raw text is quoted back in a refusal so an operator can see who to ask. */
interface LockRecord {
  token?: unknown;
  pid?: unknown;
  startTime?: unknown;
  hostname?: unknown;
}

type LockFile =
  | { state: "absent" }
  | { state: "unreadable"; raw: string }
  | { state: "read"; raw: string; record: LockRecord };

/**
 * Whether any process can still be holding this lock. `absent` and `proved-dead` are the two
 * dead-holder witnesses: no live controller owns the campaign, so an opening that never recorded a
 * terminal will not be recorded by its own process. `held` and `unreadable` stay refusals.
 */
export type LockHolderState = "absent" | "unreadable" | "held" | "proved-dead";

/** The campaign-relative lock file; the controller holds it and the seeding scripts drop it. */
export const CONTROLLER_LOCK_FILE = ".controller.lock";

/** One reader for the three questions asked of a lock file — who holds the lease, whether that
 *  holder is alive, and whether a new lease may take the path. `unreadable` is its own answer, so
 *  no caller can round it down to absent. */
function readLock(path: string): LockFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8").trim();
  } catch {
    return existsSync(path) ? { state: "unreadable", raw: "" } : { state: "absent" };
  }
  // A lock file holds an object or it holds nothing this host can judge. `null`, a bare number, a
  // string and an array all parse, and asserting each of them to be a LockRecord made the first
  // reader throw rather than refuse: `.token` off null in `lockToken`, `Number(record.pid)` off null
  // in `holderIsDead`. A throw is not the refusal this file's one rule asks for — undeterminable is
  // never dead — and the answer for it already exists.
  try {
    const record = asRecord(parseJsonAs<unknown>(raw));
    return record === null ? { state: "unreadable", raw } : { state: "read", raw, record };
  } catch {
    return { state: "unreadable", raw };
  }
}

/** The `token` a lock file carries. `unreadable` is the answer for a file that exists but cannot
 *  be parsed: the launcher treats that as no token, the evidence reader prints the sentinel. */
export function lockToken(path: string, unreadable: string | null = null): string | null {
  const file = readLock(path);
  if (file.state === "absent") return null;
  if (file.state === "unreadable") return unreadable;
  const { token } = file.record;
  return isString(token) && token !== "" ? token : null;
}

/** `ps -p <pid> -o lstart=` works identically on macOS and Linux; null when the pid is gone. */
function processStartTime(pid: number): string | null {
  const out = Bun.spawnSync({
    cmd: ["ps", "-p", String(pid), "-o", "lstart="],
    stdout: "pipe",
    stderr: "ignore",
  });
  const line = out.success ? out.stdout.toString().trim() : "";
  return line === "" ? null : line;
}

/** Whether this host can prove the holder has ended. `kill(pid, 0)` says a process exists, not
 *  that it is the recorded one, so a live pid still needs its start time to match (the
 *  openai/codex PidRecord pattern). EPERM proves the opposite of death, and another host's pid
 *  means nothing here at all. */
function holderIsDead(record: LockRecord): boolean {
  const pid = Number(record.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (isString(record.hostname) && record.hostname !== hostname()) return false;
  try {
    runtimeProcess.kill(pid, 0);
  } catch (error) {
    return errorCode(error) === "ESRCH";
  }
  return isString(record.startTime) && processStartTime(pid) !== record.startTime;
}

/** Classify one lock file's holder through the same rule that breaks a stale lock. */
export function lockHolderState(path: string): LockHolderState {
  const file = readLock(path);
  if (file.state !== "read") return file.state;
  return holderIsDead(file.record) ? "proved-dead" : "held";
}

/** Refuse, or clear the path for one retry. The rename serialises the break: of two breakers
 *  exactly one wins it and the loser retries into the winner's fresh lock, where an
 *  unlink-then-create would let both delete and both acquire. */
function breakStaleLock(path: string, conflict: string, token: string): void {
  const file = readLock(path);
  // An unreadable lock refuses with the rest: undeterminable is never dead.
  if (file.state !== "read" || !holderIsDead(file.record)) {
    throw new Error(`${path} exists${file.state === "absent" ? "" : ` (holder: ${file.raw})`} — ${conflict}`);
  }
  try {
    renameSync(path, `${path}.stale-${token}`);
    rmSync(`${path}.stale-${token}`);
  } catch {
    // Lost the rename race — the caller retries against whatever now holds the path.
  }
}

/** Release removes the file only while it is still the inode this lease created and still carries
 *  this lease's token: an operator who deleted and replaced the lock keeps their own. */
function lease(path: string, fd: number, token: string): LockLease {
  const owned = fstatSync(fd);
  const owns = (): boolean => lockToken(path) === token;
  let released: boolean | null = null;
  return {
    token,
    owns,
    release: () => {
      if (released !== null) return released;
      released = false;
      try {
        const current = statSync(path);
        if (current.dev === owned.dev && current.ino === owned.ino && owns()) {
          rmSync(path);
          released = true;
        }
      } catch {
        // A missing or operator-replaced path is no longer this controller's lock.
      } finally {
        closeSync(fd);
      }
      return released;
    },
  };
}

/** Take the path, or prove its holder dead and take it from them. */
function acquireLock(path: string, conflict: string): LockLease {
  mkdirSync(dirname(path), { recursive: true });
  const token = crypto.randomUUID();
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch {
    breakStaleLock(path, conflict, token);
    return acquireLock(path, conflict);
  }
  const record: LockRecord & { startedAt: string } = {
    pid: runtimeProcess.pid,
    startTime: processStartTime(runtimeProcess.pid),
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    token,
  };
  writeSync(fd, `${capturedJsonStringify(record)}\n`);
  return lease(path, fd, token);
}

export function acquireCampaignLock(repoRoot: string, projectId: string): LockLease {
  return acquireLock(
    join(campaignDir(repoRoot, projectId), CONTROLLER_LOCK_FILE),
    "another fullrun holds this campaign, and two controllers would interleave epochs, budget, admission, and promotion. If the holder is dead, delete the lock to release it.",
  );
}

export function acquireRegistryLock(repoRoot: string): LockLease {
  return acquireLock(
    join(campaignRoot(repoRoot), "projects.lock"),
    "another fullrun is updating the project registry. If its holder is dead, delete the lock to release it.",
  );
}
