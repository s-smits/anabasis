import { keyIfDefined } from "./optional-key.ts";
import { basename, join } from "./path.ts";
import { runtimeProcess } from "./process.ts";
import { errorCode, errorMessage, type RuntimeSignal } from "./runtime-values.ts";

/** Capture at load so replacing process.kill later cannot hide a surviving process group.
 *  test/trusted-runtime.test.ts replaces it and checks that the group is still detected. */
const processKill = runtimeProcess.kill.bind(runtimeProcess);

/**
 * How much output a captured command may produce before it is stopped.
 *
 * Bun 1.4.2 caps nothing by default — measured, an 80 MB stdout came back whole — so without this
 * a runaway command is a host process holding its entire output in memory. Past the cap Bun kills
 * the child, and `runSyncOrThrow` reports the capture rather than that kill, because the kill is a
 * race the child can win. Four callers spelled this number out beside a comment claiming the
 * default truncates at 1 MiB, which is Node's contract rather than Bun's, and none of them had
 * ever been reached.
 */
export const CAPTURE_MAX_BYTES = 64 * 1024 * 1024;

type RunSyncOptions = {
  input?: string | Uint8Array;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  maxBuffer?: number;
};

/**
 * `exitCode` is null when a signal, a timeout or a failed spawn ended the command, and `cappedAt`
 * carries the `maxBuffer` a capture reached, whichever ending the child itself got.
 */
type RunSyncResult = {
  cappedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

/** The exact shape `runSync` hands to `Bun.spawnSync`, mutable so optional keys stay absent. */
type SpawnSyncOptions = {
  cmd: string[];
  stdin: Uint8Array;
  stdout: "pipe";
  stderr: "pipe";
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  maxBuffer?: number;
};

/** Signal one exact controller-owned process identity: its group, or the process alone when it
 *  leads no group. Bubblewrap's confined command sits below the namespace init that took the
 *  session, so its own pid is the only identity the host can signal. */
export function killProcessGroupId(processGroupId: number, signal: RuntimeSignal): boolean {
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 1) return false;
  for (const target of [-processGroupId, processGroupId]) {
    try {
      processKill(target, signal);
      return true;
    } catch {
      // an exited group is reported as false below
    }
  }
  return false;
}

/** Kill the child's whole process group, falling back to the child alone when no group exists. */
export function killProcessGroup(child: Bun.Subprocess, signal: RuntimeSignal): void {
  if (killProcessGroupId(child.pid, signal)) return;
  try {
    child.kill(signal);
  } catch {
    // the child may already have exited
  }
}

/** Whether any process still belongs to the group, or the process itself is still there; EPERM
 *  proves a live member the caller may not signal. */
export function processGroupExists(processGroupId: number): boolean {
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 1) return false;
  return [-processGroupId, processGroupId].some((target) => {
    try {
      processKill(target, 0);
      return true;
    } catch (error) {
      return errorCode(error) === "EPERM";
    }
  });
}

/** Terminate and verify one exact group when isolation puts the worker below a wrapper process. */
export async function terminateAndReapProcessGroupId(processGroupId: number): Promise<boolean> {
  if (!processGroupExists(processGroupId)) return true;
  killProcessGroupId(processGroupId, "SIGTERM");
  for (let elapsed = 0; elapsed < 100 && processGroupExists(processGroupId); elapsed += 10) {
    await Bun.sleep(10);
  }
  if (!processGroupExists(processGroupId)) return true;
  killProcessGroupId(processGroupId, "SIGKILL");
  for (let elapsed = 0; elapsed < 500 && processGroupExists(processGroupId); elapsed += 10) {
    await Bun.sleep(10);
  }
  return !processGroupExists(processGroupId);
}

/** Terminate every same-group descendant and verify the group is gone before accepting output. */
export async function terminateAndReapProcessGroup(child: Bun.Subprocess): Promise<boolean> {
  return await terminateAndReapProcessGroupId(child.pid);
}

const EMPTY = new Uint8Array();

/**
 * Run a command to completion and capture both streams. A non-zero exit, a signal and a command
 * that never started are all reported rather than thrown, so a probe can record a host gap.
 */
export function runSync(cmd: readonly string[], options: RunSyncOptions = {}): RunSyncResult {
  const { input } = options;
  const spawnOptions: SpawnSyncOptions = {
    cmd: [...cmd],
    stdin:
      input === undefined
        ? new Uint8Array()
        : input instanceof Uint8Array
          ? input
          : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    ...keyIfDefined("cwd", options.cwd),
    ...keyIfDefined("env", options.env),
    ...keyIfDefined("timeout", options.timeout),
    ...keyIfDefined("maxBuffer", options.maxBuffer),
  };
  try {
    const result = Bun.spawnSync(spawnOptions);
    // Bun enforces `maxBuffer` by killing the child, and on a loaded host the child can finish
    // first: the kill never lands, `signalCode` is null, and a capture that may be short comes
    // back behind a zero exit — the silent truncation the cap exists to prevent, and a gate
    // failure on 2026-09-20 under a load average of 26 on 12 cores. The captured length is the
    // fact and the signal is the race, so a capture at or past the cap is the ending even where
    // those bytes were all there was. Bun reads in 64 KiB chunks and does not clamp to the cap,
    // so the length is a lower bound on what the command wanted to write.
    const { maxBuffer } = options;
    const cappedAt = maxBuffer !== undefined && result.stdout.length >= maxBuffer ? maxBuffer : null;
    return {
      cappedAt,
      exitCode: result.signalCode == null ? result.exitCode : null,
      signal: result.signalCode ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    // A command that never started has no streams of its own, so its stderr is why: without this
    // the caller was told `git exited null` with nothing after the colon, for every missing tool,
    // unreadable cwd and bad argument shape alike.
    const reason = new TextEncoder().encode(errorMessage(error));
    return { cappedAt: null, exitCode: null, signal: null, stdout: EMPTY, stderr: reason };
  }
}

/**
 * Run a command and return its stdout bytes, throwing with the captured stderr on any failure.
 *
 * The four endings are four different problems and the message names which: a command that ran
 * and refused, one the host stopped on a timeout, one whose capture reached `maxBuffer`, and one
 * that never started. The cap is read first because it is the only one of the four a zero exit can
 * hide. `basename` keeps the resolved path `hostTool` hands over from turning every git refusal
 * into a sentence beginning with the Xcode developer directory.
 */
export function runSyncOrThrow(cmd: readonly string[], options: RunSyncOptions = {}): Uint8Array {
  const result = runSync(cmd, options);
  if (result.cappedAt !== null || result.exitCode !== 0) {
    const exited = result.exitCode === null ? "could not start" : `exited ${result.exitCode}`;
    const stopped = result.signal === null ? exited : `died on ${result.signal}`;
    const ending = result.cappedAt === null ? stopped : `filled its ${result.cappedAt}-byte capture`;
    throw new Error(`${basename(cmd[0] ?? "")} ${ending}: ${decodeOutput(result.stderr).trim()}`);
  }
  return result.stdout;
}

/** Decode captured command bytes as UTF-8 text. */
export function decodeOutput(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Run a command and return its stdout as UTF-8 text, throwing on any failure. */
export function runTextSyncOrThrow(cmd: readonly string[], options: RunSyncOptions = {}): string {
  return decodeOutput(runSyncOrThrow(cmd, options));
}

/**
 * Bundle one entry point into the worker file a confined child runs, and return that file's path.
 *
 * Three callers build a worker — the Pi Built child, the generated tool worker and the evaluator —
 * and until 2026-09-20 each spelled the same seven build options itself. The options are a decision
 * rather than a default: the child is launched by the returned name, and a `format`, `target` or
 * `splitting` that drifted in one copy would break that one child at runtime with no build error.
 * It lives beside the process-group owner because the bundle is the image those children run.
 */
export async function buildWorkerBundle(
  failure: string,
  entrypoint: string,
  outdir: string,
  plugins: Bun.BunPlugin[] = [],
): Promise<string> {
  const naming = "worker.mjs";
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    naming,
    target: "bun",
    format: "esm",
    splitting: false,
    sourcemap: "none",
    plugins,
  });
  if (result.success) return join(outdir, naming);
  throw new Error(`${failure}: ${result.logs.map((log) => log.message).join("; ")}`);
}
