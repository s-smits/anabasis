<!--
Copy to <dir>/shared-instructions.md, replace each «field», and delete "Assumed repaired" in round
1. -->

# System audit «round», «subject»

## The question

The operator asks: «the operator's question, in their words». This round is «n» independent
sessions, each with one part and one lens (flaws, rethink, delete, factors or robustness) named in
your task. The subject is the system's design measured against the pinned `AGENTS.md` section 1,
not the newest pull request. Every claim names its pillar (wall, supply, climb, honesty, verdicts,
grounding, economy, systems, outside) and the v1.0 requirement it blocks or moves, as the
system-audit skill's table "The pillars and the v1.0 bar" defines them, or says none. Assume no
flaw, and do not read a lack of proof as proof of failure.

## What is open

Everything except the measurement's honesty (the wall and rules 3 to 8), which a proposal may change
only with proof that it still holds. Any other mechanism, prompt, default, reader, skill or line of
`AGENTS.md` may be questioned, merged or deleted; it earns its place only while its rule 13 map
holds. A dated incident in a head comment is a lesson: say whether your alternative lets it recur.

## Your lens

- **flaws**: trace your part end to end; before searching the runs, write what the logs should show.
- **rethink**: before opening any source, read only section 1 and your part's purpose and write
  under "Sketch" the design you would build. Then read the code and diff both ways; neither side
  is right by default.
- **delete**: map each concept and count option values, branch events and export readers in the logs
  and tree. A concept with a missing link is a candidate; say what removing it reopens.
- **factors**: for each pillar as section 1 and
  `.claude/skills/design-and-seats/references/question-and-factors.md` state it, give the failure it
  guards against with a recorded case and any failure none detects; the fold that reads it
  (function, file, line) or "hand count"; every restatement, quoting two that differ; and each path,
  symbol and number checked against source.
- **robustness**: try a kill at any line, a torn append, a provider failure or timeout, a missing
  wall, two writers, load and the clock, a host down. Name the test that holds each guard, or the
  one that would.

## Assumed repaired

Treat as solved: «1. each earlier confirmed finding, one sentence». They are counterfactual, never
new findings. Earlier reports, to avoid repeating them: «path».

## Authority and source

Read-only: no edits, tests, installs, paid solves, live seats, campaigns, branches, pull requests,
kills or other process actions, schedules, messages or further sessions. Others are editing this
repository, so preserve their work.
Read the machine rules your instructions name, then the pinned `AGENTS.md` and your part's skills.

The source is pinned to «commit» («what it is»). Your working directory «worktree» may move, so cite
`git show «commit»:<path>` or `git grep <pattern> «commit» -- <paths>` with one-based lines.

## Evidence

Read the code, its callers and tests first (after the sketch, under rethink). For each mismatch test
at least three explanations, among them the intended behaviour and sampling noise, and seek the
strongest counterexample. Drop a claim the pinned commit already fixes.

Campaigns are listed in «<dir>/recent-logs.json» with snapshots to cite; name the event count you
read up to. Read four to eight relevant campaigns across packs. A run is evidence only about its own
commit, so a failure a published change addressed is history. Keep promotion attempts, promotions,
later confirmation and exam changes apart. Use the production readers with explicit paths:

    bun --no-env-file tools/wri/wri.ts read --log <absolute log.jsonl>
    bun --no-env-file tools/wri/wri.ts climb --log <absolute log>,<absolute log>

Where a reader cannot run without installing, read the fold and the log and say so. Waits,
exhausted logins and elapsed hours are no learning flaw (rule 15). An absence claim needs its symbol
and callers checked; a missing human label is an evidence gap. No web search, credentials or env
files. Never quote exam-side text (a task, answer, hidden value or check) or a trace; cite event
kinds, indices, session ids, counts with denominators and source lines, and keep machine names,
account names and credential paths out. No report reaches a seat.

## Report

Your final response is the report; write no file. Fill the sections your lens names, in order.

**Sketch** (rethink): the design written before reading the source, unchanged.

**Findings** (flaws; any lens may add one): at most «three in round 1, two later», ranked, never
padded. Each: pillar and requirement; the claim in one sentence, typed as correctness fault,
operational condition, observability defect or design trade-off; why it matters (and survives the
assumed repairs); the owning mechanism with callers and tests; runs, event locators and counts with
denominators; explanations tested; and **demonstrated**, **supported** or **unproved** (kept apart).

**Proposals** (rethink, delete, robustness): at most three, ranked by result kept per machinery.
Each: pillar and requirement; the change in one sentence (delete, merge, move, redesign, add a
hostile test); the present form's measured cost (lines, branches, option values, branch events,
export readers); what it removes, keeps and gives up; the honesty property it touches and why that
holds; the decisive test (replay, rehearsal or fresh run) and one falsifying prediction.

**Does not make sense** (every lens): uncapped, one line each: `path:line`, what, and one sentence a
reviewer can check.

**Pillars** (factors): a row a pillar: its fold or "none", differing restatements, refuted
statements.

**Rule challenges**: a rule or default you think wrong, with evidence and the honesty risk of
changing it. These are the operator's decisions.

**Works**: the strongest case that the system works as it is, what you found sound, the runs read
and unread with snapshots, and your access's limits.
