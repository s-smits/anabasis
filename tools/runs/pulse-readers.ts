/**
 * What one look of the pulse adds from the deterministic readers (`READERS`, `tools/wri/derive.ts`):
 * every reader run over each run whose log moved, shared between the observers of a host, and of
 * their output only what this observer has not seen. The operator asked for it on 5 November: "we
 * need to classify the new logs that came up in that 300+ seconds", "ALL the scripts for it now".
 *
 * Three limits shape it, and each is measured or tested rather than assumed.
 *
 * The look must not slow a campaign. A solve waits in its queue for the one-minute load
 * (`tools/d2/host.ts`) and a deadline counts elapsed time, so a pass is one process a host at the
 * lowest priority, one reader at a time, at most `PASS_MS` once in `GAP_MS` however many observers
 * look, and each reader starts only where the load leaves it room (`room`). A reader on the largest
 * log takes 0.2 to 3 s and up to 929 MB (measured 5 November), so one at a time limits memory as well.
 * Under load the readers are shed, and said to be.
 *
 * The hook's `timeout 40` kills a look's whole process group. So the pass runs in a session of its
 * own and outlives the look that started it (`startPass`): a look waits for it at most `WAIT_MS`,
 * reads what the store holds and names the rest, and what the pass still finishes is there for the
 * next look. Each result lands by a rename, so a kill leaves no half of one.
 *
 * A skipped reader must never read as nothing new. So what a look says it did not read comes from the
 * store and not from a pass's account of itself (`notRead`): a reader that has read nothing past what
 * this observer's last look saw, on a log that moved since, is named, whatever stopped it.
 *
 * A line fires once. A reader's output is compared by its pattern, with digits and digests masked, as
 * `keyOf` in `pulse.ts` keeps a trigger from firing with each solve: over 57 recorded logs 757 of 784
 * lines of one trigger were the same line with another count, and on 22 October the operator called
 * the routine pulses noise. A line past the most of its pattern seen at once is new and is said at once,
 * so a new row of a table fires though its pattern is known. A line that moved only in a number waits
 * for the first result past a milestone, as a trigger of kind `reading` does. What a wake cuts is in
 * the file it names.
 *
 * The output holds hidden values as the log does. The store lies under the main worktree's `.ana/`,
 * closed to every seat as the repository and its worktrees are, and an observer's files lie beside its
 * `--state`, in `.ana/` or the host's temporary folder, also closed (`src/wall/isolation.ts`).
 * `test/runs-pulse-readers.test.ts` tries to read both through the wall.
 */
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
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { held, hold, release } from "./holder.ts";

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
const POLL_MS = 200;
const LOCK = "pass.lock";
const LAST = "pass.json";
const ERRORS = "pass.err";
const NAMES = "readers.json";

/** The most lines a wake says of one reader, of one run and of one host. My choice, on the replay the
 *  pull request reports. */
const PER_READER = 3;
const PER_RUN = 12;
export const PER_LOOK = 30;

/** What the store holds of one reader on one log. `size` is the log's bytes it read, -1 where none
 *  finished, and `at` when it last ran, which a cut moves too, so it goes to the back of the queue. */
interface ReaderResult {
  readonly size: number;
  readonly at: number;
  readonly ms: number;
  readonly ok: boolean;
}

/** How a pass ended, for the line that names what it left. */
export interface PassEnding {
  readonly at: number;
  readonly ended: "finished" | "budget" | "load";
}

/** What this observer has compared of one reader on one log. */
export interface SaidOf {
  readonly size: number;
  /** The most lines of each pattern seen at once, by the pattern's hash. It never falls. */
  readonly highest: Readonly<Record<string, number>>;
  /** The hash of each line that needs no saying: those of the last result past a milestone, and each
   *  said since. */
  readonly last: readonly string[];
  /** The pattern of the failure last said, so a reader that keeps failing is said to once. */
  readonly failed?: string;
}

/** One of the investigation's triggers of a log. */
export interface Alarm {
  readonly name: string;
  readonly lane: number;
  readonly detail: string;
}

/** One look's reading of one run's readers. */
interface ReadersSaid {
  readonly said: readonly string[];
  readonly seen: Readonly<Record<string, SaidOf>>;
  /** Readers behind the log, which keep a closed run in the looks until they have read it. */
  readonly owed: boolean;
}

interface ReadersAsked {
  readonly store: string;
  readonly log: string;
  /** The log's bytes as this look found them, and as this observer's last look found them. */
  readonly size: number;
  readonly lastSize: number | undefined;
  readonly before: Readonly<Record<string, SaidOf>> | undefined;
  /** The log's bytes at the last look that saw a milestone in its events. */
  readonly milestoneAt: number | undefined;
  /** Where this observer's copies of the full text go, one folder a run. */
  readonly files: string;
  /** How many more lines this look may say of the readers. */
  readonly spare: number;
  /** A line another part of the look says itself. */
  readonly saidElsewhere: (reader: string, line: string) => boolean;
}

/** One of the investigation's triggers as its command prints it: `NAME (lane N): detail`. */
const TRIGGER_LINE = /^([A-Z][A-Z0-9 -]*[A-Z0-9]) \(lane (\d+)\): (.*)$/;
export const triggerNameOf = (line: string): string => TRIGGER_LINE.exec(line)?.[1] ?? "";

export const storeOf = (cwd: string): string => join(mainTree(cwd), ".ana", "pulse", "readers");
export const folderOf = (store: string, log: string) => join(store, sha256(log).slice(0, 16));
const hashOf = (text: string) => sha256(text).slice(0, 8);
const short = (line: string) => line.replaceAll(/\s+/g, " ").trim().slice(0, 160);
const loadNow = () => loadavg()[0] ?? 0;

/** One reader's stored result on `log`, or null where it never ran. */
export function resultOf(store: string, log: string, reader: string): ReaderResult | null {
  const file = join(folderOf(store, log), `${reader}.json`);
  return existsSync(file) ? parseJsonAs<ReaderResult>(readFileSync(file, "utf8")) : null;
}

function lastPass(store: string): PassEnding | null {
  const file = join(store, LAST);
  return existsSync(file) ? parseJsonAs<PassEnding>(readFileSync(file, "utf8")) : null;
}

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

/** The readers a pass runs, kept for the looks, which read no helper. */
export function keepNames(store: string, names: readonly string[]): void {
  remember(join(store, NAMES), capturedJsonStringify(names));
}

function namesIn(store: string): readonly string[] {
  const file = join(store, NAMES);
  return existsSync(file) ? parseJsonAs<readonly string[]>(readFileSync(file, "utf8")) : [];
}

/** Whether another reader may start: the host stays a core under the line where a solve waits
 *  (`tools/d2/host.ts`), since a reader may take one. */
export const room = (load = loadNow(), cores = availableParallelism()): boolean => load + 1 <= cores;

/** Record how a pass ended, and drop the results of logs no look has moved for a week. */
export function endPass(store: string, ended: PassEnding["ended"]): void {
  const ending: PassEnding = { at: Date.now(), ended };
  remember(join(store, LAST), capturedJsonStringify(ending));
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    const folder = join(store, entry.name);
    if (entry.isDirectory() && Date.now() - statSync(folder).mtimeMs > STALE_MS) {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}

/** Whether a lock of the old format, a file holding the pid of a pass from a tree before 9 November,
 *  holds as that tree read it: its pass lives and took it within two `PASS_MS`. Every session's hook
 *  runs the pulse from its own tree against one store, so old and new passes meet; this serves the
 *  switch from the old format and can go once no tree older than this commit runs the pulse. */
function heldOfOld(lock: string): boolean {
  try {
    const { mtimeMs } = statSync(lock);
    runtimeProcess.kill(Number(readFileSync(lock, "utf8")), 0);
    return Date.now() - mtimeMs <= 2 * PASS_MS;
  } catch {
    return false;
  }
}

/** Whether a pass holds the host's lock: one held while its process lives, however long it reads. */
export const passRunning = (store: string): boolean =>
  held(join(store, LOCK)) || heldOfOld(join(store, LOCK));

/** The host's lock, for one pass however many looks started one. */
export function takeLock(store: string): boolean {
  mkdirSync(store, { recursive: true });
  return !heldOfOld(join(store, LOCK)) && hold(join(store, LOCK));
}

export const dropLock = (store: string): void => {
  release(join(store, LOCK));
};

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

/** Whether any reader on `logs` is behind its log. With no names on record yet, every one is. */
function due(store: string, logs: readonly string[]): boolean {
  const names = namesIn(store);
  return (
    names.length === 0 ||
    logs.some((log) => names.some((name) => resultOf(store, log, name)?.size !== statSync(log).size))
  );
}

/**
 * Start a pass over `logs` in a session of its own if the host owes one, and wait for it, or for the
 * host's running one, at most `waitMs`. It is `tools/wri/pass.ts` by its command: production imports
 * no helper (`AGENTS.md`, section 12), the choice a review of 1 November made for `wri.ts read`.
 */
export async function startPass(
  store: string,
  logs: readonly string[],
  {
    tree,
    waitMs = WAIT_MS,
    roomNow = room,
    noEmbed = false,
  }: { tree: string; waitMs?: number; roomNow?: () => boolean; noEmbed?: boolean },
): Promise<void> {
  const deadline = performance.now() + waitMs;
  mkdirSync(store, { recursive: true });
  const last = lastPass(store);
  const rested = last === null || Date.now() - last.at >= GAP_MS;
  if (logs.length > 0 && rested && roomNow() && !passRunning(store) && due(store, logs)) {
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
        ...(noEmbed ? ["--no-embed"] : []),
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
  while (passRunning(store) && performance.now() < deadline) await Bun.sleep(POLL_MS);
}

/** Why a look finds readers behind, in the terms of what it can see now. */
function whyNot(store: string): string {
  // What a pass printed on stderr is what is left of one that could not run, until a later pass
  // ends: a pass that prints nothing leaves the file as it was, so on 6 November a look called the
  // pass of 08:19 the last one for hours after others had ended.
  const errors = join(store, ERRORS);
  const standing = existsSync(errors) && statSync(errors).mtimeMs > (lastPass(store)?.at ?? 0);
  const failed = standing ? readFileSync(errors, "utf8").trim().split("\n").at(-1) : "";
  if (failed !== undefined && failed !== "") return `the last pass failed: ${short(failed)}`;
  if (passRunning(store)) return "a pass is still reading, and what it finishes comes to the next look";
  if (!room()) {
    return `shed for the load, ${loadNow().toFixed(1)} of ${String(availableParallelism())} cores`;
  }
  const last = lastPass(store);
  if (last === null) return "no pass has finished on this host";
  const at = new Date(last.at).toISOString().slice(11, 16);
  if (last.ended === "load") return `the pass of ${at}Z stopped for the load`;
  if (last.ended === "budget") return `the pass of ${at}Z ended at its limit of ${String(PASS_MS / 1000)} s`;
  return `the last pass ended at ${at}Z, and passes rest ${String(GAP_MS / 60_000)} minutes`;
}

/**
 * The readers this look cannot say it read: nothing past what this observer's last look saw, and not
 * at the log's end either. A first look makes no claim, and nor does one whose log has not moved, since
 * it holds no new events and the last look already said so. This reads the store alone, so a kill, a
 * shed, a crash and a pass that never started read alike.
 */
export function notRead(
  store: string,
  log: string,
  names: readonly string[],
  size: number,
  lastSize: number | undefined,
): readonly string[] {
  if (lastSize === undefined || lastSize === size) return [];
  return names.filter((name) => {
    const read = resultOf(store, log, name)?.size ?? -1;
    return read !== size && read <= lastSize;
  });
}

/** Digits, digests and the times they make masked, so a line that moved in a number is one line. */
const patternOf = (line: string) =>
  line.replaceAll(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/g, "#").replaceAll(/\d+(?:\.\d+)?/g, "#");

/**
 * What `lines` say that `before` has not seen. A line it holds is no news. Of the rest, a line past
 * the most of its pattern seen at once is new, the last ones of a pattern first, since a table grows at
 * its end, and any other moved only in a number. The most never falls, so a line that went and came
 * back fires as nothing new. A moved line stays out of what is held until a milestone says it.
 */
export function newsIn(
  lines: readonly string[],
  before: Pick<SaidOf, "highest" | "last"> | undefined,
  { milestone }: { readonly milestone: boolean },
) {
  const known = new Set(before?.last);
  const hashes = lines.map(hashOf);
  const patterns = lines.map((line) => hashOf(patternOf(line)));
  const counts = new Map<string, number>();
  for (const pattern of patterns) counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  const highest: Record<string, number> = { ...before?.highest };
  const spare = new Map<string, number>();
  for (const [pattern, n] of counts) {
    spare.set(pattern, Math.max(0, n - (highest[pattern] ?? 0)));
    highest[pattern] = Math.max(n, highest[pattern] ?? 0);
  }
  const fresh: string[] = [];
  const moved: string[] = [];
  const freshHashes: string[] = [];
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const hash = hashes[at] ?? "";
    if (known.has(hash)) continue;
    const pattern = patterns[at] ?? "";
    const left = spare.get(pattern) ?? 0;
    if (left > 0) {
      spare.set(pattern, left - 1);
      fresh.unshift(lines[at] ?? "");
      freshHashes.push(hash);
    } else {
      moved.unshift(lines[at] ?? "");
    }
  }
  const last = milestone || before === undefined ? hashes : [...new Set([...known, ...freshHashes])];
  return { fresh, moved, highest, last };
}

/** Whether a result of `size` bytes is the first of a reader's to read past a milestone, where a
 *  look saw the log at `at` bytes with one in its events, and the reader had read `was`. */
export const pastMilestone = (at: number | undefined, was: number | undefined, size: number): boolean =>
  at !== undefined && (was ?? -1) < at && size >= at;

/** One reader's lines for the wake, and what to remember of it. */
function oneReader(asked: ReadersAsked, name: string): { said: string[]; seen: SaidOf | undefined } {
  const { store, log, before, milestoneAt, files, saidElsewhere } = asked;
  const result = resultOf(store, log, name);
  const was = before?.[name];
  if (result === null || result.size <= (was?.size ?? -1)) return { said: [], seen: was };
  const text = textOf(store, log, name);
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (!result.ok) {
    const last = short(lines.at(-1) ?? "no output");
    const failed = hashOf(patternOf(last));
    const seen: SaidOf = { ...(was ?? { highest: {}, last: [] }), size: result.size, failed };
    return { said: was?.failed === failed ? [] : [`⚠ ${name} failed: ${last}`], seen };
  }
  const milestone = pastMilestone(milestoneAt, was?.size, result.size);
  const { fresh, moved, highest, last } = newsIn(lines, was, { milestone });
  const seen: SaidOf = { size: result.size, highest, last };
  if (was === undefined) return { said: [], seen };
  const news = [...fresh, ...(milestone ? moved : [])].filter((line) => !saidElsewhere(name, line));
  if (news.length === 0) return { said: [], seen };
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, `${name}.txt`), text);
  const more = news.length - PER_READER;
  return {
    said: [
      ...news.slice(0, PER_READER).map((line) => `◆ ${name}: ${short(line)}`),
      ...(more > 0 ? [`◆ ${name}: ${String(more)} more`] : []),
    ],
    seen,
  };
}

/**
 * What the readers add to one look at one run: what they said that this observer has not seen, with
 * the folder that holds the full text, and which of them it cannot say it read. A reader's first
 * result is remembered and not said, as a trigger's is on a first look, and an old state reads alike.
 */
export function readersSaid(asked: ReadersAsked): ReadersSaid {
  const { store, log, size, lastSize, files, spare } = asked;
  const names = namesIn(store);
  const seen: Record<string, SaidOf> = { ...asked.before };
  const news: { name: string; line: string }[] = [];
  for (const name of names) {
    const one = oneReader(asked, name);
    news.push(...one.said.map((line) => ({ name, line })));
    if (one.seen !== undefined) seen[name] = one.seen;
  }
  // A failure comes first, since a bound must not hide that a reader read nothing.
  const lines = news.toSorted(
    (one, other) => Number(other.line.startsWith("⚠")) - Number(one.line.startsWith("⚠")),
  );
  const most = Math.min(PER_RUN, Math.max(0, spare));
  const over = lines.slice(most);
  const withheld = [...new Set(over.map(({ name }) => name))].join(", ");
  const said = [
    ...lines.slice(0, most).map(({ line }) => line),
    ...(over.length > 0 ? [`◆ ${String(over.length)} more lines, of ${withheld}`] : []),
    ...(news.some(({ line }) => line.startsWith("◆")) ? [`◆ the readers' full text: ${resolve(files)}`] : []),
  ];
  const missing = notRead(store, log, names, size, lastSize);
  const never = names.length === 0 && lastSize !== undefined && lastSize !== size;
  const named = never || missing.length === names.length ? "every reader" : missing.join(", ");
  const cut =
    missing.length > 0 || never ? [`⚠ not read since the last look: ${named}; ${whyNot(store)}`] : [];
  return {
    said: [...said, ...cut],
    seen,
    owed: names.length === 0 || names.some((name) => resultOf(store, log, name)?.size !== size),
  };
}

/** The investigation's triggers, where the rows have read further than this observer last compared. */
export function alarmsMoved(store: string, log: string, before: SaidOf | undefined): readonly Alarm[] | null {
  const result = resultOf(store, log, "rows");
  if (result?.ok !== true || result.size <= (before?.size ?? -1)) return null;
  return textOf(store, log, "rows")
    .split("\n")
    .flatMap((line) => {
      const [, name = "", lane = "", detail = ""] = TRIGGER_LINE.exec(line) ?? [];
      return name === "" ? [] : [{ name, lane: Number(lane), detail }];
    });
}

/** Drop the files of observers gone for a week, beside a peer's `--state`, with any a kill left half
 *  written. */
export function pruneObservers(state: string, now = Date.now()): void {
  const folder = dirname(resolve(state));
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder)) {
    const file = join(folder, entry);
    if (/\.json(?:\.pending|\.d)?(?:\.\d+\.tmp)?$/.test(entry) && now - statSync(file).mtimeMs > STALE_MS) {
      rmSync(file, { recursive: true, force: true });
    }
  }
}
