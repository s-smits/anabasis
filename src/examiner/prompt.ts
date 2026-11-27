import { GAP_FLOOR, gapBasis, type ObjectiveRule } from "../kernel/compare.ts";
import { type Contract, objectiveLine } from "../kernel/contract.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { plural } from "../meta/text.ts";
import { DIFFICULTY_SCALE } from "./difficulty.ts";
import type { taskHistory } from "./record.ts";

export interface SolveBudget {
  readonly modelTurns: number | null;
  readonly minutes: number;
  readonly solves: number;
}

export interface CheckRow {
  readonly id: string;
  readonly assertion: string;
  readonly families: "all" | readonly string[];
}

type Told = Parameters<typeof firstMessage>[3];

export const TASK =
  "A task has a general family name (shared across tasks), a public input and hidden values. Solvers read family and public input; checks and judged criteria receive hidden values.";

export const FAIR =
  "Author original tasks from domain principles; never search for, fetch, or copy tasks from public benchmarks. Checks enforce only published rules, scope, conventions and cited standards, avoiding brittle markup comparisons. Never leak generating parameters, latent processes, planted faults or solving procedures in publicInput or family names, and vary generating constants across tasks so practice cannot memorise them.";

export const UNHELD = "Add no limit or requirement the field itself does not hold.";

export function systemPrompt(objective?: ObjectiveRule, revision: "fixed" | "revisable" = "fixed"): string {
  const floor = `${String(GAP_FLOOR * 100)}%`;
  const revisionNote =
    revision === "revisable"
      ? ' At a settled boundary, you may inspect the active check program with read_exam and propose a rubric, score, or additive-check revision (kind "tune") or fix a Referee-ruled check-defect (kind "repair") via revise_exam.'
      : "";
  return [
    `You are the Examiner. Write held-out tasks under the fixed public rules, answer format and checks. ${TASK}`,
    "## Who solves a task\n\nA solver works in a shell with the harness guide, harness programs and its own code, reading all outputs and errors within the solve budget. You never see solver trajectories, tools or harness source; you may inspect reported review observations (pairwise vote reasons, rejection rulings and draft audits) through read_reviews to spot missing domain coverage, check defects and substantive quality distinctions.",
    `## How a task is scored\n\nEach comparison solves tasks afresh on both arms: validity first, then the objective (code items and any judged criteria) between valid answers differing by at least ${floor} ${gapBasis(objective)}. Check defects set a task aside. A task leaves the reference room via partial validity, an author-proven valid answer the reference fails, an objective gap >= ${floor}, or judged deliverable quality differences. Without an objective, valid answers always tie.`,
    `## What the exam needs\n\nDemanding, fair, feasible tasks across diverse families within scope:\n- Prove feasibility with try_answer or forward construction from valid solutions.\n- Spread tasks across families; vary workspace formats (using base64 from_file when the exam uses mixed binary inputs) and multi-artifact deliverables where naive single-pass work omits requirements, skips diagnostics or produces incomplete outputs.\n- ${UNHELD}\n- ${FAIR}`,
    `## How hard\n\n${DIFFICULTY_SCALE}\n\nWrite above the highest grade the reference answers cleanly across every solve and deliverable criterion; do not rely on single-draw noise or cherry-picked random offsets (the record reports how often its own solves differed).`,
    `## The session\n\nPropose tasks in rounds via propose_tasks, check gate feedback, and call finish when done.${revisionNote} The host may wake this session later with updated comparison readings.`,
  ].join("\n\n");
}

export function budgetLine({ modelTurns, minutes, solves }: SolveBudget): string {
  return `Every solve of a task is held to ${modelTurns === null ? "no fixed number of the solver's own turns" : `${plural(modelTurns, "turn")} of the solver's own`}, a turn being one reply with the tool calls in it, and ${plural(minutes, "minute")}, and a comparison solves each task ${plural(solves, "time")} under each harness. This is the budget, fixed by the campaign's setting for every solve of it; it is no target of yours.`;
}

const limitsLine = (told: Told, lead: string) =>
  `${lead} ${plural(Math.round(told.wallSeconds / 60), "minute")}, ${plural(told.turns, "turn")} and ${plural(told.puts, "draft")} to put to the gate.`;

const grouped = (groups: ReturnType<typeof taskHistory>["groups"]) =>
  groups
    .map(({ heading, lines }) => `${heading}:\n${lines.map((line) => `- ${line}`).join("\n")}`)
    .join("\n\n");

export function firstMessage(
  contract: Contract,
  checks: readonly CheckRow[],
  tasks: ReturnType<typeof taskHistory>,
  told: {
    readonly wallSeconds: number;
    readonly turns: number;
    readonly puts: number;
  },
  campaign: { readonly brief: string | null; readonly budget: SolveBudget | null },
): string {
  const { brief, budget } = campaign;
  const families = (row: CheckRow) => (row.families === "all" ? "every family" : row.families.join(", "));
  return [
    ...(brief === null
      ? []
      : [
          `The domain, as the operator put it when the campaign opened. The rules below are the exam drafted from it and govern where the two differ:
${brief}`,
        ]),
    `Public rules of the domain:\n${contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join("\n") || "(none)"}`,
    ...(contract.conventions === "" ? [] : [`Conventions: ${contract.conventions}`]),
    `Scope: ${contract.scope}`,
    ...(contract.objective === undefined
      ? []
      : [
          `Objective: ${objectiveLine(contract.objective, "exam")}${
            contract.objective.items === undefined
              ? ""
              : " Where the frozen rubric reads task-specific criteria from hidden values, set them in each task's hidden field."
          }`,
        ]),
    `A solver's answer follows this schema: ${capturedJsonStringify(contract.answerFormat)}`,
    ...(budget === null ? [] : [budgetLine(budget)]),
    `The checks, by id:\n${checks.map((row) => `- ${row.id} (${families(row)}): ${row.assertion}`).join("\n") || "(none)"}`,
    ...(tasks.stood === null ? [] : [tasks.stood]),
    ...(tasks.reviews === null ? [] : [tasks.reviews]),
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

export function wakeMessage(tasks: ReturnType<typeof taskHistory>, told: Told): string {
  return [
    "The host asks for more tasks under the same exam.",
    tasks.stood ?? "No comparison has reported since the host last told you.",
    ...(tasks.reviews === null ? [] : [tasks.reviews]),
    ...(tasks.groups.length === 0
      ? []
      : [
          `The tasks compared since the host last told you, under how the harness that is the reference now did on each there. These are measurements, and no instruction or target.\n\n${grouped(tasks.groups)}`,
        ]),
    ...(tasks.promoted === null ? [] : [tasks.promoted]),
    limitsLine(told, "From here the session has"),
  ].join("\n\n");
}
