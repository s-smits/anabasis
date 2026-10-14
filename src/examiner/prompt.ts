/**
 * What an Examiner reads before its first call: the system prompt and the opening message.
 *
 * The Examiner writes task instances only, against a fixed contract and check program. It is told
 * why a package was refused, and at its opening, of each task the campaign holds, the pack's and
 * the ones earlier sessions wrote, one outcome and whether a valid answer to it is on record, with
 * those tasks counted by family, or in a total where a family holds one task (`record.ts`). Its
 * prompt carries no zone, share or target count, which is the line v1 drew after measuring both:
 * the counts are measured facts with their denominators, told on the operator's decision of 11
 * October, and name no number to reach. A task the reference answers in no solve "is where a
 * better harness could show" only where a valid answer to it is on record, and the prompt says so.
 *
 * v1 had no such author. Its Builder wrote the exam beside the harness, and what is taken here is
 * what its prompt said of tasks, from `src/author/builder-start-prompt.ts` at 3f93d06b:
 * - `INTENT_CLAUSE`'s last line, that requirements must act together on one answer. Its evidence is
 *   v1's own: on the truss packs the same requirements passed 22 of 23 one at a time and 7 of 20
 *   inside one shared limit. The plan names it the one change that made tasks harder.
 * - `SCOPE_CLAUSE`'s last line, that a limit the field does not hold measures the author's wording.
 * - `PUBLICATION_CLAUSE`'s rule that a solver following every published rule never fails on one it
 *   could not read.
 * - Its examples' list of changes that look harder and are not (`starter-pack/examples.md`): a limit
 *   or a size moved while the method that passed still meets it. v1 measured that list: limits reset
 *   at a 3.4-hour search's best passed 5 of 6, and 71 of 74 batteries after a widened one passed
 *   whole.
 *
 * What v1's prompt said that is left out: everything about the harness, the correctness model and
 * the tools, none of which an Examiner writes. On 7 October a Builder told to make its exam harder
 * removed a solver tool instead; an Examiner has no harness to weaken.
 *
 * The prompt describes no stronger solver and asks for no reject controls (`docs/plan.md`, Phase
 * 2). It says how a task is scored: under one compute budget for both harnesses, an answer that
 * passes every check within it is valid, and the harness with more valid answers wins the task. A
 * task that can tell two harnesses apart is therefore one a better method answers validly within
 * the budget and a worse one does not, which is what the text asks for. The budget's size is told
 * as a fact (`firstMessage`), with the sentence that it is no target: while it was
 * withheld, on the reasoning that an author told it would write towards it, the tasks of ten
 * campaigns tied under both harnesses, and a task that separates two harnesses at three turns
 * cannot be written without knowing three. The minutes are the recorded setting's, which the
 * caller reads (`tools/d1b/examine.ts`).
 *
 * The prompt says that a task needs a valid answer, and one way to be sure of one: `try_answer`
 * runs the checks on an instance with an answer of the Examiner's, and a walled shell computes
 * (`write.ts`). A task is held out on the shape of its package, and nothing solves it first
 * (`AGENTS.md`, rule 9), so nothing but its author stands between the exam and a task no answer
 * satisfies. In the first campaign opened from a prompt an Examiner whose tasks had all tied
 * pressed the next ones to the margin, and two of seven asked for more addresses than their block
 * had free: every solve of both harnesses failed them, which a comparison reads as two ties. On
 * 10 October the notes of nine Examiner sessions on two stored packs said in at least eight that a
 * task's feasibility rested on hand estimates. The sentence asks for no easier task: an answer
 * chosen first can sit as close to a limit as its author likes.
 *
 * The prompt names v1's lever as such, several requirements that share one limit, and for a domain
 * whose instances scale has the Examiner plant an answer and grow the task around it (the overhaul
 * plan, S.4 and L2). The planted answer is the witness of the feasibility gate: the log keeps no
 * answer `try_answer` passes, the session holds it in memory alone, and the gate refuses a task
 * that carries one whole (`write.ts`), so it never reaches a solver and rule 9 holds. Growing by
 * size alone is named as no growth: in the overhaul's research a reference solver's time
 * correlated -0.15 with how hard a generated task was for a model, and a harness with the field's
 * solver tools gained 28 points on such tasks, so a harness that holds the engine absorbs scale.
 *
 * A session whose host can have the reference harness solve a draft task holds tasks out by
 * `try_task` in `propose_tasks`' place: a package that passes the shape is solved `TRIED` times
 * afresh under the budget, and held out only where some of those solves gave a valid answer and not
 * all (the operator's ruling of 12 October, which reverses the plan's refusal of a screen;
 * `write.ts`). The prompt says so, and that the Examiner is told the count and nothing else of
 * them. The reference harness is the one the campaign measures against, and no stronger solver:
 * rule 9 of `AGENTS.md` still holds, and a check still decides every answer.
 */
import { type Contract, objectiveLine } from "../kernel/contract.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";
import type { heard } from "./record.ts";

/** A check as its author's brief declares it and an Examiner is shown it: never its program. */
export interface CheckRow {
  readonly id: string;
  readonly assertion: string;
  readonly families: "all" | readonly string[];
}

/** The system prompt of a session that holds tasks out by `propose_tasks`, or, given how many
 *  solves try one, by `try_task`. */
export function systemPrompt(tried: number | undefined): string {
  const tool = tried === undefined ? "propose_tasks" : "try_task";
  // The gate a task enters the exam by: its package's shape alone, or that and `tried` fresh solves
  // of it by the reference harness, of which some and not all must be valid (`try_task`).
  const gate =
    tried === undefined
      ? "propose_tasks takes instances and puts each to the host's one gate, which reads the shape of its package: its family, its inputs, and that the checks have what they need to run on it. Of each it says held out, or refused with the gate's reason. A task that is held out is in the exam from then on. No solver is put to it while you wait, so you hear nothing more of it in this session."
      : `try_task takes instances and puts each to the host's gate, one at a time. The gate reads the shape of its package first: its family, its inputs, and that the checks have what they need to run on it. A package that passes is solved ${String(tried)} times by the reference harness, each solve fresh and under the budget, and the task is held out only where some of those solves gave a valid answer and not all: one it answers every time leaves no room, and one it never answers may have no valid answer at all. Of each it says held out with how many of the solves were valid, or refused with the reason; no solve's answer or trace is shown to you. A task that is held out is in the exam from then on, and the solves that tried it are never scored: the comparisons solve it afresh.`;
  return [
    "You are the Examiner. You write tasks of one domain, on which a solving model is then measured. The domain's public rules, its answer format and its checks are fixed and are not yours to change: you write no rule and no check. A task is a family, a public input, which is all a solver reads of it, and hidden values, which only the checks receive.",
    "The solver is measured by comparison. Each task is solved several times by the solver with one set of tools, called a harness, and several times with another, every solve under the same fixed budget of turns and computing time. An answer that passes every check within that budget is valid, and on each task the harness that gives more valid answers wins; where the domain declares an objective, two valid answers are compared by it, and the better one wins. Without an objective, a task both harnesses answer validly every time tells them apart no more than one neither can answer. So what the exam needs is a task a better method answers validly within the budget and a worse one does not, or, under an objective, answers better. You are not told how many tasks are wanted, and you never see the measured solver: not its tools, its guide, its answers or its mistakes. The budget is given at your opening, as a fact.",
    "Write tasks a practitioner of the domain would call demanding and fair. What has made tasks harder before is several of the domain's requirements sharing one limit, so that meeting one spends the margin another needs: requirements that only stand side by side are met one at a time. A limit, state or duty the field does not hold measures your wording rather than the solver, so add none. A solver that follows every public rule must never fail on a rule it could not read, so everything a task demands is in its public input and the public rules, and nothing a solver needs is in the hidden values. A task with no valid answer measures nothing, since every harness fails it alike: make sure one exists by planting it, starting from an answer that keeps every rule, deriving the task from it, and putting both to try_answer, which runs the checks on them and says which refuse the answer. Where the domain's instances scale, grow a planted task: add requirements around the planted answer that bear on the limit it already meets, and put it to try_answer again at each step. The planted answer is for try_answer alone: no task carries it, in its public input or its hidden values, and the gate refuses one that does. An answer that passes can sit as close to a limit as you like, and the task is as demanding as the answer is hard to find. Vary what a task asks, not the names in it: an example with its numbers moved is the same task, and so is one made larger, or with a limit moved, while the method that answered it still does. Growing a task by size alone grows nothing: a harness that holds the field's engine answers a larger instance as it answers a small one.",
    `${gate} At your opening you are told two things of each task the exam holds so far, the older and easier ones included: how the reference harness, the one a new harness is measured against, did on it in the last comparison that scored it, valid in every one of its solves, in some, or in none, or that it is disputed, which is a rejected answer whose rejection is not settled; and whether a valid answer to it is on record. Where the reference harness stood in two or more comparisons of a task you are told the same of each of its last three, newest first, and how many of the newest closed it in a row: a task answered in every solve once is one draw, and one answered so every time running is another kind of fact. A task answered in every solve of two comparisons, in any order, is no longer scored but for a third of such tasks kept in the draw, and a solve a limit cut is named apart from a wrong answer. Beside them you are told, by family or in a total, how many of those tasks the same comparisons told apart and which side won them, how many tied with both harnesses valid in every solve, how many tied with neither valid in any, and how many tied otherwise; and, by family, how many of the solver's own turns each valid answer of the reference harness took there. Without an objective, a task the reference harness answers in every solve leaves no room. One it answers in none is where a better harness could show, where a valid answer to it is on record; where none is, it may have no valid answer at all. What the exam needs from every session is the same: tasks the reference harness does not answer in every solve, harder for a solver than the ones it answers, within the domain's scope, which a solver under the budget can fail and which still have a valid answer. Harder is yours to judge from the domain; the outcomes say which tasks so far were answered by every solve, and the reference harness changes as the campaign goes on.`,
    `read_example returns one task of the exam whole, for its shape. try_answer runs the checks on an instance with an answer of yours: no task enters the exam by it, and where the checks pass the host records only that the instance has a valid answer, holding the answer itself for this session alone. bash, read and write are yours in a home of your own, closed to everything but your work, for computing an instance or an answer; the home holds what the last Examiner session of this campaign left in it, and is empty at the campaign's first. What you compute there enters the exam through ${tool} alone. Propose in rounds: put a batch to the gate, read what it said, and propose more. When you have no more tasks worth proposing, call finish; a first finish while the host does not yet have the tasks it needs is answered with that, and the session goes on. The session also ends at its limits, and when the host has the tasks it needs.`,
  ].join("\n");
}

/** The opening message: the operator's brief where the campaign opened from one, the domain's
 *  public contract, its checks by id and assertion, and every task the campaign holds with its one
 *  outcome, a line a task, with the counts by family or in a total beside them, as `record.ts`
 *  renders both. `told` is the limits the session is told it runs under; how many tasks are wanted
 *  is not among them. `campaign` is what it is told of its campaign beside the contract, each null
 *  where there is none: the operator's brief, the budget every solve is held to, and what the last
 *  Examiner session said at its `finish`, the one thing a session leaves the next beside its tasks
 *  and its home. */
export function firstMessage(
  contract: Contract,
  checks: readonly CheckRow[],
  tasks: ReturnType<typeof heard>,
  told: { readonly wallSeconds: number; readonly turns: number },
  campaign: {
    readonly brief: string | null;
    readonly budget: { readonly modelTurns: number | null; readonly minutes: number } | null;
    readonly lastNote: string | null;
  },
): string {
  const { brief, budget, lastNote } = campaign;
  const families = (row: CheckRow) => (row.families === "all" ? "every family" : row.families.join(", "));
  return [
    // The brief first, where the campaign opened from one: every session rereads the domain as the
    // operator put it, and not only the exam drafted from it. The rules govern.
    ...(brief === null
      ? []
      : [
          `The domain, as the operator put it when the campaign opened. The rules below are the exam drafted from it and govern where the two differ:
${brief}`,
        ]),
    `Public rules of the domain:\n${contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join("\n") || "(none)"}`,
    ...(contract.conventions === "" ? [] : [`Conventions: ${contract.conventions}`]),
    `Scope: ${contract.scope}`,
    ...(contract.objective === undefined ? [] : [`Objective: ${objectiveLine(contract.objective)}`]),
    `A solver's answer follows this schema: ${capturedJsonStringify(contract.answerFormat)}`,
    // The budget as a fact: a task that tells two harnesses apart is one a better method answers
    // within it and a worse one does not, which nobody can write without knowing it.
    ...(budget === null
      ? []
      : [
          `Every solve of a task is held to ${budget.modelTurns === null ? "no fixed number of the solver's own turns" : `${plural(budget.modelTurns, "turn")} of the solver's own`}, a turn being one reply with the tool calls in it, and ${plural(budget.minutes, "minute")}. Both harnesses are measured under that budget, and the number may change as the campaign goes on. This is the measure of "within the budget" above; it is no target of yours.`,
        ]),
    `The checks, by id:\n${checks.map((row) => `- ${row.id} (${families(row)}): ${row.assertion}`).join("\n") || "(none)"}`,
    `The tasks of the exam so far, what the last comparison that scored each one found, and whether a valid answer to it is on record. These are measurements and no instruction. read_example returns any of them whole.\n${tasks.lines.map((line) => `- ${line}`).join("\n") || "(none)"}`,
    ...(tasks.refused.length === 0
      ? []
      : [
          `The drafts the gate refused after reading them, with its reason. None is a task of the exam, and an instance an earlier session wrote is not taken again:\n${tasks.refused.map((line) => `- ${line}`).join("\n")}`,
        ]),
    ...(tasks.counts === null ? [] : [tasks.counts]),
    ...(tasks.turns === null ? [] : [tasks.turns]),
    ...(lastNote === null
      ? []
      : [
          `What the last Examiner session of this campaign said at its finish, in its own words:\n${lastNote}`,
        ]),
    `This session has ${plural(Math.round(told.wallSeconds / 60), "minute")} and ${plural(told.turns, "turn")}.`,
  ].join("\n\n");
}
