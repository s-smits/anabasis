import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { dirname, resolve } from "#src/meta/path.ts";

export const SCRIPT_DIRECTORY = dirname(Bun.fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIRECTORY, "../../../..");

export type RunTypeScriptOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type RunTypeScriptResult = Omit<ReturnType<typeof runSync>, "stdout" | "stderr"> & {
  stdout: string;
  stderr: string;
};

export function runTypeScript(
  script: string,
  args: readonly string[] = [],
  options: RunTypeScriptOptions = {},
): RunTypeScriptResult {
  const result = runSync([process.execPath, resolve(SCRIPT_DIRECTORY, script), ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? Bun.env,
  });
  return { ...result, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
}
