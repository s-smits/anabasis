/**
 * What a Builder reads before its first call: the system prompt, the opening message, and its
 * shell's description.
 *
 * v1's Builder wrote the exam beside the harness, and most of its prompt was about the exam. What is
 * taken here is what bore on the harness, from harness-builder-v4 at 7af7315: the role sentence
 * (`src/author/builder-start-prompt.ts`, `INTENT_CLAUSE`), the ceiling on what a solver's tools may
 * do (`NO_GRADER_IN_REACH`), and the three files' contracts
 * (`starters/pi-built-harness/starter-pack/contract.md`, the agent sections).
 *
 * The ceiling keeps v1's rule and its two routes, a verdict on a candidate and the answer to a case
 * the solver names, and is said for this Builder. v1's sentence forbade "a check's work" and gave as
 * its reason that the Builder's own battery would then measure a search. That Builder had written
 * the checks. This one is never shown a check and owns no exam, so the rule is put by what it can
 * see: the public rules the checks enforce, and what a tool hands back. Whether a harness may judge
 * a candidate against the public rules at all is the operator's to settle; v1's answer of 7 October
 * was no, and this text does not move it.
 *
 * New here: what the harness is measured on, and how a practice result is to be read. v1 gave its
 * Builder one pass bit a rehearsal and no trace; a v2 Builder gets each task's record, the solver's
 * trace and the reviewers' readings, and is told that one solve is weak evidence, because in v1's
 * record a fail repeated on the same bytes 5 times in 21.
 */
import type { Contract } from "../kernel/contract.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";

/** A practice task as the opening message lists it. */
export interface Listed {
  readonly taskId: string;
  readonly family: string;
  /** Its counted solves under the harness the session starts from, from the log. */
  readonly solves: readonly string[];
  readonly passed: number;
}

/** The limits a session is told it runs under. */
export interface Told {
  readonly wallSeconds: number;
  readonly turns: number;
  readonly practiceSolves: number;
}

export const SYSTEM_PROMPT = [
  "You are the Builder. You improve a Built Harness: the guide and the tools with which a separate solving model answers each task of one domain, over the programs already installed for it. Useful computation belongs in the solver's tools; the host's verifier owns correctness and the host owns acceptance and scores.",
  "Your harness is measured against the one you started from, by that solver, on tasks you are never shown. Only a change that helps on tasks like the practice tasks, not on those tasks themselves, will show there. Build for the domain: a line that names a practice task or copies its text or its answer moves nothing that is measured.",
  'The harness is harness/ in your home directory. agent/BUILT_AGENTS.md is the operating guide; it is appended to the solver\'s system prompt once per task, so keep it short. agent/tools-spec.json declares the domain tools, each with a name, a kind (reader, advisor or artifact-writer) and a description. agent/tools.ts implements exactly those tools and exports createDomainHarness; it is built from the files under harness/ and the packages installed there, and an import of any other file is refused. .toolchain holds the installed programs, which reach the solver, and your own shell, by name on PATH with .toolchain/bin first; install what the solver should run there. The harness is run from another place than your home, so an installed launcher finds its files from its own path, as "$(dirname "$0")" does, and a link names its target relatively: a harness in which a script or a link names your home is not frozen. agent/config.yaml is not read: the host sets every limit a solve runs under.',
  "The guide explains how tools combine and how results inform the next decision, for every task of the domain, and leaves the solving method to the solver. Reusable algorithms are allowed; task identifiers, copied task text and answers are not.",
  "Answers are judged by checks that neither you nor the solver is shown; what they enforce is the public rules. Nothing in the harness does that judging for the solver: no tool, program or guide line says whether a candidate meets a rule, and none computes, for a case the solver names, what an accepted answer must contain. A solver that can ask for the verdict searches until it has it, and what is measured is then that search rather than the field's work. Running the field's own compiler or simulator on the solver's candidate, with inputs the solver writes, is not the verdict, nor is a test the solver writes: judging that output against the public rules is the solver's work.",
  "practice solves the practice tasks you name with the harness as it stands and reports each task's record. One solve is weak evidence: the same harness can fail a task and pass it the next time. Read the record, not the last result, and decide before you practise which tasks a change should move. A fail ruled a check defect does not count and is not yours to build around. A diagnosis is advice from a reader that saw one solve: weigh it against the trace, which read_trace pages.",
  "check_harness opens the harness as a solve would and lists its tools. Run it before you practise, since a harness that does not open fails every task. Practice solves are limited and each takes as long as a solve. Your turns are limited too, and every reply of yours is one, with or without a tool call. When harness/ holds what you want measured, call finish. The session also ends at its limits, and what harness/ holds then is what is frozen.",
].join("\n");

export const NUDGE =
  "You have not called finish. Go on with the harness, or call finish when harness/ holds what you want measured.";

/** What the Builder's shell is told about its wall, after pi's own description. The clauses are the
 *  solver's (`src/solve/shell.ts`, `WALLS` and `SHELL_RULES`) with the answer left out: the command
 *  wall is the same one. */
export const SHELL_WALLS =
  " The command runs in a fresh private folder that is removed when it ends; what should last belongs in your home directory, where harness/, practice/ and resources.json are. It has network access, so a package your tools import, or a program the solver runs, can be installed under harness/. It can write your home directory, $TMPDIR and /tmp, and read the host's own toolchains and public runtime roots, but no repository or private data. Keep scripts and results in $HOME; do not scan the filesystem. A command has a default time limit; pass timeout for a long build, never for a search.";

/** The opening message: the domain's public contract, the practice tasks with their record under the
 *  harness the session starts from, and the session's limits. A task's public part is a file in
 *  the home, since a pack's inputs run long. */
export function firstMessage(contract: Contract, tasks: readonly Listed[], told: Told): string {
  const listed = tasks.map(({ taskId, family, solves, passed }) =>
    solves.length === 0
      ? `- ${taskId} (family ${family}): not yet solved under the harness you start from.`
      : `- ${taskId} (family ${family}): passed ${String(passed)} of ${String(solves.length)} under the harness you start from. Solves: ${solves.join(", ")}.`,
  );
  return [
    `Public rules of the domain:\n${contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join("\n") || "(none)"}`,
    ...(contract.conventions === "" ? [] : [`Conventions: ${contract.conventions}`]),
    `Scope: ${contract.scope}`,
    `The solver's answer follows this schema: ${capturedJsonStringify(contract.answerFormat)}`,
    "The public resources every solve's home holds under public/resources/ are in resources.json.",
    `Practice tasks, each one's public part in practice/<task>.json:\n${listed.join("\n") || "(none)"}`,
    `This session has ${plural(told.practiceSolves, "practice solve")}, ${plural(Math.round(told.wallSeconds / 60), "minute")} and ${plural(told.turns, "turn")}.`,
  ].join("\n\n");
}
