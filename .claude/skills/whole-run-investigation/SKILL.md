---
name: whole-run-investigation
description: "Use when auditing one or more campaign logs, diagnosing stalled climbs or unexpected failures, or questioning a comparison reading (step, no-step, not-scored). Investigates append-only logs across correctness, evaluation validity, wall leakage, task difficulty, promotions, compute time, and cost, producing findings with named owners. Read-only: starts no solve, session, or round and modifies no verdict."
---

# Whole-Run Investigation

Examines one or more campaigns as equals from their append-only logs, producing a vetted synthesis establishing whether readings hold ([comparison-reading](../comparison-reading/SKILL.md)), what constrained the run, and which owner ([references/lanes.md](references/lanes.md), mapped from [references/from-v1.md](references/from-v1.md)) owns each fix. Strictly read-only: starts no solves and modifies no logs or verdicts.

## Questions needing no lanes

| Question | Command |
| --- | --- |
| Active status & last event | `bun run runs pulse` |
| Supply & next move | `bun run runs view <name>` |
| Fresh control check validation (authorised; writes `checker.read`) | `bun tools/c/accept.ts <campaign flags>` |
| Human labels for set-aside rejections (authorised) | `bun tools/d2/settle.ts <campaign flags> --session <id>` |
| Served-model degradations | `bun tools/runs/degradations.ts <name>` |
| Sessions, parent harnesses & readings | `bun tools/wri/wri.ts read --log <log>` (row F, `CHAIN`) |
| Side-by-side climb & `/tmp` crossings | `bun tools/wri/wri.ts climb --log <log>,<log>` |
| Progress by active hour (descriptive) | `bun tools/wri/wri.ts trajectory --log <log>,<log> [--grades <report>] [--hours 2,4,8]` |
| Blind cross-campaign grading | `bun tools/wri/wri.ts packets --log <log>,<log> --out <dir> --graders 2` (then `--join`, `trajectory --grades`) |
| Cross-investigation index & recurring vetted findings | `bun tools/wri/wri.ts index [--root <dir>]`; `bun tools/wri/wri.ts findings [--window 7]` |
| Cost/promotion & cohort trends | `promotion-tuner/scripts/table.ts --rows promotions`; `trend.ts --pack <pack>` |

## Procedure (`<dir>` = `.ana/wri/<date>-<campaign>/` on central host)

Each `bun tools/wri/wri.ts <verb>` step gates on the previous one:

| Step | Command | Purpose |
| --- | --- | --- |
| 0. Read | `read --log <log>` | Prints deterministic rows A–F, triggers and host-code digest |
| 1. Start | `start --log <log>[,<log>...] --out <dir> [--snapshot]` | Writes `overview.md`, `shared-instructions.md` ([references/shared-instructions.template.md](references/shared-instructions.template.md)), `investigation.json` and `data/derived/`; checks out `anabasis-at-<commit>` if needed. Active logs need stop or `--snapshot`. Settle rows A–F before step 2 |
| 2. Instruct | Edit `<dir>/shared-instructions.md` | Fill `## Orientation` (question & paths, never expected answer), `## The moved variable and prior state` (hypotheses + `predictions-<run>.md` with `id` and `lanes`), `## Already read by the primary` (or `"nothing"`). Keep `## Hard rules`; leave no blank `##` section |
| 3. Build lanes | `lanes --out <dir> [--lanes 1-4,7] [--agents N] [--high K] [--regroup]` | Writes `lanes/NN-prompt.md`, `lanes/shared-<hash>.md`, `launch.json`. Opens triggered + 6 standing lanes (1, 4, 8, 12, 14, 19), balanced by `Importance:` (default 4 agents; ≤8 lanes/session); lists isolated lane 6 without building it |
| 4. Launch & record | Run `launch.json` (`wri-lane` or `codex-gpt-swarm`) and `record --out <dir>` together | Lanes write `lanes/NN-report.md` (guarded by `tools/wri/lane-guard.ts`); `record` writes model-free reads into `record.md`. Check each session's model from its transcript |
| 5. Collect (& lane 6) | `collect --out <dir>` | Validates `reportOf` (heading, `Verdict:`, balanced `Observation:`/`Cause:`/`Owner:`/`Reverses if:`/`Decision:`, `Seen in:`, valid owners, `Prediction <id>:`) and writes `reports.md`. If lane 5 leaves a check undecided, build `--lanes 6`, run alone (`launch-06.json`), and re-collect |
| 6. Synthesise | `synthesis --out <dir>` | Renders `synthesis-prompt.md` ([references/synthesis.template.md](references/synthesis.template.md)); synthesis writes `synthesis.md` tagging each finding `<lane>.<n>` and a key from [references/standing-findings.md](references/standing-findings.md) or `new` |

Other verbs: `derive (--log <log>... | --all) [--verbose] [--force] [--no-embed]` (`READERS`, `tools/wri/derive.ts`), `reader <name> --log <log>`, and `grade --log <log> (--task <id> --answer <file> | --solve <id> | --answers <dir>) [--set <path>=<json>]...` (lanes 1, 5, 6).

## Hard rules

- **Wall (no quotes)**: never quote task text, answers, hidden values, check messages, prompt text (except lane 4), traces or Referee prose (`test/wri-walls.test.ts`). Cite event kinds, ids, 8-char digests, counts, paths and lines. Never show WRI outputs to any seat.
- **Read-only**: never edit campaign folders, logs or verdicts, or launch solves/checks (except `wri.ts grade` where permitted).
- **Isolation**: open every lane report with `# Lane <N>: <title>` and `Verdict: pending` before reading; never read another lane's prompt/report. Blind lane 14 runs first with no orientation/triggers; isolated lane 6 runs alone and freezes answer digests before reading checks or rulings.

## Vetting (`<dir>/vetting.md`, validated by `vettingFaults` in `tools/wri/findings.ts`)

Keep **triage** (copying synthesis rows) separate from **vetting** (recounting directly against raw logs, `HEAD`, harnesses and checks). In a release cycle, backtrack `predictions-<run>.md` first (`held` | `falsified` | `unreached`, checking whether the PR's mechanism event fired per `AGENTS.md` §9).

| Column | Required value |
| --- | --- |
| `id` | `vet-<n>` |
| `finding` | one-line summary of what was checked |
| `lanes` | `<lane>.<n>`, lane number or `primary` (every lane finding covered) |
| `standing` | key from [references/standing-findings.md](references/standing-findings.md) or `new` |
| `owner` | owner from [references/lanes.md](references/lanes.md) |
| `importance` | `I0`–`I3` (`AGENTS.md` §11); required when `confirmed` |
| `verdict` | `confirmed` | `plausible` | `refuted` |
| `fate` | when `confirmed`: `repair` | `carry` | `operator` | `none`, with reason |

## Related skills

- Driving WRI2P2 cycles & landing fixes: [run-improvement-campaign](../run-improvement-campaign/SKILL.md), [stack-pr](../stack-pr/SKILL.md)
- Deep comparison or external-bench diagnosis: [comparison-review](../comparison-review/SKILL.md), [compare-systems](../compare-systems/SKILL.md)
- Examiner difficulty calibration or harness inspection: [examiner-complexity](../examiner-complexity/SKILL.md), [harness-audit](../harness-audit/SKILL.md)
- Model-free path rehearsal & whole-codebase audit: [system-path-simulation](../system-path-simulation/SKILL.md), [system-audit](../system-audit/SKILL.md)
- External review handover or archiving: [oracle-handover](../oracle-handover/SKILL.md), [zip-run](../zip-run/SKILL.md)
