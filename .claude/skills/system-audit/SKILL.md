---
name: system-audit
description: "Evaluate Anabasis as a whole using independent read-only sessions, each examining one subsystem through a single analytical lens (flaws proved from counted events in recent campaigns, first-principles rethink before reading code, deletion of unused machinery, fault tolerance, or factor alignment). Claims name their evaluation pillar and are triaged by the v1.0 requirement they block; a challenge session attempts to refute them, the primary session vets each claim, and confirmed findings become assumed repairs for subsequent rounds, applied only with operator authorisation through stack-pr, commit-r, and simplify. Use when asked for fundamental flaws, an independent or full-system audit, fresh eyes, a redesign, deletion candidates, resilience gaps, or a follow-up round assuming prior findings are fixed. Single-campaign analysis belongs to whole-run-investigation, single-diff review to code-review, and kept-harness review to harness-audit."
---

# System audit

A system audit evaluates Anabasis as a whole at a single pinned commit: given the core experimental
question in `AGENTS.md` section 1, what should be redesigned, simplified, or repaired? Independent
read-only sessions each inspect one subsystem through one lens; an independent challenge session
attempts to refute their claims; and the primary session vets every claim before any code changes.

Everything is open to challenge except measurement honesty (the sandbox wall and rules 3 to 8),
which a proposal may touch only with proof that the honesty invariant still holds. Every other
mechanism, prompt, default, reader, skill, or rule in `AGENTS.md` may be merged or deleted, and
earns its keep only while its rule 13 chain holds. Historical notes in head comments record lessons
to preserve or retire, never standalone justification for retaining machinery. The audit itself is
strictly read-only, and its proposals sit at the "Planned" rung: only a fresh campaign proves an
improvement.

## The pillars and the v1.0 bar

Every claim identifies the evaluation pillar it affects: the four factors in `AGENTS.md` section 1,
the sandbox wall, and three release-level criteria (grounding, systems comparison, and external
benchmark transfer). The table below is the authoritative owner of each row's requirement,
threshold, reader, and decision role; `docs/plan.md` ("The v1.0 bar, now") tracks current values and
evidence rungs, and `docs/backlog/v1-bar.md` holds the rationale and historical record behind each
proposed threshold. Thresholds are set by the operator; entries marked "(proposed)" are not yet
fixed, and no model seat is ever told a threshold.

| row | v1.0 requires | threshold | status printed by | decides |
| --- | --- | --- | --- | --- |
| wall | every wall test passes on macOS and Linux at the top; no measured solve ran unwalled | no failure; 0 `sandbox-crash` in the measured campaigns | `bun run gate` on each system; `sandbox-crash` in the closing report | whether any reading can be trusted |
| supply | every comparison after set-up scores enough untied tasks to read a step; validity can decide a step, so the reference is not valid in every scored solve; and, once per domain, the exam separates solvers: the stronger and weaker solvers in the Starter on its opening tasks | 6 untied tasks (the fewest that clear at 0.02); at least one of the measured campaign's steps won on validity, otherwise the release notes that its climb was read on the objective alone; the stronger solver ahead of the weaker one beyond the A/A spread (both proposed) | `comparison-reading/scripts/reading.ts --zone <log>`; `promotion-tuner/scripts/table.ts --rows runs`, "room on validity" and "steps won on validity"; `compare-systems/scripts/systems.ts` for the solvers | whether the next work belongs to the Examiner or the Builder, and whether the exam measures the domain rather than its format |
| climb | confirmed promotions (`confirmed`, `src/campaign/climb.ts`) in one measured campaign (`AGENTS.md`, section 10, item 9) whose budget can hold them, in jobstat and then in a second domain on which no change was tuned, opened from its prompt unedited; each also evaluated on tasks written after the promotion alone, alongside the confirmations selection alone would expect | 6 per domain (operator threshold), to be revisited against the outside row's transfer reading; among them, more read a step for the reference on newly written tasks alone than for the starter; the second domain cold, with buffer kept as the control (all proposed) | `barLines` (`bun run runs view <name>`); `comparison-reading/scripts/starter-reads.ts` ("sign draws", "alone"); `table.ts --rows cost` for the budget | whether a promotion generalises beyond its selection tasks and its domain's tuning |
| honesty | A/A steps at most the design rate across the release's measured campaigns, counting only A/As statistically able to read a step, reported separately where validity decided and where the objective alone did; where a reference ties its own A/A on every task, the starter against itself in that campaign's starter comparisons counts in its place; the ten A/As after a sixth promotion are reported | 1.1% at 0.02 (`falseRate`) over at least 50 able A/As, on each slice (proposed) | `barLines` ("Honesty", "Starter against itself"); `table.ts --rows runs`, "A/A steps, of A/A able to read one"; nothing splits the slices yet | whether the significance level is too loose for the noise floor |
| verdicts | blind labels pooled across campaigns: rejections drawn from comparisons, 3 in 4 check defects caught and at most 1 in 10 earned rejections voided, reporting PABAK alongside kappa; plus passes sampled (`PASS_LABELS`, `src/campaign/comparison.ts`) from measured campaign references, so checks passing wrong answers are caught alongside checks refusing right ones. A domain whose comparisons contain no rejections reports that count | 30 rejections with at least 8 defects; at least 20 passes with at most 1 in 10 labelled wrong (both proposed) | `tools/d2/settle.ts` (`clears`, `src/referee/agreement.ts`); nothing pools yet, and `agreement` counts no pass labels | whether a Referee ruling can substitute for human labelling, and whether a pass implies a valid answer |
| grounding | one domain whose exam invokes the field's installed reference engine, so no check requires `--admit-authored` (rule 10) | 0 author-computed checks in that domain's measured campaign | the closing report's "What decides a pass" (`unadmitted`, `tools/d2/close.ts`); `tools/c/accept.ts` | whether a pass means the domain's pinned tool agrees |
| economy | on a single meter: dollars and active hours per promotion and per confirmed promotion, attempts per epoch against 3, and serving cost for N tasks (build cost plus N times dollars per solve, `studies/harness2/README.md`) compared against the Starter | 3 attempts, reported; reference dollars per solve at most the Starter's beyond the spread of the Starter's own rollouts (proposed); any absolute dollar target is the operator's | `tools/d2/close.ts`, `barLines`; `promotion-tuner/scripts/table.ts --rows cost`; externally, `studies/harness2/score.ts table` ("system", "build", "solve") | what a gain costs to build and to serve |
| systems | a cheaper solver in a built harness against a dearer solver in the starter, on the campaign's held-out tasks, with claim and margin fixed before the first solve (`compare-systems`); alongside the built harness against `programs-of:<digest>` to attribute the gain to guide versus programs | in v1.0 (proposed); solvers, margin, and solve count are the operator's | `compare-systems/scripts/systems.ts`; a comparison against `programs-of:<digest>` | whether a harness enables a cheaper model to match a dearer bare solver, and which component carries the effect |
| outside | the measured jobstat campaign's confirmed references, built blind to JobBench, evaluated under JobBench's own judge where their programs run, alongside a Starter from the same sitting: above the Starter, then level with Harness²'s held-out arm, then above it (operator progression, `AGENTS.md`, section 10). The noise margin is the Starter's rollout spread, and no column is compared before six rows hold a score (`run-improvement-campaign`, "The outside aim"). Claims are evaluated on a pre-registered set unsteered by prior reads (`jobbench-scoring.md`, item 22). Alongside the Starter, include a one-pass author baseline: one session of the Builder's model writing a harness from the same query and Starter Pack with no exam, practice, or comparison, exported identically. Each evaluation reports per-arm rollout spread, worst-task score, and out-of-scope benchmark tasks separately; once, compare the Starter under the campaign runtime against its export; and check whether external scores are non-decreasing along the campaign's promotion chain | the required rung is the operator's decision (proposed: above the Starter beyond its spread and above the one-pass author; no arm wider in spread or worse on its worst task than Starter rollouts allow; no drop outside scope beyond Starter spread; external score non-decreasing along the chain; runtime gap reported as a measured constant; WorkBuddy-Bench Code deferred past v1.0) | `studies/harness2/score.ts table`, and `spread` for an arm's rollouts; `studies/harness2/compare.ts read`; `promotion-tuner/scripts/trend.ts --bench <store>`; nothing orders a single chain yet | whether internal promotions transfer to an external grader, and whether the iterative loop outperforms a single authoring pass |

**When v1.0 is met.** At each release, the release-notes author evaluates every row using its
owning reader and records one line per row (`met`, `not met` with count, or `unmeasured`; never
`met` without a measured value) in **Validation and limits** and `docs/plan.md`. v1.0 is the
release whose top commit satisfies every row. Any row with an unset threshold reads `unmeasured`
and blocks v1.0: all thresholds must be fixed by the operator and committed to this table before
the graduating runs start, and no observation from those runs may shift a threshold (rule 4).

**How a threshold is set** (proposed). The wall tests, A/A design false-positive rate, and verdict
agreement bars are fixed invariants that are never relaxed to let a run pass. Every other threshold
is an operating point derived from an empirical distribution, a measured noise floor (Starter
rollout spread or Starter A/A), or an archive replay (`promotion-tuner`), and backtested before
adoption so that it accepts the archive's strongest runs and rejects known treadmills.

**Triage order.** Before vetting, sort all claims by the first v1.0 table row they block; claims
blocking no row go last.

## The lenses

The brief's "Your lens" section defines each analytical method in full; in summary:

- **flaws**: predict what campaign logs should show before searching them, then count; cap at three
  findings in round 1 and two in subsequent rounds.
- **rethink**: design the subsystem from `AGENTS.md` section 1 *before opening any source file*,
  then compare the sketch against the codebase in both directions.
- **delete**: map each concept against rule 13 and count its actual uses in code and logs; report
  every broken link.
- **factors**: verify whether each pillar is well-defined, backed by a single fold, stated once,
  and faithful to the source.
- **robustness**: probe failure modes and hostile edge cases, identifying every invariant that
  lacks a test.

Every lens also reports an uncapped list of **what does not make sense**, one verifiable line per
item. The `flaws` lens tends to surface local bugs, whereas `rethink` and `delete` ask whether an
entire mechanism should exist at all.

## The procedure

Store all audit artefacts in `<dir>` = `.ana/wri/<date>-<subject>-audit-<round>/` inside the main
checkout.

1. **Pin the source.** Check out the published stack top
   (`bun .claude/skills/stack-pr/scripts/stack.ts`) into a dedicated detached worktree
   (`git worktree add --detach ../anabasis-audit-<round> <commit>`) rather than the main checkout;
   all claims cite `git show <commit>:<path>`.
2. **Fix the evidence set.** Run
   `bun .claude/skills/system-audit/scripts/recent.ts --limit 16 --json > <dir>/recent-logs.json`
   to capture the most recent real campaigns (excluding seeds, rehearsals, and dead launches) with
   citable event snapshots. *Verify* that the list spans more than one pack and launch commit.
3. **Write the brief.** Copy [references/brief.md](references/brief.md) to
   `<dir>/shared-instructions.md` and populate every placeholder. From round 2 onward, list earlier
   confirmed findings under **Assumed repaired** as counterfactuals rather than new findings. Never
   hint at an expected conclusion in the brief.
4. **Assign parts and lenses.** Launch three to six sessions, one subsystem each, including at
   least one `rethink` session and (before a release) one `factors` session. Write each task as a
   single paragraph stating owners and purpose, lens, code paths, and boundaries preventing overlap
   with neighbouring sessions. Place any suspected flaw in the shared brief as a falsifiable
   hypothesis rather than in an individual task prompt.
5. **Launch.** Create a [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) manifest at
   `<dir>/manifest.json` with `"sandbox": "read-only"` and `"search": false`, started detached with
   `--model gpt-6.1-sol --reasoning-effort high` writing into `<dir>/gpt/`. Launch Claude sessions
   with the identical brief in a single turn. *Verify* `gpt_sessions.started` and confirm each
   transcript's model and reasoning effort.
6. **Challenge.** Give one fresh read-only session the shared brief and the raw claims stripped of
   their supporting reasoning. Instruct it to attempt to refute each claim from source code and logs
   and to write the strongest argument that the current design is sound, without seeing the primary
   session's views. A refuted claim survives only if the primary session independently confirms it
   by recounting.
7. **Vet.** Triage claims, then write `<dir>/vetting.md` with one row per claim: pillar and v1.0
   row, what was rechecked, the challenge session's counterargument, and the verdict (**confirmed**,
   **plausible** from a single report, or **refuted**). For proposals, verify both the measured
   complexity cost and preservation of honesty invariants.
8. **Report.** Present confirmed claims ranked by the v1.0 row they block and then by capability
   retained per unit of machinery removed, naming owning modules; plausible claims with what would
   settle them; vetted "does not make sense" items; rule challenges framed as operator decisions;
   what proved sound; and each v1.0 row marked blocked, moved, or untouched. An audit concludes when
   a round's `flaws` and `rethink` sessions uncover nothing new.
9. **Apply, with operator authorisation**, through [stack-pr](../stack-pr/SKILL.md): route
   redesigns through [commit-r](../commit-r/SKILL.md), deletions through
   [simplify](../simplify/SKILL.md) following the full dependency strand, and missing hostile tests
   test-first. Implementation sessions own explicit path lists in isolated worktrees
   (`workspace-write`, `ownedPaths`); the primary session reviews every diff and runs owning tests
   and `runs replay`. Only a fresh campaign measures whether a change improved outcomes.

## The parts

| part | owns | first lens |
| --- | --- | --- |
| `measurement` | `src/kernel/compare.ts`, `src/campaign/comparison.ts`, `round.ts`, `climb.ts`, `src/referee/`, `src/kernel/verify.ts` | flaws |
| `learning_loop` | `src/builder/`, `src/examiner/`, `src/kernel/reports.ts`, `src/campaign/decide.ts`, the prompts | rethink |
| `runtime_recovery` | `src/agent/`, budget and load, the log's writers and readers, `tools/d2`, `tools/runs` | robustness |
| `accumulated_capability` | whether promotions persist, or reflect selection, a shifting exam, or solve variance | flaws |
| `evaluation_grounding` | whether checks, the verifier, the Referee, and admission support claims made from promotions | flaws |
| `factors` | `AGENTS.md` section 1, `design-and-seats/references/question-and-factors.md`, `docs/plan.md`, and each pillar's fold | factors |
| `operator_surface` | the commands, skills, and `AGENTS.md`: what a user must learn to run a campaign | delete |
| `whole` | the entire system evaluated from section 1's question | rethink |

Choose parts that fit comfortably within one session's context with a single owner per claim; the
operator may specify custom partitions.

## What makes a claim

The brief's **Evidence** and **Report** sections specify the evidentiary bar for every flaw and
proposal, and vetting enforces it strictly: counted run evidence from the claim's own commit, a
measured complexity cost and falsifying prediction for every proposal, and zero exam-side
quotations.
