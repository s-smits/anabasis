# The forms

## The ledger

`<dir>/ledger.md`. It only grows. A correction is a new row naming the old one.

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
  id | explanation | kind (innocent, instrument, mechanism) | on the sealed half it predicts (a count) |
  falsified if | resolved: held, falsified or unreached, with the recount

Levels (one row a level, levels.md):
  level | count or "could not read" | what it closes
```

## The blind brief

For a session reading deliverables and traces. It gets pointers and open questions. It never gets a
count, a conclusion, the author's favourite, or which arm is which where blinding is possible. Adapt:

```text
Independent, read-only review of two sets of deliverables, X and Y, on the same tasks. Say what you
find before you say why. You get hints, not findings. Treat every hypothesis as open.

Where things are: <paths; neutral arm names; the grader's source if it is read>.

Hints, as questions: <what is there to compare; what does the grader read; how is a score formed; for
each split, what exactly differs, and is the stated reason true of the whole deliverable; what are
the conditions; what measures noise here>.

How to work: test at least three explanations, an innocent one among them. Count things, and give each
rate its denominator. Keep what you measured apart from what you infer. Read as hard for X as for Y.

Limits: read-only. Write only to <folder>. Start no paid call, solve or session. Stop and move nothing.
Never open an env file. Read Python with -I when it reads the store.

Report: what you found by level, then each explanation as confirmed (with counts and paths), plausible
(with the test that settles it) or refuted. Name what you looked for and could not establish.
```

## The backtrack brief

For the session that traces cards. It gets the cards and the repository at one commit, and it does not
get the comparison's name, its scores or its deliverables. It should not read the review's folder, or
a backlog entry about this comparison.

```text
Read-only. For each shape below: find where the mechanism lives at <commit>; say whether it exists at
all, as stated; count how often it occurs in the system's own record across campaigns, domains and
kept harnesses, with denominators, logs and commits; name the owner; say what removing or changing it
would reopen; say what the record cannot show. Test the innocent reading first: the behaviour is
intended, or the shape is rare. Do not propose a course for any model.

Shapes: <cards>
```

## The report

Lead with the answer to what the operator asked. The rest follows in this order, kept short, each with
counts and denominators. Use the wording of `attribution-and-proof`, and quote no task, rubric, answer
or trace.

```text
Answer:            the operator's question, and how sure, in two sentences
Corrections:       anything said earlier that this refutes, in plain words
The comparison:    what ran, its share of the whole, its condition, its test and size
Levels 0-6:        what held and what broke, with the count that closes each
Levels 7-11:       where the gap sits, at each grain, both directions
Explanations:      each with held, falsified or unreached, and the recount
Cuts:              how many were run, how many after seeing
Burned tasks:      which, and what remains unburned of the benchmark
Noise:             the clean A/A, or "unmeasured"
Dispositions:      defects, instrument facts, limits, leads, domain choices, dropped
Could not read:    what stayed unknown
Experiment:        the smallest that separates what survives: arms, rollouts, cost, prediction,
                   what would falsify it. Needs the operator's word
Decisions:         for the operator, each with a recommendation
```

Hold back from "improved", "better", "fixed the score" and "the cause was". A defect is fixed, and a
gain is claimed only by a later comparison that read it.
