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
 * Each part of a harness is given one purpose, here as there: the presets select pi's tools, the
 * programs and the tools of the harness's own compute, and the guide is words about them. v1's
 * sentence, "useful computation belongs in the solver's tools", was written for a solver whose
 * only way to a computation was a tool. A v2 solver has a shell, and a Builder told both to write
 * tools and to install programs built one checker as both (truss, 2026-10-09). From then until
 * 10 October this prompt told the Builder to leave `tools.ts` empty while the solver had the shell:
 * a second limit in a prompt (`AGENTS.md`, section 2), under which no harness of ten campaigns
 * declared a tool. It now states what a tool and a program each cost a solve, and `practice`
 * reports each solve's tokens, so the Builder chooses.
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
import type { NetworkReach } from "../solve/command.ts";

/** A practice task as the opening message lists it. */
interface Listed {
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

/** What a session's work is measured by: said in the system prompt, and again in every
 *  continuation, so that the goal is one sentence with one owner. */
const GOAL =
  "Your harness is measured against a reference harness, by that solver and under the same limits, on tasks you are never shown.";

export const SYSTEM_PROMPT = [
  "You are the Builder. You improve a Built Harness: the programs, the tools and the guide with which a separate solving model answers each task of one domain. Useful computation belongs in the harness, as its programs and its tools; the host's verifier owns correctness and the host owns acceptance and scores.",
  `${GOAL} Only a change that helps on tasks like the practice tasks, not on those tasks themselves, will show there. Build for the domain: a line that names a practice task or copies its text or its answer moves nothing that is measured.`,
  "The harness is harness/ in your home directory, and HARNESS.md beside it gives the purpose and the shape of each of its parts, with a worked example. The solver is pi's coding agent, and each part of the harness has one purpose. agent/tools-spec.json selects which of pi's coding tools the solver has: read, bash, edit, write. .toolchain holds the programs, which reach the solver, and your own shell, by name on PATH with .toolchain/bin first, and the solver runs them from its shell. agent/tools.ts holds tools of your own and exports createDomainHarness: the solver has them beside pi's tools, under the names, descriptions and parameter schemas you declare, each call running alone under its command wall; they are built from the files under harness/ and the packages installed there, an import of any other file being refused. Whether a computation is a program, a tool or both is yours to choose, and HARNESS.md says what each costs a solve in the tokens it reads and writes. agent/BUILT_AGENTS.md is the operating guide, which the solver reads in its system prompt once per task: keep it short, and keep it to words, since code a solver would copy out and run is a program or a tool. The solver's answer is a file it writes, answer.json, which the host reads when the solver submits: nothing of yours takes the answer. The harness is run from another place than your home, so an installed launcher finds its files from its own path, as \"$(dirname \"$0\")\" does, and a link names its target relatively: a harness in which a script or a link names your home is not frozen. agent/config.yaml is not read: the host sets every limit a solve runs under.",
  "The guide says what each program and tool is for, how they combine and how a result informs the next decision, for every task of the domain, and leaves the solving method to the solver. Reusable algorithms are allowed, as programs and tools; task identifiers, copied task text and answers are not. The host tells the solver its limits, and every tool result ends with how much of them the solver has used, so the guide says nothing of time or turns: a solver told that time is short submits an answer its own check has refused, with most of its time left.",
  "Answers are judged by checks that neither you nor the solver is shown; what they enforce is the public rules. A program or a tool may run the field's own compiler or simulator on the solver's candidate, test the candidate against a public rule and say what it does not meet: the solver would write such a test itself, and every solve of either harness runs under the same limits, so a search costs the turns and the time it takes. One limit stands. No program, tool or guide line returns a finished answer for a task, or for a case the solver names: the solver finds the answer, with what the harness gives it to compute, test and correct one.",
  "practice solves the practice tasks you name with the harness as it stands and reports each task's record. One solve is weak evidence: the same harness can fail a task and pass it the next time. Read the record, not the last result, and decide before you practise which tasks a change should move. What you change after your last practice solve is measured untried, so keep a solve for the harness you mean to finish with. A fail ruled a check defect does not count and is not yours to build around. A diagnosis is advice from a reader that saw one solve: weigh it against the trace, which read_trace pages.",
  "You work in your home directory with read, bash, edit and write. The three file tools take a path relative to it, such as harness/agent/BUILT_AGENTS.md, and the shell is there for everything else: searching, listing, running and installing.",
  "check_harness opens the harness as a solve would and lists what a solver gets from each part. Run it before you practise, since a harness that does not open fails every task. preview_harness shows what a solver would then read: its system prompt whole, with your guide and your programs' names in it, and its tools. reset_harness puts harness/agent back as this session found it. Practice solves are limited and each takes as long as a solve. Your turns are limited too, and every reply of yours is one, with or without a tool call. Every tool result ends with the turn you are in, the session time used and the practice solves left. read_opening returns the opening message again, as it was sent, for when this conversation no longer holds it. When harness/ holds what you want measured, call finish. The session also ends at its limits, and what harness/ holds then is what is frozen.",
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

/** What a session has used of its limits, as the host counts it. */
export interface Used {
  /** The model's turns that have ended. */
  readonly turns: number;
  readonly seconds: number;
  /** The practice solves the session may still start (`practiceLeft`, `tools.ts`). */
  readonly practiceLeft: number;
  /** Whether a practice solve of this session has run (`bench.opened`, `tools.ts`). */
  readonly practised: boolean;
}

/** Where `harness/` stands against the session's practice: no solve has run in this session, the
 *  harness is as the last solve ran it, it has changed since, or it does not open. */
export type Tried = "unpractised" | "tried" | "untried" | "broken";

const TRIED: Readonly<Record<Tried, string>> = {
  unpractised: "No practice solve has run in this session.",
  tried: "harness/ is as your last practice solve ran it.",
  untried: "harness/ has changed since your last practice solve, so no solve has run it as it stands.",
  broken: "harness/ does not open as it stands: check_harness says why.",
};

/** What the Builder's shell is told about its wall, after pi's own description. The command wall
 *  is the solver's, and the facts are the ones a solver's prompt gives of it
 *  (`src/solve/prompt.ts`, `environment`), the network as the wall's probe found it
 *  (`networkReach`): the shell is the solver's `bash`, started in the home. */
export const shellWalls = (network: NetworkReach): string =>
  ` The command runs in your home directory, where harness/, practice/, resources.json, HARNESS.md and your notes are. ${network === "reached" ? "It has network access, a package index having been reached from inside the wall when this process started, so a program the solver runs, and what that program needs, can be installed under harness/.toolchain." : "It has no network access: a package index could not be reached from inside the wall when this process started, so nothing can be fetched, and a program the solver runs is one written here or already on the host."} It can write your home directory, $TMPDIR and /tmp, and read the host's own toolchains and public runtime roots, but no repository or private data. A command has a default time limit and may name a longer timeout. Nothing a command starts runs on after it returns: wait for a background job in the command that started it.`;

/**
 * The last line of every tool result a Builder reads: the turn it is in, the session time used, the
 * practice solves left, and, until one has run, that none has. A solver has had the same of its own
 * limits since 2026-10-09 (`timed`, `src/solve/run.ts`). The facts ride on tool results because that
 * is where a Builder reads: in the seven sessions on record that day, 365 turns in all, every turn
 * ended in a tool call, so the message sent between turns was never sent once.
 *
 * The practice fact joined them on 2026-10-10, when a session of 43 turns spent 69% of its wall
 * measuring a tool chain through 40 shell calls, called `check_harness`, `preview_harness` and
 * `practice` not once, and left a tree whose own module spawns a program the tree does not hold.
 * Where `harness/` stood was stated only by the continuation (`TRIED`), which again no turn of it
 * triggered. The line states the condition and no course: which fact matters is the Builder's.
 */
export function usedLine(used: Used, limits: Pick<Told, "wallSeconds" | "turns">): string {
  const clock = (seconds: number) => {
    const whole = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
  };
  return `[Session: turn ${String(used.turns + 1)} of ${String(limits.turns)}, ${clock(used.seconds)} of ${clock(limits.wallSeconds)} used, ${plural(used.practiceLeft, "practice solve")} left${used.practised ? "" : ", no practice solve has run harness/"}]`;
}

/**
 * What a Builder is sent when a turn of its ends with no tool call and no `finish`: that the
 * session goes on, its goal, what it has used of its limits, where `harness/` stands, and where
 * the opening facts are served again. It is v1's continuation (`continuePrompt`,
 * `src/author/builder-continuation.ts` at 3f93d06), which restated the goal and the round's facts
 * at every turn boundary so that a compaction needed no signal.
 *
 * One part of v1's is left out on purpose: the line that named the next action. v1's Builder had a
 * submit gate to be steered to. Here the host states facts and the Builder chooses the response
 * (`AGENTS.md`, section 2): which fact matters is its to weigh, and a prescribed course was what a
 * v1 campaign followed for four test sets while it changed only its published magnitudes.
 */
export function continuation(used: Used, limits: Pick<Told, "wallSeconds" | "turns">, tried: Tried): string {
  const minutes = (seconds: number) => String(Math.floor(seconds / 60));
  return [
    "You have not called finish, and the session goes on: ending a turn does not end it. It ends when you call finish or at its limits, and what harness/ holds then is frozen and measured.",
    `The goal, unchanged: ${GOAL}`,
    `This session so far: ${String(used.turns)} of ${plural(limits.turns, "turn")} and ${minutes(used.seconds)} of ${plural(Number(minutes(limits.wallSeconds)), "minute")} used, ${plural(used.practiceLeft, "practice solve")} left. ${TRIED[tried]}`,
    "read_opening returns the opening message again: the public rules, the practice tasks, the failed practice solves and the comparisons so far.",
  ].join("\n\n");
}

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
