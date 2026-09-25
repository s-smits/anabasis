# Rehearse on a full run, or stage regression conditions

**Use this case when:** the uncertain fact is what a model will do with a prompt at the smallest legal full-run shape, or two trees or conditions must be compared on whole runs. Covers the rehearsal rules and the `difficulty-watch` / `predictions` tooling.

When the uncertain fact is what a model will do with a prompt, aim at the most brittle boundary
rather than the whole vertical — rehearsal 70c answered its question at minute 30 of a round
budgeted for hours. The brittle boundaries are where model-visible prose crosses a controller
boundary and no check binds it, which is where every recorded rehearsal surprise lived: carried
memory read under a changed binding (70c's inherited "tasks.json was frozen" note), starter
instructions read as claims about the kernel (the two-argument `setArtifact` line behind the 0/25
runs), an advisory reason interpreted by the Builder, a provider refusal arriving as a successful
turn (run 66's spend-limit replies charged as capability findings). Rank candidates by whether a
gate binds them; a boundary that gained a check since the concern was written is already answered.

Then run the real thing at the smallest legal shape:

1. Walk the layers first when the question is whether an actor will follow an instruction, by
   `cases/layer-walk.md`. A rehearsal launched over an unwalked stack cannot tell refusal from impossibility.
2. Pre-register the question as a falsifiable prediction before launch, with each falsifier and the
   conditions you are deliberately leaving untested.
3. Copy the needed campaign and domain state into a scratch worktree; never rehearse against the
   shared stores.
4. Launch the real `fullrun` entry with the real one-line prompt — no custom driver, no edited
   prompt — with `--expected-tasks 8 --max-iterations 1`. That smaller battery is for a project
   authored from scratch; a seeded one keeps the battery it copied. A rehearsal that seeds a stage runs as a
   segment instead; one that opens from scratch to reach a later stage pays for every stage before
   the one under test.
5. State every slot pin separately: Builder, Built and review, each with model and effort. An
   unstated slot is an unmeasured condition, and one rehearsal would have opened at `xhigh`
   unnoticed.
6. Choose prompts that split the boundary. Two rehearsals stressing opposite branches of one gate
   are worth more than two runs of the same prompt. If the first ends on a terminal that blocks the
   boundary rather than exercising it, the second cannot reach it either: fix the blocker instead
   of paying twice, as the pair that landed twice on `verifier-required` did.
7. Stop at the first decisive fact. The log lines and workspace tree at that moment are the
   evidence; derived checks replay offline through the exported functions.
8. A rehearsal result is research. Findings become source changes and tests, and predictions the
   stop left untested carry forward verbatim to the next production run.

Do not re-rehearse after the fix ships: the next real run is the rest of the rehearsal.

## Stage a regression condition

A regression condition is a whole `fullrun` on one exact tree under one exact condition, usually
two or more side by side. Prepare each tree with `scripts/worktree.sh new` at the exact source,
seed a later stage into it with `seed-campaign.mts --into-root` (`cases/seeded-project.md`) so
the condition resumes where that run stood instead of paying for every stage before it, and launch
it through `launch-run`, whose envelope is the only authority that may consume a paid allowance.
For a round in this tree with a scripted slot, use `cases/seeded-condition.md` instead.

Once the controller has written `opening.json`, prove the condition before reading anything else:
require `source.dirty === false` and the intended source commit, project, run, request digest and
slot tuple, read from the named `controller/<run>/opening.json` rather than the newest directory.
A missing identity field is a hold, not an implicit match, and a mixed opening is a third condition
reported as one. Then watch the authoring sequence from the saved records, once per check rather
than in a loop:

```sh
bun .claude/skills/system-path-simulation/scripts/difficulty-watch.mts --campaign /abs/condition-dir/campaigns/<slug>
```

It prints the opening, the terminal when present, and per builder-execution record the sequence calls
(`correctness_check`, `harness_trial`, `harness_inspect`, `verifier_workshop`, `submit`) with turn,
offset and outcome, and the submit rows with their finding codes. It reads the controller's own
checkpointed records, so a Claude condition and a Codex condition show the same view and no rollout jsonl is
opened. Finding codes are token-filtered; other selected fields rely on the controller schema.
Review those fields before quoting output from an untrusted or older record.

One steward per condition, as in `live-segment`: it prepares the tree, launches, checks the opening, waits on the
process or on `terminal.json`, and writes the report to the path it was given. The campaign owner
freezes the authoritative prediction/event ledger before the first launch. The parent may use
`predictions.mts --hash` to checksum an advisory projection, `--resolve` per row after the terminal,
and `--unresolved` before the session ends; those commands never consume or replace campaign
authority.

## Finish

Every condition ends with its `condition.json`, its opening check, its terminal line and its resolved prediction rows. A rehearsal result is research: findings become source changes and tests, and untested predictions carry forward verbatim to the next production run.
