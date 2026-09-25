---
name: system-path-simulation
description: "Test an uncertain Anabasis path at the smallest real layer that can decide it: deterministic joins, live authoring and admission, semantic host probes, or controlled model comparisons. Use full-run rehearsals only when the question needs them; not for ordinary run review or a path already proved by its owning test."
---

# System Path Simulation

Use this when you need to know whether a change will work in the real system, a path has not been
walked by a real actor, or a possible blocker remains unresolved. This is not tied to launch or to
failure. Take the smallest real slice around the question: start where the change takes effect when
that directly answers it, or one or two production transitions before it when the joins are part
of what must work. A fresh unused project on a familiar unchanged path does not need it.

## Revamp log

This skill is being rebuilt from observed simulations, one dated entry per run. Read the entries
before choosing a case. When a few simulated runs stand behind them, overhaul the skill around
what they show and delete the settled entries.

- 2026-09-15, gate overhaul (PR #683). A seeded round starts from a copied campaign that has
  already passed the fresh-project path, so it cannot measure what the overhaul changed: time to
  the first preview, the rows each refusal shows, adoption. There the real run is the condition;
  `cases/real-run-watch.md` is the new case. A steward subagent per condition shares the account's
  session limit: one 429 (`session limit, resets 14:20`) ended the audit subagent and the run's
  Builder in the same minute; a fresh token on the same account died the same way at 13:49. The
  launcher now runs one minimal Builder-slot turn before the gate and refuses with the provider's
  reset clause (main 69ed55b5b).
  Stewards are gone; the launching session runs its own conditions. Seeded rounds default the
  Built slot to scripted, so the Builder → Built Harness handover stays unexercised until a real
  battery; when the question is the measure stage, run `--built live`. Still open: one runner for
  a seeded round (`run-condition.mts`) with gate questions no longer routed through
  `run-segment.mts`, and a SKILL.md near one page.

## Standing triggers

These change classes warrant a simulation; each earned its place in a recorded session
(2026-09-01: four stewards, two changed a conclusion).

| The change looks like | Steward and question |
| --- | --- |
| An interface where the tests use doubles — backend signal contracts, `vendor/pi-claude-bridge`, transports | One layer-walk over the real sources: does each field/signal the change reads actually arrive there? Both recorded production defects (the one-hour settle fallback and Claude's MCP-prefixed tool names; earlier, the acceptance-close false warranty) were green-tested wrong joins of this class. |
| A removed default, backstop or widened guard | One steward asking "what fires now that this doesn't?" Removing the six-hour session cap uncovered a hidden one-hour `DEFAULT_TURN_SETTLE_MS` that fired two hours before the new wall could start. |
| A fix that claims to repair a specific past run, before the next paid run | One past-run-replay over that run's actual recorded bytes (claims, packets, terminals), plus the nearest hostile mutation in a scratch copy. Minutes of replay against run36/run39/run40 bytes beat another dead run discovering the miss live. |
| A recorded position whose next controller round is the question | One `seeded-condition`: seed with `seed-campaign.mts`, capture the first prompt, run one round through `run-condition.mts` with the slot under test live, probe with `host-panel.mts`. The 10 September Astra condition answered handover, admission and scope binding in one 354-second native turn; its helper is now the runner. |
| A changed Judge or Epoch Reviewer prompt, schema or orientation | One `review-replay`: the live Judge over recorded cases with `judge-replay.mts`, then the live reviewer over the resulting vetoed rows with `review-settle.mts`. On 2026-09-15 the first replay refuted the chosen position in six minutes (both recorded disputes were the Judge's arithmetic) and the second settled a genuine veto against the harness. |
| An unlanded stack before a paid run | One triage, no model: list every decision change in the stack with no live exercise, give each one condition, and order them so the cheap condition can cancel the dear one — one fact, then layer walk, then deterministic replay, then the eight-task one-iteration rehearsal, then a live segment. On 2026-09-01 two of four listed conditions settled without a model: a writer/reader join (below) and a revert proved byte-identical to the tree that had created claims. |

The opening rule still wins: a change fully bound by a focused test on the real code path, and a
question only a recorded live run can answer, get no steward — mark the second `unobservable`
rather than manufacturing a finding.

A cleared deterministic condition is not finished until its owning test file carries it: the gate must
bind the join the condition proved, or the next change reopens the question. The recurring shape is
two tests that each hand-roll the same record — the watchdog readiness file on 2026-09-01 — so
neither runs the real writer against the real reader. `cases/layer-walk.md` names the method.

**The launching session runs its conditions.** No steward subagent (operator decision
2026-09-15): a subagent shares the account's session limit, and its death loses the condition's
trail. The actor under test keeps the run's own condition — for the standard Opus 5 run that is
`claude-opus-5` at medium through the production backend — and the session never stands in for it
(operator decision 2026-09-01).

## Rules that hold for every case

If a gate or test already binds the thing you are about to check, you are finished before you start.

Spend alone is not the criterion (operator decision 2026-08-16, restated 2026-08-17: "we do not
care about the money, only indirectly by checking if the model is doing sensible things; time is
more important"). Use a live behavioural condition when it can change the decision and the host already
has action authority. Keep the epistemic discipline: one stubbed thing, one variable, and stop at
the decisive fact because work past that point confounds the answer.

**Prefer a new discriminator to an idle continuation.** A condition asks a new question; a further turn
often repeats an answered one. Of four conditions run on 2026-08-17, the control changed the conclusion.
This is evidence for good experimental judgement, not a required condition count.

**Keep independent live-model conditions independent.** Give each one exact head, one evidence
packet, one question, one scratch directory and one report path, as its own background command,
and keep every other model-visible byte identical. Check each load-bearing claim against the named
bytes before routing it.

**Seed as late as the question allows.** The segment starts at the last stage whose output the
question does not depend on; everything earlier is paid for and confounds nothing.
Copy the required recorded source bytes into an owned fixture before invoking a mutating
production helper. Inspect linked runtime and tool trees too: a copied workspace can still write
through `.toolchain` into the original run, outside its fingerprint. Use owned tool fixtures for
startup and resume probes; keep real recorded trees read-only.

**Choose the production owner before the helper.** A session measures authoring, a Builder campaign
also measures continuation and admission, and a full run adds measurement and routing. Read the
actual exports and helper flags at the measured revision; a familiar script name does not prove
that it still mounts production tools or supplies the current read grant and system prompt.
For admission or semantic comparisons, read [authoring-comparison](cases/authoring-comparison.md).

**Fifteen turns is the maximum budget** (operator decision 2026-08-19, replacing the ten-turn limit
from 2026-08-17). This is the whole segment's model-turn ceiling, not a tool-call limit: one turn
may contain many tool calls. A condition may request fewer turns but never more. A segment that cannot
answer inside about fifteen turns is badly staged, not under-funded: seed later and ask something
narrower.
`turn-budget-reached` is a result to read, not a failure to retry.
Keep any smaller authorised bound. Turns, tool calls, submissions and elapsed time are separate:
one native turn can contain six submissions and hours of real compiler work. Record progress and
settlement at their own boundaries; do not add turns, nudges or a new source revision to an active
condition. An explicit wall limit is a separate part of the condition.

**A settled actor ends the step.** A continuation that calls no tool closes the step as
`step-settled`. On 2026-08-17, 15 of 22 turns across four conditions were continuations that called
nothing and answered "already complete", each still re-reading a transcript that had grown all
segment — the idle turn sent 49% more input than the working turn before it. A stage with more to
do needs a continuation carrying a reason (`--continue-file`), not an empty nudge. Spend reads as
a signal here rather than a limit: a condition whose turns cost a lot while its trail shows no tool
calls says the actor stopped working.

**Read the results before starting anything else.** The recorded failure of this script is an
unread answer rather than a wrong one: four conditions finished while their pre-registered predictions
sat unresolved. The script closes with an `UNRESOLVED` line naming each `P<n>`. Resolve them
against the trail and the workspace, and append each resolution with `scripts/predictions.mts
--resolve`; `--unresolved` lists what is still open.

**Scout every prediction to its bytes before the actor starts.** For each `P<n>`, name three
things: the surface the chosen runner mounts that can produce the observable, the recorded file
where it lands, and a reader already shown to see it on one known positive. If any is missing, the
condition cannot prove the prediction however long it runs. On 2026-09-15 a census condition went
through `run-segment.mts`, which mounts no gate, and a status probe counted a process name the
suite never started. It ran 78 minutes and 70 authoring calls, then resolved all three predictions
untriggered. `run-segment.mts` now refuses predictions naming a gate, census, F2, adoption or
battery before any backend opens (`--accept-unreachable "<reason>"` keeps a deliberate absence
question); route those questions to `run-condition.mts`. A monitor's first tick should find a positive,
not only zeros.

## Pick your case, then read it

Classify the question against the table, read the case file (or files) under `cases/`, and follow
it. One question usually needs one case; a batch of conditions may need several, read in the order the
table lists them, because the cheaper case often cancels the dearer one. Every case uses the
position rules below.

| The question looks like | Case file |
| --- | --- |
| One fact: which branch, value, identity, which version the wrapper runs | `cases/check-one-fact.md` |
| Will an actor follow this instruction — and can the stack under it carry it? | `cases/layer-walk.md` (always before a live condition) |
| Does this path hold end to end with one stubbed step? | `cases/scenario-stub.md` |
| What does the real model do from this position, in a few turns? | `cases/live-segment.md` |
| Can the Builder reach admission, repair a semantic gap, or improve under another model condition? | `cases/authoring-comparison.md` |
| Seed a recorded campaign and run one real controller round with one slot live, the rest scripted or off | `cases/seeded-condition.md` |
| Does the whole runtime hold: controller, wall, verifier, record? | `cases/seeded-project.md` |
| Compare two trees or conditions on whole runs; rehearse a prompt on a full run | `cases/fullrun-conditions.md` |
| Does a fresh project on this head reach its first preview, adoption and the Built Harness? | `cases/real-run-watch.md` |
| Two or three past runs are named: which to analyse, and how to re-run it here | `cases/past-run-replay.md` |
| What the live Judge or Epoch Reviewer now decides from a recorded case | `cases/review-replay.md` |
| "The brittle angles", "what would break", across several runs | `cases/brittle-angles.md` |
| A final test of a large PR stack: which single PR carries each error | `cases/stacked-prefix-groups.md` |

A past run beats an authored position. Before writing a situation by hand, run
`scripts/pick-run.mts` over `notes/runs/` and take the nearest recorded one; the position section
below says how to derive the rest from its recorded bytes.

## Derive the position, and keep your hands off the outcome

Every shape needs a position: where the actor stands, which bytes it holds, what already happened.
The same hand writes the position, the conditions and the verdict, so this is where a simulation stops
measuring the product and starts measuring its own prose.

### How much of the position is real

A position is four separable facts, each derived or authored on its own:

- the **tree** — `campaigns/<name>/epoch-*/workspace/`, straight into `--seed-dir`;
- the **model-visible text** — the contract and `framingDigest` in `epoch-*/builder-session.json`,
  so a seeded kickoff is proved byte-equal rather than asserted;
- the **controller state** that put the actor here — `controller/<fullrun-*>/opening.json` and
  `terminal.json`, plus the recorded case rows for that checkpoint;
- the **history the actor is told it lived** — the misleading part. Where the actor's own SDK
  transcript exists (`~/.claude/projects/<workspace-slug>/*.jsonl` for a Claude slot),
  `scripts/position-packet.mts` copies its last three to five exchanges verbatim — tool calls and
  results — under a summary that is labelled as authored, so only the summary is yours. Ten
  exchanges drown the situation (operator decision 2026-08-23). A Codex slot leaves a rollout
  under `~/.codex/sessions` in another shape; there the history stays authored and labelled.

Deriving three and labelling the fourth beats a whole position hand-built for coherence. Label them
where the predictions are written: a finding is as strong as the weakest part the behaviour
depended on.

Usually no run stood exactly here, and then the quantity is the **delta to the nearest real
position**: one level lower, eight tasks instead of 25, a rebuild advice packet the real run had
settled.
A delta you cannot state in one line means the position was decorated rather than derived. The
condition is part of it — four conditions on 2026-08-17 ran at `--effort medium` and `low` against a run
that pins higher, which is a different actor rather than a cheaper one.

Two traps run the other way. Real bytes are not automatically the right bytes: seeding from a run
that predates the change under test measures the old product. And a position no completed run has
reached raises reachability before behaviour — one recorded pair spent 910 and 431 seconds landing
twice on the same `verifier-required` terminal, answering reachability by accident.

When the block and the bytes disagree, the behaviour is a response to the story. The climb condition of
2026-08-17 declared a frozen adopted climb round over a seed its own predictions file records as
the w28 workspace "standing in as" one, shared with three other conditions.

### Whether the position hands over the answer

Production puts an actor in a situation. A seeded position tends to hand it an assignment instead,
and the recorded uses show four ways that happened:

- **An imperative production never sends.** "Decide and take your next action now" closed all four
  Builder positions of 2026-08-17; "then stop: report what you set up" closed the toolchain condition of
  2026-08-16.
- **A named target, which turns a propensity question into a capability one.** One condition asked
  whether the Builder can reach the network from its walled workspace, and its position told it to
  install PlatformIO. "Can, when told" and "does, unprompted" are different findings, and a run
  usually depends on the second.
- **The falsifier stated in the subject's own prompt.** "One more byte-identical submit ends this
  session" stood in the position of the condition predicting the session would stop resubmitting.
- **A prediction whose `caught` is compliance.** P1 and P7 that day both resolve `caught` when the
  session does what the steering text quoted in the same prompt asked; neither condition could fail. P2
  is the shape that pays — it asked whether the edit landed on the surface the finding named,
  which the prompt did not say.

The line that holds: **production constrains scope, it does not assign the next action.** A
position may name the files writable this round, because production does. It may not say what to do
with them, in which order, or when to stop.

### Steer by transition, not destination

The useful behavioural shape is `A → B → {C, D}`:

- **A** is the actor's settled past, derived from recorded bytes: what it built, what was measured and
  what decision boundary it reached.
- **B** is the new controller-owned situation: the selector moved, a scope opened, or a public fact
  became available. Append B at the boundary where production would deliver it, normally through
  the real handover rather than by putting future history in the first kickoff.
- **C and D** are plausible outcomes. They belong in the campaign-owned frozen prediction/event
  ledger and its advisory simulation projection, never in model-visible text. The expected or "right" answer must not appear as a named target,
  suggested mechanism, falsifier or stopping instruction.

Write the transition as ordinary continuity: "You were in A. The controller has now selected B.
The workspace is exactly as that completed stage left it, and this round has scope S." This gives
the actor enough orientation to proceed without assigning the action it should take. Use the real
controller's reason and contract where they exist; an authored transition is labelled as such.

For an authored A or B, pre-register and run three conditions when the question is important enough to
change production prose:

1. **Natural transition:** A followed by B, with neither C nor D named.
2. **Context-minus control:** the same bytes and contract without the authored transition sentence.
3. **Counterfactual transition:** the smallest legitimate B′ for which the correct branch should
   change.

The first pair measures whether the transition steered behaviour. The counterfactual measures
whether the actor read its meaning rather than merely following its vocabulary. If B and B′ lead
to the same branch, do not claim contextual reasoning. Keep all other model-visible text,
model pins and tool contracts identical, and record each prompt digest separately.

Re-reading your own position for this does not work, since you wrote the sentence. Two checks
instead: every imperative in the position must be quotable from a production surface, and one condition
runs with the sentence removed — a behaviour that survives removal belongs to the product.

### Say what you did not run

Pre-register the prediction rows before the first condition. Condition selection, dropped conditions and reruns
belong to the campaign-owned frozen prediction/event ledger; this simulation note is only an
advisory projection of those rows. `predictions.mts --hash` writes a local integrity checksum for
the projection and refuses to replace it after the note changes. It does not create campaign
authority, consume an allowance, choose an experiment or promote a result. A rerun or newly justified
condition gets a new campaign prediction/event, not a silent edit to this projection. State the
expected outcome and what would refute it. Include an expected-failure condition when the evidence
supports one; a demonstration with no discriminator is not an experiment.

## Scripts

All under `.claude/skills/system-path-simulation/scripts/`; each takes absolute paths and refuses
a relative path or an unknown option.

| Script | Duty |
| --- | --- |
| `pick-run.mts` | list recorded runs from `notes/runs/` with ancestry, denominator and component facts for comparison |
| `position-packet.mts` | the last 1–5 exchanges of the actor's own SDK transcript, verbatim under a labelled authored summary, with the source digest |
| `difficulty-watch.mts` | the authoring sequence and submit rows from recorded builder-execution records, codes only |
| `predictions.mts` | `--hash`, `--verify`, `--resolve`, `--unresolved` on the prediction note |
| `run-segment.mts`, `seed-kickoff.mts` | a seeded live segment over the production backend |
| `seed-campaign.mts` | clone a recorded campaign into a fresh tree, or republish its selected product under a new slug here, with the symlink and absolute-path audit and `seed.json` |
| `run-condition.mts` | one real controller round over a seeded slug with each slot `live`, a scripted module or `capture`; wall, sampled process census, preregistration digest, `report.json` |
| `judge-replay.mts` | the live Main Judge over recorded battery cases under the current prompt; verdicts and the vetoed rows |
| `review-settle.mts` | the live Epoch Reviewer over a scratch copy of a recorded battery with vetoed rows to settle |
| `host-panel.mts` | valid, equivalent and hostile artifacts for one task through the real verifier host; fingerprint before and after |
| `show-prompt-surfaces.mts` | the exact model-visible surfaces and their digests |

The build stage has one interface, `HarnessBuildOptions.builderRuntime` (`src/run/harness-build.ts`).
Production binds the live transport; a scripted session bound there still runs the real submit,
census, solvability and adoption path. `test/full-run-scripted-loop.test.ts` runs the whole
controller loop through it with no provider, and `test/helpers/scripted-builder-runtime.ts` is the
one scripted session both that warranty and `run-condition.mts` use. Do not hand-build a session,
a seed clone, a product pointer, a wall, a process census or a host panel again: each has an owner
above, and the recorded setup faults of 8 to 10 September all lived in hand-written copies of them.

## Separate your script's faults from the product's

A simulation produces different kinds of refusal that can look identical on stdout. Classify the
owner before attributing behaviour; repair setup faults and verify the repaired path within the
existing authority before making a product claim. Recorded artifacts, all from simulations
that were otherwise sound: a scratch tree with no `node_modules` above it failing as `Cannot find
module '@ana/agent-bundle'`; a helper typed `level: number | null = TARGET_LEVEL`, so the "level
omitted" scenario passed `undefined` and triggered the default it claimed to omit; a script that
never passed `expectedTasks`, making its own silence read as a battery shortfall; a scratch copy
that symlinked `node_modules`, which `fullrun` refused before any provider work; a probe that
called the wrong export and failed before reaching the product fact at all; a seed exported with
`git archive` and therefore without `.git`, which `initWorkspace` overlaid with the starter skeleton so
both conditions rebuilt from placeholders while the note declared an adopted-product position
(2026-09-13; `run-segment.mts` now commits such a seed as the root and verifies the bytes).

For every refusal you intend to report, name the production
caller and confirm it passes the same arguments your script passed, from a tree set up the way
production sets one up. If the real caller passes more, your scenario is not yet the production
scenario.
Preserve the failed attempt and classify its owner: simulation setup, shared product code,
generated candidate, or provider/host environment. A repaired setup gets a new labelled attempt;
do not fold it into a model's failure count. Reproduce a shared defect against unchanged candidate
bytes when possible, then add the positive and nearest hostile case to its existing owning test.

## Test the helpers without model spend

For a changed simulation script, use the repository's prepared-worktree runner and the suites in
`test/`. From that prepared tree:

```sh
bun run test -- test/sps-*.test.mjs test/system-path-simulation-segment-loop.test.js test/system-path-simulation-workspace-changes.test.js test/full-run-scripted-loop.test.ts
```

One `test/sps-<helper>.test.mjs` per helper: select only the ones owning the change. Bun never
descends into this hidden directory, so a suite written beside its helper is never run by
anything — `test/test-discovery-completeness.test.ts` refuses one. Zero discovered tests is not a
pass. A prose-only skill edit needs frontmatter/link validation and diff review, not this runtime
matrix or a paid model replay.

It opens no model session. It covers the seeder's audit and republication, the runner's slot modes and refusals, the host panel's verdict rows, exact kickoff and appendix bytes, prompt-surface identity,
strict preflight refusal before backend construction, fresh scratch-condition isolation, hostile Git
filenames, staged and untracked workspace identity, each CLI projection, the shared turn budget,
idle settlement and controller handover. A passing matrix is mechanism evidence for the helpers;
it says nothing about the model behaviour a later condition measures.

## Result

Return one evidence path and one result:

- `blocking`: the command would use the wrong branch or condition;
- `cleared`: the check proves the intended path;
- `accepted-risk`: only a paid run can decide it.

Return this result to the invoking agent. `cleared` preserves any existing authority but does not
exercise it, schedule a command or choose the next experiment. The improvement loop or standalone host owns
that decision and launch boundary.

A deterministic check never predicts provider behaviour, output quality or later runtime branches;
when the question is one of those, either accept the risk or run the rehearsal in
`cases/fullrun-conditions.md`. A rehearsal's result is the prediction note with its resolution section,
not one of the three words.
For live conditions also report operational closure, semantic verdicts and prediction resolution
separately. Preserve verified, unaccepted and non-result denominators; list unexecuted probes.
A host-blocked condition can leave a prediction unresolved. Admission, a compiler exit and a
passing generated control set each prove their own condition, not complete domain correctness.
