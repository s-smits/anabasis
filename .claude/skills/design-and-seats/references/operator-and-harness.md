Read this for operator authority, launch authorisation and harness structure. This expands the
corresponding parts of `AGENTS.md` section 3.

## 3. The seats

### What waits for the operator

The seven decisions are listed in `AGENTS.md` section 3, with how to ask for one. Someone outside
the loop has to fix the exam, pay for it, and own what cannot be undone. The operator writes none of
the exam: freezing is `accept.ts --freeze` , admitting a check by name `--admit` , and promoting
`tools/d2/promote.ts --harness <digest> --yes` . Write "a person" only for a duty on that list; the
setting, the reference, the stop rule and the next move are code's (sections 4 to 7).

A launch authorises three decisions for that campaign: freeze a fault-free exam, promote the harness
selected by the rule, and admit checks computed by their author, including the declared objective.
This lets the campaign run unattended to a typed ending (`docs/plan.md` row F29). The owners are
`accept.ts --freeze --admit-authored` , `make` in `tools/d2/harness-builder.ts` and `planOf` in
`src/campaign/opening.ts` . `--hitl` hands all three back until `--no-hitl` , with checks admitted
by name. Freezing an exam with any other fault, and going past the stop rule, take the operator's
word each time (`--despite`, `--past-stop` ). The operator types nothing into a Builder session: the
host builds every message it reads.

### The harness

A harness is a directory where each part has one purpose (`HARNESS.md`, given to a Builder, shows
the shapes with a worked example):

| Part | Purpose |
| --- | --- |
| `agent/tools-spec.json` | Selects which of pi's coding tools the solver has |
| `.toolchain/` | The programs, which the solver runs by name from its shell |
| `agent/BUILT_AGENTS.md` | The guide, read once per task in the solver's system prompt |
| `agent/tools.ts` | The harness's own tools beside pi's, each call alone under the wall; program, tool or both is the Builder's choice, told what each costs a solve |

A harness is named by its digest (without `__pycache__` , `BYTECODE` , `src/harness/open.ts` ), so a
changed part makes a different harness, and solves under the old do not count for the new. The
**Starter Built Harness** is pi's coding agent as released, with no domain program and a few
revisable starter lines as its guide (`src/harness/starter.ts`), not named `AGENTS.md` because a
backend may load that itself. Every campaign starts from it: the first reference, and the fixed
lower reference after a promotion.

Every solve happens inside a harness: never write "with or without a harness". A better harness
shows as an answer reached within the solve's budget that the reference's is not, so the budget is
what lets it show: the more turns, the more of its programs the solver inside the starter works out
itself (section 7, "The budget").
