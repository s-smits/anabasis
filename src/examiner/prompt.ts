/**
 * What an Examiner reads before its first call: the system prompt and the opening message.
 *
 * The Examiner writes task instances against a fixed contract and check program. Its prompt
 * carries no zone, share or target count: an author told one wrote towards it in v1, so it is
 * told measured facts with their denominators (`record.ts`) and the budget every solve is held to,
 * since a task that tells two harnesses apart is one a better method answers within that budget
 * and a worse one does not. While the budget was withheld the tasks of ten campaigns tied.
 *
 * Room is defined once, in the scoring section, as a comparison reads it (`informative`,
 * `src/kernel/compare.ts`), with the objective's floor (`ROOM`); the gate section and the opening
 * refer to it. What v1's prompt said of tasks is kept: requirements that share one limit (on the
 * truss packs the same requirements passed 22 of 23 one at a time and 7 of 20 inside one shared
 * limit), no limit the field does not hold, nothing a solver needs in the hidden values, and no
 * growth by size or a moved limit alone (limits reset at a 3.4-hour search's best passed 5 of 6).
 *
 * A task needs a valid answer, and the prompt says how to be sure of one: plant it, put it to
 * `try_answer`, and grow the task around it. Nothing solves a task before it is held but the
 * reference harness at the gate (`AGENTS.md`, rule 9), so the author alone stands between the
 * exam and a task no answer satisfies: in the first campaign opened from a prompt, two of seven
 * tasks pressed to the margin had none. The planted answer never reaches a solver: the gate
 * refuses a task that carries it (`write.ts`).
 *
 * The solve is described as one system, the model inside the harness, because an Examiner that read
 * the reference harness's programs wrote against them: at esp32-fresh-opus-terra's x-4 (27 October)
 * ten drafts made `plan-pins` fail, the solver repaired each in 3 to 7 of its 20 turns, and the
 * gate refused all ten. The three kinds of room are listed apart, and beside them the three kinds
 * of draft the gates of the v0.7.2 runs held: requirements sharing a limit, rules that together
 * rule out the usual answer, and an objective's best in a narrow region.
 *
 * Each fact is stated once, in the section that owns it (17 October, #191: 1,088 words to 793).
 * The opening separates interrupted gates from measured refusals: incomplete admission leaves
 * room undecided, and its draft can be recovered and proposed afresh unless a later gate read it.
 */
import { ROOM } from "../kernel/compare.ts";
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
 *  solves try one, by `try_task`. Each fact is stated once, in the section that owns it; the
 *  tools' descriptions point here for the gate (plan item 5.1, 14 October). `reference` says
 *  whether a copy of the reference harness lies in the home (`exam-reference`, 19 October). */
export function systemPrompt(tried: number | undefined, reference: "in-home" | "unseen"): string {
  const tool = tried === undefined ? "propose_tasks" : "try_task";
  const floor = `${String(ROOM * 100)}%`;
  // The gate a task enters the exam by: its package's shape alone, or that and `tried` fresh solves
  // of it by the reference harness, held where they leave the room the scoring section names.
  const solved =
    tried === undefined
      ? " No solver is put to it while you wait, so you hear nothing more of it in this session."
      : ` A package that passes is solved by the reference harness, each solve fresh and under the budget: once alone, and where that leaves no room as above up to ${String(tried - 1)} more times together. It is held out at the first solve after which its solves leave room, the others then stopped, or refused once ${String(tried)} have not; where none gave a valid answer, only where an answer of yours passed try_answer on the same instance. You are shown how many solves were valid, the turns each valid one took and, where the domain declares an objective, what each measured and what your answer measured, with how far yours is from its best, and no answer or trace; the gate's solves are never scored.`;
  return [
    "You are the Examiner. You write tasks of one domain, on which a solving model is then measured. The domain's public rules, its answer format and its checks are fixed: you write no rule and no check. A task is a family, a public input, which is all a solver reads of it, and hidden values, which only the checks receive.",
    `## Who solves a task\n\nA solve is one system: a solving model working inside a harness. The model reads the task's public input, the public rules and the harness's guide, then works in a shell: it runs the harness's programs and tools, reads everything they print, errors included, writes and runs code of its own, and submits one answer, all within the budget of turns and minutes your opening states. A program that fails where the model can see it is one the model can retry, repair or work around in the turns it has left, so a draft on which one program fails is not yet a draft on which the system fails. The reference harness is the one a new harness is measured against: the starter, which holds no program of the domain, until a comparison promotes a better one. A promoted harness was built by a Builder on the tasks released for practice, and its guide and programs carry what it learned there. ${
      reference === "in-home"
        ? "A copy of the reference harness is in your home under reference-harness/, to read and run: its guide (agent/BUILT_AGENTS.md), its tools (agent/tools-spec.json, agent/tools.ts) and the programs its solver runs by name (.toolchain/bin). You never see a solver's answers or its mistakes."
        : "You never see the solver: not its tools, its guide, its answers or its mistakes."
    }`,
    `## How a task is scored\n\nEach task is solved several times under the reference harness and several times under the new one, each solve fresh and held to the budget. An answer that passes every check within the budget is valid. Each task is scored over every pairing of a solve of each harness: by validity first and most, a valid answer beating one that is not, and between two valid answers by how much better one is by the objective, where the domain declares one, and by how much less its solve billed. The harness the score favours wins the task. A comparison scores only tasks the gate held out.\n\nA task leaves the reference harness room in one of three ways:\n- on validity: its solves are valid in some and not all. A solve fails where the model's method misses something the public rules require, or reaches no answer within the budget.\n- on an answer of yours: none of its solves is valid, while a valid answer is on record, such as yours that passed try_answer on the same instance.\n- on the objective, where the domain declares one: an answer on record, another of its own or yours among them, is better by the objective than one of its own by at least ${floor} of the larger measure, even where every one of its solves is valid.\n\nA task it answers every time, with no answer on record that much better than its own, leaves none: a smaller difference decides no pair of a comparison, the gate does not hold such a task, and a comparison takes it off the frontier. One nobody has answered may have no valid answer.`,
    "## What the exam needs\n\nTasks within the domain's scope that leave the reference harness room and still have a valid answer, demanding and fair as a practitioner of the domain would judge them. Harder is yours to judge. You are not told how many tasks are wanted.\n- On record, the drafts that gates held have been of three kinds: several of the domain's requirements share one limit, so that meeting one spends the margin another needs; the public rules, read together, rule out the answer a usual method reaches first; and, where the domain declares an objective, the best answer lies in a narrow region that a broad search passes over, so that an answer planted there is better than the reference's. Requirements that only stand side by side are met one at a time.\n- The turns a valid answer took are what its method cost. An answer in a few of the budget's turns is one the method reaches directly, and a task changed only in its numbers, its names, its size or one limit is reached the same way: a harness that holds the field's engine answers a larger instance as it answers a small one. Vary what a task asks.\n- A limit, state or duty the field does not hold measures your wording rather than the solver. Add none.\n- Everything a task demands is in its public input and the public rules, so that a solver that follows every public rule never fails on one it could not read. Nothing a solver needs is in the hidden values.",
    "## A valid answer must exist\n\nA task with no valid answer measures nothing, since every harness fails it alike. Make sure one exists by planting it: start from an answer that keeps every rule, derive the task from it, and put both to try_answer. Where the domain's instances scale, grow a planted task: add requirements around the planted answer that bear on the limit it already meets, and try it again at each step. The planted answer is for try_answer alone: no task carries it, in its public input or its hidden values, and the gate refuses one that does. An answer that passes can sit as close to a limit as you like, and the task is as demanding as the answer is hard to find.",
    `## The gate\n\n${tool} takes instances and puts each to the host's gate${tried === undefined ? "" : ", and returns at once: the gate works while you go on, what it says of each instance comes with a later tool result, wait returns with the next of them, and finish waits for every instance still at it"}. The gate reads the shape of its package first: its family, its inputs, and that the checks have what they need to run on it.${solved} Of each it says held out, with the kind of room it left, or refused with its reason. A task held out is in the exam from then on.`,
    "## The session\n\nPropose in rounds: put drafts to the gate, read what it said, and propose more. The opening states how many drafts the session may put to the gate; each counts, held or refused, and each result of the tool that puts them says how many are used. When you have no more tasks worth proposing, call finish. A first finish while the host does not yet have the tasks it needs is answered with that, and the session goes on. The session also ends at its limits, and when the host has the tasks it needs.",
  ].join("\n\n");
}

/** The budget every solve is held to, as a fact for an Examiner: a drafting session's measure of
 *  its examples (`draft.ts`) and a writing session's opening. */
export function budgetLine(budget: { readonly modelTurns: number | null; readonly minutes: number }): string {
  return `Every solve of a task is held to ${budget.modelTurns === null ? "no fixed number of the solver's own turns" : `${plural(budget.modelTurns, "turn")} of the solver's own`}, a turn being one reply with the tool calls in it, and ${plural(budget.minutes, "minute")}. This is the budget, and it may change as the campaign goes on; it is no target of yours.`;
}

/** The opening message: the operator's brief where the campaign opened from one, the domain's
 *  public contract, its checks by id and assertion, and what `record.ts` tells of the campaign's
 *  past: a line a task, the measurement of the reference across the exam, and the drafts the gate
 *  refused or left unmeasured. `told` is the limits the session is told it runs under; how many tasks are wanted
 *  is not among them. `campaign` is what it is told of its campaign beside the contract, each null
 *  where there is none: the operator's brief, the budget every solve is held to, and what the last
 *  Examiner session said at its `finish`, the one thing a session leaves the next beside its tasks
 *  and its home. */
export function firstMessage(
  contract: Contract,
  checks: readonly CheckRow[],
  tasks: ReturnType<typeof heard>,
  told: { readonly wallSeconds: number; readonly turns: number; readonly puts: number },
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
    ...(budget === null ? [] : [budgetLine(budget)]),
    `The checks, by id:\n${checks.map((row) => `- ${row.id} (${families(row)}): ${row.assertion}`).join("\n") || "(none)"}`,
    `${tasks.legend}\n${tasks.lines.map((line) => `- ${line}`).join("\n") || "(none)"}`,
    ...(tasks.promoted === null ? [] : [tasks.promoted]),
    ...(tasks.measured === null ? [] : [tasks.measured]),
    ...(tasks.refused.length === 0
      ? []
      : [
          `The drafts the gate refused after reading them, by its reason. None is a task of the exam, and an instance an earlier session wrote is not taken again:\n${tasks.refused.map((line) => `- ${line}`).join("\n")}`,
        ]),
    ...(tasks.interrupted.length === 0
      ? []
      : [
          `The drafts whose gates ended without a measurement. These gates did not decide room. read_example returns each original instance whole. Its content can be proposed afresh unless a later gate has already read it; these are historical gate statuses:\n${tasks.interrupted.map((line) => `- ${line}`).join("\n")}`,
        ]),
    ...(lastNote === null
      ? []
      : [
          `What the last Examiner session under the current reference harness said at its finish, in its own words:\n${lastNote}`,
        ]),
    `This session has ${plural(Math.round(told.wallSeconds / 60), "minute")}, ${plural(told.turns, "turn")} and ${plural(told.puts, "draft")} to put to the gate.`,
  ].join("\n\n");
}
