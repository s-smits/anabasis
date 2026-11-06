/**
 * How far each campaign had got at each hour, on the few rulers its runs share:
 *
 *   bun tools/wri/wri.ts trajectory --log <log>[,<log>...] [--grades <report>[,<report>]] [--hours 2,4,8] [--horizons 6,12]
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
 * - **Climb**: promotions and confirmed promotions by the hour, the longest stretch without one, the
 *   stretch since the last, and the share of promotions in the first half of the run's hours.
 * - **Lead over the Starter**: points a tallied task each time the Starter sat in a comparison.
 *   The Starter's digest is one across these runs, so it is the one opponent they share, though the
 *   tasks differ. A step's own size reads against a reference that moves, so it is printed apart.
 * - **Weight**: the reference's guide lines, and the files and lines of the programs it wrote. An
 *   installed interpreter, package or binary is left out (`ownPrograms`): a harness's first 3,526
 *   files of 6 November were 6 programs and one Python.
 * - **Exam load**: each comparison's clock, tally, and each side's turns and valid share.
 * - **Quality**, only with `--grades`: lane 34's blind grades, one row a line in any report as
 *   `task<TAB>run<TAB>id<TAB>grade` and `version<TAB>run<TAB>digest<TAB>grade`. A version's quality is
 *   the mean of its soundness and the reach it holds, and a version graded 0 or 1 for soundness,
 *   broken or fitted, counts 0 whatever it holds. The Starter holds no method of the domain and is
 *   graded for no change, so its soundness counts 0. Each `--horizons` value gives the mean quality
 *   over the hours up to it. A run that stopped earlier holds its last reference to that hour, marked
 *   `*`: a run capped at two promotions still has its harness, and an early and a late horizon side
 *   by side show a race that stalled. It is a report: it changes no reading and no seat is told it
 *   (`AGENTS.md`, rules 1 and 3).
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
import { AGENT_DIR, GUIDE_FILE, TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { existsSync, lstatSync, readFileSync, realpathSync } from "#src/meta/filesystem.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { median } from "#src/meta/tally.ts";
import { waitsOf } from "./time.ts";

export const HOURS = [2, 4, 6, 8, 12, 16, 24] as const;
const HOUR = 3_600_000;
const SILENCE = 30 * 60 * 1000;
/** Path segments of what a harness installed rather than wrote. */
const INSTALLED =
  /(^|\/)(python|site-packages|dist-packages|node_modules|\.?venv|vendor|include|__pycache__)(\/|$)/;
/** A folder beside one of these holds an installed package set, so the whole of it was installed. */
const INSTALL_MARK = /^(.*\/)?[^/]+\.(dist-info|egg-info|libs)\//;
/** A program a harness wrote is shorter than this; an interpreter or a library's binary is not. */
const WRITTEN_BYTES = 256 * 1024;

export interface Grades {
  readonly tasks: ReadonlyMap<string, number>;
  readonly versions: ReadonlyMap<string, number>;
}
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
  readonly reach: number | null;
}
interface Promotion {
  readonly harness: string;
  readonly hour: number;
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
  readonly candidate: number | null;
  readonly readings: readonly Reading[];
  readonly promotions: readonly Promotion[];
  /** Quality of a harness by digest, with the Starter under its own digest. */
  readonly quality: ReadonlyMap<string, number>;
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
    return (to - start - Math.min(lost, to - start)) / HOUR;
  };
}

/** What each side did in each comparison, and each harness's valid and result counts by task. */
function solvesOf(events: readonly LogEvent[]) {
  const started = new Map<string, { comparison: string; task: string }>();
  const sides = new Map<string, { turns: number; valid: number; results: number }>();
  const held = new Map<string, Map<string, { valid: number; results: number }>>();
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
    const tasks = held.get(data.harness) ?? new Map<string, { valid: number; results: number }>();
    const one = tasks.get(solve.task) ?? { valid: 0, results: 0 };
    tasks.set(solve.task, { valid: one.valid + (outcome === "pass" ? 1 : 0), results: one.results + 1 });
    held.set(data.harness, tasks);
    opposed.set(solve.comparison, (opposed.get(solve.comparison) ?? new Set<string>()).add(solve.task));
  }
  return { sides, held, opposed };
}

/** The highest grade at which a harness holds valid answers on most of at least two solves (lane 34). */
export function reachHeld(
  tasks: ReadonlyMap<string, { readonly valid: number; readonly results: number }>,
  grade: (task: string) => number | undefined,
): number | null {
  const byGrade = new Map<number, { valid: number; results: number }>();
  for (const [task, { valid, results }] of tasks) {
    const of = grade(task);
    if (of === undefined) continue;
    const sum = byGrade.get(of) ?? { valid: 0, results: 0 };
    byGrade.set(of, { valid: sum.valid + valid, results: sum.results + results });
  }
  const held = [...byGrade].filter(([, { valid, results }]) => results >= 2 && valid * 2 > results);
  return held.length === 0 ? null : Math.max(...held.map(([of]) => of));
}

/** A version's quality: the mean of soundness and reach held, 0 for a broken or fitted version. */
export function qualityOf(soundness: number | null, reach: number | null): number | null {
  if (reach === null) return null;
  if (soundness === null) return reach / 2;
  return soundness <= 1 ? 0 : (soundness + reach) / 2;
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
  const { sides, held, opposed } = solvesOf(events);
  const key = (id: string) => `${name}\t${id}`;
  const gradeOf = (task: string) => grades?.tasks.get(key(task));
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
    const graded = [...(opposed.get(session) ?? [])].flatMap((task) => gradeOf(task) ?? []);
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
      reach: graded.length === 0 ? null : median(graded),
    };
  });
  const promotions = epochsOf(events).flatMap((epoch): Promotion[] => {
    if (epoch.reference === "starter") return [];
    const read =
      epoch.confirmed === true && epoch.starter_read !== null
        ? hourOfSession.get(epoch.starter_read)
        : undefined;
    return [{ harness: epoch.reference, hour: clock(events[epoch.from]?.at ?? ""), confirmed: read ?? null }];
  });
  const quality = new Map<string, number>();
  for (const harness of [...(starter === null ? [] : [starter]), ...promotions.map((one) => one.harness)]) {
    const reach = reachHeld(held.get(harness) ?? new Map(), gradeOf);
    const soundness = grades?.versions.get(key(harness.slice(0, 8))) ?? null;
    const value = qualityOf(soundness, reach);
    if (value !== null) quality.set(harness, value);
  }
  const end = events.at(-1)?.at ?? "";
  const ending = events.findLast(({ kind }) => kind === "campaign.ended")?.data.ending;
  return {
    name,
    opened: events[0]?.at ?? "",
    elapsed: (Date.parse(end) - Date.parse(events[0]?.at ?? end)) / HOUR,
    work: clock(end),
    ending: isString(ending) ? ending : null,
    candidate: first === undefined ? null : clock(first.at),
    readings,
    promotions,
    quality,
    starter,
  };
}

/** The tool tree's files a harness wrote, given each file's path and size: not an installed folder,
 *  not a folder holding an installed package set, and not a binary-sized file. */
export function ownPrograms(files: readonly { readonly path: string; readonly bytes: number }[]): string[] {
  const roots = new Set(
    files.flatMap(({ path }) => {
      const mark = INSTALL_MARK.exec(path);
      return mark === null ? [] : [mark[1] ?? ""];
    }),
  );
  return files
    .filter(
      ({ path, bytes }) =>
        bytes <= WRITTEN_BYTES && !INSTALLED.test(path) && ![...roots].some((root) => path.startsWith(root)),
    )
    .map(({ path }) => path);
}

/** A kept harness's weight from its state beside the log, or null where the copy keeps none. */
export function weightOf(state: string): Weight | null {
  if (!existsSync(state)) return null;
  const text = (file: string) =>
    existsSync(join(state, file)) ? readFileSync(join(state, file), "utf8") : "";
  const nonblank = (body: string) => body.split("\n").filter((line) => line.trim() !== "").length;
  const tree = join(state, TOOL_TREE_DIR);
  const real = existsSync(tree) ? realpathSync(tree) : null;
  const files =
    real === null
      ? []
      : pathsUnder(real).flatMap((path) => {
          const stat = lstatSync(join(real, path));
          return stat.isFile() ? [{ path, bytes: stat.size }] : [];
        });
  const own = ownPrograms(files);
  const lines = own.reduce((sum, path) => sum + nonblank(readFileSync(join(real ?? "", path), "utf8")), 0);
  return { guide: nonblank(text(`${AGENT_DIR}${GUIDE_FILE}`)), files: own.length, lines };
}

/** The grades of a lane 34 report: its `task` and `version` rows, anything else passed over. */
export function gradesIn(text: string): Grades {
  const tasks = new Map<string, number>();
  const versions = new Map<string, number>();
  for (const line of text.split("\n")) {
    const [graded, run, id, grade] = line.split("\t");
    const value = Number(grade);
    if (run === undefined || id === undefined || grade === undefined || !Number.isFinite(value)) continue;
    if (graded === "task") tasks.set(`${run}\t${id}`, value);
    if (graded === "version") versions.set(`${run}\t${id.slice(0, 8)}`, value);
  }
  return { tasks, versions };
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

/** The mean of a harness-valued measure over the hours to `horizon`. Past the run's end its last
 *  reference holds, since the run still has that harness. Null where a stretch has no value. */
export function meanTo(
  run: Pick<Trajectory, "promotions" | "starter">,
  horizon: number,
  value: (harness: string | null) => number | null,
): number | null {
  if (horizon <= 0) return null;
  const marks = [0, ...run.promotions.map(({ hour }) => hour).filter((hour) => hour < horizon), horizon];
  let sum = 0;
  for (const [nth, from] of marks.slice(0, -1).entries()) {
    const at = value(referenceAt(run, from));
    if (at === null) return null;
    sum += at * ((marks[nth + 1] ?? horizon) - from);
  }
  return sum / horizon;
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
      "longest gap",
      "since the last",
    ],
    runs.map((run) => {
      const [first, second] = run.promotions.map(({ hour }) => hour);
      const last = run.promotions.at(-1)?.hour ?? 0;
      return [
        run.name,
        run.opened.slice(5, 16),
        run.ending ?? "none",
        fixed(run.elapsed),
        fixed(run.work),
        fixed(run.candidate),
        fixed(run.readings[0]?.hour ?? null),
        run.promotions.map(({ hour }) => fixed(hour)).join(", ") || "none",
        `${String(run.promotions.filter(({ confirmed }) => confirmed !== null).length)} of ${String(run.promotions.length)}`,
        first === undefined || second === undefined ? "-" : fixed((second - first) / first),
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
      fixed(one.reach),
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
      "median reach",
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
    readonly horizons: readonly number[];
  },
): string {
  const { grades, hours, horizons } = options;
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
  const quality =
    grades === null
      ? "No `--grades`: quality and reach need lane 34's blind grades."
      : [
          byHour(runs, hours, (run, hour) => fixed(run.quality.get(referenceAt(run, hour) ?? "") ?? null)),
          "Mean quality up to each horizon in work hours, `*` where the run stopped first and its last reference holds:",
          table(
            ["run", ...horizons.map((horizon) => `${String(horizon)} h`)],
            runs.map((run) => [
              run.name,
              ...horizons.map((horizon) => {
                const mean = meanTo(run, horizon, (harness) => run.quality.get(harness ?? "") ?? null);
                return `${fixed(mean, 2)}${run.work < horizon ? "*" : ""}`;
              }),
            ]),
          ),
        ].join("\n\n");
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
    "### Quality by the hour",
    quality,
    "### Each comparison",
    ...runs.map(comparisonsOf),
  ].join("\n\n");
}
