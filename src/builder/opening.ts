/**
 * What a campaign runs by: its opening, as the Harness Builder's command records it
 * (`campaign.opened`, `tools/d2/harness-builder.ts`), and the plan move 7 decides on, read from
 * that opening and the log (`decide.ts`).
 *
 * The opening is the operator's conditions for the whole campaign, recorded once and again where
 * a command names another: the total budget, the full limit of a solve and the shorter budgets
 * its comparisons are read at, the Builder sessions before a comparison, who sits in each seat,
 * and, for a campaign that opens from a prompt, the prompt and who solves. None of them moves a
 * comparison's reading. The setting is the log's own record (`campaign.setting`).
 */
import type { LogEvent } from "../kernel/log.ts";
import { billedAll, type Cap } from "../kernel/reports.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { Plan } from "./decide.ts";

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
  /** The full limit of a solve in the model's turns, the shorter budgets its comparisons are also
   *  read at, and the Builder sessions before a comparison. */
  readonly limit: number | null;
  readonly ladder: readonly number[];
  readonly sessions: number;
  readonly seats: Readonly<Record<(typeof SEATS)[number], Seat | null>>;
  /** The operator's prompt, for a campaign that opened from one: its exam is drafted from it
   *  (`src/examiner/draft.ts`). Null for a campaign that opened over a stored pack. */
  readonly prompt: string | null;
  /** Who solves, where no stored cycle says: a campaign from a prompt names it at its opening. */
  readonly solver: Seat | null;
}

/** The seats a campaign names a model for. The solver's is the setting's (`tools/d2/setting.ts`). */
export const SEATS = ["builder", "examiner", "reviewer"] as const;
/** The Builder sessions before a comparison, after the campaign's first, where nothing names
 *  them: the plan's checkpoint is several sessions and then one comparison. */
export const SESSIONS = 3;
/** The scored tasks of a campaign whose setting names none. */
const TARGET = 12;
const SETTING = "campaign.setting";

/** What a log's last opening holds a campaign to run by, or null where it holds none. */
export function openingOf(events: readonly LogEvent[]): Opening | null {
  const data = events.findLast(({ kind }) => kind === "campaign.opened")?.data;
  if (data === undefined) return null;
  const budget = asRecord(data.budget);
  const seated = (named: JsonObject | null): Seat | null =>
    isString(named?.model) && isString(named.effort) ? { model: named.model, effort: named.effort } : null;
  const seat = (name: (typeof SEATS)[number]) => seated(asRecord(asRecord(data.seats)?.[name]));
  return {
    budget:
      isNumber(budget?.dollars) && isNumber(budget.reserve)
        ? { dollars: budget.dollars, reserve: budget.reserve }
        : null,
    limit: isNumber(data.limit) ? data.limit : null,
    ladder: Array.isArray(data.ladder) ? data.ladder.filter(isNumber) : [],
    sessions: isNumber(data.sessions) ? data.sessions : SESSIONS,
    seats: { builder: seat("builder"), examiner: seat("examiner"), reviewer: seat("reviewer") },
    prompt: isString(data.prompt) ? data.prompt : null,
    solver: seated(asRecord(data.solver)),
  };
}

/**
 * What move 7 reads beside a log: the campaign's plan from its opening, the dollars left of its
 * total, the size its setting asks a comparison for, and what only the caller knows. A campaign
 * with no opening on record, as every one before 2026-10-09, runs by the defaults: the full limit
 * its first setting named, no shorter budget, and no total.
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
  },
  opening: Opening | null = openingOf(events),
): Plan {
  const first = events.find(({ kind }) => kind === SETTING)?.data;
  const recorded = events.findLast(({ kind }) => kind === SETTING)?.data;
  const named = Array.isArray(recorded?.tasks) ? recorded.tasks.length : recorded?.target;
  const began = isNumber(first?.modelTurns) ? first.modelTurns : null;
  return {
    limit: opening === null ? began : opening.limit,
    ladder: opening?.ladder ?? [],
    sessions: opening?.sessions ?? SESSIONS,
    unprepared: beside.unprepared,
    wanted: {
      target: isNumber(named) ? named : (beside.target ?? TARGET),
      level: beside.level,
      restarted: [],
    },
    left:
      opening?.budget == null
        ? null
        : { dollars: opening.budget.dollars - billedAll(events), reserve: opening.budget.reserve },
    prompted: opening?.prompt != null,
    ...keyIfDefined("pastStop", beside.pastStop),
    ...keyIfDefined("admits", beside.admits),
  };
}
