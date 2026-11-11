/**
 * The climb, as one reading of a campaign's log: its epochs. An epoch runs from the opening, or a
 * promotion, to the next promotion or the log's end, under one reference harness. An epoch's row
 * holds what the pillars read of it: its starter comparison's tally without the bill, which
 * confirms the promotion (the milestone), the false-promotion estimate over its attempts beside
 * the A/A comparisons (honesty), and the cost of its promotion (economy). A row holds counts and
 * nothing of a task, and `runs view` prints the rows.
 *
 * `starterReads` holds, apart from the rows, the split of each starter tally by where its tasks
 * came from, since a whole tally can hide that the tasks written after the promotion went the
 * other way; `runs alerts` and comparison-reading's `starter-reads.ts` print it. It decides no move.
 */
import {
  differenceOf,
  gapAgainst,
  type Paired,
  pointsOf,
  readsStep,
  readsStepEitherWay,
  scoresIn,
  type Tally,
  testedSet,
  testOf,
} from "../kernel/compare.ts";
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import { lastReports, pairsReported, type Reported } from "../kernel/reports.ts";
import { billedBetween } from "../kernel/meter.ts";
import { heldAtGate } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import { short } from "./move.ts";
import type { Called } from "./names.ts";

/**
 * What an epoch's promotion attempts risk together: a false promotion among them, estimated (the
 * revised plan's M2.5, 12 October). The test gives one reading a rate at its margins, which is an
 * estimate and no bound (`falseRate`, `comparison.ts`), and a campaign makes many; this reads them.
 */
interface FalsePromotion {
  /** The readings of a candidate against the epoch's reference on a frontier, each one attempt,
   *  unsuccessful ones included. Until 19 October a step and the repeat it bought were one. */
  readonly attempts: number;
  /** A/A steps under the comparison's one-sided rule, read without the bill. The denominator
   *  excludes A/A comparisons too small to clear the level; a report from before 26 October,
   *  without unbilled scores, is read on its full score. */
  readonly errors: number;
  readonly controls: number;
  readonly incapable: number;
  /** Of the incapable, those that tied every task: a reference that answers each task alike on
   *  every solve matches itself, so its A/A can read no step at any level. */
  readonly tied: number;
  /** min(1, the sum of the attempts' rates): the union bound's form, which assumes nothing of their
   *  independence, over estimates, so an estimate and no bound. */
  readonly union: number;
}

export interface Epoch {
  /** The epoch's number, from one. */
  readonly nth: number;
  /** The reference harness, by digest, or "starter" for the first epoch of a campaign. */
  readonly reference: string;
  /** Where the epoch starts in the log, and where it ends: null while it is the last. */
  readonly from: number;
  readonly to: number | null;
  /** The harness promoted at its end, or null. */
  readonly promoted: string | null;
  /** The task versions the gate admitted during the epoch, those later released to practice among them. */
  readonly tasks: readonly string[];
  /** Builder sessions that acted in the epoch. */
  readonly sessions: number;
  /** The comparisons reported in the epoch, by id, with their readings. */
  readonly comparisons: readonly { readonly id: string; readonly reading: string }[];
  /** The reference against the starter in the epoch's first starter comparison that tallied a
   *  task, without the bill and counted from the reference's side; null in the first epoch and
   *  before one reports. Until 31 October this was the starter's share of valid answers, which read
   *  4 to 28 in the reference's favour as a near tie in an objective domain (buffer-forkedPR530's
   *  g-6). */
  readonly starter_tally: Tally | null;
  /** That comparison's id, null where `starter_tally` is. */
  readonly starter_read: string | null;
  /** Whether the promotion that opened the epoch is confirmed: its first starter comparison that
   *  tallied a task reads the reference above the starter without the bill, at that comparison's
   *  level (`AGENTS.md`,
   *  section 1, the milestone). Null in the first epoch, false before a starter comparison
   *  reports. */
  readonly confirmed: boolean | null;
  readonly falsePromotion: FalsePromotion;
}

const PROMOTED = "harness.promoted";
const ATTEMPT = "promotion attempt";

/** The bar a promotion's cost is read against (the plan's W): the promotion attempts of an epoch after set-up, comparisons against its
 *  reference, which are what the false-promotion estimate counts, so the bar does not move with the
 *  solver's price. A session the provider cut finished nothing and is no attempt. Dollars are
 *  reported beside it, and it decides no admission (12 October). The effect and transfer bars it stood
 *  beside until 13 October went: each read a set that changed with every reading. The ladder that
 *  took their place, a fixed set read after every promotion, went on 16 October: the first
 *  promotion's reference answered it whole. The climb is read as promotions. Until 5 November an
 *  opening could name another (`--cost`), and none of 310 logs did. */
export const BARS = { cost: 3 } as const;

/** The milestone a campaign is read against for the operator (`AGENTS.md`, factors 1 and 2; the
 *  plan's M1 and M2): six confirmed promotions, then the A/A comparisons after the sixth. It is
 *  observation only, so no prompt, tool or move reads it. */
const MILESTONE = { promotions: 6, controls: 10 } as const;

/** A step's worth against the bar (`worthOf`, `promotionsWorth`). */
export interface Worth {
  /** The epoch's promotion attempts, Builder sessions and billed dollars, and whether the attempts
   *  are within the bar, which set-up's epoch always is. */
  readonly cost: {
    readonly attempts: number;
    readonly sessions: number;
    readonly dollars: number;
    readonly met: boolean;
  };
}

export const ORIGINS = ["read at the promotion", "written before, not chosen on", "written after"] as const;
export type Origin = (typeof ORIGINS)[number];

/** An origin's tasks: the whole tally, those on which validity differed, and the rest. */
export interface Split {
  readonly whole: Tally;
  readonly validity: Tally;
  readonly rest: Tally;
}

/**
 * What the tasks written after a promotion read alone: a step for the reference, a step for the
 * starter, no step, or too few untied tasks to read one at the level. They are the one origin no step
 * selected, so a win there is not a margin chosen for its sign: the tasks that chose the harness won
 * its promotion, and a task written before it and not chosen on has mostly been scored in a step that
 * chose an earlier one. It decides nothing.
 */
export const UNSELECTED = ["a step", "a step for the starter", "no step", "too few"] as const;
type Unselected = (typeof UNSELECTED)[number];

/** One task of a starter read: where it came from, who wrote it, the reference's score against the
 *  starter (`-differenceOf`, the sign the read's tally takes), and the pair the read rebuilt. */
interface StarterRow {
  readonly task: string;
  readonly origin: Origin;
  readonly writer: string;
  readonly margin: number;
  readonly pair: Paired;
}

/** One promotion's first starter comparison that tallied a task. */
export interface StarterRead {
  readonly session: string;
  /** The harnesses, by digest: the reference is the old side, the starter the new. */
  readonly reference: string;
  readonly starter: string;
  /** The tally and confirmation `epochsOf` read, on the stored scores without the bill. */
  readonly stored: Tally;
  readonly confirmed: boolean;
  readonly level: number;
  readonly origins: Readonly<Record<Origin, Split>>;
  /** The tally on each writer's tasks, in the order the writers first proposed one. */
  readonly authors: readonly { readonly session: string; readonly tally: Tally }[];
  /** What the tasks written after the promotion read alone, under this tree's rule (`Unselected`). */
  readonly after: Unselected;
  /** Whether the report recorded the level the read is taken at; `level` reads 0 where not. */
  readonly levelled: boolean;
  /** Each scored task, in the report's order. */
  readonly rows: readonly StarterRow[];
  /** The harnesses and tasks, which a copy of the comparison shares. */
  readonly key: string;
}

const levelOf = ({ data }: Reported) => (isNumber(data.level) ? data.level : 0);

/** Where each epoch starts: the log's opening, then each promotion. */
function boundsOf(events: readonly LogEvent[]): { index: number; harness: string }[] {
  const promotions = events.flatMap(({ kind, data }, index) =>
    kind === PROMOTED && isString(data.harness) ? [{ index, harness: data.harness }] : [],
  );
  return [{ index: 0, harness: "starter" }, ...promotions];
}

/** The task versions that passed task admission in each epoch, oldest epoch first: the tasks written
 *  under one reference harness, which the comparison draws from newest epoch down (`scoredSet`). */
export function tasksByEpoch(events: readonly LogEvent[]): string[][] {
  const bounds = boundsOf(events);
  return bounds.map(({ index: from }, nth) => {
    const to = bounds[nth + 1]?.index ?? null;
    return events.flatMap(({ kind, data }, at) =>
      at >= from &&
      (to === null || at < to) &&
      kind === "task.gate" &&
      heldAtGate(data.outcome) &&
      isString(data.version)
        ? [data.version]
        : [],
    );
  });
}

/** The starter harness's digest, as the first comparison's terms name it; null before one. */
export function starterIn(events: readonly LogEvent[]): string | null {
  const named = events.find(({ kind }) => kind === "comparison.started")?.data.starter;
  return isString(named) ? named : null;
}

/** The epochs of a log, oldest first. A log with no promotion is one epoch. */
export function epochsOf(events: readonly LogEvent[]): Epoch[] {
  const starter = starterIn(events);
  const bounds = boundsOf(events);
  const byEpoch = tasksByEpoch(events);
  const reports = lastReports(events);
  return bounds.map(({ index: from, harness: reference }, nth) => {
    const next = bounds[nth + 1];
    const to = next?.index ?? null;
    const within = (at: number) => at >= from && (to === null || at < to);
    const tasks = byEpoch[nth] ?? [];
    // A led session spans epochs and finishes in none, so until 2 November counting the sessions
    // that finished read 0 in every epoch of a led campaign (WRI lane 31).
    const built = events.filter(({ kind }, at) => within(at) && kind.startsWith("build."));
    // An old ladder's readings are no comparison of the epoch's (`lastReports`).
    const comparisons = reports
      .filter(({ index }) => within(index))
      .map(({ session, data }) => ({ id: session, reading: isString(data.reading) ? data.reading : "" }));
    const referenceDigest = reference === "starter" ? starter : reference;
    return {
      nth: nth + 1,
      reference,
      from,
      to,
      promoted: next?.harness ?? null,
      tasks,
      sessions: new Set(built.flatMap(({ data }) => (isString(data.session) ? [data.session] : []))).size,
      comparisons,
      ...againstStarter(reports, within, reference === "starter" ? null : referenceDigest, starter),
      falsePromotion: falsePromotionOf(reports, within, { reference: referenceDigest, starter }),
    };
  });
}

/** The reference's tally without the bill in the first starter comparison within the epoch that
 *  tallied a task, and whether it reads a step for the reference: the starter is that comparison's
 *  new side, so the reference wins what the starter loses. The first, since until 4 November, with
 *  no harness waiting, the table named the pair again where tasks were held out after it (`heldSince`,
 *  `decide.ts`), mostly after a reading that left no room: until 2 November the last one set
 *  `confirmed`, which let a later draw replace a reading that confirmed nothing. The table owes
 *  the pair until this reads a tally. A report before 26 October holds no unbilled scores and is
 *  read as scored. A null `reference` is the first epoch's, which has no starter comparison. */
function againstStarter(
  reports: readonly Reported[],
  within: (at: number) => boolean,
  reference: string | null,
  starter: string | null,
): Pick<Epoch, "starter_tally" | "starter_read" | "confirmed"> {
  if (reference === null) return { starter_tally: null, starter_read: null, confirmed: null };
  const first = reports.find(
    ({ index, data }) =>
      within(index) &&
      data.old === reference &&
      data.fresh === starter &&
      data.reading !== "not-scored" &&
      asRecord(data.scored) !== null,
  );
  if (first === undefined) return { starter_tally: null, starter_read: null, confirmed: false };
  const ahead = scoresIn(first.data.scored).map((one) => -one);
  const { wins, losses, ties } = testOf(ahead);
  return {
    starter_tally: { wins, losses, ties },
    starter_read: first.session,
    confirmed: readsStep(ahead, levelOf(first)),
  };
}

/** One A/A reading of `scores` at `level`: whether it had enough untied tasks to read a step,
 *  whether it read one, and whether it tied every task. */
function controlOf(index: number, level: number, scores: readonly number[]) {
  const able = readsStep(scores.map(Math.abs), level);
  const tied = scores.length > 0 && scores.every((one) => one === 0);
  return { index, level, scores, able, tied, step: readsStep(scores, level) };
}

/** Each A/A comparison beside `reports`, the reference against itself read as a comparison is. */
function controlsIn(reports: readonly Reported[]) {
  return reports.flatMap((each) => {
    const noise = asRecord(each.data.noise);
    if (!Array.isArray(noise?.differences)) return [];
    return [controlOf(each.index, levelOf(each), scoresIn(noise))];
  });
}

/**
 * An epoch's false-promotion reading (`FalsePromotion`): its attempts, from `reports` within it
 * against `reference`, each at its own rate, and beside them the campaign's A/A comparisons.
 */
function falsePromotionOf(
  reports: readonly Reported[],
  within: (at: number) => boolean,
  harnesses: { readonly reference: string | null; readonly starter: string | null },
): FalsePromotion {
  const attempts = reports.filter(
    ({ index, data }) =>
      within(index) &&
      data.old === harnesses.reference &&
      data.fresh !== harnesses.starter &&
      asRecord(data.frontier) !== null,
  );
  /** The test's own chance a reading at its margins reads a step between equal harnesses
   *  (`falseRate`, the frontier's before 20 October), the level where its report holds none. */
  const rateOf = (attempt: Reported) => {
    const rate = testedSet(asRecord(attempt.data.scored), asRecord(attempt.data.frontier))?.falseRate;
    return isNumber(rate) ? rate : levelOf(attempt);
  };
  const read = controlsIn(reports);
  const controls = read.filter(({ able }) => able).length;
  const rates = attempts.map(rateOf);
  return {
    attempts: attempts.length,
    errors: read.filter(({ step }) => step).length,
    controls,
    incapable: read.length - controls,
    tied: read.filter(({ tied }) => tied).length,
    union: Math.min(
      1,
      rates.reduce((sum, rate) => sum + rate, 0),
    ),
  };
}

/** The epoch's starter comparison as the line prints it, nothing in the first epoch. */
function starterOf({ reference, starter_tally: tally, confirmed }: Epoch): string {
  if (reference === "starter") return "";
  if (tally === null) return ", against the starter unread";
  const read = confirmed === true ? "a step, so its promotion is confirmed" : "no step";
  return `, against the starter ${String(tally.wins)} won, ${String(tally.losses)} lost, ${String(tally.ties)} tied, ${read}`;
}

/** The tally from the reference's side of `pairs`, which holds it on the old side. */
const tallyOf = (pairs: readonly Paired[]): Tally => {
  const { wins, losses, ties } = testOf(pairs.map((pair) => -differenceOf(pair)));
  return { wins, losses, ties };
};

/** The tasks the comparisons that promoted `reference` read, before the promotion at `from`. */
function chosenOn(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  reference: string,
  from: number,
) {
  const chose = reports.filter(
    ({ index, data }) => index < from && data.fresh === reference && data.reading === "step",
  );
  return new Set(chose.flatMap((report) => pairsReported(events, report).map(({ task }) => task)));
}

/** `pairs` by who wrote each task, each with its tally. */
function byAuthor(writers: ReadonlyMap<string, string>, pairs: readonly Paired[]): StarterRead["authors"] {
  return [...new Set(writers.values())].flatMap((session) => {
    const own = pairs.filter(({ task }) => writers.get(task) === session);
    return own.length === 0 ? [] : [{ session, tally: tallyOf(own) }];
  });
}

/** `ahead`, the reference's scores, read as `Unselected` at `level`. */
export function unselectedOf(ahead: readonly number[], level: number): Unselected {
  const behind = ahead.map((one) => -one);
  if (readsStep(ahead, level)) return "a step";
  if (readsStep(behind, level)) return "a step for the starter";
  return readsStep(ahead.map(Math.abs), level) ? "no step" : "too few";
}

/** Each starter read of `events`, oldest first. */
export function starterReads(events: readonly LogEvent[]): StarterRead[] {
  const reports = lastReports(events);
  const epochs = epochsOf(events);
  // A task no session proposed came with the opening: a stored pack's or the drafted exam's.
  const writers = new Map(
    proposalsOf(events).map(({ version, session }) => [version, session ?? "the opening exam"]),
  );
  return epochs.flatMap((epoch, nth) => {
    const report = reports.find(({ session }) => session === epoch.starter_read);
    const fresh = report?.data.fresh;
    if (report === undefined || epoch.starter_tally === null || !isString(fresh)) return [];
    const { level } = report.data;
    const chosen = chosenOn(events, reports, epoch.reference, epoch.from);
    const earlier = new Set(epochs.slice(0, nth).flatMap(({ tasks }) => tasks));
    const pairs = pairsReported(events, report);
    const originOf = ({ task }: Paired): Origin =>
      chosen.has(task) ? ORIGINS[0] : earlier.has(task) ? ORIGINS[1] : ORIGINS[2];
    const splitOf = (origin: Origin): Split => {
      const own = pairs.filter((pair) => originOf(pair) === origin);
      return {
        whole: tallyOf(own),
        validity: tallyOf(own.filter((pair) => pointsOf(pair).validity !== 0)),
        rest: tallyOf(own.filter((pair) => pointsOf(pair).validity === 0)),
      };
    };
    const at = isNumber(level) ? level : 0;
    return [
      {
        session: report.session,
        reference: epoch.reference,
        starter: fresh,
        stored: epoch.starter_tally,
        confirmed: epoch.confirmed === true,
        level: at,
        origins: {
          [ORIGINS[0]]: splitOf(ORIGINS[0]),
          [ORIGINS[1]]: splitOf(ORIGINS[1]),
          [ORIGINS[2]]: splitOf(ORIGINS[2]),
        },
        authors: byAuthor(writers, pairs),
        after: unselectedOf(
          pairs.filter((pair) => originOf(pair) === ORIGINS[2]).map((pair) => -differenceOf(pair)),
          at,
        ),
        levelled: isNumber(level),
        rows: pairs.map((pair) => ({
          task: pair.task,
          origin: originOf(pair),
          writer: writers.get(pair.task) ?? "the opening exam",
          margin: -differenceOf(pair),
          pair,
        })),
        key: `${epoch.reference}|${fresh}|${pairs
          .map(({ task }) => task)
          .toSorted()
          .join(",")}`,
      },
    ];
  });
}

/** One line an epoch, as the view prints them, each harness `called` as the view names it, and the
 *  promotion that ends it. */
export function epochLine(epoch: Epoch, called: Called = short): string {
  const reference = epoch.reference === "starter" ? "the starter" : called(epoch.reference);
  const readings = epoch.comparisons.map(({ id, reading }) => `${id} ${reading}`).join(", ") || "none";
  // The first harness promoted over the Starter is set-up, epoch 0, and the climb counts from it.
  const rung = epoch.nth === 1 ? "as set-up (epoch 0)" : `as rung ${String(epoch.nth - 1)} of the climb`;
  const end = epoch.promoted === null ? "open" : `promoted ${called(epoch.promoted)} ${rung}`;
  const risk = epoch.falsePromotion;
  return `epoch ${String(epoch.nth)}: reference ${reference}; ${String(epoch.tasks.length)} tasks admitted; ${plural(epoch.sessions, "Builder session")}; comparisons ${readings}${starterOf(epoch)}; ${plural(risk.attempts, ATTEMPT)} under this reference, a false promotion among them estimated at ${percent(risk.union)}; ${sourceOf(risk)}; ${end}`;
}

/** A chance in whole percent, or to a tenth under ten, where an attempt's rate of 1.8% read as 2%;
 *  one too small for a tenth is said as under it, never as none. */
function percent(chance: number): string {
  if (chance === 0) return "0%";
  if (chance < 0.001) return "under 0.1%";
  return chance < 0.1 ? `${(100 * chance).toFixed(1)}%` : `${String(Math.round(100 * chance))}%`;
}

/** The A/A comparisons read beside an estimate. Until 3 November the riskiest attempt's rate was
 *  said first, which each comparison's own report already states. */
function sourceOf(risk: FalsePromotion): string {
  const comparisons =
    risk.controls === 0
      ? "no A/A comparison with enough untied tasks to read a step"
      : `${String(risk.errors)} of ${plural(risk.controls, "A/A comparison")} with enough untied tasks to read a step read one`;
  const tied =
    risk.tied === 0 ? "" : `, ${String(risk.tied)} of them because the reference tied every task with itself`;
  const incapable =
    risk.incapable === 0 ? "" : `, and ${String(risk.incapable)} too small to read one at their level${tied}`;
  return `${comparisons}${incapable}`;
}

/**
 * The campaign's chance of a false promotion, for its closing report (the plan's 7.6): each epoch's
 * summed estimate with what it rests on, and their sum capped at one: estimates all, and no bound.
 * An epoch's sum restarts at its promotion, so no epoch's alone describes the campaign.
 * The rule-of-three illustration assumes independent trials with one binomial rate:
 * https://doi.org/10.1111/j.1751-5823.2009.00078.x. The log does not establish those conditions.
 */
export function riskLines(events: readonly LogEvent[]): string[] {
  const epochs = epochsOf(events);
  const total = Math.min(
    1,
    epochs.reduce((sum, { falsePromotion }) => sum + falsePromotion.union, 0),
  );
  return [
    ...epochs.map(({ nth, falsePromotion: risk }) => {
      const attempts = plural(risk.attempts, ATTEMPT);
      return `- Epoch ${String(nth)}: ${attempts}, a false promotion among them estimated at ${percent(risk.union)}; ${sourceOf(risk)}.`;
    }),
    `Over the campaign, a false promotion in any epoch estimated at ${percent(total)}: the sum of the epochs' estimates, capped at one, which assumes nothing of how the attempts depend on one another. It sums estimates, so it is an estimate and no bound.`,
    "The rule assumes each untied task is as likely won as lost between equal harnesses; solver drift can violate that assumption. A/A comparisons provide an empirical check: each step is an observed false positive, but one alone does not establish miscalibration. With no steps in n independent comparisons sharing one false-positive rate, the approximate 95% upper limit is 3/n. The recorded comparisons do not establish those conditions, so they give no such bound by themselves. These estimates cover only recorded attempts; further attempts increase the campaign's estimate.",
  ];
}

/** An epoch's cost against the cost bar (`Worth`), with `pending` attempts the log holds no
 *  report of yet. */
function costOf(events: readonly LogEvent[], epoch: Epoch, pending = 0): Worth["cost"] {
  const attempts = epoch.falsePromotion.attempts + pending;
  const dollars = billedBetween(events, epoch.from, epoch.to ?? undefined);
  return { attempts, sessions: epoch.sessions, dollars, met: epoch.nth === 1 || attempts <= BARS.cost };
}

/** Comparison `id`'s worth where it reads a step (the plan's W): the cost of the log's last
 *  epoch with it as one attempt more. It is read as the log stood before its report, so a report
 *  read again says what it said. Until 19 October a repeat was its first stage's attempt. */
export function worthOf(events: readonly LogEvent[], id: string): Worth {
  const before = events.filter(({ kind, data }) => kind !== "comparison.reported" || data.session !== id);
  const last = epochsOf(before).at(-1);
  // `boundsOf` opens every log with its first epoch, so a log without one is a broken reader.
  if (last === undefined) throw new Error("epochsOf read no epoch from the log");
  return { cost: costOf(before, last, 1) };
}

/** Each promoted harness's worth (the plan's W): the cost of the epoch it ended. */
export function promotionsWorth(events: readonly LogEvent[]): ReadonlyMap<string, Worth> {
  return new Map(
    epochsOf(events).flatMap((epoch) =>
      epoch.promoted === null ? [] : [[epoch.promoted, { cost: costOf(events, epoch) }] as const],
    ),
  );
}

/** Summarise the reported cost target; it does not affect admission. */
export function worthLine({ cost }: Worth): string {
  return `cost, reported only: ${plural(cost.attempts, ATTEMPT)} this epoch (bar ${String(BARS.cost)} after set-up): ${cost.met ? "met" : "over it"}, over ${plural(cost.sessions, "Builder session")} and ${cost.dollars.toFixed(2)} dollars billed`;
}

/**
 * A campaign against the bars of the milestone and of economy, for the operator: the closing report
 * and `runs view` print it, and it decides nothing. Written on 5 November, when a recount of what a
 * release still requires found that no reader answered these over one campaign: `epochLine` says
 * one epoch's confirmation; `falsePromotion` reads the A/A comparisons of the whole campaign, so
 * nothing said what those after the sixth promotion read; and `worthLine` reads an epoch only once
 * a promotion ended it, so the 2 of 62 open epochs on record that stood over the bar were stated
 * nowhere.
 */
export function barLines(events: readonly LogEvent[]): string[] {
  const epochs = epochsOf(events);
  const climbed = epochs.filter(({ nth }) => nth > 1);
  const confirmed = climbed.filter((epoch) => epoch.confirmed === true).length;
  const unread = climbed.filter(({ starter_tally: tally }) => tally === null).length;
  const over = climbed.flatMap((epoch) => {
    const cost = costOf(events, epoch);
    const open = epoch.promoted === null ? ", open" : "";
    return cost.met ? [] : [`epoch ${String(epoch.nth)} at ${String(cost.attempts)}${open}`];
  });
  return [
    `- Climb: ${plural(climbed.length, "promotion")}, ${String(confirmed)} confirmed against a milestone of ${String(MILESTONE.promotions)}; ${String(climbed.length - confirmed - unread)} read against the starter without a step, ${String(unread)} not read against it.`,
    honestyLine(events, epochs[MILESTONE.promotions]?.from),
    `- Economy: ${plural(climbed.length, "epoch")} after set-up against a bar of ${plural(BARS.cost, ATTEMPT)} each, ${String(over.length)} over it${over.length === 0 ? "" : `: ${over.join("; ")}`}. Reported only.`,
    starterNoiseLine(events),
    repeatLine(events),
  ];
}

/**
 * The comparisons in which each side gave one validity in every solve of every task, and of those,
 * the ones where each also gave one measure: there no split of a side's solves can show noise, so
 * the A/A's and the starter's tie on every task is no measured zero. One measure is one within the
 * floor the score ties at (`gapAgainst`), as the A/A reads it and as `tools/wri/answers.ts` counts
 * it: until 10 November it was bitwise equality, and a comparison whose sides differed by at most
 * 1.9e-9 on every task went unnamed. Validity is counted apart, since a harness can repeat its
 * measure and still flip validity. Reported only; decides nothing.
 */
function repeatLine(events: readonly LogEvent[]): string {
  const one = (values: readonly boolean[]) => values.every((value) => value === values[0]);
  const read = lastReports(events).flatMap((report) => {
    const pairs = pairsReported(events, report);
    if (pairs.length === 0 || !pairs.every((pair) => one(pair.old) && one(pair.fresh))) return [];
    const measured = pairs.every((pair) => !gapAgainst(pair, "old", []) && !gapAgainst(pair, "fresh", []));
    return [{ session: report.session, measured }];
  });
  const whole = read.filter(({ measured }) => measured).map(({ session }) => session);
  const named = whole.length === 0 ? "" : ` (${whole.join(", ")}), where no split of either side shows noise`;
  return `- Repetition: in ${plural(read.length, "comparison")} each side gave one validity in every solve of every task, and in ${String(whole.length)} one measure as well${named}. Reported only.`;
}

/** What the tied A/A comparisons among `controls` say, nothing where none tied every task. */
function tiedOf(controls: readonly { readonly tied: boolean }[], of: string): string {
  const tied = controls.filter((control) => control.tied).length;
  return tied === 0
    ? ""
    : ` ${String(tied)} of ${of} tied every task, as the reference matched itself on every solve, and could read no step.`;
}

/** The A/A comparisons reported after the log's index `sixth`, where the milestone's last promotion
 *  stands. Whether one too small to read a step counts towards the bar, and whether a step reads one
 *  way or either, is the operator's, so the line keeps them apart. */
function honestyLine(events: readonly LogEvent[], sixth: number | undefined): string {
  const named = `promotion ${String(MILESTONE.promotions)}`;
  const bar = `the bar's ${String(MILESTONE.controls)}`;
  const all = controlsIn(lastReports(events));
  if (sixth === undefined) {
    const so = tiedOf(all, `the campaign's ${plural(all.length, "A/A comparison")} so far`);
    return `- Honesty: no ${named} yet, so none of ${bar} A/A comparisons after it.${so}`;
  }
  const after = all.filter(({ index }) => index > sixth);
  return `- Honesty: after ${named}, ${plural(after.length, "A/A comparison")} against ${bar}, ${readOf(after)}.${tiedOf(after, "them")}`;
}

/** How many of `controls` could read a step, and how many read one, one-sided and either way. */
function readOf(controls: readonly ReturnType<typeof controlOf>[]): string {
  const able = controls.filter((control) => control.able).length;
  const steps = controls.filter(({ step }) => step).length;
  const either = controls.filter(({ scores, level }) => readsStepEitherWay(scores, level)).length;
  return `${String(able)} with enough untied tasks to read a step: ${String(steps)} read one, ${String(either)} read one either way`;
}

/**
 * The starter against itself in every starter comparison, its own solves of each task split in two
 * as the reference's A/A splits the reference's (`pairsReported`): the noise of the harness each
 * promotion is confirmed against, which the reference's A/A reads only while the starter is the
 * reference. It folds solves already paid for, counts towards no bar and decides nothing.
 */
function starterNoiseLine(events: readonly LogEvent[]): string {
  const starter = starterIn(events);
  const read = lastReports(events).flatMap((report) => {
    if (starter === null || report.data.fresh !== starter || report.data.old === starter) return [];
    const pairs = pairsReported(events, report, "fresh");
    return pairs.length === 0 ? [] : [controlOf(report.index, levelOf(report), pairs.map(differenceOf))];
  });
  const head = "- Starter against itself:";
  if (read.length === 0) {
    return `${head} no starter comparison split the starter's own solves in two. Reported only.`;
  }
  const tied = read.filter((control) => control.tied).length;
  return `${head} ${plural(read.length, "starter comparison")} split the starter's own solves in two, ${readOf(read)}, and ${String(tied)} tied every task. Reported only, and counted towards no bar.`;
}
