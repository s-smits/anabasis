# Deterministic lanes

Eleven readers, one question each, no provider call. `review-angles.md` holds the semantic angles a
paid sweep spends on; this file holds what a local read already answers, so a live run can be
assessed without one. Every lane is selected by rank or by name:

```sh
bun .claude/skills/whole-run-investigation/scripts/wri.mjs lanes
bun .claude/skills/whole-run-investigation/scripts/wri.mjs read <runId> --out <abs dir>
bun .claude/skills/whole-run-investigation/scripts/wri.mjs read <runId> --lanes 5,yield --out <abs dir>
bun .claude/skills/whole-run-investigation/scripts/wri.mjs read <runId> --all --out <abs dir>
```

The target is a campaign folder, a `controller/<runId>` folder or a bare run id, which is looked up
in the `campaigns` tree of every worktree beside the checkout. Each lane writes into the review
directory and records its exit in `wri-review.json`; a lane whose input the target does not carry is
skipped with the reason rather than failing the read.

Every lane captures to `<review>/<lane>.txt`, and the command prints one bounded brief instead: the
run's size and terminal, each lane quoted whole or pointed at, then the digest triggers and scan
findings the snapshot lane raised. `wri.mjs` owns both halves of that — `scope` sizes the run
before the lanes so the read can pick them, `brief` renders the digest after. With no `--lanes`, the
size picks the set:

| tier | the run | lanes | semantic lanes to start from |
| --- | --- | --- | --- |
| `probe` | under two hours, or no case has scored yet | `climb,yield,posture,timeline,walls` | 2 |
| `standard` | a scored battery, under twelve hours and under three epochs | all eleven | 4 |
| `deep` | twelve hours or more, three epochs or more, or three batteries | all eleven | 8 |

`probe` withholds only the six lanes that open the measured checkout or an archive, which is the
one expensive thing a read does and which a battery that scored nothing gives nothing to read. The
tier is a default: `--lanes` and `--all` select whatever is asked for.

| # | lane | answers | reads |
| --- | --- | --- | --- |
| 1 | `snapshot` | what the battery did: cases by kind, scorecard, scan, traces, digest | campaign rows through the measured tree's own outcome reader |
| 2 | `challenge` | which recorded traces contradict the scored result | case traces |
| 3 | `delta` | which changed source the measured run actually reached | campaign rows against the measured checkout |
| 4 | `overview` | the shared brief the paid lanes would open with | the snapshot lane's output |
| 5 | `climb` | whether consecutive batteries moved what the solver must reason about | every version's bundle plus `case-record.jsonl` |
| 6 | `yield` | whether each review component changed a decision or only advised | epoch reviews, diagnoses, admission feedback |
| 7 | `posture` | what the Builder was doing before each submit, against the corpus refusal rate | Builder prose rows |
| 8 | `timeline` | where the run's wall-clock went, which hooks and steering fired, and where each slot stopped progressing | `observability/<runId>.jsonl`, plus Builder, solver and review prose |
| 9 | `walls` | which of the harness's own declared budgets bound its solves, and which never came near | every version's `agent/config.yaml` against `case-record.jsonl` and `case-result.json` |
| 10 | `recurrence` | which findings this lane has already raised on earlier runs | `notes/runs` archives |
| 11 | `archive` | whether a finished archive satisfies its own contract | one `notes/runs` archive |

Lanes 1 to 4 are the four `collect` runs, because the paid lanes consume their output. Lanes 10 and
11 need an archive, which only `finish` writes, so they skip on a live run.

## What the lanes cannot do

- `climb` reads declared bytes. A battery that changed every number without changing what must be
  reasoned about reads as `adjusted`, and `adjusted` deliberately states no direction.
- `posture` grades its own evidence. Under the 26-row floor it reports `thin`, which is a statement
  about the recorded prose, not about the Builder.
- `yield` counts opportunities and consumption. `advisory-only` says a component produced output
  nobody had to act on; it does not say the output was wrong.
- `timeline` measures elapsed time between recorded rows. A long gap says the run took that long in
  that phase, not that it was blocked; read the phase and the next row before calling it a stall.
- `timeline --classify` names two kinds of stretch and they are different claims. `unreadable` is
  the classifier failing on that prose, so its labels there are evidence about nothing; `adrift` is
  the classifier succeeding and reading no progress. On the corpus to date almost every stretch is
  `unreadable`, which is a statement about the margin, not about the model.
- A solve turn carries no recorded time, so a solver stretch is placed by its case window and
  located by turn. The Builder reaches the clock through its session start, and a review through
  the UUIDv7 in its own id; a review that falls inside no session window is left out rather than
  attached to the nearest one.
- `walls` reads the case's wall clock, which includes provider latency and every queue it waited in.
  A case that passed at a wall is not a defect; a case that reached one without passing is a
  truncated solve, not a settled capability failure.
- A lane's verdict is deterministic evidence, never a claim. The verifier still owns every pass.

## Not lanes

- `run-narrative.mjs` is the embedding reading `timeline --classify` renders. Run it directly to
  read the slots without the observation stream, which an older campaign may not carry in a form
  this reader accepts.
- `query-complexity.mjs` is the reading `climb` renders per battery, not a second lane over the same
  campaign: it was one until 2026-09-19, when it printed the check tiers and medians `climb` already
  showed. Run it directly to read an exported query pack, which is not a campaign at all.
- `archive-scaffold.mjs`, `validate-reports.mjs` and `build-manifest.mjs` belong to `launch` and
  `finish`, not to a read.
- `wri.mjs scope` and `wri.mjs brief` size the run and render the read; they answer no question of their own. The tier reads
  the clock, the epochs, the batteries and whether anything scored, none of which is a statement
  about how interesting the run is.
