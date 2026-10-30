/**
 * Read remote campaigns through the local readers (22 October 2026). One catalogue lists each
 * machine's originals, including its archive. One transfer owner refreshes copies in the existing
 * archive. Copies never become runnable campaigns. Fetch, WRI, view, source and replay used to
 * disagree on discovery, and an old fetched copy could silently stand for a growing remote log.
 * A failed transfer leaves the previous copy intact and refuses the read. Only whole log lines
 * are published. The catalogue states each log's size, and a record refresh skips a copy that
 * already has it, so the ten-minute gather of 28 October copies only campaigns that moved. No credential file is copied and rsync never follows a link.
 */
import { LOG_FILE, type LogEvent } from "#src/kernel/log.ts";
import { openingOf } from "#src/campaign/opening.ts";
import {
  closeSync,
  existsSync,
  lockExclusiveSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString, isBoolean, isNumber } from "#src/meta/json-shape.ts";
import { dirname, isAbsolute, join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { asked } from "./hosts.ts";
import { type Host, hostNamed, hostsOf } from "./host-config.ts";
import { quoted, rsync } from "./host-command.ts";
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
let fetching = Promise.resolve();

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

/** Lock a stable directory through transfer and publication, released on close or a crash.
 *  Deleting the directory would let a stale reader bypass the next holder's lock. */
async function refresh(run: RemoteRun, host: Host, repo: string, depth: Depth): Promise<string> {
  const into = archiveOf(repo, host.name, run.name);
  // A log only grows, so a record copy of the size the catalogue states has nothing to gain.
  const held = join(into, LOG_FILE);
  if (depth === "record" && run.bytes !== null && existsSync(held) && lstatSync(held).size === run.bytes) {
    await keepObservation(into, { open: run.open, stderr: run.stderr });
    return held;
  }
  mkdirSync(dirname(into), { recursive: true });
  const lock = join(dirname(into), `.fetch-${run.name}.lock`);
  mkdirSync(lock, { recursive: true });
  const stage = mkdtempSync(join(dirname(into), ".fetch-"));
  const folder = join(stage, "campaign");
  const previous = join(stage, "previous");
  let published = false;
  const fd = openSync(lock, "r");
  try {
    lockExclusiveSync(fd);
    mkdirSync(folder);
    const reused = existsSync(into) ? [`--link-dest=${into}`] : [];
    // A record refresh keeps any previously fetched artefacts. A whole refresh replaces them.
    if (depth === "record" && existsSync(into)) rsync(`${into}/`, `${folder}/`, ...reused, ...EXCLUDED);
    rsync(
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
    closeSync(fd);
    if (published || !existsSync(previous)) rmSync(stage, { recursive: true, force: true });
    else console.error(`${run.name}: the previous copy is kept in ${previous}`);
  }
}

/** Queue this process's refreshes so a blocking lock wait cannot strand an asynchronous holder. */
function bring(run: RemoteRun, host: Host, repo: string, depth: Depth): Promise<string> {
  const next = fetching.then(() => refresh(run, host, repo, depth));
  fetching = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Refresh matching remote campaigns. Exact discovery is used by one-run readers; collections
 *  use the CLI's substring matching. A missing host refuses the read, and so does a name two
 *  machines hold where one run is asked for. A collection leaves out each copy after the first and
 *  says so, since one shared name refused every collection read, the daily retire's among them
 *  (27 October 2026: `sim-truss-live` on two machines refused `runs source --has`). */
export async function syncRuns(
  names: readonly string[],
  options: {
    readonly match?: "exact" | "part";
    readonly from?: string;
    readonly repo?: string;
    readonly depth?: Depth;
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
  const remote = selected.flatMap(({ host, lines }) =>
    remoteRuns(lines, host)
      .filter((run) => matches(run.name))
      .map((run) => ({ host, run })),
  );
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
  const logs: string[] = [];
  for (const { host, run } of kept) logs.push(await bring(run, host, repo, options.depth ?? "whole"));
  return logs;
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

/** Shared by WRI and skill scripts: explicit paths stay explicit; campaign names reach all hosts. */
export async function logAcross(named: string): Promise<string> {
  return existsSync(named) ? named : (await readAcross(named, "whole")).path;
}
