/**
 * Epoch-level summary of a campaign's climb, folded from the log. An epoch spans from campaign
 * opening (or a promotion) to the next promotion (or the end of the log), under a single reference
 * harness. Each epoch row records the reported factors: the unbilled tally of its first starter
 * comparison, which confirms the promotion (climb); the estimated false-promotion probability
 * across its attempts alongside the A/A controls (honesty); and the promotion cost (economy). Rows
 * hold aggregate counts only and reveal no task identity; `runs view` renders them.
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
  wholePoints,
} from "../kernel/compare.ts";
import { OPENING, writersOf } from "../kernel/history.ts";
import { isReferenceChange, type LogEvent } from "../kernel/log.ts";
import { lastReports, pairsReported, type Reported } from "../kernel/reports.ts";
import { billedBetween } from "../kernel/meter.ts";
import { heldAtGate } from "../kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keysIf } from "../meta/optional-key.ts";
import { plural } from "../meta/text.ts";
import { short } from "./move.ts";
import type { Called } from "./names.ts";

/** Able A/A control and one-sided step counts for one comparison slice (`validity` or `objective`). */
interface ControlSlice {
  readonly controls: number;
  readonly errors: number;
}

/**
 * Estimated probability that an epoch's promotion attempts include at least one false positive.
 * Each comparison yields a per-reading false-positive estimate at its observed margins (`falseRate`,
 * `comparison.ts`), which is an estimate rather than a formal bound; this structure aggregates
 * those estimates across the epoch alongside empirical A/A controls.
 */
interface FalsePromotion {
  /** Candidate comparisons against the epoch's reference on a frontier (including unsuccessful
   *  attempts); each counts as one promotion attempt. */
  readonly attempts: number;
  /** A/A controls that read a step under the one-sided unbilled rule. Controls too small to reach
   *  the significance level are excluded from the denominator; legacy reports without unbilled
   *  scores fall back to their full scores. */
  readonly errors: number;
  /** A/A controls that read a step in either direction. Because the two halves of an A/A control
   *  are exchangeable, a reversed step is equally informative as noise, at twice the nominal rate. */
  readonly either: number;
  readonly controls: number;
  readonly incapable: number;
  /** Subset of incapable controls that tied on every task: a reference that produces identical
   *  outcomes on every solve matches itself and cannot register a step at any level. */
  readonly tied: number;
  /** Able A/A controls and steps split by whether the reference's own validity varied (`validity`)
   *  or only the objective separated mirrored halves (`objective`). */
  readonly byMeasure: Readonly<Record<"validity" | "objective", ControlSlice>>;
  /** `min(1, sum of attempt rates)`: union-bound form that avoids assuming independence across
   *  attempts; because it sums estimates, the result is an estimate rather than a formal bound. */
  readonly union: number;
}

export interface Epoch {
  /** One-based epoch index. */
  readonly nth: number;
  /** Reference harness digest, or `"starter"` in the campaign's first epoch. */
  readonly reference: string;
  /** Inclusive start log index and exclusive end log index (null for the current open epoch). */
  readonly from: number;
  readonly to: number | null;
  /** Digest of the harness promoted at the end of the epoch, or null if still open. */
  readonly promoted: string | null;
  /** Task versions admitted by the gate during the epoch, including those later released to practice. */
  readonly tasks: readonly string[];
  /** Number of distinct Builder sessions active during the epoch. */
  readonly sessions: number;
  /** Comparisons reported in the epoch, with their session ids and readings. */
  readonly comparisons: readonly { readonly id: string; readonly reading: string }[];
  /** Unbilled tally of the reference against the starter in the epoch's first starter comparison
   *  that tallied at least one task, oriented from the reference's side; null in epoch 1 and until
   *  such a comparison reports. */
  readonly starter_tally: Tally | null;
  /** Session id of that starter comparison, or null when `starter_tally` is null. */
  readonly starter_read: string | null;
  /** Whether the promotion opening this epoch is confirmed: its first starter comparison that
   *  tallied at least one task reads the reference above the starter (unbilled) at that
   *  comparison's significance level (`AGENTS.md`, section 1). Null in epoch 1; false until a
   *  starter comparison reports. */
  readonly confirmed: boolean | null;
  /** Whether that starter comparison had enough untied tasks to clear its significance level if
   *  every untied task went to the reference; null before any scored starter comparison or in epoch 1. */
  readonly starter_able: boolean | null;
  /** True when this epoch was opened by reverting an unconfirmed reference back to a prior harness. */
  readonly reverted?: boolean;
  readonly falsePromotion: FalsePromotion;
}

const ATTEMPT = "promotion attempt";

/** Economy reference bar for promotion cost: at most this many promotion attempts in an epoch
 *  after set-up, counted as comparisons against the epoch's reference (matching the false-promotion
 *  attempt count) so the bar is invariant to solver pricing. Provider-interrupted sessions are not
 *  counted. Dollar spend is reported alongside; this bar is purely observational. */
export const BARS = { cost: 3 } as const;

/** Campaign milestone tracked for the operator (`AGENTS.md`, factors 1 and 2): six confirmed
 *  promotions followed by ten A/A controls. Strictly observational; no prompt, tool, or decision
 *  rule reads these counts. */
const MILESTONE = { promotions: 6, controls: 10 } as const;

/** Evaluation of a step's cost against `BARS` (`worthOf`, `promotionsWorth`). */
export interface Worth {
  /** Epoch promotion attempts, Builder sessions, billed dollars, and whether attempts are within
   *  the bar (always true for the set-up epoch). */
  readonly cost: {
    readonly attempts: number;
    readonly sessions: number;
    readonly dollars: number;
    readonly met: boolean;
  };
}

export const ORIGINS = ["read at the promotion", "written before, not chosen on", "written after"] as const;
export type Origin = (typeof ORIGINS)[number];

/** Task tally for a single origin, decomposed into all tasks, tasks where validity differed, and
 *  tasks where validity tied. */
export interface Split {
  readonly whole: Tally;
  readonly validity: Tally;
  readonly rest: Tally;
}

/**
 * Standalone reading of tasks written after a promotion: a step for the reference, a step for the
 * starter, no step, or too few untied tasks to reach the significance level. Because no prior
 * selection step conditioned on these tasks, a gain on them is free of winner's-curse selection
 * bias (unlike tasks that chose the promoted harness or its ancestors). Descriptive only.
 */
export const UNSELECTED = ["a step", "a step for the starter", "no step", "too few"] as const;
type Unselected = (typeof UNSELECTED)[number];

/** Per-task row of a starter comparison: task origin, author session, signed margin from the
 *  reference's perspective (`-differenceOf`), and the reconstructed paired outcomes. */
interface StarterRow {
  readonly task: string;
  readonly origin: Origin;
  readonly writer: string;
  readonly margin: number;
  readonly pair: Paired;
}

/** Detailed breakdown of a promotion's first starter comparison that tallied at least one task. */
export interface StarterRead {
  readonly session: string;
  /** Harness digests: the reference is the old side and the starter is the new side. */
  readonly reference: string;
  readonly starter: string;
  /** Unbilled tally and confirmation flag computed by `epochsOf` from stored scores. */
  readonly stored: Tally;
  readonly confirmed: boolean;
  readonly level: number;
  readonly origins: Readonly<Record<Origin, Split>>;
  /** Tally grouped by Examiner session, ordered by first proposal. */
  readonly authors: readonly { readonly session: string; readonly tally: Tally }[];
  /** Standalone reading on tasks written after the promotion under the current tree's rule. */
  readonly after: Unselected;
  /** Tally and reading on tasks not selected by any prior step for this harness or its ancestors.
   *  The `"written before, not chosen on"` bucket still includes tasks selected by an ancestor's
   *  step, so this subset isolates truly unselected tasks. Descriptive only; `confirmed` governs
   *  confirmation. */
  readonly unchosen: { readonly tally: Tally; readonly read: Unselected };
  /** Whether the report recorded its significance level (`level` defaults to 0 when absent). */
  readonly levelled: boolean;
  /** Scored tasks in report order. */
  readonly rows: readonly StarterRow[];
  /** Canonical key combining harnesses and sorted task versions to identify duplicate comparisons. */
  readonly key: string;
}

const levelOf = ({ data }: Reported) => (isNumber(data.level) ? data.level : 0);

function epochSlices(events: readonly LogEvent[]) {
  const bounds: { index: number; harness: string; reverted: boolean }[] = [
    { index: 0, harness: "starter", reverted: false },
  ];
  const tasks: string[][] = [[]];
  const sessions: Set<string>[] = [new Set()];
  for (const [at, { kind, data }] of events.entries()) {
    if (isReferenceChange(kind) && isString(data.harness)) {
      bounds.push({ index: at, harness: data.harness, reverted: kind === "harness.reverted" });
      tasks.push([]);
      sessions.push(new Set());
    } else if (kind === "task.gate" && heldAtGate(data.outcome) && isString(data.version)) {
      tasks.at(-1)?.push(data.version);
    } else if (kind.startsWith("build.") && isString(data.session)) {
      sessions.at(-1)?.add(data.session);
    }
  }
  return { bounds, tasks, sessions };
}

/** Return task versions admitted by the gate in each epoch, oldest epoch first; comparisons draw
 *  from newest epoch backwards (`scoredSet`). */
export const tasksByEpoch = (events: readonly LogEvent[]): string[][] => epochSlices(events).tasks;

/** Return the starter harness digest named in the first comparison's terms, or null before any comparison. */
export function starterIn(events: readonly LogEvent[]): string | null {
  const named = events.find(({ kind }) => kind === "comparison.started")?.data.starter;
  return isString(named) ? named : null;
}

/** Fold a campaign log into its epochs, oldest first. A log with no promotions yields one epoch. */
export function epochsOf(events: readonly LogEvent[]): Epoch[] {
  return epochsFrom(events, lastReports(events));
}

function epochsFrom(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  controls = controlsIn(reports),
): Epoch[] {
  const starter = starterIn(events);
  const { bounds, tasks, sessions } = epochSlices(events);
  const confirmedDigests = new Set<string>();
  return bounds.map(({ index: from, harness: reference, reverted }, nth) => {
    const next = bounds[nth + 1];
    const to = next?.index ?? null;
    const own = reports.filter(({ index }) => index >= from && (to === null || index < to));
    const comparisons = own.map(({ session, data }) => ({
      id: session,
      reading: isString(data.reading) ? data.reading : "",
    }));
    const isStarter = reference === "starter" || (starter !== null && reference === starter);
    const referenceDigest = isStarter ? starter : reference;
    const starterCheck =
      reverted && !isStarter && confirmedDigests.has(reference)
        ? { starter_tally: null, starter_read: null, confirmed: true, starter_able: null }
        : againstStarter(own, isStarter ? null : referenceDigest, starter);
    if (starterCheck.confirmed === true && !isStarter) confirmedDigests.add(reference);
    return {
      nth: nth + 1,
      reference: isStarter ? "starter" : reference,
      from,
      to,
      promoted: next === undefined || next.reverted ? null : next.harness,
      tasks: tasks[nth] ?? [],
      sessions: sessions[nth]?.size ?? 0,
      comparisons,
      ...starterCheck,
      ...keysIf(reverted, () => ({ reverted: true })),
      falsePromotion: falsePromotionOf(own, controls, { reference: referenceDigest, starter }),
    };
  });
}

/**
 * Compute the unbilled tally and confirmation status for the epoch's first starter comparison that
 * tallied at least one task. Because the starter is the new side of that comparison, scores are
 * negated to orient them from the reference's perspective. Only the first such comparison decides
 * confirmation, preventing later draws from overwriting a failed confirmation (`heldSince`,
 * `decide.ts`). Legacy reports without unbilled scores fall back to their full scores. A null
 * `reference` denotes epoch 1, which has no starter comparison.
 */
function againstStarter(
  reports: readonly Reported[],
  reference: string | null,
  starter: string | null,
): Pick<Epoch, "starter_tally" | "starter_read" | "confirmed" | "starter_able"> {
  if (reference === null) {
    return { starter_tally: null, starter_read: null, confirmed: null, starter_able: null };
  }
  const first = reports.find(
    ({ data }) =>
      data.old === reference &&
      data.fresh === starter &&
      data.reading !== "not-scored" &&
      asRecord(data.scored) !== null,
  );
  if (first === undefined) {
    return { starter_tally: null, starter_read: null, confirmed: false, starter_able: null };
  }
  const ahead = scoresIn(first.data.scored).map((one) => -one);
  const { wins, losses, ties } = testOf(ahead);
  const level = levelOf(first);
  return {
    starter_tally: { wins, losses, ties },
    starter_read: first.session,
    confirmed: readsStep(ahead, level),
    starter_able: readsStep(ahead.map(Math.abs), level),
  };
}

/** Whether an A/A control had any validity flips on the reference (`validity`) or every task
 *  was all-valid or all-invalid so only the objective could separate mirrored halves (`objective`). */
function measureSliceOf(data: JsonObject, noise?: JsonObject): "validity" | "objective" {
  if (isNumber(noise?.flips)) return noise.flips > 0 ? "validity" : "objective";
  const counts = asRecord(data.valid)?.old;
  return Array.isArray(counts) && counts.slice(1, -1).some((count) => isNumber(count) && count > 0)
    ? "validity"
    : "objective";
}

/** Summarise a single A/A control at `level`: whether it had enough untied tasks to be capable of
 *  reading a step, whether it read one (one-sided or two-sided), and whether every task tied. */
function controlOf(index: number, level: number, scores: readonly number[], slice: "validity" | "objective") {
  const able = readsStep(scores.map(Math.abs), level);
  const tied = scores.length > 0 && scores.every((one) => one === 0);
  return {
    index,
    level,
    scores,
    slice,
    able,
    tied,
    step: readsStep(scores, level),
    either: readsStepEitherWay(scores, level),
  };
}

/** Extract the A/A control (reference against itself) recorded alongside each comparison report. */
function controlsIn(reports: readonly Reported[]) {
  return reports.flatMap((each) => {
    const noise = asRecord(each.data.noise);
    if (!Array.isArray(noise?.differences)) return [];
    return [controlOf(each.index, levelOf(each), scoresIn(noise), measureSliceOf(each.data, noise))];
  });
}

/**
 * Compute an epoch's `FalsePromotion` summary from candidate comparison attempts against
 * `reference`, alongside the campaign's A/A controls.
 */
function falsePromotionOf(
  reports: readonly Reported[],
  read: readonly ReturnType<typeof controlOf>[],
  harnesses: { readonly reference: string | null; readonly starter: string | null },
): FalsePromotion {
  const attempts = reports.filter(
    ({ data }) =>
      data.old === harnesses.reference &&
      data.fresh !== harnesses.starter &&
      asRecord(data.frontier) !== null,
  );
  /** Estimated false-positive rate at the report's observed margins (`falseRate`), falling back to
   *  the nominal significance level when absent. */
  const rateOf = (attempt: Reported) => {
    const rate = testedSet(asRecord(attempt.data.scored), asRecord(attempt.data.frontier))?.falseRate;
    return isNumber(rate) ? rate : levelOf(attempt);
  };
  const controls = read.filter(({ able }) => able).length;
  const sliceCount = (slice: "validity" | "objective"): ControlSlice => {
    const own = read.filter((one) => one.slice === slice);
    return {
      controls: own.filter(({ able }) => able).length,
      errors: own.filter(({ step }) => step).length,
    };
  };
  const rates = attempts.map(rateOf);
  return {
    attempts: attempts.length,
    errors: read.filter(({ step }) => step).length,
    either: read.filter(({ either }) => either).length,
    controls,
    incapable: read.length - controls,
    tied: read.filter(({ tied }) => tied).length,
    byMeasure: { validity: sliceCount("validity"), objective: sliceCount("objective") },
    union: Math.min(
      1,
      rates.reduce((sum, rate) => sum + rate, 0),
    ),
  };
}

const tallyText = ({ wins, losses, ties }: Tally) =>
  `${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied`;

/** Format the starter-comparison clause for an epoch summary line (empty in epoch 1). When `read`
 *  is provided, reports tasks written after the promotion separately from the pooled tally. */
function starterClause({ reference, starter_tally: tally, confirmed }: Epoch, read?: StarterRead): string {
  if (reference === "starter") return "";
  if (tally === null) return ", against the starter unread";
  const step = confirmed === true ? "a step, so its promotion is confirmed" : "no step";
  const afterWriters = new Set(
    read?.rows.filter(({ origin }) => origin === ORIGINS[2]).map(({ writer }) => writer),
  ).size;
  const pooled = `, against the starter ${tallyText(tally)}, ${step}`;
  if (read === undefined) return pooled;
  const unchosenClause = `, on the tasks no step chose ${tallyText(read.unchosen.tally)}, alone ${read.unchosen.read}`;
  if (afterWriters === 0) return `${pooled}${unchosenClause}`;
  // Separate tasks where validity differed from tasks where validity tied so the dominant signal is visible.
  const { whole, validity, rest } = read.origins[ORIGINS[2]];
  return `${pooled}, of which ${tallyText(whole)} (validity differed ${tallyText(validity)}; validity tied ${tallyText(rest)}) on the tasks ${plural(afterWriters, "Examiner session")} wrote after it, alone ${read.after}${unchosenClause}`;
}

/** Summarise the distribution of post-promotion standalone readings across `reads`. */
export const aloneOf = (reads: readonly Pick<StarterRead, "after">[]) =>
  `on the tasks written after alone, ${UNSELECTED.map((one) => `${one} ${String(reads.filter(({ after }) => after === one).length)}`).join(", ")}`;

const tallyOf = (margins: readonly number[]): Tally => {
  const { wins, losses, ties } = testOf(margins);
  return { wins, losses, ties };
};

/** Memoised `pairsReported` over one call's `events`, keyed by report session. */
function pairLookup(events: readonly LogEvent[]): (report: Reported) => Paired[] {
  const seen = new Map<string, Paired[]>();
  return (report) => {
    const found = seen.get(report.session);
    if (found !== undefined) return found;
    const pairs = pairsReported(events, report);
    seen.set(report.session, pairs);
    return pairs;
  };
}

/** Return the set of tasks scored by step-producing comparisons before `from` whose new side
 *  satisfies `stepped`. A step won by the starter as the new side of a starter comparison did not
 *  select any ancestor of the reference. */
function tasksChosenBefore(
  reports: readonly Reported[],
  pairsOf: (report: Reported) => Paired[],
  stepped: (fresh: JsonValue | undefined) => boolean,
  from: number,
) {
  const chose = reports.filter(
    ({ index, data }) => index < from && stepped(data.fresh) && data.reading === "step",
  );
  return new Set(chose.flatMap((report) => pairsOf(report).map(({ task }) => task)));
}

/** Classify reference-oriented scores `ahead` at `level` into an `Unselected` reading. */
export function unselectedOf(ahead: readonly number[], level: number): Unselected {
  const behind = ahead.map((one) => -one);
  if (readsStep(ahead, level)) return "a step";
  if (readsStep(behind, level)) return "a step for the starter";
  return readsStep(ahead.map(Math.abs), level) ? "no step" : "too few";
}

/** Extract all starter reads from `events`, oldest first. */
export function starterReads(events: readonly LogEvent[]): StarterRead[] {
  const reports = lastReports(events);
  return starterReadsFrom(events, reports, epochsFrom(events, reports), pairLookup(events));
}

function starterReadsFrom(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  epochs: readonly Epoch[],
  pairsOf: (report: Reported) => Paired[],
): StarterRead[] {
  const writers = writersOf(events);
  const writerOrder = [...new Set(writers.values())];
  return epochs.flatMap((epoch, nth) => {
    const report = reports.find(({ session }) => session === epoch.starter_read);
    const fresh = report?.data.fresh;
    if (report === undefined || epoch.starter_tally === null || !isString(fresh)) return [];
    const at = levelOf(report);
    const chosen = tasksChosenBefore(reports, pairsOf, (side) => side === epoch.reference, epoch.from);
    const anyChosen = tasksChosenBefore(reports, pairsOf, (side) => side !== fresh, epoch.from);
    const writtenEarlier = new Set(epochs.slice(0, nth).flatMap(({ tasks }) => tasks));
    const scored = pairsOf(report).map((pair) => {
      const { validity, objective } = pointsOf(pair);
      const origin = chosen.has(pair.task)
        ? ORIGINS[0]
        : writtenEarlier.has(pair.task)
          ? ORIGINS[1]
          : ORIGINS[2];
      return {
        row: {
          task: pair.task,
          origin,
          writer: writers.get(pair.task) ?? OPENING,
          margin: -wholePoints(validity + objective),
          pair,
        },
        validity: validity !== 0,
      };
    });
    const margins = (list: typeof scored) => list.map(({ row }) => row.margin);
    const splitOf = (origin: Origin): Split => {
      const own = scored.filter(({ row }) => row.origin === origin);
      return {
        whole: tallyOf(margins(own)),
        validity: tallyOf(margins(own.filter(({ validity }) => validity))),
        rest: tallyOf(margins(own.filter(({ validity }) => !validity))),
      };
    };
    const byWriter = Map.groupBy(scored, ({ row }) => writers.get(row.task));
    const authors = writerOrder.flatMap((session) => {
      const own = byWriter.get(session);
      return own === undefined ? [] : [{ session, tally: tallyOf(margins(own)) }];
    });
    const unchosen = margins(scored.filter(({ row }) => !anyChosen.has(row.task)));
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
        authors,
        after: unselectedOf(margins(scored.filter(({ row }) => row.origin === ORIGINS[2])), at),
        unchosen: { tally: tallyOf(unchosen), read: unselectedOf(unchosen, at) },
        levelled: isNumber(report.data.level),
        rows: scored.map(({ row }) => row),
        key: `${epoch.reference}|${fresh}|${scored
          .map(({ row }) => row.task)
          .toSorted()
          .join(",")}`,
      },
    ];
  });
}

/** Format a single summary line for an epoch, using `called` to render harness identifiers and
 *  attaching post-promotion breakdowns from `reads` when available. */
export function epochLine(epoch: Epoch, called: Called = short, reads: readonly StarterRead[] = []): string {
  const reference = epoch.reference === "starter" ? "starter" : called(epoch.reference);
  const readings = epoch.comparisons.map(({ id, reading }) => `${id} ${reading}`).join(", ") || "none";
  // The first promotion over the Starter is treated as setup (epoch 0); climb rungs count from there.
  const rung = epoch.nth === 1 ? "as setup (epoch 0)" : `as rung ${String(epoch.nth - 1)} of the climb`;
  const end = epoch.promoted === null ? "open" : `promoted ${called(epoch.promoted)} ${rung}`;
  const risk = epoch.falsePromotion;
  return `epoch ${String(epoch.nth)}: reference ${reference}; ${String(epoch.tasks.length)} tasks admitted; ${plural(epoch.sessions, "Builder session")}; comparisons ${readings}${starterClause(
    epoch,
    reads.find(({ session }) => session === epoch.starter_read),
  )}; ${plural(risk.attempts, ATTEMPT)} under this reference, estimated false-promotion risk ${percent(risk.union)}; ${controlsClause(risk)}; ${end}`;
}

/** Format a probability as a percentage: whole percent at or above 10%, one decimal place below
 *  10%, and `"under 0.1%"` for small positive values so non-zero risk never displays as zero. */
function percent(chance: number): string {
  if (chance === 0) return "0%";
  if (chance < 0.001) return "under 0.1%";
  return chance < 0.1 ? `${(100 * chance).toFixed(1)}%` : `${String(Math.round(100 * chance))}%`;
}

/** Format the empirical A/A control summary accompanying a false-promotion estimate. */
function controlsClause(risk: FalsePromotion): string {
  const comparisons =
    risk.controls === 0
      ? "no powered A/A control"
      : `${String(risk.errors)} of ${plural(risk.controls, "powered A/A control")} triggered a false positive (${String(risk.either)} two-sided)`;
  const tied =
    risk.tied === 0 ? "" : `, ${String(risk.tied)} of them tied on every task (zero reference variance)`;
  const incapable =
    risk.incapable === 0 ? "" : `, plus ${String(risk.incapable)} underpowered at alpha${tied}`;
  return `${comparisons}${incapable}`;
}

/**
 * Format campaign-level false-promotion risk lines for the closing report: each epoch's summed
 * estimate and its A/A controls, followed by the campaign-wide sum capped at 1. Because each
 * epoch's sum resets on promotion, no single epoch represents the full campaign. The rule-of-three
 * illustration assumes independent trials with a shared binomial rate
 * (https://doi.org/10.1111/j.1751-5823.2009.00078.x), which the log does not establish.
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
      return `- Epoch ${String(nth)}: ${attempts}, estimated false-promotion risk ${percent(risk.union)}; ${controlsClause(risk)}.`;
    }),
    `Campaign-wide estimated false-promotion risk across all epochs: ${percent(total)} (sum of per-epoch estimates capped at 100%, assuming no independence between attempts; an estimate rather than a formal bound).`,
    "The permutation test assumes each untied task is equally likely to favour either arm under the null; solver drift can violate exchangeability. A/A controls provide an empirical check: each false positive signals noise, although a single event does not establish miscalibration. With 0 false positives in n independent comparisons sharing a common rate, the approximate 95% upper confidence limit is 3/n (the log does not establish those assumptions). These estimates cover recorded attempts only; additional attempts increase cumulative risk.",
  ];
}

/** Compute an epoch's cost against `BARS`, optionally adding `pending` unreported attempts. */
function costOf(events: readonly LogEvent[], epoch: Epoch, pending = 0): Worth["cost"] {
  const attempts = epoch.falsePromotion.attempts + pending;
  const dollars = billedBetween(events, epoch.from, epoch.to ?? undefined);
  return { attempts, sessions: epoch.sessions, dollars, met: epoch.nth === 1 || attempts <= BARS.cost };
}

/** Evaluate what comparison `id` would cost if it reads a step: the current epoch's cost with `id`
 *  counted as one additional attempt. Evaluated on the log prior to `id`'s report so repeated
 *  readings are idempotent. */
export function worthOf(events: readonly LogEvent[], id: string): Worth {
  const before = events.filter(({ kind, data }) => kind !== "comparison.reported" || data.session !== id);
  const last = epochsOf(before).at(-1);
  // `epochStarts` always opens a log with epoch 1, so an empty result indicates a broken reader.
  if (last === undefined) throw new Error("epochsOf read no epoch from the log");
  return { cost: costOf(before, last, 1) };
}

/** Map each promoted harness digest to the cost of the epoch closed by its promotion. */
export function promotionsWorth(events: readonly LogEvent[]): ReadonlyMap<string, Worth> {
  return new Map(
    epochsOf(events).flatMap((epoch) =>
      epoch.promoted === null ? [] : [[epoch.promoted, { cost: costOf(events, epoch) }] as const],
    ),
  );
}

/** Format a single-line summary of promotion cost against `BARS` (descriptive only). */
export function worthLine({ cost }: Worth): string {
  return `cost (observational only): ${plural(cost.attempts, ATTEMPT)} this epoch (threshold ${String(BARS.cost)} after setup): ${cost.met ? "within threshold" : "exceeded"}, across ${plural(cost.sessions, "Builder session")} and $${cost.dollars.toFixed(2)} billed`;
}

/**
 * Format operator-facing summary lines comparing the campaign against the climb milestone and
 * economy bar, printed by the closing report and `runs view`. Reports confirmed promotions
 * (together with their post-promotion standalone readings, since a pooled confirmation can mask
 * flat performance on fresh tasks), post-milestone A/A controls, and any epochs exceeding the
 * attempt bar. Strictly observational.
 */
export function barLines(events: readonly LogEvent[]): string[] {
  const reports = lastReports(events);
  const controls = controlsIn(reports);
  const epochs = epochsFrom(events, reports, controls);
  const pairsOf = pairLookup(events);
  const climbed = epochs.filter(({ nth, reverted }) => nth > 1 && reverted !== true);
  const confirmed = climbed.filter((epoch) => epoch.confirmed === true);
  const unread = climbed.filter(({ starter_tally: tally }) => tally === null).length;
  const confirmedSessions = new Set(confirmed.map((epoch) => epoch.starter_read));
  const confirmedReads = starterReadsFrom(events, reports, epochs, pairsOf).filter(({ session }) =>
    confirmedSessions.has(session),
  );
  const overBar = climbed.flatMap((epoch) => {
    const cost = costOf(events, epoch);
    const open = epoch.promoted === null ? ", open" : "";
    return cost.met ? [] : [`epoch ${String(epoch.nth)} at ${String(cost.attempts)}${open}`];
  });
  return [
    `- Climb: ${plural(climbed.length, "promotion")}, ${String(confirmed.length)} confirmed (milestone: ${String(MILESTONE.promotions)})${confirmedReads.length === 0 ? "" : ` (${aloneOf(confirmedReads)})`}; ${String(climbed.length - confirmed.length - unread)} failed starter confirmation, ${String(unread)} pending confirmation.`,
    honestyLine(controls, epochs[MILESTONE.promotions]?.from),
    `- Economy: ${plural(climbed.length, "post-setup epoch")} against a threshold of ${plural(BARS.cost, ATTEMPT)} each, ${String(overBar.length)} exceeded${overBar.length === 0 ? "" : `: ${overBar.join("; ")}`}. Observational only.`,
    starterNoiseLine(events, reports),
    repeatLine(reports, pairsOf),
  ];
}

function repeatLine(reports: readonly Reported[], pairsOf: (report: Reported) => Paired[]): string {
  const allSame = (values: readonly boolean[]) => values.every((value) => value === values[0]);
  const read = reports.flatMap((report) => {
    const pairs = pairsOf(report);
    if (pairs.length === 0 || !pairs.every((pair) => allSame(pair.old) && allSame(pair.fresh))) return [];
    const measured = pairs.every((pair) => !gapAgainst(pair, "old", []) && !gapAgainst(pair, "fresh", []));
    return [{ session: report.session, measured }];
  });
  const fullyRepeated = read.filter(({ measured }) => measured).map(({ session }) => session);
  const named =
    fullyRepeated.length === 0 ? "" : ` (${fullyRepeated.join(", ")}, zero split-arm variance on either arm)`;
  return `- Rollout consistency: in ${plural(read.length, "comparison")} both arms had uniform validity across all rollouts per task, and in ${String(fullyRepeated.length)} uniform objective scores as well${named}. Observational only.`;
}

/** Format a suffix noting how many A/A controls tied on every task, or an empty string if none did. */
function tiedClause(controls: readonly { readonly tied: boolean }[], of: string): string {
  const tied = controls.filter((control) => control.tied).length;
  return tied === 0
    ? ""
    : ` ${String(tied)} of ${of} tied every task (identical reference outcomes across rollouts, unpowered).`;
}

/** Summarise A/A controls reported after log index `sixth` (the sixth promotion). Capable vs
 *  incapable controls and one-sided vs two-sided steps are kept separate for operator judgement. */
function honestyLine(all: readonly ReturnType<typeof controlOf>[], sixth: number | undefined): string {
  const named = `promotion ${String(MILESTONE.promotions)}`;
  const target = String(MILESTONE.controls);
  if (sixth === undefined) {
    const so = tiedClause(all, `${plural(all.length, "A/A control")} so far`);
    const counted = all.length === 0 ? "" : ` To date: ${controlCounts(all)}.`;
    return `- Honesty: ${named} not yet reached (target: ${target} post-milestone A/A controls).${counted}${so}`;
  }
  const after = all.filter(({ index }) => index > sixth);
  return `- Honesty: after ${named}, ${plural(after.length, "A/A control")} against target ${target}; ${controlCounts(after)}.${tiedClause(after, "them")}`;
}

/** Format counts of powered A/A controls and one-sided / two-sided false positives. */
function controlCounts(controls: readonly ReturnType<typeof controlOf>[]): string {
  const able = controls.filter((control) => control.able).length;
  const steps = controls.filter(({ step }) => step).length;
  const either = controls.filter((control) => control.either).length;
  return `${plural(able, "powered A/A control")}: ${String(steps)} one-sided, ${String(either)} two-sided false positives`;
}

/**
 * Evaluate the starter harness against itself across starter comparisons by splitting the starter's
 * own solves in half (`pairsReported`), mirroring the reference A/A control. This measures the
 * noise floor of the baseline harness against which promotions are confirmed, reusing already-paid
 * solves. Strictly observational and excluded from the honesty bar.
 */
function starterNoiseLine(events: readonly LogEvent[], reports: readonly Reported[]): string {
  const starter = starterIn(events);
  const read = reports.flatMap((report) => {
    if (starter === null || report.data.fresh !== starter || report.data.old === starter) return [];
    const pairs = pairsReported(events, report, "fresh");
    return pairs.length === 0
      ? []
      : [controlOf(report.index, levelOf(report), pairs.map(differenceOf), measureSliceOf(report.data))];
  });
  const head = "- Baseline A/A control:";
  if (read.length === 0) {
    return `${head} no split-arm starter comparison recorded yet. Observational only.`;
  }
  const tied = read.filter((control) => control.tied).length;
  return `${head} ${plural(read.length, "split-arm starter comparison")}, ${controlCounts(read)}, ${String(tied)} tied every task. Observational only, excluded from honesty bar.`;
}
