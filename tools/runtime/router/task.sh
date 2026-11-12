# One check task, where it runs: `task.sh <here|host> <folder> <bun pin> <deadline seconds> <task>
# [arguments...]`. `run.ts` starts it on this machine over the checkout itself (`here`, an absolute
# folder), and on a host over that host's slot (`host`, a folder under its home), where it first
# checks out the snapshot `run.ts` pushed and makes sure of the slot's dependencies. Either way the
# task is `bun run <task>` on the Bun the tree pins, under one deadline, with the orphans of earlier
# tasks ended first. It stays within bash 3.2, a Mac's /bin/bash: no associative arrays, no `${x,,}`,
# and an empty array needs the `${a[@]+...}` form.
set -euo pipefail
where="$1" dir="$2" pin="$3" wall_seconds="$4" task="$5"
shift 5
export ANA_RUNNER_ACTIVE=1

# Tailscale SSH, which serves the Macs, reports 0 as every session's exit status: on 19 October a
# suite that exited 1 there read 0 here. So a host's status goes back as a file beside the slot,
# written however this script ends, and run.ts reads it.
if [[ "$where" == host ]]; then
  dir="$HOME/$dir"
  trap 'printf "%s\n" "$?" >"$dir.status"' EXIT
fi

# Bun publishes one zip a platform. A Mac sleeps when idle, so its task runs under caffeinate.
keep_awake=()
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) bun_build=darwin-aarch64 keep_awake=(caffeinate -i) ;;
  Darwin/x86_64) bun_build=darwin-x64 keep_awake=(caffeinate -i) ;;
  Linux/x86_64) bun_build=linux-x64 ;;
  Linux/aarch64) bun_build=linux-aarch64 ;;
  *)
    printf "runner: no Bun build for %s\n" "$(uname -sm)" >&2
    exit 2
    ;;
esac

# A missing pin is unpacked into its own folder; the global Bun and every rc file stay as they are,
# since installing a pin as the global Bun once flipped it under live campaigns. A tree that pins
# none runs on the global one.
bun_dir="$HOME/.bun/bin"
if [[ -n "$pin" ]]; then
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
fi
export PATH="$bun_dir:$PATH"
cd "$dir"

marker=""
if [[ "$where" == host ]]; then
  marker="$dir"
  # A non-interactive ssh shell starts with a bare PATH. The Builder's isolated-command tests resolve
  # `rg` through the wall's toolchain roots, so the package managers' folders must be on it, and
  # Bubblewrap is often in /usr/local/bin.
  export PATH="$PATH:$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"

  # The test wrapper counts every core as equal, and half of an M1's are efficiency cores: at eight
  # it started six workers, whose e2e child processes held the load at twice the cores and ran tests
  # past their timeouts. On Apple silicon the workers are the performance cores, unless the task
  # names a count.
  perf_cores="$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || true)"
  if [[ -z "${ANA_TEST_WORKERS:-}" && "$perf_cores" =~ ^[1-9][0-9]*$ ]]; then
    export ANA_TEST_WORKERS="$perf_cores"
  fi

  # The slot becomes the snapshot: its files as pushed, nothing an earlier task left, and the two
  # caches a task is slow without, the dependencies and the suite's timings.
  git -c advice.detachedHead=false checkout -q --force --detach refs/runner/snapshot
  git clean -ffdxq -e /node_modules -e /packages/ui/node_modules -e /test/.test-timings.json
  printf "runner snapshot on %s: %s\n" "$(uname -n)" "$(git rev-parse HEAD)" >&2

  # The dependencies never travel: the slot installs them from the lockfiles it was sent, and a stamp
  # in them names the lockfiles and the Bun they were installed for, so a task installs only where
  # one of those moved since the slot's last install.
  stamp="node_modules/.ana-runner"
  wanted="bun $pin
$(git ls-tree HEAD -- package.json bun.lock packages/ui/package.json packages/ui/bun.lock)"
  if [[ "$(cat "$stamp" 2>/dev/null || true)" != "$wanted" ]]; then
    rm -f "$stamp"
    bun install --frozen-lockfile >/dev/null
    if [[ -f packages/ui/package.json && -f packages/ui/bun.lock ]]; then
      bun install --frozen-lockfile --cwd packages/ui >/dev/null
    fi
    mkdir -p node_modules
    printf '%s\n' "$wanted" >"$stamp"
    printf "runner: installed the dependencies of this snapshot's lockfiles on %s\n" "$(uname -n)" >&2
  fi
fi

# Orphaned Bun test workers have spun for ten hours, and a dead ssh shell can leave a whole task
# alive. A stale process is an orphan (parent 1) running a test worker, or naming the marker, with
# everything under it; this process's own ancestry never is. The marker must name a place only
# tasks use, so a host passes its slot and this machine none: campaigns live inside a checkout, and
# on 1 October its path matched a live campaign's orphaned qemu. Prints `pid<TAB>command` lines.
stale_run_pids() {
  ps -Ao pid=,ppid=,command= | awk -v self="$$" -v marker="$1" '
    {
      pid = $1
      ppid = $2
      cmd = $0
      sub(/^[ \t]*[0-9]+[ \t]+[0-9]+[ \t]+/, "", cmd)
      parent[pid] = ppid
      command[pid] = cmd
      pids[count++] = pid
    }
    END {
      for (p = self; p > 1 && (p in parent); p = parent[p]) mine[p] = 1
      for (i = 0; i < count; i++) {
        pid = pids[i]
        if (parent[pid] == 1 && !(pid in mine) &&
            (command[pid] ~ /bun test --test-worker/ ||
             (marker != "" && index(command[pid], marker) > 0))) stale[pid] = 1
      }
      changed = 1
      while (changed) {
        changed = 0
        for (i = 0; i < count; i++) {
          pid = pids[i]
          if (!(pid in stale) && !(pid in mine) && (parent[pid] in stale)) {
            stale[pid] = 1
            changed = 1
          }
        }
      }
      for (pid in stale) print pid "\t" command[pid]
    }
  '
}

# Names what it killed, so a wrong match shows in the log. A process can exit between the listing
# and the kill, which is no failure.
while IFS=$'\t' read -r pid cmdline; do
  kill -9 "$pid" 2>/dev/null &&
    printf "reaped process %s from a dead test run: %.160s\n" "$pid" "$cmdline" >&2
done < <(stale_run_pids "$marker")

# kill_tree <pid>: `bun run test` -> `bun test` -> workers, so killing the top alone orphans the
# workers. The whole tree is listed before any of it is killed.
kill_tree() {
  local pid
  for pid in $(ps -Ao pid=,ppid= | awk -v root="$1" '
    { parent[$1] = $2; pids[count++] = $1 }
    END {
      seen[root] = 1
      changed = 1
      while (changed) {
        changed = 0
        for (i = 0; i < count; i++)
          if (!(pids[i] in seen) && (parent[pids[i]] in seen)) { seen[pids[i]] = 1; changed = 1 }
      }
      for (pid in seen) if (pid != root) print pid
    }
  ') "$1"; do
    kill -9 "$pid" 2>/dev/null || true
  done
}

# The one deadline. The task runs as a child, so a watchdog can end its whole tree after the
# deadline, and so does a HUP, INT or TERM to this shell: a dropped ssh delivers HUP through its
# terminal, and ^C delivers INT. package.json owns each command: a restated test command once
# dropped --path-ignore-patterns.
status=0
${keep_awake[@]+"${keep_awake[@]}"} bun run "$task" "$@" &
walled_task=$!
(
  sleep "$wall_seconds"
  printf "task exceeded %ss; stopping it\n" "$wall_seconds" >&2
  kill_tree "$walled_task"
) &
walled_guard=$!
disown "$walled_guard" # its kill below is routine; keep bash from reporting it as "Killed: 9"
trap 'kill_tree "$walled_task"; kill_tree "$walled_guard"; exit 130' HUP INT TERM
wait "$walled_task" || status=$?
kill_tree "$walled_guard"
exit "$status"
