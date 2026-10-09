/**
 * What the comparisons on record say of a campaign: whether it should stop, each report read as it
 * was found, the tasks a person has to read before they are scored again, the one outcome of a task
 * its author may hear, and what the log holds of billed dollars.
 *
 * A comparison ends in a `comparison.reported` event under an id, a round's session id or a
 * checkpoint's own (`src/builder/round.ts`). A person's settling writes the same id's report once
 * more, so a comparison is read by its last report, and it stands in the log where its first one
 * does: a settling made weeks later moves no comparison behind the ones run since. Every fold here
 * starts from those. A comparison's solves are the ones whose start names it (`compare.ts`).
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
import { passed, ranUnder, solvesIn } from "./solves.ts";

/** A comparison's last report, with where the comparison stands in the log: at its first report. */
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
const REPORTED = "comparison.reported";
const BUILD_FINISHED = "build.finished";
/** The events that carry what their own model turns were billed, in a `billed` field: a solve
 *  attempt, a Builder or an Examiner session, and a reviewer's reading. */
const BILLED: ReadonlySet<string> = new Set([
  "solve.finished",
  BUILD_FINISHED,
  "exam.finished",
  "referee.finding",
  "diagnosis.recorded",
]);

/** Each comparison's last report in a log, in the order the comparisons first reported. */
export function lastReports(events: readonly LogEvent[]): Reported[] {
  const found = new Map<string, Reported>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind !== REPORTED || !isString(data.session)) continue;
    // A map keeps the place of a key's first entry, which is the comparison's first report.
    found.set(data.session, { session: data.session, index: found.get(data.session)?.index ?? index, data });
  }
  return [...found.values()];
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
      kind === BUILD_FINISHED &&
      data.changed === true &&
      isString(data.harness) &&
      data.ended !== "killed" &&
      data.ended !== "crashed",
  )?.data.harness;
  return isString(left) ? left : null;
}

/**
 * The plan's stop rule over the comparisons a log holds: how many checkpoints tallied a task, how
 * many of them have passed since the last step, and whether that is three. A checkpoint is a
 * comparison of a harness a Builder session changed. A comparison of two harnesses no session made
 * is none: counted, two of them would leave a campaign one Builder session before its stop. Nor is
 * a session that left its harness unchanged, a comparison stopped on its check defects, one its
 * dollar cap cut, or one with every task set aside or short, which tested nothing. And a harness
 * set against the baseline after it was compared with another reference is that comparison's
 * reading against the baseline (`baseline-unread`), and no checkpoint of its own.
 */
export function stopRule(events: readonly LogEvent[]) {
  const built = new Set(
    events.flatMap(({ kind, data }) =>
      kind === BUILD_FINISHED && data.changed === true && isString(data.harness) ? [data.harness] : [],
    ),
  );
  /** The harnesses already compared with a reference that is not the baseline. */
  const referenced = new Set<string>();
  const readings: unknown[] = [];
  for (const { data } of lastReports(events)) {
    const { old, fresh, baseline } = data;
    const tallied =
      asRecord(data.scored) !== null && Array.isArray(data.versions) && data.versions.length > 0;
    if (!tallied || !isString(fresh) || !built.has(fresh)) continue;
    if (old !== baseline) referenced.add(fresh);
    else if (referenced.has(fresh)) continue;
    readings.push(data.reading);
  }
  const sinceStep = readings.length - 1 - readings.lastIndexOf(STEP);
  return { checkpoints: readings.length, sinceStep, stop: sinceStep >= STOP_AFTER };
}

/**
 * The pairs a comparison's last report tallied, read as the comparison found them: from the log up
 * to its first report, so a task released, refused or disputed since is still the scored task it
 * was, under the report's own two harnesses and setting, counting the comparison's own solves, and
 * each side cut to the solves a side it asked for. None for a report that compared nothing, and
 * none for a comparison made before a solve's start named its comparison (2026-10-10).
 */
export function pairsReported(events: readonly LogEvent[], report: Reported): Paired[] {
  const { session, index, data } = report;
  const { old, fresh, setting, solves } = data;
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  if (!isString(old) || !isString(fresh) || !isString(setting) || !isNumber(solves)) return [];
  const sides = { old, fresh, setting, comparison: session };
  return whole(pairsOf(events.slice(0, index + 1), versions, sides).pairs, solves).pairs;
}

/** The task versions comparison `id` got a valid answer to, under any of its harnesses: the two of
 *  its test, the reference harness's further solves where it was read against itself, and the
 *  baseline's. */
export function answered(events: readonly LogEvent[], id: string): Set<string> {
  return new Set(
    ranUnder(events).flatMap((solve) =>
      solve.start.comparison === id && passed(solve) === true ? [solve.under.task] : [],
    ),
  );
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
 * two comparisons in a row, by version (`docs/plan.md`, Phase 2). Any valid answer of a comparison
 * ends the run, also one outside its test: a task the baseline answered is no infeasible task. Such a task ties whatever the
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
    const valid = answered(events, report.session);
    for (const { task } of pairsReported(events, report)) {
      if (report.index < (kept.get(task) ?? -1)) continue;
      runs.set(task, valid.has(task) ? 0 : (runs.get(task) ?? 0) + 1);
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
 * when both harnesses gave as many. A tie the test's own solves left without a valid answer is
 * still no "no valid answer" where another solve of the comparison gave one (`answered`).
 */
export function outcomesOf(events: readonly LogEvent[]): Map<string, Outcome> {
  const outcomes = new Map<string, Outcome>();
  for (const report of lastReports(events)) {
    const valid = answered(events, report.session);
    for (const pair of pairsReported(events, report)) {
      const won = pairings(pair);
      const tied = valid.has(pair.task) ? "tie" : "no-valid-answer";
      outcomes.set(pair.task, won.fresh === won.old ? tied : "won");
    }
    const aside = Array.isArray(report.data.aside) ? report.data.aside.filter(isString) : [];
    for (const task of aside) outcomes.set(task, "disputed");
  }
  return outcomes;
}

/**
 * The billed dollars a log holds for comparison `id`: every attempt of a solve whose start names
 * it, every reviewer's reading of such a solve, and, where a Builder session ran under the same id
 * (a round), everything billed from that session's start to its end, which is the session's own
 * turns, its practice solves and their reviewers. What another comparison or session billed since
 * is not this one's, so a comparison gone on from its log after others ran is held to its own
 * spend. A solve still running has written no sum yet, which is what a cap's reserve is for
 * (`src/builder/round.ts`).
 */
export function billedFor(events: readonly LogEvent[], id: string): number {
  const own = new Set(solvesIn(events).flatMap((solve) => (solve.start.comparison === id ? [solve.id] : [])));
  const session = (kind: string) =>
    events.findIndex((event) => event.kind === kind && event.data.session === id);
  const [opened, closed] = [session("build.started"), session(BUILD_FINISHED)];
  let billed = 0;
  for (const [index, { kind, data }] of events.entries()) {
    if (!BILLED.has(kind) || !isNumber(data.billed)) continue;
    const inSession = opened !== -1 && index >= opened && (closed === -1 || index <= closed);
    if (inSession || (isString(data.solve) && own.has(data.solve))) billed += data.billed;
  }
  return billed;
}
