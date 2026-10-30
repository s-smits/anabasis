# 14. Terms and map

Read this when a term needs its one meaning, when you name a part in prose, or when you look for the
directory that owns a mechanism. It holds `AGENTS.md` section 14 in full: every fixed term, what a
sed is, and the map of the tree.

## Terms

| Term | Meaning |
| --- | --- |
| Campaign | Everything run for one query: one domain, one contract, one check program, one log |
| Project | What the operator files campaigns under (`--project`, section 6) |
| Contract | The one public document: the rules, each with an id, and the answer format |
| Check | A hidden program that tests one rule on one answer and returns pass or reject |
| Instrument | The field's own tool that computes the facts a check compares (rule 10) |
| Control answer | An answer with a known label, used to test a check; the do-nothing answer (the smallest the format allows) is one for every task |
| Held-out task | A task the Builder never sees; only held-out tasks are scored |
| Practice task | A task released to the Builder; once released it is never scored |
| Valid answer | An answer that passes every check, submitted within the limits |
| Known valid answer | A valid answer on record for a task, `task.feasible` included |
| Rejection | An answer at least one check rejects: a true fail when wrong, a check defect when right |
| Shape check | A task package has every part, and its rule ids belong to the contract |
| Room solves | Up to three fresh reference solves that measure whether a draft leaves room |
| Task admission | The decision on an Examiner draft: shape check, then room solves where available (`task.gate`) |
| Comparison admission | What code checks before a comparison may start (section 6) |
| Session admission | What code checks before a Builder session may start |
| Solve queue | Waiting for load, budget reserve or a slot before a solve starts |
| Finish notice | The Builder's once-only notice when it calls `finish` |
| CI gate | The repository checks `bun run gate` runs |
| A/A comparison | The reference against itself on halves of its solves mirrored in time |
| Starter comparison | The starter against the reference on new tasks (row `unread`) |
| Programs ablation | The starter with only one harness's installed programs, `programs-of:<digest>` |
| Answer probe | The Referee's rerun of checks on an answer whose fields it changes |
| Wall | The OS isolation that keeps protected files and seats apart |
| Wall test | The start-up test of the wall, run as a seat's command is run (`probeWall`) |
| Deadline | The time limit of a solve or session (recorded as `wallSeconds` and the like) |
| Objective gap | An answer's improvement over another by the contract's objective |
| Capacity | A login's or host's free resources |
| Improvement patience | Counted moves in a row without a gain (`stopRule`) |
| Supply patience | Readings in a row that supply no room or no task (`roomless`) |
| Awaiting task review | Tasks waiting for a person to decide whether they are infeasible |
| Prompt limit | How many solver prompts may be sent before a solve stops |
| Model turn limit | How many answered model turns a solve may use |
| Session turn limit | How many Builder turns a session may use |
| Hand label | A person's verdict on a rejection (`earned`, `check-defect`, `unclear`) or a pass (`sound`, `wrong`, `unclear`) |
| Built Harness | The directory the Builder edits, a harness for short (section 3); the Starter Built Harness is the first reference, and each later one a promotion named, built or imported (`import.ts`) |
| Solver | The model that answers a task, fixed by the setting, only ever inside a harness |
| System | One solver in one harness: a bare system has the starter, a built one a Builder's harness |
| Reference harness | The harness a new one is compared with: the starter until a step is promoted |
| Comparison | Both harnesses solve the same held-out tasks; each task is a win, a loss or a tie |
| Round | One Builder session followed by one comparison |
| Standalone comparison | One comparison of two kept harnesses, without a session |
| Harness snapshot | A frozen copy of `harness/`, recorded as `build.checkpoint` |
| Step | A comparison whose weighted task margins clear the one-sided paired sign-flip test at its level, with and without the bill |
| Setting | Who solves, under which limits, and which tasks are scored, recorded once (section 6) |
| Condition | Everything that could change a solve's result, as one record with an id (section 5) |
| Session | One bounded stretch of an agent's work; a Builder's ends with a frozen harness version |
| Trace | The record of a model seat: every model turn and tool call with its result |

To **sed** something is to copy it verbatim (code, names, constants, messages) with the upstream
path and commit cited, changing only what this repository forces (a lint rule, a primitive the tree
owns, a colliding name) and listing each change. Rewriting the idea, or adding the package as a
dependency, is no sed.

## Map

```text
src/meta/       the owners of every runtime surface (`tools/oxlint/HABITS.md`, 12.8)
src/kernel/     the log, tasks, conditions, traces, the verifier's contract, the comparison, the reports
src/wall/       the OS wall: Seatbelt, Bubblewrap, a seat's root, what each actor may read
src/agent/      one model session of any seat over pi's loop (session); the backends and compaction
src/tools/      the tools seats share, under the wall: the one launch of a command (command), pi's
                coding tools (coding), the answer file and `submit` (answer)
src/harness/    the Built Harness: the starter, a kept state opened for a solver (open, shim), programs
src/solver/     one solve: its prompt, and the solve from its condition to its ending (run)
src/builder/    a Builder session, its tools, prompt, notes and what it is told of the past
src/examiner/   an Examiner session, its prompt, and what it is told; the drafting session (draft);
                the walled home both have (shell)
src/referee/    the Referee, the answer probe, agreement with hand labels
src/campaign/   the round, the comparison's record, admission, the reading of a campaign (handover),
                the move table (decide, ground), the opening, the operator's words, harness letters
tools/c/        the check program: accept, carry, rejections, repaired
tools/d1b/      examine, draft
tools/d2/       the campaign's commands (section 6) and the host's solve queue (host)
tools/runs/     the registry of runs and its verbs, the receipt, logins, hosts
tools/wri/      the whole-run investigation's reader of one log
tools/oxlint/   the two lint plugins, the ledger, the whole-tree scans
tools/runtime/  the lint and test wrappers, the commit check, the gate, the pre-push hook, land,
                and the hook that names an area's account as a tool call enters it (moments)
tools/loc/      the size and unused-export policy
packages/ui/    the read-only page over a campaign's log: a loopback server over the folds above
                (src/server) and four panes (src/views); its design rules are in DESIGN.md
vendor/         pi-claude-bridge, copied
docs/           the plan, the transfer ledger, the account of v1, the helper prompts
studies/        measurements outside a campaign, one folder each (`studies/README.md`)
.claude/skills/ the procedures (sections 10 and 11); main/ is the skill scripts' parser (`--host`)
.ana/           campaign logs and kept harnesses; ignored, and never edited by hand
```
