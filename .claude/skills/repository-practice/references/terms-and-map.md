# 14. Terms and map

Expands `AGENTS.md` §14 (held-out task, practice task, valid answer, reference harness, round).

## Terms

| Term | Meaning |
| --- | --- |
| Campaign | Full run for one domain query: domain, contract, check program, log |
| Contract / Check / Instrument | Public numbered rules & answer format / hidden rule checker / external pinned domain tool (rule 10) |
| Control / Known valid answer | Ground-truth validation answer (minimal valid answer is one per task) / any logged valid answer incl. `task.feasible` |
| Rejection / Task admission | Failed check(s): solver-fail (`earned`) vs check defect / host gate decision (`task.gate`) |
| A/A / Starter / Programs ablation | Reference harness vs itself (mirrored halves) / Starter vs reference harness on new tasks (`unread`) / Starter + candidate programs (`programs-of:<digest>`) |
| Answer probe / OS sandbox | Auditor check replay on perturbed answer (`src/audit/`; logs retain historical `referee.*` event kinds for archive compatibility) / OS sandbox (`src/sandbox/`) & startup `probeSandbox` |
| Deadline / Patience | Wall-clock timeout (`wallSeconds`) / improvement (`stopRule`) & supply (`roomless`) patience |
| Hand label | Human label: rejection (`earned` solver-fail / `check-defect` / `unclear`) or pass (`sound`/`wrong`/`unclear`) |
| Built Harness / Checkpoint | Builder-edited directory (`harness/`); frozen snapshot in `src/builder/store.ts` logged as `build.checkpoint` (`resolveCheckpoint`) |
| System | Three solver tiers (§3): `bareSolver` (raw `pi-durable` + coding tools, no guide/programs; external benchmark baseline), `baseStarter` (Starter, `src/harness/starter.ts`: + minimal `BUILT_AGENTS.md` template; + Builder-only `HARNESS.md` = Starter Pack), and `builtSolver` (Builder-evolved harness; internal promotions compare against both and must at least beat `baseStarter`) |
| Comparison / Significant (`step`) | Paired held-out evaluation (standalone = no Builder session) / score vector clearing one-sided sign-flip test (`isSignificant`) |
| Setting / Condition / Trace | Fixed run parameters (§6) / content-addressed full solve parameters (§5) / logged agent turns & calls |

**Sed**: copy upstream source verbatim (preserving identifiers/messages), cite path & commit, change only what repo rules strictly require, and document every local edit.

## Map (subdirectories of `AGENTS.md` §14)

```text
src/meta/       runtime wrappers (HABITS.md 12.8)
src/sandbox/    OS sandboxing (Seatbelt on macOS, Bubblewrap on Linux, sandbox-root)
src/agent/      agent session runner (`runAgent`, `AgentSpec`, `AgentRun`) and backends
src/audit/      Auditor (`auditor.ts`, `draft-audit.ts`, `judge.ts`, `agreement.ts`, `probe.ts`)
src/tools/      command (`runSandboxed`), coding (pi tools), answer (submit)
src/harness/    starter harness, open, shim
src/builder/    Builder session, tools, checkpoint `store.ts`
src/examiner/   draft, `difficulty.ts`, `record.ts` (`taskHistory`), shell (sandboxed Examiner home)
src/campaign/   `scheduler.ts` (`nextAction`), `state.ts`, `summary.ts`, `signal.ts`, `climb.ts`, names
tools/c/        accept, rejections
tools/d1b/      examine, draft
tools/d2/       campaign commands, solve queue (host)
tools/runs/     registry, `summary.ts`, receipts, logins, hosts
tools/runtime/  test, lint, commit check, gate, pre-push, land, moments
packages/ui/    loopback fold server (src/server), four panes (src/views); DESIGN.md
studies/        standalone studies (studies/README.md)
.claude/skills/ procedures & scripts; main/ = shared library (cli, logs, runs, print, stats)
```
