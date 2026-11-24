import { mkdtempSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify, lockJsonGlobals, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isBoolean, isFunction, isNumber, typeName, unitScore } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { pooled } from "../meta/pool.ts";
import { capturedSpawn, runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { killProcessGroupId, terminateAndReapProcessGroupId } from "../meta/subprocess.ts";
import type { RubricItem } from "./contract.ts";
import type { EvaluationRequest } from "./verify.ts";

export interface CheckInput {
  readonly checkId: string;
  readonly request: EvaluationRequest;
  readonly tools: readonly string[];
}

export interface CellInput {
  readonly program: string;
  readonly tools: Readonly<Record<string, string>>;
  readonly toolCeilingMs: number;
  readonly checkMs: number;
  readonly width: number;
  readonly checks: readonly CheckInput[];
  readonly objective: CheckInput | null;
  readonly objectiveScale?: "unit";
  readonly rubricItems?: readonly RubricItem[];
  readonly running: string;
}

type Undecided = { readonly nonResult: string } | { readonly faulty: string };
type RunKind = "check" | "objective" | "score";
export type CheckResult = { readonly passed: boolean } | Undecided;
type Measure = { readonly value: number; readonly scores?: Readonly<Record<string, number>> } | Undecided;

export interface CellResult {
  readonly results: readonly CheckResult[];
  readonly measured: Measure | null;
}

interface ToolCall {
  readonly toolId: string;
  readonly args?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
}

interface ToolRun {
  readonly nonResult: { readonly kind: string; readonly message: string } | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface CheckRuntime {
  readonly tools: { run: (call: ToolCall) => Promise<ToolRun> };
}

type CheckFn = (
  request: EvaluationRequest & { runtime?: CheckRuntime },
  runtime?: CheckRuntime,
) => boolean | number | Promise<boolean | number>;

interface Port {
  readonly check: CheckInput;
  readonly marker: string;
  readonly lapses: string[];
  readonly live: Set<number>;
}

const SHELL_COULD_NOT_RUN = new Set<number>([126, 127]);
const SHELL_LAUNCH_FAILURE =
  /^(?:.*?: (?:line )?\d+: |.*?:\d+: |env: ).*(?:cannot execute|command not found|not found|[Pp]ermission denied|Operation not permitted|No such file or directory|bad interpreter)/;
const PYTHON_START_FAILURE = /^Fatal Python error: init/m;

let seq = 0;
let slots = 0;

const markRunning = (port: Port): void =>
  writeFileSync(port.marker, `${String(++seq)}\n${port.check.checkId}`);

function deepFreeze(value: unknown): void {
  if (Array.isArray(value)) {
    Object.freeze(value);
    for (const item of value) deepFreeze(item);
    return;
  }
  const rec = asRecord(value);
  if (rec === null) return;
  Object.freeze(rec);
  for (const child of Object.values(rec)) deepFreeze(child);
}

function programNeverRan(exitCode: number, stdout: string, stderr: string): boolean {
  if (exitCode === 0 || stdout !== "") return false;
  const tail = stderr.trimEnd();
  if (PYTHON_START_FAILURE.test(tail)) return true;
  return SHELL_COULD_NOT_RUN.has(exitCode) && SHELL_LAUNCH_FAILURE.test(tail.split("\n").at(-1) ?? "");
}

async function runTool(cell: CellInput, port: Port, call: ToolCall): Promise<ToolRun> {
  const lapse = (kind: string, message: string): ToolRun => {
    port.lapses.push(message);
    return { nonResult: { kind, message }, exitCode: null, stdout: "", stderr: "" };
  };
  if (!port.check.tools.includes(call.toolId)) {
    throw new Error(`check ${port.check.checkId} ran ${call.toolId}, which it does not declare`);
  }
  const command = isSafePathSegment(call.toolId) ? (cell.tools[call.toolId] ?? null) : null;
  if (command === null) {
    return lapse("verifierUnavailable", `${call.toolId} is not on the verifier's tool path`);
  }
  if (call.timeoutMs !== undefined && !Number.isFinite(call.timeoutMs)) {
    throw new Error(`check ${port.check.checkId} passed a non-finite tool timeoutMs`);
  }
  const folder = mkdtempSync(join(runtimeProcess.cwd(), "tool-"));
  for (const [name, text] of Object.entries(call.files ?? {})) {
    if (!isSafePathSegment(name)) throw new Error(`check ${port.check.checkId} names a tool file ${name}`);
    writeFileSync(join(folder, name), text);
  }
  const child = capturedSpawn({
    cmd: [command, ...(call.args ?? [])],
    cwd: folder,
    detached: true,
    stdin: call.stdin === undefined ? "ignore" : new TextEncoder().encode(call.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  port.live.add(child.pid);
  const timeoutMs =
    call.timeoutMs === undefined ? null : Math.min(Math.max(1, call.timeoutMs), cell.toolCeilingMs);
  let timedOut = false;
  const timer =
    timeoutMs === null
      ? null
      : setTimeout(() => {
          timedOut = true;
          killProcessGroupId(child.pid, "SIGKILL");
        }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (timer !== null) clearTimeout(timer);
  await terminateAndReapProcessGroupId(child.pid);
  port.live.delete(child.pid);
  markRunning(port);
  if (timedOut) return lapse("timeout", `${call.toolId} ran past ${String(timeoutMs)} ms`);
  if (child.signalCode !== null) return lapse("crash", `${call.toolId} was ended by ${child.signalCode}`);
  if (programNeverRan(exitCode, stdout, stderr)) {
    return lapse(
      "protocol",
      `${call.toolId} exited ${exitCode} before its program ran: ${stderr.slice(-500)}`,
    );
  }
  return { nonResult: null, exitCode, stdout, stderr };
}

async function runTarget(
  cell: CellInput,
  program: ReturnType<typeof asRecord>,
  check: CheckInput,
  kind: RunKind,
): Promise<CheckResult | Measure> {
  const named =
    kind === "objective" ? "the objective" : kind === "score" ? `score ${check.checkId}` : "the check";
  const container =
    kind === "objective" ? program : asRecord(kind === "score" ? program?.scores : program?.checks);
  const key = kind === "objective" ? "objective" : check.checkId;
  const found: unknown = container !== null && Object.hasOwn(container, key) ? container[key] : undefined;
  if (!isFunction(found)) {
    return {
      faulty:
        kind === "score"
          ? `score ${check.checkId} is missing from the check program`
          : `the check program has no ${kind === "objective" ? "objective" : `check ${check.checkId}`}`,
    };
  }
  const marker = join(cell.running, `${String(++slots)}.run`);
  const port: Port = { check, marker, lapses: [], live: new Set() };
  const late = Promise.withResolvers<Undecided>();
  const timer = setTimeout(
    () => late.resolve({ faulty: `${named} timed out after ${cell.checkMs} ms` }),
    cell.checkMs,
  );
  const execute = async (): Promise<CheckResult | Measure> => {
    const runtime: CheckRuntime = { tools: { run: (call) => runTool(cell, port, call) } };
    let returned: unknown;
    let threw: string | null = null;
    try {
      markRunning(port);
      // SAFETY: a check program exports each target as a CheckFn; its return value is narrowed below.
      returned = await (found as CheckFn)({ ...check.request, runtime }, runtime);
    } catch (error) {
      threw = errorMessage(error);
    } finally {
      rmSync(port.marker, { force: true });
    }
    if (port.lapses.length > 0) return { nonResult: port.lapses.join("; ") };
    if (threw !== null) return { faulty: `${named} threw: ${threw}` };
    if (kind === "check") {
      return isBoolean(returned)
        ? { passed: returned }
        : { faulty: `the check returned ${typeName(returned)}` };
    }
    const unit = kind === "score" || cell.objectiveScale === "unit";
    if (isNumber(returned) && Number.isFinite(returned)) {
      const value = unit ? unitScore(returned) : returned === 0 ? 0 : returned;
      if (value !== null) return { value };
    }
    return {
      faulty: `${named} returned ${isNumber(returned) ? String(returned) : typeName(returned)}${unit ? " (expected finite number in [0, 1])" : ""}`,
    };
  };
  try {
    return await Promise.race([execute(), late.promise]);
  } finally {
    clearTimeout(timer);
    rmSync(marker, { force: true });
    for (const pid of port.live) killProcessGroupId(pid, "SIGKILL");
  }
}

const cell = parseJsonAs<CellInput>(await Bun.stdin.text());
lockJsonGlobals();
for (const check of cell.checks) deepFreeze(check.request);
if (cell.objective !== null) deepFreeze(cell.objective.request);

const { program, unloaded } = await import(cell.program).then(
  (module) => ({ program: asRecord(module), unloaded: null }),
  (error: unknown) => ({ program: null, unloaded: `the check program did not load: ${errorMessage(error)}` }),
);
const invoke = (check: CheckInput, kind: RunKind) =>
  unloaded === null ? runTarget(cell, program, check, kind) : Promise.resolve({ nonResult: unloaded });

// SAFETY: `invoke` returns `CheckResult` when `kind` is `"check"`.
const results = (await pooled(cell.checks, cell.width, (check) => invoke(check, "check"))) as CheckResult[];
const valid = results.every((result) => "passed" in result && result.passed);

let measured: Measure | null = null;
if (valid && cell.objective !== null) {
  const items = cell.rubricItems;
  if (items !== undefined && items.length > 0) {
    const objective = cell.objective;
    // SAFETY: `invoke` returns `Measure` when `kind` is `"score"`.
    const ran = (await pooled(items, cell.width, (item) =>
      invoke({ ...objective, checkId: item.id }, "score"),
    )) as Measure[];
    const scores: Record<string, number> = {};
    let failed: Measure | null = null;
    for (const [index, item] of items.entries()) {
      const outcome = ran[index];
      if (outcome === undefined || !("value" in outcome)) {
        failed = outcome ?? { faulty: `score ${item.id} produced no result` };
        break;
      }
      scores[item.id] = outcome.value;
    }
    measured = failed ?? { value: 0, scores };
  } else {
    // SAFETY: `invoke` returns `Measure` when `kind` is `"objective"`.
    measured = (await invoke(cell.objective, "objective")) as Measure;
  }
}

const written: CellResult = { results, measured };
writeFileSync("result.json", capturedJsonStringify(written));
runtimeProcess.exit(0);
