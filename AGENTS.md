# AGENTS.md

This file gives coding agents the system's shared rules and a map to its documentation. Every
session loads it, so it keeps the invariants and leaves detailed mechanisms to skills. The adjacent
`CLAUDE.md` belongs to the operator.

**Where to read more.** Four skills explain these sections under the same numbers and titles:
`design-and-seats` (1 to 3), `campaign-mechanics` (4 to 6), `comparison-reading` (7 and 8) and
`repository-practice` (9 to 14). Most tasks touch at least one of them: read the owning skill before
you change a mechanism or answer a question about one. Each section here opens with what it is
about and closes with an index of what its skill adds: the file under its `references/` to read
before you change that mechanism, and the scripts, each run as
`bun .claude/skills/<skill>/scripts/<name>.ts`. The other
skills own the procedures (section 10), `tools/oxlint/HABITS.md` how code is written (section 12),
and `docs/plan.md` status. `docs/transfer.md`, `docs/v1.md` and `studies/` hold v1's
record and outside measurements; `7f0add79:docs/<file>` means that file at that commit.

Check descriptions against the source at the stack's head and each module's head comment. When a
description no longer matches its mechanism, correct it in the change that finds it.

**Area-specific guidance.** `tools/runtime/moments.ts` runs before tool calls in Claude Code
(`.claude/settings.json`) and Codex (`.codex/config.toml`). When a command or an edit enters an
area, the hook supplies its invariants and links to the relevant section and skill. It does this
once per area per session and never blocks a call.

Carry authorised work through implementation, checks and delivery. Resolve routine ambiguity using
the most reasonable reading and state the assumption. Verify findings from your own review or
subagents before acting on them. An audit, review or plan requested on its own remains read-only.
Ask only for missing permission or a decision reserved to the operator (section 3), with the
concrete result ready for review.

## 1. What Anabasis v2 does

One query names one technical domain, and a campaign builds one **Built Harness** (a harness) for
it: the guide and programs a fixed **solver** model uses to answer that domain's tasks. A solve is
the solver and one harness acting as one system. The setting fixes the solver, so a comparison
attributes the difference to the harness. Every mechanism serves one question:

> Is the new harness better than the reference harness, for this solver, on tasks neither was
> built on?

A comparison in code answers it (section 7). Both harnesses solve the same held-out tasks afresh,
under one setting, on terms logged before the first solve. A hidden check program decides each
answer's validity and the Referee rules each rejection, so every task becomes a win, a loss or a tie
by its score over validity, the objective and the bill. A one-sided paired sign-flip test over those
scores reads a **step** or nothing, and a step promotes. The wider aim is for a built system with a
cheaper solver to match a bare system with a more expensive solver. That requires a separate
evaluation (`compare-systems`).

### The four reported factors

The campaign optimises a harness using evaluations of a fixed model. Supply determines whether an
evaluation can carry a useful signal. Four factors describe its results. Each change names the
factor it affects, or the separate purpose it serves. Recorded values live in `docs/plan.md`.

- **Supply**, the condition before the four: is there gradient? Only an informative task can
  register a difference: one the reference answers sometimes, never while a valid answer is on
  record, or every time while an answer on record beats one of its answers by at least the objective
  gap floor (`ROOM`, 1%; `informative`, `src/kernel/compare.ts`). Comparison admission requires
  eight of them at the default level (`comparisonFloor`).
- **1. Climb**: how much ability has accumulated, read as promotions within one campaign
  (`src/campaign/climb.ts`); promotions added up across campaigns make no climb. The milestone, six
  confirmed promotions in one real campaign and then in a second domain, is for observation only
  (a promotion is confirmed once a starter comparison of its epoch reads the reference above the
  starter without the bill at its level: `confirmed`, `src/campaign/climb.ts`),
  so no prompt, tool or move names a count.
- **2. Honesty**: could a gain be chance or drift? An A/A comparison beside every comparison, the
  reference's first solve of each task against its second, measures it. One reading clears between
  equal harnesses at most as often as its level (`falseRate`: 1.1% at 0.02 on 24 untied tasks), and
  the climb sums the attempts' rates as an estimate, not a bound, leaving out an A/A too small to
  reach the level (`incapable`). Bar: no step in ten A/A comparisons.
- **3. Verdicts**: are the labels right? The Referee rules every rejection (never a pass, a cut
  solve or a crash) once the host's replay of the checks repeats it. `earned` must name the broken
  rule and field, cited by a rejecting check, and `check-defect` must cite an answer probe; a ruling
  without its evidence is refused. Bar, on at least 30 blind labels (`settle.ts`): it catches three
  in four true check defects and voids at most one in ten earned rejections, with PABAK beside
  kappa.
- **4. Economy**: what did each gain cost? The closing report reads dollars and hours per promotion
  from the log alone (`tools/d2/close.ts`), at list price (`pricedAt`, `src/agent/session.ts`). Its
  one bar, an opening term that refuses nothing, is at most 3 promotion attempts per epoch after
  set-up (`worthOf`, `src/campaign/climb.ts`).

### Two sides and one wall

The exam side defines correctness; the build side tries to produce correct answers. Practice tasks
are the Builder's training set and held-out tasks its test set. Revealing held-out content or
per-task outcomes would allow the Builder to fit the evaluation set. Practice results therefore
guide development but do not measure improvement. The boundary is asymmetric: the Examiner may
read reference outcomes and each task's winning harness. The operator accepted the risk of that
feedback shaping the exam on 20 October. Only the following information crosses to the build side:

- the contract's public rules, scope and conventions, the answer format and any declared objective
  (the quantity and which way is better);
- the public part of each released (practice) task;
- for a practice solve: its ending's outcome and kind, the solver's trace and, under an objective,
  the verifier's measure of a valid answer;
- for each comparison: the tally and the reading, naming no task;
- host limits, the remaining budget, how many held-out and practice tasks the campaign holds, and
  the move table's fixed advice.

Nothing else crosses: no held-out task or its trace, no check or hidden value, no list of refusing
checks and no Referee reason. The wall is a correctness property, tested byte for byte (rule 3), and
never something to optimise.

**In `design-and-seats`, section 1** (`question-and-factors.md`, `wall.md`): each factor's owners,
bars and edges; why the wall runs one way; v1 (before 11 October 2026, `git show 5bc9988:<path>`).

## 2. The stance: code owns the conditions, models own the content

Code controls the workflow and evaluation conditions. Models choose the content within each step.
For a design question, first identify which of these owns the decision. Code decides which move may
start, every refusal and limit, a solve's condition, validity, the comparison, what crosses the
wall, the dollar cap and the log. A model decides what a harness contains, how a task is solved,
what a new task asks, whether a rejection was right (with its evidence), why a practice solve
failed, and what to change. Code owns decisions whose facts the model cannot observe, decisions
about the model itself, and values that must be identical on both sides of a comparison. Seven
consequences follow:

1. **Give a model facts, never a course.** A model told a course follows it instead of the evidence.
2. **Give an author facts instead of a target.** An author told a zone, a share or a count writes
   towards it, so the Examiner hears what was measured and no number to reach.
3. **Keep the Builder free.** It may rewrite anything, with one limit: no part of a harness names a
   task, copies its text or holds its answer. Add no second limit in a prompt or a check.
4. **Keep code from choosing content** just because reasoning about it is hard. Code may validate a
   declared structure, but a classifier in code is a model's decision made badly.
5. **Keep conditions out of a model's hands.** A reply never sets a score, a limit or an identity;
   where a model's output feeds a decision, code states the evidence it must carry and refuses it
   otherwise.
6. **When in doubt, allow, and allow the whole.** A wall protects only the exam side's hidden
   values, the operator's credentials and each seat's files. Reads are open with the protected roots
   closed by name, each seat writes one root of its own (`SolveDirs`, `src/tools/command.ts`), and a
   grant is narrowed only where two would collide or the wider one would open a protected thing.
7. **Take the simple path that reaches most of the result**: four fifths of it for a fifth of the
   code. This never applies to the measurement's honesty (rules 3 to 8).

**In `design-and-seats`, section 2** (`stance.md`): each consequence with the record behind it.

## 3. The seats

Each seat has one job and a closed view, which is what lets the wall of section 1 hold:

- **Examiner** (model, `src/examiner/`): writes tasks against a frozen contract and check program;
  for a campaign that opens from a prompt, it first drafts that exam. The host admits a task only
  where the reference's room solves leave it room (`try_task`).
- **Builder** (model, `src/builder/`): edits `harness/`, chooses campaign moves and ends with a
  frozen harness, reading only section 1's closed list, its notes and the campaign's kept harnesses.
- **Solver** (model, `src/solver/`): answers one task inside a harness with `read`, `bash`, `edit`,
  `write` and `submit`, plus the harness's own tools.
- **Verifier** (code, `src/kernel/verify.ts`): runs every check, each in a fresh walled cell with
  the network closed.
- **Referee** (model, `src/referee/referee.ts`): rules each rejection `earned`, `check-defect` or
  `unclear` with its required evidence. It sees only the exam side, never the harness or the trace.
- **Host** (code): everything section 2 gives to code.

**What the Examiner reads** is a view of the log (`src/examiner/record.ts`): the reference's
outcomes, turns and measures, and which harness won each task. It never sees a target, a harness's
name, the other harness's measures or a count of its valid solves, and it makes none of the exam's
solves itself.

A **harness** is a directory of four parts: `agent/tools-spec.json` selects pi's tools,
`.toolchain/` holds the programs, `agent/BUILT_AGENTS.md` is the guide (not `AGENTS.md`, which a
solver's backend may load by itself), and `agent/tools.ts` holds the harness's own tools. Its digest
is its identity. The **Starter Built Harness** (`src/harness/starter.ts`) is the first reference and
stays the fixed lower one. Every solve runs inside a harness, so never write "with or without a
harness".

### What waits for the operator

The operator owns the exam's approval, spending and irreversible decisions. Seven decisions
therefore require the operator's authority:

- freezing or refusing the contract and the check program, and admitting a check by name
  (`tools/c/accept.ts --freeze`, `--admit`);
- labelling drawn rejections blind;
- the dollar cap, and which account pays;
- deciding whether a task nobody answers is infeasible;
- promoting a harness to reference (`tools/d2/promote.ts --harness <digest> --yes`): the rule names
  one, and another takes a reason (`--despite`);
- changing what a solver is given or told: the starter, the shell, a campaign's limits;
- stopping a live run.

Ask about an unresolved decision with its evidence and a recommendation. Continue work that does not
depend on the answer. Authorisation covers the cases it names until withdrawn, including after
compaction; a general instruction such as "keep going" does not authorise these seven decisions.
Launching a campaign gives three of these words once: it freezes a fault-free exam, admits every
check its author decided (`--admit-authored`, rule 10), and promotes the harness the rule names.
`--hitl` hands all three back, and any other fault, or going past the stop rule, takes the
operator's word each time. The host builds every message a Builder reads, and "a person" is written
only for one of the seven.

**In `design-and-seats`, section 3** (`seats.md`, `operator-and-harness.md`): what each seat reads
and its tools; what a launch decides. `seat-view` names the seats a diff reaches and their wall
tests; `examiner-view <name>` counts what an Examiner opening would be told, and `builder-view
<name>` prints what a Builder opening would be told of the past.

## 4. The Harness Builder

One Builder conversation leads the campaign (`tools/d2/harness-builder.ts`, `--builder-led`).
Its campaign tools are `examine`, `release_practice`, `compare`, `promote`,
`campaign_status` and `wait`. Each uses the same admission checks as the operator's command.
The move table advises the Builder, while code enforces endings and selects the promotable
harness. Three invariants protect the evaluation:

- a comparison reads the harness it froze, and a step promotes that one, whatever `harness/` holds
  by then;
- a harness already read against the reference, unchanged since, is compared again only where the
  table names it, because a second draw of one pair is a second chance at a step;
- an action refused before it begins is no move.

Preserve the Builder conversation across campaign actions. Standing facts appear in every tool
result because messages sent between tool-call turns do not reach the Builder.

**In `campaign-mechanics`, section 4** (`builder-conversation.md`): Examiner sessions beside the
conversation; which moves are recorded; the Builder's clock; `--no-builder-led`.

## 5. The log

A campaign's record is one append-only file, `.ana/d2/<name>/log.jsonl` (`src/kernel/log.ts`), and
every state and report is a fold over it. An append is synced before it returns, and a read refuses
a torn or unknown line. A **condition** (`src/kernel/condition.ts`) names everything that could
change a solve; two solves compare only where their conditions differ in the one thing compared.
Four habits keep the log the only truth:

1. **Add no second store.** A fact needed later is an event.
2. **Add no second reader of one fact.** Find the fold and call it.
3. **Never edit a log, and never write an event by hand.** Move or copy a campaign only with
   `bun run runs copy`, `move` or `retire`.
4. **Keep old event kinds readable.** A log is evidence, so `EVENT_KINDS` keeps kinds no command
   writes any more.

The log holds hidden values, so it stays on the exam side: out of prompts, pull requests and pastes.
`.ana/` is ignored by Git and, like the repository and its worktrees, behind every seat's wall.
`bun run runs retire` moves a campaign idle for a day into `data/runs/`; nothing else deletes a
log.

**In `campaign-mechanics`, section 5** (`the-log.md`): what a condition names; the folds.
`conditions <name>` prints the settings a log's solves ran under, and what a comparison mixed.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` opens a campaign, from a prompt or over a stored pack, and runs it
unattended to one of seven endings: `budget`, `stop`, `exam`, `no-room`, `environment`,
`operator` or `finished` (three Builder conversations in a row made no campaign move). Its budget is
one total, and it ends once less than one solve's reserve is left. Each solve waits in the solve
queue for the host's load, at most half an hour (`--loaded` skips it, `campaign.waited` records it).
The operator steers a live campaign with a word (`tools/d2/word.ts`: `--stop`, `--tasks`,
`--budget`), which no seat reads.

The log records the opening and fixed setting (`campaign.opened`, `campaign.setting`).
The setting fixes the solver, its limits, `--target` and `--solves`; a conflicting value is
refused because it defines a different campaign. Practice release uses only reference solves
(`releaseOrder`, `src/kernel/reports.ts`), so the candidate's held-out wins cannot affect
the released set (rule 3). At most half the tasks with room are released.

**What refuses a move**: comparison admission (`src/campaign/admission.ts`), session admission, and
the stop rule, which only `--past-stop "<why>"` passes. A command writes nothing before its last
refusal, so a refused move leaves the log as it was.

**Defaults**: 24 scored tasks; 2 solves a side (`SIZE`, `src/kernel/size.ts`); level 0.02;
improvement and supply patience of 6; a gap floor of 1% (`ROOM`); a stop after more than 3 tasks
with a check defect; a reserve of 10 dollars a solve; a solve of 20 model turns, 30 minutes and 24
prompts (`LIMITS`, `tools/d2/campaign.ts`); a Builder session of 24 hours and 300 turns.

**In `campaign-mechanics`, section 6** (`campaign-command.md`, `terms-and-refusals.md`): the hand
commands; the draft's reading; idle and crashed conversations; the opening and setting; release
order; every refusal. `ending <name>` says why a campaign ended and how the table reads it now.

## 7. How a comparison is read

A comparison is the only evaluation that can establish a better harness (rule 1). It records terms
before solving (`comparison.started`), runs both harnesses afresh and pairs every solve on one
side with every solve on the other. The draw prioritises the newest epoch. Tasks with no valid
answer after two comparisons await human review; tasks the reference answers in every solve of
its last two comparisons become exhausted. One retained task joins each three frontier tasks in
the same test, exposing regressions on previously solved tasks.

**Solve outcomes** (`src/kernel/solve.ts`): a pass is valid. An earned rejection,
`wall-ended`, `turns-ended`, `context-ended`, `no-answer` or `broken-harness`
counts as a fail. A solver's `malformed` flag is its side's fail, reported separately. A
rejection ruled `check-defect`, `unclear` or not yet ruled sets the task aside for both
harnesses. `provider`, `sandbox-crash`, `killed`, `moved-files`, `check` and
`verifier` are non-results: they are retried and excluded from pairings.

**The tally** (`pointsOf`, `WEIGHTS`, `src/kernel/compare.ts`) weighs three measures: validity
0.6, the objective 0.3 and the bill 0.1. The objective and the bill count only between two valid
answers, so a refused answer is never the better one, and two answers closer than 1% by the
objective tie on it.

**The test** is an exact one-sided sign-flip test on the nonzero task scores; ties are excluded. A
step is read on the scores without the bill (0.02 by default, kept by each campaign's opening),
so the bill alone never promotes; from 25 to 31 October it had to clear with the bill as well. With equal margins it clears at 6 to
0, 8 to 1, 10 to 2 or 12 to 3 at 0.02.

**The reading** is one of `step`, `no-step`, `not-scored`, `check-defects` and `no-change`.
`not-scored` tested nothing, while `no-step` tested and found no gain.

**The budget** is the setting's model turns and deadline, the same on both sides: a better harness
shows as answers reached within it that the reference does not reach.

**The next move** comes from `decide` (`src/campaign/decide.ts`), which checks ten rows in
order: `stop`, `exam`, `bound`, `tasks`, `unfinished`, `step`, `no-room`,
`short`, `unread` and `build`. The `build` row also handles `practice` and
`unshown`. Improvement patience stops the campaign after six eligible moves without a gain
since the last promotion (`stopRule`, `src/kernel/reports.ts`). Continuing then requires
`--past-stop`.

**In `comparison-reading`, section 7** (`draw-and-solves.md`, `tally-and-test.md`,
`limits-and-room.md`, `move-table.md`): the mirror; the tally's floors; the A/A; the cap; room;
promotion; each row of `decide`. `size` says what a size can show, `reading <name>` sets a
log's readings side by side, and `draw <name>` what the next comparison would score.

## 8. Rules

Cite a rule by its number.

1. **The comparison decides, and nothing else does.** A practice result, a Builder's account, a
   reviewer's opinion and a passing suite say nothing about which harness is better.
2. **Only the Examiner writes the exam, and nobody coaches it.** No person and no other agent, you
   included, writes or repairs a rule, a check or a task, or hand-edits a pack, a check program, a
   kept harness or a log to make a command pass. A defect across domains is fixed in the host, a
   prompt or the contract code.
3. **Nothing crosses the wall except the closed list of section 1.** Changing a hidden value, a
   check, or which held-out task a non-reference harness won must leave every message a Builder or a
   solver reads byte-identical (`test/builder.test.ts`, `test/builder-led.test.ts`). That covers
   prompts, tool descriptions, tool results, home files and the choice of practice tasks, and a pull
   request that touches such a message says how it checked this.
4. **Terms are fixed before the first solve and never moved after a result.** Do not top up a set
   that a dispute thinned, or rerun a finished comparison on other terms.
5. **Both sides are solved afresh under one setting.** No stored solve stands in for a side.
6. **One solve is weak evidence.** In v1 a fail repeated on the same bytes 5 times in 21, so a
   result counts only when repeated solves support it. Say so wherever a single result is shown to
   an agent.
7. **A non-result is never a pass or a fail.** A provider failure, a sandbox crash, a kill, a check
   that threw or a verifier that could not decide is typed, solved again and counted nowhere. A
   broken harness and a task flagged malformed are their side's own fails, since otherwise they
   would leave the score.
8. **A rejection counts only once it is ruled, and a hand label overrides a ruling.** In v1, 36 of
   47 rehearsal misses came from a faulty check or instrument.
9. **No reference answers, no stronger solver, no agent built to find answers.** A check verifies a
   property, which can be right on a task nobody has solved.
10. **No agent writes an instrument.** A check's facts come from the field's own pinned tool, and a
    check decided by its author's computation, a declared objective included, is a fault until the
    operator admits it (`--admit`, or `--admit-authored` at a launch).
11. **The host owns every limit.** A file that asks for more time, turns or disk changes nothing.
12. **One owner for each decision and one reading for each fact.** Change the existing check, flag
    or reader; where two decide one thing, name both and remove one.
13. **Add machinery only on evidence, and rewrite rather than add.** Map a new concept as
    `owner → live reader → decision it changes → evidence → hostile test`, and drop it if a link is
    missing. A change that supersedes a mechanism deletes it, or names under "Not done" what still
    reads it.
14. **Stop when nothing can be learned.** Refuse a launch that cannot give a result before paying
    for it, and do not remeasure a dead provider because budget remains.
15. **Credit and session limits are expected, and are not defects of the system.** Continue from
    the log at the run's own commit once the login has capacity, or under another login, and do not
    patch, triage or report such an ending as a failure. A generic 429, a timeout or a crash that
    names no limit is investigated.

**In `comparison-reading`, section 8** (`rules.md`): each rule's reasons and edges.

## 9. Status, evidence and claims

A claim is only as good as the evidence under it, so before any sentence says that something
improved, read `attribution-and-proof`.

### The ladder

Never use "built" or "done" as a status. A statement names one of these levels, and no level stands
in for the next:

- Planned;
- Present in source (at a commit, with its live reader);
- Proved without a model (a test with its nearest hostile case, a replay or a rehearsal);
- Exercised live (an event in a real run's log);
- Shown in an outcome (a reading that moved, repeated on fresh solves);
- Withdrawn (with the reason).

`docs/plan.md` keeps each part's level, a pull request names the level it moves, and nothing else
keeps a status list.

### Evidence

```text
events in a campaign's log  >  a fold over the log  >  source and tests  >  a command's printed line
                            >  a pull request's text  >  an agent's account
```

A prompt establishes what text is delivered. A test establishes behaviour under its tested
conditions. A rehearsal uses scripted seats and no Referee, so it establishes that the path runs.
None establishes better model behaviour. A suite says nothing about the other operating system's
wall. A Referee's ruling is a model's output, kept apart from verdicts, and a session's or
subagent's report is a lead until it is checked (section 11).

A run is evidence about its own code. Select runs containing the mechanism (`bun run runs source
--has <text>`); text survives a restack that changes commit hashes. A run without the mechanism
supplies no evidence about it. Before claiming that a capability is absent ("nothing checks X"),
inspect its symbol, callers and a relevant check in the same turn.

### What may be claimed

| Claim | Requires |
| --- | --- |
| A step | A comparison that read `step`, named with its condition. It is unqualified only once a later fresh reading holds it |
| No step | The same naming and the test's size. It says nothing about equality |
| A mechanism | The event it writes, in a live run's log, where its trigger occurred |
| A refusal | The refusal's text. It establishes its own condition and nothing about the answers |
| Which part of a harness did it | A comparison against `programs-of:<digest>` |

A `step` holds under its own condition only, not under another deadline, budget, solver or host.
Keep the counts apart (valid answers, rejections by ruling, endings, non-results, tasks set aside),
give every rate its denominator, and never read one campaign's or setting's result against another's
as a gain (`promotion-tuner` sets runs side by side only to describe them).

**In `repository-practice`, section 9** (`evidence-and-claims.md`): what each level needs.

## 10. Runs with a real model

A run with a real model spends the operator's money, so it needs the operator's word, which covers
the runs it names and no others. The skills own the procedures:

| When | Skill |
| --- | --- |
| What to run next; reading what a run showed | `run-improvement-campaign` |
| Testing a path before spending; tuning a seat's prompt | `system-path-simulation` |
| How hard the Examiner's tasks are; tuning its ladder and examples | `examiner-complexity` |
| Starting, continuing, pausing, moving or stopping a run | `run-management` |
| Wording a claim | `attribution-and-proof` |
| Doubting a reading; what a fail was | `whole-run-investigation` |
| Kept harnesses, before a promotion or a handover | `harness-audit` |
| Rethinking the system: its biggest flaws, what to delete, how to harden it | `system-audit` |
| Promotions on record; tuning the rule | `promotion-tuner` |
| A cheap built system against a dear bare one | `compare-systems` |
| Handing runs or a question outside | `zip-run`, `oracle-handover` |

`bun run runs` lists every verb of the run CLI with what it does, and `bun run runs <verb> --help`
prints that verb's options.

Nine conditions hold in all of them:

1. **The worktree is the condition.** A run executes its worktree's source, so start each from a
   clean worktree of its own at a published commit (`runs fresh`, or `git worktree add --detach`),
   and leave its `src/` alone while it lives. A paid seat refuses a main worktree and one holding
   `ana-followed` (`treeFault`, `tools/d2/campaign.ts`).
2. **Prove the path first, without a model**: `harness-builder.ts --dry-run`, `bun run runs replay`
   for a reader, or `bun run runs rehearse` on a seed.
3. **Put one prediction on record before the first solve**, settled by a count (`--predict`). The
   campaign command takes none, so a campaign's goes in the ledger of the session that starts it.
4. **One or two rounds at a time on one host.** A deadline counts elapsed time, which load shifts.
5. **Never open, print or copy the file passed as `--env-file`.**
6. **Do not stop a run to fix it.** Work found while it lives is for the next start.
7. **Read the log's events and the report before any agent's prose.**
8. **Report every attempt that started as spent.**
9. **A measured run opens a fresh project and climbs on its own**, from a prompt, at one commit, to
   a typed ending. Promotions from a seed, fork, stored pack or run continued at another commit
   do not count towards this measurement. Evaluate a fix in a fresh run.

Every seat's commands run behind Seatbelt on macOS or Bubblewrap on Linux, and an unavailable wall
is a typed non-result, never an unconfined run. Seats reach the network; only the verifier's cells
are closed.

**In `repository-practice`, section 10** (`real-model-runs.md`): each condition's owner, `/goal`,
and the wall's start-up test.

## 11. Working in the repository

Use Bun 1.4.4 throughout, with no Node, npm or npx. While editing, run the owning tests through
`bun run test -- <paths>` rather than bare `bun test`. Run at most one full suite per host.
`bun run gate` runs the CI gate. Keep hooks enabled (`bun run hooks:install`); a plain push
checks whitespace and secrets, and marks its head and the pull requests above it pending. `bun run land -- <top>
--sanitize` validates the stack. GitHub Actions runs only `ci.yml`, which `land --merge`
dispatches, since its tests need a machine independent of this one. When you tune CI, prefer to
keep a check here, in the hook, `stack.ts` or `land`, posting its status to GitHub where one should
show (`local-checks`).
Report wall-test failures caused by unavailable user namespaces as failures; do not describe that
suite as passing.

### What you never touch

`.ana/`, `data/runs/`, a pack, a check program, a kept harness, `.env` and any credential, and
installed dependencies. `vendor/` changes only by a **sed**: upstream copied verbatim, with its path
and commit cited and each local change listed.

### The stack and pull requests

Pull requests stack. A release cycle ideally builds one stack and lands it as one chain, so a new
pull request goes on the top of that stack, even where it does not build on the one below it.
Expand the open pull request a change belongs to before opening a new one. Read `stack-pr` before
you branch and again before you push, and read the stack itself each time
(`bun .claude/skills/stack-pr/scripts/stack.ts`), because other sessions move it: the top is the
end of the chain, never its middle. A chain of its own on `main` suits a change that has to land
before the stack, and is worth a word with the operator first. Change another session's pull
request only on the operator's word. Use one worktree per pull request, never `git stash` by hand,
and make every published commit pass alone.

Each pull request needs one importance label and at least one category (`CATEGORIES`,
`tools/runtime/land.ts`). `I0` blocks a release; `I1` protects evaluation validity,
prevents serious run failures or broadly simplifies the tree; `I2` is a bounded improvement;
`I3` covers reporting, wording and convenience. Write an imperative commit subject and explain
the problem, resulting behaviour and evidence in the body. Follow `stack-pr` section 7 for PR
text and update it after a push. Push only your authorised branch, with `--force-with-lease`
when rewriting. Moving your own pull request onto the top of the stack is yours to do; merging,
and restacking other sessions' branches, take the operator's authority. Use
`bun run land -- <top> --merge` to land.

### Reviews and subagents

When using subagents, assign one bounded task to each and launch parallel work together. Each
brief states authority, paths, revision, observed facts, question and whether it is read-only.
Give reviewers the code without prescribing a conclusion. Verify findings against the owner,
callers, tests and newest relevant runs. Report them as confirmed (with events), plausible (with
a test or run that would settle them) or refuted. Act on confirmed findings within the task's
authority.

**In `repository-practice`, section 11** (`working-in-the-repository.md`): the command table, the
hooks, CI's jobs and native stacks. `preflight` prints what a diff owes before a commit: the tests
the static gate picks, `ui:gate`, size and prose findings, and a label.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` before editing code. Add no strict-lint findings and report the
count in the PR. Never disable a rule; answer an incorrect finding through the ledger
(`bun run not-slop`). Production imports `node:` through `src/meta` only. Reuse the
production reader for each fact. Helpers in `.claude/`, `tools/wri/` and `studies/`
may wrap production; production cannot depend on them. Keep files within 800 nonblank lines and
functions within 115. Export only names read by another file. Tests check facts and information
boundaries rather than exact wording.

**In `repository-practice`, section 12** (`code-and-writing.md`): dependencies and the ledger.
`direction` names every import from production into helper code or a test.

## 13. Writing

Write plain, understated British English for a careful colleague who has not read the conversation.

- Lead with the change and a plain verb, and write "X instead of Y" rather than a negation and its
  correction. A title is a short imperative sentence; the body says why a mechanism matters first.
- Give exact results with the axis named ("12 cases passed, 0 failed"), and keep tests,
  observations, estimates and uncertainty apart.
- Use the terms of section 14 in one meaning each, and suffix an ambiguous name ("the Builder
  session b-2").
- No "robust" or "10x", no emoji, exclamation marks or em dashes; identifiers in backticks; absolute
  dates. A head comment says why the code is as it is, with the record and the date.
- A prompt states each fact once, where it belongs; when an interface failure recurs, fix the tool
  instead of adding a sentence.

**In `repository-practice`, section 13** (`code-and-writing.md`): the long form, with examples.

## 14. Terms and map

The fixed terms, each with one meaning, and the full map are in `repository-practice`, section 14
(`terms-and-map.md`). A **held-out task** is scored and never shown to the Builder, a **practice
task** is released and never scored, a **valid answer** passes every check within the limits, the
**reference harness** is the starter until a step is promoted, and a **round** is a Builder session
and then a comparison.

```text
src/meta     runtime owners       src/kernel   log, conditions, verifier, comparison, reports
src/wall     the OS wall          src/agent    one model session      src/tools  shared tools
src/harness  the Built Harness    src/solver   one solve              src/builder, examiner, referee
src/campaign round, admission, decide, opening, words
tools/d2     campaign commands    tools/runs   run registry           tools/wri  run investigation
tools/runtime  lint, test, gate, land, moments  packages/ui  read-only log page  vendor  copied
```
