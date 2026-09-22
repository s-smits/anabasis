#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$root"

# One failure spelling for every step, whatever its tool prints: tsc says `error TS2322`, oxlint
# `Found 3 errors`, a refusing script Bun's lowercase `error:`. The pre-push hook repeats this line,
# so a step added here is named on failure without teaching the hook that tool's wording.
step() {
  local name=$1
  shift
  "$@" && return 0
  local status=$?
  echo "gate: step $name failed (exit $status)" >&2
  exit "$status"
}
step runtime bun tools/runtime/check.ts
# First, because it is the cheapest step and the one whose failure has a one-command fix:
# `bun run format`. It reads the repository ignore list, so a run worktree's campaigns and
# domains are not the gate's business.
step format bun run format:check
# `packages/ui` keeps its own lock and its own node_modules, and `scripts/worktree.sh setup`
# prepares the root one only. Without it `@types/react` does not resolve, and the lint step
# below reports type-aware findings that are not there while hiding real ones — it used to
# run after `ui`, which is where this install lived. It is a no-op once the tree is prepared.
step ui-deps bun run ui:deps
# One line per error with or without a terminal: the pre-push hook lifts these lines into
# Gate-Finding trailers, and under a terminal tsc otherwise prints coloured frames.
step typecheck bun node_modules/typescript/bin/tsc --noEmit --pretty false
step lint bun run lint
step source-policy bun tools/loc/source-policy.ts
# Cyclomatic ceiling with a shrink-only baseline; a failure names file:line, function and count.
step complexity bun tools/loc/complexity-policy.ts
step ui bun run ui:gate
# One owner for the test invocation: the `test` script runs the whole suite as one `bun test`
# under its own output-idle wall, with two workers fewer than the cores and the slowest files
# first. The reasoning, the numbers and the wall live in tools/runtime/test-suite.ts.
exec bun run test
