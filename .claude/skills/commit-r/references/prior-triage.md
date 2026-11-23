# Empirical prior triage for Commit R

Mechanical oracles (`runs replay`, byte-identical diffs, `mutate.ts`) check preservation and test coverage. They cannot test whether a behavioural rewrite's assumptions match real campaign logs, whether seat prompts introduce hedging or saturation incentives, or whether an overhaul breaks a coupled neighbour outside the compartment.

Use this protocol for behavioural rewrites, acceptance/verifier/prompt overhauls, and redesigned behavioural test suites. Skip it for pure refolds whose observable outputs remain identical.

## Who runs it

Keep architectural synthesis, final decisions, and edits in the primary session on the strongest model. When subagent delegation is authorised by the operator or session config, launch **one persistent, strictly read-only triage subagent**:

| Host runtime | Subagent setup |
| --- | --- |
| Claude Code | Read-only `Agent` on `claude-opus-5-5`, `medium` effort |
| Antigravity / Gemini | Read-only `research` subagent on `gemini-4-neon`, `medium` effort (or `Model: "inherit"` when the harness exposes no separate effort parameter) |

When subagent delegation is disabled, execute the same three rounds inline in the primary session before locking the design.

**Standing guardrails (include in every brief):** strictly read-only (no file edits, no paid models or live campaigns, no `.env` access, and no `advisor` tool). Never quote raw hidden exam values or verbatim solver traces from logs; report structural patterns, exact `k/N` counts with denominators, and `file:symbol` citations only. Verify every cited count and symbol in the primary session before acting.

## Three-round persistent loop

Keep the **same** triage subagent alive across all rounds via follow-up messages (`send_message` or agent resume) so it retains its loaded log and diff context rather than cold-starting on every refinement.

### Round 1: Pre-design prior triage (before writing code or tests)

Launch in parallel with step 2 (oracle capture) or while an earlier commit's simulation runs:

1. **State 3 to 4 explicit initial priors**: your concrete assumptions about failure frequencies, missing invariants, seat reactions, or gate strictness. Explicitly invite the subagent to **challenge, refute, or redirect** them against `data/runs/` and current WRI syntheses.
2. **Ask for empirical prevalence**: for each assumed failure class, how often does it occur across archived logs (`k/N` campaigns, `m/M` events), and what real failure modes did the priors miss?
3. **Ask for behavioural backtrack**: under the intended change, how would real seats from archived runs respond? Check specifically for prompt contradictions, hedging incentives, hidden denominators, ceiling saturation, and overly strict seat gates that stall supply.
4. **Deviate freely**: treat initial priors as disposable. If primary-source counts show a prior is rare, low-leverage, or counterproductive, pivot to the evidence-backed terms before writing code or tests.

### Round 2: Live tuning & cross-boundary validation (during steps 4 to 7)

Once the first implementation or refinement is in place, continue the **same** subagent with `git diff <base>` and **3 to 5 closely coupled files outside the rewritten compartment** (for example: `src/campaign/decide.ts`, `src/campaign/admission.ts`, `src/kernel/condition.ts`, `src/referee/referee.ts`, `test/builder-led.test.ts`, picking the real neighbours of the edited owner).

Require a concrete verdict per adjacent file citing exact `file:line` interactions:
- `VALIDATED`: boundary holds cleanly with no change needed.
- `REQUIRES CO-TUNING`: works only with a named companion edit.
- `CONFLICT / REVISED`: breaks an invariant, assumption, or Rule 3 wall property; revise before moving on.

Feed any non-trivial refinement back to the same subagent for updated priors while tuning.

### Round 3: Final oracle & refinement sign-off (step 8)

Before squashing, send the final diff to the same subagent to confirm:
- every Round 1 and Round 2 finding is cleanly closed (no residual wording or contract drift);
- archive oracle diffs on `data/runs/` show zero unintended divergences;
- Rule 3 wall tests and targeted suites pass if any seat-visible surface moved.

## Multi-commit overhauls with per-commit simulation

When a larger overhaul decomposes cleanly into ordered commits (for example: grounded mechanism commits, a `commit-r` test rewrite, and an acceptance overhaul):
1. Complete and simulate each commit at the cheapest informative tier ([system-path-simulation](../../system-path-simulation/SKILL.md): archive replay, `--dry-run`, or rehearsal) before starting the next commit.
2. Launch Round 1 of the next commit's prior triage in parallel while the current commit's test and simulation suite runs so updated priors arrive before the next design step.

## Compact Round 1 brief template

```text
Strictly read-only prior-triage researcher (no file edits, no paid models/runs, no `.env`, no `advisor`).

Context:
- Worktree: <worktree path> (branch <branch>, base <sha>)
- Archive: data/runs/ (and relevant .ana/wri/*/synthesis.md)
- Compartment files: <paths>

Initial priors (challenge, refute, or redirect freely from primary-source logs):
1. <Prior 1 + exact question to count in data/runs/>
2. <Prior 2 + behavioural backtrack question on recent runs>
3. <Prior 3 + candidate invariants or failure classes>

Cross-boundary files to check for side effects:
- <3-5 adjacent files outside the compartment>
For each file return VALIDATED | REQUIRES CO-TUNING | CONFLICT / REVISED with `file:line`.

Requirements:
- Ground every claim in exact `k/N` counts with denominators and `file:symbol` citations.
- Never quote raw hidden exam values or verbatim solver traces.
- Stay ready for follow-up rounds while we build and tune.
```
