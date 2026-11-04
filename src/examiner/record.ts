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
 *   block an outcome with a heading that says once what the block means. A line gives the task, its
 *   author's grade and words while it is still open, and then the turns each valid answer took, who
 *   won and on which measure (`carriedBy`), an answer on record better by the objective than one of
 *   the reference's own (`room` of `poolOf`'s standings), its last comparisons with the reference,
 *   and whether a valid answer is on record where none of the reference's was valid.
 *   A line also says how the reference harness did on the task when its author tried it there before
 *   or after it put it (`try_reference`, `write.ts`), counted over the current reference's tries alone
 *   (`probed`): an author of a domain whose valid answers cannot be ordered could not see a failure
 *   coming, and wrote tasks the reference answered every time (4 November).
 * - `promoted`: that the reference was promoted, and how many tasks were held out before then.
 * - `refused`: the drafts the gate refused under the current reference, by reason.
 *
 * Until 4 November the opening carried a legend for every clause, the outcome on every line, the
 * gate's room solves, which no gate has run since 1 November, and the last session's note. At
 * jobstat-fresh-opus-forkedPR595's openings the reference answered most tasks in every solve and no
 * author's account of a draft stood beside what the reference then did on it; the claim (`write.ts`)
 * does. An earlier log's gate readings are read by `tools/wri/gate-era.ts`.
 *
 * Reference measurements are told by epoch: on 16 October a session after a promotion read the
 * starter's admission counts as the new reference's. Nothing here names a harness, a check or a
 * target, and no count carries a band or a number to reach (the operator's decision of 11 October).
 */
import { scoresIn } from "../kernel/compare.ts";
import { contentOf, type Proposal, proposalsOf } from "../kernel/history.ts";
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
import { examinerSessions, passed, solvesIn, verdictsOf } from "../kernel/solves.ts";
import { heldAtGate, taskStates } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";

/** One solve an Examiner session asked of the reference harness, as `probed` reads it. */
interface Tried {
  /** The id of the task it solved: the task's own, or the one its content names (`triedAs`). */
  readonly task: string;
  /** Where its start stands in the log. */
  readonly started: number;
  readonly valid: boolean;
  readonly turns: number | null;
  /** The verifier's measure of its valid answer by the objective, where the contract declares one. */
  readonly measure: number | null;
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

/** Every task among `tasks` under the reference's outcome on it, then the last comparison the
 *  reference stood in, the promotion and the refusals. A task the log refused is no task of the
 *  exam and has no line; one the log does not hold, as a pack's before `prepare.ts`, is not yet
 *  compared. */
export function heard(events: readonly LogEvent[], tasks: readonly Pick<Task, "taskId" | "family">[]) {
  const states = taskStates(events);
  const pool = poolOf(events);
  const frontier = new Set(pool.frontier);
  const proposals = new Map(
    proposalsOf(events).flatMap((proposal) => {
      const id = proposal.task?.taskId ?? proposal.taskId;
      return id === null ? [] : [[id, proposal] as const];
    }),
  );
  const turns = referenceTurns(events);
  const since = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const tries = triesOf(events, since, [...proposals.values()]);
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
    const claim = !plain && frontier.has(version) ? claimOf(proposal) : "";
    const clauses = plain ? [] : clausesOf(block, pool, version, turns.get(version) ?? []);
    const heading = BLOCKS[block];
    const line = [`${named}${claim}`, ...clauses, ...triedLine(tries.get(taskId))].join("; ");
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

/** What a task's line says after its name: the turns each of the reference's valid answers took,
 *  whether a valid answer is on record where none of its solves was valid or none was read, who
 *  won and on which measure, and its last comparisons with the reference. */
function clausesOf(
  block: keyof typeof BLOCKS,
  pool: ReturnType<typeof poolOf>,
  version: string,
  took: readonly number[],
): string[] {
  const answered = block === "reference-every" || block === "reference-some";
  return [
    ...(answered && took.length > 0 ? [`in ${took.toSorted((a, b) => a - b).join(", ")} turns`] : []),
    ...(answered
      ? []
      : [pool.feasible.has(version) ? "a valid answer on record" : "no valid answer on record"]),
    ...standingOf(pool.standings.get(version)),
    ...historyOf(pool.histories.get(version)),
  ];
}

/** The task id a try of the reference harness runs an instance under where the campaign holds no
 *  task of its content yet (`try_reference`, `write.ts`): named by that content, so that the line of
 *  the task the instance becomes finds the try (`triesOf`). */
export const triedAs = (content: string): string => `try-${content.slice(0, 12)}`;

/**
 * Every solve an Examiner session asked for that ended with a result, by its id: whether it was
 * valid, its turns and its measure. These are the reference harness's solves of
 * `try_reference`, and until 1 November the gate's room solves. Their starts name the session, so
 * no comparison, practice record or Builder reads them (`countedSolves`), while the campaign is
 * billed for them (`spendOf`). A non-result, or a solve with no ending yet, is no try.
 */
export function probed(events: readonly LogEvent[]): Map<string, Tried> {
  const sessions = examinerSessions(events);
  const verdicts = verdictsOf(events);
  return new Map(
    solvesIn(events).flatMap(({ id, started, start, ending, end }) => {
      const valid = passed({ ending });
      if (!sessions.has(start.comparison) || valid === null || !isString(start.task)) return [];
      const checked = verdicts.get(id)?.checker;
      const tried: Tried = {
        task: start.task,
        started,
        valid,
        turns: isNumber(end?.turns) ? end.turns : null,
        measure: checked?.kind === "pass" ? (checked.objective ?? null) : null,
      };
      return [[id, tried] as const];
    }),
  );
}

/** The tries of the reference harness since the last promotion, by the id of the task each line
 *  names: a try of an instance before it was put is found by its content (`triedAs`). A try of the
 *  harness a promotion replaced tells nothing of the reference now. */
function triesOf(events: readonly LogEvent[], since: number, proposals: readonly Proposal[]) {
  const became = new Map(
    proposals.flatMap(({ task }) =>
      task === null ? [] : [[triedAs(contentOf(task)), task.taskId] as const],
    ),
  );
  const tries = new Map<string, Tried[]>();
  for (const tried of probed(events).values()) {
    if (tried.started < since) continue;
    const task = became.get(tried.task) ?? tried.task;
    tries.set(task, [...(tries.get(task) ?? []), tried]);
  }
  return tries;
}

/** How the reference harness did on a task when its author tried it there: how many of the tries
 *  were valid, and in how many turns each valid one was. */
function triedLine(tries: readonly Tried[] | undefined): string[] {
  if (tries === undefined) return [];
  const valid = tries.filter((tried) => tried.valid);
  const took = valid.flatMap(({ turns }) => (turns === null ? [] : [turns])).toSorted((a, b) => a - b);
  return [
    `tried at writing: valid in ${String(valid.length)} of ${String(tries.length)}${took.length === 0 ? "" : `, in ${took.join(", ")} turns`}`,
  ];
}

/** What an author said of its draft when it put it, or nothing where it said nothing, as a draft
 *  from before 4 November did. */
function claimOf(proposal: Proposal | undefined): string {
  const claim = proposal?.claim;
  return claim === null || claim === undefined
    ? ""
    : `, graded ${String(claim.grade)} by its author: "${claim.stops}"`;
}

/** Who won a task in the last comparison that scored it and on which measure, and an answer on
 *  record better by the objective than one of the reference's own. */
function standingOf(standing: Standing | undefined): string[] {
  if (standing === undefined) return [];
  const won =
    standing.won === null
      ? "tied there"
      : `won there by ${WON[standing.won]}${standing.by === null ? "" : ` ${CARRIED[standing.by]}`}`;
  // A share as a percentage of two significant digits.
  const room = Number(((standing.room ?? 0) * 100).toPrecision(2));
  return [won, ...(room > 0 ? [`an answer on record ${String(room)}% better than one of its own`] : [])];
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

/** The turns of the reference harness's valid answers to each task in the last comparison that
 *  tallied it, including historical ladder reports as `poolOf` does for its outcome, from the side
 *  it stood on there, and none where it stood on neither. */
function referenceTurns(events: readonly LogEvent[]): Map<string, number[]> {
  const reference = referenceOf(events);
  const took = new Map(
    solvesIn(events).flatMap(({ id, end }) => (isNumber(end?.turns) ? [[id, end.turns] as const] : [])),
  );
  const turns = new Map<string, number[]>();
  for (const report of lastReports(events, true)) {
    const side = report.data.fresh === reference ? "fresh" : report.data.old === reference ? "old" : null;
    for (const pair of pairsReported(events, report)) {
      const solves = side === null ? [] : (pair.solves?.[side] ?? []);
      turns.set(
        pair.task,
        solves.flatMap((solve, nth) =>
          side !== null && pair[side][nth] === true ? (took.get(solve) ?? []) : [],
        ),
      );
    }
  }
  return turns;
}
