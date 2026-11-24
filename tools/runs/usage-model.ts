/**
 * A light forecast of how much of each login's week every hour of the next `HORIZON` spends: an
 * xgboost-like predictor that costs next to no CPU (the operator's choice), to say on the day
 * whether use will rise. It is boosted regression trees of depth 2 of the rise an
 * hour (`fit`), on squared loss with xgboost's histogram splits, fitted afresh on every `runs usage` from the last 7, 14 or 28
 * days of readings, whichever reads the held-out hours best (`WINDOWS`): one model over every login,
 * applied to each login's own state. A longer window holds more weeks, a shorter one only the
 * pattern of the present release and its runs.
 *
 * The pool (`modelLines`, printed by `bun run runs usage`): a run moves to another login when one is
 * spent, so demand is one rate, in % of one login's week an hour, summed over the logins with room
 * left; the forecast spends it in five-minute steps for the next 4 weeks from the login whose week
 * resets soonest, each refilled at its reset. The pool is the logins a run may spend: those
 * `ANA_LOGINS` names and any that carries live runs already. A login out of the pool with no run is
 * a person's to spend, so it is neither demand nor room, and only its own lines forecast it. One
 * forecast is printed, the one that read the last hours held out best: the model's, where it beats
 * both older paces; otherwise the better of the week's pace (each login's share over its window so
 * far, floored at 12 hours, so a window minutes old does not extrapolate) and the per-run rate times
 * each login's live runs. Where the model is printed, each login's head line names the hour its week
 * ends by the model (`modelLines`), so the head and the forecast name one hour.
 */
import { HOUR_MS } from "#src/meta/clock.ts";

export interface Snapshot {
  readonly at: number;
  readonly weeks: Record<string, { pct: number; reset: number }>;
  /** Each login's live runs when the reading was taken; older readings hold none. */
  readonly runs?: Record<string, number>;
  /** Each closed login's reset (`login-state.ts`); older readings hold none. */
  readonly closed?: Record<string, number>;
}

interface Row {
  readonly at: number;
  readonly hours: number;
  readonly runs: number;
  /** The login's week pace at the reading, in % of its week an hour, and what its week had left. */
  readonly pace: number;
  readonly left: number;
  readonly x: readonly number[];
  readonly y: number;
}

type Tree =
  | { readonly value: number }
  | { readonly feature: number; readonly cut: number; readonly low: Tree; readonly high: Tree };

interface Model {
  readonly base: number;
  readonly trees: readonly Tree[];
}

/** How the model and the two older paces did on the held-out hours, and the model refitted on every
 *  row where it beat both there. */
interface Assessment {
  readonly held: number;
  readonly days: number;
  readonly error: number;
  readonly week: number;
  readonly run: number;
  readonly model: Model | null;
}

export interface Week {
  readonly login: string;
  readonly pct: number;
  readonly reset: number;
  /** Whether a run may spend this week: the login is in the pool or carries live runs already. The
   *  pool's demand and room are these weeks alone (`poolLine`, `modelLines`). */
  readonly room?: boolean;
}

/** A login's week end by the model, and whether its live runs kept going brought it sooner. */
export interface End {
  readonly at: number | null;
  readonly runs: boolean;
}

const WEEK = 168 * HOUR_MS;
const AHEAD = 4 * WEEK;
const STEP = HOUR_MS / 12;
const HORIZON = 24;
/** The days a fit may read, each tried, the one with the lower held-out error kept. */
const WINDOWS = [7, 14, 28] as const;
const HELD = 48;
const ROUNDS = 60;
const SHRINK = 0.1;
const DEPTH = 2;
const LEAF = 8;
const CUTS = 32;
const NONE = -1;
/** The hours back the rise before a reading is read over. */
const BEFORE = { least: 3, most: 6 } as const;
/** Readings closer than this to the last one kept are a burst, and make no row of their own. */
const APART = HOUR_MS / 2;

/** The share of its week `week` has spent an hour since it opened, at `at`, floored at 12 hours so
 *  a window minutes old does not extrapolate. */
export const weekPace = (week: { pct: number; reset: number }, at: number) =>
  week.pct / Math.max(12, (at - (week.reset - 168 * HOUR_MS)) / HOUR_MS);
/** Whether reading `later` of a login's week is in the window of reading `earlier`: their resets
 *  agree within an hour and its use has not fallen. A fall is a window opened afresh without a new
 *  reset, as when a login's plan is upgraded and its use falls to 0% under one reset, so a rise read
 *  across it would be counted as none. */
export const sameWindow = (earlier: { pct: number; reset: number }, later: { pct: number; reset: number }) =>
  Math.abs(earlier.reset - later.reset) < HOUR_MS && later.pct >= earlier.pct;
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
/** The readings of `history` that counted live runs, in time order. */
export const byTime = (history: readonly Snapshot[]) =>
  history.filter(({ runs }) => runs !== undefined).toSorted((one, other) => one.at - other.at);

/** The rise an hour of `login` up to reading `index` of `sorted`, from the nearest reading `BEFORE`
 *  it in the same window, or `NONE`. */
function riseBefore(sorted: readonly Snapshot[], index: number, login: string): number {
  const now = sorted[index]?.weeks[login];
  const at = sorted[index]?.at ?? 0;
  let then: Snapshot | undefined;
  for (let back = index - 1; back >= 0 && then === undefined; back -= 1) {
    const one = sorted[back];
    if (one === undefined || at - one.at > BEFORE.most * HOUR_MS) break;
    if (at - one.at >= BEFORE.least * HOUR_MS && one.weeks[login] !== undefined) then = one;
  }
  const was = then?.weeks[login];
  if (now === undefined || then === undefined || was === undefined || !sameWindow(was, now)) return NONE;
  return (now.pct - was.pct) / ((at - then.at) / HOUR_MS);
}

/** The features of `login` at reading `index` of `sorted`, before the horizon is added. */
function stateOf(sorted: readonly Snapshot[], index: number, login: string): number[] {
  const { at, runs = {}, weeks } = sorted[index] ?? { at: 0, weeks: {} };
  const date = new Date(at);
  const day = date.getDay();
  const all = Object.values(runs).reduce((sum, count) => sum + count, 0);
  const left = 100 - (weeks[login]?.pct ?? 100);
  const weekend = day === 0 || day === 6 ? 1 : 0;
  const open = Object.values(weeks).filter(({ pct }) => pct < 100).length;
  return [runs[login] ?? 0, all, date.getHours(), weekend, left, riseBefore(sorted, index, login), open];
}

const withHorizon = (state: readonly number[], at: number, hours: number) => [
  ...state,
  hours,
  new Date(at + hours * HOUR_MS).getHours(),
];

/** A row for each login and horizon at each reading at least `APART` after the last one kept. */
function rowsOf(sorted: readonly Snapshot[]): Row[] {
  const kept: number[] = [];
  for (const [index, one] of sorted.entries()) {
    const last = sorted[kept.at(-1) ?? -1];
    if (last === undefined || one.at - last.at >= APART) kept.push(index);
  }
  return kept.flatMap((index) => {
    const then = sorted[index];
    if (then === undefined) return [];
    let end = index + 1;
    while (end < sorted.length && (sorted[end]?.at ?? 0) - then.at <= (HORIZON + 0.5) * HOUR_MS) end += 1;
    const soon = sorted.slice(index + 1, end);
    return Object.entries(then.weeks).flatMap(([login, was]) => {
      const state = stateOf(sorted, index, login);
      return Array.from({ length: HORIZON }, (_, at) => at + 1).flatMap((hours) => {
        const later = soon.find(({ at }) => Math.abs(at - then.at - hours * HOUR_MS) <= HOUR_MS / 2);
        const now = later?.weeks[login];
        if (now === undefined || !sameWindow(was, now)) return [];
        const x = withHorizon(state, then.at, hours);
        const runs = then.runs?.[login] ?? 0;
        return [
          {
            at: then.at,
            hours,
            runs,
            pace: weekPace(was, then.at),
            left: 100 - was.pct,
            x,
            y: now.pct - was.pct,
          },
        ];
      });
    });
  });
}

/** At most `CUTS` thresholds between the distinct values of `column`, spread over them. */
function cutsOf(column: readonly number[]): number[] {
  const values = [...new Set(column)].toSorted((one, other) => one - other);
  const mids = values.slice(1).map((value, at) => (value + (values[at] ?? value)) / 2);
  const step = Math.max(1, mids.length / CUTS);
  return mids.filter((_, at) => Math.floor(at % step) === 0);
}

/** The split of the rows `of` that most lowers the squared error of their residuals, read from
 *  each feature's histogram, or null with none that leaves `LEAF` rows a side. */
function bestSplit(
  of: readonly number[],
  bins: readonly (readonly number[])[],
  residuals: readonly number[],
  cuts: readonly (readonly number[])[],
) {
  let best: { feature: number; bin: number; gain: number } | null = null;
  const total = { n: of.length, sum: of.reduce((all, at) => all + (residuals[at] ?? 0), 0) };
  for (const [feature, row] of cuts.entries()) {
    const count = Array.from({ length: row.length + 1 }, () => 0);
    const sum = Array.from({ length: row.length + 1 }, () => 0);
    for (const at of of) {
      const bin = bins[at]?.[feature] ?? 0;
      count[bin] = (count[bin] ?? 0) + 1;
      sum[bin] = (sum[bin] ?? 0) + (residuals[at] ?? 0);
    }
    const low = { n: 0, sum: 0 };
    for (let bin = 0; bin < row.length; bin += 1) {
      low.n += count[bin] ?? 0;
      low.sum += sum[bin] ?? 0;
      const high = { n: total.n - low.n, sum: total.sum - low.sum };
      if (low.n < LEAF || high.n < LEAF) continue;
      const gain = (low.sum * low.sum) / low.n + (high.sum * high.sum) / high.n;
      if (best === null || gain > best.gain) best = { feature, bin, gain };
    }
  }
  return best;
}

function grow(
  of: readonly number[],
  bins: readonly (readonly number[])[],
  residuals: readonly number[],
  cuts: readonly (readonly number[])[],
  depth: number,
): Tree {
  const split = depth === 0 || of.length < 2 * LEAF ? null : bestSplit(of, bins, residuals, cuts);
  if (split === null) return { value: mean(of.map((at) => residuals[at] ?? 0)) };
  const { feature, bin } = split;
  const below = (at: number) => (bins[at]?.[feature] ?? 0) <= bin;
  return {
    feature,
    cut: cuts[feature]?.[bin] ?? 0,
    low: grow(of.filter(below), bins, residuals, cuts, depth - 1),
    high: grow(
      of.filter((at) => !below(at)),
      bins,
      residuals,
      cuts,
      depth - 1,
    ),
  };
}

const valueOf = (tree: Tree, x: readonly number[]): number =>
  "value" in tree ? tree.value : valueOf((x[tree.feature] ?? 0) < tree.cut ? tree.low : tree.high, x);

/** The model of a login's rise an hour over each row's horizon. A model of the rise itself split
 *  the horizon too coarsely for the first hours, forecasting about two points at one hour where an
 *  hour mostly adds 0 or 1; the rate's held-out error is lower over nearly every horizon and cut,
 *  above all at one hour. */
function fit(rows: readonly Row[]): Model {
  const xs = rows.map(({ x }) => x);
  const cuts = (xs[0] ?? []).map((_, feature) => cutsOf(xs.map((x) => x[feature] ?? 0)));
  // Each row's bin, feature by feature: how many of that feature's cuts lie at or below its value,
  // so a row is below cut `b` exactly when its bin is at most `b`.
  const bins = xs.map((x) =>
    cuts.map((row, feature) => row.filter((cut) => cut <= (x[feature] ?? 0)).length),
  );
  const all = rows.map((_, at) => at);
  const rates = rows.map(({ y, hours }) => y / hours);
  const base = mean(rates);
  const trees: Tree[] = [];
  let guesses = rows.map(() => base);
  for (let round = 0; round < ROUNDS; round += 1) {
    const residuals = rates.map((rate, at) => rate - (guesses[at] ?? base));
    const tree = grow(all, bins, residuals, cuts, DEPTH);
    trees.push(tree);
    guesses = guesses.map((guess, at) => guess + SHRINK * valueOf(tree, xs[at] ?? []));
  }
  return { base, trees };
}

/** The rise `model` reads over `hours` from features `x`, never below none nor above `left`. */
const predict = (model: Model, x: readonly number[], hours: number, left: number) =>
  Math.min(
    left,
    hours * Math.max(0, model.base + SHRINK * model.trees.reduce((sum, tree) => sum + valueOf(tree, x), 0)),
  );

/** Fits on the rows of each of `WINDOWS` that end before the last `HELD` hours, and reads the mean
 *  absolute error on the rows of those hours for a login with room, of the fit with the lower one, of
 *  the week pace, and of `rateOf` the earlier readings times each row's runs, each capped at what the
 *  week has left. Null with no row to hold out or none to fit before it. */
export function assess(
  history: readonly Snapshot[],
  now: number,
  rateOf: (history: readonly Snapshot[]) => number | null,
): Assessment | null {
  const sorted = byTime(
    history.filter(({ at }) => at <= now && now - at < (WINDOWS.at(-1) ?? 0) * 24 * HOUR_MS),
  );
  const rows = rowsOf(sorted);
  const cut = now - HELD * HOUR_MS;
  const held = rows.filter(({ at, left }) => at >= cut && left > 0);
  const errorOf = (guess: (row: Row) => number) => mean(held.map((row) => Math.abs(guess(row) - row.y)));
  const since = (days: number) => rows.filter(({ at }) => now - at < days * 24 * HOUR_MS);
  // A window reaching past the oldest reading reads what a shorter one did, so it is not fitted.
  const oldest = sorted[0]?.at ?? now;
  const tried = WINDOWS.filter(
    (_, at) => at === 0 || now - oldest >= (WINDOWS[at - 1] ?? 0) * 24 * HOUR_MS,
  ).flatMap((days) => {
    const before = since(days).filter(({ at, hours }) => at + (hours + 0.5) * HOUR_MS < cut);
    if (before.length === 0) return [];
    const early = fit(before);
    return [{ days, error: errorOf((row) => predict(early, row.x, row.hours, row.left)) }];
  });
  if (held.length === 0 || tried.length === 0) return null;
  const best = tried.reduce((one, other) => (other.error < one.error ? other : one));
  const rate = rateOf(history.filter(({ at }) => at < cut)) ?? 0;
  const run = errorOf((row) => Math.min(row.left, row.runs * rate * row.hours));
  const week = errorOf((row) => Math.min(row.left, row.pace * row.hours));
  const model = best.error < Math.min(run, week) ? fit(since(best.days)) : null;
  return { held: held.length, days: best.days, error: best.error, week, run, model };
}

/** Each login's rise after the last reading of `history`, by `model`, hour by hour to `HORIZON`:
 *  never falling from one hour to the next, and never more than its week has left. */
function ahead(model: Model, history: readonly Snapshot[]): Record<string, number[]> {
  const sorted = byTime(history);
  const last = sorted.at(-1);
  if (last === undefined) return {};
  return Object.fromEntries(
    Object.entries(last.weeks).map(([login, { pct }]) => {
      const state = stateOf(sorted, sorted.length - 1, login);
      let most = 0;
      const rises = Array.from({ length: HORIZON }, (_, at) => {
        most = Math.max(
          most,
          predict(model, withHorizon(state, last.at, at + 1), at + 1, Math.max(0, 100 - pct)),
        );
        return most;
      });
      return [login, rises];
    }),
  );
}

/** The hour `week` runs out from `at`, by `curve`, its rise hour by hour to `HORIZON`, or by `held`,
 *  the rise an hour its live runs would keep up, whichever is sooner, and past `HORIZON` at the mean
 *  rate of what those read by then. Null where it reaches its reset first. */
function weekEnd(
  curve: readonly number[],
  week: { pct: number; reset: number },
  at: number,
  held = 0,
): number | null {
  const left = 100 - week.pct;
  if (left <= 0) return null;
  const rises = curve.map((rise, hour) => Math.max(rise, held * (hour + 1)));
  const hour = rises.findIndex((rise) => rise >= left);
  const day = rises.at(-1) ?? 0;
  const hours = hour === -1 ? (left / day) * HORIZON : hour + 1;
  const end = at + hours * HOUR_MS;
  return end < week.reset ? end : null;
}

export const spanOf = (mins: number): string =>
  mins >= 1440
    ? `${String(Math.floor(mins / 1440))}d${String(Math.floor((mins % 1440) / 60))}h`
    : `${String(Math.floor(mins / 60))}h${String(mins % 60).padStart(2, "0")}m`;
export const clock = (at: number): string =>
  new Date(at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const stamp = (at: number): string =>
  new Date(at)
    .toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(" at ", " ");

/** When the pool of `weeks` runs dry at `rate`, in % of one login's week an hour. */
function forecast(weeks: readonly Week[], rate: number, now: number): string {
  if (weeks.length === 0) return "no login is in the pool or carries a run";
  const pool = weeks.map((week) => ({
    login: week.login,
    left: Math.max(0, 100 - week.pct),
    reset: week.reset,
  }));
  const gaps: { from: number; to: number | null; by: string }[] = [];
  let lowest = { left: Number.POSITIVE_INFINITY, at: now };
  for (let at = now; at < now + AHEAD; at += STEP) {
    const refilled = pool.filter((login) => at >= login.reset);
    for (const login of refilled) Object.assign(login, { left: 100, reset: login.reset + WEEK });
    const room = pool.reduce((sum, login) => sum + login.left, 0);
    let need = (rate * STEP) / HOUR_MS;
    for (const login of pool.toSorted((one, other) => one.reset - other.reset)) {
      const take = Math.min(login.left, need);
      login.left -= take;
      need -= take;
    }
    const open = gaps.at(-1)?.to === null ? gaps.at(-1) : undefined;
    // A step that opens with no room is out even where a spent login's runs count no demand (`poolPace`).
    if (need > 1e-9 || room <= 1e-9) {
      if (open === undefined) gaps.push({ from: at, to: null, by: "" });
    } else if (open !== undefined) {
      Object.assign(open, { to: at, by: refilled.map(({ login }) => `login ${login}`).join(", ") });
    }
    const left = pool.reduce((sum, login) => sum + login.left, 0);
    if (at < now + WEEK && left < lowest.left) lowest = { left, at };
  }
  const lasting = (gap: (typeof gaps)[number]) => (gap.to ?? now + AHEAD) - gap.from;
  const said = (gap: (typeof gaps)[number]) =>
    `${gap.from - now < STEP ? "now" : `in ${spanOf(Math.round((gap.from - now) / 60_000))} (${stamp(gap.from)})`} for ${spanOf(Math.round(lasting(gap) / 60_000))}${gap.to === null ? "+" : gap.by === "" ? "" : `, till ${gap.by} resets`}`;
  const [first] = gaps;
  if (first === undefined || first.from >= now + WEEK) {
    const week = `makes the next 7d, lowest ~${String(Math.round(lowest.left))}% of one login left (${stamp(lowest.at)})`;
    return `${week}; ${first === undefined ? "lasts the 4 weeks looked ahead" : `then all out ${said(first)}`}`;
  }
  const inWeek = gaps.filter((gap) => gap.from < now + WEEK);
  const out = inWeek.reduce(
    (sum, gap) => sum + Math.min(gap.to ?? Number.POSITIVE_INFINITY, now + WEEK) - gap.from,
    0,
  );
  const longest = inWeek.reduce((one, other) => (lasting(other) > lasting(one) ? other : one));
  return `all out ${said(first)} · ${String(Math.round(out / HOUR_MS))}h out over the next 7d${longest === first ? "" : `, longest ${said(longest)}`}`;
}

const roomy = (week: Week) => week.room !== false;
const perDay = (rate: number) => `~${String(Math.round(rate * 24))}%/day`;
/** The pool's rate at the week's pace, in % of one login's week an hour. */
const poolPace = (weeks: readonly Week[], now: number) =>
  weeks.reduce((sum, week) => sum + (week.pct >= 100 ? 0 : weekPace(week, now)), 0);

/** The pool's head line over `weeks`. */
export function poolLine(weeks: readonly Week[], unread: number, now: number): string {
  const pool = weeks.filter(roomy);
  return `pool  ${perDay(poolPace(pool, now))} of one login's week at the week's pace; ${String(pool.length)} login${pool.length === 1 ? "" : "s"} refill ~${String(Math.round((pool.length * 100) / 7))}%/day${
    unread > 0 ? ` (${String(unread)} unread, left out)` : ""
  }`;
}

export const endWords = (end: End, now: number) =>
  end.at === null
    ? "projected to last until reset"
    : `projected to exhaust in ${spanOf(Math.round((end.at - now) / 60_000))} (${clock(end.at)})${end.runs ? " at current run pace" : ""}`;

/** The one forecast: where the model beats both older paces on the hours held out, when the pool
 *  runs out at its pace over the next `HORIZON` hours and each login's rise at a few of those hours,
 *  with the hour each login's week ends, the sooner of its curve and the rise its live runs keep up
 *  at `rate` (`weekEnd`), which its head line says in place of its week's pace, so the head and the
 *  forecast name one hour; otherwise the pool at whichever of the week pace and the per-run rate read
 *  those hours better, what kept the model off, and no ends. */
export function modelLines(
  weeks: readonly Week[],
  recorded: readonly Snapshot[],
  assessment: Assessment | null,
  now: number,
  rate: number | null,
): { lines: string[]; ends: Map<string, End> | null } {
  const live = byTime(recorded).at(-1)?.runs ?? {};
  const pool = weeks.filter(roomy);
  const errors =
    assessment === null
      ? "off: no rows yet to fit on and hold out"
      : `fitted on ${String(assessment.days)} days; held-out error ${assessment.error.toFixed(2)} vs ${assessment.week.toFixed(2)} for the week pace and ${assessment.run.toFixed(2)} for the per-run rate, % over ${String(assessment.held)} rows of logins with room`;
  if (assessment?.model == null) {
    const perRun = assessment !== null && rate !== null && assessment.run < assessment.week ? rate : null;
    const rateNow =
      perRun === null
        ? poolPace(pool, now)
        : pool.reduce((sum, week) => sum + (week.pct >= 100 ? 0 : (live[week.login] ?? 0) * perRun), 0);
    const lines = [
      `  ${(perRun === null ? "week pace" : "per run").padEnd(12)}${perDay(rateNow)}: ${forecast(pool, rateNow, now)}`,
      `              model ${assessment === null ? errors : `not used: ${errors}`}`,
    ];
    return { lines, ends: null };
  }
  const rises = ahead(assessment.model, recorded);
  const day = pool.reduce((sum, { login }) => sum + (rises[login]?.at(-1) ?? 0), 0);
  const ends = new Map<string, End>();
  const each = weeks.map((week) => {
    const curve = rises[week.login] ?? [];
    const at = weekEnd(curve, week, now, (live[week.login] ?? 0) * (rate ?? 0));
    ends.set(week.login, { at, runs: at !== weekEnd(curve, week, now) });
    const hours = [1, 3, 6, 12, HORIZON].map(
      (hour) => `+${String(hour)}h ${(curve[hour - 1] ?? 0).toFixed(1)}%`,
    );
    return `  login ${week.login.padEnd(6)}${hours.join("  ")}`;
  });
  const lines = [
    `  model ${`${String(HORIZON)}h`.padEnd(6)}${perDay(day / HORIZON)}: ${forecast(pool, day / HORIZON, now)}`,
    ...each,
    `              ${errors}`,
  ];
  return { lines, ends };
}
