# The levels

Inspect levels 0 to 12 in strict order, recording one ledger row per level with its supporting count or noting why it could not be read. Each level rests on those beneath it: a score tally read before verifying arm identities is a tally of unknown policies. Levels 0 to 6 require no outcome scores and cover every task (including the sealed half); levels 7 to 11 inspect outcomes and remain restricted to the open half until unsealing. **Inside** identifies the authoritative fold for an internal campaign comparison; **outside** specifies what an external benchmark study must verify directly.

## 0. Who ran

Verify the exact harness digest executed by each arm from its own record against the kept harness store. Confirm from solve traces which model and reasoning effort answered every turn. Check for model fallbacks, truncated sessions, swapped labels, or stale directories carried over from an earlier batch. **Inside:** `condition.recorded`, `bun tools/runs/degradations.ts <name>`. **Outside:** each trace's model field and termination status, plus `export.json`.

## 1. Coverage

Determine what fraction of the benchmark ran (tasks, categories, and rollouts per task). Record how tasks were selected, by whom, whether before or after inspecting outcomes, and whether they reflect the campaign's domain. Tabulate attempts started, retried, and excluded. **Inside:** `draw <name>`, `reading <name>`, and the admission line. **Outside:** the study manifest and the full benchmark task list.

## 2. Conditions

Verify whether execution conditions differed across arms, citing direct evidence: execution timing and order (interleaved versus separated by days); Python interpreter, installed packages, and `PATH` tested inside each arm; executor, available tools, system prompt, and executor-injected wrappers; resource budgets and budget instructions shown to each arm; network access; host load; and the grader's model and document conversion pipeline. **Inside:** `conditions <name>`, `HOST LOADED`, `LOAD MOVED`. **Outside:** manual inspection of runtime logs and manifests.

## 3. What was carried

Verify byte-level identity first, then verify functional execution in the target runtime. Diff the exported guide and toolchain against the kept harness (an export targeting a different platform replaces its interpreter and compiled distributions at pinned versions, listed under `rebuilt` in `export.json`). Confirm that symlinks resolve, tools execute cleanly under the solver's working directory and `PATH`, note any files omitted by export (such as `agent/tools-spec.json`), and check whether the solver actually loaded the guide. **Inside:** the harness digest guarantees byte identity. **Outside:** inspect `studies/shared/claude-export.ts` and the exported directory tree.

## 4. What was told

Even an exact byte copy can deliver a guide that is false in a new runtime. Read the guide inside the solver's workspace and classify every factual claim (limits, interfaces, scoring rules, workflow steps, and tool expectations) as true, false, or inapplicable in that environment, noting any claims rewritten during export. Then check whether traces show a solver citing or acting on a false claim, keeping in mind that absent citations are inconclusive when chain-of-thought is unrecorded.

## 5. What it was selected on

Assess whether the capability that promoted the harness in its home campaign can even register on this benchmark. Identify which measure carried the promotion (`reading`, `replay`, `carriedBy`) and whether it was confirmed on fresh tasks, then compare what the campaign's checks rewarded against what the external grader rewards. Count refusals and limit hits ("Was it too strict?" in `SKILL.md`), and note the pre-existing structural asymmetries documented in `studies/harness2/README.md` ("Read every result against how uneven the comparison is").

## 6. What the grader could see

The grader's input often differs substantially from the raw deliverable. Reproduce the grader's exact document conversion locally without calling a model: inspect character truncation caps and how much content each arm lost past them, embedded images consuming token or character budgets, dropped figures or notebook outputs, section ordering, and which output file the grader selected. A criterion marked "not found" past a truncation cap is an instrument artefact; one absent from the full deliverable is a genuine miss. Report the local reproduction alongside the official score. **Inside:** the verifier inspects the complete answer and the Referee rules with probes (lanes 1, 2, and 4 to 6).

## 7. How the score is formed

Determine whether grading is binary all-or-nothing or partial credit. Inspect the score gap at every granularity (points, rubrics, and individual criteria), since a narrow gap in criteria can amplify into a wide gap in points, while keeping the pre-registered primary measure authoritative. Count rubrics missed by a single criterion, calculate the fraction of the total gap concentrated in one task or rubric, run leave-one-out checks to test whether the sign holds, and evaluate the paired test on per-task differences (`testOf`, `src/kernel/compare.ts`).

## 8. Each split, both directions

List every task or rubric on which the two arms disagreed, covering both wins and losses without filtering by magnitude. Classify every miss (blindly where possible) as **wrong** (refuted by the grader), **absent**, **unseen** (present in the deliverable but truncated before the grader saw it), or **disputed** (the grader's stated rationale does not hold). Tabulate shared misses separately, as they reflect task difficulty, grader quirks, or base-solver limits rather than harness differences. Test whether the preferred explanation accounts for wins as accurately as losses. **Inside:** the evaluation wall remains in force, so per-task inspection stays within investigation lanes and reports cite only ids and counts.

## 9. Behaviour

Compare turn counts, wall duration, and output tokens across arms, stratifying turns by activity type (substantive work, environment recovery, file reading, and polishing), because a shorter trajectory can reflect either genuine efficiency or the other arm spending turns repairing its environment. Record which tools and harness programs were invoked or failed, and how each rollout terminated. On small task sets, behavioural correlations are descriptive only.

On external benchmarks, `compare.ts levels` counts how many shell commands reference the exported harness's program directory or invoke one of its programs by name (matched against the arm's stored tree), separating active execution from read-only inspection. These counts measure references rather than total harness influence: even a harness whose programs are never invoked still shapes behaviour through its guide. **Inside:** inspect `solve.call`, solve lanes, `chain`, and `tasks`.

## 10. Noise

Quantify intra-harness rollout variance and state how it was measured, or mark it explicitly as unmeasured. A clean A/A control tests a single harness under identical conditions in the same period with interleaved rollouts; anything else is descriptive only. Keep rollout variance separate from grader variance (measured by regrading identical deliverables). Report the test's p-value beside the minimum detectable effect at this sample size (`bun .claude/skills/comparison-reading/scripts/size.ts`), and never claim a difference is "within the noise" without a measured noise floor. **Inside:** inspect the paired A/A (`noise`), `falseRate`, and `incapable`.

## 11. Economy

Place each arm's billed dollars and wall hours alongside its score on a single consistent meter (`billOf`), keeping grader spend separate, and note whether higher cost on one arm conceals savings elsewhere. State the pricing rate behind any estimate.

## 12. What this could not read

Conclude by listing everything unobserved: unrecorded reasoning traces, missing logs, unlogged runtime conditions, or unrun tasks. State explicitly when a level lacks evidence; absence of evidence never reads as a clean bill of health (`AGENTS.md` section 9).
