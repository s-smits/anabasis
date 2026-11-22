<!-- Copy to <dir>/shared-instructions.md, replace each «field», and delete "Assumed repaired" in round 1. -->

# System audit «round», «subject»

## Question & scope

Operator question: «the operator's question, in their words». «n» independent read-only sessions each inspect one subsystem through one lens (`flaws`, `rethink`, `delete`, `factors`, `fault-tolerance`). Evaluate against pinned `AGENTS.md` §1; tag every claim with its pillar (`wall`, `supply`, `climb`, `honesty`, `verdicts`, `grounding`, `economy`, `systems`, `outside`, or `none`) and the v1.0 bar row it blocks/advances (`system-audit`). Never presume defects exist or equate missing proof with failure.

**Open to question**: everything except measurement honesty (sandbox wall and rules 3–8), which requires proof that honesty stays intact. Mechanisms, prompts, defaults, readers, skills and rules stay only while their rule-13 chain holds; check whether alternatives reopen historical failures noted in head comments.

## Lens rules

- **flaws**: trace subsystem end-to-end; write predicted log counts before reading logs, then count.
- **rethink**: read only `AGENTS.md` §1 and subsystem purpose; write first-principles **Sketch** before opening any source file, then compare symmetrically.
- **delete**: map rule-13 chains and count option values, branch events and export readers; state what deletion reopens.
- **factors**: for each pillar (`design-and-seats/references/question-and-factors.md`), record guarded & unguarded failure modes, authoritative fold (`file:symbol:line` or hand count), diverging restatements and verified symbols/numbers.
- **fault-tolerance**: test mid-line kills, torn appends, provider errors/timeouts, missing walls, concurrent writers, load/clock drift and unreachable hosts; cite the enforcing test or specify the hostile test.

## Assumed repaired

Treat these prior confirmed findings as fixed (do not re-report): «1. each finding, one sentence». Prior reports: «path».

## Authority, source & evidence

Strictly read-only: no edits, tests, installs, solves, runs, git/PR writes, kills, web search or `.env` reads. Source is pinned to «commit» («what it is»); cite via `git show «commit»:<path>` or `git grep <pat> «commit» -- <paths>` with 1-based lines.

Inspect code, callers and tests first (after **Sketch** for `rethink`). Test ≥3 competing explanations (including intended behaviour and sampling noise) and drop issues already fixed at «commit».

Logs live in «<dir>/recent-logs.json» with citable snapshots; record exact event count read, inspect 4–8 runs across multiple packs, and treat defects fixed after a run's launch commit as historical. Invoke readers with explicit paths:

```sh
bun --no-env-file tools/wri/wri.ts read --log <absolute log.jsonl>
bun --no-env-file tools/wri/wri.ts climb --log <absolute log>,<absolute log>
```

Rate-limit waits, exhausted logins and wall-clock hours are operational conditions (rule 15). Verify absences at symbol and callers. Never quote exam-side content or traces; cite event kinds, indices, session IDs, counts with denominators and lines; omit host/account/credential names. No audit report ever reaches a seat.

## Report (final response only; write no files)

Include sections required by your lens, in order:
- **Sketch** (`rethink`): unmodified first-principles design written before opening source.
- **Findings** (`flaws`, optional elsewhere; ≤«3 in R1, 2 later», unpadded): pillar & v1.0 row; one-sentence typed claim (correctness fault | operational condition | observability defect | design trade-off); impact surviving assumed repairs; owner/callers/tests; runs, event locators & counts/denominators; rival explanations tested; grade (**demonstrated** | **supported** | **unproved**).
- **Proposals** (`rethink`, `delete`, `fault-tolerance`; ≤3, ranked by capability kept per machinery removed): pillar & v1.0 row; one-sentence change; measured current cost (lines, branches, options, events, readers); what is removed/kept/sacrificed; honesty impact; decisive test + falsifying prediction.
- **Does not make sense** (all lenses, uncapped): `path:line`, anomaly, one verifiable sentence.
- **Pillars** (`factors`): row per pillar with owning fold (or `none`), conflicting restatements and refuted claims.
- **Rule challenges**: flawed rules/defaults with evidence and honesty risk (operator decisions).
- **Works**: strongest case the system works, sound components, runs inspected/uninspected with snapshots, access limits.
