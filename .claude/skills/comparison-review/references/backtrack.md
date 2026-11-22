# From a finding back to the system

A comparison shows what happened on one evaluation set; what may enter the system is only a domain-general mechanism that holds beyond it. A shape card strips away the specific comparison, a causal chain locates the responsible owner, and an eight-question gate tests whether the system actually warrants the change.

## The shape card

```text
Shape:           the mechanism, stated in the canonical terms of AGENTS.md section 14
Where:           the suspected owner (a repository path), or "unknown"
Observable:      what the system's own record shows when it recurs (an event, field, or count)
Would look like: a concrete instance in any domain
```

A shape card names no benchmark, task, rubric, or arm, reveals neither direction nor score, and never mentions what would have raised a metric. For example, "a guide's statement about resource limits persists into a runtime with different limits" is a valid card, whereas "the harness lost points on JobBench because it wrote less" is not. The mapping from comparison result to shape card stays in the ledger; any finding that cannot be expressed as a general shape remains a fact about that comparison alone.

## The causal chain

Trace backwards from the observed score difference through the deliverable, the solve trace, what the solver was told and could execute, how the harness was exported, what the Builder wrote and was rewarded for, and what the exam demanded. Advance one evidenced link at a time and stop at the first owner whose behaviour applies across all domains. Any link lacking direct evidence terminates the chain and specifies the test required to extend it. Code owns conditions and evaluation boundaries; models own content (section 2, `design-and-seats`).

| Where the chain ends | Owner | Permitted action |
| --- | --- | --- |
| The grader's view | the external benchmark | none; record as an instrument fact |
| Harness export / carrying | `studies/shared/`, the study | make exported instructions accurate and tools runnable |
| Execution conditions | the host or the study arm | equalise conditions, or document the confound |
| Harness content | the Builder | never hand-edit (section 2, consequence 3) |
| Builder visibility | `src/builder/`, section 1's closed list | expose a missing public fact within rule 3 |
| Comparison reward signal | `src/kernel/compare.ts`, the operator | operator decision after `promotion-tuner` replay |
| Exam scope and difficulty | `src/examiner/`, `examiner-complexity` | revise ladder, prompts, or domain prompt |
| Solver conditions | the operator (section 3) | operator decision |
| Base model capability | nobody | none; report as a model limitation |

## Counting recurrence in the record

A fresh session blinded to the comparison counts each shape across archived campaigns, domains, and kept harnesses using existing readers (`bun run runs replay`, `promotion-tuner/scripts/table.ts`, `harness-audit/scripts/harness-versions.ts`, `examiner-complexity/scripts/grades.ts`, `bun run runs source --has <text>`). Report every count with its denominator and commit range, treat multiple runs on the same pack as a single context, collect counts before making any code change, and report zero occurrences plainly.

## The eight questions

A shape card advances to action only by passing all eight questions, with an explicit written justification for every "no":

1. **Can it be stated without referencing the comparison?**
2. **Would it still be proposed if the comparison outcome had reversed?** A false statement in a guide is defective regardless of who won; "write more" is proposed only after a loss and fails this mirror test.
3. **Does it recur across at least two independent contexts, verified by count?** A single context yields a lead for investigation rather than a code change; unambiguous implementation defects require no recurrence.
4. **Is the external benchmark completely absent from the proposed change?** None of the benchmark's vocabulary, rubrics, thresholds, deliverable types, or task shapes may enter code, prompts, checks, or exams; a change justified only by its benchmark score is overfitting.
5. **Does it uphold the stance of `AGENTS.md` section 2?** Supply facts rather than strategies or targets, add no secondary constraint on the Builder, keep domain knowledge out of the Starter, and avoid scaffolding a capable model does not need.
6. **Does it satisfy rule 13's design map**, favouring simplification or rewriting of an existing owner over adding new machinery?
7. **Which trade-off in `AGENTS.md` section 1 does it move, and what warning sign should be monitored?** A change claimed to have zero cost has not been properly analysed.
8. **Can it be falsified using the system's own evaluation metrics** via a single pre-registered count observed before touching the external benchmark?

## Dispositions

- **Defect**: objectively wrong regardless of outcome direction; repaired at its owner (or escalated if it alters what a solver is told), without claiming a performance gain.
- **Instrument fact**: reported alongside the benchmark score to qualify interpretation.
- **Limit of the claim**: incorporated into every public claim about the comparison.
- **Lead**: recorded as a single row in the measuring run's `predictions-<run>.md`, settled in `outcomes-<run>.md` or carried forward under a fork's `## Carried`.
- **Domain choice**: escalated to the operator with supporting evidence.
- **Dropped**: retained in the report together with the gate question it failed, keeping the denominator of considered ideas transparent.

## Worked examples

The examples below come from the initial JobBench review of a promoted jobstat harness. Because they were categorised by a sighted author and not tested forward, they illustrate the gate mechanics rather than validated findings.

| Finding | Shape card | Disposition |
| --- | --- | --- |
| The guide stated "20 turns and 30 minutes" in a runtime without those limits | A guide's statement about resource limits persists into a runtime with different limits | Defect in export (`studies/shared/claude-export.ts`) |
| 7 symlinks dangled, including `bin/python` | Absolute symlinks created inside a temporary directory break once the directory moves | Defect in export |
| A tool failed on a path present only inside a campaign workspace | A harness program assumes paths specific to its build workspace | Lead, counted across kept harnesses; no new restriction on the Builder |
| A character cap truncated spreadsheets; 7 criteria collapsed into 32 points | none: specific to the external benchmark | Instrument facts and a limit of the claim |
| The built arm wrote less and lost points on omitted statements | A harness selected on one metric invests less effort in unrewarded outputs | "Write more" dropped by question 2 (mirror test); the selection question remains a lead |
| Tied with the pilot's Starter on 4 of 8 tasks | none: rubric weighting makes ties frequent | Dropped |
