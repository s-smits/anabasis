import {
  differenceOf,
  gapAgainst,
  judgeIn,
  type Paired,
  pointsOf,
  upperBound,
  isSignificant,
  isSignificantTwoSided,
  scoresIn,
  type Tally,
  testedSet,
  testOf,
  wholePoints,
} from "../kernel/compare.ts";
import { OPENING, writersOf } from "../kernel/history.ts";
import { eventsOf, isReferenceChange, type LogEvent } from "../kernel/log.ts";
import { lastReports, pairsReported, type Reported } from "../kernel/reports.ts";
import { billedBetween } from "../kernel/meter.ts";
import { heldAtGate } from "../kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keysIf } from "../meta/optional-key.ts";
import { plural, tallyText } from "../meta/text.ts";
import { short } from "./move.ts";
import type { Called } from "./names.ts";
import { openingOf } from "./opening.ts";

interface ControlSlice {
  readonly controls: number;
  readonly errors: number;
}

interface FalsePromotion {
  readonly attempts: number;
  readonly errors: number;
  readonly either: number;
  readonly controls: number;
  readonly incapable: number;
  readonly tied: number;
  readonly byMeasure: Readonly<Record<"validity" | "objective", ControlSlice>>;
  readonly levels: readonly number[];
  readonly union: number;
}

export interface Epoch {
  readonly nth: number;
  readonly reference: string;
  readonly from: number;
  readonly to: number | null;
  readonly promoted: string | null;
  readonly tasks: readonly string[];
  readonly sessions: number;
  readonly comparisons: readonly { readonly id: string; readonly reading: string }[];
  readonly starter_tally: Tally | null;
  readonly starter_read: string | null;
  readonly confirmed: boolean | null;
  readonly reverted?: boolean;
  readonly falsePromotion: FalsePromotion;
}

const ATTEMPT = "promotion attempt";

const MILESTONE = { promotions: 6 } as const;

export const ORIGINS = ["read at the promotion", "written before, not chosen on", "written after"] as const;
export type Origin = (typeof ORIGINS)[number];

export interface Split {
  readonly whole: Tally;
  readonly validity: Tally;
  readonly rest: Tally;
}

export const UNSELECTED = ["a step", "a step for the starter", "no step", "too few"] as const;
type Unselected = (typeof UNSELECTED)[number];

interface StarterRow {
  readonly task: string;
  readonly origin: Origin;
  readonly writer: string;
  readonly margin: number;
  readonly pair: Paired;
}

export interface StarterRead {
  readonly session: string;
  readonly reference: string;
  readonly starter: string;
  readonly stored: Tally;
  readonly confirmed: boolean;
  readonly level: number;
  readonly origins: Readonly<Record<Origin, Split>>;
  readonly authors: readonly { readonly session: string; readonly tally: Tally }[];
  readonly after: Unselected;
  readonly unchosen: { readonly tally: Tally; readonly read: Unselected };
  readonly levelled: boolean;
  readonly rows: readonly StarterRow[];
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

export const tasksByEpoch = (events: readonly LogEvent[]): string[][] => epochSlices(events).tasks;

export function starterIn(events: readonly LogEvent[]): string | null {
  const named = events.find(({ kind }) => kind === "comparison.started")?.data.starter;
  return isString(named) ? named : null;
}

export const epochsOf = (events: readonly LogEvent[]): Epoch[] => epochsFrom(events, lastReports(events));

function epochsFrom(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  controls = controlsIn(reports, starterSplits(events, reports).bySession),
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
        ? { starter_tally: null, starter_read: null, confirmed: true }
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

function againstStarter(
  reports: readonly Reported[],
  reference: string | null,
  starter: string | null,
): Pick<Epoch, "starter_tally" | "starter_read" | "confirmed"> {
  if (reference === null) {
    return { starter_tally: null, starter_read: null, confirmed: null };
  }
  const first = reports.find(
    ({ data }) =>
      data.old === reference &&
      data.fresh === starter &&
      data.reading !== "not-scored" &&
      asRecord(data.scored) !== null,
  );
  if (first === undefined) {
    return { starter_tally: null, starter_read: null, confirmed: false };
  }
  const ahead = scoresIn(first.data.scored).map((one) => -one);
  const { wins, losses, ties } = testOf(ahead);
  const level = levelOf(first);
  return {
    starter_tally: { wins, losses, ties },
    starter_read: first.session,
    confirmed: isSignificant(ahead, level),
  };
}

function measureSliceOf(data: JsonObject, noise?: JsonObject): "validity" | "objective" {
  if (isNumber(noise?.flips)) return noise.flips > 0 ? "validity" : "objective";
  const counts = asRecord(data.valid)?.old;
  return Array.isArray(counts) && counts.slice(1, -1).some((count) => isNumber(count) && count > 0)
    ? "validity"
    : "objective";
}

function controlOf(index: number, level: number, scores: readonly number[], slice: "validity" | "objective") {
  const able = isSignificant(scores.map(Math.abs), level);
  const tied = scores.length > 0 && scores.every((one) => one === 0);
  return {
    index,
    level,
    scores,
    slice,
    able,
    tied,
    step: isSignificant(scores, level),
    either: isSignificantTwoSided(scores, level),
  };
}

function starterSplits(events: readonly LogEvent[], reports: readonly Reported[]) {
  const starter = starterIn(events);
  const judged = new Set(
    eventsOf(events, "comparison.started").flatMap(({ event: { data } }) =>
      judgeIn(data) === undefined ? [] : [data.session],
    ),
  );
  const reads = reports.filter(
    ({ data }) => starter !== null && data.fresh === starter && data.old !== starter,
  );
  const bySession = new Map(
    reads.flatMap((report) => {
      const pairs = judged.has(report.session) ? [] : pairsReported(events, report, "fresh");
      const flips = pairs.some(({ old, fresh }) => new Set([...old, ...fresh]).size > 1);
      const slice = flips ? "validity" : "objective";
      const control = controlOf(report.index, levelOf(report), pairs.map(differenceOf), slice);
      return pairs.length === 0 ? [] : [[report.session, control] as const];
    }),
  );
  return { bySession, judgedCount: reads.filter(({ session }) => judged.has(session)).length };
}

function controlsIn(reports: readonly Reported[], splits: ReadonlyMap<string, ReturnType<typeof controlOf>>) {
  return reports.flatMap((each) => {
    const noise = asRecord(each.data.noise);
    if (!Array.isArray(noise?.differences)) return [];
    const own = controlOf(each.index, levelOf(each), scoresIn(noise), measureSliceOf(each.data, noise));
    const fallback = own.able ? undefined : splits.get(each.session);
    return [fallback?.able === true ? fallback : own];
  });
}

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
    levels: [...new Set(read.filter(({ able }) => able).map(({ level }) => level))],
    union: Math.min(
      1,
      rates.reduce((sum, rate) => sum + rate, 0),
    ),
  };
}

function starterClause({ reference, starter_tally: tally, confirmed }: Epoch, read?: StarterRead): string {
  if (reference === "starter") return "";
  if (tally === null) return ", waiting for Starter Pack check";
  const step = confirmed === true ? "confirmed against Starter Pack" : "no step";
  const afterWriters = new Set(
    read?.rows.filter(({ origin }) => origin === ORIGINS[2]).map(({ writer }) => writer),
  ).size;
  const pooled = `, vs Starter Pack ${tallyText(tally)} (${step})`;
  if (read === undefined) return pooled;
  const unchosenClause = `, on unseen tasks ${tallyText(read.unchosen.tally)} (${read.unchosen.read})`;
  if (afterWriters === 0) return `${pooled}${unchosenClause}`;
  const { whole, validity, rest } = read.origins[ORIGINS[2]];
  return `${pooled}, including ${tallyText(whole)} (validity differed ${tallyText(validity)}; validity tied ${tallyText(rest)}) on fresh post-promotion tasks from ${plural(afterWriters, "Examiner session")} (${read.after})${unchosenClause}`;
}

export const aloneOf = (reads: readonly Pick<StarterRead, "after">[]) =>
  `fresh post-promotion tasks alone: ${UNSELECTED.map((one) => `${one} ${String(reads.filter(({ after }) => after === one).length)}`).join(", ")}`;

const tallyOf = (margins: readonly number[]): Tally => {
  const { wins, losses, ties } = testOf(margins);
  return { wins, losses, ties };
};

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

export function chosenForReference(events: readonly LogEvent[], fresh: string): ReadonlySet<string> {
  const starter = starterIn(events);
  if (starter !== fresh) return new Set();
  const from = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  return tasksChosenBefore(lastReports(events), pairLookup(events), (side) => side !== starter, from);
}

export function unselectedOf(ahead: readonly number[], level: number): Unselected {
  const behind = ahead.map((one) => -one);
  if (isSignificant(ahead, level)) return "a step";
  if (isSignificant(behind, level)) return "a step for the starter";
  return isSignificant(ahead.map(Math.abs), level) ? "no step" : "too few";
}

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

export function epochLine(epoch: Epoch, called: Called = short, reads: readonly StarterRead[] = []): string {
  const reference = epoch.reference === "starter" ? "starter" : called(epoch.reference);
  const readings = epoch.comparisons.map(({ id, reading }) => `${id} ${reading}`).join(", ") || "none";
  const rung = epoch.nth === 1 ? "as setup (epoch 0)" : `as rung ${String(epoch.nth - 1)} of the climb`;
  const end = epoch.promoted === null ? "open" : `promoted ${called(epoch.promoted)} ${rung}`;
  const risk = epoch.falsePromotion;
  return `epoch ${String(epoch.nth)}: reference ${reference}; ${String(epoch.tasks.length)} tasks admitted; ${plural(epoch.sessions, "Builder session")}; comparisons ${readings}${starterClause(
    epoch,
    reads.find(({ session }) => session === epoch.starter_read),
  )}; ${plural(risk.attempts, ATTEMPT)} under this reference, estimated false-promotion risk ${percent(risk.union)}; ${controlsClause(risk)}; ${end}`;
}

function percent(chance: number): string {
  if (chance === 0) return "0%";
  if (chance < 0.001) return "under 0.1%";
  return chance < 0.1 ? `${(100 * chance).toFixed(1)}%` : `${String(Math.round(100 * chance))}%`;
}

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

export function riskLines(events: readonly LogEvent[]): string[] {
  const epochs = epochsOf(events);
  const opening = openingOf(events);
  const carried = opening?.parent?.carried.attempts ?? 0;
  const level = Number(opening?.terms.level ?? 0.02);
  const carriedRisk = Number.isFinite(level) ? carried * level : 0;
  const total = Math.min(
    1,
    carriedRisk + epochs.reduce((sum, { falsePromotion }) => sum + falsePromotion.union, 0),
  );
  return [
    ...epochs.map(({ nth, falsePromotion: risk }) => {
      const attempts = plural(risk.attempts, ATTEMPT);
      return `- Epoch ${String(nth)}: ${attempts}, estimated false-promotion risk ${percent(risk.union)}; ${controlsClause(risk)}.`;
    }),
    ...(carried > 0
      ? [`- Carried from parent lineage: ${plural(carried, `prior ${ATTEMPT}`)} before exam revision.`]
      : []),
    `Campaign-wide estimated false-promotion risk across all epochs: ${percent(total)} (sum of per-epoch estimates capped at 100%, assuming no independence between attempts; an estimate rather than a formal bound).`,
    "The permutation test assumes each untied task is equally likely to favour either arm under the null; solver drift can violate exchangeability. A/A controls provide an empirical check: each false positive signals noise, although a single event does not establish miscalibration. With 0 false positives in n independent comparisons sharing a common rate, the approximate 95% upper confidence limit is 3/n (the log does not establish those assumptions). These estimates cover recorded attempts only; additional attempts increase cumulative risk.",
  ];
}

export function promotionCosts(events: readonly LogEvent[]): ReadonlyMap<string, string> {
  return new Map(
    epochsOf(events).flatMap((epoch) => {
      if (epoch.promoted === null) return [];
      const dollars = billedBetween(events, epoch.from, epoch.to ?? undefined);
      return [
        [
          epoch.promoted,
          `cost: ${plural(epoch.falsePromotion.attempts, ATTEMPT)} this epoch, across ${plural(epoch.sessions, "Builder session")} and $${dollars.toFixed(2)} billed`,
        ] as const,
      ];
    }),
  );
}

export function barLines(events: readonly LogEvent[]): string[] {
  const reports = lastReports(events);
  const splits = starterSplits(events, reports);
  const controls = controlsIn(reports, splits.bySession);
  const epochs = epochsFrom(events, reports, controls);
  const pairsOf = pairLookup(events);
  const climbed = epochs.filter(({ nth, reverted }) => nth > 1 && reverted !== true);
  const reverts = epochs.filter(({ reverted }) => reverted === true).length;
  const confirmed = climbed.filter((epoch) => epoch.confirmed === true);
  const unread = climbed.filter(({ starter_tally: tally }) => tally === null).length;
  const confirmedSessions = new Set(confirmed.map((epoch) => epoch.starter_read));
  const confirmedReads = starterReadsFrom(events, reports, epochs, pairsOf).filter(({ session }) =>
    confirmedSessions.has(session),
  );
  const tied = controls.filter((control) => control.tied).length;
  const fallbacks = new Set(splits.bySession.values());
  const substituted = controls.filter((control) => fallbacks.has(control)).length;
  const fallbackNote =
    substituted === 0
      ? ""
      : ` (${plural(substituted, "starter split-arm fallback")} where reference was unpowered)`;
  const tiedNote =
    tied === 0
      ? ""
      : ` ${String(tied)} of them tied every task (identical reference outcomes across rollouts, unpowered).`;
  return [
    `- Climb: ${plural(climbed.length, "promotion")}${reverts === 0 ? "" : ` (${plural(reverts, "revert")})`}, ${String(confirmed.length)} confirmed (milestone: ${String(MILESTONE.promotions)})${confirmedReads.length === 0 ? "" : ` (${aloneOf(confirmedReads)})`}; ${String(climbed.length - confirmed.length - unread)} failed Starter Pack check, ${String(unread)} awaiting Starter Pack check.`,
    `- Honesty: ${plural(controls.length, "A/A control")}; ${controlCounts(controls)}${fallbackNote}.${tiedNote} Observational; the bar pools a release's.`,
    starterNoiseLine([...splits.bySession.values()], splits.judgedCount),
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

function controlCounts(controls: readonly ReturnType<typeof controlOf>[]): string {
  const able = controls.filter((control) => control.able).length;
  const steps = controls.filter(({ step }) => step).length;
  const either = controls.filter((control) => control.either).length;
  return `${plural(able, "powered A/A control")}: ${String(steps)} one-sided (95% bound ${percent(upperBound(steps, able))}), ${String(either)} two-sided false positives`;
}

function starterNoiseLine(read: readonly ReturnType<typeof controlOf>[], judgedCount: number): string {
  const head = "- Baseline A/A control:";
  const judgedNote =
    judgedCount === 0
      ? ""
      : `${plural(judgedCount, "judged starter comparison")} excluded (no starter split-arm judge votes)`;
  if (read.length === 0) {
    return `${head} ${judgedNote || "no split-arm starter comparison recorded yet"}. Observational only.`;
  }
  const tied = read.filter((control) => control.tied).length;
  return `${head} ${plural(read.length, "split-arm starter comparison")}, ${controlCounts(read)}, ${String(tied)} tied every task${judgedNote === "" ? "" : `; ${judgedNote}`}. Used by honesty where the reference A/A is unpowered; observational otherwise.`;
}
