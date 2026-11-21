/**
 * What a writing session is told of its campaign's past at its opening, and at a wake what came
 * since (`after`): a view of the log, with no store of its own (`heard`), in four parts.
 *
 * - `stood`: the comparisons the reference harness stood in that the session has not heard of, each
 *   from its side: the tasks it scored and how many its largest family held, how many each harness
 *   won, the reference's every, some and none, the tasks set aside, and how often its own two solves
 *   differed in that comparison's A/A. An opening tells the last one, and a wake each since it was
 *   last told. The reference's own solves often differ on the objective alone, and the session's own
 *   comparison says how often, rather than a count from the archive.
 * - `groups`: every task under the reference's outcome in the last comparison that scored it, one
 *   block an outcome with a heading that says once what the block means. A line gives the task, then
 *   the turns each of the reference's valid answers took and, under an objective, what each measured,
 *   who won and on which measure (`carriedBy`), whether a valid answer is on record where none of the
 *   reference's was valid, and the checks a ruling found at fault on an answer to it (`faultedOf`).
 * - `promoted`: at an opening and at the first wake after a promotion, that the reference was
 *   promoted, and how many tasks were held out before then.
 * - `refused`: at an opening alone, the drafts the gate refused since that promotion, by its reason.
 *
 * A conversation hears each reading at the wake after it, so an opening tells no task's earlier
 * comparisons. A live conversation
 * hears each refusal from the gate, so a wake repeats none, but one that crashed or met a limit
 * opens afresh from the log (`AGENTS.md`, section 4) and has that record of them alone. A wake
 * after a promotion says it, as an opening does.
 *
 * The record carries no legend, no grade or sentence of the author's on a task, and no line of its
 * tries of the reference, which `try_reference`'s reply tells once. An older log's gate readings are
 * read by `tools/wri/gate-era.ts`. A line gives the reference's measures, so a saturated objective
 * reads as "measured 1, 1" instead of passing unremarked. The check a ruling found at fault is
 * named, so that a later session does not write more tasks that the same frozen check refuses.
 *
 * Reference measurements are told by epoch, so a session after a promotion does not read the
 * starter's admission counts as the new reference's. Nothing here names a harness or a target, no
 * check but one a ruling found at fault, and no count carries a band or a number to reach (the
 * operator's decision).
 */
import { scoresIn } from "../kernel/compare.ts";
import { familySizes, proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import {
  lastReports,
  type Outcome,
  pairsReported,
  poolOf,
  referenceOf,
  type Reported,
  type Standing,
} from "../kernel/reports.ts";
import { howOftenValid } from "../kernel/size.ts";
import { solvesIn, standsOf, verdictsOf } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import { objectiveOf, type Task } from "../kernel/verify.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import { tasksByEpoch } from "../campaign/climb.ts";

/** The reference harness's valid answers to a task in the last comparison that tallied it: the
 *  turns each took and, where the contract declares an objective, what each measured. */
interface Answered {
  readonly turns: readonly number[];
  readonly measures: readonly number[];
}

/** Each block's heading, in the order the opening tells them. A task's line repeats none of it. */
const BLOCKS = {
  "reference-none": "The reference harness valid in no solve of the last comparison that scored the task",
  "reference-some": "Valid in some solves of it",
  "reference-every": "Valid in every solve of it",
  closed:
    "Closed: valid in every solve of its last two comparisons with no room left by the objective, so now scored only as a check against regressions",
  new: "Not yet compared",
  disputed: "Set aside until a person settles a rejection of an answer to it",
  faulted: "Disputed: a check was at fault on an answer to it",
  "earlier-reference": "Last compared between two other harnesses",
  practice: "In use as practice, and so never scored",
} as const;
/** Which measure of a task's score carried a win (`carriedBy`). */
const CARRIED = { validity: "on validity", objective: "on the objective" } as const;
/** Who won a task, as the reference's side reads it. */
const WON = { reference: "the reference harness", other: "the harness it was compared with" } as const;

/** The block a task stands in: its state first, then the reference's outcome on it. */
function blockOf(state: string | undefined, outcome: Outcome | "closed" | undefined): keyof typeof BLOCKS {
  if (state === "released") return "practice";
  if (state === "disputed") return "faulted";
  return outcome ?? "new";
}

/** A measure by the objective as the Examiner is told it, to six significant digits. */
export const measured = (measure: number): string => String(Number(measure.toPrecision(6)));

/** Every task among `tasks` under the reference's outcome on it, then the last comparison the
 *  reference stood in and the promotion; with `after`, only what came after that event. A task the
 *  log refused is no task of the exam and has no line; one the log does not hold, as a pack's before
 *  `prepare.ts`, is not yet compared. */
export function heard(
  events: readonly LogEvent[],
  tasks: readonly Pick<Task, "taskId" | "family">[],
  after?: number,
) {
  const states = taskStates(events);
  const pool = poolOf(events);
  const proposals = new Map(
    proposalsOf(events).flatMap((proposal) => {
      const id = proposal.task?.taskId ?? proposal.taskId;
      return id === null ? [] : [[id, proposal] as const];
    }),
  );
  const answered = referenceAnswers(events);
  const faulted = faultedOf(events);
  const setting = events.findLast(({ kind }) => kind === "campaign.setting")?.data.modelTurns;
  const budget = isNumber(setting) ? setting : undefined;
  const since = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const compared = after === undefined ? null : reportedAfter(events, after);
  const lines = new Map<string, string[]>();
  const listed: string[] = [];
  for (const { taskId, family } of tasks) {
    const proposal = proposals.get(taskId);
    const version = proposal?.version ?? "";
    const state = states.get(version);
    if (state === "refused" || compared?.has(version) === false) continue;
    const block = blockOf(state, pool.exhausted.includes(version) ? "closed" : pool.outcomes.get(version));
    if (block !== "practice") listed.push(version);
    const named = `${taskId} (${family})`;
    const plain = block === "practice" || block === "earlier-reference" || block === "faulted";
    const clauses = plain ? [] : clausesOf(block, pool, version, answered.get(version), budget);
    const checks = faulted.get(taskId);
    const fault =
      checks === undefined ? [] : [`ruled at fault on an answer to it: ${[...checks].join(", ")}`];
    const heading = BLOCKS[block];
    const line = [named, ...clauses, ...fault].join("; ");
    lines.set(heading, [...(lines.get(heading) ?? []), line]);
  }
  const groups = Object.values(BLOCKS).flatMap((heading): { heading: string; lines: string[] }[] => {
    const held = lines.get(heading) ?? [];
    return held.length === 0 ? [] : [{ heading, lines: held }];
  });
  return {
    stood: stoodLines(events, after),
    groups,
    // An opening's, and a wake's where the promotion came after the conversation last heard.
    promoted: after === undefined || since > after ? promotedLine(events, since, listed) : null,
    refused: after === undefined ? refusedLines(events, since) : [],
  };
}

/** The drafts the gate refused after event `since`, under its reason, each by its id and family. */
function refusedLines(events: readonly LogEvent[], since: number): string[] {
  const drafts = new Map(proposalsOf(events).map(({ version, task }) => [version, task]));
  const why = new Map<string, string[]>();
  for (const { kind, data } of events.slice(since + 1)) {
    const task = isString(data.version) ? drafts.get(data.version) : undefined;
    if (kind !== "task.gate" || data.outcome !== "refused" || !isString(data.reason)) continue;
    if (task === undefined || task === null) continue;
    why.set(data.reason, [...(why.get(data.reason) ?? []), `${task.taskId} (${task.family})`]);
  }
  return [...why].map(([reason, named]) => `${reason}: ${named.join(", ")}`);
}

/** The task versions of the comparisons first reported after event `after`, each at its last report,
 *  as `stoodLines` reads them: a resumed comparison's second report or a ladder's adds none. */
const reportedAfter = (events: readonly LogEvent[], after: number) =>
  new Set(
    lastReports(events)
      .filter(({ index }) => index >= after)
      .flatMap(({ data }) => (Array.isArray(data.versions) ? data.versions.filter(isString) : [])),
  );

/** What a task's line says after its name: the turns each of the reference's valid answers took and
 *  what each measured, beside the best of its author's answers on record (`task.feasible`), whether
 *  a valid answer is on record where none of its solves was valid or
 *  none was read, and who won and on which measure. */
function clausesOf(
  block: keyof typeof BLOCKS,
  pool: ReturnType<typeof poolOf>,
  version: string,
  { turns, measures }: Answered = { turns: [], measures: [] },
  budget?: number,
): string[] {
  const answered = block === "reference-every" || block === "reference-some" || block === "closed";
  const best = pool.bests.get(version);
  const sorted = (values: readonly number[]) => values.toSorted((a, b) => a - b);
  return [
    ...(answered && turns.length > 0
      ? [`in ${sorted(turns).join(", ")}${budget === undefined ? "" : ` of ${String(budget)}`} turns`]
      : []),
    ...(answered && measures.length > 0 ? [`measured ${sorted(measures).map(measured).join(", ")}`] : []),
    ...(answered && measures.length > 0 && best !== undefined
      ? [`the author's answer measured ${measured(best)}`]
      : []),
    ...(answered
      ? []
      : [pool.feasible.has(version) ? "a valid answer on record" : "no valid answer on record"]),
    ...standingOf(pool.standings.get(version)),
  ];
}

/** The checks a ruling found at fault on an answer to each task, by its id: where what stands of a
 *  solve's rejection (`standsOf`, rule 8) is `check-defect`, the task and the check its last
 *  `referee.finding` names, the Referee's or the host's. Its reason is not told. */
function faultedOf(events: readonly LogEvent[]): Map<string, Set<string>> {
  const last = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "referee.finding" && isString(data.solve) ? [[data.solve, data]] : [],
    ),
  );
  const stands = standsOf(events);
  const faulted = new Map<string, Set<string>>();
  for (const [solve, { task, check }] of last) {
    if (stands.get(solve) !== "check-defect" || !isString(task) || !isString(check)) continue;
    faulted.set(task, new Set([...(faulted.get(task) ?? []), check]));
  }
  return faulted;
}

/** Who won a task in the last comparison that scored it and on which measure. The objective gap
 *  the reference's answers left is told by its measures rather than a clause, since that gap often
 *  came from its own two solves. */
function standingOf(standing: Standing | undefined): string[] {
  if (standing === undefined) return [];
  return [
    standing.won === null
      ? "tied there"
      : `won there by ${WON[standing.won]}${standing.by === null ? "" : ` ${CARRIED[standing.by]}`}`,
  ];
}

/** The comparisons the reference harness stood in that a session has not heard of, or null where
 *  there are none: the last at an opening, whose record lists every task, and at a wake each one
 *  reported since `after`, so a wake after two readings does not miss the one that read the new
 *  reference against the starter. */
function stoodLines(events: readonly LogEvent[], after: number | undefined): string | null {
  const reference = referenceOf(events);
  const stood = lastReports(events).filter(({ data }) => data.old === reference || data.fresh === reference);
  const told = after === undefined ? stood.slice(-1) : stood.filter(({ index }) => index >= after);
  if (told.length === 0) return null;
  const named = ({ session }: Reported) =>
    after === undefined
      ? `The last comparison the reference harness stood in, ${session}`
      : `Comparison ${session}, which the reference harness stood in`;
  return told.map((report) => stoodLine(events, report, reference, named(report))).join("\n\n");
}

/** One comparison the reference harness stood in, from its side: the tasks scored and how many of
 *  them its largest family held (`familySizes`, which leaves out a task that names none), the wins
 *  each way (from the per-task winners the lines already tell), its every, some and none, the tasks
 *  set aside, and how many of them its own two solves differed on. The A/A pairs the old side's
 *  solves with each other, so it measures the reference only there. No count of the other harness's
 *  valid solves is told. */
function stoodLine(
  events: readonly LogEvent[],
  report: Reported,
  reference: string | null,
  named: string,
): string {
  const side = report.data.fresh === reference ? "fresh" : "old";
  const pairs = pairsReported(events, report);
  const spreads = pairs.map((pair) => howOftenValid(pair[side]));
  const largest =
    familySizes(
      events,
      pairs.map(({ task }) => task),
    ).sizes[0] ?? 0;
  const count = (spread: string) => String(spreads.filter((each) => each === spread).length);
  const scores = scoresIn(report.data.scored).map((score) => (side === "fresh" ? score : -score));
  const won = (sign: number) => String(scores.filter((score) => Math.sign(score) === sign).length);
  const aside = Array.isArray(report.data.aside) ? report.data.aside.length : 0;
  const own = side === "old" ? scoresIn(report.data.noise) : [];
  return [
    `${named}, scored ${plural(spreads.length, "task")}: the reference harness won ${won(1)}, the harness it was compared with won ${won(-1)}, and ${won(0)} tied.`,
    `The largest family among them held ${String(largest)}.`,
    `The reference harness was valid in every solve on ${count("every")} of them, in some on ${count("some")} and in none on ${count("none")}; ${String(aside)} more ${aside === 1 ? "was" : "were"} set aside.`,
    ...(own.length === 0
      ? []
      : [
          `Its own solves, set against each other there, differed on ${String(own.filter((score) => score !== 0).length)} of the ${String(own.length)}.`,
        ]),
  ].join(" ");
}

/** That the reference harness was promoted, on which comparison, and how many of the tasks
 *  `listed`, by version, were held out before then, under the harness it replaced, since a session
 *  not told of a promotion can spend hours drafting tasks the new reference answers at once. */
function promotedLine(events: readonly LogEvent[], since: number, listed: readonly string[]): string | null {
  const promotion = events[since];
  if (promotion === undefined) return null;
  const under = new Set(tasksByEpoch(events.slice(since)).flat());
  const before = listed.filter((version) => !under.has(version)).length;
  const rests = promotion.data.rests;
  const on = Array.isArray(rests) ? asRecord(rests[0])?.comparison : undefined;
  return `The reference harness was promoted${isString(on) ? ` on the step of comparison ${on}` : ""}. ${String(before)} of the ${String(listed.length)} tasks listed were held out before then, under the harness it replaced. Files in your home from sessions before then were written while the harness it replaced was the reference.`;
}

/** The reference harness's valid answers to each task in the last comparison that tallied it
 *  (`Answered`), including historical ladder reports as `poolOf` does for its outcome, from the side
 *  it stood on there, and none where it stood on neither. */
function referenceAnswers(events: readonly LogEvent[]): Map<string, Answered> {
  const reference = referenceOf(events);
  const took = new Map(
    solvesIn(events).flatMap(({ id, end }) => (isNumber(end?.turns) ? [[id, end.turns] as const] : [])),
  );
  const verdicts = verdictsOf(events);
  const answered = new Map<string, Answered>();
  for (const report of lastReports(events, "all")) {
    const side = report.data.fresh === reference ? "fresh" : report.data.old === reference ? "old" : null;
    for (const pair of pairsReported(events, report)) {
      const solves = side === null ? [] : (pair.solves?.[side] ?? []);
      const valid = solves.filter((_, nth) => side !== null && pair[side][nth] === true);
      const measures = valid.flatMap((solve) => objectiveOf(verdicts.get(solve)?.checker) ?? []);
      answered.set(pair.task, { turns: valid.flatMap((solve) => took.get(solve) ?? []), measures });
    }
  }
  return answered;
}
