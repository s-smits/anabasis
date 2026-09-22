---
name: simplify
description: Anabasis supplement to the user-level /simplify skill. The method, scripts and cases live in ~/.claude/skills/simplify; this file names what this repository binds, the guarantees a pass must not cut, and the commands that prove it.
---

# Simplify in Anabasis

The method is the user-level skill: ask why the code exists, fix it at the
layer that already owns it, keep to the budget, and land the commit on the PR
it simplifies. A removal or a rewrite from scratch follows its remove-first
sweep and R protocol. This file adds only what this repository binds.

## Budgets this repository enforces

- A file keeps its number of names imported from `src/meta/filesystem.ts`; a
  change adds at most one, and needing more means a redesign (2026-09-15).
  `measure.py`'s budget lines list each import source's added names.
- A repair adds at most five production lines, one new function and no new
  module unless the operator states otherwise (2026-09-15).
- A rewrite from scratch deletes in a commit titled `R` and rebuilds in the
  next commits on the same PR, so the rebuild reads against an empty slate
  (PR #683 gate overhaul; PR #703 `1ed6d7d05` then `cbdca8c3d`).

## Commands

- Scope, counts, budget and repeats, from any directory:
  `~/.claude/skills/simplify/scripts/scope.sh [<PR#>|<commit>|<a..b>|<paths>] -C <worktree> -o <diff>`
  then `~/.claude/skills/simplify/scripts/measure.py --diff <diff> --base <pre-change ref> -C <worktree>`.
  On a stack, `scope.sh` diffs against the open PR's base branch, not `main`.
  Budget lines read the worktree's files, so measure a commit in a detached
  worktree at that commit.
- Whether the pass moved anything, on seventeen measures at once and across a
  whole PR stack: `.claude/skills/reduce-complexity`. Run it before and after,
  and put both numbers in the PR body; a simplification that cannot name a
  measure it moved is a rewrite.
- The gate's own count, one line per problem file naming its functions:
  `scripts/worktree.sh run <worktree> bun tools/loc/complexity-policy.ts <paths...>`.
  Ceilings: cyclomatic complexity below 22, 115 nonblank lines per function, 800
  per file — the two line counts carry `biome format`'s 90th-percentile inflation
  over the numbers they replaced, and the complexity one does not move because a
  formatter adds no branches. `tools/loc/complexity-baseline.json` only shrinks; a pass that fixes
  a baselined function re-measures with `--write-baseline`.
- Focused proof while editing: `scripts/worktree.sh run <worktree> bun run test
  -- <owning paths...>`. The normal push runs `bun run gate` once; do not repeat
  the full suite to call the pass complete.
- Before that push, run `bun run lint` and the complexity command above on the
  changed paths and read their exit codes. Silent output is not a pass: on
  2026-09-15 a lint run that printed nothing preceded two gate refusals (five
  lint rows, then a function at 24).
- One commit on the PR the pass simplifies, pushed to that PR's source branch.
  Never open a new PR to simplify an unmerged one.

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

## Not a finding here

- A `boolean | null` tri-state, a component that stays `null` inside a digest.
- A re-read that measures a different moment (opening, submit, terminal).
- Two readers of one file with different contracts (a report wants nulls, the
  kernel wants typed refusals).
- A one-caller helper, only when its caller would otherwise carry a branch the
  name explains. A helper the caller could be is the caller.

Twenty-eight of the shapes this skill used to find by reading are now oxlint
rules under `tools/oxlint/ana/`, and all of them gate, so `bun run lint`
already reports them before a pass starts. Each rule's doc comment carries the
exemptions it needs and the site count that settled them, measured over this
tree on 2026-09-20; read the rule rather than re-deriving the exemption here,
because a list in two places drifts. `bun run simplify` also reports the
whole-tree scans in `tools/oxlint/tree-findings.ts` — `tree/copied-block`,
`tree/single-reader-export`, `tree/test-only-export` and the rest — which read
the tree at once and have no per-file rule to become. A site read and answered
"not slop", from a scan or a report-only lint rule, is answered with
`bun run not-slop -- answer <id> "<reason>"`, which writes a row of
`tools/oxlint/not-slop.tsv`; nothing reports it again until its code changes. A pass that
wants a new catcher writes it into `tools/oxlint/simplify.json` first, reads
its whole census group, and promotes it only on a clean `bun run lint`.

## A frozen file is a budget, not a reason for a module

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

Feed a procedural failure back by replacing the obsolete rule in the owning
skill file, not by adding a checklist item.
