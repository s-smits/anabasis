---
name: simplify
description: "Simplify Anabasis code using the whole-tree census method: run deterministic checks first (strict lint, `bun run simplify`, and the not-slop ledger), then inspect structural shapes that static scans cannot detect, resolving every site on a single verifiable sentence and measuring before and after with reduce-complexity scripts against explicit budgets. Use as /simplify on your own diff before committing, or when asked whether code is simple enough, why a mechanism exists, to move a fix one layer higher, or to remove something and find a cleaner alternative."
---

# Simplify

This skill is the repository's `/simplify` workflow;
[reduce-complexity](../reduce-complexity/SKILL.md) owns the complexity measurements and
[commit-r](../commit-r/SKILL.md) handles structural rewrites. Automated linters flag syntactic
patterns; this pass evaluates why code exists, whether campaigns actually exercise it, and whether
an existing owner already performs its job. Fix and report separately any bug uncovered along the
way.

## Read the invocation

Scope defaults to the named arguments or your current working diff. Match the procedure to the
operator's request:

| The operator wrote | Do this |
| --- | --- |
| "remove X", "sloppy, find another way" | Deletion is decided: trace and remove the entire strand (step 4) rather than shrinking X |
| a rewrite, "overkill", or edits leaving branch count unchanged | Use [commit-r](../commit-r/SKILL.md) |
| "why do we even need X?" | Name the existing owner that covers it, or the root cause it patches, before touching code |
| "one layer higher" | Revert the leaf patch and fix the single owning abstraction every path traverses |
| "so the bug cannot happen again" | H4: fix the defect class in its owner, then delete the per-instance patch |
| a list of declined simplifications | Apply the disagreement test (step 3) to every row |
| "is it simple enough?" | State the verdict first; if no, show the simplified form |
| "what looks most bloated?" | Rank by concepts a reader must learn (`measure.py` and the census) |

Work inline. Named external boundaries hold (renaming a shim breaks them); if a boundary blocks the
only clean cut, note that once. Never edit another session's pull request
([stack-pr](../stack-pr/SKILL.md)).

## 1. Run deterministic checks first

Never audit manually what a static tool already reports:

- `bun run lint -- --strict` (`tools/oxlint/HABITS.md`, 12.4 and 12.5): fix the offending site or
  tune the rule; never suppress it with a disable comment.
- `bun run simplify`: runs the whole-tree scans (`HABITS` 12.9); pass `-- <kind>` for one shape or
  `-- --all` for every site.
- `bun tools/loc/source-policy.ts`: enforces 800 nonblank lines per file, 115 per function, and
  zero unread exports.
- Run `reduce-complexity`'s `scope.sh` and `measure.py` before and after; any **repeat** finding
  signals calling the existing owner and deleting the duplicate.

Resolve each group completely: either fix every site, or record a justified answer with
`bun run not-slop -- answer <id> "<reason>"` under step 3's test (`-- prune` removes answers whose
sites vanished; auto-fixable rules reject answers per `HABITS` 12.2).

## 2. Inspect structural shapes static scans miss

Read the target code alongside its callers, tests, and head comment, then evaluate each shape in
order, prioritising the largest removals first:

| # | Shape | Settle it with |
| --- | --- | --- |
| H1 | **Unused in practice**: an option whose value never varies or a branch no log reaches | Count occurrences across all relevant logs and receipts; a single invariant value everywhere means delete it |
| H2 | **Duplicate reading of one fact** | Call the authoritative fold that already computes it (`AGENTS.md`, section 5, habit 2) |
| H3 | **Guard for an unreachable state** | Cite the upstream refusal or type invariant and its hostile test, then remove the guard |
| H4 | **Instance-level patch**: fixes one trigger while leaving the defect class open | Fix the owning abstraction every instance passes through and delete the site patch |
| H5 | **Single-caller helper inside one module** (the census inspects module boundaries only) | Inline it unless its name clarifies a non-trivial branch |
| H6 | **Fact stated twice in prose** | Keep it in the authoritative location and cross-reference it elsewhere |
| H7 | **Duplicate computation** | Retain the first computed result and pass it forward |
| H8 | **Hand-rolled code where the platform provides it** (Bun, an existing dependency, `src/meta`, `HABITS` 12.8) | Cite the platform primitive and integrate it in the owner; never add a new dependency for a few lines |

For each site, stop at the first rung of the simplification ladder that applies: (1) it does not
need to exist because its rule 13 chain (`owner → live reader → decision it changes → evidence →
hostile test`) has a missing link; (2) a higher layer already handles it; (3) the repository
already implements it; (4) the runtime or platform provides it; (5) it collapses into one
expression (two branches differing in one term, `ana/no-arms-differing-in-one-term`; a literal
repeated three times, `HABITS` 12.3); (6) only then write the minimal implementation inside its
owner. Prefer half the machinery for nearly all of the outcome, verifying both cost and outcome.

## 3. Apply the disagreement test

Operational heuristic: if you find yourself arguing against simplifying a site, it is usually too
complex. A site may remain only on **one sentence a reviewer can verify** against a file, test, or
log. Excuses such as "a test pins it" or "the fix touches many files" fail this test, and any
argument that a fix is inconvenient rather than wrong confirms the site as a finding. Valid
justifications include:

- a `null` representing an unknown value, or a re-read measuring a distinct point in time;
- two readers of the same file exposing distinct error contracts (for example, returning `null`
  versus throwing a refusal);
- a single-caller helper whose name clarifies a complex branch;
- an explicit rule in `AGENTS.md`, cited by number.

Record every retained scan site in the not-slop ledger with its justifying sentence, and every
retained manual site in the report.

## 4. Fix by group and follow the entire strand

When removing X, remove or simplify its fields, guards (H3), tests, and callers in the same pass;
any reader left without a producer becomes the next finding. If X patched an underlying bug, fix
the bug in its owner (H4) or report it as open. Inlining a helper's body into three callers removes
no complexity.

## 5. Verify and measure

- Re-run `measure.py` (net lines, new functions, imported names) and, for a commit or stack,
  `git complexity <base> HEAD` (decision points, import edges, exports, optional fields); edits
  that shift none of these metrics merely relocate code.
- Replay any modified log producer or reader (`bun run runs replay`), counting outputs with the
  owning reader and naming the logs checked; any unverified count is an estimate.
- Run `bun run test -- <paths>` during editing, `bun run commit:check` before committing, and the
  full CI gate once before delivery.

## Budgets

- A bug fix adds at most five production lines, one new function, and zero new modules; a pure
  simplification nets zero or fewer production lines unless the operator specifies otherwise.
- Each file preserves its count of imports from `src/meta/filesystem.ts`, adding at most one
  (`max-filesystem-imports`, `HABITS` 12.9).
- Satisfy file and function length ceilings by reducing branches first, then using a local closure,
  then extracting a function; never split into a sibling module (`copiedFileLimits` in
  `tools/loc/source-policy.json` remains empty). A `measure.py` branch count above 21 is a
  diagnostic lead rather than a hard refusal.

No simplification may violate `AGENTS.md`'s section 2 boundary, section 5 log invariants, section 8
rules, section 11 protected files, or section 13 head-comment conventions, and `null` for unknown
must stay distinct from zero.

## Report in census format

Lead with what became simpler and the commit SHA. Then report: (1) each site grouped by shape
(largest first), marked `removed`, `folded into <owner>`, `kept: <sentence>`, or `open: <why>`;
(2) budget and structural complexity rows before and after; (3) what the simpler form gives up,
with replay and test counts; and (4) **For the census** (or `none`). If a pass yields no findings,
name the site that came closest along with its justifying sentence.

## Feed the census

Whenever manual inspection reveals a pattern at three or more sites that a lint catcher (`HABITS`
12.4, 12.5) or a `tree-*.ts` scan (12.9) could detect automatically, list it under **For the
census**. New checks start in report-only mode (a strict-lint warning or a `tree-findings.ts` scan)
and graduate into `.oxlintrc.json` only at zero remaining sites once every site has a clean
alternative accepted by all other rules; heuristic checks never block. When the operator corrects a
simplification pass, refine or replace the misleading rule rather than stacking another rule on top.
