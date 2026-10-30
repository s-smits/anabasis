# Rules

Read this for the reasons and limits behind the fifteen rules in `AGENTS.md` section 8. Cite that
section when referring to a rule.

`AGENTS.md` section 8 states each rule as it binds and is the one to cite. Here each is given with
its reasons and edges.

1. **The comparison decides, and nothing else does.** A harness is better when a comparison reads a
   step. Practice results, Builder explanations, reviews and passing tests do not establish which
   harness is better. None may set or adjust the comparison's reading.

2. **Only the Examiner writes the exam, and nobody coaches it.** No person and no other agent, you
   included, writes or repairs a rule, a check or a task, or hand-edits a pack, a check program, a
   task, a kept harness or a log to make a command pass. A defect across domains is fixed
   in the host, a prompt or the contract code; a check ruled defective goes back to its author. A
   drafted exam is drafted once, before its first task, and no seat repairs a check afterwards.

3. **Nothing crosses the wall except the closed list of section 1.** The test is exact: changing a
   hidden value, a check, or which held-out task a harness other than the reference won leaves
   every message a Builder or a solver reads byte-identical. The suite holds it for a Builder's
   contexts and home (`test/builder.test.ts`, "what crosses to the Builder") and for its campaign
   tools (`test/builder-led.test.ts`, "tells the Builder the same whichever held-out task was
   won"). It covers prompts, tool descriptions, tool results, an agent's home and the choice of
   practice tasks; a change to such a message says in its pull request how it checked this. It binds
   the build side; the Examiner's view is section 3's list.

4. **Terms are fixed before the first solve and never moved after a result.** The tasks, the solves
   per side, the level, the cap and the prediction are logged first. Do not top up a set a dispute
   thinned, or rerun a finished comparison on other terms.

5. **Both sides are solved afresh under one setting.** No stored solve stands in for a side.

6. **One solve is weak evidence.** The same harness fails a task once and passes it the next time:
   in v1's record a fail repeated on the same bytes 5 times in 21. A fail, a win or a loss counts
   when repeated solves support it. Say so wherever a single result is shown to an agent.

7. **A non-result is never a pass or a fail.** A provider failure, a sandbox crash, a kill, a check
   that threw and a verifier that could not decide are typed, solved again, and counted nowhere;
   an environment failure belongs to the environment's owner, never to an author. A broken harness
   is the harness's own fail, since as a non-result it would be rerun into the same break and drop
   out of the score. A solver's flag that a task is malformed is its side's own fail for the same
   reason, reported separately: counted nowhere, it would remove a task its harness was losing.

8. **A rejection counts only once it is ruled, and a hand label overrides a ruling.** In v1, 36 of
   47 rehearsal misses came from a faulty check or instrument, while only 5 of 1,411 passes were
   overturned.

9. **No reference answers, no stronger solver, no agent built to find answers.** A check verifies a
   property, which is easier than finding an answer, so a check can be right on a task nobody has
   solved. v1's solver matched whatever its author's side found.

10. **No agent writes an instrument.** The facts a check compares come from the field's own tool
    (an analysis engine, a compiler, a simulator), installed and pinned by digest, and nothing in
    the system writes or edits one. A check decided by its author's own computation, a declared
    objective included, is a fault until the operator admits it, by name (`--admit`) or all at once
    (`--admit-authored`); the reading names each check's instrument by its tools, or `author`. So a
    drafted exam stands on the operator's word for each check, which a launch without `--hitl`
    gives (section 3).

11. **The host owns every limit.** A harness, a prompt or a file that asks for a later deadline,
    more prompts or model turns, or more disk changes nothing.

12. **One owner for each decision and one reading for each fact.** Before adding a check, a flag or
    a reader, find the one that exists and change it. Where two places decide the same thing, the
    pull request that notices it names both and removes one.

13. **Add machinery only on evidence, and rewrite rather than add.** Build a mechanism when a live
    result shows the need. An admission condition earns its place by changing a decision
    correctly; given the choice, remove or widen one before adding a wall. Map each new concept as
    `owner → live reader → decision it changes → evidence → hostile test`, and drop it when a link
    is missing. A fix rewrites the owner and the neighbouring code its old shape bent. A change
    that gives a decision a new owner, makes one rule another's fallback, or answers a failed run
    with a row, a threshold or a sentence deletes what it replaces in the same change, or names
    under "Not done" whatever still reads the old path. An overhaul leaves its part simpler, as
    `reduce-complexity` measures it.

14. **Stop when nothing can be learned.** A launch that cannot give a result is refused before it is
    paid for. A comparison that tested nothing says `not-scored`; one of non-results is an
    operational result and says nothing about a harness. Do not remeasure a dead provider because
    budget remains.

15. **Credit and session limits are expected, and are not defects of the system.** A login out of
    credit or at its session limit is ordinary, like a host restart: keep what was recorded,
    classify the affected work from its events, and continue from the log at the run's own commit
    once the login has capacity, or under another (section 10, item 9). A named reset is waited out
    inside the solve it ended (`waitOut`, `src/solver/run.ts`); a crash naming no reset counts
    towards the crash rule (`crashedRun`) and ends the campaign on its environment, a pause and no
    result. Do not patch, triage or report such an ending as a failure, count it against a change,
    or spend a pull request waiting it out; a generic 429, a timeout or a crash naming no limit is
    investigated. Logins are spent soonest weekly reset first, a nearly spent one included (`room`,
    `tools/runs/logins.ts`; operator, 25 October). `hoursLine` (`tools/wri/time.ts`) gives a run's
    hours with and without its recorded waits.
