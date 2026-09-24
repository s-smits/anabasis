# AGENTS.md

This is the working contract for Claude Code, Codex and their subagents in this repository.
`CLAUDE.md` is a symlink to it, so both read the same bytes. What belongs here is principle and
standing operator decision; the forward queue, the current head, the run condition and the open
questions belong to the operator's plan and to Git history. Where this file and newer evidence
disagree, the evidence wins. And where a rule here describes a mechanism that has since left the
source, it is dead text — say so rather than obeying it.

Be eager. Given an ambiguity, do the task rather than ask about it. Carry authorised work through
implementation, checks and delivery; the authorisation survives turns and compaction, and does not
need renewing because the conversation was summarised. Ask only when a decision or a permission is
genuinely missing, and when you do, have the reviewable result ready and name the rule that blocks
you.

<!-- weekly-best-run:start -->
<!-- weekly-best-run:end -->

**Bun only.** Every repository task runs on the stable Bun 1.4.2 named in `.bun-version`, including
a one-off inspection: never Node, npm, npx,
compatibility prefixes, version managers or package-manager handshake-variable changes.
A canary at the same version number is a different runtime, not a near-enough one. If the pinned
Bun is unavailable, report the environment gap rather than reaching for what is at hand. A run
already in flight keeps its opening's executable bytes until it finishes. The one exception is
Astra, where ad hoc inspection, data handling and automation scripts are better written in Python;
repository source and its test and gate commands stay on TypeScript and Bun.

## What Anabasis does

One short prompt about a technical domain becomes two products: an agent harness that solves tasks
in that domain, and an evaluation that decides whether those solutions are correct. The second is
much the harder one. Plausible tasks are cheap — anyone can write twenty-five of them — but a
correctness model that accepts the right answers and rejects the convincing wrong ones is the only
thing that makes a measured pass rate mean anything. The same test applies to every rule in this
file. A rule matters when construction carries it into the product or a check enforces it, and a
check that never changes a decision is decoration.

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

1. **Input.** The one line names a field, not a deliverable: "designs steel roof trusses to
   Eurocode 3". Nothing else goes in — no plan, no answer key, no driver, no hint. Public
   `--context` files are the only additional input there is.
2. **Build.** The Builder reads `STARTER.md` in a seeded workspace and writes the entire bundle
   itself: `correctness-model/brief.json` for the domain plan and the public rule decisions,
   `.../tasks.json` for the public inputs and the hidden expectations, `.../controls.json` for the
   task-bound accept and reject artifacts, `.../evaluator.ts` for the named Boolean checks,
   `.../reference/index.ts` for a reference solve over public input, then `agent/tools-spec.json`,
   `agent/tools.ts`, `agent/BUILT_AGENTS.md` and `agent/config.yaml`. Before it writes around the
   domain's real open-source tools, it installs them.
3. **Gate.** `submit` freezes the candidate once and runs a single sequence against that snapshot
   and nothing else. A refusal keeps the session alive; acceptance ends it.
4. **Measure.** The Built Harness solves the battery behind its own file wall, using the tools the
   Builder wrote for it. The host verifier then runs the declared checks over each accepted
   artifact, and every tool run is hashed and recorded as an evidence row.
5. **Learn.** The review slot reads the recorded rows and traces and writes advice. It never
   changes a pass, an acceptance or a claim.
6. **Next move.** Code admits construction, measurement, an adopted-product continuation or a typed
   stop. The Builder that already exists chooses the next experiment from the recorded evidence;
   there is no separate planner to hand the decision to. Its bounded `EXPERIMENT.json`
   (`experiment-plan/v2`, owned by `src/author/experiment-plan.ts`) records the gap, the change,
   the expected result, the scope, a `target` of `{comparator: "at-least" | "at-most",
   verifiedPasses}`, each family's ladder `level` and `move`, and a predicted pass probability
   per task.

### Design priors

Ten decisions are settled. Code that quietly moves one of them is a defect rather than a choice,
and each is here because moving it cost something.

1. **Correctness has one owner.** The host verifier, running the declared checks and the installed
   tools, decides every pass. No model judge, no review and no Builder claim sets a score.
2. **The input is one line.** No hidden plan, custom driver or evaluator hint rescues a launch that
   would otherwise fail.
3. **The Builder authors the whole bundle.** Nothing under `domains/` is hand-written or repaired
   by hand. A defect that shows up across domains is fixed in the Builder prompt, the shared
   contract or the starter, which is where it came from.
4. **Every environment failure is a typed non-result.** Provider, runtime, sandbox, protocol,
   verifier-host and tool failures leave `truthOk` and `pass` as `null`. A battery made of them
   yields an operational result — never a capability rate, and never a fail.
5. **The Builder chooses task variance and complexity.** The loop prescribes no axis, no step size,
   no family mix and no parent bijection. Levels and statistical bands describe the conditions that
   were recorded; they do not command the next experiment.
6. **Verifier output is protected.** Stdout, stderr, issue text, counterexamples, reference
   artifacts and per-task failure locations never reach the Builder, the Judge, the diagnosis
   reader or an authoring prompt. The test is mechanical: change only protected detail, and every
   prompt digest must come out unchanged.
7. **A task-only comparison keeps its product fixed.** The agent, the tools and the scoring program
   stay as they are while the battery, its task-bound controls and its reference solve change. Even
   then the comparison needs a matching measured model, isolation, thresholds and resource
   conditions before it means anything.
8. **Submit freezes one immutable snapshot.** Validation, conformance, census, F2, adoption and
   measurement all consume those same bytes. Git is the Builder's memory, not the authority on what
   was accepted.
9. **A tool is what the host hashed.** `toolId` resolves once at submit, under the candidate's
   `.toolchain` first and then the host PATH, and every run records its digest, source, inputs,
   exit and outcome.
10. **Approach the limit from above.** A battery the solver mostly passes, arrived at before a
    harder one failed, has found no limit: it proves neither that the checks are complete nor that
    the tasks are difficult. So a first battery is deliberately overly complex, around 3 verified
    of 25, and later batteries aim for a count inside `climb.band` — 0.20 to 0.50, which is 5 to 12
    of 25 — because that is where the limit can actually be measured. `placeOnBand` owns the
    reading: the Wilson interval decides whether a battery is significantly too easy or too hard,
    and the point count decides whether it sits under, on or over the aim. **No course is
    prescribed**, and the reason is recorded. Campaign 3fd52f9e-28 moved only its published
    magnitudes for four consecutive batteries, which is exactly what a prescribed three-stage
    course had told it to do. So the prompts state the counts the band implies and leave the route
    to the Builder, and they are the sole owner of those counts. `renderBatteryContract`
    (`src/run/climb-readout.ts`) states the first battery's count, the count that would find no
    limit and the aim, per size; a continuation states the aim and never the first battery's count.
    Every sentence it and the climb readout send is a line of `FRAME`
    (`src/run/climb-readout-frame.ts`), and `FRAME_REVISION` is recorded in
    `difficulty-decision/v6`, so rewording a sentence creates a new recorded condition rather than
    a tidier one. The readout states each family's solve effort, as median and most minutes against
    `solve_minutes` and median tool calls, and scores the plan's per-task predictions against the
    verdicts. Effort is stated as a fact and never read as difficulty, because within a battery
    minutes and tool calls do not separate the cases that passed from those that failed. Useful
    adopted work is retained.

## Evidence and implementation status

"Done" hides four different states, so use whichever of these four is true:

1. **Present in source:** the named tree holds the producer and its live consumer.
2. **Deterministically proved:** a positive and a hostile check exercise that consumer on that tree.
3. **Live-exercised:** a recorded run from that exact source reaches the branch.
4. **Outcome-proved:** the live run supports the capability or limit being claimed.

Prompt assertions prove text. Types prove shape. Gates prove the conditions they test. None of them
proves better model behaviour or a completed product vertical, and neither do started runs, PR
prose, reference artifacts, static discrimination controls or a move that is only projected.

```text
recorded run bytes > verified evidence reader > source and tests > terminal/log line > PR body > prose
```

A negative capability claim — "the gate does not enforce X", "nothing checks Y" — is the most
expensive kind to get wrong, because it instructs every later reader to compensate for a defect
that does not exist. One of those enters this file only with a named symbol, its call sites and a
check run in the same turn that writes it. A session report is a lead towards that check, not the
check itself. The same holds for every named threshold, constant, closed-set member and path
written here: grep-confirm it against `thresholds.frozen.yaml` or `src/` in the turn you write it,
because a rule whose mechanism has left the source is dead text that still costs a reader an
investigation.

Analyse against the full `source.commit` in `opening.json`, cite it, and show its first nine hex
characters in `main_synthesis.md`. A missing object is `source-unresolved`. A fix only counts as
current when it is an ancestor of the measured tree, and a composed stack needs every child to
contain its latest published parent. GitHub's `CLEAN` state proves neither of those.

Separate the case outcomes before reading any score:

- `verified` — an accepted submission with a verifier verdict;
- `unaccepted` — the agent ran but produced no accepted submission;
- `non-result` — a provider, runtime, sandbox, protocol, verifier-host or other typed environment
  failure, with `truthOk: null` and `pass: null`.

Only verified cases enter a capability rate. Zero verified cases give an operational result and no
capability result at all; SIGTERM preserves the recorded denominators either way. Remember also
that an in-run battery is scoring the Builder's own tasks, which is a much easier exam than it
looks: truss `0aad0d` passed 75 of 75 there, and the same agent under a Sol solver passed 2 of 23
verified hard tasks. Compare on one shared pack or not at all.

A cycle series is the independent evaluation of a real run. Each cycle measures the harness exactly
as the recorded run left it at that point, against the shared pack. An early cycle is expected to
be incomplete — c01 may have no operating guide, or a guide naming an analyser that was never
installed, or a tool reading a field the pack does not publish. It still solves, and that
incompleteness is the thing the later cycles climb away from. So never repair, complete or
back-port a cycle's bundle, and never substitute a later state for an earlier one. A condition that
differs between cycles goes in the sweep's caveats, and the results are read through it. A low
score on an early cycle is the expected signal; only a non-result is re-solved.

A run the environment cut short keeps every level it measured before the cut. When two runs are of
unequal length, compare them over the shorter one's elapsed window on both sides, and name that
window in the comparison.

Report the identities, and report verified, unaccepted and non-result counts separately. Difficulty
gets its own denominator: once any case is truth-verified, door-rejected attempts count as
difficulty failures. A battery that is entirely unaccepted is `no-difficulty-evidence` — rebuild,
with no capability rate and no difficulty strike. An unproven served-model identity refuses the
identity claim, and that is all it does: it does not reclassify a scored case as an environment
non-result.

During the beta, explicit Codex or Claude credit exhaustion is a normal operational interruption:
preserve the recorded results and classify the affected work from its receipts. That applies only
where the provider explicitly reports exhaustion. A generic 429, a timeout, a crash, an authoring
stall or an unexplained refusal is not proof of no credits — investigate what actually failed.

The controller's terminal codes are a closed set of eight: `completed`, `stopped`,
`fixed-product-boundary`, `build-failed`, `candidate-held`, `budget-limited`,
`environment-blocked`, `operator-interrupted`. Only `completed` says the run
settled the question it was launched to answer. `fullrun` exits 0 for `completed`, 3 for
`operator-interrupted` and 1 for everything else.

### What may be claimed

- **Safety:** the system refused a bad or unprovable result.
- **Mechanism:** the intended branch executed and wrote its evidence.
- **Capability:** verified artifacts passed the verifier under the named condition. The sentence
  names the recorded tool source and digest, because a Builder-authored checker is not independent.
- **Limit:** one fixed harness reached a pre-registered semantic level, and the deepest stable
  result was observed.

An advice packet arriving at a second build proves that the channel executed, and nothing more;
improvement needs outcome evidence. A 21/25 first battery found no limit. Static F2 and
discrimination evidence prove the gates they run in, but a completed Built Harness task requires
live evidence.

## Working rules

1. **The Builder builds the whole domain product.** It owns the representation, the brief, the task
   families, the task-bound controls, the operating guide, the tool contract, the declared external
   tools and the verifier content. Never hand-write a bundle and never repair controller output by
   hand; when a generated defect shows up across domains, fix it in the Builder, the shared
   contract or the starter. Deterministic registration, submission, run-loop and evidence code is
   written once in `starters/` or `vendor/`, and domain meaning and difficulty are left to the
   Builder. Find the established public interface and install the real public tool, under
   `.toolchain` or on the host PATH. A stand-in proves conformance to itself and to nothing else,
   and running an authored algorithm through an installed interpreter does not make that algorithm
   independent.

2. **Use the user's prompt exactly.** The input is one short prompt plus optional public
   `--context` paths. The operator's own words are "ONLY GIVE IT ONE LINER!! THIS IS THE MAGIC OF
   THE SYSTEM." Never add a hidden plan or a custom one-test driver.

3. **The controller owns generated output.** That covers `domains/`, `campaigns/`, runs, claims,
   admissions and promotion archives: do not edit them, repair them or commit them. The campaign
   tree has one owner, `campaignRoot()` in `src/meta/campaign-root.ts`, so never spell a campaign
   path yourself. An epoch is one authoring workspace — one Builder condition, one prompt, one
   authoring pass. A corrected prompt, a different Builder or a reopened product starts a new one;
   a measurement round does not. A failed candidate never replaces the current version. A requested
   evaluation repair is seeded once from the adopted bundle and preserves in-flight edits when it
   resumes; the adopted bundle itself stays immutable, and the accepted repair is classified by
   what actually moved.

4. **Do not coach the evaluator.** The operator's decision is that "evaluator coaching is reward
   hacking", and it is treated as test-set leakage. Protected: verifier stdout and stderr, issue
   and remedy text, verifier source and internal payloads, generated counterexamples, reference
   artifacts and per-task failure locations. None of it may reach the Builder, the Main Judge, the
   diagnosis reader, the advice packet or any authoring prompt. Public compiler errors and
   generated-module diagnostics may cross, because they describe the public authoring interface
   rather than the answer. The test is exact: change only protected verifier detail, and every
   model-visible prompt digest must come out unchanged.

   Two bounded exceptions exist. `harness_trial` returns a single per-task aggregate
   `truth.verdict` — pass, fail or not-run — for the task the caller selected and for the bytes the
   confined Built solver submitted for it unaided; check identities, per-check results, verifier
   output and diagnostics all stay withheld. That one bit is the battery's own condition on one
   task, which is exactly what a measured battery publishes for all of them, and it is the only
   instrument that lets a Builder discover its battery is too easy before paying to find out. Until
   2026-09-19 the caller supplied the solve itself, which made it the author playing solver while
   holding the answer key; it was used twice in eight recorded sessions, and the campaigns that
   ignored it declared "at most 2 verified passes" three rounds running and then measured six of
   six. The Epoch Reviewer's `probe_check` is the other exception, and rule 9 owns it.

   The Built Harness still needs the public validity relation: the requirements, constraints,
   precedence, closed value sets, constants, cited authorities, candidates and declared runtime
   facts. What is withheld is a sufficient construction algorithm — search order, allocation
   recipe, fallback chain, derivation and hidden tie-break. Withholding is a property of everything
   the agent can read, which means the brief, the operating guide, the tool descriptions and the
   tool return payloads together, not a list of filenames.

5. **Give models freedom over content and code authority over conditions.** Code owns the facts the
   model cannot observe and the decisions where the model is the subject, plus anything that has to
   stay byte-identical during a comparison: source and model identities, isolation, the task
   condition, verification, denominators, claims, rollback and promotion. Models own the
   representation, the task families, the meaning of a tool, the diagnosis and the semantic
   proposal for the next difficulty. The Built Harness owns its own solving method. Code may
   validate declared structure and realised bytes, but it must not start choosing domain content
   because reasoning about that content looks difficult. In particular: no autonomous scheduler, no
   model-written claim check, no deterministic harness-defect classifier.

6. **Use evidence as evidence.** Apply the identities, case kinds and denominators above. After
   five consecutive provider non-results, stop scheduling new battery cases: let the in-flight
   cases finish, record every unscheduled task as a typed provider non-result, and reset the count
   when a case recovers.

   Evidence cardinality follows the work that ran. Each authoring session writes its own execution
   record and never overwrites an earlier one, so a reader aggregates every record and picks the
   latest by iteration time rather than by append order. Builder tool returns checkpoint that
   record during a long turn, and those checkpoints are the liveness evidence — not file mtimes.
   Tool evidence counts attempted, completed, failed and could-not-run actions separately, and a
   submit result joins to its attempt by session and turn, never by whatever is nearby. A clause
   that exists only in stdout is not durable evidence. An admission packet that routes no owner is
   lineage with a reason — `no-feedback`, `agenda-consumed` or `evaluation-identity-unadopted` —
   and it selects no owner. Unknown usage or cost stays `null` rather than reading as zero, and a
   turn the provider costed is kept separate from one the transport estimated. The reason is worth
   spelling out: a streamed frame's `usage` is not final, an interrupted turn never receives the
   result message carrying the turn's account, and each frame repeats the whole cached input while
   none of them carries a cost. A total that holds estimated turns therefore bounds nothing in
   either direction. `usage.estimatedTurns` counts them beside `reportedTurns`, and on an older
   record it is absent, which means unknown rather than zero.

   Order harness versions and checkpoints by recorded commit time, not by directory order or file
   mtime. Per-case external and differential grounding coverage applies only to truth-verified
   cases whose accepted artifact bytes actually reached the verifier; unaccepted attempts stay in
   the difficulty denominator and the runtime-identity census, but they cannot require a tool run
   over bytes that do not exist.

   Runtime safeguards are bounded log-only sensors: one line to
   `campaigns/<project>/safeguards/<runId>/SAFEGUARDS_LOG.txt` plus stderr, best-effort. A
   safeguard never changes a case kind, a terminal, a route or a score, so read its line as a lead.
   When a recurring shape turns out to have a real owner, move it into source and remove the
   sensor.

7. **Give every decision one owner.** Every actionable piece of evidence names its producer, the
   exact evidence it cites and the active owner. `FeedbackOwner` is a closed set of nine:
   `brief`, `tests`, `instructions`, `tools-spec`, `accept-controls`, `controls`,
   `correctness-model`, `fingerprint`, `environment` (`FEEDBACK_OWNERS`,
   `src/author/campaign-types.ts`). Repair ownership names
   the defective contract; it is not a write mask and not an automatic reset. Preserve in-flight
   work, and let the accepted bytes decide attribution.

   A claim-only `CampaignFeedback` row carries routing metadata rather than a controller-validated
   finding, so keep its code and path for routing and drop its free-text claim at the author
   boundary. A typed finding that a controller validator produced may keep its detail inside
   controller-owned campaign carry, projected exactly once at the model-visible boundary. An
   unmarked finding fails closed to `generated-execution-unclassified`. Opt a generated finding
   into author-visible detail only where the producer composed that detail from public authoring
   identities — control ids, mutation classes, family names, declared check ids. When rebuild-tier
   rows tie, pick the owner whose declared closure settles the most rows, and let arrival order be
   the last tie-break.

8. **Spend complexity only when it changes a useful decision.** Map each concept as
   `owner → live consumer → decision changed → evidence → hostile test`. Reuse readers and owners,
   derive copied state rather than storing it twice, inline a rule-free one-caller wrapper, and
   remove mechanisms and files nothing uses. What a cut must preserve: isolation, identities,
   non-results, denominators, claims, rollback and controller-owned submission.

   Keep no backwards compatibility (operator decision 2026-09-22). A reader takes the current
   schema and version and nothing else. A legacy alias, a fallback branch, a superseded-version
   reader or a set member nothing produces is removed rather than kept so that older recorded runs
   stay readable, and a reader meeting an older version refuses it.

   Where a design choice is uncertain, prefer removing or widening a gate to adding a wall, an
   allowance check or a refusal. The failure mode actually observed here is not unchecked action;
   it is legitimate work blocked by a gate that pays no rent. A gate earns its place by changing a
   decision correctly. Reporting fidelity — carrying a field through, naming a thing accurately —
   is not gating, and is always fair game.

   `thresholds.frozen.yaml` is declared policy, so an executable threshold that disagrees with it
   is a blocking inconsistency rather than an implicit relaxation. New and rewritten files stay at
   or below 800 nonblank lines and functions at or below 115 (`tools/loc/source-policy.ts`, raised
   from 600 and 80 on 2026-09-20, when `biome format` took ownership of the line breaks). That walk
   covers `src`, `tools` and `vendor` and stops there, so a file under `test` or `packages` is held
   to no length at all and a long one there is a judgement rather than a gate finding.

   Six files inside that walk carry a number of their own in the `copiedFileLimits` of
   `tools/loc/source-policy.json`, and an entry there does two things at once that are easy to read
   as one. It replaces the 800-line ceiling with that file's own figure, and it switches the
   per-function check off for that file entirely. Only two of the six numbers are above 800, which
   is the tell: the rest are not exemptions from the file ceiling at all. `src/truth/probes.ts` is
   held at 436 while sitting at 432, nowhere near the ceiling it is nominally exempt from, because
   what the entry actually buys is room for `makeProbeControls` at 150 lines against a limit of
   115. So the figure tells you nothing until you know which of the two checks it was bought for,
   and meanwhile it is a tighter budget than the rest of the tree gets — four lines of headroom
   there, which restoring a handful of comments is enough to spend. Nor is the entry permanent:
   `staleCopyLimits` fails the gate when a listed file starts passing the ordinary ceilings by
   itself, so the day that function drops under 116 the entry has to come out with it. And
   `tools/loc/complexity-policy.ts` keeps every function's cyclomatic complexity below 22, with the
   existing exceptions frozen in `complexity-baseline.json` — a baseline that only ever shrinks
   (`--write-baseline`). `bun run lint` runs Oxlint over `src tools vendor starters test
   packages .claude` with two plugins: `anti-slop`, copied from dmmulroy/anti-slop, whose 17 rules
   include `require-safety-comment-for-type-assertion`, `no-object-parameters`, `no-runtime-typeof`
   and `no-module-mocking`; and `ana`, with 37 rules, where `tools/oxlint/BASELINE.md` says what is
   on, `SHAPE-RULESET.md` says what is not yet, and `FIXER-DECISIONS.md` says why 15 of the 54
   carry a fixer and 39 only report — including the nine whose fixer is mechanically available and
   refused on purpose. Those counts move whenever a rule lands, so read them off the registered
   rules in each plugin's `index.ts` rather than from here. Both plugins are optional in a
   particular sense: every lint runs them, but their findings and the not-slop ledger fail it only
   under `bun run lint -- --strict` or with
   `ANA_LINT_STRICT=1` in the environment, and the `.env` is not loaded because `bunfig.toml` sets
   `env = false`. A plain run therefore holds a contributor to oxlint's own rules and counts the
   rest. A clone becomes strict by default once it runs `git config ana.lintStrict true`: the key
   lives in its `.git/config`, is shared by its worktrees and is never pushed.

   A new file receives no grandfathered exception. **Never turn a rule off to clear a finding**: no
   new `"off"` entry in `.oxlintrc.json`, and no widening of an existing one to take in the file
   you are editing. What is already there is not that, which is worth saying because eight override
   blocks disabling up to thirty rules apiece read at first glance like exactly what the rule
   forbids. `tools/oxlint/BASELINE.md` owns them, and it reads each entry as that rule's debt on
   the day it was registered: the files that already broke it, with the rule holding every other
   file in the repository from that moment, including every new one. Registering a rule with a
   35-file exemption therefore beats leaving it unregistered until the overhaul finishes, because
   an unregistered rule holds nothing at all while the pattern keeps arriving in new files. Three
   entries are not debt and will never shrink, because there the rule is wrong about this
   repository rather than the other way round, and BASELINE.md gives each one its evidence:
   `typescript/await-thenable` is off under `test/**` because Bun declares `expect(...).rejects`
   without a Thenable type, so all 215 reports were `await expect(...)` and none was a defect. Nor
   is an override block always an exemption — `**/src/backends/oauth/**` turns nothing off and adds
   two errors, which is where this file's own rule about `capturedJsonParse` is enforced. The one
   place the contract has drifted from the config is the shrinking: BASELINE.md describes a list of
   files losing a line as each one is cleared, and all eight scopes are now globs over a tree or a
   file type, so an exemption cannot shrink a file at a time. It ends whole, once the last file
   under the glob passes. An inline suppression is the opposite case and never becomes debt at all,
   because `bun run lint` passes `--report-unused-disable-directives`: a disable comment that no
   longer names a finding fails the run, and a not-slop ledger row that no longer names one fails
   it the same way, under the strict lint for a plugin rule's.

   Tuning the deterministic linter is endorsed, `bun run lint` and `bun run simplify` alike,
   but in one direction only: change the rule's source so it targets the slop more precisely, so
   that the legitimate shape it mis-targeted passes and every slop case it caught still fails, with
   a fixture for each side. A finding the rule cannot tell apart that way is fixed in code, or
   answered with a reasoned row in the not-slop ledger. That decision is dated 2026-09-22, and it
   came after a `test/**` override and a `json-shape.ts` override silenced 13 findings wholesale.
   Treat every `unknown` parameter as a proof obligation, keep raw uncertainty at the validation
   boundary, and never hide an unproved input behind a generic intersection to satisfy the lint.
   OAuth bytes are external input: use `capturedJsonParse`.

9. **Judges advise; the verifier decides.** The Main Judge reviews only accepted shipping artifacts
   that already carry a boolean verifier verdict, so unaccepted submissions, refusals, non-results
   and missing artifacts cost no Judge call at all. There is no Judge control census: no control
   and no bait subject reaches the Judge, and a new run writes no sample, bait or standing file.
   Every ordinary accept and reject control is still task-bound and still verified through its
   declared check by the verifier.

   Each subject gets a fresh Judge session, in groups of at most five, stopping after five
   consecutive provider errors, with a 30-minute hard wall per turn, and the first valid verdict
   stands. The Judge sees the original request, the bound public task, the submitted artifact, the
   public schema and design rules, the projected tool contract and the declared runtime facts. It
   never sees the Built prompt, the solve trace, verifier output or a reference artifact, and two
   artifacts are never compared inside one prompt. `judgeDeAnchoring` in `thresholds.frozen.yaml`
   has five rows and they divide two ways, which is worth knowing before you go looking for the
   code behind them. Two already hold by construction, and by the two sentences above:
   `commitAllTasksInPhaseZero` is the fresh session per subject, and `fallbackConfigured: false` is
   the slot resolving one model with no fallback. The other three —
   `commitBeforeSeeingCandidate`, `predictionsMustBeFalsifiable` and `predictionsMustBeDisposed` —
   describe a rank-2 paired-comparison protocol that is not implemented, so nothing establishes
   them and nothing should start to. Keep those three unbound.

   A Judge fail must cite at least one verbatim rule from the public validity rules, the artifact
   schema or the public input; an uncited fail is a protocol non-result. A cited fail of a verifier
   pass is a **veto**, recorded on the claim as `vetoed` and bounded by `verifierPassJudgeFail`,
   and a contradicting first verdict is re-sampled once. Vetoes and disputed fails go to the Epoch
   Reviewer to settle, and a settled veto projects only its count and family to the Builder.
   Through all of that the Judge sets no score, changes no acceptance and decides no adoption:
   disagreement with the verifier remains a reason to go and inspect the verifier.

   The diagnosis reader (`src/review/diagnosis-reader.ts`) holds the lane neither other reviewer
   covers, which is the solver's own traces read across the battery. It is offered at most six
   standing issues about the solve — verified fails, unaccepted submissions and non-results the
   environment does not own, worst share first (`diagnosableIssues`) — and never a Judge
   disagreement, because that is about the evaluation and the Epoch Reviewer settles it. For each
   issue it sees up to four failing solves, sampled so that distinct failure sequences come first,
   and up to two passing solves of the same family, every one compiled by `compileSolve`
   (`src/review/solve-steps.ts`) into numbered steps such as `c04.s7` and `c04.end`. Beside them
   sit the measured harness's walls, its declared tool descriptions, its operating guide and a
   census of every solve's tool use. Its one tool, `record_diagnosis`, takes a harness layer from
   `DIAGNOSIS_LAYERS`, an intervention from `DIAGNOSIS_INTERVENTIONS`, a first observed failure
   boundary, a cause and a falsifier. It refuses a boundary that is not a shown step of a solve the
   reading names, a contrast that is not a step of a shown passing solve, a solver-layer reading
   that proposes a change, and any text naming a task. One reading may cover several issues that
   share a flaw. Confidence is computed from how many sampled solves the reading holds for and
   whether it cites a contrast, never stated by the model.

   The reader opens no `verifier.json`, Judge record or accepted artifact, and records
   `promptDigest`, so a change to protected detail alone leaves that digest unchanged — which is
   also why its boundary and falsifier may reach the author. The rebuild advice renders the layer,
   the intervention, the boundary and the falsifier with the support counts, and keeps the cause in
   the record, where the Epoch Reviewer reads it beside each standing issue. The reader selects no
   owner. Treat a timeout as diagnosable unless the battery
   evidence proves the environment owns it.

   The Epoch Reviewer runs once per measured-condition digest, and may record routable findings or
   dispute a standing issue. It labels each finding advisory or blocking, and blocking requires a
   demonstrated violation of the request or of a declared requirement. Its orientation states where
   the battery landed on the band, through `placeOnBand` — the same reading the climb readout gives
   the author — so that the one component reading the measured tree against the original request
   knows what the round was aiming for. Until 2026-09-18 it saw the counts alone and was asked
   about "a perfect or near-perfect battery", which left the whole `over-aim` zone, the zone whose
   name says no limit was measured, with no stated reason to inspect anything. The placement opens
   a question; the finding is still owed to whatever the request demands and the tasks leave
   undemanded.

   The orientation also carries the round's own `EXPERIMENT.json` — the gap, the change, the
   expected result, the target and the per-task predictions — because a reviewer asked whether a
   result was earned was never told what the round set out to earn. A measured battery reads the
   plan recorded with it, stated as met or missed against its target and with its predictions
   scored by `predictionScore`; a checkpoint reads the plan the workspace holds now, which the
   controller passes because a repair review's snapshot does not contain it. The plan is intent and
   never evidence of success, and it enters no condition digest, so a different plan over identical
   bytes does not buy a second review. The reviewer's closing message is recorded as its `report`,
   and it is told so and asked for plain prose; its tools refuse only what a decision or rule 4
   reads, so a long claim or a fifth citation is recorded rather than bounced for its form.

   The reviewer may also **execute**. `probe_check` takes one accept control, one rooted path into
   its artifact in the spelling the declared checks use (`$.layout.members[0].area`, read through
   `jsonPathTokens`) and one change: either a replacement value, or, for a text leaf, a `find` that
   occurs exactly once in it and the `replace` that takes its place, and refuses a call sending both
   or neither. The edit exists because a field that is a whole source file can run past the
   4,000-character ceiling a value is held to (`VALUE_MAX_CHARS`, `src/review/review-probe.ts`)
   while the line two readings of a rule disagree about occurs in it once. It runs the candidate's
   declared checks over the original and the changed artifact and reports which checks moved. At
   most eight per review (`PROBE_BUDGET`), accept controls only, on a path that already exists. A
   probe whose original did not pass, or whose changed artifact reached no verdict, is not evidence.
   Every harness-defect finding cites its `probeIds`, or sends `[]` for a source-only reading, and a
   probe-backed harness defect may be admitted blocking on first occurrence. Otherwise a first
   agent-side defect stays advisory, and recurrence is keyed by the declared check the finding
   names, or by the artifact path when it names no check — but only a path below a declared schema
   root. A bare root is not an identity: `schemaPath` requires the first segment alone, so a
   one-root domain offers exactly one word for the whole artifact, and across the recorded corpus
   every campaign that fell back to a path collapsed to a single constant. Run 17f9de demoted a new
   finding on two recurrences that belonged to other defects; the same collapse raises one at a
   single recurrence, which is how a 25-of-25 harness came to be reset. Only curriculum or
   evaluation-side defects may dispute an issue, and a dispute keeps the issue counted while
   withholding the agent advice. Public candidate analysis and checks of published limits are
   legitimate solving support — call a tool an answer shortcut only when it supplies the remaining
   decision the solver was meant to make.

   An authoring review reads two things the Builder never sees. One is the bytes the Built solver
   submitted in each of the round's blind rehearsals, beside the one verdict they earned; the
   Builder that ran them saw the verdict and not the bytes. The other is the probes the previous
   review of the same round rested its findings on, as the exact `probe_check` calls that re-run them
   (`carriedDemonstrations`, `src/review/epoch-reviewer.ts`). A carried probe is a lead and backs
   no finding until this review runs it again, because its number belonged to another review over
   bytes that may since have changed.

   Reviewer spend is not an axis for savings. The reviewer is the only component that reads the
   measured tree against the original request, so make it smarter and let the build iterate more.
   A cut is earned when the recorded corpus shows the text bought nothing, never by token count.

10. **Accepted bytes determine experiment attribution.** The frozen operation vocabulary is
    `task-probe | harness-intervention | evaluation-correction | repeat | new-baseline`.

    - **Build / harness intervention** is either no adopted harness at all, or a continuation that
      changes the product. The Builder may reopen the representation, the tools, the task families,
      the artifact schema, the verifier and the solve path. Its captured bytes decide what was
      measured; the name of the loop does not.
    - **Evaluation correction** preserves the agent, the public exam, the rules and the bound
      submission schema while correcting the evaluator, the controls or the private expectations.
      Anything broader receives build attribution.
    - **Task probe** keeps the agent bundle, the representation, the tools and the scoring program
      fixed — that is `brief.json` and `evaluator.ts` with every module it imports, which is what
      `scoringHash` covers — and changes the battery and its task-bound controls, and with them the
      reference solve and the tests. Conformance, controls and F2 all run again before measurement.
      A known product blocker cannot be evaded by changing tasks or relabelling scope.
    - **Environment recovery** keeps the product bytes fixed, and a provider coming back cannot be
      reported as a product improvement.

    There is **one authoring path**. The separate fixed-harness session that prescribed a selected
    level, a family composition and a parent lineage through `DIFFICULTY.json` is gone: across 33
    recorded rounds it never once left the too-easy zone. What it taught is kept in the open path
    as the task freeze, the changed public-input subset and the refusal of a repeated public
    condition.

    A measured candidate with at least one verified case and a written claim is selected through
    the retained-product transaction. A zero-verified or environment-blocked candidate is held with
    `candidate-zero-verified` and never becomes the baseline; its non-result and unaccepted kinds
    still reach the next round through the advice packet. There is no contest between a candidate
    and the current harness. These clauses govern a candidate that would replace a selected product
    (`candidate-promotion.ts`), and the first admitted build has nothing to replace, so
    `selectInitialProduct` (`src/run/product-versions.ts`) selects it at adoption, before its
    battery, and that battery measures it whatever it verifies.

    The rebuild advice packet is deterministic, recorded at
    `analysis/<runId>-rebuild-advice.json` with `rebuild-advice-latest.json` beside it, and bound
    by digest to the iteration that consumes it. Render it once at every rebuild kickoff. Derive
    the advice from recorded rows, recorded Judge reviews and admitted aggregate findings; per-case
    findings never reach authoring. Each issue keeps a stable id and one of the states `active`,
    `tentatively-fixed`, `confirmed-fixed`, `regressed`, `retired`, `disputed` and `unmeasured`. A
    family leaving the task set makes its issue `retired`, which proves no fix at all — absence
    counts towards a fix only when the family actually ran, and only when it ran under the condition
    that observed the issue: the same public inputs, the same `scoringHash` and the same Built model
    and solver walls (`src/author/issue-condition.ts`). A family that reran on other tasks, under
    another scoring program or another Built condition leaves its issue `unmeasured`, named as such
    in the advice and aged neither way, because a task probe that swaps out the failing tasks or an
    evaluator that stops seeing the failure makes an issue vanish without repairing anything. An
    evaluation correction therefore leaves an issue unmeasured too; settling it as corrected would
    need a regrade of the retained accepted artifacts under the corrected evaluator, which nothing
    performs yet.

    `--product-policy fixed` permits measure or stop and refuses build and rebuild. A campaign runs
    uncapped unless the operator sets `--iteration-budget N`; there is no launch default (operator
    decision 2026-08-19). `ControllerLedger` in `src/run/controller-ledger.ts` reserves the
    campaign and provider-run quotas together, before a model call. A started call stays charged
    across interruption, cap changes and epochs, and only an unstarted reservation may be
    cancelled. `budget.json` binds the database identity, and missing or corrupt state refuses
    rather than resetting the spend.

    The controller loop ceilings live in `src/critic/policy.ts`: `environmentBlockedRounds 3`,
    `buildFailedRounds 3`, `stalledFindingsRepeats 8`,
    `noopSubmitStrikes 3`, `unchangedCandidateStrikes 3`, `toolNonResultRefusals 3`, and
    `climb.offAimStreakRounds 3` — consecutive rounds reading one side of the aim, counted in
    batteries, where a round whose claim was refused counts behind a placement but never on its
    own. Runs 17f9de and c1d2a7 each reached three, and the operator stopped each by hand there.
    Nothing is held fixed while the streak runs; the Builder keeps choosing what to change.

11. **Distinguish task demands from coverage and repair.** A level is an ordinal label, not an
    explanation of difficulty. New hashes, new ids, new family names, longer descriptions or more
    scenarios establish no harder problem. The Builder names the public requirement that changed
    and the reasoning interaction it adds. Stronger checks and broader coverage can be worth having
    without making the requested solution any more complex, and a repaired evaluator is a new
    condition rather than proof of a difficulty advance.

    Battery size has one owner, and it is not the file named after it: the numbers sit in
    `POLICY.battery` in `src/critic/policy.ts`, beside the loop ceilings, as `floor 5`,
    `default 25`, `ceiling 60` and `probe {min: 5, max: 10}`, and `src/run/battery-sizing.ts`
    re-exports them and owns the decisions taken from them. A fresh product measures **probe
    batteries of 5 to 10 tasks**, sized by the Builder, until one of them passes some but not all
    of its scored cases; only then the requested size. An out-of-range size fails rather than being clamped, because a silently changed size is
    a silently changed measurement condition. `ClimbAction` is `placed | no-difficulty-evidence |
    repeated-failure-set | family-conflict`: one name for a decision that has a band placement, and
    three for recorded shapes whose rate is not difficulty evidence. The reading itself belongs to
    `placement.zone`, which `placeOnBand` has already decided. `climb`, `hold-limit` and `ease`
    were a second, lossier encoding of those five zones, and every consumer either re-switched on
    the zone or tested `=== "climb"`, which is `zone === "too-easy"` spelled differently
    (2026-09-18). No source file and no row of `thresholds.frozen.yaml` carries the
    `climb.limitHoldRounds = 4` this contract used to cite, and that absence is the design prior
    rather than a defect — the route after a battery at the limit belongs to the Builder.

    All four off-aim zones feed one trailing streak and receive the same course, with only the
    direction-bound words changed: the streak stops where the product crossed the aim, and a
    battery below the aim reads the same scores, repeated task sets, attribution and calibration
    that a battery above it reads. Until 2026-09-18 the streak counted the above-aim side alone,
    which is the side a first battery is deliberately authored away from. A target enters the
    calibration count only when its comparator names the side the streak is on, so the Builder is
    told which comparator to declare. Sample size has one owner too, the Wilson interval at
    `climb.confidence` 0.95 two-sided, whose single quantile is `REPORTING_Z` in
    `src/claim/estimation.ts`; a battery too small to hold a whole count inside the band is refused
    a placement rather than misplaced into one. Both second owners went on 2026-09-18: `wilsonZ`
    along with the duplicate Wilson implementation, and the `minLevelN` floor, which discarded a
    placement whenever the Builder had changed fewer than four tasks.

    At authoring validation, at least one shared `publicInput` path declared by each family's
    applicable truth checks must hold two distinct values. The comparison is per declared path, so
    a check declaring a coarse one is satisfied by any change anywhere inside it: 18 firmware tasks
    passed that validation while every one of them published the same display, the single
    peripheral the request had named. Declared variation proves coverage, and not semantic
    difficulty or actual verifier dependence.

    An open continuation records `EXPERIMENT.json` before preview or submit. Intent cannot change a
    score, override a gate or make identical bytes new. Refuse a repeated public condition on a
    fixed product even after the ids, families or levels have been renamed. After a battery that
    found no limit — above the aim, or every verified case passed — a plan declaring a climb below
    that count must declare, for at least one family, a `move` the last battery's plan did not;
    `repeatedMoveDetail` refuses it under `climb-battery-repeats-history` otherwise, and says it
    compared declarations rather than semantic difficulty. Changed bytes establish membership
    rather than semantic difficulty, and with no observations the result stays unknown.

    `src/author/experiment-plan.ts` owns the plan's two files. The Builder alone writes
    `EXPERIMENT.json`, as `experiment-plan/v2` with a level and a move per family and a pass
    probability per task, and `readPlan` refuses any other schema. The controller alone writes
    `PlanEvidence` to `<campaignDir>/rehearsals/experiment-evidence*.json`, claiming the next free
    name so no round overwrites another; it sits outside the workspace and the fingerprint, and holds
    the round's rehearsal verdicts, their effort and the prediction score. Where rehearsals contradict
    the target or a prediction, `harness_trial`, `correctness_check` and a refused `submit` say so as
    advice that refuses nothing, and `renderPlanView` gives the one compact view that every
    continuation and the context tool's `round/plan` document carry.

12. **Evaluate the requested artifact, not decorative output.** Every artifact-schema root must be
    reached by a material truth check, and every advertised capability must map to checks that can
    fail on real tasks. A root that could be removed or replaced without changing the verdict is
    unverified decoration: refuse it before paid measurement. F2 runs **every** authored task's
    reference solve before adoption — an earlier version solved only `tasks[0]` — and what it
    proves is the submission path, not end-user correctness. A checker-required artifact path,
    suffix or entrypoint is part of public validity, so publish it in the brief and the operating
    guide. Where a checker can execute or simulate submitted source, decide from the values it
    produces rather than from recognising one source shape. Publish every comparison rule exactly
    as the truth path applies it: the counterfactual's direction and scope, any floors or minimum
    counts, and the tolerance.

    A binary answer can be task-conditioned evidence. Refuse a boolean certification that stays
    constant within an affected family when no other applicable check derives it from artifact
    content.

    Controls are what calibrate the checks. At least 5 accepts and 5 rejects — an authoring
    requirement the Builder is told, rather than a size the gate measures, and it is worth knowing
    which before you go looking for the code that enforces it. The floor is declared as
    `evaluatorCalibration.minimumKnownPasses` and `minimumKnownFailures` in
    `thresholds.frozen.yaml`, bound through `src/claim/calibration.ts`, and asserted into the
    starter pack, where `test/starter-pack.test.ts` holds the sentence to the declared number. What
    the gate then runs is `validateControls` and `publicRuleFindings` (`src/truth/controls.ts`),
    and both check coverage alone: every applicable check-by-family cell, every declared check's
    reject, every family's reject. Of the nine places in `src` and `tools` that read
    `corpus.accept.length` or `corpus.reject.length`, seven report the number and two test it for
    zero; none compares it against five. The floor's one non-test consumer is
    `acceptIndependenceFeedback` (`src/run/accept-control-independence.ts`), where it bounds a row
    that is explicitly advisory and refuses no candidate. That is by design rather than a gap:
    `thresholds.frozen.yaml`'s own comment records the minimum falling from 20 to 5 on 2026-09-14
    "since the per-check and per-family witnesses already say what a corpus must cover", and those
    witnesses are what the next three sentences describe. Every applicable
    check-by-family cell needs one passing task-bound accept. Every applicable check needs one
    reject that fails on its declared check, and every family needs at least one such reject, where
    one reject may serve both — that is the operator decision of 2026-09-15, replacing one reject
    per cell, which had asked a 6-check, 5-family truss for 30 rejects. Build each reject from the
    known-correct accept for the same task and then change one fact; further checks may well fail
    on it (operator decision 2026-09-14). A reject that fails elsewhere but not on its named check
    provides no discrimination evidence. `taskConditioned` roots are replayed across sibling tasks,
    numeric boundaries get a task sitting on the value, and a root no check reads is refused before
    measurement.

13. **Set one representation contract before tools and truth depend on it.** The public artifact
    schema, the writer tool schema, the DraftStore representation, submit compilation, the F2
    witness and the verifier input must agree on what is required, what is nullable and what counts
    as equivalent — with no undocumented empty string or zero sentinel where the public schema
    promises `null`. A valid artifact the writer cannot express, or a writer accepting a value the
    verifier interprets differently, is a representation defect. A task probe may rewrite the
    accept corpus, but every new accept must fit the adopted schema and the recompiled schema hash
    must stay byte-identical. Conformance must open every task, and must require the generated
    tools to expose one stable worker registration and tool schema across the whole battery. Repair
    the shared contract rather than teaching agents the mismatch in prose.

14. **Keep model-visible text small and single-owned.** Stable domain and safety framing belongs in
    the start prompt, one controller-derived correction in steering, bounded continuation at a stop
    or submit boundary, and public result shaping in the live tool result. State measured public
    runtime facts where they save blind discovery, and do not repeat one duty across the workspace
    card, the body, the closing paragraph and the tool description. If the same interface failure
    keeps recurring, fix the schema, the tool or the shared contract instead of adding another
    tutorial sentence. The Builder's intent stays in its start prompt, and the loop, the gate
    sequence and the worked domain shapes stay in `STARTER.md`. Starter examples must satisfy their
    declared schemas and name only tools they declare, and refusal examples must use codes the
    current source still emits. Prompt digests are condition identities; a prompt test proves
    delivery and still requires a fresh behavioural run.

    Keep the authoring areas separate by authority. `harness_inspect` is static and read-only, with
    four modes: `readiness`, `task`, `coverage`, `feedback`. Readiness is the whole static view in
    one call, and a named `group` or `family` pages the findings or a family it cannot fit.
    `context` (`src/builder/context-tool.ts`) is where everything else a round may consult is read.
    It takes a question and the decision the answer settles, and returns the lines that bear on it,
    each cited by document and line, over five sources: the round's opening, the
    workspace notes and plan, every measured battery of the product, the solver traces of passing
    cases, and the `--context` files. Until 2026-09-23 it read the `--context` files alone, and 160
    recorded sessions called it six times, always over an empty corpus. It offers passing traces
    only, because a measured battery already publishes which cases passed, while a failing trace is
    where the failure sits. `harness_trial` takes one `taskId` and solves it blind with the measured
    Built solver — its own runtime, turn cap, solve wall and confinement — then grades what it
    submitted, returning the rule-4 aggregate verdict, whether it submitted at all, how many turns
    it used, what the solve spent as a plain fact (minutes against the solve wall, tool calls, cost)
    and any typed non-result, under six rehearsals per round and a 30-second total verifier
    deadline. Each rehearsal costs one measured case and writes its solve evidence under
    `<campaignDir>/rehearsals/`. A passing rehearsal's trace joins the context tool's traces source,
    and each rehearsal's verdict and effort join the round's plan evidence. Parameterless `submit` alone freezes and accepts candidate bytes.

    Two of the fifteen tools in `BUILDER_TOOLS` (`src/builder/builder-tool-interface.ts`) are the
    ones rule 1 depends on without naming, and an agent that has not met them will try to install a
    toolchain with `bash` and get nowhere. `public_source` takes an exact HTTPS address, the
    controller brokers the hop, and the bytes land under their own digest in an offline `.oss`
    workshop. `verifier_workshop` is where they are then unpacked, built and smoke-tested, through
    `inspect`, `read`, `write`, `run` and `export`, in one deny-default cell with its own PATH. The
    wall between that cell and the candidate runs both ways and is the part worth remembering: the
    workshop's commands cannot read the candidate workspace, and the ordinary workspace tools
    cannot read `.oss`, so text crosses only through the workshop's own `write`. `export` is the
    one outbound crossing — a single binary, script or package file up to 64 MiB into the
    candidate's `.toolchain`, keeping the executable bit, returning the byte digest and the
    installed path, and refusing a destination that already exists, because an upgrade is a
    workspace edit rather than a second export. A successful run proves which bytes executed, never
    that the tool is authoritative.

    `harness_reset` is the fifteenth and the narrowest. On a reopen rebuild it returns one surface
    to the starter seed — `agent` reopens the tooling and keeps the tasks, controls and checks,
    `correctness-model` reopens the evaluation and keeps the tooling, `all` starts over — once per
    reopen per scope, in one controller commit that leaves every replaced byte in Git history.
    Outside a reopen it refuses and says to edit the workspace in place, so it is not a way out of
    a bad round; it is what makes rule 10's harness intervention a clean start rather than an
    accumulation.

    **`agent/config.yaml` owns each harness's runtime walls** (`src/truth/harness-config.ts`). The
    Builder is told the file exists, not what it holds. The defaults are, for the solver,
    `solve_minutes 120`, `max_turns 24`, `shell_timeout_seconds 300` and
    `shell_timeout_max_seconds 900`; and for the gate, `reference_solve_seconds 120`,
    `census_minutes 30`, `check_seconds 600` and `tool_run_seconds 300`. A harness may raise any of
    them to **ten times** its default, and above that the host refuses. The Built Harness prompt
    derives and names its exact closed tool roster.

    Every fresh `tools-spec.json` is to give the solver a shell through the `presets` field:
    `"files"` for a file-shaped answer, or `"shell"` beside an artifact-writer, and never both,
    since `files` already carries the shell. That is the operator decision of 2026-09-14, taken
    after truss epochs kept declining `files`, whose draft files become the answer. The gate
    enforces it — and this paragraph said the opposite until 2026-09-18. `solverShellFindings` in
    `src/author/candidate-check.ts` refuses a spec with neither preset: on a fresh build, on a
    continuation that may author the agent, and on a task-only round, which cannot select the
    preset itself, so that refusal names the product round that can. `validateToolsSpec` is indeed
    satisfied by `presets: []` beside an artifact-writer, so the refusal lives one layer up — but
    no recorded bundle ever took that opening: all nine exported across campaigns 3fd52f9e-28 and
    -10, the two of 2026-09-17 included, declare `presets: ["shell"]`. Read a measured battery's
    roster anyway before attributing its failures to it. A Built turn is bounded by silence, one
    model call plus one command at its ceiling; a solve the whole-solve wall stops after it had
    called a tool is an unaccepted attempt carrying its traced tool calls, not a non-result.

    For generated tools, `text` is the whole model-visible result and `details` is host and trace
    evidence, so every promised value belongs in `text`. A Builder tool result that drops bytes
    says where the rest is: a truncated command writes its whole output under `.bash-output/` in
    the workspace and the result gives that path, because a draft can be read again and a command's
    output cannot. That directory is dot-prefixed so the listing tools pass over it, and it is
    never fingerprinted, so it cannot reach a candidate. The same holds on every wall that shows a
    tail of unstructured output: the result ends with one line naming the lines shown and, when the
    store succeeded, the stored file and the tool that pages it — `cutOutputNotice` on the Builder
    shell and the verifier workshop, pi's own notice on the Built shell. Each store sits where that
    model's own reader reaches it, which is `.oss/.run-output/` for a workshop run and the session
    home's `.shell-output/` for the Built shell, never the host's temporary directory where a later
    solve could read it. A store that fails costs the pointer and not the result. A limit-cut grep
    or find ends with its `moreRowsNote` count instead, so that a cut search no longer reads as a
    complete one. Protected verifier output is never stored or pointed at.

    A Builder authoring session has no default wall; `HARNESS_BUILDER_SESSION_CAP_MS` may set a
    positive-integer one, and a Builder bash install may run for up to two hours. An authoring
    review starts at the completion of a host tool call, never inside one, and then runs beside the
    session rather than holding it (`AuthoringReviews`, `src/run/authoring-review.ts`). It always
    reads frozen bytes: after a clear `correctness_check` whose agent, correctness-model or battery
    bytes have changed since the last review, that check's immutable snapshot, and after **40
    minutes** without a review (`REVIEW_INTERVAL_MS`, `src/gate/review-clock.ts`) a snapshot of the
    workspace taken at the call that started it. So an edit the Builder makes while it runs is not
    in what it reads, and a draft that cannot be frozen is not read live in its place: the clock
    stays due and the next completed call tries again. One review runs at a time, and a trigger
    that fires meanwhile waits in the clock, which keeps only the latest validated product, so
    triggers coalesce rather than queue. The clock restarts when a review finishes, and the public
    projection of its findings rides the first tool result after that. Submit is the one call that
    waits for it. A submit made while a review runs is held until the review finishes, which the
    reader session's one-hour deadline bounds (`READER_DEADLINE_MS`, `src/review/review-reader.ts`),
    and when the review shows findings the Builder has not read, they come back in place of the
    verdict and the call counts as no submit (`reason: "review-unread"`), so the same bytes sent
    next are a first submission of them. No probe budget and no no-submit strike bounds a
    session's reconnaissance before its first authoring change. A round runs as a Codex goal
    (`src/author/builder-continuation.ts`): every continuation restates the request and the round's
    facts, a round has no turn cap unless `--max-builder-turns` sets one, and three turns in a row
    without a successful tool call end it as the retryable `no-progress` clause on the same
    conversation. The continuation asks for authoring after eight turns or two hours without a
    submit, and the byte-identical resubmit strikes remain.

    **One Builder conversation spans the controller run** (`src/author/builder-conversation.ts`).
    A settled round pauses its session while the controller measures, reviews and advises, and the
    next round resumes it provided the system prompt, every tool schema and the transport are
    unchanged. The session was opened on stubs that route each call by name to the open round's
    tools, so a call between rounds is refused. A resumed round's first message says how the last
    round ended and where it is working now. It reads the notes block whenever that workspace is one
    the conversation has not worked in, because every measured round reopens under a new pass holding
    the carried copy, and compaction cuts the opening turn that first carried them; a round that stays
    in the same workspace gets none. It reads no list of earlier attempts and standing refusals,
    since it already received each refusal as a submit result; only a fresh session gets that. Each
    compaction's summary is recorded beside its token count in the Builder's prose capture, from pi's
    `compaction_end` and, on the Claude route, from the CLI transcript before the bridge deletes it;
    it is evidence and is served to no model. A round that threw, a changed contract or a closed transport opens a
    fresh session, and the run's settle closes the last one. Per-round bounds stay per round: the
    turn limit, the rehearsals, the submit strikes, the review clock and the execution record. A
    process restart loses the conversation, because nothing about it is durable.

    `correctness_check` runs the same validation sequence submit runs, control census included, on
    the exact immutable snapshot, as often as the bytes change. A blocked or runtime-non-result
    preview is remembered as spent for those bytes, and unchanged bytes spend nothing. Preview and
    submit share an in-flight gate in either call order when the candidate and installed-tool
    identities match, and submit reuses only a clear result. A thrown or host-refused gate is
    forgotten, while the preview attempt stays spent. A refused candidate repeats by
    controller-owned candidate identity, not by workspace commit. Never cache a typed runtime
    non-result as a verdict on candidate bytes.

15. **Stop honestly when the environment produces no evidence.** A battery of typed non-results
    creates no shipping claim and gives a rebuild or a probe nothing to work from, so do not
    remeasure the same dead provider merely because rounds remain. The controller gives transient
    recovery a declared bounded allowance and then records `environment-blocked`. A provider limit,
    a missing credential, an unsupported catalogue model, a spend limit, a provider timeout or a
    sandbox refusal belongs to the environment owner and never to the task author. In F2, a
    controller deadline reached before the generated-tool worker is ready or closed is a host
    non-result, while a worker that answered its handshake and then broke its protocol is a
    representation defect. A worker's close failure after an accepted submit stays in the worker
    evidence without voiding the case; without an accepted submit it remains a non-result. At claim
    time a solvability-witness tool non-result earns one fresh execution, and only for `sandbox` or
    `verifierUnavailable` — record `timeout` and `crash` on the first attempt. Persistent refusal
    leaves a typed finding and a missing-witness readiness clause beside the recorded score; it
    does not turn verified cases into wrong answers.

16. **Accept broad requests and apply strict evidence later.** Admit broadly sensible domains, and
    record the excluded families and the unverified capabilities rather than silently narrowing the
    product. Adoption, measurement and the claim gates decide afterwards what the evidence
    supports.

### The correctness model

A candidate declares `correctnessContract: "check-program/v1"`, which is the only accepted value.
Each truth check is one Boolean function in the `checks` of `correctness-model/evaluator.ts`,
applicable to declared families, reading only its declared artifact paths, its declared public
input paths and its own hidden operand. Missing required hidden data refuses execution rather than
quietly making the check inapplicable. The host runs every applicable function in a fresh confined
child and constructs the aggregate verdict; there is no second predicate anywhere.

A check declares its evidence kind. `authored` computation may name `execution.requiredToolIds`,
including an interpreter for the Builder's own algorithm, and it keeps authored semantics.
`external` evidence declares an installed tool as the deciding instrument: flags and names are
passed as args, and leaf-bound files or stdin as operands. `solvability-tool-program-argument`
refuses an external check with a multi-line argument or one over 256 bytes. The self-authored check
refuses when every required executable's digest matches known candidate-authored source. Those are
bounded detections rather than a general proof of provenance — an installed interpreter running the
Builder's algorithm is still authored computation. Coverage rows carry the declared evidence kind.
Preserve the selected command path through inventory, attestation and execution, because identical
hardlink bytes can dispatch differently under different names. Keep compilation, host simulation,
target execution and hardware operation as separate scopes.

Execution is recorded; independence needs separate evidence. The claim records the digest and the
source — `workspace-toolchain` or `host` — of every tool that ran, as `verifierEnvironmentHash`,
and `externalCheckCoverage` counts host-attested launches and reject controls per check-and-tool
pair. Neither the installation location nor passing the digest and argument checks establishes
independence.

### The gate

`correctness_check` previews the same gate `submit` runs, without the adoption; rule 14 owns the
snapshot, tool identity, cache and retry contract they share. The census, F2 and grounding read
recorded rows and executable bytes, never Judge prose. Refusals route by kind to the owning
`FeedbackOwner` and return to the same session. A byte-identical resubmit of a refused candidate is
a counted no-op strike, and three of them end the session as `authoring-stalled`. A typed runtime
non-result is neither cached as a verdict on those bytes nor counted as a strike. A close-handshake
timeout after all conformance probes have settled remains cleanup evidence and does not refuse the
candidate. Provider and credential failures end the session with a typed terminal clause. The gate
never compares two candidates and never judges quality: it admits a candidate that satisfies its
own declared contract, and refuses everything else with the exact finding.

### Identities, walls and process facts

The accepted candidate has one byte identity, from submit through adoption. Product files become
durable at one retained version path before `ControllerLedger` commits the selection, the promotion
evidence and the admission together. A held row is equally byte-bound, and a replay must name the
same version, fingerprint and experiment. Preserve damaged state for review.

Verifier process results and process cleanup are separate facts. A deadline bounds execution and
output collection even when a child or a pipe will not settle, cleanup keeps a durable receipt,
recovery never signals a saved PID, and a successful kill syscall on its own proves nothing. Each
tool run gets fresh private `TMPDIR` and `HOME` children, and the one thing restored into them is
the tool's user cache directory, from what an earlier gate run of the same tool bytes stored
(`withToolCache`, `src/verify/engine-cell-env.ts`); a battery run restores it and never stores. Darwin Seatbelt and Linux Bubblewrap each
need their own live proof, and an unavailable required wall yields a typed non-result — never an
unconfined run.

Builder access is stated once per backend, through the host-controlled file and command tools. Open
to it: the workspace, the public inputs, prior traces, the host toolchain paths, compiler scratch
and the exact `src/solve` and `src/meta` authoring interfaces. Closed: controller evidence,
credentials, other accounts and the `src/truth`, `src/verify` and `src/gate` trees, including
evidence created after the session started. The Built Harness keeps a narrower file wall but has
outbound network, so that it can fetch a toolchain into its private home (operator decision
2026-08-15, reaffirmed 2026-09-06). The controller brokers each HTTPS public-source hop: the
requested hostname resolves once, the resolved address must be public, and the request is pinned to
that address with SNI and Host bound to the real hostname, at most 5 redirects, 64 MB and 120 s.
The destructive-command guard is a safety net rather than isolation or evidence — a recursive
remove of a relative workspace tree, and a discarding checkout or restore of the session's own
file, both pass over its refusal (operator decision 2026-09-14).

### Run configuration

A run has three model slots — Builder, Built Harness and review — set with `--builder-backend`,
`--built-backend` and `--review-backend`. The backend kinds are `codex`, `openrouter` and `claude`,
and all three are supported on all three slots; `--review-backend` additionally takes `disabled`
and `inherit`. The Built slot needs a slug the Pi catalogue names, so that its evidence says what
was measured. The review slot shares one pin across the Main Judge, the diagnosis reader and the
Epoch Reviewer; operator names use `review`, while the evidence keeps `judge:"off"` and `judgePin`.

Every slot resolves its provider, credential and model through one layer,
`src/backends/pi-providers.ts`. The Builder and review slots run in-process on one pi host session
(`src/backends/pi-session.ts`), each with its own tools and framing, and the Built slot runs pi in
its confined child. The Builder keeps one session for the whole run: between rounds it waits, with
its context intact, while the controller measures and reviews, and the next round arrives as its
next prompt on a reconfigured roster. A round that threw, or a process restart, opens a fresh
session that reads the Builder's notes.

Kinds live in `.harness/backends/<project>.json`, layered over `default.json` per slot, and the
review slot is the one where an absence is easy to misread. Dropping the review key from a project
file does not turn the reviewers off; it falls through to `default.json`, which in this repository
says `{"review": {"kind": "claude"}}`, so they run on Claude. Only a review key absent from both
layers with no `HARNESS_REVIEW_BACKEND` reaches `{enabled: false, source: "unconfigured"}` in
`resolve.ts`, and `{"review":{"disabled":true}}` reaches the same disabled slot recorded as
`operator`. Both end with no reviewers and differ only in what the evidence says about why, which
is the distinction worth keeping. An empty `{"review":{}}` is refused outright rather than guessed
at. `inherit` is the third value, and it copies the Built slot's kind, model and effort so that the
review runs the condition the battery ran. Models and efforts come from
`CODEX_{BUILDER,BUILT,REVIEW}_MODEL` and `CODEX_*_REASONING_EFFORT`, or their `CLAUDE_*`
equivalents. **An unpinned codex slot defaults to `gpt-5.6-luna` at `xhigh` on all three slots**
(`src/backends/resolve.ts`), so a launch without env pins silently measures a condition no
table names — pin it explicitly. Every slot's effort is checked against the thinking levels the pi
catalogue lists for its model, with no provider call. The OpenAI-completions route pairs
`OPENROUTER_API_KEY` with the OpenRouter address, or `CUSTOM_ADDRESS` with `CUSTOM_API_KEY` and a
`CUSTOM_CONTEXT_WINDOW` of at least 16,384 output plus 8,192 reserved input tokens. Require every
opening tuple to match the intended condition before battery spend, and report mixed slots as a
separate condition. An adopted bundle exports with
`bun run harness -- export <domains/slug> <dir>` and runs `bun run solve` and `bun run check` on
the controller's own paths.

Claude credentials resolve process env > `.env.cloud` > `.env.local` > `.env` > the stored login
file, and `bun run login -- status` names the winner. Every Claude slot presents the one
`CLAUDE_CODE_OAUTH_TOKEN`. `claude setup-token` mints for the account the browser is signed in as,
not for the alias or the config directory in front of it, and session limits are per account.

## Working in the repository

The shape of a task here is: resolve the exact tree, prepare dependencies once, run focused checks
while editing, and run one composed gate at delivery. Each cost is paid only when the changed files
need it.

**Resolve and create the worktree.** Start with `scripts/worktree.sh list`. One call gives every
tree's head, its branch, its uncommitted count, its dependency state, whether a command is standing
in it, and the free space beneath them all. Reuse a clean worktree when it already owns the
intended branch and nothing is standing in it; `git status --short --branch` in the named tree
settles what the uncommitted count only counts.

```sh
scripts/worktree.sh new <branch> <absolute-dir> [start-point] [--scope S]
scripts/worktree.sh pr <number> <absolute-dir> [branch] [--scope S]
scripts/worktree.sh setup <absolute-dir> [--scope S]
scripts/worktree.sh run <absolute-dir> <command...>
scripts/worktree.sh list
scripts/worktree.sh drop <absolute-dir> [--force]
```

`new` creates the branch and runs `setup`. `pr` fetches a published pull request head first and
puts it on a distinct branch, so the PR's own source branch stays available to whichever session is
holding it. `setup` does nothing when its install marker already matches the dependency identity;
otherwise it clones real `node_modules` copy-on-write from a matching worktree, or runs one
`bun install --frozen-lockfile`. `run` checks Bun and reads no flags of its own, so the command
keeps all of its; it prepares a tree whose `node_modules` is absent, linked or prepared for
different dependencies, and refuses only while another command is standing in that tree. Use it for
Bun, for tests and for anything that loads repository modules. `list` prints every worktree with
its head, branch, uncommitted count and whether a command can run there now, marks each `ana-run-*`
tree as evidence and each tree a running command is standing in as in use, and closes with one line
counting the fleet's dependency states and the volume's free space. `drop` removes a disposable
tree, refusing the checkout itself, any `ana-run-*` tree, and anything holding uncommitted or
untracked work unless `--force`.

**Choose the scope before creating the tree.** `--scope` says how much of the local checkout the
new tree gets, and `run` then behaves the same in all three.

| scope | what it prepares | when to ask for it |
| --- | --- | --- |
| `minimal` | the worktree alone: no Bun check, no `node_modules` | a change confined to the hook's documentation set. Seconds, not a clone |
| `medium` (default) | a prepared `node_modules` | anything loading a repository module: every test, check and Bun entrypoint |
| `maximum` | medium plus inheritable ignored state: `.toolchain`, the learned test ordering | a tree that would otherwise redownload the domain toolchain |

The documentation set is `README.md`, `AGENTS.md`, `docs/**` and `.claude/**/*.md` — exactly what
the pre-push hook answers with `git diff --check` alone. `minimal` replaces the raw
`git worktree add` recipe for it, with one caveat the hook enforces and the script can only
announce: a push that creates a remote branch is never documentation-only, because an all-zero
remote sha leaves the hook nothing to diff against. So prepare the tree before publishing a branch
for the first time, even for a note.

`maximum` names every ignored path it left behind, with the reason. Credentials, `campaigns/`,
`domains/`, `runs/`, recorded results and a path-bound `.venv` never travel; the tree's own
workflow owns them.

Never symlink `node_modules`: `@ana` links may resolve into another tree's `vendor/` source. The
script never links, never treats a link as prepared, and both run launchers refuse a linked tree
before spending anything. The copy-on-write clone already shares the blocks, so a link would buy
nothing anyway. Never use bare `git stash` either, because stashes are shared across trees. Remove
only a clean disposable tree that this task created. For authorised cleanup use `/usr/bin/trash`
with explicit paths, preserve run evidence and unpublished work, and never empty the Trash.

**Classify a missing file before supplying it.** Check
`git ls-tree -r --name-only <revision> -- <path>` first. A tracked file that is missing means the
revision needs correcting; a missing dependency belongs to `worktree.sh setup`. Local run state and
configuration belong to their owning workflow, so never copy or symlink `.env`, campaign, domain or
config files from another checkout just to make a command start. A scratch script that imports
repository source belongs inside the worktree it reads: Bun resolves `@ana/*` and relative
specifiers from the importing file, so the same script sitting under a job scratch directory fails
with `Cannot find module` however absolute its paths are. A clean Git status proves the tracked
source, not that ignored dependencies match a rebased head.

**Install only when dependency identity moved.** Do not add or maintain dependency patches,
including `patchedDependencies` or edits to installed dependency source. `worktree.sh` owns root
dependency preparation, so do not install again afterwards. In a prepared tree, frozen-install only
for absent or unresolved dependencies, or for a changed owning manifest. On a frozen-install
failure, preserve stderr and inspect the exact head and the introducing diff. A real mismatch on
the intended clean revision blocks delivery; it does not authorise rewriting the lock. Where
branches, or installed dependencies and the lock, disagree on a version, take the higher one
(operator decision 2026-09-03) and prove it with one frozen install.

**Commands.** Use `bun run test -- <paths...>`, never a bare `bun test`. The wrapper runs one
`bun test --parallel` process with slowest-first ordering learned from its first run and a
disposable temporary root under the host temp directory. Its worker count is **two fewer than the
cores, less half of whatever load the host is already carrying, and never below two**
(`workerCount`, `tools/runtime/test-suite.ts`; `ANA_TEST_WORKERS` overrides it outright). The load
term is there because the cores a machine has are not the cores this suite gets, and a runner
already carrying four jobs of its own should not be asked for three times itself.

The part worth knowing before you believe a red run is what happens next. `attribute` reads the
first process's result and decides whether the branch failed or the machine did, across nine
reasons. Two of them say the machine did: every failure ended by a clock rather than an assertion
(`clock-only`), or the one-minute load passed twice the core count while they ran
(`crowded-host`). Either way up to eight failed files run again alone, in one fresh process, and
**that second verdict is the suite's**. The same happens for files the idle wall cut off before
they finished. What never gets a second chance is a failure the first process actually printed, an
error Bun raised outside any test — nothing in the failed list speaks for it, so rerunning cannot
unsay it — a file that reported nothing at all, or more than eight failures, which is more than a
busy host explains. So a red run on a loaded laptop is not yet a verdict on your branch; read which
of those sentences the wrapper printed. `bun run gate` runs nine steps — runtime, **format**,
**ui-deps**, typecheck, lint, **source-policy, complexity, ui** and tests — so the two policy
gates, the UI gate and the formatter can each fail a push that the contract used to leave unnamed.
`ui-deps` prepares `packages/ui`'s own modules before typecheck and lint read them, because
`scripts/worktree.sh setup` prepares the root ones alone, and an unprepared `@types/react` makes
lint report findings that no diff introduced. `bun run format` fixes the format step. `biome format`
at `lineWidth` 110 owns every line break under `src`, `tools`, `vendor`, `test`, `starters` and
`packages`, which is why the size ceilings are 800 and 115; the only paths outside it are `.agents`
and the fourteen vendored files an override in `biome.json` names one at a time — the three
`pi-agent-session` modules, `pi-built/jsonl.ts` and ten of `pi-claude-bridge`, all of them carried
from upstream, so that a diff against upstream stays readable. `tools/oxlint` came
in on 2026-09-20 and cost 25 lint errors, mostly `curly` finding statements the formatter had just
made multi-line. Also available: `bun run outcome` for read-only reports over recorded evidence,
`bun run replay -- <campaign>/<runId>` to re-grade a recorded battery through this tree's verifier,
`bun run triage`, `bun run secrets`, `bun run typecheck` and `bun run format`.

Run one gate at a time: two overlapping gates each took twice as long as one alone. When typecheck,
lint, source-policy or complexity fails, the pre-push hook lists each finding as
`<rule> <location> <message>` and names the commit it failed on.

| Changed files | While editing | Delivery proof |
| --- | --- | --- |
| Surrounding documentation only | `--scope minimal`, then `git diff --check` and read the diff | Commit locally and hold it; the operator approves the push, which repeats the diff check and skips the gate |
| Test or source | `scripts/worktree.sh run <dir> bun run test -- <owning-paths...>` | One normal push runs the composed gate |
| Intentional dependency change | One unfrozen install at the root, review manifest plus lock | Frozen install, then source delivery |
| Stack checkpoint with publication | Union of affected owning checks | One multi-ref push from the clean top runs the gate |
| Composition without publication, or a paid run without current exact-tree proof | Owning focused checks | One manual `bun run gate` immediately before the boundary |

"Normal push runs the gate" holds only where the hooks are installed. A clone gets them once with
`bun run hooks:install`, which is `git config core.hooksPath .githooks`, and its worktrees share
them; without it a push publishes ungated and says nothing about it (2026-09-22, PR #1). Check
`git config core.hooksPath` before relying on a push as the gate, and otherwise run `bun run gate`
yourself beforehand.

Keep the positive case and the nearest hostile case in the smallest owning test file, and add only
the case that is missing. Batch small fixes under one owner. The normal pre-push owns typecheck and
lint, so run either separately only when it is the boundary that changed. Neither substitutes for
behavioural proof.

**Every published commit passes the gate on its own** (operator decision 2026-09-24, replacing the
fix-forward rule of 2026-09-21). The history is read as well as run: an agent looking through it
for how work is done here copies what it finds, and a red commit followed by its repair teaches it
that pushing red is the way. So the pre-push hook checks out every earlier source-changing commit
the push publishes and runs `bun run gate --static` over it — runtime, format, typecheck, lint,
source-policy, complexity, and the test files near what that commit changed — then runs the whole
gate on the tip, and on the head of every other branch the push moves, since that is where a
stacked pull request ends. GitHub Actions is off for this repository, so that local run is the only
full gate a pull request head gets. "Near" is `tools/runtime/affected-tests.ts`: a test that
imports a changed file directly (operator decision 2026-09-24). It was three imports on the day the
rule landed, and the first push to pay for that showed why not: the slow end-to-end files sit two
or three imports from anything near the root of the graph, so three commits of 11 to 17 files each
selected 62% to 70% of the suite's recorded test time at depth 3, and 14% to 19% at depth 1. The
tip then ran all of it again. Depth 1 bounds the cost; it has not been measured against the bugs
it catches, and the tip's full suite is what backs it. A failure names the commit, and its fix goes into that commit rather than on
top of it: `git commit --fixup=<sha>` and `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash
<sha>~1`, or `git commit --amend` when it is the tip. Nothing was pushed, so rewriting it costs no
one anything. A rule agents keep breaking is fixed at its owner, whether that is a prompt, a skill
or the lint rule's own message.

**Shell commands and the guard.** Before sending a Bash command, scan every `$` in it: a `$VAR`,
`$(…)` or `${…}` alongside `git`, after a `>`, or inside a heredoc triggers the `dcg` guard,
including inside a loop. A blocked call never runs and costs the turn, so change the spelling
rather than asking for an allowlist entry, and test a new spelling with `dcg test '<command>'`.

Two different guards get called "the guard" in conversation here, and they admit different things,
which is how this paragraph came to recommend a redirect that does not work. Your own Bash calls
go through the `dcg` binary directly. The Builder's go through `src/builder/command-guard.ts`,
which runs that same binary and then adds an exception of its own: `privateScratchRedirect` admits
a target matching `SCRATCH_TARGET`, which is `~/…`, `$HOME/…` or `$TMPDIR/…` in either the bare or
the braced spelling. dcg alone admits neither of the last two. Probed against 0.14.4 on
2026-09-23, `> $HOME/f`, `> $TMPDIR/f` and `> "$TMPDIR/f"` are all refused by
`core.filesystem:redirect-truncate-dynamic-path`, and quoting makes no difference. The rule's own
reason is the honest one: the shell expands the target at runtime, so dcg cannot prove where the
file it is about to open with `O_TRUNC` points. What passes is a literal path, an unquoted `~/…`,
or an append — `>> $TMPDIR/f` is admitted where `> $TMPDIR/f` is refused, because appending
truncates nothing. So the shape to remember is a literal `/tmp/<subdir>/…` or the scratchpad's own
absolute path, and `~/…` when it must be the home tree. Prefer `git worktree remove --force`,
`git diff -- <path> | git apply -R`, `git branch park <tip>` followed by `git rebase --onto`, a
literal `git -C /abs/dir` one call per tree, `git push --force-with-lease`, and the Write tool
followed by `bun <f>` or `--body-file <f>` in place of a heredoc holding shell text.
`git clean -n -d` and `find` list what would go; the deletion itself is the operator's. And never
report an exit code captured with `$?` after a pipe: it is the last stage's status, so a
`| tail -8` in front of it makes every code you report the tail's.

Foreground waits are at most 60 seconds. For longer work, start one background monitor that exits
on the real condition and poll in bounded intervals, rather than stacking sleep-and-tail calls.
When the watch is under 30 minutes, checking every 290 s is cheaper than holding a monitor open.

**Simplify.** Use ponytail while authoring, and run `bun run lint -- --strict` and
`bun run simplify` — the deterministic census in `tools/oxlint/simplify-census.ts` — during the
work rather than only at the end; then `/simplify` on the finished diff. A rewrite that removes a
type assertion or merges two statements meets rules the old spelling passed
(`no-known-value-widening`, `curly`, `prefer-optional-chain`), so whoever wrote the rewrite runs
`bun run lint -- --strict` before handing it back. A mis-targeted finding from either tool is a
reason to tune that rule's source more precisely, as rule 8 says, and never to switch it off.
Prefer removing unneeded work, then existing code, then stdlib or native features, then installed
dependencies, and only then minimum new code. Preserve trust validation, data-loss handling,
security, accessibility and requested behaviour. Reuse the focused checks and the ordinary gate.
If no useful cut remains, say "already the smallest honest form".

### Versions

Anabasis is in beta. It left alpha on 2026-09-24 (operator decision), and it stays below `1.0.0`
until the operator cuts that release. The repository follows Semantic Versioning, and a version has one owner: a `vMAJOR.MINOR.PATCH`
tag on a commit of `main`, published as the GitHub release of the same name with
`gh release create v<X.Y.Z> --target <full sha>`. Nothing in the tree has a version of its own: the
root `package.json` carries none, and the `version` in `packages/ui/package.json` follows the
repository's, so a release commit sets it to the number the tag will carry. `v0.0.1` marks `main`
at `fae8fdb`, the state before PR #7 landed, where the UI package still read `0.1.0` (operator
decision 2026-09-24).

The operator decides when a version is cut and which part moves, and an agent never bumps one on
its own initiative, not even after landing a stack. An incremental release moves the patch number
(`0.0.1` to `0.0.2`), a bigger one the minor number (`0.0.2` to `0.1.0`), and a breaking one, the
operator's "proud" release, the major number (`0.1.0` to `1.0.0`), each resetting the parts to its
right. When asked, tag the exact commit the operator names, or current `origin/main` when none is
named, and say which commit that was, because local `main` can hold documentation commits that
were never pushed.

### Where changes go

Surrounding files are `README.md`, `AGENTS.md`, `docs/**` and `.claude/**/*.md` — exactly the
paths the pre-push hook excludes when it decides a push is documentation-only, after which it runs
`git diff --check` alone. **Commit them locally and leave them there until the operator approves
the push** (operator decision 2026-09-23). Until then they went straight to main, on the reasoning
that a note carries no gate and so costs nothing to publish. What that missed is that the gate was
never the thing standing between a document and its readers — a source change is read by a test, a
reviewer or a failing build before anyone believes it, and a document is read by nobody. So the
cheapest path to publication belonged to exactly the files whose only check is someone reading
them, and on 2026-09-23 two of them were written and pushed inside one turn. Commit the work, say
where it is and what it claims, and let the operator decide whether it goes out. The approval is
for the change in front of them and does not carry to the next one.

Ask for it in the reply that reports the work, in a line beside everything else that reply is
already saying. This is not a question that blocks the turn, so it does not earn an interruption or
a round trip of its own: finish, report, and name the push as the one thing left. That keeps the
rule from costing what it was meant to save, which is the operator's attention.

Nothing enforces this. The hook will push a documentation commit as readily as it ever did, and
`git diff --check` is the whole of what it asks, so this is a standing operator decision held by
discipline rather than a gate — worth saying plainly, because a rule this file cannot point to a
consumer for is one a reader should know is unenforced.

**Skill and helper scripts are not in that set**, for publication or for checks.
A `.ts`, `.mjs` or `.py` under `.claude/` needs focused checks and source
delivery, and how much of the composed gate reaches one depends on the script. `ROOTS` in
`tools/runtime/lint.ts` is `src tools vendor starters test packages .claude`, so oxlint reads every
one of them. The suite reaches a script only through a test that imports it: `bun run test`
discovers a flat tree under `test/` and never walks `.claude/`, but 47 of those discovered files
import a skill module by relative path, which pulls 52 of the 105 scripts across nine skills into
the run, and a few more transitively through those. So a script a test imports is gated like any
other source, and the remaining half is held by the lint alone — its behaviour is checked by
nothing until you check it, with `bun test` from the script's own directory. Before assuming
either, grep `test/` for the file you are editing. A document describing source that is not on main
stays with that source. Everything under `src/`, `tools/` and `vendor/` is source, whatever the file
type.

Production code and its tests follow the latest intended PR stack published on GitHub: fetch and
verify its parent chain, then use that composed head as the working baseline. Main alone is not the
current production-development state while that stack is open. "Add stacked PR" means use or rebase
onto the latest stack head. Independent non-production tooling may go directly to main.

When a PR worktree overlaps another session, create an isolated branch from the PR's published head
rather than editing that worktree: `scripts/worktree.sh pr <number> <absolute-dir>` fetches that
head and puts it on a unique branch, leaving the other session's tree alone. Once the upstream PR
settles, refresh, rebase onto it, prove containment and push to the PR's actual source branch.

For a stack, write down `parent head → child head` for every edge, compose from the first stale
edge, and propagate through the later children in order. If the bottom PR lacks current main, every
descendant is behind main through inherited ancestry even when the internal edges pass — though
surrounding-only main changes do not require a source restack. Name the first stale edge and the
full affected suffix. Once its required checks pass, push a small isolated fix directly to the open
PR whose source it corrects; do not open another PR to repair an unmerged one. When a review finds
defects across several stacked PRs, append each fix to the PR it corrects, then recompose the
children bottom-up with one `Compose PR #<child> on repaired PR #<parent>` merge per edge (operator
decision 2026-09-05). Compose on a detached HEAD so branches checked out elsewhere are undisturbed,
then push the composed heads in one atomic push. `stack-hop`'s
[publication procedure](.claude/skills/stack-hop/references/stack-publication.md) owns delivery:
run the affected focused checks, then publish the related heads through one push and one full gate
from the clean top. Land a stack on main through GitHub, merging each PR into its own base
bottom-up, so that every PR ends Merged rather than closed — a local `--no-ff` merge pushed to
`main` leaves the PR open (2026-09-21, 98 PRs). A passing top proves that checkpoint; an
intermediate head needs its own gate before independent merge, adoption or a paid launch. Keep the
hooks and the required CI enabled.

"At PR48 state" or "at stacked PR45" means the newest improvement level including later fixes,
while "the diff of PR #48" selects that PR alone. When two branches carry the named work, ask which
head is meant.

### Subagent sessions

Honour the user's requested concurrency up to 200: launch all the requested lanes together, without
imposing a lower cap or batching them unless asked. Launch parallel subagents directly from the
current session in one message, one bounded task each — no coordinator, and no further delegation.
Each prompt names the authority, the exact paths and revision, the observed facts, the question and
the required output. State read-only unless the operator asked for changes.

Lanes editing one worktree at the same time share its files, its scratch directory and its test
runs. Give each lane a disjoint path set and its own scratch subdirectory, and never a shared
helper name: in the readability pass of 2026-09-22 one lane's `rep.ts` overwrote another's, and
about 30 files' edits silently failed to land. A lane's tests read the whole tree, so while other
lanes are editing, `SOLVABILITY_SOURCE_DRIFT` (`src/run/claim-write.ts`), parse errors in
half-edited files and host-wall timeouts are all expected. The lane re-runs a failing file alone
before reporting it, and the coordinator runs the full suite once after every lane has finished.

A comment-only pass is still a source change, and it carries six hazards. `unusedExports`
(`tools/loc/source-policy.ts`) takes the exports of `AUTHORED_ROOTS` — `src`, `tools` and
`packages/ui/src` — and looks for a reader anywhere under the eight `READER_ROOTS`, which are
deliberately wider than the compiler's import graph and take in `test`, `scripts` and `.claude`.
A name spelled in a comment counts as a reader, so deleting a comment in a test can orphan an
export in `src`; drop the `export` the gate then names. Run it whole and never pass it paths,
because it silently ignores them: the last line of `source-policy.ts` calls `main()` and the last
line of `complexity-policy.ts`, otherwise the same line, calls `main(Bun.argv.slice(2))`. So
`bun tools/loc/source-policy.ts test` prints the verdict for `src`, `tools` and `vendor`, and
reporting it as a pass over `test` claims a check that never ran. Run it with no argument and
report it as what it is, which is the evidence this hazard wants anyway. Any string,
template or regex literal that moves changes a prompt digest, so compare every literal per file
against the base before committing. A rewritten comment keeps only the claims that were checked
against the code in that turn: a shortened sentence still asserting a refusal nothing performs is a
new false statement, not a tidier old one.

The fourth is the check itself. Proving that only comments moved by tokenising both versions and
comparing the streams looks exact, and a bare `ts.createScanner` is not: with no parser driving it,
it never rescans the `}` closing a `${…}` substitution as a template tail, so the backtick that
ends that literal reads as one that opens a new one and the next token swallows every byte up to
the following backtick, comments included. On 2026-09-23 that reported 31 of 90 files as code
changes, every one of them comment-only, and it did so on the files most worth checking, since a
prompt-bearing module is exactly the one full of substitutions. Parse instead: `createSourceFile`
knows where a template ends, and printing both with `removeComments: true` compares what is left.
The failure is one-directional, so a tokenising check never misses a real change — it just cannot
tell you when there is none, which is the only thing it was being asked.

The fifth is the blind spot the fourth's remedy creates, and it runs the other way. `removeComments:
true` removes every comment, which is the point, but some comments are instructions: an
`@ts-expect-error`, an `oxlint-disable-next-line`, a `biome-ignore`. Those carry behaviour, so a
pass that rewrites, moves or drops one has changed the build while the comparator reports the two
versions identical. This is the one direction in which a parse comparison can miss a real change,
and it misses it silently. Check the directives separately: extract them from both versions and
compare the text, not the count, because a directive whose rule name was rewritten leaves the count
alone. On 2026-09-23 that scan over 355 changed files found 8 carrying directives and all 8
unchanged, which took one command and is the only reason the comparator's verdict means what it
says.

The sixth is a gate that looks as though it covers you and does not. `biome format` owns every line
break under `src`, `tools`, `vendor`, `test`, `starters` and `packages` at a `lineWidth` of 110,
which makes it natural to assume a comment pass cannot leave an overlong line behind. It does not
rewrap a comment at all: clean `main` carries comment lines of 210 characters while `biome format .`
reports "No fixes applied" over 1,044 files. A comment is therefore the one line in this tree whose
width nothing measures, and on 2026-09-23 this pass added four past the limit before anyone looked,
all four inline `/* SAFETY: … */` justifications sharing a line with the assertion they justify, the
longest 233 characters. So measure the added lines yourself. Wrapping one is safe, because
`require-safety-comment-for-type-assertion` accepts a justification separated from its assertion by
whitespace and opening parentheses alone, and a newline is whitespace; expect `biome format` to
rejoin a call the long comment had been holding apart, which is the base formatting returning rather
than a change of your own.

Transport is owned by `.claude/skills/codex-luna-swarm/SKILL.md`; read it for the current route,
which changes whenever a provider's allowance does. Session reports are research rather than
evidence, so check any load-bearing finding against the source before acting on it. A report whose
author cannot be established is unattributed research.

### Writing style

Write the way this file is written, and the way the best PR bodies in this repository read: as an
account of what you found and what it means, in sentences that carry their own reason. The reader
is a colleague who was not there. Tell them what happened, tell them why it is not what they would
have expected, and tell them what it does now instead.

The opening of a recent PR body, which is the specimen to copy:

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

Four things are doing the work there. The first sentence says what was wrong in plain words before
naming a single symbol. The second paragraph raises the reader's own objection — you would not
expect much loss here — and then answers it, which is what makes the rest land. The mechanism
arrives as a sequence of ordinary facts, each one following from the last. And the consequence is
stated concretely: it buys the number back with a gate call, or it guesses.

Write in full paragraphs. A paragraph states one thing and follows it through to the end, which
means three or four sentences that build on each other rather than one sentence standing alone
under a bold heading. The default a model reaches for — a clipped fragment, a dash, another
fragment, then a bullet list of three noun phrases — reads as though the thought was interrupted
before it arrived, and it leaves the reader to reconstruct the connection between the pieces. Say
the connection instead: because, so, which means, and that is why. Resist the urge to break a
paragraph into bullets the moment it holds more than one fact, because a list is for things that
genuinely sit side by side, and most of what gets listed here is a sequence with a cause running
through it. Fragments and headings are not wrong in themselves; they are wrong when they replace
the sentence that would have explained why one thing led to the next.

Numbers belong in the prose, at the point where they earn something. "It was used twice in eight
recorded sessions"; "5,406 findings named a bare root against 3,196 naming a path below one"; "37
pass, 1 fail". A count sitting in its own section at the bottom has to be joined back to the claim
by hand, and often is not. The same goes for evidence of a repair: say what fails when it is
reverted, and how many tests that is.

State exactly what you did and what you did not. If a check was skipped, say it was skipped. If
tests failed, give the output. If a claim rests on one lane's report rather than on the source, say
which. Nothing here needs to be sold, and a sentence that sounds like it is selling something is
usually a sentence missing its evidence.

Explain a rule with a small example rather than an adjective — "one owner instead of five" says
more than "cleaner". Where a rule exists because something went wrong, the incident is the
explanation: name it, date it, and let it do the arguing. That holds for this file, for a PR body
and for a session report, which are read once against a history that is settled. It does not hold
for a source comment. A comment is read over and over against a tree that keeps moving, so one
naming a run id, a campaign, a battery's pass count or a token total is asserting something about a
system that gets rebuilt underneath it — and it goes quietly false while still reading as
authoritative, which costs the next reader a wrong belief rather than merely some time. In a
comment, keep the mechanism the incident demonstrated and drop the incident: "run c66e0d's manual
kill discarded 21 accepted artifacts" becomes "a manual kill discards every accepted artifact the
round has not yet verified", which is the same fact and stays true. Make routine minor changes
directly, and raise only the decisions the operator actually has to make.

Several operator terms cover more than one system, so resolve them aloud in a clause rather than
silently picking one. "Queries" may mean harness-query probes, review lanes or subagent sessions;
"judges" may mean the in-run Judge slot or the review lanes; "the run" is reserved for the paid
full run; and "cycle N" is most likely one cycle of a cycle series. Suffix a `cNN` name with its
product.

## Before and during a paid full run

Load each launch procedure from current `origin/main`; PR, stack and historical revisions select
product bytes and nothing else. Run the deterministic preflight and then the launcher in the same
turn, whatever the diagnostic said. A time cap is the soft `--stop-after-ms` boundary: the round in
flight finishes and records before the stop.

Omit `--project` for a fresh project unless the user asks to continue a named one. Paid runs have
no round ceiling — they continue until a typed terminal, an exhausted budget, required user input
or a direct stop. "Proof run", "one epoch" and "at least one" set a minimum coverage, not a
maximum.

The launching agent owns its findings through to closure, and makes the first controller attempt
before fixing anything. Fix a true positive at its source and relaunch fresh; fix a false-positive
preflight with the nearest hostile test. Report every controller- or provider-started attempt as
spent, including the unsuccessful ones.

```text
bun run fullrun -- --prompt "<request>" --provider-turn-budget N [--project <id>]
  [--context <path> ...] [--expected-source <commit>:<digest>] [--run <runId>]
  [--max-iterations N] [--stop-after-ms N] [--max-builder-turns N] [--expected-tasks N]
  [--iteration-budget N|none] [--product-policy fixed] [--dcg true|false]
  [--builder-backend <kind>] [--built-backend <kind>] [--review-backend <kind|disabled|inherit>]
```

`--provider-turn-budget` is **required**: the run refuses to start without an explicit positive
value. `tools/fullrun-launchd.zsh` on macOS and `tools/fullrun-systemd.sh` on Linux start a run
detached through `env -i`, from one frozen environment map with absolute `HOME`, `CODEX_HOME`,
`TMPDIR` and `PATH`.

Before launch:

1. Resolve the source revision, the stack head, Bun 1.4.2, the backend, model and effort pins and
   the provider route, and record them in the opening evidence.
2. Prove every stack edge contains its latest parent, and run the composed deterministic gate.
3. Check the Builder and review logins and the model catalogue. The Builder discovers and installs
   tools in-session, so require neither a pre-measured tool catalogue nor a scripted native call
   before authoring. Before battery spend, check the Built credentials, the required OS wall and
   the verifier profile. A failed preflight is an environment non-result.
4. Before battery spend, require a build-admissible candidate: task conformance, executed
   task-bound controls, full-task solvability, representation coverage, bundle identity and
   isolation evidence all green.
5. Write one falsifiable prediction for the variable that moved. For a task-only experiment, name
   the fixed harness, the changed families, the prior pass count, the expected direction and the
   conditions left untested. Freeze the predictions against the resolved composed SHA *before* the
   opening; a row that Git merely dates is not a prediction.
6. Use one operator-supplied one-line prompt.

After the run, read the opening, the terminal, the case records, the claims, the verified traces
and the source identity before you read Builder prose or a session synthesis. Resolve each
prediction as `sufficed`, `partial`, `refuted` or `untriggered`. Give each valid defect one owner
and choose one probe, one fresh build or a stop, keeping the next comparison to a single variable.
Order batteries by claim `createdAt`, and refuse a before/after difficulty reading that lacks the
chronology and the required task-set identity.
