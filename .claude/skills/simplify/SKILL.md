---
name: simplify
description: "Simplify Anabasis code the way the whole-tree census does: the deterministic half first (strict lint, `bun run simplify`, the not-slop ledger), then the shapes no scan sees, every site decided and kept only on one sentence a reviewer can check, measured with reduce-complexity's scripts against its budgets. Use as /simplify on your own diff before a commit, or when the operator asks whether code is simple enough, why something exists, to go one layer higher, or to remove something and find another way."
---

# Simplify

This is `/simplify` here, over any other skill of that name;
[reduce-complexity](../reduce-complexity/SKILL.md) owns the measurements and
[commit-r](../commit-r/SKILL.md) rewrites. Programs decide what syntax shows; this pass decides why
code exists, whether a run uses it, and which owner already does its job.
A bug found on the way is fixed and reported apart.

## Read the invocation

The scope is what the arguments name, or your own working diff. The wording sets the procedure:

| The operator wrote | Do this |
| --- | --- |
| "remove X", "sloppy, find another way" | The deletion is decided: follow the whole strand (step 4), never a smaller X |
| a rewrite, "overkill", or edits that leave the branch count unchanged | [commit-r](../commit-r/SKILL.md) |
| "why do we even need X?" | Name the owner that covers it, or the cause it patches, before code |
| "one layer higher" | Revert the leaf edit and fix the one owner every path runs through |
| "so the bug cannot happen again" | H4: fix the class, then remove the per-instance patch |
| a list of things you declined | The disagreement test (step 3) on every row |
| "is it simple enough?" | The verdict first; if no, show the folded form |
| "what looks most bloated?" | Rank by concepts a reader must learn (`measure.py`, the census) |

Work inline. A named boundary holds (a renamed shim breaks it); where it blocks the only cut, say so
once. Another session's pull request is not yours ([stack-pr](../stack-pr/SKILL.md)).

## 1. The deterministic half first

Never reread by hand what a program reports:

- `bun run lint -- --strict` (`tools/oxlint/HABITS.md`, 12.4 and 12.5): fix the site or tune the
  rule, never disable one.
- `bun run simplify`: the whole-tree scans (HABITS 12.9); `-- <kind>` one shape, `-- --all` every
  site.
- `bun tools/loc/source-policy.ts`: 800 nonblank lines a file, 115 a function, unread exports.
- reduce-complexity's `scope.sh` and `measure.py`, now and at the end; a **repeat** means calling
  the existing owner and deleting the copy.

Decide each group whole: fix every site, or answer one with
`bun run not-slop -- answer <id> "<reason>"` under step 3's test (`-- prune` drops answers whose
site went; fixable rules refuse an answer, HABITS 12.2).

## 2. The shapes no scan sees

Read the code, its callers, test and head comment, then ask each shape in order, largest removals
first.

| # | Shape | Settle it with |
| --- | --- | --- |
| H1 | **Nothing on record uses it**: an option whose value never varied, a branch no log reaches | Count it in every log and receipt that could hold it; one value everywhere means it goes |
| H2 | **A second reading of one fact** | Call the fold that already reads it (`AGENTS.md`, section 5, habit 2) |
| H3 | **A guard for a state that cannot arrive** | Name the earlier refusal or type, and its hostile test |
| H4 | **A patch on the instance**: the live trigger is fixed, the class stays open | Fix the owner every instance runs through, remove the patch |
| H5 | **A helper with one caller inside one module** (the census sees whole modules only) | Inline it unless its name explains a branch |
| H6 | **A fact stated twice in prose** | Keep it where it is read; point to it elsewhere |
| H7 | **One computation done twice** | Hold the first result and pass it on |
| H8 | **Hand-rolled where the platform has it** (Bun, a dependency, `src/meta`, HABITS 12.8) | Cite the platform's form and fit it into the owner; never add a dependency for a few lines |

For each site, stop at the first rung that holds: (1) it need not exist, since a link of its rule 13
map (`owner → live reader → decision it changes → evidence → hostile test`) is missing; (2) a higher
layer does it; (3) the repository already has it; (4) the platform has it; (5) it can be one
expression (two arms differing in one term, `ana/no-arms-differing-in-one-term`; a literal spelled
three times, HABITS 12.3); (6) only then the least that works, inside the owner. Prefer half the
machinery for nearly all the result, measured on both sides.

## 3. The disagreement test

The operator's rule: if you disagree with fixing something, it is probably too complex. A site
stays only on **one sentence a reviewer can check** against a file, a test or a log; "a test pins
it" or "the fix touches many files" is none, and a reason that argues the fix is hard rather than
wrong makes the site a finding. The sentences that hold:

- a `null` that means unknown, and a re-read that measures another moment;
- two readers of one file with different contracts (nulls against refusals);
- a one-caller helper whose name explains a branch;
- a rule of `AGENTS.md`, cited.

A kept scan site goes in the ledger with its sentence, a kept hand site in the report.

## 4. Fix by group, and follow the whole strand

When X goes, its fields, guards (H3), tests and callers go or simplify with it, and a reader whose
only producer went is the next finding. Where X patched a failure, fix it at its owner (H4) or say
it is open. Moving a helper's body into three callers removes nothing.

## 5. Prove it

- `measure.py` again (lines net, new functions, imported names), and for a commit or stack
  `git complexity <base> HEAD` (decision points, import edges, exports, optional fields); lines that
  moved none of those are mass moved.
- Replay a changed producer or reader (`bun run runs replay`), counting its output with the owning
  reader and naming the logs; any other count is an estimate.
- `bun run test -- <paths>` while editing, `bun run commit:check` before the commit, the CI gate
  once before delivery.

## Budgets

- A repair adds at most five production lines, one new function and no new module; a pure
  simplification nets zero production lines or fewer, unless the operator says otherwise.
- A file keeps its count of names from `src/meta/filesystem.ts`, and a change adds at most one
  (`filesystem-import-budget`, HABITS 12.9).
- Meet a ceiling with fewer branches, then a closure, then a function; never a sibling module
  (`copiedFileLimits` in `tools/loc/source-policy.json` stays empty). A `measure.py` branch count
  over 21 is a lead, never a refusal.

No pass trades `AGENTS.md`'s section 2 split, section 5's log rules, section 8's rules, section 11's
protected files or section 13's head comments, and `null` for unknown stays distinct from zero.

## Report as the census prints

Lead with what got simpler and the commit. Then: (1) by shape, largest first, each site `removed`,
`folded into <owner>`, `kept: <sentence>` or `open: <why>`; (2) budget and structural rows before
and after; (3) what the simpler form gave up, with replay and test counts; (4) **For the census**,
or "none". A pass with no finding names the site that came closest, with its sentence.

## Feed the census

A shape found by hand at three or more sites that a catcher (HABITS 12.4, 12.5) or a `tree-*.ts`
scan (12.9) could find goes under "For the census". It starts as a report (a strict-lint warning, or
a scan in `tree-findings.ts`) and joins `.oxlintrc.json` only at zero sites, once every site has a
spelling every other rule accepts; a heuristic never blocks. When the operator corrects a pass,
replace the misleading rule rather than add one.
