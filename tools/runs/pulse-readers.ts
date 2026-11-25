/**
 * What one look of the pulse adds from the deterministic readers (`READERS`,
 * `tools/wri/derive.ts`), by moment. A pass runs a reader on a log only once a moment it serves
 * lies past what it read (`tools/wri/pass.ts`), since running every reader on every moved log would
 * take many times as long.
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
import { dropCutWrites, held, hold, release } from "#src/meta/holder.ts";

/** The hook kills a look at 40 s, a peer's answer is awaited for 30 s, and a look reads for 2 to 4
 *  s besides. */
const WAIT_MS = 20_000;
/** A reader's collector takes about 1.5 cores, so at most 0.6 is added to the one-minute load. */
const PASS_MS = 30_000;
/** Below the wake's 290 s, so one observer has a pass at every look. */
const GAP_MS = 240_000;
const STALE_MS = 7 * 24 * 60 * 60_000;
const CUT_OBSERVER = /\.json(?:\.pending)?\.(\d+)\.tmp$/;
const POLL_MS = 200;
const LOCK = "pass.lock";
const LAST = "pass.json";
const ERRORS = "pass.err";
const LIST = "readers.json";
const MAX_LOGGED_LINES = 400;

const PER_READER = 3;
const PER_RUN = 12;
export const PER_LOOK = 30;

const FAILED = "the last pass failed";

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

interface Listed {
  readonly name: string;
  readonly at?: readonly EventKind[];
  readonly gist?: RegExp;
}

export interface Moment {
  readonly kind: EventKind;
  readonly session?: string;
  readonly harness?: string;
  readonly size: number;
  readonly left?: readonly string[];
}

interface Ask {
  readonly log: string;
  readonly size: number;
  readonly fresh: readonly LogEvent[];
  readonly owed: readonly Moment[] | undefined;
}

interface ReadersAsked extends Ask {
  readonly store: string;
  readonly said: readonly string[] | undefined;
  readonly files: string;
  readonly spare: number;
  readonly watched: ReadonlySet<string>;
}

interface Found {
  readonly reader: string;
  readonly at: number | null;
  readonly label: string;
  readonly line: string;
  readonly hash: string;
}

const TRIGGER_LINE = /^([A-Z][A-Z0-9 -]*[A-Z0-9]) \(lane (\d+)\): (.*)$/;

export const storeOf = (cwd: string): string => join(mainTree(cwd), ".ana", "pulse", "moments");
export const folderOf = (store: string, log: string) => join(store, sha256(log).slice(0, 16));
const short = (line: string) => line.replaceAll(/\s+/g, " ").trim().slice(0, 200);
const loadNow = () => loadavg()[0] ?? 0;
const jsonIn = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "null");

export const resultOf = (store: string, log: string, reader: string) =>
  parseJsonAs<ReaderResult | null>(jsonIn(join(folderOf(store, log), `${reader}.json`)));

const lastPass = (store: string) => parseJsonAs<PassEnding | null>(jsonIn(join(store, LAST)));

const textOf = (store: string, log: string, reader: string) =>
  readFileSync(join(folderOf(store, log), `${reader}.txt`), "utf8");

/** Through a file of this process's own, so a reader, a kill or a second writer never finds half of it. */
export function remember(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const beside = `${file}.${String(runtimeProcess.pid)}.tmp`;
  writeFileSync(beside, text);
  renameSync(beside, file);
}

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

/** The host stays a core under the line where a solve waits (`tools/d2/host.ts`), since a reader
 *  may take one. */
export const room = (load = loadNow(), cores = availableParallelism()): boolean => load + 1 <= cores;

export function endPass(store: string, ended: PassEnding["ended"]): void {
  remember(join(store, LAST), capturedJsonStringify({ at: Date.now(), ended } satisfies PassEnding));
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    const folder = join(store, entry.name);
    if (entry.isDirectory() && Date.now() - statSync(folder).mtimeMs > STALE_MS) {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}

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

/** The timer goes with the answer, since one left running would hold a finished look's process open. */
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

function leftOf(store: string, log: string, moment: Moment, listed: readonly Listed[]): string[] {
  const asked =
    moment.left ?? listed.flatMap(({ name, at }) => (at?.includes(moment.kind) === true ? [name] : []));
  return asked.filter((name) => (resultOf(store, log, name)?.size ?? -1) < moment.size);
}

function unread(store: string, ask: Ask, listed: readonly Listed[]): boolean {
  const moments = [
    ...momentsIn(ask.fresh, ask.size, listed).map(({ moment }) => moment),
    ...(ask.owed ?? []),
  ];
  if (listed.length === 0) return moments.length > 0;
  return moments.some((moment) => leftOf(store, ask.log, moment, listed).length > 0);
}

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
    await withinDeadline(pass.exited, waitMs);
  }
  while (held(join(store, LOCK)) && performance.now() < deadline) await Bun.sleep(POLL_MS);
}

function whyNot(store: string): string {
  const errors = join(store, ERRORS);
  const last = lastPass(store);
  const standing = existsSync(errors) && statSync(errors).mtimeMs > (last?.at ?? 0);
  const failed = standing ? readFileSync(errors, "utf8").trim().split("\n").at(-1) : "";
  if (failed !== undefined && failed !== "") return `${FAILED}: ${short(failed)}`;
  if (held(join(store, LOCK))) return "a pass is still reading, and what it finishes comes to the next look";
  if (!room()) return `shed for the load, ${loadNow().toFixed(1)} of ${String(availableParallelism())} cores`;
  if (last === null) return "no pass has finished on this host";
  const at = new Date(last.at).toISOString().slice(11, 16);
  if (last.ended === "load") return `the pass of ${at}Z stopped for the load`;
  if (last.ended === "budget") return `the pass of ${at}Z ended at its limit of ${String(PASS_MS / 1000)} s`;
  return `the last pass ended at ${at}Z, and passes rest ${String(GAP_MS / 60_000)} minutes`;
}

const labelOf = ({ kind, session, harness }: Moment) => [kind, session, harness].filter(Boolean).join(" ");

function ownPart(line: string, named: RegExp): string {
  const parts = (TRIGGER_LINE.exec(line)?.[3] ?? "").split(/(?:; | · )(?=[a-z]-\d+\b)/);
  const mine = parts.filter((part) => named.test(part));
  const counted = parts.length > 1 && parts.every((part) => /^[a-z]-\d+\b/.test(part));
  return counted && mine.length > 0 ? `${line.slice(0, line.indexOf("): ") + 3)}${mine.join("; ")}` : line;
}

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
  return picked.map((line) => `◆ ${reader.name}: ${short(ownPart(line, named))}`);
}

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

export function formatReaderLines(asked: ReadersAsked) {
  const { store, log, size, files } = asked;
  const listed = readersIn(store);
  const said = new Set(asked.said);
  const found: Found[] = [];
  const named: Moment[] = [];
  const owed: Moment[] = [];
  const earlier = (asked.owed ?? []).map((moment) => ({ moment, at: null }));
  const moments = [...momentsIn(asked.fresh, size, listed), ...earlier];
  // A gist picks from what a reader read last, so an overtaken moment reads without `at`: an owed
  // `comparison.started` would otherwise say the next comparison's draw as its own.
  const plain = listed.map(({ name, at }) => ({ name, ...keyIfDefined("at", at) }));
  const overtaken = (one: Moment) =>
    moments.some(({ moment }) => moment.kind === one.kind && moment.size > one.size);
  for (const { moment, at } of moments) {
    const readers = overtaken(moment) ? plain : listed;
    const one = listed.length === 0 ? { found: [], left: moment.left } : foundOf(asked, moment, at, readers);
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
  const remembered = [...(asked.said ?? []), ...shown.map(({ hash }) => hash)].slice(-MAX_LOGGED_LINES);
  return { placed, lines, owed, said: remembered };
}

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

/** Drops the files of observers gone for a week, beside a peer's `--state`, and each that
 *  `remember` left half written when a kill took its writer. */
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
