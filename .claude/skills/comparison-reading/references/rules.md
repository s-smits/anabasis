# Rules

Read this reference for the rationale and edge cases behind the fifteen rules in `AGENTS.md` section
8, which states each binding rule and serves as the authoritative citation. Rules requiring no
additional commentary are omitted.

- **2. Only the Examiner writes the exam.** A check ruled defective is returned to its author. A
  drafted exam is authored once before its first task, and no seat patches checks afterwards.

- **3. The wall.** The core regression tests are "what crosses to the Builder" in
  `test/builder.test.ts` and "tells the Builder the same whichever held-out task was won" in
  `test/builder-led.test.ts`. The rule governs the entire build side, covering prompts, tool
  descriptions, tool results, home directory files, and practice task selection; any pull request
  modifying those surfaces must explain how it verified the wall. The Examiner's asymmetric view is
  documented in `design-and-seats` (`seats.md`).

- **4. Terms first.** The task list, rollout count per side, significance level, dollar cap, and
  prediction are logged before solving begins, because parameters chosen after observing outcomes
  bias the statistical test.

- **6. One solve is weak evidence.** In v1, failures repeated on identical inputs only 5 times in
  21 trials; any single solve displayed to an agent is therefore explicitly labelled as a single
  rollout.

- **7. Non-results.** Infrastructure and environment failures belong to the host environment rather
  than to a harness or task author. A broken harness counts as a failure for its own side because
  treating it as a non-result would repeatedly trigger the same failure and drop the task from
  scoring. A `malformed` flag counts as a failure for the same reason, preventing a harness from
  discarding tasks it is losing.

- **8. Rulings first.** In v1, 36 of 47 rehearsal misses stemmed from a faulty check or instrument,
  whereas only 5 of 1,411 passes were overturned; rejections therefore account for the overwhelming
  majority of label noise.

- **9. No answer finders.** Verifying a solution property is strictly easier than synthesising an
  answer, so a check can remain sound on tasks that no solver has yet solved. Introducing a stronger
  solver or answer-finding agent would instead bias evaluation towards whatever the author's solver
  produced, as occurred in v1.

- **10. No agent writes an instrument.** An instrument (an analysis engine, compiler, or simulator)
  must be installed externally and pinned by digest. The checker validation reading classifies each
  check by its underlying tools or as `author`; an `author` check requires explicit `--admit` by
  name or `--admit-authored`, which a non-`--hitl` launch provides.

- **13. Machinery on evidence.** Every admission guard must justify its existence by changing
  decisions accurately, so removing or widening an existing guard is preferred to adding a new one.
  A repair rewrites the owning module and any neighbouring code distorted by the old design, and an
  overhaul should leave the subsystem simpler as measured by `reduce-complexity`.

- **14. Stop when nothing can be learned.** A comparison dominated by non-results reflects an
  operational outage rather than harness quality.

- **15. Limits are ordinary.** A rate-limit reset with a named time is waited out inside the solve
  it interrupted (`waitOut`, `src/solver/run.ts`). A provider crash without a named reset increments
  the crash counter (`crashedRun`) and ends the campaign on `environment`, which is an operational
  pause rather than an evaluation outcome. Classify affected runs from their log events and resume
  from the log (`repository-practice`, section 10). `hoursLine` (`tools/wri/time.ts`) reports run
  duration both including and excluding recorded waits.
