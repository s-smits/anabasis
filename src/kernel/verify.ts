/**
 * The verifier: whether an answer passes a task's checks, decided on the verifier's own tree and
 * nowhere else. Answers are stored, so a verdict can be recomputed at any time.
 *
 * Every applicable check runs in a fresh cell, as its own process with only its declared projection
 * of the answer and the task, under the wall a seat's commands run under with the network closed. A
 * check's tools run in that same wall. No wall of the verifier's own is needed, as v1's was while
 * its Builder wrote the checks: here an answer is data and a check is the exam side's code
 * (`7f0add79:docs/simplify.md`, W6).
 *
 * The verdict is a pass, a fail naming the checks that refused the answer, faulty when a check
 * itself failed on the request (it threw, returned no boolean, or is missing), or a non-result when
 * the wall, a tool or the program's loading could not decide. No answer is a fail. A faulty check is
 * the task's defect and drops the task; a non-result is the verifier's and stops the run.
 * On 20 October triage found that the reader wall aborted the model loop while an executing probe
 * ignored it, and a detached check child could hold stderr open. The verifier now accepts the
 * reader's abort signal, races a check's result against it, reaps the check group and its cell's
 * holders, and returns a non-result.
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
import { asRecord, isBoolean, isNumber, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { capturedExecPath, capturedSpawn } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { pooled } from "../meta/pool.ts";
import { killProcessGroupId, terminateAndReapProcessGroupId } from "../meta/subprocess.ts";
import {
  commandIsolationPolicy,
  isolatedArgv,
  toolTreeSearchDirs,
} from "../verify/solve-command-isolation.ts";
import { releaseRoot } from "../verify/seat-root.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../verify/solve-sandbox.ts";
import { hostScratch } from "../verify/wall-policy.ts";
import type { CheckChildInput, CheckChildResult } from "./check-child.ts";
import type { Objective } from "./contract.ts";

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

/** The brief declares its checks and may declare an objective (`Objective`):
 *  the evaluator then exports `objective(request)`, a finite number of a valid answer, which the
 *  verifier measures after the checks pass (`OBJECTIVE`). An answer the checks refuse has none. */
export type Brief = { correctnessContract: string; truthChecks: BriefTruthCheck[]; objective?: Objective };

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
export interface VerifierTree {
  /** The check program's directory: `brief.json`, `evaluator.ts` and whatever they read. */
  readonly checks: string;
  /** The verifier's tool tree, the only place a check's tools are found. */
  readonly tools: string;
}

/** An engine of the field, as the verifier's tool tree holds it for a check: the name a check runs
 *  it by, the program the tree resolves the name to, and that program's sha256. */
export interface Engine {
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
}

/** What a check's wall closes beside the repository and the home, as a seat's does (`Walled`,
 *  `src/solve/command.ts`): the repository's other worktrees, and the stored pack's root and bundle,
 *  which hold every task's hidden values. */
interface Closed {
  readonly otherTrees?: readonly string[] | undefined;
  readonly packRoots?: readonly string[] | undefined;
}

export type Verdict =
  | { readonly kind: "pass"; readonly objective?: number }
  | { readonly kind: "fail"; readonly blocking: readonly string[] }
  | { readonly kind: "faulty"; readonly check: string; readonly reason: string }
  | { readonly kind: "non-result"; readonly reason: string };

/** Whether an answer passes a task's checks. No answer is a fail. */
export type Verifier = (task: Task, answer: JsonValue | undefined, signal?: AbortSignal) => Promise<Verdict>;

interface Wall {
  readonly tree: VerifierTree;
  /** The check program's files, as `checkProgramFiles` lists them. */
  readonly program: readonly string[];
  /** The tool tree's search directories, joined as a search path. */
  readonly toolPath: string;
  /** The base of every check's command wall, or why this host has none. */
  readonly base: SolveIsolationPolicy | { readonly unsupported: string };
}

/** The objective, run as a check is, in a cell of its own: the evaluator's `objective` export,
 *  given the whole answer and the whole public task and no hidden value, with no tool. It is the
 *  author's own computation, so `accept.ts` lists it as a fault until the operator admits it by
 *  name (rule 10). */
export const OBJECTIVE: BriefTruthCheck = {
  id: "objective",
  citedDecisionIds: [],
  execution: {
    families: "all",
    artifactPaths: ["$"],
    publicInputPaths: ["$"],
    hidden: "none",
    evidence: { kind: "authored" },
  },
};

/** The check process, which reads these sources from where they stand: the wall closes the
 *  repository they lie in and opens them again by path. */
const CHECK_CHILD = join(import.meta.dir, "check-child.ts");
const CHECK_CHILD_SOURCES = [import.meta.dir, resolve(import.meta.dir, "..", "meta")];
const REPO = resolve(import.meta.dir, "..", "..");

/** v1's ceiling on one tool run, `DEFAULT_TOOL_TIMEOUT_MS` in its src/verify/host.ts. */
const TOOL_CEILING_MS = 300_000;

/**
 * The cells a verdict runs at once. Each check's cell is its own walled process, and one after
 * another the 14 checks of an esp32 exam took 658 ms of a verdict on the operator's macOS host at a
 * load of 9 (22 October): 208 ms four at a time, 138 ms eight at a time, and no less fourteen at
 * a time. Four keeps what one verdict starts at once within the Linux runner's four cores, where
 * several solves are judged together.
 */
const CELLS = 4;

/** One check's whole run, its tools included. */
const CHECK_WALL_MS = 2 * TOOL_CEILING_MS;

/** A verdict in one line, a fail's checks in order, so that two verdicts can be set side by side. */
export function spelled(verdict: Verdict): string {
  if (verdict.kind === "fail") return `fail ${[...verdict.blocking].sort().join(",")}`;
  if (verdict.kind === "faulty") return `faulty ${verdict.check}: ${verdict.reason}`;
  if (verdict.kind === "pass") {
    return verdict.objective === undefined ? "pass" : `pass ${String(verdict.objective)}`;
  }
  return `non-result ${verdict.reason}`;
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

/**
 * The pinned list of a check program's engines: each program its checks name (`requiredToolsOf`),
 * resolved on the search path a check's cell is given (`runTool`, `check-child.ts`), in the order
 * the checks first name them, and named by its digest. The host reads it here, once, for every
 * side that is given the exam's instruments (the Examiner's shell, `src/examiner/shell.ts`). A
 * name the tree does not hold is the host's own and is left out, and a name that is no plain file
 * name is never looked up, as a check's cell never looks one up.
 */
export function pinnedEngines({ checks, tools }: VerifierTree): Engine[] {
  const path = toolTreeSearchDirs(tools).join(":");
  const named = readBrief(checks).truthChecks.flatMap(({ execution }) => requiredToolsOf(execution));
  return [...new Set(named)].flatMap((name) => {
    const found = isSafePathSegment(name) ? Bun.which(name, { PATH: path }) : null;
    return found === null ? [] : [{ name, path: found, sha256: sha256OfFile(found) }];
  });
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
 * order, each directory read in that order so a refusal names the same entry on every filesystem. A
 * program is plain files: a symlink, or anything else that is neither a file nor a
 * directory, is refused rather than followed, since a link would let the program's version and its
 * cell's copy read bytes from outside the directory the version names.
 */
export function checkProgramFiles(checks: string): string[] {
  const walk = (under: string): string[] =>
    readdirSync(join(checks, under), { withFileTypes: true })
      .toSorted((one, other) => compareCodeUnits(one.name, other.name))
      .flatMap((entry) => {
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
  const brief = parseJsonAs<Brief>(readFileSync(join(checks, "brief.json"), "utf8"));
  if (brief.truthChecks.some((check) => check.id === OBJECTIVE.id)) {
    throw new Error(`a check is named ${OBJECTIVE.id}, which names the objective`);
  }
  return brief;
}

/**
 * A verifier over one tree. The brief is read and the wall's base taken once, here, so every
 * verdict it gives is under the same checks and the same wall. The tree is resolved first: the wall
 * takes only absolute roots.
 */
export function openVerifier(given: VerifierTree & Closed): Verifier {
  const tree: VerifierTree = { checks: resolve(given.checks), tools: resolve(given.tools) };
  const brief = readBrief(tree.checks);
  const wall: Wall = {
    tree,
    program: checkProgramFiles(tree.checks),
    toolPath: toolTreeSearchDirs(tree.tools).join(":"),
    base: solveIsolationPolicy({
      repoRoot: REPO,
      otherTrees: given.otherTrees ?? [],
      packRoots: given.packRoots ?? [],
      readAllowRoots: CHECK_CHILD_SOURCES,
      network: false,
    }),
  };
  return async (task, answer, signal) => {
    if (answer === undefined) return { kind: "fail", blocking: [] };
    if (signal?.aborted === true) return { kind: "non-result", reason: "the verifier was cancelled" };
    const blocking: string[] = [];
    const request = { publicTask: task, artifact: answer, hidden: task.hidden };
    // Every check runs, and the first that cannot decide or is faulty, in the brief's order,
    // decides the verdict, as it did when they ran one at a time.
    const ran = await pooled(applicableTruthChecks(brief, task), CELLS, async (check) => ({
      check,
      result: await runCheck(wall, check, request, signal),
    }));
    for (const { check, result } of ran) {
      if ("nonResult" in result) return { kind: "non-result", reason: `${check.id}: ${result.nonResult}` };
      if ("faulty" in result) return { kind: "faulty", check: check.id, reason: result.faulty };
      if ("value" in result) {
        return { kind: "faulty", check: check.id, reason: "the check returned a number" };
      }
      if (!result.passed) blocking.push(check.id);
    }
    if (blocking.length > 0) return { kind: "fail", blocking };
    if (brief.objective === undefined) return { kind: "pass" };
    // The objective is read of a valid answer only, in a cell of its own like a check.
    const measured = await runCheck(wall, OBJECTIVE, request, signal);
    if ("nonResult" in measured) {
      return { kind: "non-result", reason: `${OBJECTIVE.id}: ${measured.nonResult}` };
    }
    if ("faulty" in measured) return { kind: "faulty", check: OBJECTIVE.id, reason: measured.faulty };
    if (!("value" in measured)) {
      return { kind: "faulty", check: OBJECTIVE.id, reason: "the objective returned a boolean" };
    }
    return { kind: "pass", objective: measured.value };
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
  signal?: AbortSignal,
): Promise<CheckChildResult> {
  const { base } = wall;
  if (signal?.aborted === true) return { nonResult: "the verifier was cancelled" };
  if ("unsupported" in base) return { nonResult: `this host cannot wall a check: ${base.unsupported}` };
  // The cell is a seat of its own: one root the check writes, the program in the host's folder in
  // it, which the check reads and cannot write, and the profile beside the root, out of its reach.
  // The root lies in the host's own scratch, which the wall closes whole but for the cell it runs.
  const root = hostScratch("cell-");
  const dirs = {
    root,
    home: join(root, "home"),
    temp: join(root, "tmp"),
    kept: join(root, "kept"),
    host: `${root}.host`,
  };
  let child: Bun.Subprocess | null = null;
  let captured: Promise<{
    readonly kind: "finished";
    readonly stderr: string;
    readonly exitCode: number;
  }> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: (() => void) | null = null;
  try {
    for (const dir of [dirs.home, dirs.temp, dirs.host]) mkdirSync(dir, { recursive: true });
    // The program goes below the host's folder, so no file of it can stand as the check's
    // `result.json`.
    const copy = join(dirs.kept, "program");
    for (const file of wall.program) {
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      copyFileSync(join(wall.tree.checks, file), join(copy, file));
    }
    const input: CheckChildInput = {
      program: join(copy, EVALUATOR_FILE),
      checkId: check.id,
      returns: check === OBJECTIVE ? "measure" : "verdict",
      request: checkEvaluationRequest(check, request),
      tools: requiredToolsOf(check.execution),
      toolPath: wall.toolPath,
      toolCeilingMs: TOOL_CEILING_MS,
    };
    const policy = commandIsolationPolicy(base, { ...dirs, toolTree: wall.tree.tools });
    // The wall a seat's command takes, without its shell: the check child leads its own group, and
    // the group is ended below.
    const process = capturedSpawn({
      cmd: isolatedArgv(policy, join(dirs.host, "check.sb"), [capturedExecPath, CHECK_CHILD]),
      cwd: root,
      env: policy.environment,
      detached: true,
      stdin: new TextEncoder().encode(capturedJsonStringify(input)),
      stdout: "ignore",
      stderr: "pipe",
    });
    child = process;
    const stopped = Promise.withResolvers<"deadline" | "cancelled">();
    let stopReason: "deadline" | "cancelled" | null = null;
    const stop = (reason: "deadline" | "cancelled") => {
      if (stopReason !== null) return;
      stopReason = reason;
      killProcessGroupId(process.pid, "SIGKILL");
      stopped.resolve(reason);
    };
    timer = setTimeout(() => stop("deadline"), CHECK_WALL_MS);
    abort = () => stop("cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    captured = Promise.all([new Response(process.stderr).text(), process.exited]).then(
      ([stderr, exitCode]) => ({ kind: "finished" as const, stderr, exitCode }),
    );
    const outcome = await Promise.race([
      captured,
      stopped.promise.then((reason) => ({ kind: "stopped" as const, reason })),
    ]);
    if (outcome.kind === "stopped") {
      return {
        nonResult:
          outcome.reason === "deadline"
            ? `the check ran past ${CHECK_WALL_MS} ms`
            : "the verifier was cancelled",
      };
    }
    // End work left in the check's group before reading its result. The root's release below
    // also ends detached holders, whose process group is their own.
    await terminateAndReapProcessGroupId(process.pid);
    return (
      writtenResult(join(root, "result.json")) ?? {
        nonResult: `the check exited ${outcome.exitCode} without a result: ${outcome.stderr.slice(-2000).trim()}`,
      }
    );
  } catch (error) {
    return { nonResult: `the verifier could not run the check: ${errorMessage(error)}` };
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (signal !== undefined && abort !== null) signal.removeEventListener("abort", abort);
    if (child !== null) await terminateAndReapProcessGroupId(child.pid);
    releaseRoot(root);
    if (captured !== null) await captured.catch(() => undefined);
    rmSync(dirs.host, { recursive: true, force: true });
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
  if (isNumber(result?.value) && Number.isFinite(result.value)) return { value: result.value };
  if (isString(result?.nonResult)) return { nonResult: result.nonResult };
  if (isString(result?.faulty)) return { faulty: result.faulty };
  return null;
}
