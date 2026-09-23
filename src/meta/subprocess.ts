import { keyIfDefined } from "./optional-key.ts";
import { basename, join } from "./path.ts";
import { runtimeProcess } from "./process.ts";
import { errorCode, errorMessage, type RuntimeSignal } from "./runtime-values.ts";

/**
 * `process.kill` as it was at load. Every group signal below goes through this reference rather
 * than through the global at call time, because whatever replaces that global also decides whether
 * a surviving process group is reported — and a replacement that throws answers that there is
 * none, which is the answer that lets a verifier accept output while a child keeps running.
 * test/trusted-runtime.test.ts installs a `poisonedKill` throwing ESRCH for every target and then
 * checks that a live detached group is still seen.
 */
const processKill = runtimeProcess.kill.bind(runtimeProcess);

/**
 * How much output a captured command may produce before it is stopped. Bun 1.4.2 caps nothing by
 * default, so without this a runaway command is a host process holding its entire output in
 * memory.
 *
 * It is stated once because four files spelled the same 64 MiB out themselves, each beside a
 * comment explaining that it stops a large working tree from truncating silently at the 1 MiB
 * default — which is Node's contract, not Bun's. There was no default to raise, so the number was
 * never the thing being defended; the cap is. test/trusted-runtime.test.ts holds that reading by
 * capturing two million bytes whole.
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

/**
 * Signal one exact controller-owned process identity: its group first, since reaching the
 * descendants a solve left behind is the whole point, then the process alone. The fallback is
 * there because a child does not always lead a group — bubblewrap's namespace init is the case
 * this meets — and without it such a child would be signalled by nobody.
 *
 * Ids of 1 and below are refused rather than passed through: `kill(-1, …)` signals every process
 * the host allows and `kill(0, …)` the caller's own group, so an id that arrived from a closed or
 * mis-read receipt would take down the controller instead of the worker. A group that has already
 * exited raises on both targets and is reported as false, which is what a caller polling for its
 * disappearance reads as gone.
 */
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

/**
 * Whether any process still belongs to the group, or the process itself is still there. Signal 0
 * runs the permission check and delivers nothing, so the question can be asked of a running child
 * without disturbing it.
 *
 * EPERM counts as alive, because it is the host saying the target exists and this process may not
 * signal it. Reading it as gone is the expensive direction: `verifier-lifetime.ts` removes a
 * verifier's working cell and writes a `groupAbsent: true` cleanup receipt on the strength of this
 * answer, so a live member declared absent means a directory deleted underneath a process that is
 * still writing to it.
 */
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

/**
 * Terminate one exact group and wait until the host agrees it is gone, escalating from SIGTERM to
 * SIGKILL. The id form exists because isolation can put the worker below a wrapper process, so the
 * group to reap is one a receipt names rather than one a `Bun.Subprocess` in hand leads.
 *
 * The first wait is short, since SIGTERM is there to let a child with a handler close its own
 * files, and the second is longer because delivery is not disappearance: a group stays visible
 * until its last member has been reaped, and returning at the syscall would report a dead group on
 * a pid the next check still finds.
 *
 * It answers with a boolean rather than throwing, because a group that will not die is a fact its
 * caller records — the verifier carries it as `groupReaped: false` in the settlement it writes —
 * and not an error that should displace whatever the command produced.
 */
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
 * that never started are all reported rather than thrown, because the callers that want a throw
 * have `runSyncOrThrow` below, while the rest ask questions whose answer may be no: `git config
 * --get` exits 1 on a key nobody set, `git rev-parse` fails outside a repository, and a cleanup
 * `git worktree remove` may find nothing to remove. Each of those is the result the caller
 * records, not an interruption of it.
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
    // Bun enforces `maxBuffer` by killing the child, so which ending the child gets is a race it
    // can win: it can finish first and exit zero with a short capture, and nothing in the exit
    // code or the signal then says the output was cut. The captured length is the one fact that
    // reads the same on both sides of that race, so it decides: a capture at or past the cap is
    // capped. A gate on 2026-09-20 under a load average of 26 is where the race was first seen,
    // against a test that had been written expecting the kill to win.
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
    // A command that never started produced no streams at all, so the spawn error is put where a
    // reader already looks. Without it the caller holds `exitCode: null` and two empty buffers,
    // which is indistinguishable from a command the host killed.
    const reason = new TextEncoder().encode(errorMessage(error));
    return { cappedAt: null, exitCode: null, signal: null, stdout: EMPTY, stderr: reason };
  }
}

/**
 * Run a command and return its stdout bytes, throwing with the captured stderr on any failure.
 *
 * The message names which of four endings happened: a non-zero exit, a signal or timeout, a
 * capture that reached `maxBuffer`, or a command that never started. Four files formatted this
 * themselves and reported one — the captured stderr, or the exit code when there was none — which
 * covers a command that ran and refused and nothing else. The two endings that leave `exitCode`
 * null with both streams empty, a missing tool and a child killed at the cap, therefore arrived
 * identically as `git exited null` with nothing after the colon. The cap is read before the exit
 * code because Bun's kill races the child's own exit, and the child winning makes that code zero.
 *
 * The command is named by its basename rather than by `cmd[0]`, because `hostTool` resolves a
 * developer tool to its absolute path: every git refusal would otherwise open with the Xcode
 * developer directory before saying anything about what went wrong.
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
 * The options are held here rather than passed in because a worker that drifts on `format`,
 * `target` or `splitting` still builds cleanly and then fails inside the confined child, where the
 * failure reaches the controller as a protocol non-result instead of as a build error someone can
 * read. Three call sites build a worker this way — the generated-tool worker process, the Built
 * backend and the evaluator bundle — and each spelled the same options out itself before this.
 * The path is returned rather than recomposed by the caller, since `naming` is what decides it.
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
