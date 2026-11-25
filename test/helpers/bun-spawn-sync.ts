import type { OptionalEnvValues } from "../../src/agent/backends/scrub-env.ts";
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
    // Bun passes a snapshot of the original environment when `env` is omitted, so a child would not see
    // keys a test deleted from `Bun.env`.
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
  // Bun renders and matches a thrown `Error` by its message alone, so the failure context goes in the
  // message rather than in properties.
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
