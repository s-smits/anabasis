#!/bin/bash
# Resolve what /simplify is looking at and write it to one diff file.
#
#   scope.sh                 working diff: base..HEAD plus uncommitted changes
#   scope.sh 123             pull request #123 (gh), diffed against its own base branch
#   scope.sh abc123          one commit
#   scope.sh a..b | a...b    a range
#   scope.sh src/x.ts ...    named paths, diffed against the resolved base
#   -C <dir>                 run in another worktree
#   -o <file>                where to write the diff (default: mktemp)
#
# The base for a working diff is, in order: the base branch of the open PR for this branch
# (so a stacked branch is measured against its parent, never against main), then @{upstream},
# then origin/main or main. Prints the base, the diff path, one line per changed file with
# added/removed counts, and the changed source files for measure.py.
set -euo pipefail

dir="."
out=""
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    -C) dir="$2"; shift 2 ;;
    -o) out="$2"; shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
set -- "${args[@]+"${args[@]}"}"
cd "$dir"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "scope: not a git worktree: $PWD" >&2; exit 2; }
[ -n "$out" ] || out="$(mktemp -t simplify-scope).diff"

resolve_base() {
  local branch pr_base
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if command -v gh >/dev/null 2>&1 && [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    pr_base="$(gh pr view --json baseRefName,number --jq '"\(.baseRefName) #\(.number)"' 2>/dev/null || true)"
    if [ -n "$pr_base" ]; then
      local ref="${pr_base%% *}"
      git rev-parse --verify -q "origin/$ref" >/dev/null && { echo "origin/$ref (base of PR ${pr_base##* })"; return; }
      git rev-parse --verify -q "$ref" >/dev/null && { echo "$ref (base of PR ${pr_base##* })"; return; }
    fi
  fi
  if git rev-parse --verify -q '@{upstream}' >/dev/null 2>&1; then
    local up; up="$(git rev-parse --abbrev-ref '@{upstream}')"
    if [ "$(git rev-parse '@{upstream}')" != "$(git rev-parse HEAD)" ]; then echo "$up (upstream)"; return; fi
  fi
  for ref in origin/main main origin/master master; do
    git rev-parse --verify -q "$ref" >/dev/null && { echo "$ref (default branch)"; return; }
  done
  echo "HEAD~1 (no base found)"
}

target="${1:-}"
kind=""
if [ -z "$target" ]; then
  kind="working"
elif [[ "$target" =~ ^#?[0-9]+$ ]]; then
  kind="pr"
elif [[ "$target" == *..* ]]; then
  kind="range"
elif [ -e "$target" ]; then
  kind="paths"
elif git rev-parse --verify -q "${target}^{commit}" >/dev/null; then
  kind="commit"
else
  echo "scope: cannot read target '$target' as a PR, commit, range or path" >&2; exit 2
fi

case "$kind" in
  working)
    base_line="$(resolve_base)"; base="${base_line%% *}"
    mb="$(git merge-base "$base" HEAD 2>/dev/null || echo "$base")"
    { git diff --no-ext-diff "$mb" HEAD; git diff --no-ext-diff HEAD; } > "$out"
    untracked="$(git ls-files --others --exclude-standard | head -20)"
    echo "base: $base_line -> merge-base $(git rev-parse --short "$mb"); plus uncommitted changes"
    ;;
  pr)
    n="${target#\#}"
    base_line="$(gh pr view "$n" --json baseRefName,headRefName --jq '"\(.baseRefName) <- \(.headRefName)"')"
    gh pr diff "$n" > "$out"
    echo "base: PR #$n: $base_line"
    ;;
  range)
    git diff --no-ext-diff "$target" > "$out"
    echo "base: range $target"
    ;;
  commit)
    git show --no-ext-diff --format='commit %h %s' "$target" > "$out"
    echo "base: commit $(git rev-parse --short "$target")"
    ;;
  paths)
    base_line="$(resolve_base)"; base="${base_line%% *}"
    mb="$(git merge-base "$base" HEAD 2>/dev/null || echo "$base")"
    git diff --no-ext-diff "$mb" -- "$@" > "$out"
    echo "base: $base_line -> merge-base $(git rev-parse --short "$mb"), paths only"
    ;;
esac

echo "diff: $out"
if [ ! -s "$out" ]; then
  echo "changed: nothing. An empty scope is a result: say so, do not audit the repository instead."
  [ -n "${untracked:-}" ] && printf 'untracked (not in the diff):\n%s\n' "$untracked"
  exit 0
fi

# One line per file: +added -removed path. Then the source files measure.py should read.
python3 - "$out" <<'PY'
import re, sys
path = sys.argv[1]
files, cur = {}, None
for line in open(path, errors="replace"):
    if line.startswith("diff --git"):
        m = re.search(r" b/(.+)$", line.rstrip("\n"))
        cur = m.group(1) if m else None
        if cur: files.setdefault(cur, [0, 0])
    elif cur and line.startswith("+") and not line.startswith("+++"):
        files[cur][0] += 1
    elif cur and line.startswith("-") and not line.startswith("---"):
        files[cur][1] += 1
add = sum(a for a, _ in files.values()); rem = sum(r for _, r in files.values())
print(f"changed: {len(files)} files, +{add} -{rem}")
for f, (a, r) in sorted(files.items(), key=lambda kv: -(kv[1][0] + kv[1][1])):
    print(f"  +{a:<5}-{r:<5}{f}")
src = [f for f in files if re.search(r"\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$", f) and "node_modules" not in f]
if src:
    print("measure: " + " ".join(src))
PY
[ -n "${untracked:-}" ] && printf 'untracked (not in the diff):\n%s\n' "$untracked"
exit 0
