---
name: mutation-testing
description: "Use when running or reading nightly mutation passes, confirming surviving mutants on the fleet, triaging survivors into real defects vs unpinned invariants vs equivalents, closing high-importance test gaps with space/table checks, or running the step-8 mutation oracle for commit-r. Owns scripts/mutate.ts and scripts/nightly.ts."
---

# Mutation Testing

Mechanical mutation oracle for high-importance Anabasis owners, grounded in `AGENTS.md` (Approach 1–4, §8 rules 12–13, §9 evidence rungs, §12 test-shape hierarchy) and `tools/oxlint/HABITS.md` §12.12. Pairs syntactic mutations (`scripts/mutate.ts`) and incremental nightly sweeps (`scripts/nightly.ts`) with a simplify-first triage funnel so real defects are fixed structurally, unneeded production code is deleted rather than defended, and remaining invariants are closed through live end-to-end or space/table checks rather than isolated unit tests.

## How this skill connects to `AGENTS.md` and sibling skills

- **`AGENTS.md` Approach 2–3 & [`simplify`](../simplify/SKILL.md):** Fix owners structurally upstream and subtract before adding. Every non-error survivor is audited first against `simplify`'s concepts, altitude, upstream primitives, and shapes (`H1`–`H11`). Delete redundant guards, duplicate lookups, dead fallbacks, and unused flags before considering a test.
- **`AGENTS.md` §12, `tools/oxlint/HABITS.md` §12.12 & [`commit-r`](../commit-r/SKILL.md):** Follow [`commit-r/references/testing-protocol.md`](../commit-r/references/testing-protocol.md) for surface-importance triage: protect high-importance owners (measurement, Factor 1–4 folds, Rule 3 walls, `decide`/admission/stop rules, verifier/audit/sandbox/lock boundaries) and write **no** unit tests for low-importance or presentation surfaces. `commit-r` invokes this oracle at step 8 whenever amputating, shrinking, or replacing tests on a high-importance owner.
- **[`reduce-complexity`](../reduce-complexity/SKILL.md):** Measure before/after complexity (`git complexity`, branching density, import coupling) when simplifying production code or splitting presentation prose out of decision owners.
- **[`promotion-tuner`](../promotion-tuner/SKILL.md) (`AGENTS.md` Approach 4):** Replay rule/guard changes over `data/runs/` and inspect callers before deleting a surviving guard to confirm reachability and zero false positives.
- **[`system-path-simulation`](../system-path-simulation/SKILL.md):** Syntactic mutants catch boundary and logic gaps, never omitted requirements or cross-file semantic drift. Pair mutation sweeps with model-free rehearsals, replays, and Rule 3 perturbation walls.
- **[`repository-practice`](../repository-practice/SKILL.md) & [`local-checks`](../local-checks/SKILL.md):** Report findings using §9 exact denominators and evidence rungs (`proved without a model`, not "done"). Sweeps run locally and on the fleet, never in GitHub Actions.

## Commands

```sh
bun .claude/skills/mutation-testing/scripts/mutate.ts list <copy> <files...>
bun .claude/skills/mutation-testing/scripts/mutate.ts run <copy> <files...> --out <scratch>/kills.jsonl --suites <suites.json> [--fleet] --stop-at-kill --timeout 120
bun .claude/skills/mutation-testing/scripts/mutate.ts report <scratch>/kills.jsonl [--old old] [--survivors]
bun .claude/skills/mutation-testing/scripts/nightly.ts <tree> --state <dir> [--until HH:MM] [--timeout s] [--diff <base>] [--full]
```

## Four-stage survivor triage funnel (nightly & hardening passes)

Never chase raw survivor counts with isolated unit tests or synthetic event snippets. Work in order, drawing on `AGENTS.md` §12 and industrial mutation practice (Petrović & Ivanković / Google ICSE 2018 & TSE 2021; Meta ACH FSE 2025; Just et al. FSE 2014):

1. **Verify suite coverage first (separate measurement artefacts from real gaps).**
   `nightly.ts` selects tests via `tools/runtime/gate.ts`'s `within` primitive (direct importers in diff mode, with transitive fallback only when no direct test exists; full runtime-transitive imports in `--full` mode, dropping `import type` and `export type` edges) plus non-import string-literal path mentions, direct importers first, then fastest-first by `test/.test-timings.json` (then file size); each suite runs as its own `bun test --bail`, in that order, until one kills the mutant. When triaging an older pass whose suite list missed transitive importers, confirm survivors against the missed suites first (`--only <ids> --stop-at-kill`) before editing code or tests. Prioritise **diff-scoped / new survivors** (`report.md` against `done.json`, or `git diff --name-only <base> -- src tools`) over historical sweeps to keep signal high.
2. **Cluster confirmed survivors by subsuming invariant — fix or simplify production code before adding tests.**
   Inspect each surviving expression inside its full enclosing function, callers, and existing suites (Meta ACH showed deterministic context pre-processing lifts equivalent-mutant filtering from 0.79/0.47 to 0.95/0.96 precision/recall). Always ask *why* the branch survived before touching any test: often the production code is wrong, redundant, or does not earn its keep (`AGENTS.md` §8 rules 12–13). Classify each cluster strictly in order:
   - **Live defect or inert test:** production code is wrong today, or an existing test's fixture accidentally short-circuits before reaching the branch it claims to pin (for example, failing an earlier validation gate). Fix the owning module structurally upstream (`AGENTS.md` Approach 2) or fix the existing fixture directly rather than adding a second test.
   - **Unneeded or over-defensive production surface:** dead guard, duplicate lookup/loop, unreachable fallback, redundant flag, or incidental branch no caller relies on. Delete or simplify the production code via [`simplify`](../simplify/SKILL.md) (or [`commit-r`](../commit-r/SKILL.md) for a compartment rewrite, checking [`promotion-tuner`](../promotion-tuner/SKILL.md) archive reachability where a rule changes) rather than writing a test to defend code that should not exist.
   - **Unpinned high-importance invariant:** truly load-bearing logic on measurement, Factor 1–4 folds, Rule 3 walls, `decide`/admission/stop rules, security/path boundaries, or refusals. Close the **subsuming invariant** for the whole cluster following `AGENTS.md` §12 and [`commit-r/references/testing-protocol.md`](../commit-r/references/testing-protocol.md) in order:
     1. **Space, property, wall, and table checks (`AGENTS.md` §12 ranks 1–3):** bounded exhaustive checks against an independent rule (`≤~10s`), state-space search over reachable logs, seeded LCG generators, shared perturbation walls, or pure invariant/view-model tables.
     2. **Boundary and integration checks through live end-to-end flows (`AGENTS.md` §12 rank 4):** for process/file/provider/OS-wall boundaries, nearest hostile refusals, or real-run regressions, fold the case into an existing live lifecycle entry point (`harnessBuilder`, `examine`, `revisionRunner`, `openSuccessor`, `runs` commands) by adjusting a real fixture input or step rather than adding isolated helper calls, synthetic event snippets, or fake stubs.
     3. **Narrow unit tests only as a last resort:** only where neither space/table checks nor live end-to-end entry points can feasibly reach the boundary. Never add module mocks, fixed sleeps, or test-only exports (`HABITS.md` §12.12).
   - **Arid, low-importance, or presentation surface:** logging calls (suppressed in `mutate.ts`), CLI wording, formatting, advisory notes, or incidental low-value branches. Write **no** test ([`commit-r/references/testing-protocol.md`](../commit-r/references/testing-protocol.md)).
   - **Proved equivalent mutant:** identical observable behaviour on all reachable inputs. Retire with a one-line proof in the commit/PR body and write **no** test. Common deterministic equivalence classes:
     - strict vs non-strict comparison (`<` vs `<=`, `>` vs `>=`) between distinct log event kinds that can never share an index;
     - negative-sentinel shifts (`-1 -> -2`) compared against non-negative array or log indices;
     - redundant defensive guards already guaranteed by an earlier invariant or callee (`isContextOverflow`, empty-set no-ops, unreachable `null` fallbacks — prefer deleting via `simplify` if clean);
     - algebraic/monotonicity equivalences (verify with a quick bounded script when non-obvious).
3. **Prove every kill against the oracle (zero inert tests).**
   Run `mutate.ts run --only <target-ids> --stop-at-kill` against the edited suites (`ANA_CHECK_HOST=here --jobs N` locally for fast targeted checks; `nightly.ts` writes `survivors.diff-<base>.ids.txt` / `survivors.ids.txt` beside `report.md`, which lists each new survivor with its source line). Verify **per targeted line** that every intended mutant flips from `survived` to `killed` with zero `unread` rows: a mutant still surviving on a line you edited a test for proves the test is inert (fix the fixture so it reaches the branch, or delete the test). Then run `bun fmt`, `bun run typecheck`, `bun run lint -- --strict`, `bun tools/loc/source-policy.ts`, and `bun run simplify -- --gate` ([`repository-practice`](../repository-practice/SKILL.md)).
4. **Track yield and respect oracle limits (`AGENTS.md` §9).**
   Report exact denominators in the commit/PR: survivors read, indirect kills removed, live defects fixed, production simplifications/deletions landed, real invariant gaps closed (noting end-to-end vs space/table vs boundary), equivalents retired, and simplification leads queued. Pair with [`system-path-simulation`](../system-path-simulation/SKILL.md), Rule 3 perturbation walls, and [`promotion-tuner`](../promotion-tuner/SKILL.md) replays to cover semantic properties beyond first-order syntactic mutants.

## Routing non-error survivors to `simplify`, `commit-r`, and `reduce-complexity`

A surviving mutant that is **not** a bug and **not** worth a new test is often a structural simplification signal (`AGENTS.md` Approach 3, §8 rule 13). Before retiring a non-error cluster, check whether deleting or restructuring production code beats leaving it behind:

| Non-error survivor pattern | What it signals | Route to |
| --- | --- | --- |
| Redundant defensive guard (`A \|\| B` where `B` already holds whenever `A` holds, or callee already checks `A`) | Unneeded branch or double validation across a seam (`simplify` H1–H11) | [`simplify`](../simplify/SKILL.md) (delete redundant guard; make invariant unrepresentable) |
| Unreachable fallback (`?? default` that never triggers on reachable states) | Dead code or over-wide return type | [`simplify`](../simplify/SKILL.md) (narrow type, remove dead fallback) |
| High arid-mutant density inside a high-importance owner (prose, advisory notes, CLI formatting mixed into decision folds) | Presentation entangled with decision logic | [`commit-r`](../commit-r/SKILL.md) / [`reduce-complexity`](../reduce-complexity/SKILL.md) (split pure decision fold from presentation surface so high-importance owners stay small and high-signal) |
| Surviving `swap rows` in a decision table | Either an unpinned precedence invariant or disjoint rows with hidden coupling | Inspect reachability via [`promotion-tuner`](../promotion-tuner/SKILL.md) / callers first; pin precedence if order matters, else simplify |

Never delete a guard solely to raise kill rate — verify reachability across `data/runs/` and callers first (`AGENTS.md` §9, §12). Record confirmed simplification leads alongside retired equivalents so subsequent [`simplify`](../simplify/SKILL.md) or [`commit-r`](../commit-r/SKILL.md) passes pick them up cleanly.

## Rewrite-time oracle (`commit-r` step 8)

When deleting, shrinking, or replacing tests on a high-importance owner in [`commit-r`](../commit-r/SKILL.md):

- **Comparative mode (`--old`, Test pass or interface-preserving Rewrite):** run `old`, `new`, and `kept` suites on `<copy>` with old tests restored. Classify every `O-` survivor as either a genuine invariant/boundary gap (close with a bounded/property check; never paste back old example boilerplate) or intentionally retired incidental wording/convenience (record in the commit message). **Leaving >15% of `O-` survivors unexplained or any `unread` row halts the pass** (`report --survivors` prints unread IDs after survivors for `--only` reruns).
- **Solo mode (interface-changing Rewrite):** never mix incompatible `old` and `new` suites on one copy. Run `mutate.ts` against `new` + `kept` (`report` without `--old`), inspect `--survivors`, and close surviving decision, wall, or refusal branches.
- **Skip** on pure low-importance amputations; verify surviving boundary tests, `bun run gate`, and real-input oracle/replay instead.

## Mutation rot (high to low risk)

Mutants rot as code, callers, and test fixtures evolve. Check rot risk in order before trusting a zero-survivor result:

- **High — moved code & stale `--only` IDs:** mutant IDs encode `<file>:<byteOffset>:<label>`. Any edit above a recorded survivor shifts byte offsets so saved `survivors*.ids.txt` entries silently match nothing (`mutate.ts` prints a `stale --only IDs` warning on `stderr` when requested IDs miss). Never treat `0 mutants run` on a stale ID list as proof a fix worked—re-run against the current tree and confirm each targeted line flips from `survived` to `killed`.
- **Medium — fixture-blind tests & stale diff baselines:** a test whose fixture omits a relevant input variant (or only exercises a happy path) leaves mutants alive on lines that appear covered, and incremental diff-hunk runs do not re-test unchanged lines when a callee or shared fixture changes. Re-run the whole touched owner (or `--full`) after refactors or fixture rewrites.
- **Low — retired equivalents & arid blocks:** a mutant proved equivalent under an earlier invariant can become observable once that invariant is relaxed; revisit retired equivalents whenever the enclosing owner changes.

## Execution & clone hygiene

- **Host routing & execution:** `mutate.ts` deals mutants over the check places with `spread` (`checkPlaces`, or `fleetPlaces` under `--fleet`, plus `--local N` slots here when the others are routed; `tools/runs/host-config.ts`). Each worker owns a copy of the tree (`<out>.clone-<k>` or `--clones <prefix>`) holding what git does not ignore, its `.git` pointing at the tree's own, with `node_modules` linked only where it runs here; routed workers hand their copy to the check router, which ships it as one commit. Each place first runs every suite unmutated across its copies: a suite that fails there reads `null` for every mutant there (`<place> skips it`), and a place where none passes takes no mutants; a suite run here whose tests and test helpers start no process also records its LCOV, and reads `false` without running for a mutant on a line it loads but never runs. A mutant then runs its other suites in order, one `bun test --bail` each, stopping at the first kill under `--stop-at-kill`, each bounded by `min(--timeout, 30 s + 10× its unmutated time)`; a hang or a run without a pass, fail or bail count records `null` (`unread` whenever no suite kills the mutant). A place giving no verdict hands its mutant back and takes no more. Unrun mutants stay unrecorded so rerunning the same command resumes cleanly.
- **Incremental diff nightly mode & weekly full sweep:** after an initial complete `OWNERS` pass writes `done.json`, `nightly.ts` defaults to **diff mode** (`addedLines` in `src/meta/git.ts`): it mutates only mutants whose start line falls on a line gained in any production file under `src/` and `tools/` since the previous complete pass (falling back to `merge-base(origin/main, HEAD)` when the stored commit is no longer an ancestor after a rebase or new stack, or using `--diff <base>` verbatim; pure deletions produce no mutants), writing `<slug>.diff-<base>.jsonl` against direct importers and path mentions (transitive importers, then directory mentions, only when none exists). `--full` (Sundays; the scheduler re-passes `--full` if a full pass hits `--until`) sweeps all high-importance `OWNERS` with full transitive suites and compares survivors against the prior full pass. Both run in-process through `runMutants` with `--fleet`, local slots for half the cores and `--stop-at-kill`. Once a pass completes with zero `unread` rows, `done.json` advances so survivors are reported once in `<commit>/report.md` rather than re-alerting unchanged lines; exit code 3 signals survivors, `unread` rows, untested changed files, or an unfinished pass. Scheduling and stack selection stay outside the repository; CI never runs it.
- **Oracle copy hygiene:** initialise `<copy>` as a git repo (`git init` + commit) when tests exercise git or `treeFault` guards; lower multi-minute `setDefaultTimeout` values on `<copy>` (e.g. `600_000` → `60_000`) so deadlocking mutants fail on the per-test timeout rather than recording `unread` at `--timeout`; size `--timeout` above each suite's loaded duration. For filesystem-mutating code, use a `cp -cRp` copy-on-write clone with retargeted symlinks/gitdirs.
