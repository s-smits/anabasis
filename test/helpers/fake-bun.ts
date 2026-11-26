/**
 * A `bun` for tests of the gate's callers, `.githooks/pre-push` and `bun run land`, standing at the
 * gate's step boundary only. Installs, `bun run …` and the size policy's script are logged with the
 * commit they ran at, and pass unless ANA_FAKE_FAIL names that commit and script (`<sha> lint`);
 * ANA_FAKE_DROP names one whose runner gives no verdict, exiting ANA_FAKE_DROP_CODE (255) the first
 * ANA_FAKE_DROPS times (1), and a routed step whose ANA_CHECK_HOST is ANA_FAKE_DOWN exits so too.
 * Anything else, such as `tools/runtime/gate.ts`, runs on the real Bun. ANA_FAKE_TOGETHER=N holds
 * each install until N have started (about five seconds at most), so parallel gates overlap in the
 * log; ANA_FAKE_LATE's install ends half a second later. A test step prints ANA_FAKE_SUITE and
 * takes two seconds, the whole suite first touching ANA_FAKE_SUITE_TOUCH; it logs `workers <sha>
 * <ANA_TEST_WORKERS> <ANA_TEST_BAIL>`, and an install under a named ANA_CHECK_HOST logs `where
 * <sha> <ANA_CHECK_HOST>`.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { capturedExecPath } from "../../src/meta/process.ts";

const SCRIPT = String.raw`#!/bin/sh
case "$1" in
install | run | tools/loc/source-policy.ts) ;;
*) exec "$ANA_REAL_BUN" "$@" ;;
esac
commit=$(git rev-parse HEAD)
printf '%s\t%s\n' "$commit" "$*" >> "$ANA_FAKE_LOG"
[ "$1" != install ] || [ -z "$ANA_CHECK_HOST" ] || printf 'where\t%s\t%s\n' "$commit" "$ANA_CHECK_HOST" >> "$ANA_FAKE_LOG"
[ "$1" != install ] || [ -z "$ANA_RUNNER_SPARE_HELD" ] || printf 'spare\t%s\t%s\n' "$commit" "$ANA_CHECK_HOST" >> "$ANA_FAKE_LOG"
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
  [ "$*" != "run test" ] || [ -z "$ANA_FAKE_SUITE_TOUCH" ] || touch "$ANA_FAKE_SUITE_TOUCH"
  sleep 2
fi
drops=$ANA_FAKE_DROPS
[ -n "$drops" ] || drops=1
if [ "$commit $2" = "$ANA_FAKE_DROP" ] && [ "$(grep -c "^dropped.$commit" "$ANA_FAKE_LOG")" -lt "$drops" ]; then
  printf 'dropped\t%s\n' "$commit" >> "$ANA_FAKE_LOG"
  code=$ANA_FAKE_DROP_CODE
  [ -n "$code" ] || code=255
  exit "$code"
fi
if [ -n "$ANA_FAKE_DOWN" ] && [ "$ANA_CHECK_HOST" = "$ANA_FAKE_DOWN" ] && [ "$1" = run ]; then
  case "$2" in
  secrets | typecheck | lint | test)
    printf 'down\t%s\t%s\n' "$commit" "$ANA_CHECK_HOST" >> "$ANA_FAKE_LOG"
    code=$ANA_FAKE_DROP_CODE
    [ -n "$code" ] || code=255
    exit "$code"
    ;;
  esac
fi
if [ "$commit $2" = "$ANA_FAKE_FAIL" ]; then
  echo "fake: $2 failed on $commit"
  exit 1
fi
`;

export function fakeBun(bin: string, log: string) {
  writeFileSync(join(bin, "bun"), SCRIPT);
  chmodSync(join(bin, "bun"), 0o755);
  return { PATH: `${bin}:${Bun.env.PATH ?? ""}`, ANA_REAL_BUN: capturedExecPath, ANA_FAKE_LOG: log };
}

export const logLines = (log: string): string[] =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
    : [];

/** Where each pass the fake saw began, as `<commit> <ANA_CHECK_HOST>`, for the passes that named one. */
export const wherePassesRan = (log: string): string[] =>
  logLines(log).flatMap((line) => {
    const [kind, commit = "", place = ""] = line.split("\t");
    return kind === "where" ? [`${commit} ${place}`] : [];
  });

/** Each gate the fake saw, in order, as `<commit> <what its test step ran>`: `suite`, the nearby
 *  files of a static pass, or `-` for none. */
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
