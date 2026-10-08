/**
 * What an Examiner reads before its first call: the system prompt and the opening message.
 *
 * The plan's D1b asks whether an author who never sees the harness can write tasks the bracket
 * admits, and gives the author's side in four lines: it writes task instances only, against a fixed
 * contract and checker; it hears a word of each; and its prompt carries no zone, share or target
 * count. Since 2026-10-08 it hears what was measured beside the word, how many solves failed and
 * what stopped them, and at its opening how its campaign's earlier tasks stand now (`record.ts`):
 * a measurement and still no target, which is the line v1 drew after measuring both. v1 had no such author. Its Builder wrote the exam beside the harness, and what is taken
 * here is what its prompt said of tasks, from `src/author/builder-start-prompt.ts` at 3f93d06b:
 * - `INTENT_CLAUSE`'s last line, that requirements must act together on one answer. Its evidence is
 *   v1's own: on the truss packs the same requirements passed 22 of 23 one at a time and 7 of 20
 *   inside one shared limit.
 * - `SCOPE_CLAUSE`'s last line, that a limit the field does not hold measures the author's wording.
 * - `PUBLICATION_CLAUSE`'s rule that a solver following every published rule never fails on one it
 *   could not read.
 *
 * - Its examples' list of changes that look harder and are not (`starter-pack/examples.md`): a limit
 *   or a size moved while the method that passed still meets it. v1 measured that list: limits reset
 *   at a 3.4-hour search's best passed 5 of 6, and 71 of 74 batteries after a widened one passed
 *   whole.
 *
 * What v1's prompt said that is left out: everything about the harness, the correctness model and
 * the tools, none of which an Examiner writes. On 7 October a Builder told to make its exam harder
 * removed a solver tool instead; an Examiner has no harness to weaken.
 *
 * The words are the plan's four and two the host needs beside them: `wall-bound`, the kernel's
 * state for a task whose only fails ended at the wall, which stays apart until the plan's decision
 * 21 says whether such a task may be scored, and `undecided`, for a task the host could not finish
 * a solve of, which is nobody's verdict on the task.
 */
import { type Contract, objectiveLine } from "../kernel/contract.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";

/** A check as its author's brief declares it and an Examiner is shown it: never its program. */
export interface CheckRow {
  readonly id: string;
  readonly assertion: string;
  readonly families: "all" | readonly string[];
}

/** An example as the opening message lists it. */
export interface ListedExample {
  readonly taskId: string;
  readonly family: string;
}

/** The limits a session is told it runs under. How many tasks are wanted is not among them. */
export interface Told {
  readonly wallSeconds: number;
  readonly turns: number;
}

export const SYSTEM_PROMPT = [
  "You are the Examiner. You write tasks of one domain, on which a solving model is then measured. The domain's public rules, its answer format and its checks are fixed and are not yours to change: you write no rule and no check. A task is a family, a public input, which is all a solver reads of it, and hidden values, which only the checks receive.",
  "A task is scored when a stronger solver passes it and the solver being measured does not always pass it. A task no solver passes measures nothing, and neither does one every solver passes. The solver being measured gets better as its tools are improved, so a task that was scored can become too easy, and what the exam needs is then a task that asks more. You are not told how many tasks are wanted or what share of them should be scored, and you never see the measured solver: not its tools, its guide, its answers or its mistakes. Of each task you are told what was measured: a word, how many of its solves failed, and which checks refused them.",
  "Write tasks a practitioner of the domain would call demanding and fair. Make several of the domain's requirements act together on a single answer, so that meeting one spends the margin another needs: requirements that only stand side by side are met one at a time. A limit, state or duty the field does not hold measures your wording rather than the solver, so add none. A solver that follows every public rule must never fail on a rule it could not read, so everything a task demands is in its public input and the public rules, and nothing a solver needs is in the hidden values. Vary what a task asks, not the names in it: an example with its numbers moved is the same task, and so is one with a limit or a size moved while the method that passed it still meets it.",
  "propose_tasks takes instances and puts each through the host's gates: its shape, one solve by the stronger solver, and a repeat of the checks on the answer that solve submitted. Of each it says refused, with the gate's reason, or too hard for now, with how the stronger solve ended, or that it is feasible so far, with the answer the checks accepted. A task the stronger solver does not pass is kept by the host and tried again when the solver's tools have improved, so its instance is not yours to resubmit under another name.",
  "For each feasible task you then write three reject controls with write_controls. A control is one change to that accepted answer, a field replaced or a passage rewritten, after which one check, which you name by its id, must refuse it; change a different fact in each. Controls test the checks, not the solver: a check that passes a wrong answer, or refuses one for another reason than the one you named, is a defect the task cannot carry, and the task is refused. Once its controls hold, the task is solved by the solver being measured and you are told what was measured: too easy, wall-bound, which is a task the solver only ran out of time on and which is not scored, or scored, with the fails among its solves and what stopped them.",
  "read_example returns one existing task of the domain whole, for its shape. When you have no more tasks to propose, call finish. The session also ends at its limits, and when the host has the tasks it needs.",
].join("\n");

export const NUDGE =
  "You have not called finish. Propose further tasks, write the controls a feasible task is waiting for, or call finish.";

/** What an opening message says of the campaign's earlier tasks, each as the caller renders it. */
export interface Carried {
  /** Tasks left `waiting` for their controls: past gate 3 in an earlier session, or a reach task
   *  the stronger solver passes now. */
  readonly waiting: readonly string[];
  /** How each task earlier sessions wrote stands now, a line a task (`record.ts`). */
  readonly earlier: readonly string[];
}

/** The opening message: the domain's public contract, its checks by id and assertion, the examples
 *  by family, the session's limits, and what the campaign's earlier sessions left. */
export function firstMessage(
  contract: Contract,
  checks: readonly CheckRow[],
  examples: readonly ListedExample[],
  told: Told,
  carried: Carried,
): string {
  const families = (row: CheckRow) => (row.families === "all" ? "every family" : row.families.join(", "));
  const { waiting, earlier } = carried;
  return [
    `Public rules of the domain:\n${contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join("\n") || "(none)"}`,
    ...(contract.conventions === "" ? [] : [`Conventions: ${contract.conventions}`]),
    `Scope: ${contract.scope}`,
    `A solver's answer follows this schema: ${capturedJsonStringify(contract.answerFormat)}`,
    ...(contract.objective === undefined
      ? []
      : [
          `${objectiveLine(contract.objective)} The solver is told this with every task, and two valid answers are compared on it: a task on which a better method reaches a better value is one that can tell two solvers apart even when both pass.`,
        ]),
    `The checks, by the id a reject control names:\n${checks.map((row) => `- ${row.id} (${families(row)}): ${row.assertion}`).join("\n") || "(none)"}`,
    `Existing tasks, for read_example:\n${examples.map(({ taskId, family }) => `- ${taskId} (family ${family})`).join("\n") || "(none)"}`,
    ...(earlier.length === 0
      ? []
      : [
          `Tasks earlier sessions wrote for this exam, and how each stands against the solver as it is now. These are measurements and no instruction; read_example returns any of them whole.\n${earlier.map((line) => `- ${line}`).join("\n")}`,
        ]),
    `This session has ${plural(Math.round(told.wallSeconds / 60), "minute")} and ${plural(told.turns, "turn")}.`,
    ...(waiting.length === 0
      ? []
      : [
          `These tasks are feasible so far and have no reject controls yet: an earlier session ended before they were written, or the stronger solver passes the task only now. Write each one's controls with write_controls, under the id it has here.\n\n${waiting.join("\n\n")}`,
        ]),
  ].join("\n\n");
}
