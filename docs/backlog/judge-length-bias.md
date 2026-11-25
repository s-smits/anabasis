# Length bias in the judged lane

## Intended change

Read whether the Referee's pairwise votes favour the longer answer. The judge prompt already tells it that length is not substance (`PAIR_SYSTEM`, `HOLISTIC_LINE` in `src/audit/judge.ts`) and `fairCap` gives both answers the same byte budget, but nothing measures what the votes do. Position bias has a structural control (every criterion is voted in both orders) and self-preference has one (the Referee is cross-family); length has only the instruction.

The read: over `referee.pair` events, the share of decisive votes that went to the longer of the two answers, with its exact 95% interval (Clopper–Pearson, as `upperBound` in `src/kernel/compare.ts` gives one side). Under no bias that share sits near one half, though longer answers can also be better ones, so the read is report-only (rule 13) until a replay shows it would change a decision.

What it needs first: each `referee.pair` event to record the two answers' byte sizes before `fairCap`, so the reader never rebuilds an answer (rule 12).

## Trigger

At least 100 `referee.pair` events across gathered logs. There were none on 25 November 2026, so a reader then would have had nothing to prove itself against.

## History

The rules review of 25 November 2026 found that `AGENTS.md` said judge gaming was "closed"; it now says length is only prompted and capped, unmeasured. The operator asked to "fix everything we need to fix"; with no judged pair on record, the fix is this entry rather than a reader.
