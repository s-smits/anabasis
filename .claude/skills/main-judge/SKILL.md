---
name: main-judge
description: "Use when adding, changing or reviewing Anabasis's Main Judge: the battery review, its recorded disagreements and the advice they feed. Keeps the Judge outside verification, evidence-bound, separately reported, and unable to alter pass, acceptance, claimability or adoption."
---

# The Main Judge

The Main Judge advises. It may not change `pass`, acceptance, claimability or adoption. A disagreement with
the verifier is a reason to audit the verifier, never to change a score.

| Component | Input | Output | Authority |
|---|---|---|---|
| Main Judge | accepted battery cases with a boolean verifier verdict | `JudgeEvidence` | may flag verifier doubt; cannot change truth |

`resolveSlots` chooses the review slot's kind and model; `reviewSlot` in
`src/review/review-session.ts` resolves it through the shared pi provider layer and
`openReviewSession` opens one pi host session on the caller's tools and framing. The Judge battery
review is the only caller on that slot for verdict sessions (`judgeSessionFor`); the diagnosis
reader and Epoch Reviewer open their own sessions on the same slot through the reader. The kind set is closed. The slot was called `judge` (`--judge-backend`,
`HARNESS_JUDGE_BACKEND`) before 2026-08-19 and those spellings no longer resolve; on a tree that
predates the rename, read `judgeBackendFor` in `src/run/judge-session.ts` instead.

## No control census

The operator removed the control census on 2026-09-14: in Sol run
`truss-sol-20260913T192126453Z-0123e5` it was invalid in 3 of 3 rounds, so its standing decided
nothing useful. A new review sends only battery cases to the Judge and writes no census sessions,
`judge/control-census-sample.json`, `judge/bait-corpus.json` or `judge/review-standing.json`.
Evidence records `judge: "unvalidated"` over zero controls, and a record with a control census
behind it is refused (operator decision 2026-09-22). Do not reintroduce a validity rule or a bait
corpus.

`JudgeDecision` is closed in source: `non-result`, `incomplete-census`, `no-battery-verdicts` and
`advisory-comparison`, which a complete review records. A disagreement means audit the verifier.
Never rescore.

## Fresh sessions

Keep these frozen `judgeDeAnchoring` rows at the judge input boundary:

- `fallbackConfigured: false`
- `commitAllTasksInPhaseZero: true`

Every subject uses a fresh session. Never add a fallback model.

## Judge framing

Keep all review instructions in the one model-visible prompt file. State the request shape: a
battery case has its bound public task, the submitted artifact and the domain contract; `abstain`
is allowed when public facts cannot decide. Do not say what would make an artifact valid.

## Disagreements are advice

Every complete boolean disagreement is recorded without a materiality threshold, and none of them
changes a score. `judgeExit` in `src/analyse/judge-reviews.ts` has two kinds: `none` when the Judge
agreed on every reviewed verified case, and `advisory` otherwise, with counts in both directions.
It records no finding and routes to no owner (`judge-reviews/v12`). Disagreements in both
directions enter the rebuild advice packet as advisory rows named by family, and the exit reason
is its judge line; only families and counts cross to authoring. A review recorded under another
schema is refused rather than read.

A recorded claim also names the case ids that disagreed on that battery. Those ids sit beside the
claim; they change no score, readiness, adoption or statement.

## Check a proposed judge dimension

1. If schema, validator, contract, or host verifier can decide it, do not add it.
2. Check whether it repeats a verifier check or proxy.
3. Check that it is useful and visible without hidden truth.
4. Check that disagreement can be audited.

## Inputs, checks, and report

Give the Judge the exact operator request, the bound public task, the submitted artifact, the
public artifact schema, the projected Builder tool contract, declared runtime facts and an explicit
output schema (`JudgePublicDomain` in `src/review/judge-contract.ts`). It receives no solve trace,
no Built system prompt and no verifier output. The tool contract is load-bearing: run 69's
`distrust-verifier` hold was manufactured because the binding conventions lived only in
`agent/tools.ts` text the Judge never saw. Never give hidden expectations, control literals,
verifier verdicts in an independent pass, verifier remedies, or approval instructions.

- Validate the exact output schema and pin model and prompt identity.
- Check that cited evidence was visible to the judge.
- Keep transport non-results separate from low scores.
- Treat every disagreement as advice for the verifier's owner, never as a verdict.
- Confirm the sanitizer ran.

Report purpose, input visibility, raw assessment, disagreements and their advisory exit, and that
the Judge owns neither truth, acceptance nor adoption.
