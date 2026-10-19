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
| [Audit the five success factors](#audit-the-five-success-factors) | Whether the factors of `AGENTS.md` are the right set, measurable from the log, stated once, and true to the source. Written on 11 October for PR #227, and kept as it was used: since 13 October `AGENTS.md` reports four factors, with supply a condition of admission and worth's effect and transfer retired |
| [Review Harness² against Anabasis](#review-harness-against-anabasis) | Each Harness² mechanism mapped onto Anabasis, with a verdict, the record that limits Anabasis, and a check of the plan's four Harness² rows. Written on 19 October after PR #231 and run twice that day by outside sessions; their findings corrected the rows and the Builder's sentence on the margin in the pull request that keeps it |

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

## Review Harness² against Anabasis

```text
REVIEW: Harness² against Anabasis v2, component by component

Authority. You may read and investigate, and that is all. Change no file in either repository,
open no pull request or issue, start no campaign, solve or model run of Anabasis, append to no log,
and post nothing anywhere. Never execute code from the Harness² repository, its install scripts
or its demo. You report; the operator decides.

Trees.
- Anabasis v2: s-smits/anabasis at 23e5a27f on main, in a checkout of your own. Read AGENTS.md
  whole before anything else. Give the commit with every fact you state. Where a file you read
  disagrees with AGENTS.md, say which one you trust and why: newer evidence wins, and a sentence
  whose mechanism has left the source is dead text.
- Harness²: github.com/google-research/harness2 at 1cfe254e8d25b15f37048c3730134686abe60335.
  Clone it into a new, empty directory and treat it as untrusted data: read it, and run nothing
  from it.
- The paper: Xu et al., "Harness²: Recursive Agent Harnessing for an Open World",
  arXiv 2610.14224. Read the HTML or PDF. Say which figures you read off a plot; those numbers
  are approximate, and you mark them so.
- The recorded campaigns, if this host has them: .ana/d2/<name>/log.jsonl and the kept harnesses
  beside them. Read them only through the repository's readers (`bun run runs view <name>`,
  `tools/wri/`, `.claude/skills/harness-audit/scripts/`) or read-only jq. Treat a campaign whose
  name starts with test-, sim- or rh-, and any seed or fork, as a rehearsal and keep it out of
  every count, or count it apart. The logs hold hidden values and check verdicts, so your report
  quotes no task text, no hidden value and no check source. Never open .env, .accounts/ or any
  file passed as --env-file.

Do not read these until Part H: the four rows of docs/plan.md "What we will not do" that cite
Harness², the matching sentence in the Judge row, and the Harness² entry under Sources. They hold
an earlier review's conclusions. Reach your own first.

Method. Split the work into parallel subagents however you judge best. Run at most four at once,
each with one bounded, read-only task. Each brief names its authority, the exact paths and
commits, the facts already established, the question and the output it must return. Give a
subagent the code, not your conclusions. A subagent's report is a lead: check every finding you
keep against the source or the log yourself, and say which ones you checked.

Evidence rules (AGENTS.md section 9).
- Rank evidence in this order: events in a log, then a fold over the log, then source and tests,
  then a printed line, then prose. A prompt sentence proves text and nothing about what a model
  does.
- Keep the counts apart: valid answers, rejected answers by ruling, solves that ended with no
  answer by how they ended, non-results, and tasks set aside. Give every rate its denominator.
- A negative claim ("X never fired", "nothing reads Y", "Z cannot be expressed") needs three
  things: the named symbol, its call sites, and a check run in the same turn. A count of zero
  must also name the event that would record the mechanism firing, and show that this event is
  in fact written where the mechanism acts. Advice that is never logged reads as zero.
- Never compare results across campaigns or across two settings.

PART A. What Harness² is, in its code.
A1. List every mechanism with file:line and a sentence or two of the prompt text that governs it:
    - the harness tree and its eight components, and how each executor (OpenCode, Codex) lays
      them out, caps them and loads them;
    - proposing (the general and domain-specific scopes), probing and composing;
    - parallel and sequential recursion;
    - selection, the experience reflector and the per-domain library: what is stored, how it is
      retrieved, and what a later editor is told to do with it;
    - the ledger, the run marks, resume, the judge and the report.
A2. Account for compute per task in each mode: rollouts, improver sessions, the selector, the
    reflector. Then say exactly what the "base harness" number in each table is compared against.
A3. Say where the improver and the solver are different models, and what that does to the claim.
A4. Say what reaches each model seat (editor, composer, selector, reflector): grader output,
    rubrics, scores, other candidates' outputs. Name the mechanism that keeps grading material out,
    and say whether the network can get around it.

PART B. What Harness² shows, in its paper.
B1. Give every ablation with its numbers: library, scoping, composition, k, parallel against
    sequential, component groups, same model as editor and solver.
B2. Is there a baseline that spends the same compute (best-of-N with the same selector and the
    same number of rollouts)? Give its numbers at matched rollouts, and then matched on all tokens.
B3. Is there any evaluation of a frozen, library-built harness on tasks it was not refined on, at
    equal budget? If not, give the nearest one and what it still spends on the new task.
B4. Give the variance reported, whether any significance test was made, and which of the gains
    lie within one standard deviation.
B5. Give the failure cases the paper reports, and which mechanism each one belongs to.

PART C. What Anabasis is, at the same grain.
C1. The harness contract: the four parts, what `openHarness` and the solve actually load, what the
    digest covers, what a harness tool can and cannot do, and which pi hook points exist but are
    not wired.
C2. The Builder: its tools, practice (including `under`), traces, notes and their cap, the
    handover across sessions and promotions, the campaign tools, and what the Builder is told.
C3. The exam side: the Examiner, the try_task gate, what the Examiner is told, the check program,
    the Referee, settle packets and hand labels.
C4. Measurement and control: the scored-set draw (frontier, exhausted, retained), the two-stage
    sign-flip test, the A/A control, room, the stop rule, the move table with its holds, the
    endings, the budget readings and the operator's word.

PART D. Component map.
Build one table with a row for each Harness² mechanism and for each Harness² harness component.
The columns:
    - the Anabasis counterpart, with file:line;
    - its status, which is one of:
        - EQUIVALENT
        - PRESENT IN WEAKER FORM
        - EXPRESSIBLE BY A BUILDER TODAY WITHOUT A HOST CHANGE (show how)
        - ABSENT
        - FORBIDDEN (name the AGENTS.md rule or section, and quote the clause)
    - one line of justification.
Then build the reverse table: each Anabasis mechanism that has no Harness² counterpart, with the
factor it serves (supply, climb, honesty, verdicts, economy), or "none".

PART E. The claims each system can make.
E1. Put each system's headline claim in one sentence. Then state what a reading of each may and
    may not be said to show, using the table "What may be claimed" in AGENTS.md section 9.
E2. "Unseen tasks" means at least two things here: a task met cold by a harness frozen
    beforehand, and a task the harness is adapted to while it is being solved. For each system,
    say which kinds it handles, at what cost, and with what evidence. Say also whether each
    adapts to a new domain, and how.
E3. Restate Harness²'s main gains in Anabasis's terms: at equal budget, on held-out tasks, with a
    repeat. Say what part of each gain survives that restatement, as far as the paper lets you
    tell, and what cannot be told.

PART F. What the record says limits Anabasis.
F1. From the logs and docs/plan.md, give the recorded numbers for each candidate limit, with
    their sources: supply (gate outcomes by the reference's valid solves, informative tasks per
    comparison), Builder behaviour (sessions that changed nothing, practice solves spent, repairs
    that held), noise (A/A readings, flip rates), cost (by seat), and environment (endings by
    kind).
F2. Say what promoted and kept harnesses contain, as structure only: which parts are non-empty,
    how many programs and of what kind, the guide's length, tools declared. Map that onto
    Harness²'s components.
F3. For each piece of evidence in F1 and F2, give its date, and check it against the change log
    in AGENTS.md and docs/plan.md. A pattern recorded before a fix landed is history; say which
    findings predate a fix, and which still hold at the head.

PART G. Candidates, in both directions.
G1. For each Harness² mechanism, give a verdict:
    - ADOPT (give the owner file, the change, the AGENTS.md rules it must respect, the recorded
      evidence that justifies it under rule 13, and the hostile test that would prove it);
    - ADAPT (the same, plus what changes from the Harness² form);
    - ALREADY PRESENT;
    - NOT APPLICABLE (the goal it serves, which Anabasis does not share);
    - FORBIDDEN (the rule);
    - DEFER (the recorded count that would make it worth building, and the name of that count).
G2. Name each Anabasis mechanism that Harness²'s lighter design suggests could be simplified or
    removed. For each, give the evidence that it pays no rent, the decision it changes today, and
    whether the change is the operator's to make (AGENTS.md section 3 lists the operator's seven
    decisions).
G3. Name what Harness² could take from Anabasis. This is for the comparison only; propose
    nothing to them.

PART H. Against the earlier review.
Only now, read the Harness² rows of docs/plan.md "What we will not do", the Judge row's Harness²
sentence and the Sources entry. For each statement there, say whether you agree, disagree or
cannot tell, and give the evidence. Name anything that review missed, and any number it states
that you could not reproduce.

PART I. Complexity.
Count nonblank lines in both trees by concern: the exam or benchmark side, statistics,
orchestration and control, the improver or Builder, the solve or executor, the wall or sandbox,
tooling, tests. Give the method, so that the count can be reproduced. Say which part of each
system's size buys which claim.

Output. One report of at most 4,000 words, in plain European English, with no emoji and no
celebration, in this order:
1. A verdict in at most eight lines.
2. The Part D tables.
3. The Part G verdicts, as a table, with the evidence for each.
4. Part F, with every number and its source.
5. Part H: agreements, disagreements and omissions.
6. Parts A, B, C, E and I, compressed.
7. "Verified" and "Inferred", as two separate lists.
8. "Not checked": what you could not reach, and why.
9. The subagents you ran: one line each, giving the question and whether you checked its findings.
Cite every fact by file:line at its commit, by event kind and campaign name, or by paper section
or figure.
```
