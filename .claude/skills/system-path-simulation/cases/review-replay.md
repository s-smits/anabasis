# Replay the review slot over a recorded battery

**Use this case when:** a change moves what the Main Judge or the Epoch Reviewer is told or
allowed to decide, and the question is what the live model now does from a recorded case, before a
paid run pays a whole battery to find out.

The review slot never sets a score, so its behaviour has no deterministic proof beyond prompt
text and schema. A recorded battery already holds everything a Judge call needs (the public
context, the bound task, the accepted artifact, the verifier verdict) and everything a review
needs (the version tree, the case record, the claim), so the position is derived, not authored,
and the only variable is the prompt under test.

## 1. Pick the cases from the record, not from memory

Census every recorded disagreement first; the shape of the disagreements chooses the position.
On 2026-09-15, 10,358 recorded cases held 70 verifier-pass/Judge-fail rows, and the largest
single shape was the Judge predicting a compile failure it could not run, repeated across one
run's iterations. The two truss cases first chosen as genuine vetoes were the Judge's own
arithmetic; the replay refuted that in six minutes and the position moved to the firmware run.

```sh
bun .claude/skills/system-path-simulation/scripts/judge-replay.mts \
  --repo /abs/checkout --slug <slug> --run <runId> \
  --task <taskId> --task <taskId> --repeat 2 --out /abs/report-dir
```

`verdicts.json` holds one row per task and sample: recorded verdict, replayed verdict, cited
rules, the check ids they join to, the rationale and `digestMatch` (the request bytes are the
recording's when the brief and artifact still read the same). `contested.json` holds every
ContestedCase row the replay produced, in both directions, over the subject the controller's own
Judge review reads: a veto (a verifier pass failed with a citation, and failed again in the
confirming sample production takes) and a disputed fail (a verifier fail the Judge passed on its
one sample, naming the checks the verifier failed) are the two the reviewer settles. The summary line counts each. A run
whose brief no longer validates under the current reader refuses; move to a run that does.

At Opus medium the same artifact went 2 fail / 1 pass across three samples on 2026-09-15; that
split is why a cited fail is sampled twice before it counts. `--repeat` adds whole samples on top.

## 2. Fork the run and put the real reviewer back on it

```sh
bun .claude/skills/system-path-simulation/scripts/review-settle.mts \
  --repo /abs/checkout --slug <slug> --run <runId> --scratch /abs/new-dir \
  [--contested /abs/report-dir/contested.json] [--request "<the operator's one-liner>"]
```

The script copies the version tree (symlinks verbatim), `case-record.jsonl`, the claim, the
isolation probe and, when the campaign reached its analyse step, its `analysis/` directory into the
scratch root, derives the iteration analysis there and runs `runEpochReview` against it. Nothing is written under the real
`campaigns/`, and the forked `analysis/` is what lets recurrence and reuse decide as production
decides them. The standing issue ledger comes from `analysis/rebuild-advice-latest.json`, so the
replayed review is offered the same issues to dispute.

The reviewer is offered the Judge disagreements the way the analyse step offers them, split by
`reviewerContested` into vetoes, disputed fails and the rest. `--contested` is optional: without
it they are the recorded Judge's, derived by the controller's own `runJudgeReviews`. Until
2026-09-29 the script took `--vetoed` alone and passed no disputed fail, so a battery whose Judge
passed the verifier's fails (firmware f0fb83-i05, four of six) replayed with nothing to settle.
Step 1 is the position when a Judge disagreement is the question; when the
question is the reviewer's own reading of a battery, skip it and fork the run directly. That is the
common case: across 314 recorded epoch reviews the Judge contested nothing in most batteries, and a
run the provider cut short never got its review at all — forking it is how that review gets run.

`--request` supplies the operator's verbatim one-liner when no Judge ran, since the recorded copy
lives in the Judge's public context. Without it the reviewer is told the request is unavailable and
its first obligation, request coverage, goes unasked.

The evidence lands at `<scratch>/<runId>-epoch-review.json`, and beside it
`<runId>-public-review.json`, which is what `publicEpochReview` lets cross to the next Builder
round, so a rule-4 question is read off the replay's own projection; the summary names status,
reads, findings, disputes and the report.

Read the evidence before the report. On 2026-09-15 the reviewer read the vetoed artifact
through `read_source`, recorded `harness-defect` on `init-hardware-state` with owner
`correctness-model` at blocking severity, cited the artifact's own register write rather than the
Judge's prose, and wrote "the Judge read the shown public rules correctly" in its synthesis. Its
second blocking request was admitted advisory, under a one-reopen cap that has since been removed:
severity now reads each finding's own evidence, so both would be admitted as recorded.

## Limits

- The campaign's `analysis/` is forked as it stands now, which is after the run finished. For a
  battery whose own review recorded findings, that review is in the fork and the replay may read it
  as a prior occurrence the original did not have.
- A campaign that ended before its analyse step has no `analysis/` at all: nine of the 113 recorded
  on 2026-09-17 hold a claim without one. Those fork with an empty standing ledger, so the replay
  reads no prior occurrence and can dispute nothing. That is the weaker condition, not a refusal.
- An old run's `.toolchain` link may point at an epoch workspace that no longer holds the tools;
  the review then ends `incomplete` with the three verifier entries missing, and still settles the
  veto. That is the recorded position's property, not a staging fault. `tool-tree.mts --campaign`
  says so before the replay and lists the family's trees that still exist.
- The review slot is the one in `--repo`'s `.env` chain unless the process environment names
  another; a drained account returns 429 as a transport error on every sample. Read
  `.accounts/usage` first. When the account is not the plain one, run the script as
  `bun --env-file=.accounts/claudeN.env …`, following SKILL.md's steward rule. Both scripts strip
  the launching session's `CLAUDE*` variables before the slot opens and print the names.
