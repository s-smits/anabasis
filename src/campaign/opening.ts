/**
 * What a campaign runs by: its opening, as the Harness Builder's command records it
 * (`campaign.opened`, `tools/d2/harness-builder.ts`), and the plan move 7 decides on, read from
 * that opening and the log (`Plan`, `ground.ts`).
 *
 * The opening is the operator's conditions for the whole campaign, recorded once and again where
 * a command names another: the total budget, the full limit of a solve, the Builder sessions
 * before a comparison, who sits in each seat, whether the operator's word is waited for, and, for
 * a campaign that opens from a prompt, the prompt and who solves. None of them moves a comparison's
 * reading. The setting is the log's own record (`campaign.setting`).
 *
 * It names the project the campaign belongs to (`--project`), as a v1 run named the project whose
 * tree it joined. Until 12 October a v2 campaign was its name and its worktree, and the operator's
 * page could group campaigns only by their prompts, which differ in a word. The project is the
 * operator's choice at the opening and stays the campaign's. An opening written before then names
 * none.
 *
 * It also keeps the terms of the campaign's moves as a command last named them (`TERMS`): the
 * limits of a Builder session and of an Examiner session, the size of a comparison, the practice
 * tasks, and a solve's wall until a setting is recorded. Without them a command that names nothing
 * runs each move by its default: on 9 October a campaign opened with a solve's wall of 8 minutes,
 * 6 scored tasks and Builder sessions of 25 minutes and 6 practice solves, and, continued by its
 * name alone, recorded a setting of 120 minutes and 12 tasks and gave each session 240 minutes and
 * 24 practice solves, and nothing said so.
 */
import { type LogEvent, read } from "../kernel/log.ts";
import { type Cap, patienceOf } from "../kernel/reports.ts";
import { billedAll } from "../kernel/trace.ts";
import { SIZE } from "../kernel/size.ts";
import { unadmitted } from "../kernel/acceptance.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import type { Plan } from "./ground.ts";

/** Who sits in a seat: a model and its effort. */
export interface Seat {
  readonly model: string;
  readonly effort: string;
}
/** What a campaign runs by, as `campaign.opened` records it (`tools/d2/harness-builder.ts`). */
export interface Opening {
  /** The project the campaign belongs to (`--project`); null for an opening written before
   *  12 October, when no opening named one. */
  readonly project: string | null;
  /** The dollars the campaign may bill in all, and the reserve one solve is held at; null for a
   *  rehearsal's, whose seats are paid nothing. */
  readonly budget: Cap | null;
  /** The full limit of a solve in the model's turns, and the Builder sessions before a comparison. */
  readonly limit: number | null;
  readonly sessions: number;
  /** The moves without a gain, and the readings that left nothing to gain (`roomless`), the
   *  campaign bears in a row before it ends (`--patience`; `PATIENCE`). */
  readonly patience: number;
  readonly seats: Readonly<Record<(typeof SEATS)[number], Seat | null>>;
  /** Whether the operator is in the loop (`--hitl`): the freeze, a drafted exam's checks and a
   *  promotion then wait for the operator's word. It is kept here and not read off the running
   *  command's flag alone, so that a reopen that does not name the flag still waits; `--no-hitl`
   *  gives it back. The record keeps the key it had as `--attended`, before 16 October. */
  readonly attended: boolean;
  /** Whether the Builder makes the campaign's moves after set-up, in one live conversation with
   *  the campaign's tools (`--builder-led`, `tools/d2/harness-builder.ts`), or the host makes
   *  every move the table names. Kept as `attended` is; a record without it is the host's. */
  readonly led: boolean;
  /** The operator's prompt, for a campaign that opened from one: its exam is drafted from it
   *  (`src/examiner/draft.ts`). Null for a campaign that opened over a stored pack. */
  readonly prompt: string | null;
  /** Who solves, where no stored cycle says: a campaign from a prompt names it at its opening. */
  readonly solver: Seat | null;
  /** The terms of the campaign's moves, each as a command last named it; a move runs by its
   *  default for a term no command has named. */
  readonly terms: Terms;
}

/** The flags of a campaign's moves that its opening keeps: a solve's wall and the scored tasks,
 *  which the first setting records; a comparison's solves a side, level and stop on check
 *  defects; a Builder session's minutes, turns and practice solves; the practice tasks; and an
 *  Examiner session's tasks, proposals, minutes and turns. */
export const TERMS = [
  "solve-minutes",
  "target",
  "solves",
  "level",
  "defects",
  "minutes",
  "turns",
  "practice-solves",
  "practice",
  "exam-tasks",
  "exam-proposals",
  "exam-minutes",
  "exam-turns",
  "cost",
] as const;
export type Terms = Readonly<Partial<Record<(typeof TERMS)[number], string>>>;

/** The seats a campaign names a model for. The solver's is the setting's (`tools/d2/setting.ts`). */
export const SEATS = ["builder", "examiner", "reviewer"] as const;
/** The Builder sessions before a comparison once set-up stands (epoch 0, `sessionsRun` in
 *  `decide.ts`), where nothing names them: the plan's checkpoint is several sessions and then one
 *  comparison (L5), since one session's change is rarely detectable. Before set-up each session's
 *  harness is compared, and until 12 October three were the default after the first comparison. */
export const SESSIONS = 2;
const SETTING = "campaign.setting";

/** The paid solves of each campaign in flight in this process, by its log: a Builder's practice,
 *  a comparison's solves and the Examiner's tries of a draft task share one budget (14 October:
 *  until then a `try_task` solve was held to no reserve, and two remaining reserves could start a
 *  three-solve admission beside a Builder's practice). */
const FLYING = new Map<string, number>();

/** How many paid solves of the campaign whose log is `log` are in flight in this process. */
export function inFlight(log: string): number {
  return FLYING.get(log) ?? 0;
}

/** Whether the campaign whose log is `log` holds a reserve for `count` more solves beside those in
 *  flight. A log whose opening names no budget holds every one. */
export function affords(log: string, count: number): boolean {
  const events = read(log);
  const budget = openingOf(events)?.budget;
  if (budget == null) return true;
  return budget.dollars - billedAll(events) >= (inFlight(log) + count) * budget.reserve;
}

/** `run`, counted in flight for the campaign whose log is `log` while it runs. */
export async function flying<T>(log: string, run: () => Promise<T>): Promise<T> {
  FLYING.set(log, inFlight(log) + 1);
  try {
    return await run();
  } finally {
    FLYING.set(log, inFlight(log) - 1);
  }
}

/** What a log's last opening holds a campaign to run by, or null where it holds none. */
export function openingOf(events: readonly LogEvent[]): Opening | null {
  const data = events.findLast(({ kind }) => kind === "campaign.opened")?.data;
  if (data === undefined) return null;
  const budget = asRecord(data.budget);
  const seated = (named: JsonObject | null): Seat | null =>
    isString(named?.model) && isString(named.effort) ? { model: named.model, effort: named.effort } : null;
  const seat = (name: (typeof SEATS)[number]) => seated(asRecord(asRecord(data.seats)?.[name]));
  const terms = asRecord(data.terms);
  return {
    project: isString(data.project) ? data.project : null,
    budget:
      isNumber(budget?.dollars) && isNumber(budget.reserve)
        ? { dollars: budget.dollars, reserve: budget.reserve }
        : null,
    limit: isNumber(data.limit) ? data.limit : null,
    sessions: isNumber(data.sessions) ? data.sessions : SESSIONS,
    patience: patienceOf(events),
    seats: { builder: seat("builder"), examiner: seat("examiner"), reviewer: seat("reviewer") },
    attended: data.attended === true,
    led: data.led === true,
    prompt: isString(data.prompt) ? data.prompt : null,
    solver: seated(asRecord(data.solver)),
    terms: Object.fromEntries(
      TERMS.flatMap((term) => {
        const named = terms?.[term];
        return isString(named) ? [[term, named]] : [];
      }),
    ),
  };
}

/**
 * What move 7 reads beside a log: the campaign's plan from its opening, the dollars left of its
 * total, the size its setting asks a comparison for, and what only the caller knows. A campaign
 * with no opening on record, as one begun before 9 October, runs by the defaults, and no total.
 */
export function planOf(
  events: readonly LogEvent[],
  beside: {
    /** Whether the campaign's pack holds a task its log does not. */
    readonly unprepared: boolean;
    readonly level: number;
    /** The tasks to score, where the log's setting names none yet. */
    readonly target?: number | undefined;
    readonly pastStop?: string | undefined;
    readonly admits?: readonly string[] | undefined;
    /** The practice tasks the campaign is brought to, where the caller holds a count. */
    readonly practice?: number | undefined;
  },
  opening: Opening | null = openingOf(events),
): Plan {
  const recorded = events.findLast(({ kind }) => kind === SETTING)?.data;
  const named = recorded?.target;
  return {
    sessions: opening?.sessions ?? SESSIONS,
    patience: patienceOf(events),
    unprepared: beside.unprepared,
    wanted: {
      target: isNumber(named) ? named : (beside.target ?? SIZE.tasks),
      level: beside.level,
    },
    left:
      opening?.budget == null
        ? null
        : { dollars: opening.budget.dollars - billedAll(events), reserve: opening.budget.reserve },
    prompted: opening?.prompt != null,
    pastStop: beside.pastStop ?? null,
    // A launch without `--hitl` is the operator's word for every check its author decides
    // (`--admit-authored`, the operator, 16 October), so a reading taken under `--hitl` that left
    // some unadmitted is read again.
    admits: [
      ...new Set([...(beside.admits ?? []), ...(opening?.attended === true ? [] : unadmitted(events))]),
    ],
    practice: beside.practice ?? null,
  };
}
