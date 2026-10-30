---
name: campaign-mechanics
description: "Use before editing tools/d2/ (harness-builder, campaign-actions, campaign-terms, prepare, round, session, word), src/campaign/opening.ts or src/kernel/{log,condition,task}.ts. Explain Builder choices, log events, settings, practice release, defaults, admission refusals and campaign endings or waits (AGENTS.md sections 4–6). ending.ts reports stopping conditions; conditions.ts compares solve settings. Use run-management to launch, pause or stop runs."
---

# Campaign mechanics

This skill explains `AGENTS.md` sections 4 to 6, using the same section numbers. Read the reference
for the mechanism you are changing. `AGENTS.md` keeps the shared invariants, rules and operator
decisions; these references give their mechanisms and limits. When they disagree with current
source, check the source and correct the stale description.

Choose the reference for the mechanism you are working on:

| Reference | Sections | The question it answers |
| --- | --- | --- |
| `references/builder-conversation.md` | 4. The Harness Builder | How does the Builder lead a campaign from one conversation, and what may it choose? |
| `references/the-log.md` | 5. The log | What is the record, what does a condition name, and what may a change add to or read from it? |
| `references/campaign-command.md` | 6. A campaign's commands: the commands in order, "The campaign command" | Which command writes what, how does a campaign open, spend, end and take the operator's word? |
| `references/terms-and-refusals.md` | 6, continued: "What the log records of a campaign's conditions", "What refuses a move", "Defaults" | What does a campaign run by, what is released for practice, what refuses a move, and what are the defaults? |

## Where to read

| If you are about to, or asking | Read |
| --- | --- |
| change `tools/d2/harness-builder.ts`, `tools/d2/campaign-actions.ts` or a Builder campaign tool | `references/builder-conversation.md` |
| explain why `compare` or `promote` did something other than what the Builder asked (`comparedOf`, `step`) | `references/builder-conversation.md` |
| ask whether a move is recorded, counted against `--moves`, or carries `asked` | `references/builder-conversation.md` |
| change the Builder's deadline, its clock during a campaign action, or compaction | `references/builder-conversation.md` |
| add an event kind, a file beside the log, or a reader of a fact the log holds | `references/the-log.md` |
| ask what a condition names, or whether two solves are comparable | `references/the-log.md`; run `scripts/conditions.ts` on the log |
| move, copy, retire or archive a campaign | `references/the-log.md`, then the skill `run-management` |
| run or change a hand command (rows 0 to 7) | `references/campaign-command.md` |
| change how a campaign opens from a prompt, or the draft's reading | `references/campaign-command.md` |
| ask why a campaign ended, or what it is waiting for | `scripts/ending.ts`, then `references/campaign-command.md` |
| change an ending, the idle count (`idleOf`) or the crash count (`crashedRun`) | `references/campaign-command.md` |
| leave a word for a running campaign (`--stop`, `--tasks`, `--budget`) | `references/campaign-command.md` |
| change the opening's terms, the project or the setting | `references/terms-and-refusals.md` |
| change what practice a release takes, or in what order | `references/terms-and-refusals.md` |
| ask why comparison admission or session admission refused a move | `scripts/ending.ts`, then `references/terms-and-refusals.md` |
| change a default, or ask when an Examiner session ends | `references/terms-and-refusals.md` |
| ask what the table names next, row by row | the skill `comparison-reading`, section 7 |
| launch, continue, pause or stop a run | the skill `run-management` |

## Scripts

`scripts/ending.ts` lists recorded endings and current stopping conditions. It complements
`bun run runs view`, which reports the climb and next move without this ending history or the
counts against stopping thresholds.

```text
bun .claude/skills/campaign-mechanics/scripts/ending.ts <name | /abs/path/to/log.jsonl>
```

The script resolves a campaign name locally or in the archive, or accepts an absolute log path.
An explicit path can read a remote host's archived copy after that host stops listing it.
`--host <name>` runs the script remotely through `runCommand`.

It reports:

- Each `campaign.ended`, its reason and preceding `campaign.move` counts. `asked` marks
  a Builder choice that differed from the table. Moves after the last ending are shown separately.
- The current budget, improvement patience (`stopRule`), supply patience (`supplyRun`),
  consecutive crashes (`crashedRun` against `CRASHES`) and idle conversations
  (`idleOf` against `IDLE`).
- Admission refusal codes (`refusals`), pending operator instructions (`pendingWords`) and
  the next move (`decide`).

These readers use `planOn`, the same plan as the run view. Counts describe a restart from the
log after its last ending; a campaign ended `finished` therefore has no current idle count.
Output contains ids, codes, counts and host reasons, without tasks or checks. It remains
exam-side and must stay out of tracked files.

```text
bun .claude/skills/campaign-mechanics/scripts/conditions.ts <name | /abs/path/to/log.jsonl>
```

`conditions.ts` checks comparability through `conditionsOf`, which verifies condition hashes.
It lists settings in first-use order (`settingId`) and their changes: model, effort, compaction
and side values; limit and runtime keys; short digests for other fields. For each comparison,
it reports differences beyond harness, tool tree and task, or `comparable` when none exist.
It also groups Examiner room solves and practice solves. A host-code change appears as a changed
`host`. Output omits tasks but remains exam-side and must stay out of tracked files.
