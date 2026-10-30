---
name: campaign-mechanics
description: "A campaign's mechanics in full, AGENTS.md sections 4 to 6: the Builder's conversation and its campaign tools (examine, release_practice, compare, promote, campaign_status, wait), what the table names and what a tool does instead, deadlines and compaction, --builder-led; the log, conditions and its four habits, retire and the archive; every hand command (draft, accept, prepare, examine, round, session, checkpoint, settle, promote, import, close) and what it writes, the campaign command from a prompt or a pack, its budget and seven endings (budget, stop, exam, no-room, environment, operator, finished), idle and crashed conversations, the operator's words, the opening, project and setting, practice release order, comparison and session admission (What refuses a move), and the defaults. Use before changing or explaining harness-builder, a round, a session, admission, the setting, practice release, an ending or a default, or a log event, and to answer why a campaign ended or what it waits for (scripts/ending.ts); procedure for launching runs is run-management's."
---

# Campaign mechanics

The full account of `AGENTS.md` sections 4 to 6, under the same numbers and titles, so "section 7"
means the same section in `AGENTS.md` and here. `AGENTS.md` holds the invariants every session
carries, and this skill the mechanisms, owners and edge cases behind them. `AGENTS.md` owns the rules
(section 8) and the operator's decisions (section 3). The source at the stack's head, with each
module's head comment, outranks both. The other parts of the account are `design-and-seats`
(sections 1 to 3), `campaign-mechanics` (4 to 6), `comparison-reading` (7 and 8) and
`repository-practice` (9 to 14).

The account sits in four references, each opening with when to read it:

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
| ask what a condition names, or whether two solves are comparable | `references/the-log.md` |
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

`scripts/ending.ts` answers "why did this campaign end, and what is it waiting for", which
`bun run runs view` does not: the view prints the steps, the climb and the table's next move, and
says nothing of a campaign's endings or of any count beside its bound.

```text
bun .claude/skills/campaign-mechanics/scripts/ending.ts <name | /abs/path/to/log.jsonl>
```

It reads one log, by name as `bun run runs` finds it (a worktree's, else the archive's) or by an
absolute path, which also reads a remote host's archived copy that the view refuses. It prints each
`campaign.ended` with its reason and the `campaign.move` codes counted before it (`asked` where the
Builder chose otherwise than the table), the moves since the last ending, then the counts the
endings are decided on, each beside its bound and each from its production owner under the plan
the view asks the table with (`planOn`, `tools/runs/view.ts`): the budget left, improvement
patience (`stopRule`), supply patience (`supplyRun`, over `roomless` in `src/campaign/decide.ts`),
crashed sessions in a row (`crashedRun` against `CRASHES`), idle conversations (`idleOf` against
`IDLE`), the codes comparison admission would refuse with (`refusals`), the operator's words not
yet heard (`pendingWords`), and the table's move (`decide`). It parses its arguments through
`runCommand` (`.claude/skills/main/cli.ts`), so `--host <name>` runs it on another host. The counts
are read after the last ending, as the command run again would read them, so a campaign that ended
`finished` shows no idle conversation. It prints ids, codes, counts and the host's reasons, never a task or a
check, but its output is still read off an exam-side log: keep it out of tracked files.
