/**
 * @ana/verifier-host starts every tool process used by the verifier. Installed tools
 * (compilers, simulators, solvers, any field tool) run only through this host; correctness-model
 * modules receive a port and never touch child_process.
 *
 * Every check in an evaluation gets one fresh private directory. It holds the check's permitted
 * inputs and the files its tools produce, with no additional Builder-authored source:
 * `files` and `stdin` must be string leaves or JSON of that check's declared artifact and public
 * task projections, so a check cannot compile against an undeclared sibling or author-supplied header.
 * The tool is an inventory entry the host resolved and hashed when the candidate snapshot was made, or a
 * file an earlier run of the same check produced (`cell:<path>`, a compiled program).
 *
 * A run that exits and completes cleanup is `executed`, whatever the exit code: a compiler
 * that rejects the artifact has answered, and the evaluator reads that answer. Missing tool, wall
 * refusal, changed tool bytes, timeout and spawn failure are typed non-results: no answer exists,
 * and the row says which kind. The evaluator's own returned result never turns a non-result into an
 * answer, because the runner reads these rows directly (tool-runs.ts).
 */
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { isAbsolute, join, normalize, relative, sep } from "../meta/path.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { capturedJsonStringify, hashJsonBytes, capturedStructuredClone } from "../meta/json-runtime.ts";
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { cancellableByteStream } from "../meta/cancellable-stream.ts";
import { isString } from "../meta/json-shape.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { interpreterDigest, toolProvenance } from "./tool-inventory.ts";
import type { VerifierExecutionNonResultKind } from "./correctness-model-result.ts";
import type { ExactReadDrift } from "./exact-read-attestation.ts";
import { LINUX_BWRAP_ID, bwrapWrappedSignal } from "./linux-bwrap.ts";
import {
  type OsIsolationRuntime,
  type VerifierOsIsolation,
  type VerifierOsIsolationPlan,
  verifierOsIsolation,
} from "./os-isolation.ts";
import type {
  EvaluationScopeHandle,
  ExecutedCheckBinding,
  ToolEntry,
  ToolInventory,
  ToolRunRequest,
  ToolRunResult,
  VerifierExecutionEvidence,
  VerifierHostHandle,
  VerifierSubject,
} from "./verifier-port.ts";
import { type FrozenToolchainAccess, frozenToolchainAccess, surroundingSandbox } from "./wall-policy.ts";
import { checkToolInputs, type ToolInputGrant } from "./host-inputs.ts";
import { toolInputViolation } from "../../vendor/correctness-model-bundle/tool-inputs.ts";
import {
  VerifierContractError,
  type VerifierContractCode,
} from "../../vendor/correctness-model-bundle/contract-error.ts";
import { engineCellEnv } from "./engine-cell-env.ts";
import {
  createVerifierLifetime,
  settleUnspawned,
  superviseVerifierProcess,
  VerifierOperationalStop,
  type VerifierLifetime,
  type VerifierProcessSettlement,
} from "./verifier-lifetime.ts";
import { errorCode, errorMessage } from "../meta/runtime-values.ts";

/** Five minutes. esp32-sol-stable-20260905T1000Z lost its battery when a cold Arduino compile
 *  that had passed the census took 60,457 ms on a loaded host. This limit allows longer compiles
 *  while bounding a tool that does not finish. */
export const DEFAULT_TOOL_TIMEOUT_MS = 300_000;
/** No single tool run may exceed this wall, whatever the evaluator asks for. It equals the default
 *  (2026-09-14): of 184,953 recorded verifier tool runs, 99 percent finished within 16 s and 7 ran past
 *  300 s, while a 30-minute census has little room for a longer run. */
export const TOOL_TIMEOUT_CEILING_MS = DEFAULT_TOOL_TIMEOUT_MS;

const STDOUT_MAX_BYTES = 1024 * 1024;
const STDERR_MAX_BYTES = 256 * 1024;
const STDERR_TAIL_CHARS = 2000;
/** Bytes kept for the tail independently of the capture cap (four bytes per UTF-8 character). */
const STDERR_TAIL_BYTES = STDERR_TAIL_CHARS * 4;

const CELL_TOOL_PREFIX = "cell:";

export interface VerifierHostOptions {
  /** Protected controller/outDir owner. Required before production starts a subprocess. */
  lifetime?: VerifierLifetime;
  /** toolId → resolved executable, from `resolveToolInventory` on the candidate snapshot. A run
   *  naming an id outside this map throws. Defaults to empty. */
  inventory?: ToolInventory;
  /** The candidate's `.toolchain` tree, opened read-only inside the wall so installed tools can
   *  find their own runtime files. Null or absent opens nothing beyond the platform roots. */
  toolTree?: string | null;
  /** Base directory for cells; defaults to the OS tmpdir. */
  baseDir?: string;
  /** Parent env the toolchain defaults are read from; overridable for tests. Defaults to Bun.env. */
  parentEnv?: OptionalEnvValues;
  /** Testable host capability input. Production omits it and uses the current OS isolation. */
  osSandbox?: OsIsolationRuntime;
  /** Default true: every run needs the platform wall and fails closed without it. Tests that
   *  exercise the cell alone may set false; production never does. */
  requireOsSandbox?: boolean;
  /** The candidate's tool-run wall (`gate.tool_run_seconds` in agent/config.yaml). */
  toolRunMs?: number;
}

/** `ran` is unset before the cell's first run, null after a real one, and the request a reused
 *  first run answered, which the cell's next run replays so the tool's outputs exist. */
interface ToolCell extends ToolInputGrant {
  path: string;
  ran?: ToolRunRequest | null;
}

interface Scope {
  subject: VerifierSubject;
  artifactDigest: string;
  publicTaskDigest: string | null;
  cells: Map<string, ToolCell>;
  inFlight: Set<Promise<unknown>>;
  tail: Promise<void>;
  pendingAtClose: number;
  closed: boolean;
  /** Stops for this scope's live children and for its waits on another scope's identical run. */
  children: Set<() => Promise<VerifierProcessSettlement | null>>;
  receipts: Set<string>;
}

type EvidenceBase = Omit<
  VerifierExecutionEvidence,
  | "durationMs"
  | "exitCode"
  | "signal"
  | "timedOut"
  | "stdoutBytes"
  | "stderrBytes"
  | "stderrTail"
  | "outcome"
  | "nonResultReason"
>;
type EvidenceRun = Omit<VerifierExecutionEvidence, "outcome" | "nonResultReason">;

/** The executable one run resolved to, and where it came from: an inventory entry the candidate
 *  recorded, or a file an earlier run of the same scope produced. */
type ResolvedTool = { entry: ToolEntry; source: ToolEntry["source"] | "cell" };

/** One run's validated cell inputs, after the artifact-leaf rule accepted them. */
type RunInputs = {
  args: string[];
  files: Record<string, string>;
  stdin: string | null;
  inputPaths: string[];
};
/** The executable facts one evidence row names; null when nothing resolved. */
type EvidenceTool = { command: string; source: ToolEntry["source"] | "cell"; kind: ToolEntry["kind"] };

/** One tool launch: where it runs, what it runs, and the wall it runs under. */
type ToolLaunch = {
  readonly scope: Scope;
  readonly cell: ToolCell;
  readonly toolId: string;
  readonly base: EvidenceBase;
  readonly command: string;
  readonly args: string[];
  readonly stdin: string | null;
  readonly timeoutMs: number;
};

/** The run's own clock and the isolation plan that must still hold when it settles. */
type ToolRunWall = {
  readonly startedAt: number;
  readonly timeoutMs: number;
  readonly plan: VerifierOsIsolationPlan | null;
};

/** What moved in an inventory tool since its snapshot, or null. A script's interpreter is part of the
 *  measured condition too: the same script under another python3 is another tool. */
function movedSinceSnapshot(entry: ToolEntry, liveDigest: string, toolTree: string | null): string | null {
  if (liveDigest !== entry.digest) return "bytes changed";
  if (
    entry.interpreterDigest === undefined ||
    interpreterDigest(entry.path, toolTree) === entry.interpreterDigest
  ) {
    return null;
  }
  return `resolves a different ${entry.interpreter ?? "interpreter"}`;
}

/** The tool timeout: the evaluator's request, at least one millisecond and at most the
 *  candidate's tool-run wall, which is also the default. Keeping the calculation separate lets
 *  tests check the cap without waiting for it. */
export function resolveToolTimeoutMs(
  requested: number | undefined,
  ceilingMs = TOOL_TIMEOUT_CEILING_MS,
): number {
  return Math.min(Math.max(1, requested ?? ceilingMs), ceilingMs);
}
/** The last bytes of a stream, whatever the capture cap kept. A compiler that writes past the
 *  cap puts its closing summary at the end, so the tail follows the stream, not the capture. */
function rollTail(tail: Uint8Array[], chunk: Uint8Array): void {
  tail.push(
    chunk.byteLength <= STDERR_TAIL_BYTES ? chunk : chunk.subarray(chunk.byteLength - STDERR_TAIL_BYTES),
  );
  let total = tail.reduce((sum, kept) => sum + kept.byteLength, 0);
  for (
    let first = tail[0];
    first !== undefined && tail.length > 1 && total - first.byteLength >= STDERR_TAIL_BYTES;
    first = tail[0]
  ) {
    total -= first.byteLength;
    tail.shift();
  }
}
export function createVerifierHost(options: VerifierHostOptions = {}): VerifierHostHandle {
  return new VerifierHost(options);
}

function unspawned(base: EvidenceBase): EvidenceRun {
  return {
    ...base,
    durationMs: 0,
    exitCode: null,
    signal: null,
    timedOut: false,
    stdoutBytes: 0,
    stderrBytes: 0,
    stderrTail: "",
  };
}

/** A real change to an attested byte is the wall's refusal (`sandbox`). A re-read the host could
 *  not complete says nothing about the bytes: it is the environment's (`verifierUnavailable`) and
 *  earns the one fresh execution the census gives that kind, instead of voiding the battery as drift. */
function wallDriftOutcome(
  toolId: string,
  drift: ExactReadDrift,
  when: string,
): [VerifierExecutionNonResultKind, string] {
  return drift.kind === "changed"
    ? ["sandbox", `tool "${toolId}" wall identity changed ${when}: ${drift.detail}`]
    : [
        "verifierUnavailable",
        `tool "${toolId}" wall identity could not be re-attested ${when}: ${drift.detail}`,
      ];
}

function nonResult(run: EvidenceRun, kind: VerifierExecutionNonResultKind, message: string): ToolRunResult {
  return {
    executed: false,
    exitCode: run.exitCode,
    signal: run.signal,
    timedOut: run.timedOut,
    stdout: "",
    stderr: run.stderrTail,
    nonResult: { kind, message },
    evidence: { ...run, outcome: kind, nonResultReason: message },
  };
}

/** Normalise a cell-relative path and refuse empty input, the cell itself or an escape above it. */
function cellRelativePath(path: string): string | null {
  if (path === "" || isAbsolute(path)) return null;
  const normalized = normalize(path);
  if (
    normalized === "." ||
    normalized.startsWith(`..${sep}`) ||
    normalized === ".." ||
    normalized.startsWith(sep)
  ) {
    return null;
  }
  return normalized;
}

function authoringDefect(message: string, code: VerifierContractCode = "verifier-tool-request"): never {
  throw new VerifierContractError(code, message);
}

function captureToolOutput(child: Bun.Subprocess<"ignore" | Uint8Array<ArrayBuffer>, "pipe", "pipe">) {
  const stdout = cancellableByteStream(child.stdout);
  const stderr = cancellableByteStream(child.stderr);
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const tail: Uint8Array[] = [];
  const bytes = { stdout: 0, stderr: 0 };
  const drain = async (
    stream: AsyncIterable<Uint8Array>,
    chunks: Uint8Array[],
    name: "stdout" | "stderr",
    max: number,
  ) => {
    let kept = 0;
    for await (const chunk of stream) {
      bytes[name] += chunk.byteLength;
      if (name === "stderr") rollTail(tail, chunk);
      const room = max - kept;
      if (room <= 0) continue;
      chunks.push(chunk.byteLength <= room ? chunk : chunk.subarray(0, room));
      kept += Math.min(chunk.byteLength, room);
    }
  };
  // Capture an exact prefix while continuing to drain. A settlement cutoff records incomplete
  // output rather than claiming these observed counts are the tool's complete byte totals.
  return {
    bytes,
    stdoutChunks,
    stderrChunks,
    tail,
    drained: Promise.all([
      drain(stdout.stream, stdoutChunks, "stdout", STDOUT_MAX_BYTES),
      drain(stderr.stream, stderrChunks, "stderr", STDERR_MAX_BYTES),
    ]),
    cancel: () => {
      stdout.cancel();
      stderr.cancel();
    },
  };
}

function settledToolResult(
  base: EvidenceBase,
  toolId: string,
  observed: VerifierProcessSettlement,
  output: ReturnType<typeof captureToolOutput>,
  wall: ToolRunWall,
): ToolRunResult {
  const { startedAt, timeoutMs, plan } = wall;
  const decode = (chunks: Uint8Array[]) => new TextDecoder().decode(Bun.concatArrayBuffers(chunks));
  const signal = observed.exit?.signal ?? null;
  const run: EvidenceRun = {
    ...base,
    durationMs: Date.now() - startedAt,
    exitCode: observed.exit?.code ?? null,
    signal,
    timedOut: observed.timedOut,
    stdoutBytes: output.bytes.stdout,
    stderrBytes: output.bytes.stderr,
    stderrTail: decode(output.tail).slice(-STDERR_TAIL_CHARS),
    settlement: {
      receiptId: observed.receiptId,
      groupReaped: observed.groupReaped,
      outputComplete: observed.outputComplete,
    },
  };
  const drift = plan?.verify() ?? null;
  if (drift !== null) return nonResult(run, ...wallDriftOutcome(toolId, drift, "while it ran"));
  if (!observed.groupReaped) {
    return nonResult(
      run,
      "sandbox",
      `tool "${toolId}" process group could not be reaped; its cell is retained`,
    );
  }
  if (observed.timedOut) {
    return nonResult(
      run,
      "timeout",
      `tool "${toolId}" exceeded ${String(timeoutMs)}ms; process group absence was verified`,
    );
  }
  if (!observed.outputComplete || observed.exit === null) {
    return nonResult(run, "sandbox", `tool "${toolId}" exit or output settlement could not be proved`);
  }
  // A cell program's rejecting assert is a completed answer. An installed tool ending by signal
  // remains a crash; a sent signal never stands in for an observed signalCode.
  const wrappedSignal = base.sandbox === LINUX_BWRAP_ID ? bwrapWrappedSignal(run.exitCode) : null;
  if ((run.exitCode === null || wrappedSignal !== null) && run.toolSource !== "cell") {
    return nonResult(
      run,
      "crash",
      `tool "${toolId}" ended by signal ${String(signal ?? wrappedSignal)} before exiting`,
    );
  }
  return {
    executed: true,
    exitCode: run.exitCode,
    signal,
    timedOut: false,
    stdout: decode(output.stdoutChunks),
    stderr: decode(output.stderrChunks),
    nonResult: null,
    evidence: { ...run, outcome: "executed" },
  };
}

/** Tool outputs are untrusted paths too. Refuse linked parents, then replace the final entry
 *  rather than truncating it: a symlink or hardlink left by an earlier tool must not redirect a
 *  controller write. Exclusive creation also refuses a concurrently replaced final entry.
 *  Per-scope serial execution owns tool races; this is not a general same-UID filesystem wall. */
function writeCellInput(cell: string, rel: string, content: string): void {
  if (!lstatSync(cell).isDirectory()) authoringDefect("the evaluate cell is no longer a directory");
  let parent = cell;
  for (const part of rel.split(sep).slice(0, -1)) {
    parent = join(parent, part);
    try {
      mkdirSync(parent);
    } catch (cause) {
      if (errorCode(cause) !== "EEXIST") throw cause;
      if (!lstatSync(parent).isDirectory()) {
        authoringDefect(`input parent for "${rel}" is not an ordinary directory`);
      }
    }
  }
  const target = join(cell, rel);
  rmSync(target, { force: true });
  writeFileSync(target, content, { flag: "wx" });
}

/** Rows are appended as tool runs finish, and under census lanes that order follows lane timing.
 *  Readers get them by phase, subject and attempt, with each subject's runs in their own order, so
 *  the persisted evidence bytes are the same for one lane or four. */
function bySubject(
  left: { phase: string; subjectId: string; attempt: number },
  right: { phase: string; subjectId: string; attempt: number },
): number {
  return (
    compareCodeUnits(left.phase, right.phase) ||
    compareCodeUnits(left.subjectId, right.subjectId) ||
    left.attempt - right.attempt
  );
}

class VerifierHost implements VerifierHostHandle {
  private readonly inventory: ToolInventory;
  private readonly toolTree: string | null;
  private readonly baseDir: string;
  private readonly parentEnv: OptionalEnvValues;
  private readonly toolchainAccess: FrozenToolchainAccess;
  /** Read roots every tool run reopens: the candidate's `.toolchain` tree and the host installs. */
  private readonly readRoots: string[];
  private readonly osIsolation: VerifierOsIsolation;
  private readonly requireOsSandbox: boolean;
  private readonly usedTools = new Map<string, ToolEntry>();
  private readonly bindings = new Map<string, ExecutedCheckBinding>();
  private readonly evidenceLog: VerifierExecutionEvidence[] = [];
  /** Installed-tool runs by the question they asked: executable, arguments, inputs and timeout. */
  private readonly answers = new Map<string, Promise<ToolRunResult>>();
  private readonly lifetime: VerifierLifetime | null;
  private readonly toolRunMs: number;

  constructor(options: VerifierHostOptions) {
    const inventory: ToolInventory = Object.create(null);
    for (const [id, entry] of Object.entries(options.inventory ?? {})) inventory[id] = { ...entry };
    this.inventory = inventory;
    this.toolTree = options.toolTree ?? null;
    this.baseDir = options.baseDir ?? tmpdir();
    this.parentEnv = options.parentEnv ?? Bun.env;
    this.toolchainAccess = frozenToolchainAccess(this.parentEnv.HOME);
    this.readRoots = [
      ...new Set([...(this.toolTree === null ? [] : [this.toolTree]), ...this.toolchainAccess.installRoots]),
    ].sort();
    this.requireOsSandbox = options.requireOsSandbox ?? true;
    this.toolRunMs = options.toolRunMs ?? TOOL_TIMEOUT_CEILING_MS;
    this.lifetime =
      options.lifetime ??
      (options.baseDir !== undefined && options.requireOsSandbox === false
        ? createVerifierLifetime({ root: join(options.baseDir, ".verifier-lifetime") })
        : null);
    this.osIsolation = verifierOsIsolation({
      ...options.osSandbox,
      outerSandboxed: options.osSandbox?.outerSandboxed ?? surroundingSandbox(this.parentEnv),
    });
  }

  openSubject(subject: VerifierSubject): EvaluationScopeHandle {
    this.lifetime?.assertUsable();
    const artifactJson = capturedJsonStringify(subject.artifact) ?? "undefined";
    const publicTaskJson = subject.publicTask === null ? null : capturedJsonStringify(subject.publicTask);
    if (publicTaskJson === undefined) {
      throw new Error("verifier subject publicTask must be JSON-serializable or null");
    }
    const scope: Scope = {
      subject: capturedStructuredClone(subject),
      artifactDigest: sha256(artifactJson),
      publicTaskDigest: publicTaskJson === null ? null : sha256(publicTaskJson),
      cells: new Map(),
      inFlight: new Set(),
      tail: Promise.resolve(),
      pendingAtClose: 0,
      closed: false,
      children: new Set(),
      receipts: new Set(),
    };
    for (const check of scope.subject.checks ?? []) this.checkCell(scope, check.id);
    return {
      port: {
        run: async (request) => {
          // One mutable cell serves compile-then-run chains. Queue before materialisation so
          // a parallel call cannot replace the bytes another call's evidence names.
          const snapshot = capturedStructuredClone(request);
          const pending = scope.tail.then(() => this.run(scope, snapshot));
          scope.tail = pending.then(
            () => undefined,
            () => undefined,
          );
          return this.tracked(scope, pending);
        },
        abandon: () => this.forceClose(scope),
      },
      close: async () => {
        if (!scope.closed) this.forceClose(scope);
        while (scope.inFlight.size > 0) await Promise.allSettled(scope.inFlight);
        const receiptIds = (this.lifetime?.pendingReceipts() ?? []).filter((id) => scope.receipts.has(id));
        if (receiptIds.length === 0) {
          for (const cell of scope.cells.values()) rmSync(cell.path, { recursive: true, force: true });
        }
        return {
          pendingInvocations: scope.pendingAtClose,
          cleanup:
            receiptIds.length === 0
              ? { state: "complete" as const }
              : { state: "pending" as const, receiptIds },
        };
      },
    };
  }

  private forceClose(scope: Scope): void {
    if (scope.closed) return;
    scope.closed = true;
    scope.pendingAtClose = scope.inFlight.size;
    for (const stop of scope.children) void stop().catch(() => {});
  }

  private checkCell(scope: Scope, checkId: string): ToolCell {
    const prior = scope.cells.get(checkId);
    if (prior !== undefined) return prior;
    const inputs = checkToolInputs(scope.subject, checkId);
    const cell = { ...inputs, path: mkdtempSync(join(this.baseDir, "ana-cell-")) };
    scope.cells.set(checkId, cell);
    return cell;
  }

  executedBindings(): ExecutedCheckBinding[] {
    return [...this.bindings.values()].sort(bySubject);
  }

  tools(): Record<string, ToolEntry> {
    return Object.fromEntries([...this.usedTools].map(([id, entry]) => [id, { ...entry }]));
  }

  evidence(): VerifierExecutionEvidence[] {
    return [...this.evidenceLog].sort(bySubject);
  }

  private tracked(scope: Scope, run: Promise<ToolRunResult>): Promise<ToolRunResult> {
    const logged = run.then((result) => {
      this.evidenceLog.push(result.evidence);
      return result;
    });
    if (scope.closed) return logged;
    const tracked = logged.finally(() => scope.inFlight.delete(tracked));
    scope.inFlight.add(tracked);
    return tracked;
  }

  /** Resolve this run's executable and report invalid tool requests as authoring errors. */
  private resolveTool(cell: ToolCell, request: ToolRunRequest): ResolvedTool {
    if (!isString(request?.toolId) || request.toolId === "") {
      authoringDefect("toolId must name an inventory tool or a cell file");
    }
    if (request.toolId.startsWith(CELL_TOOL_PREFIX)) {
      const rel = cellRelativePath(request.toolId.slice(CELL_TOOL_PREFIX.length));
      if (rel === null) authoringDefect(`"${request.toolId}" is not a cell-relative path`);
      const path = join(cell.path, rel);
      let resolved: string | null = null;
      try {
        resolved = realpathSync(path);
      } catch (cause) {
        if (errorCode(cause) !== "ENOENT") {
          authoringDefect(`cell tool "${request.toolId}" physical path could not be verified`);
        }
      }
      if (resolved !== null) {
        const fromCell = relative(realpathSync(cell.path), resolved);
        if (fromCell === ".." || fromCell.startsWith(`..${sep}`) || isAbsolute(fromCell)) {
          authoringDefect(`cell tool "${request.toolId}" resolves outside its evaluate scope`);
        }
      }
      let digest: string | null = null;
      try {
        if (statSync(path).isFile()) digest = sha256OfFile(path);
      } catch {
        digest = null;
      }
      return {
        entry: { id: request.toolId, path, digest: digest ?? "", source: "host", ...toolProvenance(path) },
        source: "cell",
      };
    }
    const entry = Object.hasOwn(this.inventory, request.toolId) ? this.inventory[request.toolId] : undefined;
    if (entry === undefined) {
      authoringDefect(
        `toolId "${request.toolId}" is not in the resolved tool inventory — declare it on the check and install it under .toolchain or on the host path`,
        "verifier-tool-binding",
      );
    }
    return { entry, source: entry.source };
  }

  private validateInputs(cell: ToolCell, request: ToolRunRequest): RunInputs {
    if (!isString(request.checkId) || request.checkId.trim() === "") {
      authoringDefect("checkId must name the truth check this run grounds");
    }
    const args = request.args ?? [];
    if (!Array.isArray(args) || args.some((arg) => !isString(arg))) {
      authoringDefect("args must be an array of strings");
    }
    const violation = toolInputViolation(request, cell.leaves, cell.inputKind);
    if (violation !== null) authoringDefect(violation, "verifier-tool-input");
    const files: Record<string, string> = Object.create(null);
    const inputPaths = new Set<string>();
    for (const [name, content] of Object.entries(request.files ?? {})) {
      const rel = cellRelativePath(name);
      if (rel === null) authoringDefect(`file "${name}" is not a cell-relative path`);
      if (Object.hasOwn(files, rel)) authoringDefect(`multiple input names resolve to "${rel}"`);
      files[rel] = content;
      for (const path of cell.leaves.get(content) ?? ["authored:derived"]) inputPaths.add(path);
    }
    const stdin = request.stdin ?? null;
    if (stdin !== null) {
      for (const path of cell.leaves.get(stdin) ?? ["authored:derived"]) inputPaths.add(path);
    }
    return { args: [...args], files, stdin, inputPaths: [...inputPaths].sort(compareCodeUnits) };
  }

  private async run(scope: Scope, request: ToolRunRequest): Promise<ToolRunResult> {
    const { subject } = scope;
    if (scope.closed) {
      const base = this.evidenceBase(
        scope,
        {
          toolId: isString(request?.toolId) ? request.toolId : "",
          checkId: isString(request?.checkId) ? request.checkId : "",
        },
        { args: [], files: {}, stdin: null, inputPaths: [] },
        null,
      );
      return nonResult(
        unspawned(base),
        "sandbox",
        `tool run for check "${base.checkId}" arrived after its evaluate scope closed — a fire-and-forget run grounds nothing; failing closed without spawning`,
      );
    }
    const cell = this.checkCell(scope, request.checkId);
    const { entry, source } = this.resolveTool(cell, request);
    const inputs = this.validateInputs(cell, request);
    const { args, files, stdin } = inputs;
    const timeoutMs = resolveToolTimeoutMs(request.timeoutMs, this.toolRunMs);
    let base = this.evidenceBase(
      scope,
      request,
      inputs,
      { command: entry.path, source, kind: entry.kind },
      cell,
    );
    const replay = cell.ran;
    cell.ran = null;
    if (replay) {
      const replayed = await this.run(scope, replay);
      this.evidenceLog.push(replayed.evidence);
      if (replayed.nonResult !== null) {
        return nonResult(
          unspawned(base),
          replayed.nonResult.kind,
          `the reused first run of check "${request.checkId}" did not replay: ${replayed.nonResult.message}`,
        );
      }
    }
    for (const [rel, content] of Object.entries(files)) writeCellInput(cell.path, rel, content);
    // Re-hash the executable immediately before spawning: the inventory digest was taken at snapshot
    // time, and a tool whose bytes moved since is no longer the measured condition.
    let liveDigest: string | null;
    try {
      liveDigest = sha256OfFile(entry.path);
    } catch (error) {
      return nonResult(
        unspawned(base),
        "verifierUnavailable",
        `tool "${request.toolId}" at ${entry.path} could not be read (${errorCode(error) ?? String(error)})`,
      );
    }
    base = { ...base, toolDigest: liveDigest };
    const moved = source === "cell" ? null : movedSinceSnapshot(entry, liveDigest, this.toolTree);
    if (moved !== null) {
      return nonResult(
        unspawned(base),
        "sandbox",
        `tool "${request.toolId}" ${moved} since the candidate snapshot; refusing to run an unverified tool`,
      );
    }
    // One host serves one census or solvability pass, whose checks often ask a tool the same question:
    // design-lightweight-steel-trusses-3fd52f9e-16 ran one truss-nlfea analysis for four checks of
    // every control and met its census wall. A cell's first run is answered from an earlier executed
    // identical run; a cell program's path names its own cell, so it never matches, and a non-result
    // answers nothing, so the next identical request runs afresh.
    const question = hashJsonBytes({
      command: entry.path,
      liveDigest,
      args,
      filesDigest: base.filesDigest,
      stdinDigest: base.stdinDigest,
      timeoutMs,
    });
    // No await unless an earlier run exists: a yield here would let the scope close before the child is tracked.
    // A scope closed while it waits stops waiting at once; the earlier run still settles for its own scope.
    const pending = replay === undefined ? this.answers.get(question) : undefined;
    const earlier =
      pending &&
      (await new Promise<ToolRunResult | null>((resolve) => {
        const stop = async () => {
          resolve(null);
          return null;
        };
        scope.children.add(stop);
        void pending.then(resolve, () => resolve(null)).finally(() => scope.children.delete(stop));
      }));
    let result: ToolRunResult;
    if (earlier?.executed === true) {
      cell.ran = request;
      const { phase, subjectId, attempt, requestId, sandbox, sandboxPolicyHash } = earlier.evidence;
      result = {
        ...earlier,
        evidence: {
          ...earlier.evidence,
          ...base,
          sandbox,
          sandboxPolicyHash,
          durationMs: 0,
          reusedFrom: { phase, subjectId, attempt, requestId },
        },
      };
    } else {
      const launched = this.spawn({
        scope,
        cell,
        toolId: request.toolId,
        base,
        command: entry.path,
        args,
        stdin,
        timeoutMs,
      });
      if (replay === undefined) this.answers.set(question, launched);
      result = await launched;
    }
    if (result.executed && !scope.closed) {
      if (source !== "cell") this.usedTools.set(request.toolId, { ...entry, digest: liveDigest });
      this.bindings.set(
        `${subject.phase}\u0000${subject.subjectId}\u0000${String(subject.attempt)}\u0000${request.checkId}\u0000${request.toolId}`,
        {
          phase: subject.phase,
          subjectId: subject.subjectId,
          attempt: subject.attempt,
          checkId: request.checkId,
          adapterId: request.toolId,
        },
      );
    }
    return result;
  }

  private evidenceBase(
    scope: Scope,
    { toolId, checkId }: Pick<ToolRunRequest, "toolId" | "checkId">,
    { args, files, stdin, inputPaths }: RunInputs,
    tool: EvidenceTool | null,
    cell?: ToolCell,
  ): EvidenceBase {
    const { subject } = scope;
    const filesDigest = Object.keys(files).length === 0 ? null : hashJsonBytes(files);
    const stdinDigest = stdin === null ? null : sha256(stdin);
    const inputDigests =
      cell === undefined
        ? {}
        : {
            inputKind: cell.inputKind,
            hiddenInputDigest: cell.hiddenInputDigest,
            artifactInputDigest: cell.artifactInputDigest,
            publicTaskInputDigest: cell.publicTaskInputDigest,
          };
    const requestDigest = hashJsonBytes({
      ...inputDigests,
      toolId,
      checkId,
      args,
      filesDigest,
      stdinDigest,
      artifactDigest: scope.artifactDigest,
      publicTaskDigest: scope.publicTaskDigest,
    });
    return {
      ...inputDigests,
      toolId,
      checkId,
      requestId: `req-${requestDigest.slice(0, 32)}`,
      runId: subject.runId,
      phase: subject.phase,
      subjectId: subject.subjectId,
      attempt: subject.attempt,
      artifactDigest: scope.artifactDigest,
      publicTaskDigest: scope.publicTaskDigest,
      command: tool?.command ?? "",
      args,
      toolDigest: null,
      toolSource: tool?.source ?? null,
      toolKind: tool?.kind ?? null,
      inputPaths,
      filesDigest,
      stdinDigest,
      sandbox: "workdir+env-allowlist",
      sandboxPolicyHash: null,
      requestDigest,
    };
  }

  /** Applies the wall and starts one installed or cell tool in its cell. */
  private async spawn(launch: ToolLaunch): Promise<ToolRunResult> {
    const { scope, cell, toolId, command, args, stdin, timeoutMs } = launch;
    // The wall's own evidence is folded into `base` before the child starts.
    let base = launch.base;
    const env = engineCellEnv({
      toolchainEnv: this.toolchainAccess.environment,
      toolTree: this.toolTree,
      workdir: cell.path,
      requireOsSandbox: this.requireOsSandbox,
    });
    let spawnCommand = command;
    let spawnArgs = args;
    let plan: VerifierOsIsolationPlan | null = null;
    if (this.requireOsSandbox) {
      const prepared = this.osIsolation.prepare({
        workdir: cell.path,
        resolvedCommand: command,
        engineArgs: args,
        attestedFiles: [],
        sandboxReadRoots: this.readRoots,
        environment: env,
      });
      if ("unsupported" in prepared) {
        return nonResult(
          unspawned(base),
          "sandbox",
          `tool "${toolId}" ${this.osIsolation.requires}: ${prepared.unsupported}; failing closed without spawning`,
        );
      }
      const applied = await prepared.apply();
      if (!applied.ok) {
        return nonResult(
          unspawned(base),
          "sandbox",
          `tool "${toolId}" ${this.osIsolation.requires}: ${applied.reason}; failing closed without spawning`,
        );
      }
      base = { ...base, sandbox: this.osIsolation.id, sandboxPolicyHash: prepared.policyHash };
      const drift = prepared.verify();
      if (drift !== null) {
        return nonResult(unspawned(base), ...wallDriftOutcome(toolId, drift, "before spawn"));
      }
      spawnCommand = prepared.command;
      spawnArgs = prepared.args;
      plan = prepared;
    }
    // A shared earlier run, a replay or the wall's apply can each outlive the scope: a closed scope starts nothing.
    if (scope.closed) {
      return nonResult(
        unspawned(base),
        "sandbox",
        `tool run for check "${base.checkId}" outlived its evaluate scope; failing closed without spawning`,
      );
    }
    if (this.lifetime === null) throw new VerifierOperationalStop("no-lifetime", []);
    const startedAt = Date.now();
    const lease = this.lifetime.begin({ role: "tool", cell: cell.path, requestDigest: base.requestDigest });
    scope.receipts.add(lease.id);
    let child: Bun.Subprocess<"ignore" | Uint8Array<ArrayBuffer>, "pipe", "pipe">;
    try {
      child = Bun.spawn({
        cmd: [spawnCommand, ...spawnArgs],
        cwd: cell.path,
        env,
        detached: true,
        stdin: stdin === null ? "ignore" : new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      settleUnspawned(lease);
      const code = errorCode(error);
      const unplanned = code === "ENOENT" ? "verifierUnavailable" : "crash";
      const kind: VerifierExecutionNonResultKind = plan === null ? unplanned : "sandbox";
      return nonResult(
        { ...unspawned(base), durationMs: Date.now() - startedAt },
        kind,
        "tool failed to spawn (" + (code ?? errorMessage(error)) + ")",
      );
    }
    const output = captureToolOutput(child);
    const lifetime = superviseVerifierProcess(child, lease, output, timeoutMs);
    scope.children.add(lifetime.stop);
    try {
      lease.spawned(child.pid);
      const observed = await lifetime.done;
      if (!observed.groupReaped) this.forceClose(scope);
      return settledToolResult(base, toolId, observed, output, { startedAt, timeoutMs, plan });
    } catch (error) {
      await lifetime.stop().catch(() => {});
      this.forceClose(scope);
      throw error;
    } finally {
      scope.children.delete(lifetime.stop);
    }
  }
}
