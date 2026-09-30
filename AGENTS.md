# AGENTS.md

This is the working contract for Claude Code, Codex and their subagents in this repository. Claude Code
loads it wherever a project has no `CLAUDE.md`, so this repository keeps none. It holds principle and
standing operator decisions; the forward queue, current head, run condition and open questions belong to
the operator's plan and to Git history. Where this file and newer evidence disagree, the evidence wins,
and a rule whose mechanism has left the source is dead text: say so rather than obeying it.

Be eager. Given an ambiguity, do the task rather than ask about it. Carry authorised work through
implementation, checks and delivery; the authorisation survives turns and compaction. Ask only when a
decision or a permission is genuinely missing, and then have the reviewable result ready and name the rule
that blocks you.

<!-- weekly-best-run:start -->
<!-- weekly-best-run:end -->

**Bun only.** Every repository task, a one-off inspection included, runs on the stable Bun 1.4.2 named in
`.bun-version`: never Node, npm, npx, compatibility prefixes, version managers or package-manager
handshake-variable changes. A canary at the same version number is a different runtime. If the pinned Bun
is unavailable, report the environment gap rather than reaching for what is at hand. A run already in
flight keeps its opening's executable bytes until it finishes. The one exception is Astra, where ad hoc
inspection, data handling and automation scripts are better in Python; repository source and its test and
gate commands stay on TypeScript and Bun.

The file runs in this order: what Anabasis does and who owns each part of it, the goals, the evidence
rules, how to spend each paid run, the sixteen working rules and the mechanisms under them, code, lint and
gates, and finally working in the repository, which covers worktrees, commits, stacks, subagents and
writing style. Each skill under `.claude/skills/` owns its procedure's details, so this file names the
skill instead of repeating it.

## What Anabasis does

One short prompt about a technical domain becomes two products: an agent harness that solves tasks in that
domain, and an evaluation that decides whether those solutions are correct. The second is much the harder.
Anyone can write twenty-five plausible tasks, but only a correctness model that accepts the right answers
and rejects the convincing wrong ones makes a measured pass rate mean anything. The same test applies to
every rule here: a rule matters when construction carries it into the product or a check enforces it, and
a check that never changes a decision is decoration.

```text
INPUT      one-line prompt (+ optional public --context paths)
   │
BUILD      Builder session (model)  ── reads STARTER.md, maps the field into task families,
   │       installs real tools under .toolchain, writes correctness-model/ and agent/,
   │       rehearses with harness_inspect → harness_trial → correctness_check, then submit
   │
GATE       submit (code)  ── immutable snapshot → bundle contract → validation → conformance
   │       probes → control census → F2 reference solve of every task → grounding/solvability →
   │       adopt or refuse; every refusal returns typed findings to the same session
   │
MEASURE    Built Harness (model)  ── one confined solve per task with the closed tool roster;
   │       each accepted artifact goes to the host verifier (code plus hashed installed tools)
   │       → verified | unaccepted | non-result
   │
LEARN      review slot (model, advisory)  ── Main Judge battery review, diagnosis reader,
   │       Epoch Reviewer, deterministic rebuild advice packet
   │
NEXT MOVE  boundary (code)  ── build | measure | rebuild | stop
           The Builder chooses and implements the next experiment; accepted bytes own attribution
```

1. **Input.** The one line names a field, not a deliverable ("designs steel roof trusses to Eurocode 3").
   It carries no plan, answer key, driver or hint, and public `--context` files are the only thing that
   may go in beside it.
2. **Build.** The Builder reads `STARTER.md` in a seeded workspace, installs the domain's real open-source
   tools, and writes the whole bundle. Under `correctness-model/` that is `brief.json` for the domain plan
   and public rule decisions, `tasks.json` for the public inputs and hidden expectations, `controls.json`
   for the task-bound accepts and rejects, `evaluator.ts` for the named Boolean checks and
   `reference/index.ts` for a reference solve over public input; under `agent/` it is `tools-spec.json`,
   `tools.ts`, `BUILT_AGENTS.md` and `config.yaml`.
3. **Gate.** `submit` freezes the candidate once and runs one sequence against that snapshot. A refusal
   keeps the session alive; acceptance ends it.
4. **Measure.** The Built Harness solves the battery behind its own file wall with the Builder's tools.
   The host verifier runs the declared checks over each accepted artifact, and every tool run is hashed
   and recorded as an evidence row.
5. **Learn.** The review slot reads recorded rows and traces and writes advice. It never changes a pass,
   an acceptance or a claim.
6. **Next move.** Code admits construction, measurement, an adopted-product continuation or a typed stop
   (`src/run/next-move.ts`). The existing Builder chooses the next experiment from the recorded evidence,
   because there is no separate planner to hand it to. What a round sets out to test is the Builder's own
   note in `MEMORY.md` or `SCRATCHPAD.md`, which the controller carries and grades nowhere (rule 11).

### Design priors

Ten decisions are settled. Code that quietly moves one is a defect rather than a choice, and each is here
because moving it cost something.

1. **Correctness has one owner.** The host verifier, running the declared checks and installed tools,
   decides every pass. No model judge, review or Builder claim sets a score, and the Judge is not where
   scores run lenient ("Open gaps").
2. **The input is one line.** No hidden plan, custom driver or evaluator hint rescues a launch.
3. **The Builder authors the whole bundle.** Nothing under `domains/` is hand-written or repaired. A
   defect seen across domains is fixed where it came from, which is the Builder prompt, the shared
   contract or the starter.
4. **Every environment failure is a typed non-result.** Provider, runtime, sandbox, protocol,
   verifier-host and tool failures leave `truthOk` and `pass` `null`. A battery of them yields an
   operational result, never a capability rate and never a fail.
5. **The Builder chooses task variance and complexity.** The loop prescribes no axis, step size, family
   mix or parent bijection. Levels and bands describe recorded conditions and command nothing.
6. **Verifier output is protected.** Stdout, stderr, issue text, counterexamples, reference artifacts and
   per-task failure locations never reach the Builder, the Judge, the diagnosis reader or an authoring
   prompt. Change only protected detail, and every prompt digest must come out unchanged (rule 4).
7. **A task-only comparison keeps its product fixed.** The agent, the tools and the scoring program stay
   put while the battery, its controls and its reference solve change, and even then the comparison needs
   a matching measured model, isolation, thresholds and resources.
8. **Submit freezes one immutable snapshot.** Validation, conformance, census, F2, adoption and
   measurement consume the same bytes. Git is the Builder's memory, not the authority on what was
   accepted.
9. **A tool is what the host hashed.** `toolId` resolves once at submit, under the candidate's
   `.toolchain` first and then the host PATH, and every run records its digest, source, inputs, exit and
   outcome.
10. **Bracket a witnessed capability boundary.** Every admitted task has a verifier-accepted witness,
    which proves it feasible (optimum ≤ reference ≤ limit) and never difficult: run 371f8f's solver beat
    the Builder's own reference on 5 of 6 tasks, and truss-26 and -29's solvers on 107 of 134. Nor has a
    stronger witness yet been shown to make one difficult. On 2026-09-30 six truss-25 limits reset at
    1.02× the best of a longer search passed 5 of 6 under the recorded 90-minute Opus solver (prediction
    579d4990, refuted as frozen). Three of those searches ran 45 minutes and moved their limits by 0.2 to
    2.3%; the three that ran 3.4 hours cut them by 12 to 59%, and one of the three failed, on strength
    and member-loss resilience under the lighter limit rather than on mass. So a longer search stays an
    optional method whose effect is measured on six tasks only, and a conformance domain such as firmware
    has no optimum to search. Seek tasks beyond the fixed solver's observed capability in what they
    demand, not only in where their limits sit, and locate the transition by blind measurement. The operator aims a first battery at very hard, about 3
    of 25, so that it lands at least at hard (2026-09-30). That aim is a hypothesis rather than a
    prerequisite, and it reaches the Builder as demand in the tasks, never as a count or an aim sentence,
    since 29 of the 36 first batteries authored under "author above what you believe" passed whole.
    Later batteries swing between 1/n and n−1/n and narrow into `climb.band` (below). An unbracketed
    boundary is reported unlocated, never met with manufactured failures. **No course is
    prescribed.** Campaign 3fd52f9e-28 followed a prescribed three-stage course and moved only its
    published magnitudes for four consecutive batteries. So the Builder is told what was measured and
    what a round is for, a battery that fails some of its cases, and never a count to author towards.
    The one kind of demand the loop names is depth, more of the request's requirements acting together
    on one answer under one shared limit, so that meeting one spends the margin another needs, because
    it is the one recorded demand that dropped pass rates
    while widening kept batteries whole ("Tried and taken out"). Whether naming it moves a Builder is not
    yet measured ("Open gaps"), and which requirements, which limit and how far stay the Builder's (prior
    5). Useful adopted work is retained.

### Owners and handoffs

Four owners divide the work, and what each one never owns matters as much as what it does. The Harness
Builder, a model, owns the reading of the request, the research, the representation, the task families,
the controls, the tools, the verifier content and its own notes; it never owns the
verifier pin, case truth or adoption. The Built Harness, also a model, owns solving the public tasks with
its closed roster, through one draft and one submit path, and never sees the hidden tasks, the controls,
the verifier source or the claim state. The measurement kernel is code, and it owns identity, verifier
acquisition, isolation, the controls census, verification, non-results, denominators, claims, rollback,
adoption and the next move, but no domain diagnosis. The review slot is a model and only advisory: it
holds the Main Judge, the diagnosis reader and the Epoch Reviewer, beside the deterministic rebuild-advice
packet, which is code. It never owns case truth, denominators, claim fields or readiness.

A decision with no owner is a defect, and a change names the owner it touches (`anabasis-pipeline`). A
finding's owner is one of the nine `BUNDLE_FILES` (`src/author/feedback-routing.ts`) or `environment`,
which no bundle edit repairs (rule 7). Each handoff is checked before anything downstream depends on it,
in this order:

1. The brief states the capability, the artifact, the constraints and correctness (`validateBrief`).
2. The battery holds fresh, conforming tasks at the requested count, with probe batteries first (rule 11).
3. The tools and representation give one draft, one submit path and a public projection, over one schema
   that the writer, DraftStore, F2 and the verifier agree on (rule 13).
4. The controls are task-bound accepts and rejects with one fact changed, and the census refuses an accept
   that fails (rule 12).
5. The verifier is a closed set of grounded Boolean checks that leaks no solution advice (rule 4).
6. Adoption passes conformance, the census, the F2 reference solve of every task, grounding and the
   fingerprint.
7. Measurement produces one recorded battery, a case record, censored denominators and a claim.
8. Learning produces review records and the advice packet, which route no score.
9. The decision is `src/run/next-move.ts` choosing build, measure, rebuild or stop.

Four invariants break easily without any test noticing. The first is that the three outcomes are never
merged. Fold `unaccepted` into `non-result` and a dead provider reads as a hard battery; fold it into
`verified` and a refusal reads as a fail.

The second is that evidence is not pooled across changed identities. Evidence gathered under different
tasks, verifier, prompt, toolkit, policy or model is not comparable, which is why a decision-relevant
change opens a successor epoch.

The third is the easiest to miss: refuse a merge whose merged state looks healthy. Before collapsing two
types, fields or checks, ask whether the merged form has a state that reads as the good one. Each of these
did: an optional field hashing like a guard-emitted one, so that two isolation walls claimed one identity;
`null`-as-unknown replaced by `0`; one duration field in which an interrupted solve read as a fast one;
and seven equal ceilings of 3 with different consumers turned into one `RETRY_LIMIT`.

The fourth is that public objects are built by allowlist. Never clone a protected object and delete the
secret keys you know about, because the key you did not know about goes out with it.

### Where a run lives

`campaigns/<slug>/` is controller-owned (rule 3): read it, never edit it, and reach it through
`campaignDir()`.

| path | what it answers |
| --- | --- |
| `controller/<runId>/opening.json`, `terminal.json` | frozen source SHA, prompt, budget, slots / how it ended (read via `openRecordedRun`) |
| `case-record.jsonl` | every case: verified / unaccepted / non-result |
| `claims/<battery>.json` | `claim.ok` and any refused clause names |
| `promotions/<battery>.json` | `promoted` or `held`; a held version is **not** adopted |
| `difficulty-decisions/` | one record per round, placing the latest battery on `climb.band` |
| `versions/<battery>/` | adopted bundle bytes: diff consecutive ones to see what changed |
| `analysis/` | `IterationAnalysis`, `rebuild-advice-latest.json` |
| `rehearsals/`, `safeguards/`, `observability/`, `verifier-lifetime/` | `harness_trial` solves, log-only sensors, lifetimes |
| `epoch-*/`, `epochs.json`, `budget.json`, `controller.sqlite` | comparable windows, the spend ledger |

## Goals and the climb

This section is the one home of the climb: what it is for, how a battery is read, which component
hears which reading, what each one does with it, and what was tried and taken out. The working rules
further down refer here rather than restating it, so change a climb mechanism here and in its source
owner in the same commit.

### The goal

**The goal is a healthy, ambitious climb** (operator, 2026-09-29, replacing "optimise the climb toward
really hard tasks" of 2026-09-18). The product is worth something only where a fixed solver fails for
reasons the evaluation can prove. So each battery asks more of the field than the one before it, for a
reason the Builder can name, and every fail that locates where the solver stops is earned. Ambition
without health manufactures a limit, and health without ambition measures a solved exam. The public
yardstick is the README's. On the same 25 held-out hard tasks at cycles 1, 3, 5 and 7, Anabasis verified
6, 8, 11 and 12 and Prime-agent 8, 9, 8 and 8. Both ran on Claude Opus 5 at medium thinking with the same
verifier, Anabasis at 120 minutes per task against 45. Widen that gap on harder tasks, never by inflating
pass rates on easy ones.

**A battery below n/n is what an ambitious round expects, and a run of n/n batteries is the failure to
fix** (operator, 2026-09-30). A full pass measured nothing about where the solver stops. On source
887c163ee, whose intent clause still named acceptance alone as good, six Sol runs passed every case of
every battery with every round accepted, reserve 6a8ca0 thirteen times at 7/7 and bulk RNA-seq 36e268
eleven times at n/n. By 2026-09-30, 236 of 298 recorded batteries across the local campaigns had passed
every case.

### What one battery can say

Every case ends in one of three outcomes, and they stay apart everywhere the climb is read. A
*verified* case reached the host verifier and passed or failed there. An *unaccepted* attempt produced
no accepted submission; it counts as a fail, because hard tasks may fail that way. A *non-result*
failed in the environment and counts neither way. Only verified cases place a battery, and a battery
whose every attempt was refused at submission is placed nowhere, because it would otherwise read as a
battery of verified failures and could end a run as infeasible in one round.

From those counts a battery says one of three things. A battery that passes some but not all of its
cases can locate a limit, and only where the checks that failed it are right (`LIMIT`,
`src/run/climb-readout.ts`); a checker refusing a valid answer leaves the same partial count as a task
the solver could not do. One that passes every case found no limit. One that passes nothing usually
found a defect, though truss-27's 0/6 was a real demand, followed by 1/7 and 3/10. A full pass that
also lost cases to non-results found no limit among the cases it scored and did not measure the rest,
so it asks for no harder demand.

A miss the wall caused measures the wall rather than the task. The readout therefore names the
unaccepted cases whose solve ran to within 0.95 of the harness's `solve_minutes`
(`WALL_BOUND_SHARE`, `wallBound` in `src/run/climb-history.ts`) beside each battery's counts, as "(k ran
to the N-minute solve wall)". They stay fails in the count, since the solver did not deliver, but a
battery whose every miss is wall-bound has located the wall. truss cb274b's 54 misses were all
unaccepted, at about two minutes a case, while all 54 designs it did submit passed.

### The three parts of the climb

All three are read on verified cases.

- **The initial rung** brackets the solver: a probe of 5–10 tasks that passes some cases and fails some,
  1/n to n−1/n. A probe at n/n found no limit and one at 0/n usually a defect, so neither is a rung. It
  graduates to the requested size once its bracket also lands at or under the aim (`batterySizingGate`),
  since every graduation from a near-full bracket (5/6, 5/6, 7/8) went straight back to a near-full
  battery (25/25, 21/23, 24/25). The round it graduates in asks for the tasks it adds at the demand of
  the probe's hardest families, not of those that passed (`renderProbeSizing`), because 12 of 13
  recorded successors would still read too easy with every probe fail held. That does not isolate the
  added tasks as the cause: 10 of the 11 former-limit tasks carried unchanged passed in the successor,
  and 11 of the 13 transitions changed the scoring program. A case
  settled against its check leaves the sample (`admittedClimbRow`); without that, f0fb83's 2/6 and the
  3/6 of 2d7812 and 3e4693 graduated on one settled check and measured a full pass next.
- **Curriculum filtering** is the climb after it, at full size, between 1/25 and 24/25. RL curriculum
  filtering drops prompts every sample solves or none does, because they carry no signal. In the same way
  a battery at 0/n or n/n says nothing about where the solver stops. The unit here is the battery, since
  each task is solved once. A full pass is answered by asking more, and an empty battery by reading what
  blocked every case.
- **The band** is the target inside that region: `climb.band`, 5–12 verified of 25, where the limit is
  located rather than only bracketed. Landing there is not the end, because the next requirement moves
  the line again.

### Its shape, and how progress is read

**The climb is a line that moves** (operator, 2026-09-29, from the launch film). A raised requirement
drops the pass rate, a repair or rebuild lifts it, and the next requirement drops it again. Over the 8 or
12 rounds of a run the swings narrow into the band. The film draws 25, 6, 5, 24, 17, 21, 12, 19, 21, 9, 12
and 11 of 25 as an illustration. Each swing is a battery answering what the Builder changed, so the
fluctuation is the signal, and 8 of 11 after 10 of 11 is progress though both sit above the aim.
truss-sol-cb274b alone had the shape on 2026-09-29, at 3/8, 10/25, 15/25 and 11/25.

Progress is read on that line (`wri.ts climb`, `climb-velocity/v2`), with four numbers:

- **signal**: the claimed batteries between 1/n and n−1/n, counted over the first 8 and the first 12;
- **swing**: the mean move in pass rate per battery, which is 0 for a line of full passes at any size;
- **flat**: the stall rule of `bun run runs pulse`, `STALL_BATTERIES` (3) in a row on one side of the
  aim, none closer than the closest before them;
- **carried**: the tasks measured again unchanged after a full pass.

A zone cannot stand in for these, since 3/3 places `over-aim` and passes everything. The line ranks
custom-sol-f0fb83 (3 of 14 with signal, a 13.8-point swing) above truss-sol-198d70 (2 of 13, 3.9) and
6a8ca0 (0 of 13, flat). A change that raises a score, adds tasks or renames levels without moving the line
has not served the goal.

### The band and the placement

The band is `climb.band`, `[0.20, 0.50]` on the Wilson interval at `climb.confidence` 0.95, whose one z
is `REPORTING_Z` (`src/claim/estimation.ts`), the one owner of sample size. Its ceiling moved from 0.5 to 0.75, 0.60 and 0.40 before settling at 0.50
on 2026-09-16, and that history lives beside the row in `thresholds.frozen.yaml`. `placeOnBand`
(`src/claim/battery-difficulty.ts`) decides the zone in two steps. The interval decides `too-easy` or
`too-hard`, meaning significantly so: the lower bound above 0.50, or the upper bound below 0.20. Inside
them the point count decides `under-aim`, `on-aim` or `over-aim` against `aimCounts`, the pass counts
whose rate lies inside the band. On-aim is the calibration target, not a proved limit, and a battery too
small to hold a whole count inside the band is refused a placement rather than misplaced. A one-case
battery's aim is the empty range [1, 0], which had read every count as off the aim in both directions,
and campaign 3fd52f9e-28's last round measured one case.

What that means at the sizes a run actually measures is worth having in front of you, because
"significantly too easy" starts at a different share at each size, and a small probe reaches it only at a
full pass:

| tasks | aim | too easy from | share |
| --- | --- | --- | --- |
| 5, 6, 7 | 1–2, 2–3, 2–3 | n of n | 100% |
| 8 | 2–4 | 7 | 88% |
| 10 | 2–5 | 9 | 90% |
| 12 | 3–6 | 10 | 83% |
| 15 | 3–7 | 12 | 80% |
| 20 | 4–10 | 15 | 75% |
| 25 | 5–12 | 18 | 72% |

`too-hard` is almost unreachable at these sizes: nothing below 20 tasks can read it, and at 25 only 0 or
1 of 25 does.

The decision reads one sample, `decidingSample`: the host-identified changed subset when one was
recorded, otherwise the whole battery, so unchanged successes cannot dilute what the change did. A case
the Epoch Reviewer settled against the check that decided it counts neither way, and a veto so settled
is dropped rather than turned into a fail (`admittedClimbRow`, `difficulty-decision/v10`), because a
flip is the one direction that lowers passes. custom-sol-2d7812's firmware battery read 4/6 on two fails
of a check stricter than its published rule, and on the public rules it was an all-pass.

`decideDifficulty` writes one record per round under `difficulty-decisions/`. It is named after the
round it opened and places the latest battery in its `evidence`, so decision i12 places battery i11.
Its `placement` is null when the battery holds no verified case or `placeOnBand` refused it. Three facts
are stated beside the placement and never instead of it: a repeated failure set (at least two cases, and
at least half the smaller failing set, failing in both of the last two batteries of one task set), a
family conflict (one family significantly too easy beside one significantly too hard), and the censored
families. Before `difficulty-decision/v7` the first two set the zone aside, so a battery whose same
cases failed twice was placed nowhere however far above the aim it read.

### Who hears the placement, and what it drives

The placement is computed once and read by five parties, and only three of them act on it. Which
component hears what is the part most often misremembered, so here it is in one place.

| reader | what it receives | what it changes |
| --- | --- | --- |
| Builder | the readout: each of the newest 3 batteries' three counts, wall-bound misses, identity aliases, regrades and settled cases; the latest battery's families and where its passing artifacts are; the no-limit line on a full pass. Never a zone, aim, share or count to author towards (prior 10). | its next battery |
| battery sizing | the latest landing's placement | the next round's task count |
| Epoch Reviewer | the placement in words (`readingSentence`), as a reason to look | its findings, and through them the advice |
| controller's next move | nothing | — |
| operator | `runs pulse` (zone, "above the aim N in a row", the stall), `runs climb`, `terminal.json`'s `onAim` and `placed` | stopping or relaunching |

So the prompt a too-easy battery gives the Builder is the no-limit line, and it fires on a full pass,
not on the zone: the latest battery has at least one verified case, no unaccepted attempt, and every
verified case passed (`noLimitLine`). A 9 of 10 reads significantly too easy, shrinks the next battery
and orients the reviewer, and sends the Builder no line beyond its counts. The zone was kept from the
Builder on purpose: a zone read back to the author decided nothing the counts beside it did not already
say, and it read as a course (prior 10).

The controller's next move (`decideNextMove`, `src/run/next-move.ts`) reads no placement at all. It
builds when no product is adopted, stops on an environment fact that ends the session (`endsSession`),
measures a condition that has not been measured, remeasures a battery the environment cut short on
unchanged bytes, and otherwise opens a rebuild. `rebuild` is the retained name for authoring on the
adopted product, not an order to redesign. The controller never stops on a reading of the tasks
(`LoopState`), so stopping a flat run is the operator's call, which `bun run runs pulse` names when it
arrives.

**Battery sizing** has one owner, `POLICY.battery` in `src/critic/policy.ts` (`floor 5`, `default 25`,
`ceiling 60`, `probe {min 5, max 10}`), which `src/run/battery-sizing.ts` re-exports and which owns the
decisions. A fresh product measures Builder-sized probes of 5–10 tasks until one passes at least one
scored case and lands at or under the aim, and only then the requested size. Past the probe, a landing
that read too easy sizes the next round to the smallest battery that would still have read too easy at
its rate (`smallestSizeHoldingTooEasy`), rounded down so that rounding never flatters the reading: a rate
of 0.88 carries at 11 tasks, for 44% of the solves. Anything nearer the band keeps the requested size.
The count reaches the Builder through `taskCountSentence` alone, and a probe round adds one sentence
(`renderProbeSizing`) that names neither the aim nor its share. An out-of-range size fails rather than
being clamped, since a silently changed size is a changed condition.

### What the Builder is asked, round by round

The demand side lives in five places, each saying its part once (rule 14), and a round meets them in
this order.

**The kickoff.** The request line of `src/run/direct-input.ts` asks the Builder to add no requirement
the request does not name, and says that a stricter demand on one it does name is not an added
requirement. Both 887c163ee Builders had declined every stricter route by quoting the first half alone,
"Do not introduce an unrequested optimality objective" on a reserve design and "avoid arbitrary yield
thresholds" on an expression analysis, which left them only size (primary lanes, 2026-09-30).
Then comes the readout (`renderReadout`), with `LIMIT`, `WITNESS` (a passing artifact, like the
reference, proves a task feasible and never difficult) and, after a full pass, the no-limit line. That
line asks for a next battery that demands more of the field's own work within its tasks, by depth (prior
10), in tasks the Builder expects the solver to fail. It says outright that
more tasks, families, inputs or scenarios at the same demand measure the same reach again (a widening
route was offered until 2026-09-30; "Tried and taken out"). It rules out carrying a task forward unchanged, says how much of the solve wall the slowest
solve took, and asks for the changed requirement and its reasoning in the notes (rule 11). The wall
share is there because 153 of 233 all-pass batteries from 2026-09-25 to 2026-09-30 finished inside a
tenth of the 120-minute wall (median 5.9 minutes), sized to the Builder's own reference, while the round
after read only that every case had passed. It ends with
`MEASURE_SOLVES`, which sends the Builder to how the passing solves reached their answers, because a
limit moved or an instance enlarged while the same steps would still find an answer asks nothing new.
The rebuild advice packet sits beside it, and a finding that recurs says how many consecutive batteries
have admitted it and since which.

**Authoring.** Ambitious is what the Builder does:

- It authors the next battery's tasks as ones it expects the solver to fail, on a changed public
  requirement from the request's own field.
- It builds depth into the first tasks, not only into a raise after they pass (`INTENT_CLAUSE`,
  2026-09-30). Requirements side by side in one task are not yet depth: each of firmware 7a97af's five
  first tasks combined several published requirements, such as a debounced button against light phases
  or a peak hold against a bar level, over sound references and rejects, and all 10 of its solves
  passed in 1.1 to 5.6 of 120 minutes, 9 with no edit-tool call after the first draft.
- It raises what the checks hold together, not only how big the inputs are or where a limit sits: 6a8ca0
  grew its inputs from 24 to 53 and its scenarios from 20 to 91 at unchanged check tiers and limits.
  Tightening alone is not enough either, because 6a8ca0's limits sat at its reference's values and its
  solver held the same optimiser, and limits reset at a longer search's best mostly still passed (prior
  10). So the change has to be one the passing solves' own steps do not settle.
- It carries no task unchanged across a full pass. 36e268 grew about one task a round, and 53 of the
  tasks it measured after its full passes were bytes the solver had already passed; on 2026-09-30, 570
  of the 1,465 tasks measured after a full pass in local campaigns were carried unchanged.
- It records the changed requirement and its reasoning in its notes (rule 11), where a plan is carried.
  In the Luna lanes of 2026-09-29 a plan written into the notes was carried and built, while the
  standing push to "demand more" named nothing.

The solver must not hold the grader, or no battery can fail. No tool, program or guide line analyses a
candidate for the solver the way a check does, through the check's code or a copy of it, its instrument
or a verdict (`NO_GRADER_IN_REACH` in `src/author/builder-start-prompt.ts`, which the Builder reads in
`PUBLICATION_CLAUSE` and the Epoch Reviewer judges the tools against), because a solver that can ask
the grader searches until it passes. Until 2026-09-30 such a tool counted as solving support, and every
harness whose solver could run a check passed whole round after round: reserve 6a8ca0 (13 batteries at
7/7) and a16848, buffer 3af96d (11 at n/n) and firmware 887c16 through an adviser importing a copy of
the check's module, and truss 3e4693 (7 at 6/6) through the verifier's analyzer on the solver's PATH.
The worry that had kept the ceiling off, that a solver without an analysis fails on arithmetic, did not
show in cb274b, the one structural run whose tools left the analysis to the solver. Verified failures
then stood at 32 in firmware, where the check observes behaviour the solver cannot fully run before
submitting, 8 in truss, whose misses were mostly walls (79 unaccepted), and none in the reserve, buffer,
RNA-seq or conformer batteries. Two readers enforce it without gating: the advisory
`agent-copies-check-code` (`src/author/candidate-check.ts`) names an `agent/` file byte-identical to a
`correctness-model/` one, and the brief's `checkOnlyTools` closes named `.toolchain` instruments to the
Built shell and records `instrument:<toolId>` in the run condition (rule 14). The buffer 3af96d solver's
`chem.ts` was the evaluator's own in 13 of 13 versions, and it passed 111 of 111.

Controls calibrate the checks the climb rests on (rule 12). The advisory `accept-control-copies-reference`
(`src/run/accept-control-independence.ts`) fires when at least 5 accepts are compared and between one and
four of them are independent of the reference output, since an accept that is the reference byte for byte
shows only that the check accepts its own answer. Buffer 3af96d copied exactly half its accepts in every
epoch, one copy and one independent accept per task, so it stayed silent; conformer 5cc42c had one
independent accept of six in five of six epochs, and the Builder carried it anyway.

**Rehearsal and submit.** `harness_trial` solves one task blind with the measured Built solver (rule 14),
so a passing rehearsal shows that task is within the solver's reach, and the task the Builder expects to
be hardest is the one whose rehearsal says most. The round prompt (`src/author/builder-session.ts`) says
that a battery whose every rehearsal passed is on course to pass every case, so before submitting it the
Builder raises what its hardest tasks demand once, by depth (prior 10) rather than more tasks, families
or inputs, and rehearses one of them again. The route is named there because the no-limit line
reaches a Builder only after a full pass in its own readout: firmware 7a97af-i02 raised by five new device
families, stopped at what its simulator could model, and passed 5 of 5. What stopped it was the board's
pin inputs and further bus devices, which its emulator cannot drive ("Open gaps"), while the interactions
depth asks for, such as one sensor trajectory driving several outputs that must agree, are observable
there already. Once, and not until a
rehearsal fails: nothing holds a submit on rehearsals, because the measured battery decides where it
lands (`WITNESS`, in the battery contract), and a rehearsal hold of that kind cost whole rounds (96 of 99 predicted passes at ≤0.3 did pass;
"What has cost whole rounds"). Across 241 batteries from 2026-09-25 on, the rehearsed task had sat at
chance in its battery's solve-time order: in 111 single-rehearsal rounds it was the slowest in 18, at a
mean rank of 0.48 against 0.50. The two Sol runs on 887c163ee each submitted on one rehearsal that passed
in its first turn, citing "submit once a clear preview says it works" as the user's instruction with the
sentence on a pass's reach already in front of them (primary lanes, 2026-09-30). Each `harness_trial`
result also totals the round's graded rehearsals, because verdicts read one call at a time were never
added up: three recorded campaigns rehearsed and shipped anyway with 12 of 16 verdicts passing.

**Measurement.** Recorded solves are reused where the exam did not move (rule 10): an evaluation
correction under the same solving condition regrades the recorded submissions, a battery the environment
cut short is remeasured on unchanged bytes before any rebuild, and a repeat of an exam an at-or-above-aim
battery already sat is measured afresh and recorded as `repeat`. The readout marks regraded cases, because
a regrade is an earlier solve graded again and not a new solve.

**Review.** The Epoch Reviewer reads the placement as a reason to look and never an obligation to find
something (rule 9). A finding about easy tasks names the request obligation they leave undemanded, owned
by `correctness-model/tasks.json`, with a `demandGap` where it has shown one. It settles a Judge
disagreement only through a probe that shows the direction, and a settled case then leaves the climb's
sample as described above.

### Healthy

Every step of the climb has to be true.

- The demand comes from the field, never from a rule the Builder adds (rule 11). An invented duty,
  deadline or report format measures the solver's reading of the author's wording.
- A fail counts only where it is earned: the check that decided it holds the artifact to a rule the
  public projection states. The Epoch Reviewer settles that per case (rule 9), quoting the public
  sentence before it calls the Judge wrong.
- An unbracketed boundary is reported unlocated, never met with manufactured failures (prior 10). The
  three outcomes stay apart, and only verified cases place a battery.
- The Builder is told what was measured and never a count, share or zone to author towards (prior 10).
- Useful adopted work is retained, and a repaired check is a new condition, not a difficulty advance.

### Reading the climb as the operator

Read the climb before paying for it: run `bun run runs climb <run>` (or `wri.ts climb <campaign dir>`)
whenever a new `versions/<battery>/` appears, hours before its battery scores. Each edge gets a
structural label from check tiers and counts (`verdictOf`): `restated`, `replaced`, `adjusted`,
`narrowed`, `widened`, `eased` or `escalated`. A label is a reading, not a forecast. In a census of 170
edges on 2026-09-29, all three `escalated` edges and 16 of the 17 that widened on a new input or rule
alone were followed by full passes. So name the changed public requirement from the task rows. Read each
battery's `fails` line (held, settled against the check, unsettled) before counting a partial battery as
a limit found, and read its wall-bound count before counting a miss as the task's. Two batteries off the
band on the same side is a settled result ("While it runs"). The whole-run digest's 4b block lists each
decision with the battery it reads, and its `OFF-AIM STREAK` line is a lead for review lane 10.

### Open gaps: why batteries still pass whole

On 2026-09-30, 265 of 299 recorded batteries had passed every case. The leniency is not in the grading.
Since 2026-09-23 the Judge vetoed 5 of 1,411 verifier passes (firmware 2 of 901, truss 3 of 510), and
counting all five would move no battery out of too-easy. Of the 22 verified fails counted as limits, 17
were contested, and the check was the stricter side (the Judge passed 11; the review settled 6 against
the check). It is not in the answers either, since every firmware reference passes F2, nor in the
limits (prior 10). The gaps are on the task side. Delete a bullet in the commit that
closes it.

- **No firmware fail has yet been a limit, and the climb still counts them.** All 32 firmware verified
  fails since 2026-09-23 were classified, 29 by replay against their own evaluators and 3 from the
  record. 24 were a Builder-written host stand-in rejecting valid code (a missing `min`, `constrain`,
  `A0` or core macro, a redefinition, a display double). 5 were one unpublished status mapping. 3 were
  auto-accepted drafts at a one-minute solve wall the Builder set in its own `agent/config.yaml`. None
  is a confirmed valid-demand fail. All 32 ran on stand-in batteries, 32 of 816 verified cases against
  0 of 283 on every other substrate, and Sol Builders wrote 89 of the 92 stand-in batteries.
  `VERIFICATION_CLAUSE` has called a stand-in the last route since 2026-09-22 and it held throughout, so
  prose did not prevent it. The reviewers read these fails as defects: the Judge contested 23 of the 24
  stand-in fails, each on exactly one deciding check, and every review filed a correctness-model
  defect. None of the 8 firmware case dispositions on record carries `checkIds`, though, 6 of them
  against the check, so `settledAgainstCheck` has never dropped a case: all 8 came from two runs whose
  source predates 7643780b, which writes `checkIds`. A review replay on main (2026-10-01) settled the
  recorded `esp32-display` false rejection end to end under the current Judge and reviewer, and the
  climb then dropped it, so no link is broken; no firmware run since has had a disposition to exercise
  it live. Owner of the stand-ins themselves: the firmware instrument (the last bullet). Evidence: the
  ignored `notes/firmware-fails-20260930/`.
- **First tasks combine requirements that the solver still meets in minutes** (firmware 7a97af under
  "Authoring"), and 7 of 29 firmware batteries passed with a harness that only compiled. Depth reached a
  Builder only after a full pass or after every rehearsal passed. Owner: the last line of
  `INTENT_CLAUSE`, which since 2026-09-30 defines depth as requirements that compete, "so that meeting
  one spends the margin another needs", and is not yet measured. Change `SCOPE_CLAUSE` ("let the tasks
  span them", "vary its stated conditions") only if that line does not carry it.
- **Graduation may dilute a bracket.** A probe at 2/6 or 3/6 grows to 25 tasks and the ~19 added tasks
  pass, in 10 of 13 recorded regresses, and with every probe fail held 12 of 13 would still read too
  easy. The added tasks are not isolated as the cause: 10 of the 11 former-limit tasks carried unchanged
  passed again, and 11 of the 13 transitions changed the scoring program. The Builder heard only "Task count: exactly N tasks". Owner:
  `renderProbeSizing`, which now names the hardest families' demand at graduation, not yet measured.
- **The worked example is a toy.** The one worked domain in `starter-pack/examples.md` is a duty
  roster: one or two shifts, one public rule, a greedy reference, and families that differ in size. Its
  list of targets the solver does not reliably meet leads with three limit-tightening routes and puts
  demand last. At least 52 of 310 Builder sessions since 2026-09-23 read it (13 through the read tool,
  39 in prose or compaction read-lists; reads through bash are unrecorded). Replace it with families
  that differ by which requirements interact under one shared limit, an obvious answer that fails, and a
  very hard family, which is where the operator's aim at very hard reaches the Builder, with no count
  (prior 10).
- **The Epoch Reviewer could not name requirements exercised one at a time.** `DEMAND_GAPS` now holds
  `requirements-one-at-a-time`, not yet measured; its orientation still reads easy tasks as a result.
- **The expected-output oracle is unmeasured.** The firmware `rules.ts` is both the check's expectation
  and the solver's `expected_behaviour`, so the solver can compute every expected value before it
  submits, which `PUBLICATION_CLAUSE` calls the field's own work.
- **The firmware instrument drives input through `starter-pack/fwsim`, unmeasured.** It runs a compiled
  image on avr8js (Uno), rp2040js (Pico) or Espressif QEMU 9.2.2 (ESP32) with pin, analog and serial
  input scripted at virtual times, and prints a time-stamped trace; checks and the solver's shell both
  run it. ESP32 input needs the pack's `esp32-input.patch`, built into `.toolchain/qemu` by
  `build-qemu.sh`; stock QEMU gives untimed output only. Not simulated: I2C devices beyond TMP105, RMT,
  PCNT, LEDC and ESP32 serial input. No recorded run has installed it yet.

All of these are model-visible, so the stack that closes them is one new condition. Freeze a prediction
per change, simulate a fresh firmware first round, and launch only on the operator's word.

### Tried and taken out

Each of these was built, measured and removed, and the reason is the measurement. Do not bring one back
without new evidence that answers it.

- **Stopping on an off-aim streak.** It stopped nothing while 5/5, 6/6 and 6/6 batteries kept arriving,
  since the route is the Builder's; `runs pulse` and the digest still count one for humans (rule 10).
  No `climb.limitHoldRounds` exists either, by design.
- **A zone, share or target count in the Builder's prompt.** It read as a course, and the counts beside it
  already said what it said (prior 10).
- **A fixed-harness difficulty session** that prescribed a level, a family composition and a lineage. It
  never left the too-easy zone in 33 recorded rounds.
- **Pre-registering a round in `EXPERIMENT.json`**, until 2026-09-29. By then it changed no score or byte
  identity and graded a declaration rather than a result (rule 11).
- **The `identical-exam-over-aim` submit refusal**, until 2026-09-29. It never fired in the recorded
  corpus, and a repeat now measures whether a full pass was reliable (rule 10).
- **Holding a submit on rehearsal predictions.** 96 of 99 predicted passes at ≤0.3 passed, and the wait
  held rounds back for hours without moving a battery on the band.
- **Counting rehearsal passes "inside a single turn"**, until 2026-09-30. On the pi backend every solve
  records one turn, and 6a8ca0's i13 reserve-6 ran 75 minutes over 72 tool calls and still read one, so
  the clause was always true while Builders' notes repeated it as a sign of an easy task. The round
  tally now states the largest share of the solve wall and the most tool calls any pass took.
- **A task-set finding forced out of every full pass** (`review-duties.ts`), until 2026-09-29. It graded
  the review's wording and pressed the author to add rules the request never held.
- **Pointing a full pass at each answer's distance from the reference**, until 2026-09-30. All five
  all-pass rounds of 6a8ca0 answered it by moving limits toward the reference or enlarging instances,
  which the solver's same method still settled in one turn; `MEASURE_SOLVES` now points at the method.
- **Offering a widening route after a full pass** ("across what the request names and no task does
  yet"), until 2026-09-30. Conformer 5cc42c and buffer 3af96d took it, adding conditions, families and
  tasks, and kept passing whole; firmware 3e4693's widened edges were followed by 6/6 and 9/9, and across
  the batteries of 2026-09-23 to 30, 71 of the 74 scored batteries after a widened edge from a full pass
  passed whole. The one recorded demand that dropped pass rates was interaction: on the 2026-09-15 truss
  pack series, one added interaction per task passed 22 of 23 (Sol high), while the same requirements
  stacked inside one shared mass limit passed 7 of 20 (Sol high) and 2 of 23 (Opus 5). The intent
  clause defines that depth, the round prompt's raise before submit and the no-limit line name it at
  their moments, and no surface offers another route.
- **Stating each passing solve's slack against every published limit in the opening** (`solverRecord`),
  2026-09-29 to 30. It was added because Builders setting their next limits did not open the traces,
  and so it pointed every round at limit distance: the twin of the reference-distance pointer above,
  and the route the witness test did not show makes a task hard (prior 10). It was not measured on its
  own. The same margins stay beside each passing artifact in the context tool's traces.
- **Searching each reference as long as a solve may run** (`witness-budget`, one sentence in
  `renderBatteryContract`), 2026-09-30, and twice before unmeasured (83a24567, d21f1a27). As a duty it
  bound every task to one method: its truss prediction did not hold as frozen (prior 10), in firmware,
  which has no optimum to search, the fork given it tied no limit to a solve's minutes and raised
  difficulty by stacking requirements (prediction 62424ee4), and in a frame simulation an Opus Builder
  started one 95-minute search with about 75 minutes of its wall left and never submitted. A longer
  search stays an optional method in `examples.md`, "A search past the solver's wall".
- **A second Wilson implementation** (`wilsonZ`) and the `minLevelN` floor, which discarded a placement
  whenever fewer than four tasks changed, until 2026-09-18.
- **The transplant census**, until 2026-09-25, which refused one deliverable passing every sibling task.
  That is what a ladder of tightening limits looks like, and it made Builders invent constraints.

### Ablated components

An ablated component is switched off in source but kept there. Each removed line or block stays as a
comment under `// ABLATED(<id>): <why>`, with its exact original text after the prefix. A line added in
its place, or on its own, carries `ADDED(<id>)`. To restore a component, or drop an addition, work
through the grep: remove the prefixes, delete the replacement lines, and flip back the test assertions
under the same marker. Each entry below is a measured condition, not a settled rule. Once its run reads,
it either moves to "Tried and taken out" or its comments are deleted.

No component is ablated in source at present.

## Evidence and implementation status

"Done" hides four states, so name the one that is true. A thing is present in source when the named tree
holds the producer and its live consumer; deterministically proved when a positive and a hostile check
exercise that consumer on that tree; live-exercised when a recorded run from that exact source reaches the
branch; and outcome-proved when the live run supports the claimed capability or limit. Prompt assertions
prove text, types prove shape and gates prove the conditions they test. None of them, and neither do
started runs, PR prose, reference artifacts, static discrimination controls or a projected move, proves
better model behaviour or a completed product vertical.

```text
recorded run bytes > verified evidence reader > source and tests > terminal/log line > PR body > prose
```

A negative capability claim ("the gate does not enforce X") is the most expensive kind to get wrong,
because it tells every later reader to compensate for a defect that may not exist. It enters this file
only with a named symbol, its call sites and a check run in the same turn; a session report is a lead
toward that check. Likewise grep-confirm every threshold, constant, closed-set member and path you write
here against `thresholds.frozen.yaml` or `src/` in the same turn, because a rule whose mechanism has left
the source still costs a reader an investigation.

Analyse against the full `source.commit` in `opening.json`, cite it, and show its first nine hex
characters in `main_synthesis.md`; a missing object is `source-unresolved`. A fix counts as current only
when it is an ancestor of the measured tree, and a composed stack needs every child to contain its latest
published parent. GitHub's `CLEAN` state proves neither.

Read cases by their kind first. `verified` is an accepted submission with a verifier verdict; `unaccepted`
means the agent ran but produced no accepted submission; `non-result` is a typed environment failure with
`truthOk` and `pass` `null`. Report the identities and the three counts separately. Only verified cases
enter a capability rate, and zero verified gives an operational result only; SIGTERM preserves the
recorded denominators either way. Difficulty has its own denominator, because once any case is
truth-verified, door-rejected attempts count as difficulty failures. An all-unaccepted battery is placed
nowhere: rebuild, with no capability rate and no difficulty strike. An unproven served-model identity
refuses the identity claim and nothing more; it does not turn a scored case into a non-result.

Compare runs on one shared pack or not at all. An in-run battery scores the Builder's own tasks, which is
a much easier exam than it looks: truss `0aad0d` passed 75 of 75 there, and the same agent under a Sol
solver passed 2 of 23 verified hard tasks. A cycle series is the independent evaluation of a real run, in
which each cycle measures the harness exactly as the run left it at that point. An early cycle is expected
to be incomplete (c01 may lack an operating guide, name an analyser never installed, or read a field the
pack does not publish), and it still solves; that incompleteness is what the later cycles climb away from.
So never repair, complete or back-port a cycle's bundle or substitute a later state. Record a differing
condition in the sweep's caveats and read the results through it. A low score on an early cycle is the
expected signal, and only a non-result is re-solved. A run the environment cut short keeps every level
measured before the cut, and two runs of unequal length are compared over the shorter one's elapsed
window, named in the comparison.

During the beta, explicit Codex or Claude credit exhaustion is a normal interruption: preserve the results
and classify the affected work from its receipts. Only an explicit exhaustion message counts. A generic
429, a timeout, a crash, an authoring stall or an unexplained refusal is not proof of no credits, so
investigate what actually failed.

The controller's terminal codes are a closed set of eight (`LOOP_TERMINAL_CODES`,
`src/run/loop-terminal.ts`): `completed`, `stopped`, `fixed-product-boundary`, `build-failed`,
`candidate-held`, `budget-limited`, `environment-blocked`, `operator-interrupted`. Only `completed` says
the run settled its question. `fullrun` exits 0 for `completed`, 3 for `operator-interrupted`, 1 for every
other terminal, and 2 for a refused argument or a thrown run.

### What may be claimed

- **Safety:** the system refused a bad or unprovable result.
- **Mechanism:** the intended branch executed and wrote its evidence.
- **Capability:** verified artifacts passed the verifier under the named condition. The sentence names the
  recorded tool source and digest, because a Builder-authored checker is not independent.
- **Limit:** one fixed harness reached a pre-registered semantic level, and the deepest stable result was
  observed.

An advice packet reaching a second build proves the channel executed and nothing more; improvement needs
outcome evidence. A 21/25 first battery found no limit. Static F2 and discrimination evidence prove the
gates they run in, while a completed Built Harness task requires live evidence.

## Getting the most out of each paid run

A paid run is hours of solver time, and its only currency is recorded bytes. The loop is choose, prove,
predict, launch, watch, assess and decide; `run-improvement-campaign` owns it and `launch-run` owns the
launch. Load each launch procedure from current `origin/main`, because PR, stack and historical revisions
select product bytes and nothing else.

### Before launch

1. Choose one change from a recorded failure, wasted work or an open decision, and name its owner and a
   falsifier before writing code. Prefer deleting the competing owner, then reusing the existing one, then
   adding the minimum.
2. Prove the path cheaply (`system-path-simulation`). The strongest cheap proof is a script in gitignored
   `.scratch/` that imports the exported production function and replays it over every recorded campaign
   on disk. Before adding a refusal or a gate, count the recorded rounds on which it would have fired,
   because a gate no campaign reaches is dead weight, and one that can only fire after the thing it
   prevents is worse.
3. Before editing a prompt, render the model-visible text from a recorded round's bytes and read the
   composed result, since most defects there are one fact stated by several owners.
4. Resolve and prove the tree. Record the full source SHA, the stack head, Bun 1.4.2, the backend, model
   and effort pins and the provider route in the opening evidence. Prove every stack edge contains its
   latest parent, and run the composed gate. Pin every slot, because an unpinned codex slot silently
   measures `gpt-5.6-luna` at `xhigh`. Check the Builder and review logins and the model catalogue. The
   Builder discovers and installs tools in-session, so require neither a pre-measured tool catalogue nor a
   scripted native call before authoring.
5. **Freeze a falsifiable prediction against the resolved composed SHA, before the opening**, one row per
   moved mechanism, each with a claim a recorded count can settle ("the next battery's verified count
   falls by ≥3 of 25"), through
   `bun .claude/skills/run-improvement-campaign/scripts/prediction.ts freeze …`. "Improves" is not a
   prediction, and neither is a row Git merely dates. For a task-only experiment, name the fixed harness,
   the changed families, the prior pass count, the expected direction and what is left untested.
6. Launch the one operator-supplied prompt through `launch-run`, with the resolved full SHA as source,
   running the deterministic preflight and the launcher in the same turn:
   `bun .claude/skills/launch-run/scripts/launch.ts truss --model astra|sol|opus --source <sha>`. A pair
   is `--model sol,opus`, and any other request is `custom --prompt "<exact line>"`. The launcher is
   main's; it probes the source with that tree's own `probe.ts` and gates the shared source once. Omit
   `--project` unless continuing one, and then take it from that run's `opening.json`. Paid runs have no
   round ceiling: they continue until a typed terminal, an exhausted budget, required user input or a
   direct stop. `--stop-after-ms` is a soft boundary, in that the round in flight finishes and records
   before the stop, and provider reset waits count against it, so give a generous one, or none, when the
   question needs several rounds. "Proof run", "one epoch" and "at least one" set a minimum, not a
   maximum.

```text
bun run fullrun -- --prompt "<request>" --provider-turn-budget N [--project <id>]
  [--context <path> ...] [--expected-source <commit>:<digest>] [--run <runId>]
  [--max-iterations N] [--stop-after-ms N] [--max-builder-turns N] [--expected-tasks N]
  [--iteration-budget N|none] [--product-policy fixed] [--dcg true|false]
  [--withhold-instruments true|false]
  [--builder-backend <kind>] [--built-backend <kind>] [--review-backend <kind|disabled|inherit>]
```

`--provider-turn-budget` is required, and the run refuses to start without an explicit positive value.
`--context` is the only repeatable flag, `--dcg` defaults to `true`, and `--expected-source` is
`<40-hex commit>:<64-hex executable digest>`. A Built shell withholds each program the brief's
`checkOnlyTools` names (2026-09-30) where it resolves inside `.toolchain` by the path the verifier's
inventory takes, never a host tool, and records it as `instrument:<toolId>` in `advisorsRemoved`, so a
battery that withheld one is its own measured condition. The validator refuses an id no truth check
requires, and an absent field withholds nothing. Withholding exists because a solver that could run a
check's program passed every case round after round (truss 3e4693 ran `truss-analyze`, 7 x 6/6); its
expected effect may be slower solves rather than verified fails, since truss cb274b, whose tools ran no
check, missed only on walls (54 of 54 misses unaccepted at about two minutes a case, all 54 submitted
designs passing). The declaration is the Builder's because no rule by name or file type separates the
practitioner's compiler from a check's instrument: firmware 887c16's `arduino-cli` is an 873-byte
Builder wrapper a check declares, like its bench simulator `firmware-sim`, and compiling with it was the
solvers' only check before submitting in 8 verified fails. So `--withhold-instruments true` (added
2026-09-27), the strict operator mode that withholds every check's required tool inside `.toolchain` and
travels as `HARNESS_BUILT_WITHHOLD_INSTRUMENTS`, stays off by default. Two retired flags are refused by name
(`src/run/launch-arguments.ts`): `--max-turns`, since the Built cap is `BUILT_DEFAULT_MAX_TURNS`, and
`--turn-budget`, renamed `--iteration-budget`. `tools/fullrun-launchd.zsh` (macOS) and
`tools/fullrun-systemd.sh` (Linux) detach a run through `env -i` from one frozen environment map with
absolute `HOME`, `CODEX_HOME`, `TMPDIR` and `PATH`.

Before any battery spend, verify the opening (full SHA, clean source, prompt, budget, all three slots),
and require the Built credentials, the OS wall, the verifier profile and a build-admissible candidate,
meaning task conformance, executed task-bound controls, full-task solvability, representation coverage,
bundle identity and isolation evidence all green. A mismatch is a failed condition, not a relabelled one,
and a failed preflight is an environment non-result. The launching agent owns its findings through to
closure. It makes the first controller attempt before fixing anything, fixes a true positive at its source
and relaunches fresh, fixes a false-positive preflight with the nearest hostile test, and reports every
controller- or provider-started attempt as spent, the unsuccessful ones included.

### While it runs

Watch it quietly. While someone is reading, end each reply with `bun run runs pulse --once` from main;
when nobody is, start the detached `campaign.ts --state <file> --every 290` instead. A battery in the
middle of its solves writes nothing for long stretches, and that silence is not a stall.

What you change while it runs is for the next launch. A fix that is not an ancestor of the opening SHA
cannot reach this run (`git merge-base --is-ancestor <fix> <opening sha>` says which), however relevant it
looks.

**Two batteries off the band on the same side is a settled result.** At that point stop editing prompts
and authoring surfaces and send the operator one message holding both verified counts, the turns and
margins per case, what `wri.ts climb` says moved, and one named next experiment. Then wait. A blocked
Builder is a different matter and belongs to `builder-blocking-loop`: five refused submits in a row, a
repeated findings set, twelve checks without acceptance, two environment previews in a row, or two hours
without a submit.

### After it ends

Close out every terminal, short and zero-case runs included. Read in this order: opening, terminal, case
denominators, claims, promotions, verified traces, review spend, safeguard census, source identity, and
only then Builder prose or a session synthesis. Report the three case counts with the censored
denominator, and name the opening's full SHA.

Adjudicate every frozen prediction as `sufficed`, `partial`, `refuted` or `untriggered`. Weight the latest
two runs, since older ones measured source that no longer exists. Order batteries by claim `createdAt`,
and refuse a before/after difficulty reading that lacks the chronology and the required task-set identity.

Check `claims/` and `promotions/` before believing a round changed nothing. A refused claim leaves a
version `held`, and the next round reseeds from the last *adopted* product, so a discarded round looks
exactly like one that changed nothing. Before claiming an improvement (`attribution-and-proof`), match
every identity except the tested variable, and grade the attribution `proven`, `likely`, `mixed` or
`unproven`.

Give each valid defect one owner, and then pick **one** move: retain and measure, fix the demonstrated
owner, delete a mechanism with no consumer, investigate a consequential ambiguity, or stop. Keep the next
comparison to a single variable, and batch related fixes one PR per owner, one gate per batch.

### What has cost whole rounds here

Eleven PRs went in against model-visible text after two batteries had already shown that text was not the
lever, and none of them was in the source the next run measured. Another round went on a schema bump
inside a reader, which made every recorded campaign throw on continuation.

Until 2026-09-28 the round prompt asked the Builder to hold its submit until `harness_trial` agreed with
the aim. Rehearsals passed 96 of the 99 times the Builder had predicted a pass at ≤0.3, so the wait held
rounds back for hours and moved no battery on the band.

A gate that dies at the wall without naming a failing step is usually a process spinning the CPU, and
retrying it blindly spends another wall. Find the process first. In the same way, an empty field from a
reader run in the wrong tree, or against an open stack, is a wrong reading rather than an absent signal,
and a 429 is neither a harness defect nor proof of exhaustion; only an explicit exhaustion message is.

The 2026-09-27 runs stopped at 5.6 GiB free. Run roots nothing removed held 32.8 GiB, and one root held
532 Builder build directories at 5.8 GiB. `du` is no help in finding that, because it counts an APFS
clone's blocks as the clone's own (52 cells read as 34 GiB), so measure free space instead.

Predictions frozen after the opening cost the comparison they were meant to settle, and a climb read only
after the claim landed was read hours late, because the adopted bytes had shown the same verdict before
the battery was paid for.

## Working rules

1. **The Builder builds the whole domain product.** It owns the representation, the brief, the task
   families, the task-bound controls, the operating guide, the tool contract, the declared external tools
   and the verifier content. Never hand-write a bundle and never repair controller output by hand; a
   defect that recurs across domains is fixed in the Builder prompt, the shared contract or the starter,
   which is where it came from. Deterministic registration, submission, run-loop and evidence code is
   written once in `starters/` or `vendor/`, and domain meaning and difficulty are left to the Builder.
   Install the real public tool behind the established public interface, under `.toolchain` or on the host
   PATH. A stand-in proves conformance to itself and to nothing else, and running an authored algorithm
   through an installed interpreter does not make that algorithm independent.

2. **Use the user's prompt exactly.** The input is one short prompt plus optional public `--context`
   paths. The operator's own words are "ONLY GIVE IT ONE LINER!! THIS IS THE MAGIC OF THE SYSTEM." Never
   add a hidden plan or a custom one-test driver.

3. **The controller owns generated output.** That covers `domains/`, `campaigns/`, runs, claims,
   admissions and promotion archives: never edit, repair or commit them. The campaign tree has one owner,
   `campaignRoot()` in `src/meta/campaign-root.ts`, so never spell a campaign path yourself. An epoch is
   one authoring workspace, meaning one Builder condition, one prompt and one authoring pass. A corrected
   prompt, a different Builder or a reopened product starts a new one; a measurement round does not. A
   failed candidate never replaces the current version. A requested evaluation repair is seeded once from
   the adopted bundle, which itself stays immutable, keeps its in-flight edits when it resumes, and is
   classified by what actually moved.

4. **Do not coach the evaluator.** The operator's decision is that "evaluator coaching is reward hacking",
   and it is treated as test-set leakage. Protected: verifier stdout and stderr, issue and remedy text,
   verifier source and internal payloads, generated counterexamples, reference artifacts and per-task
   failure locations. None of it may reach the Builder, the Main Judge, the diagnosis reader, the advice
   packet or any authoring prompt. Public compiler errors and generated-module diagnostics may cross,
   because they describe the authoring interface rather than the answer. **The test is mechanical: change
   only protected detail, and every model-visible prompt digest must come out unchanged.** A passing
   measured case's own artifact is not protected, since the battery already publishes its pass bit;
   failing artifacts, reference output and F2 output stay withheld.

   Two bounded exceptions exist. `harness_trial` returns one aggregate `truth.verdict` — pass, fail or
   not-run — for the task the caller chose, over the bytes the confined Built solver submitted for it
   *unaided*; check ids, per-check results, verifier output and diagnostics stay withheld. That one bit is
   what a measured battery publishes for every task, and the only way a Builder learns its battery is too
   easy before paying for it. Until 2026-09-19 the caller supplied the solve itself, making the author the
   solver while holding the answer key. It was used twice in eight recorded sessions, and the campaigns
   that ignored it declared "at most 2 verified passes" three rounds running and then measured 6/6. The
   other is the Epoch Reviewer's `probe_check`, which rule 9 owns.

   The Built Harness still gets the public validity relation: the requirements, constraints, precedence,
   closed value sets, constants, cited authorities, candidates and declared runtime facts. What is
   withheld is a sufficient construction algorithm — search order, allocation recipe, fallback chain,
   derivation and hidden tie-break. Withholding is a property of everything the agent reads, the brief,
   the guide, the tool descriptions and the tool return payloads together, not a list of filenames.

5. **Models own content; code owns conditions.** Code owns the facts the model cannot observe, the
   decisions where the model is the subject, and anything that has to stay byte-identical across a
   comparison: source and model identities, isolation, the task condition, verification, denominators,
   claims, rollback and promotion. Models own the representation, the task families, the meaning of a
   tool, the diagnosis and the proposal for the next difficulty, and the Built Harness owns its solving
   method. Code validates declared structure and realised bytes, and it never starts choosing domain
   content because reasoning about that content looks hard. So: no autonomous scheduler, no model-written
   claim check and no deterministic classifier of harness defects.

6. **Use evidence as evidence.** Apply the identities, case kinds and denominators above. After five
   consecutive provider non-results, stop scheduling new cases: let the in-flight cases finish, record
   every unscheduled task as a typed provider non-result, and reset the count when a case recovers.

   Evidence cardinality follows the work that ran. Each authoring session writes its own execution record
   and never overwrites an earlier one, so a reader aggregates every record and picks the latest by
   iteration time rather than by append order. Builder tool returns checkpoint that record mid-turn, and
   those checkpoints, not file mtimes, are the liveness evidence. Tool evidence counts attempted,
   completed, failed and could-not-run actions separately. A submit joins its attempt by session and turn,
   never by whatever is nearby, and a clause that exists only in stdout is not durable. An admission
   packet that routes no owner is recorded as lineage by its digest alone and selects no owner; why it
   routed none is read from the packet that digest names.

   **Unknown usage or cost stays `null`, never 0**, and a turn the provider costed is kept apart from one
   the transport estimated. The reason is that streamed `usage` is not final, an interrupted turn never
   receives the result message carrying its account, and every frame repeats the whole cached input
   without a cost, so a total holding estimated turns bounds nothing. `usage.estimatedTurns` sits beside
   `reportedTurns`, and its absence on an older record means unknown.

   Order versions and checkpoints by recorded commit time, never directory order or mtime. Per-case
   external and differential grounding coverage applies only to truth-verified cases whose accepted bytes
   reached the verifier. Unaccepted attempts stay in the difficulty denominator and the runtime-identity
   census, but they cannot require a tool run over bytes that do not exist.

   Runtime safeguards are bounded log-only sensors: one best-effort line to
   `campaigns/<project>/safeguards/<runId>/SAFEGUARDS_LOG.txt` plus stderr. A safeguard never changes a
   case kind, a terminal, a route or a score, so read its line as a lead. When a recurring shape turns out
   to have a real owner, move it into source and remove the sensor.

7. **Give every decision one owner.** Actionable evidence names its producer, the exact evidence it cites
   and the active owner. An owner is one of the nine `BUNDLE_FILES` (`src/author/feedback-routing.ts`,
   under `agent/` and `correctness-model/`) or `environment`, so "which part is at fault" and "which file
   to open" have one answer, and the path's own prefix is the half a repair reopens (`ownerSide`).
   Ownership names the defective file; it is not a write mask or an automatic reset, so preserve in-flight
   work and let the accepted bytes decide attribution. A claim-only `CampaignFeedback` row keeps its code
   and path for routing and drops its free text at the author boundary. A typed finding a controller
   validator produced may keep its detail in controller-owned campaign carry, projected exactly once at
   the model-visible boundary. An unmarked finding fails closed to `generated-execution-unclassified`.
   Author-visible detail is opt-in, where the producer built it from public authoring identities: control
   ids, mutation classes, family names, declared check ids.

8. **Spend complexity only when it changes a useful decision.** Map each concept as
   `owner → live consumer → decision changed → evidence → hostile test`. Reuse readers and owners, derive
   copied state rather than storing it twice, inline a rule-free one-caller wrapper, and delete what
   nothing uses. A cut preserves isolation, identities, non-results, denominators, claims, rollback and
   controller-owned submission.

   **Take the super-Pareto form: about half the complexity for 90 to 95 percent of the result.** This is the
   one statement of the rule, and every other place that asks for the simplest path means it. When a change
   writes or rewrites a component, look first for the algorithm that needs roughly half the mechanism of the
   fuller one and still does nearly all of what it would, and take it unless the part it gives up is one of
   the guarantees just listed or a decision the recorded evidence shows it changes. It is the default rather
   than a compromise, and the reason is speed more than tidiness. The loop learns from measured rounds, and
   a component half the size is read, tested, replaced and measured again sooner, so the round that finds
   the missing few percent arrives sooner too. The separate fixed-harness difficulty session is the example
   worth keeping in mind: it prescribed a level, a family composition and a parent lineage, and across 33
   recorded rounds it never once left the too-easy zone, while the open path that replaced it prescribes
   none of that. The gate audit of 2026-09-25 took the same shape when it commented out the 21 of 50
   refusals it could not show were right, instead of refining each one.

   Measure both sides rather than asserting them. `reduce-complexity` puts numbers on the mechanism, and a
   replay over recorded inputs, or the decision the component feeds, puts one on what it still does; a trade
   stated with one side measured is a guess. Name the remainder you gave up in the commit body, so that a
   later round needing it knows it was left out on purpose rather than missed. And do not overdo it. Working
   code is not rewritten only to reach the ratio, a guarantee is never a percentage to trade, and when the
   simple form turns out to lose more than the few percent, say so and keep the fuller one.

   Complexity is not only the mechanism a line count sees, so look for the simplification in three more
   places. It can be mathematical: a closed form in place of a search, or one quantity computed once where
   three readers each approximated it. It can be an information gap closed. An explicit connection between
   two components — one owner, one schema, the data it carries stated — adds an edge to the import graph and
   still lowers complexity, because no reader has to guess any longer whether the connection exists or what
   crosses it. A published limit declared without the artifact path it bounds is the opposite case: every
   reader of the solver's margins has to guess which field the limit is about, and most guess nothing. And
   the model is a component too, so what it reliably does in its own reasoning needs no mechanism built
   around it.

   **Keep no backwards compatibility** (2026-09-22). A reader takes the current schema and version only. A
   legacy alias, a fallback branch, a superseded reader or a set member nothing produces is removed even
   if older recorded runs become unreadable, and a reader meeting an older version refuses it.

   Where a design choice is uncertain, prefer removing or widening a gate to adding a wall, an allowance
   check or a refusal. The failure actually observed here is not unchecked action; it is legitimate work
   blocked by gates that pay no rent. A gate earns its place by changing a decision correctly. Reporting
   fidelity — carrying a field through, naming a thing accurately — is not gating and always fair game.

   Code is held by the gates of **Code, lint and gates** (§3, §9, §10). **Never turn a rule off to clear a
   finding.** A mis-targeting rule is tuned only toward precision, a fixture on each side (2026-09-22).

9. **Judges advise; the verifier decides.** The Main Judge reviews only accepted artifacts that already
   carry a boolean verifier verdict, so an unaccepted, refused, non-result or missing artifact costs no
   call. There is no Judge control census: no control or bait reaches the Judge, and a new run writes no
   sample, bait or standing file, while every accept and reject control is still task-bound and verified
   through its declared check by the verifier. Each subject gets a fresh session, in groups of at most 5
   (`ANA_REVIEW_CONCURRENCY` sets another width), stopping after 5 consecutive provider errors, with a
   30-minute hard wall per turn, and the first valid verdict stands. The Judge sees the request, the bound
   public task, the artifact, the public schema and design rules, the projected tool contract and the
   declared runtime facts. It never sees the Built prompt, the solve trace, verifier output or a reference
   artifact, nor two artifacts in one prompt. Of the five `judgeDeAnchoring` rows in
   `thresholds.frozen.yaml`, two hold by construction: `commitAllTasksInPhaseZero` is the fresh session
   per subject, and `fallbackConfigured: false` is the one model with no fallback. The other three,
   `commitBeforeSeeingCandidate`, `predictionsMustBeFalsifiable` and `predictionsMustBeDisposed`, describe
   a rank-2 paired-comparison protocol that is not implemented, so keep them unbound.

   A Judge fail must cite at least 1 verbatim line of the public rules, the schema or the input, and an
   uncited fail is a protocol non-result. A cited fail of a verifier pass is a **veto**, recorded on the
   claim as `vetoed` and bounded by its verdicts, and a Judge fail of a verifier pass is re-sampled once;
   `judgeCaseKind` names how each answered case stands against the verifier, and every reader counts
   by it. Vetoes and disputed fails go to the Epoch Reviewer, and a settled veto projects only
   its count and family. The Judge sets no score, acceptance or adoption; disagreement with the verifier
   is a reason to inspect it.

   The diagnosis reader (`src/review/diagnosis-reader.ts`) reads the solver's own traces across the
   battery. It is offered at most 6 standing solve issues — verified fails, unaccepted submissions and
   non-results the environment does not own, worst share first (`diagnosableIssues`) — and never a Judge
   disagreement, because that is about the evaluation and the Epoch Reviewer settles it. For each issue
   it sees at most 4 failing solves, distinct failure sequences first, and at most 2 passing ones of the
   same family, compiled by `compileSolve` (`src/review/solve-steps.ts`) into numbered steps such as
   `c04.s7` and `c04.end`, beside the harness's walls, its tool descriptions, its guide and a census of
   tool use. Its tool `record_diagnosis` takes an owner from `DIAGNOSIS_OWNERS` (a harness file the
   solver reads, or `solver` for no change), a first failure boundary, a cause and a falsifier. It
   refuses an owner the solver does not read, a boundary that is not a shown step of a named solve, a
   contrast that is not a step of a shown passing solve, and any text naming a task. One reading may
   cover several issues. The host records how many sampled solves the reading holds for and whether it
   cites a contrast, and grades nothing from them: until 2026-09-29 it turned those counts into a
   confidence label. The reader opens no `verifier.json`, Judge record or accepted artifact, so
   protected detail cannot move its `promptDigest`, which is why its boundary and falsifier may reach
   the author. The advice renders them with support counts, and the cause stays in the record for the
   Epoch Reviewer. The named owner routes nothing. Treat a timeout as diagnosable unless the evidence
   gives it to the environment.

   The Epoch Reviewer runs once per measured-condition digest that it has read to completion; a review
   that failed or was cut short runs again at the next measurement of that condition, though the
   findings it had admitted are kept. Its finding is either a *defect*, which names the file at fault
   and is advisory or blocking, or an *observation*, which names a file or none and is always advisory.
   Blocking needs a demonstrated violation of the request or of a declared requirement; one review may
   record several blocking findings, and how many owners a round reopens is the continuation's decision
   (`src/run/next-move.ts`). Its orientation states the band placement through `placeOnBand`, as the
   climb readout does, so that the one component reading the measured tree against the request knows
   what the round aimed for. Until 2026-09-18 it saw the counts alone and was asked about "a perfect or
   near-perfect battery", which left the whole `over-aim` zone, whose name says no limit was measured,
   with no stated reason to inspect anything. The placement is a reason to look and never an obligation
   to find something: a review at any placement may end with nothing demonstrated, and say plainly
   that the tasks were easy.

   The closing message is recorded as its `report`; its tools refuse only what a decision or rule 4 reads,
   so a long claim or a fifth citation is recorded rather than bounced.

   A finding about easy tasks names the obligation of the request they leave undemanded, owned by
   `correctness-model/tasks.json`, and may carry a `demandGap` of capability-unexercised,
   sibling-values-only, limit-cleared-widely, rule-outside-request or published-scenario-only; the
   reviewer records one when it has shown the gap, not because the score was high. The fifth came on
   2026-09-29, after two Opus firmware rounds each met three held submits over one finding, and one
   of them spent about two hours on the wrong repairs: the checks ran only the published scenario, so a sketch replaying the published timeline without
   reading its sensors passed, and the finding crossed as "a capability no task exercises", which
   sent the Builder to widen scenarios instead. Until 2026-09-29 the host enforced more. It split
   the request at commas, semicolons and "and", asked for a `Clause N:` line per piece, and above the
   aim demanded either a `tasks.json` defect or a family-by-family account, which it checked by whether
   each family's name appeared in the report, re-asking once when either was missing. That graded
   wording rather than examination, and a task-set finding forced out of a full pass presses the author
   to add rules the request never held, so it went with `review-duties.ts`. Earlier `tasks.json`
   findings over the same task set are still shown again (`earlierTaskFindings`), so an unchanged task
   set is not read as settled.

   The reviewer may also execute. `probe_check` takes one accept control, one rooted path already in its
   artifact (`$.items[0].value`, read through `jsonPathTokens`) and one change: either a replacement
   value, or a `find` that occurs exactly once in a text leaf together with the `replace` that takes its
   place. A call sending both or neither is refused. The edit exists because a field holding a whole source
   file can exceed the `VALUE_MAX_CHARS` of 4,000. It runs the declared checks over the original and the
   changed artifact and reports which checks moved, at most 8 per review (`PROBE_BUDGET`,
   `src/review/review-probe.ts`). A measured review's probe runs only while the `.toolchain` still matches the
   tree digest its battery recorded, the test `read_source` applies (`toolchainReach`). A probe whose original
   did not pass, or whose change reached no verdict, is not evidence. Every defect owned under
   `correctness-model/` other than the task set cites its `probeIds`, or `[]` for a source-only reading, and a
   `probeDirection` (false rejection or false acceptance) is recorded only where some cited probe shows it
   (`probeShows`), reading the named check's own state on each side: pass, fail, no verdict, or not applicable
   to the control's task. So a probe that moved nothing never reads as a check refusing a valid answer, and
   one whose check did not apply or reached no verdict never reads as a check letting an invalid one through.
   An `agent/` defect is not asked for probes, since a probe runs the declared checks and says nothing about
   the agent. Severity reads that one finding's evidence and nothing else: an observation is advice, and a
   defect keeps the severity the reviewer chose, where `blockingEvidence` refuses a blocking one without a
   demonstration of at least 40 characters and citations quoting pages the review was returned, whichever file
   owns it. Until 2026-09-29 an `agent/` defect also needed a cited probe to block, and any probe would do, so
   an unrelated evaluator probe decided whether a tool defect reopened a working product. Neither how often a
   check was named before nor the order a review records its findings moves it. Until 2026-09-28 a first
   recurrence of a check's name raised a finding and two held it at advice, so a firmware review whose two
   probes showed a check refusing the published default pins was admitted as advice: that check had been named
   in four earlier reviews, and a naming count cannot tell two defects on one check apart. What crosses to the
   Builder is what a finding found and where: its owner, check, schema path and public inputs, its
   `demandGap`, the probes it cites with the checks they moved, and the direction they show
   (`epoch-review-public.ts`). It carries no repair method; the Builder chooses the repair. Until 2026-09-29
   the projection attached one from a fixed table (`GAP_ACTS`, `publicAct`), and a task-set defect was refused
   without a public input to vary.

   A finding settles a Judge disagreement only by naming it: `record_finding` takes `settlesCases`, the task
   ids of listed vetoes and disputed fails the finding decides, and the host records one disposition per case,
   `against-check` for a `correctness-model/` defect on the deciding check whose cited probe shows it the way
   the case says (until 2026-09-29 the host took the reviewer's word for that direction and asked for no
   probe), and `check-stands` for an observation backed by a probe that moved the check. It refuses a
   case that is not listed, not decided by the named check, not opened with `read_source`, already settled, or
   of the wrong kind for the probe's direction, since a false rejection cannot settle a veto, and the record
   keeps the ids still `unsettled`. Until 2026-09-29 opening a contested artifact was enough, so one settling
   finding attached its sentence to every defect naming that check, including ones that adjudicated none of
   those cases. A family's Judge issue stops standing only once every case it counts is settled. A review that
   ended incomplete or failed hands its findings on at advisory severity, with one sentence saying it did not
   finish, and it settles no case and disputes no issue; until 2026-09-29 it handed the Builder nothing,
   however much it had demonstrated before its provider dropped. Only a `correctness-model/` defect may
   dispute an issue, and a dispute keeps the issue counted while withholding the agent advice. A measured
   review is offered the standing issues of the register its own battery advanced on host and Judge
   evidence, each with the last diagnosis recorded for it, so an issue that battery raised first is
   disputable in it; until 2026-09-29 it was offered the register before the battery, and a dispute on a
   new issue landed a battery late, after a build had rebuilt around it. Reusable
   algorithms, bounded search and the host's margin table on published limits are legitimate solving
   support. A tool, program or guide line that analyses a candidate the way a check does, through the
   check's code or a copy of it, its instrument or a verdict, is not: until 2026-09-30 it counted as
   support, and 236 of 298 recorded batteries passed every case, every harness whose solver could run a
   check among them; the misses without one were walls, not failed analyses (`PUBLICATION_CLAUSE` in
   `src/author/builder-start-prompt.ts` records the measurement). While the measured `.toolchain` digest still
   matches a recorded tool, the reviewer may read any text file of that tree by name (`toolchain:<path>`,
   installed packages included, each at most 1 MiB) as long as the file still counts as the recorded tree
   digest took it, and a directory reads as its listing.

   An authoring review also reads the bytes of the round's failing blind rehearsals beside their
   verdict; the Builder saw only the verdict, and passing bytes reach it through `context`. It reads the
   previous review's probes too, as re-runnable calls (`carriedDemonstrations`,
   `src/review/review-carry.ts`), and each is a lead until it is re-run over the current bytes.

   Reviewer spend is not an axis for savings. The reviewer is the one component reading the measured tree
   against the request, so make it smarter and let the build iterate. Cut its text only when the recorded
   corpus shows the text bought nothing, never by token count.

10. **Accepted bytes determine attribution**, never the loop's name. The frozen vocabulary is
    `task-probe | harness-intervention | evaluation-correction | repeat | new-baseline`.

    - *Build / harness intervention* is either no adopted harness yet, or a continuation that changes the
      product: the representation, tools, families, artifact schema, verifier or solve path.
    - *Evaluation correction* keeps the agent, the public exam, the rules and the bound submission schema
      fixed while correcting the evaluator, the controls or the private expectations. Anything broader is
      build.
    - *Task probe* keeps the agent, representation, tools and scoring program fixed (`brief.json` and
      `evaluator.ts` with its imports, which is `scoringHash`) and changes the battery, its controls, the
      reference solve and the tests. Conformance, controls and F2 rerun before measurement.
    - *Environment recovery* keeps the product bytes fixed; a provider coming back is not a product
      improvement.

    There is one authoring path. The fixed-harness `DIFFICULTY.json` session, which prescribed a level, a
    family mix and a parent lineage, never left too-easy in 33 recorded rounds and is gone; what it taught
    survives as the task freeze and the changed public-input subset. A measured candidate with at least 1
    verified case and a written claim is selected through the retained-product transaction. A
    zero-verified or environment-blocked one is held (`candidate-zero-verified`, `candidate-promotion.ts`)
    and never becomes the baseline, and its kinds still reach the next round through the advice packet. No
    candidate contests the current harness. The first admitted build is selected at adoption
    (`selectInitialProduct`, `src/run/product-versions.ts`), and measured whatever it verifies.

    Recorded solves are reused where the exam did not move (`src/run/battery-reuse.ts`). An evaluation
    correction, wherever the battery it corrects sat on the band, with identical agentHash, task count and
    public task digests under the same solving condition (the backend pin, the Built effort every case
    recorded, the run condition and the tool tree: `solverConditionMoved`), *regrades* the recorded
    submissions (`readRecordedSolves` → `gradeCase`) instead of solving them, and records `regrade: {of,
    reused, changedPasses}`, because a correction moves the evaluator alone and a fresh solve would add the
    solver's own variance to that one variable. A battery the environment cut short, meaning every non-result
    solver-side and environment-owned, the hashes and the solving condition unchanged and fewer than
    `environmentBlockedRounds` prior remeasures, is remeasured before any rebuild: `censoredRemeasure`
    re-solves the censored cases and regrades the rest, and a moved condition sends the round to rebuild. A
    *repeat* posing the exam an at-or-above-aim battery already sat is measured afresh and recorded as
    `repeat`, because a second solve can show whether a full pass was reliable where a regrade only reads the
    same attempts again; the submit refusal it met until 2026-09-29 (`identical-exam-over-aim`) never fired in
    the recorded corpus. A repeat is the adopted product measured again, so promotion selects it like any
    measured candidate with a verified case and its packet becomes the next round's evidence, whether the
    Builder moved a note or nothing at all. Until 2026-09-29 it was held as `stale-task-identity`, its packet
    stayed unpublished and three of them ended a run `candidate-held`, while an unedited resubmit was told
    "Accepted" and then refused as `candidate-unchanged`; a repeat that verified nothing is still held on its
    own battery.

    The rebuild advice packet is deterministic (`analysis/<runId>-rebuild-advice.json` with
    `rebuild-advice-latest.json` beside it), bound by digest to the iteration that consumes it, and
    rendered once per rebuild kickoff from recorded rows, Judge reviews and admitted aggregate findings,
    never per-case ones. A finding a bundle file holds reaches the kickoff as feedback to that file
    instead, and one on the owner and subject (`namedSubject`) of a finding the previous battery admitted
    says how many consecutive batteries have admitted it and since which. Until 2026-09-29 each
    recurrence read as a fresh finding: 48 of the 171 routed findings then recorded repeated the battery
    before, and one on `correctness-model/brief.json`'s `wiring-behavior` check ran twelve. It states each issue's owner, not what to rebuild. Each issue keeps a stable id
    and states its recorded facts rather than a verdict on them (`issueFacts`, `rebuild-advice/v11`):
    where it was first and last seen, how many complete rechecks have not observed it since, whether it
    was seen again after an absence, which condition moved when a recheck was not comparable, and
    whether its family left the set, a review disputed it or a review settled it. Until 2026-09-29 the
    register read those absences as `tentatively-fixed` and then `confirmed-fixed`, which is a
    conclusion an absence cannot carry, since an absence says the failure did not show and not that
    anything repaired it. A family leaving the set proves no fix at all. An absence counts as a complete
    recheck only when every case of the family was truth-verified under the condition that observed the
    issue: the same tasks, hidden expectations included, `scoringHash`, check tools, Built pin,
    recorded reasoning effort, isolation and run condition, which carries the host's share of the Built
    prompt (`src/author/issue-condition.ts`). An effort or a procedure the cases never recorded
    compares with nothing, and the solver walls in `agent/config.yaml` are left out, because raising
    them is a fix. A probe that moves only a hidden limit asks the verifier another question while the
    solver reads the same bytes, which is why the hidden fields are in. A recheck that lost a case to
    a non-result or an unaccepted attempt carries the issue unchanged, because the lost case may be the
    one that failed. Under another
    condition the recheck is named not comparable and counts neither way, because swapping out the failing
    tasks or blinding the evaluator makes an issue vanish without repairing anything. An evaluation
    correction therefore leaves its rechecks not comparable even when it regrades: the scoring hash moved, and
    nothing settles an issue as corrected. A dispute carries onto a re-observation only under the
    condition that recorded it, since an issue's id names where a failure showed and not what caused it,
    and a diagnosis never carries onto a re-observation at all: it reads one battery's traces, so the
    battery an issue line names and the one its diagnosis read are always the same.

    `--product-policy fixed` permits measure or stop and refuses build and rebuild. A campaign runs
    uncapped unless the operator sets `--iteration-budget N`; there is no launch default (2026-08-19).
    `ControllerLedger` (`src/run/controller-ledger.ts`) reserves the campaign and provider-run quotas
    together before a model call. A started call stays charged across interruption, cap changes and
    epochs, and only an unstarted reservation may be cancelled. `budget.json` binds the database identity,
    and missing or corrupt state refuses rather than resetting the spend. The loop ceilings live in
    `src/critic/policy.ts`: `environmentBlockedRounds 3`, `buildFailedRounds 3` and
    `noopSubmitStrikes 3`. None of them reads a placement; the off-aim streak that once stopped a run is
    gone ("Tried and taken out", under "Goals and the climb").

11. **Distinguish task demands from coverage and repair.** A level is an ordinal label, not an
    explanation. New hashes, ids, family names, longer descriptions or more scenarios prove no harder
    problem, so the Builder names the public requirement that changed and the reasoning interaction it
    adds. Stronger checks and broader coverage may be worth having without making the solution any harder,
    and a repaired evaluator is a new condition rather than a difficulty advance.

    **The demand comes from the request's own field, never from a rule the Builder adds.** Five runs read
    on 2026-09-24 showed three climbs that only looked like climbs. The firmware Builders invented duty
    and report rules, so a failing battery measured the solver's reading of the author's wording. The
    truss Builders lengthened a listed set of load cases and called it a tier. And both shipped solver
    tools reporting every margin a check reads, so the solver could propose, read the failing state and
    adjust. None of these, nor tightening a feasible limit toward a stronger witness, proves a task harder
    or easier by itself; blind measurement decides, and its one reading of the third, six truss tasks, did
    not show it (prior 10). Tightening stays legitimate, since a slack limit is a finding about its
    reference, and a longer search stays an optional method; what the evidence does not support is
    leading with it as the route to difficulty, as `examples.md`'s list still does ("Open gaps"). Each
    prompt says it once: the Builder system prompt owns the clauses, publication and the definition of
    depth among them, `examples.md` the optional routes to a target the solver does not reliably meet,
    `roundPrompt` and `renderBatteryContract` when to submit and what a witness proves, and the climb
    readout's no-limit line asks for the changed requirement and its reasoning in the notes.
    `test/helpers/duty-overlap.ts` holds the kickoff, the round prompt, the contract, the full-pass
    readout and the sizing sentences to that: none may restate a sentence the system prompt carries. The round prompt asks for a submit once a clear preview says the candidate works, because the
    measured battery, not a rehearsal, decides where it lands (`WITNESS`), and nothing holds a submit on rehearsals
    (the 96-of-99 history is under "What has cost whole rounds").

    Battery size and the difficulty decision are climb mechanisms, and "Goals and the climb" holds both:
    the sizing gate, the placement, the facts stated beside it and who reads it.

    Declared variation proves coverage, not difficulty or verifier dependence. 18 firmware tasks varied a
    declared path while every one of them published the one display the request had named, which is why no
    rule asks a family's tasks to vary.

    A round no longer pre-registers itself. Until 2026-09-29 the Builder wrote `EXPERIMENT.json` before a
    preview or submit, and by then it changed no score, gate or byte identity: its schema refusal had
    become advice on 2026-09-28, and what was left was a comparison of the families it named against the
    families whose public tasks changed, served back to the Builder, the Epoch Reviewer and the run end.
    That graded a declaration rather than a result, so the file went, with `src/author/experiment-plan.ts`
    and `src/review/round-plan-lines.ts`. What a round sets out to test is the Builder's note in
    `MEMORY.md` or `SCRATCHPAD.md`, and an edit to those alone moves the commit without moving the
    candidate's condition. Attribution stays with the bytes: `candidateExperimentAuthoring`
    (`src/run/experiment-freeze.ts`) records the operation and the changed task ids of the accepted
    candidate. Changed bytes establish membership, not semantic difficulty, and with no observations the
    result stays unknown.

12. **Evaluate the requested artifact, not decoration.** Every artifact-schema root must be reached by a
    material truth check, and every advertised capability must map to checks that can fail on real tasks;
    a root that could be removed without changing the verdict is decoration. F2 runs **every** task's
    reference solve — it once ran only `tasks[0]` — and what it proves is the submission path, not
    end-user correctness. A checker-required path, suffix or entrypoint is public validity, so publish it
    in the brief and the guide. Where a checker can execute or simulate source, decide from the values it
    produces rather than from recognising one source form. Publish every comparison rule exactly as the
    truth path applies it: the counterfactual's direction and scope, any floors or minimum counts, and the
    tolerance. A binary answer can be task-conditioned evidence, but refuse a boolean certification
    constant within an affected family when no other applicable check derives it from artifact content.

    Controls are what calibrate the checks. At least 5 accepts and at least 5 rejects is an authoring
    requirement the Builder is told rather than a size the gate measures
    (`evaluatorCalibration.minimumKnownPasses` and `minimumKnownFailures` in `thresholds.frozen.yaml`,
    bound through `src/claim/calibration.ts`, and held in the starter by `test/starter-pack.test.ts`). Its
    one non-test consumer, `acceptIndependenceFeedback`, is advisory. What the gate runs is
    `validateControls` (`src/correctness-bundle/controls.ts`): every control binds a real task and names
    declared checks, joins and boundaries, and each reject's named check applies to its task. The census
    then runs every control, and a failing accept refuses the candidate.

    Build each reject from the known-correct accept for its task by changing one fact; other checks may
    fail on it too (2026-09-14). A reject that does not fail its named check is no discrimination
    evidence. One deliverable passing every sibling task is not refused, because that is what a ladder of
    tightening limits looks like, and the transplant census that refused it until 2026-09-25 made Builders
    invent constraints to get past it.

13. **One representation contract before tools and truth depend on it.** The public artifact schema, the
    writer tool schema, the DraftStore, submit compilation, the F2 witness and the verifier input must
    agree on what is required, what is nullable and what counts as equivalent, with no undocumented
    `""`/`0` sentinel where the schema promises `null`. A valid artifact the writer cannot express, or a
    writer value the verifier reads differently, is a representation defect. A task probe may rewrite the
    accept corpus, but every new accept fits the adopted schema, whose recompiled hash stays
    byte-identical. Conformance opens every task and requires one stable worker registration and tool
    schema across the battery. Repair the shared contract rather than teaching the mismatch in prose.

14. **Keep model-visible text small and single-owned.** Stable domain and safety framing goes in the start
    prompt, one controller-derived correction in steering, bounded continuation at a stop or submit
    boundary, and public result shaping in the live tool result. State measured public runtime facts where
    they save blind discovery, and never repeat one duty across the workspace card, the body, the closing
    paragraph and the tool description. A recurring interface failure is fixed in the schema, the tool or
    the contract, not with another tutorial sentence. The Builder's intent stays in its start prompt, and
    `STARTER.md` owns the loop, the gate sequence and the worked domain shapes. Starter examples satisfy
    their schemas, name only declared tools and use refusal codes the source still emits. Prompt digests
    are condition identities; a prompt test proves delivery, not behaviour.

    The Builder has fifteen tools in `BUILDER_TOOLS` (`src/builder/builder-tool-interface.ts`).
    `harness_inspect` is static and read-only, with four modes: `readiness`, `task`, `coverage` and
    `feedback`. Readiness is the whole static view in one call, a named `family` lists one it cannot fit,
    and findings past the first page are paged through `feedback` once `correctness_check` has recorded
    them. `context` (`src/builder/context-tool.ts`) takes a question and the decision the answer settles,
    and returns lines cited by document and line from five sources: the round's opening, the workspace
    notes, every measured battery, **passing** solver traces with their artifacts, and the
    `--context` files. A trace's artifact (`traces/<runId>/<taskId>/artifact`) is listed only when its
    bytes check against the evidence log, and ends in `readMargins` lines per published limit while the
    brief's `scoringHash` still matches. Failing traces stay out, because the failure sits there. Until
    2026-09-23 it read the `--context` files alone, and it was called six times in 160 sessions, always
    over an empty corpus.

    `harness_trial` solves one `taskId` blind with the measured Built solver — its runtime, turn cap,
    solve wall and confinement — graded under the harness's own `check_seconds` and `tool_run_seconds`. It
    returns the rule-4 verdict, whether it submitted, the turns used, the minutes against the wall, tool
    calls, cost and any typed non-result. Each costs one measured case from the provider budget, which is
    the only bound on how many a round runs, and writes under `<campaignDir>/rehearsals/`. A passing
    rehearsal's trace and artifact, with its margin lines, join `context`'s traces, and verdicts and
    effort are read back from the execution record. Only parameterless `submit` freezes and accepts
    candidate bytes.

    `public_source` and `verifier_workshop` are the two tools rule 1 depends on without naming, and an
    agent that has not met them tries to install a toolchain with `bash` and gets nowhere. `public_source`
    fetches an exact HTTPS address, brokered by the controller, into an offline `.oss` workshop under its
    digest. `verifier_workshop` (`inspect`, `read`, `write`, `run`, `export`) unpacks, builds and
    smoke-tests there, in one deny-default cell with its own PATH. The wall runs both ways, which is the
    part worth remembering: workshop commands cannot read the candidate, workspace tools cannot read
    `.oss`, and text crosses only through the workshop's `write`. `export` is the one outbound crossing —
    one binary, script or package file of at most 64 MiB into `.toolchain`, keeping its executable bit,
    returning the digest and installed path, and refusing an existing destination, because an upgrade is a
    workspace edit. A successful run proves which bytes executed, never that the tool is authoritative.

    `harness_reset` works only on a reopen rebuild and refuses otherwise, so it is no escape from a bad
    round. It returns one surface to the starter seed: `agent` keeps the tasks, controls and checks,
    `correctness-model` keeps the tooling, and `all` starts over. It runs once per scope per reopen, in
    one controller commit that leaves every replaced byte in Git, making rule 10's harness intervention a
    clean start.

    **`agent/config.yaml` owns each harness's runtime walls**
    (`src/correctness-bundle/harness-config.ts`). The Builder is told it exists, not its content.

    | section | defaults | host limits |
    | --- | --- | --- |
    | solver | `solve_minutes 120`, `max_turns 24`, `shell_timeout_seconds 300`, `shell_timeout_max_seconds 900` | ≤10×, ≥0.1× |
    | gate | `reference_solve_seconds 120`, `census_minutes 30`, `check_seconds 600`, `tool_run_seconds 300` | none |
    | battery | `solve_concurrency 3` | ≤10× |

    The solve wall is part of the measured condition. Below a tenth of the default the solver never sees a
    command return, so the battery would grade the wall's submit of a first draft. The floor
    (`harnessConfigIssue`) refuses admitting a candidate or starting a solve, but never reading a recorded
    bundle, so a replay still grades one that declared less. The Built prompt (`builtSystemPrompt`,
    `src/solve/built-starter.ts`) names its closed roster, the solve wall and what the wall submits, and
    leaves the method to the solver. Until 2026-09-29 it also asked the solver to grade every candidate,
    reach a tight limit by a bounded search and widen the worst margin, which turned every task into
    propose, grade and adjust, so a battery measured that loop rather than the solver's own way of solving.

    Every fresh `tools-spec.json` gives the solver a shell through `presets`: `"files"` for a file-shaped
    answer, whose draft files become the answer and which already carries the shell, or `"shell"` beside
    an artifact writer, and never both. That is the decision of 2026-09-14, taken after truss epochs kept
    declining `files`. Read a battery's roster before blaming it for a failure. A Built turn is bounded by
    silence, one model call plus one command at its ceiling. At the whole-solve wall the host submits the
    held draft through the solver's `submit` (`submitAtWall`, `src/backends/pi-built.ts`); an accepted one
    is graded, and otherwise a solve that called a tool is an unaccepted attempt with its traced calls,
    not a non-result. The brief's `checkOnlyTools` (2026-09-30), or every check's tool under the strict
    `--withhold-instruments true` (default off), closes those `.toolchain` instruments to the Built shell
    and records `instrument:<toolId>` in the run condition, so it is a condition of its own.

    For generated tools, `text` is the whole model-visible result and `details` is host and trace
    evidence, so every promised value belongs in `text`. A result that drops bytes says where the rest is,
    because a draft can be read again and a command's output cannot. The store is `.bash-output/` in the
    Builder workspace, dot-prefixed so listings skip it and never fingerprinted; `.oss/.run-output/` for
    the workshop; and `.shell-output/` in the Built session home. It is never the host temp directory,
    where a later solve could read it. The notice (`cutOutputNotice`, or pi's own) names the lines shown,
    the stored file and the tool that pages it, and a failed store costs the pointer, not the result. A
    cut grep or find ends with `moreRowsNote`. Protected output is never stored or pointed at.

    A Builder session has no default wall (`HARNESS_BUILDER_SESSION_CAP_MS` sets a positive-integer one),
    and a Builder bash install may run for 2 h. An authoring review starts when a host tool call
    completes, never inside one, and runs beside the session (`AuthoringReviews`,
    `src/run/authoring-review.ts`) over frozen bytes. After a clear `correctness_check` whose agent,
    correctness-model or battery bytes changed since the last review, it reads that check's snapshot;
    after **40 min** without a review (`REVIEW_INTERVAL_MS`, `src/gate/review-clock.ts`), it reads a
    workspace snapshot taken at the triggering call. Edits made while it runs are not read, and a draft
    that cannot be frozen is not read live instead; the clock stays due. One review runs at a time, and
    the clock keeps only the latest validated product, so triggers coalesce rather than queue. It restarts
    when a review ends, and its findings ride the next tool result.

    **Only submit waits** for a running review, for at most `READER_DEADLINE_MS`, 1 h
    (`src/review/review-reader.ts`). An unread *blocking* finding comes back in place of the verdict and
    the call counts as no submit (`review-unread`), so the same bytes sent next are a first submission.
    Advisory-only reviews hold nothing, because an advisory finding is advice and rides the next result; up
    to 2026-09-27, 34 holds in 19 chains cost ~79 min, two campaigns held for all-advisory reviews. No
    probe budget or no-submit strike bounds reconnaissance before the first authoring change.

    A round runs as a Codex goal (`src/author/builder-continuation.ts`). Each continuation restates the
    request and the round's facts, a round has no turn cap unless `--max-builder-turns` sets one, and
    three turns without a successful tool call end it as the retryable `no-progress` on the same
    conversation. After 8 turns or 2 h without a submit the round clock asks for authoring, or, when a
    clear `correctness_check` has had no submit since, states its age in minutes instead; the clock also
    states host load. The byte-identical resubmit strikes remain.

    **One Builder conversation spans the controller run** (`src/author/builder-conversation.ts`). A
    settled round pauses its session while the controller measures, reviews and advises, and the next
    round resumes it provided the system prompt, every tool schema and the transport are unchanged. The
    session was opened on stubs routing each call by name to the open round's tools, so a call between
    rounds is refused. A resumed round's first message says how the last round ended and where it now
    works, and re-sends the notes block when the workspace is new to the conversation, because each
    measured round reopens under a new pass and compaction cuts the opening turn first. It gets no list of
    earlier attempts and standing refusals, since each refusal already arrived as a submit result; only a
    fresh session gets one. Compaction summaries are recorded with their token counts in the prose capture
    (pi's `compaction_end`, or the CLI transcript on the Claude route) and served to no model. A round
    that threw, a changed contract or a closed transport opens a fresh session, and the run's settle
    closes the last one. Per-round bounds stay per round: the turn limit, the rehearsals, the submit
    strikes, the review clock and the execution record. A process restart loses the conversation, because
    nothing about it is durable.

    `correctness_check` runs submit's exact validation sequence, census included, on the immutable
    snapshot, as often as the bytes change. A verdict is remembered for identical bytes; a check that
    reached no verdict, a runtime non-result among them, or a gate that threw or the host refused, is
    forgotten and runs again. Preview and submit share an in-flight gate in either order when the
    candidate and installed-tool identities match, and submit reuses only a clear result. A refused
    candidate repeats by controller-owned candidate identity, not by workspace commit. **Never cache a
    runtime non-result as a verdict.**

15. **Stop honestly when the environment produces no evidence.** A battery of typed non-results creates no
    claim and gives a rebuild or a probe nothing to work from, so do not remeasure a dead provider merely
    because rounds remain. The controller gives transient recovery a declared bounded allowance and then
    records `environment-blocked`. A provider limit, a missing credential, an unsupported catalogue model,
    a spend limit, a provider timeout or a sandbox refusal belongs to the environment owner, never to the
    task author.

    In F2, a controller deadline reached before the generated-tool worker is ready, while it waits on a
    request, or while it closes without an accepted submit is a host non-result, while a worker that
    answered its handshake and then broke protocol is a representation defect. A case the host broke gets
    one fresh attempt on the same bytes in the census, and only a second host non-result stands. A census
    whose only blocking fact is such cut-short reference solves keeps the session and the run
    (`endsSession`): the refusal costs no strike, and the next submit of the same bytes runs the census
    again, since a host at load cut them rather than a dead environment (887c16, 2026-09-30). Once the
    host holds what it needed (an accepted submit, or every conformance probe settled), the generated-tool
    worker's host-marked close-handshake timeout (`closeHandshakeTimeout`) is cleanup evidence, voiding no
    case and refusing no candidate, in a battery case, in F2 and in the probes alike; every other close
    failure of that worker keeps its type. The Built model worker is the host's runtime rather than the
    Builder's bytes, so after an accepted submit any way it stops (a close timeout, a silence wall, a
    crash) is recorded on the runtime boundary and the submit is graded, unless the controller cancelled
    the case. Without an accepted submit, either worker's failure remains a non-result. At claim time a solvability-witness non-result gets one fresh execution, for `sandbox` or
    `verifierUnavailable` only; `timeout` and `crash` stand on the first attempt. Persistent refusal
    leaves a typed finding and a missing-witness readiness clause beside the score, never turning verified
    cases into fails.

16. **Accept broad requests; apply strict evidence later.** Admit broadly sensible domains, and record the
    excluded families and the unverified capabilities rather than silently narrowing the product.
    Adoption, measurement and the claim gates decide afterwards what the evidence supports.

### The correctness model

A candidate declares `correctnessContract: "check-program/v1"`, which is the only accepted value. Each
truth check is one Boolean function in the `checks` of `correctness-model/evaluator.ts`, applicable to
declared families, reading only its declared artifact paths, its declared public input paths and its own
hidden operand. Missing required hidden data refuses execution rather than quietly making the check
inapplicable. The host runs each applicable check in a fresh confined child and builds the aggregate
verdict itself; there is no second predicate anywhere. Each check declares its evidence kind, which the
coverage rows carry. `authored` computation may name `execution.requiredToolIds`, including an interpreter
for the Builder's own algorithm, and keeps authored semantics. `external` evidence names an installed tool
as the deciding instrument, flags and names as args, leaf-bound files or stdin as operands.

Nothing proves provenance: an installed interpreter running the Builder's algorithm is still authored
computation. What discloses it is the claim, which records the digest and the source
(`workspace-toolchain` or `host`) of every tool that ran as `verifierEnvironmentHash`, while
`externalCheckCoverage` counts host-attested launches and reject controls per check-and-tool pair. Neither
the install location nor passing the digest and argument checks establishes independence. Preserve the
selected command path through inventory, attestation and execution, because identical hardlinked bytes can
dispatch differently under different names. Keep compilation, host simulation, target execution and
hardware operation as separate scopes.

### The gate

`correctness_check` previews the gate `submit` runs, without the adoption; rule 14 owns the snapshot, tool
identity, cache and retry contract they share. It runs three stages: `bundle`, `conformance` and `gates`.
The census, F2 and grounding read recorded rows and executable bytes, never Judge prose. Refusals route by
kind to the owning `FeedbackOwner` and return to the same session. A byte-identical resubmit of a refused
candidate is a counted no-op strike, and three of them end the session as `authoring-stalled`; a typed
runtime non-result is neither cached nor counted as a strike. A close-handshake timeout after all
conformance probes have settled, or after an F2 reference submit was accepted, refuses nothing (rule 15). Provider and credential failures end the
session with a typed terminal clause. It never compares candidates or judges quality; it admits what
satisfies its own declared contract and refuses the rest with the exact finding.

The gate audit of 2026-09-25 put one question to every refusal: are we at least 98% sure it refuses
something actually wrong? `docs/gate-audit.md` indexes the survivors by kebab id, with what each refuses
and why. The first pass marked components with `Gate audit 2026-09-25 … kept` lines and archived the
unsure ones as commented-out blocks; the second (2026-09-26, stack PR #33) deleted those blocks and all
the markers, with the archived bytes at `3be43b8`. Main keeps both until the stack lands, and **a
commented-out refusal is not enforced, so never describe it to a model as a rule.**

Two ignored ledgers under `notes/` hold how sure we are of each decision, so that a later reading can take
one back without re-deriving why it was made. A change to a gate component or to the climb machinery
updates its row in the same sitting, and a row resolves only from recorded run bytes, never from the
change's own tests. The gate audit ledger, `notes/gate-audit-ledger/`, holds one card per component: what
it refused, the stages it runs at, its firings in the corpus, the 98% sentence and a falsifier. `INDEX.md`
gives 54 codes in nine groups (SH ID F2 CT GR BR DF LP WL): 30 kept, 23 commented out and 1 retired
(2026-09-28, moved to advice). `CONFIDENCE.md` scores P(right), P(stall) and P(move) against a keep bar of
P(right) ≥ 0.98 with P(stall) ≈ 0. The climb rewrite ledger, `notes/climb-rewrite-ledger/LEDGER.md`
(2026-09-28), records per change the decision it is meant to move, the evidence before it, P(value),
P(brittle), its class (a safe removal, a bet with a frozen prediction, or a risky change to a working
path), the exact revert and the halfway fallback, and a resolution log marks each row kept, reverted or
in-between.

### Identities, walls and process facts

The accepted candidate has one byte identity from submit through adoption. Product files become durable at
one retained version path before `ControllerLedger` commits the selection, the promotion evidence and the
admission together. A held row is byte-bound too, and a replay must name the same version, fingerprint and
experiment. Preserve damaged state for review.

Verifier process results and process cleanup are separate facts. A deadline bounds execution and output
collection even when a child or a pipe will not settle, cleanup keeps a durable receipt, recovery never
signals a saved PID, and a successful kill syscall on its own proves nothing. Each tool run gets fresh
private `TMPDIR` and `HOME`, and the one thing restored into them is the tool's user cache, from an
earlier gate run of the same bytes (`withToolCache`, `src/verify/engine-cell-env.ts`); a battery run
restores it and never stores. Darwin Seatbelt and Linux Bubblewrap each need their own live proof, and an
unavailable required wall is a typed non-result, never an unconfined run. A controller removes the
`ana-quick-run-*` temp root its launcher made when it exits, and only a SIGKILL leaves one behind. Each
Builder shell call gets its own `ana-builder-bash-*` `TMPDIR`, removed when the call settles. A closed
verifier scope removes every cell that no pending receipt holds.

Builder access is stated once per backend, through the host-controlled file and command tools. It may read
the workspace, the public inputs, prior traces, the host toolchain paths, compiler scratch, the
`src/solve` and `src/meta` authoring interfaces, `starters/`, `README.md` and this file
(`src/builder/candidate-isolation.ts`). No prompt carries this file and no backend loads it as instructions,
but a Builder can open it (2026-09-30). It may not read controller evidence, including evidence
created after the session started, credentials, other accounts, or `src/correctness-bundle`, `src/verify`
and `src/gate`. The Built Harness has a narrower file wall but outbound network, so that it can fetch a
toolchain into its private home (2026-08-15, reaffirmed 2026-09-06). The controller brokers each
public-source hop: the hostname resolves once, the address must be public, and the request is pinned to it
with SNI and Host bound to the real hostname, at most 5 redirects, 64 MB and 120 s. The
destructive-command guard is a safety net, not isolation or evidence; a recursive remove of a relative
workspace tree and a discarding checkout or restore of the session's own file both pass its refusal
(2026-09-14).

### Run configuration

A run has three model slots, set with `--builder-backend`, `--built-backend` and `--review-backend`. The
kinds `codex`, `openrouter` and `claude` work on all three, and review also takes `disabled` or `inherit`,
which copies the Built slot's kind, model and effort so that the review runs the battery's condition. The
Built slot needs a slug the Pi catalogue names, so that its evidence says what was measured. One review
pin serves the Main Judge, the diagnosis reader and the Epoch Reviewer; operator names say `review`, while
the evidence keeps `judge:"off"` and `judgePin`. Every slot resolves its provider, credential and model
through `src/backends/pi-providers.ts`. The Builder and review slots run in-process on one pi host session
(`src/backends/pi-session.ts`), each with its own tools and framing, and the Built slot runs pi in its
confined child. The Builder session persists across rounds (rule 14).

Kinds live in `.harness/backends/<project>.json`, layered per slot over `default.json`, which in this
repository sets all three slots to `claude`. The review slot is where an absence is easy to misread.
**Dropping the review key does not disable review**; it falls through to `default.json`. Only a review key
absent from both layers with no `HARNESS_REVIEW_BACKEND` yields
`{enabled: false, source: "unconfigured"}`, and `{"review":{"disabled":true}}` yields the same disabled
slot recorded as `operator`. Both run no reviewers and differ only in the recorded reason. An empty
`{"review":{}}` is refused.

Models and efforts come from `CODEX_{BUILDER,BUILT,REVIEW}_MODEL` and `CODEX_*_REASONING_EFFORT`, or their
`CLAUDE_*` equivalents. **An unpinned codex slot defaults to `gpt-5.6-luna` at `xhigh` on all three
slots** (`src/backends/resolve.ts`), a condition no table names, so pin it. Each effort is checked against
the thinking levels the pi catalogue lists for its model, with no provider call. The OpenAI-completions
route pairs `OPENROUTER_API_KEY` with the OpenRouter address, or `CUSTOM_ADDRESS` with `CUSTOM_API_KEY`
and a `CUSTOM_CONTEXT_WINDOW` ≥ 16,384 output + 8,192 reserved input tokens.
`--withhold-instruments true|false` travels as `HARNESS_BUILT_WITHHOLD_INSTRUMENTS`, which `fullrun`
always sets, onto the Built slot alone. Every opening tuple must match the intended condition before
battery spend; mixed slots are a separate condition. Export an adopted bundle with
`bun run harness -- export <domains/slug> <dir>`, then `bun run solve` and `bun run check` on the
controller's own paths.

Claude credentials resolve process env > `.env.cloud` > `.env.local` > `.env` > the stored login file, and
`bun run login -- status` names the winner. Every Claude slot presents the one `CLAUDE_CODE_OAUTH_TOKEN`.
`claude setup-token` mints for the account the browser is signed in as, not for the alias or config
directory in front of it, and session limits are per account.
## Code, lint and gates

Every rule below is an `error`, and `bun run lint` passes `--deny-warnings`, so oxlint's default
`correctness` category is fatal too, even though it is on only as warnings (`.oxlintrc.json` sets no
`categories`). Both hooks run lint, which means breaking a rule costs a round trip through the hook. Each
plugin rule's source (`tools/oxlint/{ana,anti-slop}/rules/<name>.ts`) holds its argument, its exemptions
and its measurements, so read it before arguing with a finding. The counts move whenever a rule lands, so
read them off each plugin's `index.ts`; when this was written there were 40 `ana` and 17 `anti-slop`
rules, 57 in all, and 15 of them carried fixers.

### 1. Commands, hooks, CI

`bun run gate` runs nine steps in order: runtime, format, ui-deps, typecheck, lint, source-policy,
complexity, ui and tests. With `--at <dir>` it runs whole over a checkout, which is how pre-push proves
branch heads, and with `--static <dir>` it leaves out `ui` and the suite and runs the tests importing a
changed file in their place. `bun run lint -- --strict` runs oxlint, both plugins and the not-slop ledger,
and fails on plugin findings (§3). `bun run lint -- --fix` applies the 15 plugin fixers and oxlint's own,
so read the diff it leaves. `bun run format` writes with `biome format --write .` and `format:check` only
checks, while `bun run typecheck` is `tsc --noEmit` on TypeScript 7.

Tests run through `bun run test -- <paths…>`, the walled suite runner, and never through a bare `bun
test`; a path that does not exist is refused rather than skipped. `bun run simplify` runs the whole-tree
scans of §8 through `tools/oxlint/simplify-census.ts`. `bun run not-slop -- answer <id> "<why>"` answers a
finding, and `prune` drops the rows nothing matches any longer (§3). The two policy tools treat their
arguments differently, which is easy to misread: `bun tools/loc/source-policy.ts` checks size, refused
names and unused exports and ignores any path you give it, while `bun tools/loc/complexity-policy.ts
[paths…]` checks the cyclomatic ceiling and re-measures exactly the files you name. Finally, `bun run
hooks:install` is `git config core.hooksPath .githooks`, and without it a push goes out ungated.

The pre-commit hook is the last cheap moment, because a published commit cannot be un-published. It
refuses an author email on an RFC 2606 placeholder domain (`*.test`, `*.invalid`, `*.example`,
`example.com/.net/.org`), and it refuses staged `*.ts *.tsx *.js *.mjs` that `biome format` would change;
it checks and never writes. It then lints those files (`ANA_LINT_PATHS`), prints the staged slop report
(`tools/oxlint/staged-slop.ts`), which never refuses, and runs the secret scan over the added lines. Lint
reads the bytes in the working tree, so a partially staged file is judged on what is on disk rather than
on what was staged.

The pre-push hook answers a push whose diff touches only `AGENTS.md`, `README.md`, `docs/**` or
`.claude/**/*.md` with `git diff --check` alone. For any other push it gates what the push changed: each
source-changing commit new to the remote runs `gate --static` over its own checkout, and the lowest pushed
head holding the newest of them gets the whole gate. A commit whose patch (`git patch-id --stable`) the
remote already held under the refs the push replaces is a replay that a rebase carried to a new base, and
it waits for `bun run land` (see "Where changes go"). The same hook refuses a source push to main that
lacks `Hotfix:` trailers, a new branch that is not on top of the open stack, and a push that leaves an
open PR listing another open PR's commits; one left listing old copies of its base's commits gets a
warning naming the `git rebase --onto` that repairs it. **There is no hook bypass by any spelling**,
neither `--no-verify` nor `-c core.hooksPath=…`.

CI does much less than its name suggests. `.github/workflows/gate.yml` runs the gate on macOS (Seatbelt)
and Linux (Bubblewrap) on each stack merge (the merge commit `bun run land` puts on `main`), daily at 03:17
UTC on `main`, and on manual dispatch, and it skips a head whose tree a completed run already read. The
merge commit has the stack top's tree, so dispatching on the top before `land --merge` reads `main` after
it. It is not a required check, so pre-push is the only full gate a pull request gets. Isolation code
must pass on both platforms.

Only Bun 1.4.2 runs any of this. `lint.ts` points oxlint at the native `tsgolint` binary, because the
`node_modules/.bin` entry is a `node` shim. `bunfig.toml` sets `env = false`, so `.env` is never loaded
automatically.

### 2. Formatting and compiler settings

Biome formats and does nothing else, since its linter is off. It writes 2 spaces at a width of 110, with
double quotes and quoted properties preserved, and it owns every line break except under `.agents` and in
the 14 vendored files `biome.json` names: the 3 `pi-agent-session` modules, `pi-built/jsonl.ts` and 10 of
`pi-claude-bridge`, which stay as upstream wrote them so that a diff against upstream stays readable.
Never hand-wrap against it. What it does not do is rewrap a comment, which makes a comment the one line
whose width nothing measures, so wrap long ones yourself.

The compiler targets `ES2025` for both target and lib, which brings iterator helpers, the `Set` methods,
`Promise.withResolvers`, `Object.groupBy` and `toSorted`. It runs `strict`, and three further settings
shape everyday code. `noUncheckedIndexedAccess` makes `rows[i]` a `T | undefined`, so guard it, use
`.at()`, or loop over `entries()`. `exactOptionalPropertyTypes` means never assigning `undefined` to an
optional key; use `keyIfDefined` (§4.33) instead. And `noUnusedLocals/Parameters` is satisfied by a `_`
prefix. Modules resolve as `NodeNext` with `.ts` extensions in every import, under `types: ["bun"]`. The
configuration covers `src tools vendor starters test` and `.claude/skills/**/*.{ts,mts}`. Imports have
three subpath aliases, `#src/*`, `#tools/*` and `#skills/*` (which maps to `.claude/skills/*`), and an
import climbing 3+ directories must use one (§5.16, which fixes it). `src`, `starters`, `tools/harness`
and `vendor` are `relativeOnly`, because they load without the manifest, so they stay relative at any
depth. `starters/` never imports `src/`.

### 3. How lint runs

`.oxlintrc.json` turns on `typeAware` and the plugins `import`, `oxc`, `typescript` (through `tsgolint`)
and `unicorn`, beside the JS plugins `ana` and `anti-slop`, and it ignores `node_modules campaigns domains
tmp`. `--report-unused-disable-directives` makes a stale disable a finding in its own right. The roots are
`src tools vendor starters test packages .claude`, though `packages/` joins only once
`packages/ui/node_modules` exists (`bun run ui:deps`).

Plugin findings and stale ledger rows fail the run only in strict mode, which is `--strict`,
`ANA_LINT_STRICT=1`, or `git config ana.lintStrict true`. That key lives in `.git/config`, is shared by
the worktrees and is never pushed, and the maintainer clone sets it. A run that is not strict hides the
findings as "optional", which is easy to mistake for clean. **Treat every run as strict.** Whoever
rewrites code runs `bun run lint -- --strict` before handing it back, because a rewrite that drops an
assertion or merges statements meets rules the old spelling passed (`no-known-value-widening`, `curly`,
`prefer-optional-chain`).

Answering a finding should be rare, because the first move is always to change the code. Never write an
`oxlint-disable` naming an `ana/` or `anti-slop/` rule (§4.40). Instead run `bun run lint`, take the
`[not-slop <id>]` it prints, and run `bun run not-slop -- answer <id> "<reason checkable against the
code>"` with a reason of 3+ words. The row in `tools/oxlint/not-slop.tsv` is keyed by the rule and the
text of the judged line, so editing the line reopens it, and a row nothing matches any longer fails a
strict run until you `prune` it. **A rule with a fixer cannot be answered**, because its wrong report is a
bug in the rule. The core rules (`eslint/`, `typescript/`, `unicorn/`, `import/`) may take `//
oxlint-disable-next-line <rule> -- <reason>`.

Tuning a rule runs in one direction only, a decision dated 2026-09-22 and taken after a `test/**` override
and a `json-shape.ts` override had silenced 13 findings wholesale. Retune the rule's source so that the
legitimate shape it mis-targeted passes and every slop case it caught still fails, with a fixture for each
side. A finding the rule cannot separate that way is fixed in code or answered. **Never turn a rule off or
widen an override to clear a finding** (§10).

The 15 rules marked [fix] below carry fixers. Several of them leave a compile error on purpose when they
cannot finish, such as a member missing from an import they wrote, so finish the edit.
`FIXER-DECISIONS.md` says why each of the other rules only reports.

### 4. The `ana` rules

Test files are `test/**` or any `*.test.*`. The exemptions below live inside each rule, not in overrides.

#### Structure

- 4.1 `declarations-before-the-first-function` [fix] wants a file in the order imports, then
  `type`/`interface`, then module `const`s, then functions. A `const` whose initialiser calls something,
  reads a global or reads something below stays where it is. Write new files in this order.
- 4.2 `no-inline-schema-literal` moves a table of 3+ constant primitives built inside a function to module
  scope, under a name saying what it holds. It reports only when the binding never escapes, meaning it is
  not passed, returned, spread or iterated, and tests are exempt. It has no fixer, because the naming is
  the point.
- 4.3 `no-deep-nesting` makes depth 4 in one function an error. `if`, loops, `switch` and `catch` count;
  `try`/`finally` and nested functions do not, and neither does a guard, which is an `if` without `else`
  of ≤3 statements, with no branching, ending in `return/continue/break/throw`. Fix it in this order:
  guard early, split a function that does two things, then collapse a loop-in-loop into `flatMap` or a
  `Map` lookup.
- 4.4 `no-tangled-ternary` lets a ternary grow only along its tail, to ≤3 cases, with nothing nested in a
  test or a consequent. Name the inner ternary, or use early returns or a `Map`. Do not invert the outer
  test to escape it, because `no-negated-condition` fires next.
- 4.5 `no-single-caller-helper` inlines a non-exported function with one caller and a short body, meaning
  ≤2 statements or 5 lines in an expression and ≤3 or 7 as a statement. Tests are exempt, and so are
  `.tsx` components, type guards, `using`/`catch`/early-return bodies, one of 3+ `&&`/`||` predicates, a
  name used as a value, and an inline that would push the caller past 115 lines or complexity 22.
- 4.6 `no-pass-through-wrapper` catches a body that forwards its own parameters unchanged, which is only a
  second name, so call the callee. A wrapper that adds a default, a narrowing, a reorder, a fixed argument
  or a receiver binding is allowed.
- 4.7 `no-single-use-const-chain` catches 3+ `const`s, each read once in the next statement, threading one
  value; write the chain instead (`return
  parseJsonAs<Bundle>(text).tasks.map(byId).filter(unique)`). A comment, a type annotation or a function
  value ends the chain.
- 4.8 `no-renaming-temporary` [fix] replaces `const rows = bundle.rows;`, read once in the next statement,
  with the expression itself. A binding that is annotated, a snapshot of a path reassigned later, or one
  read inside a closure is exempt, the last because it keeps the narrowing.
- 4.9 `no-alias-restating-return` catches a local alias used only as one function's return type over a
  named contract (`type X = Omit<Other["tools"], "byName">`). Delete it and let the type be inferred, or
  write `ReturnType<typeof f>`.

#### Branches and conditions

- 4.10 `no-arms-differing-in-one-term` merges two arms that are identical but for one value token at that
  token, as in `return spawnUnder(linux ? bwrap : seatbelt, command)`. Arms in dispatch position, arms
  differing in operators or strings, commented arms, and arms under 3 names or over 200 chars are exempt.
- 4.11 `prefer-condition-over-boolean-returns` [fix true→false] rewrites `if (c) return true; return
  false;` as `return c;`. For the reversed order the fixer stops, and you add the `!` yourself.
- 4.12 `prefer-const-conditional` [fix, two-arm] turns `let x; if (c) x = a; else x = b;` into `const x =
  c ? a : b`. A default followed by an override (`let w = D; if (o.w !== undefined) w = o.w`) is only
  reported; write `const w = o.w ?? D`.
- 4.13 `prefer-lookup-over-equality-chain` turns 3+ `if (x === "lit") return …` arms over a closed set
  into `const T = {…} as const satisfies Record<Kind, …>`. Arms that read the subject, which is union
  dispatch, are exempt.
- 4.14 `no-positional-boolean-parameter` exists because `close(l, true)` is opaque at the call site; take
  `outcome: "failed" | "clean"` instead, and not an options object (§5.6). Tests, `asserts`, callers that
  all pass a variable named like the parameter, and a flag gating the callback beside it are exempt.
- 4.15 `no-side-effect-in-predicate` refuses mutation inside a `filter/find/some/every` callback, such as
  the `!seen.has(id) && seen.add(id)` dedupe. Use `new Map(rows.map((r) => [r.id, r])).values()`,
  `Object.groupBy`, or a loop.

#### Arrays and loops

- 4.16 `prefer-find-over-loop` [fix] turns a `for…of` whose body is one conditional `return` of the
  element or a boolean into `find/some/every`. A loop containing `await`, an index or entry loop, a loop
  over a `Set/Map`, one with an `else`, and one returning something derived are exempt.
- 4.17 `prefer-some-over-filter-length` [fix] turns `filter(p).length > 0` into `some(p)`.
- 4.18 `prefer-includes-over-some-equals` [fix] turns `some((x) => x === "lit")` into `includes("lit")`.
  Keep `some` when it narrows a `string` against a readonly tuple.
- 4.19 `prefer-flatmap-over-map-filter` turns `map(f).filter(Boolean)` into `flatMap((x) => f(x) ??
  [])`, because `filter(Boolean)` does not narrow and also drops `0`, `""` and `false`.
- 4.20 `no-inline-block-reducer` treats a `.reduce` with a block-bodied inline arrow as a hidden loop, so
  write the `for…of`. Named reducers and expression arrows are fine.
- 4.21 `prefer-entries-over-keys-lookup` turns `for (k of Object.keys(o)) … o[k]` into a loop over
  `Object.entries`.

#### Calls

- 4.22 `no-argument-already-carried` [fix, confined] catches `f(bundle, bundle.findings)`, where the part
  should be read inside `f`. The fixer drops the parameter and the argument at every call, and rewrites
  the reads.
- 4.23 `no-transposed-argument` catches argument names crossed against parameter names. Fix whichever side
  is wrong rather than swapping blindly.
- 4.24 `no-property-read-on-function` catches a non-standard property read off a local function, which is
  always `undefined` and usually a missed rename. It has no fixer, because deleting the read deletes the
  evidence.

#### Repetition

- 4.25 `no-repeated-string-literal` [fix in tests] turns a 6+-character string (not a bare tag like
  `"non-result"`) spelled 4+ times in a file, or 10 in tests, into one named constant; in source you
  choose where the constant belongs. Import sources, object keys and strings others own, such as CLI flags
  and media types, are exempt.
- 4.26 `no-thrice-spelled-object` turns one 3+-property object literal spelled 3 times, or 5 in tests,
  into one builder function. Literals made only of flags are exempt.

#### Types

- 4.27 `no-unknown-union` exists because `Row | unknown` *is* `unknown`, so write the real type.
- 4.28 `unproven-unknown-parameter` requires an `unknown` parameter to be proved in the body, by a
  predicate, a narrowing guard, a proved local, or a hand-off to a prover (`is…`, `as…`, `has…`,
  `assert…`, `ensure…`, `require…`, `validate…`, `parse…`, `trustedJson`, `errorMessage`, `errorCode`).
  Passing it straight on proves nothing, so declare `JsonValue` or the real type, and never hide an
  unproved input behind a generic intersection.
- 4.29 `require-type-for-null-default` applies to `.js/.mjs/.cjs` only, where a `= null` default types as
  `null`. It is dormant, since no JavaScript remains at the stack head.

#### Owners: use the one implementation

Each of these rules points at an owner that §6 lists.

- 4.30 `no-hand-rolled-error-render` [fix] replaces `e instanceof Error ? e.message : String(e)` with
  `errorMessage(e)`, and `new Error(String(e))` with `asError(e)`. It is not applied in `packages/ui` or
  `starters`.
- 4.31 `require-captured-json-runtime` [fix] refuses, in `src/` and `vendor/`, the ambient `JSON.parse`,
  `JSON.stringify` and `structuredClone`, because a generated module could replace the globals. Use
  `capturedJsonParse` (which returns `JsonValue`), `parseJsonAs<T>(text)`, `capturedJsonStringify` and
  `capturedStructuredClone`. Under `src/backends/oauth/**` an override also bans `JSON.parse` and
  `parseJsonAs`, since OAuth bytes are external input: `capturedJsonParse` them and validate.
- 4.32 `require-meta-runtime-import` [fix] refuses `node:fs`, `fs/promises`, `path`, `os`, `net`, `module`
  and `assert/strict` outside `src/meta`. Import its wrapper instead (`filesystem.ts`, `path.ts`, `os.ts`,
  `network.ts`, `modules.ts`, `assert.ts`), adding a missing member beside the others; its `mkdir`,
  `mkdtemp`, `readdir` and `rm` are the promise versions. Tests and `.claude/**` are exempt.
- 4.33 `prefer-key-if-defined` [fix] wants `{ stdout: "pipe", ...keyIfDefined("cwd", options.cwd) }`
  rather than a guarded assignment after the literal. For `!== null` use `keyIfNotNull`, and `keyIfTruthy`
  and `keysIf(cond, () => ({…}))` cover the remaining cases.
- 4.34 `no-hand-rolled-sleep` refuses `new Promise((r) => setTimeout(r, ms))`. A test resolves when the
  producer finishes (`Promise.withResolvers()`) or polls with a deadline, and production code calls
  `Bun.sleep(ms)`.
- 4.35 `no-lifetime-outside-owner` treats a spawn plus `child.kill()` in one file as a third
  process-lifetime owner. Launch through `spawnCollected` / `stageCommandIsolation` and signal through
  `killProcessGroup` / `terminateAndReapProcessGroup` (`src/meta/subprocess.ts`). Tests are exempt.
- 4.36 `no-hand-spelled-git` says never to spawn `"git"` yourself. Skills use `gitOutput/gitText/gitMaybe`
  (`.claude/skills/main/git.ts`), and `src` uses `src/run/source-identity.ts`, or
  `src/author/domain-repo.ts` for the committing Builder workspace. Tests are exempt.
- 4.37 `no-hand-spelled-tree-root` [fix] applies in `src` and `.claude` but not in tests, and refuses
  `join(root, "campaigns"|"domains", …)`. Use `campaignRoot/campaignDir/defaultProductDir/productRoot`
  (`src/meta/campaign-root.ts`), or `selectedProductDir` for the tree the ledger selected.
- 4.38 `no-hand-read-argv` applies to skill scripts and not to tests: declare a `runCommand` spec, or pass
  `Bun.argv.slice(2)` to `parseOrDie/parseCommandOrDie/parseCliArgs` (`.claude/skills/main/cli.ts`).
- 4.39 `no-hand-read-controller-evidence` applies to skill scripts and not to tests, and wants
  `opening.json` and `terminal.json` read through `openRecordedRun` (`.claude/skills/main/run.ts`) rather
  than parsed by hand.
- 4.40 `no-inline-slop-answer` refuses an `oxlint-disable` naming a plugin rule; use the ledger instead.

### 5. The `anti-slop` rules

These are copied from dmmulroy/anti-slop and edited here where needed.

- 5.1 `no-array-filter-map` exists because `filter().map()` on an array makes two passes; write
  `rows.flatMap((r) => (r.ok ? [r.id] : []))`, and over a `Map`/`Set` write
  `.values().filter().map().toArray()`.
- 5.2 `no-chained-type-assertions` refuses `x as unknown as T`; validate instead.
- 5.3 `no-conditional-empty-object-spread` refuses `...(ok ? { k } : {})`. Use `keyIfDefined`/`keysIf`,
  and decide whether the key is absent or present and null.
- 5.4 `no-known-value-widening` refuses an annotation wider than the value states, such as `const row:
  object = {…}`, a literal returned as `Record<string, unknown>`, or `as any`. Keep the inference or use
  `satisfies`.
- 5.5 `no-module-mocking` refuses `vi.mock`/`jest.mock`/`unstable_mockModule`; inject through an interface
  instead (`double(…)`, `test/helpers/doubles.ts`).
- 5.6 `no-object-parameters` refuses a parameter typed `object`; name the owner type.
- 5.7 `no-reduce-accumulator-copy` refuses `Object.assign({}, acc…)`, `acc.concat`, `acc.slice()` and
  `[...acc]` at every step, which is quadratic; mutate a local and return it.
- 5.8/5.9 `no-reflect-apply` and `no-reflect-get` want typed calls and typed access. A Proxy `get` trap
  forwarding its own three parameters in order is exempt.
- 5.10 `no-runtime-typeof` refuses `typeof x === "string"` in running code. Use `isString`, `isNumber`,
  `isBoolean`, `isObject`, `isRecord`, `asRecord`, `isFunction`, `jsonKind` or `typeName` from
  `src/meta/json-shape.ts`, the only file allowed a `typeof` predicate, or parse into a named type.
  `typeof x === "undefined"`, an existence probe, is fine.
- 5.11 `no-shape-in-symbol-names` refuses any identifier containing "shape"; name the role instead
  (`CaseRow`, `toVerdict`).
- 5.12 `no-unknown-returns` refuses a declared return of `unknown`, `Promise<unknown>`, a union with it or
  an alias of it, method signatures included; return the parsed type.
- 5.13 `no-unknown-type-aliases` refuses `type Payload = unknown`; write the real type.
- 5.14 `no-unsafe-dictionary-type` refuses `Record<string, unknown|any>` and `{[k: string]: object}`. The
  one open view is `OpenRecord` (`json-shape.ts`), and for JSON it is `JsonObject`/`JsonValue`.
- 5.15 `no-widen-then-assert` refuses declaring a value wide and then asserting it back; keep the precise
  type.
- 5.16 `prefer-subpath-import` [fix] enforces the aliases of §2, and reads the alias off the nearest
  `package.json`.
- 5.17 `require-safety-comment-for-type-assertion` wants every `as T` (except `as const`) and every `<T>x`
  to carry a `SAFETY: <invariant you checked>` comment right before the assertion or its statement. Only
  whitespace, newlines included, and opening parentheses may separate them, and Biome moves the comment
  outside the parentheses. It has no fixer, because a generated comment proves nothing, and a predicate,
  `satisfies` or a parse is usually better than the assertion anyway.

```ts
// SAFETY: isManifest validated this two lines above.
const manifest = parsed as Manifest;
```

### 6. The owners (`src/meta`)

Each runtime surface has one owner in `src/meta`, which is what the owner rules of §4 point at. Files,
paths and the OS go through `filesystem.ts`, `path.ts` and `os.ts`, which expose the node surfaces with
the promise versions of `mkdir mkdtemp readdir rm`, and the network and the module loader go through
`network.ts` and `modules.ts`, the `node:net` / `node:module` surfaces. The process belongs to
`process.ts`, which gives `runtimeProcess` in place of `process`, with `capturedSpawn`, `capturedExecPath`
and `parseArgs`. Subprocesses belong to `subprocess.ts`, with `runSync`, `runSyncOrThrow`,
`runTextSyncOrThrow`, `killProcessGroup` and `terminateAndReapProcessGroup`, and host binaries to
`host-tool.ts`, as in `hostTool("git")`.

JSON in and out goes through `json-runtime.ts` (`capturedJsonParse`, `parseJsonAs<T>`,
`capturedJsonStringify`, `capturedStructuredClone`, `hashJsonBytes`), and the JSON types come from
`json-shape.ts` (`JsonValue`, `JsonObject`, `OpenRecord`, and `isString`… `typeName`). Canonical JSON is
`stable-json.ts`, with `stableJson`, `canonicalJson`, `sameJsonValue`, `hashJsonValue` and
`compareCodeUnits`, and atomic files are `completed-json.ts`, with `writeAtomic`, `writeJsonFile`,
`readJsonFile(OrNull)`, `writeCompleted` and `readCompleted`. Caught values are rendered by
`runtime-values.ts` (`errorMessage`, `asError`, `errorCode`), optional keys are built by `optional-key.ts`
(`keyIfDefined`, `keyIfNotNull`, `keyIfTruthy`, `keysIf`), and the generated trees are located by
`campaign-root.ts` (`campaignRoot`, `campaignDir`, `defaultProductDir`, `productRoot`). Hashing is
`digest.ts` (`sha256`…), and assertion is `assert.ts`, the `node:assert/strict` surface.

`tree/filesystem-import-budget` records each file's count of `filesystem.ts` imports, an operator budget
set on 2026-09-15. A change adds at most one, and a change that needs more is asking for a redesign.

### 7. Core oxlint rules

The ESLint rules come first.

- `curly: multi-line` wants braces whenever the body spans lines.
- `max-params: 5` caps a function at five parameters; name an interface or split the function, and never
  reach for an `object` bag.
- `no-else-return` drops the `else` after a branch that returns.
- `no-empty` refuses an empty block, and an empty `catch {}` needs a comment saying why.
- `no-extend-native` refuses changes to built-in prototypes, and `no-fallthrough` refuses a `switch` case
  that falls into the next.
- `no-implicit-coercion` wants `String(x)` rather than `"" + x`/`+x`/`!!x`.
- `no-param-reassign` refuses assigning to a parameter, and `no-useless-assignment` a value assigned and
  never read.
- `no-shadow` refuses a name that shadows an outer one, and a callback `row` inside a `row` loop counts.
- `no-unmodified-loop-condition` catches a loop whose condition nothing in the body changes.
- `no-unused-vars` refuses unused bindings; `^_` exempts args, vars and caught errors, and rest siblings
  are ignored.
- `preserve-caught-error` wants `throw new Error(msg, { cause })` in a `catch`.

The type-aware TypeScript rules follow.

- `await-thenable` refuses awaiting what is not a promise, and is off in `test/**` because Bun's
  `expect().rejects/.resolves` is untyped.
- `no-array-delete`, `no-base-to-string`, `no-deprecated`, `no-for-in-array`, `no-misused-spread`,
  `no-redundant-type-constituents`, `no-unnecessary-template-expression`, `no-unnecessary-type-assertion`,
  `no-useless-default-assignment`, `prefer-optional-chain`, `prefer-readonly`, `restrict-plus-operands`
  and `unbound-method` are on as well, each catching what its name describes.
- `no-explicit-any` refuses `any`, and is off in `test/**`, `.claude/**` and `vendor/pi-agent-session/**`.
- `no-extraneous-class` turns a static-only class into module functions.
- `no-floating-promises` runs with `ignoreVoid: false`, so `void p` does not satisfy it; await the
  promise, return it or `.catch` it.
- `no-misused-promises` refuses `forEach(async …)` and `if (promise)`.
- `no-non-null-assertion` refuses the non-null `!`, and is off in `test/**`, `packages/ui/**` and
  `.claude/**`.
- `no-unsafe-argument/assignment/call/member-access/return` want `any` parsed first. They are off in
  `test/**`, `packages/ui/**` and `.claude/**`, and `no-unsafe-argument` is off in
  `vendor/pi-agent-session/**` too.
- `only-throw-error` and `prefer-promise-reject-errors` want `Error` instances, made via `asError`.
- `prefer-nullish-coalescing` lets strings and numbers keep `||`, but not booleans and objects.
- `require-array-sort-compare` wants a comparator, which for strings is `compareCodeUnits`.
- `restrict-template-expressions` allows only strings and numbers inside `${}`.
- `switch-exhaustiveness-check` wants every member covered, or a `default`.
- `strict-boolean-expressions`, which admits only `any` beside real booleans, is the most-tripped rule of
  all, and these are the rewrites it asks for:

```ts
if (name)          // ✗ string            → name !== ""
if (count)         // ✗ number            → count !== 0
if (row)           // ✗ Row | undefined   → row !== undefined
if (maybe?.length) // ✗                   → (maybe?.length ?? 0) > 0
if (items.length)  // ✗ (also unicorn/explicit-length-check) → items.length > 0
```

The Unicorn and import rules come last.

- `explicit-length-check` wants `.length > 0` rather than a bare length, as above.
- `no-array-reverse` wants `toReversed()` in place of the mutating reverse.
- `no-lonely-if` folds an `if` that is the only statement of an `else` into the `else`.
- `no-negated-condition` refuses `if (!x) … else …` and `a !== b ? x : y`, so flip the arms; an `if`
  without `else` may still be negated.
- `prefer-array-find`, `prefer-array-flat` and `prefer-array-flat-map` want `find`, `flat` and `flatMap`
  over their hand-built versions.
- `prefer-at` wants `xs.at(-1)`, and `prefer-set-has` turns a constant array used only for `.includes`
  into a `Set`.
- `prefer-string-raw` wants a raw string where an escaped one would do the same.
- `no-cycle` refuses an import cycle; move the shared piece down into a module both sides import.
- `no-duplicates` merges repeated imports of one module, `type` imports included.

Complexity is not in `.oxlintrc.json` at all: `tools/loc/complexity-policy.ts` runs oxlint's `complexity`
at `max: 21` (§9). Some rules were measured and refused, so do not add them. `no-unnecessary-condition` is
one, and `no-unnecessary-type-parameters` is explicitly `off`, because `parseJsonAs<T>`, `double<T>` and
their kin exist to carry a contract the caller declares. `typescript/consistent-return` was false at all
17 sites, and obeying it adds the `default` that blinds `switch-exhaustiveness-check`. `oxc/no-map-spread`
found 49 sites, every one of them the `({ ...x, field
})` immutable update this tree is built on. `unicorn/no-array-reduce`, `prefer-ternary`,
`no-nested-ternary`, `max-depth` and `max-statements` were refused as well.

### 8. The whole-tree scans (`bun run simplify`)

`tools/oxlint/tree-*.ts` find shapes that span files. They print and never block, in `bun run simplify`
and, narrowed to your lines, in the pre-commit slop report, so treat each row as a question and answer the
false ones in the ledger (`tree/<kind>`). Run them during the work, not only at the end.

Most of the shapes are dead or misplaced code. `single-reader-export` is a file's one 10–60-line export
with one reader in the same directory, and the repair is to move it in. `test-only-export` /
`test-only-module` is something only tests call, which you delete with its test or wire into a live path.
`unread-field` is a field named nowhere else, and `orphan-module` a file nothing imports, spawns or names,
and both are deleted. `unproduced-set-member` is a union member nothing produces, so it goes, together
with its branch.

The rest are duplication and history. `copied-block` is ≥64 tokens repeated at ≥2 non-test sites, which
wants one owner, and `identity-without-owner` is a repository name spelled as a literal in ≥2 files, which
wants one constant. `superseded-schema-tag` is `x/v1` still spelled after `x/v2`, so drop the old reader,
and `compatibility-path` is a production name containing `legacy`, which is deleted.
`rule-without-fixture` is repaired by adding the fixture. `filesystem-import-budget` only registers the
standing counts of §6 and asks for no repair.

**No backwards compatibility** (2026-09-22). That means no `v1 || v2` readers, no migration branches and
no `legacy` shims, and a reader meeting an older version refuses it.

### 9. Size and policy gates (`tools/loc`)

A file may hold 800 nonblank lines and a function 115, measured after `biome format` and over `src`,
`tools` and `vendor` only. `test` and `packages` have no ceiling, so length there is a judgement rather
than a finding. `copiedFileLimits` in `source-policy.json` is easy to misread, because an entry does two
things at once: it replaces the file's 800 with its own figure, and it switches off that file's
per-function check. Most figures sit below 800, which is the tell that they bought one long function
rather than a long file; `src/correctness-bundle/probes.ts` is held at 436 so that `makeProbeControls` can
be 150 lines. The figure is therefore a tighter budget than the rest of the tree gets. `staleCopyLimits`
fails once a listed file passes the ordinary ceilings by itself, and the entry comes out then.

`refusedLiterals`/`refusedCalls` in `source-policy.json` list names from systems removed on purpose
(`Governor`, `agentLoop`, `authorEvaluator`, `climbDecision`, `mapWithConcurrency`, `createPiBackend`,
`HARNESS_EVAL_BROKER_ORIGIN`, …). A hit means you are rebuilding a retired design, so read the list before
naming a new function.

Unused exports are looked for more widely than the import graph, on purpose. An export in `AUTHORED_ROOTS`
(`src`, `tools`, `packages/ui/src`) needs a reader somewhere under `READER_ROOTS` (`src tools vendor
starters test packages scripts .claude`), and **a name spelled in a comment counts as a reader**, so
deleting a comment can orphan an export; drop the `export` the gate then names.

Complexity is held at ≤ 21 per function, and `?.` counts. `complexity-baseline.json` only shrinks:
`--write-baseline` lowers it, and a new exception has to be a visible hand edit. A long flat `switch`
becomes a lookup table (§4.13). And `thresholds.frozen.yaml` is declared policy, so an executable
threshold that disagrees with it is a blocking inconsistency.

### 10. Per-path overrides and override debt

Each block in `.oxlintrc.json` that names a path changes the rules there. `test/**` turns off
`no-unsafe-*`, `no-non-null-assertion`, `no-explicit-any` and `await-thenable`. `packages/ui/**` turns off
`no-unsafe-*` and `no-non-null-assertion`, and `.claude/**/*.{ts,mts}` turns off those two and
`no-explicit-any`. `**/src/backends/oauth/**` turns nothing off and adds bans on `JSON.parse` and on
importing `parseJsonAs`. `tools/oxlint/anti-slop/**` turns off §4.40 and lets
`switch-exhaustiveness-check` count a `default` as exhaustive, because the AST unions there are untyped.
`vendor/pi-agent-session/**` turns off §4.33, `no-explicit-any` and `no-unsafe-argument`.
`vendor/pi-claude-bridge/**` keeps the taste of the upstream it was copied from, and so turns off
§4.2–4.4, 4.6–4.13, 4.15–4.17, 4.19–4.22, 4.25, 4.26, 4.34, 4.35, 4.40, `no-else-return`,
`prefer-nullish-coalescing`, `no-lonely-if`, `no-negated-condition`, `prefer-array-flat`, `prefer-at` and
`prefer-string-raw`. `vendor/harbor/**`, a TypeScript port of Python, keeps upstream's shape the same way
and turns off §4.3, §4.5 and `no-runtime-typeof`, which Python's type dispatch needs.

Every plugin rule still applies to tests, at raised floors (string 10, object 5), with in-rule test
exemptions for §4.2, 4.5, 4.14, 4.32, 4.35–4.39. `.claude/**` may import `node:` modules (§4.32 exempts
it), and §4.36–4.39 apply there. `packages/ui` is a browser bundle with no `src/meta` owners, which is why
§4.30 skips it.

Those blocks read at first glance like exactly what §3 forbids, which is worth answering.
`tools/oxlint/BASELINE.md` owns them, and it reads each "off" entry as that rule's debt on the day it was
registered: the files that already broke it, while the rule holds every other file, including every new
one. So registering a rule with a 35-file exemption beats not registering it, because an unregistered rule
holds nothing at all. **The lists only shrink**: never add a file, and never widen a glob to take in the
one you are editing. An exemption ends whole, when the last file under its glob passes. Two entries are
not debt, because there the rule is wrong about this repository: `await-thenable` in tests, where all 215
reports were `await expect(…)`, and the anti-slop `switch-exhaustiveness-check` setting. The
`**/*.js`/`**/*.mjs` block went on 2026-09-26, with the last JavaScript file.

### 11. Writing code that passes the first time

Writing to a handful of habits from the start saves the round trip through the hook. Lay a file out as
imports, then types, then constants, then functions. Import with `.ts` extensions, through `#src/…` once
an import climbs 3+ levels outside the `relativeOnly` trees, and through `src/meta` for
`fs/path/os/net/module/assert`.

Keep the types honest at the boundary. That means no `any`, no `as` without `SAFETY:` and no `as unknown
as`: parse where the data enters (`parseJsonAs<T>` or a predicate) and keep the precise type from then on.
No `unknown` goes out, whether as a return, an alias or a union member, and an `unknown` parameter is
proved inside the function that takes it. Conditions are booleans, so write `!== ""`, `!== 0`, `!==
undefined` and `.length > 0`.

Put the positive case first, with no negated `if/else` or ternary, and keep nesting ≤3 by using guards and
ternaries to ≤3 cases along the tail. Handle every promise, remembering that `void p` does not count, and
pass no async callback where a sync one is expected. In a `catch`, `throw new Error(msg, { cause
})`, and render with `errorMessage(e)`. JSON moves only through
`capturedJsonParse`/`parseJsonAs`/`capturedJsonStringify`, and optional keys only through
`keyIfDefined`/`keyIfNotNull`/`keysIf`.

A function takes ≤5 parameters, with no boolean flags (take a string-literal union), no `object`
parameters, no shadowing and no parameter reassignment. Prefer `flatMap` over `filter().map()`,
`find/some/every` over searching loops, and `.at(-1)`, `toReversed()`, `.includes(lit)` and `entries()`
over their hand-written forms. Write no two-line single-use helpers, pass-through wrappers or one-shot
renaming `const`s, and give a string used 4+ times or an object spelled 3+ times in a file one owner.
Functions stay ≤115 lines and complexity ≤21, files ≤800, and only what another file imports is exported.
No "shape" in names, no `legacy`, no `setTimeout` sleeps and no module mocks; processes, git and the
campaign tree go through their owners.

Before committing, run `bun run format && bun run typecheck && bun run lint -- --strict`, plus `bun run
test -- <nearby tests>`. Before handing back, run `bun run simplify`, and then `/simplify` on the diff.

Some rules pull against each other, and each pair has a spelling that satisfies both. A tangled ternary
and a negated condition are both avoided by naming the inner ternary rather than inverting the outer test.
A single-caller helper against a thrice-spelled object or a lookup chain is settled by count: at 2 uses
inline, at 3 extract. A boolean parameter, an object parameter and max-params are all satisfied by a
string-literal union or a named interface. Key-if-defined, the empty-object spread and
`exactOptionalPropertyTypes` all accept `keyIfDefined`, `keyIfNotNull` or `keysIf`, all three times.
Filter-map against map-filter becomes `flatMap` returning `[]`. Deep nesting against complexity is the
pair to watch, because a guard is free for depth but costs complexity, so split the function instead.
Strict-boolean against nullish-coalescing is `(n ?? 0) > 0`, with a `!== undefined` guard when later lines
need the narrowing. And the renaming temporary against narrowing is settled inside the rule: a `const`
read in a closure below a guard is exempt, so keep it.

### 12. Tests

Tests do not mock modules; they inject, with `double(…)` (`test/helpers/doubles.ts`) rather than `as
never`, and they take scratch space through `scratchDir` with `afterAll(cleanupScratch)`
(`test/helpers/scratch.ts`). Nor do they sleep for a fixed time. Wait on `Promise.withResolvers()` or on a
polled condition with a deadline, and do not raise a timeout to hide a slow test. Keep the positive case
and the nearest hostile case in the smallest owning test file, and add only the case that is missing. Test
growth is fine, which is why a cleanup is judged by its net source lines. A test proving an export nothing
else calls is what `tree/test-only-export` flags, so test the live path instead. `bun run
test` discovers `test/` only, as a flat tree, which means a skill script is tested only if a `test/` file
imports it; grep `test/` to find out, and otherwise run `bun test` from the script's own directory.

### 13. Adding or changing a lint rule

A new rule lives in `tools/oxlint/ana/rules/<name>.ts` and is registered in `ana/index.ts` and in
`.oxlintrc.json` as `"error"`. Its header comment carries the argument: the shape, its cost, what was
measured and when, each exemption with the site that forced it, and "It fixes…" or "There is no fix…" with
the reason. Before it goes in, it has to pass an admission test: at every reported site, some spelling
passes every other rule and ceiling. The test exists because a rule whose remedy another rule refuses ends
up turned off (§11 pairs). A fixer must also meet the four conditions in `FIXER-DECISIONS.md`: the repair
is a fact rather than a decision, a wrong fix fails loudly where it wrote, the result is the house
spelling, and it does not remove the occasion for a repair only a person can supply, such as a name or a
sentence.

Measure the rule over the whole tree with `bun run lint -c <one-rule config>` and never with raw `oxlint`,
because a config without `typeAware` silently reports 0. Record the counts in `SHAPE-RULESET.md` /
`BASELINE.md`. The rule enters either at zero sites, with the tree fixed in the same change, or with a
baseline block (§10). Add the fixture (`test/helpers/oxlint-rule-fixture.ts`, marked `// REPORT` /
`// ADMITTED`, with `fixedSource` for fixers) and the `FIXER-DECISIONS.md` row;
`test/oxlint-rule-contract.test.ts` checks both.

## Working in the repository

The shape of a task here is: resolve the exact tree, prepare dependencies once, run focused checks while
editing, and run one composed gate at delivery. Each cost is paid only when the changed files need it.

### Worktrees

Start with `scripts/worktree.sh list`. One call gives every tree's head, its branch, its uncommitted
count, its dependency state and whether a command is standing in it, marks each `ana-run-*` tree as
evidence, and closes with one line counting the fleet's dependency states and the volume's free space.
Reuse a clean worktree when it already owns the intended branch and nothing is standing in it; `git status
--short --branch` in that tree settles what the uncommitted count only counts.

```sh
scripts/worktree.sh new <branch> <absolute-dir> [start-point] [--scope S]
scripts/worktree.sh pr <number> <absolute-dir> [branch] [--scope S]
scripts/worktree.sh setup <absolute-dir> [--scope S]
scripts/worktree.sh run <absolute-dir> <command...>
scripts/worktree.sh list
scripts/worktree.sh drop <absolute-dir> [--force]
```

`new` creates the branch and runs `setup`. `pr` fetches a published PR head and puts it on a distinct
branch, so the PR's own source branch stays available to whichever session is holding it. `setup` does
nothing when its install marker already matches the dependency identity; otherwise it clones real
`node_modules` copy-on-write from a matching worktree, or runs one `bun install --frozen-lockfile`. `run`
checks Bun and reads no flags of its own, so the command keeps all of its. It prepares a `node_modules`
that is absent, linked or prepared for other dependencies, and refuses only while another command is
standing in the tree, which makes it the way to run Bun, tests and anything that loads repository modules.
`drop` removes a disposable tree, refusing the checkout itself, any `ana-run-*` tree, and anything holding
uncommitted or untracked work unless `--force`.

The scope says how much of the local checkout the new tree gets, so choose it before creating the tree;
`run` then behaves the same in all three.

| scope | what it prepares | when to ask for it |
| --- | --- | --- |
| `minimal` | the worktree alone: no Bun check, no `node_modules` | documentation set; seconds |
| `medium` (default) | a prepared `node_modules` | any module load: every test, check, Bun entry |
| `maximum` | medium + `.toolchain`, learned test order | else it redownloads the toolchain |

The documentation set is `README.md`, `AGENTS.md`, `docs/**` and `.claude/**/*.md`, exactly what pre-push
answers with `git diff --check` alone. `minimal` replaces the raw `git worktree add` recipe for it, with
one caveat the hook enforces and the script can only announce: a push creating a remote branch is never
documentation-only, because an all-zero remote sha leaves the hook nothing to diff against. So prepare the
tree before a first publish, even for a note. `maximum` names every ignored path it left behind, with the
reason. Credentials, `campaigns/`, `domains/`, `runs/`, recorded results and a path-bound `.venv` never
travel, because the tree's own workflow owns them.

Never symlink `node_modules`, because `@ana` links may resolve into another tree's `vendor/` source. The
script never links and never treats a link as prepared, both run launchers refuse a linked tree before
spending anything, and the copy-on-write clone already shares the blocks, so a link would buy nothing
anyway. Never use bare `git stash` either, since stashes are shared across trees. Remove only a clean
disposable tree this task created, with `/usr/bin/trash` and explicit paths, preserve run evidence and
unpublished work, and never empty the Trash.

Classify a missing file before supplying it, with `git ls-tree -r --name-only <rev> -- <path>`. A missing
tracked file means the revision needs correcting, and a missing dependency belongs to `setup`. Local run
state and configuration belong to their owning workflow, so never copy or symlink `.env`, campaign, domain
or config files from another checkout just to make a command start. A scratch script importing repository
source belongs inside the worktree it reads: Bun resolves `@ana/*` and relative specifiers from the
importing file, so the same script under a job scratch directory fails with `Cannot find
module` however absolute its paths are. A clean status proves the tracked source, not that ignored
dependencies match a rebased head.

Install only when dependency identity moved. Add no dependency patches, which covers both
`patchedDependencies` and edits to installed source. `worktree.sh` owns root preparation, so do not
install again after it. In a prepared tree, frozen-install only for absent or unresolved dependencies or
for a changed owning manifest. On a failure, preserve stderr and inspect the exact head and the
introducing diff; a real mismatch on the intended clean revision blocks delivery, and it does not
authorise rewriting the lock. Where branches, or installed dependencies and the lock, disagree on a
version, take the higher one (operator decision 2026-09-03) and prove it with one frozen install.

Keep a script on its second use. Sessions write helpers readily, and almost all of them die with the
session: up to 2026-09-26, 464 scripts went to scratch over 63 sessions, and the same ones kept coming
back, each written from nothing. There were 18 push or restack scripts beside a `stack-hop` that already
owns publication, and 13 replays and 7 censuses over `campaigns/`. So look first in the `package.json`
scripts, the `tools/` CLIs (`runs`, `replay`, `outcome`, `run-triage`) and the owning skill's `scripts/`.
Keep a helper the moment it is used a second time, by a subagent lane or a later session. It becomes a
subcommand of the matching `tools/` CLI when it reads repository source or recorded evidence, and
otherwise goes in the owning skill's `scripts/`, with one `SKILL.md` line saying what it answers and how
to run it, so the next session finds it; the runs pulse went to `tools/runs/` and one `launch-run` line
that way on 2026-09-25. Record it in the skill and not here, because this file states principle and a tool
inventory would go stale in it. A promoted script is source, held to lint, the size policy and a test
where one can see it, while a one-off stays in scratch, because promoting it buys nothing.

Look further back in `harness-builder-v4`. This history starts at one squashed `initial commit` (d21f1a2,
2026-09-22), so `git log` and `git blame` here cannot say when or why a line was written. The full history
is in the local clone `/Users/air/Developer/harness-builder-v4` (GitHub `s-smits/harness-builder-v4`):
~4,900 commits from July 2026 on, and the PRs that numbers like `#978` in older notes refer to. It is
messy, with reverts, retunings and parallel branches, so read it for provenance and date a line with
`git log --all --follow` or `-S '<sentence>'`. Its ignored `notes/` holds the investigation notes,
`current-state.md` and handovers written before the split, and this checkout's `notes/` holds everything
since. Never build, run or deliver from it, because its tree is not this one's.

### Tests and the gate

Use `bun run test -- <paths...>`, never a bare `bun test`. The wrapper runs one `bun test --parallel`
process, with `--max-concurrency=4` within a file and 60 s per test, ordered slowest-first from what its
first run learned, under a disposable temporary root in the host temp directory. Its worker count is **two
fewer than the cores, less half the load beyond the core count, and never below two** (`workerCount`,
`tools/runtime/test-suite.ts`; `ANA_TEST_WORKERS` overrides it outright), because the cores a machine has
are not the cores this suite gets. The idle wall, 180 s without output, widens by load ÷ cores
(`wallSeconds`).

The part worth knowing before you believe a red run is what happens next. `attribute` reads the first
process's result and decides, across nine reasons, whether the branch failed or the machine did. Two of them
say the machine did: every failure ended by a clock rather than an assertion (`clock-only`), or the one-minute
load passed twice the core count while they ran (`crowded-host`). Either way the failed files run again alone,
in one fresh process, beside every file whose worker crashed or that Bun aborted or never started, up to eight
in all, and **that second verdict is the suite's**. Files the idle wall cut off get the same second run,
however many there are. Some failures never get one. A failure the first process printed on a quiet host
stands, and so does an error Bun raised outside any test, because nothing in the failed list speaks for it and
a rerun cannot unsay it. A run that bailed stands, because it never ran the files after the failure that
stopped it, and so do more than eight failed or unfinished files, which is more than a busy host explains. So
a red run on a loaded laptop is not yet a verdict on your branch; read which of those sentences the wrapper
printed.

The gate's nine steps (§1) mean that the two policy gates, the UI gate and the formatter can each fail a
push the contract used to leave unnamed. `ui-deps` prepares `packages/ui`'s own modules before typecheck
and lint, because `setup` prepares only the root's, and an unprepared `@types/react` makes lint report
findings no diff introduced. `bun run format` fixes the format step. Biome's ownership of line breaks (§2)
is why the size ceilings are 800 and 115, and `tools/oxlint` came in on 2026-09-20 and cost 25 lint
errors, mostly `curly` finding statements the formatter had just made multi-line. Also available are
`bun run runs <verb> <run>`, the door to the run readers the skills own (`bun run runs --help` lists
them), `bun run outcome` for read-only reports over recorded evidence, `bun run replay --
<campaign>/<runId>` to re-grade a recorded battery through this tree's verifier, `bun run triage` and
`bun run secrets`. Run one gate at a time, because two overlapping gates each took twice as long as one
alone. `bun run land --jobs N` is the exception, because its `--static` gates are small enough that
overlapping them still pays: over #32–#46 on 2026-09-28, four at once finished a commit every 19
seconds against 36 for one, on a 12-core host held at a load near 50, and the top's whole gate still
ran alone. When typecheck, lint,
source-policy or complexity fails, pre-push lists each finding as `<rule> <location> <message>` and names
the commit it failed on.

| Changed files | While editing | Delivery proof |
| --- | --- | --- |
| Documentation only | `--scope minimal`, then `git diff --check` and read the diff | Commit on local main and hold it; the operator approves the push, which repeats the diff check and skips the gate |
| Test or source | `scripts/worktree.sh run <dir> bun run test -- <owning-paths...>` | One normal push runs the composed gate |
| Intentional dependency change | One unfrozen install at the root, review manifest plus lock | A frozen install, then source delivery |
| Stack checkpoint with publication | The union of affected owning checks | One multi-ref push from the clean top gates what it changed; `bun run land -- <top> --sanitize` proves the replays |
| Composition without publication, or a paid run without current exact-tree proof | Owning focused checks | One manual `bun run gate` immediately before the boundary |

"Normal push runs the gate" holds only where the hooks are installed. A clone gets them once, with `bun
run hooks:install`, and its worktrees share them; without them a push publishes ungated and says nothing
about it (2026-09-22, PR #1). Check `git config core.hooksPath` before relying on a push as the gate, and
otherwise run `bun run gate` yourself beforehand. Pre-push owns typecheck and lint, so run either
separately only when it is the boundary that changed, and neither substitutes for behavioural proof. Batch
small fixes under one owner.

### Commits

**Each commit a push publishes passes the gate on its own, and a defect is fixed inside the commit that
introduced it** (operator decisions 2026-09-24, replacing the fix-forward rule of 2026-09-21 and the
compose merges of 2026-09-05). History is read as well as run. An agent looking through it for how work is
done here copies what it finds, and a red commit followed by its repair teaches it that pushing red is the
way. Two runs of the same gate hold that line. Pre-push checks out every source-changing commit new to the
remote and runs `bun run gate --static` over it, which is runtime, format, ui-deps, typecheck, lint,
source-policy, complexity, and the test files near what that commit changed, and then the whole gate once,
on the lowest pushed head holding the newest of them, since that is where the edited PR ends. The commits
a restack only replayed above it are not run at push, because `bun run land` runs the same `--static` pass
on every commit a merge would publish, where it then sits, and the whole gate on the top's head, before it
merges anything (2026-09-28). A restack of fifteen PRs used to pay for every replayed commit and every
moved head at each push, and three agents editing one stack paid it three times over. CI runs only daily
on `main` (§1), so those local runs are the only gate a PR head gets. "Near" is `tools/runtime/affected-tests.ts`: a test
that imports a changed file directly (2026-09-24). It was three imports on the day the rule landed, and
the first push to pay for that showed why not. The slow end-to-end files sit two or three imports from
anything near the root of the graph, so three commits of 11–17 files each selected 62–70% of the suite's
recorded time at depth 3, against 14–19% at depth 1, and the tip then ran all of it again. Depth 1 bounds
the cost. It has not been measured against the bugs it catches, and the tip's full suite is what backs it.

A failure names the commit, and its fix goes into that commit rather than on top of it: `git commit
--fixup=<sha>` then `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1`, or `--amend` at the
tip. Nothing was pushed, so the rewrite costs no one anything, and it costs the next push little. The
rebase keeps the id of every commit beneath the fix, the hook and `bun run land` record each id that
passed in `ana-gate-passed` under the common Git directory, and a commit already recorded there at the same pass, or
at the whole gate, is not run again. That includes a tip that passed the whole gate on a checkout holding
nothing but its own bytes, so a push whose lease was refused goes out again without paying twice.

The same holds for a defect found after publication, as long as the commit sits on an open PR rather than
on main: fold the fix in, replay the commits above it, and publish every moved head with an explicit lease
("Where changes go"). That costs a force-push, and it buys a history in which every commit reads as the
finished version of its own change. A working commit that could never pass alone, such as commit-R's `R:`
removals, is squashed into the commit that completes it before anything is pushed. Main is the one history
nothing rewrites. A rule agents keep breaking is fixed at its owner, whether that is a prompt, a skill or
the lint rule's own message.

### Shell and the guard

Before sending a Bash command, scan every `$` in it. A `$VAR`, `$(…)` or `${…}` alongside `git`, after a
`>`, or inside a heredoc trips the `dcg` guard, inside a loop as well. A blocked call never runs and costs
the turn, so change the spelling rather than asking for an allowlist entry, and test the new spelling with
`dcg test '<command>'`.

Two different guards get called "the guard", and they admit different things, which is how this paragraph
once came to recommend a redirect that does not work. Your own Bash calls go through the `dcg` binary
alone. The Builder's go through `src/builder/command-guard.ts`, which runs that same binary and then adds
`privateScratchRedirect`. That admits a target matching `SCRATCH_TARGET`, which is `~/…`, `$HOME/…` or
`$TMPDIR/…`, bare or braced, and a relative target expanding a plain variable, such as a loop's
`> "scratch/opt-$i.log"`, when every `cd` in the command stays in its own tree. dcg alone admits neither
`$HOME/…` nor `$TMPDIR/…`. Probed against 0.14.4 on 2026-09-23, `> $HOME/f`, `> $TMPDIR/f` and
`> "$TMPDIR/f"` are all refused by `core.filesystem:redirect-truncate-dynamic-path`, quoted or not. The
rule's own reason is the honest one: the shell expands the target at runtime, so dcg cannot prove where
the file it is about to open with `O_TRUNC` points. What passes is a literal path, an unquoted `~/…`, or
an append, and `>> $TMPDIR/f` is admitted because appending truncates nothing. So the shape to remember is
a literal `/tmp/<subdir>/…` or the scratchpad's own absolute path, and `~/…` when it must be the home
tree.

Prefer these spellings: `git worktree remove --force`, `git diff -- <path> | git apply -R`, `git branch
park <tip>` followed by `git rebase --onto`, a literal `git -C /abs/dir` with one call per tree, `git push
--force-with-lease`, and the Write tool followed by `bun <f>` or `--body-file <f>` in place of a heredoc
holding shell text. `git clean -n -d` and `find` list what would go, and the deletion itself is the
operator's. Never report an exit code captured with `$?` after a pipe, because it is the last stage's
status, so a `| tail -8` in front of it makes every code you report the tail's.

Foreground waits are at most 60 s. For longer work, start one background monitor that exits on the real
condition and poll it in bounded intervals, rather than stacking sleep-and-tail calls; when the watch is
under 30 minutes, checking every 290 s is cheaper than holding a monitor open. Watch a paid run with
`bun run runs pulse --once` from main, as the last action of each reply: it finds every open run and
prints what moved since the last look, each with the file that holds it. When nobody is reading, start
`run-improvement-campaign`'s `campaign.ts --state <file> --every 290` detached instead; it speaks only
when a stop row names a move.

Use ponytail while authoring, and run `bun run lint -- --strict` and `bun run simplify` (the deterministic
census, `tools/oxlint/simplify-census.ts`) during the work rather than only at the end; then run
`/simplify` on the finished diff. Whoever wrote a rewrite lints it strictly before handing it back (§3). A
mis-targeted finding from either tool is a reason to tune that rule's source more precisely (rule 8), and
never to switch it off. Prefer removing unneeded work, then existing code, then stdlib or native features,
then installed dependencies, and only then minimum new code, and let rule 8's super-Pareto form decide how
much of the old behaviour that minimum must keep. Preserve trust validation, data-loss handling, security,
accessibility and requested behaviour, and reuse the focused checks and the ordinary gate. If no useful cut
remains, say "already the smallest honest form".

### Versions

Anabasis is in beta. It left alpha on 2026-09-24 (operator decision), and it stays below `1.0.0` until the
operator cuts that release. The repository follows Semantic Versioning, and a version has one owner: a
`vMAJOR.MINOR.PATCH` tag on a commit of `main`, published as the GitHub release of the same name with
`gh release create v<X.Y.Z> --target <full sha>`. Nothing in the tree has a version of its own. The root
`package.json` carries none, and the `version` in `packages/ui/package.json` follows the repository's, so
a release commit sets it to the number the tag will carry. `v0.0.1` marks `main` at `fae8fdb`, the state
before PR #7 landed, where the UI package still read `0.1.0` (operator decision 2026-09-24).

The operator decides when a version is cut and which part moves, and an agent never bumps one on its own
initiative, not even after landing a stack. An incremental release moves the patch number (`0.0.1` to
`0.0.2`), a bigger one the minor number (`0.0.2` to `0.1.0`), and a breaking one, the operator's "proud"
release, the major number (`0.1.0` to `1.0.0`), each resetting the parts to its right. When asked, tag the
exact commit the operator names, or current `origin/main` when none is named, and say which commit that
was, because local `main` can hold documentation commits that were never pushed.

### Where changes go

**Main takes two kinds of change directly, and everything else arrives as a stacked PR** (operator
decision 2026-09-24). The first is documentation, meaning the documentation set: exactly the paths the
pre-push hook excludes when it decides a push is documentation-only, after which it runs `git diff
--check` alone, so such a push needs nothing more. The second is a hotfix, a small fix to a defect on main
that cannot wait for the stack. Each of its commits ends with a `Hotfix: <why>` trailer, the push is gated
like any source push, and pre-push refuses a source-changing push to main while any commit it adds lacks
the trailer. The declaration lives in the commit rather than in a flag, which leaves nothing to install:
Git rejects an unknown option such as `git push --docs`, ignores an alias that shadows `push`, and hands a
pre-push hook no `-o` option.

**Commit documentation on local main and leave it there until the operator approves the push** (operator
decision 2026-09-23). Until then it went straight to main, on the reasoning that a note carries no gate
and so costs nothing to publish. What that missed is that the gate was never the thing standing between a
document and its readers. A source change is read by a test, a reviewer or a failing build before anyone
believes it, and a document is read by nobody, so the cheapest path to publication belonged to exactly the
files whose only check is someone reading them. On 2026-09-23 two of them were written and pushed inside
one turn. Commit the work, say where it is and what it claims, and let the operator decide; the approval
covers the change in front of them and not the next one. Ask for it in a line of the reply that reports
the work. It is not a question that blocks the turn or earns a round trip of its own, so finish, report,
and name the push as the one thing left, which keeps the rule from costing what it was meant to save, the
operator's attention. Nothing enforces this. The hook pushes a documentation commit as readily as it ever
did, and `git diff --check` is the whole of what it asks, so this is discipline rather than a gate, said
plainly because a rule with no consumer is one a reader should know is unenforced.

Skill and helper scripts are not in the documentation set, for publication or for checks. A `.ts`, `.mts`
or `.py` under `.claude/` needs focused checks and source delivery, and how much of the gate reaches it
depends on the script. `ROOTS` in `tools/runtime/lint.ts` includes `.claude`, so oxlint reads every one of
them. The suite is another matter: `bun run test` discovers a flat `test/` and never walks `.claude/`, so
it reaches a script only through a test that imports it. When that was counted, 46 test files pulled in 44
of 93 scripts across eleven skills, plus a few more transitively. The rest are held by lint alone, their
behaviour checked by nothing until you run `bun test` from the script's own directory, so grep `test/` for
the file first. A document describing source that is not on main stays with that source. Everything under
`src/`, `tools/` and `vendor/` is source, whatever the file type.

Every other change is a PR on top of the one open stack, never beside it: a single chain from the bottom
PR to the head, each based on the one before. Two independent changes still go one above the other,
because one chain has one review order, one gate path and one merge order, while a branch off its middle
must be rebased back in by hand. Fetch and verify the parent edges and use the composed head as the
working baseline, since main alone is not the current production-development state while the stack is
open. "Add stacked PR" means a new PR on the latest head, with `--base` set to that head's branch.
Pre-push reads the open PRs with `gh` and holds two things, and when GitHub cannot be read it says so and
lets the push through. A push that creates a branch must contain the top's head, the top being the PR no
other open PR is based on, and it is refused when there is more than one top; the hook cannot see
`--base`. And a push must not leave an open PR listing commits that are not its own, whether old copies of
its base's commits, matched by author time and subject, or another open PR's head beyond its base. The
refusal prints the `git rebase --onto` or `gh pr edit --base` that repairs it.

A hotfix lands on main beneath the stack, and the bottom takes it at the next restack. When a PR worktree
overlaps another session, do not edit it: `scripts/worktree.sh pr <number> <dir>` puts the published head
on a unique branch and leaves that tree alone. Once the upstream PR settles, refresh, rebase onto it,
prove containment and push to the PR's actual source branch.

To restack, write down `parent head → child head` for every edge, restack from the first stale edge and
propagate through the later children in order, naming the first stale edge and the full affected suffix.
If the bottom lacks current main, every descendant is behind main through inherited ancestry even when the
internal edges pass, though main changes to surrounding documentation alone need no source restack. Fix a
stack bottom to top, resolving each conflict once.

A stack is linear. Each PR's branch is its parent's head followed by its own commits, with no merge commit
in it, so its range reads as exactly the work it proposes, in the order it was done, and each commit in it
has passed the gate alone. A fix goes into the commit it corrects on the PR that carries it, never into a
new PR repairing an unmerged one, and each child above is replayed bottom-up with `git rebase --onto
<new-parent-head> <old-parent-head> <child-head>`. That replaces the per-edge `Compose PR #<child> on
repaired PR #<parent>` merges of 2026-09-05. Those kept every publication a fast-forward, which is what
they were for, at the cost of ranges that interleaved the parent's repairs with the child's work: PR #8
carried five of them between eight commits of its own. Replay on a detached HEAD so that branches checked
out elsewhere are undisturbed, compare each replayed range with its saved one through `git range-diff`,
and then push every moved head in one atomic push with a lease per ref, from a checkout of the top;
`stack-hop`'s [publication procedure](.claude/skills/stack-hop/references/stack-publication.md) owns
delivery. That push gates what it changed, and the replays above it wait for the landing.

**A stack lands through `bun run land -- <top> --merge`** (`tools/runtime/land.ts`, 2026-09-28). It
reads the stack from GitHub and requires the bottom to contain main's head and each head the one beneath
it, which makes the merge commit's tree exactly the top's. It then runs `gate --static` on every commit
the merge would publish, over its own checkout, and the whole gate on the top's head, skipping any pass
already recorded in `ana-gate-passed`, and stops at the first failure with the `--fixup` that repairs it.
What it gates is this clone's `land/<ref>` branch for each pull request, made from GitHub's head the first
time, because every other local copy of a stack branch is stale or checked out in some other worktree. The
fix recipe it prints rebases with `--update-refs` behind a sequence editor that keeps only `land/` branches,
so the commits below the fix keep their ids and their recorded passes, every `land/` branch above it moves
with it, and a branch someone else made at a pull request's head stays where it was. Fixes wait there,
gated, until the one leased push it prints publishes them; `--sanitize` and `--merge` refuse a `land/`
branch GitHub does not have yet. Only then does it post `ana/stack-gate` on each head and ask GitHub's stack merge for one merge commit at
exactly the gated top, taking the statuses back when GitHub does not merge. `--sanitize` runs the same
proof and posts each commit's `ana/commit` verdict without merging, which is how a stack shows it is ready;
with neither flag the script writes nothing to GitHub. A local `--no-ff` merge pushed to `main` leaves
the PRs open (2026-09-21, 98 PRs), and the landing's merge commit is the only one the policy makes. Keep
the hooks enabled.

"At PR48 state" or "at stacked PR45" means the newest level including later fixes, while "the diff of PR
#48" selects that PR alone. When two branches carry the named work, ask which head is meant.

### Subagent sessions

Honour the requested concurrency up to 200. Launch every lane together, directly from this session in one
message, one bounded task each, with no lower cap or batching unless asked, no coordinator and no further
delegation. Each prompt names the authority, the exact paths and revision, the observed facts, the
question and the required output, and says read-only unless the operator asked for changes. Do a shared
mechanical step, such as counting codes over `campaigns/` or replaying a battery, once before launch with
an existing CLI or a new helper, and give every lane the exact command with the instruction to treat its
rows as leads. That is the helper's second use, so keep it.

Lanes editing one worktree share its files, its scratch directory and its test runs, so give each a
disjoint path set, its own scratch subdirectory and never a shared helper name. In the readability pass of
2026-09-22 one lane's `rep.ts` overwrote another's, and about 30 files' edits silently failed to land. A
lane's tests read the whole tree, so while other lanes are editing, `SOLVABILITY_SOURCE_DRIFT`
(`src/run/claim-write.ts`), parse errors in half-edited files and host-wall timeouts are all expected. A
lane re-runs a failing file alone before reporting it, and the coordinator runs the full suite once after
every lane has finished.

When the launching session holds much context and lanes are to change a PR, split it by commit, one lane
and worktree each. Every lane reads, then stops at a proposal naming its evidence and the commit each fix
folds into. Answer each at most twice, steering with what other lanes and the wider system show, then let
it commit `--fixup`s with focused checks, and fold and push once. On 2026-09-26 a reply stopped a lane
handing timeouts to the environment, which another lane had shown ends the campaign at submit.

**A comment-only pass is still a source change**, and it carries six hazards.

The first is unused exports. `unusedExports` looks for a reader of each `AUTHORED_ROOTS` export under the
deliberately wider `READER_ROOTS` (§9), and a name in a comment counts, so deleting a comment in a test
can orphan an export in `src`; drop the `export` the gate then names. Run `source-policy.ts` whole,
because it silently ignores paths: its last line calls `main()` where `complexity-policy.ts` calls
`main(Bun.argv.slice(2))`. So `bun tools/loc/source-policy.ts test` prints the `src tools vendor` verdict,
and reporting it as a pass over `test` claims a check that never ran. Report the no-argument run as what
it is. The second is literals: any string, template or regex literal that moves changes a prompt digest,
so compare every literal per file against the base before committing. The third is claims. A rewritten
comment keeps only the claims checked against the code in that turn, because a shortened sentence still
asserting a refusal nothing performs is a new false statement, not a tidier old one.

The fourth is the check itself. Comparing token streams looks exact, and a bare `ts.createScanner` is not.
With no parser driving it, it never rescans the `}` closing a `${…}` as a template tail, so the backtick
ending that literal reads as one opening a new literal, and the next token swallows every byte up to the
following backtick, comments included. On 2026-09-23 that called 31 of 90 comment-only files code changes,
and it did so on exactly the substitution-heavy prompt modules most worth checking. Parse instead, with
`createSourceFile`, and print both versions with `removeComments: true`. The failure is one-directional: a
tokeniser never misses a real change, it just cannot tell you there is none, which was the only thing it
was being asked.

The fifth is the blind spot that remedy creates, and it runs the other way. `@ts-expect-error`,
`oxlint-disable-next-line` and `biome-ignore` are comments that change the build, so a pass that rewrites,
moves or drops one reads as identical, silently. Extract the directives from both versions and compare
their text rather than their count, because a rewritten rule name leaves the count alone. On 2026-09-23, 8
of 355 changed files carried directives and all 8 were unchanged, which took one command and is the only
reason the comparator's verdict meant what it said.

The sixth is a gate that looks as though it covers you and does not. Biome owns line breaks at 110, but it
never rewraps a comment: clean `main` carries 210-character comment lines while `biome format .` reports
"No fixes applied" over 1,044 files. On 2026-09-23 this pass added four lines past the limit before anyone
looked, all of them inline `/* SAFETY: … */` justifications sharing a line with their assertion, the
longest 233 characters. So measure the added lines yourself. Wrapping one is safe, since §5.17 accepts
whitespace, newlines included, and opening parentheses in between, and when `biome format` then rejoins a
call the comment had held apart, that is the base formatting returning rather than a change of yours.

Transport is owned by `.claude/skills/codex-luna-swarm/SKILL.md`, whose route changes whenever a
provider's allowance does. Session reports are research rather than evidence, so check any load-bearing
finding against the source before acting on it. A report whose author cannot be established is
unattributed research.

### Writing style

Write the way this file and the best PR bodies in this repository read: as an account of what you found
and what it means, in sentences that carry their own reason. The reader is a colleague who was not there,
so tell them what happened, why it is not what they would have expected, and what it does now instead. The
opening of a recent PR body is the specimen to copy:

```text
It turned out that some of what a round hands to the next one was not being carried across
properly, and that in a few places a reader ended up saying more than it could actually know.

You would not expect much loss here. The Builder keeps one conversation for a whole run, so the
round's own facts -- the task count, the contract the tasks are written under -- are nominally in
context the entire time, across every compaction. But pi does compact that conversation, and the
opening turn is exactly the part that gets cut first, because it is the oldest. So a session that
has been running a while can genuinely no longer know how many tasks it was asked for. It then
either buys that back with a gate call or, worse, guesses.
```

Four things are doing the work there. The first sentence says what was wrong in plain words before naming
a single symbol. The second paragraph raises the reader's own objection and answers it, which is what
makes the rest land. The mechanism arrives as ordinary facts, each following from the last. And the
consequence is concrete: a gate call, or a guess.

Write in full paragraphs, three or four sentences that build on each other rather than one sentence
standing alone under a bold heading. The default a model reaches for, a clipped fragment, a dash, another
fragment and then three noun-phrase bullets, reads as a thought interrupted before it arrived, and it
leaves the reader to rebuild the connection between the pieces. Say the connection instead: because, so,
which means, that is why. A list is for things that genuinely sit side by side, and most of what gets
listed here is a sequence with a cause running through it. Fragments and headings are not wrong in
themselves; they are wrong when they replace the sentence that would have explained.

Numbers belong in the prose, at the point where they earn something: "used twice in eight recorded
sessions"; "5,406 findings named a bare root against 3,196 naming a path below one"; "37 pass, 1 fail". A
count sitting in its own closing section has to be joined back to the claim by hand, and often is not. For
a repair, say what fails when it is reverted, and how many tests that is.

State exactly what you did and what you did not. A skipped check is said to be skipped, failed tests come
with their output, and a claim resting on one lane's report rather than on the source says so. Nothing
here needs selling, and a sentence that sounds like selling is usually missing its evidence.

A small example beats an adjective: "one owner instead of five" says more than "cleaner". Where a rule
exists because something went wrong, the incident is the explanation, so name it, date it and let it
argue. That holds for this file, for a PR body and for a session report, which are read once against a
settled history. It does not hold for a source comment, which is read again and again against a tree that
keeps moving, so a run id, a campaign, a pass count or a token total in one goes quietly false while still
reading as authoritative, and costs the next reader a wrong belief rather than merely time. In a comment,
keep the mechanism and drop the incident: "run c66e0d's manual kill discarded 21 accepted artifacts"
becomes "a manual kill discards every accepted artifact the round has not yet verified", which is the same
fact and stays true. Make routine minor changes directly, and raise only the decisions the operator
actually has to make.

Several operator terms cover more than one system, so resolve them aloud in a clause rather than silently
picking one. "Queries" may mean harness-query probes, review lanes or subagent sessions; "judges" may mean
the in-run Judge slot or the review lanes; "the run" is reserved for the paid full run; and "cycle N" is
most likely one cycle of a cycle series. Suffix a `cNN` name with its product.

One operator term is not ambiguous, and it is easy to under-read. To "sed" something from a source means
copying it across as directly as that source allows: the code, its names, its patterns, its constants and
its messages, verbatim, with the upstream path and commit cited beside the copy. Rewrite only what this
repository forces, such as a lint rule the upstream spelling breaks, a primitive the tree already owns or
a name that would collide with one here, and name each departure in the report, so that a reader need not
diff against upstream to find them. A fresh implementation of the same idea is not a sed, and neither is
adding the upstream package as a dependency. On 2026-09-24 a test-runner fix the operator asked to sed
from Bun's CI runner arrived as hand-written code, then as a new dependency, then as a rewrite of Bun's
approach, before Bun's parse loop and messages were copied across (operator decision 2026-09-24).

### Repository map

| path | contents |
| --- | --- |
| `src/` | the product: `analyse author backends builder claim correctness-bundle critic gate` |
| | `meta observe review run solve verify` |
| `src/meta/` | the runtime surface owners (§6) |
| `tools/` | `gate.sh`, `oxlint/`, `loc/`, `runtime/`, `harness/`, `outcome/`, `replay/`, `runs/`, |
| | `run-triage/`, `secrets/`, `login/`, `vm/`, the fullrun launchd/systemd launchers |
| `test/`, `test/helpers/` | the suite; `bun run test` discovers `test/` only |
| `vendor/` | pinned upstream copies: `pi-agent-session`, `pi-built`, `pi-claude-bridge`, |
| | `agent-bundle`, `correctness-model-bundle`, `correctness-model-prims`, `harbor` |
| `starters/` | Builder-visible templates and `STARTER.md`; never imports `src/` |
| `packages/ui/` | the UI, with its own lockfile (`bun run ui:deps`) |
| `scripts/` | `worktree.sh` |
| `.claude/skills/` | operator skills; `main/{cli,git,run}.ts` are their shared owners |
| `campaigns/`, `domains/`, `runs/` | controller-generated: never edited, linted or committed |
| `docs/`, `notes/` (ignored) | prose; the gate-audit and climb-rewrite ledgers |
