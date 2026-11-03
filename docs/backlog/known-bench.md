# Handing a campaign what is known about a benchmark

Status: planned. Nothing of it is in source. The working behind it, commit by commit, with the
operator's decisions, predictions and open questions, is in `docs/progress/known-bench-plan.md`.

## The question

An outside comparison needs a grader nobody in either loop wrote, and a benchmark is the only one
on hand (`studies/harness2/README.md`, "Read every result against how uneven the comparison is").
Against Harness², which adapts on each scored task, a blind Anabasis campaign is handicapped in
three ways. Its tasks are stand-ins its Examiner wrote. Its checks grade something other than the
benchmark's grader. In stage 2, it is scored after an export to another runtime. Handing a campaign
what is known about the benchmark shows how much of the gap the first two handicaps explain. Stage 1
already practises and scores on one runtime (the README's "One runtime from practice to scoring").

## Intended changes

1. **A recipe of the study, not a flag of the host.** Level K1 needs no host branch. The operator's
   prompt already reaches the Examiner's drafting session and every writing session, and no other
   seat (`src/examiner/draft.ts:457`, `src/examiner/write.ts:436`, `src/examiner/prompt.ts:133-139`).
   The opening records it once (`tools/d2/campaign-terms.ts:315`) and refuses a changed prompt
   after the draft (`:257-260`). `--project harness2` labels the run wherever runs are listed. A
   host flag waits until a second benchmark needs the same recipe (rule 13).
2. **K1: the train half's task inputs, shown to the Examiner** (the study's arm U). Four commits,
   0 production lines:
   1. a test that the operator's prompt reaches the Examiner and no Builder message
      (`test/builder.test.ts`, `test/examiner.test.ts`);
   2. `run.ts examples`: fill `prompts/U-draft.txt`'s slot from the train half, read through
      Harness²'s own `select` (`trials.py`), with each task's instruction verbatim and its project's
      file list, into an ignored file. It reads no tests and no solution, and refuses any test-half
      task or text;
   3. `run.ts audit --campaign <name>`: every seat's calls (`tracesIn`, `src/kernel/trace.ts`)
      matched by host against the benchmark's hosts and repositories, and the tasks the Examiner
      proposed that copy a train instruction, read against 0 at each ending;
   4. this file, the study's README and `docs/plan.md` row X1.
   The resolver block in the README is applied on the runner before the first seat. Until it is,
   nothing in the host keeps a seat from fetching the test half, because every seat reaches the
   network (`src/wall/base.ts:75`).
3. **Build K2 only on a measurement.** After U ends, score U's frozen reference and the starter on
   the train half with the benchmark's verifier (`run.ts score --half train`). Build K2 only if U's
   campaign read a confirmed step against the starter while the train half shows U's reference not
   above it: the checks and the grader then disagree.
4. **K2: the train half as the exam.** Two commits:
   1. open a campaign over a bundle alone, in the layout `stageExam` writes, with `--solver`, by
      rewriting the four-flag rule in `packNamed` and `packOpened` (`tools/d2/campaign.ts`; about 30
      production lines). The stored-pack path cannot take a benchmark's tasks, since it needs a v1
      sweep with graded solves;
   2. `run.ts exam`: each train task as a task whose hidden values are its tests, with one check that
      applies the diff and runs them, admitted by name (`--admit`, rule 10).
   K2 puts an exam no Examiner wrote into a campaign, which takes the operator's word as an exception
   to rule 2.
5. **What stays as it is.** The test half never reaches a seat, and the benchmark scores it once,
   after the harness is frozen. No reference solution is read (rule 9). A K1 or K2 campaign is a
   study arm: its promotions are not counted towards the climb milestone (`AGENTS.md`, section 10,
   item 9).

## Limits known now

- JobBench is out of K2. Its grader is a model judge, and a check's cell has the network closed
  (`src/kernel/verify.ts:389`). Opening it would not be enough either, since a judge as a check gives
  a model the validity decision that `AGENTS.md` section 2 gives to code.
- K2 on WorkBuddy-Bench Code is open only if one verifier tool tree can hold what its tests import.
  A cell cannot install, and each Code task brings its own image (the study's README, domain fit).
  Otherwise the Office subset comes next.
- The filled prompt quotes the benchmark's instructions, and a handover's `REPORT.md` quotes the
  prompt (`tools/d2/close.ts:172-173`). Both stay out of tracked files until the licence word.

## How it came to be

On 3 November 2026 a pilot set Anabasis against Harness² on eight JobBench statistics tasks, with
one shared domain text and Opus 5.5 in every seat.

- **01:36.** The operator asked how much chance Anabasis had of beating Harness²; the answer was
  about 15 to 25% on judged quality, since Harness² adapts on each scored task and Anabasis never
  sees one.
- **01:37.** The operator: "It's kind of different right, Anabasis does set up it's own queries
  which make it weaker?" The answer: yes, through the stand-in tasks, the different grading and the
  runtime gap; a held-out Harness² arm (its library, frozen, on tasks it has not adapted to) was
  proposed as the like-for-like reading.
- **01:38.** The operator: "This should be really importantly stated in the studies/harness2 folder
  for comparison, that if Anabasis even comes close it's really cool bc of above", then: "we have to
  write it like this though... really unfortunate that there's no good comparison system that does
  not use evals/benchmarks to run". The study's README gained the section on how uneven the
  comparison is.
- **01:39.** The operator: "we can also add appendix that we morph Anabasis into an extra flag which
  is --knownBench or something - wdyt?", "and then we have on max 10 locations if else statements
  when flag is active we hand that info there", "but add to backlog first". This file, and an
  appendix in the study's README that points here. The first version planned `--known-bench <dir>`,
  read at ten places in the host, in two levels: K1, task inputs only, and K2, the train half's tasks
  and verifier as the exam.
- **Later on 3 November.** The operator pasted a summary of that version (two guards: the test half
  never crosses, and one owner for the flag; K1 at about nine of the ten places; K2 only if K1
  leaves a gap the grading would explain; K2 not open on JobBench) and asked: "launch subagent to
  review and to set up plan". A read-only review against the source found that K1 needs none of the
  ten places. Six (1 to 4, 9, 10) repeat an existing owner. Two (6, 7) change what a seat is given
  for a runtime gap stage 1 does not have. One (8) names an owner that holds no milestone count. One
  (5) names the wrong owner, since the stored-pack path needs a v1 sweep. It also found that the
  first guard rests on the network block, which is not applied, and on a split only the study
  knows.
- **Later on 3 November.** The operator: "re-initiate it to build a .md Plan". This file was
  rewritten to the review's shape: a recipe of the study for K1, one production change for K2, and a
  measurement on the train half that decides whether K2 is built.
