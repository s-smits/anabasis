import { keyIfDefined } from "./optional-key.ts";
import { basename } from "./path.ts";
import { capturedSpawn, runtimeProcess } from "./process.ts";
import { errorCode, errorMessage, type RuntimeSignal } from "./runtime-values.ts";

const processKill = runtimeProcess.kill.bind(runtimeProcess);

export const CAPTURE_MAX_BYTES = 64 * 1024 * 1024;
const EMPTY = new Uint8Array();
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const REAP_STEPS = [
  ["SIGTERM", 100],
  ["SIGKILL", 500],
] as const;

interface RunSyncOptions {
  input?: string | Uint8Array;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  maxBuffer?: number;
}

interface RunSyncResult {
  cappedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

interface SpawnSyncOptions {
  cmd: string[];
  stdin: Uint8Array;
  stdout: "pipe";
  stderr: "pipe";
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  maxBuffer?: number;
}

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

export function killProcessGroup(child: Bun.Subprocess, signal: RuntimeSignal): void {
  if (killProcessGroupId(child.pid, signal)) return;
  try {
    child.kill(signal);
  } catch {
    // the child may already have exited
  }
}

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

export async function terminateAndReapProcessGroupId(processGroupId: number): Promise<boolean> {
  for (const [signal, waitMs] of REAP_STEPS) {
    if (!processGroupExists(processGroupId)) return true;
    killProcessGroupId(processGroupId, signal);
    for (let elapsed = 0; elapsed < waitMs && processGroupExists(processGroupId); elapsed += 10) {
      await Bun.sleep(10);
    }
  }
  return !processGroupExists(processGroupId);
}

export async function interruptAndReapProcessGroup(child: Bun.Subprocess, graceMs: number): Promise<boolean> {
  try {
    child.kill("SIGTERM");
  } catch {
    // the leader may already have exited
  }
  await Promise.race([child.exited, Bun.sleep(graceMs)]);
  return await terminateAndReapProcessGroupId(child.pid);
}

export function runSync(cmd: readonly string[], options: RunSyncOptions = {}): RunSyncResult {
  const { input } = options;
  const spawnOptions: SpawnSyncOptions = {
    cmd: [...cmd],
    stdin: input === undefined ? EMPTY : input instanceof Uint8Array ? input : ENCODER.encode(input),
    stdout: "pipe",
    stderr: "pipe",
    ...keyIfDefined("cwd", options.cwd),
    ...keyIfDefined("env", options.env),
    ...keyIfDefined("timeout", options.timeout),
    ...keyIfDefined("maxBuffer", options.maxBuffer),
  };
  try {
    const result = Bun.spawnSync(spawnOptions);
    const { maxBuffer } = options;
    const cappedAt = maxBuffer !== undefined && result.stdout.length >= maxBuffer ? maxBuffer : null;
    return {
      cappedAt,
      exitCode: result.signalCode == null ? result.exitCode : null,
      signal: result.signalCode == null ? null : String(result.signalCode),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const reason = ENCODER.encode(errorMessage(error));
    return { cappedAt: null, exitCode: null, signal: null, stdout: EMPTY, stderr: reason };
  }
}

function endingOf({ exitCode, signal }: { exitCode: number | null; signal: string | null }): string {
  if (exitCode !== null) return `exited ${exitCode}`;
  return signal === null ? "could not start" : `died on ${signal}`;
}

export function decodeOutput(bytes: Uint8Array): string {
  return DECODER.decode(bytes);
}

export function zeroExitText(result: RunSyncResult): string | null {
  return result.exitCode === 0 ? decodeOutput(result.stdout).trim() : null;
}

export function runTextSyncOrThrow(cmd: readonly string[], options: RunSyncOptions = {}): string {
  const result = runSync(cmd, options);
  if (result.cappedAt !== null || result.exitCode !== 0) {
    const ending = result.cappedAt === null ? endingOf(result) : `filled its ${result.cappedAt}-byte capture`;
    throw new Error(`${basename(cmd[0] ?? "")} ${ending}: ${decodeOutput(result.stderr).trim()}`);
  }
  return decodeOutput(result.stdout);
}

const PIPES_AFTER_EXIT_MS = 1000;

async function drained(stream: ReadableStream<Uint8Array>, exited: Promise<number>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const read = async (): Promise<void> => {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      text += decoder.decode(next.value, { stream: true });
    }
  };
  const cut = async (): Promise<void> => {
    await exited;
    setTimeout(() => {
      reader.cancel().catch(() => undefined);
    }, PIPES_AFTER_EXIT_MS).unref();
  };
  await Promise.all([read(), cut()]);
  return text + decoder.decode();
}

export async function runCaptured(
  cmd: readonly string[],
  options: Pick<RunSyncOptions, "cwd" | "env" | "timeout"> = {},
): Promise<{ exitCode: number | null; signal: string | null; stdout: string; stderr: string }> {
  try {
    const child = capturedSpawn([...cmd], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ...keyIfDefined("cwd", options.cwd),
      ...keyIfDefined("env", options.env),
      ...keyIfDefined("timeout", options.timeout),
    });
    const [stdout, stderr, code] = await Promise.all([
      drained(child.stdout, child.exited),
      drained(child.stderr, child.exited),
      child.exited,
    ]);
    const signal = child.signalCode == null ? null : String(child.signalCode);
    return { exitCode: signal === null ? code : null, signal, stdout, stderr };
  } catch (error) {
    return { exitCode: null, signal: null, stdout: "", stderr: errorMessage(error) };
  }
}

export async function runTextOrThrow(
  cmd: readonly string[],
  options: Parameters<typeof runCaptured>[1] = {},
): Promise<string> {
  const result = await runCaptured(cmd, options);
  if (result.exitCode !== 0) {
    throw new Error(`${basename(cmd[0] ?? "")} ${endingOf(result)}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}
