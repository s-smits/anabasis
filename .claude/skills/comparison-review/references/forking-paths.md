# How a review deceives itself

Post-hoc reviews can slice small samples many ways without stating a falsehood (garden of forking paths). Keep exploratory cuts disciplined:

## Recording & data reuse
- **Log every look before running it** (`after seeing` for unplanned cuts); report the denominator of cuts inspected ("1 of 14 cuts"). Keep ledgers append-only; list every pre-freeze score/cut/deliverable already seen.
- **Keep discovery separate from confirmation**: reserve the sealed half and unseal once against pre-registered predictions (note underpowered seals explicitly).
- **Track burned tasks cumulatively**: any task whose deliverable, trace or rubric was inspected closely (including by blind reviewers) is a regression check only, never fresh confirmation. Every fix clears the 8-question gate independently.

## Selection, causal & statistical pitfalls
- **Read wins and losses equally**: inspect all open-half tasks (or a deterministic hash sample), never extremes or losses alone. Freeze one primary measure; treat post-hoc subgroups on 8 tasks as anecdotes.
- **Prevent just-so stories**: list ≥3 rival explanations (including an innocent one and an instrument one) with falsifying counts. Link causes to exact trace/log events or mark unproved. Complete level 6 (grader visibility) before level 8 (per-task splits), classify turn types before comparing averages (level 9), and check symbol + callers before claiming absence (`AGENTS.md` §9).
- **Respect statistical discipline**: never claim "within noise" without an A/A spread; never treat mixed conditions as controlled (rule 5); omit p-values during discovery; adjust multiple tests (Holm or single primary); report sample size + MDE (`size.ts`) alongside `no-step`; size confirmations for half the observed effect (winner's curse); fix rollouts beforehand (rule 4); pair every rate with its denominator.
- **Avoid reviewer bias**: send blind reviewers pointers and open questions only (`report.md`), strip arm names to hashes, verify subagent counts at raw source (`AGENTS.md` §11), and report identical counts regardless of winner.

## Five low-cost sanity checks (run before proposing a fix)
1. **Mirror question**: would you still propose this if the outcome flipped?
2. **Label swap**: does an equally plausible story emerge if arm labels swap?
3. **Placebo tasks**: does the mechanism appear just as often on tied tasks?
4. **Leave-one-out**: does dropping one task flip the gap sign?
5. **Shared-miss**: weaknesses equal in both arms cannot explain the difference.

## Permissible conclusions
Allowed: which level failed, refuted factual claims, quantified gap shares, surviving/falsified explanations, recurring archived shapes (N of M). Forbidden until confirmed by a fresh comparison: claiming a fix will improve performance or that a causal mechanism is proved.
