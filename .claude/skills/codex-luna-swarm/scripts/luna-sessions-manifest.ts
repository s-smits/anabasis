import { readFileSync, realpathSync, statSync } from "#src/meta/filesystem.ts";
import { isAbsolute } from "#src/meta/path.ts";
import { asRecord, isRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { hasText } from "#src/meta/text.ts";

/** What the shared strict parser returns for `OPTIONS`. */
export type ParsedLunaArgs = { single: ReadonlyMap<string, string>; flags: ReadonlySet<string> };
/** The parsed options keyed with underscores; a value option the caller left out is undefined. */
export type LunaOptions = {
  manifest: string | undefined;
  drain: string | undefined;
  output_dir: string | undefined;
  codex_bin: string | undefined;
  count: string | undefined;
  tasks_file: string | undefined;
  workdir: string | undefined;
  instructions_file: string | undefined;
  task_template: string | undefined;
  reasoning_effort: string | undefined;
  max_active: string | undefined;
  start_interval_ms: string | undefined;
  ephemeral: boolean;
  stress: boolean;
  launch_only: boolean;
  stop_hook: boolean;
  help: boolean;
};
/** One direct-launch session before `normalizeManifest` checks it. */
export type QuickSession = { name: JsonValue; task: JsonValue | undefined };
/** The manifest a direct launch builds from its options, read by `normalizeManifest` like a file. */
export type QuickManifest = {
  workdir: string;
  instructionsFile: string;
  stress: boolean;
  maxActive: string | undefined;
  startIntervalMs: string | number;
  sessions: QuickSession[];
};
export type LaunchPolicy = { maxActive: number; startIntervalMs: number };
export type Sandbox = "read-only" | "workspace-write";
/** One checked session, ready to launch. */
export type LunaSession = {
  name: string;
  prompt: string;
  workdir: string;
  sandbox: Sandbox;
  ownedPaths: string[];
};

const MODEL = "gpt-5.6-luna";
const DEFAULT_REASONING_EFFORT = "max";
const REASONING_EFFORTS = new Set(["high", "xhigh", "max"]);
const SANDBOXES: ReadonlySet<string> = new Set(["read-only", "workspace-write"]);
const SERVICE_TIER = "priority";
const DEFAULT_START_INTERVAL_MS = 1_000;
const BUNDLED_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex";
const HOMEBREW_CODEX = "/opt/homebrew/bin/codex";
const LAUNCH_SCHEMA_VERSION = 1;
const SEEN_SCHEMA_VERSION = 1;
const MAX_PROMPT_CHARACTERS = 200_000;
const MAX_INSTRUCTION_BYTES = MAX_PROMPT_CHARACTERS * 4;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_PREFIX_BYTES = 1024 * 1024;

const OPTIONS = {
  values: [
    "manifest",
    "drain",
    "output-dir",
    "codex-bin",
    "count",
    "tasks-file",
    "workdir",
    "instructions-file",
    "task-template",
    "reasoning-effort",
    "max-active",
    "start-interval-ms",
  ],
  flags: ["ephemeral", "stress", "launch-only", "stop-hook", "help"],
};

function usage(): string {
  return [
    "Usage: luna-sessions --manifest <absolute-json-path> [options]",
    "       luna-sessions --count <positive-integer> --workdir <absolute-directory> --instructions-file <absolute-file> [options]",
    "       luna-sessions --tasks-file <absolute-json-path> --workdir <absolute-directory> --instructions-file <absolute-file> [options]",
    "       luna-sessions --drain <absolute-output-directory>",
    "",
    "Options:",
    "  --output-dir <absolute-new-directory>",
    "  --codex-bin <absolute-executable>",
    "  --task-template <text with optional {i} and {count}>",
    "  --reasoning-effort <high|xhigh|max>  Default: max",
    "  --max-active <positive-integer>  Queue remaining tasks behind this active-session cap",
    "  --start-interval-ms <0-60000>  Minimum time between session starts",
    "  --launch-only  Do not retain the parent task for report collection",
    "  --ephemeral",
    "  --help",
  ].join("\n");
}

/** The parsed options keyed as `output_dir` for `--output-dir`, with every flag present as a
 *  boolean. The launcher parses `OPTIONS` through the shared strict parser first. */
function optionsFrom({ single, flags }: ParsedLunaArgs): LunaOptions {
  return {
    manifest: single.get("manifest"),
    drain: single.get("drain"),
    output_dir: single.get("output-dir"),
    codex_bin: single.get("codex-bin"),
    count: single.get("count"),
    tasks_file: single.get("tasks-file"),
    workdir: single.get("workdir"),
    instructions_file: single.get("instructions-file"),
    task_template: single.get("task-template"),
    reasoning_effort: single.get("reasoning-effort"),
    max_active: single.get("max-active"),
    start_interval_ms: single.get("start-interval-ms"),
    ephemeral: flags.has("ephemeral"),
    stress: flags.has("stress"),
    launch_only: flags.has("launch-only"),
    stop_hook: flags.has("stop-hook"),
    help: flags.has("help"),
  };
}

function normalizeReasoningEffort(value?: string): string {
  const effort = value ?? DEFAULT_REASONING_EFFORT;
  if (!REASONING_EFFORTS.has(effort)) {
    throw new Error("--reasoning-effort must be one of high, xhigh, or max");
  }
  return effort;
}

function isSandbox(value: JsonValue): value is Sandbox {
  return isString(value) && SANDBOXES.has(value);
}

function quickManifest(options: LunaOptions): QuickManifest {
  if (Boolean(options.count) === Boolean(options.tasks_file)) {
    throw new Error("choose exactly one of --count or --tasks-file for a direct launch");
  }
  let source: readonly unknown[];
  if (hasText(options.tasks_file)) {
    if (options.task_template !== undefined) {
      throw new Error("--task-template is accepted only with --count");
    }
    const tasksPath = absoluteExistingFile(options.tasks_file, "--tasks-file");
    if (statSync(tasksPath).size > MAX_MANIFEST_BYTES) {
      throw new Error(`--tasks-file exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    const tasks = readJsonFile(tasksPath);
    if (!Array.isArray(tasks)) throw new Error("--tasks-file must contain a JSON array");
    source = tasks;
  } else {
    // `--count` is set here: the check above refuses a launch naming neither.
    const countText = options.count ?? "";
    if (!/^\d+$/.test(countText)) throw new Error("--count must be a positive integer");
    const count = Number(countText);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("--count must be a positive integer");
    source = Array.from({ length: count }, () => null);
  }
  const count = source.length;
  if (count < 1) throw new Error("direct launch must contain at least one session");
  if (!hasText(options.workdir)) throw new Error("--workdir is required for a direct launch");
  if (!hasText(options.instructions_file)) {
    throw new Error("--instructions-file is required for a direct launch");
  }
  const template =
    options.task_template ??
    "You are investigator {i} of {count}. Follow the shared instructions and return the requested report.";
  if (template.trim().length === 0) {
    throw new Error("--task-template must be non-empty text");
  }
  const width = Math.max(2, String(count).length);
  const sessions = source.map((entry, index): QuickSession => {
    const rank = index + 1;
    if (hasText(options.tasks_file)) {
      if (isString(entry)) {
        return { name: `luna_${String(rank).padStart(width, "0")}`, task: entry };
      }
      if (!isRecord(entry)) {
        throw new Error(`tasks[${index}] must be a string or an object with name and task`);
      }
      const unexpected = Object.keys(entry).filter((key) => !new Set(["name", "task"]).has(key));
      if (unexpected.length > 0) {
        throw new Error(`tasks[${index}] has unsupported fields: ${unexpected.join(", ")}`);
      }
      return {
        name: entry.name ?? `luna_${String(rank).padStart(width, "0")}`,
        task: entry.task,
      };
    }
    return {
      name: `luna_${String(rank).padStart(width, "0")}`,
      task: template.replaceAll("{i}", String(rank)).replaceAll("{count}", String(count)),
    };
  });
  if (hasText(options.tasks_file)) {
    const descriptions = new Set<string>();
    sessions.forEach((session, index) => {
      if (!isString(session.task) || session.task.trim().length === 0) {
        throw new Error(`tasks[${index}].task must be non-empty text`);
      }
      const description = session.task.trim();
      if (descriptions.has(description)) throw new Error(`duplicate task description at tasks[${index}]`);
      descriptions.add(description);
    });
  }
  return {
    workdir: options.workdir,
    instructionsFile: options.instructions_file,
    stress: options.stress,
    maxActive: options.max_active,
    startIntervalMs: options.start_interval_ms ?? (count > 1 ? DEFAULT_START_INTERVAL_MS : 0),
    sessions,
  };
}

function launchPolicy(raw: unknown, sessionCount: number): LaunchPolicy {
  if (Array.isArray(raw)) {
    return { maxActive: sessionCount, startIntervalMs: sessionCount > 1 ? DEFAULT_START_INTERVAL_MS : 0 };
  }
  const record = asRecord(raw);
  const maxActive = Number(record?.maxActive ?? sessionCount);
  const startIntervalMs = Number(
    record?.startIntervalMs ?? (sessionCount > 1 ? DEFAULT_START_INTERVAL_MS : 0),
  );
  if (!Number.isInteger(maxActive) || maxActive < 1 || maxActive > sessionCount) {
    throw new Error(`maxActive must be an integer from 1 to ${sessionCount}`);
  }
  if (!Number.isInteger(startIntervalMs) || startIntervalMs < 0 || startIntervalMs > 60_000) {
    throw new Error("startIntervalMs must be an integer from 0 to 60000");
  }
  return { maxActive, startIntervalMs };
}

function absoluteExistingDirectory(value: string, field: string): string {
  if (!isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  const actual = realpathSync(value);
  if (!statSync(actual).isDirectory()) throw new Error(`${field} must be a directory`);
  return actual;
}

function absoluteExistingFile(value: string, field: string): string {
  if (!isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  const actual = realpathSync(value);
  if (!statSync(actual).isFile()) throw new Error(`${field} must be a file`);
  return actual;
}

function sharedInstructions(raw: unknown): string {
  const record = Array.isArray(raw) ? null : asRecord(raw);
  if (record === null) return "";
  const { instructions, instructionsFile } = record;
  if (instructions !== undefined && !isString(instructions)) {
    throw new Error("instructions must be a string");
  }
  let fromFile = "";
  if (instructionsFile !== undefined) {
    if (!isString(instructionsFile)) {
      throw new Error("instructionsFile must be an absolute file path");
    }
    const path = absoluteExistingFile(instructionsFile, "instructionsFile");
    if (statSync(path).size > MAX_INSTRUCTION_BYTES) {
      throw new Error(`instructionsFile exceeds ${MAX_INSTRUCTION_BYTES} bytes`);
    }
    fromFile = readFileSync(path, "utf8").trim();
  }
  return [fromFile, instructions?.trim()].filter(Boolean).join("\n\n");
}

/** The declared owned paths, or null when any entry is not a non-empty single-line path. */
function ownedPathsOf(value: JsonValue): string[] | null {
  if (!Array.isArray(value)) return null;
  const paths = value.filter(isString);
  const valid =
    paths.length === value.length &&
    !paths.some((path) => path.trim().length === 0 || path.includes("\0") || /[\r\n]/.test(path));
  return valid ? paths : null;
}

function normalizeManifest(raw: unknown): LunaSession[] {
  const record = Array.isArray(raw) ? null : asRecord(raw);
  const source = Array.isArray(raw) ? raw : record?.sessions;
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error("manifest must contain at least one session");
  }
  const defaultWorkdir = record?.workdir;
  const defaultSandbox = record?.sandbox ?? "read-only";
  const instructions = sharedInstructions(raw);
  const names = new Set<string>();
  return source.map((session, index): LunaSession => {
    if (!isRecord(session)) {
      throw new Error(`sessions[${index}] must be an object`);
    }
    const { name } = session;
    if (!isString(name) || !/^[a-z][a-z0-9_]{0,47}$/.test(name)) {
      throw new Error(`sessions[${index}].name must match ^[a-z][a-z0-9_]{0,47}$`);
    }
    if (names.has(name)) throw new Error(`duplicate session name: ${name}`);
    names.add(name);
    if (session.task !== undefined && session.prompt !== undefined) {
      throw new Error(`sessions[${index}] must use task or prompt, not both`);
    }
    const task = session.task ?? session.prompt;
    if (!isString(task) || task.trim().length === 0) {
      throw new Error(`sessions[${index}].task (or prompt) must be a non-empty string`);
    }
    const prompt = [instructions, task.trim()].filter(Boolean).join("\n\n");
    if (prompt.length > MAX_PROMPT_CHARACTERS) {
      throw new Error(
        `sessions[${index}] combined instructions and task exceed ${MAX_PROMPT_CHARACTERS} characters`,
      );
    }
    const workdir = session.workdir ?? defaultWorkdir;
    if (!isString(workdir)) {
      throw new Error(`sessions[${index}].workdir is required when manifest.workdir is absent`);
    }
    const sandbox = session.sandbox ?? defaultSandbox;
    if (!isSandbox(sandbox)) {
      throw new Error(`sessions[${index}].sandbox must be read-only or workspace-write`);
    }
    const ownedPaths = ownedPathsOf(session.ownedPaths ?? []);
    if (ownedPaths === null) {
      throw new Error(`sessions[${index}].ownedPaths must contain non-empty single-line paths`);
    }
    if (sandbox === "workspace-write" && ownedPaths.length === 0) {
      throw new Error(`write session ${name} must declare ownedPaths`);
    }
    return {
      name,
      prompt,
      workdir: absoluteExistingDirectory(workdir, `sessions[${index}].workdir`),
      sandbox,
      ownedPaths,
    };
  });
}

export {
  MODEL,
  SERVICE_TIER,
  BUNDLED_CODEX,
  HOMEBREW_CODEX,
  LAUNCH_SCHEMA_VERSION,
  SEEN_SCHEMA_VERSION,
  MAX_MANIFEST_BYTES,
  MAX_EVENT_PREFIX_BYTES,
  usage,
  optionsFrom,
  OPTIONS,
  normalizeReasoningEffort,
  quickManifest,
  launchPolicy,
  absoluteExistingDirectory,
  absoluteExistingFile,
  normalizeManifest,
};
