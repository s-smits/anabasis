---
name: bounded-investigation
description: "Use for 1-7 independent read-only sessions investigating one bounded Anabasis failure, diff, or design question before a fix. Defines non-leading prompts, evidence packets, symmetric fault hypotheses, self-falsification, source adjudication, and concise synthesis. Do not use for whole-run coverage at any session count; use whole-run-investigation instead."
---

# Bounded Investigation

Use an independent session to learn, never to approve. The main loop notices the problem, starts a
non-leading read-only session, continues its own work, and synthesises when the session returns.

## Routing

If the operator asks for a full-run review or wants coverage across an entire live or terminal
run, stop here and use `whole-run-investigation`, whatever session count they named. Coverage intent
decides, not the number: a full-run review belongs there at any session count, including four,
while seven sessions on one bounded question belong here. This skill is limited to 1-7 sessions
around one bounded question.

Sessions are Codex subagents under the operator's batch policy: two to five independent
questions run on `gpt-5.6-sol` at `medium`, six or more on `gpt-5.6-luna` at `xhigh`, launched
together. `codex-luna-swarm` owns the transport, including the direct companion call from Claude
Code. Use a Claude subagent only when the operator names one (`fable-low` for Fable), and never
more than two at once. A current user instruction naming another model takes precedence. Use more
than one session only when the questions are independent and worth the cost.

For the reviewer's own lens (read order, review dimensions, finding format and the
`ready-for-named-scope` / `not-ready` / `blocked-by-missing-evidence` verdict), read
[references/independent-reviewer.md](references/independent-reviewer.md). It replaces the former
`independent-harness-reviewer` skill.

## Scope and prompt

Give one question with repository, worktree, revision, source/diff/test/evidence paths, typed observed
facts, possible fault locations, read-only authority, and required evidence. Do not state the
desired answer or patch.

```text
Task: determine why <observed fact> occurs.
Artifacts: <exact paths and revision>.
Observed facts: <typed codes and counts only>.
Questions:
  1. Which owner can produce this?
  2. What evidence supports or refutes each candidate?
  3. What is the smallest discriminating test?
Constraints: read-only; cite paths; drop conclusions that fail your own verification.
Output: findings, confidence, open questions. No edits.
```

An attack session must drop attacks that fail its own checks.

## Useful lenses

Authority and identity; false green and false red gates; non-results; verifier and discrimination;
tool registration; isolation and recorded bundle binding; duplicate owners; record and size.
Run separate sessions only when they are independent and worth the cost.

## The three-session split for "why did no check catch this?"

When a defect reaches live measurement that a gate could in principle have refused, the useful
question is never only "fix this one". Three independent sessions answer it without overlapping, and
they are worth running together because each can refute the others' framing:

1. **Enforcement surface.** Map every call site that exercises the mechanism, and for each one
   record the provenance of the input it can pass and what happens on failure: refused before
   adoption, recorded as a typed non-result, or unhandled. Ask it to return a TRUE/FALSE verdict on
   one sharp claim about the input distribution, so the session cannot answer vaguely.
2. **Class survey.** Ask whether the instance belongs to a class: inventory the prose rules that
   constrain the same generated files, and mark each enforced-by `file:line` or UNENFORCED, plus
   the input distribution its enforcement uses. Rank the gaps by cost-to-discover — how far into a
   run the defect survives — rather than by how wrong they look.
3. **Historical recurrence.** Count the defect across recorded runs with the repo's own
   evidence readers, keeping runs and denominators separate, and check whether any prior review
   already reported it. A zero count is a real result, not a failed session: it says the defect is
   invisible inside the authored distribution.

The sessions carry the same evidence packet — observed recorded row, the producer's `file:line`, and any
existing check with its `file:line` — so a session that contradicts a stated fact is a detectable
finding that the parent can check.

Two failure modes to write out of the prompts. First, an enforcement session that is told "no check
exists" will confirm it; state what you actually verified and let the session refute you. In the
recorded 2026-08-14 case the check existed and the gap was its input distribution, so the framing
"no check" would have sent all three sessions to the wrong place. Second, name the repo's evidence
readers in the prompt or the session hand-derives every count.

## Session history

Session transcripts can show user corrections, scope changes, alternatives, and reversals. They are
context, not proof. Check every claim against source, tests, commits, or evidence. Recorded evidence
owns run facts; do not search session files for facts the evidence already records.

Search in order: repository/revision/date/slug/run/task boundary; metadata and user messages;
selected bodies; a timestamped window around the event. Exclude tool dumps, repeated system prompts,
pasted skills, and compaction summaries. Do not scan machine-wide traces by default.

Cite path, revision or session id, and approximate time. Redact secret-shaped values. Never modify a
trace or recorded evidence. Distinguish user messages from pasted repository instructions. Label each
conclusion `proven`, `likely`, or `unproven`.

## Adjudication

For each finding: reread source and evidence, reproduce where practical, classify as `confirmed`,
`refuted`, or `deferred with a trigger`, then name the owner before choosing a fix.

Session output is untrusted research. It cannot approve permission, acceptance, promotion, or a user
decision. Verify it against live bytes before a fix. A post-mortem needs transcript and generated
source evidence.

## Synthesis

```text
Question:
Artifacts and revision:
Confirmed findings:
Refuted findings:
Conflicts between sessions:
Owner:
Smallest discriminating next action:
Unproven:
```

The parent synthesises. Do not paste session reports into repository rules or commit prose
without adjudication. A watcher reports terminal facts and writes shared state only after synthesis.
