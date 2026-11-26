<img width="1800" height="400" alt="Anabasis" src="docs/assets/anabasis-logo.png" />

**I managed to automate myself.**

**Anabasis** builds an agent harness and its held-out evaluation suite from a single prompt for a hard-to-verify domain. It researches domain conventions, installs toolchains and checks, and promotes harness changes only when a controlled paired comparison on held-out tasks establishes a statistically significant gain.

## What it builds

Holding the solver model constant throughout isolates the causal effect of the harness from the model.

| Component | Contents |
| --- | --- |
| **Built Harness** | Content-addressed directory built on pi's coding agent (`agent/BUILT_AGENTS.md`, `agent/tools-spec.json`, `.toolchain/`) used by a fixed solver |
| **Exam** | Public contract (cited rules, answer format, optional scalar objective), hidden per-rule verification checks, and tasks with hidden parameters, all authored by a separate Examiner |
| **Run evidence** | Append-only JSONL log recording every solve trajectory, verifier verdict, Referee ruling, comparison specification, statistical reading, promotion and token cost |
| **Handover** | Standalone exported reference Harness alongside public rules and a closing report |

## How it works

```text
PROMPT → EXAM → TASKS → BUILD → SOLVE BOTH → JUDGE → PAIRWISE TEST → CLIMB or REBUILD or STOP
```

- **Examine**: The Examiner drafts public rules, answer format, checks, optional objective and control answers. Host code validates controls deterministically (replaying checks twice) and freezes the exam before any solve runs. The Examiner then authors tasks with hidden parameters; admission checks structure and rejects planted answers without solving at admission. At most half the held-out pool releases as unscored practice tasks.
- **Build**: Starting from the minimal Starter Pack (pi's coding agent as released), the Builder researches the domain, installs tools and iterates on practice tasks before freezing a candidate Harness. The wall is strict: the Builder never sees held-out tasks, check code or hidden parameters, receiving only aggregate tallies and readings.
- **Measure**: Candidate and reference solve the same held-out tasks afresh (2 rollouts/arm by default). An offline sandboxed Verifier executes checks, and a Referee adjudicates every reproducible rejection. Per-task scores weight validity at 0.6 and objective ties at 0.3; an exact one-sided paired sign-flip test registers a step at p ≤ 0.02 (e.g. 6–0 or 8–1 at equal margins). An A/A control (reference vs itself) runs beside every comparison.
- **Iterate**: A step promotes the candidate immediately. The next comparison checks the new reference against the starter (confirmed only when it beats the starter). Campaigns run unattended until one of seven terminal states (including budget, operator stop, or six eligible moves without gain).

*Note*: Drafted checks currently rely on the Examiner's own computation. Standard launches admit authored checks automatically; pass `--hitl` to require explicit operator approval for check admission, exam freeze and promotions.

## Results

<img alt="Performance on hard tasks: verified passes of the same 25 held-out hard tasks at cycles 1, 3, 5 and 7. Anabasis 6, 8, 11 and 12; Prime-agent 8, 9, 8 and 8." src="docs/assets/hard-tasks.svg" width="100%">

After 7 cycles on 25 held-out hard tasks (Claude Opus 5 medium, same verifier), **Anabasis** solves 12 vs 8 for **Prime-agent** (120 min vs 45 min/task due to CPU time in its domain solver; cycle 7 includes one re-solve using the submit time-remaining response). These figures are from v1 (`v0.4.0`); v2 has not yet replicated them. [docs/plan.md](docs/plan.md) tracks v2's current record (as of 7 November 2026: 151 promotions, 12 confirmed against starter, at most 1 confirmed per campaign vs a milestone bar of 6).

## Run it

Requires **Bun 1.4.5** on macOS or Linux (`bubblewrap` on Linux; on Ubuntu 24.04+, enable unprivileged userns via `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`). Run `bun run setup` (or `/setup-anabasis` in Claude Code) to check prerequisites, apply local setup (`bun run setup --apply`), and configure a Claude login interactively (`bun run setup --token`).

```sh
curl -fsSL https://bun.com/install | bash -s "bun-v1.4.5"
git clone https://github.com/s-smits/anabasis.git && cd anabasis
bun run setup --apply      # install deps, git hooks, .env template, and test the OS wall
bun run setup --token      # run in your terminal to save CLAUDE_CODE_OAUTH_TOKEN to .env

# Each run executes its tree's source in its own worktree:
git worktree add --detach ../anabasis-trusses && cd ../anabasis-trusses
bun install --frozen-lockfile

bun --env-file=../anabasis/.env tools/campaign/harness-builder.ts \
  --name trusses --project steel \
  --prompt "Design lightweight steel roof trusses to Eurocode 3 within strict mass limits." \
  --budget 400 \
  --solver claude/claude-opus-5-5 --builder claude/claude-opus-5-5 \
  --examiner claude/claude-opus-5-5 --reviewer claude/claude-opus-5-5
```

- **Budget & reserve**: `--budget` caps list-price USD spend (`bun .claude/skills/campaign-mechanics/scripts/bills.ts`); new solves launch only while remaining budget covers `--reserve` (\$3 default) plus in-flight solves.
- **Name, project & seats**: `--project` groups campaigns, `--name` identifies one (`--prompt-file` for longer prompts). Each seat independently targets Claude, Codex or OpenRouter with model and effort flags.
- **Defaults & dry runs**: 24 held-out tasks, 20 solve turns, 30 min/solve (`--target`, `--solves`, `--solve-model-turns`, `--solve-minutes`). `--dry-run` prints the next move without spending.
- **Resuming**: Re-run the identical command in the original checkout to resume from the append-only log without re-paying completed solves (cross-commit resumptions are refused).
- **Credentials & monitoring**: Pass credentials via `bun --env-file=<file>` or env (`.env.example` lists variables). Monitor with `bun run runs view <name>` or the read-only web UI (`bun run ui:deps && bun run ui:dev`). Multi-host settings live in `.env.runs.example`; `bun run runs` lists subcommands (`runs search` requires `rg`).

## Take the Harness along

Campaigns opened with `bun run runs fresh` export their reference Harness automatically to `data/harnesses/<name>/` (`harness/`, `RULES.md`, `REPORT.md`) on termination. Export manually or run isolated sandboxed solves against it:

```sh
bun tools/campaign/close.ts --name your-campaign --to data/harnesses/your-campaign
bun tools/campaign/close.ts --name your-campaign --to data/harnesses/your-campaign \
  --solve task-id[,task-id...] [--solver openai-codex/gpt-6.1-terra --solver-effort high]
```

- `--to` must be under `data/harnesses/` or outside the repo (`--harness <letter|digest>` picks another kept Harness; `.toolchain/` trees >100 MB deduplicate under `data/harnesses/.trees/`).
- Prefer released practice tasks for `--solve` sanity checks (output writes to `handover/log.jsonl`, excluded from campaign stats; single rollouts are diagnostic only). Handovers omit checks, hidden values and task names.
- For larger cross-system evaluations, use the `compare-systems` skill.

## Contributing

Read `AGENTS.md` before changing mechanisms, and run `bun run hooks:install`. Commit/push hooks verify formatting, lint and secrets (`ANA_PUSH_VERIFY=1 git push` adds `bun run gate -- --static`; `bun run land -- <top> --sanitize` validates every commit in a stack; `--merge`/`--whole` runs full `bun run gate`). Custom lint plugins (`anti-slop`, `ana`, `implicit-state`, `implicit-state-opinionated`) fail only under `bun run lint -- --strict` or `ANA_LINT_STRICT=1`. Optional `dcg` allowances live in `.dcg.toml`.

## Licence

MIT ([LICENSE](LICENSE)); upstream attributions in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
