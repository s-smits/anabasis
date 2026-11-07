---
name: reduce-complexity
description: "Measure complexity across a diff or PR stack: lines, branches, coupling, interface width, rules, exemptions and model-visible prose. Use before claiming simplification, when locating added machinery, or when asked whether a diff is simpler, how much a PR added, for a function's branch count or for git complexity. Report the same measures before and after; v2 has no CI branch-count gate."
---

# Reduce complexity

This skill is the instrument and [simplify](../simplify/SKILL.md) the method. Measure, cut, measure
again with the same scripts, and put both numbers in the PR body; a simplification that moved no
number is only a rewrite. The numbers price a concept but say nothing of what it decides (rule 13),
so a large fall shows smaller code rather than better code. The scripts are v1's, kept in Python
and shell.

## The whole stack, on seventeen measures

```sh
git complexity                      # HEAD against its parent
git complexity <commit>             # one commit against its parent
git complexity <base> <head>        # any two revisions, or more for a stack
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main HEAD
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main '#<bottom>' '#<top>'
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py --repo /abs/worktree --per-file origin/main HEAD
```

`git complexity` is the script under an alias that `bun run hooks:install` sets; it touches no
working files. `#<n>` is a pull request, resolved through `gh`.

| group | measures | note |
| --- | --- | --- |
| size | source files, nonblank source and test lines | tests rising with source flat suggests a mechanism got proved |
| branching | decision points, per 100 lines | textual `DECISION` tokens (`if`, `for`, `while`, `case`, `catch`, `&&`, `\|\|`, `??`, `?.`, ternary); no threshold (`tools/oxlint/HABITS.md`, 12.10) |
| coupling | import edges, mean fan-out, hub files, max fan-in | textual; a hub is at the 90th fan-out percentile or above |
| interface | exports, optional fields, signatures with 5+ parameters | each `?:` is a case every reader must handle |
| rules | refusal codes, environment knobs | regex proxies, not live counts |
| exemptions | `tools/oxlint/not-slop.tsv` rows, `copiedFileLimits` in `tools/loc/source-policy.json` | `bun run not-slop -- prune` |
| model-read text | prompt literal bytes, overall and per composer | a proxy over `PROMPT_FILES`; register a new composer there |

Source (`SOURCE_ROOTS`) is code under `src`, `tools`, `packages` and `.claude/skills`, less tests,
generated files and `vendor`.

The first revision is read at the merge base, so work landed on `main` later is not charged to the
branch (`--literal-base` compares tips as given). Fetch and name `origin/main`, since a stale local
`main` credits the branch with everything landed since. For a stack, name the base then each pull
request bottom to top, one column each. Compare siblings each against their common base, never tip
against tip.

## One diff, and a function's branch count

```sh
.claude/skills/reduce-complexity/scripts/scope.sh [<PR#>|<commit>|<a..b>|<paths>] -C <worktree> -o <scope.diff>
.claude/skills/reduce-complexity/scripts/measure.py --diff <scope.diff> --base <pre-change ref> -C <worktree>
```

`scope.sh` takes the open PR's base, else an upstream, else `origin/main`, else `HEAD~1`; read the
base it prints. `measure.py` prints functions by branch count and length, exports by caller count
(`UNUSED`, `one-caller`, from whole-word mentions, so leads only), functions over a ceiling, and:

- **budget**: production and test lines net, files added and deleted, new functions net of moved
  ones, and names each import source gained. To cost a repair, point `--base` at the head before
  that change rather than the PR base.
- **repeats**: added three-line windows found elsewhere, leads for an existing owner.

Branch counts come from `node_modules/oxlint/bin/oxlint` with every ceiling at 0 in a temporary
config, v2's only cyclomatic reading. Line ceilings default to 115 and 800; `--complexity` defaults
to 21, which nothing enforces. Run it before and after and report the budget lines.

## Reading prose as complexity

Read changed text as the seat receives it, naming seat and delivery point (`AGENTS.md`, sections 2
and 13). Fewer literal bytes prove neither less text delivered nor better behaviour, so name the
reader of an added clause and what replaces a removed one. No measure is improved by breaking a
rule of `AGENTS.md`, section 8.
