/**
 * The climb, as one reading of a campaign's log: its epochs. An epoch runs from the opening, or a
 * promotion, to the next promotion or the log's end, under one reference harness. The climb the
 * system is for is a chain of epochs in which each promoted harness answers tasks the one before
 * it failed, so an epoch's row keeps apart what each side answered on the tasks held out in it:
 * the reference harness, as the control and the comparisons read it, and the starter, the fixed
 * lower reference, which says whether the tasks got harder from one epoch to the next. A row holds
 * counts of valid answers and solves and nothing of a task.
 *
 * Written when the operator asked for the climb to be read as such: ten campaigns
 * had promoted once each and none twice, and no view said at which epoch a campaign stood or what
 * its tasks had done since the promotion. `runs view` prints the rows.
 */
import { attemptsOf, pairings, readTwice, TRIGGER, triggered, UNMEASURED } from "../kernel/compare.ts";
import { conditionsOf } from "../kernel/condition.ts";
import type { LogEvent } from "../kernel/log.ts";
import { billedBetween, lastReports, pairsReported, type Reported } from "../kernel/reports.ts";
import { countedSolves, passed } from "../kernel/solves.ts";
import { heldAtGate } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { plural } from "../meta/text.ts";
import { short } from "./move.ts";
import type { Called } from "./names.ts";
import { openingOf } from "./opening.ts";

/**
 * What an epoch's promotion attempts risk together: a false promotion among them, estimated (the
 * revised plan's M2.5, 12 October). The two-stage rule's design gives one attempt a rate, which is
 * an estimate and no bound (`falseRate`), and a campaign makes many; this reads them.
 */
interface FalsePromotion {
  /** The candidates read against the epoch's reference on a frontier, each one attempt with the
   *  repeat it bought, unsuccessful ones included. */
  readonly attempts: number;
  /** The A/A controls on record read in pairs as a step and its repeat (`readTwice`), each pair one
   *  attempt between equal harnesses, and the pairs that promoted: a count beside the estimate,
   *  which sets none of it. Until 19 October a 95% bound off the pairs replaced the design's rate once one
   *  pair was on record, and no error in one pair bounds an attempt at 95%: esp32-fresh-opus's
   *  closing report read "at most 100%" where its attempts' own rates were 1.8%, and no campaign
   *  reads the 59 pairs that bring that bound down to 5%. */
  readonly errors: number;
  readonly pairs: number;
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
  /** What the reference and the starter answered of the solves of the epoch's own tasks within
   *  it: null where no solve of that harness on those tasks is on record. */
  readonly reference_share: Share | null;
  readonly starter_share: Share | null;
  readonly falsePromotion: FalsePromotion;
}

/** The regression reading beside a comparison: the newest candidate against the previous one. */
interface Regression {
  /** The two candidates by digest, and the reference both were read against. */
  readonly newest: string;
  readonly previous: string;
  readonly against: string;
  /** The ids of the two comparisons the solves come from, the newest first. */
  readonly comparisons: readonly [string, string];
  /** Tasks both comparisons scored, which are the ones read. */
  readonly shared: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

const PROMOTED = "harness.promoted";

/** The bar a promotion's cost is read against (the plan's W), a term of the opening the operator
 *  may set (`TERMS`): the promotion attempts of an epoch after set-up, comparisons against its
 *  reference, which are what the false-promotion estimate counts, so the bar does not move with the
 *  solver's price. A session the provider cut finished nothing and is no attempt. Dollars are
 *  reported beside it, and it gates nothing (12 October). The effect and transfer bars it stood
 *  beside until 13 October went: each read a set that changed with every reading. The ladder that
 *  took their place, a fixed set read after every promotion, went on 16 October: the first
 *  promotion's reference answered it whole. The climb is read as promotions. */
const BARS = { cost: 3 } as const;

/** What `worthOf` reads of a comparison as `compared` builds its report: its id and candidate. */
interface Read {
  readonly id: string;
  readonly fresh: string;
}

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

/** The share of valid answers among `solves`, or null where there is none. */
function shareOf(solves: readonly (boolean | null)[]): Share | null {
  const judged = solves.filter((each): each is boolean => each !== null);
  return judged.length === 0 ? null : { valid: judged.filter(Boolean).length, solves: judged.length };
}

/** Where each epoch starts: the log's opening, then each promotion. */
function boundsOf(events: readonly LogEvent[]): { index: number; harness: string }[] {
  const promotions = events.flatMap(({ kind, data }, index) =>
    kind === PROMOTED && isString(data.harness) ? [{ index, harness: data.harness }] : [],
  );
  return [{ index: 0, harness: "starter" }, ...promotions];
}

/** The task versions that passed their gate in each epoch, oldest epoch first: the tasks written
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
    const under = (digest: string | null) =>
      digest === null
        ? []
        : solves.flatMap((solve) => {
            const condition = conditions.get(solve.condition);
            return within(solve.started) && condition?.harness === digest && held.has(condition.task)
              ? [passed(solve)]
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
      reference_share: shareOf(under(referenceDigest)),
      starter_share: reference === "starter" ? null : shareOf(under(starterDigest)),
      falsePromotion: falsePromotionOf(events, reports, within, {
        reference: referenceDigest,
        starter: starterDigest,
      }),
    };
  });
}

/**
 * An epoch's false-promotion reading (`FalsePromotion`): its attempts, from `reports` within it
 * against `reference`, each at its own rate, and beside them the campaign's A/A controls in pairs,
 * in the log's order, each control's reference against itself as a stage of its own.
 */
function falsePromotionOf(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  within: (at: number) => boolean,
  harnesses: { readonly reference: string | null; readonly starter: string | null },
): FalsePromotion {
  const levelOf = ({ data }: Reported) => (isNumber(data.level) ? data.level : 0);
  const against = reports.filter(
    ({ index, data }) =>
      within(index) &&
      data.old === harnesses.reference &&
      data.fresh !== harnesses.starter &&
      asRecord(data.frontier) !== null,
  );
  // A step and the repeat it bought are one attempt (the Oracle's answer, 12 October), and a later
  // reading of the same candidate that is no repeat is another (`attemptsOf`; until 16 October one
  // a candidate, and buffer-159-opus's third and fourth readings of 0665c78b went uncounted).
  const trigger = Number(openingOf(events)?.terms.trigger ?? TRIGGER);
  const attempts = [...new Set(against.map(({ data }) => data.fresh))].flatMap((fresh) =>
    attemptsOf(
      against.filter(({ data }) => data.fresh === fresh),
      ({ data }) => triggered(data, trigger),
    ).flatMap(([first]) => (first === undefined ? [] : [first])),
  );
  /** The rule's own chance an attempt promotes equal harnesses at its margins (`falseRate`), the
   *  level where its report holds none: the level is one reading's, and this the rule's. */
  const rateOf = (attempt: Reported) => {
    const rate = asRecord(attempt.data.frontier)?.falseRate;
    return isNumber(rate) ? rate : levelOf(attempt);
  };
  const controls = reports.filter(({ data }) => asRecord(data.noise) !== null);
  const stage = ({ data }: Reported) => ({
    frontier: data.noise ?? null,
    retained: UNMEASURED,
    families: {},
  });
  const pairs = Array.from({ length: Math.floor(controls.length / 2) }, (_, at) => [
    controls[2 * at],
    controls[2 * at + 1],
  ]).flatMap(([one, two]) => (one === undefined || two === undefined ? [] : [[one, two] as const]));
  const errors = pairs.filter(([one, two]) =>
    readTwice([stage(one), stage(two)], levelOf(one), trigger),
  ).length;
  const rates = attempts.map(rateOf);
  return {
    attempts: attempts.length,
    errors,
    pairs: pairs.length,
    bound: Math.max(0, ...rates),
    union: Math.min(
      1,
      rates.reduce((sum, rate) => sum + rate, 0),
    ),
  };
}

/** One line an epoch, as the view prints them, each harness `called` as the view names it. */
export function epochLine(epoch: Epoch, called: Called = short): string {
  const share = (named: string, found: Share | null) =>
    found === null ? `${named} unread` : `${named} valid ${String(found.valid)} of ${String(found.solves)}`;
  const reference = epoch.reference === "starter" ? "the starter" : called(epoch.reference);
  const readings = epoch.comparisons.map(({ id, reading }) => `${id} ${reading}`).join(", ") || "none";
  // The first harness promoted over the Starter is set-up, epoch 0, and the climb counts from it.
  const rung = epoch.nth === 1 ? "as set-up (epoch 0)" : `as rung ${String(epoch.nth - 1)} of the climb`;
  const end = epoch.promoted === null ? "open" : `promoted ${called(epoch.promoted)} ${rung}`;
  const risk = epoch.falsePromotion;
  return `epoch ${String(epoch.nth)}: reference ${reference}; ${String(epoch.tasks.length)} tasks held out; ${String(epoch.sessions)} sessions (${String(epoch.changed)} changed); comparisons ${readings}; ${share("reference", epoch.reference_share)}${epoch.reference === "starter" ? "" : `, ${share("starter", epoch.starter_share)}`} on them; ${plural(risk.attempts, "promotion attempt")} under this reference, a false promotion among them estimated at ${percent(risk.union)}: ${sourceOf(risk)}; ${end}`;
}

/** A chance in whole percent, or to a tenth under ten, where an attempt's rate of 1.8% read as 2%;
 *  one too small for a tenth is said as under it, never as none. */
function percent(chance: number): string {
  if (chance === 0) return "0%";
  if (chance < 0.001) return "under 0.1%";
  return chance < 0.1 ? `${(100 * chance).toFixed(1)}%` : `${String(Math.round(100 * chance))}%`;
}

/** The riskiest attempt's rate by design, an estimate, and the A/A controls read beside it. */
function sourceOf(risk: FalsePromotion): string {
  const controls =
    risk.pairs === 0
      ? "no two A/A controls on record"
      : `${String(risk.errors)} of ${plural(risk.pairs, "pair")} of A/A controls promoted`;
  return `${percent(risk.bound)} for the riskiest attempt by the rule's design; ${controls}`;
}

/**
 * The campaign's chance of a false promotion, for its closing report (the plan's 7.6): each epoch's
 * summed estimate with what it rests on, and their sum capped at one: estimates all, and no bound.
 * An epoch's sum restarts at its promotion, so the opening's over one patience's attempts describes
 * one window, and no epoch's alone the campaign.
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
    "The rule's design assumes each untied task is as likely won as lost between two equal harnesses, which a solver whose solves drift can break. The A/A controls test that assumption: a pair of them that promotes is a false promotion between equal harnesses, and the design's rate then does not hold. No promotion in n pairs bounds an attempt only near 3 in n, so the controls on record count against the design and bound nothing by themselves. Each line counts the attempts on record: a campaign that goes on makes more, and its estimate grows with them.",
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

/** Comparison `read.id`'s worth where it reads a step (the plan's W): the cost of the log's last
 *  epoch with it as an attempt unless it is the repeat of one (`attemptsOf`), a repeat being its
 *  first stage's. It is read as the log stood before its report, so a report read again says what it said. */
export function worthOf(events: readonly LogEvent[], read: Read): Worth {
  const before = events.filter(
    ({ kind, data }) => kind !== "comparison.reported" || data.session !== read.id,
  );
  const bars = barsOf(before);
  const epochs = epochsOf(before);
  const epoch = epochs.at(-1);
  const trigger = Number(openingOf(before)?.terms.trigger ?? TRIGGER);
  const prior = lastReports(before).flatMap(({ index, data }) =>
    epoch !== undefined &&
    index >= epoch.from &&
    data.fresh === read.fresh &&
    asRecord(data.frontier) !== null
      ? [data]
      : [],
  );
  // Until 16 October any earlier reading of the candidate made this one its repeat, and the g-6
  // prefix of buffer-159-opus read one attempt where the epoch reader counts two (`attemptsOf`).
  const open = attemptsOf(prior, (data) => triggered(data, trigger)).at(-1);
  const again = open?.length === 1 && open[0] !== undefined && triggered(open[0], trigger);
  return { bars, cost: costOf(before, epoch, bars.cost, again ? 0 : 1) };
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

/** A worth as one line: what the bar read, and that it gates nothing. */
export function worthLine({ bars, cost }: Worth): string {
  return cost === null
    ? "cost unread"
    : `cost, gating nothing: ${plural(cost.attempts, "promotion attempt")} this epoch (bar ${String(bars.cost)} after set-up): ${cost.met ? "met" : "over it"}, over ${plural(cost.sessions, "Builder session")} and ${cost.dollars.toFixed(2)} dollars billed`;
}

/**
 * The newest candidate read against the previous candidate, on the tasks both their comparisons
 * scored, from the solves those comparisons already made: a reading beside the test and never in
 * it. A Builder session starts from the harness the last one left and every comparison is made
 * against the reference, so a candidate worse than the one before it reads as progress for as
 * long as it still beats the reference (the plan's climb section, C6). The two comparisons are
 * under one setting, which names the host's code, so the solves paired differ in the harness and
 * nothing else; no earlier solve is reused in a test for that reason (AGENTS.md, section 7),
 * and this reading claims no more than the pairing. Null where the log holds no two candidates
 * read against one reference under one setting.
 */
export function regressionOf(events: readonly LogEvent[]): Regression | null {
  const reports = lastReports(events);
  const last = reports.at(-1);
  if (last === undefined || !isString(last.data.fresh) || !isString(last.data.old)) return null;
  const { fresh: newest, old: against, setting } = last.data;
  const before = reports
    .slice(0, -1)
    .findLast(
      ({ data }) =>
        data.old === against &&
        data.setting === setting &&
        isString(data.fresh) &&
        data.fresh !== newest &&
        data.fresh !== against,
    );
  if (before === undefined || !isString(before.data.fresh)) return null;
  const previousPairs = new Map(pairsReported(events, before).map((pair) => [pair.task, pair]));
  const counts = { shared: 0, wins: 0, losses: 0, ties: 0 };
  for (const pair of pairsReported(events, last)) {
    const other = previousPairs.get(pair.task);
    if (other === undefined) continue;
    counts.shared += 1;
    // By the objective too, where both comparisons fixed the same rule; on validity alone otherwise.
    const rule = pair.objective;
    const same =
      rule !== undefined &&
      other.objective?.direction === rule.direction &&
      other.objective.margin === rule.margin;
    const won = pairings({
      task: pair.task,
      old: other.fresh,
      fresh: pair.fresh,
      ...keyIfDefined(
        "objective",
        same ? { ...rule, old: other.objective?.fresh ?? [], fresh: rule.fresh } : undefined,
      ),
    });
    counts[won.fresh > won.old ? "wins" : won.fresh < won.old ? "losses" : "ties"] += 1;
  }
  return {
    newest,
    previous: before.data.fresh,
    against,
    comparisons: [last.session, before.session],
    ...counts,
  };
}

/** One line for the view: the reading, and that it is beside the test. */
export function regressionLine(found: Regression): string {
  return `regression check: harness ${short(found.newest)} (${found.comparisons[0]}) against the candidate before it, ${short(found.previous)} (${found.comparisons[1]}), both read against ${short(found.against)} under one setting, on the ${String(found.shared)} tasks both scored: ${String(found.wins)} won, ${String(found.losses)} lost, ${String(found.ties)} tied. A reading beside the test: it decides nothing`;
}
