export const runtimeProcess = globalThis.process;

export function processAnswers(pid: number): boolean {
  try {
    runtimeProcess.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function warn(text: string): void {
  const coloured = runtimeProcess.stderr.isTTY && (runtimeProcess.env.NO_COLOR ?? "") === "";
  console.warn(coloured ? `\u001B[33m${text}\u001B[39m` : text);
}

export { parseArgs, type ParseArgsOptionsConfig } from "node:util";

export const capturedExecPath = runtimeProcess.execPath;
export const capturedSpawn = Bun.spawn;
