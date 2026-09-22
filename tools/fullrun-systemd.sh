#!/bin/bash
# Launch one fullrun as a transient unit of the per-user systemd manager, so the run survives the
# launching session on Linux the way tools/fullrun-launchd.zsh keeps it alive under launchd on
# macOS. The two launchers take the same arguments, freeze the same environment map and make the
# same refusals; only the manager differs. systemd needs no descriptor file: `systemd-run` takes
# the argv directly, so there is no plist, digest or receipt to publish and verify.
#
# Usage:
#   tools/fullrun-systemd.sh --worktree DIR --log FILE --label LABEL \
#     [--env K=V]... -- CMD [ARGS...]
#
# The unit is `<label>.service` under `systemctl --user`. Stop and clean up deliberately:
#   systemctl --user kill --kill-whom=main --signal=SIGTERM <label>.service
#   systemctl --user stop <label>.service     # SIGTERM to the group, SIGKILL after five seconds
# `--collect` unloads the unit once it has exited, whatever its result; the log keeps the output.
set -euo pipefail

worktree="" log="" label=""
worktree_seen=0 log_seen=0 label_seen=0
# Five seconds of 10 ms polls for the manager to report the unit running. A test of the not-live
# refusal shortens it through ANA_SYSTEMD_LIVE_WAIT_ATTEMPTS instead of waiting the full window.
controller_live_wait_attempts=${ANA_SYSTEMD_LIVE_WAIT_ATTEMPTS:-500}
envs=() cmd=() env_keys=() env_values=() frozen_path_parts=() program_args=()
while (( $# > 0 )); do
  case "$1" in
    --worktree)
      (( $# >= 2 )) || { echo "--worktree: missing value" >&2; exit 2; }
      (( worktree_seen == 0 )) || { echo "--worktree: may be specified only once" >&2; exit 2; }
      worktree_seen=1; worktree="$2"; shift 2 ;;
    --log)
      (( $# >= 2 )) || { echo "--log: missing value" >&2; exit 2; }
      (( log_seen == 0 )) || { echo "--log: may be specified only once" >&2; exit 2; }
      log_seen=1; log="$2"; shift 2 ;;
    --label)
      (( $# >= 2 )) || { echo "--label: missing value" >&2; exit 2; }
      (( label_seen == 0 )) || { echo "--label: may be specified only once" >&2; exit 2; }
      label_seen=1; label="$2"; shift 2 ;;
    --env)
      (( $# >= 2 )) || { echo "--env: missing value" >&2; exit 2; }
      envs+=("$2"); shift 2 ;;
    --) shift; cmd=("$@"); break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$worktree" || -z "$log" || -z "$label" || ${#cmd[@]} -eq 0 ]]; then
  echo "usage: fullrun-systemd.sh --worktree DIR --log FILE --label LABEL [--env K=V]... -- CMD [ARGS...]" >&2
  exit 2
fi
if [[ ! "$label" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "invalid unit label: $label" >&2
  exit 2
fi
[[ "$log" == /* ]] || { echo "log path must be absolute: $log" >&2; exit 2; }

worktree="$(realpath -e -- "$worktree" 2>/dev/null)" || { echo "worktree does not exist: $worktree" >&2; exit 2; }
[[ -d "$worktree" ]] || { echo "worktree does not exist: $worktree" >&2; exit 2; }
[[ -f "$worktree/.bun-version" ]] || { echo "worktree has no .bun-version: $worktree" >&2; exit 2; }

# The launched process receives one exact environment map. Requiring the private homes and temp
# root alongside PATH keeps the unit independent of the shell which prepared it; a duplicate key
# would let the later value silently win.
for pair in "${envs[@]}"; do
  if [[ "$pair" != *=* ]]; then
    echo "--env must be KEY=VALUE: $pair" >&2
    exit 2
  fi
  key="${pair%%=*}"
  value="${pair#*=}"
  if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "invalid environment key: $key" >&2
    exit 2
  fi
  for seen in "${env_keys[@]}"; do
    if [[ "$seen" == "$key" ]]; then
      echo "duplicate environment key: $key" >&2
      exit 2
    fi
  done
  env_keys+=("$key")
  env_values+=("$value")
done

frozen_home="" frozen_path="" frozen_tmpdir="" frozen_codex_home=""
for index in "${!env_keys[@]}"; do
  case "${env_keys[$index]}" in
    HOME) frozen_home="${env_values[$index]}" ;;
    PATH) frozen_path="${env_values[$index]}" ;;
    TMPDIR) frozen_tmpdir="${env_values[$index]}" ;;
    CODEX_HOME) frozen_codex_home="${env_values[$index]}" ;;
  esac
done
if [[ -z "$frozen_home" || -z "$frozen_path" || -z "$frozen_tmpdir" || -z "$frozen_codex_home" ]]; then
  echo "--env must freeze exactly one HOME, CODEX_HOME, TMPDIR, and PATH" >&2
  exit 2
fi
[[ "$frozen_home" == /* ]] || { echo "frozen HOME must be absolute" >&2; exit 2; }
[[ "$frozen_tmpdir" == /* ]] || { echo "frozen TMPDIR must be absolute" >&2; exit 2; }
# The launcher owns the frozen environment, so it also owns the directory that environment names.
mkdir -p -- "$frozen_tmpdir" || { echo "frozen TMPDIR could not be created: $frozen_tmpdir" >&2; exit 2; }
[[ "$frozen_codex_home" == /* ]] || { echo "frozen CODEX_HOME must be absolute" >&2; exit 2; }
IFS=: read -r -a frozen_path_parts <<< "$frozen_path"
for path_part in "${frozen_path_parts[@]}"; do
  [[ -n "$path_part" && "$path_part" == /* ]] || {
    echo "frozen PATH entries must be non-empty absolute paths" >&2
    exit 2
  }
done
if (( $(printf '%s\n' "${frozen_path_parts[@]}" | sort | uniq -d | wc -l) > 0 )); then
  echo "frozen PATH contains a duplicate entry" >&2
  exit 2
fi

resolve_frozen_command() {
  local name="$1" candidate="" directory=""
  if [[ "$name" == /* ]]; then
    [[ -x "$name" && ! -d "$name" ]] || return 1
    realpath -e -- "$name"
    return 0
  fi
  if [[ "$name" == */* ]]; then
    candidate="$worktree/$name"
    [[ -x "$candidate" && ! -d "$candidate" ]] || return 1
    realpath -e -- "$candidate"
    return 0
  fi
  for directory in "${frozen_path_parts[@]}"; do
    candidate="$directory/$name"
    if [[ -x "$candidate" && ! -d "$candidate" ]]; then
      realpath -e -- "$candidate"
      return 0
    fi
  done
  return 1
}

# The command executable is resolved through the same frozen PATH the unit receives. A fullrun
# starts with Bun, so that exact executable must satisfy the worktree's pin before systemd sees it.
head_cmd="$(resolve_frozen_command "${cmd[0]}")" || {
  echo "command not found in frozen PATH: ${cmd[0]}" >&2
  exit 2
}
expected="$(<"$worktree/.bun-version")"
actual="$("$head_cmd" --version 2>/dev/null || true)"
if [[ "$actual" != "$expected" ]]; then
  echo "the frozen command reports Bun ${actual:-absent}, the worktree pins $expected; select the pinned Bun first" >&2
  exit 2
fi
if [[ -L "$worktree/node_modules" ]]; then
  echo "node_modules is a symlink — a run must own its dependencies; run scripts/worktree.sh setup $worktree from a prepared checkout" >&2
  exit 2
fi
cmd[0]="$head_cmd"

unit="$label.service"
unit_state() {
  systemctl --user show --property=LoadState,ActiveState,MainPID -- "$unit" 2>&1
}
if [[ "$(unit_state)" != *"LoadState=not-found"* ]]; then
  echo "unit $unit is already loaded; stop it first" >&2
  exit 2
fi

# The manager's own environment is additive, like launchd's. `env -i` runs the same Bun process
# with only the frozen map, one argv element per assignment and per command argument.
program_args=("/usr/bin/env" "-i")
for index in "${!env_keys[@]}"; do
  program_args+=("${env_keys[$index]}=${env_values[$index]}")
done
program_args+=("${cmd[@]}")

# `--collect` unloads the unit after exit so a finished run leaves no failed unit behind; the
# five-second stop timeout lets `systemctl --user stop` end a stubborn tree promptly. The manager
# expands `${VAR}` and `$$` inside command arguments and assignments by default, after the shell
# has quoted them: a prompt holding `${HOME}` would reach the controller as the unit's home.
# `--expand-environment=no` (systemd 254 and later) delivers the argv bytes as given.
systemd-run --user --collect --quiet --expand-environment=no --unit "$label" \
  --property=WorkingDirectory="$worktree" \
  --property=StandardOutput=append:"$log" \
  --property=StandardError=append:"$log" \
  --property=TimeoutStopSec=5 \
  -- "${program_args[@]}"

attempts=0
while true; do
  state="$(unit_state)"
  if [[ "$state" == *"ActiveState=active"* ]] && [[ "$state" =~ MainPID=[1-9][0-9]* ]]; then
    break
  fi
  if (( attempts >= controller_live_wait_attempts )); then
    echo "controller unit is not live after systemd-run: $unit" >&2
    exit 2
  fi
  sleep 0.01
  (( attempts += 1 ))
done

echo "launched $unit"
echo "  worktree: $worktree"
echo "  log:      $log"
echo "  watch:    tail -F $log"
echo "  status:   systemctl --user show -p ActiveState,MainPID $unit"
echo "The controller pid is written to .controller.lock in the campaign directory, not the unit's main pid."
