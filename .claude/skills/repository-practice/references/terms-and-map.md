# 14. Terms and map

Read this for the fixed terms, the meaning of a sed and the directory map (`AGENTS.md` section 14,
which defines held-out task, practice task, valid answer, reference harness and round).

## Terms

| Term | Meaning |
| --- | --- |
| Campaign | Everything run for one query: one domain, contract, check program and log |
| Contract | The one public document: the rules with ids and the answer format |
| Check | A hidden program that tests one rule on one answer: pass or reject |
| Instrument | The field's own tool that computes the facts a check compares (rule 10) |
| Control answer | An answer with a known label that tests a check; the smallest answer the format allows is one for every task |
| Known valid answer | A valid answer on record, `task.feasible` included |
| Rejection | An answer some check rejects: a true fail when wrong, a check defect when right |
| Task admission | The gate's decision on a draft (`task.gate`); in an older log it included room solves |
| A/A comparison | The reference against itself on halves of its solves mirrored in time |
| Starter comparison | The starter against the reference on new tasks (row `unread`) |
| Programs ablation | The starter with one harness's programs only, `programs-of:<digest>` |
| Answer probe | The Referee's rerun of checks on an answer whose fields it changed |
| Wall, wall test | The OS isolation between protected files and seats; its start-up test (`probeWall`) |
| Deadline | A time limit (`wallSeconds` and the like) |
| Improvement patience, supply patience | Moves without a gain (`stopRule`); readings that supply no room or task (`roomless`) |
| Prompt, model turn, session turn limit | Solver prompts sent; answered model turns; Builder turns |
| Hand label | A person's verdict on a rejection (`earned`, `check-defect`, `unclear`) or a pass (`sound`, `wrong`, `unclear`) |
| Built Harness | The directory the Builder edits (a harness); each after the starter is promoted, built or imported (`import.ts`) |
| System | One solver in one harness: bare with the starter, built with a Builder's harness |
| Comparison, standalone comparison | Both harnesses on the same held-out tasks; one without a Builder session |
| Harness snapshot | A frozen copy of `harness/` (`build.checkpoint`) |
| Step | Task scores that clear the sign-flip test at the comparison's level |
| Setting, condition | Who solves under which limits on which tasks (section 6); everything that could change a solve's result, as one record (section 5) |
| Trace | A seat's record of every turn and call |

To **sed** is to copy upstream verbatim (code, names, constants, messages), cite its path and
commit, change only what this repository forces (a lint rule, a primitive the tree owns, a colliding
name) and list each change. A rewrite of the idea, a hand port, a merge or a package dependency is
no sed.

## Map

The tree map in `AGENTS.md` section 14 names each owner. Within it:

```text
src/meta/       every runtime surface (`tools/oxlint/HABITS.md`, 12.8)
src/tools/      command (the one launch of a command), coding (pi's tools), answer (`submit`)
src/harness/    the starter, a kept state opened for a solver (open, shim)
src/examiner/   draft (the drafting session), shell (the walled home)
src/campaign/   handover (a campaign's reading), decide and ground (the move table), names
tools/c/        the check program: accept, rejections
tools/d1b/      examine, draft
tools/d2/       the campaign's commands and the solve queue (host)
tools/runs/     the run registry, receipts, logins, hosts
tools/runtime/  test and lint wrappers, the commit check, gate, pre-push, land, moments
packages/ui/    a loopback server over the folds (src/server) and four panes (src/views); DESIGN.md
studies/        measurements outside a campaign (`studies/README.md`)
.claude/skills/ the procedures; main/ is the scripts' shared library: cli (arguments, `--host`),
                logs (campaign logs), runs (one row a run), print (tables), stats (the
                permutation test between groups of runs)
```
