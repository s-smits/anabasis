---
name: system-audit
description: Rethink Anabasis as a whole with independent read-only sessions, each taking one part through one lens (flaws proved from counted events in recent campaigns, rethink from the goal before the code, delete, robustness, factors). Claims name their pillar and are triaged by the v1.0 requirement they block; a challenge session tries to refute them, the primary vets them, and confirmed findings become the next round's assumed repairs, applied on the operator's word through stack-pr, commit-r and simplify. Use when the operator asks for the biggest or fundamental flaws, an independent or general audit, fresh eyes, a rethink or redesign, what to delete, how to make the system more robust, or another round "assuming those are fixed". One campaign is whole-run-investigation's, one diff code-review's, kept harnesses harness-audit's.
---

# System audit

An audit asks of the whole system at one commit: given the goal of `AGENTS.md` section 1, what
should be different? Read-only sessions each read one part through one lens; a challenge session
tries to refute their claims, and the primary vets each before anyone acts.

Everything is open except the measurement's honesty (the wall and rules 3 to 8), which a proposal
may change only with proof that it still holds. Any other mechanism, prompt, default, reader, skill
or line of `AGENTS.md` may be merged or deleted, and exists only while its rule 13 map holds. A
dated incident in a head comment is a lesson to keep or retire, never a reason by itself. The audit
stays read-only and its proposals stand at "Planned": only a fresh run shows an improvement.

## The pillars and the v1.0 bar

Every claim names the pillar it bears on: those of `AGENTS.md` section 1, the wall, and three rows a
release adds (grounding, the systems reading, the outside comparison). This table owns each row's
requirement, threshold, reader and purpose; `docs/plan.md`, "The v1.0 bar, now", owns its present
value and level. Thresholds are the operator's, and no seat is told one.

| row | v1.0 requires | threshold | status printed by | decides |
| --- | --- | --- | --- | --- |
| wall | every wall test passes on macOS and Linux at the top; no measured solve ran unwalled | no failure | `bun run gate` on each system; `sandbox-crash` in the closing report | whether any reading can be trusted |
| supply | every comparison after set-up scores enough untied tasks to read a step, some steps won on validity | 6 untied tasks (the fewest that clear at 0.02) | `examiner-complexity/scripts/zone.ts <log>`; `promotion-tuner/scripts/table.ts --rows runs` | whether the next work is the Examiner's or the Builder's |
| climb | six confirmed promotions (`confirmed`, `src/campaign/climb.ts`) in one measured campaign (`AGENTS.md`, section 10, item 9), then in a second domain; each read also without the tasks that chose the harness | 6 a domain | `barLines` (`bun run runs view <name>`); `comparison-reading/scripts/starter-reads.ts` | whether a promotion generalises beyond its selection tasks |
| honesty | no step in the ten able A/As after the sixth promotion; across the cycle, A/A steps at most the design rate | 0 of 10; 1.1% at 0.02 (`falseRate`) over 100 able (proposed) | `barLines`; `table.ts --rows runs`, "A/A steps/capable" | whether the level is loose for the noise |
| verdicts | 30 blind labels pooled across campaigns; 3 in 4 check defects caught; at most 1 in 10 earned rejections voided; PABAK beside kappa | at least 8 labelled defects (proposed) | `tools/d2/settle.ts` (`clears`, `src/referee/agreement.ts`); nothing pools yet | whether a Referee label can stand in for a person's |
| grounding | one domain whose exam names the field's installed engine, so no check needs `--admit-authored` (rule 10) | 0 author-computed checks in that domain's measured campaign | the closing report's "What decides a pass" (`unadmitted`, `tools/d2/close.ts`); `tools/c/accept.ts` | whether a pass means the field's tool agrees |
| economy | dollars and active hours per promotion and per confirmed promotion on one meter; attempts an epoch reported against 3 | 3 attempts, reported | `tools/d2/close.ts`, `barLines`; `promotion-tuner/scripts/cost.ts` | what a gain costs |
| systems | a cheap solver in a built harness against a dear solver in the starter, on the campaign's held-out tasks, claim and margin fixed before the first solve (`compare-systems`) | solvers, margin and solves are the operator's | `compare-systems/scripts/systems.ts` | whether a harness lets a cheaper system do a dearer one's work |
| outside | a harness built blind to a benchmark against Harness² on unseen tasks under its own grader, margin fixed after a Starter A/A, two rollouts a side, repeated | the operator's: JobBench (`docs/backlog/jobbench-scoring.md`) or WorkBuddy-Bench Code (`studies/harness2/README.md`) | `studies/harness2/compare.ts read`; `studies/harness2/run.ts read` | whether the climb transfers to an outside grader |

At each release the notes' author reads every row from its reader and writes one line a row (met,
not met with its count, or unmeasured, never met without a value) in "Validation and limits" and
`docs/plan.md`. v1.0 is the release at whose top every row reads met.

**Triage on top.** Before vetting, sort claims by the first row they block, in table order; a claim
that blocks none goes last.

## The lenses

The brief's "Your lens" gives each lens's method; in short:

- **flaws**: predict what the logs should show, then count; at most three findings in round 1, two
  later.
- **rethink**: design the part from section 1 *before opening any source*, then diff with the code.
- **delete**: map each concept by rule 13 and count its uses; report each missing link.
- **factors**: is each pillar the right one, read by a fold, stated once and true to the source?
- **robustness**: try the hostile cases and name the guards no test holds.

Every lens also lists **what does not make sense**, uncapped, one checkable line each. Flaws alone
find the nearest bounded bug; rethink and delete ask whether a mechanism should exist.

## The procedure

Keep the audit's files in `<dir>` = `.ana/wri/<date>-<subject>-audit-<round>/` of the main checkout.

1. **Pin the source.** The published top (`bun .claude/skills/stack-pr/scripts/stack.ts`) in its own
   installed worktree (`git worktree add --detach ../anabasis-audit-<round> <commit>`), never the
   main checkout; claims cite `git show <commit>:<path>`.
2. **Fix the evidence.** `bun .claude/skills/system-audit/scripts/recent.ts --limit 16 --json >
   <dir>/recent-logs.json` lists the newest real campaigns (no seeds, rehearsals or dead launches),
   each with a citable snapshot. *Check:* more than one pack and launch commit.
3. **Write the brief.** Copy [references/brief.md](references/brief.md) to
   `<dir>/shared-instructions.md` and fill every field. From round 2 list earlier confirmed findings
   as **assumed repaired**: counterfactuals, never new findings. The brief names no expected
   conclusion.
4. **Choose parts and lenses.** Three to six sessions, one part each, with at least one rethink and,
   before a release, one factors session. A task is one paragraph: owners and purpose, lens, path,
   and what keeps it off its neighbours' ground. A suspected flaw goes in the brief as a hypothesis
   with its falsifier, never in a task.
5. **Launch.** A [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) manifest, `<dir>/manifest.json`,
   with `"sandbox": "read-only"` and `"search": false`, started detached with `--model gpt-6.1-sol
   --reasoning-effort high` into `<dir>/gpt/`. Claude sessions get the same brief, all started in
   one message. *Check:* `gpt_sessions.started`, and each transcript's model and effort.
6. **Challenge.** One fresh read-only session receives the brief and the claims without their
   reasoning, tries to refute each from source and logs, and writes the strongest case that the
   system works as it is. It never sees the primary's view. A refuted claim stands only on the
   primary's own recount.
7. **Vet.** Triage, then write `<dir>/vetting.md`, a row a claim: pillar and v1.0 row, what was
   rechecked, what the challenge said, and **confirmed**, **plausible** (one report) or
   **refuted**. For a proposal, recheck the measured cost and that honesty holds.
8. **Report.** Confirmed claims ranked by the row they block, then by result kept per machinery
   removed, with owners; plausible ones with what would settle them; vetted nonsense lines; rule
   challenges as decisions; what was sound; each row blocked, moved or untouched. A round whose
   flaws and rethink lenses find nothing new ends the audit.
9. **Apply, on the operator's word**, through [stack-pr](../stack-pr/SKILL.md): a redesign through
   [commit-r](../commit-r/SKILL.md), a deletion through [simplify](../simplify/SKILL.md) following
   the whole strand, a missing hostile test as the test first. Write sessions own named paths in
   their own worktrees (`workspace-write`, `ownedPaths`); the primary reads every diff and runs the
   owning tests and a replay, and a fresh run, never the audit, measures the change.

## The parts

| part | owns | first lens |
| --- | --- | --- |
| `measurement` | `src/kernel/compare.ts`, `src/campaign/comparison.ts`, `round.ts`, `climb.ts`, `src/referee/`, `src/kernel/verify.ts` | flaws |
| `learning_loop` | `src/builder/`, `src/examiner/`, `src/kernel/reports.ts`, `src/campaign/decide.ts`, the prompts | rethink |
| `runtime_recovery` | `src/agent/`, budget and load, the log's writers and readers, `tools/d2`, `tools/runs` | robustness |
| `accumulated_capability` | whether promotions persist, or reflect selection, a shifting exam or solve variance | flaws |
| `evaluation_grounding` | whether checks, the verifier, the Referee and admission support claims made from promotions | flaws |
| `factors` | `AGENTS.md` section 1, `design-and-seats/references/question-and-factors.md`, `docs/plan.md`, and each pillar's fold | factors |
| `operator_surface` | the commands, skills and `AGENTS.md`: what one must learn to run a campaign | delete |
| `whole` | the system from section 1's question | rethink |

A good part fits one session's context with one owner a claim; the operator may name others.

## What makes a claim

The brief's "Evidence" and "Report" sections state what a flaw and a proposal must carry, and
vetting holds every claim to them: counted run evidence at the claim's own commit, a measured cost
and a falsifying prediction for a proposal, and nothing exam-side quoted.
