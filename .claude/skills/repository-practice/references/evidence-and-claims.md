# 9. Status, evidence, and claims

Read this reference before assigning an evidence rung or claiming a promotion step, mechanism, or
refusal (`AGENTS.md` section 9). `attribution-and-proof` governs what conclusions a single reading
supports.

## The ladder

Each rung describes verified evidence rather than effort expended. Code that is present in source
still requires a test covering its nearest hostile case, a replay, or a rehearsal to reach "proved
without a model", and an observed event in a real run's log to reach "exercised live".

## Evidence

A type annotation verifies a data shape in the same way a prompt assertion verifies text. Because a
run provides evidence only about the exact code it executed, compare or triage only runs whose every
launch contained the mechanism under study (`bun run runs source --has <text>` or
`--holds <commit>`, `ranWith`), identifying the mechanism by source text rather than commit hash
since restacking rewrites hashes. False claims that a mechanism is absent lead subsequent work to
duplicate existing code; therefore verify symbols, callers, and a relevant check in the same turn
before asserting absence.

## What may be claimed

Report every promotion step alongside its experimental setting, task count, solves per side,
significance level, compute budget, starter baseline, and paired A/A control. Report a `no-step`
reading as "no gain found at this size" rather than as equivalence. A programs ablation requires a
standalone comparison. Results from different campaigns or settings may be presented side by side
for context, never cited as a direct gain over one another.
