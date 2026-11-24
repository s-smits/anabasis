/**
 * One reading of a campaign's log: what each step handed over.
 */
import { type Measures, pointsOf, scoresIn, type Tally, testOf } from "../kernel/compare.ts";
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import { INTERRUPTED, lastReports, latestBuilt, pairsReported, promoted } from "../kernel/reports.ts";
import { ownedBy, ownersOf, traceKind, unfinished as openMetered } from "../kernel/trace.ts";
import { billedAll, billedParts } from "../kernel/meter.ts";
import {
  ended,
  passed,
  practiceRan,
  type Ran,
  rejectionAside,
  rulingsOf,
  solvesIn,
  standsOf,
} from "../kernel/solves.ts";
import { admissionsOf, taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { type Supply, supplyOf } from "./admission.ts";
import type { Ruling } from "../referee/referee.ts";
import { fixedIn, overlapOf, reported, STARTED } from "./comparison.ts";

/** A failed practice solve, and where it stands now by the task's later solves. */
export interface PracticeFail {
  readonly solve: string;
  /** The task's version. */
  readonly task: string;
  readonly harness: string;
  readonly kind: string | null;
  /** Open; passed once or repaired under a later harness; or failing again under one. */
  readonly standing: "open" | "passed-once" | "repaired" | "failing-again";
  /** The later harness the standing rests on; null while it is open. */
  readonly under: string | null;
}

/** What the log holds of a session however it stands: its model turns and when it last wrote; and,
 *  where it has no end, whether the campaign went past it. */
interface SoFar {
  /** How it ended; null while it is open, or where it was cut. */
  readonly ended: string | null;
  /** It has no end, and the campaign went past it (`soFar`). */
  readonly cut: boolean;
  readonly turns: number;
  /** When it last wrote an event of its own. */
  readonly last: string;
}

/** What an Examiner session handed over, or has so far. */
interface Examined extends SoFar {
  readonly step: "examiner";
  readonly id: string;
  readonly proposed: number;
  readonly held: number;
  readonly refused: number;
  readonly billed: number;
}

/** What a Builder session handed over, or has so far. */
interface Built extends SoFar {
  readonly step: "builder";
  readonly id: string;
  readonly parent: string | null;
  readonly harness: string | null;
  /** On an interrupted session that saved edits past its last handover, the digest kept in `states/`. */
  readonly unfinished: string | null;
  readonly changed: boolean;
  readonly practiceSolves: number;
  /** Where its window ends in the log, for a reader of what ran inside it (`soFar`). */
  readonly until: number;
  /** Its established practice failures: only earned rejections count. */
  readonly fails: number;
  /** Its own turns, its practice solves and their reviewers. */
  readonly billed: number;
}

/** What a comparison handed over. `reading` is null until it has reported. */
interface Compared {
  readonly step: "comparison";
  readonly id: string;
  readonly old: string;
  readonly fresh: string;
  readonly tasks: number;
  readonly solves: number;
  readonly level: number;
  readonly cap: number | null;
  /** The model's turns each of its solves was told and held to, by the setting on record when it
   *  began, or by its first solve where the log holds no record of the setting; null where the
   *  turns were not limited. A changed limit is another setting, and no tally is read across two. */
  readonly modelTurns: number | null;
  readonly reading: string | null;
  /** The tally the step is read on: the scores without the bill where a report holds them
   *  (`scoresIn`), and otherwise the report's own tally, since the oldest reports hold no scores. */
  readonly tally: Tally | null;
  /** How many of its tallied tasks the two harnesses' validity differed on (`pointsOf`), as the
   *  starter read splits a tally (`starterReads`, `climb.ts`); null where nothing was tallied, or
   *  where the report's pairs cannot be read again (`pairsReported`). */
  readonly validity: number | null;
  /** Each harness by itself: the tasks with no, one, two... valid answers among its solves. */
  readonly valid: { readonly old: readonly number[]; readonly fresh: readonly number[] } | null;
  /** The points each measure gave the tallied tasks together (`pointsOf`); null where nothing was
   *  tallied, and in older reports. */
  readonly points: Measures | null;
  /** The tasks set aside for a person's labels. */
  readonly aside: number;
  /** The frontier's tallied tasks and how many its largest family holds (siblings are no fresh draws). */
  readonly grain: { readonly largest: number; readonly of: number } | null;
  /** The comparison of its kind before it and how many of its tasks that one drew too (`overlapOf`). */
  readonly repeat: { readonly with: string; readonly tasks: number } | null;
  /** The Referee's last ruling of each of its rejected answers, by kind. */
  readonly rulings: Readonly<Record<Ruling, number>>;
  /** Its solves and their rulings, without the session a round ran before it. */
  readonly billed: number;
  /** It has no report, and the campaign went past it (`nextBound`). */
  readonly cut: boolean;
  /** Its solves that began, and those of them that ended. */
  readonly begun: number;
  readonly solved: number;
}

export type Handover = Examined | Built | Compared;

/** A campaign as its log reads. */
export interface Campaign {
  /** The set-up: the task sets, the checker's reading and the stop rule, as the admission reads
   *  them for a comparison with the reference harness. */
  readonly supply: Supply;
  /** The harness last promoted, null while the reference is the starter; and the one the last
   *  whole Builder session left, null while none has left one. */
  readonly reference: string | null;
  readonly latest: string | null;
  /** Every step, in the order they started. */
  readonly steps: readonly Handover[];
  /** Every failed practice solve on a task that is still released, in the order they ended. */
  readonly fails: readonly PracticeFail[];
}

type Shared = ReturnType<typeof sharedOf>;

/** Passes running under a later harness that mark a fail repaired: one solve is weak evidence. */
const REPAIRED_AFTER = 2;
/** The events that bound a step: a step's start or its end, and the campaign's end. */
const BOUNDS: ReadonlySet<string> = new Set([
  "exam.started",
  "exam.finished",
  "build.started",
  "build.finished",
  "draft.started",
  "draft.finished",
  STARTED,
  "comparison.reported",
  "campaign.ended",
]);

function sharedOf(events: readonly LogEvent[]) {
  return {
    owners: ownersOf(events),
    open: openMetered(events),
    stands: standsOf(events),
    reports: new Map(lastReports(events).map((report) => [report.session, report])),
    solves: Map.groupBy(solvesIn(events), ({ start }) => start.comparison),
    rulings: rulingsOf(events),
    settings: events.flatMap(({ kind, data }, at) => (kind === "campaign.setting" ? [{ at, data }] : [])),
  };
}

const count = (value: unknown): number => (isNumber(value) ? value : 0);
const listed = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
const text = (value: unknown): string | null => (isString(value) ? value : null);

/** Where a failed solve stands now, by the task's later solves under the last other harness to
 *  solve it. */
function standing(
  fail: Ran & { finished: number },
  later: readonly (Ran & { finished: number })[],
): Pick<PracticeFail, "standing" | "under"> {
  const since = later.filter(
    (solve) => solve.under.task === fail.under.task && solve.finished > fail.finished,
  );
  const last = since.findLast((solve) => solve.under.harness !== fail.under.harness)?.under.harness;
  if (last === undefined) return { standing: "open", under: null };
  const under = since.flatMap((solve) => (solve.under.harness === last ? [passed(solve)] : []));
  if (under.includes(false)) return { standing: "failing-again", under: last };
  return { standing: under.length >= REPAIRED_AFTER ? "repaired" : "passed-once", under: last };
}

/**
 * The place of the first event after `index` that bounds a step, or -1. The campaign command makes
 * one move at a time, so a session, a comparison or a solve that began at `index` and has no end
 * before that place will write none: it was cut. One with no end and no bound after it is open at
 * the log's end: running, or stopped by `bun run runs stop`, which writes no ending.
 */
export function nextBound(events: readonly LogEvent[], index: number): number {
  return events.findIndex((event, at) => at > index && BOUNDS.has(event.kind));
}

/** Session at `index` with turns of kind `seat.turn`, as the log holds it, and its window end. */
function soFar(events: readonly LogEvent[], index: number, seat: "exam" | "build", owners: Shared["owners"]) {
  const id = text(events[index]?.data.session) ?? "";
  const own = ({ kind, data }: LogEvent) => kind.startsWith(`${seat}.`) && data.session === id;
  const closed = events.findIndex(
    (event, at) => at > index && own(event) && event.kind === `${seat}.finished`,
  );
  const past = events.findIndex(
    ({ kind }, at) => at > index && (kind === `${seat}.started` || kind === "campaign.ended"),
  );
  const until = [closed, past, events.length].find((at) => at !== -1) ?? events.length;
  const window = events.slice(index, closed === -1 ? until : closed + 1);
  const read: SoFar = {
    ended: closed === -1 ? null : text(events[closed]?.data.ended),
    cut: closed === -1 && past !== -1,
    turns: window.filter((event) => own(event) && event.kind === traceKind(seat, "turn")).length,
    last: window.findLast(own)?.at ?? "",
  };
  const billed = closed === -1 ? billedAll(window.filter(ownedBy(events, id, owners))) : 0;
  return { read, closed, until, window, billed };
}

/** Every failed practice solve on a released task, each with where it stands, and its start index. */
function practiceFails(events: readonly LogEvent[], practised: readonly Ran[], shared: Shared) {
  const released = new Set(taskSets(events).released);
  const practice = ended(practised.filter(({ under }) => released.has(under.task))).filter(
    (solve) => passed(solve) !== null && !rejectionAside(events, solve, shared.stands),
  );
  return practice
    .filter((solve) => passed(solve) === false)
    .map((solve) => ({
      solve: solve.id,
      task: solve.under.task,
      harness: solve.under.harness,
      kind: text(solve.ending?.kind),
      ...standing(solve, practice),
      started: solve.started,
    }));
}

function reportFields(report: ReturnType<typeof reported>) {
  if (report === null) {
    return { reading: null, tally: null, valid: null, points: null, aside: 0, grain: null };
  }
  const { reading, points, aside, valid, families, scored: raw } = report;
  const scored = raw !== null && "unbilled" in raw ? testOf(scoresIn(raw)) : raw;
  const sizes = families && Object.values(families).map(({ frontier: f }) => f.wins + f.losses + f.ties);
  return {
    reading,
    tally: scored && { wins: scored.wins, losses: scored.losses, ties: scored.ties },
    valid: valid && { old: valid.old, fresh: valid.fresh },
    points,
    aside: aside.length,
    grain: sizes && { largest: Math.max(0, ...sizes), of: sizes.reduce((a, b) => a + b, 0) },
  };
}

/** A comparison's handover, from its start and its last report. The oldest logs hold reports and
 *  no starts, and such a comparison's terms are read from its report. */
function compared(events: readonly LogEvent[], id: string, shared: Shared, began: number): Compared {
  const report = reported(events, id);
  const last = shared.reports.get(id);
  const start = events[began]?.data ?? last?.data ?? {};
  const solves = shared.solves.get(id) ?? [];
  const setting = shared.settings.findLast(({ at }) => at < began)?.data;
  const told = setting === undefined ? asRecord(solves[0]?.start.limits)?.modelTurns : setting.modelTurns;
  const dollars = asRecord(start.cap)?.dollars;
  const ruled = (ruling: Ruling) =>
    solves.filter(({ id: solve }) => shared.rulings.get(solve) === ruling).length;
  const pairs = last === undefined ? [] : pairsReported(events, last);
  const fixed = fixedIn(events, id);
  const repeat = fixed === null ? null : overlapOf(events, fixed);
  return {
    step: "comparison",
    id,
    old: text(start.old) ?? "",
    fresh: text(start.fresh) ?? "",
    tasks: Array.isArray(start.tasks) ? start.tasks.length : count(start.tasks),
    solves: count(start.solves),
    level: count(start.level),
    cap: isNumber(dollars) ? dollars : null,
    modelTurns: isNumber(told) ? told : null,
    ...reportFields(report),
    validity: pairs.length === 0 ? null : pairs.filter((pair) => pointsOf(pair).validity !== 0).length,
    repeat: repeat === null ? null : { with: repeat.with, tasks: repeat.tasks.length },
    rulings: { earned: ruled("earned"), "check-defect": ruled("check-defect"), unclear: ruled("unclear") },
    billed: billedParts(events, id, shared.owners, shared.open).comparison,
    // A comparison with no report has a start: a step is a start or a report. Like a session it is
    // cut by its own kind's next start or the campaign's end; an Examiner writes beside it.
    cut:
      report === null &&
      events.some(({ kind }, at) => at > began && (kind === STARTED || kind === "campaign.ended")),
    begun: solves.length,
    solved: ended(solves).length,
  };
}

/** The steps still open at the log's end, by id: a session with no end and a comparison with no
 *  report, that the campaign did not go past. */
export function openSteps(steps: readonly Handover[]): string[] {
  return steps.flatMap((step) => {
    const open = (step.step === "comparison" ? step.reading === null : step.ended === null) && !step.cut;
    return open ? [step.id] : [];
  });
}

/** The reading of a campaign's log: its set-up, every step's handover and its practice fails. */
export function campaignOf(events: readonly LogEvent[]): Campaign {
  const practised = practiceRan(events);
  const shared = sharedOf(events);
  const fails = practiceFails(events, practised, shared);
  const admissions = admissionsOf(events);
  const comparisons = new Set<string>();
  const steps = events.flatMap(({ kind, data }, index): Handover[] => {
    const id = data.session;
    if (!isString(id)) return [];
    if (kind === "exam.started") {
      const { read, closed, window, billed } = soFar(events, index, "exam", shared.owners);
      const end = events[closed]?.data;
      const openCounts = () => {
        const proposed = proposalsOf(window).flatMap(({ session, version }) =>
          session === id ? [version] : [],
        );
        return {
          proposed: proposed.length,
          held: proposed.filter((version) => admissions.get(version) === true).length,
          refused: proposed.filter((version) => admissions.get(version) === false).length,
          billed,
        };
      };
      const counts =
        end === undefined
          ? openCounts()
          : {
              proposed: count(end.proposed),
              held: listed(end.held),
              refused: listed(end.refused),
              billed: count(end.billed) + billedParts(events, id, shared.owners, shared.open).comparison,
            };
      return [{ step: "examiner", id, ...read, ...counts }];
    }
    if (kind === "build.started") {
      const { read, closed, until, window, billed } = soFar(events, index, "build", shared.owners);
      const end = events[closed]?.data;
      const within = ({ started }: { readonly started: number }) => started > index && started < until;
      // A session cut before its end, killed or crashed, left the harness it last froze. Its ending
      // names no harness, or a tree past the checkpoint where no session starts (`latestBuilt`), so
      // the checkpoint is read instead, and a Builder resumed after it is told where that harness
      // came from.
      const frozen = window.findLast(
        (event) => event.kind === "build.checkpoint" && event.data.session === id,
      );
      const interrupted = INTERRUPTED.has(end?.ended);
      const named = interrupted ? null : text(end?.harness);
      const harness = named ?? text(frozen?.data.harness);
      const unfinished = interrupted && end?.changed === true ? text(end?.harness) : null;
      const parent = text(data.parent);
      return [
        {
          step: "builder",
          id,
          ...read,
          parent,
          harness,
          unfinished,
          changed: named === null ? harness !== null && harness !== parent : end?.changed === true,
          // Each attempt of one solve is logged as `<id>-<attempt>`, and the session charged the
          // solve once, so attempts are folded into their solve before counting.
          practiceSolves: isNumber(end?.practiceSolves)
            ? end.practiceSolves
            : new Set(practised.filter(within).map((solve) => solve.id.replace(/-\d+$/u, ""))).size,
          until,
          fails: fails.filter(within).length,
          // An open session's own turns are summed at its end, so until then they are its window's.
          billed: end === undefined ? billed : billedParts(events, id, shared.owners, shared.open).session,
        },
      ];
    }
    // A comparison stands where the log first holds it: at its start, or at its first report. An
    // old ladder's readings were told to no Builder, and are not now (`lastReports`, `reports.ts`).
    if ((kind !== STARTED && kind !== "comparison.reported") || comparisons.has(id) || data.ladder === true) {
      return [];
    }
    comparisons.add(id);
    return [compared(events, id, shared, kind === STARTED ? index : -1)];
  });
  return {
    supply: supplyOf(events),
    reference: promoted(events),
    latest: latestBuilt(events),
    steps,
    fails: fails.map(({ started: _started, ...fail }) => fail),
  };
}
