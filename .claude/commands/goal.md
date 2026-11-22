---
description: Continue a single explicit objective grounded in workspace evidence; report the requirements, current measured state, and next bounded step
---

When an argument is provided, adopt it verbatim as the objective. Without an argument, resume the
active objective from session state. If session state holds no active objective, ask for an explicit
one rather than inferring it from a plan, checkpoint, or status file.

Inspect the workspace, current branch, working-tree changes, recent commits, active plan or
checkpoint, and the most recently executed check. Translate the objective into required outcomes and
forbidden actions. Evaluate each requirement against source code, tests, run evidence, Git state,
and pull request state; treat uncertain evidence as missing.

Print exactly three items:

1. **The contract**, as stated by the operator.
2. **The measured position**, with exact evidence and denominators.
3. **The next bounded step** that can be completed immediately.

Never mark a requirement as satisfied on the strength of prose alone. A passing unit test verifies
only its exercised boundary; a generated type, prompt, fixture, or source export does not establish
integration; a started run does not constitute a completed workflow. Continue until every
requirement has current evidence or a single specific action requires additional authority.
