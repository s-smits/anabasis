/**
 * One verdict's checks, run inside the verifier's wall. The host writes the verdict's input to this
 * process's stdin, and the process writes each check's answer, in the order given, and the
 * objective's where every check passed, to `result.json` in its working directory, the verdict's
 * cell. The answers go to a file because a check may print what it likes.
 */
import { mkdtempSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify, lockJsonGlobals, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isBoolean, isFunction, isNumber, typeName } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { pooled } from "../meta/pool.ts";
import { capturedSpawn, runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { killProcessGroupId, terminateAndReapProcessGroupId } from "../meta/subprocess.ts";
import type { EvaluationRequest } from "./verify.ts";

/** One check, or the objective, as the cell runs it. */
export interface CheckInput {
  readonly checkId: string;
  /** The check's own projection of the answer and the task. */
  readonly request: EvaluationRequest;
  /** The tools the check declares; it may run no other. */
  readonly tools: readonly string[];
}

export interface CellInput {
  /** The check program's absolute path. */
  readonly program: string;
  /** The verifier tool tree's search directories, the only place a declared tool is looked up. */
  readonly toolPath: string;
  readonly toolCeilingMs: number;
  /** One check's time, its tools included. */
  readonly checkMs: number;
  /** The checks run at once. */
  readonly width: number;
  readonly checks: readonly CheckInput[];
  /** The objective, measured once every check has passed; null where the brief declares none. */
  readonly objective: CheckInput | null;
  /** Directory where each running check keeps its own marker file (`<slot>.run`), removed on finish,
   *  so concurrent checks do not overwrite each other and a cell timeout blames a still-running check. */
  readonly running: string;
}

/** `faulty`: the check itself failed on this answer, which drops the task rather than stopping the
 *  run. `nonResult`: the verifier could not decide, which stops it. */
type Undecided = { readonly nonResult: string } | { readonly faulty: string };
export type CheckResult = { readonly passed: boolean } | Undecided;
export type Measure = { readonly value: number } | Undecided;

export interface CellResult {
  readonly results: readonly CheckResult[];
  readonly measured: Measure | null;
}

/** A tool run as a check asks for it. A file name is one path segment in the run's directory. */
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

/** v1's `CheckFn` (src/correctness-bundle/correctness-model-contract.ts, 3f93d06b). The objective
 *  takes the same arguments and returns a number. */
type CheckFn = (
  request: EvaluationRequest & { runtime?: CheckRuntime },
  runtime?: CheckRuntime,
) => boolean | number | Promise<boolean | number>;

/** What one check's tools leave behind: the lapses that make its answer a non-result, and the
 *  process groups still running, ended when its time is out. */
interface Port {
  readonly check: CheckInput;
  readonly marker: string;
  readonly lapses: string[];
  readonly live: Set<number>;
}

/** The shell's own exit codes for a program it could not execute (126) or could not find (127). */
const SHELL_COULD_NOT_RUN = new Set<number>([126, 127]);
/** The shell's own launch-failure line, as bash (`w: line 2: p: cannot execute: …`), dash
 *  (`w: 2: p: not found`), zsh (`w:2: permission denied: p`) and `env` (`env: p: No such file or
 *  directory`) print it. A program may exit 126 or 127 itself; only this line says a shell did. */
const SHELL_LAUNCH_FAILURE =
  /^(?:.*?: (?:line )?\d+: |.*?:\d+: |env: ).*(?:cannot execute|command not found|not found|[Pp]ermission denied|Operation not permitted|No such file or directory|bad interpreter)/;
/** CPython's own line for an interpreter that died initialising itself, before the program's first
 *  line ran (`init_fs_encoding: ...` for a home whose stdlib it cannot read); it then exits 1. */
const PYTHON_START_FAILURE = /^Fatal Python error: init/m;

let seq = 0;
let slots = 0;

/** Record that `port.check` currently holds the cell's thread under a monotonic sequence number. */
const markRunning = (port: Port): void =>
  writeFileSync(port.marker, `${String(++seq)}\n${port.check.checkId}`);

/** v1's reading (`74b10d9:src/verify/host.ts`) of a run whose program never started: a failing exit
 *  with nothing on stdout, and either a shell's 126 or 127 with its launch-failure line last on stderr
 *  or CPython's start-up failure, which a program that ran and raised never prints. */
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
  // Only the tool tree is searched: the process's own PATH runs on into the host's toolchain, which
  // a tool's interpreter needs and the tool itself must not come from. A name with a slash in it is
  // never looked up, since `Bun.which` hands such a path back whatever the search path says.
  const command = isSafePathSegment(call.toolId) ? Bun.which(call.toolId, { PATH: cell.toolPath }) : null;
  if (command === null) {
    return lapse("verifierUnavailable", `${call.toolId} is not on the verifier's tool path`);
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
  const timeoutMs = Math.min(Math.max(1, call.timeoutMs ?? cell.toolCeilingMs), cell.toolCeilingMs);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcessGroupId(child.pid, "SIGKILL");
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  // What the tool left running must not outlive its directory.
  await terminateAndReapProcessGroupId(child.pid);
  port.live.delete(child.pid);
  // The check resumes here, so it is the one that holds the thread now (`running`).
  markRunning(port);
  if (timedOut) return lapse("timeout", `${call.toolId} ran past ${timeoutMs} ms`);
  // A signal the host did not send is no answer either; Bun reports it as the signal, not 128 + n.
  if (child.signalCode !== null) return lapse("crash", `${call.toolId} was ended by ${child.signalCode}`);
  if (programNeverRan(exitCode, stdout, stderr)) {
    return lapse(
      "protocol",
      `${call.toolId} exited ${exitCode} before its program ran: ${stderr.slice(-500)}`,
    );
  }
  return { nonResult: null, exitCode, stdout, stderr };
}

/** A check's answer, or the objective's measure, from `found`, what the program exports under its
 *  name. A check that throws, returns no boolean or is missing is at fault itself; a tool that
 *  lapsed leaves the verifier undecided. The objective is held the same way to a finite number. */
async function decide(
  cell: CellInput,
  port: Port,
  found: unknown,
  kind: "check" | "objective",
): Promise<CheckResult | Measure> {
  const measure = kind === "objective";
  const named = measure ? "the objective" : "the check";
  if (!isFunction(found)) {
    return { faulty: `the check program has no ${measure ? "objective" : `check ${port.check.checkId}`}` };
  }
  const runtime: CheckRuntime = { tools: { run: (call) => runTool(cell, port, call) } };
  let returned: unknown;
  let threw: string | null = null;
  try {
    markRunning(port);
    // As in v1, the port rides on the request too, so a check that destructures it from there
    // reaches the same tools as one that takes it as the second argument.
    // SAFETY: a check program exports each check as a CheckFn; what it returns is narrowed below.
    returned = await (found as CheckFn)({ ...port.check.request, runtime }, runtime);
  } catch (error) {
    threw = errorMessage(error);
  } finally {
    rmSync(port.marker, { force: true });
  }
  if (port.lapses.length > 0) return { nonResult: port.lapses.join("; ") };
  if (threw !== null) return { faulty: `${named} threw: ${threw}` };
  if (!measure) {
    return isBoolean(returned)
      ? { passed: returned }
      : { faulty: `the check returned ${typeName(returned)}` };
  }
  return isNumber(returned) && Number.isFinite(returned)
    ? { value: returned }
    : { faulty: `the objective returned ${isNumber(returned) ? String(returned) : typeName(returned)}` };
}

/** One check under its own time; past it the check is at fault and the tools it left are ended. */
async function timed(
  cell: CellInput,
  check: CheckInput,
  found: unknown,
  kind: "check" | "objective",
): Promise<CheckResult | Measure> {
  const marker = join(cell.running, `${String(++slots)}.run`);
  const port: Port = { check, marker, lapses: [], live: new Set() };
  const late = Promise.withResolvers<Undecided>();
  const named = kind === "objective" ? "the objective" : "the check";
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
const run = (check: CheckInput, kind: "check" | "objective") => {
  if (unloaded !== null) return Promise.resolve({ nonResult: unloaded });
  const found = kind === "objective" ? program?.objective : asRecord(program?.checks)?.[check.checkId];
  return timed(cell, check, found, kind);
};
// SAFETY: `decide` gives a check's answer where `kind` is `"check"`.
const results = (await pooled(cell.checks, cell.width, (check) => run(check, "check"))) as CheckResult[];
const valid = results.every((result) => "passed" in result && result.passed);
// SAFETY: `decide` gives a measure where `kind` is `"objective"`.
const measured =
  valid && cell.objective !== null ? ((await run(cell.objective, "objective")) as Measure) : null;
const written: CellResult = { results, measured };
writeFileSync("result.json", capturedJsonStringify(written));
runtimeProcess.exit(0);
