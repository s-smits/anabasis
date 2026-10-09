/**
 * What the comparisons on record say of a campaign: whether it should stop, each report read as it
 * was found, the tasks a person has to read before they are scored again, the one outcome of a task
 * its author may hear, and what the log holds of billed dollars.
 *
 * A comparison ends in a `comparison.reported` event under an id, a round's session id or a
 * checkpoint's own (`src/builder/round.ts`). A person's settling writes the same id's report once
 * more, so a comparison is read by its last report. Every fold here starts from those.
 *
 * No fold here names the harness a comparison is made against. That is the reference harness, the
 * one the campaign started with until a step is promoted, and promotion is the operator's
 * (`docs/plan.md`, Phase 6). A Builder goes on from the harness its last session left
 * (`latestBuilt`), step or none.
 *
 * The stop rule is the plan's: no step in three checkpoints. Until 2026-10-09 it pooled a gain in
 * pass-rate points over three sessions, which measured the thing the plan no longer scores by
 * (`docs/plan.md`, Tuning).
 *
 * Nothing here decides a comparison or makes a solve.
 */
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { type Paired, pairings, pairsOf } from "./compare.ts";
import type { LogEvent } from "./log.ts";

/** A comparison's last report, with where it stands in the log. */
export interface Reported {
  readonly session: string;
  readonly index: number;
  readonly data: JsonObject;
}

/** What a task's author may hear of it: that one of the two harnesses won it, that it was a tie
 *  between valid answers, that no solve of the last comparison gave a valid answer, or that a
 *  rejection of an answer to it is not settled. Never which harness, and never a count. */
export type Outcome = "won" | "tie" | "no-valid-answer" | "disputed";

/** Checkpoints without a step at which the plan stops the campaign. */
const STOP_AFTER = 3;
/** Comparisons in a row without a valid answer after which a task goes to a person. */
const UNSOLVED_RUN = 2;
const STEP = "step";
/** The events that carry what their own model turns were billed, in a `billed` field: a solve
 *  attempt, a Builder or an Examiner session, and a reviewer's reading. */
const BILLED: ReadonlySet<string> = new Set([
  "solve.finished",
  "build.finished",
  "exam.finished",
  "referee.finding",
  "diagnosis.recorded",
]);

/** Each comparison's last report in a log, in the order those reports were written. */
export function lastReports(events: readonly LogEvent[]): Reported[] {
  const last = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === "comparison.reported" && isString(data.session)) last.set(data.session, index);
  }
  return [...last]
    .sort(([, a], [, b]) => a - b)
    .flatMap(([session, index]) => {
      const data = events[index]?.data;
      return data === undefined ? [] : [{ session, index, data }];
    });
}

/**
 * The harness the last whole Builder session left, by its digest, or null while none has changed
 * one. It is where the next session starts unless the operator names another: after a comparison
 * without a step the Builder continues from its latest harness (`docs/plan.md`, Phase 5). A session
 * that was killed or that crashed froze half a session's work and is passed over.
 */
export function latestBuilt(events: readonly LogEvent[]): string | null {
  const left = events.findLast(
    ({ kind, data }) =>
      kind === "build.finished" &&
      data.changed === true &&
      isString(data.harness) &&
      data.ended !== "killed" &&
      data.ended !== "crashed",
  )?.data.harness;
  return isString(left) ? left : null;
}

/**
 * The plan's stop rule over the comparisons a log holds: how many checkpoints tallied a task, how
 * many of them have passed since the last step, and whether that is three. A session that left its
 * harness unchanged, a comparison stopped on its check defects, one its dollar cap cut and one with
 * every task set aside or short tested nothing, and are no checkpoints.
 */
export function stopRule(events: readonly LogEvent[]) {
  const compared = lastReports(events).filter(
    ({ data }) => asRecord(data.scored) !== null && Array.isArray(data.versions) && data.versions.length > 0,
  );
  const sinceStep = compared.length - 1 - compared.findLastIndex(({ data }) => data.reading === STEP);
  return { checkpoints: compared.length, sinceStep, stop: sinceStep >= STOP_AFTER };
}

/**
 * The pairs a report tallied, read as the report found them: from the log up to that report, so a
 * task released or disputed since is still the scored task it was, under the report's own two
 * harnesses and setting, counting the solves started since the comparison began, and each side cut
 * to the solves a side it asked for. None for a report that compared nothing, and none for one
 * written before a report said where its comparison began.
 */
export function pairsReported(events: readonly LogEvent[], report: Reported): Paired[] {
  const { index, data } = report;
  const { old, fresh, setting, solves, began } = data;
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  if (!isString(old) || !isString(fresh) || !isString(setting) || !isNumber(solves) || !isNumber(began)) {
    return [];
  }
  const sides = { old, fresh, setting, since: began };
  return whole(pairsOf(events.slice(0, index + 1), versions, sides).pairs, solves).pairs;
}

/** Each pair cut to its first `solves` solves a side, and the tasks that have fewer. A reference
 *  harness read against itself is solved twice as often, and a comparison gone on from its log can
 *  leave a task one solve over on a side; a tally needs as many of each. */
export function whole(pairs: readonly Paired[], solves: number) {
  const enough = ({ old, fresh }: Paired) => old.length >= solves && fresh.length >= solves;
  const cut = <T>(list: readonly T[] = []) => list.slice(0, solves);
  return {
    pairs: pairs.flatMap((pair): Paired[] => {
      if (!enough(pair)) return [];
      const { task, old, fresh, solves: named, used } = pair;
      return [
        {
          task,
          old: cut(old),
          fresh: cut(fresh),
          solves: { old: cut(named?.old), fresh: cut(named?.fresh) },
          used: { old: cut(used?.old), fresh: cut(used?.fresh) },
        },
      ];
    }),
    short: pairs.flatMap((pair) => (enough(pair) ? [] : [pair.task])),
  };
}

/** Whether no solve of a pair gave a valid answer. */
export function unsolved({ old, fresh }: Paired): boolean {
  return ![...old, ...fresh].some(Boolean);
}

/**
 * The tasks that go to a person as possibly infeasible: no harness gave a valid answer to them in
 * two comparisons in a row, by version (`docs/plan.md`, Phase 2). Such a task ties whatever the
 * harnesses are and costs its solves at every comparison. It may be hard, it may be wrongly
 * checked, or it may have no valid answer at all, and only a person can tell the third: on an
 * infeasible task every rejection is a true fail, correctly, every time (the review of 2026-10-09,
 * finding 10). So it leaves the scored set until it is labelled (`tools/d2/prepare.ts`). A label
 * that keeps it is a `task.state` event that holds it once more, and the two comparisons are then
 * counted from that label on; a label that calls it infeasible refuses it, and a refused task is
 * no held-out task.
 */
export function awaitingLabel(events: readonly LogEvent[]): string[] {
  const kept = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === "task.state" && data.state === "held" && isString(data.version)) {
      kept.set(data.version, index);
    }
  }
  const runs = new Map<string, number>();
  for (const report of lastReports(events)) {
    for (const pair of pairsReported(events, report)) {
      if (report.index < (kept.get(pair.task) ?? -1)) continue;
      runs.set(pair.task, unsolved(pair) ? (runs.get(pair.task) ?? 0) + 1 : 0);
    }
  }
  return [...runs].flatMap(([task, run]) => (run >= UNSOLVED_RUN ? [task] : []));
}

/**
 * The outcome of each task some comparison scored or set aside, by task version, from the last
 * comparison that did. The plan lets a task's author hear this and no more (`docs/plan.md`, Phase
 * 2): without a stronger solve the author would otherwise hear nothing, and a difficulty zone or a
 * count is what v1 found an author writes towards. A task no comparison has scored has no outcome.
 * A tie with a valid answer in it is a tie between valid answers on both sides, since a task ties
 * when both harnesses gave as many.
 */
export function outcomesOf(events: readonly LogEvent[]): Map<string, Outcome> {
  const outcomes = new Map<string, Outcome>();
  for (const report of lastReports(events)) {
    for (const pair of pairsReported(events, report)) {
      const won = pairings(pair);
      const tied = unsolved(pair) ? "no-valid-answer" : "tie";
      outcomes.set(pair.task, won.fresh === won.old ? tied : "won");
    }
    const aside = Array.isArray(report.data.aside) ? report.data.aside.filter(isString) : [];
    for (const task of aside) outcomes.set(task, "disputed");
  }
  return outcomes;
}

/** The billed dollars the log holds from event `from` on: every solve attempt, session and
 *  reviewer's reading that ended there. One still running has written no sum yet, which is what a
 *  cap's reserve is for (`src/builder/round.ts`). */
export function billedSince(events: readonly LogEvent[], from: number): number {
  let billed = 0;
  for (const { kind, data } of events.slice(Math.max(0, from))) {
    if (BILLED.has(kind) && isNumber(data.billed)) billed += data.billed;
  }
  return billed;
}
