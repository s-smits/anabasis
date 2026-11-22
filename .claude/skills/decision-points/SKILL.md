---
name: decision-points
description: "Decide the next lifecycle action for a live Anabasis campaign at each established operator decision point: continue running, pause after the next comparison, stop, resume, or fork fresh. Encodes target promotion counts (two by default; one, three, four, or six depending on run purpose), criteria for abandoning non-promoting runs, slot eviction order under concurrency caps, criteria for launching a fresh fork, and release proof-run requirements, grounded in the empirical record of operator decisions (references/record.md). Use when a promotion, starter comparison, non-step comparison, or ending lands, when a concurrency slot opens, when asked how many promotions or hours campaigns typically run, or before proposing a stop, pause, resume, or relaunch. run-improvement-campaign owns the iteration loop and trigger commands, run-management owns execution verbs, and AGENTS.md section 3 governs any stop outside these rows."
---

# Decision points

Campaigns rarely terminate on their own stopping rules: across 141 campaigns that reported at least
one comparison between 1 October and 15 November 2026, only 15 ended automatically, whereas at
least 67 were ended by the operator or a session ([the record](references/record.md)). Deciding
when a campaign rests is therefore an operational judgement. This skill codifies the operator's
established policy so sessions act consistently and know where authority ends. None of these rules
reach any model seat: campaigns carry no hard promotion cap, and no prompt or tool mentions target
counts (`AGENTS.md`, section 1).

Three decisions fall within a session's standing authority: pausing a run at its trigger after its
next comparison; forking a fresh run at a verified fix
([run-improvement-campaign](../run-improvement-campaign/SKILL.md), "The iteration"); and, when two
runs share the fleet, designating the long run (choosing whether it rests at three or four
promotions) while rotating the other slot to the newest commit ("Two slots"). A session may also
keep a run active past its default trigger where an exception row below applies. Record every such
decision as one line in the iteration's `deviations.md` citing the governing row and the run's
metrics. Stopping a run before its trigger outside these rows, or choosing a different target count
for a run, requires the operator's authorisation: present the row's evidence and a recommendation
while leaving the run active.

## Inspect the run before consulting the table

```sh
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts due      # each run's step and trigger
bun run runs view <name>                                               # promotions, readings, the bill, the wait
bun .claude/skills/comparison-reading/scripts/starter-reads.ts <name>  # what the starter confirmed
```

Five facts determine which row applies: total promotions and starter-confirmed promotions; elapsed
hours since launch and since the latest promotion; recent comparison readings; whether the starter
comparison owed after the latest promotion has reported; and the run's stated purpose from the
opening of `predictions-<run>.md` (the feature being evaluated, a release proof run, the active
jobstat run, or the buffer control).

## Lifecycle decision points for a single run

| Point | Default | Operator exceptions | Empirical record |
| --- | --- | --- | --- |
| before its first comparison | keep running | none: a run must run for at least a few hours | first promotions arrive at a median of 7.8 hours |
| a comparison without a step, no promotion yet | keep running until the trigger: twelve hours, a comparison leaving zero untied tasks, or campaign patience | abandon earlier if superseded by a fix that changes what it measures, or if demonstrably broken or stalled; continue if failures remain informative; a dollar ceiling applies only when explicitly set by the operator for that run (500 dollars in one case) | runs ending with zero promotions ran a median of 9.2 hours and 2 comparisons, billing at most 186 dollars |
| first promotion | keep running and read the alert | pause at one promotion, after its starter comparison, when proving a patch release or launched as a one-promotion probe | 21 of 67 manual stops occurred at one promotion |
| second promotion | pause after the next comparison (which is its starter comparison); then investigate, run external jobstat evaluation, fix, and fork | see below | among runs opened under the two-promotion policy, 8 of 21 manual stops occurred at two promotions, at a median of 14.3 hours total and 4.1 hours after the second promotion |
| past two promotions | the long run of a two-run pair continues to three or four ("Two slots"); all other runs rest at two; any unscored jobstat reference is evaluated externally at each subsequent pause without asking | continue when explicitly instructed by the operator, when proving a minor release with a higher bar (four promotions in one case), or when promotions are confirmed and six appears reachable within roughly eight additional hours | 25 of 49 runs reaching two promotions continued to three; 8 of 23 later promotions checked by a starter comparison were confirmed |
| six confirmed promotions | major-version climb milestone (`docs/plan.md`): let the run proceed to its natural ending | none | 6 runs reached six or more promotions: 2 ran to budget at 34 and 50 hours, and 4 were stopped manually at 32 to 56 hours |
| automatic ending | inspect the ending; resume only after a login or session limit (`AGENTS.md`, rule 15) | never top up budget or relax patience after a budget or patience ending | 15 of 141 ended automatically, plus 4 on host `environment` endings |

Always pause after the next comparison rather than immediately upon promotion: historically, 35 of
51 manual stops after a promotion occurred before its starter comparison reported, leaving those
references unconfirmed (`AGENTS.md`, "Promotion against confirmation"), whereas once pauses began
waiting for the next comparison, 8 of 8 runs rested with confirmation recorded. If a third
promotion lands while waiting for the pause, keep and evaluate it normally.

## Two slots: a long run and the newest fork

When two runs execute concurrently, the two slots serve distinct experimental purposes: one tests
how far a climb sustains while the other evaluates consecutive candidate upgrades at the latest
commit.

- **The long run** is the older active run unless it is demonstrably stalled or broken. It
  continues past two promotions and rests after the comparison following its third or fourth
  promotion, chosen when the second lands: target four if a starter comparison has confirmed a
  promotion or if the second promotion arrived within roughly six hours of the first; otherwise
  target three. The twelve-hour trigger does not pause a long run while it continues promoting or
  producing comparisons with untied tasks, though a long run with neither at twelve hours yields its
  slot like any other run. The long run measures persistence past two promotions and starter
  confirmation over longer horizons (25 of 49 runs at two reached three, with subsequent promotions
  arriving a median of 4 to 7 hours apart).
- **The newest fork** runs at the latest verified stack head. Once a candidate upgrade altering
  runtime or seat behaviour is proved and the current fork has run more than an hour on an older
  commit, pause it at its next clean boundary (after any in-flight comparison) and launch a fresh
  run at the new head. It rests at two promotions by default.
- **When the long run rests**, the newest fork becomes the new long run if it has promoted, and the
  vacated slot receives a fresh fork at the current head.

Because every run is evidence solely about its launch commit (`AGENTS.md`, section 9), the long run
measures multi-promotion sustainability whereas only the newest fork validates the code slated to
land.

## Slot eviction order under concurrency limits

When concurrency limits require retiring a live run, retire the run from which the next comparison
yields the least information, in strict order: (1) a run superseded by a landed or stacked fix;
(2) a run demonstrably stalled or broken; (3) the middle-performing run (neither strongest nor
weakest, offering weak diagnostic signal). Three runs are exempt from eviction: the newest fork
evaluating an unmeasured fix, the sole live jobstat run (`AGENTS.md`, section 10), and any run with
an in-flight comparison (which must instead be paused after that comparison completes).

## Launching a fresh fork

Start a fresh fork once a planned fix is implemented and verified, launched at its commit head to
test the specific component it changes (`run-improvement-campaign`, step 5). Do not fork for minor
changes too small to measure: let active runs continue and defer the next investigation until they
produce data. Resume a stopped run only when explicitly named by the operator, and follow
conditional operator instructions verbatim rather than reinitiating a run contrary to a stated
condition.

## Release proof-run requirements

| Release | Proof required | Historical operator practice |
| --- | --- | --- |
| patch | one fresh run at the top commit reaching two promotions (`run-improvement-campaign`, "A run proves the release") | lowered to one promotion once, and waived four times by explicit operator decision |
| minor | two promotions at a single commit, unchanged throughout the run | raised once to four or more promotions plus a full WRI sweep |
| major | six confirmed promotions in one fresh campaign, replicated in a second domain | not yet reached |

Only the operator may lower or waive a release gate. Sessions report the proof run's status against
the gate and hold the landing until authorised.

## Historical decision errors

Across the record, seven lifecycle decisions were later regretted: five were premature or unwanted
stops, one was an automated background loop that continued stopping runs at two promotions after
that rule had been retired, and one was a restart against a conditional instruction; none involved
letting a run continue too long. Consequently, when a row leaves genuine doubt, let the run
continue and escalate the question to the operator; prefer pausing over stopping so the run
remains resumable from its log; and before labelling a stop unexplained, audit active background
loops.

## Updating the empirical record

The figures above represent a single point-in-time survey. `promotion-tuner`'s table extracts the
same per-run statistics directly from logs, and `trend.ts` compares recent weeks against prior
baselines:

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts --rows runs --since <date>
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts --rows promotions --since <date>
```

Whenever a recount shifts a default threshold (such as modal stop promotion count or elapsed
hours), update the table above and [the record](references/record.md) together. Any new operator
policy replaces the row it supersedes rather than appending beside it.
