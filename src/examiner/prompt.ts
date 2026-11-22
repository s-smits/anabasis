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
 * `src/kernel/compare.ts`), with the objective's floor (`GAP_FLOOR`); the opening refers to it. What
 * v1's prompt said of tasks is kept: no limit the field does not hold, and no growth by size or a
 * moved limit alone (limits reset at a 3.4-hour search's best passed 5 of 6).
 *
 * A task needs a valid answer. Nothing solves a task before it is held (`AGENTS.md`, rule 9), so
 * the author alone stands between the exam and a task no answer satisfies: in the first campaign
 * opened from a prompt, two of seven tasks pressed to the margin had none. The prompt states what
 * `try_answer` shows and leaves the method to the author (section 2, consequence 1: facts, never a
 * course), since a prescribed method, to plant an answer and grow the task around it, tied each task
 * to what the author could build and left the reference valid on nearly every solve. An answer that
 * passed never reaches a solver: the gate refuses a task that carries it (`write.ts`).
 *
 * The solve is described as one system, the model inside the harness, because an Examiner that read
 * the reference harness's programs wrote against them: drafts aimed at one program's faults, which
 * the solver repaired in a few turns. For the same reason a writing session's home holds no copy of
 * the reference harness, which pointed the Examiner at one harness's programs and let it compute its
 * answers with the reference's own optimiser. The prompt separates the three kinds of room, but names
 * no kind of draft: a list of admitted constructions led the author to describe many held drafts as
 * one construction, and a paired trial without the list held as many drafts for less per draft.
 *
 * Each fact is stated once, in the section that owns it, and once to each session: the valid-answer
 * section is a point of "What the exam needs", the turns a method cost are part of "How hard", and
 * the task's make-up and the limit the field does not hold are one text each for both modes (`TASK`,
 * `UNHELD`, read by `draft.ts`). What the host enforces is said by the tool result that enforces it
 * and not beforehand: a declined first finish, an instance not taken again, a planted answer carried
 * whole, and the end of a session once the host has the tasks it needs. What a passing try shows is
 * said here, in "What the exam needs", and its result names the verdict alone.
 *
 * How hard a task should be has a scale and worked examples (`ladder.ts`, with the record behind
 * them), given as calibration facts before the request. The section asks for tasks above the
 * highest grade the reference answers on every solve, which is relative to the record the session
 * reads and names no count, so the exam climbs as the reference does; a grade is what the field
 * demands, never "above the new reference's", which points the Examiner at one harness's faults that
 * the starter, holding none, can win. `SOLVER` owns where grade 2 ends. The gate reads the package
 * alone (`write.ts`), so the prompt names no solve at the gate and leaves room to the comparisons.
 *
 * The texts are written for a model that follows a prompt literally. The reference's two solves
 * often differ on the objective alone, so that spread is named as chance alongside validity flips,
 * and the record's first line gives the count of the session's own last comparison, lest a literal
 * reader take it for room. Where no objective is declared, two valid answers always tie, which the
 * scoring section says. A draft carries no grade or account of where a solver falls short, since a
 * required account adds strictness and no fact, and a declined finish names no course (`write.ts`).
 *
 * Where the host gives the session tries of the reference harness ("Trying the reference",
 * `try_reference` in `write.ts`), the section says what a try shows and what it decides, which is
 * nothing at the gate or in a comparison, and that one solve is weak evidence (`AGENTS.md`, rule 6).
 * It names no count to reach and no course: when to try, and what to make of it, is the author's.
 *
 * The gate's section is in propose_tasks's description (`write.ts`), where the Examiner reads what
 * the tool does.
 */
import { GAP_FLOOR } from "../kernel/compare.ts";
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

/** An ask's limits, as an opening and a wake tell them. */
type Told = Parameters<typeof firstMessage>[3];

/** What a task is made of, as both modes are told it: the objective reads hidden values too. */
export const TASK =
  "A task is a family, a public input and hidden values. A solver reads the family's name and the public input; only the check program receives hidden values.";

/** What validity rests on, and where what a task was built from goes, as both modes are told it. */
export const FAIR =
  "A check refuses only what a rule, the scope, the conventions or a standard a rule names states. A solver copies a string it is asked for as the public input spells it, markup included, so a check that compares that text exactly refuses the markup, which measures the wording rather than the solver. What a task was built from, such as generating parameters, a latent process or planted faults, stays hidden. The Builder reads the objective's measure of each practice solve, so a value several tasks were built from can be learnt from practice instead of found in the task, and what a harness learns so is of the exam, not of the field.";

/** The one limit on a rule or a task the field does not set, as both modes are told it. */
export const UNHELD =
  "A limit, state or duty the field does not hold measures your wording rather than the solver, so add none.";

/** The system prompt of a session that holds tasks out by `propose_tasks`. Each fact is stated
 *  once, in the section that owns it, and the gate's in `propose_tasks`'s description (`write.ts`).
 *  `tries` says whether the session may put instances to the reference harness (`try_reference`). */
export function systemPrompt(tries: "given" | "none"): string {
  const floor = `${String(GAP_FLOOR * 100)}%`;
  return [
    `You are the Examiner. You write tasks of one domain, on which a solving model is measured. The public rules, answer format and checks are fixed: you write no rule and no check. ${TASK}`,
    "## Who solves a task\n\nA solve is one system: a solving model inside a harness. The model reads the task, public rules, check assertions and harness guide, works in a shell with the harness's programs and its own code (reading all output, errors included), and submits one answer within the opening's budget. A failing program visible to the model can be retried or worked around. The reference harness is the starter (no domain programs) until a comparison promotes one built by a Builder on practice tasks. You never see a solver's tools, guide, answers or traces.",
    `## How a task is scored\n\nEach comparison solves every task afresh under both harnesses as many times as the opening states, within the budget. An answer passing every check within the budget is valid; a check refusal counts as a fail only once the Referee rules it earned. A check defect or unclear ruling sets the task aside for both harnesses, a solve whose check cannot decide is solved again, and exceeding the campaign's check-defect limit ends the campaign. Tasks are scored over all pairings of each harness's solves: validity first (valid beats invalid), then the objective between two valid answers where one is declared. Billing decides nothing.\n\nA task leaves the reference harness room in three ways:\n- on validity: some of its solves are valid and some fail (missing a public rule or hitting the budget).\n- on an answer of yours: none of its solves is valid, while a valid answer is on record (such as yours passing try_answer on the same instance).\n- on the objective (where declared): an answer on record, its own or yours, beats one of its own by at least ${floor} of the larger measure, even if every solve is valid.\n\nA task it answers every time with no answer on record better by ${floor} leaves no room. Without an objective, valid answers always tie, so only the first two ways leave room.`,
    `## What the exam needs\n\nTasks within the domain's scope that leave the reference room and have a valid answer, demanding and fair by practitioner standards. You are not told how many tasks are wanted.\n- A task with no valid answer measures nothing, since every harness fails it alike. Passing try_answer proves an instance has one, and building forward from a valid answer guarantees one even when it is harder than you could solve.\n- A harness that fits one family wins or loses its tasks together, so a comparison dominated by one family says little about the rest of the scope. The record reports how many tasks the largest family held in each comparison.\n- ${UNHELD}\n- ${FAIR}`,
    `## How hard\n\n${LADDER}\n\nA grade is what the field demands of a task, read from its public input and cited rules. A fault in one harness's programs is no grade: the starter (which holds no domain programs) is also compared on tasks written after a promotion. A task the reference answers in every solve within a few turns, with no better answer on record, is grade 2 or below for this solver, whatever grade it was given. Repeating a grade the reference already solves every time, or writing a task whose objective the field's standard method already reaches, leaves no room. Occasional validity flips or objective spread between the reference's own solves are chance, not a better method (the record's last-comparison paragraph reports how often its own solves differed). The same holds for an instance cherry-picked from many draws because a method happened to land far from the truth: that error belongs to the draw, and a harness gains on it by sharing the offset, not by a better method. Write above the highest grade the reference answers in every solve.`,
    ...(tries === "none"
      ? []
      : [
          "## Trying the reference\n\ntry_reference runs fresh solves of an instance under the reference harness within the budget. For each solve it reports validity, turns and objective measure, or what ended it (check refusal, limit, no answer or malformed flag), never its answer, trace or refusing check. Solves bill the campaign while your session clock pauses. Comparisons solve every task afresh and ignore your tries, and the gate ignores them too. One solve is weak evidence: a solve that failed may pass next time.",
        ]),
    "## The session\n\nPropose in rounds: put drafts to the gate, read its response, and propose more. Call finish when you have no more tasks worth proposing; the session also ends at its limits. After a finish or once the host has what it needs, the host may wake this conversation for more tasks and report what comparisons read since.",
  ].join("\n\n");
}

/** The budget as a fact for an Examiner, writing tasks or drafting the exam they are written
 *  under. */
export function budgetLine({ modelTurns, minutes, solves }: SolveBudget): string {
  return `Every solve of a task is held to ${modelTurns === null ? "no fixed number of the solver's own turns" : `${plural(modelTurns, "turn")} of the solver's own`}, a turn being one reply with the tool calls in it, and ${plural(minutes, "minute")}, and a comparison solves each task ${plural(solves, "time")} under each harness. This is the budget, fixed by the campaign's setting for every solve of it; it is no target of yours.`;
}

const limitsLine = (told: Told, lead: string) =>
  `${lead} ${plural(Math.round(told.wallSeconds / 60), "minute")}, ${plural(told.turns, "turn")} and ${plural(told.puts, "draft")} to put to the gate${told.tries === 0 ? "" : `, and ${plural(told.tries, "solve")} of the reference harness to ask for`}.`;

const grouped = (groups: ReturnType<typeof heard>["groups"]) =>
  groups
    .map(({ heading, lines }) => `${heading}:\n${lines.map((line) => `- ${line}`).join("\n")}`)
    .join("\n\n");

/** The opening message: the operator's brief where the campaign opened from one, the domain's
 *  public contract, its checks by id and assertion, and what `record.ts` tells of the campaign's
 *  past: the last comparison the reference stood in, the tasks under its outcome on each, the
 *  promotion and the drafts the gate refused since. `told` is the limits the session is told it runs
 *  under, with the solves of the reference harness it may ask for; how many tasks are wanted is not
 *  among them. `campaign` is what it is told of its campaign
 *  beside the contract, each null where there is none: the operator's brief and the budget every
 *  solve is held to. */
export function firstMessage(
  contract: Contract,
  checks: readonly CheckRow[],
  tasks: ReturnType<typeof heard>,
  told: {
    readonly wallSeconds: number;
    readonly turns: number;
    readonly puts: number;
    readonly tries: number;
  },
  campaign: { readonly brief: string | null; readonly budget: SolveBudget | null },
): string {
  const { brief, budget } = campaign;
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
    ...(tasks.stood === null ? [] : [tasks.stood]),
    tasks.groups.length === 0
      ? "The exam holds no task yet."
      : `The tasks of the exam so far, under how the harness that is the reference now did on each in the last comparison that scored it, wherever it stood there. These are measurements, and no instruction or target.\n\n${grouped(tasks.groups)}`,
    ...(tasks.promoted === null ? [] : [tasks.promoted]),
    ...(tasks.refused.length === 0
      ? []
      : [
          grouped([
            {
              heading:
                "The drafts the gate refused under this reference, by its reason. None is a task of the exam",
              lines: tasks.refused,
            },
          ]),
        ]),
    limitsLine(told, "This session has"),
  ].join("\n\n");
}

/** What a resting conversation is told as the host asks again (`ask`, `write.ts`): the readings
 *  since it was last told and its limits from here. No count of tasks and no target: what to write
 *  is the author's (`AGENTS.md`, section 2, consequence 2). A promotion since then is said as an
 *  opening says it (`heard`). */
export function wakeMessage(tasks: ReturnType<typeof heard>, told: Told): string {
  return [
    "The host asks for more tasks under the same exam.",
    tasks.stood ?? "No comparison has reported since the host last told you.",
    ...(tasks.groups.length === 0
      ? []
      : [
          `The tasks compared since the host last told you, under how the harness that is the reference now did on each there. These are measurements, and no instruction or target.\n\n${grouped(tasks.groups)}`,
        ]),
    ...(tasks.promoted === null ? [] : [tasks.promoted]),
    limitsLine(told, "From here the session has"),
  ].join("\n\n");
}
