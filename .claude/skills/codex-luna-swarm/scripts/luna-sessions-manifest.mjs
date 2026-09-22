import { readFileSync, realpathSync, statSync } from "#src/meta/filesystem.ts";
import { isAbsolute } from "#src/meta/path.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

const MODEL = "gpt-5.6-luna";
const DEFAULT_REASONING_EFFORT = "max";
const REASONING_EFFORTS = new Set(["high", "xhigh", "max"]);
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

function usage() {
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

function parseArgs(argv) {
  const parsed = { ephemeral: false, stress: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--ephemeral", "--stress", "--launch-only", "--stop-hook"].includes(arg)) {
      const key = arg.slice(2).replaceAll("-", "_");
      if (parsed[key]) throw new Error(`Duplicate argument: ${arg}`);
      parsed[key] = true;
    } else if (arg === "--help") {
      parsed.help = true;
    } else if (
      [
        "--manifest",
        "--drain",
        "--output-dir",
        "--codex-bin",
        "--count",
        "--tasks-file",
        "--workdir",
        "--instructions-file",
        "--task-template",
        "--reasoning-effort",
        "--max-active",
        "--start-interval-ms",
      ].includes(arg)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      const key = arg.slice(2).replaceAll("-", "_");
      if (parsed[key] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
      parsed[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function normalizeReasoningEffort(value) {
  const effort = value ?? DEFAULT_REASONING_EFFORT;
  if (!REASONING_EFFORTS.has(effort)) {
    throw new Error("--reasoning-effort must be one of high, xhigh, or max");
  }
  return effort;
}

function quickManifest(options) {
  if (Boolean(options.count) === Boolean(options.tasks_file)) {
    throw new Error("choose exactly one of --count or --tasks-file for a direct launch");
  }
  let source;
  if (options.tasks_file) {
    if (options.task_template !== undefined) {
      throw new Error("--task-template is accepted only with --count");
    }
    const tasksPath = absoluteExistingFile(options.tasks_file, "--tasks-file");
    if (statSync(tasksPath).size > MAX_MANIFEST_BYTES) {
      throw new Error(`--tasks-file exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    source = readJsonFile(tasksPath);
    if (!Array.isArray(source)) throw new Error("--tasks-file must contain a JSON array");
  } else {
    if (!/^\d+$/.test(options.count)) throw new Error("--count must be a positive integer");
    const count = Number(options.count);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("--count must be a positive integer");
    source = Array.from({ length: count }, () => null);
  }
  const count = source.length;
  if (count < 1) throw new Error("direct launch must contain at least one session");
  if (!options.workdir) throw new Error("--workdir is required for a direct launch");
  if (!options.instructions_file) throw new Error("--instructions-file is required for a direct launch");
  const template =
    options.task_template ??
    "You are investigator {i} of {count}. Follow the shared instructions and return the requested report.";
  if (!isString(template) || template.trim().length === 0) {
    throw new Error("--task-template must be non-empty text");
  }
  const width = Math.max(2, String(count).length);
  const sessions = source.map((entry, index) => {
    const rank = index + 1;
    if (options.tasks_file) {
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
  if (options.tasks_file) {
    const descriptions = new Set();
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

function launchPolicy(raw, sessionCount) {
  if (Array.isArray(raw)) {
    return { maxActive: sessionCount, startIntervalMs: sessionCount > 1 ? DEFAULT_START_INTERVAL_MS : 0 };
  }
  const maxActive = Number(raw?.maxActive ?? sessionCount);
  const startIntervalMs = Number(raw?.startIntervalMs ?? (sessionCount > 1 ? DEFAULT_START_INTERVAL_MS : 0));
  if (!Number.isInteger(maxActive) || maxActive < 1 || maxActive > sessionCount) {
    throw new Error(`maxActive must be an integer from 1 to ${sessionCount}`);
  }
  if (!Number.isInteger(startIntervalMs) || startIntervalMs < 0 || startIntervalMs > 60_000) {
    throw new Error("startIntervalMs must be an integer from 0 to 60000");
  }
  return { maxActive, startIntervalMs };
}

function absoluteExistingDirectory(value, field) {
  if (!isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  const actual = realpathSync(value);
  if (!statSync(actual).isDirectory()) throw new Error(`${field} must be a directory`);
  return actual;
}

function absoluteExistingFile(value, field) {
  if (!isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  const actual = realpathSync(value);
  if (!statSync(actual).isFile()) throw new Error(`${field} must be a file`);
  return actual;
}

function sharedInstructions(raw) {
  if (Array.isArray(raw) || !raw || typeof raw !== "object") return "";
  if (raw.instructions !== undefined && !isString(raw.instructions)) {
    throw new Error("instructions must be a string");
  }
  let fromFile = "";
  if (raw.instructionsFile !== undefined) {
    if (!isString(raw.instructionsFile)) {
      throw new Error("instructionsFile must be an absolute file path");
    }
    const path = absoluteExistingFile(raw.instructionsFile, "instructionsFile");
    if (statSync(path).size > MAX_INSTRUCTION_BYTES) {
      throw new Error(`instructionsFile exceeds ${MAX_INSTRUCTION_BYTES} bytes`);
    }
    fromFile = readFileSync(path, "utf8").trim();
  }
  return [fromFile, raw.instructions?.trim()].filter(Boolean).join("\n\n");
}

function normalizeManifest(raw) {
  const source = Array.isArray(raw) ? raw : raw?.sessions;
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error("manifest must contain at least one session");
  }
  const defaultWorkdir = Array.isArray(raw) ? undefined : raw.workdir;
  const defaultSandbox = Array.isArray(raw) ? "read-only" : (raw.sandbox ?? "read-only");
  const instructions = sharedInstructions(raw);
  const names = new Set();
  return source.map((session, index) => {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
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
    if (!new Set(["read-only", "workspace-write"]).has(sandbox)) {
      throw new Error(`sessions[${index}].sandbox must be read-only or workspace-write`);
    }
    const ownedPaths = session.ownedPaths ?? [];
    if (
      !Array.isArray(ownedPaths) ||
      ownedPaths.some(
        (path) => !isString(path) || path.trim().length === 0 || path.includes("\0") || /[\r\n]/.test(path),
      )
    ) {
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
  parseArgs,
  normalizeReasoningEffort,
  quickManifest,
  launchPolicy,
  absoluteExistingDirectory,
  absoluteExistingFile,
  normalizeManifest,
};
