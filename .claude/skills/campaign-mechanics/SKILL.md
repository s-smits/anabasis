---
name: campaign-mechanics
description: "Use before editing tools/d2/ (harness-builder, campaign-actions, campaign-terms, prepare, round, session, word), src/campaign/opening.ts or src/kernel/{log,condition,task}.ts. Explains Builder choices, log events, conditions and settings, practice release, defaults, admission refusals and campaign endings or waits (AGENTS.md sections 4–6). ending.ts reports why a campaign stopped; conditions.ts compares solve settings. Use run-management to launch, pause or stop runs."
---

# Campaign mechanics

This skill expands `AGENTS.md` sections 4 to 6, which state the invariants; the references hold the
mechanisms behind them. Where a reference disagrees with the source, the source wins and the
reference is corrected in the same change.

| Section | Reference | What it explains |
| --- | --- | --- |
| 4. The Harness Builder | `references/builder-conversation.md` | the one conversation, its campaign tools, which moves count (`led`, `asked` in an older log), why the host promoted or released, the Builder's clock |
| 5. The log | `references/the-log.md` | events, conditions, folds, and what a change may add or read |
| 6. A campaign's commands | `references/campaign-command.md` | the hand commands, opening from a prompt, endings (`idleOf`, `crashedRun`), operator words |
| 6, continued | `references/terms-and-refusals.md` | the opening's terms and setting, practice release, admission refusals, defaults |

What the table names next is `comparison-reading` section 7; moving, launching or stopping a run is
`run-management`.

## Scripts

Both resolve a campaign name locally or in the archive, or take an absolute log path, and
`--host <name>` runs them on another host. Their output names no task or check but remains
exam-side, so it stays out of tracked files.

```text
bun .claude/skills/campaign-mechanics/scripts/ending.ts <name | /abs/path/to/log.jsonl>
bun .claude/skills/campaign-mechanics/scripts/conditions.ts <name | /abs/path/to/log.jsonl>
```

- `ending.ts` answers why a campaign ended or what it waits for. It lists each `campaign.ended`
  with the moves before it, then the current counts against each stopping threshold (budget,
  `stopRule`, `supplyRun`, `crashedRun`, `idleOf`), admission refusals, pending words and the next
  move (`decide`), all through `planOn`, the plan `bun run runs view` uses. The counts describe a
  restart from the log.
- `conditions.ts` answers whether two solves are comparable. Through `conditionsOf` it lists each
  setting in first-use order with what changed, and for each comparison names any difference beyond
  harness, tool tree and task, or prints `comparable`. A host-code change shows as a changed `host`.
