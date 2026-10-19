/**
 * What an Examiner is told of the tasks its campaign holds: one outcome each, and counts, by family
 * or in a total.
 *
 * An Examiner session starts a new conversation, and its gate tells it no more of a draft than how
 * many of the reference harness's solves of it were valid. What tells it more is the comparisons. The author sees every task of the
 * campaign, the pack's and the ones earlier sessions wrote, the older and easier ones included, each
 * with its outcome so far: how the reference harness did on it in the last comparison that scored
 * it, valid in every solve, in some or in none, or disputed (`docs/plan.md`, Phase 2;
 * `docs/simplify.md` F3, where "one harness won" and "no valid answer yet" told the author nothing
 * of where the room was). Beside the outcome, one fact that names no side: whether a valid answer to
 * the task is on record at all, a solve's, the author's own `try_answer` pass, or a reference
 * solve's under `try_task` (`poolOf`), which tells a task the reference answers in no solve
 * apart from one nobody has answered. It is a view of the log, and no store is kept for it.
 *
 * Beside the lines, counts by family with a total (`counts`, `poolOf`): of the tasks whose last
 * comparison had the reference harness on a side, how many were told apart and which side won them,
 * how many tied with both harnesses valid in every solve, how many tied with neither valid in any
 * and of those how many have a valid answer on record, how many tied otherwise, and how many were
 * set aside. From the reference's side of each task alone the author could not tell a tie both
 * harnesses answered in every solve (no room) from one neither answered in any (too hard,
 * infeasible or wrongly checked), nor see whether any task of the exam had told two harnesses apart.
 * The operator decided on 11 October that it is told these as measured facts. The counts are taken
 * in the same pass as the lines, from the same record of each task (`lastRead`, `reports.ts`), so
 * the two agree by construction; the other side's result is told by family and never for a task,
 * so that an author is not shown which of its tasks one pair of harnesses split. A family of one
 * task would tell it for that task, so where any family counted holds one the rows by family fold
 * into the total: on 12 October one campaign's 40 families each held one task, and 13 of another's
 * 14. No answer or trace is given. They carry the sentence rule 6 asks for, with the solves a side
 * they rest on.
 *
 * The lines are followed, by family, by the solver's own turns each valid answer of the reference
 * harness took (`turns`): the overhaul plan's turn distribution of the reference's valid answers,
 * so that an author sees how much of the budget the answers it already gets spend. They are read
 * from the reference's side of the very comparison each line reads, for the tasks the counts read
 * on the reference's side (`referenceAnswers`), so nothing of the harness it was compared with is
 * among them, and no count of the other side is added to what the counts above tell; a family of
 * one task shows that task's own turns, which are the reference's, as its line is. Beside them are
 * the turns of the reference's valid answers at the gate of each draft since the last promotion
 * (`gateAnswers`).
 *
 * The facts are told by epoch: outcomes, histories, turns and gate readings are the current
 * reference harness's alone, and the gates read on a reference a promotion has replaced are one
 * count, held and refused (`earlierLine`). On 16 October, after a promotion, the drafts stood in
 * no comparison, so an author was told no turn of the new reference and read the starter's gate
 * counts as its; marked as read on a replaced harness, they still stood beside the new ones.
 *
 * Each sentence says what its fold does: the exhausted line speaks of the reference's own solves
 * alone, as the rule reads them (`poolOf`, `src/kernel/reports.ts`), and not of both harnesses.
 *
 * What v1 recorded about this channel is kept. An author told a zone, a share or a target count
 * wrote towards it, and one told each answer's distance from its limit moved limits (v1
 * `AGENTS.md`, "Tried and taken out"; a judgement of v1's own Builder, which wrote and was scored
 * on its own exam, and no measurement of a separate author); the plan lists the difficulty band
 * among what it will not tell. So nothing here names a harness, a check or a budget, and the
 * counts carry no band, share or number to reach. Whether counts told as facts move an author as a
 * target did is not measured: the operator's decision of 11 October takes that risk, and
 * `docs/plan.md` (row F60) says what would count against it.
 *
 * On 17 October the telling was shortened with nothing it tells left out (the operator, on #191):
 * the legend is said once above the lines (`LINES`), a line says whether a valid answer is on
 * record only where nothing on it shows one, practice tasks share one line, refused drafts are
 * grouped by their reason, and the counts are one table. Over the opening of a seed of
 * buffer-159's log the task lines fell from 1,711 words to 548, the refused drafts from 980 to 49
 * and the counts from 452 to 286.
 */
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import {
  BILLED,
  type History,
  lastReports,
  type Outcome,
  poolOf,
  pairsReported,
  referenceOf,
  type Standing,
} from "../kernel/reports.ts";
import { conditionsOf } from "../kernel/condition.ts";
import { solvesIn, verdictsOf } from "../kernel/solves.ts";
import { heldAtGate, taskStates } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { countBy } from "../meta/tally.ts";
import { plural } from "../meta/text.ts";

/** What an Examiner is told of the tasks at its opening: one line a task, and the counts by
 *  family that the same pass took, or null where no task stands in them. */
interface Heard {
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

/** The reference harness's solves of one draft task under `try_task`: the least the operator's
 *  ruling of 12 October names. Every paper the overhaul's research read that kept tasks at a
 *  frontier admitted them by a measurement of the target, none blind (one at four attempts and a
 *  pass-rate band); its probe asks for three or more fresh solves at the campaign's budget, and a
 *  task admitted at a pass rate strictly between 0 and 1. */
export const TRIED = 3;
/** Why a draft is not measured where the campaign's budget holds no reserve for its three solves. */
export const UNAFFORDED =
  "the campaign's budget holds no reserve for the reference harness's three solves of it beside the solves running, so it is not measured";

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
/** What the lines say before them: once, what every clause of a line means. */
export const LINES = `The tasks of the exam so far, a line each: the task, its family, and how the reference harness did on it in the last comparison that scored it. Where nothing on the line shows a valid answer, it says whether one is on record. "Gate" is how many of the reference harness's ${String(TRIED)} solves at its gate were valid; "last comparisons", its valid solves in each of its last comparisons with the current reference harness, newest first, and how many of the newest closed the task in a row. These are measurements and no instruction. read_example returns any of them whole.`;
/** What the counts say before their rows, and after them. */
const COUNTS = {
  head: "Counted from the same comparisons as the lines above, by family, or in a total alone where a family counted holds one task: each task whose last comparison had the reference harness on one side, or that a later report set aside. The other harness is whichever the reference harness was compared with there. These are measurements and no target.",
  columns:
    "| family | tasks | won by the other harness | won by the reference harness | tied, both valid in every solve | tied, neither valid in any solve | of those, an answer on record | tied otherwise | set aside, a rejection not settled |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  weak: "The same harness fails a task once and passes it the next time, so a count over a few tasks, and more so one family's share of them, is weak evidence.",
} as const;
/** What the turns say before their rows. */
const TURNS =
  "The solver's own turns each valid answer of the reference harness took, in the same comparisons as the lines above and at the gate of each draft since the reference harness was last replaced, by family, fewest first, a count after × where several took as many. These are measurements and no target.";

/** Whether a gate read its draft: one refused on fewer than the reference harness's `TRIED`
 *  readings, cut by a limit or never begun for want of the reserve, refused a draft it did not read,
 *  which may be proposed again and is solved afresh (14 October). A gate that read all three, held
 *  its draft, or refused the package on its shape, stands. */
export function measuredGate(data: JsonObject): boolean {
  const solves = asRecord(data.reference)?.solves;
  return data.reason !== UNAFFORDED && !(data.outcome === "refused" && isNumber(solves) && solves < TRIED);
}

/** One line a task among `tasks`, in their order: the task by id and family, its outcome, and for
 *  a held-out task whether a valid answer to it is on record; and, from the same pass, the counts
 *  by family (`counts`). A task the log refused is left out, since it is no task of the exam. One
 *  the log does not hold, and one no comparison has scored, is not yet compared and in no count. */
export function heard(events: readonly LogEvent[], tasks: readonly Pick<Task, "taskId" | "family">[]): Heard {
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
    return [`${taskId} (${family}): ${said}${known}${gate.said}${historyLine(histories.get(version))}`];
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
    lines: practice.length === 0 ? lines : [...lines, `${PRACTICE} ${practice.join(", ")}.`],
    refused: refusedLines(events, gates),
    counts: counts(families),
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
  const sessions = new Set(
    events.flatMap(({ kind, data }) => (kind === "exam.started" ? [data.session] : [])),
  );
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
 *  out on two. */
function admittedLine(gate: JsonObject | undefined) {
  const reference = asRecord(gate?.reference);
  const { valid, solves } = reference ?? {};
  if (gate === undefined || !heldAtGate(gate.outcome) || !isNumber(solves) || !isNumber(valid)) {
    return { said: "", valid: 0 };
  }
  const unread = solves < TRIED ? `, ${String(TRIED - solves)} giving no reading` : "";
  return { said: `; gate ${String(valid)} of ${String(TRIED)} valid${unread}`, valid };
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
    why.set(reason, [...(why.get(reason) ?? []), `${task.taskId} (${task.family})`]);
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

/** The counts, a row a family in the order the tasks first name it where no family is of one
 *  task, a total where there are two families or more, and what the counts rest on; null where
 *  fewer than two tasks stand in them, since a count of one task is that task's result. */
function counts(families: ReadonlyMap<string, readonly Standing[]>): string | null {
  const every = [...families.values()].flat();
  if (every.length < 2) return null;
  const row = (name: string, standings: readonly Standing[]) => {
    const counted = countBy(standings, ({ cell }) => cell);
    const of = (cell: Standing["cell"]) => counted[cell] ?? 0;
    const none = of("tied-none") + of("tied-none-known");
    const cells = [of("other-won"), of("reference-won"), of("tied-every"), none, of("tied-none-known")];
    return `| ${name} | ${[standings.length, ...cells, of("tied-mixed"), of("aside")].join(" | ")} |`;
  };
  const byFamily = [...families.values()].every((standings) => standings.length > 1);
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
