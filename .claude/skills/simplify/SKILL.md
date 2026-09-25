---
name: simplify
description: Review the changed code for reuse, simplification, efficiency and altitude cleanups in this repository, then apply the fixes. Quality only — it does not hunt for bugs; use /code-review for that. The method, its scripts and its cases live in this directory, so the skill works without any user-level skill pack.
---

# Simplify

This directory is the whole skill. A user-level `/simplify` may exist in the
operator's own skill pack; this repository does not depend on it, and where the
two disagree, this file governs here. `harness-builder-v4` and `anabasis` each
carry this directory, byte-identical: change both in the same sitting.

## First, before anything else

1. **Ask why the code exists before asking how to shrink it.** Read the code,
   the function around it, every caller and the owning test. Most answers sit
   outside the paste: a layer that already owns the job, a helper with one
   caller, a field nothing reads, a guard an earlier owner makes impossible.
2. **Fix it at the highest layer that already owns it.** "Can't we go one
   layer higher and not let the components go this deep?" is the operator's
   most expensive correction. Before editing a leaf, name the owner that
   already holds the lifecycle, the reader or the refusal.
3. **Budgets are hard, not aspirations.** See the budgets below. A stated
   budget ("max 5 prod LoC", "remove one import to add one", "consolidate max
   3 or 4 related functions") replaces them. Measure it; do not estimate it.
4. **Land on the PR it simplifies.** One commit on that PR's source branch.
   Never open a new PR to simplify an unmerged one.

You are improving code that already works. A correctness bug found on the way
is fixed under the task's authority and reported separately.

## Read the invocation

Scope comes from the arguments: pasted code, a worktree path, "uncommitted
diff", a commit, a PR number, a range or paths. Nothing named means the
working diff. Then match the wording; it decides the procedure.

| The operator wrote | Do this |
| --- | --- |
| "remove X and /simplify", "sloppy, remove and find another way" | The deletion is decided. Run the removal sweep in `cases/remove-and-rewrite.md`. Do not come back with a smaller version of X. |
| "rewrite from scratch", "completely remove and rewrite", "overkill" | The R protocol in the same file: delete the tests and the production they touch, commit `R`, rebuild tests then production. Count concepts, not lines. |
| "why do we even need X?" | Answer with the owner that already covers it, or the root cause X patches. Code comes after that answer. |
| "one layer higher", "don't let the components go this deep" | Revert the leaf edit. Find the one owner every path runs through and fix it there. |
| "find a reference in Bun or another well-known repo" | Read how that project settles the same problem, cite the file, then fit that shape into the existing owner. |
| "is it simple enough?", "streamline this definition?" | Verdict first. "Yes" is a full answer; otherwise show the consolidated form. |
| A pasted list of functions over a ceiling | Each function is a scope. Fewer branches in the owner first (see Counts). |
| "what looks most bloated?" | Read the function heads and `measure.py` output, then rank by concepts a reader must learn. |
| Bare `/simplify` after your own change | Your diff is the scope. The operator will read it as if a colleague wrote it. |

Work inline. Use subagents only when the operator asks. A named boundary
("no shared wrapper", "keep these owners") is a boundary. A renamed shim is the
forbidden thing itself. If the boundary blocks the only real cut, say so once
and stop. `cases/changed-code.md` covers a large diff, one PR inside a sweep
and a revert-to-minimal comparison.

## Measure before and after

```sh
.claude/skills/simplify/scripts/scope.sh [<PR#>|<commit>|<a..b>|<paths>] -C <worktree> -o <scope.diff>
.claude/skills/simplify/scripts/measure.py --diff <scope.diff> --base <pre-change ref> -C <worktree> \
  --function-lines 115 --file-lines 800
```

`scope.sh` resolves the base: the PR's parent on a stack, never `main` by
default. `measure.py` prints functions by branch count and length, exports by
caller count (`UNUSED`, `one-caller`), then two sections:

- **budget**: production and test lines net, new and deleted files, new
  production functions net of moved ones, and the names each import source
  gained. Point `--base` at the head *before the change you are simplifying*,
  not the PR base, when the question is what the repair costs.
- **repeats**: added code that already exists elsewhere in tracked source. A
  repeat is the "already in this codebase?" rung answered for you. Call that
  owner, then delete the other local copies of the same reader too.

Run it once before editing and once after, and put the budget lines in the
report. The worktree must hold the after-state: for a historical commit, use a
detached worktree at that commit.

Whether the pass moved anything, on seventeen measures at once and across a
whole PR stack, is `.claude/skills/reduce-complexity`. Run it before and after
and put both numbers in the PR body; a simplification that cannot name a
measure it moved is a rewrite.

## The ladder

Climb it for each mechanism and stop at the first rung that holds:

1. **Does it need to exist?** Unreachable under the contract, a fallback for a
   state an earlier owner refuses, or a rule that refuses valid input: delete
   it and everything it strands.
2. **Does a higher layer already do it?** The process-group spawner already
   kills on timeout and in `finally`; Linux `bwrap --unshare-pid` already reaps
   a namespace. A kill added in every tool only hid a shutdown-order bug in the
   controller, which was the real fix.
3. **Already in this codebase?** Call the owner. When a repair needed an
   import walk, the existing `specifiersIn` reader replaced a new module and
   its parser, and a second copy of that reader in the same file went too.
4. **Stdlib, platform or an installed dependency?** `realpathSync` already
   throws on a missing file, so the `existsSync` guards went. Never add a
   dependency for a few lines.
5. **Can it be one expression?** Two arms differing in one clause are one arm.
   Three spellings of one object literal are one small function (one owner,
   even when the line count is equal).
6. **Only then** the minimum that works, inside the owner.

At each rung, ask: did we fix the root cause, or patch the result?

## Budgets this repository enforces

- A repair adds at most five production lines, one new function and no new
  module unless the operator states otherwise; a pure simplification nets zero
  or fewer production lines (2026-09-15).
- A file keeps its number of names imported from `src/meta/filesystem.ts`; a
  change adds at most one, and needing more means a redesign (2026-09-15).
  `measure.py`'s budget lines list each import source's added names.
- A rewrite from scratch deletes in a commit titled `R` and rebuilds after
  it, so the rebuild reads against an empty slate (PR #683 gate overhaul;
  PR #703 `1ed6d7d05` then `cbdca8c3d`). A rewritten test takes the
  production it directly touches with it, and `R` is squashed into its
  rebuild before the push, because every pushed commit passes alone.

## Counts are questions

Ceilings: cyclomatic complexity below 22, 115 nonblank lines per function, 800
per file (`tools/loc/source-policy.ts`) — the two line counts carry `biome
format`'s 90th-percentile inflation over the numbers they replaced, and the
complexity one does not move because a formatter adds no branches.
`tools/loc/complexity-baseline.json` only shrinks; a pass that fixes a
baselined function re-measures with `--write-baseline`. The gate's own count,
one line per problem file naming its functions:
`scripts/worktree.sh run <worktree> bun tools/loc/complexity-policy.ts <paths...>`.

Meet a ceiling in this order: fewer branches in the owner, then a closure, then
a function. The 2026-09-02 complexity cut extracted helpers to pass the count
and left duplicated provers and drifting comments; a second pass had to undo
it. Moving unchanged decisions into one-use helpers only spreads the same count
over more places, and a dense expression hiding six branches is just as bad.

### A frozen file is a budget, not a reason for a module

A copied-file limit in `tools/loc/source-policy.json` asks for the smaller
honest form, never a sibling file that lets the new code sit outside the count.
Reuse the owner's reader, then delete the duplicate the new code sits beside,
and report production lines against the head before the change.

Example, 2026-09-15, PR #679: the copy scan had to notice agent code imported
from `correctness-model/reference/`. The first repair walked the evaluator's
import graph in a new `src/claim/evaluator-reach.ts` with its own specifier
parser, split out because `correctness-model-hygiene.ts` is held at 187 lines.
The operator refused the new module. The kept repair calls `specifiersIn`,
which `bundle-validation.ts` already owned; the child-process escape check in
the same file then dropped its own operand walker for that reader.
`correctness-model-hygiene.ts` went from 186 to 180 lines while gaining the
rule, and the per-file graph walk became one stricter predicate: once the
evaluator imports from `reference/`, that whole package is scanned.

## What the lint and the census already find

Twenty-eight of the shapes this skill used to find by reading are now oxlint
rules under `tools/oxlint/ana/`, and all of them gate, so `bun run lint`
already reports them before a pass starts. Each rule's doc comment carries the
exemptions it needs and the site count that settled them; read the rule rather
than re-deriving the exemption here, because a list in two places drifts.
`bun run simplify` reports the whole-tree scans in
`tools/oxlint/tree-findings.ts` — `tree/copied-block`,
`tree/single-reader-export`, `tree/test-only-export` and the rest — which read
the tree at once and have no per-file rule to become. How often each of those
scans is right is measured by `.claude/skills/simplify-precision`.

A site read and answered "not slop", from a scan or a report-only lint rule, is
answered with `bun run not-slop -- answer <id> "<reason>"`, which writes a row
of `tools/oxlint/not-slop.tsv`; nothing reports it again until its code
changes. A pass that wants a new catcher writes it into
`tools/oxlint/simplify.json` first, reads its whole census group, and promotes
it only on a clean `bun run lint`.

## When the change is a producer, replay it

If the simplified code writes findings, rows, prompts or records, measure its
effect on recorded inputs: run the new code over saved inputs and count the
output (3,734 → 897 census rows). Label a count taken any other way as an
estimate, and say which numbers were replayed.

## Fix process lifetime at the launch owner

Command lifetime has two owners: `spawnCollected` for isolated Builder commands
and `stageCommandIsolation` for every Built shell launch. Settle a leak there,
not in each tool.

- 2026-09-15: an abort signal threaded into the Builder's command runner was
  refused ("why do we even need to kill", then "one layer higher"). The
  spawner already killed the group on timeout and in `finally`. The leak came
  from the controller recording its terminal before its session had stopped.
- PR #689 (`c4bd09b88`): the new `reapGroupOnExit` wrapper went back into
  `stageCommandIsolation`, applied to the Darwin launch only, because Linux
  `bwrap --unshare-pid` already ends the namespace. The reference was Bun's
  `--no-orphans`. Budget: production net −1, no new function.

## Guarantees a pass must not cut

- Verifier authority, isolation, exact source and model identities, comparison
  inputs, typed non-results, the three denominators, immutable accepted bytes,
  rollback and evidence binding. `null` for unknown is meaningful state, never a
  zero or empty string.
- Controller output under `domains/`, `campaigns/`, runs, claims, admissions and
  promotion archives stays untouched. Correct the shared producer; new source
  needs a new run or a deterministic replay.
- Domain meaning and diagnosis stay model-owned. Do not replace an ambiguous
  judgement with a deterministic classifier because it is hard to reason about.
- The chosen review components stay: improve their inputs, cadence and
  consumers without adding an agent, scheduler or decision authority.
- Protected verifier detail never moves into model-visible feedback. Changing
  only private detail must leave every public prompt digest unchanged.
- A TypeScript type, a runtime validator and a prompt may state one fact at
  different boundaries. Delete a repeated check only when the earlier guarantee
  still holds at the later use, including mutation, persistence and re-entry.
  A matching digest proves bytes, not permission to read their location.
- A comment that names the run, invariant or rejected alternative a line exists
  for stays; update it when its mechanism changes.

## Keep, and not a finding here

- A doc comment that says why the code exists or which run it fixed.
- A `boolean | null` tri-state, a component that stays `null` inside a digest.
- A re-read that measures a different moment (opening, submit, terminal).
- Two readers of one file with different contracts (a report wants nulls, the
  kernel wants typed refusals).
- A one-caller helper, only when its caller would otherwise carry a branch the
  name explains. A helper the caller could be is the caller.
- When you keep something, say why. "Already the smallest honest form" is a
  valid result; name the one place that came closest to changing.

## Finish

- Focused proof while editing: `scripts/worktree.sh run <worktree> bun run test
  -- <owning paths...>`. The normal push runs `bun run gate` once; do not repeat
  the full suite to call the pass complete.
- Before that push, run `bun run lint` and the complexity command above on the
  changed paths and read their exit codes. Silent output is not a pass: on
  2026-09-15 a lint run that printed nothing preceded two gate refusals (five
  lint rows, then a function at 24).
- Report, leading with the outcome in one sentence: what got simpler, the
  commit and the PR it landed on. Follow with the budget line (production net,
  new functions, new files, new imports), what stayed and why, and the test
  counts, in plain sentences a colleague can read without the diff. When a push
  is still running, say so and report its result when it lands.

When the operator corrects a pass, replace the rule that misled you in this
file, in both checkouts. Do not append a checklist item.
