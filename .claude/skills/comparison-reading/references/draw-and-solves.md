# Terms, the scored draw and the solves

Read this for comparison terms, task selection and solve outcomes. This expands the first part of
`AGENTS.md` section 7.

The head comments of `src/kernel/compare.ts` (the tally, the test, the step),
`src/campaign/round.ts` (running one: terms, fresh solves, the cap, rejections) and
`src/campaign/comparison.ts` (reading one back) are the full account. Here is the model.

## Terms first

Before solving, a comparison records its harnesses, setting, scored tasks, solves per side, level,
objective rule, cap and any `--predict` statement in `comparison.started`. A continuation keeps
these terms. A request to change them is refused.

## The scored draw

The scored tasks are `--target` held-out ones, the newest epoch's first and, within it, those held
out since the last comparison began, each drawn by the contract's hash. The draw (`poolOf`) leaves
out a task with no valid answer after two comparisons until a person labels it, and takes off the
frontier as **exhausted** a task answered in every solve of the last two comparisons the reference
stood in for it, on either side (the other side's only where that is a later harness, so the next
harness must answer it too). A bill saving can still win an exhausted task. A task stays open where
an answer on record betters one of the reference's by the objective gap floor (`bettered`), since
the next harness can still win it. The counts live in one place (`SIZE`, `RUNS`,
`src/kernel/size.ts`), and every rule reads a side's every, some or none, so they hold at any
number of solves.

The draw also includes **retained** exhausted tasks: one per three frontier tasks, in addition to
the target (`scoredSet`). They expose regressions on tasks the reference can answer. Without them,
gains on new tasks could hide losses on old ones.

## Fresh solves

Each scored task is solved afresh under each harness, workers taking whole tasks in a hashed order
and the first side mirrored within a task (`round.ts`). One outer retry runs at the same slot, and a
second non-result leaves the task short. Counted starts form a prefix of the mirror, which
guarantees neither equal start times nor equal load or cache exposure. A solve counts only when its
start names the comparison, and no earlier solve is reused: a condition names the host's code, which
changes between comparisons, and one frozen draw of the reference's solves would bias every later
reading.

## How a solve ends

How a solve ends (`src/kernel/solve.ts`), and its part in a pair:

| Ending | Kinds | In a pair |
| --- | --- | --- |
| pass | | Valid. It beats an answer that is not valid; against another valid one it gains by how much better it is by the objective, where the comparison fixed one, and by how much less its solve billed |
| fail | `rejected`, once the rejection is ruled a true fail | Not valid |
| fail | `wall-ended`, `turns-ended`, `context-ended`, `no-answer` | Not valid, with nothing to recompute and no ruling. A deadline on a model silent ten minutes with no tool running is the provider's non-result instead (`SILENT_SECONDS`) |
| fail | `broken-harness` | Not valid. The harness is what is compared, and one that cannot open answers nothing |
| fail | `rejected`, ruled a check defect or unclear, or waiting for a person | The task is set aside for both harnesses |
| non-result | `provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier` | No measurement. It is solved again and is in no pair |
| flagged | | Not valid: the solver's statement that the task is malformed (`submit` with `malformed`), its side's own fail, reported apart (`flagged`). A task both sides flag ties |
