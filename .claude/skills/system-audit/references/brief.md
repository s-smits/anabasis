<!--
The shared instructions every session of one round of a system audit carries, whole. Copy this
file to <dir>/shared-instructions.md and replace each «field»; delete the "Assumed repaired" section
in round 1. Each session's task names its part and its lens; this file carries every lens's report,
and a session fills the parts its lens names. Its rules come from the briefs of 29 October, rounds 1
and 2 (.ana/wri/2026-10-29-general-sol-audit-1/, .ana/wri/2026-10-29-fundamental-sol-audit-2/).
-->

# System audit «round», «subject»

## The question

The operator asks: «the operator's question, in their words». This round is «n» independent
sessions, each with one part of the system and one lens (flaws, rethink, delete or robustness),
named in your task. The subject is the system's design as a whole, measured against the question of
the pinned `AGENTS.md` section 1, not the newest pull request. Do not assume a flaw exists, and do
not take a lack of proof for proof of failure.

## What is open

Everything is open except the measurement's honesty: the wall and rules 3 to 8, which a proposal
may change only with proof that they still hold. Any other mechanism, prompt, default, move-table
row, tool, reader, skill or line of `AGENTS.md` may be questioned, merged or deleted. A rule you
think is wrong goes under "Rule challenges" with its evidence. A mechanism earns its place only
while its map holds: owner, live reader, the decision it changes, evidence, and a hostile test
(rule 13). A dated incident in a head comment is a lesson. Say whether your alternative would let it
recur; it is not a reason by itself.

## Your lens

- **flaws**: trace your part end to end. Before searching the runs, write what the logs should show
  if a suspicion is right.
- **rethink**: before you open any source, read only the pinned `AGENTS.md` section 1 and your part's
  purpose, then write under "Sketch" the design you would build to serve it. Only then read the code,
  and diff the two both ways. The diff is the finding; neither side is right by default.
- **delete**: map every concept in your part, and count each option's values, each branch's events
  and each export's readers in the logs and the tree. A concept with a missing link is a candidate;
  say what removing it would reopen.
- **robustness**: try the hostile cases on your part: a kill at any line, a torn append, a provider
  failure or timeout, a missing wall, two writers, load and the clock, a host down. For each guard,
  name the test that holds it, or the test that would.

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

Read the code, its callers and its owning tests first (under the rethink lens, once your sketch is
written). Before you search the runs for a suspected defect, write down what its log should show.
For each mismatch test at least three explanations, among them the intended or innocent one and
sampling noise, and look for the strongest counterexample. Count the callers and tests, and drop a
claim the pinned commit already fixes.

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

Your final response is the report; the launcher stores it, and you write no file. Fill the sections
your lens names, in this order, and leave the others out.

**Sketch** (rethink): the design you would build, written before you read the source, kept as
written.

**Findings** (flaws; any lens may add one): at most «three in round 1, two later», ranked, never
padded. For each:

- the claim in one plain sentence, and whether it is a correctness fault, an operational
  condition, an observability defect or a design trade-off;
- why it matters for truthful, sustained improvement, and, from round 2 on, why it survives every
  assumed repair;
- the owning mechanism at the pinned commit, with its callers and test coverage;
- the runs, launch commits, event locators, counts with denominators, and the measured consequence;
- the three explanations tested and the counterevidence checked;
- a verdict: **demonstrated** (counted in the runs), **supported** (source plus partial run
  evidence) or **unproved**. Only the first two are findings; unproved questions go apart.

**Proposals** (rethink, delete, robustness): at most three, ranked by most result kept for least
machinery. For each:

- what changes, in one sentence: delete, merge, move to its owner, redesign, or a hostile test to add;
- the present form's measured cost: lines and branches, the values an option took, the events a
  branch reached in the logs, and the readers of an export;
- what it removes, what it keeps and what it gives up;
- which honesty property it touches (the wall, rules 3 to 8) and why that still holds;
- the decisive test (a replay over recorded logs, a rehearsal, or a fresh run) and one prediction
  that would falsify it.

**Does not make sense** (every lens): uncapped, one line each, as `path:line`, what, and one
sentence a reviewer can check against a file, a test or a log.

**Rule challenges**: a default, a rule or a line of `AGENTS.md` you think is wrong, with its
evidence and the honesty risk of changing it. These are the operator's decisions.

**Works**: the strongest evidence that the system works as it is, what you checked and found
sound, the evidence missing for a stronger conclusion, the exact runs read and left unread with
their snapshots, and the limits of your access. If nothing is demonstrated or proposed, say so
plainly.
