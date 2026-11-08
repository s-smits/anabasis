# Rules

Read this for the reasons and edges behind the fifteen rules of `AGENTS.md` section 8, which states
each as it binds and is the one to cite. A rule with nothing to add here is omitted.

- **2. Only the Examiner writes the exam.** A check ruled defective goes back to its author. A
  drafted exam is drafted once, before its first task, and no seat repairs a check afterwards.

- **3. The wall.** The tests are "what crosses to the Builder" in `test/builder.test.ts` and "tells
  the Builder the same whichever held-out task was won" in `test/builder-led.test.ts`. The rule
  binds the build side and covers prompts, tool descriptions, tool results, home files and the
  choice of practice tasks; a pull request that touches such a message says how it checked this.
  The Examiner's view is in `design-and-seats`, `seats.md`.

- **4. Terms first.** The tasks, solves a side, level, cap and prediction are logged before solving,
  because a term chosen after a result is chosen on the result.

- **7. Non-results.** An environment failure belongs to the environment's owner, never to an author.
  A broken harness counts as its own fail because, as a non-result, it would be rerun into the same
  break and drop out of the score; a malformed flag counts for the same reason, since otherwise it
  would remove a task its harness was losing.

- **8. Rulings first.** In v1, 36 of 47 rehearsal misses came from a faulty check or instrument,
  while 5 of 1,411 passes were overturned, so rejections carry most of the label noise.

- **9. No answer finders.** Verifying a property is easier than finding an answer, so a check can be
  right on a task nobody has solved. A stronger solver or an answer-finding agent would instead make
  the solver match whatever the author's side found, as v1's did.

- **10. No agent writes an instrument.** An instrument (an analysis engine, a compiler, a simulator)
  is installed and pinned by digest. The reading names each check's instrument by its tools, or
  `author`; an `author` check needs `--admit` by name or `--admit-authored`, which a launch without
  `--hitl` gives.

- **13. Machinery on evidence.** An admission condition earns its place by changing a decision
  correctly, so prefer removing or widening one to adding a wall. A fix rewrites the owner and the
  neighbouring code its old shape bent, and an overhaul leaves its part simpler as
  `reduce-complexity` measures it.

- **14. Stop when nothing can be learned.** A comparison made of non-results is an operational
  result and says nothing about a harness.

- **15. Limits are ordinary.** A named reset is waited out inside the solve it ended (`waitOut`,
  `src/solver/run.ts`); a crash naming no reset counts towards the crash rule (`crashedRun`) and
  ends the campaign on its environment, which is a pause instead of a result. Classify the affected
  work from its events and continue from the log (`repository-practice`, section 10). `hoursLine`
  (`tools/wri/time.ts`) gives a run's hours with and without its recorded waits.
