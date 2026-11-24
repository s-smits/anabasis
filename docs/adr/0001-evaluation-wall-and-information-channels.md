# ADR 0001: Evaluation wall and cross-wall information channels

## Status

Accepted

## Context

Anabasis separates the exam side (held-out tasks, hidden values, check source, Referee rationale) from the build side (Builder, Solver, Built Harness). Even when raw held-out tasks are withheld, indirect signals such as high-precision practice scores, candidate-dependent practice release pools, or backend auto-loaded files can leak hidden values or held-out outcomes across the wall.

## Decisions

1. **Coarse gain bands for practice objective feedback (`src/builder/tools.ts`, `bandOf`, `BAND_EDGES`)**
   Valid practice answers are reported to the Builder only as coarse relative-gain bands against the author's recorded answer (`GAP_FLOOR`, 10%, 50%, 90%), never as raw objective values. A numeric objective can depend on hidden task values; four significant digits across several practice solves provide ~13 bits per answer and permit solving for hidden parameters directly. Coarse bands reduce leakage to ~3 bits while still showing whether an edit closed on the author's answer. Full numeric precision remains in `log.jsonl`.

2. **Reference-only practice pools and feasibility (`src/kernel/reports.ts`, `poolOf`, `releaseOrder`; `src/campaign/decide.ts`, `practiceDue`)**
   Practice eligibility, `practiceFrontier`, `practicePool`, `doubted`, `awaiting`, and `releaseOrder` depend strictly on reference solves and author answers (`validAnswer: "independent"`), never on candidate solves (`validAnswer: "known"`). Candidate outcomes therefore cannot change which tasks enter practice or how many tasks are released.

3. **Reference-only disputes during comparisons (`src/campaign/round.ts`, `floor`)**
   When a check fails to run during a comparison, only the reference arm's solve may dispute the task. Allowing a candidate solve to dispute a task would let candidate behaviour alter task counts observable on the build side.

4. **Wall-safe practice leakage diagnostics (`src/harness/files.ts`, `TASK_CODE_RE`, `BUILDER_QUOTE_WORDS`, `RARE_TASKS`)**
   Builder `check_harness` reads only the frozen harness, the public contract, and released practice tasks. Entity-code matching (`TASK_CODE_RE`) and verbatim span matching (`BUILDER_QUOTE_WORDS = 8`, ignoring spans shared by more than `RARE_TASKS = 2` practice tasks) flag practice-task memorisation with zero false positives across archived harnesses while avoiding generic domain prose.

5. **Retained `read_trace` access for disputed practice tasks (`src/builder/tools.ts`, `traceTool`)**
   A practice task disputed after a check defect leaves active `bench.tasks`, yet its prior practice solves remain readable through `read_trace` because they were already released to the build side.

6. **Omitted objective values in `try_reference` (`src/examiner/write.ts`, `formatSolveOutcome`)**
   `try_reference` reported validity, turn count, or failure kind instead of the reference's raw objective score, so single-solve objective noise did not drive survivorship filtering during task drafting. v0.14 removes the tool: the Examiner sees reference outcomes only through comparisons, which closes the channel entirely.

7. **Guide named `BUILT_AGENTS.md` rather than `AGENTS.md` (`src/meta/bundle-layout.ts`, `GUIDE_FILE`)**
   Naming the Built Harness guide `BUILT_AGENTS.md` prevents agent backends from auto-loading an `AGENTS.md` file out of band alongside the host-constructed system prompt.

8. **Wall-safe public task file seeding (`src/solver/prompt.ts`, `taskFiles`, `opened`)**
   Entries in `publicInput.files` (`{ path, text }`) are written to `public/files/` and replaced in the opening message by their path and byte size so large inputs are not duplicated as escaped JSON in turn 1. Invalid, escaping, or colliding paths remain inline in JSON without refusing the task.
