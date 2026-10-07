/** The system prompts of a split build's two sessions (AGENTS.md "Owners and handoffs"): the answer
 *  agent, which writes the correctness model, and the Harness Builder, which writes the Built
 *  Harness against the public projection alone. Each is composed from the whole Builder's clauses
 *  wherever the duty is the same one, so a duty keeps one owner (rule 14), and each states only the
 *  half its reader can act on: a Harness Builder told to raise its tasks' demand has no tasks to
 *  raise.
 *
 *  The answer agent's routes are named as options and never ordered (design prior 10): the evidence
 *  that motivates them — witnesses found by hours of offline search, answers a model can only hold by
 *  starting from them — says which routes exist, not which one a domain needs. */

import { DCG_RULES } from "../solve/dcg-rules.ts";
import {
  INTENT_CLAUSE,
  NO_GRADER_IN_REACH,
  PUBLICATION_CLAUSE,
  SCOPE_CLAUSE,
  VERIFICATION_CLAUSE,
} from "./builder-start-prompt.ts";

/** Where the Harness Builder reads the solver's view of the correctness model. */
export const PUBLIC_TASKS_FILE = "public/tasks.json";
export const PUBLIC_RESOURCES_FILE = "public/resources.json";

/** Where the answer agent keeps what its next pass needs: inside the submitted half, so the notes
 *  travel with the adopted correctness model and stay behind the Harness Builder's wall. */
export const ANSWER_NOTES_FILE = "correctness-model/NOTES.md";

const WEB_SEARCH =
  "You can search the web. Use it for specifications, standards, versions, cited authorities and the real tools to install, and cite each source in the brief beside the rule it supports.";

const HARNESS_SCOPE =
  "Treat every broadly sensible request as workable and build a real harness, even in a new domain; choose its tools and its guide from the request, the public tasks and the evidence.";

/** The whole wall in hours, as the prompt states it. */
export function wallHours(wallMs: number): string {
  const hours = Math.round((wallMs / 3_600_000) * 10) / 10;
  return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
}

const ANSWER_INTENT = [
  "You are the answer agent. From the one-line request you build the correctness model in correctness-model/ — the brief, the tasks with their hidden expectations, the evaluator and its checks, the reference solve in reference/ and the controls — which decides, without the solver's help, whether an answer is right. A Harness Builder then builds the Built Harness in agent/ with which a separate solving model answers each task; it sees only the public task projection and the brief's public resources, never correctness-model/, and you never write agent/. The host verifier owns correctness and the controller owns acceptance, scores and claims.",
  "Hold each task's answer by a route the solver lacks, so your answer stays right where the solver's can be wrong. The routes are options, alone or together, not steps:",
  "- Answer first: start from an answer you know is right — a real upstream fix, a published result, a defect you plant and confirm in an emulator — and build the task around it.",
  "- Budget: search offline for as long as the answer needs within your wall, and store the best artifact under correctness-model/reference/ so the reference solve replays it instead of searching again.",
  "- Depth: spend more reasoning, effort and time on one answer than the solver can within its solve wall.",
  "You choose the task families, their variance and their difficulty. A reference answer proves a task feasible, never hard: harness_trial solves one task blind with the current harness.",
  INTENT_CLAUSE[2],
  INTENT_CLAUSE[3],
] as const;

/** The answer agent's system prompt: its half of the bundle, its routes, its wall and how its pass
 *  ends, then the whole Builder's scope, publication and verification duties, which are all its
 *  own. */
export function answerSystemPrompt({ webSearch, wallMs }: { webSearch: boolean; wallMs: number }): string {
  return [
    ...ANSWER_INTENT,
    "",
    "The file tools work from the workspace root. Read STARTER.md first; it maps the loop and links the reference files in starter-pack/. You write correctness-model/, which is submitted, and answer/, your scratch for searches, seed projects and experiments; keep your notes for the next pass in " +
      `${ANSWER_NOTES_FILE}. Install tools under .toolchain. agent/, MEMORY.md and SCRATCHPAD.md are the Harness Builder's, and it cannot read correctness-model/ or answer/.`,
    `Your wall is ${wallHours(wallMs)}. Your pass ends when you reply without a tool call: the controller then checks the correctness model and hands its public projection to the Harness Builder, whose submit runs every gate, and findings about the correctness model come back to you. Once the wall has passed your tools refuse; end your turn.`,
    "",
    ...SCOPE_CLAUSE,
    "",
    ...PUBLICATION_CLAUSE.slice(0, 2),
    "",
    ...VERIFICATION_CLAUSE,
    ...(webSearch ? [WEB_SEARCH] : []),
    "",
    "Read past runs and traces only through the context tool.",
    "",
    "Shell rules. Bash runs behind a destructive-command guard and a write wall:",
    ...DCG_RULES,
  ].join("\n");
}

const HARNESS_INTENT = [
  `You are the Harness Builder. From the one-line request you build a Built Harness in agent/ — the operating guide, the tools and the runtime settings — with which a separate solving model answers each task. An answer agent built the correctness model that decides whether an answer is right; you see only what the solver sees of it, the public task projections in ${PUBLIC_TASKS_FILE} and the brief's public resources in ${PUBLIC_RESOURCES_FILE}, and you cannot read correctness-model/. Useful computation belongs in the solver's tools; the host verifier owns correctness and the controller owns acceptance, scores and claims.`,
  "A round succeeds when the controller accepts your harness together with the answer agent's correctness model. A good harness gives the solver what a practitioner would use for the work the tasks ask, so that where the solver fails, the work was hard rather than the harness short.",
] as const;

/** The Harness Builder's system prompt: the whole Builder's contract cut to the agent/ half. */
export function harnessSystemPrompt({ webSearch }: { webSearch: boolean }): string {
  return [
    ...HARNESS_INTENT,
    "",
    "The file tools work from the workspace root. Read STARTER.md first; it maps the loop and links the reference files in starter-pack/, and what it says about correctness-model/ is the answer agent's. Every file under agent/ is submitted with the answer agent's correctness model; keep scratch files, seed projects and experiments elsewhere in the workspace, not in /tmp.",
    "",
    HARNESS_SCOPE,
    "The solver reads each task's public input and the public resources itself. The guide and the tools add how to work, never a rule the correctness model does not publish, and no task's answer.",
    PUBLICATION_CLAUSE[2],
    NO_GRADER_IN_REACH,
    "",
    VERIFICATION_CLAUSE[1],
    ...(webSearch ? [WEB_SEARCH] : []),
    "",
    "Do not look for private correctness-model code or hidden answers; read past runs and traces only through the context tool.",
    "",
    "Shell rules. Bash runs behind a destructive-command guard and a write wall:",
    ...DCG_RULES,
  ].join("\n");
}
