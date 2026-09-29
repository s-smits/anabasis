---
name: jev-surfaces
description: Find the places in Anabasis where TypeSafe's Jev, a cheap calibrated System One classifier (Noul, Choice, Score over a text state), could replace or sit beside an LLM call, an embedding classifier, a prose regex, a lexical ranking or a blind-judge labelling loop, and prove each one in shadow against recorded labels before anything moves. Sweeps the tree for the five shapes, puts every candidate through the authority filter (what owns the decision, can it touch a pass, a score, a denominator or a gate) and the jev-1.13 fit filter, then writes a surface card with a runnable Bun experiment. Use when asked where Jev, TypeSafe or a System One model fits, what it could replace, or to run the autoresearch feature-discovery loop over this repository's records.
---

# Jev surfaces

Jev answers narrow questions about a piece of text with calibrated probabilities, for four
cents per million input tokens, and writes nothing else. This repository makes hundreds of such
judgments already: a judge deciding whether a maintainer would act on a census site, an
embedding model labelling Builder prose, a regex deciding whether an error was the provider's,
a word count deciding which lines the Builder reads. Some of them are expensive, some are
brittle, and a few are exactly the kind of decision `AGENTS.md` forbids a model to make at all.
This skill tells them apart, and it does so before any prototype runs, because the costly
mistake here is not a slow classifier but a probabilistic answer quietly deciding something
the contract gives to code.

`references/jev-contract.md` holds the API, the prices, the limits and the nine failure modes
of jev-1.13. `references/surface-map.md` holds every surface found at `96230cfc`, ranked, each
with its file and line. `references/examples.md` holds five runnable Bun scripts: the client,
a shadow judge, a context reranker, and the feature-discovery loop with the adapter that builds
its records. Read the map first when the
question is "where"; read the examples when it is "show me".

## The one rule that decides most of it

Correctness has one owner, the host verifier, and conditions belong to code (`AGENTS.md`,
design prior 1 and working rule 5). A Jev answer is a model's answer, however cheap and however
calibrated. So Jev may never decide a pass, a verdict, a case kind, a denominator, a placement,
an acceptance, an adoption or a refusal, and it may never sit inside `correctness-model/evaluator.ts`
as a check: a check's instrument is a hashed installed tool (prior 9), and a remote model behind
a credential is neither. What remains is large. Jev can label records for an investigator, rank
what a model reads, pre-screen what an expensive judge reads, annotate what a reviewer sees, and
raise a log-only safeguard line. Every one of those is advisory, which is the only kind of
surface this skill proposes.

Two more constraints follow from the contract and from TypeSafe's own documentation. A state
sent to Jev leaves the machine, so a surface card names the data class it would send, and a
live call over recorded run bytes waits for the operator's go-ahead on that class. And
protected verifier detail (rule 4) never enters a state whose answer can reach a model-visible
prompt: a Jev answer computed from verifier stdout and then shown to the Builder is the same
leak as showing it the stdout, one step removed.

## The sweep

Search for shapes, not for words like "classify". The five below are the ones Jev replaces
well, and each has a search that finds it. Run them over `src`, `tools`, `.claude/skills` and
`scripts`, from the tree whose code is under discussion.

1. **Prompt-and-parse.** A model is asked a question and its answer is parsed into an enum, a
   boolean or a verdict. Search for the parse: `rg -n "enum: \[\.\.\.|parseVerdict" src/review src/truth src/analyse`.
   A tool schema with an `enum` field, recorded by a reviewer, is the tell. Most of these are
   multi-step readers with tools, and the question is whether one narrow field of their output
   could be checked or pre-screened, not whether Jev can take the reader's place.
2. **Prose regex.** A regular expression or a keyword list deciding something about natural
   language: `rg -n "new RegExp|/[a-z].*\|.*\|.*/i" src tools .claude/skills --glob '*.{ts,mjs,mts}'`
   and filter to those whose input is prose rather than a path, an identifier or an OS error.
3. **Lexical ranking.** Lines or documents ordered by shared words: `rg -n "toSorted\(\(a, b\) => b\.score|includes\(term\)|STOPWORDS" src tools .claude`.
4. **Embedding classifier.** Nearest-anchor labelling, which is Jev's closest neighbour:
   `rg -ln "@huggingface/transformers|ANCHOR_SHA256" .claude tools src`.
5. **Labelling loop.** Blind judges, seeded samples and TSVs of verdicts:
   `rg -ln "labels\.tsv|--per-shape|judge:" .claude tools`.

A sweep that finds a sixth shape worth having is a reason to add it here with its search.

## The two filters

Every candidate goes through the authority filter before the fit filter, because a surface that
fails the first is not worth measuring. Write the answers down; they become the card.

**Authority.** Name the owner of the decision (the file and function), its live consumer, and
the decision that changes when its output changes. Then ask whether that output can move a
pass, a score, a case kind, a denominator, a placement, an acceptance or a gate, following the
consumer until the answer is certain. If it can, the surface is closed to Jev as a decider, and
the most it can be is a log-only safeguard beside the owner (the `safeguards` skill owns that
shape). If it cannot, record whether the output reaches a model-visible prompt, because then it
is a new recorded condition: the prompt digest moves, the Jev model id belongs in the evidence,
and a comparison across the change is a comparison of two conditions.

**Fit.** Put the question to the jaggedness list in `references/jev-contract.md`. A question
that needs arithmetic, a count, a numeric comparison or a date is out, and so is a battery's
public input when it is mostly numbers, which most truss inputs are. A question that needs
several hops through the state loses accuracy, so cut it into one-hop questions and combine them
in code. A state that holds a whole transcript for a question about one turn is a distractor,
so filter first. Text written by a model that benefits from the answer is adversarial content,
which is one more reason the answer stays advisory.

Then ask whether labels exist. A surface with a recorded label set can be measured in an
afternoon for cents; a surface without one needs someone to label a seeded sample first, and
that cost belongs on the card.

## The surface card

One card per surviving candidate, in `notes/jev/<surface>.md` in the checkout (ignored, so it
stays out of the tree):

```text
surface      <name>: <file>:<line> <function>
incumbent    what decides today (LLM call, embedding, regex, word count, judge) and what it costs
decision     what changes when the output changes, and who consumes it
authority    advisory | reaches a model prompt (new condition) | safeguard only | closed
state        exactly what would be sent, its size in tokens, and its data class
questions    the Noul, Choice or Score, verbatim, with criteria
labels       the recorded set to measure against, its size, its source
prediction   frozen before the first live call: the metric, the incumbent's figure, the threshold that adopts
cost         records × tokens × $0.042 per million, and requests at 8 in flight
verdict      adopt | keep the incumbent | measure first | closed, with the figure that decided it
```

## Proving one

Every experiment is a shadow run. Jev answers beside the incumbent over records the incumbent
already decided, and nothing reads Jev's answer except the comparison script. Pin
`jev-1.13.0` rather than `jev-latest`, because the alias moves under a tuned threshold. Cache
every answer by its request bytes, so a rerun replays and the numbers in the card can be
reproduced. Compare on the metric the incumbent is already judged by: Wilson intervals where a
precision is the target (the census uses a point of 0.8 with the lower bound at or above 0.6),
AUC where a probability has to rank outcomes, and agreement with the operator's own answers
where they exist. A threshold is chosen on one part of the labels and reported on the other.

Freeze the prediction first, the way `run-improvement-campaign` freezes one for a run. A
shadow result that arrives before its prediction proves nothing about the surface, because the
threshold that adopts it was chosen after seeing it.

## Adopting one

A surface that clears its prediction still changes nothing on its own. A tooling surface under
`.claude/skills` becomes a script beside the skill that owns the incumbent, and a script is
source: it goes out as a stacked pull request with focused checks, not as a documentation
commit. A product surface under `src` needs the operator's decision on three things first: the
new external dependency in a paid run, the data it sends, and the new recorded condition. It
reads its credential as `TYPESAFE_API_KEY`, records the answering `model` beside every result,
and treats an unavailable service as a typed non-result of the surface, never as an empty
answer. The incumbent stays until the recorded runs show the replacement earned its place.

## The feature-discovery loop

TypeSafe's autoresearch cookbook turns labelled free text into numeric features: a proposer
writes questions, Jev answers them for every record, a model fits the answers against the
outcome, and the proposer reads the fit's worst misses and rewrites its questions. In this
skill the running agent is the proposer. `references/examples.md` has `discover.ts`, which
answers, fits a grouped cross-validated logistic regression and writes `report.md`, and the
agent edits `questions.json` between rounds. It fits text whose outcome is recorded:
Builder prose before a submit against that submit's outcome, or a finding's text against the
operator's answer to it.

It is a research instrument and nothing else. A question that predicts refused submits is a
lead for an investigator and a hypothesis for the Builder prompt's owner, never a gate on the
Builder, and a question that predicts which tasks fail says nothing about difficulty, which
blind measurement alone decides (rule 11). Folds are grouped by campaign, since rows from one
campaign share a Builder, a domain and a prompt, and a campaign that predicts itself reads as
skill. Most of the gain in the cookbook came from the first proposal, before any feedback, so
report the first round beside the last.

## What the map found at 96230cfc

The strongest first experiment is the simplify-precision shadow judge. It has 347 recorded
judge labels, it changes no product behaviour, and a round of Opus judge packets is exactly
the cost a Jev pre-screen could remove. Next come the two embedding classifiers in
`whole-run-investigation/classifier`. They are the closest thing in the tree to what Jev does,
but both are local on purpose, and the header of `prose-classify.ts` says no row text leaves
the process, so replacing either is a data decision before it is a quality one. The context
tool's `cite` ranks lines by shared words and records the `decides` parameter without reading
it. That makes it the best product surface, and also a new condition for every Builder turn
that calls it. The provider-error regex in `runtime-blocker.ts` is the one prose classifier
that moves a denominator. It is closed to Jev as a decider, and open as a safeguard that flags
the failures it missed. The map has the rest, with the ones considered and closed.
