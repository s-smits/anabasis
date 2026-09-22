import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { dirname, resolve } from "#src/meta/path.ts";

export const SCRIPT_DIRECTORY = dirname(Bun.fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIRECTORY, "../../../..");

export function runTypeScript(script, args = [], options = {}) {
  const result = runSync([Bun.argv[0], resolve(SCRIPT_DIRECTORY, script), ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? Bun.env,
  });
  return { ...result, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
}
