import { CALL_KINDS, type EventKind, eventsOf, type LogEvent, read } from "../kernel/log.ts";
import { type Cap, patienceOf } from "../kernel/reports.ts";
import { billedAll } from "../kernel/meter.ts";
import { SIZE } from "../kernel/size.ts";
import { unadmitted } from "../kernel/acceptance.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import type { Plan } from "./state.ts";

export interface Seat {
  readonly model: string;
  readonly effort: string;
}
export interface Opening {
  readonly project: string | null;
  readonly budget: Cap | null;
  readonly patience: number;
  readonly seats: Readonly<Record<(typeof SEATS)[number], Seat | null>>;
  readonly attended: boolean;
  readonly judged: boolean;
  readonly prompt: string | null;
  readonly solver: Seat | null;
  readonly terms: Terms;
}

export const TERMS = ["level", "minutes", "turns", "practice", "promotions"] as const;
export type Terms = Readonly<Partial<Record<(typeof TERMS)[number], string>>>;

export const SEATS = ["builder", "examiner", "reviewer"] as const;
const SETTING = "campaign.setting";
const FLYING = new Map<string, number>();

const UNBILLED: ReadonlySet<EventKind> = new Set([
  ...CALL_KINDS,
  "verdict",
  "condition.recorded",
  "exam.drafted",
  "task.proposed",
  "task.feasible",
  "task.gate",
  "task.state",
]);

export function inFlight(log: string): number {
  return FLYING.get(log) ?? 0;
}

export function budgetLeft(events: readonly LogEvent[], opening = openingOf(events)): Cap | null {
  const budget = opening?.budget;
  return budget == null ? null : { dollars: budget.dollars - billedAll(events), reserve: budget.reserve };
}

export function affords(log: string, count: number): boolean {
  const left = budgetLeft(read(log, UNBILLED));
  return left === null || left.dollars >= (inFlight(log) + count) * left.reserve;
}

export async function flying<T>(log: string, run: () => Promise<T>): Promise<T> {
  FLYING.set(log, inFlight(log) + 1);
  try {
    return await run();
  } finally {
    FLYING.set(log, inFlight(log) - 1);
  }
}

export function openingOf(events: readonly LogEvent[]): Opening | null {
  const data = eventsOf(events, "campaign.opened").at(-1)?.event.data;
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
    judged: data.judged === true,
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

export function planOf(
  events: readonly LogEvent[],
  beside: {
    readonly unprepared: boolean;
    readonly level: number;
    readonly target?: number | undefined;
    readonly pastStop?: string | undefined;
    readonly admits?: readonly string[] | undefined;
    readonly practice?: number | undefined;
  },
  opening: Opening | null = openingOf(events),
): Plan {
  const recorded = eventsOf(events, SETTING).at(-1)?.event.data;
  const named = recorded?.target;
  const cap = Number(opening?.terms.promotions);
  const autoAuthor = opening?.attended === true ? [] : unadmitted(events, undefined, "author");
  const autoJudge = opening?.judged === true ? unadmitted(events, undefined, "judge") : [];
  return {
    patience: patienceOf(events),
    unprepared: beside.unprepared,
    wanted: {
      target: isNumber(named) ? named : (beside.target ?? SIZE.tasks),
      level: beside.level,
      solves: isNumber(recorded?.solves) ? recorded.solves : SIZE.solves,
    },
    left: budgetLeft(events, opening),
    prompted: opening?.prompt != null,
    pastStop: beside.pastStop ?? null,
    admits: [...new Set([...(beside.admits ?? []), ...autoAuthor, ...autoJudge])],
    practice: beside.practice ?? null,
    promotions: Number.isInteger(cap) && cap > 0 ? cap : null,
  };
}
