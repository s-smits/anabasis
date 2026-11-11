/**
 * Shared process-global access for operations without an equivalent Bun 1.4 API:
 * cwd, pid, platform, signals, process groups, lifecycle events, exit and synchronous stdio.
 */
export const runtimeProcess = globalThis.process;

/** Whether a process has `pid`: signal 0 sends nothing and throws where none does. */
export function processAnswers(pid: number): boolean {
  try {
    runtimeProcess.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Argument parsing for the repository's own command entrypoints; Bun 1.4 has no equivalent. */
export { parseArgs, type ParseArgsOptionsConfig } from "node:util";

/**
 * The runtime executable and `Bun.spawn`, captured at controller import, before any generated
 * module can run and replace either global. Launch paths that start a confined child read these.
 */
export const capturedExecPath = runtimeProcess.execPath;
export const capturedSpawn = Bun.spawn;
