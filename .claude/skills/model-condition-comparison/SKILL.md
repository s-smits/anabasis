---
name: model-condition-comparison
description: Use when the operator wants two or more model conditions (Opus 5, Fable 5.1, Sol) compared on one source head and one prompt, or wants a harness change that must serve more than one model. Covers the condition design that separates harness quality from solver capability, the recorded-evidence join, the reading of each bucket, and the rule under which a change is admitted for every model rather than one.
---

# Model condition comparison

A model condition is the exact three-slot tuple in AGENTS.md: Builder, Built Harness and review,
each with kind, model and effort. Comparing two conditions means moving that tuple and nothing
else: one source commit, one prompt, one threshold manifest, one wall. Everything below exists to
keep a difference between two conditions attributable to the tuple.

The skill has two halves. The first designs and reads the comparison. The second turns what the
comparison shows into harness changes that hold under every measured model, because the product
ships one harness, not one per model.

## Why a full run per model is not a comparison

In a full run the Builder is the model. Two full runs under two conditions build two harnesses,
author two batteries and verify with two correctness models. Their pass counts are two
measurements of two different products. Reading `18/25` against `22/25` across them attributes a
harness difference, a task difference and a solver difference to the model in one breath. That
reading is refused: the comparison script returns `not-comparable` when the recorded task-set or
correctness-model hashes differ, and only the separate census and mechanism facts remain.

The same holds outside the controller. Before a side-by-side table, read the solver model and
effort from every `result.json` on both sides, not from the sweep name: on 17 September the
`veryhard-hb-opus` side had been solved by `gpt-5.6-sol` while the prime-agent side beside it was
solved by `claude-opus-5`. A series over time also needs a different harness in each cycle.

## Condition design: own conditions and cross conditions

Run the conditions as a small grid so each cause has its own cell.

| condition | Builder | Built | what it measures |
| --- | --- | --- | --- |
| own A | model A | model A | the product model A builds and solves, the standard condition |
| own B | model B | model B | the same for model B |
| cross A→B | A's adopted harness, frozen | model B | how well A's harness serves solver B on A's battery |
| cross B→A | B's adopted harness, frozen | model A | the mirror |

The own conditions are ordinary `bun run fullrun` launches, one one-line prompt, staged with the
`system-path-simulation` stager under its named condition (`opus`, `fable`, `sol`).

A cross condition seeds the adopted bundle and battery, changing only the Built pin. Use
`--product-policy fixed --max-iterations 1`: the policy permits measure or stop and refuses
build, rebuild and climb before provider work. Keep the Builder pin equal to the seed's so no
epoch is superseded.
The climb readout admits batteries by backend pin, so the cross
battery never enters its own condition's difficulty history and never pollutes a claim; it stays a recorded battery
under `domains/<slug>/runs/<runId>` for this reader to join. When the stager cannot yet express
per-slot pins for a seeded condition, say so and name that stager change before proposing another
route; do not hand-edit `.harness/backends` inside a live condition.

Two rules from AGENTS.md hold unchanged: every condition reads its own condition from its controller
opening before battery spend, and a mixed opening is its own condition, not either standard one.

## Write the predictions before launch

One falsifiable prediction per condition pair, written before any condition spends. Each names the moved
variable (the Built pin, or the Builder pin), the direction expected, and the conditions left
untested. Resolve each one as `sufficed`, `partial`, `refuted` or `untriggered` after the runs.
A prediction that cannot be refuted by the recorded rows is not one.

## Join the recorded rows

```sh
bun .claude/skills/model-condition-comparison/scripts/compare-conditions.mts \
  --condition opus=/abs/run-root/campaigns/<slug>::<runId> \
  --condition fable=/abs/other-root/campaigns/<slug>/candidates/<iter>/runs/<runId>/battery.json \
  [--json]
```

Every condition is one recorded `battery.json`, named directly or as `campaignDir::runId`, which the script
looks up under the battery roots (`candidates/<iter>/runs` and `domains/<slug>/runs`, plus
`contest`, which only campaigns measured before 2026-09-04 wrote) and refuses when it finds none or
more than one. The first condition is the reference. The script prints:

- **Identity:** run, backend pin, variant, terminal, agent, grader, task-set and threshold hashes,
  and one verdict: `paired-same-harness` (only the pin moved), `paired-same-battery` (the agent
  bundle moved too, so a difference has two candidate causes) or `not-comparable`. These labels
  compare the recorded hashes this helper reads. Check source, isolation and resource conditions
  separately before claiming that only the model pin changed.
- **Census per condition:** verified, passed, capability rate with its Wilson interval at the
  registered reporting z, unaccepted, non-result with kinds, mean turns, mean tool calls and
  solver errors. Capability rate is passed over verified. The difficulty denominator is verified
  plus unaccepted once at least one case is verified; an entirely unaccepted battery has no
  difficulty evidence. Non-results leave both.
- **Families:** passed over verified per family and condition, with unaccepted and non-result beside
  them, so a family-shaped difference is visible before any trace is opened.
- **Paired buckets** for each other condition against the reference: only the other passes, only the
  reference passes, both pass, both fail, unresolved. This pairing treats unaccepted as an
  unsuccessful attempt; it remains excluded from the capability rate. A
  non-result or an absent task makes the pair unresolved. The sign-test z is printed as advice only.
  This pairing is the operator's own comparison between two conditions the operator launched; the
  controller runs no contest and adopts a candidate on its own admitted battery, so nothing here
  decides promotion.

The output carries task ids, families, counts and hashes only. Verifier stdout, issue text,
remedies and per-task failure locations stay behind the outcome CLI's dossier for the operator
review and never enter a Builder or judge prompt.

## Read the buckets

- **Both fail.** A shared unsuccessful attempt. Inspect the harness contract and the verifier,
  then the solve traces. The bucket alone does not identify the cause. Look for a family-level
  defect before proposing a shared change.
- **Only one condition passes.** Open that task's dossier for the failing condition
  (`bun run outcome -- <campaignDir> <runId> --case <taskId>`) and read the trace for the first
  wrong transition: a tool return that hid the value it promised, a guide clause read two ways, a
  submit-attempt bound reached, context pressure, a refusal, or a wall denial. Assign one owner:
  `tools-spec`, `instructions`, `fingerprint`, contract, or environment. Write the owner beside the
  task id before proposing anything.
- **Unresolved.** A non-result or missing partner. Read the typed cause or explain why the task
  has no partner before proposing another measurement. This bucket gives no capability result.
- **No decided pair differs.** The battery found no difference, which is not evidence that none
  exists. If both passed every verified case, the battery found no limit. Choose the next
  experiment from the remaining evidence gap.

Beside the rows, compare mechanisms with the outcome and triage views: terminal reason, non-result
kinds, Builder tool census (`--builder`), refusal families, the owner each round's blocking
feedback routed to, turns and tool calls per case. A model that reaches the same pass count with three times the
turns is a different result, and a model whose Builder refused twice before adopting is a different
Builder result.

## Serve both: the admission rule for a harness change

The product ships one harness. A change proposed from one condition's losses is admitted only when its
paired effect is non-negative under every measured Built model, read per condition, never pooled.
Rank candidate changes by the worst condition's effect first (the change that lifts the weaker model
without costing the stronger one outranks a larger lift for one model that costs the other), then
by the sum. Check every required condition separately, with the model as the condition; a pooled
number can hide a change that helps one model and costs another.

Where a change may land, by owner:

- **Shared contract and starters** (`starters/`, `src/solve`, `src/meta` prompt owners): a tool
  result that names its promised value in `text`, a schema the writer and verifier read alike, a
  measured runtime fact stated once, a submit boundary sentence. These serve every model because
  every Built Harness is compiled from them. Prefer this owner.
- **Builder prompt and steering**: one controller-derived correction, not a tutorial paragraph;
  tenet 14 applies. A clause that helps the weaker model must not become a second copy of a duty
  the stronger one already follows.
- **The next authoring round**: a blocking finding routed to `tools-spec`, `instructions` or
  `fingerprint` reopens the harness under the rebuild move, and the deterministic rebuild advice
  packet carries the previous battery's issue ledger into it. This is the only route into a domain
  bundle; nobody hand-edits `domains/`.

What is never admitted: a model-conditional branch in a harness ("if the model is X, then …"),
because it makes the served model part of the task condition and breaks byte identity across
conditions; a change justified by one task; verifier detail in any model-visible text; and a change
whose only proof is a prompt assertion. A change reaches an admission claim only after a rerun
under each condition shows it, with the four evidence levels stated separately.

## Report

State, in this order: the conditions with their identities; the comparability verdict; the census
per condition; the family split; the buckets with the owner beside each model-specific loss; the
predictions resolved; the changes proposed with their worst-condition and per-condition effects; what remains
unmeasured. Use the narrow claim sentences from AGENTS.md. "Model B is better" is not one of them;
"under condition B on battery T, 21 of 24 verified cases passed against 17 of 24 under A, with 3
unresolved on each side" is.
