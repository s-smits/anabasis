/**
 * The climb, as one reading of a campaign's log: its epochs. An epoch runs from the opening, or a
 * promotion, to the next promotion or the log's end, under one reference harness. The climb the
 * system is for is a chain of epochs in which each promoted harness answers tasks the one before
 * it failed, so an epoch's row keeps apart what each side answered on the tasks held out in it:
 * the reference harness, as the A/A comparison and the other comparisons read it, and its starter
 * comparison's tally without the bill, which says whether the reference still beats the fixed lower
 * one. A row holds counts and nothing of a task.
 *
 * Written when the operator asked for the climb to be read as such: ten campaigns
 * had promoted once each and none twice, and no view said at which epoch a campaign stood or what
 * its tasks had done since the promotion. `runs view` prints the rows.
 */
import { readsStep, type Tally, testOf } from "../kernel/compare.ts";
import { conditionsOf } from "../kernel/condition.ts";
import type { LogEvent } from "../kernel/log.ts";
import { lastReports, type Reported } from "../kernel/reports.ts";
import { billedBetween } from "../kernel/trace.ts";
import { countedSolves, passed } from "../kernel/solves.ts";
import { heldAtGate } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import { short } from "./move.ts";
import type { Called } from "./names.ts";
import { openingOf } from "./opening.ts";

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
  /** The riskiest attempt's rate by the rule's design: the largest of the attempts' own rates at
   *  their margins (`falseRate`), the level where a report holds none. An estimate, no bound. */
  readonly bound: number;
  /** min(1, the sum of the attempts' rates): the union bound's form, which assumes nothing of their
   *  independence, over estimates, so an estimate and no bound. */
  readonly union: number;
}

/** Valid answers and solves of one harness on a set of tasks. */
export interface Share {
  readonly valid: number;
  readonly solves: number;
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
  /** The task versions held out during the epoch. */
  readonly tasks: readonly string[];
  /** Builder sessions that finished in the epoch, and how many changed the harness. */
  readonly sessions: number;
  readonly changed: number;
  /** The comparisons reported in the epoch, by id, with their readings. */
  readonly comparisons: readonly { readonly id: string; readonly reading: string }[];
  /** What the reference answered of the solves of the epoch's own tasks within it: null where no
   *  solve of it on those tasks is on record. */
  readonly reference_share: Share | null;
  /** The reference against the starter in the epoch's last starter comparison, without the bill
   *  and counted from the reference's side; null in the first epoch and before one reports. Until
   *  31 October this was the starter's share of valid answers, which read 4 to 28 in the
   *  reference's favour as a near tie in an objective domain (buffer-forkedPR530's g-6). */
  readonly starter_tally: Tally | null;
  /** Whether the promotion that opened the epoch is confirmed: its last starter comparison reads
   *  the reference above the starter without the bill, at that comparison's level (`AGENTS.md`,
   *  section 1, the milestone). Null in the first epoch, false before a starter comparison
   *  reports. */
  readonly confirmed: boolean | null;
  readonly falsePromotion: FalsePromotion;
}

const PROMOTED = "harness.promoted";

/** The bar a promotion's cost is read against (the plan's W), a term of the opening the operator
 *  may set (`TERMS`): the promotion attempts of an epoch after set-up, comparisons against its
 *  reference, which are what the false-promotion estimate counts, so the bar does not move with the
 *  solver's price. A session the provider cut finished nothing and is no attempt. Dollars are
 *  reported beside it, and it decides no admission (12 October). The effect and transfer bars it stood
 *  beside until 13 October went: each read a set that changed with every reading. The ladder that
 *  took their place, a fixed set read after every promotion, went on 16 October: the first
 *  promotion's reference answered it whole. The climb is read as promotions. */
const BARS = { cost: 3 } as const;

/** A step's worth against the bar (`worthOf`, `promotionsWorth`). */
export interface Worth {
  readonly bars: Readonly<Record<keyof typeof BARS, number>>;
  /** The epoch's promotion attempts, Builder sessions and billed dollars, and whether the attempts
   *  are within the bar, which set-up's epoch always is. */
  readonly cost: {
    readonly attempts: number;
    readonly sessions: number;
    readonly dollars: number;
    readonly met: boolean;
  } | null;
}

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

/** The epochs of a log, oldest first. A log with no promotion is one epoch. */
export function epochsOf(events: readonly LogEvent[]): Epoch[] {
  const starter = events.find(({ kind }) => kind === "comparison.started")?.data.starter;
  const conditions = conditionsOf(events);
  // A solve an Examiner session asked for, to try a draft task, is none of a share (`countedSolves`).
  const solves = countedSolves(events);
  const bounds = boundsOf(events);
  const byEpoch = tasksByEpoch(events);
  const reports = lastReports(events);
  return bounds.map(({ index: from, harness: reference }, nth) => {
    const next = bounds[nth + 1];
    const to = next?.index ?? null;
    const within = (at: number) => at >= from && (to === null || at < to);
    const tasks = byEpoch[nth] ?? [];
    const held = new Set(tasks);
    const builds = events.filter(({ kind }, at) => within(at) && kind === "build.finished");
    // An old ladder's readings are no comparison of the epoch's (`lastReports`).
    const comparisons = events.flatMap(({ kind, data }, at) =>
      within(at) && kind === "comparison.reported" && isString(data.session) && data.ladder !== true
        ? [{ id: data.session, reading: isString(data.reading) ? data.reading : "" }]
        : [],
    );
    const starterDigest = isString(starter) ? starter : null;
    const referenceDigest = reference === "starter" ? starterDigest : reference;
    // The reference's solves on the epoch's held-out tasks, as valid or not, null where unjudged.
    const judged = solves.flatMap((solve) => {
      const condition = conditions.get(solve.condition);
      const verdict = passed(solve);
      return referenceDigest !== null &&
        within(solve.started) &&
        condition?.harness === referenceDigest &&
        held.has(condition.task) &&
        verdict !== null
        ? [verdict]
        : [];
    });
    return {
      nth: nth + 1,
      reference,
      from,
      to,
      promoted: next?.harness ?? null,
      tasks,
      sessions: builds.length,
      changed: builds.filter(({ data }) => data.changed === true).length,
      comparisons,
      reference_share:
        judged.length === 0 ? null : { valid: judged.filter(Boolean).length, solves: judged.length },
      ...againstStarter(reports, within, reference === "starter" ? null : referenceDigest, starterDigest),
      falsePromotion: falsePromotionOf(reports, within, {
        reference: referenceDigest,
        starter: starterDigest,
      }),
    };
  });
}

/** The reference's tally without the bill in the last starter comparison within the epoch, and
 *  whether it reads a step for the reference: the starter is that comparison's new side, so the
 *  reference wins what the starter loses. A report before 26 October holds no unbilled scores and
 *  is read as scored. A null `reference` is the first epoch's, which has no starter comparison. */
function againstStarter(
  reports: readonly Reported[],
  within: (at: number) => boolean,
  reference: string | null,
  starter: string | null,
): Pick<Epoch, "starter_tally" | "confirmed"> {
  if (reference === null) return { starter_tally: null, confirmed: null };
  const last = reports.findLast(
    ({ index, data }) => within(index) && data.old === reference && data.fresh === starter,
  );
  const scored = asRecord(last?.data.scored);
  const scores = Array.isArray(scored?.unbilled) ? scored.unbilled : scored?.differences;
  if (last === undefined || !Array.isArray(scores)) return { starter_tally: null, confirmed: false };
  const ahead = scores.filter(isNumber).map((one) => -one);
  const { wins, losses, ties } = testOf(ahead);
  const level = isNumber(last.data.level) ? last.data.level : 0;
  return { starter_tally: { wins, losses, ties }, confirmed: readsStep(ahead, level) };
}

/**
 * An epoch's false-promotion reading (`FalsePromotion`): its attempts, from `reports` within it
 * against `reference`, each at its own rate, and beside them the campaign's A/A comparisons, each the
 * reference against itself read as a comparison is.
 */
function falsePromotionOf(
  reports: readonly Reported[],
  within: (at: number) => boolean,
  harnesses: { readonly reference: string | null; readonly starter: string | null },
): FalsePromotion {
  const levelOf = ({ data }: Reported) => (isNumber(data.level) ? data.level : 0);
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
    const rate = asRecord(attempt.data.scored)?.falseRate ?? asRecord(attempt.data.frontier)?.falseRate;
    return isNumber(rate) ? rate : levelOf(attempt);
  };
  const read = reports.flatMap((each) => {
    const noise = asRecord(each.data.noise);
    if (!Array.isArray(noise?.differences)) return [];
    const differences = noise.differences.filter(isNumber);
    return [
      {
        level: levelOf(each),
        differences,
        unbilled: Array.isArray(noise.unbilled) ? noise.unbilled.filter(isNumber) : differences,
      },
    ];
  });
  const aaComparisons = read.filter(({ unbilled, level }) => readsStep(unbilled.map(Math.abs), level));
  const errors = aaComparisons.filter(({ unbilled, level }) => readsStep(unbilled, level)).length;
  const rates = attempts.map(rateOf);
  return {
    attempts: attempts.length,
    errors,
    controls: aaComparisons.length,
    incapable: read.length - aaComparisons.length,
    bound: Math.max(0, ...rates),
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
  return `, against the starter without the bill ${String(tally.wins)} won, ${String(tally.losses)} lost, ${String(tally.ties)} tied, ${read}`;
}

/** One line an epoch, as the view prints them, each harness `called` as the view names it, and the
 *  promotion that ends it. */
export function epochLine(epoch: Epoch, called: Called = short): string {
  const share = (named: string, found: Share | null) =>
    found === null ? `${named} unread` : `${named} valid ${String(found.valid)} of ${String(found.solves)}`;
  const reference = epoch.reference === "starter" ? "the starter" : called(epoch.reference);
  const readings = epoch.comparisons.map(({ id, reading }) => `${id} ${reading}`).join(", ") || "none";
  // The first harness promoted over the Starter is set-up, epoch 0, and the climb counts from it.
  const rung = epoch.nth === 1 ? "as set-up (epoch 0)" : `as rung ${String(epoch.nth - 1)} of the climb`;
  const end = epoch.promoted === null ? "open" : `promoted ${called(epoch.promoted)} ${rung}`;
  const risk = epoch.falsePromotion;
  return `epoch ${String(epoch.nth)}: reference ${reference}; ${String(epoch.tasks.length)} tasks held out; ${String(epoch.sessions)} sessions (${String(epoch.changed)} changed); comparisons ${readings}; ${share("reference", epoch.reference_share)} on them${starterOf(epoch)}; ${plural(risk.attempts, "promotion attempt")} under this reference, a false promotion among them estimated at ${percent(risk.union)}: ${sourceOf(risk)}; ${end}`;
}

/** A chance in whole percent, or to a tenth under ten, where an attempt's rate of 1.8% read as 2%;
 *  one too small for a tenth is said as under it, never as none. */
function percent(chance: number): string {
  if (chance === 0) return "0%";
  if (chance < 0.001) return "under 0.1%";
  return chance < 0.1 ? `${(100 * chance).toFixed(1)}%` : `${String(Math.round(100 * chance))}%`;
}

/** The riskiest attempt's rate by design, an estimate, and the A/A comparisons read beside it. */
function sourceOf(risk: FalsePromotion): string {
  const comparisons =
    risk.controls === 0
      ? "no A/A comparison with enough untied tasks to read a step"
      : `${String(risk.errors)} of ${plural(risk.controls, "A/A comparison")} with enough untied tasks to read a step read one`;
  const incapable =
    risk.incapable === 0 ? "" : `, and ${String(risk.incapable)} too small to read one at their level`;
  return `${percent(risk.bound)} for the riskiest attempt by the rule's design; ${comparisons}${incapable}`;
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
      const attempts = plural(risk.attempts, "promotion attempt");
      return `- Epoch ${String(nth)}: ${attempts}, a false promotion among them estimated at ${percent(risk.union)}: ${sourceOf(risk)}.`;
    }),
    `Over the campaign, a false promotion in any epoch estimated at ${percent(total)}: the sum of the epochs' estimates, capped at one, which assumes nothing of how the attempts depend on one another. It sums estimates, so it is an estimate and no bound.`,
    "The rule assumes each untied task is as likely won as lost between equal harnesses; solver drift can violate that assumption. A/A comparisons provide an empirical check: each step is an observed false positive, but one alone does not establish miscalibration. With no steps in n independent comparisons sharing one false-positive rate, the approximate 95% upper limit is 3/n. The recorded comparisons do not establish those conditions, so they give no such bound by themselves. These estimates cover only recorded attempts; further attempts increase the campaign's estimate.",
  ];
}

/** The bars as the opening sets them, and the plan's where it names none (`BARS`). */
export function barsOf(events: readonly LogEvent[]): Worth["bars"] {
  const terms = openingOf(events)?.terms;
  const bar = (name: keyof typeof BARS) => {
    const set = Number(terms?.[name]);
    return Number.isFinite(set) ? set : BARS[name];
  };
  return { cost: bar("cost") };
}

/** An epoch's cost against the cost bar (`Worth`), with `pending` attempts the log holds no
 *  report of yet. */
function costOf(
  events: readonly LogEvent[],
  epoch: Epoch | undefined,
  bar: number,
  pending = 0,
): Worth["cost"] {
  if (epoch === undefined) return null;
  const attempts = epoch.falsePromotion.attempts + pending;
  const dollars = billedBetween(events, epoch.from, epoch.to ?? undefined);
  return { attempts, sessions: epoch.sessions, dollars, met: epoch.nth === 1 || attempts <= bar };
}

/** Comparison `id`'s worth where it reads a step (the plan's W): the cost of the log's last
 *  epoch with it as one attempt more. It is read as the log stood before its report, so a report
 *  read again says what it said. Until 19 October a repeat was its first stage's attempt. */
export function worthOf(events: readonly LogEvent[], id: string): Worth {
  const before = events.filter(({ kind, data }) => kind !== "comparison.reported" || data.session !== id);
  const bars = barsOf(before);
  return { bars, cost: costOf(before, epochsOf(before).at(-1), bars.cost, 1) };
}

/** Each promoted harness's worth (the plan's W): the cost of the epoch it ended. */
export function promotionsWorth(events: readonly LogEvent[]): ReadonlyMap<string, Worth> {
  const bars = barsOf(events);
  return new Map(
    epochsOf(events).flatMap((epoch) =>
      epoch.promoted === null
        ? []
        : [[epoch.promoted, { bars, cost: costOf(events, epoch, bars.cost) }] as const],
    ),
  );
}

/** Summarise the reported cost target; it does not affect admission. */
export function worthLine({ bars, cost }: Worth): string {
  return cost === null
    ? "cost unread"
    : `cost, reported only: ${plural(cost.attempts, "promotion attempt")} this epoch (bar ${String(bars.cost)} after set-up): ${cost.met ? "met" : "over it"}, over ${plural(cost.sessions, "Builder session")} and ${cost.dollars.toFixed(2)} dollars billed`;
}
