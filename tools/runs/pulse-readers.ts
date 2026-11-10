/**
 * What one look of the pulse adds from the deterministic readers (`READERS`, `tools/wri/derive.ts`), by
 * moment: a comparison's report, a promotion, an Examiner's or Builder's end, a campaign's opening or
 * ending. Each reader names the moments its answer serves (`at`), a pass runs it on a log only once
 * one lies past what it read (`tools/wri/pass.ts`), and a look says, under the event, the lines of its
 * text that name the moment's session or harness (or its `gist` where none does). A reader's answer
 * between moments repeats what a look said with another count: until 10 November every reader ran on
 * every log that moved, and on the largest closed log the 27 readers without the embedding model took
 * 277 s against a pass of 30 s.
 *
 * Three limits shape it, and each is measured or tested rather than assumed.
 *
 * The look must not slow a campaign. A solve waits in its queue for the one-minute load
 * (`tools/d2/host.ts`) and a deadline counts elapsed time, so a pass is one process a host at the
 * lowest priority, one reader at a time, at most `PASS_MS` once in `GAP_MS` however many observers
 * look, each reader only where the load leaves it room (`room`), and none at all where a look's new
 * events hold no moment not yet read.
 *
 * The hook's `timeout 40` kills a look's whole process group. So the pass runs in a session of its
 * own and outlives the look that started it (`startPass`): a look waits for it at most `WAIT_MS`, and
 * what the pass still finishes is there for the next look. Each result lands by a rename, so a kill
 * leaves no half of one.
 *
 * A skipped reader must never read as nothing new. A moment whose readers have not read it is kept in
 * the observer's memory (`Moment`), named once with the reason the store gives (`whyNot`), keeps a
 * closed run in the looks, and its lines are said at the look that finds them.
 *
 * The output holds hidden values as the log does. The store lies under the main worktree's `.ana/`,
 * closed to every seat as the repository and its worktrees are, and an observer's files lie beside its
 * `--state`, in `.ana/` or the host's temporary folder, also closed (`src/wall/isolation.ts`).
 * `test/runs-pulse-readers.test.ts` tries to read both through the wall.
 */
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { sha256 } from "#src/meta/digest.ts";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { mainTree } from "#src/meta/git.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { dropCutWrites, held, hold, release } from "./holder.ts";

/** How long a look waits for the pass. The hook kills a look at 40 s, a peer's answer is awaited for
 *  30 s, and a look has its own 2 to 4 s of reading besides. */
const WAIT_MS = 20_000;
/** The most one pass runs. A reader's collector takes about 1.5 cores, so at most 0.6 is added to the
 *  one-minute load. */
const PASS_MS = 30_000;
/** The least between one pass's end and the next one's start on a host. Below the wake's 290 s, so
 *  one observer has a pass at every look, and several share one. */
const GAP_MS = 240_000;
/** A store folder or an observer's files untouched this long go. */
const STALE_MS = 7 * 24 * 60 * 60_000;
/** What `remember` writes an observer's file through, named by its writer's pid. */
const CUT_OBSERVER = /\.json(?:\.pending)?\.(\d+)\.tmp$/;
const POLL_MS = 200;
const LOCK = "pass.lock";
const LAST = "pass.json";
const ERRORS = "pass.err";
const LIST = "readers.json";
/** The lines an observer remembers having said, enough for some days of moments. */
const SAID_KEPT = 400;

/** The most lines a look says of one reader on a moment, of one run and of one host. */
const PER_READER = 3;
const PER_RUN = 12;
export const PER_LOOK = 30;

/** How the one reason for an unread moment that is something to look at begins. */
const FAILED = "the last pass failed";

/** What the store holds of one reader on one log. `size` is the log's bytes it read, -1 where none
 *  finished, and `at` when it last ran. */
interface ReaderResult {
  readonly size: number;
  readonly at: number;
  readonly ms: number;
  readonly ok: boolean;
}

interface PassEnding {
  readonly at: number;
  readonly ended: "finished" | "budget" | "load";
}

/** A reader as the pass lists it for the looks, which read no helper. */
interface Listed {
  readonly name: string;
  readonly at?: readonly EventKind[];
  readonly gist?: RegExp;
}

/** An event a reader answers, as an observer remembers it until its readers have read it: `size` is
 *  the log's bytes at the look that saw it, and `left` the readers that had not, all of its kind's
 *  where no list was on record. */
export interface Moment {
  readonly kind: EventKind;
  readonly session?: string;
  readonly harness?: string;
  readonly size: number;
  readonly left?: readonly string[];
}

/** One look's ask of the pass: a log, its bytes now, its new events and the moments still owed. */
interface Ask {
  readonly log: string;
  readonly size: number;
  readonly fresh: readonly LogEvent[];
  readonly owed: readonly Moment[] | undefined;
}

interface ReadersAsked extends Ask {
  readonly store: string;
  /** The hashes of the lines this observer has said. */
  readonly said: readonly string[] | undefined;
  /** Where this observer's copies of the full text go, one folder a run. */
  readonly files: string;
  /** How many more lines this look may say of the readers. */
  readonly spare: number;
  /** The triggers the look says itself, by name. */
  readonly watched: ReadonlySet<string>;
}

/** One line a reader has for a moment; `at` is its event's place among the new ones, null for an
 *  owed moment. */
interface Found {
  readonly reader: string;
  readonly at: number | null;
  readonly label: string;
  readonly line: string;
  readonly hash: string;
}

/** One of the investigation's triggers as its command prints it: `NAME (lane N): detail`. */
const TRIGGER_LINE = /^([A-Z][A-Z0-9 -]*[A-Z0-9]) \(lane (\d+)\): (.*)$/;

export const storeOf = (cwd: string): string => join(mainTree(cwd), ".ana", "pulse", "moments");
export const folderOf = (store: string, log: string) => join(store, sha256(log).slice(0, 16));
/** A reader's line with its columns one space apart, cut at 200 characters: a rejection's row under
 *  a campaign name of 53 runs to 167, and its last column says whether the task is set aside. */
const short = (line: string) => line.replaceAll(/\s+/g, " ").trim().slice(0, 200);
const loadNow = () => loadavg()[0] ?? 0;
/** A stored file's JSON, `null` where there is none. */
const jsonIn = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "null");

/** One reader's stored result on `log`, or null where it never ran. */
export const resultOf = (store: string, log: string, reader: string) =>
  parseJsonAs<ReaderResult | null>(jsonIn(join(folderOf(store, log), `${reader}.json`)));

const lastPass = (store: string) => parseJsonAs<PassEnding | null>(jsonIn(join(store, LAST)));

const textOf = (store: string, log: string, reader: string) =>
  readFileSync(join(folderOf(store, log), `${reader}.txt`), "utf8");

/** Written beside its place and renamed, through a file of this process's own, so a reader, a kill
 *  or a second writer never finds half of it: until 9 November a look's state went through one
 *  shared file, and two looks renamed each other's half-written one into place. */
export function remember(file: string, text: string): void {
  // A checkout no campaign ran in has no `.ana/`, as the Linux runner's had none on 20 October.
  mkdirSync(dirname(file), { recursive: true });
  const beside = `${file}.${String(runtimeProcess.pid)}.tmp`;
  writeFileSync(beside, text);
  renameSync(beside, file);
}

/** Keep what a reader said of `log`: its text only where it finished, since a cut says nothing. */
export function keepResult(
  store: string,
  log: string,
  reader: string,
  result: ReaderResult,
  text: string | null,
): void {
  const folder = folderOf(store, log);
  mkdirSync(folder, { recursive: true });
  if (text !== null) remember(join(folder, `${reader}.txt`), text);
  remember(join(folder, `${reader}.json`), capturedJsonStringify(result));
}

/** The readers a pass runs, with their moments and gists, kept for the looks. */
export function keepReaders(store: string, listed: readonly Listed[]): void {
  const named = listed.flatMap(({ name, at, gist }) =>
    at === undefined ? [] : [{ name, at, gist: gist?.source ?? null }],
  );
  remember(join(store, LIST), capturedJsonStringify(named));
}

function readersIn(store: string): readonly Listed[] {
  const named = parseJsonAs<readonly { name: string; at: EventKind[]; gist: string | null }[] | null>(
    jsonIn(join(store, LIST)),
  );
  return (named ?? []).map(({ name, at, gist }) => ({
    name,
    at,
    ...keyIfDefined("gist", gist === null ? undefined : new RegExp(gist)),
  }));
}

/** Whether another reader may start: the host stays a core under the line where a solve waits
 *  (`tools/d2/host.ts`), since a reader may take one. */
export const room = (load = loadNow(), cores = availableParallelism()): boolean => load + 1 <= cores;

/** Record how a pass ended, and drop the results of logs no look has moved for a week. */
export function endPass(store: string, ended: PassEnding["ended"]): void {
  remember(join(store, LAST), capturedJsonStringify({ at: Date.now(), ended } satisfies PassEnding));
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    const folder = join(store, entry.name);
    if (entry.isDirectory() && Date.now() - statSync(folder).mtimeMs > STALE_MS) {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}

/** What `run` answers under the host's lock, held while this process lives however long it reads, or
 *  null where another holds it. */
export async function underLock<T>(store: string, run: () => Promise<T>): Promise<T | null> {
  mkdirSync(store, { recursive: true });
  const lock = join(store, LOCK);
  if (!hold(lock)) return null;
  try {
    return await run();
  } finally {
    release(lock);
  }
}

/** What `ask` answers within `ms`, and null after that. The timer goes with the answer, since one left
 *  running would hold a finished look's process until it fired. */
export async function withinDeadline<T>(ask: Promise<T>, ms: number): Promise<T | null> {
  const late = Promise.withResolvers<null>();
  const timer = setTimeout(
    () => {
      late.resolve(null);
    },
    Math.max(0, ms),
  );
  try {
    return await Promise.race([ask, late.promise]);
  } finally {
    clearTimeout(timer);
  }
}

/** The moments among `fresh`, read at `size` bytes: every event of a kind a listed reader names, and
 *  with no list on record yet the last event, which the first pass then names. */
function momentsIn(fresh: readonly LogEvent[], size: number, listed: readonly Listed[]) {
  const kinds = new Set(listed.flatMap(({ at }) => at ?? []));
  const chosen =
    listed.length === 0
      ? fresh.slice(-1).map((event) => ({ event, at: fresh.length - 1 }))
      : fresh.flatMap((event, at) => (kinds.has(event.kind) ? [{ event, at }] : []));
  return chosen.map(({ event: { kind, data }, at }) => {
    const harness =
      kind === "harness.promoted" && isString(data.harness) ? data.harness.slice(0, 8) : undefined;
    const moment: Moment = {
      kind,
      ...keyIfDefined("session", isString(data.session) ? data.session : undefined),
      ...keyIfDefined("harness", harness),
      size,
    };
    return { moment, at };
  });
}

/** The listed readers a moment waits on: those of its kind that have not read to its size. */
function leftOf(store: string, log: string, moment: Moment, listed: readonly Listed[]): string[] {
  const asked =
    moment.left ?? listed.flatMap(({ name, at }) => (at?.includes(moment.kind) === true ? [name] : []));
  return asked.filter((name) => (resultOf(store, log, name)?.size ?? -1) < moment.size);
}

/** Whether `ask` holds a moment some reader has not read. With no list on record, any moment does. */
function unread(store: string, ask: Ask, listed: readonly Listed[]): boolean {
  const moments = [
    ...momentsIn(ask.fresh, ask.size, listed).map(({ moment }) => moment),
    ...(ask.owed ?? []),
  ];
  if (listed.length === 0) return moments.length > 0;
  return moments.some((moment) => leftOf(store, ask.log, moment, listed).length > 0);
}

/**
 * Start a pass over the logs whose asks hold a moment not yet read, in a session of its own, and wait
 * for it, or for the host's running one, at most `waitMs`; with no such moment, neither. It is
 * `tools/wri/pass.ts` by its command: production imports no helper (`AGENTS.md`, section 12).
 */
export async function startPass(
  store: string,
  asks: readonly Ask[],
  { tree, waitMs = WAIT_MS, roomNow = room }: { tree: string; waitMs?: number; roomNow?: () => boolean },
): Promise<void> {
  const listed = readersIn(store);
  const logs = asks.flatMap((ask) => (unread(store, ask, listed) ? [ask.log] : []));
  if (logs.length === 0) return;
  const deadline = performance.now() + waitMs;
  mkdirSync(store, { recursive: true });
  const last = lastPass(store);
  const rested = last === null || Date.now() - last.at >= GAP_MS;
  if (rested && roomNow() && !held(join(store, LOCK))) {
    const { PATH, HOME } = runtimeProcess.env;
    const pass = capturedSpawn(
      [
        "/usr/bin/nice",
        "-n",
        "19",
        capturedExecPath,
        join(tree, "tools", "wri", "pass.ts"),
        "--store",
        store,
        "--budget",
        String(PASS_MS),
        ...logs,
      ],
      {
        cwd: tree,
        detached: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: Bun.file(join(store, ERRORS)),
        env: { ...keyIfDefined("PATH", PATH), ...keyIfDefined("HOME", HOME), ANA_HOP: "1" },
      },
    );
    pass.unref();
    // Until it holds the lock, which a loaded host may take a moment over, only its ending says.
    await withinDeadline(pass.exited, waitMs);
  }
  while (held(join(store, LOCK)) && performance.now() < deadline) await Bun.sleep(POLL_MS);
}

/** Why a moment's readers are behind, in the terms of what a look can see now. */
function whyNot(store: string): string {
  // What a pass printed on stderr is what is left of one that could not run, until a later pass
  // ends: a pass that prints nothing leaves the file as it was, so on 6 November a look called the
  // pass of 08:19 the last one for hours after others had ended.
  const errors = join(store, ERRORS);
  const last = lastPass(store);
  const standing = existsSync(errors) && statSync(errors).mtimeMs > (last?.at ?? 0);
  const failed = standing ? readFileSync(errors, "utf8").trim().split("\n").at(-1) : "";
  if (failed !== undefined && failed !== "") return `${FAILED}: ${short(failed)}`;
  if (held(join(store, LOCK))) return "a pass is still reading, and what it finishes comes to the next look";
  // The load before the rest: with room a look starts a pass, so one that started none had none.
  if (!room()) return `shed for the load, ${loadNow().toFixed(1)} of ${String(availableParallelism())} cores`;
  if (last === null) return "no pass has finished on this host";
  const at = new Date(last.at).toISOString().slice(11, 16);
  if (last.ended === "load") return `the pass of ${at}Z stopped for the load`;
  if (last.ended === "budget") return `the pass of ${at}Z ended at its limit of ${String(PASS_MS / 1000)} s`;
  return `the last pass ended at ${at}Z, and passes rest ${String(GAP_MS / 60_000)} minutes`;
}

const labelOf = ({ kind, session, harness }: Moment) => [kind, session, harness].filter(Boolean).join(" ");

/** The lines of `reader`'s text on `moment`: a failure's last line, else those naming its session or
 *  harness, else those its gist picks, leaving out a trigger the look says itself. */
function linesOf(asked: ReadersAsked, reader: Listed, moment: Moment): string[] {
  const result = resultOf(asked.store, asked.log, reader.name);
  const lines = textOf(asked.store, asked.log, reader.name)
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (result?.ok !== true) return [`⚠ ${reader.name} failed: ${short(lines.at(-1) ?? "no output")}`];
  const own = lines.filter((line) => !asked.watched.has(TRIGGER_LINE.exec(line)?.[1] ?? ""));
  const bare = moment.session?.replaceAll(/[^\w-]/g, "");
  const session = bare === "" ? undefined : bare;
  const named = new RegExp(`(?<![\\w-])${session ?? String.raw`\0`}(?![\\w-]*\\d)`);
  const naming = own.filter(
    (line) =>
      (session !== undefined && named.test(line)) ||
      (moment.harness !== undefined && line.includes(moment.harness)),
  );
  const gist = reader.gist;
  const picked = naming.length > 0 || gist === undefined ? naming : own.filter((line) => gist.test(line));
  return picked.map((line) => `◆ ${reader.name}: ${short(line)}`);
}

/** What each reader that has read `moment` says of it, at most `PER_READER` each, and who has not. */
function foundOf(asked: ReadersAsked, moment: Moment, at: number | null, listed: readonly Listed[]) {
  const left = leftOf(asked.store, asked.log, moment, listed);
  const label = labelOf(moment);
  const readers = listed.filter(
    ({ name, at: kinds }) =>
      (moment.left?.includes(name) ?? kinds?.includes(moment.kind) === true) && !left.includes(name),
  );
  const found = readers.flatMap((reader) =>
    linesOf(asked, reader, moment).map((line) => ({
      reader: reader.name,
      at,
      label,
      line,
      hash: sha256(line).slice(0, 8),
    })),
  );
  return { found, left };
}

/** The lines `found` may say: each once to this observer, at most `PER_READER` a reader on a moment,
 *  failures first, at most `most` in all; and the rest. */
function bounded(found: readonly Found[], said: ReadonlySet<string>, most: number) {
  const fresh = found.filter(
    ({ hash }, at) => !said.has(hash) && found.findIndex((other) => other.hash === hash) === at,
  );
  const perReader = fresh.filter(
    (one, at) =>
      fresh.slice(0, at).filter(({ reader, label }) => reader === one.reader && label === one.label).length <
      PER_READER,
  );
  const ordered = perReader.toSorted(
    (one, other) => Number(other.line.startsWith("⚠")) - Number(one.line.startsWith("⚠")),
  );
  const shown = ordered.slice(0, most);
  const over = fresh.filter((one) => !shown.includes(one));
  return { shown, over };
}

/**
 * What the readers add to one look at one run: under each new moment the lines of the readers that
 * have read it, after them those of moments owed from earlier looks that a reader has now read, the
 * folder that holds the full text, and the moments not read yet, named once. A line is said once to an
 * observer, whichever moment asks for it again.
 */
export function readersSaid(asked: ReadersAsked) {
  const { store, log, size, files } = asked;
  const listed = readersIn(store);
  const said = new Set(asked.said);
  const found: Found[] = [];
  const named: Moment[] = [];
  const owed: Moment[] = [];
  const earlier = (asked.owed ?? []).map((moment) => ({ moment, at: null }));
  for (const { moment, at } of [...momentsIn(asked.fresh, size, listed), ...earlier]) {
    const one = listed.length === 0 ? { found: [], left: moment.left } : foundOf(asked, moment, at, listed);
    found.push(...one.found);
    if (one.left?.length === 0) continue;
    const kept: Moment = { ...moment, ...keyIfDefined("left", one.left) };
    owed.push(kept);
    if (at !== null) named.push(kept);
  }
  const { shown, over } = bounded(found, said, Math.min(PER_RUN, Math.max(0, asked.spare)));
  const placed = [...new Set(shown.flatMap(({ at }) => (at === null ? [] : [at])))].map((at) => ({
    at,
    lines: shown.filter((one) => one.at === at).map(({ line }) => line),
  }));
  const late = shown
    .filter(({ at }) => at === null)
    .map(({ reader, label, line }) => line.replace(`◆ ${reader}: `, `◆ ${reader} on ${label}: `));
  const texts = new Set(
    [...shown, ...over].filter(({ line }) => line.startsWith("◆")).map(({ reader }) => reader),
  );
  for (const reader of texts) remember(join(files, `${reader}.txt`), textOf(store, log, reader));
  const withheld = [...new Set(over.map(({ reader }) => reader))].join(", ");
  const missing = named.map(
    (moment) => `${moment.left === undefined ? "the readers" : moment.left.join(", ")} of ${labelOf(moment)}`,
  );
  // A moment waiting for its pass is routine, and a pass that failed is the one reason to look:
  // until 10 November every unread moment warned, at each report of every run on every host.
  const why = missing.length > 0 ? whyNot(store) : "";
  const lines = [
    ...late,
    ...(over.length > 0 ? [`◆ ${String(over.length)} more lines, of ${withheld}`] : []),
    ...(shown.some(({ line }) => line.startsWith("◆"))
      ? [`◆ the readers' full text: ${resolve(files)}`]
      : []),
    ...(missing.length > 0
      ? [`${why.startsWith(FAILED) ? "⚠" : "·"} not read yet: ${missing.join(", ")}; ${why}`]
      : []),
  ];
  const remembered = [...(asked.said ?? []), ...shown.map(({ hash }) => hash)].slice(-SAID_KEPT);
  return { placed, lines, owed, said: remembered };
}

/** The investigation's triggers, where the rows have read further than `rowsAt`, and the size they
 *  read to. */
export function alarmsMoved(store: string, log: string, rowsAt: number | undefined) {
  const result = resultOf(store, log, "rows");
  if (result?.ok !== true || result.size <= (rowsAt ?? -1)) return null;
  const alarms = textOf(store, log, "rows")
    .split("\n")
    .flatMap((line) => {
      const [, name = "", lane = "", detail = ""] = TRIGGER_LINE.exec(line) ?? [];
      return name === "" ? [] : [{ name, lane: Number(lane), detail }];
    });
  return { alarms, size: result.size };
}

/** Drop the files of observers gone for a week, beside a peer's `--state`, and each that `remember`
 *  left half written when a kill took its writer. */
export function pruneObservers(state: string, now = Date.now()): void {
  const folder = dirname(resolve(state));
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder)) {
    const file = join(folder, entry);
    if (/\.json(?:\.pending|\.d)?$/.test(entry) && now - statSync(file).mtimeMs > STALE_MS) {
      rmSync(file, { recursive: true, force: true });
    }
  }
  dropCutWrites(folder, CUT_OBSERVER);
}
