/**
 * One reading of a campaign's log: what each step handed over.
 *
 * A campaign is a sequence of steps over one log: the set-up, Examiner sessions, Builder sessions
 * and comparisons. Readers of its parts can disagree: v1's Builder was handed one test set
 * through four readers until 21 September, and they disagreed: 20 of 25 in one paragraph and 0 of
 * 5 in the next.
 *
 * So the log is read here once (`campaignOf`), and each reader is a rendering of that reading
 * through its own filter: the operator's view prints it whole (`tools/runs/view.ts`), and the
 * Builder's opening message takes its fails and its tallies from it and nothing else (`past.ts`).
 * A step's handover is what the owner of a campaign needs of it, never its content: counts, a
 * harness's digest, a tally, a reading, a cost. No task is named in one.
 *
 * Nothing here decides or launches anything. The move that comes next is the decision table's
 * (`decide.ts`), which the view prints once beside this reading.
 *
 * A session is read from its own events while it has no end, and from its end once it has one:
 * read from its end alone, an Examiner session still running read "0 proposed, 0 held out" and
 * $0.00 when it had held out seven tasks and metered $8.23. A step with no end is `cut`
 * where the campaign went past it, and open at the log's end otherwise (`nextBound`); an open one
 * may be running or stopped, which the log cannot tell apart, so the view says when it last wrote.
 */
import type { Tally } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { billedAll, billedParts, lastReports, latestBuilt, promoted } from "../kernel/reports.ts";
import { ended, passed, practiceRan, type Ran, solvesIn } from "../kernel/solves.ts";
import { taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { type Supply, supplyOf } from "./admission.ts";
import { STARTED } from "./comparison.ts";

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
  /** It has no end, and the campaign went past it (`nextBound`). */
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
  readonly changed: boolean;
  readonly practiceSolves: number;
  /** Its failed practice solves that count: one ruled a check defect is none. */
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
  readonly tally: Tally | null;
  /** Each harness by itself: the tasks with no, one, two... valid answers among its solves. */
  readonly valid: { readonly old: readonly number[]; readonly fresh: readonly number[] } | null;
  /** The tallied tasks the objective decided, where the comparison fixed one: won or lost where
   *  validity alone would have tied. Null where it fixed none. */
  readonly decided: number | null;
  /** The tasks set aside for a person's labels. */
  readonly aside: number;
  /** The Referee's last ruling of each of its rejected answers, by kind. */
  readonly rulings: Readonly<Record<(typeof RULINGS)[number], number>>;
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

/** Passes running under a later harness that mark a fail repaired: one solve is weak evidence. */
const REPAIRED_AFTER = 2;
const RULINGS = ["earned", "check-defect", "unclear"] as const;
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

/** Session `id`, started at event `index` with turns of kind `seat.turn`, as the log holds it, and
 *  the place in the log its window ends: at its end, else at the next bound, else at the log's end. */
function soFar(events: readonly LogEvent[], index: number, id: string, seat: "exam" | "build") {
  const own = ({ kind, data }: LogEvent) => kind.startsWith(`${seat}.`) && data.session === id;
  const closed = events.findIndex(
    (event, at) => at > index && own(event) && event.kind === `${seat}.finished`,
  );
  const past = nextBound(events, index);
  const until = [closed, past, events.length].find((at) => at !== -1) ?? events.length;
  const window = events.slice(index, closed === -1 ? until : closed + 1);
  const read: SoFar = {
    ended: closed === -1 ? null : text(events[closed]?.data.ended),
    cut: closed === -1 && past !== -1,
    turns: window.filter((event) => own(event) && event.kind === `${seat}.turn`).length,
    last: window.findLast(own)?.at ?? "",
  };
  return { read, closed, until, window };
}

/** Every failed practice solve on a released task, each with where it stands, and the place in the
 *  log its solve started at (`practiceRan`, `src/kernel/solves.ts`). */
function practiceFails(events: readonly LogEvent[]): (PracticeFail & { readonly started: number })[] {
  const released = new Set(taskSets(events).released);
  const practice = ended(practiceRan(events).filter(({ under }) => released.has(under.task))).filter(
    (solve) => passed(solve) !== null,
  );
  const last = (kind: string, solve: string) =>
    events.findLast((event) => event.kind === kind && event.data.solve === solve)?.data;
  return practice.flatMap((solve) => {
    // A fail the Referee ruled a check defect does not count, and is nobody's to build around.
    if (passed(solve) !== false || last("referee.finding", solve.id)?.ruling === "check-defect") return [];
    return [
      {
        solve: solve.id,
        task: solve.under.task,
        harness: solve.under.harness,
        kind: text(solve.ending?.kind),
        ...standing(solve, practice),
        started: solve.started,
      },
    ];
  });
}

/** A comparison's handover, from its start and its last report. A log written before 9 October
 *  holds reports and no starts, and such a comparison's terms are read from its report. */
function compared(events: readonly LogEvent[], id: string): Compared {
  const report = lastReports(events).find(({ session }) => session === id)?.data;
  const start =
    events.find(({ kind, data }) => kind === STARTED && data.session === id)?.data ?? report ?? {};
  const scored = asRecord(report?.scored);
  const valid = asRecord(report?.valid);
  const solves = solvesIn(events).filter((solve) => solve.start.comparison === id);
  const own = new Set(solves.map((solve) => solve.id));
  const began = events.findIndex(({ kind, data }) => kind === STARTED && data.session === id);
  const setting = events.findLast(({ kind }, index) => kind === "campaign.setting" && index < began)?.data;
  const told = setting === undefined ? asRecord(solves[0]?.start.limits)?.modelTurns : setting.modelTurns;
  const ruled = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "referee.finding" && isString(data.solve) && own.has(data.solve)
        ? [[data.solve, data.ruling] as const]
        : [],
    ),
  );
  const side = (each: unknown) => (Array.isArray(each) ? each.filter(isNumber) : []);
  return {
    step: "comparison",
    id,
    old: text(start.old) ?? "",
    fresh: text(start.fresh) ?? "",
    tasks: Array.isArray(start.tasks) ? start.tasks.length : count(start.tasks),
    solves: count(start.solves),
    level: count(start.level),
    cap: isNumber(asRecord(start.cap)?.dollars) ? count(asRecord(start.cap)?.dollars) : null,
    modelTurns: isNumber(told) ? told : null,
    reading: text(report?.reading),
    tally:
      scored === null
        ? null
        : { wins: count(scored.wins), losses: count(scored.losses), ties: count(scored.ties) },
    valid: valid === null ? null : { old: side(valid.old), fresh: side(valid.fresh) },
    decided: isNumber(asRecord(report?.objective)?.decided)
      ? count(asRecord(report?.objective)?.decided)
      : null,
    aside: listed(report?.aside),
    rulings: {
      earned: [...ruled.values()].filter((ruling) => ruling === "earned").length,
      "check-defect": [...ruled.values()].filter((ruling) => ruling === "check-defect").length,
      unclear: [...ruled.values()].filter((ruling) => ruling === "unclear").length,
    },
    billed: billedParts(events, id).comparison,
    // A comparison with no report has a start: a step is a start or a report.
    cut: report === undefined && nextBound(events, began) !== -1,
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
  const fails = practiceFails(events);
  const practised = practiceRan(events);
  const gated = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "task.gate" && data.outcome === "passed" ? [data.version] : [],
    ),
  );
  const comparisons = new Set<string>();
  const steps = events.flatMap(({ kind, data }, index): Handover[] => {
    const id = data.session;
    if (!isString(id)) return [];
    if (kind === "exam.started") {
      const { read, closed, window } = soFar(events, index, id, "exam");
      const end = events[closed]?.data;
      // One `task.proposed` an instance the session took, and one gate or refusal of it
      // (`src/examiner/write.ts`), so the counts of an open session are its proposals so far.
      const proposals = window.flatMap((event) =>
        event.kind === "task.proposed" && event.data.session === id ? [event.data.version] : [],
      );
      const held = proposals.filter((version) => gated.has(version)).length;
      const counts =
        end === undefined
          ? { proposed: proposals.length, held, refused: proposals.length - held, billed: billedAll(window) }
          : {
              proposed: count(end.proposed),
              held: listed(end.held),
              refused: listed(end.refused),
              // With the solves it asked for to try a draft task (`try_task`), which name it where a
              // comparison's name the comparison: until 12 October no step held them.
              billed: count(end.billed) + billedParts(events, id).comparison,
            };
      return [{ step: "examiner", id, ...read, ...counts }];
    }
    if (kind === "build.started") {
      const { read, closed, until, window } = soFar(events, index, id, "build");
      const end = events[closed]?.data;
      const within = ({ started }: { readonly started: number }) => started > index && started < until;
      return [
        {
          step: "builder",
          id,
          ...read,
          parent: text(data.parent),
          harness: text(end?.harness),
          changed: end?.changed === true,
          practiceSolves: end === undefined ? practised.filter(within).length : count(end.practiceSolves),
          fails: fails.filter(within).length,
          // An open session's own turns are summed at its end, so until then they are its window's.
          billed: end === undefined ? billedAll(window) : billedParts(events, id).session,
        },
      ];
    }
    // A comparison stands where the log first holds it: at its start, or at its first report.
    if ((kind !== STARTED && kind !== "comparison.reported") || comparisons.has(id)) return [];
    comparisons.add(id);
    return [compared(events, id)];
  });
  return {
    supply: supplyOf(events),
    reference: promoted(events),
    latest: latestBuilt(events),
    steps,
    fails: fails.map(({ started: _started, ...fail }) => fail),
  };
}
