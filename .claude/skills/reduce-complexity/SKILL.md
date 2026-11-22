---
name: reduce-complexity
description: "Measure structural complexity across a diff or pull request stack: line counts, branching density, import coupling, interface width, rule proxies, lint exemptions, and model-visible prompt prose. Use before claiming a simplification, when locating newly added machinery, or when asked whether a diff is simpler, how much a pull request added, for a function's branch count, or for `git complexity`. Report identical metrics before and after; v2 has no CI branch-count gate."
---

# Reduce complexity

This skill provides the measurement instruments while [simplify](../simplify/SKILL.md) provides the
refactoring method. Measure before, simplify, measure again with the identical scripts, and include
both sets of figures in the pull request body: an edit that moves no complexity metric is merely a
rewrite. These metrics price structural surface area rather than decision value (`AGENTS.md`, rule
13), so a large drop proves smaller code rather than automatically better code. The measurement
scripts are retained from v1 in Python and shell.

## Whole-stack measurement across seventeen metrics

```sh
git complexity                      # HEAD against its parent
git complexity <commit>             # one commit against its parent
git complexity <base> <head>        # any two revisions, or more for a stack
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main HEAD
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main '#<bottom>' '#<top>'
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py --repo /abs/worktree --per-file origin/main HEAD
```

`git complexity` invokes the Python script via an alias installed by `bun run hooks:install` and
leaves working-tree files untouched. Pull request references `#<n>` are resolved through `gh`.

| group | measures | note |
| --- | --- | --- |
| size | source files, nonblank source and test lines | test lines rising while source lines stay flat suggests a mechanism gained test coverage |
| branching | decision points, per 100 lines | lexical `DECISION` tokens (`if`, `for`, `while`, `case`, `catch`, `&&`, `\|\|`, `??`, `?.`, ternary; in shell, line-opening control keywords plus `&&` and `\|\|`; in Python, line-opening control keywords plus `and` and `or`); no hard threshold (`tools/oxlint/HABITS.md`, 12.10) |
| coupling | import edges, mean fan-out, hub files, max fan-in | lexical; a hub file sits at or above the 90th fan-out percentile |
| interface | exports, optional fields, signatures with 5+ parameters | each `?:` introduces a case every consumer must handle |
| rules | refusal codes, environment knobs | regex proxies rather than live runtime counts |
| exemptions | `tools/oxlint/not-slop.tsv` rows, `copiedFileLimits` in `tools/loc/source-policy.json` | clean up stale rows with `bun run not-slop -- prune` |
| model-read text | prompt literal bytes, overall and per composer | proxy over `PROMPT_FILES`; register new composers there |

Source scope (`SOURCE_ROOTS`) spans code under `src`, `tools`, `packages`, and `.claude/skills`,
including shell scripts (`.sh`, plus extensionless files in `stack-complexity.py` whose shebang
names a shell) so migrating logic between shell and TypeScript registers as a move rather than a
deletion, excluding tests, generated files, and `vendor`.

By default, the baseline revision is resolved at the merge base so concurrent commits on `main` are
not attributed to the branch (pass `--literal-base` to compare exact tips). Fetch first and pass
`origin/main`, because a stale local `main` credits the branch with unrelated merged work. For a
stack, pass the base followed by each pull request from bottom to top to produce one column per
pull request. Compare sibling branches against their common base rather than tip against tip.

## Single-diff budgets and per-function branch counts

```sh
.claude/skills/reduce-complexity/scripts/scope.sh [<PR#>|<commit>|<a..b>|<paths>] -C <worktree> -o <scope.diff>
.claude/skills/reduce-complexity/scripts/measure.py --diff <scope.diff> --base <pre-change ref> -C <worktree>
```

`scope.sh` defaults its base to the open pull request's base, falling back to upstream,
`origin/main`, or `HEAD~1`; verify the base it prints. `measure.py` reports functions ranked by
branch count and length, exports by caller count (`UNUSED` and `one-caller` use whole-word search
and are therefore leads only), functions exceeding ceilings, and two summary blocks:

- **budget**: net production and test lines (including shell), files added and deleted, net new
  functions excluding moves, and newly imported names per import source. To cost an incremental
  repair, point `--base` at the commit immediately before that repair rather than the pull request
  base.
- **repeats**: newly added three-line windows matching existing code elsewhere, pointing to
  candidates for reuse of an existing owner.

Cyclomatic branch counts are obtained from `node_modules/oxlint/bin/oxlint` with every ceiling set
to 0 in a temporary configuration, which is v2's sole cyclomatic measurement. Line ceilings default
to 115 per function and 800 per file; `--complexity` defaults to 21 and is advisory only. Run
`measure.py` before and after editing and include the budget output in your report.

## Reading prose as complexity

Evaluate edited prompt and documentation text as the consuming seat actually receives it, naming
both the seat and delivery point (`AGENTS.md`, sections 2 and 13). Fewer literal bytes prove
neither shorter delivered prompts nor improved model behaviour, so identify the consumer of every
added clause and what replaces every removed one. No complexity metric may be improved by violating
any rule in `AGENTS.md`, section 8.
