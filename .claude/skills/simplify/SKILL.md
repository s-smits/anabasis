---
name: simplify
description: "Use before committing source changes (as /simplify) or when asked whether code is simple enough, why a mechanism exists, to move a fix one layer higher, or to remove machinery for a cleaner alternative. Runs deterministic checks first (strict lint, `bun run simplify`, not-slop ledger), inspects structural shapes static scans miss, resolves every site on one verifiable sentence, and measures before and after with reduce-complexity scripts against explicit budgets."
---

# Simplify

Repository `/simplify` workflow ([reduce-complexity](../reduce-complexity/SKILL.md) owns complexity metrics; [commit-r](../commit-r/SKILL.md) handles compartment rewrites; [stack-pr](../stack-pr/SKILL.md) places and proves commits on the stack). Work inline without touching other sessions' PRs or violating `AGENTS.md` sections 2, 5, 8, 11, or 13.

## 1. Run deterministic checks first

- `bun run lint -- --strict` (`tools/oxlint/HABITS.md` 12.4, 12.5, 12.14): fix the site or refine the rule; never add disable comments.
- `bun run simplify -- --gate`: runs the whole-tree scans (`HABITS` 12.9) and exits 1 if any unanswered site stands (`-- <kind>` filters one shape; `-- --all` lists every site).
- `bun tools/loc/source-policy.ts`: enforces 800 nonblank lines/file, 115 lines/function, and zero unread exports.
- `.claude/skills/reduce-complexity/scripts/scope.sh` and `measure.py` before and after (`repeats` flags 3-line windows duplicating an existing owner).

Fix every site in a group or record a verifiable answer with `bun run not-slop -- answer <id> "<reason>"` (`-- prune` removes stale rows; fixable rules reject ledger answers).

## 2. Inspect structural shapes static scans miss

Evaluate in order from largest removal to smallest:

| # | Shape | Resolution |
| --- | --- | --- |
| H1 | **Unused in practice** (option never varies or branch never reached in logs) | Count across logs/receipts; delete if invariant |
| H2 | **Duplicate reader of one fact** | Call the authoritative production fold (`AGENTS.md` section 5, rule 12) |
| H3 | **Guard for an unreachable state** | Cite the upstream refusal/type invariant and hostile test, then delete the guard |
| H4 | **Instance-level patch** | Fix the owning abstraction every path traverses and delete the site patch |
| H5 | **Single-caller helper inside one module** | Inline unless its name clarifies a non-trivial branch |
| H6 | **Fact stated twice in prose** | Keep in the single authoritative owner and cross-reference elsewhere |
| H7 | **Duplicate computation** | Compute once at the common caller and pass forward |
| H8 | **Hand-rolled platform primitive** | Use Bun, `src/meta`, or an existing dependency (`HABITS` 12.8) |

Stop at the first applicable rung of the ladder: (1) missing link in `owner → live reader → decision it changes → evidence → hostile test` (rule 13: delete); (2) handled one layer higher; (3) already implemented in the repo; (4) provided by the runtime; (5) collapses into one expression; (6) minimal implementation in its owner. When removing X, remove its fields, guards, tests, and callers in the same pass.

## 3. Disagreement test, budgets, and report

- **Disagreement test**: a site stays only on **one sentence a reviewer can verify** against a file, test, or log (e.g. `null` for unknown vs `0`, distinct error contracts, a clarifying helper name, or an `AGENTS.md` rule). "A test pins it" or "touches many files" is not a valid reason.
- **Budgets**: a bug fix adds at most ~5 production lines, 1 function, and 0 modules; a simplification nets <=0 production lines; each file adds at most one `src/meta/filesystem.ts` import (`max-filesystem-imports`). Meet size ceilings by reducing branches first, then local closures, then helper functions (never split into a sibling module).
- **Verify and report**: run `measure.py`, `git complexity <base> HEAD`, `bun run runs replay` (for any touched log producer/reader), owning tests, and `bun run commit:check`. Report commit SHA, sites by shape (`removed`, `folded into <owner>`, `kept: <sentence>`, `open: <why>`), before/after complexity metrics, and any pattern recurring at >=3 sites under **For the census**.
