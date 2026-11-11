# Helpers for the lanes of a whole-run investigation

Status: present in source on this pull request (10 November 2026) and proved without a model by
each helper's test. The helpers were exercised once, in one investigation of one run read beside an
earlier investigation of the same log (below); the prompt split, the prediction lines and the other
changes that reading led to are proved by tests only, and no investigation has run with them.

## The question

A lane is one question about a campaign, answered by an independent session from the log, the kept
harness states, the check program and the derived readers. Past sessions spent most of their calls
on plumbing: 265 lane transcripts, read on 10 November with the last seven days weighed most, show
10 to 80 tool calls a lane, most of them hand-written `jq`, Python and shell against the log, and up
to 50 scratch scripts in one lane. Each hand-written fold is a fresh chance of a miscount (a pairing
of tasks with scores by position misaligned every task after a set-aside one; a count of starter
probes took in 98 solves under other harnesses), and the readers that already answered a question
went unread because no prompt said what each file holds.

## Intended changes

1. **A reader or a tool for each pattern a lane repeats**, each calling the production fold and
   printing facts: no verdict, no ranking of causes, nothing a blind or isolated lane is kept from.
   A reader that takes one log and is quick enough joins `READERS` (`tools/wri/derive.ts`), so its
   file stands in every campaign's derived folder; a tool with arguments is its own file under
   `tools/wri/` or its skill's `scripts/`, run with `--log <log>`.
2. **One query tool for the log** (`tools/wri/log.ts`), so that the commonest hand work (which
   kinds, which events, each solve with its comparison and side) is one command that passes the
   lane guard.
3. **A lane guard that refuses less read-only work**: the parser faults that refused loops over
   `jq`, process substitution and searches over kept harness files are fixed, each with the test
   that its protection still holds.
4. **A prompt that says what is already counted**: every open lane's prompt lists each derived
   file with the question it answers and its size, and the tools a lane runs (`## Tools a lane
   runs`, `references/lanes.md`).
5. **More freedom, said beside the helpers**: the same section says that a table holds what its
   author thought to count, that every event, state and source file is the lane's to read, and
   that its question says where to start. The primary's "Already read" section may also name what
   looked odd and was not followed, by place and never by meaning.
6. **Catalogue sentences** where a lane's text lacked a pointer its sessions kept searching for.
7. **One file for what every open lane shares** (`sharedPrompt`, `tools/wri/investigation.ts`): the
   shared instructions, the rows and triggers, what is already counted, the pens and the report's
   form, read once a session, with a trigger's detail cut at 300 characters. A lane's own prompt
   keeps its question, its triggers whole, its predictions and its report path.
8. **Predictions as owed output**: a table of the prior state with an `id` and a `lanes` column is
   read as predictions (`predictionsOf`); each open lane a row names is handed the row and owes
   `Prediction <id>: held | falsified | unreached`, which `reportOf` checks and `reportIndex` lists
   by prediction, with the lanes that wrote no line.
9. **One lane at a time**: a report opens as `Verdict: pending`, which the collector reads as
   unfinished, and a session's task line says to write a lane's report before the next prompt.
10. **What the two lane sessions asked for and one call showed**: each comparison's tally by writing
    session and by family in `pairs.txt`; `harness-versions.ts` opening every kept state only for
    its list; a reader that finds its campaign by name left unrun on a log the name does not find;
    `log.ts kinds --kind`, two fields in `--count-by`, and a `--set` path without its `$.`.

## What stays as it is

Lanes 4 and 15 stay isolated and lane 27 blind: none is given the list of derived files, and the
helpers written for them print nothing they are kept from, which a test holds for each. No helper
gives a verdict: which kind a win is, whether a confirmation is selection, whether a check is
defective stay the lane's question.

## The first pair of investigations

On 10 November the proof run of #756 (14,082 events, two promotions) was read twice on one snapshot
with the same 26 lanes and the same model and effort: once before the helpers by five sessions, and
once with them by two sessions of 12 and 14 lanes. It is one pair, on one run, with three confounds
named below, so each figure is an observation and none a rate.

| | five sessions, before | two sessions, with the helpers |
| --- | --- | --- |
| tool calls (a lane) | 457 (17.6) | 198 (7.6) |
| model turns | 395 | 166 |
| a lane's own `jq`, Python and `awk` queries | 183 | 39 |
| repository tools run | 3 | 25 |
| hand-written code, characters (script files) | 145,000 (25) | 29,000 (3) |
| session minutes, summed (longest) | 71 (18) | 37 (21) |
| output tokens | 324,000 | 135,000 |
| findings | 37 | 28 |
| lane and prediction pairs given a resolution, of 42 | 14 | 13 |

Two reviewers then read the two sets of reports lane by lane. On the 12 lanes of the session that read every prompt first and wrote its
reports in a row, the earlier reading held 14 findings and the later 8, 6 of them the same and none
new. On the 14 lanes of the session that wrote each report before the next lane, it was 23 against
20, 15 the same, 8 only in the earlier and 4 only in the later. Three of the earlier reading's
unmatched findings bear on the run's promotions (which tasks carried a step that the same A/A block
had twice read as no step; wins on tasks whose A/A tied; a steadier reference quieting later
controls). The later reading alone found that five derived files described the live log instead of
the snapshot, and a Builder note the earlier reading reported as absent. Twenty counts were stated
differently on each side, many from different denominators, and none of the contradictions has been
recounted from the log.

The confounds: each prompt was 60,000 characters, 56,000 of them the same in every lane (20,000 of
those one lane's trigger detail), so a session of 12 to 14 lanes read 720,000 to 840,000 characters
of prompt and both were compacted; one session batched its lanes; and both readings ran under the
main checkout's older lane guard, so the guard's changes were not exercised. Changes 7 to 10 answer
what the pair showed: built again for the same investigation, the shared file is 40,000 characters
and 21 of the 23 lane prompts are 2,400 to 6,800, the other two 14,000 and 23,000.

## Limits known now

- A lane handed a table may stop at the table. One pair of investigations of one run has been read
  (above); it cannot tell the helpers' effect on findings from that of longer sessions, and a
  second pair with sessions of about eight lanes and the split prompt has not been run.
- Each reader in `READERS` runs in every `derive` pass over a log that moved, so that pass's cost
  grows with the list. The pulse runs only a reader that names a moment (`at`), once an event of
  that kind lies past what it last read: of the fifteen added here, `drafted` at the contract's
  freeze, `budget` and `rejections` at a report and `names` at a promotion, each of which has a
  line of that moment on a closed log of two domains. Of the other eleven, `aim` and `epoch-spend`
  repeat there what `ambition` and `cost` already say, and nine print a block or a table over the
  whole log; all stay `derive`'s alone. The fifteen took 0.2 to 3.4 seconds each on logs of 22,000 to 52,000 events,
  as each was timed alone; `table-timeline.ts` (24 to 53 seconds) and `harness-versions.ts --chain`
  (29 seconds on 22 kept versions) stay tools for that reason. Every reader but the two on the
  embedding model, derived once for two archived logs on one machine, took 5.9 and 34.6 seconds
  with the list as it was and 6.3 and 33.0 seconds with the fifteen added, so on the longer log
  the added cost is within the spread of one timing.
- The helpers answer a part of the hand-work, not all of it. A replay of the 11,853 commands of the
  mined sessions found 5,335 that read a log, a kept harness or a check; a classifier checked on a
  hand sample of 20 puts 34 to 44% of them as now answered by a reader or a tool. What is left is
  mostly a lane's own Python that joins event kinds, and text searches over turns by session.
- The lane guard still refuses a lane's own Python given a log by path (347 of the replayed
  refusals), since a script that writes to the path it was given cannot be told apart without
  reading it. The form that reads the log on standard input passes, and the prompt says so.

## Not done

- Asked for by a lane session and left out: a view of one task across every report, a count-only
  search of the solver's commands by family and side, `size.ts --solves`, a sign test summed over a
  run's A/A tallies, a quieter `grade` and a price for a compaction.
- A reader that finds its campaign by name is left unrun on a snapshot, not taught to read one:
  `view`, `source`, `logged`, `cost`, `table` and `loop` each resolve a name in their own way.
- The contradictions between the two readings were not recounted, and the earlier investigation's
  derived folder, which holds the same six files of the live log, was left as its session wrote it.

## Found on the way, not changed here

- **`openSteps` (`src/campaign/handover.ts`) reads a resumed comparison as cut** (confirmed by a
  scratch test and on one log). A comparison counts as cut once any bound event follows its first
  start, and the bounds include `comparison.started` itself, so a comparison resumed after a stop
  drops out of the list while it runs. Three printed lines read it (`runs view`, `wri.ts read`, the
  UI's reading page); no decision does. The least change treats a comparison as open while it has
  no report, as `openComparisons` does.
- **A file the answer and its task's public input are joined in** (lanes 1 and 4: 12 of 18 and 5 of
  the recent sessions did the join by hand) was proposed as `wri.ts export` and not built: it would
  write hidden answers to a new file outside the log. `log.ts events --kind verdict --full` and
  `tasks.ts --task` give the two halves.
- **The repaired-checker command (`be75806fc:tools/c/repaired.ts`) could not regrade a drafted
  exam**: it looked for the old checks beside the log, where a drafted exam keeps them under
  `exams/`. No session ran it, and it was removed; `wri.ts grade --solve` regrades one recorded
  answer.
- **The trigger functions of `tools/wri/folds.ts` and `tools/wri/read.ts`** (781 and 797 nonblank
  lines of 800) could move to files of their own, as `time.ts` holds the cost triggers.

## How it came to be

- **10 November 2026.** The operator: "how to expand WRI more with helper scripts, we have to
  actually look back in our session history to infer what type of scripts are needed for the groups
  we ran, of course base only on individual lanes", "try to find patterns for each WRI lane and
  write intelligent scripts around it which make WRI faster and more robust and we also should add
  more freedom in shared instructions to go after things freely apart from the helper scripts so
  that it's not less laser-focussed on the exact task at hand but can also still see subtleties".
- **The same day.** "recency bias please", "so we focus more on last 7d then 7-14d etc".
- **The same day**, on reading the first builds: "look indeed at already existing primitives etc we
  can already wrap better like you're doing now right and improving further". So a helper calls the
  production fold where one exists (`billedRate`, `withReplacedField`, `gainOver`, `sideGap`,
  `starterReads`) and a copy of one is a defect of the helper.
- **The same day**, on a second pass over each group's build: "how many of these are really
  needed?". The second pass was cut to clearing each group's own lint and typecheck findings, a
  count of the hand-work answered, the seams between two groups' files, and a new build only where
  a third of a lane's sessions of 3 to 10 November had done the work by hand.
- **The same day**, after the first investigation with the helpers: "Run two groups WRI like this
  session did" and "compare with" the earlier investigation's "subagent lanes to see if current are
  relatively more efficient compensate for the fact that it's 2 vs 5 or more WRI lanes". Then:
  "Analyze and see if we can improve even more", "re-initiate both agents to ask what it missed in
  terms of help etc" and "synthsize yourself as well and upgrade / improve 765". Changes 7 to 10
  are that synthesis.
