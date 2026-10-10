/**
 * The verifier: whether an answer passes a task's checks, decided on the verifier's own tree and
 * nowhere else. Answers are stored, so a verdict can be recomputed at any time.
 *
 * Every applicable check runs in a fresh cell inside the OS wall copied from v1, offline, as its own
 * process with only its declared projection of the answer and the task. A check's tools run in that
 * same wall. The verdict is a pass, a fail naming the checks that refused the answer, faulty when a
 * check itself failed on the request (it threw, returned no boolean, or is missing), or a non-result
 * when the wall, a tool or the program's loading could not decide. No answer is a fail. A faulty
 * check is the task's defect and drops the task; a non-result is the verifier's and stops the run.
 *
 * The contract is v1's check-program/v1, the format of the experiment's stored answers: a
 * `brief.json` declaring the checks and an `evaluator.ts` exporting them as `checks`. A check
 * program is its whole directory, nested directories included, and each check's cell gets a copy:
 * both check programs v1 wrote on 7 October import `./reference/model.ts`, which a copy of
 * `evaluator.ts` alone left behind. The hidden values are the task's, not the program's, so they
 * reach a check only as its request carries them; a directory that keeps them, as a v1 bundle's
 * `tasks.json` does, hands every task's to every check, and the caller leaves such files out.
 *
 * A check's tools resolve only from the verifier's tool tree. The condition pins that tree's digest,
 * and a tool missing from it once ran the host's copy off the search path's later directories.
 */
import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "../meta/filesystem.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { jsonPathTokens } from "../meta/json-evidence.ts";
import {
  capturedJsonParse,
  capturedJsonStringify,
  capturedStructuredClone,
  parseJsonAs,
} from "../meta/json-runtime.ts";
import { asRecord, isBoolean, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { tmpdir } from "../meta/os.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { killProcessGroupId, terminateAndReapProcessGroupId } from "../meta/subprocess.ts";
import { engineCellEnv } from "../verify/engine-cell-env.ts";
import { type VerifierOsIsolation, verifierOsIsolation } from "../verify/os-isolation.ts";
import { toolTreeSearchDirs } from "../verify/solve-command-isolation.ts";
import { type FrozenToolchainAccess, frozenToolchainAccess } from "../verify/wall-policy.ts";
import type { CheckChildInput, CheckChildResult } from "./check-child.ts";

// Copied from v1 (github.com/s-smits/anabasis, 3f93d06b), verbatim: CHECK_PROGRAM_CONTRACT,
// requiredToolsOf, applicableTruthChecks, projectPaths, projectJsonPaths and checkPublicInputs from
// vendor/correctness-model-bundle/evaluation-public-task.ts, and checkEvaluationRequest from
// vendor/correctness-model-bundle/evaluate.ts. Departure: the five types they read are declared
// here, cut to the fields those functions and the shape gate read, in place of v1's brief, contract
// and task-split modules, which did not come over.

type CheckExecution = {
  families: "all" | string[];
  artifactPaths: string[];
  publicInputPaths: string[];
  hidden: "none" | "required";
  requiredToolIds?: [string, ...string[]];
  evidence: { kind: "authored" } | { kind: "external"; requiredToolIds: [string, ...string[]] };
};

type BriefTruthCheck = { id: string; citedDecisionIds: string[]; execution: CheckExecution };

export type Brief = { correctnessContract: string; truthChecks: BriefTruthCheck[] };

interface PublicTask<PublicInput> {
  taskId: string;
  family: string;
  publicInput: PublicInput;
}

export interface EvaluationRequest {
  publicTask: PublicTask<unknown>;
  artifact: unknown;
  hidden: unknown;
}

export const CHECK_PROGRAM_CONTRACT = "check-program/v1";

/** A task as its pack stores it: the public part the solver read, and the hidden part only checks
 *  that declare it receive. */
export type Task = PublicTask<JsonValue> & { readonly hidden: JsonValue };

/** The verifier's side of a contract: the checks, and the tools only they run. */
interface VerifierTree {
  /** The check program's directory: `brief.json`, `evaluator.ts` and whatever they read. */
  readonly checks: string;
  /** The verifier's tool tree, the only place a check's tools are found. */
  readonly tools: string;
}

export type Verdict =
  | { readonly kind: "pass" }
  | { readonly kind: "fail"; readonly blocking: readonly string[] }
  | { readonly kind: "faulty"; readonly check: string; readonly reason: string }
  | { readonly kind: "non-result"; readonly reason: string };

/** Whether an answer passes a task's checks. No answer is a fail. */
export type Verifier = (task: Task, answer: JsonValue | undefined) => Promise<Verdict>;

interface Wall {
  readonly tree: VerifierTree;
  /** The check program's files, as `checkProgramFiles` lists them. */
  readonly program: readonly string[];
  /** The tool tree's search directories, joined as a search path. */
  readonly toolPath: string;
  readonly access: FrozenToolchainAccess;
  readonly isolation: VerifierOsIsolation;
  readonly readRoots: string[];
}

/** The check process, which reads these sources from where they stand. */
const CHECK_CHILD = join(import.meta.dir, "check-child.ts");
const CHECK_CHILD_SOURCES = [import.meta.dir, resolve(import.meta.dir, "..", "meta")];

/** v1's ceiling on one tool run, `DEFAULT_TOOL_TIMEOUT_MS` in its src/verify/host.ts. */
const TOOL_CEILING_MS = 300_000;

/** One check's whole run, its tools included. */
const CHECK_WALL_MS = 2 * TOOL_CEILING_MS;

/** A verdict in one line, a fail's checks in order, so that two verdicts can be set side by side. */
export function spelled(verdict: Verdict): string {
  if (verdict.kind === "fail") return `fail ${[...verdict.blocking].sort().join(",")}`;
  if (verdict.kind === "faulty") return `faulty ${verdict.check}: ${verdict.reason}`;
  return verdict.kind === "pass" ? "pass" : `non-result ${verdict.reason}`;
}

/** An external check names its tools inside its evidence declaration, because the tool is the
 *  instrument deciding it; an authored check names them at the execution level, where they are
 *  ordinary dependencies. Callers that only need to know what has to be installed and hashed ask
 *  here rather than branching on the kind themselves. */
export function requiredToolsOf(execution: CheckExecution): readonly string[] {
  return execution.evidence.kind === "external"
    ? execution.evidence.requiredToolIds
    : (execution.requiredToolIds ?? []);
}

/** Declared family scope decides applicability, and nothing else does. In particular the hidden
 *  operand is not consulted here: a check that declares `hidden: "required"` and has no expectation
 *  for the task is still applicable, and `checkEvaluationRequest` throws when it comes to run it.
 *  The two outcomes have to stay distinguishable, because a check quietly dropped for want of its
 *  operand looks exactly like a check that was never meant to apply, and only one is a defect. */
export function applicableTruthChecks(brief: Brief, task: { family: string }): BriefTruthCheck[] {
  if (brief.correctnessContract !== CHECK_PROGRAM_CONTRACT) {
    throw new Error("unsupported-correctness-contract");
  }
  return brief.truthChecks.filter(
    (check) => check.execution.families === "all" || check.execution.families.includes(task.family),
  );
}

/**
 * Rebuild a value carrying only the declared paths. A declared path grants the value at that path,
 * whole: `$.system` hands over its subtree, which is what a collection predicate naming a root
 * already means. Declaring a parent therefore grants its whole subtree.
 *
 * Two grants are wider than "the declared leaf" and belong to the contract. An array keeps its
 * length, with undeclared positions as null, so an index rule and a cardinality rule both still
 * work: declaring one element reveals its array's length. Absent is distinguishable
 * from present-and-null only where some rule declared the path.
 *
 * Traversal follows the source, so key order is the task's own and the bytes are stable under brief
 * reordering. `Object.fromEntries` defines rather than assigns, so a model-authored `__proto__` key
 * lands as an own property instead of reaching a prototype.
 */
function projectPaths(value: JsonValue, paths: readonly string[][]): JsonValue {
  if (paths.some((path) => path.length === 0)) return value;
  const below = (key: string) => paths.flatMap((path) => (path[0] === key ? [path.slice(1)] : []));
  if (Array.isArray(value)) {
    return value.map((child, index) => {
      const selected = below(`[${index}]`);
      return selected.length === 0 ? null : projectPaths(child, selected);
    });
  }
  if (!isRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const selected = below(`.${key}`);
      return selected.length === 0 ? [] : [[key, projectPaths(child, selected)]];
    }),
  );
}

function projectJsonPaths(value: JsonValue, paths: readonly string[]): JsonValue {
  const parsed = paths.map((path) => {
    const segments = jsonPathTokens(path);
    if (segments === null) throw new Error(`invalid declared JSON path: ${path}`);
    return segments;
  });
  return projectPaths(value, parsed);
}

/** One projection per check, and the check process and its private tool cell both eat it. That is
 *  what keeps the declared paths a wall rather than a note: `evaluate.ts` builds the tool-input
 *  leaves from this same value, so bytes a check may hand an installed tool are bytes it was
 *  already allowed to read, and a wider tool operand cannot be reached around the projection. */
export function checkPublicInputs(
  check: BriefTruthCheck,
  request: Pick<EvaluationRequest, "artifact" | "publicTask">,
): Pick<EvaluationRequest, "artifact" | "publicTask"> {
  return {
    artifact: projectJsonPaths(
      /* SAFETY: accepted artifact bytes are parsed JSON. */ request.artifact as JsonValue,
      check.execution.artifactPaths,
    ),
    publicTask: {
      taskId: request.publicTask.taskId,
      family: request.publicTask.family,
      publicInput: projectJsonPaths(
        /* SAFETY: the committed public task is parsed JSON. */ request.publicTask.publicInput as JsonValue,
        check.execution.publicInputPaths,
      ),
    },
  };
}

/** Each fresh child receives only its declared inputs and its own check's hidden value, which is
 *  what makes the declared paths a contract rather than documentation: a check able to read a path
 *  it never declared, or another check's expectation, would be deciding on evidence no coverage row
 *  records it as using. A check that declares `hidden: "required"` and finds no expectation of its
 *  own throws here rather than running, because a check quietly deciding without its operand is
 *  indistinguishable from a check that was never applicable, and only one of those is a defect. */
export function checkEvaluationRequest(
  check: BriefTruthCheck,
  request: EvaluationRequest,
): EvaluationRequest {
  const hidden =
    check.execution.hidden === "none"
      ? []
      : Array.isArray(request.hidden)
        ? request.hidden.filter((row: unknown) => isRecord(row) && row.checkId === check.id)
        : [];
  if (
    check.execution.hidden === "required" &&
    (hidden.length !== 1 || !isRecord(hidden[0]) || !Object.hasOwn(hidden[0], "expectation"))
  ) {
    throw new Error("check-hidden-operand-missing: " + check.id);
  }
  return capturedStructuredClone({
    ...checkPublicInputs(check, request),
    hidden,
  });
}

/**
 * A check program's files by their path under its directory, nested directories walked, in code-unit
 * order. A program is plain files: a symlink, or anything else that is neither a file nor a
 * directory, is refused rather than followed, since a link would let the program's version and its
 * cell's copy read bytes from outside the directory the version names.
 */
export function checkProgramFiles(checks: string): string[] {
  const walk = (under: string): string[] =>
    readdirSync(join(checks, under), { withFileTypes: true }).flatMap((entry) => {
      const path = under === "" ? entry.name : `${under}/${entry.name}`;
      if (entry.isDirectory()) return walk(path);
      if (entry.isFile()) return [path];
      throw new Error(`the check program's ${path} is neither a file nor a directory`);
    });
  return walk("").sort(compareCodeUnits);
}

/** A check program's version: the sha256 of each of its files, by its path under the directory.
 *  Every file counts, since the verifier copies them all into each check's cell. */
export function checkProgramVersion(checks: string): Record<string, string> {
  return Object.fromEntries(
    checkProgramFiles(checks).map((file) => [file, sha256OfFile(join(checks, file))]),
  );
}

/** A check program's declaration of its checks, as its author wrote it. */
export function readBrief(checks: string): Brief {
  return parseJsonAs<Brief>(readFileSync(join(checks, "brief.json"), "utf8"));
}

/**
 * A verifier over one tree. The brief is read and the toolchain roots frozen once, here, so every
 * verdict it gives is under the same checks and the same wall. The tree is resolved first: the wall
 * takes only absolute roots.
 */
export function openVerifier(given: VerifierTree): Verifier {
  const tree: VerifierTree = { checks: resolve(given.checks), tools: resolve(given.tools) };
  const brief = readBrief(tree.checks);
  const access = frozenToolchainAccess(Bun.env.HOME);
  const wall: Wall = {
    tree,
    program: checkProgramFiles(tree.checks),
    toolPath: toolTreeSearchDirs(tree.tools).join(":"),
    access,
    isolation: verifierOsIsolation({}),
    readRoots: [...new Set([tree.tools, ...CHECK_CHILD_SOURCES, ...access.installRoots])].sort(
      compareCodeUnits,
    ),
  };
  return async (task, answer) => {
    if (answer === undefined) return { kind: "fail", blocking: [] };
    const blocking: string[] = [];
    for (const check of applicableTruthChecks(brief, task)) {
      const result = await runCheck(wall, check, { publicTask: task, artifact: answer, hidden: task.hidden });
      if ("nonResult" in result) return { kind: "non-result", reason: `${check.id}: ${result.nonResult}` };
      if ("faulty" in result) return { kind: "faulty", check: check.id, reason: result.faulty };
      if (!result.passed) blocking.push(check.id);
    }
    return blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
  };
}

/**
 * A verdict that decides, for the host to act on. A non-result stops the run instead: it comes from
 * the verifier, never the task, and a non-result is never counted, so a run on a broken verifier, one
 * that returns one for every check, would count nothing and look clean.
 */
export async function decided(verify: Verifier, task: Task, answer: JsonValue | undefined) {
  const verdict = await verify(task, answer);
  if (verdict.kind === "non-result") {
    throw new Error(`the verifier could not decide ${task.taskId}, so the run stops: ${verdict.reason}`);
  }
  return verdict;
}

async function runCheck(
  wall: Wall,
  check: BriefTruthCheck,
  request: EvaluationRequest,
): Promise<CheckChildResult> {
  // The wall leaves the user temporary directory open to toolchains and closes the product's own
  // trees in it by prefix, so a concurrent check's cell is shut only under this one.
  const cell = mkdtempSync(join(tmpdir(), "ana-cell-"));
  try {
    // The program goes below the cell, so no file of it can stand as the check's `result.json`.
    const copy = join(cell, "program");
    for (const file of wall.program) {
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      copyFileSync(join(wall.tree.checks, file), join(copy, file));
    }
    const input: CheckChildInput = {
      program: join(copy, EVALUATOR_FILE),
      checkId: check.id,
      request: checkEvaluationRequest(check, request),
      tools: requiredToolsOf(check.execution),
      toolPath: wall.toolPath,
      toolCeilingMs: TOOL_CEILING_MS,
    };
    const env = engineCellEnv({
      toolchainEnv: wall.access.environment,
      toolTree: wall.tree.tools,
      workdir: cell,
      requireOsSandbox: true,
    });
    const plan = wall.isolation.prepare({
      workdir: cell,
      resolvedCommand: capturedExecPath,
      engineArgs: [CHECK_CHILD],
      attestedFiles: [],
      sandboxReadRoots: wall.readRoots,
      environment: env,
    });
    if ("unsupported" in plan) return { nonResult: `${wall.isolation.requires}: ${plan.unsupported}` };
    const applied = await plan.apply();
    if (!applied.ok) return { nonResult: `${wall.isolation.requires}: ${applied.reason}` };
    const before = plan.verify();
    if (before !== null) {
      return { nonResult: `the wall ${before.kind} before the check ran: ${before.detail}` };
    }
    const child = capturedSpawn({
      cmd: [plan.command, ...plan.args],
      cwd: cell,
      env,
      detached: true,
      stdin: new TextEncoder().encode(capturedJsonStringify(input)),
      stdout: "ignore",
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroupId(child.pid, "SIGKILL");
    }, CHECK_WALL_MS);
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    // A tool the check left running must not outlive the cell it writes to.
    await terminateAndReapProcessGroupId(child.pid);
    if (timedOut) return { nonResult: `the check ran past ${CHECK_WALL_MS} ms` };
    const after = plan.verify();
    if (after !== null) return { nonResult: `the wall ${after.kind} while the check ran: ${after.detail}` };
    return (
      writtenResult(join(cell, "result.json")) ?? {
        nonResult: `the check exited ${exitCode} without a result: ${stderr.slice(-2000).trim()}`,
      }
    );
  } catch (error) {
    return { nonResult: `the verifier could not run the check: ${errorMessage(error)}` };
  } finally {
    rmSync(cell, { recursive: true, force: true });
  }
}

/** The check process's answer, or null when it wrote none that reads as one. */
function writtenResult(path: string): CheckChildResult | null {
  if (!existsSync(path)) return null;
  let written: JsonValue;
  try {
    written = capturedJsonParse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const result = asRecord(written);
  if (isBoolean(result?.passed)) return { passed: result.passed };
  if (isString(result?.nonResult)) return { nonResult: result.nonResult };
  if (isString(result?.faulty)) return { faulty: result.faulty };
  return null;
}
