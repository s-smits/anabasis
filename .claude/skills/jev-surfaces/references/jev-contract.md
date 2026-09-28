# The Jev contract, as of jev-1.13

This page condenses what the live TypeSafe documentation said on 2026-09-28, so that a surface
card can be written without re-reading the site. The site owns every number here, and the
documentation index at `https://docs.typesafe.ai/llms.txt` is where to check one before it goes
into a prediction: any page serves Markdown when `.md` is appended to its path. Where this page
and the site disagree, the site wins and this page is stale.

## What it is

Jev is a classifier rather than a generator. It takes a `state` (a string, a JSON object or an
array of text) and a map of typed questions, and answers every question in parallel against that
one state. It writes no text and no reasoning, and it calls no tools. Each answer is a
calibrated probability over an answer space the caller defined, so the caller's code owns every
decision taken from it. That last point is the one that matters in this repository, because it
means a Jev answer can only ever be an input to an owner that already exists.

| Primitive | Asks | Returns | Use it for |
| --- | --- | --- | --- |
| `noul` | whether one statement holds | `noul` ∈ [0, 1], the probability of yes | one condition; one Noul per label when several may apply |
| `choice` | which one of a closed set (at most 255 options) | `choice`, `probabilities` over every option, `confidence` | picking one owner, one kind, one line |
| `score` | how far along ordered, described levels (2 to 10) | `score` (probability-weighted level), `probabilities`, `legend`, `confidence` | a graded dimension that code then thresholds |

Choice confidence is `(n · peak − 1) / (n − 1)`, the concentration of the distribution, which
says how sure the answer is and nothing about whether the workflow built on it is right. A Noul
has no confidence field: a value near 0.5 means yes and no are about equally likely, not that
the property is present at medium strength.

## The call

One endpoint serves every model. Nothing needs installing: Bun's own `fetch` is the whole client,
which keeps a prototype inside the scratchpad and out of the dependency lock.

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json

{ "model": "jev-1.13.0", "state": …, "questions": { "<id>": { "type": "noul" | "choice" | "score",
  "instructions": "<string | object | array>", "criteria": … } } }
```

`criteria` is `{ "true": …, "false": … }` for a Noul (optional), a map from option to its
description (or `null`) for a Choice, and an ordered array of level descriptions for a Score. The
question id is never sent to the model, so the instructions must carry the whole meaning. An
`instructions` object may hold the question in one field and data in others, and refer to either
by a backticked path such as `` `brief.rules[3]` ``, the same way it points into `state`.

The response is `{ model, answers: { <id>: { type, noul | choice | score, probabilities?,
confidence?, legend? } }, usage: { input_tokens, output_tokens } }`. `model` is the versioned id
that actually answered, so record it: the `jev-latest` alias moves when a release ships, and a
threshold tuned against one version is a different condition under the next. Pin `jev-1.13.0`
in anything that is measured.

The JavaScript SDK (`@typesafe-ai/sdk`, with `choice()`, `noul()` and `score()` helpers that infer
answer types) is the right client once a surface is adopted into `src/`, because the repository
installs dependencies only through `worktree.sh` and a reviewed lock change. The prototype does
not need it.

## Price, limits and size

Input tokens cost $0.042 per million and output tokens are free. The shared limits are 250,000
tokens a second and 1,200 requests a minute, and the documentation warns that they are adjusting
dynamically, so a batch should run eight requests in flight and back off on `429`, honouring
`retry-after`. A request holds 64k tokens in all, and the state plus its single longest question
must fit in 32k.

Every question in one request shares that request's state, so asking twelve questions of one
Builder transcript costs about as much as asking one. The parallel-questions cookbook measured
13 questions batched at 12.2× cheaper and 10× faster than 13 calls, with the same answers. The
consequence for a surface card is that cost scales with records, not with questions, and that
a question which only matters for some records costs almost nothing to ask of all of them.

## Where it is weak

The jaggedness page for jev-1.13 (reviewed 2026-09-17) lists nine failure modes. Five of them
rule out whole classes of Anabasis surface before any prototype runs, which is why the skill
applies them as a filter rather than discovering them the expensive way.

1. **Arithmetic, counting and numeric closeness.** Jev does not count reliably, and it cannot
   tell whether two numbers are near each other. Margins, limits, pass counts, Wilson intervals,
   token totals and anything read off `thresholds.frozen.yaml` stay in code. A Score level is
   not a measurement either: its expectation can be thresholded but not interpolated.
2. **Dates and ordering.** Comparing timestamps or deciding which commit came first stays in
   code. Extraction of a date's parts from prose can be a Choice; the comparison cannot.
3. **Indirection.** A property of a property, or a question that needs several hops through the
   state, loses accuracy. "Does this reject control change exactly one fact of its accept?" is
   several hops; "does this sentence name a task id?" is one.
4. **Large state full of distractors.** Accuracy falls as unrelated text grows, so a whole
   Builder transcript is the wrong state for a question about one turn. Filter in code first,
   then send the turn, the line or the paragraph the question is about.
5. **Adversarial content.** State is data, and text arguing for its own classification can move
   the answer. Builder prose and Built solver output are written by models whose interests the
   answer may touch, which is a reason to keep every Jev answer advisory where those models can
   read its consequences.

The other four are literal reading (write the exact condition, put boundary cases in criteria),
contradictory instructions and criteria, no structural invariants between separately asked
questions (a Noul and a yes/no Choice on the same condition are not interchangeable, and a Noul
and its negation need not sum to one), and generation (select from candidates, never ask for a
value).

## Data leaving the machine

A request sends its state to TypeSafe's servers, which is publication in the sense this
repository's contract uses: it may be retained even if nothing uses it afterwards. The
documentation says Jev is not trained on customer requests, and zero retention is an enterprise
term. So a surface card names exactly what its state would contain, and a live call over
recorded run bytes needs the operator's go-ahead for that data class. Protected verifier detail
(rule 4 of `AGENTS.md`) never enters a state whose answer can reach a model-visible prompt,
because the answer would carry the detail across the wall one step removed. Keeping it out of
every state is the simpler rule, and nothing on the surface map needs it.
