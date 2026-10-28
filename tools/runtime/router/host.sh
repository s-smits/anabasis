# What runs on a host. run.sh ships lib.sh and this file as one script beside the slot's folder
# and runs it under ssh -tt with the host's /bin/bash, which on the M1 is 3.2.
# Arguments: <slot folder> <bun pin> <task> <deadline seconds> [task args...]. A slot's script is never
# rewritten while its own task runs: run.sh holds the slot's lock.
set -euo pipefail
slot_dir="$1"
pin="$2"
task="$3"
wall_seconds="$4"
shift 4
export ANA_RUNNER_ACTIVE=1
# Tailscale SSH, which serves the Mac, reports 0 as every session's exit status: on 19 October a
# suite that exited 1 there read 0 here, as every check sent to it had. So the status goes back as
# a file beside the slot, written however this script ends, and run.sh reads it.
trap 'printf "%s\n" "$?" >"$HOME/$slot_dir.status"' EXIT

# Bun publishes one zip a platform. The Mac sleeps on an idle lid, so its task runs under
# caffeinate; the Linux host stays up by itself.
keep_awake=()
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) bun_build=darwin-aarch64 keep_awake=(caffeinate -i) ;;
  Linux/x86_64) bun_build=linux-x64 ;;
  Linux/aarch64) bun_build=linux-aarch64 ;;
  *)
    printf "runner: no Bun build for %s\n" "$(uname -sm)" >&2
    exit 2
    ;;
esac

# A missing pin is unpacked into its own folder; the global Bun and every rc file stay as they are.
bun_dir="$HOME/.bun/releases/$pin/bin"
if [[ ! -x "$bun_dir/bun" ]]; then
  printf "Installing Bun %s (%s) into %s; the global Bun is untouched\n" "$pin" "$bun_build" "$bun_dir" >&2
  mkdir -p "$HOME/.bun/releases"
  staging="$(mktemp -d "$HOME/.bun/releases/.install-XXXXXX")"
  url="https://github.com/oven-sh/bun/releases/download/bun-v$pin/bun-$bun_build.zip"
  unpacked="$staging/bun-$bun_build/bun"
  if ! curl -fsSL -o "$staging/bun.zip" "$url" || ! unzip -q "$staging/bun.zip" -d "$staging" ||
    [[ "$("$unpacked" --version 2>/dev/null || true)" != "$pin" ]]; then
    rm -rf "$staging"
    printf "could not install Bun %s from %s\n" "$pin" "$url" >&2
    exit 2
  fi
  mkdir -p "$bun_dir"
  mv -f "$unpacked" "$bun_dir/bun"
  rm -rf "$staging"
fi
# A non-interactive ssh shell starts with a bare PATH. The Builder's isolated-command tests resolve
# `rg` through the wall's toolchain roots, so the package managers' folders must be on it, and
# Bubblewrap is often in /usr/local/bin.
export PATH="$bun_dir:$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# The test wrapper counts every core as equal, and half of an M1's are efficiency cores: at eight
# it started six workers, whose e2e child processes held the load at twice the cores and ran tests
# past their timeouts. On Apple silicon the workers are the performance cores, unless the task
# names a count; elsewhere the wrapper's own count stands.
perf_cores="$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || true)"
if [[ -z "${ANA_TEST_WORKERS:-}" && "$perf_cores" =~ ^[1-9][0-9]*$ ]]; then
  export ANA_TEST_WORKERS="$perf_cores"
fi

# Tests that read Git must see the transferred bytes, new and deleted files included, so the slot
# is a disposable repository whose one commit is the tree as sent. No hook runs in it.
# A slot whose own .git is missing or broken would otherwise find a repository above it.
cd "$HOME/$slot_dir"
if [[ "$(git rev-parse --git-dir 2>/dev/null || true)" != .git ]]; then
  rm -rf .git
  git init -q
fi
git config core.hooksPath /dev/null
git config user.name "Runner Snapshot"
git config user.email "runner@snapshot.invalid"
git read-tree --empty
printf 'node_modules/\n' >.git/info/exclude
git add -A -- .
git -c commit.gpgsign=false commit -q --no-verify --allow-empty -m "runner snapshot"
printf "runner snapshot on %s: %s\n" "$(uname -n)" "$(git rev-parse HEAD)" >&2

# The UI package keeps its own lockfile, and the sync keeps its node_modules, so `ui:gate` and a
# routed `bun run test -- packages/ui/test` need its own install.
bun install --frozen-lockfile >/dev/null
if [[ -f packages/ui/package.json && -f packages/ui/bun.lock ]]; then
  bun install --frozen-lockfile --cwd packages/ui >/dev/null
fi

reap_stale_runs "$slot_dir"
status=0
run_walled "$wall_seconds" ${keep_awake[@]+"${keep_awake[@]}"} bun run "$task" "$@" || status=$?
exit "$status"
