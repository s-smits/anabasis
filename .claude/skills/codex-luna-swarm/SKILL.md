---
name: codex-luna-swarm
description: Launch, start, monitor, and collect independent Codex subagents (gpt-5.6-luna at high, xhigh or max; gpt-5.6-sol for small review batches) for bounded parallel work, from Codex or from Claude Code, including requests supplied as a Markdown file of session prompts. This skill owns Codex subagent transport even when another investigation or review skill defines the questions. Use whenever the user asks for Luna or Sol agents, a swarm, many sessions, a concurrency test, a particular reasoning effort, a Codex subagent from Claude Code, or later collection of reports. Distinguish launch-only requests from requests to wait, collect, or synthesise. Route high and xhigh through the direct launcher; for 16 or more sessions, also invoke the direct launcher instead of native spawn_agent.
---

# Codex Luna Swarm

## Establish the author before judging a report

A failed session is missing work, never work done by something else. When two Luna lanes once
failed on exhausted credits, Claude `general-purpose` subagents wrote the reports and the session
called them "gpt-5.6-luna at max, both completed"; nothing in the reports themselves showed it.

So establish the author before the claims. `<scratchpad>/lane-*.log` records the launcher's outcome
either way, and `agent-*.meta.json` names a Claude subagent. Check an unattributed report's
load-bearing claims against source, and name the model that actually ran.

Exhaustion is an ordinary interruption: these lanes are typed non-results, not a harness defect.

Launch one independent Luna worker per bounded task. Keep orchestration in the main session and
keep preparation smaller than the work delegated to the sessions.

## Check required inputs first

Resolve every packet, attachment, and user-supplied path named in the current message before
browsing, installation, repository inspection, or session planning. If one is absent but the
repository and request still define the session count, authority, and output, continue without it and
build the scopes from the repository. Ask only when the missing material genuinely determines the
work. Do not search earlier tasks or substitute a similar file.

## Parse a supplied Markdown task file structurally

When the user supplies a Markdown file containing session prompts, treat that file as the
authoritative task source. Inspect its heading hierarchy before preparing sessions, then parse the
repeated task sections with `scripts/parse-markdown-tasks.mjs`. Do not copy headings by line range,
flatten Markdown into prose, or replace complete sections with summaries.

Use two passes:

1. Run `--inspect` and confirm the proposed task-heading level, section count, numbering, and any
   preamble. A normal layout is one H1 title followed by one H2 section per task, but select the
   repeated structural level actually used by the document.
2. Parse to JSON with the expected count. Preserve each complete task section, including its
   heading, nested headings, quotations, bullets, tables, code blocks, return shape, and terminal
   constraints. Remove only an inter-section horizontal rule; use `--keep-separators` if it is
   meaningful task content.

```sh
bun --no-env-file /absolute/path/to/codex-luna-swarm/scripts/parse-markdown-tasks.mjs \
  --input /absolute/prompts.md \
  --inspect

bun --no-env-file /absolute/path/to/codex-luna-swarm/scripts/parse-markdown-tasks.mjs \
  --input /absolute/prompts.md \
  --output /absolute/luna-tasks.json \
  --expected-count 20
```

The parser must report one unique lowercase underscore name and one digest for every task. Require
the parsed count to match the request, sequential IDs when the headings are numbered, valid JSON,
and exact equality between every emitted `task` value and its canonical parsed Markdown section.
Put genuinely shared instructions from before the first task heading in the common instruction
packet when useful; `--instructions-output` writes that preamble separately. Do not repeat it in
every session. If two heading levels remain plausible and would produce different session counts, ask
rather than guessing.

## Identify the requested stopping point

- **Launch, start, or spawn:** accept every session and return the launch evidence. Do not wait for
  reports unless the user also asks to wait, collect, review, or summarise.
- **Wait, collect, review, or summarise:** remain active through terminal, drain the reports, and
  return the requested synthesis.
- Treat the verb “launch” by itself as launch-only. Do not ask a clarifying question merely to add
  collection work.

When the repository, count, authority, and requested output are sufficient, make bounded scope
assumptions and proceed. Do not stop after presenting a plan, task list, or command unless the user
asked for a preview or approval. Prepare the tasks and start the sessions in the same turn.

Use precise states:

- `preparing` while resolving inputs, defining sessions, and checking transport;
- `launched` only after all native calls are accepted or the fallback emits
  `luna_sessions.started`;
- `collecting` only when the user requested report collection.

Do not say “launching” when only preparing a task file.

## Select effort and route

The operator's batch policy (2026-09-04) decides the model before these transport defaults:

| independent questions | model and effort | launch |
| --- | --- | --- |
| 2 to 5 | `gpt-5.6-sol` at `medium` | native `gpt-5.6-sol` sessions, or one companion call per session from Claude Code |
| 6 or more | `gpt-5.6-luna` at `xhigh` | all sessions in one batch; native `luna_worker` cannot represent `xhigh`, so use the direct launcher |

An explicit operator choice for the current batch replaces the table; recover it from
`notes/current-state.md` or the message. Do not expand two useful questions to six merely to
qualify for a Luna batch, and do not wait for earlier reports before starting the rest of a batch.
Already running sessions keep their recorded identity when the next batch's policy changes.

- Accept `high`, `xhigh`, and `max`. Use `max` when the user names Luna without an effort.
- Preserve an explicit effort exactly. Never upgrade `high` or `xhigh` to `max`.
- For explicit `high` or `xhigh`, use the direct launcher at any session count. Native
  `luna_worker` is fixed to `max` and cannot represent those requests.
- For `max` with 1-15 sessions from Codex, prefer native `luna_worker` agents.
- For 16 or more sessions, use the direct launcher with `--tasks-file`.
- The direct launcher has no session-count ceiling. Do not split one concurrency request into
  batches; the count follows the questions the evidence has not already settled.
- One launcher invocation has one effort. If the user requests mixed efforts, group sessions by
  effort and use one direct invocation per group.

When native Luna availability is uncertain, attempt one prepared session. If the active catalogue
rejects `luna_worker`, report that once and launch the complete set through the fallback. Do not try
the same rejected native call for every session and never substitute Terra or a coordinator.

## Launch from Claude Code

From Claude Code the parent session is the only Claude model in the chain: it calls the Codex
plugin's companion script itself and Codex is the subagent. Do not use the `codex:rescue` skill or
the `codex:codex-rescue` agent type; both add a Sonnet session whose single action is the same call.
At most two Claude subagents run at once (operator decision 2026-09-04); Codex sessions do not count
against that ceiling.

Batch policy when the operator names no model and effort (operator decision 2026-09-04):

| sessions | model | effort |
| --- | --- | --- |
| 1-5 | `gpt-5.6-sol` | `medium` |
| 6 or more | `gpt-5.6-luna` | `xhigh` |

Start every session of a batch together. `scripts/codex-sessions.mjs` applies the policy, writes
one prompt file per session and detaches one companion per task, so the Bash tool's 600 s timeout
(exit 144) cannot end them:

```sh
bun .claude/skills/codex-luna-swarm/scripts/codex-sessions.mjs launch \
  --tasks-file /private/tmp/<session>/tasks.json --out-dir /private/tmp/<session>/codex \
  --workdir /absolute/worktree [--model gpt-5.6-luna --effort xhigh] [--write] [--plan-only]
bun .claude/skills/codex-luna-swarm/scripts/codex-sessions.mjs status --out-dir /private/tmp/<session>/codex
bun .claude/skills/codex-luna-swarm/scripts/codex-sessions.mjs drain  --out-dir /private/tmp/<session>/codex
```

`tasks.json` is an array of `{ "name", "task", "model"?, "effort"?, "write"? }`; names match
`^[a-z][a-z0-9_]*$` and are unique, paths are absolute, and a used `--out-dir` is refused. Write
both files with the Write tool, never a heredoc. Wait on `<name>.exit.json` with the Monitor tool
or a Bash `until` loop, then `drain` prints each finished log once and a
`codex_sessions.drained` summary with `finished`, `failed`, `running` and `missing` counts; a
`missing` session (no exit record, pid gone) exits 2 and is missing work. Reports are research:
check every load-bearing finding against the source before acting on it.

A single short session may still use the companion directly with the Bash tool's
`run_in_background`, whose stdout returns as a task notification when the process exits:

```sh
bun ~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs \
  task --fresh --model gpt-5.6-sol --effort medium "<one complete task>"
```

Omit `--write` for a read-only session. Do not pass the companion's `--background` flag: it
detaches the job and returns only a job id that nothing reports back. `task` has no `--help`; any
text after the flags is sent to Codex as the prompt and spends a turn.
Use the marketplace path shown above; do not replace it with a versioned cache copy. For a
long single session, use a detached launcher that writes its report to an explicit path and
wait for its exit record. The remaining sections describe the native and direct Codex routes.

## Define bounded sessions

Read shared material once. Put the common revision, evidence rules, safety constraints, and output
shape in one instruction packet. A session row then needs only:

- a unique lowercase underscore name;
- one question or component to inspect and its limits;
- the principal path, entry point, or producer -> consumer flow where inspection starts;
- read-only or explicit write authority; and
- the required report or patch outcome.

When several sessions would repeat the same mechanical step, such as a census over `campaigns/`, a
replay or a digest, put it in the packet once as an exact command. Look for it first in the
`bun run` entries, the CLIs under `tools/` and the owning skill's `scripts/`, and write it only
when none of them has it. A helper written for a swarm has now been used twice, so keep it as
AGENTS.md's "Keep a script on its second use" describes.

For a broad request such as “investigate this repo”, inspect the top-level structure once and divide
the named count into independent components or risks. Do not invent a suspected defect for
every session and do not perform the investigation in the parent before launch. If the session count is
larger than the number of top-level components, split important components by lifecycle, authority,
failure mode, tests, and public contract instead of asking the user to choose a decomposition.

For a causal or defect investigation, also require the session to test at least three plausible
hypotheses when evidence suggests a mismatch, including an innocent or intentional explanation;
census the relevant callers and tests; and propose a correction only for a proved defect. Do not
force repository history, evidence, every package, or a hostile test into a session when its question
does not need them.

If repository instructions make Skills relevant, ask the session to select and read one to three.
Do not assign the same generic Skills to every session only to satisfy a count.

Make each brief exhaustive inside its owned angle, not expansive across the repository. A title,
line range, generic “review this”, or duplicate numbered prompt is too weak. Validate the task file
by JSON shape, exact count, unique names, distinct scopes, starting points, authority, and outcome.
Accept equivalent wording; do not build a phrase linter.

Default to read-only. A write session must own explicit paths or responsibility and must be told that
other agents may be editing the repository. When the user asks for fixes without assigning write
ownership, let sessions propose the smallest correction and have the main session verify and implement
confirmed fixes after collection. Do not use a coordinator and do not let sessions spawn more sessions.
Treat reports as research; verify any load-bearing finding in the main session.

## Use native Luna for max at 1-15 sessions

Call `spawn_agent` with:

- `agent_type: "luna_worker"`;
- a unique underscore `task_name`;
- `fork_turns: "none"` when the message contains the complete evidence packet; and
- the bounded assignment in `message`.

Do not pass `model` or `reasoning_effort`; the project custom agent owns `gpt-5.6-luna` and `max`.
Do not use this route for an explicit `high` or `xhigh` request.
After the first native session is accepted, submit the remaining prepared sessions without waiting for
that session to finish. For launch-only work, return the accepted task IDs and stop.

## Use the fallback launcher

Resolve `scripts/luna-sessions.mjs` relative to this `SKILL.md`. Do not read, copy, or reimplement it in
the main session. It starts one independent `codex exec` process per session, pins `gpt-5.6-luna`, the
selected `high`, `xhigh`, or `max` reasoning effort, and priority service, sends prompts over stdin
without a shell, and writes per-session evidence. Do not substitute a global or previously copied
launcher for this repo-scoped script.

Use the repository-pinned Bun release. Resolve its executable from the active worktree and pass
`--no-env-file`; do not select a second JavaScript runtime through a version manager. Do not run
upstream test suites before an ordinary launch.

For a read-only investigation, write a compact JSON task file:

```json
[
  {
    "name": "evidence",
    "task": "Own evidence identity from construction through its deciding consumer. Start at the evidence constructor and public projection. Report confirmed mismatches, innocent explanations, exact evidence, and the smallest proved correction."
  },
  {
    "name": "runtime",
    "task": "Own runtime failure classification through non-result typing and denominators. Start at process result handling and its evidence consumer. Report confirmed defects, competing explanations, and remaining uncertainty."
  }
]
```

For a launch-only request, add `--launch-only`:

```sh
bun .claude/skills/codex-luna-swarm/scripts/luna-sessions.mjs \
  --tasks-file /absolute/luna-tasks.json \
  --workdir /absolute/worktree \
  --instructions-file /absolute/shared-instructions.md \
  --output-dir /absolute/durable-scratch/luna-topic-date \
  --reasoning-effort xhigh \
  --max-active 12 \
  --start-interval-ms 1000 \
  --launch-only
```

Omit `--launch-only` when the user asked this task to collect reports. The first stdout event is
`luna_sessions.started`; only then report the output directory, exact count, model, reasoning effort,
service tier, runtime, active count, and pace as launched.

For collected reviews and audits, always choose a new caller-owned `--output-dir` under durable
task scratch or the evidence owner. The system temporary default is only for disposable rehearsals:
a long session is not recoverable from a path the host may clean before its report is drained.

Pass `--reasoning-effort high`, `--reasoning-effort xhigh`, or `--reasoning-effort max` to state the
launch condition. The flag defaults to `max` for old commands. An unsupported value is a launch
error, not a reason to choose another effort.

`--max-active N` queues excess work in the same launch. Sessions start one second apart by default;
`--start-interval-ms N` makes the pace explicit. After a typed HTTP 429 non-result, reduce the
active count or pace and retry only missing sessions after the current launcher settles.

The launcher needs access to active Codex state. If the parent shell is sandboxed, request access
once for the launcher command; individual read-only session sandboxes remain read-only.

Use `--count N` only for a genuine concurrency test or when the shared packet maps each rank to a
distinct assignment. Investigations normally use named task objects.

Use a manifest for write sessions or per-session worktrees:

```json
{
  "workdir": "/absolute/worktree",
  "instructionsFile": "/absolute/shared-instructions.md",
  "sessions": [
    { "name": "tests", "task": "Implement the named hostile test.", "sandbox": "workspace-write", "ownedPaths": ["test/"] }
  ]
}
```

A manifest contains one or more sessions. The top-level worktree and sandbox apply to every session
unless overridden; a `workspace-write` session requires non-empty `ownedPaths`.

## Collect only when requested

The launcher must outlive the turn that started it. A launcher started as an ordinary background
command dies with its parent and takes every `codex exec` child with it (2026-08-28: one launch
killed after about two minutes, all 24 children gone, no reports written). Start it detached with
`nohup <launcher> ... &` and record the pid. The repository's `.codex/config.toml` registers
the launcher's `--stop-hook` mode. Confirm that the current host loads that hook before relying
on it; check the launcher pid and its children before each drain.

Each completion prints one compact `luna_session.finished` event. Print every newly finished report
once with:

```sh
bun .claude/skills/codex-luna-swarm/scripts/luna-sessions.mjs --drain /absolute/outputDir
```

Call `--drain` again after `luna_sessions.completed`. Then read `summary.json`, require one result per
requested session, and report non-zero sessions as missing work. Keep transport warnings separate from
session failure; a WebSocket-to-HTTPS fallback may still complete successfully.

The start evidence proves requested configuration, not the model actually bound by a remote
session. When identity is load-bearing, verify the session records before making the claim. Return
exact completed and failed counts plus any operational non-results.
