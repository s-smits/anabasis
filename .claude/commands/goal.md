---
description: Continue one explicit objective from workspace evidence; report the requirements, current results and next step
---

With an argument, use it exactly as the objective. With none, resume the active goal from session
state. If session state has no active goal, ask for one explicit objective; do not infer it from a
plan, checkpoint or status file.

Read the workspace, branch, changes, recent commits, current plan or checkpoint, and the last
executed check. Turn the objective into required results and forbidden actions. Measure each result
against source, tests, run evidence, Git and PR state; uncertain evidence is missing.

Print exactly three things:

1. **The contract**, as written by the operator.
2. **The measured position**, with exact evidence and denominators.
3. **The next bounded step** that can be completed now.

Never report a requirement as met on prose alone. A green unit test proves its exercised boundary
only; a generated type, prompt, fixture, or source export is not integration; a started run is not
a completed workflow. Continue until every result has current evidence or one exact action needs
new authority.
