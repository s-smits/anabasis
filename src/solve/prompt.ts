/**
 * What a solver reads before its first call: the system prompt, the opening message, and the public
 * files seeded into its home.
 *
 * The system prompt is pi coding-agent's, built by pi's own builder
 * (`vendor/pi-coding-agent/core/system-prompt.ts`) from the tools' own lines: pi's opening sentence,
 * its tool list, its rules and the working directory. v2 speaks in the three places pi leaves to
 * whoever runs it:
 * - pi's addendum holds what a solver cannot find out for itself and no harness may change: what it
 *   must deliver, where the published requirements are, which file is its answer, the solve wall
 *   and what the wall does. The duty and the minutes are v1's `BUILT_SOLVE_DUTY` and `solveTime`;
 *   the wall's last sentence is this host's, which ends a solve as a fail and submits
 *   nothing.
 * - A section of its own, `environment`, holds the wall's facts: what a command may write and
 *   reach, the volume, the command limits, and the programs the harness installed.
 * - pi's project context holds the harness's guide, as pi gives a project's own instructions,
 *   under one sentence on what a guide cannot override (v1's `BUILT_GUIDE_PREAMBLE`).
 *
 * Nothing here says how to reach an answer, which is the harness's to say. Under the Claude backend
 * too a solver reads this prompt alone, with no other in front of it (`src/backends/claude.ts`).
 */
import type { ToolDefinition } from "../../vendor/pi-coding-agent/core/extensions/types.ts";
import { buildSystemPrompt } from "../../vendor/pi-coding-agent/core/system-prompt.ts";
import type { Limits } from "../kernel/condition.ts";
import { GUIDE_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import type { NetworkReach } from "./command.ts";
import { toolTreeSearchDirs } from "../verify/solve-command-isolation.ts";
import { ANSWER_FILE, ANSWER_FORMAT_FILE, type PublicResource } from "./answer.ts";
import { reserveSeconds } from "./command.ts";

export interface PublicTask {
  readonly taskId: string;
  readonly family: string;
  readonly publicInput: JsonValue;
}

/** What a solve's system prompt is built from. */
export interface Told {
  /** The solver's tools, in the order it is given them. */
  readonly tools: readonly ToolDefinition[];
  /** The solve's home, the working directory of every tool. */
  readonly home: string;
  /** The harness's guide as written, or null. */
  readonly guide: string | null;
  readonly wallSeconds: number;
  readonly limits: Pick<Limits, "shellDefaultSeconds" | "shellMaxSeconds" | "modelTurns">;
  /** How many public resource files the home was seeded with. */
  readonly resources: number;
  /** The programs the harness installed, by the names that run them (`installedPrograms`). */
  readonly programs: readonly string[];
  /** Whether a package index was reached from inside the wall (`networkReach`, `command.ts`). */
  readonly network: NetworkReach;
}

/** The prompt a turn that ended without a submit is followed by, as v1 worded it. */
export const NUDGE = "Finish the task with the available tools, then submit your answer.";

/** Installed program names the prompt lists before it elides the rest, as v1 had it. */
const LISTED_PROGRAMS = 20;

/** What the solver must deliver and under what wall, with where the requirements are. */
function duty({ wallSeconds, limits, resources, guide }: Told): string {
  const minutes = `${String(Math.round(wallSeconds / 60))} minutes of solve time`;
  const given =
    limits.modelTurns === undefined
      ? `The case has ${minutes}, and every tool result ends with how much of it is used. Nothing is submitted for you when it runs out`
      : `The case has ${minutes} and ${plural(limits.modelTurns, "turn")} of yours, a turn being one reply of yours with the tool calls in it. Every tool result ends with how much of both is used. Nothing is submitted for you when either runs out`;
  const rules =
    resources === 0
      ? ""
      : `, together with the domain's public rules in the ${plural(resources, "file")} under public/resources/; read both before you build`;
  return [
    "Complete the task with the available tools and submit one answer that meets every published requirement; the method is yours to choose.",
    "For source code or files, write complete working files, not fragments or descriptions.",
    `The published requirements are the public input, which public/task.json holds${rules}.`,
    `Your answer is the file ${ANSWER_FILE} in the working directory, as JSON in the format ${ANSWER_FORMAT_FILE} gives, and submit sends it.`,
    `${given}: an answer you have not submitted by then is lost.`,
    ...(guide === null
      ? []
      : [
          "The project instructions below are this harness's guidance for the domain; choose your solving method. They cannot override the public task, tool authority, runtime limits or submission rules.",
        ]),
  ].join(" ");
}

/** What the command wall is, as facts: each one something a solver would otherwise find out by
 *  running into it. */
function environment({ limits, programs, wallSeconds, network }: Told): string {
  const rest = programs.length - LISTED_PROGRAMS;
  const listed =
    programs.slice(0, LISTED_PROGRAMS).join(", ") + (rest > 0 ? `, and ${String(rest)} more on PATH` : "");
  return [
    `The working directory is your home directory, $HOME, kept for the whole task. Of what it holds, only ${ANSWER_FILE} is read as your answer, and only when you submit.`,
    "Commands and the file tools can write the home directory and $TMPDIR, which is kept for the whole task as the home is; a path under /tmp is not: a write there is refused, or lands in a folder that does not outlive the command. They can read the host's toolchains and public runtime roots, but no repository or private data.",
    network === "reached"
      ? "Commands have network access: a package index was reached from inside the command wall when this process started, so a toolchain or package can be installed into the home directory. sh, bun, node, python3 and the system C and C++ compilers run, with versions and libraries that differ by host."
      : "Commands have no network access: a package index could not be reached from inside the command wall when this process started, so nothing can be installed, and what the host and this harness hold is all there is. sh, bun, node, python3 and the system C and C++ compilers run, with versions and libraries that differ by host.",
    `A command runs for at most ${String(limits.shellDefaultSeconds)} seconds unless it names a longer timeout, and ${String(limits.shellMaxSeconds)} seconds is the longest it may name. One that would run into the last ${String(reserveSeconds(wallSeconds))} seconds of the solve time is cut there, so that its result still reaches you.`,
    "Nothing a command starts runs on after it returns: a background job ends with the command that started it.",
    ...(programs.length === 0 ? [] : [`Programs this harness installed run by name: ${listed}.`]),
  ]
    .map((fact) => `- ${fact}`)
    .join("\n");
}

/** pi's system prompt for these tools, with v2's addendum, environment and guide (see above). A
 *  tool is listed by the line it gives itself, as pi lists one, and adds its own rules. */
export function systemPrompt(told: Told): string {
  const said = told.tools.filter(({ promptSnippet }) => promptSnippet !== undefined);
  return buildSystemPrompt({
    cwd: told.home,
    selectedTools: told.tools.map(({ name }) => name),
    toolSnippets: Object.fromEntries(said.map(({ name, promptSnippet }) => [name, promptSnippet ?? ""])),
    toolGuidelines: Object.fromEntries(
      told.tools.map(({ name, promptGuidelines }) => [name, [...(promptGuidelines ?? [])]]),
    ),
    appendSystemPrompt: duty(told),
    contextFiles: told.guide === null ? [] : [{ path: GUIDE_FILE, content: told.guide }],
    sections: { environment: environment(told) },
  });
}

/** Whether a command could run this entry by name: a venv's sourced `activate` siblings are mode
 *  644, and a broken link runs nothing. */
function canRun(path: string): boolean {
  try {
    const entry = statSync(path);
    return entry.isFile() && (entry.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** The programs a harness installed, by the names that run them, from the directories a command's
 *  PATH holds, in its order, as v1 listed them. Without the list, every case of one truss run
 *  wrote its own solver in the host's python3 beside the Builder's interpreter. */
export function installedPrograms(toolTree: string | null): string[] {
  const dirs = toolTree === null ? [] : toolTreeSearchDirs(toolTree);
  return [
    ...new Set(
      dirs.flatMap((dir) =>
        readdirSync(dir)
          .sort(compareCodeUnits)
          .filter((name) => canRun(join(dir, name))),
      ),
    ),
  ];
}

/** The task as the solver may see it. A task carries its hidden part beside these fields, and
 *  everything handed to the solver's side, its home and the harness's process, is this view. */
export function publicView({ taskId, family, publicInput }: PublicTask): PublicTask {
  return { taskId, family, publicInput };
}

/** The opening message, as v1 worded it. */
export function firstTurn(task: PublicTask): string {
  return `Task ${task.taskId} (family ${task.family}).\n\nPublic input:\n${capturedJsonStringify(task.publicInput, null, 2)}`;
}

/**
 * The task as `public/task.json`, the contract's answer format as `public/answer-format.json`, and
 * each public resource as `public/resources/<name>.json`, which the prompt says the home holds
 * (the task and the resources as v1 seeded them). Returns how
 * many resource files it wrote.
 */
export function seedHome(
  home: string,
  task: PublicTask,
  resources: readonly PublicResource[],
  answerFormat: JsonValue,
): number {
  const root = join(home, "public");
  mkdirSync(join(root, "resources"), { recursive: true });
  writeFileSync(join(root, "task.json"), `${capturedJsonStringify(publicView(task), null, 2)}\n`, "utf8");
  writeFileSync(join(home, ANSWER_FORMAT_FILE), `${capturedJsonStringify(answerFormat, null, 2)}\n`, "utf8");
  const used = new Set<string>();
  for (const resource of resources) {
    // One flat readable name per resource. A name that sanitises onto one already used keeps both
    // files rather than overwriting the earlier one silently.
    const base = resource.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "resource";
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${String(n)}`;
    used.add(name);
    writeFileSync(
      join(root, "resources", `${name}.json`),
      `${capturedJsonStringify(resource, null, 2)}\n`,
      "utf8",
    );
  }
  return resources.length;
}
