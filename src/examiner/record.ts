/**
 * What a writing session is told of its campaign's past at its opening: a view of the log, with no
 * store of its own (`heard`), in four parts.
 *
 * - `last`: the last comparison the reference harness stood in, from its side: the tasks it scored,
 *   how many each harness won, the reference's every, some and none, the tasks set aside, and how
 *   often its own two solves differed in that comparison's A/A. On 2 November the archive's
 *   objective domains showed the reference's own solves differing on the objective alone on 314 of
 *   1,373 tasks, which the prompt then named as a count; the session's own comparison now says it.
 * - `groups`: every task under the reference's outcome in the last comparison that scored it, one
 *   block an outcome with a heading that says once what the block means. A line gives the task, then
 *   the turns each of the reference's valid answers took and, under an objective, what each measured,
 *   who won and on which measure (`carriedBy`), its last comparisons with the reference, whether a
 *   valid answer is on record where none of the reference's was valid, and the checks a ruling found
 *   at fault on an answer to it (`faultedOf`).
 * - `promoted`: that the reference was promoted, and how many tasks were held out before then.
 * - `refused`: the drafts the gate refused under the current reference, by reason.
 *
 * Until 4 November the opening carried a legend for every clause, the outcome on every line, the
 * gate's room solves, which no gate has run since 1 November, and the last session's note. An
 * earlier log's gate readings are read by `tools/wri/gate-era.ts`.
 *
 * On 5 November the overhaul took out three things #610 to #612 had added and no campaign had yet
 * run: the author's grade and sentence on each open task, a line of its tries of the reference (told
 * once, in `try_reference`'s reply), and a gap clause that said whether the reference's own two solves
 * or an answer on record made it. In its place a line gives the reference's measures, so a saturated
 * objective reads as "measured 1, 1": at jobstath2-fresh-opus-forkedPR608, 243 of 265 passing verdicts
 * measured exactly 1, and the record said nothing of it. The check a ruling found at fault is named
 * because at jobstat-fresh-opus-forkedPR607-r2 a later session wrote three more tasks that one frozen
 * check, ruled at fault on 10 answers, then refused.
 *
 * Reference measurements are told by epoch: on 16 October a session after a promotion read the
 * starter's admission counts as the new reference's. Nothing here names a harness, a check or a
 * target, and no count carries a band or a number to reach (the operator's decision of 11 October).
 */
import { scoresIn } from "../kernel/compare.ts";
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import {
  type History,
  lastReports,
  type Outcome,
  pairsReported,
  poolOf,
  referenceOf,
  type Standing,
} from "../kernel/reports.ts";
import { spreadOf } from "../kernel/size.ts";
import { solvesIn, verdictsOf } from "../kernel/solves.ts";
import { heldAtGate, taskStates } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";

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
function blockOf(state: string | undefined, outcome: Outcome | undefined): keyof typeof BLOCKS {
  if (state === "released") return "practice";
  if (state === "disputed") return "faulted";
  return outcome ?? "new";
}

/** A measure by the objective as the Examiner is told it, to six significant digits. */
export const measured = (measure: number): string => String(Number(measure.toPrecision(6)));

/** Every task among `tasks` under the reference's outcome on it, then the last comparison the
 *  reference stood in, the promotion and the refusals. A task the log refused is no task of the
 *  exam and has no line; one the log does not hold, as a pack's before `prepare.ts`, is not yet
 *  compared. */
export function heard(events: readonly LogEvent[], tasks: readonly Pick<Task, "taskId" | "family">[]) {
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
  const since = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const lines = new Map<string, string[]>();
  const listed: string[] = [];
  for (const { taskId, family } of tasks) {
    const proposal = proposals.get(taskId);
    const version = proposal?.version ?? "";
    const state = states.get(version);
    if (state === "refused") continue;
    const block = blockOf(state, pool.outcomes.get(version));
    if (block !== "practice") listed.push(version);
    const named = `${taskId} (${family})`;
    const plain = block === "practice" || block === "earlier-reference" || block === "faulted";
    const clauses = plain ? [] : clausesOf(block, pool, version, answered.get(version));
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
    last: lastLine(events),
    groups,
    promoted: promotedLine(events, since, listed),
    refused: refusedLines(events, since),
  };
}

/** What a task's line says after its name: the turns each of the reference's valid answers took and
 *  what each measured, whether a valid answer is on record where none of its solves was valid or
 *  none was read, who won and on which measure, and its last comparisons with the reference. */
function clausesOf(
  block: keyof typeof BLOCKS,
  pool: ReturnType<typeof poolOf>,
  version: string,
  { turns, measures }: Answered = { turns: [], measures: [] },
): string[] {
  const answered = block === "reference-every" || block === "reference-some";
  const sorted = (values: readonly number[]) => values.toSorted((a, b) => a - b);
  return [
    ...(answered && turns.length > 0 ? [`in ${sorted(turns).join(", ")} turns`] : []),
    ...(answered && measures.length > 0 ? [`measured ${sorted(measures).map(measured).join(", ")}`] : []),
    ...(answered
      ? []
      : [pool.feasible.has(version) ? "a valid answer on record" : "no valid answer on record"]),
    ...standingOf(pool.standings.get(version)),
    ...historyOf(pool.histories.get(version)),
  ];
}

/** The checks a ruling found at fault on an answer to each task, by its id: a solve's last
 *  `referee.finding`, the Referee's or the host's, where it is `check-defect`. Its reason is not told. */
function faultedOf(events: readonly LogEvent[]): Map<string, Set<string>> {
  const last = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "referee.finding" && isString(data.solve) ? [[data.solve, data]] : [],
    ),
  );
  const faulted = new Map<string, Set<string>>();
  for (const { ruling, task, check } of last.values()) {
    if (ruling !== "check-defect" || !isString(task) || !isString(check)) continue;
    faulted.set(task, new Set([...(faulted.get(task) ?? []), check]));
  }
  return faulted;
}

/** Who won a task in the last comparison that scored it and on which measure. Until 5 November
 *  the line also gave the objective gap the reference's answers left, which in a truss campaign of
 *  #588 came from its own two solves on all five such lines (WRI lane 14); its measures say that now. */
function standingOf(standing: Standing | undefined): string[] {
  if (standing === undefined) return [];
  return [
    standing.won === null
      ? "tied there"
      : `won there by ${WON[standing.won]}${standing.by === null ? "" : ` ${CARRIED[standing.by]}`}`,
  ];
}

/** A task's last comparisons with the reference harness, newest first, where it stood in at least
 *  two (`poolOf`, histories): each as every, some or none of the reference's solves valid, a limit
 *  that cut a solve named apart, and how many of the newest closed the task in a row. Which of them
 *  is too easy is the author's to judge. */
function historyOf(history: History | undefined): string[] {
  if (history === undefined || history.reads.length < 2) return [];
  const reads = history.reads.map(({ valid, cut }) => `${valid}${cut ? " (a solve cut at a limit)" : ""}`);
  const run = history.closedRun;
  return [
    `last ${String(reads.length)} comparisons, newest first: ${reads.join(", ")}`,
    ...(run === 0 ? [] : [`the last ${run === 1 ? "" : `${String(run)} in a row `}closed it`]),
  ];
}

/** The last comparison the reference harness stood in, from its side, or null before any: the
 *  tasks scored, the wins each way (from the per-task winners the lines already tell), its every,
 *  some and none, the tasks set aside, and how many of them its own two solves differed on. The
 *  A/A pairs the old side's solves with each other, so it measures the reference only there. No
 *  count of the other harness's valid solves is told. */
function lastLine(events: readonly LogEvent[]): string | null {
  const reference = referenceOf(events);
  const report = lastReports(events).findLast(
    ({ data }) => data.old === reference || data.fresh === reference,
  );
  if (report === undefined) return null;
  const side = report.data.fresh === reference ? "fresh" : "old";
  const spreads = pairsReported(events, report).map((pair) => spreadOf(pair[side]));
  const count = (spread: string) => String(spreads.filter((each) => each === spread).length);
  const scores = scoresIn(report.data.scored).map((score) => (side === "fresh" ? score : -score));
  const won = (sign: number) => String(scores.filter((score) => Math.sign(score) === sign).length);
  const aside = Array.isArray(report.data.aside) ? report.data.aside.length : 0;
  const own = side === "old" ? scoresIn(report.data.noise) : [];
  return [
    `The last comparison the reference harness stood in, ${report.session}, scored ${plural(spreads.length, "task")}: the reference harness won ${won(1)}, the harness it was compared with won ${won(-1)}, and ${won(0)} tied.`,
    `The reference harness was valid in every solve on ${count("every")} of them, in some on ${count("some")} and in none on ${count("none")}; ${String(aside)} more ${aside === 1 ? "was" : "were"} set aside.`,
    ...(own.length === 0
      ? []
      : [
          `Its own solves, set against each other there, differed on ${String(own.filter((score) => score !== 0).length)} of the ${String(own.length)}.`,
        ]),
  ].join(" ");
}

/** That the reference harness was promoted, on which comparison, and how many of the tasks
 *  `listed`, by version, were held out before then, under the harness it replaced. At esp32-fresh-opus-terra's x-4 (27
 *  October) the promoted harness answered all 22 listed tasks in 2 turns each, and the opening said
 *  nothing of the promotion: the session spent 362 minutes on ten drafts of one kind, each refused. */
function promotedLine(events: readonly LogEvent[], since: number, listed: readonly string[]): string | null {
  const promotion = events[since];
  if (promotion === undefined) return null;
  const under = new Set(
    events
      .slice(since)
      .flatMap(({ kind, data }) => (kind === "task.gate" && heldAtGate(data.outcome) ? [data.version] : [])),
  );
  const before = listed.filter((version) => !under.has(version)).length;
  const rests = promotion.data.rests;
  const on = Array.isArray(rests) ? asRecord(rests[0])?.comparison : undefined;
  return `The reference harness was promoted${isString(on) ? ` on the step of comparison ${on}` : ""}. ${String(before)} of the ${String(listed.length)} tasks listed were held out before then, under the harness it replaced. Files in your home from sessions before then were written while the harness it replaced was the reference.`;
}

/** The drafts the gate refused since the last promotion, grouped by its reason, an earlier log's
 *  room solves' among them in their own words. Until 14 October later sessions saw none of these
 *  drafts. */
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
  for (const report of lastReports(events, true)) {
    const side = report.data.fresh === reference ? "fresh" : report.data.old === reference ? "old" : null;
    for (const pair of pairsReported(events, report)) {
      const solves = side === null ? [] : (pair.solves?.[side] ?? []);
      const valid = solves.filter((_, nth) => side !== null && pair[side][nth] === true);
      const measures = valid.flatMap((solve) => {
        const checked = verdicts.get(solve)?.checker;
        return checked?.kind === "pass" && checked.objective !== undefined ? [checked.objective] : [];
      });
      answered.set(pair.task, { turns: valid.flatMap((solve) => took.get(solve) ?? []), measures });
    }
  }
  return answered;
}
