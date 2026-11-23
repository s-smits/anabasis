#!/bin/sh
# The commit's checks, v1's pre-commit ported: `.githooks/pre-commit` runs this before every commit
# once `bun run hooks:install` has pointed the clone there, and `bun run commit:check` runs it by
# hand. Two refusals, both about facts a commit records permanently: an author who cannot be
# attributed, and a credential-shaped literal. Between them sit the formatter, the linter and an
# advisory slop report over the staged source. This is the last moment either is still cheap to
# fix: once a commit reaches a remote, rewriting history does not un-publish it.
#
# The scan reads added lines only: re-reporting a line that is already committed teaches the
# operator to skip the check.
set -eu

# An email under an RFC 2606 reserved domain can never resolve to a GitHub account, so the commit
# lands as an unlinked user, and a stale email in .git/config can record many such commits before
# anyone notices, none of which can be re-attributed without rewriting the open pull requests.
# `git var` resolves the same precedence `git commit` uses, so this checks the value that will
# actually be recorded.
author_email=$(git var GIT_AUTHOR_IDENT)
author_email=${author_email#*<}
author_email=${author_email%%>*}

case "$author_email" in
*@*.test | *@*.invalid | *@*.example | *@example.com | *@example.net | *@example.org)
  echo "commit-check: author email '$author_email' is a reserved placeholder domain (RFC 2606)." >&2
  echo "GitHub cannot attribute it, so this commit would record an unlinked author." >&2
  echo "If it came from a stale repository override, drop it:" >&2
  echo "  git config --local --unset user.email && git config --local --unset user.name" >&2
  echo "If the placeholder is deliberate, commit without this check." >&2
  exit 1
  ;;
esac

root=$(git rev-parse --show-toplevel)

# The formatter, strict linter, source policy and simplify census over staged files. CI still runs
# them over the whole tree; this catches findings when they are one commit old rather than one
# stack old. The checks read working-tree bytes of staged paths, so a partially staged file is
# judged on what is on disk, not on what the index holds.
staged=$(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.js' '*.mjs')
staged_md=$(git diff --cached --name-only --diff-filter=ACMR -- '*.md')
if [ -n "$staged" ]; then
  cd "$root"
  # A commit may stage only files biome.json leaves unformatted, such as the copied pi sources;
  # without the flag biome refuses the empty set as if the files were unformatted.
  # shellcheck disable=SC2086
  bun node_modules/@biomejs/biome/bin/biome format --no-errors-on-unmatched $staged || {
    echo "commit-check: staged files are not formatted; run bun fmt <paths> and stage the result." >&2
    exit 1
  }
  ANA_LINT_PATHS="$staged" bun tools/runtime/lint.ts --strict || {
    echo "commit-check: staged files fail bun run lint -- --strict; fix the findings and stage again." >&2
    exit 1
  }
fi
if [ -n "$staged" ] || printf '%s\n' "$staged_md" | grep -qx "AGENTS.md"; then
  cd "$root"
  bun tools/loc/source-policy.ts || {
    echo "commit-check: source-policy failed; fix the findings and stage again." >&2
    exit 1
  }
fi
if [ -n "$staged" ] || [ -n "$staged_md" ]; then
  cd "$root"
  bun tools/oxlint/staged-slop.ts || {
    echo "commit-check: simplify census findings touch staged lines; fix or answer them and stage again." >&2
    exit 1
  }
fi

exec bun "$root/tools/secrets/scan.ts" --staged
