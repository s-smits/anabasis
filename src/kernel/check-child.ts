/**
 * One check, run inside the verifier's sandbox. The host writes the check's input to this process's
 * stdin, and the process writes the check's answer to `result.json` in its working directory, the
 * check's cell. The answer goes to a file because a check may print what it likes.
 *
 * A tool the check runs starts here, in a directory of its own under the cell, so it runs inside the
 * same wall: the Seatbelt profile follows every child on Darwin, and the namespaces do on Linux. A
 * tool that could not start or ran out its time leaves the check deciding without its evidence, so
 * the result is a non-result whatever the check returned. A tool that ran and failed is evidence:
 * the check reads its exit code and decides.
 */
import { mkdtempSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify, lockJsonGlobals, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isBoolean, isFunction, isRecord, typeName } from "../meta/json-shape.ts";
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
  /** The check's own projection of the answer and the task. */
  readonly request: EvaluationRequest;
  /** The tools the check declares; it may run no other. */
  readonly tools: readonly string[];
  readonly toolCeilingMs: number;
}

export type CheckChildResult = { readonly passed: boolean } | { readonly nonResult: string };

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

/** v1's `CheckFn` (src/correctness-bundle/correctness-model-contract.ts, 3f93d06b). */
type CheckFn = (
  request: EvaluationRequest & { runtime?: CheckRuntime },
  runtime?: CheckRuntime,
) => boolean | Promise<boolean>;

async function runTool(input: CheckChildInput, call: ToolCall, lapses: string[]): Promise<ToolRun> {
  const lapse = (kind: string, message: string): ToolRun => {
    lapses.push(message);
    return { nonResult: { kind, message }, exitCode: null, stdout: "", stderr: "" };
  };
  if (!input.tools.includes(call.toolId)) {
    throw new Error(`check ${input.checkId} ran ${call.toolId}, which it does not declare`);
  }
  const command = Bun.which(call.toolId);
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
  return { nonResult: null, exitCode, stdout, stderr };
}

async function decide(input: CheckChildInput): Promise<CheckChildResult> {
  const lapses: string[] = [];
  try {
    const program: unknown = await import(input.program);
    const checks = isRecord(program) ? asRecord(program.checks) : null;
    const check: unknown = checks?.[input.checkId];
    if (!isFunction(check)) return { nonResult: `the check program has no check ${input.checkId}` };
    const runtime: CheckRuntime = { tools: { run: (call) => runTool(input, call, lapses) } };
    // As in v1, the port rides on the request too, so a check that destructures it from there
    // reaches the same tools as one that takes it as the second argument.
    // SAFETY: a check program exports each check as a CheckFn; what it returns is narrowed below.
    const passed: unknown = await (check as CheckFn)({ ...input.request, runtime }, runtime);
    if (lapses.length > 0) return { nonResult: lapses.join("; ") };
    return isBoolean(passed) ? { passed } : { nonResult: `the check returned ${typeName(passed)}` };
  } catch (error) {
    return { nonResult: `the check threw: ${errorMessage(error)}` };
  }
}

const input = parseJsonAs<CheckChildInput>(await Bun.stdin.text());
lockJsonGlobals();
writeFileSync("result.json", capturedJsonStringify(await decide(input)));
runtimeProcess.exit(0);
