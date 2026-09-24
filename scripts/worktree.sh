#!/usr/bin/env bash
# Create worktrees, prepare them, run commands in them, and say what exists.
#
#   scripts/worktree.sh new <branch> <absolute-dir> [start-point] [--scope S]
#   scripts/worktree.sh pr <number> <absolute-dir> [branch] [--scope S]
#   scripts/worktree.sh setup <absolute-dir> [--scope S]
#   scripts/worktree.sh run <absolute-dir> <command...>     # e.g. a focused test
#   scripts/worktree.sh list
#   scripts/worktree.sh drop <absolute-dir> [--force]
#
# --scope says how much of the local checkout the new tree gets. The default is `medium`,
# which is what every worktree got before the scope existed.
#
#   minimal   the Git worktree alone: no Bun check, no node_modules, no local state. This is
#             the whole preparation a change under docs/, README.md, AGENTS.md or a
#             .claude/**/*.md needs, because the pre-push hook excludes exactly those paths
#             and runs `git diff --check` alone on them. Seconds instead of a clone.
#   medium    minimal plus a prepared node_modules. Anything that loads a repository module —
#             every test, every check, every Bun entrypoint — needs this.
#   maximum   medium plus the source checkout's ignored local state, so the tree starts with
#             the installed toolchain and the learned test ordering rather than rebuilding
#             them. LOCAL_STATE below lists what travels; REFUSED_STATE lists what must not,
#             with the reason on each line.
#
# A prepared worktree owns a real node_modules carrying a marker that names the dependency
# identity it realised: bun.lock plus the package.json fields that change the installed graph.
# `setup` does nothing when the marker already matches. Otherwise it clones node_modules
# copy-on-write from the first worktree of this repository whose marker matches, and runs one
# frozen install when none does. The marker, not the source's lock, selects the source: on
# 2026-09-02 the main checkout carried a morning lock over a tree installed ten days earlier,
# and every clone from it failed the push gate.
#
# The clone is the reason nothing here links. A node_modules symlinked to another checkout
# resolves @ana/* into that tree's vendor/ with no error, so a link is never treated as
# prepared, and both run launchers refuse a linked tree outright before they spend anything
# (src/run/full-run-launch.ts, tools/fullrun-systemd.sh). On APFS and on any filesystem with
# reflinks the clone shares the blocks anyway, so the link would buy nothing it does not
# already have.
#
# `run` prepares a worktree whose node_modules is absent, linked or prepared for other
# dependencies, refuses only while another command is standing in that tree, then execs the
# command. Progress goes to stderr, so the command owns stdout.
set -euo pipefail

MARKER=.ana-dependency-identity
script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

# Ignored paths a `maximum` tree inherits. Each is expensive to rebuild and carries no identity
# of its own, so a copy is the same thing the tree would have produced.
LOCAL_STATE=(
  .toolchain                 # installed real tools; a rebuild is a download per tool
  test/.test-timings.json    # slowest-first ordering the wrapper learned from its last run
)

# Ignored paths that must not travel, and why. `maximum` names each one it skipped rather than
# leaving the omission silent.
REFUSED_STATE=(
  ".env|credentials: resolution order is process env then .env.cloud, .env.local, .env"
  "campaigns|recorded run evidence, controller-owned"
  "domains|generated product bundles, controller-owned"
  "runs|recorded case output"
  "notes/runs|archived run reviews"
  ".claude/skills/run-cycles/results|recorded batteries quoting hidden expectations"
  ".harness|run state; the tracked backends/ already travels with the checkout"
  ".venv|a virtualenv records its own absolute path and breaks when moved"
  ".uv-cache|rebuilt on demand and larger than what it saves"
  ".scratch|transient, and this script writes its own clones there"
)

say() { echo "$*" >&2; }
fail() { say "$*"; exit 1; }

# --- Preconditions ---------------------------------------------------------------------------

# Refuse before install or execution unless PATH names the exact Bun release the worktree
# declares. No version-manager fallback can silently select another runtime.
use_pinned_bun() {
  local dir=$1 version found
  version=$(tr -d '[:space:]' 2>/dev/null < "$dir/.bun-version" || true)
  [ -n "$version" ] || fail "$dir has no Bun pin in .bun-version"
  command -v bun >/dev/null 2>&1 || fail "Bun $version is required but bun is not on PATH"
  found=$(bun --version 2>/dev/null || echo none)
  [ "$found" = "$version" ] || fail ".bun-version asks for $version, bun is $found"
}

absolute() {
  case "$1" in /*) ;; *) fail "worktree directory must be absolute: $1" ;; esac
}

# Print the physical root of the worktree named by an absolute path, or refuse.
worktree_root() {
  local dir=$1 root
  absolute "$dir"
  [ -d "$dir" ] || fail "worktree does not exist: $dir"
  dir=$(cd "$dir" && pwd -P)
  root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || fail "$dir is not a Git worktree"
  [ "$(cd "$root" && pwd -P)" = "$dir" ] || fail "$dir is inside a worktree but is not its root"
  printf '%s\n' "$dir"
}

dependency_identity() {
  bun --no-env-file "$script_root/tools/dependency-identity.ts" "$1" ||
    fail "cannot read the dependency identity of $1 (bun.lock and package.json)"
}

# --- Dependencies ----------------------------------------------------------------------------

# Every package under `packages/` that declares dependencies owns a node_modules of its own. A
# tree missing one is not prepared, whatever the root marker says: `run` would otherwise exec
# into it and the type-aware lint would report an error type for React rather than the absent
# directory (bf00dc7eb).
workspace_modules_present() {
  local manifest package
  for manifest in "$1"/packages/*/package.json; do
    [ -f "$manifest" ] || continue
    grep -q '"dependencies"' "$manifest" || continue
    package=${manifest%/package.json}
    [ -d "$package/node_modules" ] || return 1
  done
  return 0
}

# Set `installed` to the identity a real node_modules was prepared for: empty when node_modules
# is absent, a symlink, unmarked, or missing a workspace package's own modules.
read_marker() {
  installed=
  [ -d "$1/node_modules" ] && [ ! -L "$1/node_modules" ] && [ -f "$1/node_modules/$MARKER" ] || return 0
  workspace_modules_present "$1" || return 0
  read -r installed < "$1/node_modules/$MARKER" || true
}

# Print every worktree of this repository, the caller's own checkout first.
every_worktree() {
  local dir=$1 line
  printf '%s\n' "$(git rev-parse --show-toplevel 2>/dev/null)"
  while IFS= read -r line; do
    case "$line" in "worktree "*) printf '%s\n' "${line#worktree }" ;; esac
  done < <(git -C "$dir" worktree list --porcelain)
}

# Print the first prepared tree for the identity.
clone_source() {
  local want=$1 dir=$2 candidate
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    read_marker "$candidate"
    [ "$installed" = "$want" ] || continue
    printf '%s\n' "$candidate"
    return
  done < <(every_worktree "$dir")
}

# Clone into ignored scratch space and rename, so an interrupted copy never leaves a partial
# tree under its real name. A concurrent preparer that finished first keeps its tree. APFS
# clones copy-on-write (`cp -c`); GNU cp reflinks where the filesystem can and copies bytes
# elsewhere.
clone_path() {
  local source=$1 dir=$2 name=$3 partial="$2/.scratch/clone-$$-${3//\//_}"
  mkdir -p "$dir/.scratch"
  rm -rf "$partial"
  if { cp -Rc "$source/$name" "$partial" 2>/dev/null ||
      { rm -rf "$partial" && cp -R --reflink=auto "$source/$name" "$partial" 2>/dev/null; }; } &&
    [ ! -e "$dir/$name" ] && mkdir -p "$(dirname "$dir/$name")" && mv "$partial" "$dir/$name"; then
    return 0
  fi
  rm -rf "$partial"
  return 1
}

# Prove every declared @ana package is installed and resolves inside this worktree rather than
# in the tree the dependencies came from; both otherwise fail silently.
assert_ana_local() {
  (cd "$1" && bun --no-env-file -e '
    const cwd = import.meta.dir;
    const pkg = await Bun.file("package.json").json();
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    const names = Object.keys(declared).filter((name) => name.startsWith("@ana/"));
    const missing = [];
    const stray = [];
    for (const name of names) {
      let resolved;
      try {
        resolved = Bun.resolveSync(name, cwd);
      } catch {
        missing.push(name);
        continue;
      }
      if (!resolved.startsWith(`${cwd}/`)) stray.push(`${name} -> ${resolved}`);
    }
    if (missing.length) console.error(`declared but not installed: ${missing.join(", ")}`);
    if (stray.length) console.error("@ana resolves outside this worktree:\n  " + stray.join("\n  "));
    if (missing.length || stray.length) Bun.exit(1);
    console.error(`@ana: ${names.length} packages resolve inside the worktree`);
  ')
}

# A package under `packages/` is outside the root workspaces: it carries its own lock and its own
# node_modules, and the root install does not reach them. `bun run lint` is type-aware over
# `packages/`, so a tree missing `packages/ui`'s @types/react reports
# `HTMLAttributes<HTMLSpanElement>` as an error type at the gate's lint step — four steps before
# `ui` would have installed it, and naming a type rather than the absent directory.
prepare_packages() {
  local dir=$1 source=$2 lock name
  for lock in "$dir"/packages/*/bun.lock; do
    [ -f "$lock" ] || continue
    name=packages/$(basename "$(dirname "$lock")")
    [ ! -d "$dir/$name/node_modules" ] || continue
    if [ -z "$source" ] || [ ! -d "$source/$name/node_modules" ] ||
      ! clone_path "$source" "$dir" "$name/node_modules"; then
      (cd "$dir" && bun install --frozen-lockfile --cwd "$name") >&2
    fi
  done
}

prepare() {
  local dir=$1 want=$2 source=""
  read_marker "$dir"
  if [ "$installed" = "$want" ]; then
    say "node_modules: already prepared for dependency identity ${want:0:12}"
  else
    # Replacing node_modules takes the modules a running command is importing out from under it.
    # Every entry point reaches the removal through here, so the refusal stands here rather than
    # beside one of them. An absent node_modules takes nothing from anyone.
    { [ -e "$dir/node_modules" ] || [ -L "$dir/node_modules" ]; } && busy "$dir" && fail "$dir is in use by a running command and its node_modules is linked, unmarked or prepared for other dependencies; run scripts/worktree.sh setup $dir when it is free"
    source=$(clone_source "$want" "$dir")
    rm -rf "$dir/node_modules"
    if [ -n "$source" ] && clone_path "$source" "$dir" node_modules; then
      say "node_modules: cloned from $source"
    else
      if [ -n "$source" ]; then
        say "node_modules: clone from $source failed, installing"
      else
        say "node_modules: no worktree is prepared for dependency identity ${want:0:12}, installing"
      fi
      (cd "$dir" && bun install --frozen-lockfile) >&2
      printf '%s\n' "$want" > "$dir/node_modules/$MARKER"
    fi
  fi
  prepare_packages "$dir" "$source"
  assert_ana_local "$dir"
}

# --- Local state (scope maximum) ---------------------------------------------------------------

# Copy the ignored paths a tree may inherit from the checkout that owns this invocation, and
# name the ones that exist there and stay behind. Nothing here is required: a missing path is
# simply the thing the tree will build for itself.
mirror_local_state() {
  local dir=$1 source name reason entry taken=() left=()
  source=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  [ -n "$source" ] && [ "$source" != "$dir" ] || return 0
  for name in "${LOCAL_STATE[@]}"; do
    [ -e "$source/$name" ] || continue
    [ ! -e "$dir/$name" ] || continue
    mkdir -p "$(dirname "$dir/$name")"
    if [ -d "$source/$name" ]; then
      if clone_path "$source" "$dir" "$name"; then taken+=("$name"); else say "local state: could not clone $name"; fi
    elif cp -p "$source/$name" "$dir/$name"; then
      taken+=("$name")
    else
      say "local state: could not copy $name"
    fi
  done
  for entry in "${REFUSED_STATE[@]}"; do
    name=${entry%%|*}
    reason=${entry#*|}
    if [ -e "$source/$name" ]; then left+=("$name ($reason)"); fi
  done
  [ ${#taken[@]} -eq 0 ] || say "local state: copied ${taken[*]}"
  if [ ${#left[@]} -ne 0 ]; then
    say "local state: left behind ${#left[@]} path(s)"
    printf '  %s\n' "${left[@]}" >&2
  fi
}

# --- Commands ----------------------------------------------------------------------------------

cmd_setup() {
  local dir want scope=${SCOPE:-medium}
  dir=$(worktree_root "$1")
  if [ "$scope" = minimal ]; then
    say "scope minimal: no dependency preparation. Run setup again for a source change."
    say "  publishing a branch this remote has never seen runs the whole gate whatever the diff"
    say "  touched (.githooks/pre-push reads an all-zero remote sha), so prepare before that push."
  else
    use_pinned_bun "$dir"
    want=$(dependency_identity "$dir")
    prepare "$dir" "$want"
    [ "$scope" = maximum ] && mirror_local_state "$dir"
  fi
  say
  say "worktree ready: $dir (scope $scope)"
  say "  edit proof: scripts/worktree.sh run $dir bun run test -- <owning-test>"
  say "  source delivery: one normal git push runs the final gate; do not run it first"
  say "  run state and configuration: use their owning workflow; do not copy them from another checkout"
}

# Create the branch, then prepare. A fetch moves refs every worktree shares, so only a remote
# start-point pays for one; pull/<n> refs are fetched by `pr` and a generic fetch misses them.
cmd_new() {
  local branch=$1 dir=$2 start=${3:-origin/main} repo
  absolute "$dir"
  repo=$(git rev-parse --show-toplevel)
  case "$start" in
    origin/pr/*|refs/remotes/origin/pr/*) ;;
    origin/*|refs/remotes/origin/*) git -C "$repo" fetch origin --quiet ;;
  esac
  git -C "$repo" worktree add -b "$branch" "$dir" "$start" >&2
  trap "say 'setup failed; remove the new worktree with: git worktree remove --force $dir'" EXIT
  cmd_setup "$dir"
  trap - EXIT
}

# A worktree on a published pull request head. The PR's own source branch may be checked out
# somewhere else, so the new branch is always distinct and the fetch names the head directly:
# an overlapping session's tree is left alone.
cmd_pr() {
  local number=$1 dir=$2 branch=${3:-} repo ref
  case "$number" in ''|*[!0-9]*) fail "pull request number must be digits: $number" ;; esac
  absolute "$dir"
  repo=$(git rev-parse --show-toplevel)
  ref="refs/remotes/origin/pr/$number"
  git -C "$repo" fetch origin "+pull/$number/head:$ref" --quiet ||
    fail "cannot fetch pull/$number/head; check the number and the remote"
  branch=${branch:-"claude/pr-$number-$(date -u +%m%d-%H%M%S)"}
  say "pull request $number: $ref -> branch $branch"
  cmd_new "$branch" "$dir" "$ref"
}

# A tree whose dependencies do not match is prepared rather than refused. `want` is read from
# the tree's own lock and manifest, so preparing it is exactly what `setup` would do and what the
# caller was about to be told to do by hand; the marker went stale because the tree moved, not
# because anyone chose those dependencies. The one case that still refuses is a tree some command
# is standing in, which is the case the old refusal was written for.
cmd_run() {
  local dir want
  dir=$(worktree_root "$1")
  shift
  use_pinned_bun "$dir"
  want=$(dependency_identity "$dir")
  read_marker "$dir"
  [ "$installed" = "$want" ] || prepare "$dir" "$want"
  hold_tree "$dir"
  cd "$dir"
  exec "$@"
}

# One snapshot of every running command line, so a tree another process is standing in can be
# named without one ps per worktree. This invocation is dropped from the snapshot along with its
# ancestors and its children: `scripts/worktree.sh run <dir> ...` carries the worktree path in
# its own argv, every shell and `env` wrapper above it carries the whole line, and bash forks a
# copy of itself to run ps, which the snapshot then catches mid-fork. A concurrent run of this
# script is not excluded — that one is exactly the reader we are looking for. The path match is
# deliberately generous: a child path counts too, which errs towards leaving a tree be.
running_commands() {
  [ -n "${PROCESSES+set}" ] || PROCESSES=$(ps -axo pid=,ppid=,command= 2>/dev/null |
    awk -v self="$$" '
      { pid[NR] = $1; parent[$1] = $2; line = $0; sub(/^ *[0-9]+ +[0-9]+ +/, "", line); command[NR] = line }
      END {
        for (p = self; p != "" && p != "0" && p != "1"; p = parent[p]) mine[p] = 1
        for (n = 1; n <= NR; n++) {
          if (pid[n] in mine) continue
          own = 0
          for (p = pid[n]; p != "" && p != "0" && p != "1"; p = parent[p]) if (p == self) { own = 1; break }
          if (!own) print pid[n] " " command[n]
        }
      }')
}

# The working directories of those same processes. A command line need not name its tree: bash
# 5.1 and later, and zsh, exec the last command of `cd <tree> && bun run test` in place of the
# shell, leaving a bare `bun run test` that the scan above cannot place. The kernel still knows
# where it stands. Linux reads it from /proc and Darwin from lsof; a process belonging to another
# user yields nothing, and the list is taken from the snapshot so this script's own family stays
# out of it. A shell or an agent CLI merely standing in a tree is left out too: neither opens
# node_modules itself, and whatever it starts stands there as its own process and is found.
running_cwds() {
  [ -z "${CWDS+set}" ] || return 0
  running_commands
  # Named by argv[0] rather than the kernel's command name, which an agent CLI may set to its
  # version string.
  local movers
  movers=" $(printf '%s\n' "$PROCESSES" | awk '{
    name = $2; sub(/.*\//, "", name); sub(/^-/, "", name)
    if (name !~ /^(sh|bash|zsh|dash|fish|login|claude|codex|caffeinate)$/) print $1
  }' | tr '\n' ' ') "
  if [ -d /proc/self ]; then
    CWDS=$(find /proc/[0-9]*/cwd -maxdepth 0 -printf '%p %l\n' 2>/dev/null |
      awk -v movers="$movers" '{ split($1, part, "/"); if (index(movers, " " part[3] " ")) { sub(/^[^ ]+ /, ""); print } }')
  else
    CWDS=$(lsof -a -d cwd -Fpn 2>/dev/null |
      awk -v movers="$movers" '/^p/ { p = substr($0, 2) } /^n/ && index(movers, " " p " ") { print substr($0, 2) }')
  fi
}

# The command `run` exec's into carries neither this script's name nor the worktree path in its
# argv, and ps reports no working directory, so the process scan is blind to the one command the
# refusal exists for: `run <dir> bun run test` becomes `bun run test`, and a second session reads
# the tree as free and deletes node_modules from under a live suite. Before exec'ing, `run`
# records its own pid where anyone asking about this tree will look. The worktree's own git
# directory is per-tree, untracked and already holds the tree's private state; a repository
# whose git directory cannot be resolved simply keeps the process scan alone.
#
# One file per holder, named by its pid. A single ledger rewritten by every caller lost holders:
# two callers read the same old list, each wrote its own copy, and the later rename kept only one
# pid while the other command ran on, invisible once the recorded one exited. Creating a file of
# one's own is the whole registration, so there is nothing to interleave.
holders_dir() {
  local gitdir
  gitdir=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null) && [ -d "$gitdir" ] || return 1
  printf '%s
' "$gitdir/worktree-run.holders"
}

# The recorded pids that are still running, and the exited ones removed on the way. Each file is
# one pid's own, so removing a dead one cannot drop a live holder. A pid the kernel has reused
# belongs to some other process by now, which costs a refusal that is merely unnecessary, never a
# deletion that is not. The single-file ledger earlier versions wrote is still read: a command
# started under them keeps its pid there until it ends.
live_pids() {
  local holders=$1 pid path
  for path in "$holders"/*; do
    [ -f "$path" ] || continue
    pid=${path##*/}
    case "$pid" in "" | *[!0-9]*) continue ;; esac
    if kill -0 "$pid" 2>/dev/null; then printf '%s\n' "$pid"; else rm -f "$path"; fi
  done
  [ -f "${holders%.holders}.pids" ] || return 0
  while IFS= read -r pid; do
    case "$pid" in "" | *[!0-9]*) continue ;; esac
    kill -0 "$pid" 2>/dev/null && printf '%s\n' "$pid"
  done < "${holders%.holders}.pids"
  return 0
}

# Record this process against the tree. The pid survives the exec, so it names the command itself
# and stops naming it the moment the command ends. Failing to write costs the refusal, not the
# run: the command the caller asked for still runs.
hold_tree() {
  local holders
  holders=$(holders_dir "$1") || return 0
  mkdir -p "$holders" 2>/dev/null && : > "$holders/$$" 2>/dev/null
  return 0
}

busy() {
  local holders held
  if holders=$(holders_dir "$1"); then
    held=$(live_pids "$holders")
    [ -n "$held" ] && return 0
  fi
  running_commands
  case "$PROCESSES" in *"$1"*) return 0 ;; esac
  running_cwds
  local real
  real=$(cd "$1" 2>/dev/null && pwd -P) || real=$1
  case "
$CWDS
" in *"
$real
"* | *"
$real/"*) return 0 ;; esac
  return 1
}

# One line per worktree: what it is on, whether it can run a command now, whether it holds work
# and whether something is using it. States a session otherwise discovers by running something
# and reading the failure, or by not discovering them at all.
cmd_list() {
  local repo want path branch head dirty state tag free trees=0 ready=0 stale=0 absent=0 held=0
  repo=$(git rev-parse --show-toplevel)
  want=$(dependency_identity "$repo")
  say "dependency identity ${want:0:12}; deps ready means a command runs here now"
  while IFS= read -r path; do
    [ -n "$path" ] && [ -d "$path" ] || continue
    branch=$(git -C "$path" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "(detached)")
    head=$(git -C "$path" rev-parse --short HEAD 2>/dev/null || echo "?")
    dirty=$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    read_marker "$path"
    trees=$((trees + 1))
    if [ -L "$path/node_modules" ]; then state="deps LINKED"; stale=$((stale + 1))
    elif [ -z "$installed" ]; then state="deps absent"; absent=$((absent + 1))
    elif [ "$installed" = "$want" ]; then state="deps ready"; ready=$((ready + 1))
    else state="deps stale ${installed:0:12}"; stale=$((stale + 1))
    fi
    case "$path" in
      */ana-run-*) tag=" [run evidence: never remove]" ;;
      "$repo") tag=" [checkout]" ;;
      *) tag="" ;;
    esac
    busy "$path" && { tag="$tag [in use]"; held=$((held + 1)); }
    printf '%s  %s  %s  %s  %s changed%s\n' "$head" "$state" "$branch" "$path" "$dirty" "$tag"
  done < <(every_worktree "$repo" | sort -u)
  free=$(df -Pk "$repo" | awk 'NR == 2 { printf "%.0f", $4 / 1048576 }')
  say "$trees worktrees: $ready ready, $stale stale or linked, $absent absent, $held in use; ${free} GiB free"
}

# Remove a disposable tree this task created. Recorded evidence and unfinished work are refused:
# a run worktree's untracked campaigns/ and domains/ are the only copy of what a run measured.
cmd_drop() {
  local dir repo dirty force=${FORCE:-}
  dir=$(worktree_root "$1")
  repo=$(git rev-parse --show-toplevel)
  [ "$dir" != "$(cd "$repo" && pwd -P)" ] || fail "refusing to remove the checkout itself: $dir"
  case "$dir" in
    */ana-run-*) fail "refusing to remove $dir: an ana-run-* tree holds the recorded evidence of a run" ;;
  esac
  local evidence
  for evidence in campaigns domains runs; do
    [ -d "$dir/$evidence" ] && [ -z "$force" ] && fail "refusing to remove $dir: $evidence/ holds recorded evidence. Move it out, or pass --force"
  done
  dirty=$(git -C "$dir" status --porcelain | wc -l | tr -d ' ')
  if [ "$dirty" != 0 ] && [ -z "$force" ]; then
    git -C "$dir" status --short >&2
    fail "refusing to remove $dir: $dirty uncommitted or untracked path(s) above. Deliver or discard them, or pass --force"
  fi
  git -C "$repo" worktree remove --force "$dir" >&2
  say "removed $dir"
}

# --- Dispatch ------------------------------------------------------------------------------------

# Strip the scope and force flags out of a verb's arguments; the rest stay positional. `run`
# never reaches here, so a command's own flags are never read as this script's.
SCOPE=medium
FORCE=
parse_flags() {
  ARGS=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --scope) [ $# -ge 2 ] || fail "--scope needs a value"; SCOPE=$2; shift 2 ;;
      --scope=*) SCOPE=${1#--scope=}; shift ;;
      --minimal|--medium|--maximum) SCOPE=${1#--}; shift ;;
      --force) FORCE=1; shift ;;
      --) shift; ARGS+=("$@"); return ;;
      *) ARGS+=("$1"); shift ;;
    esac
  done
  case "$SCOPE" in minimal|medium|maximum) ;; *) fail "--scope must be minimal, medium or maximum, not $SCOPE" ;; esac
}

USAGE="usage: scripts/worktree.sh {new <branch> <absolute-dir> [start-point] | pr <number> <absolute-dir> [branch] | setup <absolute-dir> | run <absolute-dir> <command...> | list | drop <absolute-dir>} [--scope minimal|medium|maximum] [--force]"

verb=${1:-}
[ $# -eq 0 ] || shift
case "$verb" in
  run) [ $# -ge 2 ] || fail "usage: scripts/worktree.sh run <absolute-dir> <command...>"; cmd_run "$@" ;;
  new) parse_flags "$@"; [ ${#ARGS[@]} -ge 2 ] || fail "usage: scripts/worktree.sh new <branch> <absolute-dir> [start-point]"; cmd_new "${ARGS[@]}" ;;
  pr) parse_flags "$@"; [ ${#ARGS[@]} -ge 2 ] || fail "usage: scripts/worktree.sh pr <number> <absolute-dir> [branch]"; cmd_pr "${ARGS[@]}" ;;
  setup) parse_flags "$@"; [ ${#ARGS[@]} -eq 1 ] || fail "usage: scripts/worktree.sh setup <absolute-dir>"; cmd_setup "${ARGS[@]}" ;;
  list) parse_flags "$@"; cmd_list ;;
  drop) parse_flags "$@"; [ ${#ARGS[@]} -eq 1 ] || fail "usage: scripts/worktree.sh drop <absolute-dir> [--force]"; cmd_drop "${ARGS[@]}" ;;
  *) fail "$USAGE" ;;
esac
