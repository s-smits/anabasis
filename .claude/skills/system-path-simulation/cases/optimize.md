# Optimise by simulation

Tunes changes observable only via a live model seat (e.g. Examiner held drafts after a promotion) using iterative [before-after](before-after.md) pairs of [live seats](live-seat.md) on recorded seeds. (Tune scoring rules off-policy via [promotion-tuner](../../promotion-tuner/SKILL.md).)

Editable surfaces: Examiner prompt (`src/examiner/prompt.ts`), tool-result facts (`admitDraft` in `src/examiner/write.ts`; `src/examiner/record.ts`) or Examiner home (`src/examiner/shell.ts`), committed so new inputs stay documented in `AGENTS.md` §3. Session terms (`tools/d1b/examine.ts`, `--tasks 12 --proposals 36 --minutes 240 --turns 200`) are operator conditions (recommend, do not auto-merge). Never vary solver model, budget or exam content.

## 1. Fix primary count, graded loss & guards

Freeze one primary count, direction, threshold, denser **graded loss**, and non-regression **guards** before round 1 (changing primary count starts a new series). Size arms so outcomes separate by ≥2 events. Under current `TASK_ADMISSION` (`src/examiner/write.ts`), `pairs` counts package-valid `held` drafts while validity headroom and `gap >= 1%` read 0 (populated on historical logs only); actual headroom appears once comparisons run (`examiner-complexity`'s `ambition.ts`).

| Seat | Primary count | Graded loss | Guards |
| --- | --- | --- | --- |
| Examiner post-promotion | drafts held | drafts refused; median turns of valid reference answers (pre-v0.14 trees) | USD / admission |
| Examiner at opening | drafts held before comparison 1 | drafts refused | USD / admission |

## 2. Select open positions & measure noise floor

Survey logs (`live-seat.ts read --log <abs log> --from <event>`) for poor baseline positions with a **positive deviant** (proving the position is open; only structural exhaustion proves it closed). Pick two positions from distinct campaigns (dev + held-out confirmation). Run one identical A/A pair at each new position to establish its noise floor.

## 3. Diagnose & diff prompts before spending

Compare tool calls (`live-seat.ts calls <log|dir>...`) between positive deviant and failing seat: (1) does the seat self-check with the solver's method? (2) which sentence prescribes a directive or contradicts the log (`AGENTS.md` §2)? (3) which error hits every arm? Keep edits small and inspect exact prompt diffs first:

```sh
bun <after>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <before> --name sim-<what>-before -- tools/d1b/examine.ts --session x-<n> <flags> > before.txt
bun <after>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <after> --name sim-<what>-after -- tools/d1b/examine.ts --session x-<n> <flags> > after.txt
diff <(sed 's/sim-<what>-before/X/g' before.txt) <(sed 's/sim-<what>-after/X/g' after.txt)
```

## 4. Run, verify & decide

Fix positions, models/efforts, cap, time limit, admission horizon `N` and host class before round 1:
- **Size**: ≥5 pairs of one model at ≥6 admissions/seat (`alpha = 0.05`, 5/5 with ties against gain). Smaller rounds are `screen` only and cannot enter a PR.
- **Execution**: cut seeds directly on seating host (`bun run runs seed --from <run> --name sim-<what>-<arm> --before <session>`), match source models/efforts/reviewer, launch arms simultaneously (`start --cap <usd> --minutes <n>`), never pass `--loaded`.
- **Check in order**: (1) integrity (`pairs` verifies model/effort/source/cut + commit in `compare`); (2) delivery (`tail -n +<events+1> <log> | grep -c '<text>'`; 0 = `unreached`); (3) fixed horizon `live-seat.ts pairs <ctrl>,<arm> ... --gates N` (drop <6 admissions as `thin`, stop both at `N`, grade blind); (4) compare vs A/A spread and sign-test per model.

Pre-register each round in `.ana/wri/<date>-<what>/` (`series`, `variable`, `why`, `arms`, `size`, `intent`, `outcomes` `O1`–`O3`, `delivery`, `guards`, `result`, `next`). Admit to a PR only from a decision-sized round showing either:
- **Gain**: variable delivered, beat control beyond noise floor, guards held, replicated on held-out position (rule 6); or
- **Simpler parity**: no regression beyond noise floor, cost guard held, net removal of prompt/tools/code (`reduce-complexity`).

Revert otherwise; stop after 3 flat rounds. Claim only `"the count moved on two seeds from two campaigns"` (`AGENTS.md` §10), and trash round seeds/worktrees once recorded.
