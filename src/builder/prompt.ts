/**
 * What a Builder reads before its first call: the system prompt, the opening message, and its
 * shell's description.
 *
 * v1's Builder wrote the exam beside the harness, and most of its prompt was about the exam. What is
 * taken here is what bore on the harness, from harness-builder-v4 at 7af7315: the role sentence
 * (`src/author/builder-start-prompt.ts`, `INTENT_CLAUSE`), the ceiling on what a solver's tools may
 * do (`NO_GRADER_IN_REACH`), and the three files' contracts in brief
 * (`starters/pi-built-harness/starter-pack/contract.md`, the agent sections). Their shapes in full,
 * with a worked example, are `HARNESS.md` in the session's home (`src/solve/starter.ts`).
 *
 * Each part of a harness is given one purpose, here as there: the presets select pi's tools, a
 * computation is a program, the guide is words about the programs, and a tool of the harness's own
 * is for a harness without the shell. v1's sentence, "useful computation belongs in the solver's
 * tools", was written for a solver whose only way to a computation was a tool. A v2 solver has a
 * shell, and a Builder told both to write tools and to install programs built one checker as both
 * (truss, 2026-10-09).
 *
 * The ceiling is one rule: no harness tool returns a finished answer for a task (`docs/plan.md`,
 * principle 6). v1's sentence had two routes, a verdict on a candidate and the answer to a case the
 * solver names, and forbade both as "a check's work", with the reason that the Builder's own
 * battery would then measure a search. That Builder had written the checks. Until 2026-10-09 this
 * prompt kept both, said by the public rules. The operator lifted the first on 9 October, with the
 * same rule in every session: a tool may tell the solver whether a candidate meets a public rule.
 * A solver does that unaided, as v1 recorded when its solver wrote a search and ran it until the
 * checks cleared; this Builder is never shown a check; and both harnesses are solved under the
 * same limits, which price the search. A tool that hands over the answer stays forbidden.
 *
 * A session is a new conversation, so the opening message carries what the plan gives a Builder
 * whose conversation was lost: the notes its earlier sessions left, which are v1's (`memory.ts`),
 * and, from the log, every failed practice solve so far and each comparison's tally (`past.ts`).
 *
 * New here: what the harness is measured on, and how a practice result is to be read. It is
 * measured against the reference harness, which is the Starter Built Harness until a step is
 * promoted and so need not be the harness a later session starts from. v1 gave its
 * Builder one pass bit a rehearsal and no trace; a v2 Builder gets each task's record, the solver's
 * trace and the reviewers' readings, and is told that one solve is weak evidence, because in v1's
 * record a fail repeated on the same bytes 5 times in 21.
 */
import type { Contract } from "../kernel/contract.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";
import { MEMORY_FILE, SCRATCH_DIR, SCRATCH_LIMITS, SCRATCHPAD_FILE } from "./memory.ts";

/** A practice task as the opening message lists it. */
export interface Listed {
  readonly taskId: string;
  readonly family: string;
  /** Its counted solves under the harness the session starts from, from the log. */
  readonly solves: readonly string[];
  readonly passed: number;
}

/** What a session is told of the sessions before it (`memory.ts`). */
export interface Past {
  /** The harness the session starts from, as the lists below name a harness. */
  readonly start: string;
  /** Every failed practice solve of the campaign on this session's tasks, a line each. */
  readonly fails: readonly string[];
  /** Every comparison of the campaign that tallied a task, a line each. */
  readonly comparisons: readonly string[];
  /** The notes block a session opens on, v1's (`memory.ts`); empty until a session has written any. */
  readonly memory: string;
}

/** The limits a session is told it runs under. */
export interface Told {
  readonly wallSeconds: number;
  readonly turns: number;
  readonly practiceSolves: number;
}

export const SYSTEM_PROMPT = [
  "You are the Builder. You improve a Built Harness: the programs and the guide with which a separate solving model answers each task of one domain. Useful computation belongs in the harness's programs; the host's verifier owns correctness and the host owns acceptance and scores.",
  "Your harness is measured against a reference harness, by that solver and under the same limits, on tasks you are never shown. Only a change that helps on tasks like the practice tasks, not on those tasks themselves, will show there. Build for the domain: a line that names a practice task or copies its text or its answer moves nothing that is measured.",
  'The harness is harness/ in your home directory, and HARNESS.md beside it gives the purpose and the shape of each of its parts, with a worked example. The solver is pi\'s coding agent, and each part of the harness has one purpose. agent/tools-spec.json selects which of pi\'s coding tools the solver has: read, bash, edit, write. .toolchain holds the programs, which reach the solver, and your own shell, by name on PATH with .toolchain/bin first: every computation you add is a program there, which the solver runs from its shell. agent/BUILT_AGENTS.md is the operating guide, which the solver reads in its system prompt once per task: keep it short, and keep it to words, since code a solver would copy out and run is a program. agent/tools.ts holds tools of your own and exports createDomainHarness. Leave its list empty while the solver has the shell: a tool that runs what a program does is the same thing built twice. It is for a harness that leaves the shell out, and it is built from the files under harness/ and the packages installed there, an import of any other file being refused. The solver\'s answer is a file it writes, answer.json, which the host reads when the solver submits: nothing of yours takes the answer. The harness is run from another place than your home, so an installed launcher finds its files from its own path, as "$(dirname "$0")" does, and a link names its target relatively: a harness in which a script or a link names your home is not frozen. agent/config.yaml is not read: the host sets every limit a solve runs under.',
  "The guide says what each program is for, how the programs combine and how a result informs the next decision, for every task of the domain, and leaves the solving method to the solver. Reusable algorithms are allowed, as programs; task identifiers, copied task text and answers are not.",
  "Answers are judged by checks that neither you nor the solver is shown; what they enforce is the public rules. A program may run the field's own compiler or simulator on the solver's candidate, test the candidate against a public rule and say what it does not meet: the solver would write such a test itself, and every solve of either harness runs under the same limits, so a search costs the turns and the time it takes. One limit stands. No program, tool or guide line returns a finished answer for a task, or for a case the solver names: the solver finds the answer, with what the harness gives it to compute, test and correct one.",
  "practice solves the practice tasks you name with the harness as it stands and reports each task's record. One solve is weak evidence: the same harness can fail a task and pass it the next time. Read the record, not the last result, and decide before you practise which tasks a change should move. A fail ruled a check defect does not count and is not yours to build around. A diagnosis is advice from a reader that saw one solve: weigh it against the trace, which read_trace pages.",
  "You work in your home directory with read, bash, edit and write. The three file tools take a path relative to it, such as harness/agent/BUILT_AGENTS.md, and the shell is there for everything else: searching, listing, running and installing.",
  "check_harness opens the harness as a solve would and lists what a solver gets from each part. Run it before you practise, since a harness that does not open fails every task. preview_harness shows what a solver would then read: its system prompt whole, with your guide and your programs' names in it, and its tools. reset_harness puts harness/agent back as this session found it. Practice solves are limited and each takes as long as a solve. Your turns are limited too, and every reply of yours is one, with or without a tool call. When harness/ holds what you want measured, call finish. The session also ends at its limits, and what harness/ holds then is what is frozen.",
].join("\n");

/** What the next session receives from this one (v1's `HANDOVER`, `src/author/builder-session.ts`
 *  at 3f93d06). Every session opens in a new home, and the Builder's own notes cross only through
 *  these files; `finish` ends the session at the turn that calls it, so a note meant for after it
 *  is never written. */
const HANDOVER =
  `The next session opens in a new home, and what you learned reaches it only through ${MEMORY_FILE}, ` +
  `${SCRATCHPAD_FILE} and ${SCRATCH_DIR}/ in your home directory (${SCRATCH_LIMITS}; a larger file stays behind, a top-level folder that ` +
  "no longer fits stays behind whole, and a symbolic link never crosses). finish ends this session at " +
  "that turn, so bring them up to date before you call it.";

export const NUDGE =
  "You have not called finish. Go on with the harness, or call finish when harness/ holds what you want measured.";

/** What the Builder's shell is told about its wall, after pi's own description. The command wall
 *  is the solver's, and the facts are the ones a solver's prompt gives of it
 *  (`src/solve/prompt.ts`, `environment`): the shell is the solver's `bash`, started in the home. */
export const SHELL_WALLS =
  " The command runs in your home directory, where harness/, practice/, resources.json, HARNESS.md and your notes are. It has network access, so a program the solver runs, and what that program needs, can be installed under harness/.toolchain. It can write your home directory, $TMPDIR and /tmp, and read the host's own toolchains and public runtime roots, but no repository or private data. A command has a default time limit and may name a longer timeout. Nothing a command starts runs on after it returns: wait for a background job in the command that started it.";

/** The opening message: the domain's public contract, the practice tasks with their record under the
 *  harness the session starts from, what the campaign's log holds of the sessions before this one,
 *  and the session's limits. A task's public part is a file in the home, since a pack's inputs run
 *  long. */
export function firstMessage(contract: Contract, tasks: readonly Listed[], told: Told, past: Past): string {
  const listed = tasks.map(({ taskId, family, solves, passed }) =>
    solves.length === 0
      ? `- ${taskId} (family ${family}): not yet solved under the harness you start from.`
      : `- ${taskId} (family ${family}): passed ${String(passed)} of ${String(solves.length)} under the harness you start from. Solves: ${solves.join(", ")}.`,
  );
  return [
    // First, and not last: it is the Builder's own prose and may predate what stands below it.
    ...(past.memory === "" ? [] : [past.memory]),
    `Public rules of the domain:\n${contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join("\n") || "(none)"}`,
    ...(contract.conventions === "" ? [] : [`Conventions: ${contract.conventions}`]),
    `Scope: ${contract.scope}`,
    `The solver's answer follows this schema: ${capturedJsonStringify(contract.answerFormat)}`,
    "The public resources every solve's home holds under public/resources/ are in resources.json.",
    `Practice tasks, each one's public part in practice/<task>.json:\n${listed.join("\n") || "(none)"}`,
    `You start from harness ${past.start}.${
      past.fails.length === 0
        ? " No practice solve of these tasks has failed in this campaign so far."
        : ` Every failed practice solve of these tasks in this campaign so far, oldest first, with where it stands now; read_trace opens each:\n${past.fails.join("\n")}`
    }`,
    ...(past.comparisons.length === 0
      ? []
      : [`Comparisons so far, on tasks you are not shown:\n${past.comparisons.join("\n")}`]),
    HANDOVER,
    `This session has ${plural(told.practiceSolves, "practice solve")}, ${plural(Math.round(told.wallSeconds / 60), "minute")} and ${plural(told.turns, "turn")}.`,
  ].join("\n\n");
}
