## Guidelines for this bundle (medium)

**Choose medium when** the question reaches into cases: why a case failed, what the Built
Harness did turn by turn, what the verifier and the Judge said, what the tasks and controls
actually contained, and which candidate the Builder previewed before submitting. It is the
bundle for a whole-run investigation lane or a defect hunt. Expect single-digit to low tens of
MB.

**Read in this order.** Start with the light order (launch, opening, terminal, claims,
decisions, advice, Builder reasoning), then:

1. `versions/<version>/runs/<runId>/battery.json`: the recorded rows for that battery; the
   per-case files below must agree with it.
2. `cases/<case>/case-result.json`, then `verifier.json`: outcome kind and the verifier's
   check-by-check verdict. `verifier.json` is protected material for the Builder; it is fine
   for the operator or a reviewer.
3. `cases/<case>/trace.json`: turns, tool calls, argument digests and result previews of the
   Built Harness. Previews are truncated; the full outputs were not recorded unless the verbose
   bundle carries transcripts.
4. `cases/<case>/public-task.json`, `final-submission.json`, `artifact.json`: what the solver
   was asked, what it submitted, what the verifier read.
5. `cases/<case>/judge.json` and `runs/<runId>/judge/`: the Judge's verdict, the census sample,
   bait corpus and standing. A Judge disagreement is a reason to inspect the verifier, never a
   score change.
6. `versions/<version>/correctness-model/`: `tasks.json` (public inputs plus hidden
   expectations), `controls.json` (task-bound accepts and rejects), `reference/`, evaluator
   tests. Read a check in `evaluator.ts` beside the control that isolates it.
7. `epochs/<epoch>/NN-<slug>/` and `trials/`: census, conformance, solvability and iteration
   receipts per previewed candidate; `builder-path-record.jsonl` lists every guarded file access
   the Builder made.

**What this bundle cannot answer.** What the models were prompted with in full (no
observability stream), how each verifier process was spawned and settled (no lifetime
receipts), what the Builder's workspace looked like beyond the accepted bytes, and any complete
tool output. Those are verbose.

**Do not conclude from this bundle** that a check is independent because it ran an installed
tool: `verifier.json` records digests and sources, and an interpreter running the Builder's own
algorithm remains authored computation.
