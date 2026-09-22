import type { OptionalEnvValues } from "../../src/backends/scrub-env.ts";
import { isString } from "../../src/meta/json-shape.ts";
import { asError } from "../../src/meta/runtime-values.ts";

interface TextCommandOptions {
  cwd?: string;
  env?: OptionalEnvValues;
  stdin?: string | Uint8Array;
  timeout?: number;
  maxBuffer?: number;
}

const encoder = new TextEncoder();

export function spawnTextSync(command: string, args: readonly string[], options: TextCommandOptions = {}) {
  const { stdin = "", ...spawnOptions } = options;
  const input = isString(stdin) ? encoder.encode(stdin) : stdin;
  let result: Bun.SyncSubprocess<"pipe", "pipe">;
  try {
    // Bun 1.4.2 gives an env-less spawn a snapshot of the original process environment, so a child
    // would not see the deletions `test/env-baseline.ts` makes. Hand it the baseline explicitly.
    result = Bun.spawnSync({
      cmd: [command, ...args],
      stdin: input,
      stdout: "pipe",
      stderr: "pipe",
      env: Bun.env,
      ...spawnOptions,
    });
  } catch (error) {
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      outputOverflow: false,
      error: asError(error),
    };
  }
  return {
    status: result.exitCode,
    signal: result.signalCode ?? null,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    timedOut: result.exitedDueToTimeout === true,
    outputOverflow: result.exitedDueToMaxBuffer === true,
    error: null,
  };
}

export function execTextSync(
  command: string,
  args: readonly string[],
  options: TextCommandOptions = {},
): string {
  const result = spawnTextSync(command, args, options);
  // The message carries the whole failure. Bun prints a thrown Error by its message alone, and reads
  // it the same way through `toMatchObject`, so the fields this used to assign onto the error were
  // invisible to every reader: a caller debugging a failed command saw the exit code and nothing
  // else, and the one test that asserted stdout and stderr could not see them either (2026-09-18).
  if (result.error !== null || result.status !== 0 || result.signal !== null) {
    const cause =
      result.status === null || result.status === 0
        ? (result.signal ?? result.error?.message ?? "unknown")
        : result.status;
    throw new Error(
      `command failed (${cause}): ` +
        `${command}\nstdout: ${result.stdout.trimEnd()}\nstderr: ${result.stderr.trimEnd()}`,
    );
  }
  return result.stdout;
}
