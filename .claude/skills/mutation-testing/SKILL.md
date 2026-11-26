---
name: mutation-testing
description: "Use when running or reading nightly mutation passes, confirming surviving mutants on the fleet, triaging survivors into real defects vs unpinned invariants vs equivalents, closing high-importance test gaps with space/table checks, or running the step-8 mutation oracle for commit-r. Owns scripts/mutate.ts and scripts/nightly.ts."
---

# Mutation Testing

Mechanical mutation oracle for high-importance Anabasis owners (`AGENTS.md` §12). Pairs syntactic mutations (`scripts/mutate.ts`) and incremental nightly sweeps (`scripts/nightly.ts`) with a four-stage triage funnel so test coverage rises on real invariants without example-test bloat.

Tightly linked to [`commit-r`](../commit-r/SKILL.md) (which invokes this oracle at step 8 whenever rewriting or replacing tests on high-importance owners), [`reduce-complexity`](../reduce-complexity/SKILL.md), and [`local-checks`](../local-checks/SKILL.md).

## Commands

```sh
bun .claude/skills/mutation-testing/scripts/mutate.ts list <copy> <files...>
bun .claude/skills/mutation-testing/scripts/mutate.ts run <copy> <files...> --out <scratch>/kills.jsonl --suites <suites.json> [--fleet] --stop-at-kill --timeout 120
bun .claude/skills/mutation-testing/scripts/mutate.ts report <scratch>/kills.jsonl [--old old] [--survivors]
bun .claude/skills/mutation-testing/scripts/nightly.ts <tree> --state <dir> [--until HH:MM] [--timeout s] [--full]
```

## Four-stage survivor triage funnel (nightly & hardening passes)

Never chase raw survivor counts with one example test per mutant. Work in order, drawing on proven industrial mutation practice (Petrović & Ivanković / Google ICSE 2018 & TSE 2021; Meta ACH FSE 2025; Just et al. FSE 2014):

1. **Verify suite coverage first (separate measurement artefacts from real gaps).**
   `nightly.ts` selects the five `BOUNDED` suites plus every test reaching the owner via runtime imports (`import` / `export ... from` / `import()`, dropping `import type` and `export type` edges) or non-import string-literal path mentions, ordered fastest-first by `test/.test-timings.json` (then file size) without mixing units. When triaging an older pass whose suite list missed transitive importers, confirm survivors against the missed suites first (`--only <ids> --stop-at-kill`) before editing tests. Prioritise **diff-scoped / new survivors** (`report.md` against `done.json`, or `git diff --name-only <base> -- src`) over historical sweeps to keep signal high and avoid alert fatigue.
2. **Cluster confirmed survivors by subsuming invariant and classify cleanly.**
   Inspect each surviving expression inside its full enclosing function and callers (Meta ACH showed deterministic context pre-processing lifts equivalent-mutant filtering from 0.79/0.47 to 0.95/0.96 precision/recall), and inspect any existing test covering that function first. Classify each cluster into one of four buckets:
   - **Live defect or inert test** (production code wrong today, or an existing regression test whose fixture accidentally bypasses the branch it claims to pin): fix the owning code or existing test directly rather than adding a duplicate.
   - **Unpinned high-importance invariant** (code right today, silent regression risk on measurement, Factor 1–4 folds, Rule 3 walls, `decide`/admission/stop rules, or refusals): target the **subsuming invariant** for the cluster and close it with **one** compact space, table, or property check in the owning suite (`AGENTS.md` §12), killing the whole cluster at once rather than writing one example per mutant.
   - **Arid / presentation surface** (Google's arid-node principle: logging calls—suppressed directly in `mutate.ts`—plus compound blocks/functions that only format prose, CLI output, or advisory notes): write **no** test ([`commit-r/references/testing-protocol.md`](../commit-r/references/testing-protocol.md)).
   - **Proved equivalent mutant** (identical observable behaviour on all reachable inputs): retire with a one-line proof in the PR/commit body and write **no** test. Common deterministic equivalence classes here:
     - strict vs non-strict comparison (`<` vs `<=`, `>` vs `>=`) between distinct log event kinds that can never share an index;
     - negative-sentinel shifts (`-1 -> -2`) compared against non-negative array or log indices;
     - redundant defensive guards already guaranteed by an earlier invariant or callee (`isContextOverflow`, empty-set no-ops, unreachable `null` fallbacks);
     - algebraic/monotonicity equivalences (verify with a quick bounded script when non-obvious).
3. **Prove every kill against the oracle.**
   Run `mutate.ts run --only <target-ids> --stop-at-kill` against the edited suites (`ANA_CHECK_HOST=here --jobs N` locally for fast targeted checks), verifying every genuine gap flips from survived to killed with zero `unread` rows, followed by `bun fmt`, `bun run typecheck`, `bun run lint -- --strict`, `bun tools/loc/source-policy.ts`, and `bun run simplify -- --gate`.
4. **Track yield and respect oracle limits.**
   Report exact denominators in the commit/PR: survivors read, indirect kills removed, real invariant gaps closed, live defects or inert tests uncovered, equivalents retired, and simplification leads surfaced. Remember that first-order syntactic mutants catch boundary and logic gaps well, but never catch omitted requirements or cross-file semantic defects—pair this skill with [`system-path-simulation`](../system-path-simulation/SKILL.md), Rule 3 perturbation walls, and [`promotion-tuner`](../promotion-tuner/SKILL.md) archive replays.

## Routing non-error survivors to `simplify` and `commit-r`

A surviving mutant that is **not** a bug and **not** worth a new test is often a structural optimisation signal rather than waste. Before retiring a non-error cluster, check whether deleting or restructuring production code beats leaving it behind:

| Non-error survivor pattern | What it signals | Route to |
| --- | --- | --- |
| Redundant defensive guard (`A \|\| B` where `B` already holds whenever `A` holds, or callee already checks `A`) | Unneeded branch or double validation across a seam | [`simplify`](../simplify/SKILL.md) (delete redundant guard; make invariant unrepresentable) |
| Unreachable fallback (`?? default` that never triggers on reachable states) | Dead code or over-wide return type | [`simplify`](../simplify/SKILL.md) (narrow type, remove dead fallback) |
| High arid-mutant density inside a high-importance owner (prose, advisory notes, CLI formatting mixed into decision folds) | Presentation entangled with decision logic | [`commit-r`](../commit-r/SKILL.md) / [`reduce-complexity`](../reduce-complexity/SKILL.md) (split pure decision fold from presentation surface so high-importance owners stay small and high-signal) |
| Surviving `swap rows` in a decision table | Either an unpinned precedence invariant or disjoint rows with hidden coupling | Inspect reachability first; pin precedence if order matters, else simplify |

Never delete a guard solely to raise kill rate—verify reachability across `data/runs/` and callers first (`AGENTS.md` §9, §12). Record confirmed simplification leads alongside retired equivalents so subsequent `simplify` or `commit-r` passes pick them up cleanly.

## Rewrite-time oracle (`commit-r` step 8)

When deleting, shrinking, or replacing tests on a high-importance owner in [`commit-r`](../commit-r/SKILL.md):

- **Comparative mode (`--old`, Test pass or interface-preserving Rewrite):** run `old`, `new`, and `kept` suites on `<copy>` with old tests restored. Classify every `O-` survivor as either a genuine invariant/boundary gap (close with a bounded/property check; never paste back old example boilerplate) or intentionally retired incidental wording/convenience (record in the commit message). **Leaving >15% of `O-` survivors unexplained or any `unread` row halts the pass** (`report --survivors` prints unread IDs after survivors for `--only` reruns).
- **Solo mode (interface-changing Rewrite):** never mix incompatible `old` and `new` suites on one copy. Run `mutate.ts` against `new` + `kept` (`report` without `--old`), inspect `--survivors`, and close surviving decision, wall, or refusal branches.
- **Skip** on pure low-importance amputations; verify surviving boundary tests, `bun run gate`, and real-input oracle/replay instead.

## Execution & clone hygiene

- **Host routing:** `mutate.ts` spreads mutants over check hosts via `checkPlaces` (`tools/runs/host-config.ts`), one worker per host slot, each suite run with `--timeout` as its deadline; any set `ANA_CHECK_HOST` keeps runs to that one place (`here` for this machine; pass `--jobs` around a third of local cores), unless `--fleet` spreads across every listed host regardless (`fleetPlaces`; `nightly.ts` always passes `--fleet`). Each place must pass every baseline suite unmutated or takes no mutants; a place giving no verdict hands its mutant back and takes no more. Unrun mutants stay unrecorded so rerunning the same command resumes cleanly.
- **Incremental nightly carry-forward:** after a complete pass writes `done.json`, `nightly.ts` reruns only owners whose own file, matched suites, saved `.suites.json` membership, or transitive dependencies changed (`--full` forces all owners; `--until HH:MM` stops cleanly and exits 3 to resume next run). `report.md` beside the JSONL files lists per-owner counts and new survivors since `done.json`; exit code 3 signals new survivors or an unfinished pass. Scheduling and stack selection stay outside the repository; CI never runs it.
- **Oracle copy hygiene:** initialise `<copy>` as a git repo (`git init` + commit) when tests exercise git or `treeFault` guards; lower multi-minute `setDefaultTimeout` values on `<copy>` (e.g. `600_000` → `60_000`) so deadlocking mutants fail on the per-test timeout rather than recording `unread` at `--timeout`; size `--timeout` above each suite's loaded duration. For filesystem-mutating code, use a `cp -cRp` copy-on-write clone with retargeted symlinks/gitdirs.
