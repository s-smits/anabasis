<!--
The shared instructions every session of one round of a system audit carries, whole. Copy this
file to <dir>/shared-instructions.md and replace each «field»; delete the "Assumed repaired" section
in round 1. Its rules come from the briefs of 29 October, rounds 1 and 2
(.ana/wri/2026-10-29-general-sol-audit-1/, .ana/wri/2026-10-29-fundamental-sol-audit-2/).
-->

# System audit «round», «subject»

## The question

The operator asks: «the operator's question, in their words». This round is «n» independent
sessions, each owning one part of the system; the subject is the system's design as a whole, not
the newest pull request. Do not assume a flaw exists, and do not take a lack of proof for proof of
failure.

## Assumed repaired

Treat these as solved for your analysis:

«1. each confirmed finding of the earlier rounds, one plain sentence»

They are counterfactual: not claims that a fix is published, and never your new findings. Where an
observation depends on one of them, set that explanation aside before you claim anything. The
earlier reports are at «path to each earlier round's reports.md»; read them only as needed to avoid
repeating them, and do not inherit their other conclusions without checking.

## Authority and source

Read-only. No implementation, tests, simulations, paid solves, seats or campaigns, installs, edits
to source, branches or pull requests, process actions, schedules, messages to other agents or
further sessions. Others are editing this repository: preserve their work.

Read `/Users/air/.anabasis/AGENTS.md` before your first shell command, then the pinned repository
`AGENTS.md` and the skills that own your part. The audit is read-only even where the repository's
default carries a finding through implementation.

The source is pinned to «commit» («what it is: the top of the stack, its pull request»). Your
working directory is «worktree», which may move: every source claim uses `git show «commit»:<path>`
or `git grep <pattern> «commit» -- <paths>`, with one-based line numbers.

## Evidence

Read the code, its callers and its owning tests first. Before you search the runs for a suspected
defect, write down what its log should show. For each mismatch test at least three explanations,
among them the intended or innocent one and sampling noise, and look for the strongest
counterexample. Count the callers and tests, and drop a claim the pinned commit already fixes.

The recent real campaigns are listed in «<dir>/recent-logs.json», each with the snapshot to cite:
its path, its event count, its last event, the sha256 of the lines read and the commits its launches
ran. A live log grows while you read it, so name the count you read up to. Read a bounded four to
eight relevant campaigns across packs, extending only for one decisive comparison. A run is evidence
only about the commit its receipt names: an old run cannot show a newer mechanism, and a failure a
published change already addressed is history, not a current flaw. Tell promotion attempts,
promotions, later confirmation on fresh solves and changes of the exam apart.

Use the production readers, with explicit local paths so that nothing refreshes a remote copy:

    bun --no-env-file tools/wri/wri.ts read --log <absolute log.jsonl>
    bun --no-env-file tools/wri/wri.ts climb --log <absolute log>,<absolute log>

Check that a reader's source matches the pinned mechanism before relying on it. Where a reader cannot
run without installing or writing, read the pinned fold and the log instead and say so.

Waits, an exhausted login, elapsed hours and an unobserved mechanism are not evidence that learning
is flawed (`AGENTS.md`, rule 15): compare useful work per active hour and per billed dollar. A claim
that something is absent needs its owning symbol and its callers checked in this session. A missing
human label is an evidence gap, not a demonstrated error.

No web search, no credentials, env files or authentication files, and no unrelated private
transcripts. Never quote a task, an answer, a hidden value, a rejecting check or other exam-side
text: give event kinds and indices, session ids, counts with their denominators and source
references. Keep machine names, account names and credential paths out of the report.

## Report

Your final response is the report; the launcher stores it, and you write no file. Return at most
«three in round 1, two later» findings, ranked by importance, as a short ranked list rather than a
catalogue of local bugs, and never padded to fill the count. For each:

- the claim in one plain sentence, and whether it is a correctness fault, an operational
  condition, an observability defect or a design trade-off;
- why it matters for truthful, sustained improvement, and, from round 2 on, why it survives every
  assumed repair;
- the owning mechanism at the pinned commit, with its callers and test coverage;
- the runs, launch commits, event locators, counts with denominators, and the measured consequence;
- the three explanations tested and the counterevidence checked;
- a verdict: **demonstrated** (counted in the runs), **supported** (source plus partial run
  evidence) or **unproved**; only the first two are findings, and unproved questions go apart;
- the smallest change or simplification worth testing, what it removes or reuses, its trade-off,
  and one prediction that would falsify it.

End with the strongest evidence that the system works, what evidence is missing for a stronger
conclusion, what you checked and found sound, the exact runs read and left unread with their
snapshots, and the limits of your access. If nothing is demonstrated, say so plainly.
