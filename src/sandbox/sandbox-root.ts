import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rm,
} from "../meta/filesystem.ts";
import { held, hold, recordIn } from "../meta/holder.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { processTable } from "../meta/process-table.ts";

export type ReleaseRoot = () => Promise<void>;

export const hostFolder = (root: string): string => `${root}.host`;

const claimOf = (root: string): string => `${root}.owner`;

export function claim(root: string): void {
  hold(claimOf(root));
}

export const claimed = (root: string): boolean => held(claimOf(root));

let reclaimSeq = 0;

async function reclaimDead(at: string): Promise<void> {
  const owner = claimOf(at);
  if (recordIn(owner) === "" || claimed(at)) return;
  const tomb = `${at}.reclaiming-${String(runtimeProcess.pid)}-${String((reclaimSeq += 1))}`;
  const move = (from: string, to: string): string | null => {
    try {
      renameSync(from, to);
      return to;
    } catch {
      return null;
    }
  };
  const movedOwner = move(owner, `${tomb}.owner`);
  if (movedOwner === null) return;
  endHolders([at, hostFolder(at)]);
  const movedRoot = move(at, tomb);
  const movedHost = move(hostFolder(at), `${tomb}.host`);
  try {
    if (movedRoot !== null) await removeWhole(movedRoot);
    if (movedHost !== null) await rm(movedHost, { recursive: true, force: true });
  } finally {
    await rm(movedOwner, { force: true });
  }
}

export async function claimRoot(root: string): Promise<ReleaseRoot> {
  const at = resolve(root);
  mkdirSync(dirname(at), { recursive: true });
  await reclaimDead(at);
  mkdirSync(at, { mode: 0o700 });
  claim(at);
  return () => releaseRoot(at);
}

export async function releaseRoot(root: string): Promise<void> {
  endHolders([root, hostFolder(root)]);
  await Promise.all([removeWhole(root), rm(hostFolder(root), { recursive: true, force: true })]);
  await rm(claimOf(root), { force: true });
}

function latestWrite(root: string): number {
  const inside = (folder: string) => {
    try {
      return readdirSync(folder).map((name) => join(folder, name));
    } catch {
      return [];
    }
  };
  const tops = [root, hostFolder(root)].filter(existsSync);
  return Math.max(...tops.flatMap((top) => [top, ...inside(top)]).map((path) => lstatSync(path).mtimeMs));
}

export async function releaseLeft(
  parents: readonly string[],
  unclaimedBefore: number,
  act: "release" | "describe",
  spared: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const left: string[] = [];
  for (const parent of parents.filter(existsSync)) {
    const roots = new Set(
      readdirSync(parent).map((name) => join(parent, name.replace(/\.(?:host|owner)$/, ""))),
    );
    for (const root of roots) {
      try {
        if (spared.has(root)) continue;
        if (recordIn(claimOf(root)) === "" ? latestWrite(root) >= unclaimedBefore : claimed(root)) continue;
        if (act === "release") await releaseRoot(root);
        left.push(root);
      } catch {
        // Ignore roots modified concurrently during the sweep.
      }
    }
  }
  return left;
}

async function removeWhole(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true });
    return;
  } catch {
    const open = (dir: string): void => {
      chmodSync(dir, 0o700);
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) open(join(dir, entry.name));
      }
    };
    open(root);
  }
  await rm(root, { recursive: true, force: true });
}

interface EndHoldersOptions {
  readonly group?: number | undefined;
  readonly spareOwn?: boolean;
  readonly table?: typeof processTable;
}

export function endHolders(roots: string | readonly string[], options: EndHoldersOptions = {}): void {
  const { group, spareOwn = false, table = processTable } = options;
  if (runtimeProcess.platform !== "darwin") return;
  const list = Array.isArray(roots) ? roots : [roots];
  const real = list.filter(existsSync).map((root) => realpathSync.native(root));
  if (real.length === 0) return;
  const until = performance.now() + 1000;
  for (let settled = true; performance.now() < until; ) {
    const holders = holdersOf(real, { group, spareOwn }, table());
    if (holders.length === 0 && settled) return;
    settled = holders.length === 0;
    for (const pid of holders) {
      try {
        runtimeProcess.kill(pid, "SIGKILL");
      } catch {
        // Process exited between listing and `SIGKILL`.
      }
    }
  }
}

function descendantsOf(table: ReturnType<typeof processTable>, seed: Iterable<number>): Set<number> {
  const found = new Set(seed);
  for (let size = -1; size !== found.size; ) {
    size = found.size;
    for (const { pid, ppid } of table) if (found.has(ppid)) found.add(pid);
  }
  return found;
}

function holdersOf(
  roots: readonly string[],
  { group, spareOwn }: { readonly group: number | undefined; readonly spareOwn: boolean },
  rows: ReturnType<typeof processTable>,
): number[] {
  const inRoot = (path: string | null) =>
    path !== null && roots.some((root) => path === root || path.startsWith(`${root}/`));
  const table = rows.filter(({ pid }) => pid > 1 && pid !== runtimeProcess.pid);
  const spared = spareOwn
    ? descendantsOf(
        table,
        table
          .filter(
            (row) =>
              row.ppid === runtimeProcess.pid &&
              row.pid !== group &&
              row.pgid !== group &&
              !inRoot(row.program),
          )
          .map(({ pid }) => pid),
      )
    : new Set<number>();
  const active = spared.size === 0 ? table : table.filter(({ pid }) => !spared.has(pid));
  return [
    ...descendantsOf(
      active,
      active
        .filter((row) => row.pgid === group || inRoot(row.cwd) || inRoot(row.program))
        .map(({ pid }) => pid),
    ),
  ];
}
