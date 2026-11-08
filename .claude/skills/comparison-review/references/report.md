# The forms

## The ledger

`<dir>/ledger.md` only grows; a correction is a new row naming the old one.

```text
Question (operator's words):
Comparison:      kind, arms, condition, commit, where its record lives
Already seen:    every result, cut and deliverable read before this line, by whom
Primary measure: one, with its direction
Secondary:       each, read as description
Seal:            salt (the digest of this file's first version), open tasks, sealed tasks
Burned tasks:    task, by which session, for which row (grows)

Cuts (one before each runs):
  id | why | when | planned or after seeing | result in one line

Explanations (written before the unsealing):
  id | explanation | kind (innocent, instrument, mechanism) | predicted count on the sealed half |
  falsified if | resolved: held, falsified or unreached, with the recount

Levels (one row a level, levels.md):
  level | count or "could not read" | what it closes
```

## The blind brief

Pointers and open questions only: no count, conclusion, favourite, or which arm is which.

```text
Independent, read-only review of two sets of deliverables, X and Y, on the same tasks. Say what you
find before you say why. You get hints, not findings; treat every hypothesis as open.

Where things are: <paths; neutral arm names; the grader's source if it is read>.
Hints, as questions: <what to compare; what the grader reads; how a score is formed; for each split,
what differs and whether the stated reason holds of the whole deliverable; the conditions; what
measures noise>.
How to work: test at least three explanations, one innocent. Count, with denominators. Keep what you
measured apart from what you infer. Read as hard for X as for Y.
Limits: read-only; write only to <folder>; no paid call, solve or session; never open an env file;
run Python with -I when it reads the store.
Report: findings by level, then each explanation as confirmed (counts and paths), plausible (the test
that settles it) or refuted, and what you could not establish.
```

## The backtrack brief

The cards and the repository at one commit; never the comparison's name, scores, deliverables, the
review's folder or a backlog entry about it.

```text
Read-only. For each shape below: find where the mechanism lives at <commit>; say whether it exists as
stated; count it in the system's record across campaigns, domains and kept harnesses, with
denominators, logs and commits; name the owner; say what changing it would reopen and what the
record cannot show. Test the innocent reading first (intended, or rare). Propose no course for any
model.

Shapes: <cards>
```

## The report

Lead with the answer, keep each part short with counts and denominators, use attribution-and-proof's
wording, and quote no task, rubric, answer or trace.

```text
Answer:          the operator's question, and how sure, in two sentences
Corrections:     anything said earlier that this refutes
The comparison:  what ran, its share of the whole, its condition, test and size
Levels 0-6:      what held and broke, each with its closing count
Levels 7-11:     where the gap sits, at each grain, both directions
Explanations:    each held, falsified or unreached, with the recount
Cuts:            how many, how many after seeing
Burned tasks:    which, and what remains unburned
Noise:           the clean A/A, or "unmeasured"
Dispositions:    defects, instrument facts, limits, leads, domain choices, dropped
Could not read:  what stayed unknown
Experiment:      the smallest that separates what survives (arms, rollouts, cost, prediction,
                 falsifier), on the operator's word
Decisions:       for the operator, each with a recommendation
```

Avoid "improved", "better", "fixed the score" and "the cause was": a defect is fixed, and a gain is
claimed only by a later comparison that read it.
