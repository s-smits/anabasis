---
name: wave-audit
description: "Compare one or several recorded source states to see whether changes improved Anabasis's climb. Build a state-by-condition census first; compare adjacent states only when prompt, model, command, project lineage, budget and runtime identities support it; read equal windows, earned failures and the mechanisms that fired. Use for 'did the fixes work', 'is this wave better', or before relaunching on a new source."
---

# Wave audit: did the source improve the runs

The goal is a healthier, more ambitious climb: successive batteries move towards the solver's limit
on failures the verifier can earn. Read AGENTS.md "Goals and the climb" for the target and the line's
numbers, and [the climb reference](../whole-run-investigation/references/climb.md#the-line) for the
rows that print them. Per run, lead with the share of the solve wall and the follow-up of each earned
fail; signal is rare and confirms a step. This audit reads recorded runs; it launches and stops
nothing. What it concludes goes to [run-improvement-campaign](../run-improvement-campaign/SKILL.md)
("The scoreboard") as the next move.

## When this skill applies, and when a neighbour does

| The question | Owner |
|---|---|
| Did source changes improve the runs? | this skill |
| What happened inside one run, and what limited it? | [whole-run-investigation](../whole-run-investigation/SKILL.md) |
| Which model is better, on one source and one prompt? | [model-condition-comparison](../model-condition-comparison/SKILL.md) |
| May this movement be claimed, and in which words? | [attribution-and-proof](../attribution-and-proof/SKILL.md), applied to every row |
| How does the adopted harness do on a fixed pack? | [harness-query](../harness-query/SKILL.md), paid; see §9 |
| Which runs of the week were strongest? | [weekly-run-review](../weekly-run-review/SKILL.md) |
| What should launch next? | [run-improvement-campaign](../run-improvement-campaign/SKILL.md) |

## The trap this skill exists for

Each run's Builder authors its own battery, so "6 of 6" in one source state and "4 of 6" in another
are different exams. The lower score may mean a harder battery, a broken evaluator, or a weaker
product. A pass count alone cannot tell those apart.

Raw pass rates compare only on a shared pack. `compare-conditions.mts` refuses a join whose task-set
hashes differ, and `harness-query` solves one fixed pack on each harness of one campaign (§9).
Without a shared pack, report what the loop did with its batteries, not what they scored. A perfect
battery is the base rate here, as AGENTS.md "Goals and the climb" says, and it is not news. A
battery with both passes and verified fails is a useful signal only after the fails survive review.

## Study, state, condition and pair

A **wave** is a launch batch. A **study** may compare several source states, each with multiple
source commits, conditions and repeated runs. Build the state-by-condition matrix before pairing.
Keep a pair whose prompt/domain or model moved labelled *mixed-condition*; report what happened
descriptively, but leave it out of any source verdict.

A **condition cell** groups runs by exact `project.requestDigest` and the three model slots (`kind`,
`model`, `reasoningEffort`, `enabled`); retain slot `source` as a separate identity check. The
digest names the request, so it is the domain and prompt check. Show the number of runs and distinct
source commits in every state-cell, including cells with no counterpart. Do not compare authored
task packs as if they were shared tasks.

A **candidate pair** is a cross-state comparison within the same request and model-slot cell. Check
the whole cross-product when either side has replicates. Do not choose one baseline for several
candidates or force a unique pair when the samples are many-to-many. If a narrative comparison
changes request or model, keep it on a separate mixed-condition line.

The source commit is the variable under study. Before calling a candidate pair source-only, compare
these fields in both `controller/<runId>/opening.json` records:

| field | source-only comparison requires | record |
|---|---|---|
| `project.requestDigest` | equal | `opening.json` |
| `modelSlots.{builder,built,review}` | equal kind, model, effort, enabled and slot source | `opening.json` |
| `command.digest` | equal for openings written after the digest change in #118 | `opening.json` |
| legacy launch command | normalized arguments equal; remove `--run`, `--expected-source` and `--project` with their values | each run's `.scratch/quick-run/launch.json` |
| project lineage | both created, or both continued from the same seed/product state | opening plus `seed.json` when present |
| budgets | equal configured turn budget and provider resource cap | `opening.json` |
| runtime | equal Bun name, version, platform, architecture and executable identity | `opening.json` |
| operator backend | same backend identity; equal file paths alone do not prove equal contents | `modelSlots.operatorConfig` and the referenced non-secret identity |
| source | commit differs; neither opening is dirty | `opening.json` |

The #118 change leaves run id, source and project out of `command.digest`, so the same condition
should have the same digest. Before #118, the digest included those fields, and a difference did not
show a changed command. For those openings, parse each saved `launch.json` argv and compare after
removing the three flags and their values. Treat `--run=x`, `--expected-source=x` and `--project=x`
the same way. Do not print raw argv or backend configuration. If the launch record or backend
identity is missing, mark the pair's identity unresolved and exclude it from source attribution.

Matching prompt and slots finds candidate pairs, not source-only pairs. A field that differs makes
the pair mixed; an unknown field stays unknown. Report that movement and the mismatch beside the
candidate, then state how many eligible pairs remain. Zero eligible pairs means the source effect is
undetermined, not unchanged.

## 1. Census before comparison

Use the maintained read-only reader from the main checkout:

```sh
bun .claude/skills/wave-audit/scripts/census.ts [--states <abs census-states.json>]
```

It finds and reads runs as `runs pulse` does, plus each seeded campaign's `seed.json`. With a
census-state file a run's state is that file's `rows[].state`; without one, its source commit. It
prints one row per state and condition, then every adjacent-state pair of one condition with each
identity that differs (same source, dirty, origin, seed, cap, command). It calls no network and
prints no prompt, argv, credential or backend content. For openings before #118, a command digest
differs in every pair; resolve the command with the saved launch argv rule above.

Use the source-at-launch to define states, not campaign suffixes or launch time alone. A state can
contain several source commits, and a PR boundary can have no matching condition. The script's
output is the join map, not the audit: report missing openings, unmatched cells, mixed pairs and
eligible pairs before reading any outcome.

State labels that name PRs come from a mapping file; do not rebuild one from the network to
reproduce its labels. Use an existing mapping or group by source SHA, then name the range being
compared. Never infer source from adjacent campaign numbers. `runs show` and the campaign root still
provide the recorded outcomes for each run.

## 2. Read what the source range could change

For each eligible pair, list the commits between its baseline and candidate source SHAs and classify
where each can act. A study with multiple source commits in one state needs a separate range per
pair or named source boundary.

| reach | recorded evidence |
|---|---|
| model-visible Builder text, task contract or tool descriptions | `framingDigest`, recorded prompt, rehearsal use, Builder plan and notes |
| Builder tool or gate | gate receipts, `correctness_check` rows, finding codes and episode endings |
| controller routing or readout | observations, difficulty decisions and advice packets |
| verifier or host execution | case records, verifier results and typed non-results |
| review slot | review records, findings and admissions |
| documentation or skills only | no run effect; list separately |

Reach counts are an inventory, not proof that a path affected a run. A model-visible path change
does not prove the selected run received changed text; read its `framingDigest` and recorded prompt.
A changed `framingDigest` is necessary context for a text-behaviour claim, not proof that one
sentence caused the Builder's choice.

For the deterministic reach read, pin both the prior SHA and the run so the campaign cannot select
another condition:

```sh
bun .claude/skills/whole-run-investigation/scripts/wri.ts delta <candidate campaign> \
  --repo <main checkout> --previous <baseline SHA> --run <candidate runId> --json
```

## 3. Find the prediction and date it

Test what was predicted before each candidate opened, not what looks good afterwards. Read
`notes/predictions/<runId>.jsonl` or the wave ledger with `bun
.claude/skills/run-improvement-campaign/scripts/prediction.ts list --run <runId>` or `--ledger
<path>`. Compare each prediction's `at` with every paired opening's `writtenAt`; one ledger can
predate one run and postdate another.

A plan or scratch note counts only if it predates the opening, and say that file time does not
freeze it. A post-opening note may guide the reading but cannot confirm it. No prediction leaves the
audit descriptive; freeze a falsifiable direction and refuting observation for the next study.

## 4. Checkpoints and equal windows

Read the first battery, the third round, and the terminal when both sides reach them. Before a
candidate has a battery, its verdict is `undetermined`; after the first battery but before two
edges, report calibration only. For a large corpus, also show the first eight batteries per run and
the first three edges per run, with denominators and schema coverage. Do not let long runs dominate
by contributing every later round to an early comparison.

Equal windows are rule, not courtesy. Compare round r with round r, ordered by claim `createdAt`,
and cap the terminal comparison at the shorter measured window. A run cut by the environment or
operator keeps every level it measured before the cut; the terminal reason is a caveat, not a
product verdict. Report which runs reached each checkpoint. Missing or live terminal records are
censored, not zero.

## 5. Read the same measures on both sides

Run a measure reader only after checking what schemas it accepted. A reader that refuses old records
has not measured zero. Report its coverage and the schema versions refused, then use compatible
saved records (`terminal.json`, difficulty decisions, `runs show`, claims, case records or execution
records) where they exist. If no compatible record remains, mark the measure unavailable.

### 5a. Battery placement and the climb line

For each battery, report placement beside `passed`, `verified`, `unaccepted` and `nonResults`. A
**partial** battery has `0 < passed < verified`. Read the placement from `terminal.json` →
`runEnd.climb.batteries[]`, a supported difficulty-decision record, or the `runs show` Batteries
table. Do not infer it from `claims[].claim.ok`: a claim can be refused while the difficulty record
still places the battery. When the decision reader refuses an older schema, report the refused
version and use a saved placement only if its fields still have that meaning.

Run `wri.ts climb` for supported records and read velocity, horizon, flat, carried and edge labels
as [the climb reference](../whole-run-investigation/references/climb.md) defines them. A placement
zone sits beside that line, never instead of it. An `on-aim` or `over-aim` result counts as located
only where at least one verified fail remains valid after review. Read V/U/N beside each placement:
a softer zone bought by fewer verified cases is not progress, and a full battery found no limit.

The climb reader needs adopted versions and may refuse older `difficulty-decision` schemas. Its raw
JSON can be very large. Bound the output to the equal window; if an older record is refused, use
recorded task and battery rows only where available, and mark the missing placement or edge as
unavailable rather than dropping the run. A `too-hard` zone is not automatically progress: a broken
evaluator or dead solver can land there too, so check the denominator and correction record.

### 5b. What each edge asked

The `climb` reader assigns structural labels (`restated`, `replaced`, `adjusted`, `narrowed`,
`widened`, `eased`, `escalated`). A label is a reading, not a forecast, and more `escalated` edges
are not automatically better. Name the changed public requirement from consecutive
`public-task.json` rows beside the label; classify identical tasks, field changes, ID-only changes
and missing artifacts separately. After a full pass, report unchanged carried tasks and the share of
restated or adjusted edges within the same window, with counts because a short run has fewer edges.

### 5c. Calibration and rehearsal

For older runs, `runEnd.climb.batteries[].plan` carries the plan score; if a later source removed
it, call it absent, not missed. To read rehearsal use, join each `harness_trial` in
`epoch-*/builder-execution.json` to the accepted submit's `candidateId`. Count trials, passes,
passing trials acted on before submit, accepted candidates rehearsed on the same ID, and accepted
submissions never rehearsed.

The reader is `wri.ts handoff <campaign>`. It may refuse older execution or difficulty-decision
versions. If so, parse the recorded v5-v7 execution calls directly or report schema-unavailable
coverage; never turn a reader refusal into zero trials. A pass on changed bytes is acted on; a pass
on submitted bytes is not. More passing rehearsals acted on and more accepted submissions rehearsed
on the same candidate ID support calibration.

### 5d. Gate rent

`wri.ts gates <campaign> [--json]` and `wri.ts census [--json]` report refusal episodes and endings:
`repaired`, `repaired-tool-condition`, `cleared-without-edit`, `bundle-unchanged-condition-unknown`,
`answered-identity-unrecorded` and `unanswered`. Map campaign rows back to run IDs before
aggregating. Report each ending's denominator, held rounds and submits, submit strikes and stalled
ends, plus episodes per Builder round. State reader coverage; older `builder-execution` versions may
be unavailable rather than zero.

Better is fewer held rounds, cleared-without-edit and unanswered episodes, submit strikes and
stalled ends. First-clear and first-adoption times are context. Name the sample count and how
adoption was identified; a first-clear time is not an adoption time.

### 5e. Evaluation corrections and review

Count correction rounds and whether each flipped a verdict. A correction on byte-identical public
tasks that moves nothing is a loop, not a repair. Replay uses this syntax:

```sh
bun run replay -- <campaign>/<runId before> --under <campaign>/<runId after>
```

Do not use `replay --help`; it parses the flag as a candidate path. If the stored battery or bundle
snapshot is missing, report replay unavailable and stop retrying equivalent pairs. Better is fewer
corrections, with each one moving a verdict. A correction that leaves an issue `unmeasured` has not
shown a fix.

`wri.ts yield <campaign>` reports Epoch Reviewer findings and their routes;
`analysis/<runId>-rebuild-advice.json` reports issue states. Count snapshot occurrences separately
from unique issues and give the join key. Better is findings that name a real owner and change a
later round, more `absentBatteries` in complete rechecks, and fewer `returned`. Report the
`rulesChangedRechecks` inside `absentBatteries` apart: a recheck under changed public rules answers
whether the repair held under the new rules, not whether the issue persists under the old, so it is
a weaker count of fixes than one under the same rules. `returned` and `firstSeenRunId` hold only
across the same task inputs, so a drop in `returned` after the tasks changed counts no fewer
recurrences. `retired` and `unmeasured` prove no fix. If Judge coverage is included, state the
subject identity and deduplication rule, and reconcile offered, verdict and abstention counts before
comparing rates. A schema refusal is unavailable evidence, not zero findings.

### 5f. Case outcomes and terminal

Classify each case in this order: a typed environment or runtime non-result, including `truthOk:
null`; an unaccepted attempt with no environment failure; then a submitted artifact that reached the
host verifier, which is verified pass or fail. Keep verified, unaccepted and non-result denominators
separate, with provider, runtime, sandbox, protocol, verifier and operator causes split where the
record permits. Do not classify `acceptedSubmit: false` before checking for a non-result.

Read terminal `outcome` and `terminalReason` only when their schema is supported. A battery made
only of non-results or unaccepted attempts locates no verified boundary. Missing `case-record.jsonl`
rows, verifier files or terminal denominators are coverage gaps, not evidence of no failures.

### 5g. Pace, host and provider

Use `wri.ts timeline <campaign> --run <runId> --json` and `wri.ts walls <campaign> --battery <runId>
--json`, then report reader coverage. Compare minutes to first adoption and first claim, claim
intervals, provider turns per battery, rounds per hour, retries, provider waits, 429s,
credit/session limits and wall-bound attempts. A wall-bound unaccepted case is a miss by the solver
at that wall, not a verified task failure.

Faster is better only when §5a to §5f did not get worse. Host load and concurrency decide pace as
much as source does. State the measured load and whether timestamps show only interval overlap;
opening/terminal intervals cannot prove process-level concurrency, current load or account identity.
Keep unknown host facts unknown.

### 5h. Context only: solver effort and margin

`case-result.json` `solver.toolCalls`, elapsed time against `solve_minutes`, and accepted-artifact
margin against the task limit describe the exam, not the product. Report them beside a placement
when useful, never as a verdict row. A longer solve on a harder exam is not a regression.

## 6. Tie movement to a mechanism that fired

For every commit classified in §2, record its trigger, whether the trigger occurred, the recorded
output and the measure it should move. Evidence can be a gate finding, advice line, saved evidence
field, delivered battery-contract sentence or safeguard firing (`bun run outcome --safeguards
<campaign>` or `campaigns/<project>/safeguards/<runId>/SAFEGUARDS_LOG.txt`).

If one mechanism fired and the predicted measure moved, attribution can be `proven`; if several
fired, `likely`. A fired mechanism with no movement did not suffice. A trigger that never occurred
is `untriggered`, not failed. Movement without a fired mechanism remains noise or a confound until
shown otherwise. A changed path or digest is not itself a fired mechanism.

## 7. Confounds to test before a verdict

- **Builder resampling:** one Builder can author a different first plan. A single matched pair says
  what happened, not what repeats.
- **Model, prompt or domain movement:** keep changed request digests or model slots mixed-condition.
  Raw pack scores do not cross that boundary.
- **Project lineage:** compare continued projects only with the same seed/product state. Read
  `seed.json` fingerprints as well as `opening.json.continuation`; an opening may say `null` while a
  seed carries the inherited product.
- **Host and provider:** load, concurrency, 429s, credit exhaustion and session limits can change
  pace or censor a run.
- **Different stop points:** operator stop, timeout or budget cap; cut both sides to an equal
  window.
- **Protected-detail parity:** check the recorded prompt and `framingDigest` against model-visible
  changes. Do not expose verifier output or hidden task details.
- **Missing or refused records:** schema coverage differs by reader and state. Name absent
  terminals, case rows, tool trees, evaluator files and review records.

## 8. Verdict per pair, transition, state and prediction

At each checkpoint, give each candidate pair one verdict:

- `improved`: at least one climb measure moved the better way, no measure moved the worse way, and
  confounds are ruled out or named.
- `regressed`: the mirror of `improved`.
- `unchanged`: complete comparable rows sit within what Builder resampling plausibly moves.
- `undetermined`: rows disagree, evidence is censored, or an unresolved confound could explain the
  movement.
- `mixed-condition`: prompt/domain, model or another tested condition moved with source; describe
  the outcome, but do not count it as a source verdict.

Name the one or two rows that decided the verdict and give attribution `proven`, `likely`, `mixed`
or `unproven` from §6. Per transition, count eligible condition cells by direction and list mixed
and unpaired cells separately. Per state, report eligible comparisons and whether their samples are
independent. Zero eligible pairs is `undetermined`, never `unchanged`. Do not average pass rates
across conditions. Repeated cross-products can share a run, so do not use a sign test unless the
pairs were independently selected.

Adjudicate each frozen prediction when its checkpoint is reached:

```sh
bun .claude/skills/run-improvement-campaign/scripts/prediction.ts adjudicate --ledger <path> \
  --id <id> --outcome sufficed|partial|refuted|untriggered --evidence "<file or reading>"
```

Use `--run <runId>` instead of `--ledger` for a per-run row. `untriggered` means the run never
tested the variable, such as a prediction about an edge after a run that ended at one battery.

## 9. When the question needs a capability number

Placement and calibration show whether the loop improved. They cannot show whether the product
solves more. For that, use a shared pack:

- Solve one fixed task set on both adopted bundles through
  [harness-query](../harness-query/SKILL.md). This is paid: one measured case per task per side.
  The two bundles must be rounds of one campaign or of a seeded continuation of it, because a pack
  task is graded by the correctness bundle of the product that authored it. Across fresh campaigns
  read the solve-wall share instead (AGENTS.md "Open gaps", the third blocker).
- Re-grade artifacts under another evaluator with `bun run replay --
  <campaign>/<runId> --under <bundle>`, if recorded artifacts and bundles exist.
- Join recorded batteries only when they share a task-set hash; `compare-conditions.mts` refuses
  otherwise.

Name the pack, model pins and walls, and report verified, unaccepted and non-result cases
separately. Do not launch a new paid measurement as part of this audit; ask before spending.

## 10. Write the audit down

Write it at `notes/wave-audits/<candidate sha9>.md`, or beside the review it came from. Put the
state-by-condition table and unmatched cells first, then one block per adjacent transition and
checkpoint. This replaces the single-wave template; include only measures that were read, with
schema coverage and denominators.

```text
Checkpoint:          first battery | third round | terminal; read at <UTC time>
States:              <baseline state and source SHAs> → <candidate state and source SHAs>
Condition cell:      <request digest, domain, model slots; baseline n> → <candidate n>
Pair identity:       request/slots <match>; command <digest | normalized legacy argv | unknown>;
                     lineage <same seed | fresh | mixed | unknown>; budget/runtime/backend <...>
Source range:        <baseline SHA>..<candidate SHA>; <n> commits; reach <...>; framing <...>
Prediction:          <id> — frozen <ledger/file time/post hoc>; outcome <...>
Window:              <round r or elapsed window>; reached by <n>/<N> runs each side
Movement:            climb <velocity, horizon, flat, carried>; placement <zone, passed/verified>;
                     edges <label and changed public requirement>; rehearsal <...>; gate <...>
                     corrections/review <...>; cases <verified/unaccepted/non-result>; pace <...>
Verdict:             <pair verdict>; attribution <level>; deciding rows <...>
Transition:          <k improved, ...>; eligible pairs <n>; mixed <n>; unpaired <n>
State verdict:       <verdict>; rests on <n> eligible comparisons
Caveats:             <host, provider, stop, schema, lineage or evaluator gaps>
Next move:           one experiment and owner — hand to run-improvement-campaign
Settles at:          <next checkpoint and what it could change>
```

An audit without a next move or an adjudicated prediction was only a report. Say which checkpoint
will settle it.
