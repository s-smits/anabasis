# The loop's timers

Firing protocol lives in [SKILL.md](../SKILL.md). Keep a timer only while every column fills concretely, and retire it at its trigger:

| Timer | Owner | Reads | Decision | Evidence | Retire when |
| --- | --- | --- | --- | --- | --- |
| driver | cycle session | `wri2p2.ts due`, `runs active`, ready queue | next single step or none | step taken before any event announced it | quiet in 3/4 firings over 2d → lengthen or move check to `due` |
| chain | scheduling firing | `wri2p2.ts due` | run next step +10m later | `due` listed an actionable step | `due` empty (schedules no successor) |
| milestone | prediction | non-event deadline (use `until.ts` for log events) | resolve prediction row | prediction row | after firing once |
| open decisions | cycle session | open rows in `cycle.md`/`plan.md` | resolve ambiguity or escalate | decision with overturn condition | 2 consecutive quiet firings |
| morning read | cycle session | nightly jobs, disk, stack vs `main` | log backlog or escalate | failure not announced by alerts | local job emits lines read by driver |
| handover | operator time | 5 points, stack, loop diagnostics ([cycle-ledger.md](cycle-ledger.md)) | next session handoff | handover section in `cycle.md` | after firing once |

Never poll campaign logs on a timer (use `runs alerts`/`pulse`/`until.ts`). Move deterministic checks into `due`, `bun run runs` or local jobs.

## Timer prompt (self-contained post-compaction, 5 items in order)

1. Name, creation date, and 7-day recreation date (delete old id when recreating).
2. Absolute paths to cycle dir and worktree.
3. Operator authority verbatim + date + standing caps/prohibitions.
4. First command to run + `"follow the firing protocol of run-improvement-campaign's Timers"`.
5. Quiet rule: emit one summary line, write no ledger row, change no timers.

Keep firings idempotent: re-read `due`/`next` fresh and write predictions before any `--yes`.

## Auditing timers

```sh
bun .claude/skills/run-improvement-campaign/scripts/timers.ts <transcript.jsonl | dir> ... [--since <ISO>]
```

Inspect active vs quiet splits: move mostly-quiet recurring polls into `due`/local jobs, collapse duplicate event/timer readers, and replace late-firing timers with event hooks.
