/**
 * The solves a log holds: each attempt once, from its `solve.started` to its `solve.finished`, with
 * the condition it ran under and the verdict its answer was given.
 *
 * A solve is three records in the log. Its start names its condition by id alone, the condition
 * record says which task version, harness and side that was (`condition.ts`), and its ending and
 * its verdict name the solve. Every reader of a campaign joins them: a task's standing against a
 * harness, the pairs a comparison counts (`compare.ts`), a Builder's practice record,
 * the reviewers' packets, the launcher and the investigation's reader. Until 2026-10-08 each made
 * the join for itself, in fourteen places, and they had come to differ in small ways: one read a
 * task's solves in the order they started and another in the order they ended, which are not the
 * same order when four run at once.
 *
 * Here the join is made once. `solvesIn` is the solves as their own two events tell them and
 * resolves nothing, so a watcher can read a log whose conditions it has no use for; `ranUnder` adds
 * the condition; `ended` puts solves in the order they finished, which is the order every count of
 * "the latest so many" means; `verdictsOf` is the last verdict of each.
 */
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { type Condition, conditionsOf, type Limits, limitsIn } from "./condition.ts";
import type { LogEvent } from "./log.ts";
import type { Verdict } from "./verify.ts";

/** One solve attempt as its own events tell it. */
export interface Solve {
  readonly id: string;
  /** Where its start stands in the log, and its ending: null while the log holds none. */
  readonly started: number;
  readonly finished: number | null;
  /** The condition its start names, by id; empty where it names none. */
  readonly condition: string;
  /** How it ended, as `solve.ts` types an ending: its outcome, its kind and its reason. */
  readonly ending: JsonObject | null;
  /** The two events' own fields: the task's id, the model and the limits at the start; the
   *  seconds, the tokens, the dollars and the harness it opened at the end. */
  readonly start: JsonObject;
  readonly end: JsonObject | null;
}

/** A solve with the condition the log records for it. */
export interface Ran extends Solve {
  readonly under: Condition;
}

/** A solve that has ended. */
type Ended = { readonly finished: number; readonly end: JsonObject };

/** The verdict the log holds of a solve's answer. */
export interface Judged {
  readonly solve: string;
  /** The task by its id, which is how a verdict names its task; null where it names none. */
  readonly task: string | null;
  /** The answer that was judged. */
  readonly answer: JsonValue | undefined;
  /** The verdict's kind as logged: pass, fail, faulty or non-result. */
  readonly kind: string;
  /** The host's refusal of the answer's format, when no check ran. */
  readonly fault: string | null;
  /** The checker's own verdict, or null where no check gave one: an answer outside the contract's
   *  format reached no check, and a non-result decided nothing. */
  readonly checker: Verdict | null;
}

/** Every solve a log holds, in the order they started. */
export function solvesIn(events: readonly LogEvent[]): Solve[] {
  const solves = new Map<string, { -readonly [Key in keyof Solve]: Solve[Key] }>();
  for (const [index, { kind, data }] of events.entries()) {
    if (!isString(data.solve)) continue;
    if (kind === "solve.started") {
      solves.set(data.solve, {
        id: data.solve,
        started: index,
        finished: null,
        condition: isString(data.condition) ? data.condition : "",
        ending: null,
        start: data,
        end: null,
      });
    }
    const solve = kind === "solve.finished" ? solves.get(data.solve) : undefined;
    if (solve !== undefined) {
      solve.finished = index;
      solve.ending = asRecord(data.ending);
      solve.end = data;
    }
  }
  return [...solves.values()];
}

/** Every solve a log holds but those an Examiner session asked for to try a draft task
 *  (`try_task`, `src/examiner/session.ts`), whose starts name the session where a comparison's name
 *  the comparison. Those are the Examiner's: never scored, and no part of a task's record, its
 *  answers, a share or a tally. */
export function countedSolves(events: readonly LogEvent[]): Solve[] {
  const sessions = new Set(
    events.flatMap(({ kind, data }) => (kind === "exam.started" ? [data.session] : [])),
  );
  return solvesIn(events).filter(({ start }) => !sessions.has(start.comparison));
}

/** The solves whose condition the log records, each with it, but the Examiner's (`countedSolves`).
 *  A condition that does not hash to its id is refused, as `conditionsOf` refuses it. A solve that
 *  opened another harness than its condition names ran under none: its runner stopped on it
 *  (`practised`), and what goes on from the log must not count it. */
export function ranUnder(events: readonly LogEvent[]): Ran[] {
  const conditions = conditionsOf(events);
  return countedSolves(events).flatMap((solve) => {
    const under = conditions.get(solve.condition);
    const opened = solve.end?.harness;
    return under === undefined || (isString(opened) && opened !== under.harness) ? [] : [{ ...solve, under }];
  });
}

/**
 * The practice solves of a log: the test-side solves that no comparison asked for. They are what a
 * Builder may be shown of a solve, by its record, its fails and its traces. A solve a comparison
 * made is the exam's, whatever becomes of its task: a held-out task that is scored and released
 * afterwards would otherwise bring its comparison's solves with it, and a Builder would read which
 * held-out task its harness had failed. Until 2026-10-09 the opening's record and `read_trace`
 * read every test-side solve of a practice task, and only the list of fails held to this.
 */
export function practiceRan(events: readonly LogEvent[]): Ran[] {
  return ranUnder(events).filter(
    ({ under, start }) => under.side === "test" && start.comparison === undefined,
  );
}

/** Who solved last on the test side of a log, and under what limits: the model, the effort and the
 *  limits of the condition its last test-side solve started under, or null before any. It is what a
 *  command about to solve as another solver, or under other limits, is set against
 *  (`tools/d2/setting.ts`). */
export function solverLast(
  events: readonly LogEvent[],
): { readonly model: string; readonly effort: string; readonly limits: Limits } | null {
  const tested = new Map(
    events.flatMap(({ kind, data }) => {
      const condition = asRecord(data.condition);
      return kind === "condition.recorded" && isString(data.id) && condition?.side === "test"
        ? [[data.id, condition] as const]
        : [];
    }),
  );
  const started = events.findLast(
    ({ kind, data }) => kind === "solve.started" && isString(data.condition) && tested.has(data.condition),
  )?.data.condition;
  const ran = tested.get(isString(started) ? started : "");
  const limits = limitsIn(ran?.limits);
  return ran !== undefined && isString(ran.model) && isString(ran.effort) && limits !== null
    ? { model: ran.model, effort: ran.effort, limits }
    : null;
}

/** The finished among `solves`, in the order they ended. */
export function ended<Each extends Solve>(solves: readonly Each[]): (Each & Ended)[] {
  return solves
    .flatMap((solve) => {
      const { finished, end } = solve;
      return finished === null || end === null ? [] : [{ ...solve, finished, end }];
    })
    .sort((a, b) => a.finished - b.finished);
}

/** Whether a solve passed: true for a pass, false for a fail of any kind, and null for a
 *  non-result or a solve with no ending, which are no measurement. */
export function passed({ ending }: Pick<Solve, "ending">): boolean | null {
  return ending?.outcome === "pass" ? true : ending?.outcome === "fail" ? false : null;
}

/** The last verdict a log holds for each solve, by the solve. */
export function verdictsOf(events: readonly LogEvent[]): Map<string, Judged> {
  return new Map(
    events.flatMap(({ kind, data }) => {
      if (kind !== "verdict" || !isString(data.solve)) return [];
      const judged: Judged = {
        solve: data.solve,
        task: isString(data.task) ? data.task : null,
        answer: data.answer,
        kind: isString(data.kind) ? data.kind : "",
        fault: isString(data.fault) ? data.fault : null,
        checker: checkerVerdict(data),
      };
      return [[data.solve, judged] as const];
    }),
  );
}

/** The checks that refused an answer; none for any verdict but a checker's fail. An answer some
 *  check refused is what a reviewer reads and a repair is held to. */
export function refusedBy(verdict: Judged | undefined): readonly string[] {
  return verdict?.checker?.kind === "fail" ? verdict.checker.blocking : [];
}

/** The checker's own verdict a `verdict` event holds, with its measure where one was taken, or
 *  null where no check gave one. The acceptance's regrading reads the same event through this
 *  (rule 12): until 11 October it had a copy that dropped the measure. */
export function checkerVerdict(data: JsonObject): Verdict | null {
  if (data.kind === "pass") {
    return {
      kind: "pass",
      ...keyIfDefined("objective", isNumber(data.objective) ? data.objective : undefined),
    };
  }
  if (data.kind === "fail" && Array.isArray(data.blocking) && data.blocking.length > 0) {
    return { kind: "fail", blocking: data.blocking.filter(isString) };
  }
  return data.kind === "faulty" && isString(data.check) && isString(data.reason)
    ? { kind: "faulty", check: data.check, reason: data.reason }
    : null;
}
