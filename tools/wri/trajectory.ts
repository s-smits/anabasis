/**
 * How far each campaign had got at each hour, on the few rulers its runs share:
 *
 *   bun tools/wri/wri.ts trajectory --log <log>[,<log>...] [--grades <report>[,<report>]] [--hours 2,4,8]
 *
 * A promotion count says nothing across runs whose comparisons draw other tasks under other rules,
 * and hours to a promotion says nothing of what it bought: a run that reaches a fair harness in two
 * hours and stalls can read better or worse than one that takes four, depending on where it is cut.
 * On 6 November the operator asked for a reading that holds both, so that a race to the first
 * comparison and a stall after it both show. Each run therefore reads as step functions of its work
 * hours, cut at one set of hours, and a run that had stopped by an hour reads `.` there rather than
 * standing still: an ended run is censored, not flat.
 *
 * The channels stay apart and none is a verdict:
 * - **Climb**: promotions and confirmed promotions by the hour, the longest stretch without one and
 *   the stretch since the last.
 * - **Lead over the Starter**: points a tallied task each time the Starter sat in a comparison.
 *   The Starter's digest is one across these runs, so it is the one opponent they share, though the
 *   tasks differ. A step's own size reads against a reference that moves, so it is printed apart.
 * - **Weight**: the reference's guide lines, and the files and lines of the programs it wrote. An
 *   installed interpreter, package or binary is left out (`ownPrograms`): a harness's first 3,526
 *   files of 6 November were 6 programs and one Python.
 * - **Exam load**: each comparison's clock, tally, and each side's turns and valid share.
 * - **Task grade**, only with `--grades`: the median of lane 27's task grades in each comparison, from
 *   `task<TAB>run<TAB>id<TAB>grade` rows in any report. It changes no reading and no seat is told it
 *   (`AGENTS.md`, rules 1 and 3).
 *
 * A first version read quality off the grades, the mean of a version's soundness and the highest
 * grade it held, by the hour and up to horizons. A second reading of sixteen runs on 6 November found
 * that the grade held was the highest grade the exam offered in 30 or 31 of 31 promoted versions, that
 * 2.62 of the first promotion's mean rise of 2.78 was half a soundness the Starter is given none of,
 * and that carrying a stopped run's last reference made a stall and a stop one number. So none of it
 * is computed here, and a stopped run stays censored in every table.
 *
 * A read's lead falls by construction as tasks that did not choose the harness join it, so set it
 * beside the split `starter-reads` prints, and read it across one run's reads only with that in mind.
 *
 * Runs of different commits are described side by side (`AGENTS.md`, section 9). Only a comparison on
 * one set of tasks says which harness is better. Work hours subtract every recorded wait and any
 * silence of half an hour, which also takes out a solve-queue wait while other solves ran, so they
 * are a lower bound. Read-only; the output stays on the exam side with the log it reads.
 */
import { epochsOf } from "#src/campaign/climb.ts";
import { pathsUnder } from "#src/harness/open.ts";
import { scoresIn, testOf } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { lastReports } from "#src/kernel/reports.ts";
import { practiceRan } from "#src/kernel/solves.ts";
import { AGENT_DIR, GUIDE_FILE, TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "#src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { median } from "#src/meta/tally.ts";
import { waitsOf } from "./time.ts";

export const HOURS = [2, 4, 6, 8, 12, 16, 24] as const;
const SILENCE = 30 * 60 * 1000;
/** Path segments of what a harness installed rather than wrote. */
const INSTALLED =
  /(^|\/)(python|site-packages|dist-packages|node_modules|\.?venv|vendor|include|__pycache__)(\/|$)/;
/** A bundled interpreter's home, known by the library folder its build lays out, whatever the home
 *  is named. The tool tree itself is no such home: a harness keeps its own programs there. */
const HOME = /\/lib\/python\d[\d.]*\//;
/** An installed package's metadata folder, and what follows its package's name in that folder's name. */
const METADATA = /\.(?:dist-info|egg-info)$/;
const PAST_NAME = /(?:-[^/]*)?\.(?:dist-info|egg-info)$/;
/** A wheel's folder of bundled shared libraries, written whole by the installer. */
const LIBS = /(^|\/)[^/]+\.libs\//;
/** A program a harness wrote is shorter than this; an interpreter or a library's binary is not. */
const WRITTEN_BYTES = 256 * 1024;
const GUIDE_PATH = `${AGENT_DIR}${GUIDE_FILE}`;

export type Grades = ReadonlyMap<string, number>;
interface Weight {
  readonly guide: number;
  readonly files: number;
  readonly lines: number;
}
interface Side {
  readonly turns: number;
  readonly valid: number;
  readonly results: number;
}
interface Reading {
  readonly session: string;
  readonly hour: number;
  /** Work hours from the comparison's start to its report. */
  readonly took: number | null;
  readonly reading: string;
  readonly tally: string;
  readonly each: number;
  /** The built side's points a task over the Starter, where the Starter sat in this comparison. */
  readonly lead: number | null;
  readonly aa: string;
  readonly starter: Side | null;
  readonly built: Side | null;
  /** The median task grade of the comparison's tasks, with `--grades`. */
  readonly grade: number | null;
}
interface Promotion {
  readonly harness: string;
  readonly hour: number;
  /** Whether a starter comparison read it at all. */
  readonly read: boolean;
  /** The hour its starter read confirmed it, or null. */
  readonly confirmed: number | null;
}
export interface Trajectory {
  readonly name: string;
  readonly opened: string;
  readonly elapsed: number;
  readonly work: number;
  /** The ending the log records, or null where it records none. */
  readonly ending: string | null;
  /** The comparison the log stops inside, or null. */
  readonly cut: string | null;
  readonly candidate: number | null;
  readonly readings: readonly Reading[];
  readonly promotions: readonly Promotion[];
  readonly starter: string | null;
}

/** Work hours from the log's first event: elapsed less each recorded wait and silence, once. */
export function clockOf(events: readonly LogEvent[]): (at: string) => number {
  const times = events.map(({ at }) => Date.parse(at));
  const start = times[0] ?? 0;
  const spans = waitsOf(events).map(({ from, until }): [number, number] => [from, until]);
  for (const [nth, time] of times.entries()) {
    const before = times[nth - 1];
    if (before !== undefined && time - before >= SILENCE) spans.push([before, time]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, until] of spans) {
    const last = merged.at(-1);
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], until);
    else merged.push([from, until]);
  }
  return (at) => {
    const to = Date.parse(at);
    const lost = merged.reduce((sum, [from, until]) => sum + Math.max(0, Math.min(until, to) - from), 0);
    return (to - start - Math.min(lost, to - start)) / HOUR_MS;
  };
}

/** What each side did in each comparison, and the tasks each comparison solved. */
function solvesOf(events: readonly LogEvent[]) {
  const started = new Map<string, { comparison: string; task: string }>();
  const sides = new Map<string, { turns: number; valid: number; results: number }>();
  const opposed = new Map<string, Set<string>>();
  for (const { kind, data } of events) {
    if (
      kind === "solve.started" &&
      isString(data.comparison) &&
      isString(data.solve) &&
      isString(data.task)
    ) {
      started.set(data.solve, { comparison: data.comparison, task: data.task });
      continue;
    }
    if (kind !== "solve.finished" || !isString(data.solve) || !isString(data.harness)) continue;
    const solve = started.get(data.solve);
    const outcome = asRecord(data.ending)?.outcome;
    if (solve === undefined || outcome === "non-result") continue;
    const side = `${solve.comparison}:${data.harness}`;
    const sum = sides.get(side) ?? { turns: 0, valid: 0, results: 0 };
    sides.set(side, {
      turns: sum.turns + (isNumber(data.turns) ? data.turns : 0),
      valid: sum.valid + (outcome === "pass" ? 1 : 0),
      results: sum.results + 1,
    });
    opposed.set(solve.comparison, (opposed.get(solve.comparison) ?? new Set<string>()).add(solve.task));
  }
  return { sides, opposed };
}

/** The side of a comparison as printed, or null where that side ran nothing. */
function sideOf(sides: ReadonlyMap<string, Side>, session: string, harness: unknown): Side | null {
  return isString(harness) ? (sides.get(`${session}:${harness}`) ?? null) : null;
}

/** One campaign's readings and promotions on its work-hours clock. */
export function trajectoryOf(name: string, events: readonly LogEvent[], grades: Grades | null): Trajectory {
  const clock = clockOf(events);
  const first = events.find(({ kind }) => kind === "comparison.started");
  const starter = isString(first?.data.starter) ? first.data.starter : null;
  const { sides, opposed } = solvesOf(events);
  const hourOfSession = new Map<string, number>();
  const readings = lastReports(events).map(({ session, index, data }): Reading => {
    const hour = clock(events[index]?.at ?? "");
    hourOfSession.set(session, hour);
    const begun = events.find(
      ({ kind, data: of }) => kind === "comparison.started" && of.session === session,
    );
    const { wins, losses, ties } = testOf(scoresIn(data.scored));
    const tallied = wins + losses + ties;
    const points = asRecord(data.points);
    const sum =
      (isNumber(points?.validity) ? points.validity : 0) +
      (isNumber(points?.objective) ? points.objective : 0);
    const each = tallied === 0 ? 0 : sum / tallied;
    const noise = testOf(scoresIn(data.noise));
    const starterFresh = data.fresh === starter;
    const starterOld = data.old === starter;
    const graded = [...(opposed.get(session) ?? [])].flatMap((task) => grades?.get(`${name}\t${task}`) ?? []);
    return {
      session,
      hour,
      took: begun === undefined ? null : hour - clock(begun.at),
      reading: isString(data.reading) ? data.reading : "",
      tally: `${String(wins)}-${String(losses)}-${String(ties)}`,
      each,
      lead: starterFresh ? -each : starterOld ? each : null,
      aa: `${String(noise.wins)}-${String(noise.losses)}-${String(noise.ties)}`,
      starter: starterFresh || starterOld ? sideOf(sides, session, starter) : null,
      built: sideOf(sides, session, starterFresh ? data.old : data.fresh),
      grade: graded.length === 0 ? null : median(graded),
    };
  });
  const promotions = epochsOf(events).flatMap((epoch): Promotion[] => {
    if (epoch.reference === "starter") return [];
    const read =
      epoch.confirmed === true && epoch.starter_read !== null
        ? hourOfSession.get(epoch.starter_read)
        : undefined;
    return [
      {
        harness: epoch.reference,
        hour: clock(events[epoch.from]?.at ?? ""),
        read: epoch.starter_read !== null,
        confirmed: read ?? null,
      },
    ];
  });
  const end = events.at(-1)?.at ?? "";
  const ending = events.findLast(({ kind }) => kind === "campaign.ended")?.data.ending;
  const open = events.findLast(({ kind }) => kind === "comparison.started")?.data.session;
  return {
    name,
    opened: events[0]?.at ?? "",
    elapsed: (Date.parse(end) - Date.parse(events[0]?.at ?? end)) / HOUR_MS,
    work: clock(end),
    ending: isString(ending) ? ending : null,
    cut: isString(open) && !hourOfSession.has(open) ? open : null,
    candidate: first === undefined ? null : clock(first.at),
    readings,
    promotions,
    starter,
  };
}

/** A path with its `.` and `..` segments resolved, as a `RECORD` line names one from its folder. */
function resolved(path: string): string {
  const kept: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") kept.pop();
    else if (segment !== "." && segment !== "") kept.push(segment);
  }
  return kept.join("/");
}

/** The paths an installer wrote, from each package's metadata: the files its `RECORD` names (a CSV
 *  whose first field is a path from the folder it installed into), or, where no record can be read,
 *  the folders and modules its `top_level.txt` or its own name gives. */
function installedBy(files: readonly { readonly path: string }[], recordOf: (path: string) => string | null) {
  const paths = new Set<string>();
  const folders = new Set<string>();
  const marks = new Map(
    files.flatMap(({ path }) => {
      const segments = path.split("/");
      const at = segments.findIndex(
        (segment, place) => place < segments.length - 1 && METADATA.test(segment),
      );
      const folder = segments[at] ?? "";
      const site = segments
        .slice(0, at)
        .map((segment) => `${segment}/`)
        .join("");
      return at === -1 ? [] : [[`${site}${folder}/`, { site, name: folder.replace(PAST_NAME, "") }] as const];
    }),
  );
  for (const [meta, { site, name }] of marks) {
    folders.add(meta);
    const record = recordOf(`${meta}RECORD`) ?? recordOf(`${meta}installed-files.txt`);
    const from = record !== null && meta.endsWith(".egg-info/") ? meta : site;
    const named = record
      ?.split("\n")
      .map((line) =>
        line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : (line.split(",")[0] ?? ""),
      );
    if (named !== undefined) {
      for (const each of named.filter((line) => line.trim() !== "")) paths.add(resolved(`${from}${each}`));
      continue;
    }
    const tops = recordOf(`${meta}top_level.txt`)
      ?.split("\n")
      .filter((line) => line.trim() !== "") ?? [name];
    for (const top of tops) {
      folders.add(`${site}${top.trim()}/`);
      paths.add(`${site}${top.trim()}.py`);
    }
  }
  return { paths, folders: [...folders] };
}

/** The tool tree's files a harness wrote, given each file's path and size (`recordOf` reads a file
 *  of the tree by its path, or gives null): not an installed folder (`INSTALLED`, a wheel's `.libs`),
 *  not a file an installed package's metadata names, and not a binary-sized file. A harness's own
 *  module beside installed packages stays: until 10 November one `.dist-info` dropped the whole folder
 *  that held it, which hid a jobstat harness's own `pylib/statkit.py` behind thirteen packages. An
 *  interpreter's home goes whole (`HOME`): on 13 November 882 of the 888 files read as written by a
 *  jobstat harness were the standard library of one it kept under a name of its own, and 30 of the
 *  32 places where `names.ts` found a task's identifier were lines of that library. */
export function ownPrograms(
  files: readonly { readonly path: string; readonly bytes: number }[],
  recordOf: (path: string) => string | null = () => null,
): string[] {
  const installed = installedBy(files, recordOf);
  const homes = [...new Set(files.map(({ path }) => path.slice(0, path.search(HOME) + 1)))].filter(Boolean);
  return files
    .filter(
      ({ path, bytes }) =>
        bytes <= WRITTEN_BYTES &&
        !INSTALLED.test(path) &&
        !homes.some((home) => path.startsWith(home)) &&
        !LIBS.test(path) &&
        !installed.paths.has(path) &&
        !installed.folders.some((folder) => path.startsWith(folder)),
    )
    .map(({ path }) => path);
}

/** The programs a kept harness wrote, under the real root of its tool tree: its files, and each link
 *  that names another file of the tree (`bin/pack-answer` to `check-answer`), listed by its own name. */
export function ownFilesOf(state: string): { readonly root: string; readonly paths: readonly string[] } {
  const tree = join(state, TOOL_TREE_DIR);
  if (!existsSync(tree)) return { root: tree, paths: [] };
  const root = realpathSync(tree);
  const files = pathsUnder(root).flatMap((path) => {
    const stat = lstatSync(join(root, path));
    if (stat.isFile()) return [{ path, bytes: stat.size }];
    const target =
      stat.isSymbolicLink() && existsSync(join(root, path)) ? realpathSync(join(root, path)) : "";
    return target.startsWith(`${root}/`) && lstatSync(target).isFile() ? [{ path, bytes: 0 }] : [];
  });
  const recordOf = (path: string) =>
    existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null;
  return { root, paths: ownPrograms(files, recordOf) };
}

const unrecorded = (value: JsonValue | undefined): string => (isString(value) ? value : "unrecorded");

/** The guide and the programs a kept harness wrote, by path (the guide as `guide`). Moved here from
 *  `packets.ts` on 10 November so that `harness-versions.ts --lines` and `names.ts` read the one list
 *  a blind packet reads. */
export function writtenIn(state: string): Map<string, string> {
  const { root, paths } = ownFilesOf(state);
  const found = new Map(paths.map((path) => [path, join(root, path)]));
  if (existsSync(join(state, GUIDE_PATH))) found.set("guide", join(state, GUIDE_PATH));
  return found;
}

/** The unified diff of what a harness wrote, from `parent` (a state folder, or none) to `version`,
 *  one context line a hunk, path by path in order; `filesOf` names the files read, by label. */
export function diffOf(
  parent: string,
  version: string,
  filesOf: (state: string) => ReadonlyMap<string, string> = writtenIn,
): string[] {
  const old = existsSync(parent) ? filesOf(parent) : new Map<string, string>();
  const fresh = filesOf(version);
  const link = (file: string | undefined) =>
    file !== undefined && lstatSync(file).isSymbolicLink() ? `-> ${readlinkSync(file)}` : null;
  return [...new Set([...old.keys(), ...fresh.keys()])].toSorted().flatMap((path) => {
    const [before, after] = [link(old.get(path)), link(fresh.get(path))];
    if (before !== null || after !== null) {
      // A link reads as the name it points to, never as its target's text a second time.
      if (before === after) return [];
      return [
        `--- parent/${path}`,
        `+++ version/${path}`,
        ...(before === null ? [] : [`-${before}`]),
        ...(after === null ? [] : [`+${after}`]),
      ];
    }
    const { stdout } = runSync([
      "diff",
      "-U1",
      "--label",
      `parent/${path}`,
      "--label",
      `version/${path}`,
      old.get(path) ?? "/dev/null",
      fresh.get(path) ?? "/dev/null",
    ]);
    const text = decodeOutput(stdout).trimEnd();
    return text === "" ? [] : text.split("\n");
  });
}

/** How the campaign came to hold `digest`, and the parent the log records for it: the one reader of
 *  a version's parent, which `harness-versions.ts` and the lane 27 packets both call (moved from
 *  `harness-versions.ts` on 10 November, when the packets read `harness.version` alone and gave a led
 *  session's checkpoints the starter for a parent). */
export function madeOf(events: readonly LogEvent[], digest: string, starter: string) {
  const version = events.find(
    ({ kind, data }) => kind === "harness.version" && data.version === digest,
  )?.data;
  if (isString(version?.parent)) {
    const note = isString(version.note) ? `${version.note.split(/\s+/).length}-word note` : "no note";
    return {
      made: `session ${unrecorded(version.session)} from ${version.parent.slice(0, 8)}, ${note}`,
      parent: version.parent,
    };
  }
  const imported = events.find(
    ({ kind, data }) => kind === "harness.imported" && data.harness === digest,
  )?.data;
  if (imported !== undefined) return { made: `imported from ${unrecorded(imported.from)}`, parent: null };
  // A Builder that leads its campaign freezes a harness with `build.checkpoint` and no parent: its
  // parent is the session's harness snapshot before it, or what the session began from. Until 27 October
  // this read only `harness.version`, and every harness compared in a led campaign read as made by
  // no record.
  const at = events.findIndex(({ kind, data }) => kind === "build.checkpoint" && data.harness === digest);
  const session = events[at]?.data.session;
  const before = events.slice(0, Math.max(at, 0)).filter(({ data }) => data.session === session);
  const parent =
    before.findLast(({ kind }) => kind === "build.checkpoint")?.data.harness ??
    before.findLast(({ kind }) => kind === "build.started")?.data.parent;
  if (isString(parent)) {
    return { made: `checkpoint of session ${unrecorded(session)} from ${parent.slice(0, 8)}`, parent };
  }
  // A led session practises states it never freezes: until 2 November each read as made by no
  // record, 28 of them in seven campaigns (lane 15), though the log's practice solves name each.
  if (digest === starter) {
    return { made: "the Starter Built Harness as this checkout writes it", parent: null };
  }
  if (practiceRan(events).some(({ under }) => under.harness === digest)) {
    return { made: "a state its Builder practised and never froze", parent: null };
  }
  return {
    made: "no record of its making: a stored sweep's harness, a starter of another checkout, or a programs-of control",
    parent: null,
  };
}

/** A kept harness's weight from its state beside the log, or null where the copy keeps none. */
export function weightOf(state: string): Weight | null {
  if (!existsSync(state)) return null;
  const text = (file: string) =>
    existsSync(join(state, file)) ? readFileSync(join(state, file), "utf8") : "";
  const nonblank = (body: string) => body.split("\n").filter((line) => line.trim() !== "").length;
  const { root, paths } = ownFilesOf(state);
  const lines = paths.reduce((sum, path) => sum + nonblank(readFileSync(join(root, path), "utf8")), 0);
  return { guide: nonblank(text(`${AGENT_DIR}${GUIDE_FILE}`)), files: paths.length, lines };
}

/** The task grades of a lane 27 report: its `task` rows, anything else passed over. */
export function gradesIn(text: string): Grades {
  const tasks = new Map<string, number>();
  for (const line of text.split("\n")) {
    const [graded, run, id, grade] = line.split("\t");
    const value = Number(grade);
    if (graded !== "task" || run === undefined || id === undefined) continue;
    if (grade !== undefined && Number.isFinite(value)) tasks.set(`${run}\t${id}`, value);
  }
  return tasks;
}

const fixed = (value: number | null, places = 1) => (value === null ? "-" : value.toFixed(places));

/** The longest stretch with no promotion, from the opening through to the run's last hour. */
export function longestGap({ promotions, work }: Pick<Trajectory, "promotions" | "work">): number {
  const marks = [0, ...promotions.map(({ hour }) => hour), work];
  return Math.max(...marks.slice(1).map((mark, nth) => mark - (marks[nth] ?? 0)));
}

/** The reference in force at an hour: the last promoted by then, the Starter before any. */
function referenceAt(
  { promotions, starter }: Pick<Trajectory, "promotions" | "starter">,
  hour: number,
): string | null {
  return promotions.findLast((one) => one.hour <= hour)?.harness ?? starter;
}

function row(cells: readonly (string | number)[]): string {
  return `| ${cells.join(" | ")} |`;
}

function table(head: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  return [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
}

/** One channel, a row a run and a column an hour, with `.` once the run had stopped, and its end. */
function byHour(
  runs: readonly Trajectory[],
  hours: readonly number[],
  at: (run: Trajectory, hour: number) => string,
) {
  return table(
    ["run", ...hours.map((hour) => `${String(hour)} h`), "at its end"],
    runs.map((run) => [
      run.name,
      ...hours.map((hour) => (hour > run.work ? "." : at(run, hour))),
      at(run, run.work),
    ]),
  );
}

/** One row a run: when it reached each mark, and how its gaps ran. */
function stretchesOf(runs: readonly Trajectory[]): string {
  return table(
    [
      "run",
      "opened",
      "ending",
      "elapsed h",
      "work h",
      "first candidate",
      "first read",
      "promotions at",
      "confirmed",
      "second gap over first",
      "less its starter reads",
      "longest gap",
      "since the last",
    ],
    runs.map((run) => {
      const [first, second] = run.promotions.map(({ hour }) => hour);
      const last = run.promotions.at(-1)?.hour ?? 0;
      const count = (of: (one: Promotion) => boolean) => run.promotions.filter(of).length;
      // A starter comparison in the gap is owed by the host, and no candidate needs it.
      const owed = run.readings.filter(
        ({ lead, hour }) => lead !== null && hour > (first ?? 0) && hour <= (second ?? 0),
      );
      const gap = (less: number) =>
        first === undefined || second === undefined ? "-" : fixed((second - first - less) / first);
      return [
        run.name,
        run.opened.slice(5, 16),
        run.ending ?? (run.cut === null ? "none" : `none, cut in ${run.cut}`),
        fixed(run.elapsed),
        fixed(run.work),
        fixed(run.candidate),
        fixed(run.readings[0]?.hour ?? null),
        run.promotions.map(({ hour }) => fixed(hour)).join(", ") || "none",
        `${String(count(({ confirmed }) => confirmed !== null))} confirmed, ${String(count(({ read }) => read))} read, ${String(count(({ read }) => !read))} never read`,
        gap(0),
        gap(owed.reduce((sum, { took }) => sum + (took ?? 0), 0)),
        fixed(longestGap(run)),
        fixed(run.work - last),
      ];
    }),
  );
}

/** One table a run, a row a comparison. */
function comparisonsOf(run: Trajectory): string {
  const lines = run.readings.map((one) =>
    row([
      one.session,
      fixed(one.hour),
      fixed(one.took),
      one.reading,
      one.tally,
      one.aa,
      fixed(one.each, 0),
      fixed(one.lead, 0),
      one.starter === null
        ? "-"
        : `${fixed(one.starter.turns / Math.max(one.starter.results, 1))}, ${String(one.starter.valid)}/${String(one.starter.results)}`,
      one.built === null
        ? "-"
        : `${fixed(one.built.turns / Math.max(one.built.results, 1))}, ${String(one.built.valid)}/${String(one.built.results)}`,
      fixed(one.grade),
    ]),
  );
  return [
    `#### ${run.name}`,
    row([
      "comparison",
      "work h",
      "took",
      "reading",
      "tally",
      "A/A",
      "points a task",
      "lead over the Starter",
      "Starter turns, valid",
      "built turns, valid",
      "median task grade",
    ]),
    row(Array.from({ length: 11 }, () => "---")),
    ...lines,
  ].join("\n");
}

export function trajectoryText(
  campaigns: readonly { readonly name: string; readonly log: string; readonly events: readonly LogEvent[] }[],
  options: {
    readonly grades: Grades | null;
    readonly hours: readonly number[];
  },
): string {
  const { grades, hours } = options;
  const runs = campaigns.map(({ name, events }) => trajectoryOf(name, events, grades));
  runs.sort((a, b) => Date.parse(a.opened) - Date.parse(b.opened));
  const weights = new Map<string, Weight | null>();
  const weight = (run: Trajectory, harness: string | null) => {
    if (harness === null) return null;
    const log = campaigns.find(({ name }) => name === run.name)?.log ?? "";
    const id = `${run.name}\t${harness}`;
    if (!weights.has(id)) weights.set(id, weightOf(join(dirname(log), "states", harness)));
    return weights.get(id) ?? null;
  };
  const climbed = byHour(runs, hours, (run, hour) => {
    const by = run.promotions.filter((one) => one.hour <= hour);
    return `${String(by.length)} (${String(by.filter(({ confirmed }) => confirmed !== null && confirmed <= hour).length)})`;
  });
  const led = byHour(runs, hours, (run, hour) =>
    fixed(run.readings.findLast((one) => one.hour <= hour && one.lead !== null)?.lead ?? null, 0),
  );
  const weighed = byHour(runs, hours, (run, hour) => {
    const of = weight(run, referenceAt(run, hour));
    return of === null ? "?" : `${String(of.guide)}/${String(of.files)}/${String(of.lines)}`;
  });
  return [
    "Runs of different commits on different tasks, described side by side: only a comparison on one set of tasks says which harness is better. `.` means the run had stopped by that hour.",
    "### Stretches, in work hours",
    stretchesOf(runs),
    "### Promotions by the hour, confirmed in brackets",
    climbed,
    "### Points a task over the Starter, the last read by the hour",
    led,
    "### The reference's weight by the hour: guide lines / own program files / their lines",
    weighed,
    "### Each comparison",
    ...runs.map(comparisonsOf),
  ].join("\n\n");
}
