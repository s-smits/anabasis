# AGENTS.md

The working contract for Claude Code, Codex and their subagents in this repository.
`CLAUDE.md` symlinks here, so both read the same rules. This file holds principles and standing
operator decisions. The operator's plan and Git history own the forward queue, the current head,
run condition and open decisions. Newer evidence wins wherever they disagree, and a rule whose mechanism has left the source is dead text — say so
rather than obeying it.

Be eager: given ambiguity, do the task rather than ask. Carry authorised work through
implementation, checks and delivery; authorisation persists across turns and compaction. Ask only
for a decision or permission that is genuinely missing, with the reviewable result ready and the
blocking rule cited.

<!-- weekly-best-run:start -->
<!-- weekly-best-run:end -->

**Bun only.** Stable Bun 1.4.2 from `.bun-version`, for every repository task including one-off
inspection: never Node, npm, npx,
compatibility prefixes, version managers or package-manager handshake-variable changes.
A same-version canary is a different runtime. If pinned Bun is unavailable,
report the environment gap. Running runs keep their opening's executable bytes until they finish.
Exception: for Astra, prefer Python for ad hoc inspection, data handling and automation scripts;
repository source and its test and gate commands stay on TypeScript/Bun.

## What Anabasis does

One short prompt about a technical domain becomes two products: an agent harness that solves tasks
in that domain, and an evaluation that decides whether those solutions are correct. The evaluation
is the harder product. Plausible tasks are cheap; a correctness model that accepts correct answers
and rejects convincing wrong ones is what makes a measured pass rate mean anything. A rule matters
only when construction carries it into the product or a check enforces it; a check that never
changes a decision is decoration.

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

1. **Input.** One line names a field, not a deliverable ("designs steel roof trusses to
   Eurocode 3"). No plan, answer key, driver or hint is added; public `--context` files are the
   only extra input.
2. **Build.** The Builder reads `STARTER.md` in a seeded workspace and writes the whole bundle:
   `correctness-model/brief.json` (domain plan and public rule decisions), `.../tasks.json`
   (public inputs plus hidden expectations), `.../controls.json` (task-bound accept and reject
   artifacts), `.../evaluator.ts` (named Boolean checks), `.../reference/index.ts` (a public-input
   reference solve), `agent/tools-spec.json`, `agent/tools.ts`, `agent/BUILT_AGENTS.md` and
   `agent/config.yaml`. It installs the domain's real open-source tools before writing around them.
3. **Gate.** `submit` freezes the candidate once and runs one sequence on that snapshot alone.
   A refusal keeps the session; acceptance ends it.
4. **Measure.** The Built Harness solves the battery under its own file wall with the tools the
   Builder wrote. The host verifier runs the declared checks over each accepted artifact, with
   every tool run hashed and recorded as an evidence row.
5. **Learn.** The review slot reads recorded rows and traces and writes advice. It never changes a
   pass, an acceptance or a claim.
6. **Next move.** Code admits construction, measurement, an adopted-product continuation or a
   typed stop. The existing Builder chooses the next experiment from recorded evidence; there is no
   separate planner. Its bounded `EXPERIMENT.json` records the gap, change, expected result, scope
   and a `target` of `{comparator: "at-least" | "at-most", verifiedPasses}`.

### Design priors

These ten decisions are settled. Code that quietly moves one of them is a defect, not a choice.

1. **Correctness has one owner.** The host verifier, running the declared checks and installed
   tools, decides every pass. No model judge, review or Builder claim sets a score.
2. **The input is one line.** No hidden plan, custom driver or evaluator hint rescues a launch.
3. **The Builder authors the whole bundle.** Nothing in `domains/` is hand-written or repaired by
   hand; cross-domain defects are fixed in the Builder prompt, the shared contract or the starter.
4. **Every environment failure is a typed non-result.** Provider, runtime, sandbox, protocol,
   verifier-host and tool failures leave `truthOk` and `pass` as `null`. A battery of them yields
   an operational result, never a capability rate and never a fail.
5. **The Builder chooses task variance and complexity.** The loop prescribes no axis, step size,
   family mix or parent bijection. Levels and statistical bands describe recorded conditions; they
   do not command the next experiment.
6. **Verifier output is protected.** Stdout, stderr, issue text, counterexamples, reference
   artifacts and per-task failure locations never reach the Builder, the Judge, the diagnosis
   reader or an authoring prompt. Changing only protected detail must leave every prompt digest
   unchanged.
7. **A task-only comparison keeps its product fixed.** The agent, tools and scoring program stay
   fixed while the battery, its task-bound controls and its reference solve change. Comparison
   still requires matching measured model, isolation, thresholds and resource conditions.
8. **Submit freezes one immutable snapshot.** Validation, conformance, census, F2, adoption and
   measurement all consume the same bytes; Git is Builder memory, not accepted-byte authority.
9. **A tool is what the host hashed.** `toolId` resolves once at submit under the candidate's
   `.toolchain`, then the host PATH; each run records digest, source, inputs, exit and outcome.
10. **Approach the limit from above.** A battery the solver mostly passes before a harder one
    failed found no limit; it proves neither complete checks nor difficult tasks. A first battery
    is overly complex, about 3 verified of 25; later batteries aim for a count inside `climb.band`
    (0.20–0.50, so 5 to 12 of 25), where the limit is measured. `placeOnBand` owns the reading: the
    Wilson interval decides significantly too easy or too hard, the point count decides under, on
    or over the aim. **No course is prescribed.** Campaign 3fd52f9e-28 moved only its published
    magnitudes for four consecutive batteries, which is exactly what a prescribed three-stage
    course had told it to do. The prompts state the counts the band implies and leave the route to
    the Builder, and they are the only owner of those counts: `renderBatteryContract`
    (`src/run/climb-readout.ts`) states the first battery's count, the count that finds no limit
    and the aim, per size; a continuation states the aim and never the first battery's count. Every
    sentence it and the climb readout send is a line of `FRAME` (`src/run/climb-readout-frame.ts`),
    and `FRAME_REVISION` is recorded in `difficulty-decision/v5`, so a reworded sentence is a new
    recorded condition. Retain useful adopted work.

## Evidence and implementation status

Use four separate statements instead of "done":

1. **Present in source:** the named tree contains the producer and its live consumer.
2. **Deterministically proved:** a positive and hostile check exercise the consumer on that tree.
3. **Live-exercised:** a recorded run from that exact source reaches the branch.
4. **Outcome-proved:** the live run supports the claimed capability or limit.

Prompt assertions prove text, types prove shape and gates prove tested conditions. None proves
better model behaviour or a completed product vertical; neither do started runs, PR prose,
reference artifacts, static discrimination controls or projected moves.

```text
recorded run bytes > verified evidence reader > source and tests > terminal/log line > PR body > prose
```

A negative capability claim — "the gate does not enforce X", "nothing checks Y" — is the most
expensive kind to get wrong, because it instructs every later reader to compensate for a defect that
does not exist. One enters this file only with a named symbol, its call sites and a check run in the
turn that writes it. A session report is a lead, not the check. Every named threshold, constant,
closed-set member and path written here is grep-confirmed against `thresholds.frozen.yaml` or `src/`
in that same turn, because a rule whose mechanism has left the source is dead text that still costs
a reader an investigation.

Analyse against `opening.json`'s full `source.commit`; cite it and show its first nine hex
characters in `main_synthesis.md`. A missing object is `source-unresolved`. A current fix must be
an ancestor of the measured tree; a composed stack requires every child to contain its latest
published parent. GitHub's `CLEAN` state proves neither.

Separate case outcomes before reading a score:

- `verified` — accepted submission with a verifier verdict;
- `unaccepted` — the agent ran but produced no accepted submission;
- `non-result` — provider, runtime, sandbox, protocol, verifier-host or other typed environment
  failure, with `truthOk: null` and `pass: null`.

Only verified cases enter capability rates. Zero verified cases give an operational result without
a capability result; SIGTERM preserves recorded denominators. An in-run battery scores the
Builder's own tasks: truss `0aad0d` passed 75 of 75 there, and its agent under a Sol solver passed
2 of 23 verified hard tasks. Compare on one shared pack.

A cycle series is the independent evaluation of the real run. Each cycle measures the harness
exactly as the recorded run left it at that point, against the shared pack. An early cycle
is expected to be incomplete: c01 may have no operating guide, a guide that names an analyser that
was never installed, or a tool that reads a field the pack does not publish. It still solves, and
that incompleteness is what the later cycles climb from. Never repair, complete or back-port a
cycle's bundle, and never substitute a later state for an earlier one. Record a condition that
differs between cycles in the sweep's caveats, and read the results through it. A low score on an
early cycle is the expected signal; only a non-result is re-solved.

A run the environment cut short keeps every level it measured before the cut. Compare runs of
unequal length over the shorter one's elapsed window on both sides, and name that window.

Report identities and separate verified, unaccepted and non-result counts. Difficulty uses its own
denominator: once any case is truth-verified, door-rejected attempts count as difficulty failures.
An entirely unaccepted battery is `no-difficulty-evidence`: rebuild, with no capability rate and no
difficulty strike. Unproven served-model identity refuses the identity claim; it does not
reclassify a scored case as an environment non-result.

During R&D, explicit Codex or Claude credit exhaustion is a normal operational interruption:
preserve recorded results and classify affected work from its receipts. Apply this only when the
provider explicitly reports exhaustion. A generic 429, timeout, crash, authoring stall or
unexplained refusal is not proof of no credits — investigate the actual failure.

The controller's terminal codes are a closed set of nine: `completed`, `stopped`,
`fixed-product-boundary`, `build-failed`, `candidate-held`, `budget-limited`,
`environment-blocked`, `measurement-stalled`, `operator-interrupted`. Only `completed` says the run
settled the question it was launched to answer. `fullrun` exits 0 for `completed`, 3 for
`operator-interrupted` and 1 otherwise.

### What may be claimed

- **Safety:** the system refused a bad or unprovable result.
- **Mechanism:** the intended branch executed and wrote its evidence.
- **Capability:** verified artifacts passed the verifier under the named condition; the sentence
  names the recorded tool source and digest, since a Builder-authored checker is not independent.
- **Limit:** one fixed harness reached a pre-registered semantic level and the deepest stable
  result was observed.

An advice packet reaching a second build proves channel execution alone; improvement needs outcome
evidence. A 21/25 first battery found no limit. Static F2 and discrimination evidence prove their
gates; a completed Built Harness task requires live evidence.

## Working rules

1. **The Builder builds the whole domain product.** It owns representation, brief, task families,
   task-bound controls, operating guide, tool contract, declared external tools and verifier
   content. Never hand-write bundles or repair controller output. Fix cross-domain generated
   defects in the Builder, the shared contract or the starter. Put deterministic registration,
   submission, run-loop and evidence code once in `starters/` or `vendor/`; leave domain meaning
   and difficulty to the Builder. Find the established public interface and install the real public
   tool under `.toolchain` or on the host PATH. A stand-in proves conformance to itself alone;
   using an installed interpreter for an authored algorithm does not make that algorithm
   independent.

2. **Use the user's prompt exactly.** Input is one short prompt plus optional public `--context`
   paths. The operator's instruction is "ONLY GIVE IT ONE LINER!! THIS IS THE MAGIC OF THE SYSTEM."
   Never add a hidden plan or a custom one-test driver.

3. **The controller owns generated output.** This covers `domains/`, `campaigns/`, runs, claims,
   admissions and promotion archives; do not edit, repair or commit them. The campaign tree has one
   owner, `campaignRoot()` in `src/meta/campaign-root.ts`; spell no campaign path yourself. An
   epoch is one authoring workspace: one Builder condition, one prompt, one authoring pass. A
   corrected prompt, a different Builder or a reopened product starts a new one; a measurement
   round does not. A failed candidate never replaces the current version. A requested evaluation
   repair is seeded once from the adopted bundle and preserves in-flight edits on resume; keep the
   adopted bundle immutable and classify the accepted repair by what actually moved.

4. **Do not coach the evaluator.** The operator's decision is: "evaluator coaching is reward
   hacking." Treat it as test-set leakage. Protected: verifier stdout/stderr, issue and remedy
   text, verifier source and internal payloads, generated counterexamples, reference artifacts and
   per-task failure locations. None may reach the Builder, the Main Judge, the diagnosis reader,
   the advice packet or any authoring prompt. Public compiler errors and generated-module
   diagnostics may cross, because they describe the public authoring interface. The test is exact:
   changing only protected verifier detail must leave every model-visible prompt digest unchanged.

   Two bounded exceptions exist. `harness_trial` returns one per-task aggregate `truth.verdict` of
   pass, fail or not-run, for the task the caller selected and the bytes the confined Built solver
   submitted for it unaided; check identities, per-check results, verifier output and diagnostics
   stay withheld. That bit is the battery's own condition on one task, which is what a measured
   battery publishes for all of them, and it is the only instrument that lets a Builder see its
   battery is too easy before paying for it. Until 2026-09-19 the caller supplied the calls, which
   made it the author playing solver while holding the answer key; it was used twice in eight
   recorded sessions and the campaigns that ignored it declared "at most 2 verified passes" three
   rounds running and measured six of six. The Epoch Reviewer's `probe_check` is the other, under
   rule 9.

   The Built Harness still needs the public validity relation: requirements, constraints,
   precedence, closed value sets, constants, cited authorities, candidates and declared runtime
   facts. Withhold a sufficient construction algorithm: search order, allocation recipe, fallback
   chain, derivation and hidden tie-break. Withholding is a property of everything the agent can
   read — brief, operating guide, tool descriptions and tool return payloads — not a list of
   filenames.

5. **Give models freedom over content and code authority over conditions.** Code owns facts the
   model cannot observe and decisions where the model is the subject, plus anything that must stay
   byte-identical during comparison: source and model identities, isolation, the task condition,
   verification, denominators, claims, rollback and promotion. Models own representation, task
   families, tool meaning, diagnosis and the semantic next-difficulty proposal. The Built Harness
   owns its solving method. Code may validate declared structure and realised bytes; it must not
   choose domain content because reasoning about it seems difficult. Do not add an autonomous
   scheduler, a model-written claim check or a deterministic harness-defect classifier.

6. **Use evidence as evidence.** Apply the identities, case kinds and denominators above. After
   five consecutive provider non-results, stop scheduling new battery cases: let in-flight cases
   finish, record every unscheduled task as a typed provider non-result, and reset the count when a
   case recovers.

   Evidence cardinality follows the work that ran. Each authoring session writes its own execution
   record and never overwrites an earlier one; readers aggregate every record and pick the latest
   by iteration time, not append order. Builder tool returns checkpoint that record during a long
   turn; use those checkpoints as liveness evidence rather than file mtimes. Tool evidence counts
   attempted, completed, failed and could-not-run actions separately; join a submit result to its
   attempt by session and turn, never by nearby order. A clause present only in stdout is not
   durable evidence. An admission packet that routes no owner is lineage with a reason
   (`no-feedback`, `agenda-consumed` or `evaluation-identity-unadopted`); it
   selects no owner. Unknown usage or cost stays `null` instead of reading as zero, and a turn the
   provider costed is separated from one the transport estimated: a streamed frame's `usage` is not
   final, an interrupted turn never gets the result message that carries the turn's account, and
   each frame repeats the whole cached input while none carries a cost, so a total holding
   estimated turns bounds nothing in either direction. `usage.estimatedTurns` counts them beside
   `reportedTurns`; absent on an older record, where it is unknown rather than zero.

   Order harness versions and checkpoints by recorded commit time, not directory or file mtime.
   Per-case external and differential grounding coverage applies only to truth-verified cases whose
   accepted artifact bytes reached the verifier; unaccepted attempts stay in the difficulty
   denominator and the runtime-identity census but cannot require a tool run over absent bytes.

   Runtime safeguards are bounded log-only sensors: one line to
   `campaigns/<project>/safeguards/<runId>/SAFEGUARDS_LOG.txt` plus stderr, best-effort. A
   safeguard never changes a case kind, terminal, route or score; treat its line as a lead. When a
   recurring shape has a real owner, move it into source and remove the sensor.

7. **Give every decision one owner.** Every actionable evidence names its producer, exact cited
   evidence and active owner. `FeedbackOwner` is a closed set of eleven: `brief`, `tests`,
   `instructions`, `tools-spec`, `accept-controls`, `controls`, `correctness-model`, `fingerprint`,
   `environment`, `judge`, `unknown`. Repair ownership names the defective contract, not a write
   mask or an automatic reset. Preserve in-flight work; accepted bytes decide attribution.

   A claim-only `CampaignFeedback` row carries routing metadata, not a controller-validated
   finding: keep its code and path for routing, drop its free-text claim at the author boundary. A
   typed finding a controller validator produced may keep its detail inside controller-owned
   campaign carry, projected exactly once at the model-visible boundary. An unmarked finding fails
   closed to `generated-execution-unclassified`. Opt a generated finding into author-visible detail
   only when the producer composes that detail from public authoring identities — control ids,
   mutation classes, family names, declared check ids. When rebuild-tier rows tie, choose the owner
   whose declared closure settles the most rows; arrival order is the last tie-break.

8. **Spend complexity only when it changes a useful decision.** Map each concept as
   `owner → live consumer → decision changed → evidence → hostile test`. Reuse readers and owners,
   derive copied state, inline rule-free one-caller wrappers, remove unused mechanisms and files.
   Preserve isolation, identities, non-results, denominators, claims, rollback and
   controller-owned submission.

   Keep no backwards compatibility (operator decision 2026-09-22). A reader takes the current
   schema and version only; a legacy alias, fallback branch, superseded-version reader or set
   member nothing produces is removed, not kept so older recorded runs stay readable. A reader
   that meets an older version refuses it.

   When a design choice is uncertain, prefer removing or widening a gate to adding a wall,
   allowance check or refusal. The observed failure mode here is not unchecked action; it is
   legitimate work blocked by a gate that pays no rent. A gate earns its place by changing a
   decision correctly. Reporting fidelity — carrying a field, naming a thing accurately — is not
   gating and is always fair game.

   `thresholds.frozen.yaml` is declared policy: an executable threshold that disagrees with it is a
   blocking inconsistency, not an implicit relaxation. New and rewritten files stay at or below 800
   nonblank lines and functions at or below 115 (`tools/loc/source-policy.ts`, raised from 600 and
   80 on 2026-09-20 when `biome format` took the line breaks), and
   `tools/loc/complexity-policy.ts` keeps every function's cyclomatic complexity below 22, with
   existing exceptions frozen in `complexity-baseline.json` — that baseline only shrinks
   (`--write-baseline`). `bun run lint` runs Oxlint over `src tools vendor starters test
   packages .claude` with two plugins, `anti-slop` (copied from dmmulroy/anti-slop; 16 rules,
   including `require-safety-comment-for-type-assertion`, `no-object-parameters`, `no-runtime-typeof`,
   `no-module-mocking`) and `ana` (35 rules; `tools/oxlint/BASELINE.md` says what is on,
   `SHAPE-RULESET.md` what is not yet, and `FIXER-DECISIONS.md` why 13 of the 51 carry a fixer and
   38 report — including the nine whose fixer is mechanically available and refused on purpose).
   Both plugins are optional: every lint runs them, but their findings and the not-slop ledger
   fail it only under `bun run lint -- --strict` or `ANA_LINT_STRICT=1` in the environment (the
   `.env` is not loaded, since `bunfig.toml` sets `env = false`); a plain run holds a contributor
   to oxlint's own rules and counts the rest. A clone is strict by default once it runs
   `git config ana.lintStrict true`: the key stays in its `.git/config`, shared by its worktrees
   and never pushed.
   A new file receives no grandfathered exception; keep each remaining
   exception scoped to one rule and named path, and let an obsolete suppression fail the lint
   (the strict lint, for a plugin rule's) rather than persist as debt. **Never turn a rule off**:
   no new `"off"` entry in
   `.oxlintrc.json`, whether for the tree, a glob such as `test/**` or one named file. Tuning the
   deterministic linter, `bun run lint` and `bun run simplify` alike, is endorsed, in one
   direction only: change the rule's source so it targets
   the slop more precisely, so the legitimate shape it mis-targeted passes and every slop case it
   caught still fails, with a fixture for each side. A finding the rule cannot tell apart that way
   is fixed in code or answered with a reasoned row in the not-slop ledger (operator decision
   2026-09-22, after a `test/**` and a `json-shape.ts` override silenced 13 findings wholesale).
   Treat every `unknown` parameter as a proof obligation, keep raw
   uncertainty at the validation boundary, and never hide an unproved input behind a generic
   intersection to satisfy lint. OAuth bytes are external input: use `capturedJsonParse`.

9. **Judges advise; the verifier decides.** The Main Judge reviews only accepted shipping artifacts
   that carry a boolean verifier verdict; unaccepted submissions, refusals, non-results and missing
   artifacts cost no Judge call. There is no Judge control census: no control or bait subject
   reaches the Judge, and a new run writes no sample, bait or standing file. Every ordinary accept
   and reject control is still task-bound and verified through its declared check by the verifier.

   Each subject gets a fresh Judge session: groups of at most five, stop after five consecutive
   provider errors, a 30-minute hard wall per turn, and the first valid verdict stands. The Judge
   sees the original request, the bound public task, the submitted artifact, the public schema and
   design rules, the projected tool contract and declared runtime facts; never the Built prompt,
   the solve trace, verifier output or a reference artifact. Never compare two artifacts inside its
   prompt. Keep the three `judgeDeAnchoring` rows unbound.

   A Judge fail must cite at least one verbatim rule from the public validity rules, artifact
   schema or public input; an uncited fail is a protocol non-result. A cited fail of a verifier
   pass is a **veto**, recorded on the claim as `vetoed` and bounded by `verifierPassJudgeFail`; a
   contradicting first verdict is re-sampled once. Vetoes and disputed fails go to the Epoch
   Reviewer to settle, and a settled veto projects only its count and family to the Builder. The
   Judge still sets no score, changes no acceptance and does not decide adoption: disagreement with
   the verifier remains a reason to inspect the verifier.

   The diagnosis reader offers at most six standing non-environment issues, states how many
   matching cases it sampled, says when no passing contrast was supplied, and keeps failed tool
   arguments beside failed results. It attaches a cause, first observed failure boundary,
   falsifier and intervention class to the controller-owned issue, and selects no owner. Treat a
   timeout as diagnosable unless the battery evidence proves environment ownership.

   The Epoch Reviewer runs once per measured-condition digest and may record routable findings or
   dispute a standing issue. It must label each finding advisory or blocking; blocking requires a
   demonstrated violation of the request or a declared requirement. Its orientation states where
   the battery landed on the band through `placeOnBand`, the same reading the climb readout
   gives the author, so the one component that reads the measured tree against the original request
   knows what the round was aiming for; until 2026-09-18 it saw the counts alone and was asked
   about "a perfect or near-perfect battery", which left the whole `over-aim` zone — the zone whose
   name says no limit was measured — with no stated reason to inspect. The placement opens a
   question; the finding is still the obligation of the request the tasks leave undemanded. It may
   also **execute**: `probe_check` takes one accept control, one rooted path into its artifact in
   the spelling the declared checks use (`$.layout.members[0].area`, read through `jsonPathTokens`)
   and one replacement value, runs the candidate's declared checks over the original and the
   changed artifact, and reports which checks moved. At most eight per review, accept controls
   only, on a path that already exists. A probe whose original did not pass, or whose changed
   artifact reached no verdict, is not evidence. Every harness-defect finding cites its `probeIds`
   or sends `[]` for a source-only reading, and a probe-backed harness-defect may be admitted
   blocking on first occurrence. Otherwise a first agent-side defect stays advisory and recurrence
   is keyed by the declared check the finding names, or by the artifact path when it names none —
   but only a path below a declared schema root. A bare root is not an identity: `schemaPath`
   requires the first segment alone, so a one-root domain offers one word for the whole artifact,
   and across the recorded corpus every campaign that fell back to a path collapsed to a single
   constant. Run 17f9de demoted a new finding on two recurrences belonging to other defects; the
   same collapse raises one at a single recurrence, which is how a 25-of-25 harness was reset. Only
   curriculum or evaluation-side defects may dispute an issue; a dispute keeps the issue counted
   while withholding agent advice. Public candidate analysis and checks of published limits are
   legitimate solving support; call a tool an answer shortcut only when it supplies the remaining
   decision the solver was meant to make.

   Reviewer spend is not an axis for savings. The reviewer is the only component that reads the
   measured tree against the original request; make it smarter and let the build iterate more. A
   cut is earned when the recorded corpus shows the text bought nothing, never by token count.

10. **Accepted bytes determine experiment attribution.** The frozen operation vocabulary is
    `task-probe | harness-intervention | evaluation-correction | repeat | new-baseline`.

    - **Build / harness intervention:** no adopted harness, or a continuation that changes the
      product. The Builder may reopen representation, tools, task families, artifact schema,
      verifier and solve path. Its captured bytes, not the loop name, determine the measured
      experiment.
    - **Evaluation correction:** preserve the agent, public exam, rules and bound submission schema
      while correcting the evaluator, controls or private expectations. Broader edits receive build
      attribution.
    - **Task probe:** keep the agent bundle, representation, tools and scoring program fixed —
      `brief.json` and `evaluator.ts` with every module it imports (`scoringHash`); change the
      battery and its task-bound controls, and with them the reference solve and tests. Re-run
      conformance, controls and F2 before measurement. Known product blockers cannot be evaded by
      changing tasks or relabelling scope.
    - **Environment recovery:** keep product bytes fixed. A provider restoration cannot be reported
      as a product improvement.

    There is **one authoring path**. The separate fixed-harness session that prescribed a selected
    level, family composition and parent lineage through `DIFFICULTY.json` is removed: across 33
    recorded rounds it never left the too-easy zone. Its learnings are kept in the open path as the
    task freeze, the changed public-input subset and the refusal of a repeated public condition.

    A measured candidate with at least one verified case and a written claim is selected through
    the retained-product transaction. A zero-verified or environment-blocked candidate is held with
    `candidate-zero-verified` and never becomes the baseline; its non-result and unaccepted kinds
    reach the next round through the advice packet. There is no contest between a candidate and the
    current harness.

    The rebuild advice packet is deterministic, recorded at
    `analysis/<runId>-rebuild-advice.json` (with `rebuild-advice-latest.json` beside it) and bound
    by digest to the consuming iteration. Render it once at every rebuild kickoff. Derive advice
    from recorded rows, recorded Judge reviews and admitted aggregate findings; per-case findings
    never reach authoring. Each issue keeps a stable id and the states `active`,
    `tentatively-fixed`, `confirmed-fixed`, `regressed`, `retired` and `disputed`. A family leaving
    the task set makes its issue `retired`, which proves no fix. Count absence towards a fix only
    when the family ran.

    `--product-policy fixed` permits measure or stop and refuses build and rebuild. A campaign runs
    uncapped unless the operator sets `--iteration-budget N`; there is no launch default (operator
    decision 2026-08-19). `ControllerLedger` in `src/run/controller-ledger.ts` reserves campaign and
    provider-run quotas together before a model call. Started calls stay charged across
    interruption, cap changes and epochs; only an unstarted reservation may be cancelled.
    `budget.json` binds the database identity, and missing or corrupt state refuses instead of
    resetting spend.

    Controller loop ceilings (`src/critic/policy.ts`): `environmentBlockedRounds 3`,
    `buildFailedRounds 3`, `stalledMeasureRounds 3`, `stalledFindingsRepeats 8`,
    `noopSubmitStrikes 3`, `unchangedCandidateStrikes 3`, `toolNonResultRefusals 3`, and
    `climb.offAimStreakRounds 3` — consecutive rounds reading one side of the aim, counted in
    batteries, with a round whose claim was refused counting behind a placement but never alone.
    Runs 17f9de and c1d2a7 each reached three and the operator stopped each by hand there. Nothing
    is held fixed while the streak runs; the Builder keeps choosing what to change.

11. **Distinguish task demands from coverage and repair.** A level is an ordinal label, not a
    difficulty explanation. New hashes, ids, family names, longer descriptions or more scenarios do
    not establish a harder problem. The Builder names the changed public requirement and the
    reasoning interaction it adds. Stronger checks and broader coverage may be useful without
    making the requested solution more complex. A repaired evaluator is a new condition, not proof
    of a difficulty advance.

    Battery size has one owner, `src/run/battery-sizing.ts`: `floor 5`, `default 25`, `ceiling 60`.
    A fresh product measures **probe batteries of 5 to 10 tasks**, sized by the Builder, until one
    passes some but not all of its scored cases; only then the requested size. An out-of-range size
    fails rather than being clamped, because a silently changed size is a changed measurement
    condition. `ClimbAction` is `placed | no-difficulty-evidence | repeated-failure-set |
    family-conflict`: one name for a decision that has a band placement and three for recorded
    shapes whose rate is not difficulty evidence. The reading belongs to `placement.zone`, which
    `placeOnBand` already decided — `climb`, `hold-limit` and `ease` were a second, lossier
    encoding of those five zones, and every consumer either re-switched on the zone or tested
    `=== "climb"`, which is `zone === "too-easy"` spelled differently (2026-09-18). No source file
    and no row of `thresholds.frozen.yaml` carries the `climb.limitHoldRounds = 4` this contract
    used to cite, and that absence is the design prior, not a defect — the route after a battery at
    the limit is the Builder's. All four off-aim zones feed one trailing streak and receive the
    same course, with the words that are direction-bound changed: the streak stops where the
    product crossed the aim, and a battery below it reads the same scores, repeated task sets,
    attribution and calibration a battery above it reads. Until 2026-09-18 the streak counted the
    above-aim side alone, which is the side a first battery is authored away from. A target enters
    the calibration count only when its comparator names the side the streak is on, so the Builder
    is told which comparator to declare. Sample size has one owner, the Wilson interval at
    `climb.confidence` 0.95 two-sided, whose one quantile is `REPORTING_Z` in
    `src/claim/estimation.ts`; a battery too small to hold a whole count inside the band is refused
    a placement rather than misplaced. Both second owners went on 2026-09-18: `wilsonZ` with the
    duplicate Wilson implementation, and the `minLevelN` floor that discarded a placement whenever
    the Builder had changed fewer than four tasks.

    At authoring validation, at least one shared `publicInput` path declared by each family's
    applicable truth checks must have two distinct values. The comparison is per declared path, so
    a check declaring a coarse one is satisfied by any change anywhere inside it: 18 firmware tasks
    passed it while every one of them published the same display, the one peripheral the request
    named. Declared variation proves coverage, not semantic difficulty or actual verifier
    dependence.

    An open continuation records `EXPERIMENT.json` before preview or submit. Intent cannot change
    scores, override gates or make identical bytes new. Refuse repeated public conditions on a
    fixed product even after ids, families or levels are renamed. Changed bytes establish
    membership, not semantic difficulty; with no observations the result stays unknown.

12. **Evaluate the requested artifact, not decorative output.** Every artifact-schema root must be
    reached by a material truth check, and every advertised capability must map to checks that can
    fail on real tasks. A root that may be removed or replaced without changing the verdict is
    unverified decoration: refuse it before paid measurement. F2 runs **every** authored task's
    reference solve before adoption — an earlier version solved only `tasks[0]` — and proves the
    submission path, not end-user correctness. A checker-required artifact path, suffix or
    entrypoint is part of public validity: publish it in the brief and the operating guide. When a
    checker can execute or simulate submitted source, decide from the values it produces rather
    than recognising one source shape. Publish every comparison rule exactly as the truth path
    applies it: counterfactual direction and scope, floors or minimum counts, and tolerance.

    A binary answer can be task-conditioned evidence. Refuse a boolean certification that stays
    constant within an affected family when no other applicable check derives it from artifact
    content.

    Controls calibrate the checks. At least 5 accepts and 5 rejects. For every applicable
    check-by-family cell, require one passing task-bound accept. Require one reject that fails on
    its declared check for every applicable check, and give every family at least one such reject;
    one reject may serve both (operator decision 2026-09-15, replacing one reject per cell, which
    asked a 6-check, 5-family truss for 30 rejects). Build each reject from the known-correct
    accept for the same task, then change one fact; further checks may fail on it (operator
    decision 2026-09-14). A reject that fails elsewhere but not on its named check provides no
    discrimination evidence. `taskConditioned` roots are replayed across sibling tasks; numeric
    boundaries get a task on the value; a root no check reads is refused before measurement.

13. **Set one representation contract before tools and truth depend on it.** The public artifact
    schema, writer tool schema, DraftStore representation, submit compilation, F2 witness and
    verifier input must agree on required, nullable and equivalent values; no undocumented empty
    string or zero sentinel where the public schema promises `null`. A valid artifact the writer
    cannot express, or a writer accepting a value the verifier interprets differently, is a
    representation defect. A task probe may rewrite the accept corpus, but every new accept must
    fit the adopted schema and the recompiled schema hash must stay byte-identical. Conformance
    must open every task and require generated tools to expose one stable worker registration and
    tool schema across the battery. Repair the shared contract instead of teaching agents the
    mismatch in prose.

14. **Keep model-visible text small and single-owned.** Put stable domain and safety framing in the
    start prompt, one controller-derived correction in steering, bounded continuation at a stop or
    submit boundary, and public result shaping in the live tool result. State measured public
    runtime facts where they save blind discovery, and do not repeat one duty across the workspace
    card, body, closing paragraph and tool description. If the same interface failure recurs, fix
    the schema, tool or shared contract instead of adding another tutorial sentence. Keep the
    Builder's intent in its start prompt and the loop, gate sequence and worked domain shapes in
    `STARTER.md`. Starter examples must satisfy their declared schemas and name only tools they
    declare; refusal examples must use codes the current source still emits. Prompt digests are
    condition identities; prompt tests prove delivery and still require a fresh behavioural run.

    Keep the authoring areas separate by authority. `harness_inspect` is static and read-only, with
    nine modes (`readiness`, `summary`, `task`, `tools`, `typecheck`, `inventory`, `coverage`,
    `feedback`, `history`). `harness_trial` takes one `taskId` and solves it blind with the
    measured Built solver — its own runtime, turn cap, solve wall and confinement — then grades
    what it submitted, returning the rule-4 aggregate verdict, whether it submitted, its turns and
    any typed non-result, under six rehearsals per session and a 30-second total verifier deadline.
    Each rehearsal costs one measured case and writes its solve evidence under
    `<campaignDir>/rehearsals/`. Parameterless `submit` alone freezes and accepts candidate bytes.

    **`agent/config.yaml` owns each harness's runtime walls** (`src/truth/harness-config.ts`). The
    Builder is told the file exists, not what it holds. Defaults: solver `solve_minutes 120`,
    `max_turns 24`, `shell_timeout_seconds 300`, `shell_timeout_max_seconds 900`; gate
    `reference_solve_seconds 120`, `census_minutes 30`, `check_seconds 600`, `tool_run_seconds 300`.
    A harness may raise any of them to **ten times** its default; above that the host refuses. The
    Built Harness prompt derives and names its exact closed tool roster. Every fresh
    `tools-spec.json` is to give the solver a shell through the `presets` field — `"files"` for a
    file-shaped answer, or `"shell"` beside an artifact-writer, never both, since `files` already
    carries the shell (operator decision 2026-09-14, after truss epochs kept declining `files`,
    whose draft files become the answer). The gate enforces it, and this paragraph said the
    opposite until 2026-09-18: `solverShellFindings` in `src/author/candidate-check.ts` refuses a
    spec with neither preset, on a fresh build, on a continuation that may author the agent, and on
    a task-only round — which cannot select the preset itself, so that refusal names the product
    round that can. `validateToolsSpec` is indeed satisfied by `presets: []` beside an
    artifact-writer, so the refusal lives one layer up — but no recorded bundle took that opening:
    all nine exported across campaigns 3fd52f9e-28 and -10, the two of 2026-09-17 included,
    declare `presets: ["shell"]`. Still read a measured battery's roster before attributing its
    failures. A Built turn is bounded by silence, one model call plus one command at its ceiling;
    a solve the whole-solve wall stops after it called a tool is an unaccepted attempt with its
    traced tool calls, not a non-result.
    For generated tools, `text` is the whole model-visible result and `details` is host and trace
    evidence, so every promised value belongs in `text`. A Builder tool result that drops bytes
    names where the rest is: a truncated command writes its whole output under `.bash-output/` in
    the workspace and the result gives that path, because a draft can be read again and a command's
    output cannot. The directory is dot-prefixed so the listing tools pass over it and never
    fingerprinted, so it cannot reach a candidate.

    A Builder authoring session has no default wall; `HARNESS_BUILDER_SESSION_CAP_MS` may set a
    positive-integer one, and a Builder bash install may run up to two hours. The Epoch Reviewer
    reads the authoring tree always at the completion of a host tool call and never inside one:
    after a clear `correctness_check` whose agent or correctness-model bytes changed since the last
    review, it reads that immutable snapshot; after **40 minutes** without a review
    (`REVIEW_INTERVAL_MS`, `src/gate/review-clock.ts`), it reads the live workspace at the next
    completed tool call. The clock restarts when a review finishes and the public projection of its
    findings rides that tool's result. No probe budget or no-submit strike bounds a session's
    reconnaissance before its first authoring change. A round runs as a Codex goal
    (`src/author/builder-continuation.ts`): every continuation restates the request and the round's
    facts, a round has no turn cap unless `--max-builder-turns` sets one, and three turns in a row
    without a successful tool call end it as the retryable `no-progress` clause on the same
    conversation. The continuation asks for authoring after eight turns or two hours without a
    submit, and byte-identical resubmit strikes remain.

    **One Builder conversation spans the controller run** (`src/author/builder-conversation.ts`).
    A settled round pauses its session while the controller measures, reviews and advises; the
    next round resumes it when the system prompt, every tool schema and the transport are
    unchanged. The session was opened on stubs that route each call by name to the open round's
    tools, and a call between rounds is refused. A resumed round's first message says how the
    last round ended and where it works now; it reads no memory block, which only a fresh session
    receives. A round that threw, a changed contract or a closed transport opens a fresh session,
    and the run's settle closes the last one. Per-round bounds stay per round: turn limit,
    rehearsals, submit strikes, the review clock and the execution record. A process restart loses
    the conversation, since nothing about it is durable.

    `correctness_check` runs the same validation sequence submit runs, control census included, on
    the exact immutable snapshot, as often as the bytes change. A blocked or runtime-non-result
    preview is remembered as spent for those bytes; unchanged bytes spend nothing. Preview and
    submit share an in-flight gate in either call order when candidate and installed-tool
    identities match; submit reuses only a clear result. A thrown or host-refused gate is
    forgotten, while the preview attempt stays spent. A refused candidate repeats by
    controller-owned candidate identity, not workspace commit. Never cache a typed runtime
    non-result as a verdict on candidate bytes.

15. **Stop honestly when the environment produces no evidence.** A battery of typed non-results
    creates no shipping claim and gives no input to a rebuild or probe; do not remeasure the same
    dead provider because rounds remain. The controller gives transient recovery a declared bounded
    allowance, then records `environment-blocked`. A provider limit, missing credential,
    unsupported catalogue model, spend limit, provider timeout or sandbox refusal belongs to the
    environment owner, never to the task author. In F2, a controller deadline before the
    generated-tool worker is ready or closed is a host non-result; a worker that answered its
    handshake and then broke its protocol is a representation defect. A worker's close failure
    after an accepted submit stays in worker evidence without voiding the case; without an accepted
    submit it remains a non-result. At claim time, a solvability-witness tool non-result earns one
    fresh execution only for `sandbox` or `verifierUnavailable`; record `timeout` and `crash` on the
    first attempt. Persistent refusal leaves a typed finding and a missing-witness readiness clause
    beside the recorded score; it does not turn verified cases into wrong answers.

16. **Accept broad requests and apply strict evidence later.** Admit broadly sensible domains;
    record excluded families and unverified capabilities without silently narrowing the product.
    Adoption, measurement and claim gates decide what the evidence supports.

### The correctness model

A candidate declares `correctnessContract: "check-program/v1"` — the only accepted value. Each
truth check is one Boolean function in `correctness-model/evaluator.ts` `checks`, applicable to
declared families, reading only its declared artifact paths, public input paths and its own hidden
operand. Missing required hidden data refuses execution rather than making the check inapplicable.
The host runs every applicable function in a fresh confined child and constructs the aggregate
verdict; there is no second predicate.

A check declares its evidence kind. `authored` computation may name `execution.requiredToolIds`,
including an interpreter for the Builder's own algorithm, and keeps authored semantics. `external`
evidence declares an installed tool as the deciding instrument: pass flags and names as args and
leaf-bound files or stdin as operands. `solvability-tool-program-argument` refuses an external
check with a multi-line argument or one over 256 bytes. The self-authored check refuses when every
required executable's digest matches known candidate-authored source. These are bounded detections,
not a general proof of provenance; an installed interpreter running the Builder's algorithm remains
authored computation. Coverage rows carry the declared evidence kind. Preserve the selected command
path through inventory, attestation and execution: identical hardlink bytes can dispatch
differently under different names. Keep compilation, host simulation, target execution and hardware
operation as separate scopes.

Execution is recorded; independence needs separate evidence. The claim records the digest and
source (`workspace-toolchain` or `host`) of every tool that ran as `verifierEnvironmentHash`, and
`externalCheckCoverage` counts host-attested launches and reject controls per check-and-tool pair.
Neither installation location nor passing the digest and argument checks establishes independence.

### The gate

`correctness_check` previews the same gate `submit` runs, without adoption; rule 14 owns their
shared snapshot, tool identity, cache and retry contract. The census, F2 and grounding read
recorded rows and executable bytes, never Judge prose. Refusals route by kind to the owning
`FeedbackOwner` and return to the same session. A byte-identical resubmit of a refused candidate is
a counted no-op strike; three end the session as `authoring-stalled`. A typed runtime non-result is
neither cached as a verdict on those bytes nor counted as a strike. A close-handshake timeout after
all conformance probes settled remains cleanup evidence without refusing the candidate. Provider
and credential failures end the session with a typed terminal clause. The gate never compares two
candidates and never judges quality: it admits a candidate that satisfies its own declared contract
and refuses everything else with the exact finding.

### Identities, walls and process facts

The accepted candidate has one byte identity from submit through adoption. Product files become
durable at one retained version path before `ControllerLedger` commits selection, promotion
evidence and admission together. A held row is equally byte-bound; a replay must name the same
version, fingerprint and experiment. Preserve damaged state for review.

Verifier process results and process cleanup are separate facts: a deadline bounds execution and
output collection even when a child or pipe will not settle, cleanup keeps a durable receipt,
recovery never signals a saved PID, and a successful kill syscall alone proves nothing. Each tool
run gets fresh private `TMPDIR` and `HOME` children. Darwin Seatbelt and Linux Bubblewrap each need
their own live proof, and an unavailable required wall yields a typed non-result, never an
unconfined run.

Builder access is stated once per backend through the host-controlled file and command tools: the
workspace, public inputs, prior traces, host toolchain paths, compiler scratch and the exact
`src/solve` and `src/meta` authoring interfaces are open; controller evidence, credentials, other
accounts and the `src/truth`, `src/verify` and `src/gate` trees are closed, including evidence
created after session start. The Built Harness keeps a narrower file wall with outbound network so
it can fetch a toolchain into its private home (operator decision 2026-08-15, reaffirmed
2026-09-06). The controller brokers each HTTPS public-source hop: the requested hostname resolves
once, the resolved address must be public, and the request is pinned to that address with SNI and
Host bound to the real hostname — at most 5 redirects, 64 MB and 120 s. The destructive-command
guard is a safety net, not isolation or evidence; a recursive remove of a relative workspace tree
and a discarding checkout or restore of the session's own file pass over its refusal (operator
decision 2026-09-14).

### Run configuration

A run has three model slots — Builder, Built Harness and review — set with `--builder-backend`,
`--built-backend` and `--review-backend`. Backend kinds are `codex`, `openrouter` and `claude`, and
all three are supported on all three slots; `--review-backend` also takes `disabled` and `inherit`.
The Built slot needs a slug the Pi catalogue names so its evidence says what was measured. The
review slot shares one pin across the Main Judge, diagnosis reader and Epoch Reviewer; operator
names use `review`, evidence keeps `judge:"off"` and `judgePin`.

Every slot resolves its provider, credential and model through one layer,
`src/backends/pi-providers.ts`. The Builder and review slots run in-process on one pi host session
(`src/backends/pi-session.ts`), each with its own tools and framing; the Built slot runs pi in its
confined child. The Builder keeps one session for the whole run: between rounds it waits, with its
context intact, while the controller measures and reviews, and the next round arrives as its next
prompt on a reconfigured roster. A round that threw, or a process restart, opens a fresh session
that reads the Builder's notes.

Kinds live in `.harness/backends/<project>.json`, layered over `default.json` per slot; an absent
review key means "nobody chose", while `{"review":{"disabled":true}}` is an explicit off. Models and
efforts come from `CODEX_{BUILDER,BUILT,REVIEW}_MODEL` and `CODEX_*_REASONING_EFFORT`, or the
`CLAUDE_*` equivalents. **An unpinned codex slot defaults to `gpt-5.6-luna` at `xhigh` on all three
slots** (`src/backends/slot-defaults.ts`), so a launch without env pins silently measures a
condition no table names — pin explicitly. Every slot's effort is checked against the thinking
levels the pi catalogue lists for its model, with no provider call. The OpenAI-completions route
pairs `OPENROUTER_API_KEY` with the OpenRouter address, or
`CUSTOM_ADDRESS` with `CUSTOM_API_KEY` and a `CUSTOM_CONTEXT_WINDOW` of at least 16,384 output plus
8,192 reserved input tokens. Require every opening tuple to match the intended condition before
battery spend; report mixed slots as a separate condition. An adopted bundle exports with
`bun run harness -- export <domains/slug> <dir>` and runs `bun run solve` and `bun run check` on the
controller's own paths.

Claude credentials resolve process env > `.env.cloud` > `.env.local` > `.env` > the stored login
file; `bun run login -- status` names the winning source. Every Claude slot presents the one
`CLAUDE_CODE_OAUTH_TOKEN`. `claude setup-token` mints for the account the browser is signed in
as, not for the alias or config dir in front of it, and session limits are per account.

## Working in the repository

Resolve the exact tree, prepare dependencies once, run focused checks while editing and one
composed gate at delivery. Pay each cost only when the changed files need it.

**Resolve and create the worktree.** Start with `scripts/worktree.sh list`: one call gives every
tree's head, branch, uncommitted count, dependency state, whether a command is standing in it, and
the free space beneath them all. Reuse a clean worktree when it already owns the intended branch
and nothing is standing in it; `git status --short --branch` in the named tree settles what the
uncommitted count only counts.

```sh
scripts/worktree.sh new <branch> <absolute-dir> [start-point] [--scope S]
scripts/worktree.sh pr <number> <absolute-dir> [branch] [--scope S]
scripts/worktree.sh setup <absolute-dir> [--scope S]
scripts/worktree.sh run <absolute-dir> <command...>
scripts/worktree.sh list
scripts/worktree.sh drop <absolute-dir> [--force]
```

`new` creates the branch and runs `setup`. `pr` fetches a published pull request head first and
puts it on a distinct branch, so the PR's own source branch stays available to the session that
holds it. `setup` does nothing when its install marker already matches the dependency identity;
otherwise it clones real `node_modules` copy-on-write from a matching worktree, or runs one
`bun install --frozen-lockfile`. `run` checks Bun and reads no flags of its own, so a command
keeps its; it prepares a tree whose `node_modules` is absent, linked or prepared for other
dependencies, and refuses only while another command is standing in that tree. Use it for Bun,
tests and anything loading repository modules. `list` prints every worktree with its head,
branch, uncommitted count and whether a command can run there now, marking each `ana-run-*` tree
as evidence and each tree a running command is standing in as in use, and closes with one line
counting the fleet's dependency states and the volume's free space. `drop` removes a disposable
tree, refusing the checkout itself, any `ana-run-*` tree and anything holding uncommitted or
untracked work unless `--force`.

**Choose the scope before creating the tree.** `--scope` says how much of the local checkout the
new tree gets, and `run` then works the same in all three.

| scope | what it prepares | when to ask for it |
| --- | --- | --- |
| `minimal` | the worktree alone: no Bun check, no `node_modules` | a change confined to the hook's documentation set. Seconds, not a clone |
| `medium` (default) | a prepared `node_modules` | anything loading a repository module: every test, check and Bun entrypoint |
| `maximum` | medium plus inheritable ignored state: `.toolchain`, the learned test ordering | a tree that would otherwise redownload the domain toolchain |

The documentation set is `README.md`, `AGENTS.md`, `docs/**` and `.claude/**/*.md` —
exactly what the pre-push hook answers with `git diff --check` alone. `minimal` replaces the raw
`git worktree add` recipe for it, with one caveat the hook enforces and the script can only
announce: a push that creates a remote branch is never documentation-only, because an all-zero
remote sha leaves the hook nothing to diff against. Prepare the tree before publishing a branch
for the first time, even for a note.

`maximum` names every ignored path it left behind with the reason. Credentials, `campaigns/`,
`domains/`, `runs/`, recorded results and a path-bound `.venv` never travel; the tree's own
workflow owns them.

Never symlink `node_modules`: `@ana` links may resolve into another tree's `vendor/` source. The
script never links, never treats a link as prepared, and both run launchers refuse a linked tree
before spending anything. The copy-on-write clone already shares the blocks, so a link would buy
nothing. Never use bare `git stash`; stashes are shared across trees. Remove only a clean
disposable tree this task created. For authorised cleanup use `/usr/bin/trash` with explicit
paths; preserve run evidence and unpublished work, and never empty Trash.

**Classify a missing file before supplying it.** Check
`git ls-tree -r --name-only <revision> -- <path>` first. A tracked missing file means the revision
needs correcting; a missing dependency belongs to `worktree.sh setup`. Local run state or
configuration belongs to its owning workflow: never copy or symlink `.env`, campaign, domain or
config files from another checkout to make a command start. A scratch script that imports
repository source belongs inside the worktree it reads: Bun resolves `@ana/*` and relative
specifiers from the importing file, so the same script under a job scratch directory fails with
`Cannot find module` however absolute its paths are. Clean Git status proves tracked source, not that
ignored dependencies match a rebased head.

**Install only when dependency identity moved.** Do not add or maintain dependency patches,
including `patchedDependencies` or edits to installed dependency source. `worktree.sh` owns root
dependency preparation; do not install again afterwards. In a prepared tree, frozen-install only
for absent or unresolved dependencies or a changed owning manifest. On frozen-install failure,
preserve stderr and inspect the exact head and introducing diff. A real mismatch on the intended
clean revision blocks delivery; it does not authorise rewriting the lock. For version disagreements
between branches or installed dependencies and lock, take the higher version (operator decision
2026-09-03) and prove it with one frozen install.

**Commands.** `bun run test -- <paths...>`, never bare `bun test`. The wrapper runs one
`bun test --parallel` process with **two workers fewer than the machine's cores, minimum two**
(`ANA_TEST_WORKERS` overrides), slowest-first ordering learned from its first run, and a disposable
temporary root under the host temp directory; after an idle wall it re-runs never-reported files
once, without workers. `bun run gate` runs nine steps — runtime, **format**, **ui-deps**, typecheck,
lint, **source-policy, complexity, ui** and tests — so the two policy gates, the UI gate and the
formatter can fail a push the contract used to leave unnamed. `ui-deps` prepares `packages/ui`'s
own modules before typecheck and lint read them, because `scripts/worktree.sh setup` prepares the
root ones alone and an unprepared `@types/react` makes lint report findings no diff introduced. `bun run format` fixes the format
step; `biome format` at `lineWidth` 110 owns every line break under `src`, `tools`, `vendor`,
`test`, `starters` and `packages`, which is why the size ceilings are 800 and 115. The only paths
outside it are `.agents` and the eleven vendored files an override in `biome.json` names one at a
time; `tools/oxlint` came in on 2026-09-20 and cost 25 lint errors, mostly `curly` finding
statements the formatter had just made multi-line. Also available: `bun run outcome` (read-only
reports over recorded evidence), `bun run replay -- <campaign>/<runId>` (re-grade a recorded
battery through this tree's verifier), `bun run triage`, `bun run secrets`, `bun run typecheck`,
`bun run format`.

Run one gate at a time: two overlapping gates each took twice as long as one alone. When
typecheck, lint, source-policy or complexity fails, the pre-push hook lists each finding as `<rule> <location> <message>`, and
`prepare-commit-msg` appends them to the next commit on top of the failing one as `Gate-Fix` and
`Gate-Finding` trailers.
`git log origin/main --format='%(trailers:key=Gate-Finding,valueonly)' | awk 'NF {print $1}' | sort | uniq -c | sort -rn`
counts the rules agents keep breaking.

| Changed files | While editing | Delivery proof |
| --- | --- | --- |
| Surrounding documentation only | `--scope minimal`, then `git diff --check` and read the diff | Normal push repeats the diff check and skips the gate |
| Test or source | `scripts/worktree.sh run <dir> bun run test -- <owning-paths...>` | One normal push runs the composed gate |
| Intentional dependency change | One unfrozen install at the root, review manifest plus lock | Frozen install, then source delivery |
| Stack checkpoint with publication | Union of affected owning checks | One multi-ref push from the clean top runs the gate |
| Composition without publication, or a paid run without current exact-tree proof | Owning focused checks | One manual `bun run gate` immediately before the boundary |

Keep the positive and nearest hostile case in the smallest owning test file; add only the missing
case. Batch small fixes under one owner. Normal pre-push owns typecheck and lint; run either
separately only when it is the changed boundary. Neither substitutes for behavioural proof.

**A static gate failure is fixed forward** (operator decision 2026-09-21). Commit the work as
written; do not run lint or the policy steps first to clean it. When the push gate fails on
typecheck, lint, source-policy or complexity, nothing is pushed: leave the failing commit as it is,
make the fix the next commit directly on top, and push both together. Never amend, squash or rebase
the failing commit away: the pair records what the author got wrong, and merge commits carry both
to main. Fix a rule agents keep breaking at its owner, whether a prompt, a skill or the lint rule's
own message, rather than in more fix commits.

**Shell commands and the guard.** Before sending a Bash command, scan every `$`: `$VAR`, `$(…)` or
`${…}` alongside `git`, after `>` or inside a heredoc triggers the `dcg` guard, including inside
loops. A blocked call never runs and loses the turn — change the spelling rather than requesting an
allowlist entry. Test a new spelling with `dcg test '<command>'`.
The shape to remember: redirect to a literal path or the shell's own `$HOME/…` or `$TMPDIR/…`
(dcg 0.14.0 admits that private scratch redirect); prefer `git worktree remove --force`,
`git diff -- <path> | git apply -R`, `git branch park <tip>` then `git rebase --onto`, literal
`git -C /abs/dir` one call per tree, `git push --force-with-lease`, and the Write tool followed by
`bun <f>` or `--body-file <f>` over a heredoc holding shell text. `git clean -n -d` and `find` list;
the deletion is the operator's. Never report an exit code captured with `$?` after a pipe: it is
the last stage's status, so a `| tail -8` before it makes every reported code the tail's.

Foreground waits are at most 60 seconds. For longer work, start one background monitor that exits
on the real condition and poll in bounded intervals rather than stacking sleep-and-tail calls. When
a watch is under 30 minutes, check every 290 s instead of holding a monitor open: it is cheaper.

**Simplify.** Use ponytail while authoring, and run `bun run lint -- --strict` and `bun run simplify` (the
deterministic census, `tools/oxlint/simplify-census.ts`) during the work, not only at the end;
then `/simplify` on the finished diff. A mis-targeted finding from either is a reason to tune that
rule's source more precisely, as rule 8 says, never to switch it off. Prefer removing
unneeded work, existing code, stdlib or native features, installed dependencies, then minimum new
code. Preserve trust validation, data-loss handling, security, accessibility and requested
behaviour. Reuse the focused checks and ordinary gate. If no useful cut remains, say "already the
smallest honest form".

### Where changes go

Surrounding files go directly to main: `README.md`, `AGENTS.md`, `docs/**` and
`.claude/**/*.md`. These are exactly the paths the pre-push hook excludes when deciding a
documentation-only push, which then runs `git diff --check` alone. **Skill and helper scripts are
not in that set**: a `.ts`, `.mjs` or `.py` under `.claude/` needs focused checks and source
delivery, and no composed gate reaches one — `bun run test` skips `.claude/` during discovery and
`bun run lint` lists only `src tools vendor starters test packages`, so run `bun test` from the
script's own directory and read the count. Documents describing source absent from main stay with that source. Everything under
`src/`, `tools/` and `vendor/` is source regardless of file type.

Production code and its tests follow the latest intended PR stack published on GitHub: fetch and
verify its parent chain, then use that composed head as the working baseline. Main alone is not the
current production-development state while that stack is open. "Add stacked PR" means use or rebase
onto the latest stack head. Independent non-production tooling may go directly to main.

When a PR worktree overlaps another session, create an isolated branch from the PR's published head
rather than editing that worktree: `scripts/worktree.sh pr <number> <absolute-dir>` fetches
that head and puts it on a unique branch, leaving the other session's tree alone. After the upstream PR settles, refresh, rebase onto it, prove
containment and push to the PR's actual source branch.

For a stack, write down `parent head → child head` for every edge, compose from the first stale
edge and propagate through the later children in order. If the bottom PR lacks current main, every
descendant is behind main through inherited ancestry, even when the internal edges pass — though
surrounding-only main changes do not require a source restack. Name the first stale edge and the
full affected suffix. After its required checks pass, push a small isolated fix directly to the
open PR whose source it corrects; do not open another PR to repair an unmerged one. When a review
finds defects across several stacked PRs, append each fix to the PR it corrects, then recompose the
children bottom-up with one `Compose PR #<child> on repaired PR #<parent>` merge per edge (operator
decision 2026-09-05). Compose on a detached HEAD so branches checked out elsewhere are undisturbed,
then push the composed heads in one atomic push. `stack-hop`'s
[publication procedure](.claude/skills/stack-hop/references/stack-publication.md) owns delivery:
run affected focused checks, then publish related heads through one push and one full gate from the
clean top. Land a stack on main through GitHub, merging each PR into its own base bottom-up, so every PR ends Merged rather than
closed; a local `--no-ff` merge pushed to `main` leaves the PR open (2026-09-21, 98 PRs). A passing top proves that checkpoint; an intermediate head needs its own gate before
independent merge, adoption or paid launch. Keep hooks and required CI enabled.

"At PR48 state" or "at stacked PR45" means the newest improvement level including later fixes;
"the diff of PR #48" selects that PR alone. Ask which head when two branches carry the named work.

### Subagent sessions

Honour the user's requested concurrency up to 200; launch all requested lanes together without
imposing a lower cap or batching unless asked. Launch parallel subagents directly from the current
session in one message, one bounded task each — no coordinator, no further delegation. Each prompt
names authority, exact paths and revision, observed facts, the question and the required output.
State read-only unless the operator requested changes.

Transport is owned by `.claude/skills/codex-luna-swarm/SKILL.md`; read it for the current route,
which changes when a provider's allowance does. Session reports are research, not evidence: check
any required finding against the source before acting on it. A report whose author cannot be
established is unattributed research.

### Writing style

Plain, understated European English in commits, PRs, comments and operator messages. State what
changed and what remains, supported by exact results: "12 cases passed, 0 failed". Avoid Silicon
Valley language and unsupported claims such as "bulletproof", "robust" or "10x"; no celebration,
emoji or exclamation marks. Explain rules with small examples. Prefer "one owner instead of five"
to negative-first contrasts. Make routine minor changes directly; raise only decisions the operator
must make.

Several operator terms cover more than one system — resolve them aloud in one clause rather than
silently. "Queries" may mean harness-query probes, review lanes or subagent sessions; "judges" may
mean the in-run Judge slot or the review lanes; "the run" is reserved for the paid full run;
"cycle N" is most likely one cycle of a cycle series. Suffix a `cNN` name with its product.

## Before and during a paid full run

Load each launch procedure from current `origin/main`; PR, stack and historical revisions select
product bytes only. Run deterministic preflight, then the launcher in the same turn regardless of
the diagnostic result. A time cap is the soft `--stop-after-ms` boundary: the round in flight
finishes and records before the stop.

Omit `--project` for a fresh project unless the user asks to continue a named one. Paid runs have
no round ceiling: continue until a typed terminal, exhausted budget, required user input or a
direct stop. "Proof run", "one epoch" and "at least one" set minimum coverage.

The launching agent owns findings through closure and makes the first controller attempt before
fixing anything. Fix true positives at their source and relaunch fresh; fix false-positive
preflights with the nearest hostile test. Report every controller- or provider-started attempt as
spent, including unsuccessful ones.

```text
bun run fullrun -- --prompt "<request>" --provider-turn-budget N [--project <id>]
  [--context <path> ...] [--expected-source <commit>:<digest>] [--run <runId>]
  [--max-iterations N] [--stop-after-ms N] [--max-builder-turns N] [--expected-tasks N]
  [--iteration-budget N|none] [--product-policy fixed] [--dcg true|false]
  [--builder-backend <kind>] [--built-backend <kind>] [--review-backend <kind|disabled|inherit>]
```

`--provider-turn-budget` is **required**; the run refuses to start without an explicit positive
value. `tools/fullrun-launchd.zsh` (macOS) and `tools/fullrun-systemd.sh` (Linux) start a run
detached through `env -i` from one frozen environment map with absolute `HOME`, `CODEX_HOME`,
`TMPDIR` and `PATH`.

Before launch:

1. Resolve the source revision, stack head, Bun 1.4.2, backend/model/effort pins and provider
   route, and record them in the opening evidence.
2. Prove every stack edge contains its latest parent and run the composed deterministic gate.
3. Check Builder and review logins and the model catalogue. The Builder discovers and installs
   tools in-session: require neither a pre-measured tool catalogue nor a scripted native call
   before authoring. Before battery spend, check Built credentials, the required OS wall and the
   verifier profile. A failed preflight is an environment non-result.
4. Before battery spend, require a build-admissible candidate: task conformance, executed
   task-bound controls, full-task solvability, representation coverage, bundle identity and
   isolation evidence green.
5. Write one falsifiable prediction for the moved variable. For a task-only experiment, name the
   fixed harness, the changed families, the prior pass count, the expected direction and the
   conditions left untested. Freeze predictions against the resolved composed SHA *before* the
   opening; a row Git merely dates is not a prediction.
6. Use one operator-supplied one-line prompt.

After the run, read opening, terminal, case records, claims, verified traces and source identity
before Builder prose or session synthesis. Resolve predictions as `sufficed`, `partial`, `refuted`
or `untriggered`. Give each valid defect one owner and choose one probe, fresh build or stop; keep
the next comparison to one variable. Order batteries by claim `createdAt`; refuse a before/after
difficulty reading without chronology and the required task-set identity.
