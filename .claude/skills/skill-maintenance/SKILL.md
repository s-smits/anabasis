---
name: skill-maintenance
description: "Audit and consolidate the Anabasis skill set. Compare current source, observed skill use and callers; move useful guidance to an existing owner and retire redundant entry points. Preserve main-versus-stack differences, scripts, independent review coverage and resolving links."
---

# Skill maintenance

A skill earns its slot by changing what a session does. Measure use before deleting, keep the
knowledge when folding, and never let a rename leave a dead link.

## Measure actual reads, not mentions

Every session's skill listing repeats each name, so a plain string count says nothing. Scope
the census to this repository's sessions and a named window ending before the audit began.
Count observed read, Skill-tool and script calls separately, deduplicated per session:

- Codex rollouts under `~/.codex/sessions/<yyyy>/<mm>/<dd>/*.jsonl`: keep lines with
  `"type":"function_call"` or `"type":"custom_tool_call"`, then inspect actual read/shell
  arguments for `skills/<name>/(SKILL.md|references/|scripts/)`. Unwrap orchestration calls;
  a delegated prompt mentioning a command is not its execution.
- Claude sessions under `~/.claude/projects/<project>/*.jsonl`: match `"skill":"<name>"` (Skill
  tool) and `"file_path":"…skills/<name>/` (Read tool); one hit per session per skill.

Report the window, provider/session coverage and limitations beside counts. Two weeks is usual.
Exclude pasted listings and copied tool outputs; deduplicate inherited calls where identity permits.
A read request does not prove successful loading or good decisions. Missing archives, dynamic paths
and unobserved callers prevent a claim of zero use. Check automations, scripts, tests and other
skills independently; a script-bound skill may show no prose reads. Keep raw session content private.

## Classify each skill

| Finding | Action |
|---|---|
| describes a retired mechanism (check the source on the intended tree, not memory) | delete; move any still-true rule into the owning skill |
| no observed use | investigate its unique duty and rare opportunities; this alone does not justify removal |
| two skills answer the same trigger with the same authority | port the distinct guidance into the existing used owner; add a reference only for substantial optional detail |
| a recurring pattern lacks guidance | improve its current owner first; add a skill only for a distinct recurring task |
| a skill has scripts imported by `test/` | it is source: change it on the source delivery path, never as a text-only push |

Preserve useful decisions and safety boundaries, not obsolete wording, duplicated manuals or
arbitrary old quotas. Extend the survivor's trigger and name the former owner in its relevant
section. Update callers before removing the old directory; Git preserves the original body.
Keep assessment separate from authority to act: folding a stop procedure into a review never
authorises that review to kill or relaunch. Do not merge blinded pairs or retire review lanes
through entry-point cleanup; `wri-lane-maintenance` owns that evidence-sensitive question.

## Respect the two skill trees

Compare published main, the relevant published stack and the active checkout before choosing a
target. An older checkout can still advertise skills already consolidated on main; do not count
their retirement twice or restore them. Preserve dirty skills and never overwrite them to make
the catalogue agree. Before editing a skill on main, run:

```sh
git diff --stat origin/main <stack-head> -- .claude/skills/<name>
```

- Identical on both sides: edit or delete freely on main; the merge is clean.
- Changed on the stack: add new sections or new files rather than rewriting the changed lines,
  and leave the stack's vocabulary alone. Do not port the stack's rewrite to main; a document that
  describes source not yet on main stays with that source.
- Renamed on the stack: leave the main copy in place; a delete on main against a rename on the
  stack is a merge conflict.

## Deliver

Skill text goes to main through the surrounding-files workflow in `AGENTS.md`. Reuse the task's
clean owning tree when available; the Codex app owns creation of its managed worktrees.

Commit only the named files, fetch and rebase immediately before `git push origin HEAD:main`; a
concurrent skill maintainer may have pushed. The pre-push hook proves the diff is documentation-only.
A skill script or a test under `test/` needs a prepared worktree, its focused check and a normal
source push; when main's Bun pin is not the installed Bun, that source goes on a stacked PR whose
pin is.

Before pushing, run the owning skill-link check and inspect references in neighbours, scripts,
personal skills and automation prompts, including paused consumers. Update an automation through
its owning app tool, preserving status, schedule, target and scope. Historical reports stay
historical; do not rewrite their findings. Use recoverable removal under `AGENTS.md`.
Write one line per retired skill in the commit message, with the retained owner and why it suffices.
Report entry points and instructions removed separately from any unproved effect on model work.
