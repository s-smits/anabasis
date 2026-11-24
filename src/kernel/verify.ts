/**
 * The verifier: whether an answer passes a task's checks, decided on the verifier's own tree and
 * nowhere else. Answers are stored, so a verdict can be recomputed at any time.
 */
import { CHECK_BRIEF, EVALUATOR_FILE } from "../meta/bundle-layout.ts";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "../meta/filesystem.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { jsonPathTokens } from "../meta/json-evidence.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isBoolean, isNumber, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { capturedExecPath, capturedSpawn } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { killProcessGroupId, terminateAndReapProcessGroupId } from "../meta/subprocess.ts";
import { containsPath } from "../meta/path-containment.ts";
import { commandIsolationPolicy, isolatedArgv, toolTreeSearchDirs } from "../wall/isolation.ts";
import { hostFolder, releaseRoot } from "../wall/seat-root.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../wall/base.ts";
import { closedHome, hostScratch, toolchainPathDirs } from "../wall/policy.ts";
import type { CellInput, CellResult, CheckInput, CheckResult } from "./check-child.ts";
import type { Objective } from "./contract.ts";
import type { AnswerFile } from "./answer-files.ts";
import { keyIfDefined } from "../meta/optional-key.ts";

// Core check-projection primitives adapted from v1 (`evaluation-public-task.ts`, `evaluate.ts`),
// omitting `structuredClone` because `runCell` serialises projections synchronously to child stdin.

interface CheckExecution {
  families: "all" | string[];
  artifactPaths: string[];
  publicInputPaths: string[];
  /** Relative deliverable paths, or `$` for all files. Omitted grants no files. */
  filePaths?: string[];
  /** `whole`: the task's hidden values as their author wrote them, the form a drafted exam's
   *  checks are told they read (`src/examiner/draft.ts`), rather than `required`, whose rows by
   *  check id no draft writes, and which stopped every such draft on `check-hidden-operand-missing`
   *  before any check ran. */
  hidden: "none" | "required" | "whole";
  requiredToolIds?: [string, ...string[]];
  evidence: { kind: "authored" } | { kind: "external"; requiredToolIds: [string, ...string[]] };
}

interface BriefTruthCheck {
  id: string;
  citedDecisionIds: string[];
  execution: CheckExecution;
}

/** The brief declares its checks and may declare an objective (`Objective`):
 *  the evaluator then exports `objective(request)`, a finite number of a valid answer, which the
 *  verifier measures after the checks pass (`OBJECTIVE`). An answer the checks refuse has none. */
export interface Brief {
  correctnessContract: string;
  truthChecks: BriefTruthCheck[];
  objective?: Objective;
  /** External engines declared for `objective(request, runtime)` when it runs installed tools. */
  objectiveTools?: readonly string[];
}

interface PublicTask<PublicInput> {
  taskId: string;
  family: string;
  publicInput: PublicInput;
}

export interface EvaluationRequest {
  publicTask: PublicTask<JsonValue>;
  artifact: JsonValue;
  hidden: JsonValue;
  files?: readonly AnswerFile[];
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
  /** True when host-forwarded or resolving via symlink outside the pack's `.toolchain/`. */
  readonly external: boolean;
}

/** What a check's wall closes beside the repository and the home, as a seat's does (`Walled`,
 *  `src/tools/command.ts`): the repository's other worktrees, and the stored pack's root and bundle,
 *  which hold every task's hidden values. */
interface Closed {
  readonly otherTrees?: readonly string[] | undefined;
  readonly packRoots?: readonly string[] | undefined;
  /** One check's time, its tools included; `PER_CHECK_MS` where unset. */
  readonly checkMs?: number | undefined;
}

export type Verdict =
  | { readonly kind: "pass"; readonly objective?: number }
  | { readonly kind: "fail"; readonly blocking: readonly string[] }
  | { readonly kind: "faulty"; readonly check: string; readonly reason: string }
  | { readonly kind: "non-result"; readonly reason: string };

/** Whether an answer passes a task's checks. No answer is a fail. */
export type Verifier = (
  task: Task,
  answer: JsonValue | undefined,
  signal?: AbortSignal,
  files?: readonly AnswerFile[],
) => Promise<Verdict>;

interface Wall {
  readonly tree: VerifierTree;
  /** The check program's files, as `checkProgramFiles` lists them. */
  readonly program: readonly string[];
  /** Declared tool ids pre-resolved to their direct executable paths (`resolveVerifierTool`). */
  readonly toolMap: Readonly<Record<string, string>>;
  /** The base of every check's command wall, or why this host has none. */
  readonly base: SolveIsolationPolicy | { readonly unsupported: string };
  readonly checkMs: number;
}

/** The objective, run as a check is, in the verdict's cell: the evaluator's `objective` export,
 *  given the whole answer, its files, the whole public task and the task's hidden values, with no
 *  tool. Its files let it measure a work product the prompt asks for, such as a workbook. It is
 *  the author's own computation, so `accept.ts` lists it as a fault until the operator admits it by
 *  name (rule 10). Its hidden values let it measure against what the task was built from, such as
 *  the parameters that generated its data, so it has a best value no recomputation reaches; an
 *  objective that could only recompute from the public input what the solver could recompute too
 *  ties nearly every task at its best. */
export const OBJECTIVE: BriefTruthCheck = {
  id: "objective",
  citedDecisionIds: [],
  execution: {
    families: "all",
    artifactPaths: ["$"],
    filePaths: ["$"],
    publicInputPaths: ["$"],
    hidden: "whole",
    evidence: { kind: "authored" },
  },
};

/** Manifest listing ambient host tool names a drafted exam (`tools/d2/exam.ts`) is permitted to
 *  invoke inside the verifier cell; stored packs install binaries directly under `.toolchain/bin/`. */
export const HOST_TOOLS_FILE = "host-tools.json";

/** Resolved verifier executable with its provenance: physically installed inside the pack's
 *  `.toolchain/` (`pack`) or forwarded from the ambient host toolchain path (`host`). */
interface ResolvedVerifierTool {
  readonly kind: "pack" | "host";
  readonly path: string;
  readonly sha256: string;
}

const CHECK_CHILD = join(import.meta.dir, "check-child.ts");
const CHECK_CHILD_SOURCES = [import.meta.dir, resolve(import.meta.dir, "..", "meta")];
const REPO = resolve(import.meta.dir, "..", "..");
const CHECKS_AT_ONCE = 4;
/** Per-check wall timeout including its tools; exceeding it marks the check faulty. */
export const PER_CHECK_MS = 120_000;

/** Objective measure of a passing verdict, or null. */
export function objectiveOf(verdict: Verdict | null | undefined): number | null {
  return verdict?.kind === "pass" ? (verdict.objective ?? null) : null;
}

/** Blocking check ids of a failing verdict, or empty. */
export function blockingOf(verdict: Verdict | null | undefined): readonly string[] {
  return verdict?.kind === "fail" ? verdict.blocking : [];
}

/** The faulty check id and reason of `verdict`, or null for any other verdict kind. */
export function faultyOf(
  verdict: Verdict | null | undefined,
): { readonly check: string; readonly reason: string } | null {
  return verdict?.kind === "faulty" ? { check: verdict.check, reason: verdict.reason } : null;
}

/** True when a verdict decided pass or fail rather than faulty or non-result. */
export function decides(verdict: Verdict): verdict is Extract<Verdict, { kind: "pass" | "fail" }> {
  return verdict.kind === "pass" || verdict.kind === "fail";
}

/** One-line canonical spelling of a verdict for equality and display. */
export function spelled(verdict: Verdict): string {
  if (verdict.kind === "fail") return `fail ${[...verdict.blocking].toSorted().join(",")}`;
  if (verdict.kind === "faulty") return `faulty ${verdict.check}: ${verdict.reason}`;
  if (verdict.kind === "pass") {
    return verdict.objective === undefined ? "pass" : `pass ${String(verdict.objective)}`;
  }
  return `non-result ${verdict.reason}`;
}

/** Ambient host tool names and draft provenance read from `toolsDir/host-tools.json`. */
function hostManifestIn(toolsDir: string): { readonly draft: boolean; readonly tools: ReadonlySet<string> } {
  const manifest = join(toolsDir, HOST_TOOLS_FILE);
  if (!existsSync(manifest)) return { draft: false, tools: new Set() };
  const parsed = asRecord(parseJsonAs<JsonValue>(readFileSync(manifest, "utf8")));
  const listed = Array.isArray(parsed?.tools) ? parsed.tools : [];
  return {
    draft: parsed?.origin === "draft",
    tools: new Set(listed.filter((entry): entry is string => isString(entry) && isSafePathSegment(entry))),
  };
}

/** Strict subdirectory (or file) inside `home` for a resolved executable — never `home` itself. */
function safeHomeRoot(real: string, home: string): string {
  const grand = dirname(dirname(real));
  if (grand !== home && containsPath(grand, home)) return grand;
  const parent = dirname(real);
  return parent !== home && containsPath(parent, home) ? parent : real;
}

/** Resolve one declared verifier tool by provenance: a binary under `toolsDir` takes precedence
 *  (`pack` on operator-installed packs; `host` when staged from a drafted exam under Rule 10),
 *  otherwise an ambient host binary named in `host-tools.json` (`host`). Preserves the lexical
 *  executable path (for Python PEP 405 venvs and argv0-relative tools) while hashing the canonical
 *  `realpathSync` target so binary updates move the digest. */
export function resolveVerifierTool(
  toolsDir: string,
  name: string,
  hostPath = toolchainPathDirs().join(":"),
): ResolvedVerifierTool | null {
  if (!isSafePathSegment(name)) return null;
  const manifest = hostManifestIn(toolsDir);
  const packBin = Bun.which(name, { PATH: toolTreeSearchDirs(toolsDir).join(":") });
  if (packBin !== null) {
    return {
      kind: manifest.draft ? "host" : "pack",
      path: packBin,
      sha256: sha256OfFile(realpathSync(packBin)),
    };
  }
  if (!manifest.tools.has(name)) return null;
  const hostBin = Bun.which(name, { PATH: hostPath });
  return hostBin === null
    ? null
    : { kind: "host", path: hostBin, sha256: sha256OfFile(realpathSync(hostBin)) };
}

/** Tool ids a check requires, whether declared under external evidence or execution dependencies. */
export function requiredToolsOf(execution: CheckExecution): readonly string[] {
  return execution.evidence.kind === "external"
    ? execution.evidence.requiredToolIds
    : (execution.requiredToolIds ?? []);
}

/** Resolve and hash every declared verifier engine (`resolveVerifierTool`). */
export function pinnedEngines({ checks, tools }: VerifierTree): Engine[] {
  const hostPath = toolchainPathDirs().join(":");
  const toolsReal = existsSync(tools) ? realpathSync(tools) : null;
  const brief = readBrief(checks);
  const named = [
    ...brief.truthChecks.flatMap(({ execution }) => requiredToolsOf(execution)),
    ...(brief.objectiveTools ?? []),
  ];
  return [...new Set(named)].flatMap((name) => {
    const resolved = resolveVerifierTool(tools, name, hostPath);
    if (resolved === null) return [];
    const external = toolsReal === null || !containsPath(realpathSync(resolved.path), toolsReal);
    return [{ name, path: resolved.path, sha256: resolved.sha256, external }];
  });
}

/** Truth checks whose declared family scope includes `task.family`. */
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
function checkPublicInputs(
  check: BriefTruthCheck,
  request: Pick<EvaluationRequest, "artifact" | "publicTask" | "files">,
): Pick<EvaluationRequest, "artifact" | "publicTask" | "files"> {
  return {
    ...keyIfDefined(
      "files",
      check.execution.filePaths === undefined
        ? undefined
        : (request.files ?? []).filter(
            (file) => check.execution.filePaths?.some((path) => path === "$" || path === file.path) === true,
          ),
    ),
    artifact: projectJsonPaths(request.artifact, check.execution.artifactPaths),
    publicTask: {
      taskId: request.publicTask.taskId,
      family: request.publicTask.family,
      publicInput: projectJsonPaths(request.publicTask.publicInput, check.execution.publicInputPaths),
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
  if (check.execution.hidden === "whole") {
    return { ...checkPublicInputs(check, request), hidden: request.hidden };
  }
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
    throw new Error(`check-hidden-operand-missing: ${check.id}`);
  }
  return { ...checkPublicInputs(check, request), hidden };
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
  return walk("").toSorted(compareCodeUnits);
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
  const brief = parseJsonAs<Brief>(readFileSync(join(checks, CHECK_BRIEF), "utf8"));
  if (brief.truthChecks.some((check) => check.id === OBJECTIVE.id)) {
    throw new Error(`a check is named ${OBJECTIVE.id}, which names the objective`);
  }
  return brief;
}

/** Safe `$HOME` read-allow roots for resolved engine binaries whose realpath lies under `$HOME`
 *  outside `tools` (never reopening `$HOME` itself). Shared by `openVerifier` and `inExaminerWall`. */
export function engineReadRoots(
  tools: string,
  paths: readonly string[],
  home: string | undefined = closedHome(),
): string[] {
  if (home === undefined) return [];
  const canonicalTools = existsSync(tools) ? realpathSync(tools) : null;
  return [
    ...new Set(
      paths.flatMap((path) => {
        const real = realpathSync(path);
        if (!containsPath(real, home)) return [];
        if (canonicalTools !== null && containsPath(real, canonicalTools)) return [];
        return [safeHomeRoot(real, home)];
      }),
    ),
  ];
}

/**
 * A verifier over one tree. The brief is read and the wall's base taken once, here, so every
 * verdict it gives is under the same checks and the same wall. The tree is resolved first: the wall
 * takes only absolute roots.
 */
export function openVerifier(given: VerifierTree & Closed): Verifier {
  const tree: VerifierTree = { checks: resolve(given.checks), tools: resolve(given.tools) };
  const brief = readBrief(tree.checks);
  const [firstTool, ...moreTools] = brief.objectiveTools ?? [];
  const objectiveTools: [string, ...string[]] | undefined =
    firstTool === undefined ? undefined : [firstTool, ...moreTools];
  const objective: BriefTruthCheck | null =
    brief.objective === undefined
      ? null
      : objectiveTools === undefined
        ? OBJECTIVE
        : {
            ...OBJECTIVE,
            execution: {
              ...OBJECTIVE.execution,
              requiredToolIds: objectiveTools,
              evidence: { kind: "authored" },
            },
          };
  const hostPath = toolchainPathDirs().join(":");
  const declared = [
    ...new Set([
      ...brief.truthChecks.flatMap(({ execution }) => requiredToolsOf(execution)),
      ...(brief.objectiveTools ?? []),
    ]),
  ];
  const resolvedTools = declared.flatMap((name) => {
    const resolved = resolveVerifierTool(tree.tools, name, hostPath);
    return resolved === null ? [] : [[name, resolved] as const];
  });
  const toolMap = Object.fromEntries(resolvedTools.map(([name, resolved]) => [name, resolved.path]));
  const homeToolRoots = engineReadRoots(
    tree.tools,
    resolvedTools.map(([, resolved]) => resolved.path),
  );
  const wall: Wall = {
    tree,
    program: checkProgramFiles(tree.checks),
    toolMap,
    base: solveIsolationPolicy({
      repoRoot: REPO,
      otherTrees: given.otherTrees ?? [],
      packRoots: given.packRoots ?? [],
      readAllowRoots: [...CHECK_CHILD_SOURCES, ...new Set(homeToolRoots)],
      network: false,
    }),
    checkMs: given.checkMs ?? PER_CHECK_MS,
  };
  return async (task, answer, signal, files) => {
    if (answer === undefined) return { kind: "fail", blocking: [] };
    const request = {
      publicTask: task,
      artifact: answer,
      hidden: task.hidden,
      ...keyIfDefined("files", files),
    };
    const checks = applicableTruthChecks(brief, task);
    if (checks.length === 0) {
      return { kind: "faulty", check: "brief", reason: `no check applies to family ${task.family}` };
    }
    const ran = await runCell(wall, checks, objective, request, signal);
    if ("nonResult" in ran) return { kind: "non-result", reason: ran.nonResult };
    if ("held" in ran) return { kind: "faulty", check: ran.held, reason: ran.reason };
    // Every check ran, and the first that cannot decide or is faulty, in the brief's order, decides.
    const blocking: string[] = [];
    for (const [index, result] of ran.results.entries()) {
      const { id } = checks[index] ?? OBJECTIVE;
      if ("nonResult" in result) return { kind: "non-result", reason: `${id}: ${result.nonResult}` };
      if ("faulty" in result) return { kind: "faulty", check: id, reason: result.faulty };
      if (!result.passed) blocking.push(id);
    }
    if (blocking.length > 0) return { kind: "fail", blocking };
    const { measured } = ran;
    if (measured === null) return { kind: "pass" };
    const { id } = OBJECTIVE;
    if ("nonResult" in measured) return { kind: "non-result", reason: `${id}: ${measured.nonResult}` };
    if ("faulty" in measured) return { kind: "faulty", check: id, reason: measured.faulty };
    return { kind: "pass", objective: measured.value };
  };
}

/**
 * A verdict that decides, for the host to act on. A non-result is thrown instead, and each caller decides
 * what it ends (a run, a draft's reading, a Referee's replay): it comes from
 * the verifier, never the task, and a non-result is never counted, so a run on a broken verifier, one
 * that returns one for every check, would count nothing and look clean.
 */
export async function decided(
  verify: Verifier,
  task: Task,
  answer: JsonValue | undefined,
  files?: readonly AnswerFile[],
) {
  const verdict = await verify(task, answer, undefined, files);
  if (verdict.kind === "non-result") {
    throw new Error(`the verifier could not decide ${task.taskId}: ${verdict.reason}`);
  }
  return verdict;
}

/** One check's input to the cell: its own projection of the answer, and the tools it declares. */
const inputOf = (check: BriefTruthCheck, request: EvaluationRequest): CheckInput => ({
  checkId: check.id,
  request: checkEvaluationRequest(check, request),
  tools: requiredToolsOf(check.execution),
});

/** The check that last marked itself active among those still running in `runningDir`, or null. */
function heldCheck(runningDir: string): string | null {
  if (!existsSync(runningDir)) return null;
  let held: { readonly seq: number; readonly checkId: string } | null = null;
  for (const name of readdirSync(runningDir)) {
    if (!name.endsWith(".run")) continue;
    let content: string;
    try {
      content = readFileSync(join(runningDir, name), "utf8");
    } catch {
      continue;
    }
    const [rawSeq, checkId] = content.split("\n");
    const seq = Number(rawSeq);
    if (
      Number.isFinite(seq) &&
      checkId !== undefined &&
      checkId !== "" &&
      (held === null || seq > held.seq)
    ) {
      held = { seq, checkId };
    }
  }
  return held?.checkId ?? null;
}

/**
 * One verdict's cell: a walled process that runs every check, and the objective where the answer
 * passes them, and writes their answers (`check-child.ts`). Its own time is the checks' times in
 * waves of `CHECKS_AT_ONCE`, one more for the objective and one for its start, so it runs out only
 * where a check holds the process's thread, and that check, which the cell names as it runs, is at
 * fault. A cell that runs out before any check starts, a cancel and a host that cannot wall a check
 * are non-results.
 */
async function runCell(
  wall: Wall,
  checks: readonly BriefTruthCheck[],
  objective: BriefTruthCheck | null,
  request: EvaluationRequest,
  signal?: AbortSignal,
): Promise<CellResult | { readonly nonResult: string } | { readonly held: string; readonly reason: string }> {
  const { base } = wall;
  if (signal?.aborted === true) return { nonResult: "the verifier was cancelled" };
  if ("unsupported" in base) return { nonResult: `this host cannot wall a check: ${base.unsupported}` };
  // The cell is a seat of its own: one root the checks write, the program in the host's folder in
  // it, which they read and cannot write, and the profile beside the root, out of their reach.
  // The root lies in the host's own scratch, which the wall closes whole but for the cell it runs.
  const root = hostScratch("cell-");
  const dirs = {
    root,
    home: join(root, "home"),
    temp: join(root, "tmp"),
    kept: join(root, "kept"),
    host: hostFolder(root),
  };
  const cellMs = (Math.ceil(checks.length / CHECKS_AT_ONCE) + 2) * wall.checkMs;
  let child: Bun.Subprocess | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: (() => void) | null = null;
  try {
    for (const dir of [dirs.home, dirs.temp, dirs.host]) mkdirSync(dir, { recursive: true });
    const runningDir = join(dirs.temp, ".ana-running");
    mkdirSync(runningDir, { recursive: true });
    // The program goes below the host's folder, so no file of it can stand as `result.json`.
    const copy = join(dirs.kept, "program");
    for (const file of wall.program) {
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      copyFileSync(join(wall.tree.checks, file), join(copy, file));
    }
    const input: CellInput = {
      program: join(copy, EVALUATOR_FILE),
      tools: wall.toolMap,
      toolCeilingMs: wall.checkMs,
      checkMs: wall.checkMs,
      width: CHECKS_AT_ONCE,
      checks: checks.map((check) => inputOf(check, request)),
      objective: objective === null ? null : inputOf(objective, request),
      running: runningDir,
    };
    const policy = commandIsolationPolicy(base, { ...dirs, toolTree: wall.tree.tools });
    // The wall a seat's command takes, without its shell: the cell leads its own group, and the
    // group is ended below.
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
    const stopped = Promise.withResolvers<
      { readonly nonResult: string } | { readonly held: string; readonly reason: string }
    >();
    const stop = (reason: string) => {
      killProcessGroupId(process.pid, "SIGKILL");
      stopped.resolve({ nonResult: reason });
    };
    timer = setTimeout(() => {
      // A check that never yields holds the cell past every check's own time: it is at fault, as
      // one that runs out its time is. A cell that started no check could not run, and decides nothing.
      const held = heldCheck(input.running);
      if (held === null) return stop(`the cell ran past ${String(cellMs)} ms`);
      killProcessGroupId(process.pid, "SIGKILL");
      stopped.resolve({ held, reason: `the check timed out, holding the cell past ${String(cellMs)} ms` });
    }, cellMs);
    abort = () => stop("the verifier was cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    const finished = Promise.all([new Response(process.stderr).text(), process.exited]).then(
      ([stderr, exitCode]) => ({ stderr, exitCode }),
    );
    const outcome = await Promise.race([finished, stopped.promise]);
    if ("nonResult" in outcome || "held" in outcome) return outcome;
    const { stderr, exitCode } = outcome;
    return (
      writtenResult(join(root, "result.json"), checks.length) ?? {
        nonResult: `the cell exited ${String(exitCode)} without a result: ${stderr.slice(-2000).trim()}`,
      }
    );
  } catch (error) {
    return { nonResult: `the verifier could not run the checks: ${errorMessage(error)}` };
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (abort !== null) signal?.removeEventListener("abort", abort);
    // End work left in the cell's group; the root's release also ends detached holders, whose
    // process group is their own.
    if (child !== null) await terminateAndReapProcessGroupId(child.pid);
    await releaseRoot(root);
  }
}

/** What the cell wrote of a check or the objective that leaves it undecided, or null. */
const undecided = (value: unknown) => {
  const written = asRecord(value);
  if (isString(written?.nonResult)) return { nonResult: written.nonResult };
  if (isString(written?.faulty)) return { faulty: written.faulty };
  return null;
};

/** The cell's answers, or null where it wrote none that reads as one for each of its `count` checks. */
function writtenResult(path: string, count: number): CellResult | null {
  if (!existsSync(path)) return null;
  let parsed: JsonValue;
  try {
    parsed = capturedJsonParse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const written = asRecord(parsed);
  const listed = Array.isArray(written?.results) ? written.results : [];
  const results = listed
    .map((each): CheckResult | null => {
      const passed = asRecord(each)?.passed;
      return isBoolean(passed) ? { passed } : undecided(each);
    })
    .filter((each) => each !== null);
  const value = asRecord(written?.measured)?.value;
  const measured = isNumber(value) && Number.isFinite(value) ? { value } : undecided(written?.measured);
  if (listed.length !== count || results.length !== count) return null;
  if (written?.measured !== null && measured === null) return null;
  return { results, measured };
}
