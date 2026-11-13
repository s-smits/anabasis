# AGENTS.md

Every coding agent loads this file. It holds the system's invariants and a map; mechanisms live in
skills, and the adjacent `CLAUDE.md` belongs to the operator. Four skills expand these sections
under the same numbers: `design-and-seats` (1 to 3), `campaign-mechanics` (4 to 6),
`comparison-reading` (7 and 8) and `repository-practice` (9 to 14). Read the owning skill before you
change a mechanism or answer a question about one: its `SKILL.md` indexes its references by section,
and its scripts run as `bun .claude/skills/<skill>/scripts/<name>.ts`. `tools/oxlint/HABITS.md` owns
how code is written and `docs/plan.md` status; `docs/v1.md`, `docs/transfer.md` and `studies/` hold
v1's record. `tools/runtime/moments.ts` gives each area's invariants before a tool call enters it.

**How to take a task.** Read a request for its aim and carry it as far as your authority reaches. A
defect is usually one case of a shape, so repair or rewrite the owner whose design let it through;
the small patch is for where the larger change waits on a decision of section 3. Begin from what the
tree holds: find the code that already reads the fact or does the job (rule 12), and remove what
your change makes redundant. State nothing about the tree, a run, the remote or the clock that you
have not just read at its source: check a description against the source at the stack's head and
correct it in the change that finds it wrong, verify a finding before acting on it, and correct a
wrong statement to whoever heard it. Resolve routine ambiguity by the most reasonable reading and
report the choice with what would overturn it; ask only for missing permission or a decision of
section 3, with the result ready, and answer each question asked. Carry authorised work through
checks and delivery, and report it against the aim: the rung reached (section 9) and what is left,
counted. An audit, review or plan asked for on its own stays read-only. Backlog work gets one file,
`docs/backlog/<subject>.md`: the intended changes, then their history in the operator's words.

**The operator's own machines.** What is true only on the operator's machines (hosts, logins,
accounts, local jobs, check runners and the caps they set) lives in a local skill,
`operator-machines`, which Git ignores and nothing publishes. Where present, read it before the
first command; on those machines it wins over this file. Keep its contents out of every tracked
file, commit message and pull request, a run's full name included, since it ends in its host.

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

- **Supply**, the precondition: is there gradient? Only an informative task can register an
  effect: one the reference answers in some solves only, fails in every solve while a valid answer
  is on record, or answers every time while an answer on record beats one of its own by at least the
  gap floor (`ROOM`, 1%; `informative`, `src/kernel/compare.ts`). Which tasks are informative is
  known only once they are solved, so admission counts frontier tasks instead, those the reference
  has not closed, and needs eight at the default level (`comparisonFloor`).
- **1. Climb**: promotions within one campaign (`src/campaign/climb.ts`). A promotion is confirmed
  when the first starter comparison of its epoch that tallied a task reads the reference above the
  starter at its level (`confirmed`). The milestone, six confirmed promotions in one campaign and
  then in a second domain, is observed only, so no prompt or tool names a count. Runs carry no cap;
  one is paused only after its latest promotion's starter comparison has reported.
- **2. Honesty**: could a gain be noise? An A/A control (the reference against itself) runs beside
  every comparison, and one reading clears between equal harnesses at most at the level
  (`falseRate`). Bar: no A/A step in the ten after the six promotions (`barLines`).
- **3. Verdicts**: are the labels right? A Referee ruling must carry its evidence (`earned`: the
  broken rule, a rejecting check and a probe that moved it; `check-defect`: a refusing check and a
  probe that moved it). Bar, on at least 30 blind labels (`clears`, `src/referee/agreement.ts`):
  catch three in four check defects and void at most one in ten earned rejections.
- **4. Economy**: what did each gain cost? `tools/d2/close.ts` reads dollars and hours per
  promotion from the log at list price (`billOf`, `src/kernel/meter.ts`), against a reported bar
  of at most 3 promotion attempts per epoch (`BARS`).

### Trade-offs to keep in view

- **Task difficulty against statistical power**: tied tasks leave the test, and a step is likeliest
  where the reference passes 30 to 50%; watch its valid share and the untied tasks a comparison.
- **A stricter step against a faster climb**: 2 solves at 0.02 is the balance; an A/A step means the
  level is loose for the noise, and a faster climb is a gain only where its promotions hold.
- **The objective against chance**: once validity saturates, the noisier objective decides; say
  which measure carried a step. A reference that answers each task alike ties its own A/A and reads
  no false rate, so read the starter against itself beside it (`barLines`). A higher gap floor
  (`ROOM`) is no remedy for margin noise: it moves the noise to the next margin and starves supply.
- **Promotion against confirmation**: the host owes one starter comparison after every promotion and
  runs it at the Builder's next `compare` (`heldSince`, `src/campaign/decide.ts`). Before the table
  owes it, while too few tasks are held out since the promotion, a Builder's own comparison can read
  first, and its step leaves that promotion unconfirmed for good (`test/milestone-walk.test.ts`).
- **Cost against value**: read dollars per promotion and per confirmed promotion on one meter
  (`promotion-tuner`), and dollars a solve rising without validity gains as bloat.
- **Supply against the clock**: an Examiner that aims higher takes longer and admits fewer; read
  hours to the next comparison beside the tasks it admitted.
- **Practice against held-out supply**: a release takes at most half of what is held; watch the
  frontier near the floor.
- **Builder freedom against overfitting practice**: practice gains that held-out comparisons do not
  repeat are the sign.
- **Patience against stopping too soon**: six eligible moves without a gain end a campaign, and
  each move after is another draw at the false rate; treat a step after `--past-stop` warily.
- **A promotion against the starter**: a promotion beats its parent on the tasks that chose it, and
  a near-sweep of one family from the newest session says less than the same tally over several. The
  starter comparison after it splits its tally by where each task came from (`starterReads`), and a
  reference that keeps losing the tasks written since is fitting its own draws, not climbing.
- **Deciding sooner against reporting first**: a new reading reports and moves nothing until a
  replay over the record (`promotion-tuner`) shows which decisions it would have changed; a reading
  that decides at once is a second decider the comparison never measured (rule 1).
- **A strict gate against a capable model**: a refusal guesses the comparison and can end a campaign
  with nothing compared; refuse only what makes a reading dishonest or a spend certainly wasted, and
  give the rest to the seat as a note.
- **The objective against the habits it leaves unpaid**: a harness learns only what the checks and
  the objective reward, so a habit no check holds, a section's content for one, is no lever yet.
- **An outside benchmark against fitting the query to it**: a benchmark reads transfer, never a
  step. A query that names the benchmark's tasks or professions fits the exam to its scoring set, so
  the query keeps the domain's own scope and the benchmark's other tasks are reported apart.
- **A tuned query against its origin**: a query adapted from another system's prompt is bounded, in
  words, against that origin instead of its last version, so that drift does not accumulate.

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
- host limits, the remaining budget, the counts of held-out and practice tasks, and the move
  table's fixed advice.

Nothing else crosses: no held-out task or trace, check, hidden value, list of refusing checks or
Referee reason. The wall is a correctness property, tested byte for byte (rule 3).

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
  `submit` and the harness's tools.
- **Verifier** (code, `src/kernel/verify.ts`): runs each check in a fresh walled cell, offline.
- **Referee** (model, `src/referee/referee.ts`): rules each rejection the host's replay of the
  checks repeats (never a pass, a cut solve or a crash) `earned`, `check-defect` or `unclear`,
  seeing only the exam side.
- **Host** (code): everything section 2 gives to code.

A **harness** is a directory (`agent/tools-spec.json`, `.toolchain/`, the guide
`agent/BUILT_AGENTS.md`, `agent/tools.ts`) whose digest is its identity. The **Starter Built
Harness** (`src/harness/starter.ts`) is the first reference and the fixed baseline. Every solve runs
inside a harness, so never write "with or without a harness".

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
a cycle covers its runs, their stops and its patches (section 10). A launch gives three words once
(freeze a fault-free exam, `--admit-authored`, promote what the rule names), which `--hitl` hands
back; a launch on a numbered login lets the run's keeper pick the paying account at a limit
(`keepsItself`, `tools/runs/manage.ts`). Host messages write "a person" only for one of the seven.

## 4. The Harness Builder

One Builder conversation leads the campaign (`tools/d2/harness-builder.ts`) with `examine`,
`compare`, `campaign_status` and `wait`, beside one Examiner conversation. Code enforces endings,
releases practice and promotes what a step names. Three invariants:

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
   copy`, `move` or `retire`.
4. **Keep old event kinds readable** (`EVENT_KINDS`).

The log holds hidden values, so it stays out of prompts, PRs and pastes. `bun run runs retire`
moves a campaign idle for a day into `data/runs/`, deletes an idle seed that no paid launch went on
from, and takes a campaign archived on the host `ABLATION_HOST` names into the central archive,
deleting it there once the copy matches byte for byte; nothing else deletes a log. A copy of a
campaign on another host holds its record and each kept harness's own files, never the packages a
seat installed (`installs`, `tools/runs/snapshots.ts`), so it is read and never run.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` opens a campaign from a prompt or a stored pack and runs it
unattended to one of seven endings: `budget`, `stop`, `exam`, `no-room`, `environment`, `operator`
or `finished` (three Builder conversations in a row made no campaign move). Its budget is one total,
and it ends once less is left than one solve's reserve, or than the next comparison's test costs at
what its solves billed. Each solve waits in the solve queue for the
host's load, at most half an hour (`--loaded` skips it, `campaign.waited` records it). The operator
steers it with `tools/d2/word.ts`, which no seat reads. The setting fixes the solver, its limits,
`--target` and `--solves`; a conflicting value is refused. Practice is released from reference
solves only (`releaseOrder`), at most half of what is held, and every release after the first
leaves at least the comparison floor of frontier tasks (`practiceDue`).

**What refuses a move**: comparison admission (`src/campaign/admission.ts`), session admission and
the stop rule, which only `--past-stop "<why>"` passes. A command writes nothing before its last
refusal, so a refused move leaves the log as it was, but for the harness the Builder's `compare`
froze to ask for it (`build.checkpoint`), which the table then names as not yet compared.

**Defaults**: 24 scored tasks; 2 solves a side (`SIZE`); level 0.02; improvement and supply
patience of 6; gap floor 1% (`ROOM`); a stop after more than 3 tasks with a check defect; a reserve
of 3 dollars a solve; a solve of 20 turns, 30 minutes and 24 prompts (`LIMITS`,
`tools/d2/campaign.ts`); a Builder session of 24 hours and 300 turns.

## 7. How a comparison is read

A comparison logs its terms first, solves both sides afresh and pairs every solve on one side with
every solve on the other, drawing the newest epoch first with one retained task per three frontier
tasks to expose regressions.

**Outcomes** (`src/kernel/solve.ts`): a pass is valid; an earned rejection, an ended limit,
`no-answer`, `broken-harness` or `malformed` is that side's fail; an unruled, `check-defect` or
`unclear` rejection sets the task aside; a `provider`, `sandbox-crash`, `killed`, `moved-files`,
`check` or `verifier` ending is a non-result, retried and never paired.

**Score and test**: validity weighs 0.6 and the objective 0.3 (`pointsOf`, `WEIGHTS`), the
objective only between two valid answers and tied within 1%; the bill decides nothing. An exact
one-sided sign-flip test on the nonzero task scores reads a step at the level (6 to 0 or 8 to 1 at
0.02 with equal margins). Readings are `step`, `no-step` (tested, no effect), `not-scored` (nothing
tested), `check-defects` and `no-change`.

**The next move** comes from `decide` (`src/campaign/decide.ts`), whose nine rows run from `stop` to
`build`. The host releases owed practice (`practiceDue`) as tasks are held out, as an Examiner
session ends, as a conversation opens on tasks held since the last release, and after a reading
that promoted nothing, which is owed one task where nothing was held out since the last release.
Six eligible moves without a gain stop a campaign (`stopRule`).

## 8. Rules

1. **The comparison decides, and nothing else does**: no practice result, account, review or suite.
2. **Only the Examiner writes the exam, and nobody coaches it.** No person and no agent writes or
   repairs a rule, check or task, or hand-edits a pack, check program, kept harness or log to make a
   command pass; fix a cross-domain defect in the host, a prompt or the contract code.
3. **Nothing crosses the wall except section 1's list.** Changing a hidden value, a check or which
   held-out task a candidate won leaves every Builder and solver message byte-identical but the
   budget (`test/builder.test.ts`, `test/builder-led.test.ts`). That covers prompts, tool
   descriptions, tool results, home files and the choice of practice tasks, and a PR touching such
   a message says how it checked this.
4. **Terms are fixed before the first solve and never moved after a result**: do not top up a set
   that a dispute thinned, or rerun a finished comparison on other terms.
5. **Both sides are solved afresh under one setting**; no stored solve stands in for a side.
6. **One solve is weak evidence**; in v1 a fail repeated on the same bytes 5 times in 21, so a
   result counts only when repeated solves support it; say so wherever one is shown to an agent.
7. **A non-result is never a pass or a fail**; it is solved again and counted nowhere.
8. **A rejection counts only once ruled, and a hand label overrides a ruling**; in v1, 36 of 47
   rehearsal misses came from a faulty check.
9. **No reference answers, no stronger solver, no agent built to find answers.** A check verifies a
   property, and a value the task was generated from is a fact of the task, not an answer.
10. **No agent writes an instrument.** A check's facts come from the field's own pinned tool, and
    one decided by its author's computation is a fault until the operator admits it (`--admit`, or
    `--admit-authored` at a launch).
11. **The host owns every limit**; a file that asks for more time, turns or disk changes nothing.
12. **One owner per decision and one reader per fact**; where two decide one thing, name both and
    remove one.
13. **Add machinery only on evidence, and rewrite rather than add**: `owner → live reader → decision
    it changes → evidence → hostile test`; a superseding change deletes what it replaces or names
    under "Not done" what still reads it.
14. **Stop when nothing can be learned**: refuse a launch that cannot give a result before paying,
    and do not remeasure a dead provider because budget remains.
15. **Credit and session limits are expected, not defects**: continue from the log at the run's own
    commit once a login has room, or under another login, and do not patch, triage or report such an
    ending as a failure; investigate a 429, timeout or crash that names no limit.

## 9. Status, evidence and claims

Read `attribution-and-proof` before claiming an improvement. Never write "built" or "done"; name one
rung of the ladder, none standing in for the next: planned; present in source (commit and live
reader); proved without a model (a test with its nearest hostile case, a replay or a rehearsal);
exercised live (an event in a real run's log); shown in an outcome (a reading that moved, repeated
on fresh solves); withdrawn (with the reason). `docs/plan.md` keeps each part's level.

```text
events in a campaign's log  >  a fold over the log  >  source and tests  >  a command's printed line
                            >  a pull request's text  >  an agent's account
```

The order ranks what you say as well as what you read: your answer to the operator, a cause you
offer for a result and a subagent's report are an agent's account until something higher backs them.
Take a count from the fold that owns it instead of parsing a log by hand, read the remote, the head
and the clock instead of recalling them, and give a cause as a hypothesis with the count that would
refute it. A test or rehearsal shows a path works, never better model behaviour, and a suite says
nothing of the other operating system's wall. A run is evidence about its own code (`bun run runs
source --has <text>`). Before claiming something is absent, inspect its symbol and callers.

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
unconfined run. Skills own the procedures: what to run next and a run's life
(`run-improvement-campaign`, `run-management`); proving a path or tuning a prompt
(`system-path-simulation`, `examiner-complexity`); what a run or a comparison did
(`whole-run-investigation`, `comparison-review`, `harness-audit`); the record across runs
(`promotion-tuner`, `compare-systems`, `system-audit`); a claim (`attribution-and-proof`); a
handover (`zip-run`, `oracle-handover`). `bun run runs` lists the run CLI's verbs.

1. **The worktree is the condition.** Start each run from a clean worktree of its own at a
   published commit (`runs fresh`) and leave its `src/` alone while it lives; a paid seat refuses a
   main worktree or one holding `ana-followed` (`treeFault`).
2. **Prove the path first without a model** (`--dry-run`, `runs replay`, `runs rehearse`).
3. **Record one prediction, settled by a count that can fall either way, before the first solve.**
4. **One or two rounds at a time on one host**, since load shifts deadlines; before placing a run,
   read `bun run runs loadwatch --once`, whose last line orders the machines least loaded first.
5. **Never open, print or copy the file passed as `--env-file`.**
6. **Do not stop a run to fix it**; the fix goes on the stack and reaches the next fresh runs.
7. **Read the log's events and the report before any agent's prose**, your own earlier account too.
8. **Report every attempt that started as spent.**
9. **A measured run opens a fresh project and climbs on its own** from a prompt at one commit;
   promotions from a seed, fork, pack or another commit do not count.

**Which domains to run.** Jobstat is the domain v1.0 is built towards, and buffer is the control:
its runs read against those of two, three and four weeks before, to show that a change did not
regress. One live run is always jobstat; run both, since they are far apart: a change that holds on
both, surgical ones above all, plausibly generalises. Until jobstat climbs, put the effort there;
before v1.0, read the other domains' newest runs against their past ones, find the change behind
any regression and repair it.

**The outside aim.** Each jobstat run's newest promoted reference is also read on JobBench once the
run has promoted twice, started detached and never waited for, or as a run with one promotion
stops, unless its blind audit finds it inferior, under that benchmark's own judge
(`studies/harness2/`), against three baselines kept apart: the bareSolver (the Starter, exported),
stock Claude Code with an empty guide (Harness²'s Base) and Harness²'s held-out arm. The
operator's aims, in order, are a built harness above the bareSolver, level with the held-out arm,
then above it. Read a deficit as a difference in conditions first (what the export carries and tells
the solver, the interpreter and its packages, the day) and as the harness only once those are equal;
a difference inside the Starter's spread between rollouts is no reading, and each arm is rolled
afresh after a change to the export or the scoring. run-improvement-campaign ("The outside aim")
owns the tasks and the read, and `docs/plan.md` the values.

**Between the operator's words.** In a cycle (section 3; `run-improvement-campaign`), read each live
run against its trigger: pause one that has reached it after its next comparison, investigate it,
put the fix on the stack and fork fresh runs at its head within the grants the cycle's ledger
records, parking none of it behind a question; a rehearsal settles a doubt at no cost. A stop no
trigger names, section 3's other decisions and every merge stay the operator's. Wake on events
instead of the clock: `runs alerts` says each new promotion, starter read, ending and stall, and the
anti-stall hook, on by default and paused only on the operator's word, runs `bun run runs pulse`
every 290 seconds and wakes an idle session only on a line worth reading. A timer is for a
judgement no event announces.

## 11. Working in the repository

Use Bun 1.4.4 and no Node, npm or npx. Run owning tests with `bun run test -- <paths>` while editing
and `bun run gate`, the CI gate, once at the change's final top, at most one full suite per host,
away from a live comparison where another host is free. Keep hooks enabled. GitHub Actions runs only
`ci.yml`, so prefer local checks (`local-checks`). A check counts once it ran over the whole change
and its exit code was read, which a pipe hides; a failure that passes alone is a lead to rerun under
load, not yet noise. Report wall-test failures from unavailable user namespaces as failures.

### What you never touch

`.ana/`, `data/runs/`, a pack, a check program, a kept harness, `.env` and any credential, and
installed dependencies. `vendor/` changes only by a **sed**: upstream copied verbatim, with its path
and commit cited and each local change listed.

### The stack and pull requests

PRs stack, and a release lands one chain. Expand the open PR a change belongs to, or put a new one
on the top. Read `stack-pr` and the stack (`bun .claude/skills/stack-pr/scripts/stack.ts`) before
you branch and again before you push, since other sessions move it. Moving your own PR onto the top
is yours; another session's PR, worktree or run changes only on the operator's word. Use one
worktree per PR, never `git stash` by hand, and make every commit pass alone. Each PR carries one
importance label (`I0` blocks a release; `I1` protects evaluation validity, prevents serious run
failures or broadly simplifies the tree; `I2` is a bounded improvement; `I3` covers reporting,
wording and convenience) and a category (`CATEGORIES`, `tools/runtime/land.ts`). Push only your
authorised branch, with `--force-with-lease` when rewriting, and read back at the remote what you
published (the heads, and the counts and commits a body cites) before reporting it. Merging and
restacking others' branches are the operator's; before `bun run land -- <top> --merge`, three
reviewer subagents read the whole landing, each through one lens (stack-pr, section 9), and their
confirmed findings go on the stack before `--sanitize` runs again.

**Commands that run the first time.** A shell command runs only where its effect can be read before
it runs, so write it plainly, and where a guard refuses one, write the form it names, never a
variant that slips past. Write a file with the file-editing tools instead of `>` or
`cat > <file> <<EOF`, keeping `>` for a new scratch file under the temporary directory at a literal
path. Put a script longer than a line in a file and run it (`python3 -I <file>`, `bun <file>`)
instead of piping text to an interpreter; a short heredoc quotes its delimiter (`<<'EOF'`) and holds
no `$(...)`, backtick or `${...}`. Quote every expansion and glob, and give `mv` and `git -C`
literal paths. Read an older file with `git show <ref>:<path>` instead of
`git checkout <ref> -- <path>`, `git restore` or `git reset --hard`; deleting branches is the
operator's. Move what is unwanted to the Trash by explicit paths instead of `rm -r`, and leave shell
profiles, ssh configuration and env files alone.

### Reviews and subagents

Give each subagent one bounded task, stating authority, paths, revision, facts, the question and
whether it is read-only, and give reviewers code instead of a conclusion. Hand over a survey or a
large change early; one under about a hundred production lines is quicker made than briefed. A
report is an agent's account (section 9): check each finding against the source or the log before it
moves anything, and overrule or brief again a lane that adds machinery where less would do. Report
each finding as confirmed (with events), plausible (with what would settle it) or refuted.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` first. Add no strict-lint findings and never disable a rule. A finding
wrong about one site is answered as `HABITS.md` says for its rule (`bun run not-slop`); one wrong
about a kind of site is the rule's defect, tuned with a fixture for each side instead of site by
site. Production imports `node:` only through `src/meta`. Keep files within 800 nonblank lines and
functions within 115, export only names another file reads, and test facts rather than wording.

### Where a reader or a helper lives

Before writing code, search by what it does instead of by its name, since a second reader often has
another name. Two scripts that group the same rows, two tables of one option and a private copy of a
production fold are each one surface spelt twice (rule 12): fold them into the owner, and delete
what the record shows nothing invokes (`simplify`, shape H1). A guard, timer or recurring check
answers rule 13's map too, and goes once it has fired on nothing or costs more at each firing than
the defect it guards. Place the rest by who reads it, taking the first row that fits:

| Who reads it | Where it lives |
| --- | --- |
| a campaign, a `bun run` verb, a local job or the UI | production: a fold in `src/` (one reader per fact, section 5), or the command's own folder under `tools/` |
| an investigation of one campaign, in depth from its log, reached through `wri.ts` | `tools/wri/` |
| the scripts of two or more skills, or a reading across campaigns | `.claude/skills/main/`, a library with no command of its own: arguments (`cli.ts`), log discovery (`logs.ts`), one row a run (`runs.ts`), tables (`print.ts`), the permutation test between groups of runs (`stats.ts`) |
| one skill's procedure | that skill's `scripts/` |

Production leads wherever a helper shares its function. A helper layer (`tools/wri/`, `main/`, a
skill's `scripts/`) may import production and the other layers, never the reverse, and reads a fact
through the production fold or primitive that already reads it instead of keeping a copy. Where both
do one thing, production's version is the owner and the helper calls it; where production lacks the
part, or needs what a helper reads, that part moves into production (`direction.ts`). So no
`bun run` verb lives in a skill's `scripts/`, a script a job runs only prints what production
computes, and a second command that prints another view of a fold becomes a view of its owner. A helper that gains a caller in a second
skill moves to `main/` instead of being copied, and `main/` imports no skill's `scripts/`.

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
- A skill says how things are now, with each intent in one place and no finding since overtaken;
  history goes to commits, PRs, the backlog or a head comment.

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
