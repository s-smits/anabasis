import { mkdtempSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify, lockJsonGlobals, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isBoolean, isFunction, isNumber, typeName } from "../meta/json-shape.ts";
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
  const folder = mkdtempSync(join(runtimeProcess.cwd(), "tool-"));
  for (const [name, text] of Object.entries(call.files ?? {})) {
    if (!isSafePathSegment(name)) throw new Error(`check ${port.check.checkId} names a tool file ${name}`);
    writeFileSync(join(folder, name), text);
  }
  if (call.timeoutMs !== undefined && !Number.isFinite(call.timeoutMs)) {
    throw new Error(`check ${port.check.checkId} passed a non-finite tool timeoutMs`);
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

function kindLabel(kind: RunKind, checkId: string): string {
  return kind === "objective" ? "the objective" : kind === "score" ? `score ${checkId}` : "the check";
}

async function decide(
  cell: CellInput,
  port: Port,
  found: unknown,
  kind: RunKind,
): Promise<CheckResult | Measure> {
  const named = kindLabel(kind, port.check.checkId);
  if (!isFunction(found)) {
    const missing =
      kind === "objective"
        ? "objective"
        : kind === "score"
          ? `score ${port.check.checkId}`
          : `check ${port.check.checkId}`;
    return { faulty: `the check program has no ${missing}` };
  }
  const runtime: CheckRuntime = { tools: { run: (call) => runTool(cell, port, call) } };
  let returned: unknown;
  let threw: string | null = null;
  try {
    markRunning(port);
    // SAFETY: a check program exports each check as a CheckFn; what it returns is narrowed below.
    returned = await (found as CheckFn)({ ...port.check.request, runtime }, runtime);
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
  if (kind === "score" || (kind === "objective" && cell.objectiveScale === "unit")) {
    return isNumber(returned) && Number.isFinite(returned) && returned >= 0 && returned <= 1
      ? { value: returned }
      : {
          faulty: `${named} returned ${isNumber(returned) ? String(returned) : typeName(returned)} (expected finite number in [0, 1])`,
        };
  }
  return isNumber(returned) && Number.isFinite(returned)
    ? { value: returned }
    : { faulty: `the objective returned ${isNumber(returned) ? String(returned) : typeName(returned)}` };
}

async function timed(
  cell: CellInput,
  check: CheckInput,
  found: unknown,
  kind: RunKind,
): Promise<CheckResult | Measure> {
  const marker = join(cell.running, `${String(++slots)}.run`);
  const port: Port = { check, marker, lapses: [], live: new Set() };
  const late = Promise.withResolvers<Undecided>();
  const named = kindLabel(kind, check.checkId);
  const timer = setTimeout(
    () => late.resolve({ faulty: `${named} timed out after ${cell.checkMs} ms` }),
    cell.checkMs,
  );
  try {
    return await Promise.race([decide(cell, port, found, kind), late.promise]);
  } finally {
    clearTimeout(timer);
    rmSync(marker, { force: true });
    for (const pid of port.live) killProcessGroupId(pid, "SIGKILL");
  }
}

const cell = parseJsonAs<CellInput>(await Bun.stdin.text());
lockJsonGlobals();
const { program, unloaded } = await import(cell.program).then(
  (module) => ({ program: asRecord(module), unloaded: null }),
  (error: unknown) => ({ program: null, unloaded: `the check program did not load: ${errorMessage(error)}` }),
);
const run = (check: CheckInput, kind: RunKind) => {
  if (unloaded !== null) return Promise.resolve({ nonResult: unloaded });
  const container =
    kind === "objective" ? program : asRecord(kind === "score" ? program?.scores : program?.checks);
  const key = kind === "objective" ? "objective" : check.checkId;
  const found: unknown = container !== null && Object.hasOwn(container, key) ? container[key] : undefined;
  return timed(cell, check, found, kind);
};

async function measureObjective(objective: CheckInput): Promise<Measure> {
  const items = cell.rubricItems;
  if (items === undefined || items.length === 0) {
    // SAFETY: `decide` gives a measure where `kind` is `"objective"`.
    return (await run(objective, "objective")) as Measure;
  }
  // SAFETY: `decide` gives a measure where `kind` is `"score"`.
  const ran = (await pooled(items, cell.width, (item) =>
    run({ ...objective, checkId: item.id }, "score"),
  )) as Measure[];
  const scores: Record<string, number> = {};
  for (const [index, item] of items.entries()) {
    const outcome = ran[index];
    if (outcome === undefined || !("value" in outcome)) {
      return outcome ?? { faulty: `missing score ${item.id}` };
    }
    scores[item.id] = outcome.value;
  }
  return { value: 0, scores };
}

// SAFETY: `decide` gives a check's answer where `kind` is `"check"`.
const results = (await pooled(cell.checks, cell.width, (check) => run(check, "check"))) as CheckResult[];
const valid = results.every((result) => "passed" in result && result.passed);
const measured = valid && cell.objective !== null ? await measureObjective(cell.objective) : null;
const written: CellResult = { results, measured };
writeFileSync("result.json", capturedJsonStringify(written));
runtimeProcess.exit(0);
