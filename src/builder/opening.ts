/**
 * What a campaign runs by: its opening, as the Harness Builder's command records it
 * (`campaign.opened`, `tools/d2/harness-builder.ts`), and the plan move 7 decides on, read from
 * that opening and the log (`Plan`, `ground.ts`).
 *
 * The opening is the operator's conditions for the whole campaign, recorded once and again where
 * a command names another: the total budget, the full limit of a solve, the Builder sessions
 * before a comparison, who sits in each seat, whether the operator's word is waited for,
 * and, for a campaign that opens from a prompt, the prompt and who solves. None of them moves a
 * comparison's reading. The setting is the log's own record (`campaign.setting`).
 *
 * It also keeps the terms of the campaign's moves as a command last named them (`TERMS`): the
 * limits of a Builder session and of an Examiner session, the size of a comparison, the practice
 * tasks, and a solve's wall and prompts until a setting is recorded. Until 2026-10-09 it kept
 * none, and a command that named nothing ran each move by its default. The second campaign from a
 * prompt was opened with a solve's wall of 8 minutes, 6 scored tasks and Builder sessions of 25
 * minutes and 6 practice solves; continued by its name alone, it recorded a setting of 120
 * minutes and 12 tasks and gave each session 240 minutes and 24 practice solves, and nothing said
 * so.
 */
import type { LogEvent } from "../kernel/log.ts";
import { billedAll, type Cap, patienceOf } from "../kernel/reports.ts";
import { SIZE } from "../kernel/size.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { Plan } from "./ground.ts";

/** Who sits in a seat: a model and its effort. */
export interface Seat {
  readonly model: string;
  readonly effort: string;
}
/** What a campaign runs by, as `campaign.opened` records it (`tools/d2/harness-builder.ts`). */
export interface Opening {
  /** The dollars the campaign may bill in all, and the reserve one solve is held at; null for a
   *  rehearsal's, whose seats are paid nothing. */
  readonly budget: Cap | null;
  /** The full limit of a solve in the model's turns, and the Builder sessions before a comparison. */
  readonly limit: number | null;
  readonly sessions: number;
  /** The moves without a gain, the idle Examiner sessions and the comparisons without room the
   *  campaign bears in a row before it ends (`--patience`; `PATIENCE`). */
  readonly patience: number;
  readonly seats: Readonly<Record<(typeof SEATS)[number], Seat | null>>;
  /** Whether the freeze and a promotion wait for the operator's word (`--attended`). Until
   *  12 October it was the running command's flag alone, so a reopen that did not name it ran an
   *  attended campaign on unattended, and promoted without the operator. */
  readonly attended: boolean;
  /** The operator's prompt, for a campaign that opened from one: its exam is drafted from it
   *  (`src/examiner/draft.ts`). Null for a campaign that opened over a stored pack. */
  readonly prompt: string | null;
  /** Who solves, where no stored cycle says: a campaign from a prompt names it at its opening. */
  readonly solver: Seat | null;
  /** The terms of the campaign's moves, each as a command last named it; a move runs by its
   *  default for a term no command has named. */
  readonly terms: Terms;
}

/** The flags of a campaign's moves that its opening keeps: a solve's wall and prompts and the
 *  scored tasks, which the first setting records; a comparison's solves a side, level and stop on
 *  check defects; a Builder session's minutes, turns and practice solves; the practice tasks; and
 *  an Examiner session's tasks, proposals, minutes and turns. */
export const TERMS = [
  "solve-minutes",
  "target",
  "solves",
  "level",
  "trigger",
  "margin",
  "defects",
  "minutes",
  "turns",
  "practice-solves",
  "practice",
  "exam-tasks",
  "exam-proposals",
  "exam-minutes",
  "exam-turns",
] as const;
export type Terms = Readonly<Partial<Record<(typeof TERMS)[number], string>>>;

/** The seats a campaign names a model for. The solver's is the setting's (`tools/d2/setting.ts`). */
export const SEATS = ["builder", "examiner", "reviewer"] as const;
/** The Builder sessions before a comparison, after the campaign's first, where nothing names
 *  them: the plan's checkpoint is several sessions and then one comparison. */
export const SESSIONS = 3;
const SETTING = "campaign.setting";

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
    budget:
      isNumber(budget?.dollars) && isNumber(budget.reserve)
        ? { dollars: budget.dollars, reserve: budget.reserve }
        : null,
    limit: isNumber(data.limit) ? data.limit : null,
    sessions: isNumber(data.sessions) ? data.sessions : SESSIONS,
    patience: patienceOf(events),
    seats: { builder: seat("builder"), examiner: seat("examiner"), reviewer: seat("reviewer") },
    attended: data.attended === true,
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
 * with no opening on record, as every one before 2026-10-09, runs by the defaults, and no total.
 */
export function planOf(
  events: readonly LogEvent[],
  beside: {
    /** Whether the campaign's pack holds a task its log does not. */
    readonly unprepared: boolean;
    readonly level: number;
    readonly trigger: number;
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
  const named = Array.isArray(recorded?.tasks) ? recorded.tasks.length : recorded?.target;
  return {
    sessions: opening?.sessions ?? SESSIONS,
    patience: patienceOf(events),
    unprepared: beside.unprepared,
    wanted: {
      target: isNumber(named) ? named : (beside.target ?? SIZE.tasks),
      level: beside.level,
      trigger: beside.trigger,
    },
    left:
      opening?.budget == null
        ? null
        : { dollars: opening.budget.dollars - billedAll(events), reserve: opening.budget.reserve },
    prompted: opening?.prompt != null,
    ...keyIfDefined("pastStop", beside.pastStop),
    ...keyIfDefined("admits", beside.admits),
    ...keyIfDefined("practice", beside.practice),
  };
}
