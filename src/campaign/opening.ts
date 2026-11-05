/**
 * What a campaign runs by: its opening, as the Harness Builder's command records it
 * (`campaign.opened`, `tools/d2/harness-builder.ts`), and the plan move 7 decides on, read from
 * that opening and the log (`Plan`, `ground.ts`).
 *
 * The opening is the operator's conditions for the whole campaign, recorded once and again where
 * a command names another: the total budget, who sits in each seat, whether the operator's word is
 * waited for, and, for a campaign that opens from a prompt, the prompt and who solves. None of them
 * moves a comparison's reading. The setting is the log's own record (`campaign.setting`), and the
 * one record of a solve's limits, the scored tasks and the solves a side: the campaign command
 * records it as it starts (`tools/d2/harness-builder.ts`). Until 5 November the opening kept copies of them,
 * a solve's model turns (`limit`) and three terms, so that a campaign continued by its name before
 * its first comparison or session kept what it was opened with: on 9 October one opened with a
 * solve's deadline of 8 minutes recorded 120 when continued by its name alone. In the 108 paid
 * campaigns opened from 28 October the terms were named in none and `limit` in one.
 *
 * It names the project the campaign belongs to (`--project`), as a v1 run named the project whose
 * tree it joined. Until 12 October a v2 campaign was its name and its worktree, and the operator's
 * page could group campaigns only by their prompts, which differ in a word. The project is the
 * operator's choice at the opening and stays the campaign's. An opening written before then names
 * none.
 *
 * It also keeps the terms of the campaign's moves as a command last named them (`TERMS`): the
 * limits of a Builder conversation, the comparison's level, the practice tasks, the tasks an
 * Examiner session is asked for, and the operator's cap of promotions. Without them a command that
 * names nothing runs each move by its default: on 9 October a campaign opened with Builder sessions
 * of 25 minutes, continued by its name alone, gave each session 240 minutes, and nothing said so.
 * An older opening's other terms (`defects`, `practice-solves`, the Examiner's `exam-proposals`,
 * `exam-minutes` and `exam-turns`, and `cost`) are read past: none of 310 logs named one, and each
 * is its move's default now. So are its Builder sessions before a comparison (`sessions`), which
 * went with the table's row that counted them.
 */
import { type LogEvent, read } from "../kernel/log.ts";
import { type Cap, patienceOf } from "../kernel/reports.ts";
import { billedAll } from "../kernel/meter.ts";
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
  /** The improvement patience and supply patience: moves without a gain and readings that left
   *  nothing to gain (`roomless`) before the campaign ends (`--patience`; `PATIENCE`). */
  readonly patience: number;
  readonly seats: Readonly<Record<(typeof SEATS)[number], Seat | null>>;
  /** Whether the operator is in the loop (`--hitl`): the freeze, a drafted exam's checks and a
   *  promotion then wait for the operator's word. It is kept here and not read off the running
   *  command's flag alone, so that a reopen that does not name the flag still waits; `--no-hitl`
   *  gives it back. The record keeps the key it had as `--attended`, before 16 October. */
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

/** The flags of a campaign's moves that its opening keeps: a comparison's level; a Builder
 *  conversation's deadline and session turn limit; the practice tasks; an Examiner session's tasks;
 *  and the operator's cap of promotions, `none` to lift it. */
export const TERMS = ["level", "minutes", "turns", "practice", "exam-tasks", "promotions"] as const;
export type Terms = Readonly<Partial<Record<(typeof TERMS)[number], string>>>;

/** The seats a campaign names a model for. The solver's is the setting's (`tools/d2/setting.ts`). */
export const SEATS = ["builder", "examiner", "reviewer"] as const;
const SETTING = "campaign.setting";

/** The paid solves of each campaign in flight in this process, by its log: a Builder's practice
 *  and a comparison's solves share one budget (14 October: until then a `try_task` solve of the
 *  gate's was held to no reserve, and two remaining reserves could start a three-solve gate beside
 *  a Builder's practice). */
const FLYING = new Map<string, number>();

/** How many paid solves of the campaign whose log is `log` are in flight in this process. */
export function inFlight(log: string): number {
  return FLYING.get(log) ?? 0;
}

/** What is left of the campaign's total once every billed dollar in `events` is subtracted, with
 *  its reserve, or null where the opening names no budget. The one reading of it for the plan, a
 *  solve's admission, the Builder's practice, the Examiner's next request and the page's runway. */
export function budgetLeft(events: readonly LogEvent[]): Cap | null {
  const budget = openingOf(events)?.budget;
  return budget == null ? null : { dollars: budget.dollars - billedAll(events), reserve: budget.reserve };
}

/** Whether the campaign whose log is `log` holds a reserve for `count` more solves beside those in
 *  flight. A log whose opening names no budget holds every one. */
export function affords(log: string, count: number): boolean {
  const left = budgetLeft(read(log));
  return left === null || left.dollars >= (inFlight(log) + count) * left.reserve;
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
  const cap = Number(opening?.terms.promotions);
  return {
    patience: patienceOf(events),
    unprepared: beside.unprepared,
    wanted: {
      target: isNumber(named) ? named : (beside.target ?? SIZE.tasks),
      level: beside.level,
    },
    left: budgetLeft(events),
    prompted: opening?.prompt != null,
    pastStop: beside.pastStop ?? null,
    // A launch without `--hitl` is the operator's word for every check its author decides
    // (`--admit-authored`, the operator, 16 October), so a reading taken under `--hitl` that left
    // some unadmitted is read again.
    admits: [
      ...new Set([...(beside.admits ?? []), ...(opening?.attended === true ? [] : unadmitted(events))]),
    ],
    practice: beside.practice ?? null,
    promotions: Number.isInteger(cap) && cap > 0 ? cap : null,
  };
}
