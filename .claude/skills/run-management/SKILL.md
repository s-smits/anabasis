---
name: run-management
description: "Start, continue, keep, pause, copy, move, monitor, and stop authorised Anabasis campaigns via `bun run runs`: launch named campaigns, resume from logs on another login or commit, keep runs alive across provider waits, pause cleanly, copy stopped runs between worktrees, migrate runs across hosts, inspect run status and login capacity, reach remote hosts, and terminate runs cleanly. Use when asked to manage campaign lifecycles, check login capacity or fleet status, verify move readiness, or diagnose move refusals. Owns host-level run lifecycle; `run-improvement-campaign` owns experimental decisions, and `whole-run-investigation` analyses run logs."
---

# Run management

Each campaign runs as one process writing one append-only log (`tools/d2/harness-builder.ts`; [campaign-mechanics](../campaign-mechanics/SKILL.md)) and is controlled via `bun run runs` (`tools/runs/cli.ts`, `registry.ts`). Run `bun run runs` for the verb list and `<verb> --help` for flags. Mutating verbs dry-run by default and require `--yes`.

Named verbs route automatically to the holding host (refusing if missing or duplicated). Read-only verbs refresh cached peer logs (`pulse` polls without copying). Archived runs live in `data/runs/<host>/<name>/`; lifecycle verbs refuse archived runs (`copy <name> --to <worktree>` first).

| Verb | Purpose | Owner |
| --- | --- | --- |
| `fresh <pack>... [--model opus\|sonnet\|gpt\|<p>/<id>] [--effort hhmm] [--login N] [--logins <list>] [--budget 800] [--as <sfx>] [--at <c>] [--host <h>] [--yes] [-- <flags>]` | Create detached worktree at published commit and launch | `fresh.ts` |
| `launch <name> [--login N] [--yes] -- <flags>` | Start new campaign in current worktree | `manage.ts` |
| `continue <name> [--at <c>] [--login N] [--budget N] [--after <ev>] [--yes] [-- <flags>]` | Resume stopped run from log (or drain at `--after`) | `manage.ts` |
| `pause <name> [--after <ev>] [--eval] [--yes]` | Stop at clean boundary (`--eval` then runs `runs bench --wait`) | `manage.ts` |
| `keep <name> [--logins <list>] [--wait-hours 0.25] [--yes]` | Rotate logins across provider waits and restart after crashes | `keep.ts` |
| `copy <name> --to <worktree> [--yes]` | Move stopped local run to another worktree (source → `.ana/moved/`) | `move.ts` |
| `move <name> --to <h> [--from <h>] [--login N] [--after <ev>] [--hold] [--yes] [-- <flags>]` | Pause, rsync and resume on another host at same commit | `move.ts` |
| `stop <name>... [--yes]` | Kill campaign process group + keeper and release scratch roots | `stop.ts` |
| `status [--all]`, `hosts [--all] [--health]`, `on <host> <verb...>` | Fleet summary, host health/load and remote verb execution | `pulse.ts`, `hosts.ts` |
| `usage [N...] [--json]`, `active` | 5h/weekly utilisation and active runs per login | `logins.ts` |
| `loadwatch [<sec>] [--once \| -s [-w 1m\|5m\|15m]]` | Host CPU load (`--once` sorts least loaded first) | `loadwatch.ts` |
| `pulse [<part>...] [--every 290] [--state <f>] [--no-readers]`, `alerts [--state <f>]` | Incremental event/reader deltas; one-line cron alerts | `pulse.ts`, `alerts.ts` |
| `view <name>`, `source <name> [--holds <c>]...` | State + `decide` recommendation; launch commits & ancestry | `view.ts`, `receipt.ts` |
| `bench [<run>] [--bench <n>] [--host <h>] [--store <d>] [--as <l>] [--harness <k>] [--login N] [--wait] [--yes]` | Export promoted reference and queue external benchmark read | `bench.ts` |
| `sync [--yes \| --check] [--force]`, `fetch [<name>] [--from <h>]`, `retire [--days 1] [--yes]` | Align `ANA_TOOLS`/`ANA_PYTHON`; sync peer logs/stores; clean/archive | `sync.ts`, `move.ts`, `retire.ts` |
| `search <pat> [--regex] [--ignore-case] [--here] [--in logs\|notes\|all] [--max <n>]` | Search runs, notes and docs across hosts | `search.ts` |
| `zip`, `replay`, `seed`, `rehearse` | Bundle ([zip-run](../zip-run/SKILL.md)), replay, seed & rehearse ([system-path-simulation](../system-path-simulation/SKILL.md)) | `zip.ts`, `replay.ts`, `seed.ts` |

## Start (`fresh` & `launch`)

```sh
bun --env-file=<file> run runs fresh <pack> [--model sonnet] [--login N] [--as <suffix>] [--host <host>] --yes
```

`fresh` reads `<pack>-prompt.txt` from `ANA_PROMPTS` (default `anabasis-prompts`), names `<pack>-fresh-<model>[-<suffix>]-<host>[-r<n>]` in `<pack>-fresh`, defaults to Opus (`--effort hhmm` Opus, `xxhh` Sonnet, `hhhh` else; `gpt` = `openai-codex/gpt-6.1-sol`), \$800 budget and 20-turn / 30-minute solve limits (`LIMITS`, `tools/d2/campaign.ts`), in detached worktree `anabasis-<name>` at `--at` (`HEAD`).

- **Placement**: check `runs loadwatch --once` before `fresh`, `continue` or `move`; pass `--host` if least-loaded under cap (`ANA_RUN_CAP` / `capacity`, default 2) differs from dry-run pick. Launch sequentially (dry runs do not reserve slots).
- **Env & logins**: pass `--env-file=<file>` (+ `--env-file=.env.runs` for `ANA_LOGINS`, `ANA_LOGIN_RUNS`, `ANA_LOGIN_SUBS`, `ANA_HOSTS`, `ANA_KEEP`); never print or copy env files. Without `--login`, picks an open login under `ANA_LOGIN_RUNS` resetting soonest.
- **Provenance**: after launch, run `git tag -f run/<first-9-sha> <commit> && git push origin run/<first-9-sha>`.
- **`launch`**: starts in current worktree; refuses duplicate names, active writers, dirty trees or unpublished commits.

## Continue, pause, keep, words & stop

- **`continue`**: reuses latest receipt flags/login (args after `--` replace stored flags; `--budget` raises cap). Refuses `--at` another commit while `openComparisons` is non-empty; measured runs stay at opening commit.
- **`pause`**: stops at clean boundary (`reported`, `promoted`, `examined`, `finished`, `compacted`, or `|`-joined; `reported` also awaits pending starter confirmation). Default `--after next` drains in-flight solves via a time-bounded `PAUSE` word. One waiter per run, launched under `nohup` from a detached worktree.
- **`keep`**: auto-attached when alternate logins exist (`ANA_KEEP=off` disables); rotates logins when waits exceed `--wait-hours`, restarts after crashes/`environment` (≤3 restarts without a turn), exits on terminal endings.
- **Operator words** (`tools/d2/word.ts --name <name>`): `--stop "<why>"`, `--budget N`, `--tasks "<why>"` (invisible to seats; `--promotions N|none` is a launch flag).
- **`sync` & `stop`**: `sync` refuses solver-visible updates on busy hosts without `--force`; prefer `pause` over `stop` (`stop` writes no `campaign.ended`).

## Related skills

- Experimental cycles, predictions & `runs bench`: [run-improvement-campaign](../run-improvement-campaign/SKILL.md)
- Pause, eviction & fork thresholds: [decision-points](../decision-points/SKILL.md)
- Campaign loop & admission rules: [campaign-mechanics](../campaign-mechanics/SKILL.md)
- Post-run log audits: [whole-run-investigation](../whole-run-investigation/SKILL.md)
