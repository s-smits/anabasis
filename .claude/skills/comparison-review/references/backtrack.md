# From a finding back to the system

Only domain-general mechanisms may enter the system. Strip benchmark specifics into a **shape card**, trace to the first domain-general owner, and pass the 8-question gate.

## Shape card & causal chain

```text
Shape:           mechanism in AGENTS.md §14 terms (no benchmark, task, rubric, arm or score)
Where:           suspected owner path, or "unknown"
Observable:      system record event/field/count when it recurs
Would look like: concrete instance in any domain
```

Trace backwards (deliverable → trace → solver prompt/tools → export → Builder signal → exam) to the first evidenced domain-general owner:

| Chain stops at | Owner | Action |
| --- | --- | --- |
| Grader view | external benchmark | none (instrument fact) |
| Export / carrying | `studies/shared/`, study | fix exported guide/tool accuracy |
| Conditions | host or study arm | equalise or document confound |
| Harness content | Builder | never hand-edit (`AGENTS.md` §2) |
| Builder visibility | `src/builder/`, §1 list | expose public fact within rule 3 |
| Reward signal | `src/kernel/compare.ts`, operator | operator decision after `promotion-tuner` replay |
| Exam scope/difficulty | `src/examiner/`, `examiner-complexity` | revise ladder, prompts or query |
| Solver conditions | operator (§3) | operator decision |
| Base model capability | nobody | report as model limit |

## Recurrence & 8-question gate

A fresh blinded session counts each shape across archived campaigns/domains/harnesses (`runs replay`, `table.ts`, `harness-versions.ts`, `grades.ts`, `runs source --has`; multiple runs on one pack = 1 context). Advance only if all 8 pass:
1. Stated without referencing the comparison?
2. **Mirror test**: still proposed if the outcome flipped?
3. Recurs across ≥2 independent contexts (exempt for clear implementation defects)?
4. Zero external benchmark vocabulary/rubrics/shapes in the fix?
5. Upholds `AGENTS.md` §2 (facts not directives/targets; Builder unconstrained; Starter domain-free)?
6. Satisfies rule 13 (simplify/rewrite owner before adding machinery)?
7. Names the `AGENTS.md` §1 trade-off moved and warning sign to watch?
8. Falsifiable on internal metrics via one pre-registered count before re-touching the external benchmark?

## Dispositions & examples

Classify each card as **Defect**, **Instrument fact**, **Limit of the claim**, **Lead** (`predictions-<run>.md`), **Domain choice** (operator), or **Dropped** (citing failed gate #):
- *"Guide stated 20 turns / 30 min outside campaign"* → Defect (`studies/shared/pi-solve.ts` / `portableGuide`).
- *"7 dangling symlinks in moved export"* → Defect in export.
- *"Tool assumed build-workspace path"* → Lead (counted across saved checkpoints).
- *"200k char cap / 7-criteria rubric"* → Instrument fact / claim limit.
- *"Built arm wrote less on unrewarded fields"* → `"Write more"` dropped by Q2; selection question = Lead.
- *"4/8 ties with pilot Starter"* → Dropped.
