/**
 * Every `claude` process Harness² starts on JobBench, and the reader of what one wrote: the rollout
 * (`harness2/benchmarks/jb_claude_runner.py` with `ClaudeCodeSubstrate.exec_argv` and `exec_env`),
 * the improver session (`Proposer._claude_cli` and `call` in `harness2/core/proposer.py`) and the
 * stream-json renderer a later session reads a rollout through (`render_events`, `summarize`), all
 * Apache-2.0, Google LLC, at 1cfe254 with the fork's Claude Code commits.
 *
 * Local changes: a rollout reports what it billed (the sum of each attempt's `total_cost_usd`),
 * which Harness² never reads back; the runner's outer wall (twice the timeout plus ten minutes)
 * is left out, since each attempt already has its own; no session is served from the audit cache,
 * so every call is a fresh draw; and a timed-out session's whole process group is ended.
 */
import { errorMessage } from "#src/meta/runtime-values.ts";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { killProcessGroupId, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { sha256 } from "#src/meta/digest.ts";
import { pyDumps, pyLen, pySlice, pyStr, pyStrip, splitLines, truthy, walkFiles } from "./py.ts";
import { installTree } from "./tree.ts";

/** What a `claude` process is started with, from the pilot's `h2l1.sh` and `config.py`. */
export interface Claude {
  readonly bin: string;
  readonly model: string;
  readonly effort: string;
  readonly budgetUsd: string;
  readonly timeoutS: number;
  readonly env: Readonly<Record<string, string>>;
}

/** Where one rollout reads its task and leaves its output, under the run store. */
export interface RolloutPlace {
  readonly store: string;
  readonly task: string;
  readonly label: string;
}

/** What one improver session returned (`Reply`). */
export interface Reply {
  readonly text: string;
  readonly costUsd: number;
  readonly attempts: number;
  readonly workspace: string | null;
}

/** The improver's reasoning effort (`_channels`, `effort="high"`). */
const IMPROVER_EFFORT = "high";
/** `config.SCRUB_ENV` less the auth names an improver keeps (`_CLAUDE_AUTH_ENV`). */
const IMPROVER_SCRUB = new Set([
  "HARNESS2_JUDGE_API_KEY",
  "HARNESS2_BRIDGE_KEY",
  "HARNESS2_CODEX_API_KEY",
  "HARNESS2_WB_CLAUDE_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_WEBHOOK_URL",
  "JIRA_API_TOKEN",
]);
/** Set when Harness² itself runs inside Claude Code; a child CLI must not inherit them. */
const NESTED = new Set(["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"]);
const TASK_FOLDER = "task_folder";
const OBS_TRUNC = 50_000;
const MAX_CHARS = 8_000_000;
const ARGS_TRUNC = 2000;
const ROLLOUT_ATTEMPTS = 2;
const GRACE_MS = 30_000;
/** The prompt every JobBench rollout reads (`jb_opencode_runner.PROMPT`), verbatim. */
const ROLLOUT_PROMPT = `=== TASK FOLDER ===
{task_folder}

=== INSTRUCTIONS ===
1. Read the TASK_INSTRUCTIONS.txt file in the task folder above
2. Based on the Reference Files section in TASK_INSTRUCTIONS.txt, read the corresponding files from the same task folder using appropriate tools.
3. Complete the task as specified in TASK_INSTRUCTIONS.txt
4. Only save the final deliverables to the output directory specified below. Do not save any intermediate or temporary files.

=== OUTPUT DIRECTORY ===
{output_dir}

IMPORTANT:
- All reference files are in the task folder: {task_folder}
- Only save the final deliverables to the output directory {output_dir}. Do not save any intermediate or temporary files.
- You MUST only access files within {workspace} or search online for new reference files if you find needed. Do NOT access any files or directories in this system outside of this path.
- If you encounter ambiguous or conflicting information, analyze the conflict, explain your reasoning, and justify the approach you choose.
- If a file cannot be read directly (e.g., .xlsx, .docx, .db, .pptx), use appropriate tools, MCP servers, or code to extract and process its contents.`;

function truncated(chars: number): string {
  return `…(+${chars} chars — render truncation)`;
}

function clip(value: JsonValue | undefined, limit: number): string {
  const text = (value === undefined || value === null ? "" : pyStr(value)).replaceAll("\0", "");
  const length = pyLen(text);
  return limit <= 0 || length <= limit ? text : pySlice(text, 0, limit) + truncated(length - limit);
}

/** `len(x or [])` for the counts the init line prints. */
function count(value: JsonValue | undefined): number {
  if (!truthy(value)) return 0;
  if (Array.isArray(value)) return value.length;
  return isRecord(value) ? Object.keys(value).length : pyLen(pyStr(value));
}

function resultText(content: JsonValue | undefined): string {
  if (isString(content)) return content;
  if (!Array.isArray(content)) {
    return content === undefined || content === null ? "" : pyDumps(content, { ascii: "raw" });
  }
  return content
    .flatMap((block) => {
      if (isString(block)) return [block];
      if (!isRecord(block)) return [];
      if (block.type === "text") return [truthy(block.text) ? pyStr(block.text) : ""];
      return block.type === "image" ? ["(image)"] : [];
    })
    .join("\n");
}

function toolArgs(name: string, input: JsonValue | undefined): string {
  if (isRecord(input)) {
    if (name === "Bash" && isString(input.command)) return input.command;
    if (Object.keys(input).every((key) => key === "file_path") && isString(input.file_path)) {
      return input.file_path;
    }
  }
  return input === undefined || input === null ? "" : pyDumps(input, { ascii: "raw" });
}

/** `parse_events`: every JSON line with a string `type`, junk lines tolerated. */
export function parseEvents(path: string): JsonObject[] {
  const events: JsonObject[] = [];
  for (const raw of splitLines(readFileSync(path, "utf8").replaceAll("\0", ""))) {
    const line = pyStrip(raw);
    if (!line.startsWith("{")) continue;
    try {
      const event = capturedJsonParse(line);
      if (isRecord(event) && isString(event.type)) events.push(event);
    } catch {
      // A line that is not JSON is junk in Python too.
    }
  }
  return events;
}

function texts(value: JsonValue | undefined): string {
  return truthy(value) ? pyStr(value) : "";
}

function systemLine(event: JsonObject): string | null {
  if (event.subtype === "init") {
    return `[HARNESS] session init | model=${pyStr(event.model)} | skills=${count(event.skills)} agents=${count(event.agents)}`;
  }
  if (event.subtype === "compact_boundary") return "[HARNESS] context compacted";
  if (event.subtype !== "hook_response") return null;
  const out = [event.output, event.stdout, event.stderr].find((value) => truthy(value)) ?? "";
  const name = [event.hook_name, event.hook_event].find((value) => truthy(value)) ?? "";
  const tail = pyStrip(pyStr(out)) === "" ? "" : `: ${clip(out, OBS_TRUNC)}`;
  return `[HARNESS] hook ${pyStr(name)} exit=${pyStr(event.exit_code)}${tail}`;
}

function blockLines(event: JsonObject, sub: string): string[] {
  const message = isRecord(event.message) ? event.message : {};
  const content = message.content;
  if (event.type === "user" && isString(content)) {
    return pyStrip(content) === "" ? [] : [`${sub}[USER] ${clip(content, OBS_TRUNC)}`];
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): string[] => {
    if (!isRecord(block)) return [];
    if (event.type === "assistant") {
      if (block.type === "text" && pyStrip(texts(block.text)) !== "") {
        return [`${sub}[ASSISTANT] ${clip(block.text, OBS_TRUNC)}`];
      }
      if (block.type === "thinking" && pyStrip(texts(block.thinking)) !== "") {
        return [`${sub}[THINKING] ${clip(block.thinking, OBS_TRUNC)}`];
      }
      if (block.type !== "tool_use") return [];
      const name = texts(block.name) || "tool";
      return [`${sub}[ACTION] ${name}(${clip(toolArgs(name, block.input), ARGS_TRUNC)})`];
    }
    if (block.type === "tool_result") {
      return [
        `${sub}[${truthy(block.is_error) ? "OBSERVATION ERROR" : "OBSERVATION"}] ${clip(resultText(block.content), OBS_TRUNC)}`,
      ];
    }
    return block.type === "text" && pyStrip(texts(block.text)) !== ""
      ? [`${sub}[USER] ${clip(block.text, OBS_TRUNC)}`]
      : [];
  });
}

function resultLines(event: JsonObject): string[] {
  const usage = isRecord(event.usage) ? event.usage : {};
  const line = `[HARNESS] session ${pyStr(event.subtype)} | turns=${pyStr(event.num_turns)} cost_usd=${pyStr(event.total_cost_usd)} | tokens in=${pyStr(usage.input_tokens)} cache_read=${pyStr(usage.cache_read_input_tokens)} cache_write=${pyStr(usage.cache_creation_input_tokens)} out=${pyStr(usage.output_tokens)}`;
  if (!truthy(event.is_error)) return [line];
  return [line, `[ERROR] ${clip(truthy(event.result) ? event.result : event.subtype, 1000)}`];
}

/** `render_events`: a stream as the tagged lines a later session reads. */
export function renderEvents(path: string): string {
  let events: JsonObject[];
  try {
    events = parseEvents(path);
  } catch (error) {
    return `(failed to read trajectory: ${errorMessage(error)})`;
  }
  const lines = events.flatMap((event): string[] => {
    const sub = truthy(event.parent_tool_use_id) ? "[SUBAGENT] " : "";
    if (event.type === "system") return [systemLine(event) ?? []].flat();
    if (event.type === "assistant" || event.type === "user") return blockLines(event, sub);
    return event.type === "result" ? resultLines(event) : [];
  });
  const rendered = pyStrip(lines.join("\n"));
  if (rendered === "") return "(no parseable events in trajectory)";
  const length = pyLen(rendered);
  return length > MAX_CHARS
    ? `${pySlice(rendered, 0, MAX_CHARS)}\n${truncated(length - MAX_CHARS)}`
    : rendered;
}

/** The parts of `summarize` the runner's log line and the bill read. */
export function summarize(path: string): { turns: number; subtype: string; tools: number; costUsd: number } {
  let events: JsonObject[];
  try {
    events = parseEvents(path);
  } catch {
    events = [];
  }
  let tools = 0;
  let result: JsonObject = {};
  for (const event of events) {
    const message = isRecord(event.message) ? event.message : {};
    if (event.type === "assistant" && Array.isArray(message.content)) {
      tools += message.content.filter((block) => isRecord(block) && block.type === "tool_use").length;
    } else if (event.type === "result") result = event;
  }
  return {
    turns: isNumber(result.num_turns) ? Math.trunc(result.num_turns) : 0,
    subtype: pyStr(result.subtype),
    tools,
    costUsd: isNumber(result.total_cost_usd) ? result.total_cost_usd : 0,
  };
}

/** Whether a child ended within `ms`, waking each second so that no long timer outlives it. */
async function exitedWithin(child: Bun.Subprocess, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await Promise.race([child.exited, Bun.sleep(Math.min(1000, deadline - Date.now()))]);
  }
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * `run_in_group`: one process in a group of its own; on timeout TERM the group, wait out the
 * grace, KILL what is left, and report 124 as timeout(1) does.
 */
export async function inGroup(
  argv: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    stdin?: string;
    stdout: string;
    stderr: string;
    timeoutS: number;
  },
): Promise<number> {
  const child = capturedSpawn([...argv], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: Bun.file(options.stdout),
    stderr: Bun.file(options.stderr),
  });
  if (await exitedWithin(child, options.timeoutS * 1000)) return await child.exited;
  killProcessGroupId(child.pid, "SIGTERM");
  if (!(await exitedWithin(child, GRACE_MS))) await terminateAndReapProcessGroupId(child.pid);
  await child.exited;
  return 124;
}

function nonEmpty(dir: string): boolean {
  return existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length > 0;
}

function stamp(at: Date, form: "file" | "clock"): string {
  const two = (value: number): string => String(value).padStart(2, "0");
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
  if (form === "clock") return clock;
  return `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}_${clock.replaceAll(":", "")}`;
}

/**
 * `run_one` behind `execute`: stage the workspace, run `claude -p` up to twice (a second time only
 * when the first left no deliverable and did not spend its budget), and move what it produced to
 * `model_output/<label>`. Returns the dollars billed; the output directory may be left empty.
 */
export async function rollout(place: RolloutPlace, treeDir: string, claude: Claude): Promise<number> {
  const taskDir = join(place.store, place.task, TASK_FOLDER);
  const name = place.task.replaceAll("/", "_");
  const finalDir = join(place.store, place.task, "model_output", place.label);
  const trajDir = join(place.store, place.task, "model_traj", place.label);
  const logFile = join(
    place.store,
    ".harness2-logs",
    `hevo_${name}_${place.label}_${stamp(new Date(), "file")}.log`,
  );
  mkdirSync(join(place.store, ".harness2-logs"), { recursive: true });
  const log = (line: string): void => appendFileSync(logFile, `${line}\n`);
  mkdirSync(trajDir, { recursive: true });
  const staged = mkdtempSync(join(tmpdir(), "adapt-cc-root-"));
  const workspace = join(tmpdir(), "hevo_ws_cc", `${name}_${place.label}_${runtimeProcess.pid}`);
  const output = join(workspace, "output");
  let billed = 0;
  try {
    installTree(treeDir, staged);
    rmSync(workspace, { recursive: true, force: true });
    for (let attempt = 1; attempt <= ROLLOUT_ATTEMPTS; attempt += 1) {
      rmSync(join(workspace, TASK_FOLDER), { recursive: true, force: true });
      rmSync(output, { recursive: true, force: true });
      mkdirSync(output, { recursive: true });
      cpSync(taskDir, join(workspace, TASK_FOLDER), { recursive: true });
      if (attempt === 1) {
        for (const part of ["CLAUDE.md", ".claude", "scripts"].filter((each) =>
          existsSync(join(staged, each)),
        )) {
          cpSync(join(staged, part), join(workspace, part), { recursive: true });
        }
      }
      const traj = join(
        trajDir,
        `${name}_${place.label}_attempt${attempt}_${stamp(new Date(), "file")}.jsonl`,
      );
      log(`[${stamp(new Date(), "clock")}] run ${place.task} (${place.label}) attempt ${attempt} -> ${traj}`);
      const prompt = ROLLOUT_PROMPT.replaceAll("{task_folder}", join(workspace, TASK_FOLDER))
        .replaceAll("{output_dir}", output)
        .replaceAll("{workspace}", workspace);
      const argv = [
        claude.bin,
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-hook-events",
        "--dangerously-skip-permissions",
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--add-dir",
        workspace,
      ];
      if (claude.model !== "") argv.push("--model", claude.model);
      if (claude.effort !== "") argv.push("--effort", claude.effort);
      if (claude.budgetUsd !== "") argv.push("--max-budget-usd", claude.budgetUsd);
      const code = await inGroup(argv, {
        cwd: workspace,
        env: {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          DISABLE_AUTOUPDATER: "1",
          ...Object.fromEntries(Object.entries(claude.env).filter(([key]) => !NESTED.has(key))),
        },
        stdout: traj,
        stderr: `${logFile}.stderr`,
        timeoutS: claude.timeoutS,
      });
      if (existsSync(`${logFile}.stderr`)) {
        appendFileSync(logFile, readFileSync(`${logFile}.stderr`));
        rmSync(`${logFile}.stderr`);
      }
      const seen = summarize(traj);
      billed += seen.costUsd;
      log(
        `[${stamp(new Date(), "clock")}] attempt ${attempt}: rc=${code} result=${seen.subtype} turns=${seen.turns} tools=${seen.tools} cost_usd=${seen.costUsd.toFixed(4)}`,
      );
      if (nonEmpty(output)) break;
      if (seen.subtype.startsWith("error_max_budget")) {
        log(`[${stamp(new Date(), "clock")}] BUDGET SPENT ${place.task}; not retrying`);
        break;
      }
      if (code === 124) log(`[${stamp(new Date(), "clock")}] TIMEOUT ${place.task} attempt ${attempt}`);
    }
    if (nonEmpty(output)) {
      mkdirSync(finalDir, { recursive: true });
      for (const item of readdirSync(output)
        .toSorted()
        .filter((entry) => !entry.startsWith("."))) {
        renameSync(join(output, item), join(finalDir, item));
      }
      log(`[${stamp(new Date(), "clock")}] output -> ${finalDir}`);
    } else log(`[${stamp(new Date(), "clock")}] NO OUTPUT for ${place.task} (${place.label})`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  }
  return billed;
}

/** A session that gave no usable reply after its transport attempts (`ProposerError`). */
export class ProposerError extends Error {
  readonly attempts: number;
  readonly costUsd: number;

  constructor(message: string, attempts: number, costUsd: number) {
    super(message);
    this.attempts = attempts;
    this.costUsd = costUsd;
    this.name = "ProposerError";
  }
}

/** `_parse_json`: the CLI's one JSON object, tolerating banners and trailing noise around it. */
function parsePayload(stdout: string): JsonObject {
  const text = pyStrip(stdout);
  if (text === "") return {};
  const tries = [
    text,
    ...splitLines(text)
      .toReversed()
      .map((line) => pyStrip(line))
      .filter((line) => line.startsWith("{") && line.endsWith("}")),
  ];
  const [first, last] = [text.indexOf("{"), text.lastIndexOf("}")];
  if (first >= 0 && first < last) tries.push(text.slice(first, last + 1));
  for (const candidate of tries) {
    try {
      const payload = capturedJsonParse(candidate);
      return isRecord(payload) ? payload : { result: text };
    } catch {
      // Python tries the next reading too.
    }
  }
  return { result: text };
}

/** `_call_fingerprint`: the audit name's key, over the label, the mission, the evidence's real path
 *  and its bytes, each part closed by a NUL, so a call's audit files carry Harness²'s own name. */
export function callKey(label: string, mission: string, contextDir: string): string {
  const parts: (string | Uint8Array)[] = [label, mission, "", realpathSync(contextDir)];
  for (const rel of walkFiles(contextDir, ["__pycache__"])) {
    parts.push(rel, readFileSync(join(contextDir, rel)));
  }
  return sha256(Buffer.concat(parts.flatMap((part) => [Buffer.from(part), Buffer.from([0])]))).slice(0, 16);
}

/** One improver session in a fresh copy of `contextDir`, with up to `tries` transport attempts. */
export async function improve(
  call: { mission: string; contextDir: string; label: string; harvest: string | null; tries: number },
  claude: Claude,
  auditDir: string,
): Promise<Reply> {
  const safe = `${call.label.replaceAll(/[^A-Za-z0-9_.-]+/gu, "_")}.${callKey(call.label, call.mission, call.contextDir)}`;
  const started = Date.now();
  let spent = 0;
  let last = "";
  mkdirSync(auditDir, { recursive: true });
  const audit = (text: string, meta: { ok: boolean; attempts: number; error: string }): void => {
    writeFileSync(join(auditDir, `${safe}.mission.md`), call.mission);
    writeFileSync(join(auditDir, `${safe}.response.md`), text);
    const wall = Math.round((Date.now() - started) / 100) / 10;
    const record = {
      label: call.label,
      ok: meta.ok,
      channel: "claude_cli",
      model: claude.model,
      effort: IMPROVER_EFFORT,
      attempts: meta.attempts,
      wall_s: wall,
      cost_usd: spent,
      error: meta.error,
    };
    writeFileSync(join(auditDir, `${safe}.meta.json`), pyDumps(record, { indent: 2 }));
  };
  for (let attempt = 1; attempt <= call.tries; attempt += 1) {
    if (attempt > 1) await Bun.sleep(10_000 * (attempt - 1));
    const tmp = mkdtempSync(join(tmpdir(), "harness2-prop-"));
    try {
      if (existsSync(call.contextDir)) cpSync(call.contextDir, join(tmp, "context"), { recursive: true });
      const argv = [
        claude.bin,
        "--dangerously-skip-permissions",
        "-p",
        "--output-format",
        "json",
        "--model",
        claude.model,
        "--effort",
        IMPROVER_EFFORT,
        "--setting-sources",
        "project",
        "--settings",
        pyDumps({ claudeMdExcludes: ["**/context/**"] }),
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--no-session-persistence",
      ];
      const kept = Object.entries(claude.env).filter(([key]) => !NESTED.has(key) && !IMPROVER_SCRUB.has(key));
      const env = { ...Object.fromEntries(kept), ANTHROPIC_MODEL: claude.model };
      const [stdout, stderr] = [join(tmp, ".stdout"), join(tmp, ".stderr")];
      const code = await inGroup(argv, {
        cwd: tmp,
        env,
        stdin: call.mission,
        stdout,
        stderr,
        timeoutS: claude.timeoutS,
      });
      if (code === 124) {
        last = `timeout after ${claude.timeoutS}s`;
        continue;
      }
      const payload = parsePayload(readFileSync(stdout, "utf8"));
      let text = pyStr(truthy(payload.result) ? payload.result : truthy(payload.text) ? payload.text : "");
      let error = "";
      if (
        truthy(payload.is_error) ||
        !(payload.subtype === undefined || payload.subtype === null || payload.subtype === "success")
      ) {
        error = `CLI error: ${pyStr(payload.subtype)} ${pySlice(text, 0, 200)}`;
        text = "";
      } else if (code !== 0 && pyStrip(text) === "") {
        error = `rc=${code}: ${pySlice(readFileSync(stderr, "utf8"), -300)}`;
      }
      spent += isNumber(payload.total_cost_usd) ? payload.total_cost_usd : 0;
      if (pyStrip(text) === "") {
        last = error || "empty reply";
        continue;
      }
      let workspace: string | null = null;
      if (call.harvest !== null && existsSync(join(tmp, call.harvest))) {
        workspace = join(auditDir, `${safe}.workspace`);
        rmSync(workspace, { recursive: true, force: true });
        cpSync(join(tmp, call.harvest), workspace, { recursive: true });
      }
      audit(text, { ok: true, attempts: attempt, error: "" });
      return { text, costUsd: spent, attempts: attempt, workspace };
    } catch (error) {
      last = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  audit("", { ok: false, attempts: call.tries, error: last });
  throw new ProposerError(`[${call.label}] claude_cli/${claude.model}: ${last}`, call.tries, spent);
}
