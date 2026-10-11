/**
 * What an Examiner reads before its first call: the system prompt and the opening message.
 *
 * The Examiner writes task instances only, against a fixed contract and check program. It is told
 * why a package was refused, and at its opening one outcome of each task the campaign holds, the
 * pack's and the ones earlier sessions wrote, and aggregate counts from the last scored comparison
 * involving the current reference (`record.ts`). Its prompt carries no zone, share or target count, which is the line v1 drew
 * after measuring both. v1 had no such author. Its Builder wrote the exam beside the harness, and
 * what is taken here is what its prompt said of tasks, from `src/author/builder-start-prompt.ts`
 * at 3f93d06b:
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
 * Until 2026-10-09 the prompt described a stronger solver that had to pass a task, three reject
 * controls the Examiner wrote from that solver's answer, and a word for how the measured solver
 * did. The plan removes all three (`docs/plan.md`, Phase 2), and the prompt says instead how a
 * task is scored now: under one compute budget for both harnesses, an answer that passes every
 * check within it is valid, and the harness with more valid answers wins the task. A task that can
 * tell two harnesses apart is therefore one a better method answers validly within the budget and
 * a worse one does not, which is what the text asks for. Until 10 October the budget's size was
 * not told, on the reasoning that an author told it would write towards it; the tasks of ten
 * campaigns tied under both harnesses, and a task that separates two harnesses at three turns
 * cannot be written without knowing three. It is told now as a fact (`Facts`, `firstMessage`),
 * with the sentence that it is no target. The minutes are the recorded setting's: until
 * 11 October the examine command read them from the campaign's default limits, so the two buffer
 * sessions of that day were told 120 minutes where every solve ran under 8.
 *
 * Since 2026-10-09 the prompt says that a task needs a valid answer, and one way to be sure of
 * one; since 10 October `try_answer` runs the checks on an instance with an answer of the
 * Examiner's, and a walled shell computes, where before the Examiner could run nothing and said
 * so (`session.ts`). A task is held out on the shape of its package, and nothing solves it first (`AGENTS.md`,
 * rule 9), so nothing but its author stands between the exam and a task no answer satisfies. In
 * the first campaign opened from a prompt an Examiner whose tasks had all tied pressed the next
 * ones to the margin, and two of seven asked for more addresses than their block had free: every
 * solve of both harnesses failed them, which a comparison reads as two ties and its reader, until
 * the same day, as room. The same day's notes of nine Examiner sessions on two stored packs say
 * in at least eight that a task's feasibility rests on hand estimates. The sentence asks for no
 * easier task: an answer chosen first can sit as close to a limit as its author likes.
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

/** The limits a session is told it runs under. How many tasks are wanted is not among them. */
/** What a session is told of its campaign beside the contract: the operator's brief, where the
 *  campaign opened from one, and the budget every solve is held to, where the caller knows it. */
interface Facts {
  readonly comparison?: readonly string[] | undefined;
  readonly brief?: string | null | undefined;
  readonly budget?: { readonly modelTurns: number | null; readonly minutes: number } | null | undefined;
  /** What the last Examiner session of the campaign said at its `finish`, in its own words, where
   *  one did: the one thing a session leaves the next beside its tasks and its home (11 October;
   *  until then the note was logged and shown to nobody). */
  readonly lastNote?: string | null | undefined;
}

export interface Told {
  readonly wallSeconds: number;
  readonly turns: number;
}

export const SYSTEM_PROMPT = [
  "You are the Examiner. You write tasks of one domain, on which a solving model is then measured. The domain's public rules, its answer format and its checks are fixed and are not yours to change: you write no rule and no check. A task is a family, a public input, which is all a solver reads of it, and hidden values, which only the checks receive.",
  "The solver is measured by comparison. Each task is solved several times by the solver with one set of tools, called a harness, and several times with another, every solve under the same fixed budget of turns and computing time. An answer that passes every check within that budget is valid, and on each task the harness that gives more valid answers wins; where the domain declares an objective, two valid answers are compared by it, and the better one wins. Without an objective, a task both harnesses answer validly every time tells them apart no more than one neither can answer. So what the exam needs is a task a better method answers validly within the budget and a worse one does not, or, under an objective, answers better. You are not told how many tasks are wanted, and you never see the measured solver: not its tools, its guide, its answers or its mistakes. The budget is given at your opening, as a fact.",
  "Write tasks a practitioner of the domain would call demanding and fair. Make several of the domain's requirements act together on a single answer, so that meeting one spends the margin another needs: requirements that only stand side by side are met one at a time. A limit, state or duty the field does not hold measures your wording rather than the solver, so add none. A solver that follows every public rule must never fail on a rule it could not read, so everything a task demands is in its public input and the public rules, and nothing a solver needs is in the hidden values. A task with no valid answer measures nothing, since every harness fails it alike: make sure one exists, by starting from an answer that keeps every rule, deriving the task from it, and putting both to try_answer, which runs the checks on them and says which refuse the answer. An answer that passes can sit as close to a limit as you like, and the task is as demanding as the answer is hard to find. Vary what a task asks, not the names in it: an example with its numbers moved is the same task, and so is one with a limit or a size moved while the method that answered it still does.",
  "propose_tasks takes instances and puts each to the host's one gate, which reads the shape of its package: its family, its inputs, and that the checks have what they need to run on it. Of each it says held out, or refused with the gate's reason. A task that is held out is in the exam from then on. No solver is put to it while you wait, so you hear nothing more of it in this session. At your opening you are told one thing of each task the exam holds so far, the older and easier ones included: how the reference harness, the one a new harness is measured against, did on it in the last comparison that scored it, valid in every one of its solves, in some, or in none; or that it is disputed, which is a rejected answer whose rejection is not settled. Without an objective, a task the reference harness answers in every solve leaves no room; one it answers in none is where a better harness could show. What the exam needs from every session is the same: tasks the reference harness does not answer in every solve, harder for a solver than the ones it answers, within the domain's scope, which a solver under the budget can fail and which still have a valid answer. Harder is yours to judge from the domain; the outcomes say which tasks so far were answered by every solve, and the reference harness changes as the campaign goes on.",
  "read_example returns one task of the exam whole, for its shape. try_answer runs the checks on an instance with an answer of yours and keeps no answer: no task enters the exam by it, and where the checks pass the host keeps only that the instance has a valid answer. bash, read and write are yours in a home of your own, closed to everything but your work, for computing an instance or an answer; the home holds what the last Examiner session of this campaign left in it, and is empty at the campaign's first. What you compute there enters the exam through propose_tasks alone. Propose in rounds: put a batch to the gate, read what it said, and propose more. When you have no more tasks worth proposing, call finish; a first finish while the host does not yet have the tasks it needs is answered with that, and the session goes on. The session also ends at its limits, and when the host has the tasks it needs.",
].join("\n");

export const NUDGE = "You have not called finish. Propose further tasks, or call finish.";

/** The opening message: the operator's brief where the campaign opened from one, the domain's
 *  public contract, its checks by id and assertion, the session's limits, and every task the
 *  campaign holds with its one outcome, and the comparison summary, as `record.ts` renders them. */
export function firstMessage(
  contract: Contract,
  checks: readonly CheckRow[],
  listed: readonly string[],
  told: Told,
  campaign: Facts = {},
): string {
  const { brief = null, budget = null, lastNote = null, comparison = [] } = campaign;
  const families = (row: CheckRow) => (row.families === "all" ? "every family" : row.families.join(", "));
  return [
    // The brief first, where the campaign opened from one: every session rereads the domain as the
    // operator put it, and not only the exam drafted from it (10 October). The rules govern.
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
    // within it and a worse one does not, which nobody can write without knowing it (10 October).
    ...(budget === null
      ? []
      : [
          `Every solve of a task is held to ${budget.modelTurns === null ? "no fixed number of the solver's own turns" : `${plural(budget.modelTurns, "turn")} of the solver's own`}, a turn being one reply with the tool calls in it, and ${plural(budget.minutes, "minute")}. Both harnesses are measured under that budget, and the number may change as the campaign goes on. This is the measure of "within the budget" above; it is no target of yours.`,
        ]),
    `The checks, by id:\n${checks.map((row) => `- ${row.id} (${families(row)}): ${row.assertion}`).join("\n") || "(none)"}`,
    `The tasks of the exam so far, what the last comparison that scored each one found, and whether a valid answer to it is on record. These are measurements and no instruction. read_example returns any of them whole.\n${listed.map((line) => `- ${line}`).join("\n") || "(none)"}`,
    ...(comparison.length === 0 ? [] : [`Comparison summary:\n${comparison.join("\n")}`]),
    ...(lastNote === null
      ? []
      : [
          `What the last Examiner session of this campaign said at its finish, in its own words:\n${lastNote}`,
        ]),
    `This session has ${plural(Math.round(told.wallSeconds / 60), "minute")} and ${plural(told.turns, "turn")}.`,
  ].join("\n\n");
}
