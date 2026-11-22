# AGENTS.md

Every coding agent loads this file: the system's invariants and a map. Mechanisms live in four
skills numbered like these sections; read the owning one before you change a mechanism or answer a
question about one.

| Task touches | Read first | Prove with |
| --- | --- | --- |
| seats, prompts, the wall, the starter | `design-and-seats` (1 to 3) | `seat-view.ts` and the wall tests it names |
| the campaign loop, admission, practice, endings | `campaign-mechanics` (4 to 6) | `bun run runs replay`, `runs rehearse` |
| readings, scores, the draw, A/A, `decide` | `comparison-reading` (7, 8) | `promotion-tuner`'s replay over the record |
| commits, PRs, checks, claims, writing | `repository-practice` (9 to 14), `tools/oxlint/HABITS.md` | `bun run gate`, `preflight.ts` |

Skill scripts run as `bun .claude/skills/<skill>/scripts/<name>.ts`. `docs/plan.md` owns status;
`docs/v1.md`, `docs/transfer.md` and `studies/` hold v1's record; `tools/runtime/moments.ts`
repeats an area's invariants as a tool call enters it.

**How to take a task.** Carry a request's aim as far as your authority reaches, through checks and
delivery.

1. **Fix the shape, not the instance.** Repair or rewrite the owner whose design let the defect
   through; patch only where the larger change waits on a decision of section 3.
2. **Replay before you change a decision.** Before changing a rule that decides (admission, the
   draw, scoring, practice release, stopping), replay it over `data/runs/` (`promotion-tuner`,
   `system-path-simulation`) and state which recorded decisions it flips. One recent run is an
   anecdote; the archive is the denominator.
3. **Subtract before adding.** Find the code that already does the job (rule 12) and try deleting
   or collapsing a seam before adding a flag, guard, branch, helper or prompt paragraph.
4. **Verify at the source.** State nothing about the tree, a run, the remote or the clock that you
   have not just read there; a summary, your own included, is a lead. Correct a wrong description
   in the change that finds it, and a wrong statement to whoever heard it.
5. **Review yourself hostilely.** Name the strongest objection, the count that would refute the
   change, and the test or mutant that fails before it and passes after.

Resolve routine ambiguity by the most reasonable reading and say what would overturn it; ask only
for missing permission or a section 3 decision, with the result ready, and answer each question
asked. Start the task that runs longest without you first. An audit, review or plan asked for alone
stays read-only. Report the rung reached (section 9) and what is left, counted. Backlog work gets
one file, `docs/backlog/<subject>.md`: the intended changes, then their history in the operator's
words.

**The operator's machines** (hosts, logins, accounts, jobs, caps) are described in the operator's
`CLAUDE.md`, which wins there; its contents, a run's full name included, stay out of every tracked
file, commit message and pull request.

## 1. What Anabasis does

A query names a technical domain, and a campaign builds a **Built Harness** (a harness) for it: the
guide and programs a fixed **solver** model uses on that domain's tasks. Holding the solver
constant attributes any difference to the harness. Every mechanism serves one question:

> Is the new harness better than the reference harness, for this solver, on tasks neither was
> built on?

A comparison answers it (section 7): both harnesses solve the same held-out tasks afresh on terms
logged in advance, a hidden check program decides validity, the Referee rules each rejection, and a
one-sided paired sign-flip test over per-task scores reads a **step** or nothing. A step promotes
the candidate to reference. Whether a cheap solver with a built harness matches a dearer bare one
is a separate evaluation (`compare-systems`).

### The four reported factors

Each change names the factor it moves and the count that shows it; `docs/plan.md` holds the values.

- **Supply**, the precondition: is there gradient? Only an informative task can register an effect
  (`informative`, `src/kernel/compare.ts`); since that is known only after solving, admission counts
  frontier tasks, those the reference has not closed (`comparisonFloor`).
- **1. Climb**: promotions within one campaign (`src/campaign/climb.ts`), each confirmed when its
  epoch's first starter comparison reads the reference above the starter (`confirmed`). The
  milestone, six confirmed promotions in one campaign and then in a second domain, is observed
  only, so no prompt or tool names a count.
- **2. Honesty**: could a gain be noise? An A/A control (the reference against itself) runs beside
  every comparison; bar: no A/A step in the ten after the six promotions (`falseRate`, `barLines`).
- **3. Verdicts**: are the labels right? A Referee ruling carries its evidence; bar, on at least 30
  blind labels, three in four check defects caught and at most one in ten earned rejections voided
  (`clears`, `src/referee/agreement.ts`).
- **4. Economy**: dollars and hours per promotion at list price (`tools/d2/close.ts`, `billOf`,
  `BARS`).

### Trade-offs to keep in view

The traps changes most often fall into; the rest are in `design-and-seats`.

- **The objective against chance**: once validity saturates, the noisier objective decides; say
  which measure carried a step, and read the starter's own A/A beside a reference that ties its own.
  A higher gap floor only moves margin noise and starves supply.
- **Promotion against confirmation**: the starter comparison owed after a promotion runs at the
  Builder's next `compare` (`heldSince`); a Builder comparison that reads first leaves the promotion
  unconfirmed for good (`test/decide-explore.test.ts`).
- **Practice against held-out supply**: a release takes at most half of what is held, so watch the
  frontier near the floor, and read practice gains that held-out comparisons do not repeat as
  overfitting.
- **A strict gate against a capable model**: refuse only what makes a reading dishonest or a spend
  certainly wasted, and give the rest to the seat as a note, since a refusal can end a campaign with
  nothing compared.
- **An outside benchmark against fitting to it**: a benchmark reads transfer, never a step, and the
  query keeps the domain's own scope, never the benchmark's tasks or professions.

### Two sides and one wall

Practice tasks are the Builder's training set and held-out tasks its test set. Leaking held-out
content or per-task outcomes would let the Builder fit the test set, so practice results guide
development and never measure improvement. The wall is asymmetric: the Examiner may read reference
outcomes and each task's winning harness. Only this crosses to the build side:

- the contract's public rules, scope and conventions, the answer format and any declared objective
  (the quantity and its direction);
- the public part of each released (practice) task;
- for a practice solve: its outcome and kind, the solver's trace and, under an objective, the
  verifier's measure of a valid answer and of the task author's best answer on record, which may
  depend on that task's hidden values;
- for each comparison: the tally and the reading, naming no task;
- host limits, the remaining budget and the counts of held-out and practice tasks.

Nothing else crosses: no held-out task or trace, check, hidden value, list of refusing checks,
Referee reason or the move table's choice. The wall is a correctness property, tested byte for byte
(rule 3).

## 2. The stance: code owns the conditions, models own the content

Code owns the workflow and the evaluation: which move may start, every refusal and limit, a solve's
condition, validity, the comparison, the wall, the dollar cap and the log. A model owns the
content: the harness, the solution, the task, whether a rejection was right, why a practice solve
failed and what to change. Code takes what a model cannot observe, what concerns the model itself,
and what must be identical on both sides of a comparison.

1. **Give a model facts, never a course**; told a course, it follows it over the evidence.
2. **Give an author facts instead of a target**: the Examiner hears no number to reach.
3. **Keep the Builder free**, with one limit: no part of a harness names a task, copies its text or
   holds its answer.
4. **Code validates declared structure and never chooses content.**
5. **A reply never sets a score, limit or identity**; where it feeds a decision, code states the
   evidence it must carry.
6. **When in doubt, allow the whole.** Walls protect only hidden values, credentials and each seat's
   files (`SolveDirs`, `src/tools/command.ts`).
7. **Take the simple path to most of the result**, never at the measurement's honesty.

## 3. The seats

Each seat has one job and a closed view:

- **Examiner** (model, `src/examiner/`): drafts the exam from a prompt, then writes tasks; the
  host's gate checks each task's shape and refuses one carrying a planted answer, solving none
  (`propose_tasks`). It reads a view of the log (`src/examiner/record.ts`): reference outcomes and
  each task's winner, never a target or a harness name.
- **Builder** (model, `src/builder/`): edits `harness/`, chooses moves and freezes a harness,
  reading only section 1's list, its notes and the kept harnesses.
- **Solver** (model, `src/solver/`): answers one task with `read`, `bash`, `edit`, `write`,
  `submit` and the harness's programs.
- **Verifier** (code, `src/kernel/verify.ts`): runs each check in a fresh walled cell, offline.
- **Referee** (model, `src/referee/referee.ts`): rules each rejection the host's replay of the
  checks repeats (never a pass, a cut solve or a crash) `earned`, `check-defect` or `unclear`,
  seeing only the exam side.
- **Host** (code): everything section 2 gives to code.

A **harness** is a directory (`agent/tools-spec.json`, `.toolchain/`, the guide
`agent/BUILT_AGENTS.md`) whose digest is its identity. The **Starter Built Harness**
(`src/harness/starter.ts`), pi's coding agent as released with its four tools, is the first
reference and the fixed baseline. The **Starter** (or **bareSolver**) is the solver under it; the
**Starter Pack** is it plus `HARNESS.md`, what a campaign begins from; a **builtSolver** is the
solver under a harness a Builder built. Every solve runs inside a harness, so never write "with or
without a harness".

### What waits for the operator

Seven decisions take the operator's authority:

- freezing or refusing the contract and check program, and admitting a check
  (`tools/c/accept.ts --freeze`, `--admit`);
- labelling drawn rejections blind;
- the dollar cap, and which account pays;
- deciding that a task nobody answers is infeasible;
- promoting a harness (`tools/d2/promote.ts --harness <digest> --yes`; one the rule does not name
  takes `--despite`);
- changing what a solver is given or told: the starter, the shell, a campaign's limits;
- stopping a live run.

Ask with the evidence and a recommendation, and continue independent work. An authorisation lasts
until withdrawn and covers what it names: "keep going" covers none of these, and the word that opens
a cycle covers its runs, their stops and its patches (section 10). What a launch grants by itself
is in `design-and-seats`. Host messages write "a person" only for one of the seven.

## 4. The Harness Builder

One Builder conversation leads the campaign (`tools/d2/harness-builder.ts`) with `examine`,
`compare`, `campaign_status` and `wait`. Beside it one Examiner conversation rests between asks; each
`examine` wakes it, across promotions too, and it closes with the Builder's conversation
(`tools/d2/campaign-actions.ts`). Code enforces endings, releases practice and promotes what a step
names. The Builder makes its own moves and is never told the table's (`src/campaign/decide.ts`).
Three invariants:

- a comparison reads the harness it froze, and a step promotes that one;
- an unchanged harness is compared again only where the move table names it, since a second draw is
  a second chance at a false step;
- an action refused before it begins is no move.

Standing facts go in every tool result, since messages between tool turns never reach the Builder.

## 5. The log

A campaign's record is one append-only, synced file, `.ana/d2/<name>/log.jsonl`
(`src/kernel/log.ts`), and every state and report is a fold over it. A **condition**
(`src/kernel/condition.ts`) names what the host fixes for a solve; two solves compare only where
their conditions differ in the one thing compared.

1. **Add no second store.** A fact needed later is an event.
2. **Add no second reader of one fact.** Find the fold and call it.
3. **Never edit a log or write an event by hand**; move or copy a campaign only with `bun run runs
   copy`, `move` or `retire`, and nothing but `retire` deletes one.
4. **Keep old event kinds readable** (`EVENT_KINDS`).

The log holds hidden values, so it stays out of prompts, PRs and pastes. A copy of a campaign on
another host holds its record and kept harnesses but not what seats installed, so it is read and
never run.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` opens a campaign from a prompt or a stored pack and runs it
unattended to one of seven endings: `budget`, `stop`, `exam`, `no-room`, `environment`, `operator`
or `finished` (three Builder conversations in a row made no campaign move). The operator steers it
with `tools/d2/word.ts`, which no seat reads. The setting fixes the solver, its limits, `--target`
and `--solves`, and a conflicting value is refused. Practice is released from reference solves
only, at most half of what is held, leaving the comparison floor of frontier tasks (`practiceDue`).

**What refuses a move**: comparison admission (`src/campaign/admission.ts`), session admission and
the stop rule, which only `--past-stop "<why>"` passes. A command writes nothing before its last
refusal, but for the harness the Builder's `compare` froze to ask (`build.checkpoint`).

**Defaults** live in one place each, never here: the comparison's size (`SIZE`,
`src/kernel/size.ts`), patience (`PATIENCE`, `src/kernel/reports.ts`), the gap floor and weights
(`GAP_FLOOR`, `WEIGHTS`, `src/kernel/compare.ts`), a solve's limits (`LIMITS`,
`tools/d2/campaign.ts`), and the level, reserve and Builder session in the flag table of
`tools/d2/campaign-terms.ts`.

## 7. How a comparison is read

A comparison logs its terms first, solves both sides afresh and pairs every solve on one side with
every solve on the other, drawing the newest epoch first with one retained task per three frontier
tasks to expose regressions.

**Outcomes** (`src/kernel/solve.ts`): a pass is valid; an earned rejection, an ended limit,
`no-answer`, `broken-harness` or `malformed` is that side's fail; an unruled, `check-defect` or
`unclear` rejection sets the task aside; a `provider`, `sandbox-crash`, `killed`, `moved-files`,
`check` or `verifier` ending is a non-result, retried and never paired.

**Score and test**: a task's score weighs validity, and the objective only between two valid
answers (`pointsOf`, `WEIGHTS`); the bill decides nothing. An exact one-sided sign-flip test on the
nonzero task scores reads a step at the level. Readings are `step`, `no-step` (tested, no effect),
`not-scored` (nothing tested), `check-defects` and `no-change`. The next move comes from `decide`
(`src/campaign/decide.ts`), and six eligible moves without a gain stop a campaign (`stopRule`).

## 8. Rules

1. **The comparison decides, and nothing else does**: no practice result, account, review or suite.
2. **Only the Examiner writes the exam, and nobody coaches it.** No person and no agent writes or
   repairs a rule, check or task, or hand-edits a pack, check program, kept harness or log to make a
   command pass; fix a cross-domain defect in the host, a prompt or the contract code.
3. **Nothing crosses the wall except section 1's list.** Changing a hidden value, a check or which
   held-out task a candidate won leaves every Builder and solver message byte-identical but the
   budget (`test/builder.test.ts`, `test/builder-led.test.ts`, `test/wall-practice.test.ts`). That
   covers prompts, tool descriptions, tool results, home files and the choice of practice tasks, and
   a PR touching such a message says how it checked this.
4. **Terms are fixed before the first solve and never moved after a result**: do not top up a set
   that a dispute thinned, or rerun a finished comparison on other terms.
5. **Both sides are solved afresh under one setting**; no stored solve stands in for a side.
6. **One solve is weak evidence**: a result counts only when repeated solves support it, and one
   shown to an agent says so.
7. **A non-result is never a pass or a fail**; it is solved again and counted nowhere.
8. **A rejection counts only once ruled, and a hand label overrides a ruling.**
9. **No reference answers, no stronger solver, no agent built to find answers.** A check verifies a
   property, and a value the task was generated from is a fact of the task, not an answer.
10. **No agent writes an instrument.** A check's facts come from the field's own pinned tool, and
    one decided by its author's computation is a fault until the operator admits it (`--admit`, or
    `--admit-authored` at a launch).
11. **The host owns every limit**; a file that asks for more time, turns or disk changes nothing.
12. **One owner per decision and one reader per fact**; where two decide one thing, name both and
    remove one.
13. **Add machinery only on evidence, and rewrite rather than add**: `owner → live reader → decision
    it changes → evidence → hostile test`. Prefer deleting a seam or widening an owner to a new
    branch, option or prompt paragraph; a new reading reports only, until a replay over the record
    shows which decisions it would change. A superseding change deletes what it replaces or names
    under "Not done" what still reads it, and a PR adding over 50 production lines says why no
    existing surface could be simplified instead.
14. **Stop when nothing can be learned**: refuse a launch that cannot give a result before paying,
    and do not remeasure a dead provider because budget remains.
15. **Credit and session limits are expected, not defects**: continue from the log at the run's own
    commit once a login has room, or under another login, and do not patch, triage or report such an
    ending as a failure; investigate a 429, timeout or crash that names no limit.

## 9. Status, evidence and claims

Read `attribution-and-proof` before claiming an improvement. Never write "built" or "done"; name one
rung of the ladder, none standing in for the next: planned; present in source (commit and live
reader); proved without a model (a bounded check or property, a replay or a rehearsal);
exercised live (an event in a real run's log); shown in an outcome (a reading that moved, repeated
on fresh solves); withdrawn (with the reason). `docs/plan.md` keeps each part's level.

```text
events in a campaign's log  >  a fold over the log  >  source and tests  >  a command's printed line
                            >  a pull request's text  >  an agent's account
```

The order ranks what you say as well as what you read: your answer, a cause you offer and a
subagent's report are an agent's account until something higher backs them. Take a count from the
fold that owns it, and give a cause as a hypothesis with the count that would refute it. A test or
rehearsal shows a path works, never better model behaviour, and a suite says nothing of the other
operating system's wall. A run is evidence about its own code (`bun run runs source --has <text>`).
Before claiming something is absent, inspect its symbol and callers.

| Claim | Requires |
| --- | --- |
| A step | A comparison that read `step`, named with its condition; unqualified once a later fresh reading holds it |
| No step | The same, with the test's size; it says nothing about equality |
| A mechanism | Its event in a live run's log, where its trigger occurred |
| A refusal | The refusal's text, which proves its own condition only |
| Which part of a harness did it | A comparison against `programs-of:<digest>` |

Keep counts apart, give every rate its denominator, and never read one campaign's or setting's
result against another's as a gain: a change over the weeks is read between groups of fresh runs,
each difference against the spread between runs (`promotion-tuner`, `scripts/trend.ts`).

## 10. Runs with a real model

A real-model run spends the operator's money and needs their word for the runs it names. Its seats
run behind Seatbelt or Bubblewrap, and an unavailable wall is a typed non-result, never an
unconfined run. Skills own the procedures, from `run-improvement-campaign` and `run-management` to
`whole-run-investigation`; `bun run runs` lists the verbs.

1. **The worktree is the condition.** Start each run from a clean worktree of its own at a
   published commit (`runs fresh`) and leave its `src/` alone while it lives; a paid seat refuses a
   main worktree or one holding `ana-followed` (`treeFault`).
2. **Prove the path first without a model** (`--dry-run`, `runs replay`, `runs rehearse`).
3. **Record one prediction, settled by a count that can fall either way, before the first solve.**
4. **One or two rounds at a time on one host**, since load shifts deadlines; `runs fresh` without
   `--host` places a run by login use and load (`leastOccupied`).
5. **Never open, print or copy the file passed as `--env-file`.**
6. **Do not stop a run to fix it**; the fix goes on the stack and reaches the next fresh runs.
7. **Read the log's events and the report before any agent's prose**, your own earlier account too.
8. **Report every attempt that started as spent.**
9. **A measured run opens a fresh project and climbs on its own** from a prompt at one commit;
   promotions from a seed, fork, pack or another commit do not count.

**Which domains.** Jobstat is the domain v1.0 is built towards and always has a live run; buffer is
the control, read against its runs of two to four weeks before. A change that holds on both
plausibly generalises, and a regression in another domain is traced to its change and repaired.

**The outside aim.** At each pause from its second promotion on, a jobstat run's newest reference is
read on JobBench under its own judge, without a question, against the Starter, stock Claude Code
and Harness²'s held-out arm. Read a deficit as a difference in conditions first, and one inside the
Starter's spread between rollouts as no reading (`run-improvement-campaign`, "The outside aim").

**Between the operator's words.** In a cycle, pause a live run that reached its trigger after its
next comparison, investigate it, put the fix on the stack and fork fresh runs at its head within the
cycle's grants, parking none of it behind a question. Other stops, section 3's decisions and every
merge stay the operator's. Wake on events (`runs alerts`, `runs pulse`), not the clock.

## 11. Working in the repository

Use the Bun `package.json` pins and no Node, npm or npx, and keep hooks enabled. Run owning tests with
`bun run test -- <paths>` while editing and `bun run gate` once at the change's top; the check
runner places each on the fleet (`local-checks`), and GitHub Actions runs only `ci.yml`.

### What you never touch

`.ana/` (but for `.ana/wri/`, where an investigation and a cycle keep their own files),
`data/runs/`, a pack, a check program, a kept harness, `.env` and any credential, and installed
dependencies. `vendor/` changes only by a **sed**: upstream copied verbatim, with its path and
commit cited and each local change listed.

### The stack and pull requests

PRs stack, and a release lands one chain: **small** (`0.x.y+1`) for any chain whose proof passes,
**big** (`0.x+1.0`) only for a mechanism exercised live at the top and a factor's count that moved
against the last big release's runs by more than the spread between runs. Which runs compare is
read from each run's commit (`bun run runs source`), never from the version.

Read `stack-pr` and the stack (`bun .claude/skills/stack-pr/scripts/stack.ts`) before you branch and
again before you push, since other sessions move it. Expand the open PR a change belongs to (a
follow-up to the same problem is a commit appended to that PR, with what sits above it restacked and
pushed with `--no-verify`, other sessions' PRs included), or put a new one on the top: push its
branch, open it with `gh pr create --draft --base <top's branch>` and run `bun run land -- <new top>
--sanitize`, which links the whole chain into GitHub's native stack (`gh stack link`), the unit
`land --merge` merges. A base alone leaves a PR outside that stack, and a base in the middle of one
forks it. A sanitize proves the whole chain from `main`, reusing every remembered pass; `--from
<pull request>`, which proves only the commits from that PR up and turns no head mergeable, is used
on the operator's word. Moving your own PR onto the top is yours; another session's PR, worktree or
run changes only on the operator's word, but for replaying its commits unchanged above your own.
One worktree per PR, no `git stash` by hand, and every commit passes alone. Each PR carries a
category (`CATEGORIES`, `tools/runtime/land.ts`) and the highest importance label whose test it meets:

- `I0`: results are already wrong or unsafe (a reading or promotion computed wrong, the wall
  crossed, answers lost, a credential exposed, spend past its cap, `main` failing its gate); live
  runs should pause until it lands. About one PR in 50.
- `I1`: corrects a defect in what a campaign decides, measures or shows a seat (admission,
  practice release, supply, the draw, the climb, the comparison, the Referee, the wall); protects
  validity before a result goes wrong; prevents a crash, stall, lost session, wasted spend or a run
  ended by a fault it could recover from; or removes a whole mechanism.
- `I2`: any other change to production code, a prompt or the run and landing tools, including a
  simplification that removes code.
- `I3`: reporting, wording, comments, documentation and skill prose, or tests alone.

Between two levels, take the higher: a label read too low hides a fix from the review and the
landing order it deserves.

Push only your authorised branch, with `--force-with-lease` when rewriting, and read back at the
remote what you published (the heads, and the counts and commits a body cites) before reporting
it. Merging is the operator's; before `bun run land -- <top> --merge` the landing is reviewed
through three lenses (`stack-pr`, section 9), and confirmed findings go on the stack before
`--sanitize` runs again.

**Shell commands.** A guard reads each command before it runs: write it plainly, use the form a
refusal names (`repository-practice`, "Commands a guard reads"), write files with the editing tools
and run any script longer than a line from a file. Move unwanted files to the Trash by explicit
path instead of `rm -r`; leave branches, shell profiles, ssh configuration and env files alone.

### Reviews and subagents

Give each subagent one bounded task (authority, paths, revision, facts, the question, read-only or
not) and give reviewers code instead of a conclusion. Hold a reviewer to exact counts with
denominators and `file:symbol` references, and reject machinery it proposes without showing that a
subtraction fails. A change under about a hundred production lines is quicker made than briefed,
and a decision that reconciles two invariants stays with you. A report is an agent's account
(section 9): check each finding at the source and report it as confirmed (with events), plausible
(with what would settle it) or refuted.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` first. Add no strict-lint findings and never disable a rule: a finding
wrong about one site is answered in `bun run not-slop`, one wrong about a kind of site is the rule's
defect. Production imports `node:` only through `src/meta`. Keep files within 800 nonblank lines and
functions within 115, and export only names another file reads.

### Tests

A test states an outcome over a space of inputs rather than one example, so that a defect nobody
imagined still falls inside it. In order of preference: every input up to a small bound, against the
owner's stated rule or an independent count (`test/compare-exhaustive.test.ts`); a search over
reachable states with invariants that span moves (`test/decide-explore.test.ts`); a seeded generator
over raw events that counts each branch it reached (`test/pairs-property.test.ts`); and a named
example only for a flow across a process, file or provider boundary, or a refusal's nearest hostile
case. Pin each measured constant (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once, as the protocol.
Delete or replace a test only against mechanical mutants of its owner (commit-r, step 8): a mutant
the old tests killed that the new ones and the kept suite miss returns as a case or is answered as
incidental. A bounded check stays within about ten seconds on one host, through a symmetry or a
canonical state before a smaller bound. Test facts rather than wording, through the live path. A
check counts once it ran over the whole change and its exit code was read, which a pipe hides; a
failure that passes alone is a lead, and a wall test failing for want of user namespaces is a
failure.

### Where a reader or a helper lives

Search by what code does, not by its name, and fold a surface spelt twice into its owner (rule 12).
A guard, timer or recurring check goes once it has fired on nothing or costs more than the defect it
guards. Place the rest by the first row that fits:

| Who reads it | Where it lives |
| --- | --- |
| a campaign, a `bun run` verb, a local job or the UI | production: a fold in `src/` (one reader per fact, section 5), or the command's own folder under `tools/` |
| an investigation of one campaign, in depth from its log, reached through `wri.ts` | `tools/wri/` |
| the scripts of two or more skills, or a reading across campaigns | `.claude/skills/main/`, a library with no command of its own (`cli.ts`, `logs.ts`, `runs.ts`, `print.ts`, `stats.ts`) |
| one skill's procedure | that skill's `scripts/` |

A helper layer may import production, never the reverse (`direction.ts`), and reads a fact through
the production fold that owns it; where production lacks the part, the part moves into production.

## 13. Writing

Write plain, understated British English for a careful colleague who has not read the conversation.
The register is a short research paper's: connected sentences that explain why, in the vocabulary
of machine learning where it fits (baseline, held-out set, noise, power, effect), never the clipped
one-clause fragments of a controlled-language manual. Write less: cut what restates, hedges or
retells history until each sentence carries a fact or a reason, and read a mechanism that resists
a short explanation as a lead that the mechanism is overbuilt.

- Answer first; then lead with the change and a plain verb, "X instead of Y" rather than a negation.
- Give exact results with the axis named, and keep tests, observations and estimates apart.
- Use section 14's terms in one meaning each.
- No "robust", emoji, exclamation marks or em dashes; identifiers in backticks; absolute dates.
- A prompt states each fact once and is tuned by rewriting a few sentences instead of adding to it;
  when an interface failure recurs, fix the tool.
- A skill or this file says how things are now, with each intent in one place and each default in
  its code; history goes to commits, PRs, the backlog or a head comment.

## 14. Terms and map

A **held-out task** is scored and never shown to the Builder; a **practice task** is released and
never scored; a **valid answer** passes every check within the limits; the **reference harness** is
the starter until a step is promoted; a **round** is a Builder session then a comparison. The full
glossary is in `repository-practice`, section 14 (`terms-and-map.md`).

```text
src/meta     runtime owners       src/kernel   log, conditions, verifier, comparison, reports
src/wall     the OS wall          src/agent    one model session      src/tools  shared tools
src/harness  the Built Harness    src/solver   one solve              src/builder, examiner, referee
src/campaign round, admission, decide, opening, words
tools/d2     campaign commands    tools/runs   run registry           tools/wri  run investigation
tools/runtime  lint, test, gate, land, moments  packages/ui  read-only log page  vendor  copied
.claude/skills  the procedures and their scripts  .claude/skills/main  the scripts' shared library
```
