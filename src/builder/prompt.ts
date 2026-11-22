/**
 * Builder system prompt, opening message, and shell description (`src/builder/prompt.ts`).
 *
 * Supplies only the facts permitted across the evaluation wall (`AGENTS.md` section 1): the public
 * contract and objective (`GAP_FLOOR`), the harness's three components (`HARNESS.md`,
 * `src/harness/starter.ts`), the single prohibition on task/answer embedding, prior session notes
 * (`memory.ts`), failed practice solves and comparison tallies (`past.ts`), and practice-task
 * records for the current exact digest.
 */
import { GAP_FLOOR } from "../kernel/compare.ts";
import { type Contract, objectiveLine } from "../kernel/contract.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";
import type { Limits } from "../kernel/condition.ts";
import { short } from "../campaign/move.ts";
import { INSTALLER_TOLD, type NetworkReach } from "../tools/command.ts";
import { CONTEXT_OUTPUT_LIMIT } from "../../vendor/claude-mem/ContextBudget.ts";
import { MEMORY_FILE } from "./memory.ts";

/** One harness's counted practice record on a task, as the opening lists it. */
interface TaskPractice {
  readonly solves: readonly string[];
  readonly passed: number;
  /** Each valid answer's band against the author's answer on record, in solve order (`bandOf`,
   *  `tools.ts`). */
  readonly measures?: readonly string[];
}

/** A practice task as the opening message lists it. */
export interface Listed extends TaskPractice {
  readonly taskId: string;
  readonly family: string;
  /** Whether it left practice on a check defect the Referee ruled on a practice answer to it. */
  readonly left: boolean;
  /** Counted practice under the current reference harness, when distinct from the starting harness
   *  and solved at least once. */
  readonly reference?: TaskPractice & { readonly digest: string };
}

/** What a session is told of the sessions before it (`memory.ts`). */
export interface Past {
  /** The harness the session starts from, as the lists below name a harness, where it came from
   *  and how the last session ended, as a sentence (`startTold`, `past.ts`). */
  readonly start: string;
  /** Every failed practice solve of the campaign on this session's tasks, a line each. */
  readonly fails: readonly string[];
  /** Every comparison of the campaign that tallied a task, a line each. */
  readonly comparisons: readonly string[];
  /** The notes block a session opens on (`memory.ts`); empty until an earlier session left notes. */
  readonly memory: string;
}

/** Who solves with a harness: the model as a condition names it, and its effort. */
export interface Solver {
  readonly model: string;
  readonly effort: string;
}

/** The limits a session is told it runs under, and the solver and limits each of its harness's
 *  solves is held to. */
export interface Told {
  readonly wallSeconds: number;
  readonly turns: number;
  readonly practiceSolves: number;
  readonly solver: Solver;
  readonly solve: Pick<Limits, "wallSeconds" | "modelTurns">;
}

/** What a session's work is measured by: said in the system prompt, and again in every
 *  continuation, so that the goal is one sentence with one owner. */
const GOAL =
  "Your harness is measured against a reference harness on tasks you are never shown: the same solving model answers each task under each harness, under the same limits.";

/** The texts a Builder reads that differ by who makes its campaign's moves. */
export interface Said {
  /** The system prompt's sentences on the campaign its tools lead and what ends it, before the one
   *  on the session's end; empty for a session by hand, whose campaign is the operator's. */
  readonly closing: string;
  /** What becomes of `harness/` at the session's end, as the system prompt and a continuation say it. */
  readonly frozen: string;
  /** `read_opening`'s description. */
  readonly opening: string;
  /** `finish`'s description. */
  readonly finish: string;
  /** What a harness that does not open leaves, with no practice solve and after one. */
  readonly broken: { readonly unpractised: string; readonly practised: string };
  /** What finishing on a harness no practice solve ran does. */
  readonly untried: string;
}

/**
 * Who makes a campaign's moves, and every text of a Builder's that differs by it. Under `host` a
 * session by hand (`tools/d2/session.ts`, `round.ts`) ends in a harness its operator has measured.
 * Under `builder` the campaign command's one live conversation makes them through its campaign
 * tools (`BuildRequest.campaign`, `tools/d2/harness-builder.ts`). A session takes its row once
 * (`Bench.said`), and no text asks which it is anywhere else, so the texts of a session by hand
 * are these and no others whatever the other row says. What a
 * session does differently with campaign tools, and not what it says, is asked of the same
 * request where it is done: its turns are metered as they end and its opening is served as the log
 * stands (`session.ts`), and its practice is held to the campaign's total (`practiceLeft`,
 * `tools.ts`). A led Builder is told each fact once, where it is owned: what its tools do in their
 * descriptions, and here what a tool result ends with and what ends the campaign. A promotion ends
 * nothing: the operator's milestone is no rule (`AGENTS.md`, "Climb"), and `finish` ends
 * the campaign only after three conversations in a row made no campaign move (`harness-builder.ts`).
 */
export const SAID: Readonly<Record<"host" | "builder", Said>> = {
  host: {
    closing: "",
    frozen: "frozen and measured",
    opening:
      "Return this session's opening message again, as it was sent: the public rules and the answer format, the practice tasks with their record at the start, every failed practice solve and each comparison so far, and the session's limits. It changes nothing. Use it when the conversation no longer holds those facts.",
    finish:
      "End the session. What harness/ holds now is frozen and measured. Say in one or two sentences what you changed and what you expect it to move. A harness that does not open, or that has changed since your last practice solve while solves are left, is said once and not refused: call finish again to end the session so.",
    broken: {
      unpractised: "no harness of this session is measured",
      practised: "the harness your last practice solve ran is measured in its place",
    },
    untried: "and have it measured untried",
  },
  builder: {
    closing:
      "You lead the campaign with its tools, and each one's result ends with the campaign's facts. A promotion ends nothing: the next step is measured against the new reference, and the climb goes on for as many steps as you find. The campaign ends at its budget, on its provider, on the operator's word, on a comparison stopped by check defects, after as many moves in a row without a gain as its patience, after as many readings that left the reference no room or Examiner sessions that held out no task, or once three conversations in a row have made no campaign move.",
    frozen: "frozen",
    opening:
      "Read the current public rules, practice tasks, failed practice solves, comparison tallies and session limits, for when this conversation no longer holds them. It changes nothing.",
    finish:
      "End this conversation and freeze harness/, measuring nothing. Record what changed, what remains unmeasured and what you would try next. Call finish again to acknowledge a notice about the harness.",
    broken: {
      unpractised: "no harness of this session is kept",
      practised: "the harness your last practice solve ran is kept in its place",
    },
    untried: "and leave it untried",
  },
};

/** What the next session receives from this one (v1's `HANDOVER`,
 *  `3f93d06:src/author/builder-session.ts`). Every session opens in a new home, and the Builder's
 *  own notes cross only through the one file the campaign keeps (`memory.ts`); `finish` ends the
 *  session at the turn that calls it, so a note meant for after it is never written. */
const HANDOVER =
  `The next session opens in a fresh home and receives only ${MEMORY_FILE} (plain file, no symlink), ` +
  `shown newest-first up to ${String(CONTEXT_OUTPUT_LIMIT)} characters (longer notes are cut to head and tail). ` +
  "Update it before calling finish, which ends the session on that turn.";

/** What a session has used of its limits, as the host counts it. */
export interface Used {
  /** The model's turns that have ended. */
  readonly turns: number;
  readonly seconds: number;
  /** The practice solves the session may still start (`practiceLeft`, `tools.ts`). */
  readonly practiceLeft: number;
  /** The session's latest harness snapshot, or null before one (`bench.opened`, `tools.ts`). */
  readonly practised: string | null;
}

/** Counted practice comes from the log, independently of which harness snapshot was frozen last. */
function tried(harness: string | Error, practice: "counted" | "uncounted"): string {
  if (harness instanceof Error) return "harness/ does not open as it stands: check_harness says why.";
  if (practice === "counted") return "harness/ has counted practice results under its exact current digest.";
  return "harness/ has no counted practice result as it stands.";
}

/** What the Builder's shell is told about its wall, after pi's own description. The command wall
 *  is the solver's, and the facts are the ones a solver's prompt gives of it
 *  (`src/solver/prompt.ts`, `environment`), the network as the reach test found it
 *  (`networkReach`): the shell is the solver's `bash`, started in the home. */
export const shellWalls = (network: NetworkReach): string =>
  ` Runs in your home directory (holding harness/, practice/, resources.json, HARNESS.md, notes, and kept/ copies of earlier harnesses; only harness/ is frozen). ${
    network === "unreached"
      ? "No network access, so a program the solver runs is one written here or already on the host."
      : `Network is reachable, so packages and programs can be installed under harness/.toolchain.${INSTALLER_TOLD[network]}`
  } Writable: your home and $TMPDIR, which persists for the session; a write under /tmp is refused or does not outlive the command. Readable: host toolchains and public runtime roots, never the repository or private data. Background jobs are killed when a command returns, so one is waited for in the command that started it.`;

export function systemPrompt(said: Said): string {
  return [
    "You are the Builder. You build and refine a Built Harness (programs and operating guide) for a separate solving model in one domain. The host owns verification, acceptance, and scoring.",
    `${GOAL} Measured tasks are never practice tasks and include families not seen in practice. One hard rule: nothing in harness/ may name a task, copy its text, or embed its answer.`,
    [
      "How to approach the work:",
      "- Use practice tasks as diagnostic samples of how the solver behaves in this domain. Read solver traces alongside the task inputs and public rules to find general gaps in domain method, tooling, or independent verification.",
      "- Put real domain work (parsing, modelling, simulation, candidate search, and public-rule checks) into reusable programs under .toolchain/, and keep agent/BUILT_AGENTS.md concise and grounded in first principles.",
      "- Prune as you iterate: simplify or remove prose and programs that traces show go unused or add no clear gain. Narrow recipes, constants, or shortcuts fitted to a handful of practice tasks fail to transfer to unseen tasks and families.",
      "- One practice solve is noisy: the same harness can fail and then pass. Read the full practice record rather than one run alone; anything edited after your last practice solve is measured untried.",
      "",
      "The solver is pi's coding agent. Your harness lives in harness/ (see HARNESS.md for shapes, conventions, a worked example, and the starter guide) and has three parts:",
      "- agent/tools-spec.json: selects pi coding tools for the solver (read, bash, edit, write).",
      "- .toolchain/: executables runnable by name in both your shell and the solver's.",
      "- agent/BUILT_AGENTS.md: the operating guide read into the solver's system prompt.",
      'You may revise or rewrite any part from scratch, from kept/, or from the starter; only harness/ at freeze is measured. Harnesses run from another directory than your home, so launchers resolve paths relative to themselves (as "$(dirname "$0")" does) and symlinks use relative targets; any script or link naming your home is refused at freeze.',
      "Hidden checks enforce the public rules. Your programs spend the solve's shared turn and time budget; the solver always decides what it writes to answer.json and submits.",
    ].join("\n"),
    `Comparisons pair your candidate against the reference on each task. Validity comes first: an invalid answer never beats a valid one. Between valid answers, an objective gain of at least ${String(GAP_FLOOR * 100)}% breaks ties. Earlier solved tasks remain in comparisons alongside new ones, so regressions on easy tasks cost comparisons. Cost and turns are reported but unscored; running out of turns, time, or context without submitting, or flagging a task malformed, counts as a fail. Check-defect fails are excluded and not yours to build around.`,
    "Use read, edit, and write with paths relative to your home (such as harness/agent/BUILT_AGENTS.md), and bash for everything else: searching, listing, running and installing. Each reply counts as one turn, with or without a tool call.",
    [
      said.closing,
      `The session ends when you call finish or hit its limits, and harness/ is then ${said.frozen}.`,
    ]
      .filter((sentence) => sentence !== "")
      .join(" "),
  ].join("\n\n");
}

/**
 * The last line of every tool result a Builder reads: the turn it is in, the session time used, the
 * practice solves left, and, until one has run, that none has. A solver has the same of its own
 * limits (`timed`, `src/solver/run.ts`). The facts ride on tool results because that is where a
 * Builder reads: nearly every turn ends in a tool call, so a message sent only between turns is
 * hardly ever read.
 *
 * The practice fact is there because a session can spend most of its time limit measuring a tool
 * chain through the shell without once calling `check_harness`, `preview_harness` or `practice`,
 * and leave a tree that does not open.
 * The line states the condition and no course: which fact matters is the Builder's.
 */
export function usedLine(used: Used, limits: Pick<Told, "wallSeconds" | "turns">): string {
  const clock = (seconds: number) => {
    const whole = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
  };
  return `[Session: turn ${String(used.turns + 1)} of ${String(limits.turns)}, ${clock(used.seconds)} of ${clock(limits.wallSeconds)} used, ${plural(used.practiceLeft, "practice solve")} left${used.practised === null ? ", no practice solve has run harness/" : ""}]`;
}

/**
 * What a Builder is sent when a turn of its ends with no tool call and no `finish`: that the
 * session goes on, its goal, what it has used of its limits, where `harness/` stands, and where
 * the opening facts are served again. It is v1's continuation (`continuePrompt`,
 * `3f93d06:src/author/builder-continuation.ts`), which restated the goal and the round's facts
 * at every turn boundary so that a compaction needed no signal.
 */
export function continuation(
  used: Used,
  limits: Pick<Told, "wallSeconds" | "turns">,
  harness: string | Error,
  said: Said,
  practice: "counted" | "uncounted",
): string {
  const minutes = (seconds: number) => String(Math.floor(seconds / 60));
  return [
    `You have not called finish, and the session goes on: ending a turn does not end it. It ends when you call finish or at its limits, and what harness/ holds then is ${said.frozen}.`,
    `The goal, unchanged: ${GOAL}`,
    `This session so far: ${String(used.turns)} of ${plural(limits.turns, "turn")} and ${minutes(used.seconds)} of ${plural(Number(minutes(limits.wallSeconds)), "minute")} used, ${plural(used.practiceLeft, "practice solve")} left. ${tried(harness, practice)}`,
    "read_opening returns the opening message again.",
  ].join("\n\n");
}

/** A record's clause of its valid answers' bands (`bandOf`, `tools.ts`), none where there are none;
 *  `name` gives the quantity in full once a message, then "the objective". */
export function measuredClause(name: () => string, measures: readonly string[] = []): string {
  return measures.length === 0 ? "" : `, ${name()} against the author's answer: ${measures.join(", ")}`;
}

/** The opening message: the domain's public contract, the practice tasks with their record under the
 *  harness the session starts from (and under the current reference harness when distinct, with
 *  each valid answer's band against the author's answer on record), what the campaign's log holds
 *  of the sessions before this one, and the session's limits. A task's public part is a file in the
 *  home, since a pack's inputs run long. */
export function firstMessage(contract: Contract, tasks: readonly Listed[], told: Told, past: Past): string {
  const names = [contract.objective?.quantity ?? ""];
  const name = () => names.shift() ?? "the objective";
  const listed = tasks.map(({ taskId, family, solves, passed, measures, left, reference }) => {
    if (left) {
      return `- ${taskId} (family ${family}): no longer a practice task, since the Referee ruled a check defect on a practice answer to it; read_trace still opens its solves.`;
    }
    const start =
      solves.length === 0
        ? "not yet solved under the harness you start from."
        : `passed ${String(passed)} of ${String(solves.length)} under the harness you start from${measuredClause(name, measures)}. Solves: ${solves.join(", ")}.`;
    const ref =
      reference === undefined || reference.solves.length === 0
        ? ""
        : ` Under the reference harness (${short(reference.digest)}): passed ${String(reference.passed)} of ${String(reference.solves.length)}${measuredClause(name, reference.measures)}. Solves: ${reference.solves.join(", ")}.`;
    return `- ${taskId} (family ${family}): ${start}${ref}`;
  });
  return [
    // First, and not last: it is the Builder's own prose and may predate what stands below it.
    ...(past.memory === "" ? [] : [past.memory]),
    `Public rules of the domain:\n${contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join("\n") || "(none)"}`,
    ...(contract.conventions === "" ? [] : [`Conventions: ${contract.conventions}`]),
    `Scope: ${contract.scope}`,
    ...(contract.objective === undefined ? [] : [`Objective: ${objectiveLine(contract.objective)}`]),
    `The solver's answer follows this schema: ${capturedJsonStringify(contract.answerFormat)}`,
    "The public resources every solve's home holds under public/resources/ are in resources.json.",
    `Practice tasks, each one's public part in practice/<task>.json:\n${listed.join("\n") || "(none)"}`,
    `${past.start}${
      past.fails.length === 0
        ? " No practice solve of these tasks has failed in this campaign so far."
        : ` Every failed practice solve of these tasks in this campaign so far, oldest first, with where it stands now; read_trace opens each:\n${past.fails.join("\n")}`
    }`,
    ...(past.comparisons.length === 0
      ? []
      : [`Comparisons so far, on tasks you are not shown:\n${past.comparisons.join("\n")}`]),
    // Who solves with the harness and what each solve is held to, since a campaign can run a
    // smaller solver under a Builder of the larger, and a guide written for one reads differently
    // to the other.
    `The solver your harness is measured with is ${told.solver.model} at ${told.solver.effort} effort. Each of its solves, in practice and in a comparison, has ${plural(Math.round(told.solve.wallSeconds / 60), "minute")} and ${told.solve.modelTurns === undefined ? "its model turns unlimited" : plural(told.solve.modelTurns, "model turn")}.`,
    HANDOVER,
    `This session has ${plural(told.practiceSolves, "practice solve")}, ${plural(Math.round(told.wallSeconds / 60), "minute")} and ${plural(told.turns, "turn")}.`,
  ].join("\n\n");
}
