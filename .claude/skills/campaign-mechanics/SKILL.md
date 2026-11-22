---
name: campaign-mechanics
description: "Use before editing or answering questions about tools/d2/ (harness-builder, campaign-actions, campaign-terms, prepare, round, session, word), src/campaign/opening.ts, src/kernel/{log,condition,task}.ts, practice release, admission refusals, or campaign endings. Explains Builder choices, log events, experimental conditions and settings, defaults, and waits (AGENTS.md sections 4 to 6). ending.ts reports why a campaign stopped; conditions.ts compares solve settings; bills.ts analyses solve costs against turn counts and reserve. Use run-management to launch, pause, or stop runs."
---

# Campaign mechanics

This skill expands `AGENTS.md` sections 4 to 6, which state the system invariants; the reference
files below document the underlying mechanisms. Whenever a reference disagrees with the source code,
the source code is authoritative and the reference must be updated in the same change.

| Section | Reference | What it explains |
| --- | --- | --- |
| 4. The Harness Builder | `references/builder-conversation.md` | The single Builder conversation, its campaign tools, which moves are recorded (`led`, or `asked` in older logs), why the host promotes or releases tasks, and how the Builder's clock runs |
| 5. The log | `references/the-log.md` | Log events, experimental conditions, state folds, and what a change may add or read |
| 6. A campaign's commands | `references/campaign-command.md` | Manual commands, opening from a prompt, campaign endings (`idleOf`, `crashedRun`), and operator words |
| 6, continued | `references/terms-and-refusals.md` | Opening terms and settings, practice release, admission refusals, and defaults |

The decision table that determines the next move is documented in [comparison-reading](../comparison-reading/SKILL.md) (section 7);
launching, moving, or stopping runs belongs to [run-management](../run-management/SKILL.md) (with lifecycle thresholds in [decision-points](../decision-points/SKILL.md)); rehearsing or simulating a changed campaign path on a seed belongs to [system-path-simulation](../system-path-simulation/SKILL.md); and diagnosing a finished or stalled run belongs to [whole-run-investigation](../whole-run-investigation/SKILL.md).

## Scripts

Each script resolves a campaign name locally or in the archive, or accepts an absolute path to a
log file; passing `--host <name>` executes it on a remote host. Although their output omits task
text and check code, it remains exam-side data and must stay out of tracked files.

```text
bun .claude/skills/campaign-mechanics/scripts/ending.ts <name | /abs/path/to/log.jsonl>
bun .claude/skills/campaign-mechanics/scripts/conditions.ts <name | /abs/path/to/log.jsonl>
bun .claude/skills/campaign-mechanics/scripts/bills.ts <name | /abs/path/to/log.jsonl>... | --runs <dir>
```

- `ending.ts` explains why a campaign ended or what condition it is waiting on. It lists each
  `campaign.ended` event with its preceding moves, followed by current counts against each stopping
  threshold (budget, `stopRule`, `supplyRun`, `crashedRun`, `idleOf`), admission refusals, pending
  operator words, and the next recommended move (`decide`), all computed via `planOn` (the same
  planner used by `bun run runs view`). These counts describe what a restart from the log will do.
- `conditions.ts` checks whether two solves share a comparable experimental condition. Using
  `conditionsOf`, it lists each distinct setting in order of first use with the fields that changed,
  and for each comparison reports any difference beyond harness, tool tree, and task, or prints
  `comparable`. Any change to host code appears as a changed `host` field.
- `bills.ts` checks whether turn counts track seat expenditure and whether the per-solve reserve is
  adequate. For each seat and model, it prints finished seat bills, dollars per turn, the rank
  correlation between turns and bill, seats exhibiting a single turn at ten times their median cost,
  and solves whose cost exceeded their campaign's reserve.
