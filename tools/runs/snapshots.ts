/**
 * Read remote campaigns through the local readers. One catalogue lists each machine's originals,
 * including its archive. One transfer owner refreshes copies in the existing archive. Copies never
 * become runnable campaigns. A failed transfer leaves the previous copy intact and refuses the read;
 * only whole log lines are published; credentials are excluded and rsync never follows a link.
 *
 *   bun run runs catalogue
 */
import { Type } from "typebox";
import { CODEX_AUTH } from "#src/agent/backends/models.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { DELIVERABLES } from "#src/kernel/answer-files.ts";
import { LOG_FILE, read as readLog, truncatePartial } from "#src/kernel/log.ts";
import { cloneFile, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "#src/meta/filesystem.ts";
import { hold, release } from "#src/meta/holder.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isNumber } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { homedir } from "#src/meta/os.ts";
import { dirname, isAbsolute, join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { pooled } from "#src/meta/pool.ts";
import { runtimeProcess, warn } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { keepObservation, observationAt, stderrTail } from "./diagnosis.ts";
import { quoted, rsync, sideOf, sshScript } from "./host-command.ts";
import { type Bench, benchesOf, type Host, hostNamed, hostsOf } from "./host-config.ts";
import { answerOf, asked } from "./hosts.ts";
import PACKAGE_PATHS from "./package-paths.py" with { type: "text" };
import {
  ARCHIVE,
  archiveOf,
  fileStat,
  HERE,
  keepers,
  originals,
  processes,
  readable,
  readNamed,
  SEED_FILE,
  writers,
  type Run,
} from "./registry.ts";

interface RemoteRun {
  readonly name: string;
  readonly path: string;
  readonly project: string | null;
  readonly open: boolean;
  /** Whether a keeper held it there; false from a host whose tree sends none. */
  readonly kept: boolean;
  readonly stderr: string | null;
  readonly bytes: number | null;
}

type Depth = "record" | "whole";

/** Of a benchmark's trees, only the toolchain `bin` folder (`levels` reads exported program names). */
const PROGRAMS_ONLY = [
  "--include=/trees/",
  "--include=/trees/*/",
  "--include=/trees/*/scripts/",
  "--include=/trees/*/scripts/toolchain/",
  "--include=/trees/*/scripts/toolchain/bin/***",
  "--exclude=/trees/**",
];
export const PRIVATE_NAMES = [".env", ".env.*", "*.env", CODEX_AUTH];
const EXCLUDED = PRIVATE_NAMES.map((name) => `--exclude=${name}`);
/** Folders of installed packages, caches and built bundles, by name. */
export const DERIVED: ReadonlySet<string> = new Set([
  "node_modules",
  ".bundle-snapshots",
  "__pycache__",
  ".git",
  ".cache",
  ".cargo",
  ".local",
  ".matplotlib",
  "Library",
]);
const DERIVED_LIST = [...DERIVED];
/** Run the wheel RECORD reader at the source of a zip or remote copy, pruning `DERIVED` dirs. */
export const PACKAGED = `python3 -I -c ${quoted(PACKAGE_PATHS)} ${DERIVED_LIST.map(quoted).join(" ")}`;
/** List remote files while pruning `DERIVED` dirs at the source (emits pruned dirs with a trailing `/`). */
const FIND_FILES = `find . \\( -type d \\( ${DERIVED_LIST.map((name) => `-name ${quoted(name)}`).join(" -o ")} \\) -prune -exec printf '%s/\\0' {} + \\) -o ! -type d -print0`;
/** Submitted files, the one part of `states/` a record copy keeps so verdict readers can inspect them. */
const DELIVERED = join("states", DELIVERABLES.folder);
// Include `SEED_FILE` so a copied rehearsal seed never reads as a paid campaign in a replay.
const RECORD = [
  "--include=/log.jsonl",
  "--include=/states/",
  `--include=/${DELIVERED}/***`,
  "--exclude=/states/*",
  "--include=/launch-*.json",
  `--include=/${SEED_FILE}`,
  "--exclude=/*",
];
/** A host's answer to `catalogue`. `kept` and `bytes` are read where a host's tree sends them. */
const CATALOGUE = Type.Array(
  Type.Object({
    name: Type.String(),
    path: Type.String(),
    project: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    open: Type.Boolean(),
    kept: Type.Optional(Type.Unknown()),
    stderr: Type.Union([Type.String(), Type.Null()]),
    bytes: Type.Optional(Type.Unknown()),
  }),
);
/** Concurrent rsyncs per sweep, under sshd's default ten-session limit on the shared control socket. */
const AT_ONCE = 6;
/** Poll interval when waiting on a copy another fetch holds. */
const WAIT_MS = 200;

/** Files and complete directories a package owns, relative to the archive root. */
export const packagedOf = (printed: string): Set<string> =>
  new Set(printed === "" ? [] : parseJsonAs<string[]>(printed));

/** One original campaign's identity and project, streaming only `campaign.opened` events. */
function entryOf({ name, path }: Run): { name: string; path: string; project: string | null } {
  return {
    name,
    path,
    project: openingOf(readLog(path, (kind) => kind !== "campaign.opened"))?.project ?? null,
  };
}

/** Only originals are advertised: a fetched copy cannot claim another machine's campaign. */
export async function catalogue(): Promise<void> {
  const running = processes();
  const records = await Promise.all(
    originals().map(async (run) => ({
      ...entryOf(run),
      open: writers(run, running).length > 0,
      kept: keepers(run.name, running).length > 0,
      stderr: await stderrTail(run.path),
      bytes: lstatSync(run.path).size,
    })),
  );
  console.log(capturedJsonStringify(records));
}

/** Original campaign identities and projects, shared with fresh placement. */
export const localCatalogue = () => originals().map(entryOf);

/** Validate before a remote record can name a transfer source or local destination. */
export function remoteRuns(lines: readonly string[] | null, host: Host): RemoteRun[] {
  if (lines === null) throw new Error(`${host.name}: no campaign catalogue; copies were not refreshed`);
  const said = answerOf(CATALOGUE, lines);
  if (said === null) throw new Error(`${host.name}: invalid campaign catalogue`);
  return said.map(({ name, path, project, open, kept, stderr, bytes }) => {
    if (
      !isSafePathSegment(name) ||
      !isAbsolute(path) ||
      !path.endsWith(`/${name}/${LOG_FILE}`) ||
      path.includes("\n")
    ) {
      throw new Error(`${host.name}: campaign path does not name its log`);
    }
    return {
      name,
      path,
      project: project ?? null,
      open,
      kept: kept === true,
      stderr,
      bytes: isNumber(bytes) ? bytes : null,
    };
  });
}

/** Whether `run` already lives in its peer's archive (`data/runs/here/<name>`), so nothing else
 *  (including cut-Builder note recovery on retire) will write to its folder. */
const isArchived = (run: RemoteRun): boolean =>
  run.path.endsWith(`/${join(ARCHIVE, HERE, run.name, LOG_FILE)}`);

/** The rsync flag that leaves one path of the copied folder where it is. */
const leaving = (path: string): string => `--exclude=/${path.replaceAll(/[*?[]/gu, String.raw`\$&`)}`;

/** Files a copy takes in byte order and outermost paths it leaves behind (`DERIVED` folders and
 *  entries owned by pip wheel `RECORD`s), pruned at the source so installed trees are not walked. */
async function filesOf(host: Host, folder: string): Promise<{ taken: string[]; left: string[] }> {
  const listed = (
    await runTextOrThrow(sshScript(host, `cd ${quoted(folder)} && ${FIND_FILES} && ${PACKAGED}`))
  ).split("\0");
  const owned = packagedOf(listed.pop() ?? "");
  const paths = listed
    .filter((path) => path.startsWith("./"))
    .map((path) => path.slice(2))
    .toSorted();
  const taken: string[] = [];
  const left = new Set<string>();
  for (const raw of paths) {
    const pruned = raw.endsWith("/");
    const parts = (pruned ? raw.slice(0, -1) : raw).split("/");
    let outer: string | undefined;
    let prefix = "";
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      prefix = index === 0 ? part : `${prefix}/${part}`;
      if (owned.has(prefix) || ((pruned || index + 1 < parts.length) && DERIVED.has(part))) {
        outer = prefix;
        break;
      }
    }
    if (outer !== undefined) left.add(outer);
    else if (!pruned) taken.push(raw);
  }
  return { taken, left: [...left].toSorted() };
}

/** Inspect `into` as it stands. Returns null after updating its observation if `into` already holds
 *  everything `depth` needs at `run.bytes`; otherwise returns the local copy state for transfer. */
function copyOrReuse(run: RemoteRun, into: string, depth: Depth) {
  const exists = fileStat(into)?.isDirectory() === true;
  const bytes = exists ? (fileStat(join(into, LOG_FILE))?.size ?? null) : null;
  const wholeBytes = exists ? observationAt(into)?.wholeBytes : undefined;
  const closedWhole = !run.open && !run.kept && isArchived(run) && wholeBytes === run.bytes;
  if (run.bytes !== null && bytes === run.bytes && (depth === "record" || closedWhole)) {
    keepObservation(into, {
      open: run.open,
      kept: run.kept,
      stderr: run.stderr,
      ...keyIfDefined("wholeBytes", wholeBytes),
    });
    return null;
  }
  return { exists, bytes, wholeBytes };
}

/** Stage a remote snapshot into `folder` and return its verified whole-line log byte length. */
async function stageTransfer(
  run: RemoteRun,
  host: Host,
  spec: {
    readonly into: string;
    readonly folder: string;
    readonly depth: Depth;
    readonly exists: boolean;
    readonly bytes: number | null;
  },
): Promise<number> {
  const { into, folder, depth, exists, bytes } = spec;
  mkdirSync(folder, { recursive: true });
  // Pre-seed a growing log via copy-on-write clone so openrsync delta-transfers only appended bytes
  // (`--link-dest` alone only hardlinks identical files and re-sends grown logs from byte 0).
  if (bytes !== null && run.bytes !== null && bytes < run.bytes) {
    cloneFile(join(into, LOG_FILE), join(folder, LOG_FILE));
  }
  const { taken, left } =
    depth === "whole" ? await filesOf(host, dirname(run.path)) : { taken: [], left: [] };
  // On case-folding disks, keep only the last byte-order member (typically lower-case) of each
  // case-colliding group so upper-case terminfo aliases or Examiner files never abort rsync.
  const foldCase = taken.length > 0 && fileStat(dirname(into).toUpperCase()) !== undefined;
  const last = foldCase ? new Map(taken.map((path) => [path.toLowerCase(), path])) : null;
  const twins = last === null ? [] : taken.filter((path) => last.get(path.toLowerCase()) !== path);
  if (twins.length > 0) {
    console.log(
      `${run.name}: ${String(twins.length)} paths named as another but for case stay on ${host.name} alone`,
    );
  }
  await rsync(
    `${sideOf(host, dirname(run.path))}/`,
    `${folder}/`,
    ...(exists ? [`--link-dest=${into}`] : []),
    ...EXCLUDED,
    ...left.map(leaving),
    ...twins.map(leaving),
    ...(depth === "record" ? RECORD : []),
  );
  const log = join(folder, LOG_FILE);
  if (!lstatSync(log).isFile()) throw new Error(`${run.name}: the copied log is not a regular file`);
  return truncatePartial(log);
}

/** Publish staged `folder` into `into`. Record refreshes overlay files into an existing copy
 *  (deliverables before the log that references them) so whole artefacts survive; whole or initial
 *  refreshes swap atomically through `previous`. */
function publishSnapshot(folder: string, into: string, depth: Depth): void {
  if (depth === "record" && fileStat(into) !== undefined) {
    const delivered =
      fileStat(join(folder, DELIVERED)) === undefined ? [] : readdirSync(join(folder, DELIVERED));
    if (delivered.length > 0) mkdirSync(join(into, DELIVERED), { recursive: true });
    for (const kept of delivered) renameSync(join(folder, DELIVERED, kept), join(into, DELIVERED, kept));
    const record = readdirSync(folder)
      .filter((name) => name !== "states")
      .toSorted((a, b) => Number(a === LOG_FILE) - Number(b === LOG_FILE));
    for (const file of record) renameSync(join(folder, file), join(into, file));
    return;
  }
  const previous = join(dirname(folder), "previous");
  if (fileStat(into) !== undefined) renameSync(into, previous);
  try {
    renameSync(folder, into);
  } catch (error) {
    if (fileStat(previous) !== undefined) renameSync(previous, into);
    throw error;
  }
}

/** Refresh one copy under its holder (`holder.ts`), recovering any copy a killed swap set aside. */
async function refresh(run: RemoteRun, into: string, host: Host, depth: Depth): Promise<string> {
  const held = join(into, LOG_FILE);
  if (copyOrReuse(run, into, depth) === null) return held;
  const lock = join(dirname(into), `.fetch-${run.name}.lock`);
  const holder = join(lock, "holder");
  const stage = join(lock, "stage");
  const previous = join(stage, "previous");
  mkdirSync(lock, { recursive: true });
  while (!hold(holder)) await Bun.sleep(WAIT_MS);
  let published = false;
  try {
    if (fileStat(previous) !== undefined && fileStat(into) === undefined) renameSync(previous, into);
    const copy = copyOrReuse(run, into, depth);
    if (copy === null) {
      published = true;
      return held;
    }
    rmSync(stage, { recursive: true, force: true });
    const folder = join(stage, "campaign");
    const logBytes = await stageTransfer(run, host, {
      into,
      folder,
      depth,
      exists: copy.exists,
      bytes: copy.bytes,
    });
    const wholeBytes =
      depth === "whole" && !run.open && !run.kept && isArchived(run) ? logBytes : copy.wholeBytes;
    keepObservation(folder, {
      open: run.open,
      kept: run.kept,
      stderr: run.stderr,
      ...keyIfDefined("wholeBytes", wholeBytes),
    });
    publishSnapshot(folder, into, depth);
    published = true;
    return held;
  } finally {
    if (published || fileStat(previous) === undefined) rmSync(stage, { recursive: true, force: true });
    else console.error(`${run.name}: the previous copy is kept in ${previous} for the next fetch`);
    release(holder);
  }
}

/** Refresh matching remote campaigns. Exact discovery refuses duplicate names across hosts;
 *  collection reads drop duplicates after the first and keep copies from silent or unlisted hosts. */
export async function syncRuns(
  names: readonly string[],
  options: {
    readonly match?: "exact" | "part";
    readonly from?: string;
    readonly depth?: Depth;
    /** Only campaigns no process writes or keeps, so a whole copy does not move underneath it. */
    readonly closed?: boolean;
  } = {},
): Promise<string[]> {
  const repo = runtimeProcess.cwd();
  const peers = hostsOf();
  const selected = await asked(["catalogue"], options.from === undefined ? peers : [hostNamed(options.from)]);
  const matches = (name: string) =>
    names.length === 0 ||
    names.some((part) => (options.match === "exact" ? name === part : name.includes(part)));
  const silent = new Set<string>();
  const remote = selected.flatMap(({ host, lines }) => {
    if (lines !== null || options.from !== undefined) {
      return remoteRuns(lines, host)
        .filter((run) => matches(run.name) && (options.closed !== true || !(run.open || run.kept)))
        .map((run) => ({ host, run }));
    }
    warn(`${host.name}: no campaign catalogue; its copies were left as they were`);
    silent.add(host.name);
    return [];
  });
  const owners = new Set(originals(repo).map((run) => run.name));
  const kept: typeof remote = [];
  for (const one of remote) {
    if (owners.has(one.run.name)) {
      const twice = `${one.run.name}: more than one original campaign, including ${one.host.name}`;
      if (options.match === "exact") throw new Error(twice);
      warn(`${twice}; that copy is left out`);
      continue;
    }
    owners.add(one.run.name);
    kept.push(one);
  }
  const known = new Set(peers.map(({ name }) => name));
  const stale = (from = HERE) => silent.has(from) || (from !== HERE && !known.has(from));
  const archive = archiveOf(repo);
  const left = readable(repo).filter((run) => stale(run.archived) && matches(run.name));
  const failed: string[] = [];
  const brought = await pooled(kept, AT_ONCE, ({ host, run }) =>
    refresh(run, join(archive, host.name, run.name), host, options.depth ?? "whole").catch(
      (error: unknown) => {
        failed.push(`${host.name} ${run.name}: ${errorMessage(error)}`);
        return null;
      },
    ),
  );
  if (failed.length > 0) {
    throw new Error(`${String(failed.length)} of ${String(kept.length)} copies failed: ${failed.join("; ")}`);
  }
  return [...brought.filter((log) => log !== null), ...left.map((run) => run.path)];
}

/** Where this machine holds a benchmark's records: its store where rolled here, else `data/bench/<name>`. */
export const recordsHere = ({ name, host, store }: Pick<Bench, "name" | "host" | "store">): string =>
  host === undefined
    ? store.replace(/^~\//u, `${homedir()}/`)
    : join(dirname(archiveOf(runtimeProcess.cwd())), "bench", name);

/** Copy each remote benchmark score store into `data/bench/<name>`, keeping only toolchain `bin` from trees. */
export async function fetchBenches(): Promise<string[]> {
  const copied: string[] = [];
  for (const bench of benchesOf()) {
    const { name, host, store } = bench;
    if (host === undefined) continue;
    const into = recordsHere(bench);
    mkdirSync(into, { recursive: true });
    // rsync reads a relative path from the remote home folder, whereas a quoted `~` is literal.
    const from = `${sideOf(host, store.replace(/^~\//u, ""))}/`;
    try {
      await rsync(from, `${into}/`, ...EXCLUDED, ...PROGRAMS_ONLY);
      copied.push(into);
    } catch (error) {
      warn(`${name} on ${host.name}: the benchmark score store was not copied: ${errorMessage(error)}`);
    }
  }
  return copied;
}

/** Take over retired campaigns on `host` once this machine holds an identical copy byte for byte. */
export async function takeRetired(host: Host, act: "take" | "describe"): Promise<void> {
  const archive = archiveOf(runtimeProcess.cwd());
  const [answer] = await asked(["catalogue"], [host]);
  const failed: string[] = [];
  for (const run of remoteRuns(answer?.lines ?? null, host)) {
    const from = dirname(run.path);
    const copy = join(archive, host.name, run.name);
    const own = join(archive, HERE, run.name);
    const held = [own, copy].find(
      (folder) => fileStat(folder)?.isDirectory() === true && fileStat(join(folder, LOG_FILE)) !== undefined,
    );
    if (!isArchived(run) || run.open || run.kept || run.bytes === null || held === undefined) continue;
    try {
      const differing = (
        await rsync(
          `${sideOf(host, from)}/`,
          `${held}/`,
          "-n",
          "-c",
          "--itemize-changes",
          ...EXCLUDED,
          ...(await filesOf(host, from)).left.map(leaving),
        )
      )
        .split("\n")
        // Lines starting with `.` report unchanged contents whose timestamps or modes alone differ.
        .filter((line) => line !== "" && !line.startsWith("."));
      if (differing.length > 0) {
        console.log(
          `${host.name} ${run.name}: stays there, ${String(differing.length)} paths differ from the copy here, the first ${differing[0] ?? ""}`,
        );
        continue;
      }
      console.log(
        `${act === "take" ? "" : "would: "}${host.name} ${run.name}: held in ${own}, ${from} deleted there`,
      );
      if (act === "describe") continue;
      mkdirSync(dirname(own), { recursive: true });
      if (held === copy) renameSync(copy, own);
      const folder = quoted(from);
      const said = await runTextOrThrow(
        sshScript(
          host,
          `if test "$(wc -c < ${quoted(run.path)} | tr -d ' ')" = ${String(run.bytes)}; then chmod -R u+w ${folder}; rm -rf -- ${folder}; else echo grown; fi`,
        ),
      );
      if (said.includes("grown")) {
        if (held === copy) renameSync(own, copy);
        failed.push(`${run.name}: its log there is no longer the length its catalogue gave, so it stays`);
      }
    } catch (error) {
      failed.push(`${run.name}: ${errorMessage(error)}`);
    }
  }
  if (failed.length > 0) {
    throw new Error(`${String(failed.length)} campaigns were not taken over: ${failed.join("; ")}`);
  }
}

/** Resolve a path as given, or refresh a named campaign before reading its existing archive copy. */
export async function readAcross(name: string, depth: Depth = "record"): Promise<Run> {
  const refreshed = await syncRuns([name], { match: "exact", depth });
  const run = readNamed(name);
  if (run.archived !== undefined && run.archived !== HERE && !refreshed.includes(run.path)) {
    throw new Error(`${name}: its host no longer lists the campaign; the old copy was left intact`);
  }
  return run;
}

/** A collection reads refreshed copies, leaving an old copy out once its host stops listing it. */
export async function readableAcross(names: readonly string[] = [], depth: Depth = "record"): Promise<Run[]> {
  const refreshed = await syncRuns(names, { depth });
  return readable().filter(
    (run) =>
      (names.length === 0 || names.some((name) => run.name.includes(name))) &&
      (run.archived === undefined || run.archived === HERE || refreshed.includes(run.path)),
  );
}

/** Resolve `<log | campaign folder | name>` across local paths and remote hosts. */
export async function logAcross(named: string, depth: Depth = "whole"): Promise<string> {
  const stat = fileStat(named);
  if (stat === undefined) return (await readAcross(named, depth)).path;
  if (stat.isDirectory() && fileStat(join(named, LOG_FILE)) !== undefined) return join(named, LOG_FILE);
  return named;
}
