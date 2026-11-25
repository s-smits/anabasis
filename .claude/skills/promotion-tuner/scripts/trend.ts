#!/usr/bin/env bun
/**
 * Windowed campaign trend report: runs opened in the newest window of days against preceding
 * windows, pack by pack, across supply, climb, holding, honesty and economy. Read-only; it launches
 * no solves and makes no decisions.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { formatOf, MISSING, printed } from "#skills/main/print.ts";
import { loadRuns, type Run, rungsOf } from "#skills/main/runs.ts";
import { type Shift, shiftOf } from "#skills/main/stats.ts";
import { upperBound } from "#src/kernel/compare.ts";
import { DAY_MS } from "#src/meta/clock.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { median } from "#src/meta/tally.ts";
import { campaignsOf, outsideLines, scoresOf } from "./outside.ts";

const USAGE = `usage:
  bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/trend.ts
    [--window <days>] [--back <n>] [--until <date>] [--pack <pack>]... [--any-setting]
    [--has <text>]... [--holds <commit>]... [--bench <store> [--bench-tasks <list>]]
    [--format md|tsv] [--runs <dir>]

--window       the days a window spans, 7 by default; a run is placed by the day it opened
--back         how many earlier windows the newest is read against, 2 by default
--until        where the newest window ends and every log is read to, now by default; a date
               repeats a reading
--pack         these packs only (repeatable); every pack the newest window holds by default
--any-setting  keep earlier runs under settings the newest window does not hold
--has, --holds only runs whose every launch ran with code that holds this text or commit (repeatable)
--bench        a score store, absolute: adds the outside scores of the promoted harnesses in it
--bench-tasks  the tasks, comma-separated, the outside scores are read on: one part of a read alone
--format       md (default) or tsv
--runs         the campaigns under this folder only, read without the hosts' registry or an env file`;
const OPTIONS = {
  window: "int",
  back: "int",
  until: "text",
  pack: "list",
  "any-setting": "flag",
  has: "list",
  holds: "list",
  bench: "abs",
  "bench-tasks": "text",
  format: "text",
  runs: "abs",
} as const;
/** The level a difference between windows is described at; it decides nothing. */
const LEVEL = 0.05;
/** The hours a run cut short must have lasted to set a block's horizon, half the iteration's
 *  twelve-hour trigger: most runs cut short sooner never ran, and a horizon near the first
 *  comparison would read nothing. */
const FLOOR = 6;
const ALL = "all packs";
const MIXED = "no single direction";
const READINGS = new Map([
  [
    "apart faster",
    "promotions came faster while fewer held, the shape of a climb fitted to its own comparisons",
  ],
  ["apart slower", "promotions came slower and more of them held"],
  ["together faster", "promotions came faster and more of them held"],
  ["together slower", "promotions came slower and fewer held"],
]);

export interface Measure {
  readonly factor: "supply" | "climb" | "holding" | "honesty" | "economy";
  readonly name: string;
  readonly better: "higher" | "lower";
  readonly of: (runs: readonly Run[]) => number | null;
  readonly counts: (runs: readonly Run[]) => string;
}

export interface Window {
  /** 0 for the newest, counting back. */
  readonly back: number;
  readonly from: number;
  readonly to: number;
  readonly runs: readonly Run[];
}

export interface Change {
  /** The newest value over the earlier, less one; null where either is missing or the earlier is 0.
   */
  readonly relative: number | null;
  readonly shift: Shift;
  readonly verdict:
    | "too few runs"
    | "within inter-run variance"
    | "moved, better"
    | "moved, worse"
    | "no value";
}

type Each = (run: Run) => number;

const total = (runs: readonly Run[], each: Each) => runs.reduce((sum, run) => sum + each(run), 0);
const promoted: Each = (run) => run.promotions.length;
const one: Each = () => 1;

/** A ratio of two sums over the runs, so a longer run weighs by its exposure; more is better unless
 *  `lower` says otherwise. */
function rate(factor: Measure["factor"], name: string, part: Each, whole: Each, per = 1): Measure {
  return {
    factor,
    name,
    better: "higher",
    of: (runs) => {
      const denom = total(runs, whole);
      return denom === 0 ? null : (per * total(runs, part)) / denom;
    },
    counts: (runs) => `${total(runs, part).toFixed(0)}/${total(runs, whole).toFixed(0)}`,
  };
}

/** The median of what the runs list, for a time or a cost one slow run would set in a ratio of
 *  sums; less is better. */
function middle(factor: Measure["factor"], name: string, values: (run: Run) => readonly number[]): Measure {
  return {
    factor,
    name,
    better: "lower",
    of: (runs) => median(runs.flatMap(values)),
    counts: (runs) => `n ${String(runs.flatMap(values).length)}`,
  };
}

const lower = (measure: Measure): Measure => ({ ...measure, better: "lower" });

function falseSteps(name: string, part: Each, whole: Each): Measure {
  const measure = lower(rate("honesty", name, part, whole));
  const bound = (runs: readonly Run[]) =>
    (100 * upperBound(total(runs, part), total(runs, whole))).toFixed(1);
  return { ...measure, counts: (runs) => `${measure.counts(runs)}, 95% bound ${bound(runs)}%` };
}

/** Every measure a list of runs is read by, in table order: `table.ts` prints a run's own counts
 *  from these, so a rate has one spelling. */
export const MEASURES = {
  reported: rate(
    "supply",
    "runs that reported a comparison",
    (run) => (run.firstReported === null ? 0 : 1),
    one,
  ),
  firstReport: middle("supply", "hours to the first report", (run) =>
    run.firstReported === null ? [] : [run.firstReported],
  ),
  // The two parts of the hours to a first comparison: the supply's, until admission refuses one
  // nothing, and the wait from then until it begins, which the hours to a first report hide.
  firstAdmissible: middle("supply", "hours until a first comparison is admissible", (run) =>
    run.firstAdmissible === null ? [] : [run.firstAdmissible],
  ),
  heldOff: middle("supply", "hours from then until it began", (run) =>
    run.firstAdmissible === null || run.firstCompared === null
      ? []
      : [run.firstCompared - run.firstAdmissible],
  ),
  room: rate(
    "supply",
    "room on validity, of scored tasks",
    (run) => run.room,
    (run) => run.scored,
  ),
  firstPromotion: middle("climb", "hours to the first promotion", (run) =>
    run.promotions.slice(0, 1).map((first) => first.elapsed),
  ),
  byHorizon: rate("climb", "runs promoted by the horizon", (run) => Math.min(promoted(run), 1), one),
  speed: rate("climb", "promotions per 100 active hours", promoted, (run) => run.active, 100),
  perComparison: rate("climb", "promotions per comparison", promoted, (run) => run.compared),
  rung: middle("climb", "hours per rung", (run) => rungsOf(run).map((rung) => rung.epochElapsed)),
  confirmed: rate(
    "holding",
    "promotions the starter confirmed, of those it read",
    (run) => run.confirmed,
    (run) => run.reads,
  ),
  after: rate(
    "holding",
    "tasks written after a promotion, won of won and lost",
    (run) => run.after.wins,
    (run) => run.after.wins + run.after.losses,
  ),
  onValidity: rate(
    "holding",
    "steps won on validity, of steps",
    (run) => run.onValidity,
    (run) => run.stepped,
  ),
  aa: falseSteps(
    "A/A steps, of A/A able to read one",
    (run) => run.aaSteps,
    (run) => run.controls,
  ),
  aaValidity: falseSteps(
    "A/A steps where reference validity varied",
    (run) => run.aaValiditySteps,
    (run) => run.aaValidityControls,
  ),
  aaObjective: falseSteps(
    "A/A steps on objective alone",
    (run) => run.aaObjectiveSteps,
    (run) => run.aaObjectiveControls,
  ),
  rungDollars: middle("economy", "dollars per rung", (run) => rungsOf(run).map((rung) => rung.dollars)),
  perPromotion: lower(rate("economy", "dollars per promotion", (run) => run.dollars, promoted)),
  // On one meter across the windows, over the runs whose every turn it priced.
  repriced: lower(
    rate(
      "economy",
      "repriced dollars per promotion",
      (run) => run.repriced ?? 0,
      (run) => (run.repriced === null ? 0 : promoted(run)),
    ),
  ),
  perConfirmed: lower(
    rate(
      "economy",
      "dollars per confirmed promotion",
      (run) => run.dollars,
      (run) => run.confirmed,
    ),
  ),
} satisfies Record<string, Measure>;
const LISTED: readonly Measure[] = Object.values(MEASURES);

export function windowsOf(runs: readonly Run[], until: number, days: number, back: number): Window[] {
  return Array.from({ length: back + 1 }, (_, nth) => {
    const [from, to] = [until - (nth + 1) * days * DAY_MS, until - nth * days * DAY_MS];
    return { back: nth, from, to, runs: runs.filter(({ launched }) => launched >= from && launched < to) };
  });
}

export function comparable(windows: readonly Window[]) {
  const held = new Set(windows[0]?.runs.map(({ setting }) => setting));
  return keptOf(windows, ({ setting }) => held.has(setting));
}

function keptOf(windows: readonly Window[], keep: (run: Run) => boolean) {
  const kept = windows.map((window) => ({ ...window, runs: window.runs.filter(keep) }));
  const size = (each: readonly Window[]) => each.reduce((sum, { runs }) => sum + runs.length, 0);
  return { windows: kept, left: size(windows) - size(kept) };
}

/** Whether nothing in a run ended it: it is live, was paused or killed, or the operator stopped it.
 *  A run that ended on its own terms is known at any age. */
const cutShort = (run: Run) => run.live || run.ending === "no ending" || run.ending === "operator";

/** A block's windows with every run read at its horizon by `at` (`loadRuns`), and the line that
 *  says so. Where no newest run was cut short past `FLOOR`, each run is read whole, and only runs
 *  cut short before the floor are left out. */
function atHorizon(windows: readonly Window[], at: (run: Run, hours: number) => Run) {
  const ages = (windows[0]?.runs ?? []).flatMap((run) =>
    cutShort(run) && run.elapsed >= FLOOR ? [run.elapsed] : [],
  );
  const hours = Math.min(...ages);
  const { windows: kept, left } = keptOf(
    windows,
    (run) => !cutShort(run) || run.elapsed >= (Number.isFinite(hours) ? hours : FLOOR),
  );
  const read = Number.isFinite(hours)
    ? `Read at ${hours.toFixed(1)} hours from each run's first event, the least a newest run cut short has lasted past ${String(FLOOR)} h`
    : `No newest run was cut short past ${String(FLOOR)} h, so each run is read whole`;
  return {
    windows: kept.map((window) => ({ ...window, runs: window.runs.map((run) => at(run, hours)) })),
    line: `${read}; ${counted(left, "run")} cut short sooner ${left === 1 ? "is" : "are"} left out.`,
  };
}

export function changeOf(measure: Measure, then: readonly Run[], now: readonly Run[]): Change {
  const [before, after] = [measure.of(then), measure.of(now)];
  const shift = shiftOf(then, now, measure.of);
  const relative = before === null || after === null || before === 0 ? null : after / before - 1;
  if (shift.p === null || before === null || after === null) return { relative, shift, verdict: "no value" };
  if ((shift.least ?? 1) > LEVEL) return { relative, shift, verdict: "too few runs" };
  if (shift.p > LEVEL) return { relative, shift, verdict: "within inter-run variance" };
  const up = after > before;
  return {
    relative,
    shift,
    verdict: up === (measure.better === "higher") ? "moved, better" : "moved, worse",
  };
}

export function valued(measure: Measure, runs: readonly Run[]): string {
  const value = measure.of(runs);
  if (value === null) return MISSING;
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} (${measure.counts(runs)})`;
}

/** A difference as a cell: the relative change, p and the verdict. A sampled p is never zero, so
 *  the smallest one printed is a bound. */
function changed({ relative, shift, verdict }: Change): string {
  if (verdict === "no value") return MISSING;
  const moved =
    relative === null ? "" : `${relative >= 0 ? "+" : "-"}${Math.abs(100 * relative).toFixed(0)}%, `;
  const untested = shift.p === null || verdict === "too few runs";
  const chance = untested ? "" : shift.p < 0.001 ? "p < 0.001, " : `p ${shift.p.toFixed(3)}, `;
  return `${moved}${chance}${verdict}`;
}
const day = (at: number) => new Date(at).toISOString().slice(0, 10);
const labelOf = ({ back }: Window) => (back === 0 ? "now" : `${String(back)} back`);
const counted = (count: number, what: string) => `${String(count)} ${what}${count === 1 ? "" : "s"}`;

function pooledLine(window: Window): string {
  const distinct = (key: "release" | "setting") => [...new Set(window.runs.map((run) => run[key]))];
  const opened = `${labelOf(window)}: opened ${day(window.from)} to ${day(window.to - 1)}`;
  if (window.runs.length === 0) return `${opened}, no run`;
  return `${opened}, ${counted(window.runs.length, "run")}, ${counted(distinct("setting").length, "setting")}, ${distinct("release").join(", ")}`;
}

export function guardOf(
  then: readonly Run[],
  now: readonly Run[],
  precomputed: ReadonlyMap<Measure, Change> | null = null,
): { pattern: string; line: string } {
  const read = [MEASURES.speed, MEASURES.confirmed, MEASURES.after].map((measure) => ({
    measure,
    change: precomputed?.get(measure) ?? changeOf(measure, then, now),
  }));
  const [speed, ...held] = read.map(({ change }) => change);
  if (speed?.verdict === "no value" || held.every(({ verdict }) => verdict === "no value")) {
    return {
      pattern: "not read",
      line: "not read: a window holds no promotion the starter read, or no active hour.",
    };
  }
  const faster = Math.sign(speed?.relative ?? 0);
  // What holds a promotion is read on both counts where both have a value, and they must agree.
  const signs = held.map(({ relative }) => Math.sign(relative ?? 0)).filter((sign) => sign !== 0);
  const holding = signs.every((sign) => sign === signs[0]) ? (signs[0] ?? 0) : 0;
  const pattern = faster === 0 || holding === 0 ? MIXED : faster === holding ? "together" : "apart";
  const reading =
    READINGS.get(`${pattern} ${faster > 0 ? "faster" : "slower"}`) ??
    "speed did not move, or the two holding counts moved opposite ways";
  // The pattern is read from signs, so it says beside itself whether any of them is past the spread.
  const past = read.some(({ change }) => change.verdict.startsWith("moved"));
  const told = read.map(
    ({ measure, change }) =>
      `${measure.name} ${valued(measure, now)} against ${valued(measure, then)} (${changed(change)})`,
  );
  return {
    pattern,
    line: `${pattern}: ${reading}${past ? "" : "; none of the three moved past the spread between runs, so the pattern is a lead only"}. ${told.join("; ")}.`,
  };
}

function packLines(
  pack: string,
  read: { windows: readonly Window[]; left: number; line: string },
  format: "md" | "tsv",
) {
  const { windows, left } = read;
  const [now, ...before] = windows;
  if (now === undefined) return { lines: [], tested: 0, moved: 0 };
  // A window without a run is named once and takes no column, difference or guard line.
  const earlier = before.filter(({ runs }) => runs.length > 0);
  const changes = LISTED.map((measure) => earlier.map((then) => changeOf(measure, then.runs, now.runs)));
  const named = format === "tsv" ? [pack] : [];
  const rows = LISTED.map((measure, at) => [
    ...named,
    measure.factor,
    measure.name,
    ...[now, ...earlier].map((window) => valued(measure, window.runs)),
    ...(changes[at] ?? []).map(changed),
  ]);
  const head = [
    ...named.map(() => "pack"),
    "factor",
    "measure",
    ...[now, ...earlier].map(labelOf),
    ...earlier.map((then) => `current vs ${labelOf(then)}`),
  ];
  const verdicts = changes.flat().map(({ verdict }) => verdict);
  const moved = verdicts.filter((verdict) => verdict.startsWith("moved")).length;
  const counts = {
    tested: moved + verdicts.filter((verdict) => verdict === "within inter-run variance").length,
    moved,
  };
  if (format === "tsv") return { lines: [printed(head, rows, format)], ...counts };
  // Runs of different minor releases measure different things.
  const minors = (window: Window) =>
    new Set(window.runs.flatMap(({ release }) => /v\d+\.\d+/u.exec(release)?.[0] ?? []));
  const notes = [
    read.line,
    left > 0 && `Left out: ${String(left)} earlier runs under settings the newest window does not hold.`,
    pack === ALL &&
      "Every pack and setting is pooled here, so a difference can be the mix of packs alone: read each pack's block first.",
    earlier.length === 0 && "No earlier window holds a run to read the newest against.",
    ...earlier.map(
      (then) =>
        minors(then).symmetricDifference(minors(now)).size > 0 &&
        `Now against ${labelOf(then)} spans minor releases, which change what a run measures: a description of the record, not the effect of a change.`,
    ),
  ];
  return {
    lines: [
      `## ${pack}`,
      "",
      ...windows.map(pooledLine),
      ...notes.filter((note) => note !== false),
      "",
      printed(head, rows, format),
      "",
      ...earlier.map((then, nth) => {
        const computed = new Map(LISTED.map((measure, at) => [measure, changes[at]?.[nth]] as const));
        const kept = new Map(
          [...computed].flatMap(([measure, change]) =>
            change === undefined ? [] : [[measure, change] as const],
          ),
        );
        return `Climb vs confirmation (current vs ${labelOf(then)}): ${guardOf(then.runs, now.runs, kept).line}`;
      }),
      "",
    ],
    ...counts,
  };
}

async function main(args: CommandArgs): Promise<number> {
  const format = formatOf(args);
  const [days, back] = [args.int("window") ?? 7, args.int("back") ?? 2];
  if (days < 1 || back < 1) return args.die("--window and --back take a whole number from 1");
  const named = args.value("until");
  const until = named === null ? Date.now() : Date.parse(named);
  if (Number.isNaN(until)) return args.die(`--until takes a date; got ${named ?? ""}`);
  const kept = { home: args.value("runs"), repo: runtimeProcess.cwd() };
  const { runs, skipped, at } = await loadRuns({
    until,
    ...kept,
    since: day(until - (back + 1) * days * DAY_MS),
    has: args.list("has"),
    holds: args.list("holds"),
  });
  const windows = windowsOf(runs, until, days, back);
  const asked = args.list("pack");
  const packs = asked.length > 0 ? asked : [...new Set(windows[0]?.runs.map(({ pack }) => pack))].toSorted();
  let [tested, moved] = [0, 0];
  for (const pack of packs.length === 1 || asked.length > 0 ? packs : [...packs, ALL]) {
    const own = windows.map((window) => ({
      ...window,
      runs: pack === ALL ? window.runs : window.runs.filter((run) => run.pack === pack),
    }));
    const read = pack === ALL || args.flag("any-setting") ? { windows: own, left: 0 } : comparable(own);
    const block = packLines(pack, { ...atHorizon(read.windows, at), left: read.left }, format);
    console.log(block.lines.join("\n"));
    // The pooled block reads the packs' runs again, so its tests are no further tests.
    if (pack === ALL) continue;
    tested += block.tested;
    moved += block.moved;
  }
  const bench = args.value("bench");
  if (bench !== null) {
    const scores = scoresOf(bench, args.value("bench-tasks")?.split(",") ?? null);
    const names = campaignsOf(scores);
    const built =
      names.length === 0 ? { runs: [], skipped: [] } : await loadRuns({ ...kept, since: "", names });
    console.log(outsideLines(scores, [...built.runs, ...runs], format).join("\n"));
    skipped.push(...built.skipped);
  }
  if (format === "tsv") return 0;
  console.log(
    `\n${String(tested)} per-pack tests at alpha=${String(LEVEL)}: ${String(moved)} flagged as shifted. Under a true null, each test fires at 5%; because metrics share runs and counts, false shifts tend to cluster rather than occur independently.`,
  );
  console.log(
    "Campaigns are the unit of analysis: p is the permutation share of window reassignments that separate the metric at least as far. Rows are descriptive only and do not represent a step or govern promotion.",
  );
  if (skipped.length > 0) console.log(`not read (${String(skipped.length)}): ${skipped.join("; ")}`);
  return 0;
}

if (import.meta.main) await runCommand({ name: "trend", usage: USAGE, options: OPTIONS }, main);
