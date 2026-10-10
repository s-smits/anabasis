/**
 * One check, run inside the verifier's sandbox. The host writes the check's input to this process's
 * stdin, and the process writes the check's answer to `result.json` in its working directory, the
 * check's cell. The answer goes to a file because a check may print what it likes.
 *
 * A tool the check runs starts here, in a directory of its own under the cell, so it runs inside the
 * same wall: the Seatbelt profile follows every child on Darwin, and the namespaces do on Linux. A
 * tool that is missing, never started its program, was ended by a signal or ran out its time leaves
 * the check deciding without its evidence, so the result is a non-result whatever the check returned.
 * A tool that ran and failed is evidence: the check reads its exit code and decides.
 */
import { mkdtempSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify, lockJsonGlobals, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isBoolean, isFunction, isNumber, isRecord, typeName } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { capturedSpawn, runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { killProcessGroupId, terminateAndReapProcessGroupId } from "../meta/subprocess.ts";
import type { EvaluationRequest } from "./verify.ts";

export interface CheckChildInput {
  /** The check program's absolute path. */
  readonly program: string;
  readonly checkId: string;
  /** What the program is asked for: a check's verdict, a boolean under `checks[checkId]`, or the
   *  objective's measure, a finite number from its `objective` export (`verify.ts`, `OBJECTIVE`). */
  readonly returns: "verdict" | "measure";
  /** The check's own projection of the answer and the task. */
  readonly request: EvaluationRequest;
  /** The tools the check declares; it may run no other. */
  readonly tools: readonly string[];
  /** The verifier tool tree's search directories, the only place a declared tool is looked up. */
  readonly toolPath: string;
  readonly toolCeilingMs: number;
}

/** `faulty`: the check itself failed on this request, which drops the task rather than stopping the run. */
export type CheckChildResult =
  | { readonly passed: boolean }
  | { readonly value: number }
  | { readonly nonResult: string }
  | { readonly faulty: string };

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
  readonly tools: { run(call: ToolCall): Promise<ToolRun> };
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

/** v1's `CheckFn` (src/correctness-bundle/correctness-model-contract.ts, 3f93d06b). The objective
 *  takes the same arguments and returns a number. */
type CheckFn = (
  request: EvaluationRequest & { runtime?: CheckRuntime },
  runtime?: CheckRuntime,
) => boolean | number | Promise<boolean | number>;

async function runTool(input: CheckChildInput, call: ToolCall, lapses: string[]): Promise<ToolRun> {
  const lapse = (kind: string, message: string): ToolRun => {
    lapses.push(message);
    return { nonResult: { kind, message }, exitCode: null, stdout: "", stderr: "" };
  };
  if (!input.tools.includes(call.toolId)) {
    throw new Error(`check ${input.checkId} ran ${call.toolId}, which it does not declare`);
  }
  // Only the tool tree is searched: the process's own PATH runs on into the host's toolchain, which
  // a tool's interpreter needs and the tool itself must not come from. A name with a slash in it is
  // never looked up, since `Bun.which` hands such a path back whatever the search path says.
  const command = isSafePathSegment(call.toolId) ? Bun.which(call.toolId, { PATH: input.toolPath }) : null;
  if (command === null) {
    return lapse("verifierUnavailable", `${call.toolId} is not on the verifier's tool path`);
  }
  const cell = mkdtempSync(join(runtimeProcess.cwd(), "tool-"));
  for (const [name, text] of Object.entries(call.files ?? {})) {
    if (!isSafePathSegment(name)) throw new Error(`check ${input.checkId} names a tool file ${name}`);
    writeFileSync(join(cell, name), text);
  }
  const child = capturedSpawn({
    cmd: [command, ...(call.args ?? [])],
    cwd: cell,
    detached: true,
    stdin: call.stdin === undefined ? "ignore" : new TextEncoder().encode(call.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeoutMs = Math.min(Math.max(1, call.timeoutMs ?? input.toolCeilingMs), input.toolCeilingMs);
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

/** v1's reading (`src/verify/host.ts`, 74b10d9) of a run whose program never started: a failing exit
 *  with nothing on stdout, and either a shell's 126 or 127 with its launch-failure line last on stderr
 *  or CPython's start-up failure, which a program that ran and raised never prints. */
function programNeverRan(exitCode: number, stdout: string, stderr: string): boolean {
  if (exitCode === 0 || stdout !== "") return false;
  const tail = stderr.trimEnd();
  if (PYTHON_START_FAILURE.test(tail)) return true;
  return SHELL_COULD_NOT_RUN.has(exitCode) && SHELL_LAUNCH_FAILURE.test(tail.split("\n").at(-1) ?? "");
}

/** The check's answer. A check that throws, returns no boolean or is missing is at fault itself; a
 *  program that does not load, or a tool that lapsed, leaves the verifier undecided. The objective
 *  is held the same way to a finite number. */
async function decide(input: CheckChildInput): Promise<CheckChildResult> {
  const lapses: string[] = [];
  const named = input.returns === "measure" ? "the objective" : "the check";
  let check: unknown;
  try {
    const program: unknown = await import(input.program);
    const exported = isRecord(program) ? program : {};
    check = input.returns === "measure" ? exported.objective : asRecord(exported.checks)?.[input.checkId];
  } catch (error) {
    return { nonResult: `the check program did not load: ${errorMessage(error)}` };
  }
  if (!isFunction(check)) {
    return {
      faulty: `the check program has no ${input.returns === "measure" ? "objective" : `check ${input.checkId}`}`,
    };
  }
  const runtime: CheckRuntime = { tools: { run: (call) => runTool(input, call, lapses) } };
  let returned: unknown;
  let threw: string | null = null;
  try {
    // As in v1, the port rides on the request too, so a check that destructures it from there
    // reaches the same tools as one that takes it as the second argument.
    // SAFETY: a check program exports each check as a CheckFn; what it returns is narrowed below.
    returned = await (check as CheckFn)({ ...input.request, runtime }, runtime);
  } catch (error) {
    threw = errorMessage(error);
  }
  if (lapses.length > 0) return { nonResult: lapses.join("; ") };
  if (threw !== null) return { faulty: `${named} threw: ${threw}` };
  if (input.returns === "measure") {
    return isNumber(returned) && Number.isFinite(returned)
      ? { value: returned }
      : { faulty: `the objective returned ${isNumber(returned) ? String(returned) : typeName(returned)}` };
  }
  return isBoolean(returned) ? { passed: returned } : { faulty: `the check returned ${typeName(returned)}` };
}

const input = parseJsonAs<CheckChildInput>(await Bun.stdin.text());
lockJsonGlobals();
writeFileSync("result.json", capturedJsonStringify(await decide(input)));
runtimeProcess.exit(0);
