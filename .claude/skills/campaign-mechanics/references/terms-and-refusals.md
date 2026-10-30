Read this for campaign terms, practice release, admission and defaults. This expands the second half
of `AGENTS.md` section 6; the commands are in `campaign-command.md`.

## 6. A campaign's commands (continued)

### What the log records of a campaign's conditions

**The opening** (`campaign.opened`) keeps what the campaign runs by, so its command can continue by
name alone: the project, the total and the reserve, the full limit of a solve, the Builder sessions
before the table advises a comparison (`--sessions`, 2), improvement and supply patience
(`--patience`, 6 each), who sits in each seat, and the terms of its moves as a command last named
them (`TERMS`, `src/campaign/opening.ts`). An unspecified term uses its default. Later invocations
inherit recorded terms unless an explicit override records a replacement. These terms are the
operator's conditions.

**The project groups campaigns** (`--project`: letters, digits, `.`, `_`, `-`).
The opening requires one. Later invocations inherit it and cannot substitute another
(`projectOf`, `tools/d2/campaign.ts`). It organises the operator's page without affecting
campaign decisions or seat messages. Campaigns run only through commands 0–7 have no project.

**The setting** (`campaign.setting`, `tools/d2/setting.ts`) is recorded once, by the first command
that begins a comparison or a Builder session, and never changes. The first command records what it
names and the defaults for the rest: who solves and under which limits (`--solver`,
`--solver-effort`, `--solver-window`, `--solve-minutes`, `--solve-model-turns`), the held-out
tasks a comparison draws (`--target`) and the solves a side (`--solves`). A command whose flag names
something else is refused with both values: a different setting is a different campaign, and no
solve on record counts for a different solver. A log with solves from before any setting is held to
the one its last test-side solves ran under (`firstRecord`). `--solver-window`, 300,000 tokens by
default, is where the solver's Claude Code compacts; a model served with a 200K context, such as
`claude-haiku-5-5`, is refused at it.

**Practice follows the supply and the outcomes.** A release takes at most half of what is held.
`--practice` is owed again after each reading, a comparison's report or a promotion (`practiceDue`,
`src/campaign/decide.ts`), so a Builder whose practice no longer fails gets new tasks; inside a
conversation the host releases what is owed as each Examiner session beside it holds a task
(`releaseOwed`, `tools/d2/campaign-actions.ts`). Once practice exists, a release never leaves fewer
frontier tasks, read on the reference's own solves, than a comparison needs (`comparisonFloor`).
Each release is one task fewer to compare. A release takes, in this order (`releaseOrder`,
`src/kernel/reports.ts`):

1. the tasks the reference answered in no solve of two comparisons it stood in;
2. half, rounded up and counted with those already released, of the tasks that left the reference
   room in its last reading of each (a failed solve, or an answer of its own or its author's
   bettering one of its answers by the objective gap floor); the other half stays held;
3. the rest by the contract's draw, those the reference always answers among them, since a
   practice pass returns the objective's measure.

The release reads the reference's own solves alone, so which held-out task a new harness won leaves
the practice set unchanged (rule 3). A task scored before its release keeps that comparison's solves
on the exam side; a Builder sees only its practice solves (`practiceRan`, `src/kernel/solves.ts`).
Before a comparison the campaign holds as many scorable tasks as it scores (`--target`), or the
Examiner writes more first.

### What refuses a move

Comparison admission (`admission`, `src/campaign/admission.ts`) is asked by a round or a standalone
comparison before its first event, whoever started it. Among other things it refuses:

- a log with no held-out task;
- fewer frontier tasks than a step needs at the level, plus two, for one task set aside and one tie
  (`held-short`, `comparisonFloor`);
- no `--cap`;
- a checker nobody has read;
- a campaign the stop rule stopped, unless `--past-stop "<why>"` gives the operator's reason
  (`stop.overridden`).

A Builder session on its own asks session admission (`admitSession`): a cap, a read checker, the
stop rule; and it refuses a `--session` whose Builder started and did not end whole (`spent`,
`src/builder/session.ts`). A comparison or session the log shows begun continues without asking. A
command writes nothing before its last refusal: the admission, then the comparison's own terms, then
an override of the stop rule and the setting. A reported comparison run again repeats its report. A
rehearsal is exempt by name, since its seats are scripts.

The other verbs over a campaign's log (the skill `run-management`):

```text
bun run runs rehearse [--no-comparison] <the flags of tools/d2/round.ts that name no model>
bun run runs rehearse --campaign <the flags of tools/d2/harness-builder.ts that name no model>
bun run runs view <name> [--level N] [--target N] [--practice N] [--past-stop "<why>"]
bun run runs fresh | launch | continue | keep | pause | copy | fetch | retire | stop <name> | source <name> | status | usage | active | pulse | replay | seed | zip
```

### Defaults

- 24 scored tasks (`--target`) and 2 solves a side (`SIZE`, `src/kernel/size.ts`), each of which a
  setting may name once;
- level 0.02 (`--level`) and improvement patience 6 (`--patience`): one step at the level promotes;
- an objective gap floor of 1% of the larger measure (`ROOM`), a constant: two valid answers closer
  than it tie, and a better answer on record by less leaves a task no room, in task admission, on
  the frontier and in `roomOf`;
- a stop after more than 3 tasks with a check defect (`--defects`);
- a reserve of 10 dollars a solve (`--reserve`); for a small campaign, set it near what one solve of
  that solver bills (`solve.finished.billed` in an earlier log);
- `--parent latest` and `--reference promoted` (the starter until a promotion);
- a Builder session of 1,440 minutes of its own time, 300 session turns and 24 practice solves; a
  Builder that leads its campaign has only as many as the remaining total holds a reserve for
  (`practiceLeft`, `src/builder/tools.ts`);
- a solve of 20 model turns, 30 minutes and 24 prompts, whoever solves (`LIMITS`,
  `tools/d2/campaign.ts`).

An Examiner session can finish under three conditions:

- It has supplied the needed tasks (`shortOf`, `src/campaign/decide.ts`), either at `finish`
  or at the end of that turn. The need includes practice and the admission floor before the first
  comparison, and the target afterwards, or the explicit `--exam-tasks` request.
- It calls `finish` twice without proposing a task between the calls.
- It calls `finish` after using its full proposal allowance (`spent`, `src/examiner/write.ts`).

`finish` waits for pending admissions, so the session may hold out more tasks than requested. An
early `finish` is declined with an explanation of the need, without a target count: otherwise the
Examiner tends to propose one small batch and stop. Its home and final note carry into the next
session.
