---
name: system-audit
description: Hunt the biggest flaws in Anabasis v2 as a whole, with independent read-only sessions that each own one part of the system, read its owners, callers and tests at one pinned commit, and must prove each finding from counted events in recent real campaigns. Rounds repeat with the confirmed findings of the last assumed repaired, until nothing fundamental is demonstrated. Use when the operator asks for the biggest or fundamental flaws, an independent or general audit, what is wrong with the system, fresh eyes on the design, or another round "assuming those are fixed". One campaign's question is whole-run-investigation's, one diff's is code-review's, and the kept harnesses are harness-audit's.
---

# System audit

A system audit asks one question of the whole system, at one commit: what, if anything, most stops
it from improving harnesses truthfully and sustainably? Independent sessions each take one part,
read it from its source, and bring back at most a few findings, each proved from recent runs. The
primary vets every finding before anyone acts on one. It reads and proposes: an audit asked for on
its own stays read-only (`AGENTS.md`, the paragraph before section 1), and what follows from it
is the operator's call.

The procedure is the one three batches settled on:

- **16 October.** Five Claude teammates read the promotion path at one commit. Each wrote what
  the path does, then its flaws as F1, F2 and so on, citing only counts, ids and lines.
- **29 October, round 1.** Three gpt-6.1-sol sessions at high effort took measurement, the learning
  loop, and runtime and recovery. They returned four bounded issues: settlement corrections that
  three readers missed, rollback selection, stale drafts after a restart, and the provider-wait
  reader.
- **29 October, round 2.** Three sessions took accumulated capability, learning information and
  evaluation grounding, and assumed those four were repaired. One confirmed a target-coverage
  mismatch: an exam was accepted that left out the compilation the operator's prompt required. Two
  more stood as supported concerns: practice that refreshes only on success, and a promotion chain
  read as accumulated ability. No failed learning or false promotion was demonstrated
  (`.ana/wri/2026-10-29-fundamental-sol-audit-2/vetting.md`).

The rounds are what make it work. A session asked for flaws reports the nearest bounded bug, so
the next round names those as solved and asks again, until a round finds nothing fundamental.

## The procedure

Keep the audit's files in one folder, `<dir>`, at `.ana/wri/<date>-<subject>-audit-<round>/` of the
main checkout, beside the investigations.

1. **Pin the source.** Take the top of the open stack, published
   (`bun .claude/skills/stack-pr/scripts/stack.ts`), and give the sessions a worktree of their own
   at it (`git worktree add --detach ../anabasis-audit-<round> <commit>`). Never give them the main
   checkout, which `ana.follow` moves. Every source claim cites `git show <commit>:<path>` with
   one-based lines.
   *Check:* the commit is on `origin`, and the worktree has its dependencies, since the readers
   need them and the sessions install nothing.
2. **Fix the evidence.** Run `bun .claude/skills/system-audit/scripts/recent.ts --limit 16 --json >
   <dir>/recent-logs.json`, which lists the newest real campaigns once each, seeds, rehearsals and
   dead launches left out. For each one it gives the snapshot every report cites: the event count,
   the last event, the sha256 of the lines read and the commits its launches ran. The sessions read
   these paths and nothing that would refresh a remote copy.
   *Check:* the list spans more than one pack and more than one launch commit, or the brief says it
   does not.
3. **Write the brief.** Copy [the brief](references/brief.md) to `<dir>/shared-instructions.md`
   and fill in its marked fields: the operator's question in their words, the commit, the
   worktree, the inventory, the round, and, from round 2 on, the earlier rounds' confirmed findings
   as **assumed repaired**. Those are counterfactual. They are not claims that a fix is published,
   and they are not new findings. Each later round names the reports of the rounds before, to be
   read only so as not to repeat them.
   *Check:* no marked field is left, and the brief names no finding the primary expects.
4. **Choose the parts.** Choose one session a part, three by default, each owning paths and naming
   who owns the rest (the table below). Its task is one paragraph: what it owns, the end-to-end
   path to trace, the hypothesis to try in the runs, and the one sentence that keeps it off its
   neighbours' ground. Never hand a session a suspected flaw. It may test an earlier finding only
   where the brief lists that finding as a hypothesis with what would falsify it.
5. **Launch.** Write a [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) manifest,
   `<dir>/manifest.json`, with `"sandbox": "read-only"` and `"search": false`, and start it
   detached on the model the operator's rules name (`--model gpt-6.1-sol --reasoning-effort high`),
   output in `<dir>/gpt/`. Claude sessions get the same brief and task, all started in one message.
   *Check:* `gpt_sessions.started` in the log. Before reading a report, check the model and effort
   the session's transcript recorded.
6. **Vet.** Read every report, then write `<dir>/vetting.md` with one row a claim: what was
   rechecked here (the events recounted, the source read at the commit) and a verdict of
   **confirmed**, **plausible** (resting on one report) or **refuted**. Say what a confirmed claim
   does *not* establish, as round 2 did ("absence of later confirmation is not proof that a
   promotion is wrong"). Triage is not vetting. Recount every "N of M" a finding leans on.
7. **Report and carry forward.** Report to the operator:
   - the confirmed findings, ranked, each with its owner and the smallest change worth testing;
   - the plausible ones, each with what would settle it;
   - a list of what was checked and found sound.

   The confirmed findings become the next round's assumed repairs, if the operator wants another
   round. A fix is a change of its own, through stack-pr, on the operator's word. A finding that
   bears on a run's prediction goes to that cycle's ledger.

## The parts

Round 1 reads the parts as the code divides them. A later round reads the system's relation to its
goal, across the code:

| round | session | owns | others own |
| --- | --- | --- | --- |
| 1 | `measurement` | `src/kernel/compare.ts`, `src/campaign/comparison.ts`, `round.ts`, `climb.ts`, `src/referee/`, `src/kernel/verify.ts`, the wall's boundaries and their tests: task selection, verdicts, fresh evaluation and the promotion decision, end to end | agent strategy, operations |
| 1 | `learning_loop` | `src/builder/`, `src/examiner/`, `src/kernel/reports.ts`, `src/campaign/decide.ts`, the prompts and session continuation: drafting and admission, practice, task turnover, comparison feedback, continued harness work | scoring and verdicts, recovery |
| 1 | `runtime_recovery` | `src/agent/`, budget and load control, the log's writers and readers, the `tools/d2` lifecycle, `tools/runs` status, receipts and recovery: the largest loss of useful work or misleading state | learning strategy, measurement |
| 2+ | `accumulated_capability` | whether successive promotions persist on independent evidence, or can be explained by selection, a shifting exam or solve variation: `climb.ts`, readers, promotion records, kept lineage, compare-systems studies | |
| 2+ | `learning_information` | whether the loop receives and acts on enough informative evidence: Builder and Examiner prompts, practice exposure, admission and turnover, public feedback, the table's scheduling | |
| 2+ | `evaluation_grounding` | whether the target and its correctness evidence support the claims made from promotions: contracts, checks, verifier, Referee and admission evidence, calibration and review coverage | |

The operator may name other parts. A part is good when one session can read all its owners in one
context and its findings have one owner each.

## What makes a finding

The brief carries these rules. Vetting holds every finding to them:

- **Source before runs.** Read the owners, callers and tests, then write down what the logs should
  show if the suspicion is right, and only then search the runs.
- **Three explanations.** Test at least three explanations for each mismatch: the intended
  behaviour, sampling noise and the suspected defect. Look for the strongest counterexample.
- **Counted evidence.** A claim needs run names, event indices, counts with their denominators,
  and the snapshot it read. One reproducible logical contradiction can qualify, labelled with its
  scope.
- **The run's own code.** A run is evidence only about the commit its receipt names. An old run
  shows a newer mechanism nothing, and a failure a published change already addressed is history,
  not a current flaw.
- **Not a learning flaw.** Waits, an exhausted login and elapsed hours are rule 15's ordinary
  case, never evidence that learning is flawed. Compare useful work per active hour and per dollar.
- **Absence needs checking.** A claim that something is absent needs its owning symbol and its
  callers checked in the same session. A missing label is an evidence gap, not a demonstrated
  error.
- **A short ranked list.** At most three findings in round 1 and two in a later round, never
  padded to fill the count. Each says whether it is a correctness fault, an operational condition,
  an observability defect or a design trade-off. The rest go under "checked and found sound" and
  "runs read and left unread".
- **The walls.** Never quote a task, an answer, a hidden value, a check's text or a trace. Cite
  event kinds, indices, ids, counts and source lines. Keep machine names, logins and credential
  paths out. No session reads an env file, and no report reaches a seat.

## Where the detail lives

| file | owns |
| --- | --- |
| [references/brief.md](references/brief.md) | the shared instructions every session of a round carries |
| `scripts/recent.ts` | the inventory of recent real campaigns, each as a cited snapshot |
| [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) | the manifest, the detached launch, the drain and the retry |
| [whole-run-investigation](../whole-run-investigation/SKILL.md) | one campaign's question, with its lanes and synthesis |
