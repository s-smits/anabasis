# The empirical record behind the decision points

Compiled on 15 November 2026 from all campaign logs in the central archive and local worktrees
whose first event occurred on or after 1 October 2026. Each campaign was summarised via `runOf`
(`.claude/skills/main/runs.ts`), reconstructing state at stop time using production folds over the
truncated log, cross-referenced against operator instructions regarding stops, pauses, resumptions,
and relaunches in session transcripts and cycle ledgers. In total, 286 campaigns opened; 141
reported at least one comparison and form the denominator below, while 145 never reached a
comparison. Promotion counts include the initial promotion above the Starter.

Attributing who ended a run is partially estimated because a stop command, process kill, sleeping
host, and crash all leave the log without a terminal ending event. Twenty-seven final stops are
explicitly recorded in the log (an `operator` ending, pause word, or stop word); 40 additional
stops are inferred as manual from session transcripts naming a stop or pause of that run; 48 have
neither a logged ending nor a transcript reference. Treat 67 as a lower bound on manual stops and
115 as an upper bound.

## Promotion counts across campaigns

| promotions | 0 | 1 | 2 | 3 | 4 | 5 | 6 or more | campaigns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all 141 | 53 | 39 | 24 | 13 | 3 | 3 | 6 | 141 |
| opened from 3 November | 14 | 10 | 9 | 4 | 1 | 0 | 2 | 40 |

Across all 141 campaigns, 195 promotions occurred, of which 31 were confirmed by a starter
comparison across 19 campaigns; among the 40 campaigns opened from 3 November onward, 61 promotions
occurred with 27 confirmed. The six campaigns reaching six or more promotions achieved 6, 6, 6, 7,
7, and 10 promotions (the 10-promotion run had 2 confirmed, one 7-promotion run had 5 confirmed,
and the other four had none). False-positive A/A steps totalled 2 out of 204 A/A comparisons
statistically able to read a step.

| reached at least | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| campaigns | 88 | 49 | 25 | 12 | 9 | 6 | 3 |

## Campaign duration and cost

| measure | value |
| --- | --- |
| hours from opening to first promotion | median 7.8, range 2.0 to 31.2 (n=88); opened from 3 November, median 5.4 (n=26) |
| hours to second promotion | median 12.7, range 4.0 to 52.4 (n=49); opened from 3 November, median 11.4 (n=16) |
| each promotion from third to seventh | median 4 to 7 elapsed hours after the previous promotion (2 to 3.4 active hours), at 33 to 61 billed dollars |
| hours at manual stop | median 17.1, interquartile range 11.3 to 28.1 (n=67); opened from 3 November, median 12.9 (n=21) |
| hours from latest promotion to manual stop | median 3.1 (n=51) |
| hours from second promotion to manual stop | median 6.3 (n=30); opened from 3 November, median 4.1 (n=12) |
| runs ending with zero promotions | median 9.2 hours and 2 comparisons (n=52); maximum billed spend 186 dollars on the current meter |

## Manual stops by promotion count

| stops by hand | 0 | 1 | 2 | 3 | 4 | 5 | 6 or more | n | median hours |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| recorded in the log | 8 | 8 | 6 | 5 | 0 | 0 | 0 | 27 | 21.8 |
| recorded and inferred | 16 | 21 | 15 | 8 | 2 | 1 | 4 | 67 | 17.1 |
| of those, opened from 3 November | 4 | 5 | 8 | 3 | 1 | 0 | 0 | 21 | 12.9 |

Grouped by stop week, median run duration declined from 28.9 and 19.7 hours (weeks of 12 and 19
October) to 15.2 and 12.7 hours (weeks of 2 and 9 November). During the week of 19 October, 9 of 13
manual stops occurred at three or more promotions, whereas during the two November weeks, 25 of 29
occurred at two or fewer. Among runs opened from 3 November onward, manual stops occurred at a
median of 9.9 hours for zero promotions (n=4), 15.3 hours for one (n=5), 14.3 hours for two (n=8),
and 25.5 hours for three (n=3).

Starter-comparison confirmation had already reported at the time of stop in 16 of 51 post-promotion
stops across the full window, 14 of 17 for runs opened from 3 November onward, and 8 of 8 from
9 November onward once pauses began waiting for the next comparison.

Among the remaining campaigns, 15 terminated on campaign rules (4 budget, 4 patience, 3 no-room,
2 exam, 2 finished), 4 terminated on host `environment` endings, 6 halted at a login limit, and 1
remained live. Fifty-one campaigns were resumed on their existing logs (mostly within 30 minutes of
a limit or `environment` ending), and 25 of those subsequently achieved 58 promotions.

## History of operator policy directives

Across 136 dated directives (133 between 7 October and 15 November 2026), the default promotion
target changed four times:

| from | the rule in their words | what replaced it |
| --- | --- | --- |
| 7 October | a clock: stop at five or six hours, investigate, relaunch | "we should just continuate once they stop, this is why it's not reaching multiple promotions" |
| 12 October | no count: stop "the least promising", "stalled" or "outdated" run; three for runs that "promoted too easily" | "okay cap at 6 promotions and milestone at 6 as well" (25 October) |
| 25 October | six promotions or twelve hours, whichever comes first | "stop every run after two promotions except for the job stat ones" (3 November) |
| 3 November | two, first as an automatic stop | "we should not automatically stop it, but we should get a notification and then pause it" (6 November), then "pause ... after next comparison (bit more realistic than promotion)" (8 November) |
| 15 November | two slots: "pausing one of the two and to keep the other one going until like longer, like 3 or 4 promotions, like based on what you think is best", the other "based on the latest", for consecutive runs on different potential upgrades | currently in force; issued after this survey, so no counts above reflect runs under it |

Documented exceptions to the two-promotion default (about 14 directives): one promotion five times
(hard domains or "mainly for proving for merging" a patch); three promotions twice; six or more
five times (including "let it try to reach promotion 9" and "until 6 promotions if it reaches it
within 8h"); and allowing jobstat runs to "stop themselves" twice on 3 November.

Directives for non-promoting runs (about 14 directives): nine stops (least promising, stalled,
outdated, "really slow", and "the middle-going one", which "does not have any signals") and four
continues ("did they try 6 times", "it should at least run for a few hours", a run with informative
errors, and "if no promo in $500 - stop", set once and never reached).

Release proof directives (seven gates and four waivers): "at least two promotions to merge it ...
unchanged during the run" (4 November), "4+ promotions and a full WRI sweep" for a minor release
(9 November), and one promotion for a patch (8 November); proof was waived on operator authority on
28 October and on 4, 10, and 11 November (the last recorded in cycle ledgers).

Seven regretted decisions: five premature or unwanted stops, one background loop that continued
stopping runs at two promotions from 3 to 7 November after the rule changed, and one restart
violating a conditional instruction. None concerned a run left active too long.

## Measurement limitations

Stop rationales live in operator transcripts rather than campaign logs, and most directives omit
explicit hour or dollar counts. Elapsed hours are measured from the first event and therefore
include idle rest time across restarts. Dollar figures prior to 1 November used an earlier billing
meter and are comparable only after repricing. Thirteen logs from 9 and 10 October use a legacy
event format rejected by current readers and are excluded from this survey.
