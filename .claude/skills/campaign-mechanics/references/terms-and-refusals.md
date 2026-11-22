Read this reference for a campaign's recorded terms, practice task release, admission refusals, and
defaults. It expands the second half of `AGENTS.md` section 6; the commands themselves are
documented in `campaign-command.md`.

## 6. A campaign's commands (continued)

### What the log records of a campaign's conditions

**The opening** (`campaign.opened`) stores everything required to continue a campaign by name: the
project, total budget and reserve, both patience thresholds (`--patience`), the seat models, and the
most recently specified move terms (`TERMS`, `src/campaign/opening.ts`), namely the significance
level, conversation time and turn limits, practice allowance, and promotion cap. Subsequent
invocations inherit these values unless overridden by a flag; legacy opening fields that no reader
consumes are ignored. The significance level is the sole exception: once a comparison has started,
the level is pinned to that comparison's level, and any command specifying a different level is
refused before writing to the log (rule 4).

**The project** (`--project`, required and fixed at opening via `projectOf`) groups campaigns on the
operator dashboard and influences no campaign decision or seat message.

**The setting** (`campaign.setting`, `tools/d2/setting.ts`) fixes the experimental condition once,
when the first solve-bearing move begins (`settingOf`), and cannot be altered thereafter. It records
the solver model, effort, context window, and limits (`--solver`, `--solver-effort`,
`--solver-window`, `--solve-minutes`, `--solve-model-turns`), together with `--target` and
`--solves`. Conflicting flags are refused because solves collected under one solver setting cannot
be combined with another. A legacy log containing solves recorded before `campaign.setting` existed
is bound to the setting of its last test-side solves (`firstRecord`) and checked when a paid command
opens the campaign (`campaignFor`). `--solver-window` (300,000 tokens) sets the backend compaction
threshold, so a model served with a 200K context window is refused at that setting.

### Practice release

Releasing practice tasks supplies the Builder with fresh training failures, at the direct cost of
removing each released task from the held-out evaluation pool. Practice release is triggered after
each comparison reading or promotion (`practiceDue`, `src/campaign/decide.ts`) and executed by the
host (`releaseOwed`, `tools/d2/campaign-actions.ts`) when new tasks are admitted, when an Examiner
session finishes, when a Builder conversation opens with newly admitted tasks available, and after a
non-promoting reading (which releases one task if no new tasks were admitted since the previous
release). Practice is never released while a comparison remains unreported, and any task left in
doubt by a reference rejection is excluded (`practicePool`, `poolOf`). Eligible tasks are released
in priority order (`releaseOrder`, `src/kernel/reports.ts`):

1. tasks that the reference failed to solve across two comparisons;
2. half (rounded down, counted jointly with already released tasks) of the tasks that left
   improvement headroom on the reference in its last reading, keeping the remaining half held out;
3. remaining tasks in the contract's deterministic hash order, including tasks the reference always
   solves, because a passing practice solve still exposes the objective measure.

Because this ordering inspects only the reference harness's solves, which tasks a candidate won
cannot influence the practice set (rule 3). A task evaluated before its release retains those
comparison solves on the exam side; the Builder observes only its own practice solves
(`practiceRan`, `src/kernel/solves.ts`).

### What refuses a move

Comparison admission (`admission`, `src/campaign/admission.ts`) runs before a comparison writes its
first event, regardless of who initiated it. It refuses when there are no held-out tasks; when fewer
frontier tasks exist than a step requires at the configured level plus two (one buffer for a task
set aside and one for a tie; `held-short`, `comparisonFloor`); when `--cap` is missing; when the
checker has not been validated; when the cap is below the estimated cost of the comparison's test
alone based on historical finished solve bills (`cap-short`, which ends the campaign on budget if no
comparison is open); or when a stopped campaign lacks `--past-stop` (`stop.overridden`). Session
admission (`admitSession`) requires a cap, a validated checker, and a passing stop rule, and refuses
a `--session` whose Builder started without completing cleanly (`spent`, `src/builder/session.ts`).
A move already started in the log resumes without re-checking admission, and rehearsals are exempt
by name. Refusal checks execute in fixed order: admission, terms, stop override, and setting.
`bun run runs view` and `rehearse` exercise and verify these paths.

### Defaults

Locations and edge cases for the defaults referenced in `AGENTS.md` section 6:

- `--target` and `--solves` are defined in `SIZE` (`src/kernel/size.ts`); `GAP_FLOOR` is a single
  constant shared by the tally, task admission, the frontier definition, and `roomOf`.
- The `--defects` stop threshold applies only to manual comparisons.
- The per-solve reserve (`--reserve`) sits above the highest solve bill observed under default
  limits and is the one place where a turn limit proxies for dollar spend: a solve is gated on the
  reserve before starting and is not interrupted once running. Run `scripts/bills.ts` to inspect
  historical solves that exceeded the reserve before increasing solve limits or lowering the
  reserve.
- Default selectors are `--parent latest` and `--reference promoted`.
- Each Builder session receives 24 practice solves (`--practice-solves`), reduced when the remaining
  budget cannot reserve them (`practiceLeft`, `src/builder/tools.ts`). Each Examiner session
  receives 240 minutes, 200 turns, and 36 proposals (`tools/d1b/examine.ts`).

An Examiner session finishes once it has supplied the required tasks (`tasksToAskFor`,
`src/campaign/decide.ts`: practice tasks plus the admission floor before the first comparison, and
the comparison target thereafter, at least one sweep), when it calls `finish` twice with no
intervening proposal, or when its proposal quota is exhausted. An early `finish` is declined with a
statement of the need but without a numeric count, because an Examiner given an explicit count tends
to propose one small batch and stop. The first two endings suspend the conversation for the next
request.
