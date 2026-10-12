/**
 * The climb, as one reading of a campaign's log: its epochs. An epoch runs from the opening, or a
 * promotion, to the next promotion or the log's end, under one reference harness. The climb the
 * system is for is a chain of epochs in which each promoted harness answers tasks the one before
 * it failed, so an epoch's row keeps apart what each side answered on the tasks held out in it:
 * the reference harness, as the control and the comparisons read it, and the starter, the fixed
 * lower reference, which says whether the tasks got harder from one epoch to the next. A row holds
 * counts of valid answers and solves and nothing of a task.
 *
 * Written on 10 October, when the operator asked for the climb to be read as such: ten campaigns
 * had promoted once each and none twice, and no view said at which epoch a campaign stood or what
 * its tasks had done since the promotion. `runs view` prints the rows.
 */
import { type Paired, pairings, pairingsBy, readTwice, TRIGGER, UNMEASURED } from "../kernel/compare.ts";
import { conditionsOf } from "../kernel/condition.ts";
import type { LogEvent } from "../kernel/log.ts";
import { billedAll, lastReports, pairsReported, type Reported } from "../kernel/reports.ts";
import { upperBound } from "../kernel/size.ts";
import { countedSolves, passed } from "../kernel/solves.ts";
import { asRecord, isBoolean, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { plural } from "../meta/text.ts";
import { short } from "./move.ts";
import { openingOf } from "./opening.ts";

/**
 * What an epoch's promotion attempts risk together: a false promotion among them, bounded (the
 * revised plan's M2.5, 12 October). The two-stage rule bounds one attempt, and a campaign makes
 * many; this reads them, and the table may refuse the next comparison past a share of it.
 */
interface FalsePromotion {
  /** The candidates read against the epoch's reference on a frontier, each one attempt with the
   *  repeat it bought, unsuccessful ones included. */
  readonly attempts: number;
  /** The A/A controls on record read in pairs as a step and its repeat (`readTwice`), each pair one
   *  attempt between equal harnesses, and the pairs that promoted. */
  readonly errors: number;
  readonly pairs: number;
  /** The one-sided confidence of `bound`. */
  readonly confidence: number;
  /** One attempt's rate at most: the upper bound off the pairs (`upperBound`), never none, or by
   *  design the rule's own rate an attempt (`falseRate`) where no two controls are on record. */
  readonly bound: number;
  /** The union bound over the attempts, min(1, the sum of their bounds), which assumes nothing of
   *  their independence. */
  readonly union: number;
  /** Whether the bound was read under other tasks, from a control of another epoch, or by design for
   *  a fixed comparison. */
  readonly indicative: boolean;
}

/** The confidence a false-promotion bound is read at. */
const CONFIDENCE = 0.95;

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

/** The three bars a promotion is read against (the plan's W), each a term of the opening the
 *  operator may set (`TERMS`): `effect`, the valid share a new harness gains over the reference on
 *  the scored set; `transfer`, how far a promoted harness's valid share may fall from its share
 *  where it was promoted, on tasks written after its freeze; `cost`, the promotion attempts of an
 *  epoch after set-up, comparisons against its reference, which are what the false-promotion bound
 *  counts, so the bar does not move with the solver's price. A session the provider cut finished
 *  nothing and is no attempt. Dollars are reported beside them. They gate nothing (12 October). */
const BARS = { effect: 0.25, transfer: 0.15, cost: 3 } as const;
/** The tasks written after a harness's freeze its transfer is read on, at the least. */
const TRANSFER_TASKS = 8;

/** What `worthOf` reads of a comparison as `compared` builds its report: its id and candidate,
 *  each harness's census, its pairs, and whether the exam names an objective. */
interface Read {
  readonly id: string;
  readonly fresh: string;
  readonly valid: { readonly old: readonly number[]; readonly fresh: readonly number[] };
  readonly pairs: readonly Paired[];
  readonly objective: boolean;
}

/** A step's worth against the bars (`worthOf`, `promotionsWorth`). */
export interface Worth {
  readonly bars: Readonly<Record<keyof typeof BARS, number>>;
  /** The new harness's valid share less the reference's, and the share of the pairings of two valid
   *  answers it won by the objective, null where the exam names none or no two valid answers met.
   *  The bar is met by validity, or by the objective on at least half those pairings with no more
   *  pairings lost than won on validity (the Oracle's answer, 12 October). Null where a side has
   *  no census. */
  readonly effect: { readonly gain: number; readonly objective: number | null; readonly met: boolean } | null;
  /** A promoted harness's valid share on the tasks its epoch held out, written after its freeze,
   *  against its share in the comparison that promoted it; `met` null under eight tasks or where a
   *  share is unread. Null under the starter, which no comparison promoted. */
  readonly transfer: {
    readonly harness: string;
    readonly tasks: number;
    readonly share: number | null;
    readonly was: number | null;
    readonly met: boolean | null;
  } | null;
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
      data.outcome === "passed" &&
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
    const comparisons = events.flatMap(({ kind, data }, at) =>
      within(at) && kind === "comparison.reported" && isString(data.session)
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
 * against `reference`, and one attempt's bound read off the campaign's A/A controls in pairs, in
 * the log's order, each control's reference against itself as a stage of its own.
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
  // One attempt a candidate: a step and the repeat it bought are one (the Oracle's answer, 12 October).
  const attempts = against.filter(
    (one, at) => !against.slice(0, at).some(({ data }) => data.fresh === one.data.fresh),
  );
  /** The rule's own chance an attempt promotes equal harnesses at its margins (`falseRate`), the
   *  level where its report holds none: the level is one reading's, and this the rule's. */
  const rateOf = (attempt: Reported) => {
    const rate = asRecord(attempt.data.frontier)?.falseRate;
    return isNumber(rate) ? rate : levelOf(attempt);
  };
  const controls = reports.filter(({ data }) => asRecord(data.noise) !== null);
  const trigger = Number(openingOf(events)?.terms.trigger ?? TRIGGER);
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
  const measured = upperBound(errors, pairs.length, CONFIDENCE);
  const bounds = attempts.map((attempt) => (pairs.length > 0 ? measured : rateOf(attempt)));
  return {
    attempts: attempts.length,
    errors,
    pairs: pairs.length,
    confidence: CONFIDENCE,
    bound: pairs.length > 0 ? measured : Math.max(0, ...bounds),
    union: Math.min(
      1,
      bounds.reduce((sum, bound) => sum + bound, 0),
    ),
    indicative: pairs.length === 0 || controls.some(({ index }) => !within(index)),
  };
}

/** One line an epoch, as the view prints them. */
export function epochLine(epoch: Epoch): string {
  const share = (named: string, found: Share | null) =>
    found === null ? `${named} unread` : `${named} valid ${String(found.valid)} of ${String(found.solves)}`;
  const reference = epoch.reference === "starter" ? "the starter" : epoch.reference.slice(0, 8);
  const readings = epoch.comparisons.map(({ id, reading }) => `${id} ${reading}`).join(", ") || "none";
  // The first harness promoted over the Starter is set-up, epoch 0, and the climb counts from it.
  const rung = epoch.nth === 1 ? "as set-up (epoch 0)" : `as rung ${String(epoch.nth - 1)} of the climb`;
  const end = epoch.promoted === null ? "open" : `promoted ${epoch.promoted.slice(0, 8)} ${rung}`;
  const risk = epoch.falsePromotion;
  const percent = (chance: number) => `${String(Math.round(100 * chance))}%`;
  const source =
    risk.pairs === 0
      ? `${percent(risk.bound)} an attempt by design, before two A/A controls, indicative`
      : `${String(risk.errors)} of ${plural(risk.pairs, "pair")} of A/A controls promoted, at most ${percent(risk.bound)} an attempt at ${percent(risk.confidence)}${risk.indicative ? ", indicative" : ""}`;
  return `epoch ${String(epoch.nth)}: reference ${reference}; ${String(epoch.tasks.length)} tasks held out; ${String(epoch.sessions)} sessions (${String(epoch.changed)} changed); comparisons ${readings}; ${share("reference", epoch.reference_share)}${epoch.reference === "starter" ? "" : `, ${share("starter", epoch.starter_share)}`} on them; ${plural(risk.attempts, "promotion attempt")} under this reference, a false promotion among them at most ${percent(risk.union)}: ${source}; ${end}`;
}

/** A harness's valid share from a census of tasks by their valid solves (`Valid`), or null. */
function censusShare(census: unknown): number | null {
  if (!Array.isArray(census) || !census.every(isNumber) || census.length < 2) return null;
  const tasks = census.reduce((sum, count) => sum + count, 0);
  const valid = census.reduce((sum, count, solves) => sum + count * solves, 0);
  return tasks === 0 ? null : valid / (tasks * (census.length - 1));
}

/** The bars as the opening sets them, and the plan's where it names none (`BARS`). */
function barsOf(events: readonly LogEvent[]): Worth["bars"] {
  const terms = openingOf(events)?.terms;
  const bar = (name: keyof typeof BARS) => {
    const set = Number(terms?.[name]);
    return Number.isFinite(set) ? set : BARS[name];
  };
  return { effect: bar("effect"), transfer: bar("transfer"), cost: bar("cost") };
}

/** A comparison against the effect bar (`Worth`), from its census and its pairs as `compared`
 *  reads them. A share of a few solves is an exact fraction, so the gain is rounded before it is
 *  held to the bar. */
function effectOf({ valid, pairs, objective }: Read, bar: number): Worth["effect"] {
  const [old, fresh] = [censusShare(valid.old), censusShare(valid.fresh)];
  if (old === null || fresh === null) return null;
  const by = pairs.map(pairingsBy);
  const sum = (count: (one: (typeof by)[number]) => number) =>
    by.reduce((total, one) => total + count(one), 0);
  const both = sum((one) => one.valid);
  const won = objective && both > 0 ? sum((one) => one.objective.fresh) / both : null;
  const held = sum((one) => one.validity.old) <= sum((one) => one.validity.fresh);
  const gain = Math.round((fresh - old) * 1e6) / 1e6;
  return { gain, objective: won, met: gain >= bar || (won !== null && won >= 0.5 && held) };
}

/** The effect a step's report logged (`worthOf`), or null where it holds none. */
function loggedEffect(data: JsonObject | undefined): Worth["effect"] {
  const told = asRecord(asRecord(data?.worth)?.effect);
  if (!isNumber(told?.gain) || !isBoolean(told.met)) return null;
  return { gain: told.gain, objective: isNumber(told.objective) ? told.objective : null, met: told.met };
}

/** The last report within `epoch` that read `harness` as the new one: the comparison it was
 *  promoted on, where it ended the epoch. */
function restedOn(events: readonly LogEvent[], epoch: Epoch, harness: string): Reported | undefined {
  return lastReports(events).findLast(
    ({ index, data }) =>
      data.fresh === harness && index >= epoch.from && (epoch.to === null || index < epoch.to),
  );
}

/** The transfer of the reference of `epochs[nth]`, read in its own epoch (`Worth`). */
function transferOf(events: readonly LogEvent[], epochs: readonly Epoch[], nth: number, bar: number) {
  const [before, epoch] = [epochs[nth - 1], epochs[nth]];
  if (before === undefined || epoch === undefined) return null;
  const rested = restedOn(events, before, epoch.reference);
  const was = censusShare(asRecord(rested?.data.valid)?.fresh);
  const found = epoch.reference_share;
  const share = found === null || found.solves === 0 ? null : found.valid / found.solves;
  const read = epoch.tasks.length >= TRANSFER_TASKS && share !== null && was !== null;
  return {
    harness: epoch.reference,
    tasks: epoch.tasks.length,
    share,
    was,
    met: read ? was - share <= bar + 1e-9 : null,
  };
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
  const dollars = billedAll(events.slice(epoch.from, epoch.to ?? undefined));
  return { attempts, sessions: epoch.sessions, dollars, met: epoch.nth === 1 || attempts <= bar };
}

/** Comparison `read.id`'s worth where it reads a step (the plan's W): its effect, the transfer of
 *  the reference it was read against, and the cost of the log's last epoch with it as an attempt
 *  where its candidate is not one already, a repeat being its first stage's. It is read as the log
 *  stood before its report, so a report read again says what it said. */
export function worthOf(events: readonly LogEvent[], read: Read): Worth {
  const before = events.filter(
    ({ kind, data }) => kind !== "comparison.reported" || data.session !== read.id,
  );
  const bars = barsOf(before);
  const epochs = epochsOf(before);
  const epoch = epochs.at(-1);
  const again = lastReports(before).some(
    ({ index, data }) =>
      epoch !== undefined &&
      index >= epoch.from &&
      data.fresh === read.fresh &&
      asRecord(data.frontier) !== null,
  );
  return {
    bars,
    effect: effectOf(read, bars.effect),
    transfer: transferOf(before, epochs, epochs.length - 1, bars.transfer),
    cost: costOf(before, epoch, bars.cost, again ? 0 : 1),
  };
}

/** Each promoted harness's worth (the plan's W): the effect of the comparison it was promoted on,
 *  its transfer read in the epoch it opened, and the cost of the epoch it ended. */
export function promotionsWorth(events: readonly LogEvent[]): ReadonlyMap<string, Worth> {
  const bars = barsOf(events);
  const epochs = epochsOf(events);
  return new Map(
    epochs.flatMap((epoch, nth) => {
      if (epoch.promoted === null) return [];
      const rested = restedOn(events, epoch, epoch.promoted);
      const worth: Worth = {
        bars,
        effect: loggedEffect(rested?.data),
        transfer: transferOf(events, epochs, nth + 1, bars.transfer),
        cost: costOf(events, epoch, bars.cost),
      };
      return [[epoch.promoted, worth] as const];
    }),
  );
}

/** The bars a promotion's worth falls below, of effect and transfer: a cost over its bar is the
 *  campaign's, and leaves the promotion as it stands. */
export function belowBar({ effect, transfer }: Worth): string[] {
  return [effect?.met === false ? "effect" : [], transfer?.met === false ? "transfer" : []].flat();
}

/** A worth as one line: what each bar read, and that it gates nothing. */
export function worthLine({ bars, effect, transfer, cost }: Worth): string {
  const points = (share: number) => String(Math.round(100 * share));
  const verdict = (met: boolean | null) => (met === null ? "unread" : met ? "met" : "below bar");
  const effectSaid =
    effect === null
      ? "effect unread"
      : `effect ${effect.gain > 0 ? "+" : ""}${points(effect.gain)} points of valid share (bar ${points(bars.effect)}): ${verdict(effect.met)}`;
  const transferSaid =
    transfer === null
      ? "no transfer under the starter"
      : `transfer of ${short(transfer.harness)}: ${transfer.share === null ? "no share" : `valid ${points(transfer.share)}%`} on ${plural(transfer.tasks, "task")} written after its freeze, against ${transfer.was === null ? "no share" : `${points(transfer.was)}%`} where it was promoted (bar ${points(bars.transfer)} points, at least ${String(TRANSFER_TASKS)} tasks): ${verdict(transfer.met)}`;
  const costSaid =
    cost === null
      ? "cost unread"
      : `cost ${plural(cost.attempts, "promotion attempt")} this epoch (bar ${String(bars.cost)} after set-up): ${verdict(cost.met)}, over ${plural(cost.sessions, "Builder session")} and ${cost.dollars.toFixed(2)} dollars billed`;
  return `worth, read against the bars and gating nothing: ${effectSaid}; ${transferSaid}; ${costSaid}`;
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
