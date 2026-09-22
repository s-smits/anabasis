## Guidelines for this bundle (light)

**Choose light when** the question is about the loop, not the cases: what the Builder tried each
round, what the controller decided, what each battery scored, and what advice the next round
received. It is the bundle to hand to a reviewing model with a size cap, and the one to send
when "traces" or "reasoning" is the request. Aim: under 2 MB.

**Read in this order.**

1. `launch/launch.json` and `controller/opening.json`: prompt, source commit, backends and
   effort. Every later claim is about these bytes.
2. `controller/terminal.json`: how the run ended and its typed clause.
3. `epochs.json`, then `claims/` in `createdAt` order: one claim per measured battery with
   verified, unaccepted and non-result counts. Read scores only after separating those kinds.
4. `difficulty-decisions/` and `analysis/*-rebuild-advice.json`: the move chosen after each
   battery and the advice packet the next Builder session received.
5. `epochs/<epoch>/builder-prose.jsonl`: the Builder's reasoning per turn, in sequence;
   `builder-execution.json` beside it counts tool calls, failed calls and submits.
6. `versions/<version>/agent/` and `correctness-model/evaluator.ts`: what changed between
   versions. Compare `version.json` to see whether agent, tasks or evaluator bytes moved.

**What this bundle cannot answer.** Why one case failed (no per-case traces or verifier output),
whether the Judge agreed with the verifier (no Judge files), what the tasks or controls
contained (no `tasks.json` or `controls.json`), what the models were prompted with (no
observability stream). For those, ask for the medium or verbose bundle.

**Do not conclude from this bundle** that a harness improved because a score rose: check
`version.json` for which bytes changed and whether the task set is the same. `case-result.json`
gives the outcome kind per case and nothing about the cause.
