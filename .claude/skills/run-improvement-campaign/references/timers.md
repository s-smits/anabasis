# Event hooks and timers

Wake protocol lives in [SKILL.md](../SKILL.md#event-hooks-and-timers). Prefer event hooks (`until.ts`, `runs alerts`, `runs pulse`) over clock timers.

## Primary: promotion-driven event hooks

```sh
bun .claude/skills/run-improvement-campaign/scripts/until.ts <run> --at harness.promoted:next --say "backtrack predictions and decide pause vs continue (up to 5)"
```

- Start with `--at harness.promoted:next` (resolves to `currentPromotions + 1` on launch, eliminating off-by-one counts across promotions 1 → 2 → 3 → 4 → 5).
- On wake: execute the per-promotion prediction-backtracking gate (`SKILL.md`). Either arm `runs pause <run> --after reported --yes` and wait for rest, or log the continuation row in `cycle.md` + `deviations.md` and immediately re-arm `--at harness.promoted:next` (up to 5 promotions maximum).
- Never run recurring interval loops (`90m`, `2h/4h/6h/8h`) to poll campaign progress: a single solve sweep can exceed 90 minutes, causing clock polls to fire twice mid-sweep with no new evidence.

## Fallback: non-event timers

Keep a timer only for deadlines no log event announces, while every column fills concretely, and retire it at its trigger:

| Timer | Owner | Reads | Decision | Evidence | Retire when |
| --- | --- | --- | --- | --- | --- |
| non-promo ceiling | cycle session | `wri2p2.ts due` (`clockTurns`), `runs view` | pause stalled 0-promo run at 12h | one-shot at `clockTurns` | fires once or promo 1 arrives |
| chain | scheduling wake | `wri2p2.ts due` | run next step +10m later | `due` listed an actionable step | `due` empty (schedules no successor) |
| open decisions | cycle session | open rows in `cycle.md`/`plan.md` | resolve ambiguity or escalate | decision with overturn condition | 2 consecutive quiet firings |
| handover | operator time | 5 points, stack, loop diagnostics ([cycle-ledger.md](cycle-ledger.md)) | next session handoff | handover section in `cycle.md` | after firing once |

Move deterministic checks into `wri2p2.ts due`, `bun run runs` or local jobs rather than recurring session timers.

## Timer prompt (self-contained post-compaction, 5 items in order)

1. Name, creation date, and 7-day recreation date (delete old id when recreating).
2. Absolute paths to cycle dir and worktree.
3. Operator authority verbatim + date + standing caps/prohibitions.
4. First command to run + `"follow the wake protocol of run-improvement-campaign"`.
5. Quiet rule: emit one summary line, write no ledger row, change no hooks or timers.

Keep wakes idempotent: re-read `due`/`next` fresh and write predictions before any `--yes`.

## Auditing timers

```sh
bun .claude/skills/run-improvement-campaign/scripts/timers.ts <transcript.jsonl | dir> ... [--since <ISO>]
```

Inspect active vs quiet splits: replace recurring polls with `until.ts` event hooks, collapse duplicate readers, and delete any timer that stays quiet in ≥3/4 firings.
