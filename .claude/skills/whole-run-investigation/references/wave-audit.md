# Wave audit: did the new source improve the runs

Load this when the operator asks whether a new batch of runs is better than the last one — "can you
see an improvement at the runs", "did the fixes work", "is this wave better". A **wave** is the set
of runs launched together on one source commit, one run per condition. The audit compares a
candidate wave with the baseline wave it replaced, and it is only a fair question when the two
differ in one variable: the source. It reads recorded bytes, launches nothing and changes no score;
what it concludes goes back to `run-improvement-campaign` as the next move.

The obvious reading is the wrong one. Every wave's Builder authors its own battery, so "6 of 6" in
the baseline and "4 of 6" in the candidate are two different exams, and the lower score may mean a
harder battery rather than a worse product. Raw pass rates compare only on a shared pack
(`model-condition-comparison`'s `compare-conditions.mts` refuses a join whose task-set hashes
differ, and `harness-query` solves a fixed pack on each harness). Without one, the audit reads what
the loop did with its batteries rather than what they scored.

## 1. Pair the runs and prove one variable moved

Pair each candidate run with the baseline run of the same condition, and read both `opening.json`
files: prompt digest, the three model slots with kind, model and effort, provider-turn budget,
expected task count, `--project` (fresh on both sides or continued on both), and the full
`source.commit`. Any difference besides the source makes the pair a mixed condition: report it
separately and leave it out of the verdict. Record the host conditions too — concurrent runs, load,
free disk, provider waits — because they are caveats both sides may not share.

Then list what the source moved: `git log --oneline <baseline sha>..<candidate sha>` and the PRs it
spans. Each fix in that range is a candidate cause, and nothing outside it is.

## 2. Find the prediction, and date it honestly

The audit tests what was predicted before the candidate opened, not what looks good afterwards.
Read `notes/predictions/<runId>.jsonl` for each candidate run
(`prediction.ts list --run <runId>`). A prediction written only into a plan file counts if its file
predates the opening, but say that it is dated by file time rather than frozen in the ledger. A
prediction written after the opening is post hoc: it may guide the reading, and it cannot confirm
anything.

## 3. Read the same measures on both sides

Every measure below comes from an existing reader, so run each on both waves and set the rows side
by side. Direction says which way is better for the standing goal — a climb towards really hard
tasks — not which way is bigger.

| measure | reader | better is |
| --- | --- | --- |
| placement per battery, in order; rounds before the first on-band battery; `too-easy` count | `bun run runs show <runId>` (Batteries, CLIMB column); `difficulty-decisions/` | fewer `too-easy` before the band, or any battery on band |
| what each edge asked of the solver | `wri.ts climb <campaign>` | more `escalated`, fewer `restated`, `adjusted`, `widened` |
| calibration: target met or missed, prediction score, rehearsals contradicting the target and what the Builder did next | `wri.ts read` `handoff` calibration table; the pulse plan line; lanes 10 and 11 | a target the battery can fail; a contradiction acted on before submit |
| gate cost: episodes cleared with no edit, stalls, rounds lost to the gate | `wri.ts gates <campaign>` | fewer rounds lost, fewer no-edit clears |
| evaluation-correction loops and what each correction flipped | `wri.ts gates`; `bun run replay -- <before> --under <after>` | fewer corrections, each moving a verdict |
| denominators and terminal | `runs show` cases and Terminal | no rise in unaccepted or non-results; a typed terminal |
| pace: time to first adoption, minutes per round, provider turns per battery | `runs show` observations and claim times | faster only if the rows above did not get worse |
| solver effort and margin to the limit per verified case | `case-result.json` `solver.toolCalls`; `artifact.json` against `public-task.json` | context only: it describes the exam, not the product |

Compare over equal windows. Read round against round (r1 with r1, r2 with r2), and when one wave is
shorter, cut the other to its elapsed window and name that window. A run the environment cut short
keeps every level it measured before the cut.

## 4. Tie each movement to a mechanism that fired

A measure that moved counts towards a fix only when that fix's branch actually executed in the
candidate wave. For each fix in the source range, follow `attribution-and-proof`'s "was the
intended mechanism live": its bytes are in the opening's tree, its trigger condition occurred, and
its output is recorded — a finding code, an advice line, an evidence field. Lane 21's reach reading
over the `delta` lane does this for a whole range. A fix whose trigger never occurred is
`untriggered`, not failed; a measure that moved with no fired mechanism behind it is noise or a
confound until shown otherwise.

## 5. Give a verdict per pair, then per wave

Each pair gets `improved`, `unchanged`, `regressed` or `undetermined` on the measures above, with
the one or two rows that decided it, and an attribution of `proven`, `likely`, `mixed` or
`unproven`. One run per condition is one sample: a pair's verdict says what happened, not that it
will repeat. Across the wave, count pairs by direction — five of six improving is a result and three
of six is not — and never average pass rates across conditions. Then adjudicate each frozen
prediction with `prediction.ts adjudicate` as `sufficed`, `partial`, `refuted` or `untriggered`.

`undetermined` is the honest verdict before the candidate has placed a battery, and before round
two it is usually the only one: a first battery reads the Builder's opening guess, while the climb
shows from the second edge on. Audit at three checkpoints — first battery, third round, terminal —
and keep the earlier rows rather than overwriting them.

## 6. Write it down

Write the audit beside the review it came from, or at `notes/wave-audits/<candidate sha9>.md`, in
this shape:

```text
Waves:            baseline <sha9> (runIds) → candidate <sha9> (runIds)
Moved variable:   source; <n> commits across PRs <#…>; mixed pairs excluded: <…>
Predictions:      <row ids or plan lines>, frozen <ledger | file time | post hoc>
Window:           <round r / elapsed hh:mm> on both sides
Per pair:         <condition>: <verdict> on <deciding rows>; attribution <level>; mechanisms fired <…>
Wave:             <k of n> pairs improved, <…> unchanged, <…> regressed, <…> undetermined
Prediction outcomes: <id>: <outcome> — <evidence path>
Caveats:          host load, provider waits, non-results, anything one side did not share
Next move:        one experiment, one owner — handed to run-improvement-campaign
```

An audit that ends without a next move or an adjudicated prediction was only a report; say so, and
say which checkpoint will settle it.
