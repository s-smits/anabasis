# 14. Terms and map

Read this reference for canonical repository terms, the definition of a sed, and the directory map
(`AGENTS.md` section 14 defines held-out task, practice task, valid answer, reference harness, and
round).

## Terms

| Term | Meaning |
| --- | --- |
| Campaign | The complete run for one domain query: one domain, contract, check program, and log |
| Contract | The single public specification document containing numbered rules and the answer format |
| Check | A hidden program that evaluates one rule on one submitted answer, returning pass or reject |
| Instrument | An external domain tool that computes the objective facts a check compares (rule 10) |
| Control answer | An answer with a known ground-truth label used to validate a check; the minimal syntactically valid answer serves as one for every task |
| Known valid answer | Any valid answer recorded in the log, including `task.feasible` |
| Rejection | An answer rejected by one or more checks: a true failure when wrong, or a check defect when valid |
| Task admission | The host gate's decision on a drafted task (`task.gate`); in older logs this also included headroom solves |
| A/A comparison | An evaluation of the reference harness against itself on time-mirrored halves of its own solves |
| Starter comparison | An evaluation of the starter baseline against the reference harness on new tasks (row `unread`) |
| Programs ablation | The starter harness augmented with only one candidate's programs (`programs-of:<digest>`) |
| Answer probe | The Referee's re-execution of checks on a perturbed copy of the submitted answer |
| Wall, wall test | OS-level isolation separating protected files from seats; its startup verification (`probeWall`) |
| Deadline | A wall-clock time limit (`wallSeconds` and related fields) |
| Improvement patience, supply patience | Consecutive eligible moves without a promotion (`stopRule`); consecutive readings supplying no headroom or tasks (`roomless`) |
| Prompt, model turn, session turn limit | Solver prompts sent; completed model turns; Builder session turn cap |
| Hand label | A human verdict on a rejection (`earned`, `check-defect`, `unclear`) or a pass (`sound`, `wrong`, `unclear`) |
| Built Harness | The directory edited by the Builder (a harness); every harness after the starter is promoted, built, or imported (`import.ts`) |
| System | One solver policy paired with one harness: the bareSolver (the Starter) or a builtSolver (a Builder's harness); the Starter Pack is what a campaign starts from (`AGENTS.md`, section 3) |
| Comparison, standalone comparison | A paired evaluation of two harnesses on the same held-out tasks; a standalone comparison runs without a Builder session |
| Harness snapshot | A frozen copy of `harness/` recorded as `build.checkpoint` |
| Step | A vector of per-task scores that clears the one-sided sign-flip test at the comparison's significance level |
| Setting, condition | Who solves under which limits on which tasks (section 6); the complete content-addressed record of everything that could affect a solve's outcome (section 5) |
| Trace | A seat's logged sequence of model turns and tool calls |

To **sed** is to copy upstream source verbatim (preserving code, identifiers, constants, and
messages), cite the upstream path and commit hash, alter only what this repository strictly requires
(a lint rule, an existing internal primitive, or a colliding name), and document every local edit.
A conceptual rewrite, manual port, merge, or package dependency is not a sed.

## Map

The top-level tree map in `AGENTS.md` section 14 lists each subsystem owner. Within those
directories:

```text
src/meta/       all runtime boundary wrappers (`tools/oxlint/HABITS.md`, 12.8)
src/tools/      command (single command launch), coding (pi's tools), answer (`submit`)
src/harness/    the starter harness and opening kept harnesses for a solver (open, shim)
src/examiner/   draft (drafting session), shell (walled Examiner home)
src/campaign/   handover (campaign reading), decide and ground (the move table), names
tools/c/        check program validation: accept, rejections
tools/d1b/      examine, draft
tools/d2/       campaign commands and the solve queue (host)
tools/runs/     run registry, launch receipts, logins, host management
tools/runtime/  test and lint wrappers, commit check, gate, pre-push, land, moments
packages/ui/    loopback server over log folds (src/server) and four UI panes (src/views); DESIGN.md
studies/        standalone empirical studies outside a campaign (`studies/README.md`)
.claude/skills/ operational procedures; main/ holds the shared script library: cli (arguments,
                `--host`), logs (campaign logs), runs (one row per run), print (tables), stats
                (permutation test between groups of runs)
```
