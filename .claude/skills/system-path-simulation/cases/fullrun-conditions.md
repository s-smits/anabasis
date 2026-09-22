# Rehearse on a full run, or stage regression conditions

**Use this case when:** the uncertain fact is what a model will do with a prompt at the smallest legal full-run shape, or two trees or conditions must be compared on whole runs. Covers the rehearsal rules and the `stage-run` / `difficulty-watch` / `predictions` tooling.

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

## Historical staging helper

The helper below predates current configuration and resume rules: it links an environment file
from another checkout and removes a copied lock. Do not use it as authority for a new launch.
Use `launch-run` and the current resume contract; the command documents the recorded setup.

A regression condition is a whole `fullrun` on one exact tree under one exact condition, usually two or
more trees or conditions side by side. Five hand-written staging scripts between 2026-08-21 and
2026-08-23 each forgot one thing (condition O died on a missing `.env` and an absent `domains/`), so the
staging is one script and the condition's identity is a file:

```sh
bun .claude/skills/system-path-simulation/scripts/stage-run.mts \
  --source <sha-or-branch> --dir /abs/condition-dir --modules-from /abs/tree-with-real-node_modules \
  --condition sol|opus --project <slug> --run <unused-run-id> --expected-tasks N \
  --prompt-file /abs/one-liner.txt [--task-set-digest <64-hex>|none] \
  [--max-iterations N] [--max-builder-turns N] [--session-cap-ms MS] \
  [--seed-campaign /abs/run-root --slug <campaign-slug>]
```

It refuses before creating anything: an existing directory, a symlinked or `@ana`-less
`node_modules`, a missing `.env`, a bad slug or run id, a missing expected task count, a
non-canonical flag, an unresolvable source or a non-UTF-8/NUL prompt. It copies the prompt bytes
without trimming or adding a newline, obtains source/request/command identities through the
detached product checkout's own identity helpers, and writes `launch.sh` with every pin of the
named condition exported plus `condition.json` (schema `simulation-condition/v1`: clean source commit/digest,
pins, project/run, prompt/request digests, expected task count, command digest, flags and a null
pid). `--iteration-budget` is omitted when absent; explicit `none` is accepted only for a fresh
condition. The prompt is loaded by the launcher without shell command substitution, preserving its
bytes through the product's `--prompt` argument.
The task-set digest is advisory staging metadata:
the product does not write it in `opening.json`; if supplied, `--opening` reports it as
unobservable and holds until recorded battery evidence can decide it. The helper never launches: the launch-run command is the only authority that may
consume a paid allowance. The two standard conditions are the exact tuples in `AGENTS.md`; a
mixed opening is a third condition and is reported as one.

Seed a later stage with `--seed-campaign`: through `seed-campaign.mts` it copies the campaign and
its domain into the condition, removes the controller lock, verifies the selected product and
audits escaping symlinks and absolute references to the source root, so the condition resumes
where that run stood instead of paying for every stage before it. For a round in this tree with a
scripted slot, use `cases/seeded-condition.md` instead. A run launched by hand has no `condition.json` and cannot be opening-checked; stage it.

Once the controller has written `opening.json`, prove the condition before reading anything else:

```sh
bun .claude/skills/system-path-simulation/scripts/stage-run.mts --opening --dir /abs/condition-dir
```

Exit 1 names the drifted source, project, run, request or slot. It requires `source.dirty === false`
and the product-written source digest, and reads only the named `controller/<run>/opening.json`,
never the newest directory. Missing product-written identity fields are a hold, not an implicit
match. Then watch the authoring sequence from the saved records,
once per check rather than in a loop:

```sh
bun .claude/skills/system-path-simulation/scripts/difficulty-watch.mts --campaign /abs/condition-dir/campaigns/<slug>
```

It prints the opening, the terminal when present, and per builder-execution record the sequence calls
(`correctness_check`, `harness_trial`, `harness_inspect`, `verifier_workshop`, `submit`) with turn,
offset and outcome, and the submit rows with their finding codes. It reads the controller's own
checkpointed records, so a Claude condition and a Codex condition show the same view and no rollout jsonl is
opened. Finding codes are token-filtered; other selected fields rely on the controller schema.
Review those fields before quoting output from an untrusted or older record.

One steward per condition, as in `live-segment`: it stages, launches, checks the opening, waits on the
process or on `terminal.json`, and writes the report to the path it was given. The campaign owner
freezes the authoritative prediction/event ledger before the first launch. The parent may use
`predictions.mts --hash` to checksum an advisory projection, `--resolve` per row after the terminal,
and `--unresolved` before the session ends; those commands never consume or replace campaign
authority.

## Finish

Every condition ends with its `condition.json`, its opening check, its terminal line and its resolved prediction rows. A rehearsal result is research: findings become source changes and tests, and untested predictions carry forward verbatim to the next production run.
