---
name: system-audit
description: Rethink Anabasis v2 as a whole with independent read-only sessions. Each takes one part and one lens. Flaws must be proved from counted events in recent real campaigns. Rethink sketches the part from its goal before reading the code, then diffs the two. Delete names what no record or reader needs. Robustness tries the hostile cases. Every report also lists what does not make sense. A challenge session tries to refute the claims, the primary vets them, and confirmed findings become the next round's assumed repairs; on the operator's word they are applied through stack-pr, commit-r and simplify. Use when the operator asks for the biggest or fundamental flaws, an independent or general audit, fresh eyes, a rethink or redesign, what to delete, how to make the system more robust, or another round "assuming those are fixed". One campaign's question is whole-run-investigation's, one diff's is code-review's, the kept harnesses are harness-audit's.
---

# System audit

A system audit asks one question of the whole system at one commit: what, given the goal of
`AGENTS.md` section 1, should be different? Independent sessions each take one part through one
lens, read it from its source and its runs, and bring back flaws, proposals and a plain list of
what does not make sense. A challenge session tries to refute them, and the primary vets every
claim before anyone acts on one.

**What is open.** Everything is open except the measurement's honesty: the wall and rules 3 to 8,
which a proposal may change only with proof that they still hold. Every other mechanism, prompt,
default, move-table row, tool, reader and skill may be questioned, merged or deleted. That includes
`AGENTS.md`'s own text and the rest of its rules, as a row for the operator. A mechanism exists only
while its map holds (rule 13: `owner → live reader → decision it changes → evidence → hostile test`).
A head comment's dated incident is a lesson to keep or retire with a reason, never a reason by
itself.

**What it is not.** An audit asked for on its own stays read-only (`AGENTS.md`, the paragraph
before section 1). It proposes, and step 9 applies only on the operator's word. Its proposals stand
at "Planned" (section 9): no audit shows that a change improves anything, which only a fresh run
can.

## The record

- **16 October.** Five Claude teammates read the promotion path at one commit, each writing what
  the path does and then its flaws, citing counts, ids and lines.
- **29 October, round 1.** Three gpt-6.1-sol sessions at high effort, one each for measurement,
  the learning loop, and runtime and recovery, returned four bounded issues:
  - settlement corrections that three readers missed;
  - rollback selection;
  - stale drafts after a restart;
  - the provider-wait reader.
- **29 October, round 2.** With those four assumed repaired, three sessions read accumulated
  capability, learning information and evaluation grounding. They confirmed one design-level
  flaw: an exam was accepted that left out the compilation the operator's prompt required. Two
  supported concerns stood beside it, and no false promotion was demonstrated
  (`.ana/wri/2026-10-29-fundamental-sol-audit-2/vetting.md`).

What both rounds lacked: every session was asked only for proved flaws, capped at two or three. So
each reported the nearest bounded bug, and nothing asked whether a mechanism should exist at all.
The lenses below add that question, and the rounds keep the proof.

## The lenses

Each session carries one lens over its part, or one lens across the whole system.

| lens | the session | what it returns |
| --- | --- | --- |
| **flaws** | traces its part end to end, writes what the logs should show if a suspicion is right, then counts the runs | at most three findings in round 1 and two later, each demonstrated or supported |
| **rethink** | reads only `AGENTS.md` section 1 and its part's purpose, then writes the design it would build, *before opening any source*. Only then does it read the code and diff the two | a sketch, the diff (what exists that the sketch lacks, and what the sketch has that the code lacks), and up to three proposals |
| **delete** | maps every concept in its part (rule 13) and counts each option's values, each branch's events and each export's readers in the logs and the tree | each concept with a missing link, and what removing it would reopen |
| **robustness** | tries the hostile cases on its part: a kill at any line, a torn append, a provider failure or timeout, a missing wall, two writers, load and the clock, a host down. For each guard it asks which test holds it | the guards no test holds and the hostile cases with no answer, each with the test that would hold it |

Every lens also returns **what does not make sense**: one line each, uncapped, with a location and
one sentence a reviewer can check. "This is confusing" is no line. A rethink session reads the
code only after its sketch is written, so the code cannot anchor it. The diff is the finding;
neither side is right by default.

## The procedure

Keep the audit's files in one folder, `<dir>`, at `.ana/wri/<date>-<subject>-audit-<round>/` of the
main checkout.

1. **Pin the source.** Take the top of the open stack, published
   (`bun .claude/skills/stack-pr/scripts/stack.ts`), in a worktree of its own
   (`git worktree add --detach ../anabasis-audit-<round> <commit>`), never the main checkout, which
   `ana.follow` moves. Every source claim cites `git show <commit>:<path>` with one-based lines.
   *Check:* the commit is on `origin`, and the worktree has its dependencies installed. The
   sessions install nothing.
2. **Fix the evidence.** Run
   `bun .claude/skills/system-audit/scripts/recent.ts --limit 16 --json > <dir>/recent-logs.json`.
   It lists the newest real campaigns once each, leaving out seeds, rehearsals and dead launches.
   Each comes with the snapshot a report cites: the event count, the last event, the sha256 of the
   lines read and the commits its launches ran.
   *Check:* more than one pack and more than one launch commit, or the brief says otherwise.
3. **Write the brief.** Copy [the brief](references/brief.md) to `<dir>/shared-instructions.md`
   and fill its marked fields. From round 2 on, list the earlier rounds' confirmed findings and
   accepted proposals as **assumed repaired**. They are counterfactual: not claims that a fix is
   published, and never new findings.
   *Check:* no marked field is left, and the brief names no conclusion the primary expects.
4. **Choose the parts and lenses.** Give each session one row of the table below, and three to six
   sessions a round. A good round mixes lenses: at least one rethink, and flaws on the parts the last
   round left open. A task is one paragraph naming:
   - the part's owners and its purpose in one sentence;
   - the lens;
   - the path to trace;
   - the one sentence that keeps it off its neighbours' ground.

   Never hand a session a suspected flaw. An earlier finding goes in the brief as a hypothesis,
   with what would falsify it.
5. **Launch.** Write a [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) manifest,
   `<dir>/manifest.json`, with `"sandbox": "read-only"` and `"search": false`. Start it detached on
   the model the operator's rules name (`--model gpt-6.1-sol --reasoning-effort high`), with output
   in `<dir>/gpt/`. Claude sessions get the same brief and task, all started in one message.
   *Check:* `gpt_sessions.started`, and each transcript's model and effort before its report is
   used.
6. **Challenge.** Once the reports are in, start one fresh read-only session. It gets the brief and
   each report's claims, stripped of their reasoning, and tries to refute every claim from the
   source and the logs. It also writes the strongest case that the system works as it is. It never
   sees the primary's view. A claim it refutes needs the primary's own recount before it stands.
7. **Vet.** Write `<dir>/vetting.md`, one row a claim:
   - what was rechecked here (events recounted, source read at the commit);
   - what the challenge said;
   - a verdict of **confirmed**, **plausible** (resting on one report) or **refuted**.

   For a proposal, vetting checks the measured cost of the present form and that the honesty
   properties hold under the new one. Say what a confirmed claim does not establish. Triage is not
   vetting.
8. **Report and carry forward.** Report to the operator:
   - the confirmed flaws and proposals, ranked by result kept against machinery removed, each with
     its owner;
   - the plausible ones, with what would settle each;
   - the vetted lines that do not make sense;
   - the rule challenges, as decisions;
   - what was found sound.

   Confirmed rows become the next round's assumed repairs. A round whose flaws and rethink lenses
   find nothing new ends the audit.
9. **Apply, on the operator's word.** Each accepted row becomes a change, through
   [stack-pr](../stack-pr/SKILL.md):
   - a redesign through [commit-r](../commit-r/SKILL.md), test-first with the old code as oracle;
   - a deletion through [simplify](../simplify/SKILL.md), following the whole strand;
   - a missing hostile test as the test first.

   Independent changes may go to write sessions, each owning named paths in its own worktree
   (`workspace-write`, `ownedPaths`). The primary reads every diff and runs the owning tests and a
   replay. A change to what a seat reads states how the wall tests still hold (rule 3). The change
   is measured by a fresh run, never by the audit that proposed it.

## The parts

| part | owns | lens it suits first |
| --- | --- | --- |
| `measurement` | `src/kernel/compare.ts`, `src/campaign/comparison.ts`, `round.ts`, `climb.ts`, `src/referee/`, `src/kernel/verify.ts`, the wall's boundaries: task selection, verdicts, fresh evaluation and the promotion decision | flaws |
| `learning_loop` | `src/builder/`, `src/examiner/`, `src/kernel/reports.ts`, `src/campaign/decide.ts`, the prompts and continuation: drafting, admission, practice, turnover, feedback | rethink |
| `runtime_recovery` | `src/agent/`, budget and load, the log's writers and readers, the `tools/d2` lifecycle, `tools/runs` status, receipts and recovery | robustness |
| `accumulated_capability` | whether successive promotions persist on independent evidence, or can be explained by selection, a shifting exam or solve variation | flaws |
| `evaluation_grounding` | whether contracts, checks, the verifier, the Referee and admission evidence support the claims made from promotions | flaws |
| `operator_surface` | the commands, skills and `AGENTS.md`: what an operator or agent must learn to run one campaign, and how many places state one fact | delete |
| `whole` | the system from section 1's question, across every part | rethink |

The operator may name other parts. A part is good when one session can read all its owners in one
context and each of its claims has one owner.

## What makes a claim

The brief carries these rules. Vetting holds every claim to them.

- **A flaw** needs the source mechanism and counted run evidence: run names, event indices, counts
  with their denominators and the snapshot read. One reproducible logical contradiction can qualify,
  labelled with its scope. Test three explanations (the intended behaviour, noise, the defect) and
  look for the strongest counterexample.
- **A proposal** needs:
  - the present form's measured cost (lines and branches from `measure.py`, the census's sites, the
    values an option took and the events a branch reached in the logs);
  - what it removes and keeps, and what it gives up;
  - which honesty property it touches, and why that still holds;
  - the decisive test: a replay over recorded logs (`bun run runs replay`), a rehearsal, or a fresh
    run;
  - one prediction that would falsify it.

  Rank by most result kept for least machinery (`AGENTS.md`, section 2, item 7).
- **A run is evidence only about its own commit.** A failure a published change already addressed
  is history. Waits, an exhausted login and elapsed hours are rule 15's ordinary case, never a
  learning flaw.
- **Absence needs checking**: its symbol and its callers, in the same session. A missing label is an
  evidence gap, not an error.
- **No padding.** The caps bound flaws and proposals. A lens that finds nothing says so, and says
  what it checked and found sound.
- **The walls.** Never quote a task, an answer, a hidden value, a check's text or a trace. Cite
  kinds, indices, ids, counts and lines. Keep machine names, logins and credential paths out. No
  session reads an env file, and no report reaches a seat.

## Where the detail lives

| file | owns |
| --- | --- |
| [references/brief.md](references/brief.md) | the shared instructions every session of a round carries, and each lens's report |
| `scripts/recent.ts` | the inventory of recent real campaigns, each as a cited snapshot |
| [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) | the manifest, the detached launch, the drain and the retry |
| [whole-run-investigation](../whole-run-investigation/SKILL.md) | one campaign's question, with its lanes and synthesis |
