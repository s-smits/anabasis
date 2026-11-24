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

interface CheckExecution {
  families: "all" | string[];
  artifactPaths: string[];
  publicInputPaths: string[];
  filePaths?: string[];
  hidden: "none" | "required" | "whole";
  requiredToolIds?: [string, ...string[]];
  evidence: { kind: "authored" } | { kind: "external"; requiredToolIds: [string, ...string[]] };
}

interface BriefTruthCheck {
  id: string;
  citedDecisionIds: string[];
  execution: CheckExecution;
}

export interface Brief {
  correctnessContract: string;
  truthChecks: BriefTruthCheck[];
  objective?: Objective;
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

export type Task = PublicTask<JsonValue> & { readonly hidden: JsonValue };

export interface VerifierTree {
  readonly checks: string;
  readonly tools: string;
}

export interface Engine {
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly external: boolean;
}

interface Closed {
  readonly otherTrees?: readonly string[] | undefined;
  readonly packRoots?: readonly string[] | undefined;
  readonly checkMs?: number | undefined;
}

export type Verdict =
  | { readonly kind: "pass"; readonly objective?: number }
  | { readonly kind: "fail"; readonly blocking: readonly string[] }
  | { readonly kind: "faulty"; readonly check: string; readonly reason: string }
  | { readonly kind: "non-result"; readonly reason: string };

export type Verifier = (
  task: Task,
  answer: JsonValue | undefined,
  signal?: AbortSignal,
  files?: readonly AnswerFile[],
) => Promise<Verdict>;

interface Wall {
  readonly tree: VerifierTree;
  readonly program: readonly string[];
  readonly toolMap: Readonly<Record<string, string>>;
  readonly base: SolveIsolationPolicy | { readonly unsupported: string };
  readonly checkMs: number;
}

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

export const HOST_TOOLS_FILE = "host-tools.json";

interface ResolvedVerifierTool {
  readonly kind: "pack" | "host";
  readonly path: string;
  readonly sha256: string;
}

const CHECK_CHILD = join(import.meta.dir, "check-child.ts");
const CHECK_CHILD_SOURCES = [import.meta.dir, resolve(import.meta.dir, "..", "meta")];
const REPO = resolve(import.meta.dir, "..", "..");
const CHECKS_AT_ONCE = 4;
export const PER_CHECK_MS = 120_000;

export function objectiveOf(verdict: Verdict | null | undefined): number | null {
  return verdict?.kind === "pass" ? (verdict.objective ?? null) : null;
}

export function blockingOf(verdict: Verdict | null | undefined): readonly string[] {
  return verdict?.kind === "fail" ? verdict.blocking : [];
}

export function faultyOf(
  verdict: Verdict | null | undefined,
): { readonly check: string; readonly reason: string } | null {
  return verdict?.kind === "faulty" ? { check: verdict.check, reason: verdict.reason } : null;
}

export function decides(verdict: Verdict): verdict is Extract<Verdict, { kind: "pass" | "fail" }> {
  return verdict.kind === "pass" || verdict.kind === "fail";
}

export function spelled(verdict: Verdict): string {
  if (verdict.kind === "fail") return `fail ${[...verdict.blocking].toSorted().join(",")}`;
  if (verdict.kind === "faulty") return `faulty ${verdict.check}: ${verdict.reason}`;
  if (verdict.kind === "pass") {
    return verdict.objective === undefined ? "pass" : `pass ${String(verdict.objective)}`;
  }
  return `non-result ${verdict.reason}`;
}

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

function toolLookup(toolsDir: string) {
  return {
    toolPath: toolTreeSearchDirs(toolsDir).join(":"),
    hostPath: toolchainPathDirs().join(":"),
    manifest: hostManifestIn(toolsDir),
  };
}

export function resolveVerifierTool(
  toolsDir: string,
  name: string,
  lookup = toolLookup(toolsDir),
): ResolvedVerifierTool | null {
  if (!isSafePathSegment(name)) return null;
  const packBin = Bun.which(name, { PATH: lookup.toolPath });
  const bin =
    packBin ?? (lookup.manifest.tools.has(name) ? Bun.which(name, { PATH: lookup.hostPath }) : null);
  if (bin === null) return null;
  return {
    kind: packBin !== null && !lookup.manifest.draft ? "pack" : "host",
    path: bin,
    sha256: sha256OfFile(realpathSync(bin)),
  };
}

export function requiredToolsOf(execution: CheckExecution): readonly string[] {
  return execution.evidence.kind === "external"
    ? execution.evidence.requiredToolIds
    : (execution.requiredToolIds ?? []);
}

const declaredTools = (brief: Brief) => [
  ...new Set([
    ...brief.truthChecks.flatMap(({ execution }) => requiredToolsOf(execution)),
    ...(brief.objectiveTools ?? []),
  ]),
];

export function pinnedEngines({ checks, tools }: VerifierTree): Engine[] {
  const lookup = toolLookup(tools);
  const toolsReal = existsSync(tools) ? realpathSync(tools) : null;
  return declaredTools(readBrief(checks)).flatMap((name) => {
    const resolved = resolveVerifierTool(tools, name, lookup);
    if (resolved === null) return [];
    const external = toolsReal === null || !containsPath(realpathSync(resolved.path), toolsReal);
    return [{ name, path: resolved.path, sha256: resolved.sha256, external }];
  });
}

export function applicableTruthChecks(brief: Brief, task: { family: string }): BriefTruthCheck[] {
  if (brief.correctnessContract !== CHECK_PROGRAM_CONTRACT) {
    throw new Error("unsupported-correctness-contract");
  }
  return brief.truthChecks.filter(
    (check) => check.execution.families === "all" || check.execution.families.includes(task.family),
  );
}

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

export function checkEvaluationRequest(
  check: BriefTruthCheck,
  request: EvaluationRequest,
): EvaluationRequest {
  if (check.execution.hidden === "whole") {
    return { ...checkPublicInputs(check, request), hidden: request.hidden };
  }
  const hidden =
    check.execution.hidden === "none" || !Array.isArray(request.hidden)
      ? []
      : request.hidden.filter((row: unknown) => isRecord(row) && row.checkId === check.id);
  if (
    check.execution.hidden === "required" &&
    (hidden.length !== 1 || !isRecord(hidden[0]) || !Object.hasOwn(hidden[0], "expectation"))
  ) {
    throw new Error(`check-hidden-operand-missing: ${check.id}`);
  }
  return { ...checkPublicInputs(check, request), hidden };
}

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

export function checkProgramVersion(checks: string): Record<string, string> {
  return Object.fromEntries(
    checkProgramFiles(checks).map((file) => [file, sha256OfFile(join(checks, file))]),
  );
}

export function readBrief(checks: string): Brief {
  const brief = parseJsonAs<Brief>(readFileSync(join(checks, CHECK_BRIEF), "utf8"));
  if (brief.truthChecks.some((check) => check.id === OBJECTIVE.id)) {
    throw new Error(`a check is named ${OBJECTIVE.id}, which names the objective`);
  }
  return brief;
}

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
        const insideTools = canonicalTools !== null && containsPath(real, canonicalTools);
        if (!containsPath(real, home) || insideTools) return [];
        return [
          [dirname(dirname(real)), dirname(real)].find((dir) => dir !== home && containsPath(dir, home)) ??
            real,
        ];
      }),
    ),
  ];
}

const stopVerdict = (
  id: string,
  outcome: CheckResult | NonNullable<CellResult["measured"]>,
): Verdict | null =>
  "nonResult" in outcome
    ? { kind: "non-result", reason: `${id}: ${outcome.nonResult}` }
    : "faulty" in outcome
      ? { kind: "faulty", check: id, reason: outcome.faulty }
      : null;

export function openVerifier(given: VerifierTree & Closed): Verifier {
  const tree: VerifierTree = { checks: resolve(given.checks), tools: resolve(given.tools) };
  const brief = readBrief(tree.checks);
  const [firstTool, ...moreTools] = brief.objectiveTools ?? [];
  const objective: BriefTruthCheck | null =
    brief.objective === undefined
      ? null
      : firstTool === undefined
        ? OBJECTIVE
        : { ...OBJECTIVE, execution: { ...OBJECTIVE.execution, requiredToolIds: [firstTool, ...moreTools] } };
  const lookup = toolLookup(tree.tools);
  const resolvedTools = declaredTools(brief).flatMap((name) => {
    const resolved = resolveVerifierTool(tree.tools, name, lookup);
    return resolved === null ? [] : [[name, resolved.path] as const];
  });
  const wall: Wall = {
    tree,
    program: checkProgramFiles(tree.checks),
    toolMap: Object.fromEntries(resolvedTools),
    base: solveIsolationPolicy({
      repoRoot: REPO,
      otherTrees: given.otherTrees ?? [],
      packRoots: given.packRoots ?? [],
      readAllowRoots: [
        ...CHECK_CHILD_SOURCES,
        ...engineReadRoots(
          tree.tools,
          resolvedTools.map(([, path]) => path),
        ),
      ],
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
    const ran = await runCell(wall, { checks, objective, request, signal });
    if ("nonResult" in ran) return { kind: "non-result", reason: ran.nonResult };
    if ("held" in ran) return { kind: "faulty", check: ran.held, reason: ran.reason };
    const blocking: string[] = [];
    for (const [index, result] of ran.results.entries()) {
      const { id } = checks[index] ?? OBJECTIVE;
      const stopped = stopVerdict(id, result);
      if (stopped !== null) return stopped;
      if ("passed" in result && !result.passed) blocking.push(id);
    }
    if (blocking.length > 0) return { kind: "fail", blocking };
    const { measured } = ran;
    if (measured === null) return { kind: "pass" };
    return (
      stopVerdict(OBJECTIVE.id, measured) ?? {
        kind: "pass",
        ...keyIfDefined("objective", "value" in measured ? measured.value : undefined),
      }
    );
  };
}

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

const inputOf = (check: BriefTruthCheck, request: EvaluationRequest): CheckInput => ({
  checkId: check.id,
  request: checkEvaluationRequest(check, request),
  tools: requiredToolsOf(check.execution),
});

function heldCheck(runningDir: string): string | null {
  if (!existsSync(runningDir)) return null;
  let held: { readonly seq: number; readonly checkId: string } | null = null;
  for (const name of readdirSync(runningDir)) {
    if (!name.endsWith(".run")) continue;
    try {
      const [rawSeq, checkId = ""] = readFileSync(join(runningDir, name), "utf8").split("\n");
      const seq = Number(rawSeq);
      if (Number.isFinite(seq) && checkId !== "" && (held === null || seq > held.seq)) {
        held = { seq, checkId };
      }
    } catch {
      // Marker removed between readdir and read.
    }
  }
  return held?.checkId ?? null;
}

async function runCell(
  wall: Wall,
  run: {
    readonly checks: readonly BriefTruthCheck[];
    readonly objective: BriefTruthCheck | null;
    readonly request: EvaluationRequest;
    readonly signal: AbortSignal | undefined;
  },
): Promise<CellResult | { readonly nonResult: string } | { readonly held: string; readonly reason: string }> {
  const { checks, objective, request, signal } = run;
  const { base } = wall;
  if (signal?.aborted === true) return { nonResult: "the verifier was cancelled" };
  if ("unsupported" in base) return { nonResult: `this host cannot wall a check: ${base.unsupported}` };
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
    if (child !== null) await terminateAndReapProcessGroupId(child.pid);
    await releaseRoot(root);
  }
}

const undecided = (value: unknown) => {
  const written = asRecord(value);
  if (isString(written?.nonResult)) return { nonResult: written.nonResult };
  if (isString(written?.faulty)) return { faulty: written.faulty };
  return null;
};

function writtenResult(path: string, count: number): CellResult | null {
  if (!existsSync(path)) return null;
  let written: ReturnType<typeof asRecord>;
  try {
    written = asRecord(capturedJsonParse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
  const listed = Array.isArray(written?.results) ? written.results : [];
  const results = listed.flatMap((each): CheckResult[] => {
    const passed = asRecord(each)?.passed;
    const item = isBoolean(passed) ? { passed } : undecided(each);
    return item === null ? [] : [item];
  });
  const value = asRecord(written?.measured)?.value;
  const measured = isNumber(value) && Number.isFinite(value) ? { value } : undecided(written?.measured);
  if (listed.length !== count || results.length !== count) return null;
  return written?.measured !== null && measured === null ? null : { results, measured };
}
