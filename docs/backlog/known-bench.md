# A known-benchmark mode: `--known-bench`

Status: planned. Nothing of it is in source.

## The question

An outside comparison needs a grader nobody in either loop wrote, and a benchmark is the only one
on hand (`studies/harness2/README.md`, "Read every result against how uneven the comparison is").
Against Harness², which adapts on each scored task, a blind Anabasis campaign is handicapped three
ways: its tasks are stand-ins its Examiner wrote, its checks grade something other than the
benchmark's grader, and it builds on another runtime than it is scored on. A mode that hands
Anabasis what is known about the benchmark would show how much of a gap those handicaps make, and
would give the like-for-like arm the study lacks.

## Intended changes

1. **One flag, one owner.** `--known-bench <dir>` names a folder holding the benchmark's train half:
   task inputs, the deliverable's format and, where the benchmark has one that runs offline, its
   verifier. The campaign's opening records it, and `campaign.setting` names it, so a condition
   names the known benchmark and no solve of such a campaign is ever compared with one from a blind
   campaign (`src/kernel/condition.ts`). Every place below reads the recorded value, never the
   command line (rule 12).
2. **At most ten places act on it**, each a plain branch on the recorded value, and data rather
   than a branch wherever the value is just text to show. The candidates, in order of what they
   are expected to move:

   | # | Place | When the flag is set |
   | --- | --- | --- |
   | 1 | `tools/d2/campaign-terms.ts` | parse and check the folder; refuse a test half inside it |
   | 2 | `src/campaign/opening.ts` | record the folder's digest in the opening and the setting |
   | 3 | `src/examiner/draft.ts` | the draft is shown the train half's task inputs as examples |
   | 4 | `src/examiner/prompt.ts` | each writing session is shown the same examples |
   | 5 | `tools/d2/prepare.ts` | level K2 only: the train half's tasks become the exam, its verifier the check program, through the stored-pack path a campaign already opens over |
   | 6 | `src/solver/` | solve on the runtime the benchmark scores on, so the build-to-scoring runtime gap closes |
   | 7 | `src/builder/prompt.ts` | tell the Builder that runtime and what export drops, as public facts |
   | 8 | `src/campaign/climb.ts` | keep the campaign out of the climb milestone (`AGENTS.md`, section 10, item 9) |
   | 9 | `tools/runs/view.ts` | label the campaign as known-bench wherever a run is listed |
   | 10 | the study's export | freeze and export the reference harness for the benchmark's runner |

3. **Two levels, measured in order.** K1 hands over task inputs only (places 1 to 4 and 6 to 10):
   the Examiner still writes every task and check, which is the study's arm U ("Unlabelled training
   examples"). K2 adds place 5: the benchmark's own train-half tasks and verifier are the exam,
   which is Meta-Harness's exposure under Anabasis's optimiser. Measure K1 first; build K2 only if
   K1 leaves a gap that the grading mismatch would explain.
4. **What stays as it is.** The test half never crosses: no task, trace or grade of it reaches any
   seat, and it is scored once, by the benchmark, after the harness is frozen. That keeps Anabasis
   held out, so the mode never becomes adaptation on the scored task. No reference solutions are
   handed over (rule 9). A benchmark verifier used as a check is an instrument nobody in the loop
   wrote, and still takes the operator's `--admit` (rule 10).

## Limits known now

- JobBench grades with a model judge, which needs the network, and the verifier's cells are closed
  to it, so K2 is not open on JobBench as the verifier stands. WorkBuddy-Bench Code's hidden tests
  run offline and fit.
- A K1 or K2 campaign climbs on what it was handed, so its promotions say nothing about the blind
  climb; they are read as a study arm only.

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
  appendix in the study's README that points here.
