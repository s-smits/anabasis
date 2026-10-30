---
name: agentsmd-backtest
description: "Backtest a change to AGENTS.md, a skill or the moments hook on the sessions that ran under it: read the last day's Claude Code and Codex transcripts, compare rule breaches per 100 shell calls with the sessions under the earlier text, triage each miss to the owner that would have caught it, and revise AGENTS.md within a token budget. Use when the operator asks how a new AGENTS.md behaves, to backtrack or backtest it, which misses the rewrite caused, whether sessions read the owning skill, or to update AGENTS.md from recent sessions. Script: scripts/sessions.ts."
---

# Backtest AGENTS.md on recent sessions

A rewrite of AGENTS.md is a prediction: that sessions under the new text break no rule the old text
kept. This skill tests that prediction on the transcripts the change has produced since it landed,
by default the last 24 hours, and puts each miss where it belongs. It reads transcripts only. It
starts no run, and it changes AGENTS.md only where a confirmed miss is owned there.

The evidence is weak and the skill says so: a day holds about a dozen sessions, most of them short,
and each session is one draw of one model on one task. A rate on the current side is compared with
the earlier side's rate on the same pattern, and a difference carried by one session is read as that
session, not as the text.

## 1. Measure

```sh
bun .claude/skills/agentsmd-backtest/scripts/sessions.ts --hours 24 --root <claude config dir>...
bun .claude/skills/agentsmd-backtest/scripts/sessions.ts --hours 72 --root <dir>...  # baseline
bun .claude/skills/agentsmd-backtest/scripts/sessions.ts --prompts <session id prefix> --root <dir>...
```

Pass one `--root` for every Claude Code config directory this machine has (`~/.claude` alone by
default); the operator's machine file says which exist. Codex rollouts are read from
`~/.codex/sessions` without a flag. The script prints one line a session and one total each for
`current` and `earlier`:

- **Which AGENTS.md.** A Claude Code transcript does not hold the text it loaded, so the script
  takes the AGENTS.md at the worktree's HEAD when the session started, from that worktree's reflog.
  A Codex rollout holds the text. `current` means the text contains `--marker`, by default the first
  prose line of AGENTS.md at this tree's HEAD. Give a marker from the change under test when a
  later commit rewrote that line.
- **Rule hits per 100 shell calls**, by patterns for the rules a command shows: `git stash`, a bare
  `bun test`, Node or npm, a force push without a lease, a push without the hooks, a pull request
  opened without `--draft` or a label, an em dash in a commit or a pull request body or an edited
  file, a typed Bun release path, checks run here with `RUN_REMOTE=0`, a read of `.env`, `rm`
  instead of `/usr/bin/trash`, an edit under `.ana/`, `vendor/`, `data/runs/` or `node_modules`,
  and an edit to tracked files in the main checkout.
- **Areas and skills.** The areas come from the moments hook's own table (`momentsOf`,
  `tools/runtime/moments.ts`). An area is `read` where the session read its owning skill before its
  first call into the area, and `unread` otherwise. This is the rewrite's central promise, that a
  session reads the skill that holds the moved detail, measured directly.

## 2. Collect the candidates

A candidate is any of these, on the current side:

1. a hit whose rate is above the earlier side's;
2. an area entered `unread`;
3. an operator prompt that corrects the session. Read every prompt with `--prompts`, and mark the
   ones that say a thing was wrong, missing, slow or done twice ("wtf", "no", "I said", "again",
   "why did you", a repeated request).

Open each candidate in its transcript before triage. A pattern also matches text in a heredoc, a
`grep` for the pattern itself, or a read-only form (`git stash list`); a hit that is no breach is
dropped, and a pattern that keeps producing such hits is tightened in the script.

## 3. Triage each miss

Ask one question of each confirmed miss: would the earlier AGENTS.md have prevented it? Settle it
from the text, never from memory: `git show <commit before the change>:AGENTS.md` and search for
the rule, then search the current AGENTS.md and the skill it moved to.

| Finding | Owner | Fix |
| --- | --- | --- |
| The earlier text stated the rule in AGENTS.md and the current text dropped or weakened it | AGENTS.md | Restore the rule in the section that owns it, in one sentence |
| The rule moved to a skill, the session entered the area and never read the skill | the skill's `description`, or the moments route | Name the path, verb or question that should have loaded it; add or correct a route in `moments.ts` |
| The session read the skill and still missed | the skill's text | Rewrite the sentence it misread |
| The earlier side shows the same miss at a similar rate | not the rewrite | Name the real owner: the operator's machine file, a session memory note, a skill, the code |
| The miss is a model's judgement on an open question | nobody | Report it; no text change |

A miss whose cause is a stale memory note is fixed in the note, since a note outlives the rule it
paraphrased. A miss owned by the operator's machine file is reported to the operator with the
sentence to change; that file is theirs.

## 4. Revise AGENTS.md

Change AGENTS.md only for a finding that row one of the table owns. The operator may allow a
rewrite of a part or the whole; either way the change keeps to the token budget the operator set,
by default at most 10% more tokens than the current file. Count them before and after with the
tokenizer the last consolidation used, or, where none is at hand, as bytes divided by four, and say
which. A rewrite inside the budget is better than an appended sentence: a section that needed a
restored rule usually holds a sentence that no session needed.

Keep the invariants of the rewrite: AGENTS.md holds what every session needs, a skill holds its
mechanism, and each fact has one owner (rule 12). Machine names, logins and paths stay out of
tracked files.

## 5. Check and publish

- AGENTS.md and every changed skill: frontmatter parses, a `description` of at most 1,024
  characters, prose lines of at most 100 characters, no em dash, and section numbers that still
  match the four skills that follow them.
- The script: `bun run lint -- --strict`, `bun run typecheck` and `bun run format:check` on the
  change, and one run over the window that the report quotes.
- Publish through `stack-pr`: a pull request on the top of the cycle's stack, with the window, the
  counts on both sides and every finding with its verdict.

## Report

Lead with the answer: whether sessions under the current text missed anything the earlier text
would have caught, with the window and the session counts. Then:

1. the two totals, current and earlier, with shell calls and each hit per 100;
2. each candidate as `confirmed`, with the session id and time, or `refuted`, with why, and the
   owner and fix of each confirmed one;
3. what changed (AGENTS.md, a skill, a route, a memory note), with the token count before and
   after;
4. what the window could not test: areas no session entered, rules no command shows, and the
   sessions too short to count.
