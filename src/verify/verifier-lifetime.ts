/** Protected ownership of verifier children which outlive their bounded result. */
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "../meta/filesystem.ts";
import { hostname } from "../meta/os.ts";
import { isAbsolute, join, relative, resolve } from "../meta/path.ts";
import { readJsonFile, writeCompleted } from "../meta/completed-json.ts";
import { runtimeProcess } from "../meta/process.ts";
import { processGroupExists } from "../meta/subprocess.ts";
import { errorCode, type RuntimeSignal } from "../meta/runtime-values.ts";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
export { superviseVerifierProcess } from "./verifier-lifetime-process.ts";

export interface VerifierProcessSettlement {
  receiptId: string;
  exit: { code: number | null; signal: RuntimeSignal | null } | null;
  groupReaped: boolean;
  outputComplete: boolean;
  timedOut: boolean;
}
export type VerifierCleanup = { state: "complete" } | { state: "pending"; receiptIds: string[] };
export interface VerifierProcessLease {
  readonly id: string;
  spawned(pid: number): void;
  settle(observation: VerifierProcessSettlement): void;
  registerStop(stop: () => Promise<VerifierProcessSettlement>): void;
}
export interface VerifierLifetime {
  begin(input: {
    role: "tool" | "evaluator" | "reference";
    cell?: string;
    requestDigest?: string;
  }): VerifierProcessLease;
  assertUsable(): void;
  pendingReceipts(): string[];
  /** Close admission and bound every currently owned child's settlement before terminal writing. */
  close(): Promise<string[]>;
  /** Observe recorded groups and clean exact retained cells. Never signal a persisted PID. */
  recover(): string[];
}
/** Why the lifetime refused. One sentence covered all seven for as long as the class existed, and
 *  it was the sentence for the first: the 2026-09-18 stop investigation read "restore the host"
 *  against 1714 receipts that had every one settled, because the throw was a `begin` after `close`.
 *  `solvability.ts` carries this message into an environment-owned finding, so the wrong sentence
 *  routes as evidence rather than staying in a log. */
type VerifierStopReason =
  | "unsettled-children"
  | "closed"
  | "root-identity"
  | "receipt-write"
  | "active-leases"
  | "cell-inside-root"
  | "receipt-path"
  | "no-lifetime";

const STOP_SAID: Record<VerifierStopReason, string> = {
  "unsettled-children": "verifier process cleanup is incomplete; restore the host before another execution",
  closed: "the verifier lifetime is closed; this run opens no further verifier process",
  "root-identity": "the verifier receipt root is no longer the directory it was opened on",
  "receipt-write": "a verifier process receipt could not be written; the child is unaccounted for",
  "active-leases": "verifier leases are still open; recovery observes only a quiet host",
  "cell-inside-root": "the requested verifier cell sits inside the protected receipt root",
  "receipt-path": "a verifier receipt path is a symbolic link; the recorded tree is not the one being read",
  "no-lifetime": "no verifier lifetime owns this execution",
};

type Intent = Static<typeof intentSchema>;
type Stored = { dir: string; intent: Intent; pid: number | null; groupReaped: boolean };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Settle a lease whose child never started. Nothing was reaped because no group exists, no output
 * was opened so collection is complete, and no deadline ran. Three spawn sites settle this way —
 * the tool host, the reference solve and the evaluator process — and a receipt that disagrees with
 * the others about a child that never existed is a cleanup fact the terminal reader cannot resolve.
 */
export function settleUnspawned(lease: VerifierProcessLease): void {
  lease.settle({
    receiptId: lease.id,
    exit: null,
    groupReaped: true,
    outputComplete: true,
    timedOut: false,
  });
}

export class VerifierOperationalStop extends Error {
  readonly code = "verifier-cleanup-pending";
  constructor(
    readonly reason: VerifierStopReason,
    readonly receiptIds: readonly string[],
  ) {
    super(STOP_SAID[reason]);
    this.name = "VerifierOperationalStop";
  }
}

/** Run `body` and close the lifetime on the way out, recording which way it left. Two callers
 *  create a lifetime they own for the length of one call; a `finally` that forgets the throw
 *  writes a clean close over a failed run, and that receipt is what the terminal reader believes. */
export async function withVerifierLifetime<T>(
  lifetime: VerifierLifetime,
  body: () => Promise<T>,
): Promise<T> {
  let failed = false;
  try {
    return await body();
  } catch (cause) {
    failed = true;
    throw cause;
  } finally {
    await closeVerifierLifetime(lifetime, failed ? "failed" : "clean");
  }
}

/** Cleanup may stop an otherwise successful caller; a primary failure keeps its identity. */
export async function closeVerifierLifetime(
  lifetime: VerifierLifetime,
  outcome: "failed" | "clean",
): Promise<void> {
  try {
    const pending = await lifetime.close();
    if (pending.length > 0) throw new VerifierOperationalStop("unsettled-children", pending);
  } catch (error) {
    if (outcome === "clean") throw error;
  }
}

const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
const nullableString = Type.Union([Type.String(), Type.Null()]);
const cellSchema = Type.Object({ path: Type.String(), device: Type.Number(), inode: Type.Number() });
const intentSchema = Type.Object({
  schema: Type.Literal("verifier-process-intent/v1"),
  id: Type.String(),
  role: Type.Union([Type.Literal("tool"), Type.Literal("evaluator"), Type.Literal("reference")]),
  hostname: Type.String(),
  controllerPid: Type.Integer({ minimum: 2 }),
  cell: Type.Union([cellSchema, Type.Null()]),
  requestDigest: nullableString,
  createdAt: Type.String(),
});
const spawnedSchema = Type.Object({
  schema: Type.Literal("verifier-process-spawned/v1"),
  id: Type.String(),
  pid: Type.Integer({ minimum: 2 }),
});
const settlementSchema = Type.Object({
  schema: Type.Literal("verifier-process-settlement/v1"),
  receiptId: Type.String(),
  exit: Type.Union([Type.Object({ code: nullableNumber, signal: nullableString }), Type.Null()]),
  groupReaped: Type.Boolean(),
  outputComplete: Type.Boolean(),
  timedOut: Type.Boolean(),
});
const cleanupSchema = Type.Object({
  schema: Type.Literal("verifier-process-cleanup/v1"),
  id: Type.String(),
  groupAbsent: Type.Literal(true),
  observedAt: Type.String(),
});
/** The four receipts a verifier process writes beside its intent. Each is written in one place
 *  and read in another, so the pair agrees through this record rather than through spelling. */
const RECEIPT = {
  intent: "intent.json",
  spawned: "spawned.json",
  settlement: "settlement.json",
  cleanup: "cleanup.json",
} as const;

function directoryIdentity(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("verifier ownership path is not a direct directory");
  }
  return { path: realpathSync(path), device: stat.dev, inode: stat.ino };
}

function readStored(root: string, id: string): Stored {
  if (!ID.test(id)) throw new Error("invalid verifier process receipt name");
  const dir = join(root, id);
  if (directoryIdentity(dir).path !== dir) throw new Error("indirect verifier process receipt");
  const intent = readJsonFile(join(dir, RECEIPT.intent));
  if (!Value.Check(intentSchema, intent) || intent.id !== id || intent.hostname !== hostname()) {
    throw new Error("unreadable or foreign verifier process intent");
  }
  let pid: number | null = null;
  if (existsSync(join(dir, RECEIPT.spawned))) {
    const spawned = readJsonFile(join(dir, RECEIPT.spawned));
    if (!Value.Check(spawnedSchema, spawned) || spawned.id !== id) {
      throw new Error("invalid verifier spawn identity");
    }
    pid = spawned.pid;
  }
  let groupReaped = false;
  if (existsSync(join(dir, RECEIPT.settlement))) {
    const settled = readJsonFile(join(dir, RECEIPT.settlement));
    if (!Value.Check(settlementSchema, settled) || settled.receiptId !== dir) {
      throw new Error("invalid verifier settlement");
    }
    groupReaped = settled.groupReaped;
  }
  if (existsSync(join(dir, RECEIPT.cleanup))) {
    const cleanup = readJsonFile(join(dir, RECEIPT.cleanup));
    if (!Value.Check(cleanupSchema, cleanup) || cleanup.id !== id || pid === null) {
      throw new Error("invalid verifier cleanup receipt");
    }
    groupReaped = true;
  }
  return { dir, intent, pid, groupReaped };
}

function removeExactCell(cell: Intent["cell"], root: string): void {
  if (cell === null) return;
  if (
    !isAbsolute(cell.path) ||
    resolve(cell.path) !== cell.path ||
    relative(cell.path, root).split("/")[0] !== ".."
  ) {
    throw new Error("verifier cell contains its protected receipt owner");
  }
  try {
    const now = directoryIdentity(cell.path);
    if (now.path !== cell.path || now.device !== cell.device || now.inode !== cell.inode) {
      throw new Error("verifier cell identity changed before cleanup");
    }
    rmSync(cell.path, { recursive: true, force: true });
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT") throw cause;
  }
}

function recoverReceipts(root: string, pending: Set<string>): string[] {
  const rows: Stored[] = [];
  let unreadable = false;
  for (const id of readdirSync(root)) {
    try {
      rows.push(readStored(root, id));
    } catch {
      pending.add(join(root, id));
      unreadable = true;
    }
  }
  if (unreadable) return [...pending];
  for (const row of rows) {
    if (!pending.has(row.dir)) continue;
    const peers = rows.filter((peer) => peer.intent.cell?.path === row.intent.cell?.path);
    if (peers.some((peer) => !peer.groupReaped && (peer.pid === null || processGroupExists(peer.pid)))) {
      continue;
    }
    try {
      removeExactCell(row.intent.cell, root);
      writeCompleted(join(row.dir, RECEIPT.cleanup), {
        schema: "verifier-process-cleanup/v1",
        id: row.intent.id,
        groupAbsent: true,
        observedAt: new Date().toISOString(),
      });
      pending.delete(row.dir);
    } catch {
      /* Preserve uncertainty and the exact receipt for the next observer. */
    }
  }
  return [...pending];
}

/** A controller/outDir root, supplied explicitly; candidate directories must not contain it. */
export function createVerifierLifetime(options: { root: string }): VerifierLifetime {
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  const root = directoryIdentity(options.root);
  const active = new Set<string>();
  const stops = new Map<string, () => Promise<VerifierProcessSettlement>>();
  const pending = new Set<string>();
  let closing = false;
  const pendingReceipts = () => [...new Set([...pending, ...active])];
  const assertRoot = () => {
    const now = directoryIdentity(root.path);
    if (now.device !== root.device || now.inode !== root.inode || now.path !== root.path) {
      throw new VerifierOperationalStop("root-identity", [root.path]);
    }
  };
  for (const id of readdirSync(root.path)) {
    try {
      if (!readStored(root.path, id).groupReaped) pending.add(join(root.path, id));
    } catch {
      pending.add(join(root.path, id));
    }
  }
  const assertUsable = () => {
    assertRoot();
    if (closing || pending.size > 0) {
      throw new VerifierOperationalStop(closing ? "closed" : "unsettled-children", pendingReceipts());
    }
  };
  return {
    assertUsable,
    pendingReceipts,
    close: async () => {
      closing = true;
      await Promise.allSettled([...stops.values()].map((stop) => stop()));
      return pendingReceipts();
    },
    begin: (input) => {
      assertUsable();
      const cell = input.cell === undefined ? null : directoryIdentity(input.cell);
      if (cell !== null && relative(cell.path, root.path).split("/")[0] !== "..") {
        throw new VerifierOperationalStop("cell-inside-root", [root.path]);
      }
      const id = crypto.randomUUID();
      const dir = join(root.path, id);
      mkdirSync(dir, { mode: 0o700 });
      writeCompleted(join(dir, RECEIPT.intent), {
        schema: "verifier-process-intent/v1",
        id,
        role: input.role,
        hostname: hostname(),
        controllerPid: runtimeProcess.pid,
        cell,
        requestDigest: input.requestDigest ?? null,
        createdAt: new Date().toISOString(),
      });
      active.add(dir);
      let settled = false;
      return {
        id: dir,
        registerStop: (stop) => {
          if (settled) return;
          stops.set(dir, stop);
          if (closing) void stop().catch(() => {});
        },
        spawned: (pid) => {
          try {
            assertRoot();
            if (!Number.isSafeInteger(pid) || pid < 2 || existsSync(join(dir, RECEIPT.spawned))) {
              throw new Error("invalid verifier pid");
            }
            writeCompleted(join(dir, RECEIPT.spawned), { schema: "verifier-process-spawned/v1", id, pid });
          } catch {
            pending.add(dir);
            throw new VerifierOperationalStop("receipt-write", [dir]);
          }
        },
        settle: (observation) => {
          if (settled) return;
          try {
            assertRoot();
            if (observation.receiptId !== dir) throw new Error("mismatched verifier receipt");
            writeCompleted(join(dir, RECEIPT.settlement), {
              schema: "verifier-process-settlement/v1",
              ...observation,
            });
          } catch {
            pending.add(dir);
            throw new VerifierOperationalStop("receipt-write", [dir]);
          }
          settled = true;
          active.delete(dir);
          stops.delete(dir);
          if (!observation.groupReaped) pending.add(dir);
        },
      };
    },
    recover: () => {
      assertRoot();
      if (active.size > 0) throw new VerifierOperationalStop("active-leases", [...active]);
      return recoverReceipts(root.path, pending);
    },
  };
}
