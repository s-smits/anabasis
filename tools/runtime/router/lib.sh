# What both sides of the runner share. The bun shim and run.sh source it here, and run.sh ships it
# ahead of host.sh to every host, so this machine and each host pin, reap and wall a task the same
# way. It defines functions and runs nothing, and stays within bash 3.2, the M1's /bin/bash: no
# associative arrays, no `${x,,}`, and an empty array needs the `${a[@]+...}` form.

# An Anabasis tree pins its Bun in package.json ("packageManager": "bun@X"), and branches differ.
# ~/.bun/releases/X/bin/bun keeps each version beside the global ~/.bun/bin/bun, so a tree gets its
# own pin without anyone switching the global install; installing a pin as the global Bun once
# flipped it under campaigns running on the M1.

# bun_pin <root>: the version <root>/package.json pins, or nothing.
bun_pin() {
  local line pattern='"packageManager"[[:space:]]*:[[:space:]]*"bun@([^"+]+)'
  [[ -f "$1/package.json" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $pattern ]]; then
      printf '%s\n' "${BASH_REMATCH[1]}"
      return 0
    fi
  done <"$1/package.json"
}

# pinned_bun <root>: the Bun binary to run for <root>; the global one where the pin is absent.
pinned_bun() {
  local pin
  pin="$(bun_pin "$1")"
  if [[ -n "$pin" && -x "$HOME/.bun/releases/$pin/bin/bun" ]]; then
    printf '%s\n' "$HOME/.bun/releases/$pin/bin/bun"
  else
    printf '%s\n' "$HOME/.bun/bin/bun"
  fi
}

# Every step before the task is safe to repeat (a probe, a mkdir, an rsync, an upload), so a
# failure there gets two more tries. macOS's openrsync exits 1 for every error, so a dropped
# connection looks like any other. The task itself is never retried. Bash ignores `set -e` under
# `||`, so a retried step must be one command or pipeline that returns its own failure.
with_retries() {
  local attempt=1 status pause
  while true; do
    status=0
    "$@" || status=$?
    ((status != 0)) || return 0
    ((attempt < 3)) || return "$status"
    pause=$((attempt * ${ANA_RUNNER_RETRY_DELAY:-5}))
    printf "runner: %s failed (exit %s); retry %s of 2 in %ss\n" "$1" "$status" "$attempt" "$pause" >&2
    sleep "$pause"
    attempt=$((attempt + 1))
  done
}

# Orphaned Bun test workers have spun for ten hours, and a dead ssh shell can leave a whole run
# tree alive. A stale process is an orphan (parent 1) running a test worker, or naming the marker,
# with everything under it; this process's own ancestry never is. The marker must name a place
# only tests use: the local lane passes none, since campaigns live inside the checkout and on
# 1 October its path matched a live campaign's orphaned qemu. Prints `pid<TAB>command` lines.
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
# and the kill, which is no failure, so this always returns 0.
reap_stale_runs() {
  local pid cmdline
  while IFS=$'\t' read -r pid cmdline; do
    kill -9 "$pid" 2>/dev/null &&
      printf "reaped process %s from a dead test run: %.160s\n" "$pid" "$cmdline" >&2
  done < <(stale_run_pids "${1:-}")
  return 0
}

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

# run_walled <seconds> <cmd...>: the one wall, on every side. The task runs as a child, so a
# watchdog can end its whole tree after <seconds>, and so does a HUP, INT or TERM to this shell: a
# dropped ssh delivers HUP through its PTY, and ^C delivers INT. Returns the task's status.
run_walled() {
  local limit=$1 status=0
  shift
  "$@" &
  walled_task=$!
  (
    waited=0
    while kill -0 "$walled_task" 2>/dev/null; do
      if ((waited >= limit)); then
        printf "task exceeded %ss; stopping it\n" "$limit" >&2
        kill_tree "$walled_task"
        exit 0
      fi
      sleep 5
      waited=$((waited + 5))
    done
  ) &
  walled_guard=$!
  disown "$walled_guard" # its kill below is routine; keep bash from reporting it as "Killed: 9"
  trap 'kill_tree "$walled_task"; kill_tree "$walled_guard"; exit 130' HUP INT TERM
  wait "$walled_task" || status=$?
  kill_tree "$walled_guard"
  return "$status"
}
