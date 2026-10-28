#!/usr/bin/env bash
# The runner: run.sh <test|typecheck|lint|secrets|gate> [args]. The bun shim sends Anabasis's
# check tasks here, so that they run on a host `ANA_HOSTS` lists rather than on this loaded laptop: a
# push once gated here at a load average of 47 beside seven live runs. RUN_REMOTE picks the host by
# its place in that list, its name or its ssh destination, 0 runs the task here, and unset takes the
# first host that is not busy (`pick_host`), or this machine where the list is empty. Whatever the host,
# the task is `bun run <task>` over the working tree as it stands, uncommitted bytes included,
# under the Bun the tree pins and one deadline, and its exit status is this script's.
#
# A task waits for one of its host's slots in a queue on this machine, first come first served:
# each host takes two tasks at once (`slots`), and this machine one. Settings, each optional:
# ANA_RUNNER_WALL (seconds a task may run, 3600), ANA_RUNNER_QUEUE_WAIT (seconds a task may wait for
# a slot, 2400; exit 75 past it), ANA_RUNNER_MIN_FREE_GB (free space a host must have, 3; exit 69
# below it or when it does not answer), ANA_RUNNER_RETRY_DELAY (5), ANA_RUNNER_BUSY (the one-minute
# load, as a percentage of a host's cores, at which an unnamed host counts as busy, 100). A host
# needs only ssh, bash, git, rsync, curl and unzip, and gets the tree's pinned Bun on its first task.
set -euo pipefail

# Bash reads a script while it runs it, so an in-place edit shifts the bytes under every task still
# running. The braces make bash read the whole file first, and the `exit` on their line keeps it
# from reading past them. install.ts installs a change by renaming new copies over the old.
{

runner_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$runner_dir/lib.sh"

task="${1:-}"
case "$task" in
  test | typecheck | lint | secrets | gate) shift ;;
  *)
    printf "usage: %s {test|typecheck|lint|secrets|gate} [arguments...]\n" "$0" >&2
    exit 2
    ;;
esac

for setting in ANA_RUNNER_WALL ANA_RUNNER_QUEUE_WAIT ANA_RUNNER_MIN_FREE_GB ANA_RUNNER_RETRY_DELAY ANA_RUNNER_BUSY; do
  if ! [[ "${!setting:-0}" =~ ^[0-9]+$ ]]; then
    printf "%s must be a non-negative integer, got '%s'\n" "$setting" "${!setting}" >&2
    exit 2
  fi
done
wall_seconds="${ANA_RUNNER_WALL:-3600}"
((wall_seconds > 0)) || wall_seconds=3600

ssh_options=(
  -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3
  -o ControlMaster=no -o ControlPath=none
)

alive() { [[ "$1" =~ ^[1-9][0-9]*$ ]] && kill -0 "$1" 2>/dev/null; }

# taken_here <host>: the slots this machine's tasks hold on <host>, and the tasks waiting for one.
# A slot just made has no PID yet and counts as held.
taken_here() {
  local path pid taken=0
  for path in "${TMPDIR:-/tmp}/ana-runner/$1"/slot-* "${TMPDIR:-/tmp}/ana-runner/$1"/wait.*; do
    [[ -e "$path" ]] || continue
    if [[ -d "$path" ]]; then pid="$(cat "$path/pid" 2>/dev/null || true)"; else pid="$(cat "$path" 2>/dev/null || true)"; fi
    if [[ -z "$pid" ]] || alive "$pid"; then taken=$((taken + 1)); fi
  done
  printf '%s' "$taken"
}

# pick_host: the host an unset RUN_REMOTE runs on. Every host is asked its one-minute load and its
# cores at once, and the first in the list's order that is not busy takes the task: busy is
# a load at or above ANA_RUNNER_BUSY percent of its cores, or every slot held by this machine's own
# tasks. Where all are busy, the least loaded one with a free slot takes it, else the first that
# answered, where the task queues as before. On 22 October the M1, the first line, carried two
# campaigns and every CI gate while the Linux runner sat idle.
pick_host() {
  local names=("${host_sshs[@]}") i probes load cores percent taken reading
  local busy_at="${ANA_RUNNER_BUSY:-100}" pick="" fallback="" best="" best_percent="" first_said=""
  probes="$(mktemp -d "${TMPDIR:-/tmp}/ana-runner-probe.XXXXXX")"
  for i in "${!names[@]}"; do
    ssh -o ConnectTimeout=5 "${ssh_options[@]}" "${names[$i]}" \
      'n="$(getconf _NPROCESSORS_ONLN)"; l="$( (sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg) | tr -d "{}" | awk "{ print \$1 }")"; echo "$l $n"' \
      >"$probes/$i" 2>/dev/null </dev/null &
  done
  wait
  for i in "${!names[@]}"; do
    read -r load cores _ <"$probes/$i" || true
    taken="$(taken_here "${names[$i]}")"
    if ! [[ "$load" =~ ^[0-9]+([.][0-9]+)?$ && "$cores" =~ ^[1-9][0-9]*$ ]]; then
      reading="no load reading"
      [[ -n "$first_said" ]] || first_said="${names[$i]} gave $reading"
      continue
    fi
    percent="$(awk -v l="$load" -v n="$cores" 'BEGIN { printf "%d", l * 100 / n }')"
    reading="load $load of $cores cores, $taken of $slots slots held from here"
    [[ -n "$fallback" ]] || fallback="${names[$i]}"
    if ((percent < busy_at && taken < slots)); then
      pick="${names[$i]}"
      break
    fi
    [[ -n "$first_said" ]] || first_said="${names[$i]} is busy ($reading)"
    if ((taken < slots)) && { [[ -z "$best" ]] || ((percent < best_percent)); }; then
      best="${names[$i]}" best_percent="$percent"
    fi
  done
  rm -rf "$probes"
  if [[ -z "$pick" ]]; then
    pick="${best:-${fallback:-${names[0]:-}}}"
    printf "runner: every host is busy or gave no load reading, so the task goes to %s\n" "$pick" >&2
  elif [[ -n "$first_said" ]]; then
    printf "runner: %s, so the task goes to %s\n" "$first_said" "$pick" >&2
  fi
  printf '%s' "$pick"
}

# The hosts are the machines ANA_HOSTS lists, read by its one reader (tools/runs/host-config.ts)
# through hosts.js, which install.ts bundles from hosts.ts: from the environment, or else from
# .env.runs in the main worktree, where `bun run runs` finds them. Until 25 October the runner kept
# a hosts file of its own, which on stijn-pro named the same two machines, in the same order, as its
# ANA_HOSTS, each with two slots. The lister runs in this folder, so Bun loads no .env of the tree.
root="$(git rev-parse --show-toplevel)"
host_names=() host_sshs=() slots=2
list_hosts() {
  local main env_file=()
  main="$(dirname "$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)")"
  [[ ! -f "$main/.env.runs" ]] || env_file=(--env-file="$main/.env.runs")
  (cd "$runner_dir" && "$(pinned_bun "$root")" ${env_file[@]+"${env_file[@]}"} hosts.js)
}
if [[ "${RUN_REMOTE:-}" != 0 ]]; then
  if ! listed="$(list_hosts)"; then
    printf "runner: ANA_HOSTS could not be read; RUN_REMOTE=0 runs the task here\n" >&2
    exit 2
  fi
  while read -r name ssh_name; do
    [[ -n "$name" ]] || continue
    host_names+=("$name") host_sshs+=("$ssh_name")
  done <<<"$listed"
fi

# The host: none for RUN_REMOTE=0, else the host whose place (from 1), name or ssh destination it
# gives, and for an unset RUN_REMOTE the one `pick_host` names, or none where the list is empty.
host=""
choice="${RUN_REMOTE:-}"
if [[ -z "$choice" ]]; then
  if ((${#host_sshs[@]} == 0)); then choice=0; else choice="$(pick_host)"; fi
fi
if [[ "$choice" != 0 ]]; then
  for ((i = 0; i < ${#host_sshs[@]}; i++)); do
    if [[ "$choice" == "$((i + 1))" || "$choice" == "${host_names[$i]}" || "$choice" == "${host_sshs[$i]}" ]]; then
      host="${host_sshs[$i]}"
      break
    fi
  done
  if [[ -z "$host" ]]; then
    printf "RUN_REMOTE=%s names no host ANA_HOSTS lists; 0 runs the task here\n" "$choice" >&2
    exit 2
  fi
fi
# This machine runs one task at a time.
[[ -n "$host" ]] || slots=1

on_host() { ssh "${ssh_options[@]}" "$host" "$@"; }

# The queue. A waiter's ticket names its PID; it takes a slot only when no live ticket is older,
# and a slot is a folder whose creation is the lock, with its holder's PID inside. A ticket or a
# slot whose PID is gone is removed by whoever reads it. Only the oldest waiter tries the slots,
# once a second, so no two waiters race for one.
queue_dir="${TMPDIR:-/tmp}/ana-runner/${host:-local}"
held_slot=""
ticket=""

release_queue() {
  [[ -z "$ticket" ]] || rm -f "$ticket"
  [[ -z "$held_slot" ]] || rm -rf "$queue_dir/slot-$held_slot"
}

tickets_ahead() {
  local path pid ahead=0
  while IFS= read -r path; do
    [[ "$path" != "$ticket" ]] || break
    pid="$(cat "$path" 2>/dev/null || true)"
    if alive "$pid"; then ahead=$((ahead + 1)); else rm -f "$path"; fi
  done < <(ls -1tr "$queue_dir"/wait.* 2>/dev/null)
  printf '%s' "$ahead"
}

take_slot() {
  local k holder
  for ((k = 1; k <= slots; k++)); do
    if [[ -d "$queue_dir/slot-$k" ]]; then
      # A slot just made has no PID yet; only a slot whose PID is written and dead is free.
      holder="$(cat "$queue_dir/slot-$k/pid" 2>/dev/null || true)"
      [[ -n "$holder" ]] && ! alive "$holder" || continue
      rm -rf "$queue_dir/slot-$k"
    fi
    if mkdir "$queue_dir/slot-$k" 2>/dev/null; then
      printf '%s\n' "$$" >"$queue_dir/slot-$k/pid"
      held_slot="$k"
      return 0
    fi
  done
  return 1
}

queue_enter() {
  local waited next_status=15 limit="${ANA_RUNNER_QUEUE_WAIT:-2400}"
  mkdir -p "$queue_dir"
  ticket="$queue_dir/wait.$$"
  printf '%s\n' "$$" >"$ticket"
  trap release_queue EXIT
  trap 'exit 130' HUP INT TERM
  SECONDS=0
  until [[ "$(tickets_ahead)" == 0 ]] && take_slot; do
    waited=$SECONDS
    if ((waited >= limit)); then
      printf "runner: waited %ss for a slot on %s; no task started\n" "$limit" "${host:-this machine}" >&2
      exit 75
    fi
    if ((waited >= next_status)); then
      printf "runner: waiting for a slot on %s; %s tasks ahead (%ss)\n" "${host:-this machine}" "$(tickets_ahead)" "$waited" >&2
      next_status=$((waited + 15))
    fi
    sleep 1
  done
  rm -f "$ticket"
  ticket=""
}

# A host that does not answer, or lacks capacity for a snapshot, its dependencies and the tests'
# scratch, starts nothing: the M1 stood 94% full on 1 October, and a full disk fails a task midway.
preflight() {
  local free_kib min_gib="${ANA_RUNNER_MIN_FREE_GB:-3}"
  if ! free_kib="$(with_retries on_host 'df -Pk "$HOME" | awk "NR == 2 { print \$4 }"')"; then
    printf "runner: %s does not answer; no sync or task started\n" "$host" >&2
    exit 69
  fi
  if ! [[ "$free_kib" =~ ^[0-9]+$ ]]; then
    printf "runner: %s gave no free-space reading ('%s'); no sync or task started\n" "$host" "$free_kib" >&2
    exit 69
  fi
  if ((free_kib < min_gib * 1024 * 1024)); then
    printf "runner: %s has %s GiB free, below the %s GiB a task needs; no sync or task started\n" \
      "$host" "$((free_kib / 1024 / 1024))" "$min_gib" >&2
    exit 69
  fi
}

# The tree as it stands goes to the slot's folder, minus Git, credentials, run state and anything
# Git ignores; the slot keeps its own .git and the two dependency caches. The ignore merge reads
# every line as an exclude, so a Git `!` re-include is carried ahead of it as an include (tools/runs/
# under the runs/ rule never arrived, 21 September), anchored as Git anchors a pattern with an inner
# slash. The filters are the sender's alone, so a deletion also removes stale sources and run state
# a new ignore rule covers; a receiver-side node_modules rule kept every scratch tree that linked the
# cache (1 October).
push_tree() {
  local line pattern includes=()
  if [[ -f "$1/.gitignore" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == '!'* ]] || continue
      pattern="${line#!}"
      if [[ "${pattern%/}" == */* && "$pattern" != /* ]]; then pattern="/$pattern"; fi
      includes+=(--filter="+s $pattern")
    done <"$1/.gitignore"
  fi
  rsync -az --delete \
    --exclude="/.git" --exclude="/node_modules" --exclude="/packages/ui/node_modules" \
    --filter="-s node_modules" --exclude="/test/.test-timings.json" \
    --filter="-s .env" --filter="-s .env.*" --filter="-s /.harness" \
    --filter="-s /.toolchain" --filter="-s /.agents" --filter="-s /.scratch" \
    --filter="-s /domains" --filter="-s /campaigns" --filter="-s *.zip" \
    ${includes[@]+"${includes[@]}"} \
    --filter=":s- .gitignore" \
    -e "ssh ${ssh_options[*]}" "$1/" "$host:$2/"
}

ship_script() { cat "$runner_dir/lib.sh" "$runner_dir/host.sh" | on_host "cat > '$1.run.sh'"; }

# remote_run <root> <pin> [args...]: the task in the slot's folder on the host. The folder names
# this machine too, so two machines that share a host never share a slot.
remote_run() {
  local root=$1 pin=$2 dir quoted="" strict="" bail="" plain="" status=0
  shift 2
  dir=".cache/ana-runner/$(uname -n | cut -d. -f1)-slot-$held_slot"
  with_retries on_host "mkdir -p '$dir' && rm -f '$dir.status'"
  with_retries push_tree "$root" "$dir"
  printf "runner: sent %s to %s, slot %s\n" "$root" "$host" "$held_slot" >&2
  # With no arguments printf would send one empty one, which changes the suite's routing.
  if (($# > 0)); then printf -v quoted "%q " "$@"; fi
  # The slot is a fresh repository, so the clone's `ana.lintStrict` never reaches it, and every
  # remote lint ran lenient (1 October). The setting goes as the variable lint.ts reads.
  if [[ -n "${ANA_LINT_STRICT:-}" ]]; then
    printf -v strict "ANA_LINT_STRICT=%q " "$ANA_LINT_STRICT"
  elif [[ "$(git -C "$root" config --type=bool --get ana.lintStrict 2>/dev/null || true)" == true ]]; then
    strict="ANA_LINT_STRICT=1 "
  fi
  # A proof of `bun run land` or the pre-push hook stops at its first failed test; the variable
  # that asks for it goes as ANA_LINT_STRICT does, since ssh carries no environment.
  if [[ -n "${ANA_TEST_BAIL:-}" ]]; then printf -v bail "ANA_TEST_BAIL=%q " "$ANA_TEST_BAIL"; fi
  with_retries ship_script "$dir"
  # The forced terminal is what delivers a HUP to the host when ssh drops, so it stays. Where this
  # end is no terminal, the task writes into a pipe instead, so the host's tools draw no progress
  # bars into a log or an agent's output (operator, 27 October).
  [[ -t 1 ]] || plain=" 2>&1 | cat"
  # --norc: a bash started straight under sshd reads ~/.bashrc, and the M1's does not parse.
  ssh "${ssh_options[@]}" -tt "$host" \
    "${strict}${bail}/bin/bash --norc $dir.run.sh $dir $pin $task $wall_seconds $quoted$plain" || status=$?
  # ssh reports its own failures as 255. Otherwise the verdict is the status host.sh left beside
  # the slot, since Tailscale SSH reports 0 whatever the task did; none left is no verdict either.
  if ((status != 255)); then
    status="$(with_retries on_host "cat '$dir.status' 2>/dev/null || true")"
    [[ "$status" =~ ^[0-9]+$ ]] || status=255
  fi
  if ((status == 255)); then
    printf "runner: the connection to %s dropped, or its task left no exit status, so this is no verdict; the host stops what was left\n" "$host" >&2
  fi
  return "$status"
}

status=0
if [[ -n "$host" ]]; then
  pin="$(bun_pin "$root")"
  if [[ -z "$pin" ]]; then
    printf "%s pins no Bun in package.json's packageManager\n" "$root" >&2
    exit 2
  fi
  preflight
  queue_enter
  # A plain call: under `||` bash switches `set -e` off inside it, and a sync that failed for good
  # would go on to test a stale tree. Any failing step, the task included, ends run.sh here.
  remote_run "$root" "$pin" "$@"
else
  queue_enter
  # The task's own `bun` calls must not come back through the shim while this holds the slot.
  export ANA_RUNNER_ACTIVE=1
  reap_stale_runs
  cd "$root"
  bun_path="$(pinned_bun "$root")"
  export PATH="${bun_path%/bun}:$PATH"
  # package.json owns each command: a restated test command once dropped --path-ignore-patterns,
  # and a restated lint kept its own path list and passed a narrowed scope.
  run_walled "$wall_seconds" bun run "$task" "$@" || status=$?
fi
exit "$status"

}; exit
