/**
 * A `bun` for tests of the gate's callers: `.githooks/pre-push` and `bun run land`. It stands at
 * the gate's step boundary only. `bun install …` and `bun run …` are logged with the commit checked
 * out where they ran, and pass unless ANA_FAKE_FAIL names that commit and script (`<sha> lint`);
 * ANA_FAKE_DROP names one the same way whose runner drops, exiting 255, the first ANA_FAKE_DROPS
 * times (1 unless set);
 * anything else, a `.ts` entry point such as `tools/runtime/gate.ts`, runs on the real Bun, so the
 * hook, the landing and the gate's own choice of steps and nearby tests are the real ones.
 *
 * ANA_FAKE_TOGETHER=N holds each install until N have started, or about five seconds, and logs its
 * end, so gates run side by side overlap in the log and gates run one after another do not; the
 * install of ANA_FAKE_LATE's commit ends half a second later. ANA_FAKE_SUITE is printed by a test
 * step, which then takes two seconds, for a pulse to read. A test step also logs the workers it was
 * given and whether it stops at its first failure, `workers <sha> <ANA_TEST_WORKERS> <ANA_TEST_BAIL>`,
 * each empty for none.
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
[ "$1 $2" != "run test" ] || printf 'workers\t%s\t%s\t%s\n' "$commit" "$ANA_TEST_WORKERS" "$ANA_TEST_BAIL" >> "$ANA_FAKE_LOG"
if [ "$1" = install ] && [ -n "$ANA_FAKE_TOGETHER" ]; then
  i=0
  while [ "$(grep -c 'install --frozen-lockfile' "$ANA_FAKE_LOG")" -lt "$ANA_FAKE_TOGETHER" ] && [ "$i" -lt 500 ]; do
    sleep 0.01
    i=$((i + 1))
  done
  [ "$commit" != "$ANA_FAKE_LATE" ] || sleep 0.5
  printf 'end\t%s\n' "$commit" >> "$ANA_FAKE_LOG"
fi
if [ "$1 $2" = "run test" ] && [ -n "$ANA_FAKE_SUITE" ]; then
  printf '%s\n' "$ANA_FAKE_SUITE"
  sleep 2
fi
drops=$ANA_FAKE_DROPS
[ -n "$drops" ] || drops=1
if [ "$commit $2" = "$ANA_FAKE_DROP" ] && [ "$(grep -c "^dropped.$commit" "$ANA_FAKE_LOG")" -lt "$drops" ]; then
  printf 'dropped\t%s\n' "$commit" >> "$ANA_FAKE_LOG"
  exit 255
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
