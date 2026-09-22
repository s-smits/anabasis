---
name: final-harness-audit
description: Review every harness version the Builder produced for one domain. Join workspace commits to iteration evidence, saved execution versions, measured batteries, and claims. Read-only over controller output.
---

# Final Harness Audit

## Final Builder-only archive review

Run this mandatory campaign-close review whenever Builder authoring completed a workspace commit. After authoring is terminal, resolve the final `iteration.json.workspaceChange.commit` and create an archive outside controller-owned outputs:

```sh
git -C <workspace> archive --format=zip --output <temporary-path>/final-harness.zip <workspaceChange.commit>
```

Give an independent reviewer only that zip and a neutral request to inspect structure, internal consistency, stale or duplicate files, agent/tool/correctness-model agreement, and obvious missing parts. Do not provide the run prompt, evidence, scores, verifier detail, operator diagnosis, expected fix, or earlier conclusions.

Record the workspace commit and zip SHA-256 outside the archive. The review is advisory: it cannot decide correctness, fingerprint, F2, adoption, case truth, claims, or promotion. If the Builder rewrites the candidate, discard the old review and archive the new final commit.

The history review below is a separate mode. Use it to join versions to evidence. Never pass that evidence into the zip-only review.

## Full history review

Review the harness across its full history instead of one run. Each authoring iteration commits to `campaigns/<slug>/epoch-*/workspace/.git`. Read that history and its evidence. Never repair `campaigns/` or `domains/` by hand.

Missing evidence stays missing. A version without a battery is `never measured`. A missing workspace repository is `workspace repo absent`; its iteration evidence may still exist.

## Where facts live

| Fact | Source |
|---|---|
| harness versions | `campaigns/<slug>/epoch-*/workspace/.git` |
| authoring cost | `epoch-*/NN-<slug>/iteration.json` attempts and owner fields |
| saved version identity | `iteration.json` `fingerprint`; first 16 chars of the three hashes form the bundle snapshot ID |
| measured score | adopted `domains/<slug>/runs/`, held `campaigns/<slug>/candidates/*/runs/`, and crossed `campaigns/<slug>/contest/*/runs/` batteries with the matching bundle snapshot ID |
| valid claim | `campaigns/<slug>/claims/<runId>.json` `claim.ok` |
| current version | fingerprint the adopted `domains/<slug>` bytes; retained snapshot directories may contain several versions |

An epoch is one fixed campaign generation. A changed binding creates a successor. The current harness may come from an older epoch whose workspace no longer exists. Report that directly.

## Commands

```bash
bun .claude/skills/final-harness-audit/scripts/harness-versions.mjs <slug>
bun .claude/skills/final-harness-audit/scripts/harness-versions.mjs <slug> --json [--campaign <path>]
bun .claude/skills/final-harness-audit/scripts/harness-versions.mjs <slug> --diff <ordinal|commit>
bun .claude/skills/final-harness-audit/scripts/harness-versions.mjs <slug> --files <ordinal|commit>
```

Run the helper through a prepared checkout's `scripts/worktree.sh run`, using the
repository's pinned Bun. Set `--repo` to the actual run worktree and `--campaign`
to its campaign when the reader comes from another checkout. `--campaign` alone
does not relocate the adopted domain. Before reporting missing measured joins,
check both roots against the opening and recorded battery paths.

Default output shows each version, product size, line churn from the active starter, public-task-set
facts, attempts by session, owner route, measured batteries, pass count, and claim result. JSON adds
a `quickRead` projection, the largest product and code files, code/data/prose line counts, per-path
churn from the starter and previous checkpoint, and task transitions. Task comparison uses only
`family` and `publicInput`: exact repeats, public JSON layouts, vocabulary movement and deterministic
term-frequency cosine. These are diagnostic facts, not a complexity or quality score. The script
does not call an embedding service because a mutable remote model would not be reproducible run
evidence. `--diff` lists changed paths and a diffstat for a version. `--files` shows nonblank lines by file.
The script joins records; it does not judge them.

## Questions to answer

- Did the Builder author the change? Compare the starter commit with commits that produced fingerprinted candidates.
- Is the current harness the newest? Compare the current bundle snapshot with the last fingerprint and read `promotions/` for any gap.
- What did authoring cost? Use attempts and `gates-blocked` results by session.
- Is a score usable? Separate verified, unaccepted and non-result cases. A refused
  claim limits what can be asserted; preserve the recorded cases and report the
  refusal clause rather than erasing their denominators.
- Is growth useful work or repeated output? Start with `quickRead`, largest files and task
  transitions, then inspect the named version with `--diff`.

## Protected evidence

Do not copy hidden expectations, detailed verifier behaviour, per-task failure locations, or reference outputs into Builder, judge, or repair text. Aggregate counts and clause names are safe; issue text is not.
