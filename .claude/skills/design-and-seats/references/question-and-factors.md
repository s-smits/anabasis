Read this when you change or explain what a comparison is for, a factor's reader or bar (supply,
climb, honesty, verdicts, economy), or a v1 word. It holds `AGENTS.md` section 1 except its
subsection "Two sides and one wall", which is in `wall.md`.

## 1. What Anabasis v2 does

One query names one technical domain. A campaign builds one **Built Harness** for it (a harness,
for short): the guide and the programs a solving model uses to answer that domain's tasks. The
**solver** is that model, and it only ever answers from inside a harness: a solve is the solver and
one harness as one system. The campaign's setting fixes the solver, so two systems in a comparison
differ only in their harness, and whatever one wins, its harness won. Every mechanism serves one
question:

> Is the new harness better than the reference harness, for this solver, on tasks neither was
> built on?

The point of the climb lies outside it: a built system with a cheap solver should reach what a bare
system with a dear solver reaches. A campaign cannot read that, since its setting fixes the solver;
the skill `compare-systems` reads it on a campaign's held-out tasks.

A comparison in code answers the question (section 7). Both harnesses solve the same held-out tasks
afresh under the same limits, terms logged before the first solve; a hidden check program decides
validity and the Referee rules each rejection; each task is a win, a loss or a tie by its score over
validity, the objective and the bill; and a one-sided paired sign-flip test reads a **step** or
nothing. The operator freezes the exam, sets the dollar cap and labels answers blind, and one
append-only log a campaign holds every state (section 5).

### The four reported factors

Anabasis v2 is a training loop in which the thing trained is a harness and the loss is measured by
running a fixed model. It needs a training signal that carries information, a held-out set the
learner cannot see, an evaluation less noisy than the effect it seeks, correct labels, and a result
worth its cost. The first, supply, is a condition of admission; the other four are reported: climb,
honesty, verdicts and economy. Every session, pull request and run is judged against them, and a
change that moves none says what it moves instead. Their recorded values live only in
`docs/plan.md`, "Goal and the four factors".

**Supply, the condition before the four: is there gradient?** A comparison registers a difference
only where one harness answers and the other does not, or, under a declared objective, answers
better by it. A task the reference solves every time with no better answer on record, and a task
nobody has solved, carry no signal; a scored set of them reads "no room" whatever the new harness is
like. The informative tasks lie between (`informative`, `src/kernel/compare.ts`; section 7, "Room
for improvement"). Here the solver stays fixed and the Examiner keeps the exam at its frontier
(section 3). Supply is the number of informative tasks in a scored set, held to
`comparisonFloor(level)` by comparison admission (section 6, "What refuses a move"). It binds first,
since every other number is undefined without it, and is not reported, since passing it shows only
that a difference could be shown.

**1. Climb: how much ability has accumulated?** The one quantity the system exists to move is the
reference harness. A promotion is one step of descent: a harness that beats the reference on
held-out tasks by more than chance allows, in one comparison on fresh solves. A climb is several
within one campaign (`src/campaign/climb.ts`); promotions summed across campaigns are no climb. A
draft the reference never answered at admission but whose author's answer passes (`task.feasible`)
is held out like any other (`measured`, `src/examiner/write.ts`), since it is exactly the room a
promotion leaves. That answer shows only that it passes the checks, and not that the public input
suffices to derive it, so a held task nobody answers may be hard or underspecified until a person
reads it. An older log's `ladder` tasks read as held out, and its ladder readings decide nothing
(`lastReports`, `src/kernel/reports.ts`).

A small movement is read against the solver's measured variation before it is called a gain.
Milestone: six confirmed promotions in one real campaign, then the same in a second domain. It is
the operator's milestone for observation and no quota, rule or stop: no prompt, tool or row of the
move table names a count of promotions, and the release cycle stops runs from outside
(run-improvement-campaign). Improvement patience marks a possible plateau, no proof that no step is
left. A campaign that ended before six on its budget, its environment or as `finished` reads
"reached N promotions; further improvement unresolved"; one ended by improvement patience reads
differently. Its false-promotion risk is reported over every comparison that could have promoted,
since the opening's estimate covers one window of improvement patience at most.

**2. Honesty: could the measured gains be chance or drift?** A test at level 0.10 is designed to
crown a winner between equal harnesses about one time in ten, a claim until it is measured on the
real solver, whose same harness fails a task once and passes it the next time. The measurement is
the A/A comparison beside every comparison (section 7, "Beside the test"), where a step is a false
positive by construction. Bar: no step in the ten A/A comparisons after the six on record, which
still bounds the rate loosely. The level is per comparison: nothing holds a campaign's many attempts
to it together, and no opening is refused on their sum. Each reading prints its own false rate
(`falseRate`, `src/campaign/comparison.ts`) and the opening prints it at its target (`sizeLines`,
`src/kernel/size.ts`); the climb sums the attempts' rates as an estimate and no bound, beside the A/A
comparisons that read a step, counting only those able to reach the level and reporting the rest as
too small (`falsePromotion`, `incapable`, `src/campaign/climb.ts`).

**3. Verdicts: are the labels correct?** No one has audited the check program against the field, and
a check that rejects a right answer is label noise: in v1, 36 of 47 rehearsal misses came from a
faulty check or instrument. The Referee is the noise filter (`src/referee/referee.ts`, whose head
comment holds its evidence rules; section 7, "Rejections"): it rules every rejection before it
counts, after the host replays the checks, and a ruling without the evidence its kind requires is
refused and logged. `earned` is a loss; `check-defect` and `unclear` set the task aside for both
harnesses, so a broken check scores against nobody. The Referee is measured by agreement with a
person labelling the same rejections blind (`tools/d2/settle.ts`, `src/referee/agreement.ts`): label
against ruling as two rates, each kind's agreement and PABAK beside kappa, never kappa alone, and
each settled comparison reread with the labels (`swapped`), where a decision that flips means its
packet was too small. Bar: on at least thirty labels, catching three in four of the rejections a
person calls a check defect, and voiding at most one in ten of those a person calls earned.

**4. Economy: what did each measured gain cost?** A significant step is not necessarily a useful
one. The budget is a bound the operator sets, and a campaign is judged by how fast it climbs under
it rather than by what it leaves unspent. The closing report reads economy from the log alone
(`tools/d2/close.ts`, "Work and spend"), in dollars calculated at list prices (`pricedAt`,
`src/agent/session.ts`) as the cap reads them, with the backend's totals beside (`costLine`,
`src/kernel/trace.ts`), and leads with dollars and hours per promotion. Its one bar, an opening
term the operator may set, refuses nothing (`worthOf`, `src/campaign/climb.ts`): at most 3
promotion attempts per epoch after set-up.

Left out on purpose: the wall, a correctness property the suite tests; practice results, a
learner's score on its own training set (rule 1); and cost apart from its climb. The four are ordered by where they bind: without climb no result, without
honesty and verdicts none anyone can believe, without economy none whose price is known.

### What changed from v1

v1 is this repository's history before v2 took it over on 11 October 2026 (`git show
5bc9988:<path>`; `docs/transfer.md` keeps the account). It was published as a squashed history, so
a v1 commit cited in `docs/transfer.md` is missing here. Much of `src/meta`, `src/wall`, `tools/loc`
and `tools/oxlint` came from v1, so v1's wording survives in comments, and a comment citing
"AGENTS.md rule N" means v1's differently numbered rules. v1's fixed task set, difficulty band,
author's answer as credential, F2, submit barrier, automatic acceptance and promotion veto are
retired. A **climb** is factor 1, an **epoch** the stretch of a campaign under one reference
(`src/campaign/climb.ts`), the **level** the step test's (`--level`); a **cycle** and a **sweep**
name the stored v1 run a pack comes from, and **bundle** its directory.

