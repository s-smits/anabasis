import { GAP_FLOOR } from "../kernel/compare.ts";
import { type Contract, objectiveLine } from "../kernel/contract.ts";
import { HOST_ONLY } from "../harness/starter.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";
import type { Limits } from "../kernel/condition.ts";
import { short } from "../campaign/move.ts";
import { INSTALLER_TOLD, type NetworkReach } from "../tools/command.ts";
import { CONTEXT_OUTPUT_LIMIT } from "../../vendor/claude-mem/ContextBudget.ts";
import { MEMORY_FILE } from "./memory.ts";

interface TaskPractice {
  readonly solves: readonly string[];
  readonly passed: number;
  readonly measures?: readonly string[];
}

export interface Listed extends TaskPractice {
  readonly taskId: string;
  readonly family: string;
  readonly left: boolean;
  readonly reference?: TaskPractice & { readonly digest: string };
}

export interface Past {
  readonly start: string;
  readonly fails: readonly string[];
  readonly comparisons: readonly string[];
  readonly memory: string;
}

export interface Solver {
  readonly model: string;
  readonly effort: string;
}

interface SessionLimits {
  readonly wallSeconds: number;
  readonly turns: number;
  readonly practiceSolves: number;
  readonly solver: Solver;
  readonly solve: Pick<Limits, "wallSeconds" | "modelTurns">;
}

const GOAL =
  "Your harness is measured against a reference harness on tasks you are never shown: the same solving model answers each task under each harness, under the same limits.";

export interface ModePrompts {
  readonly closing: string;
  readonly frozen: string;
  readonly opening: string;
  readonly finish: string;
  readonly broken: { readonly unpractised: string; readonly practised: string };
  readonly untried: string;
}

export const MODE_PROMPTS: Readonly<Record<"host" | "builder", ModePrompts>> = {
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

const HANDOVER =
  `The next session opens in a fresh home and receives only ${MEMORY_FILE} (plain file, no symlink), ` +
  `shown newest-first up to ${String(CONTEXT_OUTPUT_LIMIT)} characters (longer notes are cut to head and tail). ` +
  "Update it before calling finish, which ends the session on that turn.";

export interface Used {
  readonly turns: number;
  readonly seconds: number;
  readonly practiceLeft: number;
  readonly practised: string | null;
}

function tried(harness: string | Error, practice: "counted" | "uncounted"): string {
  if (harness instanceof Error) return "harness/ does not open as it stands: check_harness says why.";
  if (practice === "counted") return "harness/ has counted practice results under its exact current digest.";
  return "harness/ has no counted practice result as it stands.";
}

export const shellWalls = (network: NetworkReach): string =>
  ` Runs in your home directory (holding harness/, practice/, resources.json, HARNESS.md, notes, and kept/ copies of earlier harnesses; only harness/ is frozen). ${
    network === "unreached"
      ? "No network access, so a program the solver runs is one written here or already on the host."
      : `Network is reachable, so packages and programs can be installed under harness/.toolchain.${INSTALLER_TOLD[network]}`
  } Writable: your home and $TMPDIR, which persists for the session; a write under /tmp is refused or does not outlive the command. Readable: host toolchains and public runtime roots, never the repository or private data. Background jobs are killed when a command returns, so one is waited for in the command that started it.`;

export function systemPrompt(modePrompts: ModePrompts): string {
  return [
    "You are the Builder. You build and refine a Built Harness (programs and operating guide) for a separate solving model in one domain. The host owns verification, acceptance, and scoring.",
    `${GOAL} Measured tasks are never practice tasks and include families not seen in practice. One hard rule: nothing in harness/ may name a task, copy its text, or embed its answer.`,
    [
      "Practice tasks are diagnostic samples of how the solver behaves in this domain; reading solver traces alongside task inputs and public rules exposes general gaps in method, tooling, or verification. One practice solve is noisy (the same harness can fail and then pass), anything edited after your last practice solve is measured untried, and narrow recipes or constants fitted to practice tasks fail to transfer to unseen tasks and families. General, composable programs under .toolchain/ transfer across unseen tasks and families, whereas single-family scripts sit idle outside the family they were written for. Every line of agent/BUILT_AGENTS.md enters every solve's prompt, so concise guides and pruning uninvoked programs or stale prose leave room for reading new tasks.",
      `Kept harnesses are also exported and run on ordinary domain workspaces where public/task.json, public/files/, public/resources/, answer.json, submit, and campaign scoring do not exist. Export keeps agent/BUILT_AGENTS.md up to the heading "${HOST_ONLY}" and strips everything under it, so sections above that heading describe general domain tools and method over ordinary files while campaign-specific paths, rule IDs, checking, and submission belong under "${HOST_ONLY}".`,
      "",
      "The solver is pi's coding agent. Your harness lives in harness/ (see HARNESS.md for shapes, conventions, a worked example, and the starter guide) and has three parts:",
      "- agent/tools-spec.json: selects pi coding tools for the solver (read, bash, edit, write).",
      "- .toolchain/: executables runnable by name in both your shell and the solver's.",
      "- agent/BUILT_AGENTS.md: the operating guide read into the solver's system prompt.",
      'You may revise or rewrite any part from scratch, from kept/, or from the starter; only harness/ at freeze is measured. Harnesses run from another directory than your home, so launchers resolve paths relative to themselves (as "$(dirname "$0")" does) and symlinks use relative targets; any script or link naming your home is refused at freeze.',
      "Hidden checks enforce the public rules. Your programs spend the solve's shared turn and time budget; the solver always decides what it writes to answer.json and submits.",
    ].join("\n"),
    `Comparisons pair your candidate against the reference on each task. Validity comes first: an invalid answer never beats a valid one. Between valid answers, an objective gain of at least ${String(GAP_FLOOR * 100)}% of the larger magnitude breaks ties. Earlier solved tasks remain in comparisons alongside new ones, so regressions on easy tasks cost comparisons. Cost and turns are reported but unscored; running out of turns, time, or context without submitting, or flagging a task malformed, counts as a fail. Check-defect fails are excluded and not yours to build around.`,
    "Use read, edit, and write with paths relative to your home (such as harness/agent/BUILT_AGENTS.md), and bash for everything else: searching, listing, running and installing. Each reply counts as one turn, with or without a tool call.",
    [
      modePrompts.closing,
      `The session ends when you call finish or hit its limits, and harness/ is then ${modePrompts.frozen}.`,
    ]
      .filter((sentence) => sentence !== "")
      .join(" "),
  ].join("\n\n");
}

export function usedLine(used: Used, limits: Pick<SessionLimits, "wallSeconds" | "turns">): string {
  const clock = (seconds: number) => {
    const whole = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
  };
  return `[Session: turn ${String(used.turns + 1)} of ${String(limits.turns)}, ${clock(used.seconds)} of ${clock(limits.wallSeconds)} used, ${plural(used.practiceLeft, "practice solve")} left${used.practised === null ? ", no practice solve has run harness/" : ""}]`;
}

export function continuation(
  used: Used,
  limits: Pick<SessionLimits, "wallSeconds" | "turns">,
  harness: string | Error,
  modePrompts: ModePrompts,
  practice: "counted" | "uncounted",
): string {
  const minutes = (seconds: number) => String(Math.floor(seconds / 60));
  return [
    `You have not called finish, and the session goes on: ending a turn does not end it. It ends when you call finish or at its limits, and what harness/ holds then is ${modePrompts.frozen}.`,
    `The goal, unchanged: ${GOAL}`,
    `This session so far: ${String(used.turns)} of ${plural(limits.turns, "turn")} and ${minutes(used.seconds)} of ${plural(Number(minutes(limits.wallSeconds)), "minute")} used, ${plural(used.practiceLeft, "practice solve")} left. ${tried(harness, practice)}`,
    "read_opening returns the opening message again.",
  ].join("\n\n");
}

export function measuredClause(name: () => string, measures: readonly string[] = []): string {
  return measures.length === 0 ? "" : `, ${name()} against the author's answer: ${measures.join(", ")}`;
}

export function firstMessage(
  contract: Contract,
  tasks: readonly Listed[],
  told: SessionLimits,
  past: Past,
): string {
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
    `The solver your harness is measured with is ${told.solver.model} at ${told.solver.effort} effort. Each of its solves, in practice and in a comparison, has ${plural(Math.round(told.solve.wallSeconds / 60), "minute")} and ${told.solve.modelTurns === undefined ? "its model turns unlimited" : plural(told.solve.modelTurns, "model turn")}.`,
    HANDOVER,
    `This session has ${plural(told.practiceSolves, "practice solve")}, ${plural(Math.round(told.wallSeconds / 60), "minute")} and ${plural(told.turns, "turn")}.`,
  ].join("\n\n");
}
