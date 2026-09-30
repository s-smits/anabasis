---
name: wave-audit
description: "Audit whether a new wave of Anabasis runs improved on the wave it replaced. Pairs each run with its baseline of the same condition, proves the source commit is the one variable that moved, dates the prediction, reads the same measures on both sides over equal windows (band placements, climb edges, rehearsal use, gate rent, evaluation corrections, denominators, pace), ties every movement to a fix whose branch fired, and gives a verdict per pair, per wave and per prediction at three checkpoints. Use when asked 'is there an improvement at the runs', 'did the fixes work', 'is this wave better than the last', 'compare the new runs with the old ones', or before relaunching on a new source."
---

# Wave audit: did the new source improve the runs

A **wave** is the set of runs launched together on one source commit, one run per condition. A wave
audit compares a candidate wave with the baseline wave it replaced and answers one question: did
moving the source make the loop do better at what it is for? The loop is for a healthy, ambitious
climb (AGENTS.md "Goals and the climb"), so "better" means a line that locates the solver's limit
sooner on fails that were earned, and fewer rounds wasted on the way there. It does not mean scoring
higher.

The audit reads recorded bytes. It launches nothing, stops nothing and changes no score. What it
concludes goes back to [run-improvement-campaign](../run-improvement-campaign/SKILL.md) as the
next move.

## When this skill applies, and when a neighbour does

| The question | Owner |
| --- | --- |
| Is the new wave better than the old one? Did the fixes work? | this skill |
| What happened inside one run, and what limited it? | [whole-run-investigation](../whole-run-investigation/SKILL.md) |
| Which model is better, on one source and one prompt? | [model-condition-comparison](../model-condition-comparison/SKILL.md) (the mirror of this skill: it moves the model and holds the source) |
| May this one movement be claimed, and in which words? | [attribution-and-proof](../attribution-and-proof/SKILL.md), which this skill applies to every row |
| How does the adopted harness do on a fixed pack? | [harness-query](../harness-query/SKILL.md) (paid; see §9) |
| Which runs of the week were strongest? | [weekly-run-review](../weekly-run-review/SKILL.md) |
| What to launch next? | [run-improvement-campaign](../run-improvement-campaign/SKILL.md), taking this audit's verdict as input |

## The trap this skill exists for

The obvious reading of a new wave is wrong. Each run's Builder authors its own battery, so "6 of 6"
in the baseline and "4 of 6" in the candidate are two different exams. The lower score may mean a
harder battery, a broken evaluator or a weaker product, and the pass count alone cannot tell those
apart.

The corpus shows how badly a raw rate misleads:

- Truss `0aad0d` passed 75 of 75 on its own batteries, while the same agent passed 2 of 23 verified
  hard tasks under a Sol solver on a shared pack.
- On 2026-09-27 the recorded terminals of both projects (`design-lightweight-steel-trusses-3fd52f9e-*`
  and `writes-firmware-esp32-raspberry-9c0c68b1-*`) held 98 placed batteries: 79 `too-easy`, 16
  `over-aim`, 3 `on-aim`, and none below the aim.

So a perfect battery is the base rate here, as AGENTS.md "Goals and the climb" counts for the whole
corpus, and it is not news. A first battery that passes some of its cases and fails some, on fails
its review holds, would be news.

Raw pass rates compare only on a shared pack. `compare-conditions.mts` refuses a join whose
task-set hashes differ, and `harness-query` solves one fixed pack on each harness. Without a shared
pack, the audit reads what the loop did with its batteries, not what they scored.

## Vocabulary

- **Condition:** the three model slots (kind, model, effort) plus the prompt, the task count and the
  budget: everything in `opening.json` except the source. Examples: `truss-sol`, `custom-opus`.
- **Pair:** one baseline run and one candidate run of the same condition. The pair is the unit of
  evidence, and the wave is only a count of pairs.
- **Moved variable:** the source commit, `baseline sha..candidate sha`. Anything else that differs
  makes the pair a *mixed condition*.
- **Checkpoint:** the point at which a reading is taken on both sides. There are three: the first
  placed battery, the third round, and the terminal (§6).
- **Window:** the stretch compared on both sides. Round r against round r, or the shorter side's
  elapsed time applied to both.

## 1. Identify both waves

1. **Find the runs.** `bun run runs` lists every run on the machine, open ones first. For a stopped
   wave, each launch worktree keeps `<worktree>/.scratch/quick-run/launch.json`, which records the
   service, opening and source. The run id carries the wave: every run launched in one batch shares
   its timestamp and six-hex suffix, for example `*-20260927T145744429Z-7e43c0`.
2. **Find the campaign of each run.** It is the directory under `campaigns/` whose `controller/`
   holds that run id. The same condition gets a new numbered campaign on every fresh launch, so
   `…-3fd52f9e-19` (baseline truss-sol) and `…-3fd52f9e-22` (candidate truss-sol) are a pair while
   `-20` and `-21` belong to other conditions. Never pair by neighbouring suffix; pair by the
   condition prefix of the run id and by `modelSlots`.
3. **Read both `controller/<runId>/opening.json`** and fill in this table per pair:

| field | must match within a pair | where |
| --- | --- | --- |
| `project.requestDigest` | yes (same prompt) | `opening.json` |
| `modelSlots.{builder,built,review}` kind, model, `reasoningEffort`, `enabled` | yes | `opening.json` |
| `command.digest` (the fullrun arguments) | yes, unless a flag was the tested variable | `opening.json` |
| `project.origin` and `continuation` | both `created` and `null`, or both continued from the same state | `opening.json` |
| `budget`, `providerResourceBudget` | yes, or the difference is named | `opening.json` |
| `runtime` (Bun) | yes | `opening.json` |
| `source.commit`, `source.dirty` | **this is the variable**; `dirty: true` on either side is a caveat | `opening.json` |
| `framingDigest` | expected to differ when the range changed a model-visible text | `epoch-*/builder-session.json` |
| operator backend file (`modelSlots.operatorConfig`) | yes | `.harness/backends/` |

A pair that differs anywhere except the source and its consequences is a mixed condition. Report
it on its own line and leave it out of the wave verdict. Replicas (`r1`, `r2` in the run id) are
separate samples of one condition: pair them r1 with r1, or state that they were pooled.

4. **Record host conditions on both sides.** How many runs shared the host, and the load and free
   disk (the pulse header prints both). Note provider waits, credit exhaustion and 429s (the
   `timeline` lane), and whether the two waves overlapped in time on one account. The two sides
   often did not share these. Six concurrent runs at a load of 32 is a different pace condition
   from two runs on an idle host.

## 2. List what the source moved

`git log --oneline <baseline sha>..<candidate sha>` in the main checkout, plus the pull requests
that range spans. Each commit is a candidate cause, and nothing outside the range is. Classify each
commit by where it can act, because that decides what can show its effect:

| reach | shows up in | example evidence |
| --- | --- | --- |
| model-visible Builder text (prompt, battery contract, starter, tool descriptions) | `framingDigest` changes; Builder behaviour | rehearsal use, the Builder's notes and prose |
| Builder tool or gate behaviour | gate receipts, `correctness_check` rows | finding codes, episode endings in `gates` |
| controller routing and readouts | observations, difficulty decisions, advice packets | `difficulty-decisions/*.json`, `analysis/*-rebuild-advice.json` |
| verifier and host execution | case records, `verifier.json` | case kinds, non-result types |
| review slot | reviewer records, findings | the `yield` lane, admissions |
| documentation and skills only | nothing in the run | not a cause; list it and exclude it |

Then run the deterministic reach check for the range:

```sh
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts delta <candidate campaign> \
  --repo <main checkout> --previous <baseline campaign dir or sha>
```

Always pass `--previous`. Without it, `delta` picks the newest earlier sibling campaign with the
same name minus its numeric suffix. Every condition of a wave shares that prefix, so it can pick
another condition's campaign and diff the wrong pair. The output lists changed files, the safeguard
ids declared in them with their recorded firings, and whether a model-visible surface changed.
Lane 21 of WRI reads the semantic half.

## 3. Find the prediction, and date it honestly

The audit tests what was predicted before the candidate opened, not what looks good afterwards.

- **Frozen in the ledger:** `notes/predictions/<runId>.jsonl`, or a wave ledger named with
  `--ledger`. Read it with
  `bun .claude/skills/run-improvement-campaign/scripts/prediction.ts list --run <runId>`, or
  `--ledger <path>`. A per-run ledger cannot exist before its run id does, so a prediction for a
  wave is frozen into `--ledger notes/predictions/wave-<candidate sha9>.jsonl` before the launch.
  Compare each row's `at` with every `opening.json` `writtenAt`: a row later than an opening is post
  hoc for that run.
- **Written only in a plan or scratch file:** counts only if the file predates the opening. Say that
  it is dated by file time, which anyone could have touched, and not frozen.
- **Written after the opening:** post hoc. It may guide the reading, but it cannot confirm anything.
- **No prediction:** the audit still runs, but its verdict is descriptive. Say so, and freeze one
  for the next wave.

A usable prediction names the moved variable, a direction on one measure from §5, and the reading
that would refute it. "Fewer 6/6 batteries" is falsifiable. "Better runs" is not.

## 4. Pick the checkpoint and cut equal windows

Read at three checkpoints, append each reading to the audit, and keep the earlier rows rather than
overwriting them:

| checkpoint | reached when | what it can show |
| --- | --- | --- |
| first battery | both runs of the pair have a claimed battery (`runs show` Batteries, or `claims/`) | the Builder's opening calibration: rehearsal use, first placement |
| third round | both have three placed batteries or three rounds recorded | the climb: edge verdicts, streaks, correction loops |
| terminal | both have `terminal.json` | the whole run: the terminal code, `runEnd`, denominators, pace |

Before the first battery, the only honest verdict is `undetermined`. Between the first battery and
the second edge, a pair can show calibration but no climb.

Equal windows are rule, not courtesy:

- Compare round r with round r, ordered by claim `createdAt`, never by directory order or mtime.
- When one side is shorter, cut the other to the shorter side's elapsed window and name that
  window, for example "first 3h 10m on both sides".
- A run the environment or the operator cut short keeps every level it measured before the cut.
  Its terminal code (`signal-terminated`, `environment-blocked`) is a caveat, not a verdict on the
  product. Do not compare a stopped run's round count with a completed run's.

## 5. Read the same measures on both sides

Run each reader on both campaigns and set the rows side by side. **Direction** says which way is
better for the standing goal, a healthy, ambitious climb (AGENTS.md "Goals and the climb"). It does
not say which way is bigger.

### 5a. Where the batteries landed

Band placement, per battery in claim order: one of the five `BandZone` values
(`src/claim/battery-difficulty.ts`), or `unplaced` when no verified case or `placeOnBand` refused
it. AGENTS.md "Goals and the climb", under "The band and the placement", owns what each zone means
and the band, `climb.band`, it is read against.

- **Readers.** For a finished run, `terminal.json` → `runEnd.climb.batteries[]`: zone, passed,
  verified, trials. For a live run, `bun run outcome <campaign> <runId> --scorecard`
  (its runEnd section reads the newest difficulty decision). `bun run runs show <runId>` gives the
  Batteries table (BATTERY, CLAIMED, PASSED, CLIMB, RATIONALE), and `difficulty-decisions/*.json`
  gives the full record.
- **Better is** more batteries between 1/n and n−1/n in the first 8 and 12, a larger swing, fewer
  tasks carried unchanged after a full pass, and a line that is not flat (`wri.ts climb`: `velocity`,
  `horizon`, `flat`, `carried`). A zone is read beside these, never instead of them (AGENTS.md
  "Goals and the climb", under "Its shape, and how progress is read"), so an `over-aim` or `on-aim`
  placement counts only when it passed some cases and failed some.
- **Traps.**
  - Placement is taken over *verified* cases, so a battery that lost cases to non-results is placed
    on a smaller n with a wider interval. On current source 6 of 6 and 4 of 4 place `too-easy` while
    3 of 3 places `over-aim`; the truss-astra baseline below recorded `over-aim` at 4 of 4 under its
    own source. A softer zone bought by fewer verified cases is not progress, so read `verified`
    beside every zone.
  - `too-hard` is not automatically progress. Check the denominators (§5f) and the evaluation
    corrections (§5e): a broken evaluator or a dead solver also lands there.
  - A battery whose claim was refused is `unplaced`.

### 5b. What each edge asked of the solver

The climb edge verdicts come from the `climb` reader (it needs an adopted version under
`versions/`):

```sh
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts climb <campaign> [--json]
```

Each edge between consecutive batteries gets one of seven structural labels (`restated`,
`replaced`, `adjusted`, `narrowed`, `widened`, `eased`, `escalated`), defined at the head of
`climb-velocity.ts` and read as [the climb reference](../whole-run-investigation/references/climb.md)
says. A label is a reading, not a forecast (AGENTS.md "Goals and the climb", under "Reading the
climb as the operator"), so a higher share of `escalated` is not better by itself.

- **Better is** more edges whose changed public requirement you can name from the task rows, and
  fewer `restated` or `adjusted` edges after a full pass.
- **Trap:** a candidate with fewer batteries has fewer edges. Compare shares within the equal
  window, and name the counts.

### 5c. Calibration: did the Builder know how hard its exam was?

- **The plan's score.** Gone with `EXPERIMENT.json`. A run whose source predates its removal records
  one score line per battery (`runEnd.climb.batteries[].plan`), and a pair spanning the removal
  reads it as absent on the newer side, not as missed.
- **Rehearsals.** Read the `harness_trial` calls in `epoch-*/builder-execution.json`: each carries
  its task, its verdict and the `candidateId` it solved. The question is whether a rehearsal pass
  was acted on before submit, so join those rows to the accepted submit's `candidateId`: a pass on
  bytes that were then changed was acted on, and one on the bytes submitted unchanged was not.
  Better is passes acted on, and submitted bytes that were rehearsed at all.
- **Readers.** WRI's `handoff` lane has a calibration table, and lanes 10 and 11 read the semantic
  side:

```sh
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts handoff <campaign>
```

### 5d. What the gate cost

The `gates` reader (`gate-rent.ts`) lists each refusal episode and how it ended:

- `repaired`
- `repaired-tool-condition`
- `cleared-without-edit`
- `bundle-unchanged-condition-unknown`
- `answered-identity-unrecorded`
- `unanswered`

```sh
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts gates <campaign> [--json]
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts census [--json]   # every campaign at once
```

- **Better is** fewer rounds held by the gate, fewer `cleared-without-edit` episodes (a refusal that
  cleared with no change refused nothing real), fewer `unanswered` episodes, and fewer submit strikes
  and `authoring-stalled` ends.
- **Pace facts:** time from the opening to the first clear preview, and to the first adoption. These
  are context, read with §5g.

### 5e. Evaluation corrections

Count the evaluation-correction rounds, and for each one, whether it flipped any verdict. A
correction over byte-identical public tasks that moved nothing is a loop, not a repair.

```sh
bun run replay -- <campaign>/<runId before> --under <campaign>/<runId after>
```

This re-grades the earlier battery's accepted artifacts under the later bundle's evaluator, so it
shows exactly which verdicts the correction moved. Better is fewer corrections, each one moving a
verdict. An issue left `unmeasured` by a correction is not a fix (AGENTS rule 10).

### 5f. Denominators and the terminal

Per battery, count verified, unaccepted and non-result cases separately (the CASES column of `bun
run runs`; `bun run outcome <campaign> <runId>`). Then take the terminal code from `terminal.json` → `outcome` and
`terminalReason`, which is one of the closed set of eight.

- **Better is** no rise in unaccepted cases or non-results, and a terminal of `completed` or an
  operator stop, rather than `build-failed`, `candidate-held` or `environment-blocked`.
- **Environment non-results** (provider, credential, sandbox) belong to the environment, not to
  either source. If one side had them and the other did not, that is a caveat, never a product
  difference.
- A battery made only of non-results or unaccepted cases is placed nowhere. It is neither a pass
  nor a fail.

### 5g. Pace

Read these from `runs show` and the claim `createdAt` times:

- minutes to first adoption
- minutes per round
- provider turns per battery
- rounds per hour of wall clock

Faster is better only when §5a to §5f did not get worse. Host load and concurrency (§1) decide pace
as much as source does, so a pace difference under different host conditions is a caveat, not a
finding.

### 5h. Review loop

The `yield` lane gives Epoch Reviewer findings per review, blocking and advisory, and what each one
routed to. The rebuild advice packets (`analysis/<runId>-rebuild-advice.json`) give issue states.

- **Better is** findings that name a real owner and change a later round; more issues not observed
  in complete rechecks (`absentBatteries`); fewer `returned`.
- **Trap:** `retired` and `unmeasured` prove no fix.

### 5i. Context only: solver effort and margin

`case-result.json` `solver.toolCalls` and the minutes against `solve_minutes`, and the margin of
each accepted `artifact.json` against its `public-task.json` limit. These describe the exam, not
the product. A longer solve on a harder exam is not a regression. Report them beside a placement
and never as a verdict row.

## 6. Tie each movement to a mechanism that fired

A row that moved counts towards a fix only if that fix's branch actually executed in the candidate
run. For every commit classified in §2, fill in:

| commit | trigger condition | did it occur? | recorded output | measure it should move |
| --- | --- | --- | --- | --- |

The recorded output is a finding code in a gate receipt, an advice line, an evidence field, a
battery-contract sentence in the recorded prompt, or a safeguard firing (`bun run outcome --safeguards
<campaign>`, or `campaigns/<project>/safeguards/<runId>/SAFEGUARDS_LOG.txt`). This is
[attribution-and-proof](../attribution-and-proof/SKILL.md)'s "was the intended mechanism live",
applied commit by commit. Read each result like this:

- **Fired and the measure moved the predicted way:** `proven` if one mechanism fired alone, `likely`
  if several fired together.
- **Fired and nothing moved:** the fix did not suffice. That is a finding.
- **Trigger never occurred:** `untriggered`, not failed.
- **Moved with no fired mechanism behind it:** noise or a confound (host, provider, Builder
  sampling) until shown otherwise.

A changed `framingDigest` means every Builder action ran under the new text. That makes the text
necessary context for any behaviour change, not proof of one: attribute a behaviour to a prompt
sentence only when the Builder's own plan, notes or prose cite what that sentence asked.

## 7. Confounds to rule out before a verdict

- **One sample per condition.** A Builder that samples a different first plan can move every row.
  A single pair shows what happened, not what will repeat.
- **Host and provider:** load, concurrency, 429s, credit exhaustion, a shared account's session limit
  (§1).
- **Different stop points:** an operator SIGTERM, a timed stop, a budget cap. Cut to equal windows
  (§4).
- **Continued projects:** a candidate continued from the baseline's adopted product starts from a
  product, not from nothing. Compare it only with a baseline that was also continued.
- **Mixed slots:** a pin that changed silently. An unpinned codex slot resolves to the default model
  (AGENTS "Run configuration"), so compare `modelSlots`, not launch intent.
- **Protected-detail parity:** a candidate whose prompts now carry something the baseline's did not
  may be rewarded for leakage. Check `framingDigest` against the range's model-visible changes.

## 8. Give a verdict per pair, per wave and per prediction

**Per pair**, at each checkpoint, give one verdict:

- `improved`: at least one of §5a to §5e moved the better way, no row in §5a to §5f moved the worse
  way, and the confounds of §7 are ruled out or named.
- `regressed`: the mirror of `improved`.
- `unchanged`: the rows sit within what one Builder resample plausibly moves. For example, both sides
  pass every case of every battery, rehearsals passed at similar rates, and the edge mix is the same.
- `undetermined`: before the checkpoint, or when rows disagree in direction, or when a confound can
  explain the difference.

Name the one or two rows that decided each verdict, and give an attribution of `proven`, `likely`,
`mixed` or `unproven` from §6.

**Per wave**, count pairs by direction and never average pass rates across conditions. For scale,
a one-sided sign test over independent pairs gives these probabilities under "no effect":

| pairs improved | probability |
| --- | --- |
| 6 of 6 | 0.016 |
| 5 of 6 | 0.109 |
| 5 of 5 | 0.031 |
| 4 of 4 | 0.0625 |

So five of six improving is suggestive and six of six is a result. Mixed conditions and
`undetermined` pairs leave the count, and the verdict names how many pairs it rests on.

**Per prediction**, adjudicate each frozen row once its checkpoint is reached:

```sh
bun .claude/skills/run-improvement-campaign/scripts/prediction.ts adjudicate --ledger <path> \
  --id <id> --outcome sufficed|partial|refuted|untriggered --evidence "<file or reading>"
```

Use `--run <runId>` in place of `--ledger` for a per-run row. `untriggered` means the run never
tested the variable, for example a prediction about the second edge in a run that ended at one
battery.

## 9. When the question needs a capability number

Placement and calibration show whether the loop improved. They cannot show whether the product
solves more. If the operator asks that, it needs a shared pack, which has three routes:

- Solve one fixed task set on both adopted bundles through
  [harness-query](../harness-query/SKILL.md). This is paid: one measured case per task per side.
- Re-grade artifacts under another evaluator with `bun run replay -- … --under …`, which is free.
- Join two recorded batteries that already share a task-set hash with `compare-conditions.mts`,
  which is free and refuses otherwise.

Name the pack, the model pins and the walls, and report verified, unaccepted and non-result cases
separately. Ask before spending on the first route: it is a new measurement, not part of the audit.

## 10. Write it down

Write the audit at `notes/wave-audits/<candidate sha9>.md`, or beside the review it came from, and
append one block per checkpoint:

```text
Checkpoint:          first battery | third round | terminal — read at <UTC time>
Waves:               baseline <sha9> (<runId suffix>, n runs) → candidate <sha9> (<suffix>, n runs)
Moved variable:      source; <n> commits across PRs <#…>; reach: <prompt | gate | controller | verifier | review>
Mixed pairs:         <condition: field that differs> — excluded
Host:                baseline <runs/load/overlap>; candidate <…>
Predictions:         <id or plan line> — frozen <ledger | file time | post hoc>
Window:              <round r | elapsed hh:mm> on both sides

Per pair:
  <condition>  line <signal, swing, flat, carried: b → c>  zones <b: too-easy×4> → <c: over-aim, too-easy>  edges <…>
               rehearsal passes acted on <0/1 → 1/1>  gate <…>  corrections <…>
               denominators <v/u/nr → v/u/nr>  pace <…>
               verdict <improved | …> on <deciding rows>; attribution <level>; mechanisms fired <commit: output>
Wave:                <k of n> improved, <…> unchanged, <…> regressed, <…> undetermined (sign-test p ≈ <…>)
Prediction outcomes: <id>: <outcome> — <evidence path>
Caveats:             <confounds from §7 that remain>
Next move:           one experiment, one owner — handed to run-improvement-campaign
Settles at:          <next checkpoint and what it could change>
```

An audit that ends without a next move or an adjudicated prediction was only a report. Say so, and
say which checkpoint will settle it.

## Worked baseline, 2026-09-27

This is the baseline wave on source `4ec0615bf`, with run ids `*-20260927T052020405Z-1408e8`
(truss) and `*-20260927T052323252Z-b445f0` (custom). Every run ended `signal-terminated` when the
operator stopped the wave for the relaunch on `6e96003d` (`*-20260927T145744429Z-7e43c0`). Its
`runEnd.climb` rows, read from each `terminal.json`, show what the candidate is measured against. The
target column is the plan's, which sources before `EXPERIMENT.json`'s removal still wrote:

| condition | campaign | batteries (zone, passed of verified, target) |
| --- | --- | --- |
| truss-sol | `…-3fd52f9e-19` | 4 batteries, all `too-easy` at 6 of 6; the first missed an `at-most 3` target by 3, with a Brier score of 0.40 |
| truss-opus | `…-3fd52f9e-17` | 1 battery, `too-easy` at 6 of 6; an `at-least 1` target met, which only a battery with no pass could miss |
| truss-astra | `…-3fd52f9e-18` | 1 battery, `over-aim` at 4 of 4 verified; an `at-most 3` target missed |
| custom-sol | `…-9c0c68b1-15` | 7 batteries, all `too-easy` at 6 of 6; six of the seven targets missed |
| custom-astra | `…-9c0c68b1-14` | 1 battery, `too-easy` at 5 of 5; target missed |
| custom-opus | `…-9c0c68b1-13` | 1 battery, `too-easy` at 4 of 4; target met |

For the truss-sol pair, the prediction frozen by file time was "first batteries at or below the aim
(fewer 6/6 perfect batteries); no identical-exam evaluation-correction loops; the
withhold-instruments flag stays off". Against that baseline, a candidate first battery that passes
some cases and fails some, on fails its review holds, is the reading that would count as
improvement; an `over-aim` placement at a full pass would not.
