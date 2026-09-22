/**
 * Tool-run types. A check that needs external software asks the host to run an installed tool; the
 * host resolves the executable, applies isolation, starts the process and records its result.
 * External evidence binds tool inputs to declared artifact and public bytes; authored computation
 * may build private inputs from its check-local operands, and the receipt names which mode ran.
 */
import type { VerifierExecutionNonResultKind } from "./correctness-model-result.ts";
import type { VerifierCleanup } from "./verifier-lifetime.ts";
import type { BriefTruthCheck } from "../truth/brief.ts";

/**
 * What either wall mechanism is asked to confine: one resolved command and its arguments, the
 * directory it runs in, the exact files it may read and the roots those reads may come from.
 * Declared once so Darwin, Bubblewrap and their shared read preparation cannot drift.
 */
export interface VerifierConfinementRequest {
  workdir: string;
  resolvedCommand: string;
  engineArgs: string[];
  attestedFiles: string[];
  sandboxReadRoots: string[];
}

/** One installed tool the host may run, resolved once when the candidate snapshot is made. */
export interface ToolEntry {
  id: string;
  /** Absolute path of the executable the id resolved to. */
  path: string;
  /** sha256 of the executable bytes at resolution; re-checked before every spawn. */
  digest: string;
  /** Where the id resolved: the candidate workspace's `.toolchain` tree, or the host PATH. */
  source: "workspace-toolchain" | "host";
  /** A compiled binary or a text script behind a shebang, which `source` alone cannot tell apart. */
  kind: "binary" | "script";
  /** The shebang command's basename for a script (`python3`, `sh`); null for a binary. */
  interpreter: string | null;
  /** sha256 of that interpreter's bytes as the cell's search path resolved it at snapshot time;
   *  absent for a binary or an interpreter that could not be found. */
  interpreterDigest?: string;
}

/** toolId → resolved entry. toolId is the adapterId a brief's external-verifier declaration
 *  names — one namespace, so a declared grounding and its execution evidence join by id. */
export type ToolInventory = Record<string, ToolEntry>;

/** A generated check's tool request: which tool to run and which check it serves. */
export interface ToolRunRequest {
  /** An inventory id, or a file an earlier run of this check produced inside the cell, named
   *  as `cell:<relative path>` (a compiled program, for example). */
  toolId: string;
  /** The brief truth check this run grounds. Runs are check-bound: a run for check A never
   *  grounds check B. */
  checkId: string;
  args?: readonly string[];
  /** Files written into the cell before the tool starts, relative path → content. Every content
   *  must be a string. External checks require a string leaf or JSON of their declared artifact/
   *  public projection; authored checks may construct inputs from their confined check operands. */
  files?: Record<string, string>;
  /** Omit for no input. Supplied bytes, including an empty string, obey the same binding as `files`. */
  stdin?: string;
  /** Timeout for this run; defaults to and is capped at `TOOL_TIMEOUT_CEILING_MS`. */
  timeoutMs?: number;
}

export interface ToolRunResult {
  /** True when the tool completed under the isolation with confirmed process/output cleanup and
   *  no timeout. A rejecting exit is still a result; cell programs may also finish by signal. */
  executed: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** Present when no completed run exists: tool missing, wall refused, timeout, spawn failure. */
  nonResult: { kind: VerifierExecutionNonResultKind; message: string } | null;
  evidence: VerifierExecutionEvidence;
}

/**
 * The subject being verified, bound by the runner around every evaluate() call. Generated code
 * cannot see or set it, so a tool always runs over the artifact the runner is verifying.
 */
export interface VerifierSubject {
  /** Controller-selected applicable checks. Null is reserved for direct host probes. */
  checks: readonly BriefTruthCheck[] | null;
  runId: string | null;
  phase: "discrimination" | "solvability" | "battery";
  /** caseId (battery) or controlId (discrimination) — the evidence-chain join key. */
  subjectId: string;
  /** Evaluate-call ordinal within this subject. */
  attempt: number;
  /** The canonical artifact under evaluate — generated code cannot replace it. */
  artifact: unknown;
  /** Exact public task projection under evaluate; null only for host probes. */
  publicTask: unknown;
  /** Captured private operands; each check receives only its declared row. Absent in direct probes. */
  hidden?: unknown;
}

/** What the host actually provided for one run. */
export type VerifierSandboxLevel = "workdir+env-allowlist" | "darwin-seatbelt/v1" | "linux-bwrap/v1";

/** Protected execution facts. Args, stderr and process receipts may contain input or host details;
 * model-visible readers must use the dedicated public projections. */
export type VerifierExecutionEvidence = {
  toolId: string;
  checkId: string;
  /** The request digest (`req-` + requestDigest prefix), stable across identical retries. */
  requestId: string;
  runId: string | null;
  phase: "discrimination" | "solvability" | "battery";
  subjectId: string;
  attempt: number;
  /** Host-derived sha256 of the canonical artifact this run saw. */
  artifactDigest: string;
  publicTaskDigest: string | null;
  /** Canonical commitments to this check's projected tool operands. Absent on a tool run no host-bound
   *  check cell selected. */
  artifactInputDigest?: string;
  publicTaskInputDigest?: string | null;
  /** Selected from the host-bound check, never the tool request. Absent with the digests above. */
  inputKind?: "authored" | "external";
  hiddenInputDigest?: string | null;
  /** The absolute executable the host spawned, or "" when nothing resolved. */
  command: string;
  args: string[];
  /** sha256 of the executable bytes the host re-hashed immediately before spawning; null when
   *  no file could be hashed. */
  toolDigest: string | null;
  toolSource: ToolEntry["source"] | "cell" | null;
  /** Binary or script, for the tool that ran; null when nothing resolved. */
  toolKind: ToolEntry["kind"] | null;
  /** Where every cell input came from, sorted: `artifact:$.path` or `task:$.path` for each
   *  string leaf `files` and `stdin` used (`artifact:$` for the projected artifact JSON). A reader sees
   *  which artifact parts a check compiled without opening them. Authored inputs additionally
   *  name their check-local hidden path or `authored:derived`; these are protected receipts. */
  inputPaths: string[];
  /** sha256 over the files map written into the cell for this run; null when none. */
  filesDigest: string | null;
  stdinDigest: string | null;
  sandbox: VerifierSandboxLevel;
  /** Present exactly when `sandbox` names an OS mechanism. */
  sandboxPolicyHash: string | null;
  /** sha256 over the tool/check ids, args, file/stdin digests and whole/projected input digests. */
  requestDigest: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  stderrTail: string;
  /** "executed" or the non-result kind — the row states its own outcome. */
  outcome: "executed" | VerifierExecutionNonResultKind;
  /** The host's own refusal sentence for a non-result. Absent on an executed run. Protected
   *  controller evidence: it never reaches model-visible text. */
  nonResultReason?: string;
  /** Protected process observations. Cancellation may leave only a prefix of output. */
  settlement?: { receiptId: string; groupReaped: boolean; outputComplete: boolean };
  /** The earlier identical run of the same host that answered this request without spawning;
   *  process facts and settlement are that run's. */
  reusedFrom?: {
    phase: VerifierExecutionEvidence["phase"];
    subjectId: string;
    attempt: number;
    requestId: string;
  };
};

/** One executed grounding fact: this check ran this tool for this exact evaluate to completion. */
export interface ExecutedCheckBinding {
  phase: VerifierExecutionEvidence["phase"];
  subjectId: string;
  attempt: number;
  checkId: string;
  adapterId: string;
}

/** The evaluator-facing contract. Evidence readers live on the runner's handle, out of generated
 *  code's reach; each port belongs to exactly one evaluate scope. */
interface VerifierPort {
  /** Run an installed tool for one truth check inside this scope's cell. Throws on an unknown
   *  toolId or empty checkId — authoring defects, never environment facts. A call made after the
   *  owning scope closed fails closed as a sandbox non-result without spawning. */
  run(request: ToolRunRequest): Promise<ToolRunResult>;
  /** Close the scope before the evaluate returns: a run still in flight records evidence but binds
   *  nothing. */
  abandon(): void;
}

/** One evaluate call's handle. The runner opens it immediately before evaluate(), provides only
 *  its port, and closes it in `finally` — on return, non-result and throw alike. */
export interface EvaluationScopeHandle {
  port: VerifierPort;
  /** Settle runs still in flight, remove cells once cleanup is confirmed, and report how many
   *  invocations the evaluator left unread. */

  close(): Promise<{ pendingInvocations: number; cleanup?: VerifierCleanup }>;
}

/** The runner-facing handle: per-evaluate scope creation plus every run-level evidence reader. */
export interface VerifierHostHandle {
  openSubject(subject: VerifierSubject): EvaluationScopeHandle;
  /** (phase, subject, attempt, checkId, toolId) facts that ran to completion through this host instance. */
  executedBindings(): ExecutedCheckBinding[];
  /** The inventory entry of every tool that ran to completion, keyed by toolId — the
   *  verifierEnvironmentHash input. */
  tools(): Record<string, ToolEntry>;
  /** Every run's evidence in order, executed and non-result alike. */
  evidence(): VerifierExecutionEvidence[];
}

/** The controller-owned capability supplied to generated check functions. */
export interface VerifierRuntime {
  tools: VerifierPort;
}
