---
name: whole-run-investigation
description: "Use when auditing one or more campaign logs, diagnosing stalled climbs or unexpected failures, or questioning a comparison reading (step, no-step, not-scored). Investigates append-only logs across correctness, evaluation validity, wall leakage, task difficulty, promotions, compute time, and cost, producing findings with named owners. Read-only: starts no solve, session, or round and modifies no verdict."
---

# Whole-Run Investigation

Examines one or more campaigns as equals from their append-only logs, producing a vetted synthesis establishing whether readings hold ([comparison-reading](../comparison-reading/SKILL.md)), what constrained the run, and which owner ([references/lanes.md](references/lanes.md), mapped from prior catalogues in [references/from-v1.md](references/from-v1.md)) owns each fix. Strictly read-only: starts no solves and modifies no logs or verdicts.

## Questions needing no lanes

| Question | Command |
| --- | --- |
| Active status & last event | `bun run runs pulse` |
| Supply & next move | `bun run runs view <name>` |
| Fresh control check validation (authorised; writes `checker.read`) | `bun tools/eval/accept.ts <campaign flags>` |
| Human labels for rejections or passes (authorised) | `bun tools/campaign/settle.ts <campaign flags> --session <id>` |
| Served-model degradations | `bun tools/runs/degradations.ts <name>` |
| Sessions, parent harnesses & readings | `bun tools/wri/wri.ts read --log <log>` (row F, `CHAIN`) |
| Side-by-side climb & `/tmp` crossings | `bun tools/wri/wri.ts climb --log <log>,<log>` |
| Same-domain version backtracking (release-gap weighted) | `bun tools/wri/wri.ts backtrack (--log <log>[,<log>] \| --domain <domain>)` |
| Progress by active hour (descriptive) | `bun tools/wri/wri.ts trajectory --log <log>,<log> [--grades <report>] [--hours 2,4,8]` |
| Blind cross-campaign grading | `bun tools/wri/wri.ts packets --log <log>,<log> --out <dir> --graders 2` (then `--join`, `trajectory --grades`) |
| Cross-investigation index & recurring vetted findings | `bun tools/wri/wri.ts index [--root <dir>]`; `bun tools/wri/wri.ts findings [--window 7]` |
| Cost/promotion & cohort trends | `promotion-tuner/scripts/table.ts --rows promotions`; `trend.ts --pack <pack>` |

## Procedure (`<dir>` = `.ana/wri/<date>-<campaign>/` on central host)

Run standalone via `bun run wri <verb>` (wraps `tools/wri/wri.ts`, requires no `.env` credentials, and shares `packOf`/`domainOf` and `EVAL_RUNNER` from `.env.runs`). Each step gates on the previous one:

| Step | Command | Purpose |
| --- | --- | --- |
| -1. Domain & eval check | `check --log <log> [--min-promo N]` / `regressions --log <log>` | Connects the run to its domain, checks `promotions >= minPromo` (default `1`), checks for paired external benchmark arms (`EVAL_RUNNER`) and gitignored `/.wri/domains/<domain>/` extensions, and prints deterministic rubric-miss + `.toolchain/bin` transfer tables (exits `1` if paired ablation is owed first; see [regression-evals-analyzer](../regression-evals-analyzer/SKILL.md)) |
| 0. Read | `read --log <log>` | Prints deterministic rows A–F, triggers and host-code digest |
| 1. Start | `start --log <log>[,<log>...] --out <dir> [--snapshot] [--min-promo N]` | Writes `overview.md`, `shared-instructions.md` ([references/shared-instructions.template.md](references/shared-instructions.template.md), with `## Operator questions` copied from [references/questions.md](references/questions.md): add or drop rows there per investigation, or in `questions.md` for every later one), `investigation.json` and `data/derived/`; prints domain/eval readiness; checks out `anabasis-at-<commit>` if needed. Active logs need stop or `--snapshot`. Settle rows A–F before step 2 |
| 2. Instruct | Edit `<dir>/shared-instructions.md` | Fill `## Orientation` (question & paths, never expected answer), `## The moved variable and prior state` (hypotheses + `predictions-<run>.md` with `id` and `lanes`), `## Already read by the primary` (or `"nothing"`). Keep `## Hard rules`; leave no blank `##` section |
| 3. Build lanes | `lanes --out <dir> [--lanes 1-4,7] [--agents N] [--high K] [--regroup] [--min-promo N] [--with-evals]` | Writes `lanes/NN-prompt.md`, `lanes/shared-<hash>.md`, `launch.json`. Opens triggered + 10 standing core lanes (1, 2, 3, 4, 5, 6, 9, 11, 14, 16) plus optional Lane 90 (when `promotions >= minPromo` and paired external bench records exist) and any standing gitignored `/.wri/domains/<domain>/lanes.md` lanes (`21`–`99`), balanced by `Importance:` (default 4 agents; ≤8 lanes/session); lists isolated lane 20 without building it |
| 4. Launch & record | Run `launch.json` (`wri-lane` or `codex-gpt-swarm`) and `record --out <dir>` together | Lanes write `lanes/NN-report.md` (guarded by `tools/wri/lane-guard.ts`); `record` writes model-free cross-version and archive reads (`wri.ts backtrack --domain`, `trend.ts`, `table.ts`, `starter-reads.ts`, `replay.ts`, `findings`) into `record.md`. Check each session's model from its transcript |
| 5. Collect (& lane 20) | `collect --out <dir>` | Validates `reportOf` (heading, `Verdict:`, balanced `Observation:`/`Cause:`/`Owner:`/`Reverses if:`/`Decision:`, `Seen in:`, valid owners, `Prediction <id>:`, `Question <id>:` for each operator question naming the lane) and writes `reports.md`, which lists each operator question with its lanes' answers and whose findings table gives each finding its id, owner, marks, `Seen in:` log selectors and decision (`document.ts`'s `findings` part prints those log parts for an Oracle). If lane 17 leaves a check undecided, build `--lanes 20`, run alone (`launch-20.json`), and re-collect |
| 6. Synthesise | `synthesis --out <dir>` | Renders `synthesis-prompt.md` ([references/synthesis.template.md](references/synthesis.template.md)) with same-domain version-gap history (`{history}`); synthesis writes `synthesis.md` starting with version-over-version progress and tagging each finding by its id (`lane<N>-<kind><k>`, from the heading's `<kind>:`; `<lane>.<n>` in investigations collected before) and a key from [references/standing-findings.md](references/standing-findings.md) or `new` |

Other verbs: `derive (--log <log>... | --all) [--verbose] [--force] [--no-embed]` (`READERS`, `tools/wri/derive.ts`), `reader <name> --log <log>`, `grade --log <log> (--task <id> --answer <file> | --solve <id> | --answers <dir>) [--set <path>=<json>]...` (lanes 4, 17, 20), and `bun tools/wri/rank-lanes.ts [--check]` (keeps `lanes.md` and `TRIGGERS` ordered strictly by descending `Importance:`).

## Hard rules

- **Wall (no quotes)**: never quote task text, answers, hidden values, check messages, prompt text (except lane 16), traces or Auditor prose (`test/wri-walls.test.ts`). Cite event kinds, ids, 8-char digests, counts, paths and lines. Never show WRI outputs to any seat.
- **Read-only**: never edit campaign folders, logs or verdicts, or launch solves/checks (except `wri.ts grade` where permitted).
- **Isolation**: open every lane report with `# Lane <N>: <title>` and `Verdict: pending` before reading; never read another lane's prompt/report. Blind lane 1 runs first with no orientation/triggers; isolated lane 20 runs alone and freezes answer digests before reading checks or rulings.

## Vetting (`<dir>/vetting.md`, validated by `vettingFaults` in `tools/wri/findings.ts`)

Keep **triage** (copying synthesis rows) separate from **vetting** (recounting directly against raw logs, `HEAD`, harnesses and checks). In a release cycle, backtrack `predictions-<run>.md` first (`held` | `falsified` | `unreached`, checking whether the PR's mechanism event fired per `AGENTS.md` §9).

| Column | Required value |
| --- | --- |
| `id` | `vet-<n>` |
| `finding` | one-line summary of what was checked |
| `lanes` | finding id (`lane3-misreading1`, or `3.1` before), lane number or `primary` (every lane finding covered) |
| `standing` | key from [references/standing-findings.md](references/standing-findings.md) or `new` |
| `owner` | owner from [references/lanes.md](references/lanes.md) |
| `importance` | `I0`–`I3` (`AGENTS.md` §11); required when `confirmed` |
| `verdict` | `confirmed` \| `plausible` \| `refuted` |
| `fate` | when `confirmed`: `repair` \| `carry` \| `operator` \| `none`, with reason |

## Custom counterfactual angles (on top of normal WRI)

When testing specific candidate improvements or open dilemmas on top of standard WRI, run ~3 independent read-only subagents (`gemini-4-neon` at `medium` effort, or `Model: "inherit"` where effort is not exposed) writing `<dir>/angles/<slug>.md`. Split along orthogonal axes tailored to the proposed changes (typically: scoring, sampling and decision rules; exam grounding, audit and objective; supply, harness economy and runtime waste), quantifying exact counterfactual dollars, wall-clock hours, and flipped decisions with denominators against primary logs, derived readers, and `promotion-tuner` replays. Keep every angle under `## Hard rules` (read-only, wall-safe, no quotes), separate observed spend from counterfactual bounds, and verify cited counts before using them in vetting or design dilemmas.

## Related skills

- Driving WRI2P2 cycles & landing fixes: [run-improvement-campaign](../run-improvement-campaign/SKILL.md), [stack-pr](../stack-pr/SKILL.md)
- External benchmark regression analysis & domain WRI extensions: [regression-evals-analyzer](../regression-evals-analyzer/SKILL.md)
- Deep comparison or external-bench diagnosis: [comparison-review](../comparison-review/SKILL.md), [compare-systems](../compare-systems/SKILL.md)
- Examiner difficulty calibration or harness inspection: [examiner-complexity](../examiner-complexity/SKILL.md), [harness-audit](../harness-audit/SKILL.md)
- Model-free path rehearsal & whole-codebase audit: [system-path-simulation](../system-path-simulation/SKILL.md), [system-audit](../system-audit/SKILL.md)
- External review handover or archiving: [oracle-handover](../oracle-handover/SKILL.md), [zip-run](../zip-run/SKILL.md)
