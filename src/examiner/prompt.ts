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
 * `src/kernel/compare.ts`), with the objective's floor (`ROOM`); the opening refers to it. What
 * v1's prompt said of tasks is kept: no limit the field does not hold, nothing a solver needs in
 * the hidden values, and no growth by size or a moved limit alone (limits reset at a 3.4-hour
 * search's best passed 5 of 6).
 *
 * A task needs a valid answer. Nothing solves a task before it is held (`AGENTS.md`, rule 9), so
 * the author alone stands between the exam and a task no answer satisfies: in the first campaign
 * opened from a prompt, two of seven tasks pressed to the margin had none. The prompt states what `try_answer` shows and leaves the method to the author.
 * Until 31 October it prescribed one, to plant an answer and grow the task around it, which tied
 * each task to what the author could build: of 6,225 admission readings since 16 October, 5,664 had
 * the reference valid on every room solve, and only 27 were refused for want of the author's proof
 * (section 2, consequence 1: facts, never a course). An answer that passed never reaches a solver:
 * the gate refuses a task that carries it (`write.ts`).
 *
 * The solve is described as one system, the model inside the harness, because an Examiner that read
 * the reference harness's programs wrote against them: at esp32-fresh-opus-terra's x-4 (27 October)
 * ten drafts made `plan-pins` fail, the solver repaired each in 3 to 7 of its 20 turns, and the
 * gate's room solves refused all ten. The prompt separates the three kinds of room, but names no kind
 * of draft. Until 28 October it listed three constructions admitted in v0.7.2; in later sessions,
 * the author described fifteen held drafts with fifteen family labels as one construction. In one
 * paired trial from a recorded position, both Opus seats held 12 of 12 drafts. The seat without the
 * list billed 11% less per draft (28 October). The prompt also explains that the solver
 * can reach answers computed by the home's copy of the reference harness: at buffer-fresh-gpt-v071's
 * x-3 the Examiner computed its answers with the reference's own optimiser, and in 9 refusals that
 * compared them its answer equalled the reference's best or was up to 0.59% worse (27 October).
 *
 * Each fact is stated once, in the section that owns it (17 October, #191: 1,088 words to 793).
 * What the host enforces is said by the tool result that enforces it and not beforehand: a declined
 * first finish (195 of 417 finishes in the record), an instance not taken again, a planted answer
 * carried whole (forbidden by the gate, but never observed on record), and what a passing try
 * shows (28 October).
 * How hard a task should be has a scale and worked examples (`ladder.ts`, with the record behind
 * them) instead of "Harder is yours to judge", which stood until 31 October. The section asks for
 * tasks above the highest grade the reference answers on every solve, which is relative to the
 * record the session reads and names no count, so the exam climbs as the reference does.
 * Until 1 November the gate also put each draft to the reference harness's room solves under
 * `try_task`, and the prompt said how; it reads the package alone now (`write.ts`), so the prompt
 * names no solve at the gate and leaves room to the comparisons. The opening still separates an
 * earlier log's unmeasured gates from its refusals: such a gate left room undecided, and its draft
 * can be recovered and proposed afresh unless a later gate read it.
 *
 * On 2 November the texts were read for a model that follows a prompt literally (Opus 5.5). Only
 * validity flips were called chance, while in every A/A of the archive's objective domains since
 * 26 October the reference's two solves differed on the objective alone on 314 of 1,373 tasks, so a
 * literal reader took that spread for room; it is now named as chance with its count. "Above the new
 * reference's" grade and the programs in the home pointed the Examiner at one harness's faults,
 * which the starter, holding none, can win; a grade is now what the field demands. "Below grade 3"
 * disagreed with `SOLVER` ("grade 2 or below"), which owns the point, as does the sentence on size
 * and numbers removed here. "Varying what they ask" on a declined finish was a course (`write.ts`).
 */
import { ROOM } from "../kernel/compare.ts";
import { type Contract, objectiveLine } from "../kernel/contract.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";
import { LADDER } from "./ladder.ts";
import type { heard } from "./record.ts";

/** The budget every solve is held to and how many times a comparison solves a task under each
 *  harness, as the campaign's setting names them: the solver's own turns, null where unlimited. */
export interface SolveBudget {
  readonly modelTurns: number | null;
  readonly minutes: number;
  readonly solves: number;
}

/** A check as its author's brief declares it and an Examiner is shown it: never its program. */
export interface CheckRow {
  readonly id: string;
  readonly assertion: string;
  readonly families: "all" | readonly string[];
}

/** The system prompt of a session that holds tasks out by `propose_tasks`. Each fact is stated
 *  once, in the section that owns it; the tools' descriptions point here for the gate (plan item
 *  5.1, 14 October). `reference` says whether a copy of the reference harness lies in the home
 *  (19 October). */
export function systemPrompt(reference: "in-home" | "unseen"): string {
  const floor = `${String(ROOM * 100)}%`;
  return [
    "You are the Examiner. You write tasks of one domain, on which a solving model is then measured. The domain's public rules, its answer format and its checks are fixed: you write no rule and no check. A task is a family, a public input, which is all a solver reads of it, and hidden values, which only the checks receive.",
    `## Who solves a task\n\nA solve is one system: a solving model working inside a harness. The model reads the task's public input, the public rules and the harness's guide, then works in a shell: it runs the harness's programs and tools, reads everything they print, errors included, writes and runs code of its own, and submits one answer, all within the budget of turns and minutes your opening states. A program that fails where the model can see it is one the model can retry, repair or work around in the turns it has left, so a draft on which one program fails is not yet a draft on which the system fails. The reference harness is the one a new harness is measured against: the starter, which holds no program of the domain, until a comparison promotes a better one. A promoted harness was built by a Builder on the tasks released for practice, and its guide and programs carry what it learned there. ${
      reference === "in-home"
        ? "A copy of the reference harness is in your home under reference-harness/, to read and run: its guide (reference-harness/agent/BUILT_AGENTS.md), its tools (reference-harness/agent/tools-spec.json and tools.ts) and the programs its solver runs by name (reference-harness/.toolchain/bin). An answer these programs compute is one its solver can reach by running them. You never see a solver's answers or its mistakes."
        : "You never see the solver: not its tools, its guide, its answers or its mistakes."
    }`,
    `## How a task is scored\n\nIn a comparison each task is solved under the reference harness and under the new one as many times each as your opening states, each solve fresh and held to the budget. An answer that passes every check within the budget is valid. Each task is scored over every pairing of a solve of each harness: by validity first and most, a valid answer beating one that is not, and between two valid answers by how much better one is by the objective, where the domain declares one. What a solve billed decides nothing. The harness the score favours wins the task. A comparison scores only tasks the gate held out.\n\nA task leaves the reference harness room in one of three ways:\n- on validity: its solves are valid in some and not all. A solve fails where the model's method misses something the public rules require, or reaches no answer within the budget.\n- on an answer of yours: none of its solves is valid, while a valid answer is on record, such as yours that passed try_answer on the same instance.\n- on the objective, where the domain declares one: an answer on record, another of its own or yours among them, is better by the objective than one of its own by at least ${floor} of the larger measure, even where every one of its solves is valid.\n\nA task it answers every time, with no answer on record that much better than its own, leaves none: a smaller difference decides no pair of a comparison, and a comparison takes it off the frontier. One nobody has answered may have no valid answer.`,
    "## What the exam needs\n\nTasks within the domain's scope that leave the reference harness room and still have a valid answer, demanding and fair as a practitioner of the domain would judge them. You are not told how many tasks are wanted.\n- The turns a valid answer took are what its method cost. An answer in a few of the budget's turns is one the method reaches directly.\n- A limit, state or duty the field does not hold measures your wording rather than the solver. Add none.\n- Everything a task demands is in its public input and the public rules, so that a solver that follows every public rule never fails on one it could not read. Nothing a solver needs is in the hidden values.",
    `## How hard\n\n${LADDER}\n\nGrade each draft on this scale before you put it, from its public input and the rules it cites. A task the reference answers in every solve within a few of its turns is at grade 2 or below for this solver, whatever grade you gave it. A grade at which the reference harness answers every solve of the tasks on record measures nothing more. Room it leaves on such a task, by failing a solve now and then or by its own valid answers differing on the objective, is chance and not a better method: a harness compared with itself differs that way too: the reference's first solve against its second differed on the objective alone on 314 of the 1,373 tasks on record that have an objective. Write above the highest such grade. A task's grade is what the field demands of it: a fault of one harness's programs is no grade, and the starter, which holds no program of the domain, is compared on the tasks written after a promotion too. An exam that stays at the grades the reference already answers tells no harness from another.`,
    "## A valid answer must exist\n\nA task with no valid answer measures nothing, since every harness fails it alike. try_answer runs every check on an answer of yours to one instance, so a pass there shows that instance has a valid answer. How you reach that answer, before the task or after it, is yours.",
    "## The gate\n\npropose_tasks takes instances and puts each to the host's gate. The gate reads the shape of its package: its family, its inputs, and that the checks have what they need to run on it. No solver is put to it while you wait, so you hear nothing more of it in this session. Of each it says held out, or refused with its reason. A task held out is in the exam from then on.",
    "## The session\n\nPropose in rounds: put drafts to the gate, read what it said, and propose more. When you have no more tasks worth proposing, call finish. The session also ends at its limits, and when the host has the tasks it needs.",
  ].join("\n\n");
}

/** The budget as a fact for an Examiner, writing tasks or drafting the exam they are written
 *  under. */
export function budgetLine({ modelTurns, minutes, solves }: SolveBudget): string {
  return `Every solve of a task is held to ${modelTurns === null ? "no fixed number of the solver's own turns" : `${plural(modelTurns, "turn")} of the solver's own`}, a turn being one reply with the tool calls in it, and ${plural(minutes, "minute")}, and a comparison solves each task ${plural(solves, "time")} under each harness. This is the budget, and it may change as the campaign goes on; it is no target of yours.`;
}

/** The opening message: the operator's brief where the campaign opened from one, the domain's
 *  public contract, its checks by id and assertion, and what `record.ts` tells of the campaign's
 *  past: a line a task, the measurement of the reference across the exam, and the drafts the gate
 *  refused or, in an earlier log, left unmeasured. `told` is the limits the session is told it runs under; how many tasks are wanted
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
    readonly budget: SolveBudget | null;
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
          `The drafts the gate refused after reading them, by its reason. None is a task of the exam:\n${tasks.refused.map((line) => `- ${line}`).join("\n")}`,
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
