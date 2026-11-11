#!/usr/bin/env bun
/**
 * Then and now: the runs that opened in the newest window of days set against those of the windows
 * before it, pack by pack, over one list of measures, with each difference tested against the
 * spread between runs. It answers "is the system doing better than a week and two weeks ago" from
 * the record, and whether a faster climb is one that holds. It starts no solve, calls no model and
 * writes nothing; no reading here is a step or a comparison of harnesses, and a pattern is a lead
 * for an investigation (`AGENTS.md` section 1, "Deciding sooner against reporting first").
 *
 * A row is the fold of `.claude/skills/main/runs.ts`, placed by the day the run opened. Results are
 * never read across settings (section 9), so an earlier window keeps only the runs under a setting
 * the newest window of that pack holds, and a window that spans a minor release says so. The newest
 * runs are younger and are paused at their trigger, so every measure is a rate with its exposure as
 * the denominator or a median, never a count a longer run would win by lasting. One campaign is one
 * draw: a difference is put to a permutation test with the campaign as the unit (`main/stats.ts`),
 * and reads `moved` at p <= 0.05, `inside the spread` above it, and `too few runs` where the
 * windows could read nothing at that level whatever happened.
 *
 * A campaign selects on its own comparisons, so more promotions an hour is a gain only where they
 * hold: one line a window sets the speed beside the promotions the starter confirmed and the tasks
 * written after a promotion that the reference still won (`guardOf`), and `--bench` adds the
 * outside scores of the promoted harnesses (`outside.ts`). It prints counts and pack names, never a
 * task, an answer or a check.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { formatOf, MISSING, printed } from "#skills/main/print.ts";
import { loadRuns, promotedBy, type Run, rungsOf } from "#skills/main/runs.ts";
import { type Shift, shiftOf } from "#skills/main/stats.ts";
import { DAY_MS } from "#src/meta/clock.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { median } from "#src/meta/tally.ts";
import { campaignsOf, outsideLines, scoresOf } from "./outside.ts";

const USAGE = `usage:
  bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/trend.ts
    [--window <days>] [--back <n>] [--until <date>] [--pack <pack>]... [--any-setting]
    [--has <text>]... [--holds <commit>]... [--bench <store>] [--format md|tsv] [--runs <dir>]

--window       the days a window spans, 7 by default; a run is placed by the day it opened
--back         how many earlier windows the newest is read against, 2 by default
--until        where the newest window ends, now by default; a date repeats a reading
--pack         these packs only (repeatable); every pack the newest window holds by default
--any-setting  keep earlier runs under settings the newest window does not hold
--has, --holds only runs whose every launch ran with code that holds this text or commit (repeatable)
--bench        a score store, absolute: adds the outside scores of the promoted harnesses in it
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
  format: "text",
  runs: "abs",
} as const;
/** The level a difference between windows is described at; it decides nothing. */
const LEVEL = 0.05;
/** The elapsed hours a run's first promotion is counted by, the iteration's trigger. */
const MARK = 12;
const ALL = "all packs";
const MIXED = "no single direction";
/** What a pattern says, by whether promotions came faster. */
const READINGS = new Map([
  [
    "apart faster",
    "promotions came faster while fewer held, the shape of a climb fitted to its own comparisons",
  ],
  ["apart slower", "promotions came slower and more of them held"],
  ["together faster", "promotions came faster and more of them held"],
  ["together slower", "promotions came slower and fewer held"],
]);

/** One quantity read over a list of runs. */
export interface Measure {
  readonly factor: "supply" | "climb" | "holding" | "honesty" | "economy";
  readonly name: string;
  readonly better: "higher" | "lower";
  /** Its value over the runs, null where its denominator is empty. */
  readonly of: (runs: readonly Run[]) => number | null;
  /** The counts the value is made of. */
  readonly counts: (runs: readonly Run[]) => string;
}

/** One window of days and the runs that opened in it. */
export interface Window {
  /** 0 for the newest, counting back. */
  readonly back: number;
  readonly from: number;
  readonly to: number;
  readonly runs: readonly Run[];
}

/** A difference between two windows in one measure, as read. */
export interface Change {
  /** The newest value over the earlier, less one; null where either is missing or the earlier is 0. */
  readonly relative: number | null;
  readonly shift: Shift;
  readonly verdict: "too few runs" | "inside the spread" | "moved, better" | "moved, worse" | "no value";
}

type Each = (run: Run) => number;

const total = (runs: readonly Run[], each: Each) => runs.reduce((sum, run) => sum + each(run), 0);
const promoted: Each = (run) => run.promotions.length;

/** A ratio of two sums over the runs, so that a longer run weighs by its exposure; more is better
 *  unless `lower` says otherwise. */
function rate(factor: Measure["factor"], name: string, part: Each, whole: Each, per = 1): Measure {
  return {
    factor,
    name,
    better: "higher",
    of: (runs) => (total(runs, whole) === 0 ? null : (per * total(runs, part)) / total(runs, whole)),
    counts: (runs) => `${total(runs, part).toFixed(0)}/${total(runs, whole).toFixed(0)}`,
  };
}

/** The median of what the runs list, a time or a cost that a ratio of sums would let one slow run
 *  set; less is better. */
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

/** Every measure a list of runs is read by, in the order a table gives them: `table.ts` prints a
 *  run's own counts from these, so a rate has one spelling. */
export const MEASURES = {
  reported: rate(
    "supply",
    "runs that reported a comparison",
    (run) => (run.firstReported === null ? 0 : 1),
    (run) => (run.firstReported !== null || !run.live ? 1 : 0),
  ),
  firstReport: middle("supply", "hours to the first report", (run) =>
    run.firstReported === null ? [] : [run.firstReported],
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
  byMark: rate(
    "climb",
    `runs promoted by ${String(MARK)} h`,
    (run) => promotedBy([run], MARK).promoted,
    (run) => promotedBy([run], MARK).known,
  ),
  speed: rate("climb", "promotions a 100 active hours", promoted, (run) => run.active, 100),
  perComparison: rate("climb", "promotions a comparison", promoted, (run) => run.compared),
  rung: middle("climb", "hours a rung", (run) => rungsOf(run).map((rung) => rung.epochElapsed)),
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
  aa: lower(
    rate(
      "honesty",
      "A/A steps, of A/A able to read one",
      (run) => run.aaSteps,
      (run) => run.controls,
    ),
  ),
  rungDollars: middle("economy", "dollars a rung", (run) => rungsOf(run).map((rung) => rung.dollars)),
  perPromotion: lower(rate("economy", "dollars a promotion", (run) => run.dollars, promoted)),
  perConfirmed: lower(
    rate(
      "economy",
      "dollars a confirmed promotion",
      (run) => run.dollars,
      (run) => run.confirmed,
    ),
  ),
} satisfies Record<string, Measure>;
const LISTED: readonly Measure[] = Object.values(MEASURES);

/** The runs by the window each opened in, newest window first; a run outside every window is in
 *  none. */
export function windowsOf(runs: readonly Run[], until: number, days: number, back: number): Window[] {
  return Array.from({ length: back + 1 }, (_, nth) => {
    const [from, to] = [until - (nth + 1) * days * DAY_MS, until - nth * days * DAY_MS];
    return { back: nth, from, to, runs: runs.filter(({ launched }) => launched >= from && launched < to) };
  });
}

/** One pack's windows under the settings its newest window holds, and how many earlier runs under
 *  other settings were left out. */
export function comparable(windows: readonly Window[]) {
  const held = new Set(windows[0]?.runs.map(({ setting }) => setting));
  const kept = windows.map((window) => ({
    ...window,
    runs: window.runs.filter(({ setting }) => held.has(setting)),
  }));
  const left = windows.reduce(
    (sum, window, at) => sum + window.runs.length - (kept[at]?.runs.length ?? 0),
    0,
  );
  return { windows: kept, left };
}

export function changeOf(measure: Measure, then: readonly Run[], now: readonly Run[]): Change {
  const [before, after] = [measure.of(then), measure.of(now)];
  const shift = shiftOf(then, now, measure.of);
  const relative = before === null || after === null || before === 0 ? null : after / before - 1;
  if (shift.p === null || before === null || after === null) return { relative, shift, verdict: "no value" };
  if (shift.deals < 2 / LEVEL) return { relative, shift, verdict: "too few runs" };
  if (shift.p > LEVEL) return { relative, shift, verdict: "inside the spread" };
  const up = after > before;
  return {
    relative,
    shift,
    verdict: up === (measure.better === "higher") ? "moved, better" : "moved, worse",
  };
}

/** A measure's value over the runs beside the counts it is made of, to the digits its size needs. */
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

/** What a window pools, so that a reader sees what its runs do not share. */
function pooledLine(window: Window): string {
  const distinct = (key: "release" | "setting") => [...new Set(window.runs.map((run) => run[key]))];
  const opened = `${labelOf(window)}: opened ${day(window.from)} to ${day(window.to - 1)}`;
  if (window.runs.length === 0) return `${opened}, no run`;
  return `${opened}, ${counted(window.runs.length, "run")}, ${counted(distinct("setting").length, "setting")}, ${distinct("release").join(", ")}`;
}

/** The climb set against what holds it, between two windows: the pattern and its three counts. */
export function guardOf(then: readonly Run[], now: readonly Run[]): { pattern: string; line: string } {
  const read = [MEASURES.speed, MEASURES.confirmed, MEASURES.after].map((measure) => ({
    measure,
    change: changeOf(measure, then, now),
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

/** One pack's block: what its windows pool, the measures by window, and the guard lines. */
function packLines(pack: string, windows: readonly Window[], left: number, format: "md" | "tsv") {
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
    ...earlier.map((then) => `now against ${labelOf(then)}`),
  ];
  const verdicts = changes.flat().map(({ verdict }) => verdict);
  const moved = verdicts.filter((verdict) => verdict.startsWith("moved")).length;
  const counts = {
    tested: moved + verdicts.filter((verdict) => verdict === "inside the spread").length,
    moved,
  };
  if (format === "tsv") return { lines: [printed(head, rows, format)], ...counts };
  // Runs of different minor releases measure different things.
  const minors = (window: Window) =>
    new Set(window.runs.flatMap(({ release }) => /v\d+\.\d+/u.exec(release)?.[0] ?? []));
  const notes = [
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
      ...earlier.map(
        (then) =>
          `Climb against what holds it, now against ${labelOf(then)}: ${guardOf(then.runs, now.runs).line}`,
      ),
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
  const { runs, skipped } = await loadRuns({
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
    // Every pack pooled is read only as a whole, where a setting is one pack's concern.
    const read = pack === ALL || args.flag("any-setting") ? { windows: own, left: 0 } : comparable(own);
    const block = packLines(pack, read.windows, read.left, format);
    console.log(block.lines.join("\n"));
    tested += block.tested;
    moved += block.moved;
  }
  const bench = args.value("bench");
  if (bench !== null) {
    const scores = scoresOf(bench);
    // No name keeps every campaign, so a store whose arms no campaign built folds none.
    const names = campaignsOf(scores);
    const built =
      names.length === 0 ? { runs: [], skipped: [] } : await loadRuns({ ...kept, since: "", names });
    // An arm is joined by its digest, so the windows' runs stand in where a record names no campaign.
    console.log(outsideLines(scores, [...built.runs, ...runs], format).join("\n"));
    skipped.push(...built.skipped);
  }
  if (format === "tsv") return 0;
  console.log(
    `\n${String(tested)} differences tested at ${String(LEVEL)}, ${String(moved)} read moved; about ${(tested * LEVEL).toFixed(1)} would by chance where nothing changed.`,
  );
  console.log(
    "A campaign is the unit: p is the share of ways to deal the two windows' campaigns out again that move the measure as far apart. No row is a step or a comparison of harnesses, and none decides a promotion.",
  );
  if (skipped.length > 0) console.log(`not read (${String(skipped.length)}): ${skipped.join("; ")}`);
  return 0;
}

if (import.meta.main) await runCommand({ name: "trend", usage: USAGE, options: OPTIONS }, main);
