# 12. Code that passes the first time, and 13. Writing

Read this reference for the rationale behind `AGENTS.md` sections 12 and 13; `scripts/preflight.ts`
reports the file-size and prose patterns that can be checked statically.

## 12. Code that passes the first time

`tools/oxlint/HABITS.md` documents the repository's coding conventions, `src/meta` owners, size
policy, and test design; changes that do not touch code may skip it.

- Never disable a lint rule: add no new `"off"` entries to `.oxlintrc.json` and no `oxlint-disable`
  directives for plugin rules. Record a genuine false positive in the findings ledger, or tune the
  rule in a dedicated linting change.
- Dependencies run strictly one way so production code remains self-contained without auxiliary
  tooling. Production comprises `src/`, `vendor/`, `packages/`, and `tools/` outside `tools/wri/`
  — this is the battle-tested tier covered by strict runtime invariants and mutation testing
  (`src/` and `tools/campaign/` via `.claude/skills/mutation-testing/scripts/nightly.ts`). Any
  primitive or fact that production requires (such as `repoRoot` in `src/meta/git.ts` or
  `familySizes` in `src/kernel/history.ts`) must live in or graduate up to a production owner
  rather than staying in a helper library.
- Helper code belongs in one of three locations (`tools/wri/`, `.claude/skills/main/`, or a skill's
  `scripts/` directory), distinguished by caller (`AGENTS.md`, section 12, "Readers/helpers").
  `.claude/skills/main/` holds strictly non-production skill and reporting glue shared across two
  or more skills (CLI parsing, Markdown/TSV tables, log discovery and clock folds, cross-run
  archive folds, permutation stats) so skill churn stays out of `src/`. Before writing a new
  helper, search `src/meta/`, `main/`, and `tools/wri/folds.ts`; `tools/loc/source-policy.ts`
  enforces that `.claude/skills/main/` imports only production code and sibling `main/` modules
  (never other `.claude/` paths, `tools/wri/`, `studies/`, or `test/`). No `bun run` verb
  lives inside a skill's `scripts/`, scripts executed by automated jobs only format what production
  computes, and an additional view of an existing fold becomes a view on its owner. When a helper
  gains a caller in a second skill, move it to `main/` instead of duplicating it; when production
  also needs it, graduate it to `src/meta/` or the owning `src/` fold.
- Tests assert the concrete facts a message conveys (outcomes, counts, limits) and verify wall
  exclusions by their absence, allowing prose wording to evolve freely. When a prompt sentence
  itself is under test, assert against the composed prompt directly.
- Match test style to code: bounded exhaustive checks (`test/compare-exhaustive.test.ts`),
  state-space exploration (`test/decide-explore.test.ts`), or seeded property tests
  (`test/pairs-property.test.ts`) for pure kernel/decision logic; clear regression tests for
  real-run bugs, boundaries, and hostile refusals. Pin measured constants (`WEIGHTS`, `GAP_FLOOR`,
  `SIZE`, `PATIENCE`) once. Check mechanical mutants before deleting or replacing tests (`commit-r`
  step 8). Keep bounded checks ≤~10s via symmetry, verify full-change exit codes directly (never
  masked by pipes), and treat missing-userns wall failures as real failures.

## 13. Writing

Write clearly and concisely: state the question, the mechanism, and the empirical evidence with its
limitations (`AGENTS.md`, section 13).

- State general principles, current behaviour, and rationale instead of chronological narratives
  ("at X moment Y happened, so we did Z"). Keep timeline history in commits, pull requests,
  backlog notes, or measurement logs.
- Prefer direct contrasts ("one owner instead of five") over negations; infrastructure changes state
  what they enable without implying an empirical gain.
- Keep single simulations, live observations, and cost estimates distinct. Preserve counts,
  baselines, and stated limits when revising text, and attribute check results to their commit and
  runner.
- Omit authorship labels and boilerplate closing claims; `stack-pr` section 7 governs pull request
  descriptions.
- A file's head comment serves as the module manual: it states why the code is structured as it is,
  the defect or design requirement it addresses, and any empirical measurement, updated when the
  code changes.
- Keep each prompt fact on a single surface (system prompt, opening message, or tool result) so
  surfaces do not drift apart.
