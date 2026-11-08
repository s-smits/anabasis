/**
 * Read remote campaigns through the local readers (22 October 2026). One catalogue lists each
 * machine's originals, including its archive. One transfer owner refreshes copies in the existing
 * archive. Copies never become runnable campaigns. Fetch, WRI, view, source and replay used to
 * disagree on discovery, and an old fetched copy could silently stand for a growing remote log.
 * A failed transfer leaves the previous copy intact and refuses the read. Only whole log lines
 * are published. The catalogue states each log's size, and a record refresh skips a copy that
 * already has it, so the ten-minute gather of 28 October copies only campaigns that moved. No credential file is copied and rsync never follows a link.
 *
 *   bun run runs catalogue
 */
import { LOG_FILE, type LogEvent } from "#src/kernel/log.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString, isBoolean, isNumber } from "#src/meta/json-shape.ts";
import { dirname, isAbsolute, join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { pooled } from "#src/meta/pool.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { asked } from "./hosts.ts";
import { type Host, hostNamed, hostsOf } from "./host-config.ts";
import { quoted, rsync } from "./host-command.ts";
import { hold, release } from "./holder.ts";
import {
  archiveOf,
  HERE,
  originals,
  readable,
  readNamed,
  wholeLines,
  processes,
  SEED_FILE,
  writers,
  type Run,
} from "./registry.ts";
import { keepObservation, stderrTail } from "./diagnosis.ts";

interface RemoteRun {
  readonly name: string;
  readonly path: string;
  readonly project: string | null;
  readonly open: boolean;
  readonly stderr: string | null;
  readonly bytes: number | null;
}

type Depth = "record" | "whole";
const EXCLUDED = ["--exclude=.env", "--exclude=.env.*", "--exclude=*.env", "--exclude=auth.json"];
// The seed's mark comes too, so a copy of a rehearsal's seed is no paid campaign to a reader: until
// 29 October the gather left it out, and two compare-systems seeds counted as campaigns in a replay.
const RECORD = [
  "--include=/log.jsonl",
  "--include=/launch-*.json",
  `--include=/${SEED_FILE}`,
  "--exclude=/*",
];
/** How many copies are refreshed at once. Each is one rsync over the host's shared ssh connection,
 *  which carries ten sessions at most by sshd's default. */
const AT_ONCE = 6;
/** How often a fetch looks again at a copy another fetch holds. */
const WAIT_MS = 200;

/** The text only an opening's line holds. A line that merely quotes it is parsed and passed over. */
const OPENED = `"kind":"campaign.opened"`;

/** One original campaign's identity and project, as a catalogue lists it. Only the openings are
 *  parsed: every refresh asks each host for its catalogue, and parsing every line of every log for
 *  one project took 3.3 s of a refresh's 5.4 s on the Linux runner on 30 October. */
function entryOf({ name, path }: Run): { name: string; path: string; project: string | null } {
  const openings = wholeLines(path)
    .split("\n")
    .filter((line) => line.includes(OPENED))
    .map((line) => parseJsonAs<LogEvent>(line));
  return { name, path, project: openingOf(openings)?.project ?? null };
}

/** Only originals are advertised: a fetched copy cannot claim another machine's campaign. */
export async function catalogue(): Promise<void> {
  const running = processes();
  const records = await Promise.all(
    originals().map(async (run) => ({
      ...entryOf(run),
      open: writers(run, running).length > 0,
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
  const value = capturedJsonParse(lines.join("\n"));
  if (!Array.isArray(value)) throw new Error(`${host.name}: campaign catalogue is not a list`);
  return value.map((entry) => {
    const run = asRecord(entry);
    if (
      run === null ||
      !isString(run.name) ||
      !isSafePathSegment(run.name) ||
      !isString(run.path) ||
      !isAbsolute(run.path)
    ) {
      throw new Error(`${host.name}: invalid campaign catalogue entry`);
    }
    if (!run.path.endsWith(`/${run.name}/${LOG_FILE}`) || run.path.includes("\n")) {
      throw new Error(`${host.name}: campaign path does not name its log`);
    }
    if (run.project !== undefined && run.project !== null && !isString(run.project)) {
      throw new Error(`${host.name}: invalid campaign project`);
    }
    if (!isBoolean(run.open) || !(run.stderr === null || isString(run.stderr))) {
      throw new Error(`${host.name}: invalid campaign observation`);
    }
    return {
      name: run.name,
      path: run.path,
      project: isString(run.project) ? run.project : null,
      open: run.open,
      stderr: run.stderr,
      bytes: isNumber(run.bytes) ? run.bytes : null,
    };
  });
}

/** Refresh one copy under its holder (`holder.ts`), which a fetch keeps however long it transfers and
 *  the next takes over once its process is gone. The stage sits beside the holder, so a fetch killed
 *  part way leaves it where the next one finds it: a copy set aside is put back, and the rest goes. */
async function refresh(run: RemoteRun, into: string, host: Host, depth: Depth): Promise<string> {
  // A log only grows, so a record copy of the size the catalogue states has nothing to gain.
  const held = join(into, LOG_FILE);
  if (depth === "record" && run.bytes !== null && existsSync(held) && lstatSync(held).size === run.bytes) {
    await keepObservation(into, { open: run.open, stderr: run.stderr });
    return held;
  }
  const lock = join(dirname(into), `.fetch-${run.name}.lock`);
  const holder = join(lock, "holder");
  mkdirSync(lock, { recursive: true });
  while (!hold(holder)) await Bun.sleep(WAIT_MS);
  const stage = join(lock, "stage");
  const folder = join(stage, "campaign");
  const previous = join(stage, "previous");
  let published = false;
  try {
    if (existsSync(previous) && !existsSync(into)) renameSync(previous, into);
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const reused = existsSync(into) ? [`--link-dest=${into}`] : [];
    await rsync(
      `${host.ssh}:${quoted(dirname(run.path))}/`,
      `${folder}/`,
      ...reused,
      ...EXCLUDED,
      ...(depth === "record" ? RECORD : []),
    );
    const log = join(folder, LOG_FILE);
    if (!lstatSync(log).isFile()) throw new Error(`${run.name}: the copied log is not a regular file`);
    // link-dest may have linked an unchanged log to the previous copy. Replace its inode.
    const whole = join(stage, "whole-log");
    await Bun.write(whole, wholeLines(log));
    renameSync(whole, log);
    await keepObservation(folder, { open: run.open, stderr: run.stderr });
    // A record refresh keeps the artefacts a whole refresh fetched by moving only the record into
    // the copy, a file at a time, the log last. Copying the folder to keep them took 4.7 s of a
    // 5.8 s refresh of one live run on 30 October: 6,372 files, most of them its Examiner's home.
    if (depth === "record" && existsSync(into)) {
      const record = readdirSync(folder).toSorted((a, b) => Number(a === LOG_FILE) - Number(b === LOG_FILE));
      for (const file of record) renameSync(join(folder, file), join(into, file));
      published = true;
      return held;
    }
    // A whole refresh replaces them.
    if (existsSync(into)) renameSync(into, previous);
    try {
      renameSync(folder, into);
      published = true;
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, into);
      throw error;
    }
    return join(into, LOG_FILE);
  } finally {
    if (published || !existsSync(previous)) rmSync(stage, { recursive: true, force: true });
    else console.error(`${run.name}: the previous copy is kept in ${previous} for the next fetch`);
    release(holder);
  }
}

/** Refresh matching remote campaigns. Exact discovery is used by one-run readers; collections
 *  use the CLI's substring matching. It returns the copies it refreshed and those a silent host's
 *  were left at. A name two machines hold refuses the read where one run is asked for. A collection leaves out each copy after the first and
 *  says so, since one shared name refused every collection read, the daily retire's among them
 *  (27 October 2026: `sim-truss-live` on two machines refused `runs source --has`). */
export async function syncRuns(
  names: readonly string[],
  options: {
    readonly match?: "exact" | "part";
    readonly from?: string;
    readonly repo?: string;
    readonly depth?: Depth;
    /** Only the campaigns no process writes, which a copy can hold whole without moving under it. */
    readonly closed?: boolean;
  } = {},
): Promise<string[]> {
  const repo = options.repo ?? runtimeProcess.cwd();
  const local = originals(repo);
  // Only the host named is asked: another host's catalogue would be read and then dropped.
  const selected = await asked(
    ["catalogue"],
    options.from === undefined ? hostsOf() : [hostNamed(options.from)],
  );
  const matches = (name: string) =>
    names.length === 0 ||
    names.some((part) => (options.match === "exact" ? name === part : name.includes(part)));
  // A host asked alone refuses; among several, one that is silent keeps its copies as they were.
  // Until 30 October it refused every refresh, and 8 of 99 gather ticks left every copy stale.
  const silent = new Set<string>();
  const remote = selected.flatMap(({ host, lines }) => {
    if (lines !== null || options.from !== undefined) {
      return remoteRuns(lines, host)
        .filter((run) => matches(run.name) && (options.closed !== true || !run.open))
        .map((run) => ({ host, run }));
    }
    console.error(`${host.name}: no campaign catalogue; its copies were left as they were`);
    silent.add(host.name);
    return [];
  });
  const owners = new Set(local.map((run) => run.name));
  const kept: typeof remote = [];
  for (const one of remote) {
    if (owners.has(one.run.name)) {
      const twice = `${one.run.name}: more than one original campaign, including ${one.host.name}`;
      if (options.match === "exact") throw new Error(twice);
      console.error(`${twice}; that copy is left out`);
      continue;
    }
    owners.add(one.run.name);
    kept.push(one);
  }
  // The archive is named once: asking git for the main worktree for each of 145 copies took 2.6 s
  // of a 38 s reading of the table of runs on 30 October.
  // A copy whose host no `ANA_HOSTS` names cannot be refreshed, so it is read as it stands: until
  // 3 November a reader run without `.env.runs` dropped every peer's copy, and the promotion table
  // read 0 confirmed promotions where fullrun and v065-b each hold one.
  const known = new Set(hostsOf().map(({ name }) => name));
  const stale = (from = HERE) => silent.has(from) || (from !== HERE && !known.has(from));
  const archive = archiveOf(repo);
  const left = readable(repo).filter((run) => stale(run.archived) && matches(run.name));
  const brought = await pooled(kept, AT_ONCE, ({ host, run }) =>
    refresh(run, join(archive, host.name, run.name), host, options.depth ?? "whole"),
  );
  return [...brought, ...left.map((run) => run.path)];
}

/** Resolve a path as given, or refresh a named campaign before reading its existing archive copy. */
export async function readAcross(name: string, depth: Depth = "record"): Promise<Run> {
  const repo = runtimeProcess.cwd();
  const refreshed = await syncRuns([name], { match: "exact", repo, depth });
  const run = readNamed(name, repo);
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

/**
 * The one resolver of a reader's `<log | campaign folder | name>`: a folder reads its log, an
 * explicit path stays explicit, and a campaign's name reaches every host, copied whole or, for a
 * reader of its log alone, as its record. Until 30 October
 * `reading.ts` and `live-seat.ts` each resolved a folder themselves and the other readers refused one.
 */
export async function logAcross(named: string, depth: Depth = "whole"): Promise<string> {
  if (existsSync(join(named, LOG_FILE))) return join(named, LOG_FILE);
  return existsSync(named) ? named : (await readAcross(named, depth)).path;
}
