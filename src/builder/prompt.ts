import { GAP_FLOOR, gapBasis, type ObjectiveRule } from "../kernel/compare.ts";
import { type Contract, hasJudge, objectiveLine } from "../kernel/contract.ts";
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

interface Past {
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
  "Your harness is measured against a reference harness on hidden held-out tasks under identical solver and limits.";

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
    opening: "Return this session's opening record and limits unchanged.",
    finish:
      "End the session and freeze harness/ for measurement. State what changed and why. Call finish again to acknowledge any notice.",
    broken: {
      unpractised: "no harness of this session is measured",
      practised: "the harness your last practice solve ran is measured in its place",
    },
    untried: "and have it measured untried",
  },
  builder: {
    closing:
      "Drive the campaign with its tools. A promotion advances the reference and continues the climb until budget, patience, no-room, check defects, operator stop or three idle conversations.",
    frozen: "frozen",
    opening: "Read the current public rules, practice record, failures, comparisons and session limits.",
    finish:
      "End this conversation and freeze harness/ without comparing. Note what changed, what is unmeasured and next steps. Call finish again to acknowledge any notice.",
    broken: {
      unpractised: "no harness of this session is kept",
      practised: "the harness your last practice solve ran is kept in its place",
    },
    untried: "and leave it untried",
  },
};

const HANDOVER = `The next session starts in a fresh home reading only ${MEMORY_FILE} (plain file, newest-first up to ${String(CONTEXT_OUTPUT_LIMIT)} characters). Update it before calling finish.`;

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
  ` Runs in your home (harness/, practice/, resources.json, HARNESS.md, kept/; only harness/ is frozen). ${
    network === "unreached"
      ? "No network access."
      : `Network reachable for installs under harness/.toolchain.${INSTALLER_TOLD[network]}`
  } Write to home or $TMPDIR (never /tmp); no repository/private access; background jobs end on return.`;

export function systemPrompt(modePrompts: ModePrompts, objective?: ObjectiveRule): string {
  return [
    "You are the Builder. Build and refine a Built Harness (programs and operating guide) for a separate solving model in one domain. The host owns verification, acceptance and scoring.",
    `${GOAL} Measured tasks include unseen families; never name a task, copy its text or embed its answer in harness/.`,
    [
      'Use practice tasks to diagnose general gaps in method, tooling and deliverable verification: run `practice` (including `under: "reference"`) and inspect both tool calls AND delivered files side-by-side via `read_trace(solve, file=...)` (checking deliverable integrity, diagnostics, clarity and omitted requirements—especially when the objective includes judged criteria). Single solves are noisy; narrow practice-fitted recipes fail to transfer.',
      `General, composable programs under .toolchain/ transfer across unseen tasks and external workspaces; prune unused scripts and stale prose. Keep \`agent/BUILT_AGENTS.md\` lean above \`${HOST_ONLY}\` (concise portable tool invocation and high-leverage verification habits, storing longer reference docs under \`.toolchain/\` for on-demand reading) and put all campaign paths (\`public/task.json\`, \`answer.json\`, \`submit\`), rule IDs and campaign wrappers strictly under \`${HOST_ONLY}\`, which export strips. Let the solver use its full budget for discovery, diagnostics and reopening deliverables.`,
      "",
      "The solver is pi's coding agent; harness/ (see HARNESS.md) holds `agent/tools-spec.json`, `.toolchain/` (relative paths/symlinks only, never your home path) and `agent/BUILT_AGENTS.md`. You may revise or rewrite from scratch, kept/ or starter; the solver always decides what it writes and submits.",
    ].join("\n"),
    `Comparisons pair candidate vs reference: validity first, then objective gains >= ${String(GAP_FLOOR * 100)}% ${gapBasis(objective)} (plus swapped pairwise judging when declared). Retained tasks guard against regressions. Cost and turns are unscored, and each arm's mean solve cost and turns are reported alongside each reading so you can spot prompt bloat or rushed solves; every guide line enters every solve's context. Timeouts, turn-limit expiry or malformed flags count as fails; check-defect fails are excluded.`,
    "Use read, edit and write with paths relative to home (e.g. harness/agent/BUILT_AGENTS.md), and bash for everything else.",
    [modePrompts.closing, `Ending via finish or limits leaves harness/ ${modePrompts.frozen}.`]
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
  const judged = hasJudge(contract.objective);
  const label = judged ? "the code-scored part of the objective" : "the objective";
  const names = [
    judged ? `${label} (${contract.objective?.quantity ?? ""})` : (contract.objective?.quantity ?? ""),
  ];
  const name = () => names.shift() ?? label;
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
