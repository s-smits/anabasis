/**
 * What an Examiner is told of its campaign's past at a session's opening: a view of the log, with
 * no store of its own (`heard`).
 *
 * - One line per task, in task order. Tasks last compared between two other harnesses share a line
 *   where there is nothing more to report. Each line gives the current reference's result in the
 *   last comparison that scored the task (every, some or no solve valid, or disputed), the turns
 *   each valid answer took, the winner and deciding measure (`carriedBy`), any objective improvement
 *   on record over a reference answer (`room` of `poolOf`'s standings), and the admission counts
 *   and turns. It also gives comparison history where there are at least two readings, and whether
 *   a valid answer is on record where the other facts show none (`poolOf`). Winning alone does not
 *   explain the source of room (`7f0add79:docs/simplify.md`, F3). Naming the measure distinguishes
 *   method gains from the 25 bill-only wins recorded in buffer-fresh-opus-v065-a's g-3 (26 October).
 * - One summary of the reference across the exam (`measuredLine`): tasks in its last comparison,
 *   grouped by every, some or no solve valid; and drafts admitted under it, grouped by source of
 *   room. Across 26 October's buffer runs it was valid in 93 to 100% of each comparison's solves while most
 *   drafts were held on the objective alone, and an author reading sixty lines saw neither.
 * - Drafts refused after evaluation, grouped by reason (`refusedLines`), and interrupted admissions,
 *   listed by draft (`interruptedLines`).
 *
 * Until 26 October the opening also held a table of the tasks by family where winners were hidden, a
 * count of the task admissions read on a replaced reference, and the turns by family in a block of their
 * own. At forkedPR377's x-6 the table took 2,636 of the opening's 21,705 bytes and no turn of seven
 * sessions cited it; the turns now stand on the line of the task they were taken on.
 *
 * Reference measurements are told by epoch: on 16 October a session after a promotion read the
 * starter's admission counts as the new reference's. Admissions before the last promotion therefore
 * contribute no counts or turns. Nothing here names a harness, a check or a target, and no count carries a band or
 * a number to reach (the operator's decision of 11 October).
 */
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import {
  type History,
  lastReports,
  type Outcome,
  poolOf,
  pairsReported,
  referenceOf,
} from "../kernel/reports.ts";
import { BILLED } from "../kernel/trace.ts";
import { conditionsOf } from "../kernel/condition.ts";
import { examinerSessions, solvesIn, verdictsOf } from "../kernel/solves.ts";
import { spreadOf } from "../kernel/size.ts";
import { heldAtGate, taskStates } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";

/** At most three room solves per draft; the task admission stops at the first reading that leaves room. */
export const TRIED = 3;
/** Why a draft is not measured where the campaign's budget holds no reserve for its next solve. */
export const UNAFFORDED =
  "the campaign's budget holds no reserve for the reference harness's next solve of it beside the solves running, so it is not measured";

/** One valid answer of the reference at a task admission. */
interface RoomAnswer {
  readonly turns: number | null;
  readonly seconds: number | null;
  readonly measure: number | null;
}

/** How each outcome is said. */
const SAID: Readonly<Record<Outcome, string>> = {
  "reference-every": "valid in every solve",
  "reference-some": "valid in some solves",
  "reference-none": "valid in no solve",
  "earlier-reference": "last compared between two other harnesses",
  disputed: "disputed: a rejection of an answer to it is not settled",
};
/** Where a held draft's room came from, as `informative` reads room solves: the clause the
 *  task admission says of a draft it holds (`measured`, `write.ts`), and the kinds the measurement counts. */
const HELD_ON = {
  validity: "on validity, its solves valid in some and not all",
  yours: "on an answer of yours, where none of its solves was valid",
  objective: "on the objective alone, every one of its solves valid",
} as const;
/** Which measure of a task's score carried a win (`carriedBy`): a step must also clear its level
 *  with the bill's points taken out (`stepOf`), so wins the bill alone carried cannot make one. */
const CARRIED = {
  validity: "on validity",
  objective: "on the objective",
  bill: "on the bill alone",
} as const;

/** The clauses some line carries, so the legend explains those and no other: at job-fresh-opus-v071's
 *  x-4 it explained a task admission and a history no line held, and said on each of seven lines what a win on
 *  the bill alone means (26 October). */
interface Carried {
  admission: boolean;
  history: boolean;
  bill: boolean;
}

/** What the lines say before them: once, what each clause some line carries means. */
function legendOf(carried: Carried): string {
  const clauses = [
    carried.bill
      ? `A win "on the bill alone" is one only the cost of its solves carried; a step is also read without the bill.`
      : "",
    carried.admission
      ? `"Gate" is how many of the reference harness's solves at its gate were valid, of the solves it ran, at most ${String(TRIED)}, and their turns.`
      : "",
    carried.history
      ? `"Last comparisons" are its valid solves in each of its last comparisons with the current reference harness, newest first, and how many of the newest closed the task in a row.`
      : "",
  ].filter((clause) => clause !== "");
  return [
    `The tasks of the exam so far, a line each: the task, its family, and how the reference harness did on it in the last comparison that scored it, with the solver's own turns each of its valid answers took, and who won it there, and on which measure: the other harness, whichever the reference harness was compared with, the reference harness, or neither. Where nothing on the line shows a valid answer, it says whether one is on record.`,
    ...clauses,
    "These are measurements and no instruction. read_example returns any of them whole.",
  ].join(" ");
}

/** How an author's answer at a task admission stood against the reference harness's best valid answer by
 *  the objective, or against its worst (`of`), as a share of the larger magnitude (`gainOver`,
 *  `seenOf` in `write.ts`). Room is read against any one of its answers, so the worst decides it. */
export function gapSaid(gap: number, of: "best" | "worst" = "best"): string {
  return gap === 0
    ? `the same as its ${of}`
    : `${percent(gap)} ${gap > 0 ? "better" : "worse"} than its ${of}`;
}

/** Classify an admitted draft's room from the number of valid reference solves. */
export function heldOn(valid: number, solves: number): string {
  if (valid === 0) return HELD_ON.yours;
  return valid < solves ? HELD_ON.validity : HELD_ON.objective;
}

/** Whether a task admission read its draft: one refused on fewer than the reference harness's `TRIED`
 *  readings, cut by a limit or never begun for want of the reserve, refused a draft it did not read,
 *  which may be proposed again and is solved afresh (14 October). A task admission that read all three, held
 *  its draft, or refused the package on its shape check, stands. */
export function measuredGate(data: JsonObject): boolean {
  const solves = asRecord(data.reference)?.solves;
  return !(
    data.outcome === "refused" &&
    ((isNumber(solves) && solves < TRIED) ||
      (isString(data.reason) && data.reason.endsWith("so it is not measured")))
  );
}

/** A share as a percentage of two significant digits, without its sign. */
function percent(share: number): string {
  return `${String(Number((Math.abs(share) * 100).toPrecision(2)))}%`;
}

/** The turns of some valid answers, fewest first, as a clause, or nothing where there are none. */
function inTurns(turns: readonly number[]): string {
  return turns.length === 0 ? "" : `, in ${turns.toSorted((a, b) => a - b).join(", ")} turns`;
}

/** How far the author's answer stood from the reference harness's best at the task admission, where the task admission
 *  measured both (`reference.gap`, `task.gate`). */
function yoursSaid(reference: unknown): string {
  const gap = asRecord(reference)?.gap;
  return isNumber(gap) ? `, yours ${gapSaid(gap)}` : "";
}

/** One line a task among `tasks`, in their order (the module's head comment says what each holds),
 *  then those last compared between two other harnesses with nothing more to say, grouped, and the
 *  practice tasks in one line. A task the log refused is no task of the exam and has no line; one
 *  the log does not hold, as a pack's before `prepare.ts`, is not yet compared. */
export function heard(events: readonly LogEvent[], tasks: readonly Pick<Task, "taskId" | "family">[]) {
  const states = taskStates(events);
  const { outcomes, standings, feasible, histories } = poolOf(events);
  const versions = new Map(
    proposalsOf(events).flatMap(({ version, taskId, task }) => {
      const id = task?.taskId ?? taskId;
      return id === null ? [] : [[id, version] as const];
    }),
  );
  const since = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const last = lastAdmissions(events);
  const admissions: ReadonlyMap<string, JsonObject> = new Map(
    [...last].flatMap(([version, { data, at }]) => (at > since ? [[version, data] as const] : [])),
  );
  const compared = referenceTurns(events);
  const roomAnswers = gateAnswers(events, since);
  const practice: string[] = [];
  // Count listed tasks admitted under the current reference separately from those admitted before it.
  let under = 0;
  let listed = 0;
  const carried: Carried = { admission: false, history: false, bill: false };
  const elsewhere = new Map<string, string[]>();
  const lines = tasks.flatMap(({ taskId, family }) => {
    const version = versions.get(taskId) ?? "";
    const state = states.get(version);
    const named = `${taskId} (${family})`;
    if (state === "refused") return [];
    if (state === "released") {
      practice.push(named);
      return [];
    }
    listed += 1;
    if (state === "disputed") return [`${named}: disputed: a check was at fault on an answer to it`];
    const outcome = outcomes.get(version);
    const answered = outcome === "reference-every" || outcome === "reference-some";
    const said = outcome === undefined ? "not yet compared" : SAID[outcome];
    if (heldAtGate(admissions.get(version)?.outcome)) under += 1;
    const admission = admissionLine(
      admissions.get(version),
      (roomAnswers.get(version) ?? []).flatMap(({ turns }) => turns ?? []),
    );
    const known =
      answered || admission.valid > 0
        ? ""
        : `; ${feasible.has(version) ? "an answer on record" : "no answer on record"}`;
    const standing = standings.get(version);
    const won =
      standing === undefined
        ? ""
        : standing.won === null
          ? "; tied there"
          : `; won there by the ${standing.won} harness${standing.by === null ? "" : ` ${CARRIED[standing.by]}`}`;
    const objectiveGap =
      (standing?.room ?? 0) > 0
        ? `; an answer on record ${percent(standing?.room ?? 0)} better than one of its own`
        : "";
    const history = historyLine(histories.get(version));
    const rest = `${won}${objectiveGap}${admission.said}${history}`;
    // A task last compared between two other harnesses, with nothing more to say of it, is one id in
    // a line: at forkedPR377's x-7, 50 such lines repeated each session's.
    if (outcome === "earlier-reference" && rest === "") {
      elsewhere.set(known, [...(elsewhere.get(known) ?? []), named]);
      return [];
    }
    carried.admission ||= admission.said !== "";
    carried.history ||= history !== "";
    carried.bill ||= won !== "" && standing?.by === "bill";
    return [`${named}: ${said}${answered ? inTurns(compared.get(version) ?? []) : ""}${known}${rest}`];
  });
  return {
    legend: legendOf(carried),
    lines: [
      ...lines,
      ...[...elsewhere].map(
        ([known, named]) => `Last compared between two other harnesses${known}: ${named.join(", ")}.`,
      ),
      ...(practice.length === 0 ? [] : [`In use as practice, and so never scored: ${practice.join(", ")}.`]),
    ],
    promoted: promotedLine(events[since], listed - under, listed),
    measured: measuredLine(events, admissions),
    refused: refusedLines(events, admissions, roomAnswers),
    interrupted: interruptedLines(events, last, since),
  };
}

/** That the reference harness was promoted, on which comparison, and how many of the `listed` tasks
 *  were held out under the harness it replaced. At esp32-fresh-opus-terra's x-4 (27 October) the
 *  promoted harness answered all 22 listed tasks in 2 turns each, and the opening said nothing of the
 *  promotion: the session spent 362 minutes on ten drafts of one kind, each refused. */
function promotedLine(promotion: LogEvent | undefined, before: number, listed: number): string | null {
  if (promotion === undefined) return null;
  const rests = promotion.data.rests;
  const on = Array.isArray(rests) ? asRecord(rests[0])?.comparison : undefined;
  return `The reference harness was promoted${isString(on) ? ` on the step of comparison ${on}` : ""}. ${String(before)} of the ${String(listed)} tasks listed were held out before then, under the harness it replaced; a line reads the harness that is the reference now wherever it stood in the comparison that last scored the task. Files in your home from sessions before then were written against the harness it replaced.`;
}

/** Each proposed version's last task admission, with where it stands in the log. */
function lastAdmissions(
  events: readonly LogEvent[],
): Map<string, { readonly data: JsonObject; readonly at: number }> {
  return new Map(
    events.flatMap(({ kind, data }, at) =>
      kind === "task.gate" && isString(data.version) ? [[data.version, { data, at }] as const] : [],
    ),
  );
}

/** Summarise a held task's admission: valid reference solves, their turns and any non-results.
 *  Omit the clause where no solve counts were recorded. Since 20 October admission stops once the
 *  completed solves leave room; earlier admissions ran all `TRIED` solves. */
function admissionLine(admission: JsonObject | undefined, turns: readonly number[]) {
  const reference = asRecord(admission?.reference);
  const { valid, solves, ran = TRIED } = reference ?? {};
  if (
    admission === undefined ||
    !heldAtGate(admission.outcome) ||
    !isNumber(solves) ||
    !isNumber(valid) ||
    !isNumber(ran)
  ) {
    return { said: "", valid: 0 };
  }
  const unread = solves < ran ? `, ${String(ran - solves)} giving no reading` : "";
  return {
    said: `; gate ${String(valid)} of ${String(ran)} valid${unread}${inTurns(turns)}${yoursSaid(reference)}`,
    valid,
  };
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

/** A task's last comparisons with the reference harness, newest first, as one clause after its
 *  line, or nothing where it stood in fewer than two (`poolOf`, histories): each as every, some or
 *  none of the reference's solves valid, a limit that cut a solve named apart, and how many of the
 *  newest closed the task in a row. Which of them is too easy is the author's to judge. */
function historyLine(history: History | undefined): string {
  if (history === undefined || history.reads.length < 2) return "";
  const reads = history.reads.map(({ valid, cut }) => `${valid}${cut ? " (a solve cut at a limit)" : ""}`);
  const run =
    history.closedRun === 0
      ? ""
      : `; the last ${history.closedRun === 1 ? "" : `${String(history.closedRun)} in a row `}closed it`;
  return `; last ${String(reads.length)} comparisons: ${reads.join(", ")}${run}`;
}

/** Summarise the current reference's last comparison, whichever side it took: tasks with every,
 *  some or no solve valid, with set-aside tasks counted separately. Report task counts, never solve
 *  counts, which could reveal one task's result. Also summarise drafts admitted under this
 *  reference by source of room (`heldOn`), and measured refusals. Null where neither is recorded. */
function measuredLine(
  events: readonly LogEvent[],
  admissions: ReadonlyMap<string, JsonObject>,
): string | null {
  const reference = referenceOf(events);
  const report = lastReports(events).findLast(
    ({ data }) => data.old === reference || data.fresh === reference,
  );
  const side = report?.data.fresh === reference ? "fresh" : "old";
  const reads = report === undefined ? [] : pairsReported(events, report).map((pair) => pair[side]);
  const aside = Array.isArray(report?.data.aside) ? report.data.aside.length : 0;
  const some = reads.filter((each) => spreadOf(each) === "some").length;
  const none = reads.filter((each) => spreadOf(each) === "none").length;
  const read = [...admissions.values()].filter((admission) => measuredGate(admission));
  const held = read.flatMap(({ outcome, reference: counted }) => {
    const { valid, solves: of } = asRecord(counted) ?? {};
    return heldAtGate(outcome) && isNumber(valid) && isNumber(of) ? [heldOn(valid, of)] : [];
  });
  const refused = read.filter(({ outcome }) => outcome === "refused").length;
  const kinds = Object.values(HELD_ON).map(
    (on) => `${String(held.filter((each) => each === on).length)} ${on}`,
  );
  const said = [
    ...(reads.length === 0
      ? []
      : [
          `In the last comparison the reference harness stood in, it was valid in every solve on ${String(reads.length - some - none)} of ${plural(reads.length, "task")} tallied, in some on ${String(some)}, in none on ${String(none)}${aside === 0 ? "" : `; ${String(aside)} more ${aside === 1 ? "was" : "were"} set aside`}.`,
        ]),
    ...(held.length + refused === 0
      ? []
      : [
          `Under the current reference harness the gate held out ${plural(held.length, "draft")}${held.length === 0 ? "" : `: ${kinds.join("; ")}`}. It refused ${plural(refused, "draft")} after reading them.`,
        ]),
  ];
  return said.length === 0 ? null : `${said.join(" ")} These are measurements and no target.`;
}

/** Drafts refused under the current reference after evaluation, grouped by reason. Report solve
 *  counts for refusals based on reference solves, and the admission reason for package refusals.
 *  Until 14 October later sessions saw none of these drafts, so they could not distinguish a draft
 *  with no valid answer in three reference solves from one never proposed. */
function refusedLines(
  events: readonly LogEvent[],
  admissions: ReadonlyMap<string, JsonObject>,
  answered: ReturnType<typeof gateAnswers>,
): string[] {
  const why = new Map<string, string[]>();
  for (const { version, task } of proposalsOf(events)) {
    const admission = admissions.get(version);
    if (
      task === null ||
      admission?.outcome !== "refused" ||
      !measuredGate(admission) ||
      !isString(admission.reason)
    ) {
      continue;
    }
    const { valid, solves } = asRecord(admission.reference) ?? {};
    const reason =
      isNumber(valid) && isNumber(solves)
        ? `the reference harness valid in ${String(valid)} of ${String(solves)} solves`
        : admission.reason;
    why.set(reason, [
      ...(why.get(reason) ?? []),
      `${task.taskId} (${task.family}${inTurns(answered.get(version)?.flatMap(({ turns }) => (turns === null ? [] : [turns])) ?? [])}${yoursSaid(admission.reference)})`,
    ]);
  }
  return [...why].map(([reason, drafts]) => `${reason}: ${drafts.join(", ")}`);
}

/** Draft versions whose latest admission ended without a complete measurement, whether or not the
 *  author received the result. For an earlier reference, report only the draft and status. For the
 *  current reference, include admission counts and the reason, never a solver's answer or review. */
function interruptedLines(
  events: readonly LogEvent[],
  admissions: ReadonlyMap<string, { readonly data: JsonObject; readonly at: number }>,
  since: number,
): string[] {
  const tasks = new Map(proposalsOf(events).map(({ version, task }) => [version, task]));
  return [...admissions].flatMap(([version, { data, at }]) => {
    const task = tasks.get(version);
    if (task === undefined || task === null || data.outcome !== "refused" || measuredGate(data)) return [];
    const status = `${task.taskId} (${task.family}): gate not measured`;
    if (at < since) return [`${status}; used a replaced reference`];
    const { valid, solves, ran } = asRecord(data.reference) ?? {};
    const measured =
      isNumber(valid) && isNumber(solves)
        ? `; ${String(valid)} of ${String(solves)} measured solves valid`
        : "";
    const attempted = isNumber(ran) ? `; ${String(ran)} attempted` : "";
    return [`${status}${measured}${attempted}${isString(data.reason) ? `; ${data.reason}` : ""}`];
  });
}

/** Each valid answer the reference harness gave at a task admission after event `from`, by draft version:
 *  the Examiner's solves under `try_task`, which no comparison counts, with the solver's own turns
 *  each took and the objective the verifier measured of it, null where the log holds none. Read
 *  from a promotion on, they are the new reference's alone. The task admission reads the measures by the
 *  comparison's definition of room (`informative`); a later session is told the turns on the
 *  draft's line. Until 16 October an Examiner was told the turns of comparisons only, and after a
 *  promotion its drafts stood in none: main0_5_1's answered drafts took a median of 4 of the 16
 *  turns, recode-151's 3, and neither was told. */
export function gateAnswers(events: readonly LogEvent[], from: number): Map<string, RoomAnswer[]> {
  const sessions = examinerSessions(events);
  const conditions = conditionsOf(events);
  const verdicts = verdictsOf(events);
  const answers = new Map<string, RoomAnswer[]>();
  for (const { id, started, start, ending, end, condition } of solvesIn(events)) {
    const version = conditions.get(condition)?.task;
    if (started <= from || !sessions.has(start.comparison) || version === undefined) continue;
    if (ending?.outcome !== "pass") continue;
    const checker = verdicts.get(id)?.checker;
    const measure = checker?.kind === "pass" ? (checker.objective ?? null) : null;
    answers.set(version, [
      ...(answers.get(version) ?? []),
      {
        turns: isNumber(end?.turns) ? end.turns : null,
        seconds: isNumber(end?.seconds) ? end.seconds : null,
        measure,
      },
    ]);
  }
  return answers;
}

/** What draft `version`'s solves at session `session`'s task admission billed, read once every one has
 *  ended: their own and the Referee's rulings of them. Until 17 October a task admission was billed the
 *  session's sum across its solves, which moves with every draft once a call's are solved together
 *  (`proposeTool`, `write.ts`). */
export function gateBilled(events: readonly LogEvent[], session: string, version: string): number {
  const conditions = conditionsOf(events);
  const own = new Set(
    solvesIn(events).flatMap(({ id, start, condition }) =>
      start.comparison === session && conditions.get(condition)?.task === version ? [id] : [],
    ),
  );
  return events.reduce(
    (sum, { kind, data }) =>
      BILLED.has(kind) && isNumber(data.billed) && isString(data.solve) && own.has(data.solve)
        ? sum + data.billed
        : sum,
    0,
  );
}
