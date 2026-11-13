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
import { Type } from "typebox";
import { LOG_FILE, type LogEvent } from "#src/kernel/log.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isNumber } from "#src/meta/json-shape.ts";
import { dirname, isAbsolute, join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { pooled } from "#src/meta/pool.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { asked, answerOf } from "./hosts.ts";
import { type Host, hostNamed, hostsOf } from "./host-config.ts";
import { quoted, rsync, sideOf, sshScript } from "./host-command.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { hold, release } from "./holder.ts";
import {
  ARCHIVE,
  archiveOf,
  HERE,
  keepers,
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
  /** Whether a keeper held it there; false from a host whose tree sends none. */
  readonly kept: boolean;
  readonly stderr: string | null;
  readonly bytes: number | null;
}

type Depth = "record" | "whole";
const EXCLUDED = ["--exclude=.env", "--exclude=.env.*", "--exclude=*.env", "--exclude=auth.json"];
/** Folders of installed packages, caches and built bundles, by name. A harness's `.bundle-snapshots`
 *  were 30 of the 38 MB its states held on 2026-10-08. */
const DERIVED = new Set([
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
// The seed's mark comes too, so a copy of a rehearsal's seed is no paid campaign to a reader: until
// 29 October the gather left it out, and two compare-systems seeds counted as campaigns in a replay.
const RECORD = [
  "--include=/log.jsonl",
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
/** How many copies are refreshed at once. Each is one rsync over the host's shared ssh connection,
 *  which carries ten sessions at most by sshd's default. */
const AT_ONCE = 6;
/** How often a fetch looks again at a copy another fetch holds. */
const WAIT_MS = 200;

/** The text only an opening's line holds. A line that merely quotes it is parsed and passed over. */
const OPENED = `"kind":"campaign.opened"`;

/** Whether a folder of this name, holding these entries, is installed, cached or built: one named so
 *  (`DERIVED`), or a pip target, known by a `.dist-info` in it. Neither a copy of a campaign nor a zip
 *  holds one, since the log names what was installed and nothing here reads the packages. */
export const derived = (name: string, entries: readonly string[]): boolean =>
  DERIVED.has(name) || entries.some((entry) => entry.endsWith(".dist-info"));

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

/** The files and links of a remote folder, each by its path from it, in byte order. */
async function filesOf(host: Host, folder: string): Promise<string[]> {
  const listed = await runTextOrThrow(sshScript(host, `cd ${quoted(folder)} && find . ! -type d -print0`));
  return listed
    .split("\0")
    .filter((path) => path.startsWith("./"))
    .map((path) => path.slice(2))
    .toSorted();
}

/** The folders among a campaign's `paths` that a copy leaves on its host (`derived`), each the
 *  outermost such folder: the packages a harness or the Examiner installed, and caches. On
 *  12 November they were 25.1 of the 27.7 GB that 69 whole copies of one runner held here, in tool
 *  trees copied again at each freeze. A copy therefore opens as no harness (`keptAs` refuses a kept
 *  state short of its programs), which a copy never did: a campaign runs on from its original. */
function installs(paths: readonly string[]): string[] {
  const found = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    const at = parts.findIndex(
      (part, index) => index + 1 < parts.length && derived(part, parts.slice(index + 1, index + 2)),
    );
    if (at !== -1) found.add(parts.slice(0, at + 1).join("/"));
  }
  const outer = [...found].toSorted();
  return outer.filter((folder) => !outer.some((other) => folder.startsWith(`${other}/`)));
}

/** The files among `paths` that a disk which folds case cannot hold beside another named the same
 *  but for case: all of each such group but its last in byte order, the most lower-case, to which
 *  `terminfo`'s upper-case aliases link. Until 10 November 4 of 118 whole copies of the Linux host
 *  failed every night: `N/NCR260VT300WPP`, a link to `../n/ncr260vt300wpp`, became a link to itself
 *  here, and an Examiner's `w/t1.py` beside its `w/T1.py` aborted rsync. */
function caseTwins(paths: readonly string[]): string[] {
  const last = new Map(paths.map((path) => [path.toLowerCase(), path]));
  return paths.filter((path) => last.get(path.toLowerCase()) !== path);
}

/** The rsync flag that leaves one path of the copied folder where it is. */
const leaving = (path: string): string => `--exclude=/${path.replaceAll(/[*?[]/gu, String.raw`\$&`)}`;

/** Refresh one copy under its holder (`holder.ts`), which a fetch keeps however long it transfers and
 *  the next takes over once its process is gone. The stage sits beside the holder, so a fetch killed
 *  part way leaves it where the next one finds it: a copy set aside is put back, and the rest goes. */
async function refresh(run: RemoteRun, into: string, host: Host, depth: Depth): Promise<string> {
  // A log only grows, so a record copy of the size the catalogue states has nothing to gain.
  const held = join(into, LOG_FILE);
  if (depth === "record" && run.bytes !== null && existsSync(held) && lstatSync(held).size === run.bytes) {
    keepObservation(into, { open: run.open, kept: run.kept, stderr: run.stderr });
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
    const paths = depth === "whole" ? await filesOf(host, dirname(run.path)) : [];
    const left = installs(paths);
    const twins = existsSync(dirname(into).toUpperCase())
      ? caseTwins(paths.filter((path) => !left.some((install) => path.startsWith(`${install}/`))))
      : [];
    if (twins.length > 0) {
      console.log(
        `${run.name}: ${String(twins.length)} paths named as another but for case stay on ${host.name} alone`,
      );
    }
    await rsync(
      `${sideOf(host, dirname(run.path))}/`,
      `${folder}/`,
      ...reused,
      ...EXCLUDED,
      ...left.map((install) => leaving(`${install}/`)),
      ...twins.map(leaving),
      ...(depth === "record" ? RECORD : []),
    );
    const log = join(folder, LOG_FILE);
    if (!lstatSync(log).isFile()) throw new Error(`${run.name}: the copied log is not a regular file`);
    // link-dest may have linked an unchanged log to the previous copy. Replace its inode.
    const whole = join(stage, "whole-log");
    await Bun.write(whole, wholeLines(log));
    renameSync(whole, log);
    keepObservation(folder, { open: run.open, kept: run.kept, stderr: run.stderr });
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
    readonly depth?: Depth;
    /** Only the campaigns no process writes, which a copy can hold whole without moving under it. */
    readonly closed?: boolean;
  } = {},
): Promise<string[]> {
  const repo = runtimeProcess.cwd();
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
        .filter((run) => matches(run.name) && (options.closed !== true || !(run.open || run.kept)))
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
  // One copy that fails holds up no other, and the read still fails once the rest are in: until 10
  // November one aborted rsync started no further copy of its host.
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

/**
 * Take over the campaigns `host` has retired, the host being the one `ABLATION_HOST` names: each
 * that its own retire has moved into its archive, which no process writes or keeps there and of
 * which this machine holds every file a copy takes byte for byte, joins this machine's own archive,
 * and the original is deleted there, so that the host stays clear for ablations. Nothing else
 * deletes an original. That host's retire stays the one owner of when a campaign is finished (idle
 * for a day, `archiveIdle`, retire.ts): a log's ending would be a second one and a poor one, since
 * of the 69 campaigns one runner held on 12 November 10 ended in an ending and the rest were
 * stopped where they stood. A campaign still in its worktree there, which a `continue` can go on
 * with, is left alone. The proof
 * is one checksummed dry run of rsync, which names every path the copy lacks or holds differently,
 * so a campaign with a path left on its host for its case (`caseTwins`) stays there, named; a
 * credential file and what was installed there are never copied (`EXCLUDED`, `installs`) and go
 * with the original, so a campaign taken over is a record and runs no further. The copy moves
 * first, so a sweep killed before the deletion is finished by the next one, and the deletion runs
 * only while the log there is as long as the catalogue said: one that grew stays, and its copy is
 * the host's again. A deletion that fails part way leaves the copy this machine's own, since it is
 * then the one copy and a later refresh from what is left must not replace it. Asked to
 * `describe`, it says what it would do.
 */
export async function takeRetired(host: Host, act: "take" | "describe"): Promise<void> {
  const archive = archiveOf(runtimeProcess.cwd());
  const [answer] = await asked(["catalogue"], [host]);
  const failed: string[] = [];
  for (const run of remoteRuns(answer?.lines ?? null, host)) {
    const from = dirname(run.path);
    const copy = join(archive, host.name, run.name);
    const own = join(archive, HERE, run.name);
    const held = [own, copy].find((folder) => existsSync(join(folder, LOG_FILE)));
    const retired = run.path.endsWith(`/${join(ARCHIVE, HERE, run.name, LOG_FILE)}`);
    if (!retired || run.open || run.kept || run.bytes === null || held === undefined) continue;
    try {
      const differing = (
        await rsync(
          `${sideOf(host, from)}/`,
          `${held}/`,
          "-n",
          "-c",
          "--itemize-changes",
          ...EXCLUDED,
          ...installs(await filesOf(host, from)).map((folder) => leaving(`${folder}/`)),
        )
      )
        .split("\n")
        // A line that opens with a point names a path whose times or modes alone differ.
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
