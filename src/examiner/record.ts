/**
 * What an Examiner is told of the tasks its campaign holds, at a session's opening: a view of the
 * log, with no store of its own.
 *
 * - A line a task, the pack's and those earlier sessions wrote: how the reference harness did on
 *   it in the last comparison that scored it (every, some or no solve valid, or disputed), its
 *   gate's count, its last comparisons where it stood in two or more, and whether a valid answer
 *   is on record where nothing on the line shows one (`poolOf`). An author told only "one harness
 *   won" could not tell where the room was (`7f0add79:docs/simplify.md`, F3).
 * - Who won each task in that comparison, by how much where the objective alone decided it, and
 *   how far apart the reference's own valid answers were where that reaches the room floor, its
 *   room by the objective (`comparedOf`). Until 20 October only counts by family told who won,
 *   folded into a total where a family held one task, so that no author learnt which of its tasks
 *   a pair of harnesses split. The operator took
 *   the risk of an author writing towards the other harness's wins for the feedback: from the
 *   reference's side alone a win by rounding reads as one by method, and buffer-fresh-opus-r6's
 *   comparison g-2 read 23-0-1 on gains under 0.7%.
 * - Counts by family (`counts`): how the tasks were won, lost and tied, and how many were set
 *   aside.
 * - The turns each valid answer of the reference took, by family, in those comparisons and at the
 *   gates since the last promotion (`turnsOf`), so an author sees how much of the budget its tasks
 *   already spend.
 * - The drafts a gate refused after reading them, by reason (`refusedLines`), and the gates read on
 *   a replaced reference as one count (`earlierLine`).
 * On 21 October, 2 of 1,396 drafts in 30 logs were refused for three reserved solves; the gate
 * reserves only its next solve. An unmeasured refusal may return within the same session too.
 *
 * Everything is told by epoch: on 16 October a session after a promotion read the starter's gate
 * counts as the new reference's. Nothing here names a harness, a check or a target, and no count
 * carries a band or a number to reach (the operator's decision of 11 October; whether counts move
 * an author as a target did is `7f0add79:docs/plan.md`, row F60).
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
  type Standing,
} from "../kernel/reports.ts";
import { BILLED } from "../kernel/trace.ts";
import { conditionsOf } from "../kernel/condition.ts";
import { examinerSessions, solvesIn, verdictsOf } from "../kernel/solves.ts";
import { heldAtGate, taskStates } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { countBy } from "../meta/tally.ts";
import { plural } from "../meta/text.ts";

/** What an Examiner is told of the tasks at its opening: one line a task, and the counts by
 *  family that the same pass took, or null where no task stands in them. */
interface Heard {
  /** What every clause of a line means, said once before them (`legendOf`). */
  readonly legend: string;
  readonly lines: string[];
  /** The drafts a gate refused having read them, a line a reason (`refusedLines`). */
  readonly refused: string[];
  readonly counts: string | null;
  /** The turns the reference harness's valid answers took, by family, or null where none is on
   *  record (`turnsOf`). */
  readonly turns: string | null;
  /** The gates read on a reference harness since replaced, as one count (`earlierLine`). */
  readonly earlier: string | null;
}

/** At most three reference probes per draft; the gate stops at the first reading that leaves room. */
export const TRIED = 3;
/** Why a draft is not measured where the campaign's budget holds no reserve for its next solve. */
export const UNAFFORDED =
  "the campaign's budget holds no reserve for the reference harness's next solve of it beside the solves running, so it is not measured";

/** How each outcome is said. */
const SAID: Readonly<Record<Outcome, string>> = {
  "reference-every": "valid in every solve",
  "reference-some": "valid in some solves",
  "reference-none": "valid in no solve",
  "earlier-reference": "last compared between two other harnesses",
  disputed: "disputed: a rejection of an answer to it is not settled",
};
/** Whether a valid answer to a task is on record, said where nothing else on its line shows one. */
const KNOWN = { yes: "an answer on record", no: "no answer on record" } as const;
/** The tasks in use as practice, as one line (`heard`). */
const PRACTICE = "In use as practice, and so never scored:";
/** What the counts say before their rows, and after them. */
const COUNTS = {
  head: "Counted from the same comparisons as the lines above, by family, or in a total alone where the lines do not say who won each task and a family counted holds one: each task whose last comparison had the reference harness on one side, or that a later report set aside. The other harness is whichever the reference harness was compared with there. These are measurements and no target.",
  columns:
    "| family | tasks | won by the other harness | won by the reference harness | tied, both valid in every solve | tied, neither valid in any solve | of those, an answer on record | tied otherwise | set aside, a rejection not settled |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  weak: "The same harness fails a task once and passes it the next time, so a count over a few tasks, and more so one family's share of them, is weak evidence.",
} as const;
/** What the turns say before their rows. */
const TURNS =
  "The solver's own turns each valid answer of the reference harness took, in the same comparisons as the lines above and at the gate of each draft since the reference harness was last replaced, by family, fewest first, a count after × where several took as many. These are measurements and no target.";

/** What the lines say before them: once, what every clause of a line means. With `results`, who
 *  won each task in its last comparison is among them (`exam-results`). */
function legendOf(results: boolean): string {
  const won = results
    ? ", and who won it there: the other harness, whichever the reference harness was compared with, the reference harness, or neither"
    : "";
  return `The tasks of the exam so far, a line each: the task, its family, and how the reference harness did on it in the last comparison that scored it${won}. Where nothing on the line shows a valid answer, it says whether one is on record. "Gate" is how many of the reference harness's solves at its gate were valid, of the solves it ran, at most ${String(TRIED)}; "last comparisons", its valid solves in each of its last comparisons with the current reference harness, newest first, and how many of the newest closed the task in a row. These are measurements and no instruction. read_example returns any of them whole.`;
}

/** What a task's last comparison with the reference harness on a side says on its line: with
 *  `results` (the operator's word of 20 October), who won it there; and how much better an answer on record, its
 *  author's or another of its own, was than one of the reference's, where that reaches the floor
 *  (`roomLeft`), which is all its room by the objective. */
function comparedOf(standing: Standing | undefined, results: boolean): string {
  if (standing === undefined) return "";
  const { cell, room } = standing;
  const winner = cell === "other-won" ? "other" : cell === "reference-won" ? "reference" : null;
  const won = winner === null ? "; tied there" : `; won there by the ${winner} harness`;
  return `${results && cell !== "aside" ? won : ""}${(room ?? 0) > 0 ? `; an answer on record ${percent(room ?? 0)} better than one of its own` : ""}`;
}

/** How an author's answer at a gate stood against the reference harness's best valid answer by
 *  the objective, as a share of the larger magnitude (`gainOver`, `seenOf` in `write.ts`). */
export function gapSaid(gap: number): string {
  return gap === 0 ? "the same as its best" : `${percent(gap)} ${gap > 0 ? "better" : "worse"} than its best`;
}

/** How far the author's answer stood from the reference harness's best at the gate, as a clause,
 *  where the gate measured both (`reference.gap`, `task.gate`): a later session keeps the size of
 *  the room each task was held on, and of each refused draft's shortfall. */
function yoursSaid(reference: unknown): string {
  const gap = asRecord(reference)?.gap;
  return isNumber(gap) ? `, yours ${gapSaid(gap)}` : "";
}

/** A share as a percentage of two significant digits, without its sign. */
function percent(share: number): string {
  return `${String(Number((Math.abs(share) * 100).toPrecision(2)))}%`;
}

/** Whether a gate read its draft: one refused on fewer than the reference harness's `TRIED`
 *  readings, cut by a limit or never begun for want of the reserve, refused a draft it did not read,
 *  which may be proposed again and is solved afresh (14 October). A gate that read all three, held
 *  its draft, or refused the package on its shape, stands. */
export function measuredGate(data: JsonObject): boolean {
  const solves = asRecord(data.reference)?.solves;
  return !(
    data.outcome === "refused" &&
    ((isNumber(solves) && solves < TRIED) ||
      (isString(data.reason) && data.reason.endsWith("so it is not measured")))
  );
}

/** One line a task among `tasks`, in their order: the task by id and family, its outcome, and for
 *  a held-out task whether a valid answer to it is on record; and, from the same pass, the counts
 *  by family (`counts`). A task the log refused is left out, since it is no task of the exam. One
 *  the log does not hold, and one no comparison has scored, is not yet compared and in no count. */
export function heard(
  events: readonly LogEvent[],
  tasks: readonly Pick<Task, "taskId" | "family">[],
  results = true,
): Heard {
  const states = taskStates(events);
  const { outcomes, standings, feasible, histories } = poolOf(events);
  const answers = referenceAnswers(events);
  const took = new Map(
    solvesIn(events).flatMap(({ id, end }) => (isNumber(end?.turns) ? [[id, end.turns] as const] : [])),
  );
  const turns = new Map<string, number[]>();
  const versions = new Map(
    proposalsOf(events).flatMap(({ version, taskId, task }) => {
      const id = task?.taskId ?? taskId;
      return id === null ? [] : [[id, version] as const];
    }),
  );
  // Each version's last gate, told where it read the current reference harness: until 16 October
  // a session after a promotion read the starter's gate counts as the new reference's, and wrote
  // on in the families the promotion had closed.
  const since = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const last = new Map(
    events.flatMap(({ kind, data }, at) =>
      kind === "task.gate" && isString(data.version) ? [[data.version, { data, at }] as const] : [],
    ),
  );
  const gates: ReadonlyMap<string, JsonObject> = new Map(
    [...last].flatMap(([version, { data, at }]) => (at > since ? [[version, data] as const] : [])),
  );
  const families = new Map<string, Standing[]>();
  const practice: string[] = [];
  const lines = tasks.flatMap(({ taskId, family }) => {
    const version = versions.get(taskId) ?? "";
    const state = states.get(version) ?? "";
    if (state === "refused") return [];
    if (state === "released") {
      practice.push(`${taskId} (${family})`);
      return [];
    }
    if (state === "disputed") {
      return [`${taskId} (${family}): disputed: a check was at fault on an answer to it`];
    }
    const standing = standings.get(version);
    if (standing !== undefined) families.set(family, [...(families.get(family) ?? []), standing]);
    const read = standing !== undefined && standing.cell !== "aside";
    const valid = read ? (answers.get(version) ?? []).flatMap((solve) => took.get(solve) ?? []) : [];
    if (valid.length > 0) turns.set(family, [...(turns.get(family) ?? []), ...valid]);
    const outcome = outcomes.get(version);
    const said = outcome === undefined ? "not yet compared" : SAID[outcome];
    const gate = admittedLine(gates.get(version));
    // A valid solve of the last comparison or the gate shows an answer on record; elsewhere it is said.
    const shown = outcome === "reference-every" || outcome === "reference-some" || gate.valid > 0;
    const known = shown ? "" : `; ${feasible.has(version) ? KNOWN.yes : KNOWN.no}`;
    return [
      `${taskId} (${family}): ${said}${known}${comparedOf(standing, results)}${gate.said}${historyLine(histories.get(version))}`,
    ];
  });
  const gated = gateAnswers(events, since);
  for (const { version, task } of proposalsOf(events)) {
    const valid = (gated.get(version) ?? []).flatMap((answer) =>
      answer.turns === null ? [] : [answer.turns],
    );
    if (task !== null && valid.length > 0) {
      turns.set(task.family, [...(turns.get(task.family) ?? []), ...valid]);
    }
  }
  return {
    legend: legendOf(results),
    lines: practice.length === 0 ? lines : [...lines, `${PRACTICE} ${practice.join(", ")}.`],
    refused: refusedLines(events, gates),
    counts: counts(families, results),
    turns: turnsOf(turns),
    earlier: earlierLine([...last.values()].flatMap(({ data, at }) => (at < since ? [data] : []))),
  };
}

/** The gates read on a reference harness a promotion has replaced, as one count, or null where
 *  there are none: what they read was of that harness, and is not told as the current one's. */
function earlierLine(gates: readonly JsonObject[]): string | null {
  const held = gates.filter(({ outcome }) => outcome === "passed").length;
  const refused = gates.filter((gate) => gate.outcome === "refused" && measuredGate(gate)).length;
  return held + refused === 0
    ? null
    : `Before the reference harness was last replaced, the gate held out ${plural(held, "draft")} and refused ${plural(refused, "draft")} after reading them. What it read of them was of a harness since replaced, and is not told.`;
}

/** Each valid answer the reference harness gave at a gate after event `from`, by draft version:
 *  the Examiner's solves under `try_task`, which no comparison counts, with the solver's own turns
 *  each took and the objective the verifier measured of it, null where the log holds none. Read
 *  from a promotion on, they are the new reference's alone. The gate reads the measures by the
 *  comparison's definition of room (`informative`); the session's later ones are told the turns by
 *  family. Until 16 October an Examiner was told the turns of comparisons only, and after a
 *  promotion its drafts stood in none: main0_5_1's answered drafts took a median of 4 of the 16
 *  turns, recode-151's 3, and neither was told. */
export function gateAnswers(
  events: readonly LogEvent[],
  from: number,
): Map<string, { readonly turns: number | null; readonly measure: number | null }[]> {
  const sessions = examinerSessions(events);
  const conditions = conditionsOf(events);
  const verdicts = verdictsOf(events);
  const answers = new Map<string, { readonly turns: number | null; readonly measure: number | null }[]>();
  for (const { id, started, start, ending, end, condition } of solvesIn(events)) {
    const version = conditions.get(condition)?.task;
    if (started <= from || !sessions.has(start.comparison) || version === undefined) continue;
    if (ending?.outcome !== "pass") continue;
    const checker = verdicts.get(id)?.checker;
    const measure = checker?.kind === "pass" ? (checker.objective ?? null) : null;
    answers.set(version, [
      ...(answers.get(version) ?? []),
      { turns: isNumber(end?.turns) ? end.turns : null, measure },
    ]);
  }
  return answers;
}

/** What draft `version`'s solves at session `session`'s gate billed, read once every one has
 *  ended: their own and the Referee's rulings of them. Until 17 October a gate was billed the
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

/** How many of the reference harness's solves at a held task's gate were valid, as one clause, or
 *  nothing where the gate read no solves. Its own session was told it (`try_task`); until
 *  14 October a later one was not, so a task held out on one valid solve in three read as one held
 *  out on two. It is of the solves the gate ran, which since 20 October stop at the first that
 *  leaves room; a gate before then ran `TRIED`. */
function admittedLine(gate: JsonObject | undefined) {
  const reference = asRecord(gate?.reference);
  const { valid, solves, ran = TRIED } = reference ?? {};
  if (
    gate === undefined ||
    !heldAtGate(gate.outcome) ||
    !isNumber(solves) ||
    !isNumber(valid) ||
    !isNumber(ran)
  ) {
    return { said: "", valid: 0 };
  }
  const unread = solves < ran ? `, ${String(ran - solves)} giving no reading` : "";
  return { said: `; gate ${String(valid)} of ${String(ran)} valid${unread}${yoursSaid(reference)}`, valid };
}

/** The drafts a gate refused having read them, with the gate's reason: until 14 October a later
 *  session was told nothing of them, and could not tell a draft refused at none of three valid
 *  solves from one never written. A draft whose gate read fewer solves may be proposed again, and
 *  is left out (`measuredGate`). */
function refusedLines(events: readonly LogEvent[], gates: ReadonlyMap<string, JsonObject>): string[] {
  const why = new Map<string, string[]>();
  for (const { version, task } of proposalsOf(events)) {
    const gate = gates.get(version);
    if (task === null || gate?.outcome !== "refused" || !measuredGate(gate) || !isString(gate.reason)) {
      continue;
    }
    // A draft the reference harness's solves refused is said by their count, the rule being the
    // system prompt's; one refused on its package, by the gate's own reason.
    const { valid, solves } = asRecord(gate.reference) ?? {};
    const reason =
      isNumber(valid) && isNumber(solves)
        ? `the reference harness valid in ${String(valid)} of ${String(solves)} solves`
        : gate.reason;
    why.set(reason, [
      ...(why.get(reason) ?? []),
      `${task.taskId} (${task.family}${yoursSaid(gate.reference)})`,
    ]);
  }
  return [...why].map(([reason, drafts]) => `${reason}: ${drafts.join(", ")}`);
}

/** A task's last comparisons with the reference harness, newest first, as one clause after its
 *  line, or nothing where it stood in fewer than two (`poolOf`, histories): each as every, some or
 *  none of the reference's solves valid, a limit that cut a solve named apart, and how many of the
 *  newest closed the task in a row. A fact of the record and no target: which of them is too easy
 *  is the author's to judge. */
function historyLine(history: History | undefined): string {
  if (history === undefined || history.reads.length < 2) return "";
  const reads = history.reads.map(({ valid, cut }) => `${valid}${cut ? " (a solve cut at a limit)" : ""}`);
  const run =
    history.closedRun === 0
      ? ""
      : `; the last ${history.closedRun === 1 ? "" : `${String(history.closedRun)} in a row `}closed it`;
  return `; last ${String(reads.length)} comparisons: ${reads.join(", ")}${run}`;
}

/** The reference harness's valid answers to each task, by solve id, in the last comparison that
 *  tallied it, read as its outcome and its standing are (`taskRecords`, `reports.ts`): from the
 *  side the reference stood on there, and none where it stood on neither. */
function referenceAnswers(events: readonly LogEvent[]): Map<string, string[]> {
  const reference = referenceOf(events);
  const answers = new Map<string, string[]>();
  for (const report of lastReports(events)) {
    const side = report.data.fresh === reference ? "fresh" : report.data.old === reference ? "old" : null;
    for (const pair of pairsReported(events, report)) {
      const named =
        side === null ? [] : (pair.solves?.[side] ?? []).filter((_solve, nth) => pair[side][nth] === true);
      answers.set(pair.task, named);
    }
  }
  return answers;
}

/** The turns, a row a family in the order the tasks first name it, fewest first; null where no
 *  valid answer of the reference harness is on record with its turns. */
function turnsOf(families: ReadonlyMap<string, readonly number[]>): string | null {
  if (families.size === 0) return null;
  const rows = [...families].map(([family, taken]) => {
    const counted = Object.entries(countBy(taken, (turns) => String(turns))).toSorted(
      ([a], [b]) => Number(a) - Number(b),
    );
    return `- family ${family}: ${counted.map(([turns, answers]) => (answers === 1 ? turns : `${turns} ×${String(answers)}`)).join(", ")}`;
  });
  return [TURNS, ...rows].join("\n");
}

/** The counts, a row a family in the order the tasks first name it, a total where there are two
 *  families or more, and what the counts rest on; null where no task stands in them. Where the
 *  lines do not say who won each task (`results` off), the rows fold into the total wherever a
 *  family is of one task, and one task alone is no count, since either would be that task's result. */
function counts(families: ReadonlyMap<string, readonly Standing[]>, results: boolean): string | null {
  const every = [...families.values()].flat();
  if (every.length < (results ? 1 : 2)) return null;
  const row = (name: string, standings: readonly Standing[]) => {
    const counted = countBy(standings, ({ cell }) => cell);
    const of = (cell: Standing["cell"]) => counted[cell] ?? 0;
    const none = of("tied-none") + of("tied-none-known");
    const cells = [of("other-won"), of("reference-won"), of("tied-every"), none, of("tied-none-known")];
    return `| ${name} | ${[standings.length, ...cells, of("tied-mixed"), of("aside")].join(" | ")} |`;
  };
  const byFamily = results || [...families.values()].every((standings) => standings.length > 1);
  const rows = byFamily ? [...families].map(([family, standings]) => row(family, standings)) : [];
  const sizes = [...new Set(every.flatMap(({ solves }) => solves ?? []))].toSorted((a, b) => a - b);
  const [fewest] = sizes;
  const most = sizes.at(-1) ?? 0;
  const span = fewest === most ? plural(most, "solve") : `${String(fewest)} to ${String(most)} solves`;
  return [
    COUNTS.head,
    COUNTS.columns,
    ...rows,
    ...(families.size > 1 ? [row("every family", every)] : []),
    `${fewest === undefined ? "" : `Each count rests on ${span} a side of the task's last comparison. `}${COUNTS.weak}`,
  ].join("\n");
}
