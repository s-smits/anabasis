/**
 * A `bun` for tests of the gate's callers, such as `.githooks/pre-push`. It stands at
 * the gate's step boundary only. `bun install …` and `bun run …` are logged with the commit checked
 * out where they ran, and pass unless ANA_FAKE_FAIL names that commit and script (`<sha> lint`);
 * anything else, a `.ts` entry point such as `tools/runtime/gate.ts`, runs on the real Bun, so the
 * hook and the gate's own choice of steps and nearby tests are the real ones.
 *
 * ANA_FAKE_SUITE is printed by a test step, which then takes two seconds, for a pulse to read.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { capturedExecPath } from "../../src/meta/process.ts";

const SCRIPT = String.raw`#!/bin/sh
case "$1" in
install | run) ;;
*) exec "$ANA_REAL_BUN" "$@" ;;
esac
commit=$(git rev-parse HEAD)
printf '%s\t%s\n' "$commit" "$*" >> "$ANA_FAKE_LOG"
if [ "$1 $2" = "run test" ] && [ -n "$ANA_FAKE_SUITE" ]; then
  printf '%s\n' "$ANA_FAKE_SUITE"
  sleep 2
fi
if [ "$commit $2" = "$ANA_FAKE_FAIL" ]; then
  echo "fake: $2 failed on $commit"
  exit 1
fi
`;

/** Writes the fake into `bin`, and returns the environment that puts it first on PATH. */
export function fakeBun(bin: string, log: string) {
  writeFileSync(join(bin, "bun"), SCRIPT);
  chmodSync(join(bin, "bun"), 0o755);
  return { PATH: `${bin}:${Bun.env.PATH ?? ""}`, ANA_REAL_BUN: capturedExecPath, ANA_FAKE_LOG: log };
}

/** A log's lines, none when nothing wrote it. */
export const logLines = (log: string): string[] =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
    : [];

/** Each gate the fake saw, in the order it began, as `<commit> <what its test step ran>`: `suite`
 *  for the whole suite, the nearby files for a static pass, or `-` when it ran none. */
export function gatesRun(log: string): string[] {
  const rows = logLines(log).map((line) => line.split("\t"));
  return rows.flatMap(([commit = "", args = ""]) => {
    if (!args.startsWith("install")) return [];
    const test = rows.find((row) => row[0] === commit && row[1]?.startsWith("run test") === true)?.[1];
    return [
      `${commit} ${test === undefined ? "-" : test === "run test" ? "suite" : test.replace("run test -- ", "")}`,
    ];
  });
}
