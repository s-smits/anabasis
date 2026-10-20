---
name: simplify
description: "Review changed Anabasis v2 code for reuse, simplification and efficiency, then apply the fixes. Report correctness bugs separately. Starts from the lint plugins, the whole-tree census and the not-slop ledger, measures before and after with reduce-complexity's scripts, and holds a pass to its budgets and the repository's rules. Use as /simplify on your own diff before a commit, or when the operator asks whether code is simple enough, why something exists, to go one layer higher, or to remove something and find another way."
---

# Simplify

This file is `/simplify` in this repository. An operator's own skill pack may hold another
`/simplify`; where the two disagree, this one governs here. The method is reading: why the code
exists, which owner already does its job, what can go. [reduce-complexity](../reduce-complexity/SKILL.md)
is the instrument and owns the three measurement scripts, and [commit-r](../commit-r/SKILL.md) owns a
rewrite from scratch.

## First

1. **Ask why the code exists before asking how to shrink it.** Read the code, the function around
   it, every caller, the owning test and the head comment, which says what defect the code answers
   (`AGENTS.md`, section 13). Most answers lie outside the diff: an owner that already does the job,
   a helper with one caller, a field nothing reads, a guard an earlier refusal makes impossible.
2. **Fix it at the highest layer that already owns it.** "Can't we go one layer higher?" is the
   operator's most expensive correction. Before editing a leaf, name the owner that already holds
   the decision, the reading or the refusal.
3. **Budgets are hard.** The defaults are below; a budget the operator states ("max 5 prod LoC",
   "remove one import to add one") replaces them. Measure it; do not estimate it.
4. **Land on the pull request it simplifies**, as a commit there when the pull request is your own.
   Another session's pull request is never yours to change ([stack-pr](../stack-pr/SKILL.md)).

You are improving code that works. A correctness bug found on the way is fixed under the task's
authority and reported apart.

## Read the invocation

The scope comes from the arguments: pasted code, a worktree, "uncommitted diff", a commit, a pull
request, a range or paths. Nothing named means your own working diff. The wording decides the
procedure.

| The operator wrote | Do this |
| --- | --- |
| "remove X and /simplify", "sloppy, remove and find another way" | The deletion is decided. Follow the whole strand (below), and do not come back with a smaller X |
| "rewrite from scratch", "completely remove and rewrite", "overkill" | [commit-r](../commit-r/SKILL.md) |
| "why do we even need X?" | Answer with the owner that already covers it, or the root cause X patches. Code comes after that answer |
| "one layer higher" | Revert the leaf edit. Find the one owner every path runs through and fix it there |
| "find a reference in Bun or another well-known repository" | Read how that project settles it, cite the file, then fit that form into the existing owner |
| "is it simple enough?" | The verdict first. "Yes" is a whole answer; otherwise show the folded form |
| "what looks most bloated?" | Rank by concepts a reader must learn, from `measure.py` and the census |
| a bare `/simplify` after your own change | Your diff is the scope, read as if a colleague wrote it |

Work inline, and use subagents only when the operator asks. A named boundary ("keep these
owners") is a boundary, and a renamed shim is the forbidden thing itself. When the boundary blocks
the only real cut, say so once and stop.

**Following a removal.** Each caller goes too or gets simpler now that the value cannot occur. A
field only X set leaves its type. A guard that existed because X could yield nothing goes. A test
of X alone goes, and a test that pinned other behaviour through X is given another fixture. A
reader whose only producer went is the next finding. Where X patched a failure, the removal
reopens it: fix it at its owner, or say plainly that it is open. Moving a helper's body into three
callers is no removal.

## What the repository already finds

Read these before reading by hand. Each was a shape this skill kept finding by eye.

- `bun run lint -- --strict`: the `ana` and `anti-slop` plugins are the catchers that decide from
  the syntax alone (`tools/oxlint/HABITS.md`, 12.4 and 12.5). Fix the site or tune the rule; never
  turn one off (`AGENTS.md`, section 12).
- `bun run simplify`: the whole-tree scans, which relate two files and which no per-file rule can
  express (HABITS 12.9): orphan and test-only modules and exports, single-reader exports, copied
  blocks, unread fields, compatibility paths. `bun run commit:check` prints the ones on your
  changed lines. Each row is a question.
- `bun run not-slop -- answer <id> "<a reason a reviewer can check>"` records an answer for an
  eligible finding. Fixable plugin rules and registers refuse an answer; follow HABITS 12.2.
  `-- prune` drops answers whose finding no longer exists.
- `bun tools/loc/source-policy.ts`: 800 nonblank lines a file and 115 a function over `src`,
  `tools` and `vendor`, plus unread exports in `src`, `tools` and `packages/ui/src`. No CI job runs it, so run
  it yourself and add no finding. It reads `.claude` as evidence of export use; the census also
  treats skill scripts as finding candidates.

## Measure before and after

Run reduce-complexity's `scope.sh` and `measure.py` (its section "One diff") once before editing
and once after, and put the budget lines in the report: production and test lines net, new
functions net of moved ones, the names each import source gained. Its
**repeats** section is added code that already exists in tracked source: call that owner, and
delete the other copies of the same reader too. For a pull request or a stack, give the structural
rows of `stack-complexity.py` beside the lines (decision points, import edges, exported symbols,
optional fields): a pass that moves lines and none of those has moved mass.

## The ladder

Climb it for each mechanism, and stop at the first rung that holds.

1. **Does it need to exist?** Map it as rule 13 asks,
   `owner → live reader → decision it changes → evidence → hostile test`, and drop it when a link is
   missing.
2. **Does a higher layer already do it?** A campaign move's admission belongs in
   `src/builder/admission.ts`; the launcher in `tools/runs/manage.ts` starts the command.
3. **Is it already in this repository?** Add no second reader of one fact: find the fold that reads
   it and call that (`AGENTS.md`, section 5). `measure.py`'s repeats name candidates.
4. **The platform, Bun or an installed dependency?** Every runtime surface has one owner in
   `src/meta` (HABITS 12.8). Never add a dependency for a few lines.
5. **Can it be one expression?** Two arms that differ in one term are one arm
   (`ana/no-arms-differing-in-one-term`); an object literal of three or more properties spelled
   three times is one function (HABITS 12.3).
6. **Only then** the least that works, inside the owner.

At each rung, ask whether the root cause was fixed or the result patched, and how much of the old
behaviour the minimum must keep: prefer the form with about half the machinery that keeps nearly
all of the result, measured on both sides, with `measure.py` for the mechanism and a replay or the
decision the code feeds for what it still does.

v2's own review named four forms its growth took (`7f0add79:docs/simplify.md`, section 5), and each is a
rung-1 or rung-2 question: two generations of one mechanism standing side by side; a weak seat
compensated by more rows in the controller instead of being mended at the seat; an incident
written into the code as a date and a branch; and proof machinery carried from v1 for a threat v2
does not have.

## Budgets

- A repair adds at most five production lines, one new function and no new module, and a pure
  simplification nets zero production lines or fewer, unless the operator states another.
- A file keeps its count of names imported from `src/meta/filesystem.ts`, and a change adds at most
  one (`filesystem-import-budget`, HABITS 12.9).
- A ceiling is met with fewer branches in the owner, then a closure, then a function. Helpers with
  one use spread the same count over more places. A sibling module that lets new code sit outside
  the 800-line count is refused, and `copiedFileLimits` in `tools/loc/source-policy.json` stays empty. v2 has no
  complexity gate: `measure.py`'s branch count over 21 is a lead, never a refusal.

## When the change is a producer, replay it

Code that writes events, rows, reports or prompts is measured on recorded input. `bun run runs
replay` reads every campaign log in the repository's worktrees, live and interrupted ones among
them, and leaves out a live solve's log; it reports selected folds, rather than every output.
Count the changed output before and after with its owning reader. Say which logs were read,
and label estimated counts as estimates.

## What a pass must not cut

Keep the conditions and content split in `AGENTS.md` section 2, the log rules in section 5, the
rules in section 8, the protected files in section 11 and the head comments in section 13.
A measure that improves by breaking one of them is no simplification. `null` for unknown stays
distinct from zero.

## Keep, and not a finding

- A `null` that means unknown, and a re-read that measures another moment.
- Two readers of one file with different contracts, where one wants nulls and the other refusals.
- A helper with one caller, where the caller would otherwise carry a branch the name explains.
- Working code already close to its smallest honest form. Say "already the smallest honest form"
  when it is, and name the one place that came closest to changing.

## Finish

- While editing, run the owning tests only: `bun run test -- <paths>`. Before the commit,
  `bun run commit:check`. Before delivery, the gate CI runs (`AGENTS.md`, section 11), once, with
  every exit code read; a run that printed nothing is not a pass.
- Report with the outcome first, in one sentence: what got simpler, and the commit. Then the budget
  lines, what the simpler form gave up and how that was measured (or that it gave up nothing),
  what stayed and why, and the test counts.

When the operator corrects a pass, replace the rule that misled you here. Do not append a
checklist item.
