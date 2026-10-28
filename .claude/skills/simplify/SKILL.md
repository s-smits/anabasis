---
name: simplify
description: "Simplify Anabasis v2 code the way the whole-tree census does: run the deterministic half first (strict lint, `bun run simplify`, the not-slop ledger), then read for the shapes no scan sees, decide every site, keep a site only on one sentence a reviewer can check, report grouped by shape, and hand each shape found by hand at three sites to the census. Measures before and after with reduce-complexity's scripts and holds a pass to its budgets and the repository's rules. Use as /simplify on your own diff before a commit, or when the operator asks whether code is simple enough, why something exists, to go one layer higher, or to remove something and find another way."
---

# Simplify

This file is `/simplify` in this repository. An operator's own skill pack may hold another
`/simplify`; where the two disagree, this one governs here. [reduce-complexity](../reduce-complexity/SKILL.md)
is the instrument and owns the three measurement scripts, and [commit-r](../commit-r/SKILL.md) owns
a rewrite from scratch.

Simplification here has two halves. The **deterministic half** is `bun run simplify` with the
strict lint. It was measured from 628 commits and 20 recorded passes. It names each shape with a
fixed argument, lists every site under it, and records a kept site in the not-slop ledger with a
checkable reason. A shape that held up there was promoted to a lint rule once its sites reached
zero. On 20 October it found one site and the filesystem register over the whole tree. What is
left for a reading pass is what no program can decide: why code exists, whether any recorded run
uses it, and which owner already does its job. This skill does that half, and does it the way
the census works: by shape, with every site decided, every decision recorded, and every recurring
shape handed back to the census.

You are improving code that works. A correctness bug found on the way is fixed under the task's
authority and reported apart.

## Read the invocation

The scope comes from the arguments: pasted code, a worktree, "uncommitted diff", a commit, a pull
request, a range or paths. Nothing named means your own working diff. The wording decides the
procedure.

| The operator wrote | Do this |
| --- | --- |
| "remove X and /simplify", "sloppy, remove and find another way" | The deletion is decided. Follow the whole strand (step 4), and do not come back with a smaller X |
| a rewrite or overhaul, "overkill", or edits that leave a compartment's branch count where it was | [commit-r](../commit-r/SKILL.md) |
| "why do we even need X?" | Answer with the owner that already covers it, or the root cause X patches. Code comes after that answer |
| "one layer higher" | Revert the leaf edit. Find the one owner every path runs through and fix it there |
| "simplify the system so the bug cannot happen again" | Shape H4: fix the class where every instance passes, then remove the per-instance patch |
| a list of things you declined to fix | The disagreement test (step 3) on every row |
| "find a reference in Bun or another well-known repository" | Read how that project settles it, cite the file, then fit that form into the existing owner |
| "is it simple enough?" | The verdict first. "Yes" is a whole answer; otherwise show the folded form |
| "what looks most bloated?" | Rank by concepts a reader must learn, from `measure.py` and the census |
| a bare `/simplify` after your own change | Your diff is the scope, read as if a colleague wrote it |

Work inline, and use subagents only when the operator asks. A named boundary ("keep these
owners") is a boundary, and a renamed shim is the forbidden thing itself. When the boundary blocks
the only real cut, say so once and stop. A budget the operator states ("max 5 prod LoC", "remove
one import to add one") replaces the defaults below; measure it rather than estimate it. Land on
the pull request the pass simplifies when it is your own; another session's pull request is never
yours to change ([stack-pr](../stack-pr/SKILL.md)).

## 1. The deterministic half first

Never reread by hand what a program already reports. Before reading:

- `bun run lint -- --strict`: the `ana` and `anti-slop` catchers, which decide from the syntax alone
  (`tools/oxlint/HABITS.md`, 12.4 and 12.5). Fix the site or tune the rule; never turn one off
  (`AGENTS.md`, section 12).
- `bun run simplify`: the whole-tree scans (HABITS 12.9), grouped by shape, largest first.
  `-- <kind>` prints one shape, `-- --all` every site. `bun run commit:check` narrows them to the
  lines a commit changes.
- `bun tools/loc/source-policy.ts`: 800 nonblank lines a file, 115 a function, and unread exports.
  No CI job runs it, so run it yourself and add no finding.
- reduce-complexity's `scope.sh` and `measure.py` (its section "One diff"), once now and once at
  the end. Its **repeats** are added code that already exists in tracked source: call that owner
  and delete the other copies.

Decide each reported group as a group, as the census asks: fix every site, or answer a site with
`bun run not-slop -- answer <id> "<reason>"` under the test of step 3. Fixable plugin rules and
registers refuse an answer (HABITS 12.2); `-- prune` drops answers whose site went.

## 2. The shapes no scan sees

Read the code, the function around it, every caller, the owning test and the head comment, which
says what defect the code answers (`AGENTS.md`, section 13). Then ask each shape of the scope,
in this order, and list every site that answers yes. The order puts the shapes whose answer
removes the most first. Each row names the recorded case that put it here.

| # | Shape | Settle it with | Recorded case |
| --- | --- | --- | --- |
| H1 | **Nothing on record uses it.** A flag, a field or an option whose value never varied, a branch no log reaches, a decision that never changed | Count it in every log that could hold it (`AGENTS.md`, section 11: count an event kind in the logs that hold it), and in the launch receipts. One value everywhere means the option goes | The named scored set: `tasks: null` in all 544 `campaign.setting` events on one host and 17 on another, removed with −123 production lines (20 October). The Diagnoser: 20 of 20 readings named the solver, removed with 1,063 lines |
| H2 | **A second reading of one fact.** A reader that derives again what a fold or a report already states | Find the fold that reads it (`AGENTS.md`, section 5, habit 2) and call that | `onValidity` in #276 derived again what every report prints as "the objective decided N tasks", and was removed with its report line and test before publication (20 October) |
| H3 | **A guard for a state that cannot arrive.** An earlier refusal, a type or a removal already excludes it | Name the refusal that comes first, and the test of its hostile case | A guard that existed because a removed producer could yield nothing goes with that producer |
| H4 | **A patch on the instance.** The fix answers the trigger seen live, and the class stays open. Ask the operator's question of 19 October: would the bug occur next time? | Find the owner every instance runs through, fix it there, and remove the per-trigger patch | A move that changed nothing killed a campaign without an ending. It was fixed in `harnessBuilder`, where every move ends, rather than in the one draw that took no task (#299, 20 October) |
| H5 | **A helper or a wrapper inside one module, with one caller.** The census's `single-reader-export` sees whole modules only | Inline it unless its name explains a branch the caller would otherwise carry | `shellSeconds` into `heldSeconds`, `carryMemoryForward` into `keepMemory` (14 and 15 October) |
| H6 | **A fact stated twice in prose.** Two skills, a prompt and its tool result, `AGENTS.md` and a head comment | Keep it where it is read, and point to it from the rest (`AGENTS.md`, section 13) | Four restated passages across the skills became pointers to the skills that own them (9 October) |
| H7 | **One computation done twice.** Parse once, read once, compute once | Hold the first result and pass it on | The Referee's verdict parsed once (7 October) |
| H8 | **Hand-rolled where the platform has it.** Bun, an installed dependency, an owner in `src/meta` (HABITS 12.8), or a library used at one to three sites that the platform replaces | Cite the platform's or the reference project's form, then fit it into the existing owner. Never add a dependency for a few lines | The operator's ask of 1 October |

v2's own review named four forms its growth took (`7f0add79:docs/simplify.md`, section 5). Each is
an H1, H2 or H4 question: two generations of one mechanism standing side by side; a weak seat
compensated by more rows in the controller instead of being mended at the seat; an incident
written into the code as a date and a branch; and proof machinery carried from v1 for a threat v2
does not have.

For each site, climb the ladder and stop at the first rung that holds:

1. **Does it need to exist?** Map it as rule 13 asks,
   `owner → live reader → decision it changes → evidence → hostile test`, and drop it when a link is
   missing.
2. **Does a higher layer already do it?** A campaign move's admission belongs in
   `src/campaign/admission.ts`; the launcher in `tools/runs/manage.ts` only starts the command.
3. **Is it already in this repository?** (H2, and `measure.py`'s repeats.)
4. **Does the platform, Bun or an installed dependency do it?** (H8.)
5. **Can it be one expression?** Two arms that differ in one term are one arm
   (`ana/no-arms-differing-in-one-term`); an object literal of three or more properties spelled
   three times is one function (HABITS 12.3).
6. **Only then** the least that works, inside the owner.

Prefer the form with about half the machinery that keeps nearly all of the result. Measure both
sides: `measure.py` for the mechanism, and a replay or the decision the code feeds for what it
still does.

## 3. The disagreement test

The operator's rule of 20 October: if you disagree with fixing something, it is probably too
complex. So a site stays only on **one sentence a reviewer can check** against a file, a test or a
log. "A test pins it", "it works", "it may be needed" and "the fix touches many files" are no such
sentence. Where the reason takes more than one sentence, or argues that the fix is hard rather
than wrong, the site is a finding: simplify the mechanism until the fix is easy, and fix it.

These are the sentences that hold up, each settled the same way every time:

- A `null` that means unknown, and a re-read that measures another moment.
- Two readers of one file with different contracts, where one wants nulls and the other refusals.
- A helper with one caller, where the caller would otherwise carry a branch the name explains.
- Something the rules of `AGENTS.md` keep (below), cited by section or number.

A kept site that a scan reported goes into the ledger with its sentence. A kept site found by hand
goes into the report with it.

## 4. Fix by group, and follow the whole strand

Fix a shape's sites together. When something goes, each caller goes too, or gets simpler now that
its value cannot occur:

- A field only X set leaves its type.
- A guard that existed because X could yield nothing goes (H3).
- A test of X alone goes, and a test that pinned other behaviour through X gets another fixture.
- A reader whose only producer went is the next finding.
- Where X patched a failure, the removal reopens it: fix it at its owner (H4), or say plainly
  that it is open.

Moving a helper's body into three callers is no removal.

## 5. Prove it

- `measure.py` again, with the budget lines: production and test lines net, new functions net of
  moved ones, and the names each import source gained. For a pull request or a stack, give
  `stack-complexity.py`'s structural rows beside them: decision points, import edges, exported
  symbols and optional fields. A pass that moved lines and none of those has moved mass.
- **A producer or a reader is replayed.** Code that writes events, rows, reports or prompts is
  measured on recorded input: `bun run runs replay` reads every campaign log in the repository's
  worktrees and reports selected folds. Count the changed output before and after with its owning
  reader, and say which logs were read. On 11 October a pass replayed all 66 logs and found them
  identical. A count taken any other way is labelled an estimate.
- While editing, run only the owning tests: `bun run test -- <paths>`. Run `bun run commit:check`
  before the commit, and the CI gate (`AGENTS.md`, section 11) once before delivery, reading
  every exit code. A run that printed nothing is not a pass.

## Budgets

- A repair adds at most five production lines, one new function and no new module. A pure
  simplification nets zero production lines or fewer, unless the operator states otherwise.
- A file keeps its count of names imported from `src/meta/filesystem.ts`, and a change adds at most
  one (`filesystem-import-budget`, HABITS 12.9).
- A ceiling is met with fewer branches in the owner, then a closure, then a function. Helpers with
  one use spread the same count over more places. A sibling module that lets new code sit outside
  the 800-line count is refused, and `copiedFileLimits` in `tools/loc/source-policy.json` stays
  empty. v2 has no complexity threshold: a `measure.py` branch count over 21 is a lead, never a refusal.

## What a pass must not cut

The conditions and content split in `AGENTS.md` section 2, the log rules in section 5, the rules in
section 8, the protected files in section 11 and the head comments in section 13 are what no pass
trades. A measure that improves by breaking one of them is no simplification. `null` for unknown
stays distinct from zero.

## Report as the census prints

Lead with one sentence: what got simpler, and the commit. Then:

1. **By shape, largest first.** The shape's code and its argument once, then each site with its
   verdict: `removed`, `folded into <owner>`, `kept: <the one sentence>`, or `open: <why>`.
   Deterministic rows and H rows are reported alike.
2. **Budget lines and structural rows**, before and after, measured.
3. **What the simpler form gave up**, and how that was measured, or that it gave up nothing. Then
   the replay and the test counts.
4. **For the census:** shapes to hand over (below), or "none".

A pass with no finding names the scope it read, and the one site that came closest to changing,
with its sentence. "Already the smallest honest form" without that site is no report.

## Feed the census

The census exists because passes kept finding the same shapes by eye, in whichever files they
happened to open. A shape you find by hand at three or more sites, in this pass or in recorded
ones, whose sites a program could find, is named under "For the census" with its sites and its
argument. A program could find them where the syntax shows them (a catcher, HABITS 12.4 and 12.5)
or where the whole tree does (a `tree-*.ts` scan, 12.9).

It goes in as the census's own shapes went. First it reports, measured over the tree: a per-file
rule as a warning in a strict lint run, a whole-tree shape as a scan in `tree-findings.ts`, which
`bun run simplify` prints. It is
promoted to `.oxlintrc.json` only once its sites are at zero and it passes the admission test: at
every site, some spelling satisfies every other rule. A heuristic reports and never blocks, since
a false positive costs more than a miss (operator, 1 October). The shapes of section 2 that need a
log, a caller's intent or a model's reading stay here. A new one joins the table with its recorded
case.

When the operator corrects a pass, replace the rule that misled you here. Do not append a
checklist item.
