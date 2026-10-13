# Helper prompts

Prompts handed whole to another session: a reviewer, a subagent, an outside model. Each names
its authority, the tree and commit, the question and the required output, as section 11 of
`AGENTS.md` asks of a subagent's brief. A session that uses one fills the placeholders in angle
brackets, hands the text and nothing else, and checks every finding that comes back against the
source before acting on it (section 9: a report is a lead).

A prompt is kept here once it has been used and its findings read. It is the operator's to add to;
a session adds one with the pull request that used it.

| Prompt | For |
| --- | --- |
| [Audit the five success factors](#audit-the-five-success-factors) | Whether the factors of `AGENTS.md` are the right set, measurable from the log, stated once, and true to the source. Written on 11 October for PR #227 |

## Audit the five success factors

```text
AUDIT: the five success factors of Anabasis v2

Authority. Read-only. You change no file, open no pull request, start no run,
append to no log and post nothing. You report. The operator decides.

Tree. s-smits/anabasis at <commit>, on <branch>. Read AGENTS.md whole
first, then the files named below. State every fact with the commit you read
it at. Where this tree and main disagree, say which you read.

What is under audit. AGENTS.md states that the system is judged by five
factors, in the order they bind, each a question, a measurement and a bar:

  1 Supply    informative tasks in a comparison's scored set
  2 Climb     promotions a campaign; pairs the starter loses each epoch
  3 Honesty   false steps in A/A controls
  4 Verdicts  the Referee's rulings against a person's blind labels
  5 Worth     effect size, transfer, cost; no bar set

The text is AGENTS.md "The five success factors"; the recorded values are
docs/plan.md "Goal and the five factors"; the campaign skill
.claude/skills/run-improvement-campaign/SKILL.md names the factor a pass holds.
The claim is that these five are (a) the right set, (b) each measurable from
the log as written, (c) each stated once, and (d) true to the source. Audit
each of the four.

PART A. Is the set right?

A1. For each factor, write the failure it guards against in one sentence,
    and name a recorded campaign or event kind where that failure occurred
    or would have shown. A factor with no recorded failure behind it is
    listed as unproven by rule 13 of AGENTS.md.
A2. Name any failure of the system that none of the five would detect.
    Candidates to test, and reject with a reason or keep: a harness that
    hard-codes answers (rule: "nothing in a harness returns a finished
    answer"); an Examiner that writes tasks the solver cannot read; a
    provider outage read as a loss (rule 7); a comparison whose two sides
    ran at different hours; a check that accepts the do-nothing answer; a
    promotion on the objective alone; compaction losing the Builder's
    conversation; a drift of the host's load. For each, say which factor
    it falls under or that none does.
A3. Is the order "where they bind" right? Give one recorded case where a
    later factor bound before an earlier one, or say there is none.
A4. Are any two factors one? Test honesty against verdicts (a check defect
    is a tie in an A/A, not a lie) and climb against worth (a promotion with
    no effect size).
A5. The text chose five of "three to seven". Argue for four, six or seven if
    a change would be better, with the factor added or removed.

PART B. Is each measurable from the log, as written?

For each factor, trace the number from its definition to the events that
would produce it. Name the fold (function, file, line) that computes it
today, or state that none exists. Then say whether a session could print it
from one log with the readers in the tree, or whether it is a hand count.

B1. Supply. "The reference valid on some solves and not all, or on none while
    another harness was." Is this the same as roomOf (src/builder/decide.ts)?
    Is it the same as what prepare.ts and the Examiner's "room" session read?
    Where two readers decide it, name both (rule 12). Does the bar "at least
    4 before each comparison" have an owner, and would admission
    (src/builder/admission.ts) refuse a comparison below it today?
B2. Climb. Where are promotions counted (harness.promoted)? Where are "pairs
    the starter loses per epoch" computed, and what is an epoch in the
    source? Can the second be read for every promotion on record from its
    log, or only for some?
B3. Honesty. Read src/builder/round.ts (the slots), src/kernel/compare.ts
    (halves) and src/builder/comparison.ts (noise in the report). Confirm or
    refute each sentence of AGENTS.md's factor 3: the reference solved twice
    as often; earlier solves one side and later the other; tallied and
    tested as a comparison is; "a step there is a false positive by
    construction"; "0 in 6 bounds the rate at about 39%" (recompute:
    (1-p)^6 = 0.05); "the later side always runs after the earlier".
    Then: is there any fold that counts controls and their readings across
    campaigns, or is "6" a hand count? Where does the decision table ask for
    a control (noiseRead), and under what condition does it stop asking?
B4. Verdicts. Read src/review/referee.ts, src/review/agreement.ts,
    tools/d2/settle.ts, src/review/rejections.ts. Confirm or refute each
    sentence of factor 4: when the Referee runs (every rejection inside a
    comparison; never a pass, a cut solve or a crash); the host's replay
    before any reading; the inputs listed; the exclusions listed; the
    evidence each ruling must carry and that a ruling without it is refused;
    what earned, check-defect and unclear do to the task; that reasons never
    reach the Builder (name the test that proves it); the three-by-three
    table and the two rates; the bar's numbers (10 a kind, 3 in 4, 1 in 10,
    3 passes a comparison) against the Bar in agreement.ts and the plan.
    State whether "3 passes a comparison read by a person" has any owner in
    code or is a procedure only.
B5. Worth. For each of effect size, transfer and cost: name the report field
    or event it is read from (valid in the report; task versions and their
    exam.* events; billed dollars and build.* events). Say whether "tasks
    written after the harness was frozen" can be identified from a log
    today, by which fields, and whether any comparison on record scored one.

PART C. Is each stated once?

C1. Grep AGENTS.md, docs/plan.md, every SKILL.md, every head comment under
    src/ and tools/ for: M1, M2, M3, "false step", "false-step", "noise",
    "A/A", "room", "informative", "effect size", "transfer", "worth",
    "success factor". List every place a factor is defined or restated.
    Where two definitions differ in any number or word that changes the
    measurement, quote both.
C2. AGENTS.md says it holds no status and the plan holds the values. Find any
    recorded value, date or "today" that remains in AGENTS.md's section, and
    any definition that remains only in the plan.
C3. Does the plan's "It works when" sentence agree with the five-row table
    above it? Does the "Goal" sentence?

PART D. Is the text true to the source?

D1. Every path, symbol and flag named in the section: confirm it exists at
    <commit> (src/builder/round.ts, src/review/referee.ts,
    src/review/agreement.ts, tools/d2/settle.ts, referee.finding,
    roomOf). List any that does not.
D2. Every number: "36 of 47 rehearsal misses", "0.10", "one time in ten",
    "six on record", "3 in 4", "1 in 10", "10 labels a kind", "2 to 4 untied
    tasks", "18 and 22". Name the source of each (docs/v1.md, the plan, a
    log) or mark it unsourced.
D3. Every claim about what is excluded: "never the harness, the trace or
    anything the Builder wrote"; "no seat reads an answer that passed";
    "the wall is tested in the suite as a byte-identical message". Name the
    test or the code path, or mark the claim unproven.
D4. The "left out on purpose" paragraph: is each exclusion argued correctly?
    In particular, is the wall only a correctness property, or does its
    leakage have a rate that should be a factor (lane 18 of the
    whole-run-investigation skill)?

PART E. Style

E1. AGENTS.md section 13: plain, understated, no celebration, absolute
    dates, fixed terms with one meaning. Quote any sentence that breaks it.
E2. The ML framing ("gradient", "descent", "label noise", "overfitting"): for
    each, say whether the analogy holds exactly, loosely, or misleads, and
    what a reader who takes it literally would get wrong.
E3. Is anything in the section a course rather than a fact (consequence 1 of
    section 2: "give a model facts and never a course")? The section is read
    by sessions, not by seats; say whether that distinction is stated.

OUTPUT. One report, in this order:

  Verdict      one line: the five stand / stand with corrections / do not stand
  Findings     a table: id, part (A-E), file:line, the claim, what you found,
               severity (blocks / corrects / notes), and the fix in one line.
               Most severe first. A finding you could not verify is marked
               so, with what would verify it.
  Unmeasured   the factors, or parts of them, that no fold computes today,
               with the event kinds a fold would read and where it would live
  Open         the operator's decisions this leaves: the bars with no word
               (supply's 4; worth's three), and any factor you would add or
               remove
  Counts       files read, greps run, tests run (name each; run none that
               spends), and the commit of every tree you read

Quote nothing from a task, an answer, a hidden value, a check's text, a
prompt or a trace, whatever you find in .ana/. Event kinds, ids, digests,
counts, paths and line numbers only. Every "N of M" you report is recounted
by you from the source or the log, not copied from the text under audit.
```
