---
name: reduce-complexity
description: "Measure whether a change made the tree simpler: line counts, branching, coupling, interface width, rule count, standing exemptions and model-visible prose across one diff or a stack of pull requests. Use before claiming a pass reduced complexity, when deciding which pull request added machinery, and to read a function's branch count, which no v2 gate reports."
---

# Reduce complexity

[simplify](../simplify/SKILL.md) (`/simplify`) is the method: read the callers, fold into the owner, delete before you add. This
skill is the instrument. It asks whether the change made the tree smaller or moved code between
files, using the same measures before and after.

The honest order is: measure, cut, measure again, and put both numbers in the PR body. A
simplification that cannot show a number it moved is a rewrite.

These numbers are one side of a trade. Rule 13 of `AGENTS.md` maps every concept as
`owner → live reader → decision it changes → evidence → hostile test` and drops it when a link is
missing; this skill measures what the concept costs, never the decision it changes. A pass that
reports a large fall here and nothing about what the component still decides has shown that it is
smaller, not that it is better.

All three scripts are v1's, adapted; v1's copies read back with
`git show 5bc9988:.claude/skills/reduce-complexity/scripts/<name>`, and no other copy runs. They are
Python and shell where the rest of `.claude` is bun TypeScript, because a port keeps that transfer
and a rewrite would not.

## The whole stack, on seventeen measures

```sh
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main HEAD
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main '#<bottom>' '#<top>'
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py --repo /abs/worktree --per-file origin/main HEAD
```

It reads revisions through Git plumbing, so it needs no extra worktree and changes no working
files. A `#<n>` argument is a pull request number in the repository this checkout's `origin` names,
resolved through `gh` and fetched if this checkout has not seen it.

| group | measures | what a rise means |
| --- | --- | --- |
| how much is there | source files, nonblank source lines, nonblank test lines | more to read. Test lines rising while source holds usually means a mechanism got proved; source rising while tests hold usually means it did not |
| how much branching | decision points, decisions per 100 lines | more decision tokens. Both are textual proxies, not function-level complexity. The density divides the count by nonblank source lines; v2 has no complexity gate (`tools/oxlint/HABITS.md`, 12.10) |
| how tangled | import edges, mean fan-out, hub files, max fan-in | more import occurrences. Relative imports and `#` aliases count, using `package.json`'s `imports`. A hub is a file at or above its revision's 90th fan-out percentile. These are textual counts, not a resolved dependency graph |
| how wide the interface | exported symbols, optional fields, signatures with 5+ parameters | more states every reader must handle. Optional fields are the quiet one: each `?:` is a case somebody downstream has to consider |
| how many rules | distinct refusal codes, environment knobs | more code literals in `code`, `kind` or `check` positions and more environment variables recognised by the script's regexes. These are proxies, not a count of live refusals or settings |
| how much is excused | waived findings, copied-file ceilings | `tools/oxlint/not-slop.tsv` rows and `copiedFileLimits` entries in `tools/loc/source-policy.json`. `bun run not-slop -- prune` removes answers whose finding no longer exists. HABITS 12.10 keeps the ceiling map empty |
| how much a model reads | prompt literal bytes, and the same per composer | more literal text in the selected composers, subject to the limits below |

"Source" here is the script's `SOURCE_ROOTS` and `SOURCE_SUFFIX`: code under `src`, `tools`,
`packages` and `.claude/skills`, excluding tests, generated files and `vendor`. A pull request that
changes only a skill's scripts reads its rows here, and decision points are the script's `DECISION`
tokens (`if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `??`, `?.` and the ternary), never a
count by hand over another set. This is wider than
`source-policy.ts`'s `AUTHORED_ROOTS`, which names `packages/ui/src` rather than all of `packages`.
`PROMPT_FILES` names selected files composing seat prompts, descriptions and tool results. Add a
new composer there in the same pull request. Literal bytes are a regex proxy: they include
non-prompt strings and quoted text in comments, and omit generated values, campaign data and
upstream tool descriptions.

The first revision is read from the merge base of the first and last, so work landed on `main`
after the branch was cut is not charged to the branch. Getting this wrong is the standard error:
in v1 a six-PR stack once appeared to have deleted 2,872 test lines it had not touched.
`--literal-base` compares the tips as given when that is what you want. Run `git fetch origin`
first and name `origin/main`, not `main`: a local main that has not been updated is an ancestor of
the branch, so nothing warns you, and the branch is credited with everything main has landed since.

### Comparing pull requests

Name the base followed by the stack bottom-to-top. Each revision gets a column, so a reader can
see which pull request moved a measure. The net column compares the first and last.

For two branches outside one chain, such as siblings or a rewrite against the thing it replaces,
compare each against their common base and read the two nets. Do not compare sibling tips
directly: each carries the other's absence as a deletion.

## One diff, and a function's branch count

```sh
.claude/skills/reduce-complexity/scripts/scope.sh [<PR#>|<commit>|<a..b>|<paths>] -C <worktree> -o <scope.diff>
.claude/skills/reduce-complexity/scripts/measure.py --diff <scope.diff> --base <pre-change ref> -C <worktree>
```

`scope.sh` first tries the open PR's base, then a differing upstream, then `origin/main`, `main`,
`origin/master`, `master`, and finally `HEAD~1`. Read the printed base before using the diff.
Untracked files are listed, up to twenty, but stay outside a working diff. `measure.py`
prints functions by branch count and length, exports by caller count (`UNUSED`, `one-caller`), the
functions over a ceiling, then two sections:

- **budget**: production and test lines net, new and deleted files, new production functions net
  of moved ones, and the names each import source gained. Point `--base` at the head *before the
  change you are simplifying*, not the PR base, when the question is what a repair costs.
- **repeats**: added three-line code windows found elsewhere in tracked source after strings and
  numbers are normalised. These are leads to inspect before calling an existing owner.

It reads branch counts from `node_modules/oxlint/bin/oxlint` with `complexity`,
`max-lines-per-function` and `max-lines` set to a maximum of 0 in a temporary config of its own,
so every function is reported. That is a measurement, not a change to this repository's lint
configuration, and it is the only cyclomatic reading v2 has. The line ceilings default to
`source-policy.ts`'s 115 and 800. `--complexity` defaults to v1's 21, which nothing in v2
enforces, so a function over it is a lead and not a refusal. Function lengths from Oxlint skip
comments; the file and budget counts include them, as does `source-policy.ts`.
Export caller counts are whole-word mentions in other tracked source files, including comments;
`UNUSED` and `one-caller` are leads rather than an import analysis.

Run it once before editing and once after, and put the budget lines in the report. The worktree
must hold the after-state.

## Reading prose as complexity

Read changed text in the composed message, with its seat and delivery point named. Follow
`AGENTS.md` sections 2 and 13: code owns conditions, models own content, and each fact belongs
where it is read. A lower literal count alone proves neither less text delivered nor better
model behaviour. Name the reader of an added clause and the mechanism replacing a removed one.

## What a pass must not cut

The rules of `AGENTS.md` section 8 are what no pass trades. A measure that improves by breaking
one of them is no simplification.
