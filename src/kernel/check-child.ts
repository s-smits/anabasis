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
  /** The verifier tool tree's search directories, the only place a declared tool is looked up. */
  readonly toolPath: string;
  readonly toolCeilingMs: number;
}

/** `faulty`: the check itself failed on this request, which drops the task rather than stopping the run. */
export type CheckChildResult =
  | { readonly passed: boolean }
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
  return { nonResult: null, exitCode, stdout, stderr };
}

/** The check's answer. A check that throws, returns no boolean or is missing is at fault itself; a
 *  program that does not load, or a tool that lapsed, leaves the verifier undecided. */
async function decide(input: CheckChildInput): Promise<CheckChildResult> {
  const lapses: string[] = [];
  let check: unknown;
  try {
    const program: unknown = await import(input.program);
    check = isRecord(program) ? asRecord(program.checks)?.[input.checkId] : undefined;
  } catch (error) {
    return { nonResult: `the check program did not load: ${errorMessage(error)}` };
  }
  if (!isFunction(check)) return { faulty: `the check program has no check ${input.checkId}` };
  const runtime: CheckRuntime = { tools: { run: (call) => runTool(input, call, lapses) } };
  let passed: unknown;
  let threw: string | null = null;
  try {
    // As in v1, the port rides on the request too, so a check that destructures it from there
    // reaches the same tools as one that takes it as the second argument.
    // SAFETY: a check program exports each check as a CheckFn; what it returns is narrowed below.
    passed = await (check as CheckFn)({ ...input.request, runtime }, runtime);
  } catch (error) {
    threw = errorMessage(error);
  }
  if (lapses.length > 0) return { nonResult: lapses.join("; ") };
  if (threw !== null) return { faulty: `the check threw: ${threw}` };
  return isBoolean(passed) ? { passed } : { faulty: `the check returned ${typeName(passed)}` };
}

const input = parseJsonAs<CheckChildInput>(await Bun.stdin.text());
lockJsonGlobals();
writeFileSync("result.json", capturedJsonStringify(await decide(input)));
runtimeProcess.exit(0);
