# The forms

## The ledger

`<dir>/ledger.md` is strictly append-only; record any correction as a new row referencing the superseded entry.

```text
Question (operator's words):
Comparison:      kind, arms, condition, commit, and path to its record
Already seen:    every result, cut, and deliverable inspected before this line, and by whom
Primary measure: one metric, with its direction
Secondary:       additional metrics, treated as descriptive only
Seal:            salt (SHA-256 digest of this file's first version), open tasks, and sealed tasks
Burned tasks:    task, inspecting session, and row reference (append-only)

Cuts (recorded before execution):
  id | rationale | timestamp | planned or after seeing | one-line result

Explanations (committed before unsealing):
  id | explanation | kind (innocent, instrument, mechanism) | predicted count on sealed half |
  falsified if | resolution: held, falsified, or unreached, with recount

Levels (one row per level in levels.md):
  level | count or "could not read" | what it settles
```

## The blind brief

Supply file pointers and open questions only: omit counts, conclusions, preferred hypotheses, and real arm identities.

```text
Independent, read-only review of two sets of deliverables, X and Y, on the same tasks. Describe what
you observe before proposing explanations. Treat every prompt below as an open question rather than a
finding.

Where things are: <paths; neutral arm labels; grader source if inspectable>.
Open questions: <what to compare; what the grader actually reads; how scores are formed; for each
split, what differs and whether the grader's reason holds of the full deliverable; execution
conditions; what measures variance>.
Methodology: evaluate at least three competing explanations, including one innocent explanation.
Report counts with denominators, separate observation from inference, and scrutinise X and Y equally.
Constraints: read-only; write only inside <folder>; start no paid call, solve, or session; never open
an env file; invoke Python with -I when reading the result store.
Report: findings ordered by level, followed by each explanation ruled confirmed (with counts and
paths), plausible (with the test that would settle it), or refuted, and a list of what could not be
established.
```

## The backtrack brief

Provide only the shape cards and the repository checkout at a single commit; never include the comparison name, scores, deliverables, review directory, or related backlog entries.

```text
Read-only. For each shape card below: locate where the mechanism lives at <commit>; verify whether it
exists as stated; count its occurrences across archived campaigns, domains, and kept harnesses with
denominators, logs, and commits; identify the owning subsystem; note what modifying it would risk
reopening and what the archive cannot establish. Test the innocent reading first (intended behaviour
or rare edge case). Propose no prescriptive instruction for any model.

Shapes: <cards>
```

## The report

Lead with the direct answer to the operator's question, keep every section concise with explicit counts and denominators, adhere to `attribution-and-proof` terminology, and quote no task text, rubric, answer, or trace.

```text
Answer:          the operator's question and degree of confidence, in two sentences
Corrections:     any earlier claim refuted by this review
The comparison:  what ran, benchmark coverage, execution conditions, statistical test, and sample size
Levels 0 to 6:   what held and what broke, each with its closing count
Levels 7 to 11:  where the gap sits, at each granularity, in both directions
Explanations:    each pre-registered explanation marked held, falsified, or unreached, with recount
Cuts:            total cuts executed, and how many were added after seeing outcomes
Burned tasks:    which tasks are burned, and how many unburned tasks remain
Noise:           the clean A/A measurement, or "unmeasured"
Dispositions:    defects, instrument facts, limits of the claim, leads, domain choices, and dropped cards
Could not read:  what remained unobserved
Experiment:      the smallest fresh test separating surviving hypotheses (arms, rollouts, projected
                 cost, prediction, and falsifier), subject to operator approval
Decisions:       items requiring operator authority, each with a recommendation
```

Avoid phrasing such as "improved", "better", "fixed the score", or "the cause was": defects are repaired, and performance gains are claimed only once a subsequent fresh comparison measures them.
