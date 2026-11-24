---
name: simplify
description: "Use before committing source changes (as /simplify) or when asked whether code is simple enough, why a mechanism exists, to move a fix one layer higher, to remove something and find a cleaner alternative, or to audit `not-slop.tsv`. Routes invocations (escalating structural rewrites to `commit-r`), runs deterministic checks and single-command before/after `measure.py`, audits existing ledger answers, evaluates concepts/altitude/upstream primitives and eleven structural shapes (H1–H11), enforces explicit invariants and budgets, and closes with a mandatory hostile full-diff audit."
---

# Simplify

Repository `/simplify` workflow ([reduce-complexity](../reduce-complexity/SKILL.md) owns complexity scripts; [commit-r](../commit-r/SKILL.md) owns compartment rewrites; [stack-pr](../stack-pr/SKILL.md) owns stack placement; `tools/oxlint/HABITS.md` owns lint rules). Work inline without touching another session's PR. Fix any correctness bug uncovered along the way under task authority and report it separately.

## 1. Route the invocation (and escalate early to `commit-r`)

Scope defaults to named arguments (code, worktree, PR, commit, range, paths) or the working diff against the PR's base branch. Match the procedure to the request:

| Request or trigger | Procedure |
| --- | --- |
| `"remove X"` / `"sloppy, find another way"` | Deletion is decided: cut the entire strand (step 5); never return a smaller X or a replacement wrapper |
| `"too sloppy"` / `"rewrite from scratch"` / `"overkill"` | Route directly to [commit-r](../commit-r/SKILL.md) (no separate `/simplify` pass after `commit-r` squash; these shapes inform `commit-r` step 5) |
| `"why do we even need X?"` / `"one layer higher"` | Name the owning abstraction or root cause before editing; revert leaf patches and fix the single layer every path traverses |
| `"is it simple enough?"` / `"what looks most bloated?"` | Read-only verdict first (or rank by concepts a reader must learn from `measure.py` and the census) |
| Bare `/simplify` on own diff or PR | Read the diff as if a colleague wrote it; apply steps 2–6 |

**Self-escalate to `commit-r`** instead of nibbling with local edits whenever: (a) a diff or file carries ≥3 interacting local patches/workarounds, (b) you are simplifying a hand-rolled adapter, rewriter, or implicit state machine, or (c) local cuts leave total concepts or branch count flat because the compartment's boundary itself is wrong. A named external boundary holds (a renamed shim breaks it); if it blocks the only clean cut, say so once and stop.

## 2. Run deterministic checks and audit the ledger first

Never audit manually what static tools already catch, and measure before touching code:

- `bun run lint -- --strict` (`tools/oxlint/HABITS.md` 12.4–12.5, 12.14): fix the site or tune the rule; never add disable comments.
- `bun run simplify -- --gate` (`tools/oxlint/HABITS.md` 12.9): fix or answer every census site (`-- --all`, `-- <kind>`), and check standing registers (`tree/max-filesystem-imports`) plus staged rules (`tools/oxlint/staged-rules.json`) on touched files.
- `bun tools/loc/source-policy.ts`: enforces 800 nonblank lines/file, 115 lines/function, `AGENTS.md` size, import direction, and zero unread exports.
- Measure before editing (and again after with the same `<ref>`):
  ```sh
  python3 .claude/skills/reduce-complexity/scripts/measure.py --base <ref> [-C <worktree>]
  ```
  (Use `.claude/skills/reduce-complexity/scripts/scope.sh <target> -o <diff>` + `measure.py --diff <diff> --base <ref>` for a PR number or commit range.) Read `budget`, `repeats`, ranked function complexity, and `UNUSED`/`one-caller` exports first.
- **Audit `tools/oxlint/not-slop.tsv` on touched files**: run `bun run not-slop -- prune` for stale rows, and challenge every existing answer touching your files or area under step 4's disagreement test — delete and fix any row rationalising convenience or admitting two spellings of one fact.

## 3. Concept map, altitude, and structural shapes (H1–H11)

Before editing, read **outside the diff**: every caller, the module head comment, sibling owners, and `git log origin/main..HEAD -- <files>` (when patching code introduced by an earlier PR in your own stack, fold into that owning PR rather than stacking a compensating layer). Then run three quick probes:

1. **Concept inventory**: list every added or kept concept (types, functions, exports, flags, env knobs, files, branches, fallback paths, prose blocks).
2. **Revert-to-Minimal Probe**: starting from `<base>`, what is the smallest edit that makes every behavioural test pass? Every line beyond that minimal diff must name the failure mode or invariant it prevents.
3. **Upstream / platform check**: before keeping *any* custom rewriter, parser, lock/copy/retry shim, or hardcoded constant wrapping an external tool, CLI, dependency, or OS interface (`uv`, `rsync`, `git`, `ssh`, `bwrap`, `oxlint`, `biome`, Bun, installed packages), check upstream flags, env vars, or exported constants (`--help`, `node_modules`, docs). One native flag beats fifty lines of glue.

Evaluate structural shapes static scans miss, from largest removal to smallest:

| # | Shape | Resolution |
| --- | --- | --- |
| H1 | **Unused or invariant in practice** (option never varies or branch never reached) | Count across callers and archived logs/receipts (`data/runs/`); delete if invariant while preserving historical `EVENT_KINDS` |
| H2 | **Generational accretion** (two generations side by side, incident date-branch, or controller patch for a weak seat) | Delete the superseded stratum or fix the defect at the seat |
| H3 | **Missing upstream or platform primitive** (custom glue where native tool flag/env var, Bun/OS primitive, dependency export, or `src/meta` suffices) | Verify upstream docs/exports and delegate natively (`tools/oxlint/HABITS.md` 12.8); never add a dependency for a few lines |
| H4 | **Instance-level or low-altitude patch** (fixes one trigger/caller while leaving the defect class open) | Revert the leaf edit and fix the single owning abstraction every path traverses |
| H5 | **Prose compensating for fixable code** (prompt warning, skill nudge, or manual flag guarding a trap code can prevent) | Auto-detect, default safely, or make the invalid state unrepresentable in code and delete the prose |
| H6 | **Duplicate reader or scattered implicit state** (second fold of one fact, or coupled booleans / parallel maps / parsed names) | Call the authoritative production fold (`AGENTS.md` §5, rule 12) or collapse into one discriminated union (`tools/oxlint/HABITS.md` 12.14) |
| H7 | **Guard for an unreachable state** (`null` check, `?? []`, or fallback ruled out upstream or by the OS primitive) | Cite the upstream refusal, type invariant, or primitive error and hostile test, then delete the guard |
| H8 | **Wrapper reflex & abstraction laundering** (new helper, wrapper, or sibling module added just to pass a line ceiling or import cap) | Export/call the existing owner directly, inline, or cut branches in the owner so total concepts actually drop |
| H9 | **Redundant I/O, repeated work, or excess transfer/memory** (re-reading files/processes in a loop, loading whole append-only logs, re-scanning unchanged items) | Stream, hoist, or compute once at the common caller and pass forward |
| H10 | **Test & fixture bloat** (copy-pasted example tests, duplicated fixture builders, or implementation-pinning assertions) | Consolidate into bounded exhaustive checks or deterministic LCG properties over observable outcomes (`AGENTS.md` §12, `tools/oxlint/HABITS.md` 12.12; use `commit-r` mutation testing when replacing existing suites) |
| H11 | **Prose & comment bloat** (essay comments restating code, drifted notes, or facts stated twice across docs/skills) | State once in the authoritative owner and cross-reference elsewhere |

**Simplification ladder** (stop at the first rung that holds): (1) broken rule-13 chain (`owner → live reader → decision it changes → evidence → hostile test`: delete); (2) handled one layer higher; (3) already owned in this repository; (4) provided natively by upstream tool, runtime, or dependency; (5) collapses into one expression (`ana/no-arms-differing-in-one-term`, table-driven fold); (6) minimal implementation inside its owner — preferring roughly half the machinery for nearly all of the outcome when both mechanism and outcome are measured.

## 4. Disagreement test, invariants, and budgets

- **Disagreement test**: if you find yourself arguing against simplifying a site, it is probably too complex. A site stays only on **one sentence a reviewer can verify** against a file, test, or log (e.g. `null` for unknown vs `0`, distinct error contracts, a helper name clarifying a non-trivial branch, or an `AGENTS.md` rule by number). `"A test pins it"`, `"touches many files"`, `"just a few lines"`, or `"as X.ts does"` all fail. Record retained scan sites via `bun run not-slop -- answer <id> "<reason>"` (fixable rules reject ledger answers).
- **Must not cut**: (1) wall byte-identity (`AGENTS.md` rule 3; check with `bun .claude/skills/design-and-seats/scripts/seat-view.ts` and wall tests); (2) typed `null` for unknown (never collapse into `0`, `false`, or `""`); (3) historical log `EVENT_KINDS` readability (`AGENTS.md` §5); (4) code owns conditions / models own content (`AGENTS.md` §2) and measurement rules 4, 5, 7, 8; (5) protected paths (`AGENTS.md` §11: `.ana/` except `.ana/wri/`, `data/runs/`, `vendor/`, packs, check programs, kept harnesses).
- **Budgets** (operator-stated budgets replace defaults): a bug fix adds ≤5 production lines, ≤1 new function, and 0 new modules; a pure simplification nets ≤0 production lines; each file adds ≤1 `src/meta/filesystem.ts` import (`tree/max-filesystem-imports`). Meet length ceilings (800 lines/file, 115 lines/function; `measure.py`'s `cx > 21` is an advisory lead) by cutting branches first, then local closures, then helpers — never split into a sibling module (`tools/loc/source-policy.json` stays empty).

## 5. Follow the strand and run the mandatory hostile full-diff audit

- **Follow the entire strand**: when removing X, remove or simplify its fields, guards (H7), callers, tests (re-fixturing tests that pinned unrelated behaviour through X), `not-slop.tsv` rows, and docs in the same pass. Any reader left without a producer becomes the next finding. If X patched an underlying bug, fix the owner (H4) or report it open.
- **Mandatory post-`/simplify` hostile audit (before committing)**: read the **entire resulting `git diff <base>`** top to bottom with fresh eyes — disregarding your pass's own prior justifications — and check five gates:
  1. Did this pass invent *any* new wrapper, helper, flag, or import (H8)?
  2. Does every surviving hunk survive the Revert-to-Minimal Probe and one-sentence Disagreement Test?
  3. Did total concepts, branches, and net production lines actually decrease rather than relocate?
  4. Is any removed strand half-cleaned (orphaned fields, guards, tests, comments, or ledger rows)?
  5. If patch-on-patch layers still remain, stop patching and escalate to `commit-r`.

## 6. Verify, report, and feed the census

- Re-run `measure.py --base <ref>` and `git complexity <base> HEAD`; replay any touched log producer/reader with `bun run runs replay` (label unverified counts as estimates); run owning `bun run test -- <paths>`, `bun run commit:check`, and `bun run gate` before delivery.
- **Report**: lead with one sentence on what got simpler and the commit SHA. Follow with: (1) sites grouped by shape, largest first (`removed`, `folded into <owner>`, `kept: <verifiable sentence>`, `open: <why>` — or `"already the smallest honest form"`, naming the closest site); (2) before/after `measure.py` budget and `git complexity` rows; (3) `not-slop.tsv` audit result plus replay and test counts; (4) **For the census** (`none`, or any manual pattern recurring at ≥3 sites that a lint catcher or `tree/` scan can detect automatically — starting report-only in `tools/oxlint/staged-rules.json` and graduating to `.oxlintrc.json` only at zero sites).
