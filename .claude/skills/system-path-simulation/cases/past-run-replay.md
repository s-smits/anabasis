# Replay a real past run

**Use this case when:** an operator names past runs or their syntheses, or your change touches a component a recorded run exercised, and the question is which run to analyse and how to re-run that position on the current tree.

Replaying a recorded run is the cheapest way to put a change where it matters: the position is
already derived, the condition is already recorded, and the question becomes "does the current tree
do something different from this exact place". Prefer it over an authored position whenever a
synthesis under `notes/runs/` touches the component you changed.

## 1. Choose the run

Given two or three candidate runs, do not choose by memory. Rank them:

```sh
bun .claude/skills/system-path-simulation/scripts/pick-run.mts \
  --tree /abs/tree-under-test --notes /abs/repo/notes/runs --component "<term>" [--json]
```

One row per synthesis: reviewed date, campaign, source commit and its ancestry against the tree
under test (`ancestor, N commit(s) since`, `NOT an ancestor (on origin/main)`, or `source unknown
here`), outcome, terminal reason, recorded denominator, adjudication and result groups, and how
often the component term appears in the three note files. Then apply the criteria in order:

1. **Ancestry first.** A run whose source is an ancestor of the tree under test measures the same
   product one step earlier, and `commitsSince` is the delta. A squash-merged run shows `NOT an
   ancestor (on origin/main)`; read the delta from the merge instead, it is still usable. An unresolved source
   cannot establish product identity: resolve it before claiming a source comparison.
2. **The right denominator for the question.** A mechanism question wants the run that reached the
   mechanism, even an aborted one with zero cases. A capability question wants verified cases.
3. **The component matters to that result.** Most hits, and the synthesis names it in its findings
   rather than in passing.
4. **Newest last.** Recency breaks ties only.

The best run is usually the one whose failure the current tree claims to fix; that is the only
run on which the change has a falsifiable prediction. Write the choice and the runs you did not
pick into the prediction note.

## 2. Take the position from the snapshot bytes

Open the campaign of the chosen run (the run root is recorded in the synthesis; live runs sit in
their own worktrees) and read, in this order: `controller/<runId>/opening.json` for source, epoch
and the three slots; `difficulty-watch.mts --campaign` for the authoring sequence and the submit rows;
the recorded case rows for the checkpoint you replay. Derive the four position facts from the
position section of `SKILL.md`; the history the actor is told it lived is the only authored part.
Where the run's Builder ran on a Claude slot, its transcript sits under
`~/.claude/projects/<workspace-slug>/` and `position-packet.mts --transcript <jsonl>
--summary-file <md> --exchanges 5` copies the last exchanges verbatim under your summary, so the
actor resumes from its own last tool results rather than from your account of them. The delta to
the real position is `commitsSince` plus whatever
`git log --oneline <source>..HEAD -- <paths>` lists for the component.

## 3. Pick the shape for the replay

| The component is | Replay as |
|---|---|
| a deterministic reader, selector or gate | `scenario-stub` over the recorded state through the same exports, or `check-one-fact` |
| a model seat whose judgment broke | `live-segment` seeded from `epoch-<key>/workspace/` at the stage before the break |
| a join between two controller stages | `fullrun-conditions` with `--seed-campaign <run-root> --slug <slug>` |

Stub or seed nothing the run did not record. The old bytes are the control: the same position on
the source commit and on the tree under test is a paired comparison with one moved variable.

## 4. Pre-register and resolve

Write one row per expected difference — "on `<tree>` the selector admits 25 rows where `<run>`
admitted 0" — with the falsifier, hash the note with `predictions.mts --hash`, run, and resolve
every row with `--resolve`. A replay that reproduces the recorded result on the old commit and
changes it on the new one is mechanism evidence for the fix; it is not live-exercised until a
fresh run from the new tree reaches the same branch.

## Finish

Report the chosen run with its ancestry line, the runs not chosen and why, the replay shape, and each resolved row. Name the next fresh run that would turn the mechanism result into a live-exercised one.
