---
name: decision-points
description: "Decide what an Anabasis campaign does next at each point where the operator has decided it: keep running, pause after the next comparison, stop, continue or fork fresh. States the count of promotions a run is taken to (two by default; one, three, four or six where its purpose says so), when a run that is not promoting is given up, which run goes when slots are short, when a fresh fork is worth its slot and what a release asks of its proof run, each beside the count of the operator's own decisions behind it (references/record.md). Use when a promotion, a starter read, a comparison without a step or an ending lands, when a slot frees, when asked how many promotions runs make or how long they run before they are stopped, and before proposing a stop, a pause, a continue or a relaunch. run-improvement-campaign owns the loop and the trigger's commands, run-management the verbs, and AGENTS.md section 3 every stop no row here names."
---

# Decision points

A campaign rarely ends by its own rules: of the 141 that reported a comparison between 1 October and
15 November 2026, 15 did, and at least 67 were ended by a person or a session
([the record](references/record.md)). When a run rests is therefore a judgement, and this skill
states the operator's, so that a session decides as they would and knows where the decision is not
its own. Nothing here reaches a seat: a run carries no cap, and no prompt or tool names a count
(`AGENTS.md`, section 1).

Two decisions are a session's. It pauses a run at its trigger, after the run's next comparison, and
it forks a fresh run at a proved fix
([run-improvement-campaign](../run-improvement-campaign/SKILL.md), "The iteration"). It may also
keep a run going past its trigger where a row below says so, with a line in the iteration's
`deviations.md` naming the row. Ending a run before its trigger, and any count for a run other than
the row's, take the operator's word: ask with the row's evidence and a recommendation, and leave the
run running meanwhile.

## Read the run before the row

```sh
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts due      # each run's step and trigger
bun run runs view <name>                                               # promotions, readings, the bill, the wait
bun .claude/skills/comparison-reading/scripts/starter-reads.ts <name>  # what the starter confirmed
```

Five facts place a run on the table: its promotions and how many the starter confirmed; its hours
since the opening and since the newest promotion; its last readings; whether the newest promotion's
starter comparison has reported; and what the run is for, which its `predictions-<run>.md` opens
with (the component it measures, a release's proof, the jobstat run, the buffer control).

## The points of one run

| Point | Default | The operator's exceptions | On record |
| --- | --- | --- | --- |
| before its first comparison | keep it | none: a run "should at least run for a few hours" | first promotions land at a median 7.8 hours |
| a comparison without a step, no promotion yet | keep it to the trigger: twelve hours, a comparison that left no task untied, or the campaign's own patience | given up sooner where its code is outdated by a fix that changes what it measures, or where it is broken or stalled on evidence; a run whose failures are informative goes on, and a dollar ceiling holds only where the operator sets one for that run (500 dollars, once) | runs that ended with none had run a median 9.2 hours and 2 comparisons, and none had billed more than 186 dollars |
| the first promotion | keep it, and read the alert | paused at one, after its starter read, where it proves a patch release or was started as a probe with that trigger | 21 of 67 stops by hand came at one |
| the second promotion | pause after the next comparison, which is that promotion's starter read; then investigate, read a jobstat reference outside, fix and fork | below | of the runs opened from 3 November, 8 of 21 stops by hand came at two, at a median 14.3 hours and 4.1 hours after the second promotion |
| past two | no run is taken there by default | kept on where the operator says so of that run ("don't stop it after 2, just to check"), where it proves a minor release they set higher (four, once), and where its promotions are confirmed and it can reach six within about eight more hours | 25 of 49 runs at two went on to three; 8 of 23 later promotions that a starter comparison read were confirmed |
| six confirmed | the climb milestone of the major version (`docs/plan.md`): the run goes on to its own ending | none | 6 runs reached six or more: 2 ran to their budget, at 34 and 50 hours, and 4 were ended by hand at 32 to 56 hours |
| an ending by its own rules | read it; continue only a login or session limit (rule 15) | a run that ended on its budget or its patience is not topped up or widened afterwards | 15 of 141, and 4 more on the host's `environment` ending |

A pause is taken after the comparison, never at the promotion: 35 of 51 stops by hand after a
promotion came before its starter comparison had reported, and those references were never
confirmed or refuted (`AGENTS.md`, "Promotion against confirmation"); of the runs opened from
9 November, all 8 rested with it read. A third promotion that lands
while the pause waits is the run's own and is read like the others.

## Which run goes when slots are short

Under the limit on live runs, the run to end is the one the next reading learns least from, in this
order: one whose code a landed or stacked fix has overtaken; one stalled or broken on evidence; then
"the middle-going one", neither the best nor the worst, which shows no signal either way. Three
runs are never chosen: the newest fork of a fix no other run measures, the one live jobstat run
(`AGENTS.md`, section 10), and a run with a comparison open, which is paused after it instead.

## A fresh fork

A fork starts once a plan's fix is implemented and proved, at its head, for the component it adds
(run-improvement-campaign, step 5). A change too small to measure starts none: the live runs go on
and the next investigation waits for them. A run that was stopped is continued only where the
operator names it, and a word with a condition is followed as given: "if it didn't run for just
now, then don't reinitiate it" forbade a restart that a session then made.

## What a release asks of its proof run

| Release | Proof | The operator's practice |
| --- | --- | --- |
| patch | a fresh run at the top to two promotions (run-improvement-campaign, "A run proves the release") | lowered to one promotion once, and landed without a proof run four times, each on their own word |
| minor | two promotions at one commit, unchanged during the run | set higher once: "4+ promotions and a full WRI sweep" |
| major | six confirmed promotions in one fresh campaign, then in a second domain | not yet reached |

Lowering or waiving a gate is the operator's alone. A session reports the run's state against the
gate and holds the landing.

## The errors on record

Seven decisions were regretted, and five of them were stops the operator did not want or that came
too soon; none was a run left going too long. So where a row leaves doubt, the run goes on and the
doubt goes to the operator; a pause is preferred to a stop, since it leaves a run that continues
from its log; and before a stop is called unexplained, the session reads its own background loops,
one of which went on ending runs at two promotions for four days after that rule was withdrawn.

## Recount the record

The counts above are one dated reading. `promotion-tuner`'s table gives the same row a run from the
logs, and `trend.ts` reads one week's runs against the weeks before:

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts --rows runs --since <date>
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts --rows promotions --since <date>
```

Where a recount moves a row's default (the count most stops come at, or the hours), rewrite the row
and [the record](references/record.md) together. A new word of the operator's replaces the row it
overrules instead of joining it.
