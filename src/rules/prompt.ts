/**
 * What a Rule Author reads before its first call: the system prompt and the opening message.
 *
 * v1 had no such author. Its Builder wrote the correctness model beside the harness, and what v1
 * told it about checks is in `src/author/builder-start-prompt.ts` and the starter pack's
 * `examples.md` (github.com/s-smits/anabasis at 3f93d06). Taken from there, each for what v1
 * measured beside it (v1 `AGENTS.md`, "Open gaps" and "Tried and taken out"):
 *
 * - `PUBLICATION_CLAUSE`: a solver that follows every published rule never fails on one it could
 *   not read, and the list of what a statement has to publish, from constants to the reading a
 *   check takes where a practitioner could take two. 5 of 32 firmware fails were one unpublished
 *   status mapping.
 * - `VERIFICATION_CLAUSE`: decide what the delivered work does by recomputing it on the supplied
 *   inputs, and accept every implementation the rules permit; a check that recognises how an
 *   answer is written, or replays it into a stand-in its author wrote, grades the author's model of
 *   the work. 24 of those 32 fails were a Builder-written stand-in refusing valid code, and 36 of
 *   47 rehearsal misses were a check's fault (v1 #124), while 5 of 1,411 passes were vetoed: a
 *   model-written check errs by refusing right answers. That is why an accept control here may be
 *   an edit too, a second valid answer its author's check has to pass.
 * - `SCOPE_CLAUSE`'s last line, that a limit, state or duty the field does not hold measures the
 *   author's wording. v1 pressed for a task-set finding out of every full pass and took that out
 *   again (`review-duties.ts`, until 2026-09-29): it "pressed the author to add rules the request
 *   never held". So this author is told that adding nothing is a result, and its nudge says so
 *   again.
 * - `examples.md`: each reject is an accept of the same task with one fact changed, and accepts
 *   the reference did not produce show that the rules admit them and not a recipe.
 *
 * Left out: everything about the harness, the solver's tools and the tasks, none of which this
 * author writes; the reference solve and its F2 gate, since the witness that a requirement can be
 * met is a stronger solve's accepted answer and never the author's own, which was v1's first
 * blocker ("the answer is the author's own"); the brief's joins, decoy classes and numeric
 * boundaries, which v2's verifier does not read; and any zone, share or target count, which v1
 * measured an author writes towards. What it is told of the campaign's tasks is the Examiner's
 * record of them (`src/examiner/record.ts`): words and counts.
 */
import type { Contract } from "../kernel/contract.ts";
import { CONTROLS } from "../kernel/task.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";
import type { Declared } from "./candidate.ts";

/** An existing task as the opening message lists it. */
export interface ListedTask {
  readonly taskId: string;
  readonly family: string;
  /** Whether an answer the checks accepted for it is on record for the session to read. */
  readonly witnessed: boolean;
}

/** The limits a session is told it runs under. */
export interface Told {
  readonly wallSeconds: number;
  readonly turns: number;
  /** Additions it may put to the gates. */
  readonly tries: number;
}

export const SYSTEM_PROMPT = [
  "You are the Rule Author. An exam of one domain is a set of public rules, an answer format and a check program, in which each check is a function that says whether an answer meets the rules it cites. Another author writes the exam's tasks, and a solving model is measured on them. You write one addition to what the exam can judge: one public rule, one check that enforces it, and controls that show the check does. Everything that exists stays as it is. You cannot change or remove a rule, a check, a control or a task, and the host proves on the bytes that you did not.",
  "The exam grows by a requirement its checks do not yet judge. Add one a practitioner of the domain would hold a piece of work to and could name the source of. A limit, state or duty the field does not hold measures your wording rather than the solver, so add none. If the checks already judge what the field asks of these tasks, call finish and say so: a session that adds nothing is a result. You are not told how many rules are wanted, and you never see the solver being measured: not its tools, its guide, its answers or its mistakes. You are told what was measured of the existing tasks, a word each with the fails among its solves and the checks that refused them. That is a measurement and no instruction.",
  "A solver reads the rule's statement and the check's assertion and never the code. A solver that follows every public rule must never fail on a rule it could not read, so the statement says everything the check requires of an answer: constants with their authority, units, precision and rounding, the direction of a comparison and its tolerance, the canonical form, and where a practitioner could read the rule two ways, the reading the check takes. The host cannot prove that a statement says enough. Once a rule is in use, a Referee reads every answer its check refuses against the statement and the public task, not against your code, and a refusal the statement does not decide is ruled the check's defect.",
  "The check is one module that exports `check`, a function of the request that returns true or false and may be async: `export const check = ({ artifact, publicTask }) => ...`. `artifact` is the answer and `publicTask.publicInput` the task's public input, each cut down to the paths you declare, so declare every path the code reads. It receives no hidden value. It may import files of the existing check program by relative path, from its own place in `added/`, and nothing else, and it may run only tools an existing check already names, through the runtime it is handed, as those checks do. Decide what an answer does by recomputing it from the answer and the public input, and accept every answer the statement permits. A check that recognises how one accepted answer happens to be written, trusts the answer's own report of itself, or replays the answer into a stand-in you wrote grades your model of the work and not the work. Return false for an answer that breaks the rule, and do not throw on an answer the format allows.",
  `Controls are answers the host puts to the whole program with your check in it. Each starts from an answer the checks accepted for an existing task, which read_task shows. An accept control is that answer as it stands, or with one change after which every check must still pass it: a second valid way to meet the rule shows that the rule passes it and not one answer's wording. A reject control is that answer with one change, a field replaced or a passage rewritten, after which your check must refuse it and no other check may. Write at least ${String(CONTROLS)} reject controls, change a different fact in each, and make each a mistake a competent solver could make, since a control tests only the fault its author thought of. The host makes each change, so send the change and not the answer. The unchanged answer every control starts from must pass the whole program, which is also the proof that the rule can be met.`,
  "propose_rule takes the whole addition and puts it through the host's gates in order: its shape, with the proof that nothing existing moved; its controls; and a second run of every control, which must give the same verdict. A gate that refuses says why, and you may send the addition again, revised, while the session has attempts left. When the gates hold, the accepted answers on record are graded under the program with your check in it, and you are told which of the ones you can read it now refuses. A new requirement may rightly refuse an old accepted answer, and that task then waits for a new one. A refusal the statement does not decide is a defect to mend. Each propose_rule replaces the addition before it.",
  "read_check_program lists the check program's files and returns one: `brief.json` declares each check, and `evaluator.ts` holds their code. read_task returns one existing task whole, with the answer the checks accepted for it where one is on record. When the addition holds and you stand by it, call finish; call it too when you have none to add. The session also ends at its limits, and an addition you have not finished on is not kept. What you leave is a candidate: whether the exam takes it is another's decision.",
].join("\n");

export const NUDGE =
  "You have not called finish. Send the addition with propose_rule, revise it, or call finish. Finishing with nothing added is a result too.";

/** The opening message: the domain's public contract, its checks as their brief declares them, the
 *  tools a check may name, the existing tasks, what was measured of the campaign's tasks, and the
 *  session's limits. */
export function firstMessage(
  contract: Contract,
  checks: readonly Declared[],
  tasks: readonly ListedTask[],
  told: Told,
  measured: readonly string[],
): string {
  const families = (row: Declared) => (row.families === "all" ? "every family" : row.families.join(", "));
  const tools = [...new Set(checks.flatMap((row) => row.tools))];
  return [
    `Public rules of the domain:\n${contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join("\n") || "(none)"}`,
    ...(contract.conventions === "" ? [] : [`Conventions: ${contract.conventions}`]),
    `Scope: ${contract.scope}`,
    `A solver's answer follows this schema: ${capturedJsonStringify(contract.answerFormat)}`,
    `The checks:\n${
      checks
        .map(
          (row) =>
            `- ${row.id} (${families(row)}): ${row.assertion} Cites ${row.cites.join(", ") || "no rule"}; reads ${row.reads.join(", ") || "no path"} of the answer and ${row.inputs.join(", ") || "no path"} of the public input${row.tools.length === 0 ? "" : `; runs ${row.tools.join(", ")}`}.`,
        )
        .join("\n") || "(none)"
    }`,
    `Tools a check may name: ${tools.join(", ") || "none"}.`,
    `Existing tasks, for read_task:\n${
      tasks
        .map(
          ({ taskId, family, witnessed }) =>
            `- ${taskId} (family ${family})${witnessed ? ", with an accepted answer on record" : ""}`,
        )
        .join("\n") || "(none)"
    }`,
    ...(measured.length === 0
      ? []
      : [
          `What was measured of the tasks written for this exam, against the solver as it is now. These are measurements and no instruction.\n${measured.map((line) => `- ${line}`).join("\n")}`,
        ]),
    `This session has ${plural(Math.round(told.wallSeconds / 60), "minute")}, ${plural(told.turns, "turn")} and ${plural(told.tries, "attempt")} at the gates.`,
  ].join("\n\n");
}
