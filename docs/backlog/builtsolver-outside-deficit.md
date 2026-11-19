# Why no builtSolver has scored above the Starter outside

Status (18 November 2026): six decisions wait for the operator, each below with its counts and a
recommendation. Of them only item 1's second half is present in source. The counts are those of the
investigation of the jobstat fork at #921's head, vetted on 18 November, and of the record's
jobstat starter reads since 1 November, recounted on 18 November after two reviews of the first
draft.

## The question

A jobstat campaign promotes harnesses that beat their parent on its own exam, and on JobBench no
promoted reference has yet scored above the Starter. The export and the solver's Python were
repaired first (#919, #936), since a deficit is read as a difference in conditions before it is read
as the harness. The question here is what remains once those are equal: does the campaign select
for what the benchmark reads, and do its promotions hold on tasks that did not choose them?

## Intended changes

Each is the operator's (`AGENTS.md`, section 3): what a solver or a Builder is given or told, the
level and the size, and what an exam may ask for.

1. **What a valid answer must show.** A solver's answer is one JSON value (`answerFormat`,
   `src/examiner/draft.ts`), so a file, a sheet or a report cannot be an answer or a check's input.
   The fork's exam drafted five checks, all on the answer's structure, and named the content of a
   section as not measured; validity differed between the two sides on 0 tasks in 7 of 7
   comparisons, so every step was read on the interval objective alone. Recommendation, in two
   halves. First the query: its validity sentence asks for agreement (counts that match a recount,
   each imputation or exclusion documented with the records it touched, a recommendation that
   follows from a stated rule) instead of existence, each clause decidable from the JSON answer, the
   public input and the hidden values. This half is written as the query's seventh version and waits
   for one fresh run with its predictions. Then the host: submit captures the regular files a
   solver leaves under `deliverables/` (at most 64 and 16 MiB in all), keeps them by digest under
   the campaign's `states/` with only their manifest in the verdict, and gives them to each check
   whose execution declares them; every check of a drafted exam declares all of them, and the
   objective reads the JSON value alone. The Referee is shown each file's text, bounded, and probes
   and rules on a file by `file:<path>`; a drafted control and an Examiner's `try_answer` carry text
   files, so a check that reads them can be proved feasible. The submit tool's description names the
   folder, which changes what a solver is told (`AGENTS.md`, section 3). Not done: a known valid
   answer (`task.feasible`) keeps no files, and the Linux wall's capture is unproved by a live
   solve. This half was first to wait for that run's exam; on the operator's word of 18 November to
   improve the system before the next jobstat run it is present in source beside the query, so that
   run drafts its exam with both, and reads whether an exam then measures a file's content.
   Missing: the drafted exam of a run on both.
2. **Confirming a promotion on tasks that did not choose it.** None of the fork's three promotions
   was confirmed. Its starter reads stored 4-15-0, 8-11-0 and 10-4-0; on the tasks read at each
   promotion they were 4-2-0, 6-1-0 and 7-0-0, and on the tasks written after it 0-13-0, 2-10-0 and
   3-4-0. Over the record on jobstat (41 starter reads in 14 campaigns, the same since 1 or 4
   November) the tasks a promotion was chosen on read 350-75-11 for the reference and those written
   after 174-224-16. Crossed with whether practice of a task's family was released before the
   reference was promoted, the tasks written after read 98-162-5 on such families (38% of untied)
   and 76-62-11 on the rest (55%), while the tasks chosen on read 284-47-2 and 66-28-9: the
   reference loses most on new tasks of the families it practised on. Pooled over origins the two
   groups read alike (412-217-7 against 156-92-20), because the chosen-on tasks, which it wins, sit
   mostly in practised families. Whether the cause is fitting to the family's practice
   tasks or an Examiner that aims new tasks of a family at the reference's weaknesses there (it
   reads the reference's outcomes by family and task, `src/examiner/record.ts`) this count does not
   part. Recommendation: print the split beside the starter read as a report that decides nothing,
   and one pair of fresh runs, one of which draws part of each comparison from families with no
   practice. Missing: that pair.
3. **What a Builder hears of a practice solve under an objective.** One lane reports that the
   Builder built two calibration harnesses and worked practice measures back towards each released
   task's generating values (`measuredText` and `recordText`, `src/builder/tools.ts`, give the
   verifier's measure of a valid answer and of the author's best on record, which section 1 allows
   across the wall). The reversal test was run in the investigation's synthesis: within 0.1%, one
   calibration session matched 7 of 10 tasks it probed against 1 of 14 unprobed tasks of the same
   exam session and 16 of 76 elsewhere, so the account is confirmed for that session; the other's 3
   of 14 against 4 of 42 and 0 of 44 is no clear difference. The exam's objective is the interval's
   width over the parameter wherever the interval covers it, so one probe returns the parameter at
   the precision the result prints; rounding the measure would coarsen that and not close it. What a
   recovered value is worth on held-out tasks depends on the exam: one family held 39 of the fork's
   50 proposed tasks and its parameters lie close together, so a value learned on practice serves as
   a prior on held-out tasks of the family. Recommendation: no change to what a Builder reads
   (section 1 allows the measure); read the family split of item 2 for whether calibrated harnesses
   lose on new families, and put the concentration of an exam on one family to the operator as an
   Examiner matter, since nobody coaches the Examiner (rule 2).
4. **The level and the size.** The fork's first promotion read 7-1-0 at p 0.020, and the A/A beside
   it read a step the other way. Recommendation: keep 2 solves a side at 0.02 until a
   `promotion-tuner` replay over the record shows which promotions a third solve would have
   withheld. Missing: that replay.
5. **The outside read's size.** The fork's third reference scored 282 of 518 beside the Starter's
   296; on the five tasks the read counts as fair (`score.ts table`, `fair 5`, one of them cut for
   the judge on every arm) 184 beside 198 of 296, and on the four of those the judge read uncut 162
   beside 168 of 228. Each is inside the Starter's spread of 20 between rollouts, so none is a
   reading. Recommendation: two rollouts of the Starter at each sitting, so that each sitting
   measures its own spread, at about half as much again as the standing sitting. That the
   benchmark's rubrics are all-or-nothing and that its judge reads a cut text were reported from
   outside and not recounted here.
6. **The runtime of the outside baseline.** A campaign's solver runs under pi and the outside read
   under an export to another runtime (`known-bench.md` names this handicap). Recommendation: none
   yet. An arm that rolls the Starter under the campaign's own runtime outside would part the export
   from the harness, and it waits on item 5's spread.

## What is left out on purpose

- The query names no task or profession of the benchmark, and no rubric line. Each clause the
  seventh version adds traces to a sentence of the query's origin; the map is in that run's
  prediction file, and one added clause that traced to none was struck before any run.
- The gap floor (`ROOM`) and the objective sentence are unchanged, so the seventh query's run
  differs from the sixth's in the validity sentence alone.
- No confirmation rule decides anything until the pair of item 2 has been read.

## How it came to be

- 9 November 2026, on a query that named the benchmark's professions: "okay this is a bit
  cheating", "we want to let it free". The lever since is what validity checks, not which tasks the
  query names.
- 17 November, on the export: "it does not have to be perfect, the agent itself should be able to
  handle environment link failures", and "remove stuff that's helpful to help outdated harness to
  propagate".
- 18 November, after the fork's outside read (0 of 8 rollouts reached the reference's library; no
  reading): the operator pasted an outside account in four causes (the exam selects a scalar on a
  JSON answer; promoted harnesses fit the Examiner's draws; the built reference does not reach its
  programs outside; the benchmark's instrument is noisy) and wrote "Fable, aggressively fix based
  on the findings, you can do it", then "tune the prompt as well to v7 prompt based on FINDINGS.md"
  and "(fundamental mismatch)". The first two causes are items 1 and 2; the third is held by #936
  and measured by the live fork's outside rows; the fourth is item 5.
