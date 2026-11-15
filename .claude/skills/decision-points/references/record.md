# The record behind the decision points

Read on 15 November 2026 from every campaign log the central archive and the worktrees held whose
first event is on or after 1 October 2026, a row a campaign through `runOf`
(`.claude/skills/main/runs.ts`), with the state at each stop from the production folds over the log
cut there, and from the operator's own words about stopping, pausing, continuing and relaunching in
the session transcripts and the cycles' ledgers. 286 campaigns opened; 141 reported at least one
comparison and are counted here; 145 never compared. Promotions include the first one over the
Starter.

Who ended a run is partly an estimate. A stop command, a kill, a sleeping host and a crash leave
the log alike, with no ending. 27 final stops are recorded in the log (an `operator` ending, a pause
word or a stop word); 40 more are counted as by hand because a session's transcript names a stop or
a pause of that run; 48 have no ending and no such mention. Read the 67 as a lower bound and the 115
as an upper one.

## How many promotions the runs made

| promotions | 0 | 1 | 2 | 3 | 4 | 5 | 6 or more | campaigns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all 141 | 53 | 39 | 24 | 13 | 3 | 3 | 6 | 141 |
| opened from 3 November | 14 | 10 | 9 | 4 | 1 | 0 | 2 | 40 |

195 promotions in all, 31 of them confirmed by a starter comparison, in 19 campaigns; among the 40
campaigns opened from 3 November, 61 promotions and 27 confirmed. The six campaigns at six or more
made 6, 6, 6, 7, 7 and 10; the run of ten holds 2 confirmed and one of seven 5, the other four
none. A/A steps: 2 of 204 A/A comparisons able to read one.

| reached at least | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| campaigns | 88 | 49 | 25 | 12 | 9 | 6 | 3 |

## How long they ran

| measure | value |
| --- | --- |
| hours from the opening to the first promotion | median 7.8, range 2.0 to 31.2 (n=88); opened from 3 November, median 5.4 (n=26) |
| hours to the second promotion | median 12.7, range 4.0 to 52.4 (n=49); opened from 3 November, median 11.4 (n=16) |
| each promotion from the third to the seventh | a median 4 to 7 elapsed hours after the one before, 2 to 3.4 of them active, at 33 to 61 billed dollars |
| hours at a stop by hand | median 17.1, interquartile range 11.3 to 28.1 (n=67); opened from 3 November, median 12.9 (n=21) |
| hours from the newest promotion to a stop by hand | median 3.1 (n=51) |
| hours from the second promotion to a stop by hand | median 6.3 (n=30); opened from 3 November, median 4.1 (n=12) |
| a run that ended with no promotion | a median 9.2 hours and 2 comparisons (n=52); none billed more than 186 dollars on today's meter |

## At how many promotions a run was ended by hand

| stops by hand | 0 | 1 | 2 | 3 | 4 | 5 | 6 or more | n | median hours |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| recorded in the log | 8 | 8 | 6 | 5 | 0 | 0 | 0 | 27 | 21.8 |
| recorded and inferred | 16 | 21 | 15 | 8 | 2 | 1 | 4 | 67 | 17.1 |
| of those, opened from 3 November | 4 | 5 | 8 | 3 | 1 | 0 | 0 | 21 | 12.9 |

By the week of the stop, the median hours fell from 28.9 and 19.7 (the weeks of 12 and 19 October)
to 15.2 and 12.7 (the weeks of 2 and 9 November); the week of 19 October ended 9 of 13 runs at three
or more promotions, the two November weeks 25 of 29 at two or fewer. Opened from 3 November, the stops
at none came at a median 9.9 hours (n=4), at one 15.3 (n=5), at two 14.3 (n=8) and at three 25.5
(n=3).

Whether the starter comparison owed after the newest promotion had reported at the stop: 16 of 51
over the whole window, 14 of 17 for runs opened from 3 November and 8 of 8 from 9 November, when the
pause began to wait for it.

How the others ended: 15 by the campaign's own rules (budget 4, patience 4, no room 3, exam 2,
finished 2), 4 on the host's `environment` ending, 6 left at a login's limit, 1 live. 51 campaigns
were launched again on the same log, mostly within half an hour of a limit or an `environment`
ending; 25 of them promoted afterwards, 58 times.

## The operator's words

136 dated decisions, 133 of them from 7 October to 15 November 2026. The count a run was taken to
changed four times, each by the operator's word:

| from | the rule in their words | what replaced it |
| --- | --- | --- |
| 7 October | a clock: stop at five or six hours, investigate, relaunch | "we should just continuate once they stop, this is why it's not reaching multiple promotions" |
| 12 October | no count: stop "the least promising", "stalled" or "outdated" run; three for runs that "promoted too easily" | "okay cap at 6 promotions and milestone at 6 as well" (25 October) |
| 25 October | six promotions or twelve hours, whichever comes first | "stop every run after two promotions except for the job stat ones" (3 November) |
| 3 November | two, first as an automatic stop | "we should not automatically stop it, but we should get a notification and then pause it" (6 November), then "pause ... after next comparison (bit more realistic than promotion)" (8 November) |

Exceptions to two, about 14 words: one promotion, five times (a hard domain, or "mainly for proving
for merging" a patch); three, twice; six or more, five times (a run let on to nine, "let it try to
reach promotion 9"; "until 6 promotions if it reaches it within 8h"); and the jobstat runs left to
"stop themselves", twice, on 3 November.

A run that was not promoting, about 14 words: nine stops (least promising, stalled, outdated,
"really slow", and "the middle-going one", which "does not have any signals") and four keeps ("did
they try 6 times", "it should at least run for a few hours", a run with informative errors, and "if
no promo in $500 - stop", set for one run and reached by none).

A release's proof, seven gates and four waivers: "at least two promotions to merge it ...
unchanged during the run" (4 November), "4+ promotions and a full WRI sweep" for a minor release
(9 November), one promotion for a patch (8 November); landed without the proof on 28 October and on
4, 10 and 11 November, each on the operator's word (the last read from the ledgers).

Seven regrets: five stops the operator did not want or that came too soon, one loop of a session
that went on stopping runs at two from 3 to 7 November, and one restart against a conditional word.
None is about a run left going too long.

## What the record cannot say

Why a run was stopped is in the words, never in the log, and most words name no hours or dollars.
The hours are elapsed from the first event; a run launched again counts its rest. Dollars before
1 November are on another meter and are compared only repriced. Thirteen logs of 9 and 10 October
are in an event format the reader refuses and are left out.
