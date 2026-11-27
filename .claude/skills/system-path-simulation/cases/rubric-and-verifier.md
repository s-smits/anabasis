# Rubric items and the pairwise judge

A contract's objective may carry rubric items of two kinds: `code` items, which the verifier scores in the offline sandbox, and `judge` items, which the stateless pairwise judge (`src/audit/judge.ts`) votes on between two valid answers. When a cross-family reviewer is seated, the Examiner sees both kinds during `d-1` and decides dynamically whether the domain needs `judge` items; on same-family openings (`rubricLaneOf` = `"code-only"`), `draft_exam` keeps the rubric deterministic code-only and refuses `judge` items before audit. Judging runs only when the contract has a judge item and judging is admitted (automatically on unattended cross-family openings, or via `tools/eval/accept.ts --admit-judge` under `--hitl`); every other exam calls no judge and spends nothing on one. This guide names the cheapest tier that settles each question about that path.

## What each tier can settle

| Question | Tier | Command or owner | Cleared when |
| --- | --- | --- | --- |
| Do unjudged readings change? | 1 | `bun run runs replay` at both commits; promotion-tuner `replay.ts --tree <abs> --logs <dir> --since <date>` at both | Output identical but for the tree or HEAD line (0 flips) |
| Does the judged score detect a gain and hold its A/A floor? | 1 | `bun .claude/skills/promotion-tuner/scripts/simulate-scoring.ts` | Null A/A ≤ the level within Monte Carlo spread; real gain ≥ 99%; bloat and scale attacks ≈ 0 |
| Does a judged comparison lock its terms, judge every valid pair (main and A/A), resume after a fault and read a step on votes alone? | 1–2 | `test/round.test.ts` "a judged comparison", `test/judge.test.ts` | Pass through the real `checkpoint` writer and readers |
| Does an unjudged campaign stay judge-free end to end? | 2 | `bun run runs rehearse --name sim-<what> --id g-sim --new latest --held none:pass` on a seed of a verifiable campaign | Same reading at both commits; 0 `referee.pair` events |
| Does a real judge vote on substance and agree with itself under swap? | 3 | Operator-approved live seat (`cases/live-seat.md`) | Swap-disagreement and A/A rates within the plan's live watchlist |

A scripted rehearsal reaches the judged path only on a seed whose contract carries a judge item; seed from an archived judged campaign rather than authoring log events (`AGENTS.md` §5). Rehearsals seat `scriptedJudge` (`tools/runs/rehearse.ts`), which reads the two fenced answers and votes by their digests, so its two orders of a pair agree.

## Hostile cases to keep

- **Order bias.** A judge that always prefers the answer shown first must read no step: every pair is judged in both orders, and the passes cancel (`test/judge.test.ts`).
- **Missing vote.** A pair without a vote stops the comparison before its report; running it again resumes from the log and judges only what is left (`judgingLeft`).
- **Cap during judging.** A cap reached between pairs marks the comparison capped, and it reads not-scored rather than scoring a partial set.
- **Same-family reviewer.** On a same-family opening, `draft_exam` and `revise_exam` refuse `kind: "judge"` items inside the session before audit (`draftFaults` / `revisionRefusal`), and paid judged comparisons refuse same-family reviewers (`comparedOn` / `assertCrossFamily`).
- **Hidden values.** Criterion votes see a task's hidden values beside the task; the holistic vote sees neither the hidden values nor the criteria (`test/judge.test.ts`).
- **Pool closure.** Under a judge, no task closes as easy on code saturation (`poolOf`), since judged room lies above a full code score.

Report each case as `cleared`, `blocking` or `accepted-risk` with its owner, as `SKILL.md` asks.
