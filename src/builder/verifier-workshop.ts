/**
 * The Builder's verifier workshop execution owner. A Builder has to install the domain's real tools
 * before it can write checks around them, so it needs somewhere to fetch, unpack, build and smoke
 * test third-party source: a controller broker acquires the public HTTPS bytes, and every
 * inspection, setup step and smoke test after that runs in one deny-default cell.
 *
 * Each action appends a typed row to controller evidence — its outcome, its reason and the digests
 * of policy, request and result — so what the workshop did stays readable after the session that
 * did it. None of that admits a verifier: workshop completion says a tool builds and answers, not
 * that a submitted artifact is correct.
 */
import { keyIfDefined, keyIfNotNull } from "../meta/optional-key.ts";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "../meta/filesystem.ts";
import { basename, dirname, join, relative } from "../meta/path.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { sha256 } from "../meta/digest.ts";
import { hashJsonBytes, capturedJsonStringify } from "../meta/json-runtime.ts";
import type { RuntimeSignal } from "../meta/runtime-values.ts";
import {
  CandidateIsolationRefusal,
  CandidateIsolationUnavailable,
  ISOLATED_OUTPUT_MAX,
  type PathRecord,
  type IsolatedOutcome,
  type IsolatedRequest,
  runIsolated,
} from "./candidate-isolation-runtime.ts";
import type { CandidateAccessPolicy } from "./candidate-isolation.ts";
import { type PublicSourceBroker, PublicSourceFailure, acquirePublicSource } from "./public-source.ts";
import { readWindow } from "./read-window.ts";
import { truncateTail } from "./pi-coding/truncate.ts";
import { cutOutputNotice } from "./tool-write.ts";
import {
  VerifierWorkshopRequestRefusal,
  actionRequestDigest,
  existingWorkshopPath,
  verifierWorkshopCommand,
  verifierWorkshopContent,
  type VerifierWorkshopRequest,
  workshopEnvironment,
  workshopPath,
} from "./verifier-workshop-input.ts";
import type {
  VerifierWorkshopAction,
  VerifierWorkshopActionEvidence,
  VerifierWorkshopReason,
} from "./verifier-workshop-evidence.ts";
import { surveyVerifierSource } from "./verifier-workshop-survey.ts";
import { exportWorkshopFile, type WorkshopExportBinding } from "./verifier-workshop-export.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { VERIFIER_WORKSHOP } from "./capability-modes.ts";

/** The most text a write or a run's stdin may carry. A read is bounded by the capture instead,
 *  since it pages what it returns. */
const MAX_TEXT_INPUT = 256 * 1024;
const MAX_COMMAND = 32 * 1024;
const PUBLIC_OUTPUT = 16 * 1024;
/** Where a cut run's whole captured output is kept: inside the workshop, because the ordinary
 *  workspace tools cannot read `.oss` and the workshop read can, and dot-prefixed to keep it apart
 *  from the unpacked sources. */
const RUN_OUTPUT_DIR = ".run-output";
const RUN_OUTPUT_PAGER = "page it with verifier_workshop read, offset and limit";
let runOutputSeq = 0;
const OUTCOME_WORD = { failed: "FAILED", "non-result": "NON-RESULT" } as const;

export type VerifierWorkshopRunner = (
  policy: CandidateAccessPolicy,
  record: PathRecord,
  request: IsolatedRequest,
) => Promise<IsolatedOutcome>;

interface VerifierWorkshopOptions {
  root: string;
  evidencePath: string;
  policy: CandidateAccessPolicy;
  record: PathRecord;
  runner?: VerifierWorkshopRunner;
  sourceBroker?: PublicSourceBroker;
  exportBinding?: WorkshopExportBinding;
}

interface VerifierWorkshopResult {
  text: string;
  details: {
    evidenceSchema: string;
    resultDigest: string;
    sequence: number;
    receipt: {
      outcome: "completed" | "failed" | "non-result";
      resultDigest: string;
      /** Host-authored action identity, shared with verifier-workshop.jsonl. */
      workshopSequence: number;
      subjectDigest?: string;
      reason?: string;
    };
  };
}

export interface VerifierWorkshop {
  fetch(url: string, signal?: AbortSignal): Promise<VerifierWorkshopResult>;
  inspect(path?: string): Promise<VerifierWorkshopResult>;
  read(path: string, offset?: number, limit?: number): Promise<VerifierWorkshopResult>;
  write(path: string, content: string): Promise<VerifierWorkshopResult>;
  run(command: string, cwd?: string, stdin?: string): Promise<VerifierWorkshopResult>;
  export(path: string, destination: string): Promise<VerifierWorkshopResult>;
}

interface WorkshopProcess {
  exitCode: number | null;
  signal: RuntimeSignal | null;
  timedOut: boolean;
  capturedStdoutBytes: number;
  capturedStderrBytes: number;
  capturedOutputBytes: number;
  captureTruncated: boolean;
  outputTruncated: boolean;
  outputMode: "complete" | "tail" | "captured-tail";
  output: string;
}

/** The process facts of a command the wall launched, recorded beside the reason: a `null` process
 *  says the wall refused before launch, an exit code says the command ran and chose it. A later
 *  reader has only the recorded evidence to draw that distinction from, which is why it is a field
 *  and not a sentence in the tool result; the output itself stays in that result. The evidence row
 *  type in verifier-workshop-evidence.ts imports this one. */
export interface WorkshopProcessFacts {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

class WorkshopIssue extends Error {
  constructor(
    readonly outcome: "failed" | "non-result",
    readonly reason: VerifierWorkshopReason,
    message: string,
    readonly process?: WorkshopProcess,
  ) {
    super(message);
  }
}

/** The process facts and the public tail of one command, whole lines where a line fits. `notice`
 *  is the cut line the caller composed once it knew whether the whole output was stored. */
function processSummary(
  outcome: IsolatedOutcome,
  tail: ReturnType<typeof truncateTail>,
  notice: string,
): WorkshopProcess {
  const encoder = new TextEncoder();
  const captureTruncated = outcome.stdoutTruncated || outcome.stderrTruncated;
  return {
    exitCode: outcome.status,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    capturedStdoutBytes: encoder.encode(outcome.stdout).byteLength,
    capturedStderrBytes: encoder.encode(outcome.stderr).byteLength,
    capturedOutputBytes: tail.totalBytes,
    captureTruncated,
    outputTruncated: captureTruncated || tail.truncated,
    outputMode: captureTruncated ? "captured-tail" : tail.truncated ? "tail" : "complete",
    output: notice === "" ? tail.content : `${tail.content}\n\n${notice}`,
  };
}

class Workshop implements VerifierWorkshop {
  private readonly root: string;
  private readonly runner: VerifierWorkshopRunner;
  private readonly sourceBroker: PublicSourceBroker;
  private readonly env: OptionalEnvValues;
  private sequence: number;

  constructor(private readonly options: VerifierWorkshopOptions) {
    mkdirSync(options.root, { recursive: true });
    this.root = realpathSync.native(options.root);
    this.runner = options.runner ?? runIsolated;
    this.sourceBroker = options.sourceBroker ?? acquirePublicSource;
    this.env = workshopEnvironment(this.root);
    this.sequence = existsSync(options.evidencePath)
      ? readFileSync(options.evidencePath, "utf8").split("\n").filter(Boolean).length
      : 0;
  }

  /** One command through the cell. `spill` is set by `run` alone: its output is the Builder's own
   *  build and smoke-test log, and a cut one is stored whole where the workshop read can page it. */
  private async execute(
    request: IsolatedRequest,
    accepted: readonly (number | null)[] = [0],
    policy = this.options.policy,
    runner = this.runner,
    spill = false,
  ) {
    let outcome: Awaited<ReturnType<VerifierWorkshopRunner>>;
    try {
      outcome = await runner(policy, this.options.record, request);
    } catch (error) {
      if (error instanceof CandidateIsolationUnavailable) {
        throw new WorkshopIssue("non-result", "mechanism-unavailable", error.message);
      }
      if (error instanceof CandidateIsolationRefusal) {
        throw new WorkshopIssue("non-result", "sandbox-refused", error.message);
      }
      throw new WorkshopIssue("non-result", "mechanism-unavailable", errorMessage(error));
    }
    const whole = `${outcome.stdout}${outcome.stderr}`;
    const tail = truncateTail(whole, { maxBytes: PUBLIC_OUTPUT });
    const stored = spill && tail.truncated ? await this.storeWholeOutput(whole) : null;
    const caveat =
      stored !== null && (outcome.stdoutTruncated || outcome.stderrTruncated)
        ? ` The command wrote more than the workshop captures, so the stored file stops where the ${ISOLATED_OUTPUT_MAX / (1024 * 1024)} MiB capture did.`
        : "";
    const process = processSummary(
      outcome,
      tail,
      cutOutputNotice(whole, tail, stored, RUN_OUTPUT_PAGER, caveat),
    );
    if (outcome.timedOut) throw new WorkshopIssue("non-result", "timeout", process.output, process);
    if (outcome.status === null) {
      throw new WorkshopIssue(
        "failed",
        "process-signalled",
        process.output || outcome.signal || "process signalled",
        process,
      );
    }
    if (!accepted.includes(outcome.status)) {
      throw new WorkshopIssue("failed", "command-failed", process.output, process);
    }
    return { outcome, process };
  }

  private async inspectTree(requested: string) {
    const target = existingWorkshopPath(this.root, requested);
    if (!statSync(target).isDirectory()) {
      throw new VerifierWorkshopRequestRefusal("inspect path is not a directory");
    }
    const { outcome } = await this.execute(
      {
        capability: VERIFIER_WORKSHOP,
        mode: "read",
        command: "rg",
        args: [
          "--files",
          "--hidden",
          // The enclosing checkout's Git metadata is outside the workshop's read boundary.
          "--no-ignore-vcs",
          "--glob",
          "!.git/**",
          "--glob",
          "!node_modules/**",
          "--glob",
          "!.venv/**",
          target,
        ],
        cwd: this.root,
        paths: [target],
        env: this.env,
        osRefusalIsOutcome: true,
      },
      [0, 1],
    );
    return {
      path: relative(this.root, target) || ".",
      ...surveyVerifierSource(outcome.stdout, this.root, outcome.stdoutTruncated || outcome.stderrTruncated),
    };
  }

  /** Write text through the cell, so the host's staging buys no authority the workshop's own
   *  commands do not have. */
  private async writeText(target: string, content: string): Promise<void> {
    await this.execute({
      capability: VERIFIER_WORKSHOP,
      mode: "write",
      command: "/bin/sh",
      args: ["-c", 'umask 077; /bin/cat > "$1"', "workshop-write", target],
      cwd: this.root,
      paths: [target],
      env: this.env,
      stdin: content,
    });
  }

  /** Keep a cut run's whole output under `RUN_OUTPUT_DIR` and return its workshop path. A store
   *  that fails returns null rather than failing the run: the tail and its exit facts are still the
   *  result, and the notice then names no file. */
  private async storeWholeOutput(whole: string): Promise<string | null> {
    try {
      const dir = await this.ensureDirectory(RUN_OUTPUT_DIR);
      runOutputSeq += 1;
      const target = join(dir, `run-${Date.now().toString(36)}-${runOutputSeq.toString(36)}.txt`);
      if (existsSync(target)) return null;
      await this.writeText(target, whole);
      return relative(this.root, target);
    } catch {
      return null;
    }
  }

  private async copyControllerFile(staged: string, target: string): Promise<void> {
    const parent = join(this.root, "downloads");
    await this.execute({
      capability: "public_source",
      mode: "write",
      command: "/bin/mkdir",
      args: ["-p", "downloads"],
      cwd: this.root,
      paths: [parent],
      env: this.env,
    });
    await this.execute({
      capability: "public_source",
      mode: "write",
      command: "/bin/cp",
      args: [staged, target],
      cwd: this.root,
      paths: [target],
      controllerReadFiles: [staged],
      env: this.env,
    });
  }

  /** Create a requested workshop directory through the same isolated cell that will use it, so the
   *  convenience of auto-setup buys no authority the workshop's own commands do not have. The
   *  nearest existing ancestor is resolved first, so a symlink cannot turn that creation into a
   *  path escape. */
  private async ensureDirectory(requested: string): Promise<string> {
    const lexical = workshopPath(this.root, requested);
    if (existsSync(lexical)) {
      const existing = existingWorkshopPath(this.root, relative(this.root, lexical));
      if (!statSync(existing).isDirectory()) {
        throw new VerifierWorkshopRequestRefusal("workshop directory path is not a directory");
      }
      return existing;
    }
    let ancestor = dirname(lexical);
    while (!existsSync(ancestor) && ancestor !== this.root) ancestor = dirname(ancestor);
    const physicalAncestor = existingWorkshopPath(this.root, relative(this.root, ancestor));
    if (!statSync(physicalAncestor).isDirectory()) {
      throw new VerifierWorkshopRequestRefusal("workshop directory parent is not a directory");
    }
    await this.execute({
      capability: VERIFIER_WORKSHOP,
      mode: "write",
      command: "/bin/mkdir",
      args: ["-p", relative(this.root, lexical)],
      cwd: this.root,
      paths: [lexical],
      env: this.env,
    });
    const created = existingWorkshopPath(this.root, relative(this.root, lexical));
    if (!statSync(created).isDirectory()) {
      throw new VerifierWorkshopRequestRefusal("workshop directory was not created");
    }
    return created;
  }

  private async settle<T>(
    action: VerifierWorkshopAction,
    request: VerifierWorkshopRequest,
    run: () => Promise<T>,
    readers: {
      subject?: (result: T) => string | null;
      process?: (result: T) => WorkshopProcess | null;
      origin?: (result: T) => VerifierWorkshopActionEvidence["origin"];
    } = {},
  ): Promise<VerifierWorkshopResult> {
    let body:
      | { status: "completed"; action: VerifierWorkshopAction; message: string; result: T }
      | {
          status: "failed" | "non-result";
          action: VerifierWorkshopAction;
          reason: VerifierWorkshopReason;
          message: string;
          process?: WorkshopProcess;
        };
    try {
      body = {
        status: "completed",
        action,
        message:
          action === "run"
            ? "COMPLETED — the process exited successfully. This is execution evidence, not a checker verdict or truth result."
            : `COMPLETED — ${action} completed. This is workshop evidence, not a checker verdict or truth result.`,
        result: await run(),
      };
    } catch (error) {
      if (error instanceof WorkshopIssue) {
        const issueBody: Extract<typeof body, { status: "failed" | "non-result" }> = {
          status: error.outcome,
          action,
          reason: error.reason,
          message: `${OUTCOME_WORD[error.outcome]} — ${action} did not complete. No checker verdict or truth was established.${error.message === "" ? "" : ` ${error.message}`}`,
          ...keyIfDefined("process", error.process),
        };
        body = issueBody;
      } else if (error instanceof VerifierWorkshopRequestRefusal) {
        body = {
          status: "failed",
          action,
          reason: "request-refused",
          message: `FAILED — ${action} request was refused. No checker verdict or truth was established. ${error.message}`,
        };
      } else if (error instanceof PublicSourceFailure) {
        body = {
          status: error.outcome,
          action,
          reason: error.reason,
          message: `${OUTCOME_WORD[error.outcome]} — ${action} did not complete. No checker verdict or truth was established. ${error.message}`,
        };
      } else {
        body = {
          status: "non-result",
          action,
          reason: "mechanism-unavailable",
          message: `NON-RESULT — ${action} did not complete. No checker verdict or truth was established. ${errorMessage(error)}`,
        };
      }
    }
    // What a completed result says about its own process, subject and origin; an issue carries only
    // its process.
    const read =
      body.status === "completed"
        ? {
            process: readers.process?.(body.result) ?? null,
            subject: readers.subject?.(body.result) ?? null,
            origin: readers.origin?.(body.result),
          }
        : { process: body.process ?? null, subject: null, origin: undefined };
    const { process } = read;
    const evidence: VerifierWorkshopActionEvidence = {
      schema: "verifier-workshop-action/v2",
      sequence: ++this.sequence,
      at: new Date().toISOString(),
      action,
      outcome: body.status,
      reason: body.status === "completed" ? null : body.reason,
      policyDigest:
        action === "export"
          ? (this.options.exportBinding?.policy.digest ?? this.options.policy.digest)
          : this.options.policy.digest,
      requestDigest: actionRequestDigest(action, request),
      resultDigest: hashJsonBytes(body),
      subjectDigest: read.subject,
      ...keyIfDefined("origin", read.origin),
      process:
        process === null
          ? null
          : { exitCode: process.exitCode, signal: process.signal, timedOut: process.timedOut },
    };
    appendFileSync(this.options.evidencePath, `${capturedJsonStringify(evidence)}\n`);
    const receipt: VerifierWorkshopResult["details"]["receipt"] = {
      outcome: evidence.outcome,
      resultDigest: evidence.resultDigest,
      workshopSequence: evidence.sequence,
      ...keyIfNotNull("subjectDigest", evidence.subjectDigest),
      ...keyIfNotNull("reason", evidence.reason),
    };
    return {
      text: capturedJsonStringify(body),
      details: {
        evidenceSchema: evidence.schema,
        resultDigest: evidence.resultDigest,
        sequence: evidence.sequence,
        receipt,
      },
    };
  }

  fetch(value: string, signal?: AbortSignal): Promise<VerifierWorkshopResult> {
    return this.settle(
      "fetch",
      { url: value },
      async () => {
        const source = await this.sourceBroker(value, signal);
        try {
          const target = workshopPath(this.root, join("downloads", `${source.sha256}.source`));
          if (existsSync(target)) {
            const existing = existingWorkshopPath(this.root, relative(this.root, target));
            if (sha256(readFileSync(existing)) !== source.sha256) {
              throw new WorkshopIssue(
                "failed",
                "command-failed",
                "content-addressed workshop download has different bytes",
              );
            }
          } else {
            await this.copyControllerFile(source.path, target);
          }
          const copied = existingWorkshopPath(this.root, relative(this.root, target));
          if (sha256(readFileSync(copied)) !== source.sha256) {
            throw new WorkshopIssue(
              "failed",
              "command-failed",
              "public source copy changed before settlement",
            );
          }
          return {
            path: relative(this.root, target),
            initialUrl: source.initialUrl,
            finalUrl: source.finalUrl,
            bytes: source.bytes,
            sha256: source.sha256,
          };
        } finally {
          source.cleanup();
        }
      },
      {
        subject: (result) => result.sha256,
        origin: ({ initialUrl, finalUrl }) => ({ initialUrl, finalUrl }),
      },
    );
  }

  inspect(path = "."): Promise<VerifierWorkshopResult> {
    return this.settle("inspect", { path }, () => this.inspectTree(path), {
      subject: (result) => (result.truncated ? null : result.pathDigest),
    });
  }

  export(path: string, destination: string): Promise<VerifierWorkshopResult> {
    return this.settle(
      "export",
      { path, destination },
      async () => {
        const binding = this.options.exportBinding;
        if (binding === undefined) {
          throw new VerifierWorkshopRequestRefusal(
            "candidate export is unavailable in this workshop composition",
          );
        }
        return exportWorkshopFile(this.root, binding, path, destination, async (request, policy) => {
          await this.execute(request, [0], policy, runIsolated);
        });
      },
      { subject: (result) => result.sha256 },
    );
  }

  read(path: string, offset?: number, limit?: number): Promise<VerifierWorkshopResult> {
    return this.settle(
      "read",
      { path, offset, limit },
      async () => {
        const target = existingWorkshopPath(this.root, path);
        if (!statSync(target).isFile()) throw new VerifierWorkshopRequestRefusal("read path is not a file");
        const { outcome } = await this.execute({
          capability: VERIFIER_WORKSHOP,
          mode: "read",
          command: "/bin/cat",
          args: [target],
          cwd: this.root,
          paths: [target],
          env: this.env,
        });
        // The window pages what the capture holds, so only a file past the capture is refused.
        if (outcome.stdoutTruncated) {
          throw new VerifierWorkshopRequestRefusal(
            `workshop file is larger than the ${ISOLATED_OUTPUT_MAX / (1024 * 1024)} MiB a read captures`,
          );
        }
        const bytes = new TextEncoder().encode(outcome.stdout).byteLength;
        if (outcome.stdout.includes("\0")) {
          throw new VerifierWorkshopRequestRefusal("workshop read admits text files only");
        }
        // Checker sources run to thousands of lines and rarely fit one tool result whole. The
        // window carries its own line range, so a partial read cannot pass for a complete one.
        const window = readWindow(outcome.stdout, offset, limit);
        return { path: relative(this.root, target), bytes, sha256: sha256(outcome.stdout), ...window };
      },
      { subject: (result) => result.sha256 },
    );
  }

  write(path: string, contentValue: string): Promise<VerifierWorkshopResult> {
    const contentBytes = new TextEncoder().encode(contentValue).byteLength;
    const contentSha256 = sha256(contentValue);
    return this.settle(
      "write",
      { path, contentBytes, contentSha256 },
      async () => {
        const content = verifierWorkshopContent(contentValue, MAX_TEXT_INPUT);
        const lexicalTarget = workshopPath(this.root, path);
        const physicalParent = await this.ensureDirectory(relative(this.root, dirname(lexicalTarget)));
        const target = existsSync(lexicalTarget)
          ? existingWorkshopPath(this.root, path)
          : join(physicalParent, basename(lexicalTarget));
        if (existsSync(target) && !statSync(target).isFile()) {
          throw new VerifierWorkshopRequestRefusal("write path is not a file");
        }
        await this.writeText(target, content);
        const written = readFileSync(existingWorkshopPath(this.root, relative(this.root, target)));
        const writtenSha256 = sha256(written);
        if (writtenSha256 !== contentSha256) {
          throw new WorkshopIssue("failed", "command-failed", "written workshop bytes changed");
        }
        return { path: relative(this.root, target), bytes: written.length, sha256: writtenSha256 };
      },
      { subject: (result) => result.sha256 },
    );
  }

  run(commandValue: string, cwdValue = ".", stdinValue?: string): Promise<VerifierWorkshopResult> {
    const stdinBytes = stdinValue === undefined ? null : new TextEncoder().encode(stdinValue).byteLength;
    const stdinSha256 = stdinValue === undefined ? null : sha256(stdinValue);
    return this.settle(
      "run",
      { command: commandValue, cwd: cwdValue, stdinBytes, stdinSha256 },
      async () => {
        const command = verifierWorkshopCommand(commandValue, MAX_COMMAND);
        const stdin =
          stdinValue === undefined
            ? undefined
            : verifierWorkshopContent(stdinValue, MAX_TEXT_INPUT, "run stdin");
        const cwd = await this.ensureDirectory(cwdValue);
        const request: IsolatedRequest = {
          capability: VERIFIER_WORKSHOP,
          mode: "exec",
          command: "/bin/sh",
          args: ["-c", command],
          cwd,
          paths: [cwd],
          env: this.env,
          osRefusalIsOutcome: true,
          ...keyIfDefined("stdin", stdin),
        };
        const { process } = await this.execute(request, [0], this.options.policy, this.runner, true);
        return {
          note: "Process execution only; this does not establish a checker verdict or truth.",
          ...process,
        };
      },
      { process: (result) => result },
    );
  }
}

export function createVerifierWorkshop(options: VerifierWorkshopOptions): VerifierWorkshop {
  return new Workshop(options);
}
