---
name: weekly-run-review
description: Select, explain and publish the strongest Anabasis runs from one calendar week. Use for the weekly best-run Automation, top-three/top-five comparisons, and questions about what made a run good, what limited it, or what should happen next. It filters by duration, reuses WRI deterministic checks, reads published main syntheses, and challenges finalists with Luna xhigh.
---

# Weekly Run Review

Find the strongest completed runs cheaply, then spend model review only on the five deterministic
finalists. Evidence collection is read-only. The final publication owns only one two-line block in
`AGENTS.md`; the full weekly note stays in the local, ignored
`notes/best_agent_week_<ISO-year>-W<week>.md`.

## Boundaries

- Never edit `campaigns/`, `domains/`, controller evidence, claims, promotions or per-run WRI archives.
- Never launch a product run, choose an experiment for the campaign owner, or change a pass.
- The M/W/F full-run audit owns missing WRI analysis. This weekly flow records a missing synthesis;
  it does not launch WRI to fill the gap.
- Luna reports are research. Reconcile material numbers against deterministic snapshots and the
  cited recorded evidence before publishing them.
- Never expose verifier issue/remedy text, counterexamples, reference artefacts, raw traces, task IDs,
  per-task failure locations or model reasoning.

[references/trajectory.md](references/trajectory.md) defines the week-over-week trajectory
contract.

## 1. Run the selector

Start from a fresh worktree at the published main revision. The selector reads the WRI archives
in the `--repo` checkout's local `notes/runs/`.

```sh
bun --no-env-file .claude/skills/weekly-run-review/scripts/select-best-runs.mjs \
  --repo /absolute/main/worktree \
  --week previous --timezone Europe/Oslo \
  --top 5 --min-duration-minutes 30 \
  --snapshot-root /absolute/scratch/deterministic-snapshots \
  --out /absolute/scratch/weekly-selection.json \
  --markdown /absolute/scratch/weekly-selection.md \
  --luna-manifest /absolute/scratch/luna-sessions.json \
  --luna-instructions /absolute/scratch/luna-shared-instructions.md
```

The week is the previous Oslo Monday 00:00 to Monday 00:00, represented as a half-open UTC interval.
Completed-run membership uses `terminal.writtenAt`; wall duration is terminal minus opening. A valid
run exactly at 30 minutes is admitted. Shorter runs remain in the census but consume no WRI or Luna
work. Unfinished, damaged and conflicting rows remain typed exclusions.

The wrapper then invokes the exact source checkout's existing
`whole-run-investigation/scripts/trace-review.mjs` once for every duration-eligible run. That collector
owns nine fixed outcome CLI views: Builder, default metrics, scan, scorecard, warning observations and
the four case partitions, plus the WRI digest and bounded case/trace readability samples. Require the
snapshot manifest, every required view and every recorded byte/hash to agree. Do not reproduce these
readers in the weekly skill.

The selector fills five seats from deterministic evidence before looking for a synthesis. The axes are
candidate promotion, vertical completion, informative difficulty, operational yield and non-saturated
scale. Exact wins and losses are adjudicated later from the published synthesis; a promotion
remains a promotion signal. This is an explicit review queue rather than a hidden weighted capability score.
Duration is only an admission filter. Perfect and all-fail batteries are saturated; non-results never
enter capability rates.

## 2. Bind the five main syntheses

For exactly the five selected rows, resolve `notes/runs/<runName>/review.json` and
`main_synthesis.md` from that local `notes/runs/`. Bind only a `wri-archive/v1` packet whose run ID and full
40-character source revision match the run; any other packet is `synthesis-missing`. Hash the
synthesis bytes. Do not silently replace a missing finalist with rank six.

If a selected synthesis is missing, conflicting or source-mismatched, report the typed gap and stop its
Luna admission. The separate full-run audit supplies the missing analysis. Never read a candidate
worktree's notes as a substitute for main.

## 3. Investigate the top five with Luna xhigh

Use `codex-luna-swarm`'s direct launcher because xhigh is explicit:

```sh
bun .agents/skills/codex-luna-swarm/scripts/luna-sessions.mjs \
  --manifest /absolute/scratch/luna-sessions.json \
  --reasoning-effort xhigh \
  --max-active 4 --start-interval-ms 2000
```

For five ready finalists the selector generates sixteen distinct sessions: two per run (mechanism and
counterfactual) and six cross-run challenges (comparability, full vertical, difficulty, attributable
improvement, decision yield, and blind best-run/action review). Do not pad the count. Do not launch the
manifest unless its `launchAllowed` field is true; a blocked manifest contains no sessions. Drain
completed reports with the launcher's
`--drain` mode while it runs, then once after exit. A typed 429 permits one retry of missing sessions only,
at lower concurrency and slower pacing. Treat any remaining transport failure as missing research.

Each leaf is read-only and independent. It must state a rival explanation and falsifier, keep exact
denominators, and return `unobservable` rather than guess.

The Scheduled task's primary synthesis runs as `gpt-5.6-sol` at xhigh. It owns the week-over-week
synthesis after the Luna reports return. When this Skill is invoked under another condition, use one
bounded read-only Sol xhigh session for that synthesis. Do not ask a Luna session to confirm its own
WRI conclusion. If missing finalist syntheses block Luna, the Sol primary still publishes the
deterministic trajectory, with semantic mechanisms marked `unobservable`; it does not fill the
missing WRI review.

## 4. Decide what “best” means

Adjudicate the Luna challenges against deterministic facts and `attribution-and-proof`. Do not pool
different task sets, source identities, model conditions, verifier rules or provenance conditions.

A unique best overall needs coherent identity, a recorded denominator, measurement that supports a decision, claimable evidence and no unresolved product-side blocker. Otherwise publish `no
claimable winner` and name separate axis leaders. A perfect battery means no limit was found. A
promotion whose claim is refused remains promoted and unclaimed.

For the chosen run, produce a learning handoff with four things:

1. the mechanisms the next condition should preserve;
2. the most important limitation to target;
3. one bounded counterfactual condition that changes only that limitation; and
4. the evidence that would falsify the proposed explanation.

The chosen run becomes a reference condition rather than an automatic template or launch. The campaign owner
decides whether to register the next experiment.

### Hand useful tool lessons downstream

Add one delimited `Builder-tool automation hand-off` section to the weekly note. It is a small
hypothesis queue for the separate `review-and-improve-builder-tools` Automation, not evidence or
source-change authority. Include at most three items which concern a Builder-owned tool interface and
either recur across two finalists or directly affect one finalist's promotion or completed vertical.

Each item names `preserve`, `investigate` or `no-action`, the exact tool or owner, the observed fact and
denominator, safe run/source evidence, current-stack status, one rival explanation and a falsifier.
A preserve item protects a successful sequence from an apparently simpler change. An investigate item
only prioritises the downstream review; that Automation must prove it from its own source and receipt
window before acting. Exclude general model quality, difficulty design, verifier truth and source defects
owned outside Builder tools. When no item qualifies, publish `No builder-tool hand-off` with the missing
evidence rather than filling the section speculatively.

## 5. Publish the weekly reference

Write `notes/best_agent_week_<ISO-year>-W<week>.md` with the period, full top-five table, winner or
no-winner result, mechanisms, limitations, rival explanations, falsifiers, exact identities and
denominators, safe evidence paths, Luna result counts, the learning handoff, and this stable block:

```text
<!-- builder-tool-handoff:start -->
## Builder-tool automation hand-off
<zero to three bounded items, or the explicit no-hand-off result>
<!-- builder-tool-handoff:end -->
```

Always include the delimited `weekly-system-trajectory` block defined by the trajectory reference.
A malformed prior trajectory is an explicit history gap and is never repaired by guessing.

Update only the block delimited by `weekly-best-run:start` and `weekly-best-run:end` in `AGENTS.md`.
It has exactly two visible lines:

```text
Best run of <ISO week>: <run, or no claimable winner>.
Why: <at most one concise sentence; the weekly note is local, so it links nothing under notes/>.
```

If the marker is absent, duplicated or malformed, stop instead of rewriting the file broadly. A rerun
may update the same week's note; it never rewrites an earlier week's note. Check `git diff --check`,
review the `AGENTS.md` diff, commit only that file, refresh `origin/main`, replay if necessary, and push
`HEAD:main` under the repository's surrounding-file rule. A non-fast-forward or overlapping marker
change is a publication conflict and does not authorise an overwrite.

Return the same concise report in the Scheduled task. Link the weekly note, selected
`main_synthesis.md`, `digest.md` and `review.json` files; omit raw Luna reports.
