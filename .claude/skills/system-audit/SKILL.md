---
name: system-audit
description: Rethink Anabasis as a whole with independent read-only sessions. Each takes one part and one lens. Flaws must be proved from counted events in recent real campaigns. Rethink sketches the part from its goal before reading the code, then diffs the two. Delete names what no record or reader needs. Robustness tries the hostile cases. Factors audits the pillars themselves: the right set, each read by a fold, stated once, true to the source. Every claim names its pillar, and claims are triaged first by the v1.0 requirement they block. Every report also lists what does not make sense. A challenge session tries to refute the claims, the primary vets them, and confirmed findings become the next round's assumed repairs; on the operator's word they are applied through stack-pr, commit-r and simplify. Use when the operator asks for the biggest or fundamental flaws, an independent or general audit, fresh eyes, a rethink or redesign, what to delete, how to make the system more robust, or another round "assuming those are fixed". One campaign's question is whole-run-investigation's, one diff's is code-review's, the kept harnesses are harness-audit's.
---

# System audit

A system audit asks one question of the whole system at one commit: what, given the goal of
`AGENTS.md` section 1, should be different? Independent sessions each take one part through one
lens, read it from its source and its runs, and bring back flaws, proposals and a plain list of
what does not make sense. A challenge session tries to refute them, and the primary vets every
claim before anyone acts on one.

**What is open.** Everything is open except the measurement's honesty: the wall and rules 3 to 8,
which a proposal may change only with proof that they still hold. Every other mechanism, prompt,
default, move-table row, tool, reader and skill may be questioned, merged or deleted. That includes
`AGENTS.md`'s own text and the rest of its rules, as a row for the operator. A mechanism exists only
while its map holds (rule 13: `owner → live reader → decision it changes → evidence → hostile test`).
A head comment's dated incident is a lesson to keep or retire with a reason, never a reason by
itself.

**What it is not.** An audit asked for on its own stays read-only (`AGENTS.md`, the paragraph
before section 1). It proposes, and step 9 applies only on the operator's word. Its proposals stand
at "Planned" (section 9): no audit shows that a change improves anything, which only a fresh run
can.

## The pillars and the v1.0 bar

Every claim names the pillar it bears on. The pillars are those of `AGENTS.md` section 1: supply,
the condition before the four, then climb, honesty, verdicts and economy, with the wall beside them
as a correctness property, and three rows a release adds: grounding (rule 10), the systems reading
of section 1's wider aim, and the outside comparison. A v1.0 release needs every row below. This
table owns what each row requires, its threshold, the reader that prints its status and the
decision it serves; `docs/plan.md`, "The v1.0 bar, now", owns each row's present value and level,
and nothing else states either. A threshold is the operator's (`AGENTS.md`, section 3), and no
seat is told one (section 2, consequence 2).

| row | v1.0 requires | threshold | status printed by | decision it serves |
| --- | --- | --- | --- | --- |
| wall | every wall test passes on macOS and on Linux at the release's top, and no solve of the measured campaign ran unwalled | no failure on either system; an unavailable wall is a typed non-result, never a pass | `bun run gate` on a runner of each system (`test/builder.test.ts`, `test/builder-led.test.ts`, the wall's start-up test); `sandbox-crash` non-results in the closing report | whether any reading of the release can be trusted at all |
| supply | every comparison of the measured campaign after set-up scores enough untied tasks to read a step at its level, and some of its steps are won on validity | at least 6 untied tasks a comparison, the fewest an exact one-sided sign-flip test can clear at 0.02 (one in 2^6); the share of steps won on validity is the operator's | `examiner-complexity/scripts/zone.ts <log>` (untied on validity and on the objective alone, the reference's valid share); `promotion-tuner/scripts/table.ts --rows runs`, column "steps won by validity" | whether the exam leaves room for a step to mean a better harness, and so whether the next work is the Examiner's or the Builder's |
| climb | six confirmed promotions in one measured campaign (`AGENTS.md`, section 10, item 9), at one commit, then the same in a second domain the operator names (plan row L2). "Confirmed" is `confirmed` in `src/campaign/climb.ts`. Beside each confirmed promotion the release states whether its read is a step without the tasks that chose the harness | 6 in each domain; whether a read counts the tasks that chose the harness is the operator's | `barLines` (`src/campaign/climb.ts`: the closing report and `bun run runs view <name>`); `comparison-reading/scripts/starter-reads.ts` for the split by origin | whether a promotion is a gain beyond the tasks that selected it, the release's main claim |
| honesty | no step in the ten A/A comparisons able to read one after the sixth promotion of the climb's campaign, and across the measured campaigns of the release cycle a share of A/A steps no higher than the level's design rate | 0 of 10 able; at most 1.1% at 0.02 (`falseRate`) over at least 100 able (proposed, the operator's to set) | `barLines`, whose honesty line keeps the able apart; `table.ts --rows runs`, column "A/A steps/capable" | whether the level is loose for the noise, and so whether a step can be taken at its word |
| verdicts | at least 30 blind labels pooled across campaigns, among them enough labelled check defects to read the catch rate; three in four check defects caught; at most one in ten earned rejections voided; PABAK beside kappa | 30 labels, of which at least 8 are labelled check defects (proposed, the operator's to set); 3 in 4; 1 in 10 | `tools/d2/settle.ts` over one campaign's packets (`clears`, `src/referee/agreement.ts`); no reader pools packets across campaigns yet | whether a label the Referee gives can stand in for a person's |
| grounding | one domain whose exam names the field's installed engine, so its checks stand without `--admit-authored` (rule 10, plan row F32) | 0 checks decided by their author's computation in the measured campaign of that domain | the closing report's "What decides a pass" line (`unadmitted`, `tools/d2/close.ts`); `tools/c/accept.ts` decides admission | whether a pass means the field's own tool agrees, not only the exam's author |
| economy | dollars and active hours per promotion and per confirmed promotion, priced on one meter, for the measured campaign and for the release cycle's runs; attempts an epoch after set-up reported against 3 | 3 attempts, reported; any dollar target is the operator's | `tools/d2/close.ts` and `barLines` for one campaign; `promotion-tuner/scripts/cost.ts` across runs | what a gain costs, read apart from whether it is one |
| systems | a cheap solver inside a harness a measured campaign built against a dear solver inside the starter, on that campaign's held-out tasks, under a claim and margin fixed before the first solve (`compare-systems`) | the pair of solvers, the margin and the solves a task are the operator's | `compare-systems/scripts/systems.ts` | section 1's wider aim: whether building a harness lets a cheaper system do a dearer one's work |
| outside | a frozen harness built without a benchmark's tasks or grades, against Harness² on tasks neither has adapted to, under one solver, the same prompt and inputs and the benchmark's own grader, with the margin fixed after a Starter A/A and before the first built rollout, at two rollouts a side, and repeated by a second campaign | the course, the tasks and the margin are the operator's: JobBench parity (`docs/backlog/jobbench-scoring.md`) or WorkBuddy-Bench Code (`studies/harness2/README.md`) | `studies/harness2/compare.ts read` for JobBench; `studies/harness2/run.ts read` for WorkBuddy-Bench | whether a climb on an exam Anabasis wrote itself carries to a grader nobody in either loop wrote |

**How the bar is kept.** No reader of its own, since each row's reader exists: at each release the
session that writes the notes reads every row from the reader named above, on the release's
measured campaign and its cycle's runs, and puts one line a row in the notes' "Validation and
limits" (met, not met with its count, or unmeasured), then copies the same lines into
`docs/plan.md`, "The v1.0 bar, now". A row whose reader has no value is unmeasured, never met. A
system audit reads the same table to triage (below). v1.0 is the release at whose top every row
reads met.

**Triage on top.** Before vetting, sort every claim by the first row it blocks, in the table's
order: the measurement's honesty before supply, a result before its credibility, credibility
before its cost, and the systems and outside comparisons last, since they rest on all the rest. A
claim that blocks no row goes below them all. Vetting and the report keep that order.

## The record

- **One commit, five readers.** Five Claude teammates read the promotion path at one commit, each writing what
  the path does and then its flaws, citing counts, ids and lines.
- **A first round.** Three gpt-6.1-sol sessions at high effort, one each for measurement,
  the learning loop, and runtime and recovery, returned four bounded issues:
  - settlement corrections that three readers missed;
  - rollback selection;
  - stale drafts after a restart;
  - the provider-wait reader.
- **A second round.** With those four assumed repaired, three sessions read accumulated
  capability, learning information and evaluation grounding. They confirmed one design-level
  flaw: an exam was accepted that left out the compilation the operator's prompt required. Two
  supported concerns stood beside it, and no false promotion was demonstrated
  (the round's `vetting.md` under `.ana/wri/`).

- **The factors.** One prompt asked whether the factors were the right set, measurable from the
  log, stated once and true to the source. It was kept in `a650fe98b:docs/prompts.md`, and is the factors lens below.

What both rounds lacked: every session was asked only for proved flaws, capped at two or three. So
each reported the nearest bounded bug, and nothing asked whether a mechanism should exist at all.
The lenses below add that question, and the rounds keep the proof.

## The lenses

Each session carries one lens over its part, or one lens across the whole system.

| lens | the session | what it returns |
| --- | --- | --- |
| **flaws** | traces its part end to end, writes what the logs should show if a suspicion is right, then counts the runs | at most three findings in round 1 and two later, each demonstrated or supported |
| **rethink** | reads only `AGENTS.md` section 1 and its part's purpose, then writes the design it would build, *before opening any source*. Only then does it read the code and diff the two | a sketch, the diff (what exists that the sketch lacks, and what the sketch has that the code lacks), and up to three proposals |
| **delete** | maps every concept in its part (rule 13) and counts each option's values, each branch's events and each export's readers in the logs and the tree | each concept with a missing link, and what removing it would reopen |
| **factors** | takes each pillar as `AGENTS.md` section 1 and `design-and-seats`' `question-and-factors.md` state it and asks four things: is the set right (the failure each guards against, with a recorded case, and a failure none would detect); is each read by a named fold from the log or only by a hand count; is each stated once (every restatement in `AGENTS.md`, the skills, `docs/plan.md` and head comments); is the text true to the source (each path, symbol, number and exclusion it names) | per pillar: its fold or "none", the restatements that differ in a number or word, the statements the source refutes, and any failure no pillar would detect |
| **robustness** | tries the hostile cases on its part: a kill at any line, a torn append, a provider failure or timeout, a missing wall, two writers, load and the clock, a host down. For each guard it asks which test holds it | the guards no test holds and the hostile cases with no answer, each with the test that would hold it |

Every lens also returns **what does not make sense**: one line each, uncapped, with a location and
one sentence a reviewer can check. "This is confusing" is no line. A rethink session reads the
code only after its sketch is written, so the code cannot anchor it. The diff is the finding;
neither side is right by default.

## The procedure

Keep the audit's files in one folder, `<dir>`, at `.ana/wri/<date>-<subject>-audit-<round>/` of the
main checkout.

1. **Pin the source.** Take the top of the open stack, published
   (`bun .claude/skills/stack-pr/scripts/stack.ts`), in a worktree of its own
   (`git worktree add --detach ../anabasis-audit-<round> <commit>`), never the main checkout, which
   may be moved to follow the stack while the sessions read. Every source claim cites
   `git show <commit>:<path>` with one-based lines.
   *Check:* the commit is on `origin`, and the worktree has its dependencies installed. The
   sessions install nothing.
2. **Fix the evidence.** Run
   `bun .claude/skills/system-audit/scripts/recent.ts --limit 16 --json > <dir>/recent-logs.json`.
   It lists the newest real campaigns once each, leaving out seeds, rehearsals and dead launches.
   Each comes with the snapshot a report cites: the event count, the last event, the sha256 of the
   lines read and the commits its launches ran.
   *Check:* more than one pack and more than one launch commit, or the brief says otherwise.
3. **Write the brief.** Copy [the brief](references/brief.md) to `<dir>/shared-instructions.md`
   and fill its marked fields. From round 2 on, list the earlier rounds' confirmed findings and
   accepted proposals as **assumed repaired**. They are counterfactual: not claims that a fix is
   published, and never new findings.
   *Check:* no marked field is left, and the brief names no conclusion the primary expects.
4. **Choose the parts and lenses.** Give each session one row of the table below, and three to six
   sessions a round. A good round mixes lenses: at least one rethink, and flaws on the parts the last
   round left open, and one factors session in the round before a release. A task is one paragraph naming:
   - the part's owners and its purpose in one sentence;
   - the lens;
   - the path to trace;
   - the one sentence that keeps it off its neighbours' ground.

   Never hand a session a suspected flaw. An earlier finding goes in the brief as a hypothesis,
   with what would falsify it.
5. **Launch.** Write a [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) manifest,
   `<dir>/manifest.json`, with `"sandbox": "read-only"` and `"search": false`. Start it detached on
   the model the operator's rules name (`--model gpt-6.1-sol --reasoning-effort high`), with output
   in `<dir>/gpt/`. Claude sessions get the same brief and task, all started in one message.
   *Check:* `gpt_sessions.started`, and each transcript's model and effort before its report is
   used.
6. **Challenge.** Once the reports are in, start one fresh read-only session. It gets the brief and
   each report's claims, stripped of their reasoning, and tries to refute every claim from the
   source and the logs. It also writes the strongest case that the system works as it is. It never
   sees the primary's view. A claim it refutes needs the primary's own recount before it stands.
7. **Vet.** Triage first ("Triage on top"), then write `<dir>/vetting.md`, one row a claim in
   that order:
   - the pillar and the v1.0 row it blocks, or none;
   - what was rechecked here (events recounted, source read at the commit);
   - what the challenge said;
   - a verdict of **confirmed**, **plausible** (resting on one report) or **refuted**.

   For a proposal, vetting checks the measured cost of the present form and that the honesty
   properties hold under the new one. Say what a confirmed claim does not establish. Triage is not
   vetting.
8. **Report and carry forward.** Report to the operator:
   - the confirmed flaws and proposals, ranked by the v1.0 row each blocks and then by result kept
     against machinery removed, each with its owner;
   - the plausible ones, with what would settle each;
   - the vetted lines that do not make sense;
   - the rule challenges, as decisions;
   - what was found sound;
   - for each v1.0 row, whether the round found it blocked, moved or untouched.

   Confirmed rows become the next round's assumed repairs. A round whose flaws and rethink lenses
   find nothing new ends the audit.
9. **Apply, on the operator's word.** Each accepted row becomes a change, through
   [stack-pr](../stack-pr/SKILL.md):
   - a redesign through [commit-r](../commit-r/SKILL.md), test-first with the old code as oracle;
   - a deletion through [simplify](../simplify/SKILL.md), following the whole strand;
   - a missing hostile test as the test first.

   Independent changes may go to write sessions, each owning named paths in its own worktree
   (`workspace-write`, `ownedPaths`). The primary reads every diff and runs the owning tests and a
   replay. A change to what a seat reads states how the wall tests still hold (rule 3). The change
   is measured by a fresh run, never by the audit that proposed it.

## The parts

| part | owns | lens it suits first |
| --- | --- | --- |
| `measurement` | `src/kernel/compare.ts`, `src/campaign/comparison.ts`, `round.ts`, `climb.ts`, `src/referee/`, `src/kernel/verify.ts`, the wall's boundaries: task selection, verdicts, fresh evaluation and the promotion decision | flaws |
| `learning_loop` | `src/builder/`, `src/examiner/`, `src/kernel/reports.ts`, `src/campaign/decide.ts`, the prompts and continuation: drafting, admission, practice, turnover, feedback | rethink |
| `runtime_recovery` | `src/agent/`, budget and load, the log's writers and readers, the `tools/d2` lifecycle, `tools/runs` status, receipts and recovery | robustness |
| `accumulated_capability` | whether successive promotions persist on independent evidence, or can be explained by selection, a shifting exam or solve variation | flaws |
| `evaluation_grounding` | whether contracts, checks, the verifier, the Referee and admission evidence support the claims made from promotions | flaws |
| `factors` | `AGENTS.md` section 1, `design-and-seats/references/question-and-factors.md`, `docs/plan.md`'s factor table, and the folds each pillar names: `src/campaign/climb.ts`, `src/campaign/admission.ts`, `src/referee/agreement.ts`, `tools/d2/close.ts` | factors |
| `operator_surface` | the commands, skills and `AGENTS.md`: what an operator or agent must learn to run one campaign, and how many places state one fact | delete |
| `whole` | the system from section 1's question, across every part | rethink |

The operator may name other parts. A part is good when one session can read all its owners in one
context and each of its claims has one owner.

## What makes a claim

The brief carries these rules. Vetting holds every claim to them.

- **Every claim names its pillar** and the v1.0 row it blocks or moves, or says none.
- **A flaw** needs the source mechanism and counted run evidence: run names, event indices, counts
  with their denominators and the snapshot read. One reproducible logical contradiction can qualify,
  labelled with its scope. Test three explanations (the intended behaviour, noise, the defect) and
  look for the strongest counterexample.
- **A proposal** needs:
  - the present form's measured cost (lines and branches from `measure.py`, the census's sites, the
    values an option took and the events a branch reached in the logs);
  - what it removes and keeps, and what it gives up;
  - which honesty property it touches, and why that still holds;
  - the decisive test: a replay over recorded logs (`bun run runs replay`), a rehearsal, or a fresh
    run;
  - one prediction that would falsify it.

  Rank by most result kept for least machinery (`AGENTS.md`, section 2, item 7).
- **A run is evidence only about its own commit.** A failure a published change already addressed
  is history. Waits, an exhausted login and elapsed hours are rule 15's ordinary case, never a
  learning flaw.
- **Absence needs checking**: its symbol and its callers, in the same session. A missing label is an
  evidence gap, not an error.
- **No padding.** The caps bound flaws and proposals. A lens that finds nothing says so, and says
  what it checked and found sound.
- **The walls.** Never quote a task, an answer, a hidden value, a check's text or a trace. Cite
  kinds, indices, ids, counts and lines. Keep machine names, logins and credential paths out. No
  session reads an env file, and no report reaches a seat.

## Where the detail lives

| file | owns |
| --- | --- |
| [references/brief.md](references/brief.md) | the shared instructions every session of a round carries, and each lens's report |
| `scripts/recent.ts` | the inventory of recent real campaigns, each as a cited snapshot |
| [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) | the manifest, the detached launch, the drain and the retry |
| [whole-run-investigation](../whole-run-investigation/SKILL.md) | one campaign's question, with its lanes and synthesis |
