#!/bin/zsh -f
# -f (NO_RCS): without it ~/.zshenv can reorder PATH onto a different Bun executable than the
# launching shell selected.
# Launch one fullrun as a per-run launchd user job, so the run survives the launching session:
# task cleanup of the session's process tree, the session ending, and terminal closure all leave
# the job running under the per-user launchd. Runs 40 and 43 (2026-08-01) died from exactly that
# process-tree cleanup; nohup/setsid/disown do not cover it.
#
# Usage:
#   tools/fullrun-launchd.zsh --worktree DIR --log FILE --label LABEL \
#     [--env K=V]... -- CMD [ARGS...]
#
# Example:
#   tools/fullrun-launchd.zsh \
#     --worktree "$(pwd -P)" --log "$(pwd -P)/fullrun-run45.log" --label ana.fullrun.run45 \
#     --env "HOME=/absolute/private-home" --env "CODEX_HOME=/absolute/private-codex-home" \
#     --env "TMPDIR=/absolute/private-tmp" --env "PATH=/absolute/pinned-bun:/usr/bin:/bin" \
#     --env "CODEX_BUILDER_MODEL=gpt-5.6-sol" --env "CODEX_BUILT_MODEL=gpt-5.6-sol" --env "CODEX_REVIEW_MODEL=gpt-5.6-sol" \
#     --env "CODEX_BUILDER_REASONING_EFFORT=high" --env "CODEX_BUILT_REASONING_EFFORT=high" --env "CODEX_REVIEW_REASONING_EFFORT=medium" \
#     -- bun run fullrun -- --run run45 --prompt "the exact user request"
#
# The prompt stays one ProgramArguments element — never interpolated into a shell string.
# Stop and clean up deliberately:
#   launchctl kill TERM "gui/$(id -u)/<label>"   # then verify the .controller.lock pid is dead
#   launchctl bootout "gui/$(id -u)/<label>"
#   rm -f "<worktree>/.launchd/<label>.plist" \
#         "<worktree>/.launchd/<label>.plist.receipt.json"  # only after bootout
set -euo pipefail

worktree="" log="" label=""
plist_staging="" lint_pid=""
controller_published=0 controller_owned=0
plist_receipt="" plist_digest=""
worktree_seen=0 log_seen=0 label_seen=0
# Five seconds of 10 ms polls for the controller to report running. A test of the not-live
# refusal shortens it through ANA_LAUNCHD_LIVE_WAIT_ATTEMPTS instead of waiting the full window.
controller_live_wait_attempts=${ANA_LAUNCHD_LIVE_WAIT_ATTEMPTS:-500}
typeset -a envs cmd env_keys env_values frozen_path_parts program_args render_args
while (( $# > 0 )); do
  case "$1" in
    --worktree)
      (( $# >= 2 )) || { print -u2 -- "--worktree: missing value"; exit 2 }
      (( worktree_seen == 0 )) || { print -u2 -- "--worktree: may be specified only once"; exit 2 }
      worktree_seen=1; worktree="$2"; shift 2 ;;
    --log)
      (( $# >= 2 )) || { print -u2 -- "--log: missing value"; exit 2 }
      (( log_seen == 0 )) || { print -u2 -- "--log: may be specified only once"; exit 2 }
      log_seen=1; log="$2"; shift 2 ;;
    --label)
      (( $# >= 2 )) || { print -u2 -- "--label: missing value"; exit 2 }
      (( label_seen == 0 )) || { print -u2 -- "--label: may be specified only once"; exit 2 }
      label_seen=1; label="$2"; shift 2 ;;
    --env)
      (( $# >= 2 )) || { print -u2 -- "--env: missing value"; exit 2 }
      envs+=("$2"); shift 2 ;;
    --) shift; cmd=("$@"); break ;;
    *) print -u2 "unknown argument: $1"; exit 2 ;;
  esac
done
if [[ -z "$worktree" || -z "$log" || -z "$label" || ${#cmd} -eq 0 ]]; then
  print -u2 "usage: fullrun-launchd.zsh --worktree DIR --log FILE --label LABEL [--env K=V]... -- CMD [ARGS...]"
  exit 2
fi
if [[ ! "$label" =~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' ]]; then
  print -u2 "invalid launchd label: $label"
  exit 2
fi

worktree="${worktree:A}"
[[ -d "$worktree" ]] || { print -u2 "worktree does not exist: $worktree"; exit 2 }
[[ -f "$worktree/.bun-version" ]] || { print -u2 "worktree has no .bun-version: $worktree"; exit 2 }

# The launched process receives one exact environment map. Requiring the private homes and temp
# root alongside PATH keeps the plist independent of the shell which prepared it; rejecting
# duplicate keys prevents plutil from silently choosing one of two values.
local_arg=""
for local_arg in "${envs[@]}"; do
  if [[ "$local_arg" != *=* ]]; then
    print -u2 -- "--env must be KEY=VALUE: $local_arg"
    exit 2
  fi
  key="${local_arg%%=*}"
  value="${local_arg#*=}"
  if [[ ! "$key" =~ '^[A-Za-z_][A-Za-z0-9_]*$' ]]; then
    print -u2 "invalid environment key: $key"
    exit 2
  fi
  if (( ${env_keys[(Ie)$key]} > 0 )); then
    print -u2 "duplicate environment key: $key"
    exit 2
  fi
  env_keys+=("$key")
  env_values+=("$value")
done

home_index=${env_keys[(Ie)HOME]:-0}
path_index=${env_keys[(Ie)PATH]:-0}
tmpdir_index=${env_keys[(Ie)TMPDIR]:-0}
codex_home_index=${env_keys[(Ie)CODEX_HOME]:-0}
if (( home_index == 0 || path_index == 0 || tmpdir_index == 0 || codex_home_index == 0 )); then
  print -u2 -- "--env must freeze exactly one HOME, CODEX_HOME, TMPDIR, and PATH"
  exit 2
fi
frozen_home="${env_values[$home_index]}"
frozen_path="${env_values[$path_index]}"
frozen_tmpdir="${env_values[$tmpdir_index]}"
frozen_codex_home="${env_values[$codex_home_index]}"
[[ "$frozen_home" == /* ]] || { print -u2 "frozen HOME must be absolute"; exit 2 }
[[ "$frozen_tmpdir" == /* ]] || { print -u2 "frozen TMPDIR must be absolute"; exit 2 }
# The launcher owns the frozen environment, so it also owns the directory that environment names:
# the 2026-09-02 truss launch created a project and then died ENOENT on its first mkdtemp.
mkdir -p -- "$frozen_tmpdir" || { print -u2 "frozen TMPDIR could not be created: $frozen_tmpdir"; exit 2 }
[[ "$frozen_codex_home" == /* ]] || { print -u2 "frozen CODEX_HOME must be absolute"; exit 2 }
frozen_path_parts=("${(@s/:/)frozen_path}")
typeset -a seen_path_parts
path_part=""
for path_part in "${frozen_path_parts[@]}"; do
  [[ -n "$path_part" && "$path_part" == /* ]] || {
    print -u2 "frozen PATH entries must be non-empty absolute paths"
    exit 2
  }
  if (( ${seen_path_parts[(Ie)$path_part]} > 0 )); then
    print -u2 "frozen PATH contains a duplicate entry: $path_part"
    exit 2
  fi
  seen_path_parts+=("$path_part")
done

resolve_frozen_command() {
  local name="$1" candidate="" directory=""
  if [[ "$name" == /* ]]; then
    [[ -x "$name" && ! -d "$name" ]] || return 1
    print -r -- "${name:A}"
    return 0
  fi
  if [[ "$name" == */* ]]; then
    candidate="$worktree/$name"
    [[ -x "$candidate" && ! -d "$candidate" ]] || return 1
    print -r -- "${candidate:A}"
    return 0
  fi
  for directory in "${frozen_path_parts[@]}"; do
    candidate="$directory/$name"
    if [[ -x "$candidate" && ! -d "$candidate" ]]; then
      print -r -- "${candidate:A}"
      return 0
    fi
  done
  return 1
}

# The command executable is resolved through the same frozen PATH the job receives. A fullrun
# starts with Bun, so that exact executable must satisfy the worktree's patch pin before launchctl
# sees the plist.
head_cmd="$(resolve_frozen_command "${cmd[1]}")" || {
  print -u2 "command not found in frozen PATH: ${cmd[1]}"
  exit 2
}
expected="$(<"$worktree/.bun-version")"
actual="$("$head_cmd" --version 2>/dev/null || true)"
if [[ "$actual" != "$expected" ]]; then
  print -u2 "the frozen command reports Bun ${actual:-absent}, the worktree pins $expected; select the pinned Bun first"
  exit 2
fi
if [[ -L "$worktree/node_modules" ]]; then
  print -u2 "node_modules is a symlink — a run must own its dependencies; run scripts/worktree.sh setup $worktree from a prepared checkout"
  exit 2
fi

# The job's first argument is absolute because launchd resolves no PATH at spawn time.
cmd[1]="$head_cmd"

uid="$(id -u)"
service="gui/$uid/$label"
plist_dir="$worktree/.launchd"
plist="$plist_dir/$label.plist"
plist_receipt="$plist.receipt.json"
publish_helper="${0:A:h}/fullrun-launchd-publish.ts"

# launchd's EnvironmentVariables dictionary is additive to the per-user manager environment. An
# omitted variable could therefore change the condition through `launchctl setenv`. `env -i`
# executes the same Bun process with only the frozen map, while retaining one argv element per
# assignment and per command argument.
program_args=("/usr/bin/env" "-i")
index=1
while (( index <= ${#env_keys} )); do
  program_args+=("${env_keys[$index]}=${env_values[$index]}")
  (( index += 1 ))
done
program_args+=("${cmd[@]}")
xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; s="${s//$'\r'/&#13;}"
  print -rn -- "$s"
}

if [[ -L "$plist_dir" ]]; then
  print -u2 "launchd directory must not be a symlink: $plist_dir"
  exit 2
fi
if [[ -e "$plist_dir" && ! -d "$plist_dir" ]]; then
  print -u2 "launchd directory is not a directory: $plist_dir"
  exit 2
fi
mkdir -p "$plist_dir"
if [[ -L "$plist_dir" || ! -d "$plist_dir" ]]; then
  print -u2 "launchd directory changed while it was being prepared: $plist_dir"
  exit 2
fi
if [[ -e "$plist" || -L "$plist" ]]; then
  print -u2 "plist already exists; bootout and preserve or remove it deliberately: $plist"
  exit 2
fi
if [[ -e "$plist_receipt" || -L "$plist_receipt" ]]; then
  print -u2 "plist digest receipt already exists; preserve or remove it deliberately: $plist_receipt"
  exit 2
fi
if launchctl print "$service" >/dev/null 2>&1; then
  print -u2 "service $service is already loaded; bootout first"
  exit 2
fi
launch_complete=0

write_plist() {
  local target="$1" target_label="$2" receipt="$3"
  plist_staging="$(mktemp "$plist_dir/.${target_label}.plist.XXXXXX")"
  {
    print '<?xml version="1.0" encoding="UTF-8"?>'
    print '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    print '<plist version="1.0"><dict>'
    print -rn '  <key>Label</key><string>'; xml_escape "$target_label"; print '</string>'
    print '  <key>ProgramArguments</key><array>'
    local_arg=""
    for local_arg in "${render_args[@]}"; do
      print -rn '    <string>'; xml_escape "$local_arg"; print '</string>'
    done
    print '  </array>'
    print -rn '  <key>WorkingDirectory</key><string>'; xml_escape "$worktree"; print '</string>'
    print -rn '  <key>StandardOutPath</key><string>'; xml_escape "$log"; print '</string>'
    print -rn '  <key>StandardErrorPath</key><string>'; xml_escape "$log"; print '</string>'
    print '  <key>RunAtLoad</key><true/>'
    print '</dict></plist>'
  } > "$plist_staging"

  exec 3<"$plist_staging"
  exec 4<"$plist_staging"
  /bin/rm -f -- "$plist_staging"
  plist_staging=""
  plutil -lint -s /dev/fd/3 4<&- &
  lint_pid=$!
  if wait "$lint_pid"; then
    lint_pid=""
  else
    lint_status=$?
    lint_pid=""
    exec 3<&- 4<&- || true
    return "$lint_status"
  fi
  exec 3<&-
  published_digest="$($head_cmd --no-env-file "$publish_helper" "$target" "$receipt" <&4)"
  exec 4<&-
  [[ "$published_digest" =~ '^[0-9a-f]{64}$' ]] || {
    print -u2 "publisher returned an invalid plist SHA-256: $published_digest"
    return 2
  }
  "$head_cmd" --no-env-file "$publish_helper" --verify "$target" "$published_digest" >/dev/null || {
    print -u2 "published plist changed before launchctl bootstrap: $target"
    return 2
  }
}

remove_unowned_publication() {
  local target="$1" receipt="$2" digest="$3"
  if [[ -f "$target" && ! -L "$target" ]] && "$head_cmd" --no-env-file "$publish_helper" --verify "$target" "$digest" >/dev/null 2>&1; then
    /bin/rm -f -- "$target" || true
    if [[ -f "$receipt" && ! -L "$receipt" ]]; then /bin/rm -f -- "$receipt" || true; fi
  fi
}

bootstrap_service() {
  local service_name="$1" descriptor="$2"
  if launchctl bootstrap "gui/$uid" "$descriptor"; then
    return 0
  else
    bootstrap_status=$?
  fi
  # A service visible after a failed bootstrap may belong to another launcher. This invocation
  # did not establish it and therefore must preserve the original refusal.
  return "$bootstrap_status"
}

verify_bootstrapped_plist() {
  local service_name="$1" target="$2" digest="$3"
  if "$head_cmd" --no-env-file "$publish_helper" --verify "$target" "$digest" >/dev/null 2>&1; then
    return 0
  fi
  print -u2 "published plist changed after bootstrap; booting out $service_name: $target"
  launchctl bootout "$service_name" >/dev/null 2>&1 || true
  return 2
}

launchctl_service_live() {
  local service_name="$1" output="" exit_status=0
  output="$(launchctl print "$service_name" 2>&1)" || { exit_status=$?; return "$exit_status"; }
  [[ "$output" == *"state = running"* ]] || return 2
  [[ "$output" =~ '(^|[[:space:]])pid[[:space:]]*=[[:space:]]*[1-9][0-9]*([[:space:]]|$)' ]] || return 2
}

wait_for_controller_live() {
  local attempts=0 observed_status=0
  while true; do
    if launchctl_service_live "$service"; then
      return 0
    else
      observed_status=$?
    fi
    (( observed_status == 2 )) || return "$observed_status"
    (( attempts < controller_live_wait_attempts )) || return 2
    /bin/sleep 0.01
    (( attempts += 1 ))
  done
}

cleanup() {
  local cleanup_status=$?
  trap - EXIT INT TERM HUP
  if [[ -n "$lint_pid" ]]; then
    kill -TERM "$lint_pid" 2>/dev/null || true
    wait "$lint_pid" 2>/dev/null || true
    lint_pid=""
  fi
  if [[ -n "$plist_staging" && -e "$plist_staging" ]]; then
    /bin/rm -f -- "$plist_staging"
  fi
  if (( launch_complete == 0 && controller_owned == 1 )); then
    launchctl bootout "$service" >/dev/null 2>&1 || true
  fi
  if (( controller_published == 1 && controller_owned == 0 )); then
    remove_unowned_publication "$plist" "$plist_receipt" "$plist_digest"
  fi
 return "$cleanup_status"
}

interrupt() {
  local signal_status="$1"
  cleanup
  exit "$signal_status"
}

trap cleanup EXIT
trap 'interrupt 130' INT
trap 'interrupt 143' TERM
trap 'interrupt 129' HUP

render_args=("${program_args[@]}")
write_plist "$plist" "$label" "$plist_receipt"
plist_digest="$published_digest"
controller_published=1
print "published plist:         $plist"
print "plist digest receipt:    $plist_receipt"
print "published plist SHA-256: $plist_digest"

if bootstrap_service "$service" "$plist"; then
  controller_owned=1
else
  exit "$bootstrap_status"
fi
verify_bootstrapped_plist "$service" "$plist" "$plist_digest" || exit $?
wait_for_controller_live || {
  live_status=$?
  print -u2 "controller service is not live after bootstrap"
  exit "$live_status"
}

launch_complete=1
print "launched $service"
print "  worktree: $worktree"
print "  log:      $log"
print "  plist:    $plist"
print "  watch:    tail -F $log"
print "  status:   launchctl print $service"
print "The controller pid is written to .controller.lock in the campaign directory, not the launchd pid."
