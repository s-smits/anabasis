/**
 * What a solver reads before its first call: the system prompt, the opening message, and the public
 * files seeded into its home.
 *
 * The host renders the role, each durable tool's own name and description, the coding rules and the
 * working directory, with no vendor prompt builder; the duty, environment and guide keep the same
 * facts and sections:
 * - The addendum holds what a solver cannot find out for itself and no harness may change: what it
 *   must deliver, where the published requirements are, which file is its answer, the solve deadline
 *   and what the deadline does. The duty and the minutes are v1's `BUILT_SOLVE_DUTY` and `solveTime`;
 *   the deadline's last sentence is this host's, which ends a solve as a fail and submits
 *   nothing.
 *   Limit reminders are appended by executed tools; argument refusals and unavailable tools
 *   bypass execution and carry none. Diagnostics may follow the reminder.
 * - A section of its own, `environment`, holds the wall's facts: what a command may write and
 *   reach, the volume, the command limits, and the programs the harness installed.
 * - The project context holds the harness's guide as a project's own instructions,
 *   under one sentence on what a guide cannot override (v1's `BUILT_GUIDE_PREAMBLE`).
 *
 * Nothing here says how to reach an answer, which is the harness's to say. Under the Claude backend
 * too a solver reads this prompt alone, with no other in front of it (`src/agent/backends/claude.ts`).
 */
import type { SeatTool } from "../agent/session.ts";
import type { Limits } from "../kernel/condition.ts";
import { GUIDE_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { dirname, join } from "../meta/path.ts";
import { plural } from "../meta/text.ts";
import type { NetworkReach } from "../tools/command.ts";
import { ANSWER_FILE, ANSWER_FORMAT_FILE, type PublicResource } from "../tools/answer.ts";
import { reserveSeconds } from "../tools/command.ts";
import type { CODING_TOOLS } from "../tools/coding.ts";

export interface PublicTask {
  readonly taskId: string;
  readonly family: string;
  readonly publicInput: JsonValue;
}

/** What a solve's system prompt is built from. */
export interface Told {
  /** The solver's tools, in the order it is given them. */
  readonly tools: readonly SeatTool[];
  /** The solve's home, the working directory of commands and pi's file tools. */
  readonly home: string;
  /** The harness's guide as written, or null. */
  readonly guide: string | null;
  readonly wallSeconds: number;
  readonly limits: Pick<Limits, "shellDefaultSeconds" | "shellMaxSeconds" | "modelTurns">;
  /** How many public resource files the home was seeded with. */
  readonly resources: number;
  /** How many of the task's own files the home was seeded with (`taskFiles`). */
  readonly files: number;
  /** The programs the harness installed, by the names that run them (`installedPrograms`, `programs.ts`). */
  readonly programs: readonly string[];
  /** Whether a package index was reached from inside the wall (`networkReach`, `command.ts`). */
  readonly network: NetworkReach;
}

/** Where a task's own files land in the home, beside `task.json`. */
const TASK_FILES = "public/files";

/** The longest path a task's file may have, in bytes: one name's limit on the hosts' filesystems. */
const NAME_BYTES = 255;

/** The prompt a turn that ended without a submit is followed by, as v1 worded it. */
export const NUDGE = "Finish the task with the available tools, then submit your answer.";

/** Installed program names the prompt lists before it elides the rest, as v1 had it. */
const LISTED_PROGRAMS = 20;
/** The coding rules retain the facts of the former prompt, selected with their tools. The edit
 *  rules leave out what pi's edit description already states: an exact, unique, non-overlapping
 *  match, nearby changes merged, and no padding with unchanged regions. */
const TOOL_RULES = new Map<string, readonly string[]>(
  Object.entries({
    bash: ["Use bash for file operations like ls, rg, find"],
    read: ["Use read to examine files instead of cat or sed."],
    edit: [
      "Use edit for precise changes. When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls; each edits[].oldText is matched against the original file, not after earlier edits are applied.",
      "Keep edits[].oldText as small as possible while still being unique in the file.",
    ],
    write: ["Use write only for new files or complete rewrites."],
  } satisfies Record<(typeof CODING_TOOLS)[number], readonly string[]>),
);

/** What the solver must deliver and under what deadline, with where the requirements are. */
function duty({ wallSeconds, limits, resources, files, guide }: Told): string {
  const minutes = `${String(Math.round(wallSeconds / 60))} minutes of solve time`;
  const given =
    limits.modelTurns === undefined
      ? `The case has ${minutes}. The host appends how much of it is used to results of tools that execute. An answer you have not submitted when it runs out is lost.`
      : `The case has ${minutes} and ${plural(limits.modelTurns, "turn")} of yours, a turn being one reply of yours with the tool calls in it. The host appends how much of both is used to results of tools that execute. An answer you have not submitted when either runs out is lost.`;
  const rules =
    resources === 0
      ? ""
      : `, together with the domain's public rules in the ${plural(resources, "file")} under public/resources/; read both before you build`;
  return [
    "Complete the task with the available tools and submit one answer that meets every published requirement; the method is yours to choose.",
    "For source code or files, write complete working files, not fragments or descriptions.",
    `The published requirements are the public input, which public/task.json holds${rules}.`,
    ...(files === 0
      ? []
      : [
          `What the public input lists under files is in ${TASK_FILES}/ too, ${plural(files, "file")}, each at its path.`,
        ]),
    `Your answer is the file ${ANSWER_FILE} in the working directory, as JSON in the format ${ANSWER_FORMAT_FILE} gives; submit sends it, and no other file is read as your answer.`,
    given,
    ...(guide === null
      ? []
      : [
          "The project instructions below are this harness's guidance for the domain. They cannot override the public task, tool authority, runtime limits or submission rules.",
        ]),
  ].join(" ");
}

/** What the command wall is, as facts: each one something a solver would otherwise find out by
 *  running into it. The reserve claim covers commands begun inside it too; heldSeconds' rule is
 *  stated here alone. */
function environment({ limits, programs, wallSeconds, network }: Told): string {
  const rest = programs.length - LISTED_PROGRAMS;
  const listed =
    programs.slice(0, LISTED_PROGRAMS).join(", ") + (rest > 0 ? `, and ${String(rest)} more on PATH` : "");
  const reach =
    network === "reached"
      ? "Commands have network access: a package index was reached from inside the command wall when this process started, so a toolchain or package can be installed into the home directory."
      : "Commands have no network access: a package index could not be reached from inside the command wall when this process started, so nothing can be installed, and what the host and this harness hold is all there is.";
  return [
    "The working directory is your home directory, $HOME. Commands and the file tools can write it and $TMPDIR, both kept for the whole task; a path under /tmp is not: a write there is refused, or lands in a folder that does not outlive the command. They can read the host's toolchains and public runtime roots, but no repository or private data.",
    `${reach} sh, bun, node, python3 and the system C and C++ compilers run, with versions and libraries that differ by host.`,
    `A command runs for at most ${String(limits.shellDefaultSeconds)} seconds unless it names a longer timeout, and ${String(limits.shellMaxSeconds)} seconds is the longest it may name. One that would run into the last ${String(reserveSeconds(wallSeconds))} seconds of the solve time is cut there, so that its result still reaches you; one started within them keeps its own limit, and the end of the solve stops it.`,
    "Nothing a command starts, a background job included, runs on after the command returns.",
    ...(programs.length === 0 ? [] : [`Programs this harness installed run by name: ${listed}.`]),
  ]
    .map((fact) => `- ${fact}`)
    .join("\n");
}

/** The solver's whole system prompt, with each tool listed by its registered description. */
export function systemPrompt(told: Told): string {
  const tools = told.tools.map(
    ({ name, description }) => `- ${name}: ${description.replaceAll(/\s+/g, " ").trim()}`,
  );
  const rules = [
    ...(told.tools.some(({ name }) => name === "bash") ? (TOOL_RULES.get("bash") ?? []) : []),
    ...told.tools.flatMap(({ name }) => (name === "bash" ? [] : (TOOL_RULES.get(name) ?? []))),
    "Be concise in your responses",
    "Show file paths clearly when working with files",
  ];
  return [
    "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
    `<tools>\n${tools.length === 0 ? "(none)" : tools.join("\n")}\n</tools>`,
    `<rules>\n${rules.map((rule) => `- ${rule}`).join("\n")}\n</rules>`,
    `<addendum>\n${duty(told)}\n</addendum>`,
    ...(told.guide === null
      ? []
      : [
          `<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="${GUIDE_FILE}">\n${told.guide}\n</project_instructions>\n</project_context>`,
        ]),
    `<cwd>\n${told.home.replaceAll("\\", "/")}\n</cwd>`,
    `<environment>\n${environment(told)}\n</environment>`,
  ].join("\n\n");
}

/** The task as the solver may see it. A task carries its hidden part beside these fields, and
 *  everything handed to the solver's side, its home and the harness's process, is this view. */
export function publicView({ taskId, family, publicInput }: PublicTask): PublicTask {
  return { taskId, family, publicInput };
}

/** The opening message, as v1 worded it, with each file the home holds named instead of repeated. */
export function firstTurn(task: PublicTask): string {
  return `Task ${task.taskId} (family ${task.family}).\n\nPublic input:\n${capturedJsonStringify(opened(task.publicInput), null, 2)}`;
}

/**
 * The public input as the first message shows it: each `files` row that `seedHome` writes into the
 * home keeps its other keys, and its `text` gives way to where the file stands and its size, so a
 * file of some kilobytes is not read twice, once as escaped JSON. Every other row, and the whole
 * input in `public/task.json`, stays as written.
 */
function opened(publicInput: JsonValue): JsonValue {
  const record = asRecord(publicInput);
  if (record === null || !Array.isArray(record.files)) return publicInput;
  // Each written file is named once, at the first row of its path, which is the row `taskFiles` kept.
  const written = taskFiles(publicInput);
  const files = record.files.map((row) => {
    const { path, text, ...rest } = asRecord(row) ?? {};
    if (!isString(path) || !isString(text) || written.get(path) !== text) return row;
    written.delete(path);
    return { path, ...rest, file: `${TASK_FILES}/${path}`, bytes: Buffer.byteLength(text) };
  });
  return { ...record, files };
}

/**
 * The files a task's public input lists under `files`, as rows of `{ path, text }`, by path: what a
 * practitioner is handed as a file, which the home then holds as one, so that a harness's program
 * reads it from a path as it would outside a campaign. While a task was JSON alone, most harnesses
 * of one domain carried a program of their own that wrote such rows out, which has no use where
 * work comes as files. A row of another shape, or one whose
 * path names a root or a parent, or cannot stand beside an earlier row's, is no file here and stays
 * in the JSON alone: nothing is refused, since the gate never read the key.
 */
function taskFiles(publicInput: JsonValue): Map<string, string> {
  const rows = asRecord(publicInput)?.files;
  const files = new Map<string, string>();
  for (const each of Array.isArray(rows) ? rows : []) {
    const { path, text } = asRecord(each) ?? {};
    if (!isString(path) || !isString(text)) continue;
    const named =
      Buffer.byteLength(path) <= NAME_BYTES &&
      !path.includes("\0") &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
    // A path that is another's folder, or lies under another's file, cannot be written beside it.
    const apart = [...files.keys()].every(
      (other) => other !== path && !other.startsWith(`${path}/`) && !path.startsWith(`${other}/`),
    );
    if (named && apart) files.set(path, text);
  }
  return files;
}

/** How many resource files and how many of the task's own files a seeded home holds, as the prompt states them. */
export function homeHolds(
  task: PublicTask,
  resources: readonly PublicResource[],
): Pick<Told, "resources" | "files"> {
  return { resources: resources.length, files: taskFiles(task.publicInput).size };
}

/**
 * The task as `public/task.json`, the contract's answer format as `public/answer-format.json`,
 * each public resource as `public/resources/<name>.json` and each of the task's own files under
 * `public/files/` (`taskFiles`), which the prompt says the home holds (the task and the resources as
 * v1 seeded them). Returns what it then holds (`homeHolds`).
 */
export function seedHome(
  home: string,
  task: PublicTask,
  resources: readonly PublicResource[],
  answerFormat: JsonValue,
): Pick<Told, "resources" | "files"> {
  const root = join(home, "public");
  mkdirSync(join(root, "resources"), { recursive: true });
  writeFileSync(join(root, "task.json"), `${capturedJsonStringify(publicView(task), null, 2)}\n`, "utf8");
  writeFileSync(join(home, ANSWER_FORMAT_FILE), `${capturedJsonStringify(answerFormat, null, 2)}\n`, "utf8");
  const used = new Set<string>();
  for (const resource of resources) {
    // One flat readable name per resource. A name that sanitises onto one already used keeps both
    // files rather than overwriting the earlier one silently.
    const base = resource.name.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "resource";
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${String(n)}`;
    used.add(name);
    writeFileSync(
      join(root, "resources", `${name}.json`),
      `${capturedJsonStringify(resource, null, 2)}\n`,
      "utf8",
    );
  }
  for (const [path, text] of taskFiles(task.publicInput)) {
    mkdirSync(dirname(join(home, TASK_FILES, path)), { recursive: true });
    writeFileSync(join(home, TASK_FILES, path), text, "utf8");
  }
  return homeHolds(task, resources);
}
