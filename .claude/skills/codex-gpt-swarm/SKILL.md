---
name: codex-gpt-swarm
description: "Launch and collect independent Codex sessions (gpt-6-luna at high, xhigh or max; gpt-6.1-sol at low to xhigh) for bounded parallel work, from Claude Code or Codex: one manifest, one detached launcher, one report a session, a drain while it runs, and a retry of incomplete sessions. Owns the Codex transport when another skill sets the questions, as whole-run-investigation does for its lanes. Use when the operator asks for Luna or Sol sessions, a swarm, many sessions, a reasoning effort, a Codex subagent from Claude Code, or a later collection of reports. Distinguish a request to launch from one to wait and collect."
---

# Codex GPT swarm

One independent Codex session per bounded task. The orchestration stays in the session that
launches, and the preparation stays smaller than the work it hands out. One script does the
transport:

```sh
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --manifest <json> --output-dir <new dir> [options]
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --drain <output dir>
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --retry <output dir> [--max-active N] [--start-interval-ms N]
```

The usage block at the head of `gpt-sessions.ts` lists every flag. The launcher reads no `.env`:
`bunfig.toml` sets `env = false`, so no login's key reaches it or the sessions it starts.

## The author before the report

A failed session is missing work, never work done by something else. When two Luna lanes of v1
failed on exhausted credits, Claude subagents wrote the reports and the session called them "Luna
at max, both completed"; nothing in the reports showed it. So read who ran before reading what was
claimed: `summary.json` holds each session's result, and a report with no result there is not a
Codex session's. Exhaustion is an ordinary interruption (`AGENTS.md`, rule 15): those sessions are
typed non-results, retried later, and never a defect of the work.

## Model, effort and count

The operator's batch policy of 4 September decides when the request names no model:

| independent questions | model and effort |
| --- | --- |
| 2 to 5 | `--model gpt-6.1-sol --reasoning-effort medium` |
| 6 or more | `--model gpt-6-luna --reasoning-effort xhigh`, all in one launch |

An explicit choice for this batch replaces the table. Keep an effort exactly as named and never
raise it; Luna named without an effort runs at `max`. One launch runs one model at one effort, so
mixed efforts are one launch a group. Do not split two useful questions into six to reach a Luna
batch, and do not wait for earlier reports before starting the rest of a batch: the count follows
the questions the evidence has not settled.

The table is the batch policy, not a count-based choice in the launcher. Pass its flags explicitly.
`MODELS` in `gpt-sessions.ts` accepts these values:

| model | accepted efforts | default effort |
| --- | --- | --- |
| `gpt-6-luna` | `high`, `xhigh`, `max` | `max` |
| `gpt-6.1-sol` | `low`, `medium`, `high`, `xhigh` | `medium` |

With neither flag the launcher uses `gpt-6-luna` at `max`, even for a small batch. Every launch
uses the `priority` service tier (`DEFAULT_MODEL`, `SERVICE_TIER`). From Claude Code at most two
Claude subagents run at once (the operator, 4 September); Codex sessions do not count against that.

## Where to stop

- **Launch, start, spawn**: start every session and return the start line. Do not wait for reports
  unless the request also says wait, collect, review or summarise.
- **Wait, collect, review, summarise**: stay until the launch completes, drain every report, and
  return the synthesis asked for.

Say `preparing` while writing the manifest, `launched` only once the launcher printed
`gpt_sessions.started`, and `collecting` only when collection was asked for. When the repository,
the count, the authority and the output are clear, make bounded assumptions and start in the same
turn; do not stop at a plan unless a preview was asked for.

## The sessions

Read shared material once and put it in the shared instructions: the commit, the evidence rules,
the limits and the report's form. A row then needs a unique lowercase name, one question and its
limits, where inspection starts, its authority, and the outcome it returns. A title, a line range
or "review this" is too weak; the same generic question numbered six times is one question.

- **A step every session would repeat** goes in the instructions once as an exact command. Look for
  it first in the `bun run` scripts, the commands under `tools/` (`bun tools/wri/wri.ts read --log
  <log>` reads a campaign) and the owning skill's `scripts/`.
- **A causal question** asks the session to test at least three hypotheses where the evidence shows
  a mismatch, an innocent or intended one among them, to count the callers and tests, and to propose
  a correction only for a defect it proved.
- **Read-only by default.** A write session owns named paths and is told others may be editing.
  Where fixes are asked for and nobody owns the paths, sessions propose and the launching session
  checks and makes the confirmed fixes. No coordinator, and no session starts another.
- **Keep reports within the seat's permitted view** (`AGENTS.md`, sections 1 and 3), and keep
  private details out of prompts and published text (section 10).

Reports are research. Check every finding you act on as `AGENTS.md`, section 11, says.

## The manifest

Write it as a file, using a file-writing tool rather than shell interpolation:

```json
{
  "workdir": "/absolute/worktree",
  "instructionsFile": "/absolute/shared-instructions.md",
  "sessions": [
    { "name": "readers", "task": "Own the readers of comparison.reported from the log to the view. Report each reader, what it reads, and any two that disagree." },
    { "name": "fixture", "task": "Write the hostile case named in the instructions.", "sandbox": "workspace-write", "ownedPaths": ["test/compare.test.ts"] }
  ]
}
```

Every session has Codex's live web search (`codex --search`) unless the manifest holds
`"search": false`, and the launch record keeps the choice for a retry. A query leaves the machine,
so a session that reads campaign logs, which hold hidden values, runs without it: the manifest of a
whole-run investigation's lanes says so itself. Tell a searching session to put only public
concepts in its queries, and to cite each claim from the web by its URL.

Each session receives the shared instructions (the file's, then `instructions`), its task, then a
line stating its authority. A row takes only `name`, `task`, `workdir`, `sandbox` and `ownedPaths`;
names match `^[a-z][a-z0-9_]{0,47}$`, tasks are distinct, and a `workspace-write` session declares
`ownedPaths`. Codex starts only inside a Git work tree unless told otherwise, and the launcher tells
it so for a read-only session and for one that owns its whole workdir.

## Launch

Start the whole batch in one detached launcher, so neither the Bash tool's 600-second limit nor the
end of the turn takes it down: a launcher started as an ordinary background command died with its
parent on 28 August and took all 24 sessions with it. The output directory must not exist yet, and
the log goes outside it:

```sh
nohup bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts \
  --manifest <scratch>/manifest.json --output-dir <scratch>/gpt \
  --model gpt-6.1-sol --reasoning-effort medium [--max-active 12] [--start-interval-ms 1000] \
  > <scratch>/gpt.log 2>&1 &
```

Put the output directory somewhere the host does not clean, in the session's scratchpad or beside
the evidence it serves, never under a campaign's folder. The first line of the log is
`gpt_sessions.started`; only then report the directory, the count, the model, the effort, the
service tier, the active count and the pace as launched. The launcher finds Codex by `--codex-bin`,
then the ChatGPT app's copy, then Homebrew's, then `codex` on the `PATH`. It needs Codex's own state;
request shell access only if the sandbox refuses the authorised launch. Each read-only session
stays read-only.

## Watch, drain, retry

Read the launcher's log: one `gpt_session.finished` line a session, then
`gpt_sessions.completed`. Drain while it runs, not only at the end: `--drain <output dir>` prints
what `reports.md` gained since the last drain, and sixty lanes of one v1 batch sat unread on
29 September because nothing drained them. `reports.md` gains each report as its session settles,
so it holds every settled report even if the launcher dies.

After `gpt_sessions.completed`, drain once more and read `summary.json`: one result for each
session asked for. A session that did not complete is missing work, and its result says why
(`failureKind`: `spawn`, `rate-limit`, or `null` when unclassified). A transport warning in stderr is not a
failure: a fall-back from WebSocket to HTTPS may still complete. The start line proves the
configuration asked for, not the model a remote session bound; where identity carries a claim,
read the session's own event log before making it.

Codex retries a request inside a session. A session completes only when its last attempt exits 0
and writes a report (`settle`, `gpt-receipts.ts`). An incomplete session gets one further attempt
by default (`--retries`, 0 to 5): `codex exec resume` of its thread where Codex named one, a fresh
start otherwise. After rate-limited sessions, let the launch settle, then run
again only what is missing, under the recorded model, effort and prompts:

```sh
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --retry <output dir> --max-active 4 --start-interval-ms 5000
```

A retry leaves `launch.json` and every completed result as they were, appends the rerun reports to
`reports.md`, and refuses while that directory's launcher still runs.

## Lanes of a whole-run investigation

[whole-run-investigation](../whole-run-investigation/SKILL.md) step 3 writes the manifest,
`<dir>/launch.json`: one `workspace-write` session a lane built, owning the report it writes, in the
checkout the investigation reads. Launch it as it stands. A lane that runs alone (5 and 19) is
built, and launched, on its own after the reports it waits on. Then `wri.ts collect` reads the
reports as from any seat.
