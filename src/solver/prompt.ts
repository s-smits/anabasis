import type { AgentTool } from "../agent/session.ts";
import { DELIVERABLES, fileRowBytes } from "../kernel/answer-files.ts";
import type { Limits } from "../kernel/condition.ts";
import { GUIDE_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { dirname, join } from "../meta/path.ts";
import { plural } from "../meta/text.ts";
import { ANSWER_FILE, ANSWER_FORMAT_FILE, type PublicResource } from "../tools/answer.ts";
import { INSTALLER_TOLD, type NetworkReach, reserveSeconds } from "../tools/command.ts";
import type { CODING_TOOLS } from "../tools/coding.ts";

export interface PublicTask {
  readonly taskId: string;
  readonly family: string;
  readonly publicInput: JsonValue;
}

interface PromptEnvelope {
  readonly tools: readonly AgentTool[];
  readonly home: string;
  readonly guide: string | null;
  readonly addendum: string;
  readonly environment: string;
}

export interface Told {
  readonly tools: readonly AgentTool[];
  readonly home: string;
  readonly guide: string | null;
  readonly wallSeconds: number;
  readonly limits: Pick<Limits, "shellDefaultSeconds" | "shellMaxSeconds" | "modelTurns">;
  readonly resources: number;
  readonly files: number;
  readonly programs: readonly string[];
  readonly network: NetworkReach;
}

const TASK_FILES = "public/files";

export const NUDGE = "Finish the task with the available tools, then submit your answer.";

const LISTED_PROGRAMS = 20;
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

export function listedPrograms(programs: readonly string[]): string {
  const rest = programs.length - LISTED_PROGRAMS;
  return (
    programs.slice(0, LISTED_PROGRAMS).join(", ") + (rest > 0 ? `, and ${String(rest)} more on PATH` : "")
  );
}

function environment({ limits, programs, wallSeconds, network }: Told): string {
  const listed = listedPrograms(programs);
  const reach =
    network === "unreached"
      ? "Commands have no network access: a package index could not be reached from inside the command wall when this process started, so nothing can be installed, and what the host and this harness hold is all there is."
      : `Commands have network access: a package index was reached from inside the command wall when this process started, so a toolchain or package can be installed into the home directory.${INSTALLER_TOLD[network]}`;
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

export function promptEnvelope({
  tools: seatTools,
  home,
  guide,
  addendum,
  environment: env,
}: PromptEnvelope): string {
  const tools = seatTools.map(
    ({ name, description }) => `- ${name}: ${description.replaceAll(/\s+/g, " ").trim()}`,
  );
  const rules = [
    ...(seatTools.some(({ name }) => name === "bash") ? (TOOL_RULES.get("bash") ?? []) : []),
    ...seatTools.flatMap(({ name }) => (name === "bash" ? [] : (TOOL_RULES.get(name) ?? []))),
    "Be concise in your responses",
    "Show file paths clearly when working with files",
  ];
  return [
    "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
    `<tools>\n${tools.length === 0 ? "(none)" : tools.join("\n")}\n</tools>`,
    `<rules>\n${rules.map((rule) => `- ${rule}`).join("\n")}\n</rules>`,
    `<addendum>\n${addendum}\n</addendum>`,
    ...(guide === null
      ? []
      : [
          `<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="${GUIDE_FILE}">\n${guide}\n</project_instructions>\n</project_context>`,
        ]),
    `<cwd>\n${home.replaceAll("\\", "/")}\n</cwd>`,
    `<environment>\n${env}\n</environment>`,
  ].join("\n\n");
}

export function systemPrompt(told: Told): string {
  return promptEnvelope({
    tools: told.tools,
    home: told.home,
    guide: told.guide,
    addendum: duty(told),
    environment: environment(told),
  });
}

export function publicView({ taskId, family, publicInput }: PublicTask): PublicTask {
  return { taskId, family, publicInput };
}

export function firstTurn(task: PublicTask): string {
  return `Task ${task.taskId} (family ${task.family}).\n\nPublic input:\n${capturedJsonStringify(opened(task.publicInput), null, 2)}`;
}

function opened(publicInput: JsonValue): JsonValue {
  const record = asRecord(publicInput);
  if (record === null || !Array.isArray(record.files)) return publicInput;
  const written = taskFiles(publicInput);
  const files = record.files.map((row) => {
    const held = asRecord(row);
    if (held === null || !isString(held.path)) return row;
    const bytes = written.get(held.path);
    const decoded = bytes === undefined ? null : fileRowBytes(held);
    if (bytes === undefined || decoded === null || !decoded.equals(bytes)) return row;
    written.delete(held.path);
    const { text: _t, base64: _b, entries: _e, ...rest } = held;
    return { ...rest, path: held.path, file: `${TASK_FILES}/${held.path}`, bytes: bytes.length };
  });
  return { ...record, files };
}

function taskFiles(publicInput: JsonValue): Map<string, Buffer> {
  const rows = asRecord(publicInput)?.files;
  const files = new Map<string, Buffer>();
  let total = 0;
  for (const each of Array.isArray(rows) ? rows : []) {
    const row = asRecord(each);
    const bytes = row === null ? null : fileRowBytes(row);
    if (bytes === null || !isString(row?.path) || total + bytes.length > DELIVERABLES.bytes) continue;
    const path = row.path;
    const apart = [...files.keys()].every(
      (other) => other !== path && !other.startsWith(`${path}/`) && !path.startsWith(`${other}/`),
    );
    if (apart) {
      files.set(path, bytes);
      total += bytes.length;
    }
  }
  return files;
}

function homeHolds(
  task: PublicTask,
  resources: readonly PublicResource[],
): Pick<Told, "resources" | "files"> {
  return { resources: resources.length, files: taskFiles(task.publicInput).size };
}

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
  for (const [path, bytes] of taskFiles(task.publicInput)) {
    mkdirSync(dirname(join(home, TASK_FILES, path)), { recursive: true });
    writeFileSync(join(home, TASK_FILES, path), bytes);
  }
  return homeHolds(task, resources);
}
