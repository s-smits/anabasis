/**
 * A light forecast of how much of each login's week every hour of the next `HORIZON` spends
 * (1 November 2026). The operator asked for an xgboost-like predictor that costs next to no CPU, to
 * say on the day whether use will rise. It is boosted regression trees of depth 2 of the rise an
 * hour (`fit`), on squared loss with xgboost's histogram splits, fitted afresh on every `runs usage` from the last 7, 14 or 28
 * days of readings, whichever reads the held-out hours best (`WINDOWS`): one model over every login,
 * applied to each login's own state. A longer window holds more weeks, a shorter one only the
 * pattern of the present release and its runs.
 *
 * A row is one login at one reading and one horizon of 1 to `HORIZON` hours: its rise over that
 * horizon, in % of its week, read at the reading nearest that hour, half an hour either side, in
 * the same weekly window. Its features are the horizon, the login's live runs, the runs live on
 * every login, the local hour now and at the horizon, whether it is a weekend, the share of its
 * week left, its rise an hour over the hours before (`NONE` with no reading 3 to 6 hours back), and
 * how many logins have room.
 * Each horizon is learnt directly rather than an hour stepped with the runs held, because runs stop
 * and start: a model that holds them reads a login busy for the last five hours as busy all day,
 * and a login idle at 21:00 whose runs come at night as idle (operator, 1 November). A week's use is
 * read in whole percents, so one hour's rise is mostly rounding (of 169 pairs of readings 0.5 to 2
 * hours apart up to 1 November, 83 read none at a mean of 0.73% an hour); the trees average it over
 * the rows that share a horizon.
 *
 * It speaks only where it beats both older paces on the rows of the last `HELD` hours, held out of
 * a fit on the rows that end before them: the week pace (`weekPace` times the horizon) and the
 * per-run rate (`perRunRate` times the login's runs and the horizon, as if they kept going). A first
 * form also stayed off until nine in ten of the last week's hours held a reading, since before 1
 * November one was taken only when someone ran the verb (88 of 164 hours from 26 October). On that
 * record, cut at now and 24, 48 and 72 hours before 1 November 21:00, the model beat the per-run rate
 * at all four cuts and the week pace at two (2.66 against 3.81, 2.73 against 3.84), so the held-out
 * test against both is the gate instead, and the record kept so far is the start (operator,
 * 1 November). That test scores logins with room only, since a spent login's rise is none whichever
 * forecast reads it: 440 of 1,048 forecast rows on 6 November, which took the model's error from 3.09
 * to 1.79 without its forecasts changing and never changed when it spoke.
 *
 * The hour a login's week ends is a question of its own (`weekEnd`). The curve stays the trees' own,
 * for the reason above, but they read a mean, and a login busy now that goes on being busy runs out
 * before its mean does, so the end also asks what its live runs would spend if they kept going, and
 * says so where that decides it. Past the horizon it goes on at the day's mean rate. Walked forward
 * over the 127 hours from 28 October to 6 November that had enough record, forecasting only from the
 * readings up to each hour and speaking only where the gate let it, 34 of the 38 calls that a week
 * ends within a day were right and they caught 34 of 50 forecasts whose week did; with this, 45 of 53
 * and 45 of 52. Before 3 November it caught more at the price of more false alarms (right in 16 of
 * 19 calls, then 21 of 28). Every window that closed on this record ran out, so only the day's call
 * can show a false alarm, and nothing tests an end named days ahead, which was off by 14 hours at
 * one to three days and 35 beyond. The count of logins with room is a feature because a spent login's
 * runs move to the others: it took the curve's error from 3.09 to 2.52 over the hours both spoke.
 * These were chosen on this record from overlapping hourly forecasts, so they are estimates until
 * later readings repeat them.
 */

export interface Snapshot {
  readonly at: number;
  readonly weeks: Record<string, { pct: number; reset: number }>;
  /** Each login's live runs when the reading was taken; readings before 22 October hold none. */
  readonly runs?: Record<string, number>;
  /** Each closed login's reset (`login-state.ts`); readings before 5 November 2026 hold none. */
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
export interface Assessment {
  readonly held: number;
  readonly days: number;
  readonly error: number;
  readonly week: number;
  readonly run: number;
  readonly model: Model | null;
}

const HOUR = 3_600_000;
export const HORIZON = 24;
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
const APART = HOUR / 2;

/** The share of its week `week` has spent an hour since it opened, at `at`, floored at 12 hours so
 *  a window minutes old does not extrapolate. */
export const weekPace = (week: { pct: number; reset: number }, at: number) =>
  week.pct / Math.max(12, (at - (week.reset - 168 * HOUR)) / HOUR);
/** Whether reading `later` of a login's week is in the window of reading `earlier`: their resets
 *  agree within an hour and its use has not fallen. A fall is a window opened afresh without a new
 *  reset, as when a login's plan is upgraded (login 3 read 94% and then 0% under one reset on
 *  4 November, the one fall in 284 readings), so a rise read across it would be counted as none. */
export const sameWindow = (earlier: { pct: number; reset: number }, later: { pct: number; reset: number }) =>
  Math.abs(earlier.reset - later.reset) < HOUR && later.pct >= earlier.pct;
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
    if (one === undefined || at - one.at > BEFORE.most * HOUR) break;
    if (at - one.at >= BEFORE.least * HOUR && one.weeks[login] !== undefined) then = one;
  }
  const was = then?.weeks[login];
  if (now === undefined || then === undefined || was === undefined || !sameWindow(was, now)) return NONE;
  return (now.pct - was.pct) / ((at - then.at) / HOUR);
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
  new Date(at + hours * HOUR).getHours(),
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
    while (end < sorted.length && (sorted[end]?.at ?? 0) - then.at <= (HORIZON + 0.5) * HOUR) end += 1;
    const soon = sorted.slice(index + 1, end);
    return Object.entries(then.weeks).flatMap(([login, was]) => {
      const state = stateOf(sorted, index, login);
      return Array.from({ length: HORIZON }, (_, at) => at + 1).flatMap((hours) => {
        const later = soon.find(({ at }) => Math.abs(at - then.at - hours * HOUR) <= HOUR / 2);
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
 *  the horizon too coarsely for the first hours: logged forecasts from 2 to 4 November read +1.8%
 *  to +2.1% at one hour, where an hour mostly adds 0 or 1. On the record of 4 November, cut every
 *  6 hours over the 72 before it, the rate's held-out error over every horizon was 2.21 against
 *  2.58 for the rise's, lower at 10 of 11 cuts (0.46 against 1.57 at one hour). */
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
    history.filter(({ at }) => at <= now && now - at < (WINDOWS.at(-1) ?? 0) * 24 * HOUR),
  );
  const rows = rowsOf(sorted);
  const cut = now - HELD * HOUR;
  const held = rows.filter(({ at, left }) => at >= cut && left > 0);
  const errorOf = (guess: (row: Row) => number) => mean(held.map((row) => Math.abs(guess(row) - row.y)));
  const since = (days: number) => rows.filter(({ at }) => now - at < days * 24 * HOUR);
  // A window reaching past the oldest reading reads what a shorter one did, so it is not fitted.
  const oldest = sorted[0]?.at ?? now;
  const tried = WINDOWS.filter(
    (_, at) => at === 0 || now - oldest >= (WINDOWS[at - 1] ?? 0) * 24 * HOUR,
  ).flatMap((days) => {
    const before = since(days).filter(({ at, hours }) => at + (hours + 0.5) * HOUR < cut);
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
export function ahead(model: Model, history: readonly Snapshot[]): Record<string, number[]> {
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
export function weekEnd(
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
  const end = at + hours * HOUR;
  return end < week.reset ? end : null;
}
