<!--
Copy to <dir>/shared-instructions.md, replace each «field», and delete "Assumed repaired" in round
1. -->

# System audit «round», «subject»

## The question

The operator asks: «the operator's question, in their words». This round comprises «n» independent
sessions, each assigned one subsystem and one analytical lens (`flaws`, `rethink`, `delete`,
`factors`, or `robustness`) specified in your task. Evaluate the system's design against the pinned
`AGENTS.md` section 1 rather than focusing solely on the latest pull request. Every claim must name
its evaluation pillar (`wall`, `supply`, `climb`, `honesty`, `verdicts`, `grounding`, `economy`,
`systems`, `outside`) and the v1.0 requirement it blocks or advances as defined in `system-audit`'s
table "The pillars and the v1.0 bar" (or state `none`). Do not presume a defect exists, and do not
interpret the absence of proof as proof of failure.

## What is open

Everything is open to question except measurement honesty (the sandbox wall and rules 3 to 8),
which a proposal may alter only with proof that the honesty property remains intact. Any other
mechanism, prompt, default, reader, skill, or rule in `AGENTS.md` may be questioned, merged, or
deleted; each earns its place only while its rule 13 chain holds. Treat historical incidents noted
in head comments as failure modes to evaluate: state whether your alternative allows them to recur.

## Your lens

- **flaws**: trace your subsystem end to end; before inspecting campaign logs, write down what the
  logs should show under your hypothesis, then count.
- **rethink**: before opening any source file, read only `AGENTS.md` section 1 and your subsystem's
  purpose, and write your first-principles design under **Sketch**. Then inspect the codebase and
  compare both designs symmetrically; neither is right by default.
- **delete**: map every concept and count actual option values, branch events, and export readers
  across logs and source. Flag any concept with a missing link as a deletion candidate, and state
  what removing it reopens.
- **factors**: for each pillar defined in section 1 and
  `.claude/skills/design-and-seats/references/question-and-factors.md`, identify the failure mode
  it guards against (with a recorded case) and any failure mode left undetected; the authoritative
  fold that computes it (function, file, line) or "hand count"; every restatement in the tree,
  quoting any two that diverge; and every path, symbol, and number verified against source.
- **robustness**: test failure modes including a kill at any line, a torn log append, a provider
  error or timeout, a missing sandbox wall, concurrent writers, host load and clock drift, and an
  unreachable host. Cite the test enforcing each guard, or specify the hostile test that would.

## Assumed repaired

Treat the following prior confirmed findings as already resolved: «1. each earlier confirmed
finding, one sentence». Use them as counterfactual assumptions rather than reporting them again.
Consult earlier reports to avoid duplication: «path».

## Authority and source

This session is strictly read-only: perform no file edits, test runs, installs, paid solves, live
seats, campaigns, branches, pull requests, process kills, schedules, messages, or sub-sessions.
Other sessions may be editing this repository, so leave the tree undisturbed. Read the machine
rules referenced by your instructions, followed by the pinned `AGENTS.md` and the skills owning
your subsystem.

The source is pinned to «commit» («what it is»). Because your working directory «worktree» may
advance, cite source via `git show «commit»:<path>` or `git grep <pattern> «commit» -- <paths>`
with one-based line numbers.

## Evidence

Inspect code, callers, and tests first (after writing the sketch under `rethink`). For every
observed discrepancy, test at least three competing explanations (including intended behaviour and
sampling noise) and actively seek the strongest counterexample. Drop any claim already resolved at
the pinned commit.

Campaign logs are catalogued in «<dir>/recent-logs.json» with citable snapshots; state the exact
event count you read up to. Examine four to eight relevant campaigns across multiple packs. Because
a run is evidence only about its own launch commit, treat defects fixed in subsequent commits as
historical. Keep promotion attempts, promotions, later confirmations, and exam changes distinct.
Invoke production readers with explicit paths:

    bun --no-env-file tools/wri/wri.ts read --log <absolute log.jsonl>
    bun --no-env-file tools/wri/wri.ts climb --log <absolute log>,<absolute log>

If a reader cannot execute without installing dependencies, inspect the fold and log directly and
note that limitation. Rate-limit waits, exhausted logins, and elapsed wall-clock hours are
expected operational conditions rather than learning defects (rule 15). Verify any absence claim by
inspecting the symbol and its callers; treat missing human labels as an evidence gap. Perform no
web searches and never inspect credentials or env files. Never quote exam-side content (tasks,
answers, hidden values, or checks) or solver traces; cite event kinds, indices, session IDs, counts
with denominators, and source lines, and omit host names, account names, and credential paths. No
audit report ever reaches a model seat.

## Report

Your final response is the report; write no files to disk. Include the sections required by your
lens, in order.

**Sketch** (`rethink`): your first-principles design written before opening source, unmodified.

**Findings** (`flaws`; any lens may add findings): at most «three in round 1, two later», ranked by
severity and never padded. For each finding, state: pillar and v1.0 requirement; a one-sentence
claim typed as correctness fault, operational condition, observability defect, or design trade-off;
why it matters (and survives the assumed repairs); owning mechanism with callers and tests; runs,
event locators, and counts with denominators; rival explanations tested; and evidence grade
(**demonstrated**, **supported**, or **unproved**, kept strictly separate).

**Proposals** (`rethink`, `delete`, `robustness`): at most three, ranked by capability retained per
unit of machinery removed. For each proposal, state: pillar and v1.0 requirement; the proposed
change in one sentence (delete, merge, move, redesign, or add a hostile test); measured cost of the
current form (lines, branches, option values, branch events, export readers); what it removes,
retains, and sacrifices; any honesty property affected and why it still holds; and the decisive
verification (replay, rehearsal, or fresh run) together with one falsifying prediction.

**Does not make sense** (every lens): uncapped list, one line per item: `path:line`, what is
anomalous, and one verifiable sentence.

**Pillars** (`factors`): one row per pillar listing its authoritative fold (or `none`), conflicting
restatements, and refuted statements.

**Rule challenges**: any rule or default you judge flawed, with supporting evidence and the honesty
risk of changing it. All rule changes remain operator decisions.

**Works**: the strongest argument that the system works as designed, components confirmed sound,
runs inspected and uninspected with snapshots, and any limits on your access.
