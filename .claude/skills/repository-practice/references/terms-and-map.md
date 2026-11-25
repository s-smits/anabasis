# 14. Terms and map

Expands `AGENTS.md` §14 (held-out task, practice task, valid answer, reference harness, round).

## Terms

| Term | Meaning |
| --- | --- |
| Campaign | Full run for one domain query: domain, contract, check program, log |
| Contract / Check / Instrument | Public numbered rules & answer format / hidden rule checker / external pinned domain tool (rule 10) |
| Control / Known valid answer | Ground-truth validation answer (minimal valid answer is one per task) / any logged valid answer incl. `task.feasible` |
| Rejection / Task admission | Failed check(s): true fail vs check defect / host gate decision (`task.gate`) |
| A/A / Starter / Programs ablation | Reference vs itself (mirrored halves) / Starter vs reference on new tasks (`unread`) / Starter + candidate programs (`programs-of:<digest>`) |
| Answer probe / Wall & wall test | Referee check replay on perturbed answer / OS sandbox & startup `probeSandbox` |
| Deadline / Patience | Wall-clock limit (`wallSeconds`) / improvement (`stopRule`) & supply (`roomless`) patience |
| Hand label | Human verdict: rejection (`earned`/`check-defect`/`unclear`) or pass (`sound`/`wrong`/`unclear`) |
| Built Harness / Snapshot | Builder-edited directory (`harness/`); frozen copy logged as `build.checkpoint` |
| System | Three solver tiers (§3): `bareSolver` (raw `pi-durable` + coding tools, no guide/programs; external benchmark baseline), `baseStarter` (Starter, `src/harness/starter.ts`: + minimal `BUILT_AGENTS.md` template; + Builder-only `HARNESS.md` = Starter Pack), and `builtSolver` (Builder-evolved harness; internal promotions compare against both and must at least beat `baseStarter`) |
| Comparison / Step | Paired held-out evaluation (standalone = no Builder session) / score vector clearing one-sided sign-flip test |
| Setting / Condition / Trace | Fixed run parameters (§6) / content-addressed full solve parameters (§5) / logged seat turns & calls |

**Sed**: copy upstream source verbatim (preserving identifiers/messages), cite path & commit, change only what repo rules strictly require, and document every local edit.

## Map (subdirectories of `AGENTS.md` §14)

```text
src/meta/       runtime wrappers (HABITS.md 12.8)
src/tools/      command, coding (pi tools), answer (submit)
src/harness/    starter harness, open, shim
src/examiner/   draft, shell (walled Examiner home)
src/campaign/   handover, decide, ground, names
tools/c/        accept, rejections
tools/d1b/      examine, draft
tools/d2/       campaign commands, solve queue (host)
tools/runs/     registry, receipts, logins, hosts
tools/runtime/  test, lint, commit check, gate, pre-push, land, moments
packages/ui/    loopback fold server (src/server), four panes (src/views); DESIGN.md
studies/        standalone studies (studies/README.md)
.claude/skills/ procedures & scripts; main/ = shared library (cli, logs, runs, print, stats)
```
