/**
 * What an Examiner is told of the tasks its campaign holds: one outcome each.
 *
 * An Examiner session starts a new conversation, and since 2026-10-09 it is put to no solver either: a
 * task is held out on the shape of its package (`src/kernel/task.ts`), so nothing a session does
 * tells its author whether a task was any good. What tells it is the comparisons. The plan has the
 * author see every task of the campaign, the pack's and the ones earlier sessions wrote, the older
 * and easier ones included, each with its outcome so far: how the reference harness did on it in
 * the last comparison that scored it, valid in every solve, in some or in none, or disputed
 * (`docs/plan.md`, Phase 2; since 11 October, `docs/simplify.md` F3: "one harness won" and "no
 * valid answer yet" told the author nothing of where the room was). Beside the outcome, one fact
 * that names no side: whether a valid answer to the task is on record at all, a solve's or the
 * author's own `try_answer` pass (`feasibleTasks`), which tells a task the reference answers in no
 * solve apart from one nobody has answered. The aggregate comparison summary adds validity and
 * win/loss/tie counts for the whole comparison, without task or harness identifiers, from the
 * last scored comparison involving the current reference. Both views read the log and keep no
 * second store. Until that day a session was shown the pack's tasks by id and family alone,
 * and no outcome.
 *
 * Each sentence says what its fold does. Until 11 October the exhausted line said "answered by
 * both harnesses", where the rule reads the reference's own solves alone (`exhausted`,
 * `src/kernel/reports.ts`); the review of the buffer runs of that day found the two apart.
 *
 * What v1 recorded about this channel is kept. An author told a zone, a share or a target count
 * wrote towards it, and one told each answer's distance from its limit moved limits (v1
 * `AGENTS.md`, "Tried and taken out"; a judgement of v1's own Builder, which wrote and was scored
 * on its own exam, and no measurement of a separate author); the plan lists the difficulty band
 * among what it will not tell. So a line names no harness, no count of solves, no check and no
 * budget. The summary gives observed counts, not targets; two solves remain weak evidence.
 */
import { decidedByObjective, tally } from "../kernel/compare.ts";
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import {
  feasibleTasks,
  lastReports,
  type Outcome,
  outcomesOf,
  pairsReported,
  promoted,
} from "../kernel/reports.ts";
import { asRecord, isString } from "../meta/json-shape.ts";
import { taskStates } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";

/** How each outcome is said. */
export const SAID: Readonly<Record<Outcome, string>> = {
  "reference-every": "the reference harness answered it validly in every solve of the last comparison",
  "reference-some":
    "the reference harness answered it validly in some solves of the last comparison and not in others",
  "reference-none": "the reference harness answered it validly in no solve of the last comparison",
  "earlier-reference":
    "the last comparison that scored it was between two other harnesses, so the reference harness's own record on it is older or none",
  disputed: "disputed: a rejection of an answer to it is not settled",
  exhausted:
    "the reference harness answered it validly in every solve of two comparisons: no longer scored, unless it is among the third kept in the draw",
};
/** The one fact beside the outcome that names no side. */
const KNOWN = {
  yes: "a valid answer to it is on record",
  no: "no valid answer to it is on record",
} as const;
/** What a state that is not held out says of a task. */
const SETTLED = new Map([
  ["released", "in use as practice, and so never scored"],
  ["disputed", "disputed: a check was at fault on an answer to it"],
]);

/** Aggregate facts from the last scored comparison involving the current reference. Existing
 * readers own the counted solves and tally; no probe, answer, trace, harness identity or task
 * identifier enters this view (11 October). Counts stay comparison-wide: a singleton family
 * would reveal the other harness result for that task. */
export function comparisonSummary(events: readonly LogEvent[]): string[] {
  const reports = lastReports(events);
  const reference = promoted(events) ?? reports.map(({ data }) => data.starter).find(isString);
  if (!isString(reference)) return [];
  const report = reports.findLast(
    ({ data }) =>
      data.old !== data.fresh &&
      asRecord(data.scored) !== null &&
      Array.isArray(data.versions) &&
      data.versions.length > 0 &&
      (data.old === reference || data.fresh === reference),
  );
  if (report === undefined) return [];
  const pairs = pairsReported(events, report);
  if (pairs.length === 0) return [];
  const counts = { bothPass: 0, bothFail: 0, referenceOnly: 0, otherOnly: 0 };
  let validReference = 0;
  let validOther = 0;
  let solves = 0;
  for (const pair of pairs) {
    const own = report.data.old === reference ? pair.old : pair.fresh;
    const other = report.data.old === reference ? pair.fresh : pair.old;
    const passedReference = own.filter(Boolean).length;
    const passedOther = other.filter(Boolean).length;
    validReference += passedReference;
    validOther += passedOther;
    solves += own.length;
    counts.bothPass += passedReference * passedOther;
    counts.bothFail += (own.length - passedReference) * (other.length - passedOther);
    counts.referenceOnly += passedReference * (other.length - passedOther);
    counts.otherOnly += (own.length - passedReference) * passedOther;
  }
  const scored = tally(pairs);
  const wins = report.data.old === reference ? scored.wins : scored.losses;
  const losses = report.data.old === reference ? scored.losses : scored.wins;
  const excluded = ["aside", "disputed", "short", "withdrawn"].map((key) => {
    const versions = report.data[key];
    return `${key} ${Array.isArray(versions) ? versions.length : 0}`;
  });
  return [
    `The last scored comparison involving the current reference, under one setting. Counts describe repeated solves; solve pairings are not independent observations. These are measurements, not a target pass rate or difficulty band. Tasks excluded: ${excluded.join(", ")}.`,
    `${pairs.length} tasks; reference valid ${validReference}/${solves} solves; other valid ${validOther}/${solves} solves; solve pairings: both pass ${counts.bothPass}, both fail ${counts.bothFail}, reference only ${counts.referenceOnly}, other only ${counts.otherOnly}; other harness task wins ${wins}, losses ${losses}, ties ${scored.ties}; objective decided ${decidedByObjective(pairs)} tasks.`,
  ];
}

/** One line a task among `tasks`, in their order: the task by id and family, its outcome, and for
 *  a held-out task whether a valid answer to it is on record. A task the log refused is left out,
 *  since it is no task of the exam. One the log does not hold, and one no comparison has scored,
 *  is not yet compared. */
export function heard(
  events: readonly LogEvent[],
  tasks: readonly Pick<Task, "taskId" | "family">[],
): string[] {
  const states = taskStates(events);
  const outcomes = outcomesOf(events);
  const feasible = feasibleTasks(events);
  const versions = new Map(
    proposalsOf(events).flatMap(({ version, taskId, task }) => {
      const id = task?.taskId ?? taskId;
      return id === null ? [] : [[id, version] as const];
    }),
  );
  return tasks.flatMap(({ taskId, family }) => {
    const version = versions.get(taskId) ?? "";
    const state = states.get(version) ?? "";
    if (state === "refused") return [];
    const outcome = outcomes.get(version);
    const settled = SETTLED.get(state);
    if (settled !== undefined) return [`${taskId} (family ${family}): ${settled}`];
    const said = outcome === undefined ? "not yet compared" : SAID[outcome];
    return [`${taskId} (family ${family}): ${said}; ${feasible.has(version) ? KNOWN.yes : KNOWN.no}`];
  });
}
