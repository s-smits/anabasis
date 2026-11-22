---
name: system-path-simulation
description: "Exercise an untested Anabasis execution path before a live campaign traverses it: read the record (a single reader fact, a full archive replay, or an in-memory synthetic log), rehearse (real commands on a seeded campaign with scripted seats), or seat a live model (an Examiner session or round from a seed, or paired seat rounds tuning a prompt or term against one primary count), each runnable before and after a change, and trace findings back to the owning module to fix, simplify, or rewrite. Use to test command joins, revisit a recorded state, size a comparison, verify kill or stop recovery, simulate an open stack before landing, or tune the Examiner's prompt or terms (cases/optimize.md). Not for post-hoc analysis of a finished run (whole-run-investigation) or launching a paid campaign (run-management)."
---

# System path simulation

Use this skill when a code path must work reliably in production and no live campaign has yet
exercised it: for example, when a change crosses a boundary between two commands, when sizing a
comparison round, or when investigating a suspected blocker. Choose the lowest-cost tier capable of
answering the question and stop there.

Because a campaign's entire state resides in its append-only log, a **seed** copies the log
truncated at a chosen event together with the checks or drafted exam, kept harnesses, Builder
notes, and Examiner home referenced up to that cut (`seedCampaign`, `tools/runs/seed.ts`). Any
recorded campaign state can thus be restored and executed forward. Keep the source campaign intact:
a rehearsal reads subsequent tasks from it (`draftedSource`).

## Three options

| option | what runs | cost | it answers | it cannot say |
| --- | --- | --- | --- | --- |
| **1. Read the record** | this tree's readers over recorded or synthetic events; writes nothing | seconds | how a fold, reader, or seat message interprets a given event pattern | what a command executes after the last event |
| **2. Rehearse** | the real commands, sandbox wall, verifier, and comparison on a seed, with scripted seats and no Referee | minutes, no model spend | whether commands join cleanly and what a position of a given size can measure | how a real model behaves |
| **3. Seat a model** | the real commands with a live model in one or more seats on a seed | dollars | what a real model does from a recorded position | a statistical rate: one seat is a single sample |

State which option you stopped at and why the next tier was unnecessary. Five case guides provide
detailed procedures: [synthetic](cases/synthetic.md) for option 1, [rehearsal](cases/rehearsal.md)
for option 2, [live-seat](cases/live-seat.md) for option 3, [before-after](cases/before-after.md)
for running any option across two commits or over an open stack before landing, and
[optimize](cases/optimize.md) for iterative paired rounds under option 3.

## Rules

1. **Pre-register intent and rival outcomes** in a file inside the cycle's or investigation's
   directory under `.ana/wri/`. Before executing anything, state what the change is intended to do
   and specify two or three plausible outcomes (expected shift, null effect, opposite shift, or a
   guard regression), each with its metric, threshold, and implied next step, then evaluate the
   result against all of them. A property guaranteed by construction (such as an added prompt
   sentence appearing or a deleted refusal disappearing) is a delivery check: report it as
   verification of what reached the seat, never as a confirmed prediction. An outcome outside the
   pre-registered set is itself a finding.
2. **Seed late, and only from a real run.** Cut immediately before the event of interest
   (`runs seed --points` lists candidate cuts) from a quiescent log, under the commit that produced
   the run unless the code itself is the experimental variable (`--as-ran`), and state in one
   sentence how the seed differs from the nearest real campaign state.
3. **Construct states exclusively with campaign commands.** Never hand-edit or append log lines,
   and never drop harnesses directly into `states/`. To reach a state no real run has visited, cut
   earlier and run the real command with different flags. Hand-constructed event sequences remain
   strictly in memory as synthetic logs.
4. **Write only to a seed.** `rehearse` and `live-seat.ts start` enforce the presence of
   `seed.json`; production commands do not, so prefix all seed names with `sim-<what>`.
5. **Vary one factor at a time.** Two rehearsals are comparable when only one flag differs; two
   commits are comparable only on identical inputs. A tuning series fixes its protocol before round
   one ([optimize](cases/optimize.md), step 5).
6. **Vary the state rather than the prompt**, unless the prompt itself is the variable under test.
   A live seat runs the production command with the production prompt; nothing informs the model of
   the hypothesis or arranges the state to make the desired behaviour artificially easy.
7. **Separate script defects from product defects.** When a rehearsal diverges, first verify
   whether the scripted seat supplied an invalid answer (such as stale accept controls reported by
   `tools/c/accept.ts`).
8. **State what did not run** wherever the result is summarised or cited.
9. **Codify cleared conditions in owning tests** under `test/` that fail without the fix. A
   command join is proved only by a test running the real writer against the real reader; two unit
   tests that each stub the opposite side prove only two isolated halves, and an untested join is
   itself a finding.
10. **Clean up seeds after use**: `/usr/bin/trash .ana/d2/sim-<what>` once the question is
    answered. `bun run runs retire` automatically deletes seeds idle for a day unless a paid
    `harness-builder.ts` launch left a receipt, in which case it archives the seed under
    `data/runs/` like a normal run (`unlaunchedSeed`, `tools/runs/receipt.ts`).

Readers and `runs seed --from <name>` resolve campaign names across `ANA_HOSTS`. Because a seat's
artefacts stay on its executing host, every script in this skill accepts `--host <name>` and runs
there at this tree's published commit (`.claude/skills/main/cli.ts`).

## 1. Read the record

Always use the repository's own readers rather than writing ad-hoc parsers. Most questions that
initially appear to require simulation are answered directly by an existing reader:

| the fact | command | writes |
| --- | --- | --- |
| The next move, and what would refuse it | `bun tools/d2/harness-builder.ts --name <name> --dry-run` | nothing |
| Whether a run is alive, and its last act | `bun run runs pulse <name>` | the pulse's state file |
| Supply, and the conditions comparisons ran under | `bun run runs view <name>` | nothing |
| Sessions, parents and readings | `bun tools/wri/wri.ts read --log <log>`, row F and `CHAIN` | nothing |
| Whether the checker stands on its controls | `bun tools/c/accept.ts <pack flags> --name <campaign>` | `checker.read`; run it on a seed |
| What the host still holds of a run | `bun run runs stop <name>` without `--yes` | nothing |

For facts no CLI command prints directly, call the kernel folds: `read` (`src/kernel/log.ts`),
`taskStates` and `taskSets` (`src/kernel/task.ts`), `poolOf` (`src/kernel/reports.ts`), `stopRule`
(`src/campaign/admission.ts`), and `conditionsOf` (`src/kernel/condition.ts`). The log records
every tool call, verdict, condition, and `task.proposed` payload in full, but not the rendered
prompt: reconstruct what a model saw from the codebase at its receipt commit.

`bun run runs replay [<name> ...]` checks whether the current tree still parses every recorded log.
It refreshes cached copies of remote campaigns, then folds remote logs, local worktree logs
(including seeds), and the local archive through the kernel readers, exiting 1 with the reader's
error on any refusal; an actively written log is read through its last complete line. Run `replay`
before committing any change to `EVENT_KINDS` or a fold field, after rebasing onto a moved stack,
and before seeding from an older campaign (since `seedCampaign` checks only `read` and `taskSets`).
To test how a reader handles an event pattern absent from recorded logs, see
[synthetic](cases/synthetic.md).

## 2. Rehearse

Run `bun run runs seed` followed by `bun run runs rehearse` on the resulting seed
([rehearsal](cases/rehearsal.md) documents the invocation forms and script interpretations). Every
seat runs a deterministic script on pi's faux provider, exercising the real command joins while
fixing seat behaviour. Rehearsals omit live models and API backends, practice solves, the Referee
(a scripted `fail` awaits `tools/d2/settle.ts`), wall-clock time pressure, and admission gates
(`admitComparison`, `admitSession`), and are identifiable by `seed.json`, `(a seed)` in pulse
output, and `faux/script` as the model. No mode combines a live Builder with scripted solves.

## 3. Seat a model

Seating a live model incurs API spend and therefore requires the operator's authorisation naming
the seats, model, effort level, and login, together with an upfront budget estimate specifying each
seat's dollar cap, wall-clock limit, and total spend. Launch every seat through
`scripts/live-seat.ts start` ([live-seat](cases/live-seat.md)).

| seat | seed cut | command | read by |
| --- | --- | --- | --- |
| An Examiner session | where it should start | `tools/d1b/examine.ts --session x-<n> --examiner <model> --examiner-effort <e> ...` | `live-seat.ts read`, `pairs` |
| A comparison's solves alone | right after a recorded `build.finished` (`--events`) | `tools/d2/checkpoint.ts --id g-<n> --new latest` | its report |
| A campaign stretch | before `build.started`, or at rest | `harness-builder.ts`, every seat's model named | the log's readers |

- **Pass the env file only as a path**: never open, print, or copy its contents.
- **Size the dollar cap from historical data**: multiply the empirical cost per admission (for an
  Examiner) or per solve (for a comparison round) at a similar campaign state by the target count,
  adding headroom so the seat does not hit its cap before reaching the measurement threshold.
- **Run paired arms concurrently on one host.** Launch both arms of a pair together on the host
  with the most free cores (`bun run runs hosts --health`) so they share identical host load, each
  assigned a login with sufficient session quota for the full seat (`bun run runs usage`), as a
  session limit aborts all in-flight solves. Distribute multiple pairs across hosts listed in
  `ANA_HOSTS`, one pair per host (`--host <name>`), starting with the least loaded host
  (`bun run runs loadwatch --once`), so pairs do not confound each other's load.
- **Treat a single seat as a single sample.** One seat verifies an execution path and cannot
  estimate a rate (`AGENTS.md`, rule 6); measuring whether an edit moves a metric is the scope of
  [optimize](cases/optimize.md). Results from seeds never feed back into production campaigns, and
  a seeded run never counts as a climb (`AGENTS.md`, section 10, item 9).

## 4. Trace findings to the owning abstraction

Before patching a blocking condition or unexpected outcome, ask three diagnostic questions. First,
is this one instance of a wider defect class? If so, fix the owning abstraction through which all
paths flow and delete site-specific patches ([simplify](../simplify/SKILL.md), shape H4). Second,
does the mechanism justify its existence with an owner, a live reader, a decision it alters, and
supporting evidence (`AGENTS.md`, rule 13)? If not, delete it instead of repairing it. Third, did
the simulation require special scaffolding (scripted answers, bypassed layers, multiple flags, or
retries), or has the same component appeared in two separate simulations? A path that resists clean
exercise or concise explanation usually signals an overbuilt component. Line-level removals go
through `simplify`, structural rewrites through [commit-r](../commit-r/SKILL.md), and subsystem
reviews through [system-audit](../system-audit/SKILL.md). Verify any resulting change with
[before-after](cases/before-after.md) on the same logs or seed, ensuring unintended readings remain
unchanged, and codify the condition in its owning test (rule 9). None of this substitutes for an
operator decision (`AGENTS.md`, section 3), repairs an exam rule, check, or task, or justifies a
change not measured by a comparison.

## The result

Report seven items:

1. the question investigated, and the option and case at which you stopped;
2. the seed, its source campaign, its cut point, and its one-sentence difference from the real
   state (or both commits for a before/after ablation);
3. the pre-registered intent, each rival outcome, and which outcome matched, keeping delivery
   checks separate;
4. what did not run;
5. each condition classified as `blocking`, `cleared`, or `accepted-risk` (naming who accepted it),
   with both its minimal fix and its deeper culprit plus one verdict (`fix the owner`, `remove`,
   `rewrite`, or `none`) and a verifiable one-sentence rationale (including for `none`);
6. for option 3, total dollars and minutes billed, counting every started seat as spent;
7. which seeds were trashed, or which were kept and why.
