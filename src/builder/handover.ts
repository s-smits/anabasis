/**
 * One reading of a campaign's log: what each step handed over, and the moves that may start next.
 *
 * A campaign is a sequence of steps over one log: the set-up, Examiner sessions, Builder sessions
 * and comparisons. Until 2026-10-09 nobody held the whole of it. The launcher read the supply, the
 * pulse read what ran, the investigation's reader read everything for a person with a question, and
 * the Builder's opening message had a reader of its own (`past.ts`). v1's Builder was handed one
 * test set through four such readers until 21 September, and they disagreed: 20 of 25 in one
 * paragraph and 0 of 5 in the next.
 *
 * So the log is read here once (`campaignOf`), and each reader is a rendering of that reading
 * through its own filter: the operator's view prints it whole (`tools/runs/view.ts`), and the
 * Builder's opening message takes its fails and its tallies from it and nothing else (`past.ts`).
 * A step's handover is what the owner of a campaign needs of it, never its content: counts, a
 * harness's digest, a tally, a reading, a cost. No task is named in one.
 *
 * The next move is no second decision (`nextMoves`). Whether a round, a checkpoint or a session
 * may start is the admission a launch of it is given (`admission.ts`), asked with the same
 * supply. What is added is what only the whole campaign shows: that there is nothing to compare,
 * that a comparison waits for a person's labels, that a harness has read a step and is the
 * operator's to promote, and that the plan's stop rule has stopped the campaign.
 *
 * Nothing here launches anything. The operator, or a session that stands in for the campaign's
 * owner, reads the moves and starts one (`AGENTS.md`, section 4).
 */
import type { Tally } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { billedParts, comparedAs, lastReports, latestBuilt, promoted } from "../kernel/reports.ts";
import { ended, passed, practiceRan, type Ran, solvesIn } from "../kernel/solves.ts";
import { taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import {
  admission,
  type Supply,
  sessionAdmission,
  supplyOf,
  type Wanted,
  type WantedPractice,
} from "./admission.ts";

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
  /** What the Diagnoser read of it: null where it read nothing. */
  readonly diagnosis:
    | { readonly owner: string; readonly confidence: string; readonly cause: string }
    | "abstained"
    | null;
}

/** What an Examiner session handed over. `ended` is null while it runs, or where it never ended. */
interface Examined {
  readonly step: "examiner";
  readonly id: string;
  readonly ended: string | null;
  readonly proposed: number;
  readonly held: number;
  readonly refused: number;
  readonly billed: number;
}

/** What a Builder session handed over. */
interface Built {
  readonly step: "builder";
  readonly id: string;
  readonly ended: string | null;
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
  readonly budgets: number;
  readonly cap: number | null;
  /** The model's turns each of its solves was told and held to, by the setting on record when it
   *  began, or by its first solve where the log holds no record of the setting; null where the
   *  turns were not limited. A changed limit is another setting, and no tally is read across two. */
  readonly modelTurns: number | null;
  readonly reading: string | null;
  readonly tally: Tally | null;
  /** Each harness by itself: the tasks with no, one, two... valid answers among its solves. */
  readonly valid: { readonly old: readonly number[]; readonly fresh: readonly number[] } | null;
  /** The tasks set aside for a person's labels. */
  readonly aside: number;
  /** The Referee's last ruling of each of its rejected answers, by kind. */
  readonly rulings: Readonly<Record<(typeof RULINGS)[number], number>>;
  /** Its solves and their rulings, without the session a round ran before it. */
  readonly billed: number;
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

/** What the next moves are asked with: a comparison's flags and a lone session's. */
export interface Asked {
  /** The harness a comparison is made against, as `--reference` names it. */
  readonly reference: string;
  readonly comparison: Wanted;
  readonly session: WantedPractice;
}

/** A move a campaign's owner may make now, or why not, and what its reader should know. */
export interface Move {
  readonly move: string;
  readonly may: boolean;
  readonly refusals: readonly string[];
  readonly notes: readonly string[];
}

/** Passes running under a later harness that mark a fail repaired: one solve is weak evidence. */
const REPAIRED_AFTER = 2;
const RULINGS = ["earned", "check-defect", "unclear"] as const;
const STEP = "step";
const UNCOMPARED =
  "a comparison of the harness it leaves is refused as the log stands, for the reasons a round is given";

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

/** The Diagnoser's last reading of a solve, as a fail carries it. */
function diagnosed(read: JsonObject | undefined): PracticeFail["diagnosis"] {
  if (read === undefined) return null;
  const { owner, confidence, cause } = read;
  return isString(owner) && isString(confidence) && isString(cause)
    ? { owner, confidence, cause }
    : "abstained";
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
        diagnosis: diagnosed(last("diagnosis.recorded", solve.id)),
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
    events.find(({ kind, data }) => kind === "comparison.started" && data.session === id)?.data ??
    report ??
    {};
  const scored = asRecord(report?.scored);
  const valid = asRecord(report?.valid);
  const solves = solvesIn(events).filter((solve) => solve.start.comparison === id);
  const own = new Set(solves.map((solve) => solve.id));
  const began = events.findIndex(({ kind, data }) => kind === "comparison.started" && data.session === id);
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
    budgets: listed(start.budgets),
    cap: isNumber(asRecord(start.cap)?.dollars) ? count(asRecord(start.cap)?.dollars) : null,
    modelTurns: isNumber(told) ? told : null,
    reading: text(report?.reading),
    tally:
      scored === null
        ? null
        : { wins: count(scored.wins), losses: count(scored.losses), ties: count(scored.ties) },
    valid: valid === null ? null : { old: side(valid.old), fresh: side(valid.fresh) },
    aside: listed(report?.aside),
    rulings: {
      earned: [...ruled.values()].filter((ruling) => ruling === "earned").length,
      "check-defect": [...ruled.values()].filter((ruling) => ruling === "check-defect").length,
      unclear: [...ruled.values()].filter((ruling) => ruling === "unclear").length,
    },
    billed: billedParts(events, id).comparison,
  };
}

/** The reading of a campaign's log: its set-up, every step's handover and its practice fails. */
export function campaignOf(events: readonly LogEvent[]): Campaign {
  const fails = practiceFails(events);
  const finished = (kind: string, id: string) =>
    events.findLast((event) => event.kind === kind && event.data.session === id)?.data;
  const comparisons = new Set<string>();
  const steps = events.flatMap(({ kind, data }, index): Handover[] => {
    const id = data.session;
    if (!isString(id)) return [];
    if (kind === "exam.started") {
      const end = finished("exam.finished", id);
      return [
        {
          step: "examiner",
          id,
          ended: text(end?.ended),
          proposed: count(end?.proposed),
          held: listed(end?.held),
          refused: listed(end?.refused),
          billed: count(end?.billed),
        },
      ];
    }
    if (kind === "build.started") {
      const closed = events.findIndex(
        (event) => event.kind === "build.finished" && event.data.session === id,
      );
      const end = finished("build.finished", id);
      return [
        {
          step: "builder",
          id,
          ended: text(end?.ended),
          parent: text(data.parent),
          harness: text(end?.harness),
          changed: end?.changed === true,
          practiceSolves: count(end?.practiceSolves),
          fails: fails.filter(({ started }) => started > index && (closed === -1 || started < closed)).length,
          billed: billedParts(events, id).session,
        },
      ];
    }
    // A comparison stands where the log first holds it: at its start, or at its first report.
    if ((kind !== "comparison.started" && kind !== "comparison.reported") || comparisons.has(id)) return [];
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

/**
 * The moves a campaign's owner may make on this log, each with the refusals and the notes a launch
 * of it would be given. A round, a checkpoint and a session by itself are read by their admission
 * and nothing else. The others are said only where the log shows them: a settling, a promotion and
 * the stop.
 */
export function nextMoves(events: readonly LogEvent[], asked: Asked): Move[] {
  const { steps, reference, latest, supply } = campaignOf(events);
  const against = supplyOf(events, asked.reference);
  const move = (named: string, read: { refusals: readonly string[]; notes: readonly string[] }): Move => ({
    move: named,
    may: read.refusals.length === 0,
    ...read,
  });
  const comparisons = steps.flatMap((step) => (step.step === "comparison" ? [step] : []));
  const waiting = comparisons.findLast(({ aside }) => aside > 0);
  // A harness to promote is the latest one, where it is not the reference and has read a step
  // against the reference as it stands.
  const steps_ =
    latest === null || latest === reference
      ? []
      : comparedAs(events, latest).filter(
          ({ against: old, reading }) => reading === STEP && (reference === null || old === reference),
        );
  const round = admission(against, { ...asked.comparison, builds: true });
  const alone = sessionAdmission(supply, asked.session);
  return [
    move("a round", round),
    move(
      "a checkpoint",
      latest === null || latest === reference
        ? {
            refusals: [
              "no Builder session has left a harness that is not the reference harness: there is nothing to compare",
            ],
            notes: [],
          }
        : admission(against, { ...asked.comparison, builds: false }),
    ),
    move("a Builder session by itself", {
      refusals: alone.refusals,
      // A session scores nothing, so its admission does not ask whether a comparison could follow.
      // The view says so where none could: live-1 on 2026-10-09 read "may start" for a session
      // beside a refused round and a refused checkpoint, with nothing joining the two.
      notes:
        alone.refusals.length === 0 && round.refusals.length > 0 ? [...alone.notes, UNCOMPARED] : alone.notes,
    }),
    move("an Examiner session", {
      refusals: [],
      notes: [
        `${String(supply.held)} held out · ${String(supply.released)} released for practice: what a session writes is held out beside them`,
      ],
    }),
    ...(waiting === undefined
      ? []
      : [
          move("settling", {
            refusals: [],
            notes: [
              `comparison ${waiting.id} set ${plural(waiting.aside, "task")} aside for a person's labels: tools/d2/settle.ts --session ${waiting.id}`,
            ],
          }),
        ]),
    ...(latest === null || steps_.length === 0
      ? []
      : [
          move("a promotion", {
            refusals: [],
            notes: [
              `harness ${latest.slice(0, 8)} read a step against the reference harness in ${plural(steps_.length, "comparison")} (${steps_.map(({ comparison }) => comparison).join(", ")}): the plan promotes a step once it has been repeated on fresh solves, and the word is the operator's (tools/d2/promote.ts)`,
            ],
          }),
        ]),
    ...(supply.stop.stop
      ? [
          move("stop", {
            refusals: [],
            notes: [
              `${plural(supply.stop.sinceStep, "checkpoint")} since the last step: the campaign's patience is spent (docs/plan.md, Phase 5; --patience)`,
            ],
          }),
        ]
      : []),
  ];
}
