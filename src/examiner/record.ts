/**
 * What an Examiner is told of the tasks its campaign holds: one outcome each, and counts by family.
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
 * solve apart from one nobody has answered. It is a view of the log, and no store is kept for it.
 * Until 9 October a session was shown the pack's tasks by id and family alone, and no outcome.
 *
 * Beside the lines, since 11 October, counts by family with a total (`counts`, `standingsOf`): of
 * the tasks whose last comparison had the reference harness on a side, how many were told apart and
 * which side won them, how many tied with both harnesses valid in every solve, how many tied with
 * neither valid in any and of those how many have a valid answer on record, how many tied otherwise,
 * and how many were set aside. Until then the author heard the reference's side of each task alone,
 * and could not tell a tie both harnesses answered in every solve (no room) from one neither
 * answered in any (too hard, infeasible or wrongly checked), nor see whether any task of the exam
 * had told two harnesses apart. The operator decided that day that it is told these as measured
 * facts. The counts are taken in the same pass as the lines, from the same record of each task
 * (`lastRead`, `reports.ts`), so the two agree by construction; the other side's result is told
 * by family and never for a task, so that an author is not shown which of its tasks one pair of
 * harnesses split. A family of one task would tell it for that task, so where any family counted
 * holds one the rows by family fold into the total: on 12 October esp32's 40 families each held
 * one task, and 13 of buffer's 14. They carry the sentence rule 6 asks for, with the solves a side
 * they rest on.
 *
 * Since 12 October the lines are followed, by family, by the solver's own turns each valid answer
 * of the reference harness took (`turns`): the overhaul plan's turn distribution of the
 * reference's valid answers, so that an author sees how much of the budget the answers it already
 * gets spend. They are read from the reference's side of the very comparison each line reads, for
 * the tasks the counts read on the reference's side (`referenceAnswers`), so nothing of the harness
 * it was compared with is among them, and no count of the other side is added to what the counts
 * above tell; a family of one task shows that task's own turns, which are the reference's, as its
 * line is.
 *
 * Each sentence says what its fold does. Until 11 October the exhausted line said "answered by
 * both harnesses", where the rule reads the reference's own solves alone (`exhausted`,
 * `src/kernel/reports.ts`); the review of the buffer runs of that day found the two apart.
 *
 * What v1 recorded about this channel is kept. An author told a zone, a share or a target count
 * wrote towards it, and one told each answer's distance from its limit moved limits (v1
 * `AGENTS.md`, "Tried and taken out"; a judgement of v1's own Builder, which wrote and was scored
 * on its own exam, and no measurement of a separate author); the plan lists the difficulty band
 * among what it will not tell. So nothing here names a harness, a check or a budget, and the
 * counts carry no band, share or number to reach. Whether counts told as facts move an author as a
 * target did is not measured: the operator's decision of 11 October takes that risk, and
 * `docs/plan.md` (row F60) says what would count against it.
 */
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import {
  feasibleTasks,
  lastReports,
  type Outcome,
  outcomesOf,
  pairsReported,
  promoted,
  type Standing,
  standingsOf,
} from "../kernel/reports.ts";
import { solvesIn } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";
import { isNumber } from "../meta/json-shape.ts";
import { countBy } from "../meta/tally.ts";
import { plural } from "../meta/text.ts";

/** What an Examiner is told of the tasks at its opening: one line a task, and the counts by
 *  family that the same pass took, or null where no task stands in them. */
export interface Heard {
  readonly lines: string[];
  readonly counts: string | null;
  /** The turns the reference harness's valid answers took, by family, or null where none is on
   *  record (`turnsOf`). */
  readonly turns: string | null;
}

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
/** What the counts say before their rows, and after them. */
const COUNTS = {
  head: "Counted from the same comparisons as the lines above, by family where every family counted holds two tasks or more and otherwise in a total alone: each task whose last comparison had the reference harness on one side, or that a later report set aside, and no other. The other harness is whichever the reference harness was compared with there. These are measurements and no target.",
  weak: "The same harness fails a task once and passes it the next time, so a count over a few tasks, and more so one family's share of them, is weak evidence.",
} as const;
/** What the turns say before their rows. */
const TURNS =
  "The solver's own turns each valid answer of the reference harness took, in the same comparisons as the lines above, by family and fewest first. These are measurements and no target.";

/** One line a task among `tasks`, in their order: the task by id and family, its outcome, and for
 *  a held-out task whether a valid answer to it is on record; and, from the same pass, the counts
 *  by family (`counts`). A task the log refused is left out, since it is no task of the exam. One
 *  the log does not hold, and one no comparison has scored, is not yet compared and in no count. */
export function heard(events: readonly LogEvent[], tasks: readonly Pick<Task, "taskId" | "family">[]): Heard {
  const states = taskStates(events);
  const outcomes = outcomesOf(events);
  const standings = standingsOf(events);
  const feasible = feasibleTasks(events);
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
  const families = new Map<string, Standing[]>();
  const lines = tasks.flatMap(({ taskId, family }) => {
    const version = versions.get(taskId) ?? "";
    const state = states.get(version) ?? "";
    if (state === "refused") return [];
    const settled = SETTLED.get(state);
    if (settled !== undefined) return [`${taskId} (family ${family}): ${settled}`];
    const standing = standings.get(version);
    if (standing !== undefined) families.set(family, [...(families.get(family) ?? []), standing]);
    const read = standing !== undefined && standing.cell !== "aside";
    const valid = read ? (answers.get(version) ?? []).flatMap((solve) => took.get(solve) ?? []) : [];
    if (valid.length > 0) turns.set(family, [...(turns.get(family) ?? []), ...valid]);
    const outcome = outcomes.get(version);
    const said = outcome === undefined ? "not yet compared" : SAID[outcome];
    return [`${taskId} (family ${family}): ${said}; ${feasible.has(version) ? KNOWN.yes : KNOWN.no}`];
  });
  return { lines, counts: counts(families), turns: turnsOf(turns) };
}

/** The reference harness's valid answers to each task, by solve id, in the last comparison that
 *  tallied it, read as its outcome and its standing are (`taskRecords`, `reports.ts`): from the
 *  side the reference stood on there, and none where it stood on neither. */
function referenceAnswers(events: readonly LogEvent[]): Map<string, string[]> {
  const reports = lastReports(events);
  const reference = promoted(events) ?? reports[0]?.data.old;
  const answers = new Map<string, string[]>();
  for (const report of reports) {
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
  const rows = [...families].map(
    ([family, taken]) => `- family ${family}: ${taken.toSorted((a, b) => a - b).join(", ")}`,
  );
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
    const apart = of("other-won") + of("reference-won");
    const none = of("tied-none") + of("tied-none-known");
    return `- ${name}, ${plural(standings.length, "task")}: ${String(apart)} told apart, won by the other harness ${String(of("other-won"))} and by the reference harness ${String(of("reference-won"))}; ${String(of("tied-every"))} tied with both harnesses valid in every solve; ${String(none)} tied with neither valid in any solve, of which ${String(of("tied-none-known"))} with a valid answer on record; ${String(of("tied-mixed"))} tied otherwise; ${String(of("aside"))} set aside on a rejection not settled.`;
  };
  const byFamily = [...families.values()].every((standings) => standings.length > 1);
  const rows = byFamily ? [...families].map(([family, standings]) => row(`family ${family}`, standings)) : [];
  const sizes = [...new Set(every.flatMap(({ solves }) => solves ?? []))].toSorted((a, b) => a - b);
  const [fewest] = sizes;
  const most = sizes.at(-1) ?? 0;
  const span = fewest === most ? plural(most, "solve") : `${String(fewest)} to ${String(most)} solves`;
  return [
    COUNTS.head,
    ...rows,
    ...(families.size > 1 ? [row("every family", every)] : []),
    `${fewest === undefined ? "" : `Each count rests on ${span} a side of the task's last comparison. `}${COUNTS.weak}`,
  ].join("\n");
}
