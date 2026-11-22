---
name: reduce-complexity
description: "Measure structural complexity across a diff or pull request stack: line counts, branching density, import coupling, interface width, rule proxies, lint exemptions, and model-visible prompt prose. Use before claiming a simplification, when locating newly added machinery, or when asked whether a diff is simpler, how much a pull request added, for a function's branch count, or for `git complexity`. Report identical metrics before and after; v2 has no CI branch-count gate."
---

# Reduce complexity

Measurement instruments paired with [simplify](../simplify/SKILL.md): measure before, simplify, measure after with identical commands, and report both in the PR body. Metrics price structural surface area, not decision value (`AGENTS.md` rule 13).

## Whole-stack measurement (17 metrics)

```sh
git complexity                              # HEAD vs parent (alias from `bun run hooks:install`)
git complexity <base> <head>                # two revisions or a stack
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main HEAD
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main '#<bottom>' '#<top>'
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py --repo /abs/worktree --per-file origin/main HEAD
```

| Group | Measures | Note |
| --- | --- | --- |
| Size | Source files, nonblank source & test lines | Scope: `src`, `tools`, `packages`, `.claude/skills` (incl. shell); excludes `test`, generated, `vendor` |
| Branching | Decision points & per-100-lines density | Lexical tokens (`if`/`for`/`while`/`case`/`catch`/`&&`/`\|\|`/`??`/`?.`/`:?`); no CI gate (`HABITS.md` 12.10) |
| Coupling | Import edges, mean fan-out, hubs (≥90th pct), max fan-in | Lexical |
| Interface | Exports, optional `?:` fields, ≥5-param signatures | Each `?:` adds consumer cases |
| Rules & exemptions | Refusal codes, env knobs, `not-slop.tsv` rows, `copiedFileLimits` | Regex proxies; prune stale rows via `bun run not-slop -- prune` |
| Model-read text | Prompt literal bytes (`PROMPT_FILES`) | Register new composers there |

Always fetch first and compare against `origin/main` (merge-base default; `--literal-base` for exact tips). Pass bottom-to-top `#<n>` PR refs for per-PR columns; compare sibling branches against their common base.

## Single-diff budgets & per-function branch counts

```sh
.claude/skills/reduce-complexity/scripts/scope.sh [<PR#>|<commit>|<a..b>|<paths>] -C <worktree> -o <scope.diff>
.claude/skills/reduce-complexity/scripts/measure.py --diff <scope.diff> --base <pre-change ref> -C <worktree>
```

`measure.py` reports ranked per-function cyclomatic complexity (via `node_modules/oxlint/bin/oxlint`; advisory `--complexity 21`, ceilings 115 lines/fn and 800/file), export caller counts (`UNUSED`/`one-caller` leads), **budget** (net prod/test lines, added/deleted files, net functions, new imports), and **repeats** (added 3-line duplicates).

## Prose complexity

Evaluate prompt/doc edits as delivered to the consuming seat (`AGENTS.md` §2, §13); fewer literal bytes alone prove neither shorter rendered prompts nor better model behaviour. Never trade away any `AGENTS.md` §8 rule for lower metrics.

## Related skills

- Refactoring method & census: [simplify](../simplify/SKILL.md)
- Compartment rewrites & multi-PR consolidation: [commit-r](../commit-r/SKILL.md), [consolidate-stack](../consolidate-stack/SKILL.md), [stack-pr](../stack-pr/SKILL.md)
