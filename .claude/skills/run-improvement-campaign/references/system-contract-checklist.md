# Contract catalogue and historical migration

This catalogue records the checklist's migration and source checks at the revisions named below.
Those checks must be repeated before treating a row as current. In particular, the present
Builder-led experiment and check-program contract supersede parts of the older climb and engine
descriptions. Preserve the historical rows as evidence of that review, not as today's requirements.
This is not a campaign score. The campaign record in `run-improvement-campaign/SKILL.md` applies these facts
to one campaign, repeating candidate, battery and event blocks under exact identities. The
whole-run review sessions in `whole-run-investigation` review an active or completed run and consume
the relevant campaign rows; they do not replace this current-system audit.

## Count decision

Do not preserve 40 as the maintained count. Preserve the historical IDs as the migration ledger
below. The maintained campaign template now has 55 standing fact types (the guard event went with
the Progress Guard on 2026-09-04):

| Layer | Standing fact types | Why it is separate |
|---|---:|---|
| fixed campaign identity | 12 | request, source, runtime and measurement identities have different owners and equality rules |
| candidate | 11 | static task, tool, control and verifier contracts no longer share one state |
| measured battery | 7 | measurement identity, partition, truth ownership, review, claim and readiness settle independently |
| conditional event | 7 | rebuild, deletion, climb, non-result, promotion, interruption and later proof occur only when triggered |
| prediction | 13 | frozen operator predictions, diagnostic retirement/backtrack and recurring generalisation checks are retained without pretending they are product evidence |
| close and procedure | 5 | closure, projection agreement and procedure receipts remain distinct |

The candidate and battery block-state rows make 57 state rows in the template. In a real campaign
those two blocks repeat. This is not a completion denominator.

The added prediction fact `P16` is the diagnostic-retirement/backtrack record: when a hypothesis,
safeguard or proposed fix is retired or refuted, preserve its frozen evidence identity, successor
or `consumedBy` link, affected dependent work and the route that can reopen or backtrack it. This is
an advisory continuity fact for the campaign/meta layer; WRI may point to it but does not own its
execution, retirement or promotion.

## Climb-review source readiness

These are source-readiness Booleans about the current system, not campaign evidence states. Flip
one to `true` only when the named witness exists at the reviewed source revision. Each row is owned
by one whole-run review session. Who flips which row: the history-feeding machinery flips CL-A and
CL-C; the public comparison packet flips CL-E — its source-readiness meaning is "the review
machinery can supply consecutive public task sets, their notes, and their task-set hashes to
lane 20". The readout rows and their live consumer (`readClimbReadout`, `readClimbBatteries`) are
read by the primary's `climb` lane, which is a deterministic reader rather than a readiness row.

| ID | Ready at reviewed source? | Required witness | Owner |
|---|---|---|---|
| CL-A | true | recorded one-line difficulty note per frozen climb/descend-authored task set | lane 20 |
| CL-C | true | history-to-prompt binding (climb readout + last-two-battery projection reaches the successor authoring prompt) | lane 10 |
| CL-E | true | comparable on-note consecutive task sets suppliable to lane 20 (public task sets, notes, task-set hashes) | lane 20 |

Reviewed source revision for the three `true` rows: published stack successor #361 at
`f04c86852435a0eb2c47c024761e99140fdfbf0e`. The difficulty-note writer and ledger consumer are in
`src/author/task-battery-session.ts`, `src/run/climb-history.ts`,
`src/run/climb-ledger-note.ts` and `src/run/full-run-round.ts` (since 2026-09-21 `src/run/climb-readout.ts`
and `src/run/climb-readout-frame.ts` replace the note writers); current WRI supplies lane 20's public
comparison. The product-side CL-A and CL-C witnesses were rechecked in the separate clean
composed product tree at `4719798ca8b7ecd01779b2a4cfcbb630f8217808`; CL-E remains supplied by
this WRI procedure and binds its comparison to those product task-set identities. Another revision
must be checked for these witnesses directly. Ancestry from an older proven commit is useful
provenance, not a substitute for the live producer and consumer.

## Stacked-source compatibility recorded on 2026-08-25

The catalogue travels on main, so it must not pretend that an unmerged source change is universal.
Record the exact reviewed source first, then apply these conditional joins. The published stack state
checked on 2026-08-25 is #361 at `f04c86852435a0eb2c47c024761e99140fdfbf0e`;
#360 is the latest product-changing parent and #361 changes shared test fixtures only.
The separately composed product tree checked the same day is the clean descendant
`4719798ca8b7ecd01779b2a4cfcbb630f8217808`, which includes the zero-row metrics change at
`8d7f1d6df36311443e425f573dfcd03d68deec89`. It shares ancestor
`73cd256e64b8335bf7d51d06585430cf3eddc7c5` with #361 but does not descend from #361, so its rows
below apply only to a source that descends from their exact composed commits.

| Stack change | Present when | Checklist home | Required interpretation |
|---|---|---|---|
| #357 deletes four files with no live invoker | the reviewed source descends from `94a5a8700d2d15316667cc5485e987d4c9f71f03` | source/reference audit only | Do not require `rss-sample.ts`, `stale-pattern-audit.ts`, `claude-islands.test.js` or `transfer-ui.tsv`; a surviving reference must name a different live owner or fail. |
| #358 records the run driver's battery slice | the reviewed source descends from `6b43ed07babf35f8789270e03111dc0de8c10bd4` | M2; deterministic row G | `readBatterySlice` consumes `recordedEvidence(runDir, "battery.json")`. Rewritten bytes refuse before they enter the campaign record. Earlier sources lack this consumer join and must record that limit rather than borrow the later proof. |
| #359 gives path containment one owner | the reviewed source descends from `2074c15d21e7ade44ab487d7cd931b72f09bf97b` | M1; deterministic row H | Host paths use `containsPath`; wall-profile paths use `posixContainsPath`. Callers still own resolution/realpath and live isolation evidence. Helper presence or `meta-path.test.ts` alone is not a wall proof. |
| #360 gives build and climb iteration decoration one owner | the reviewed source descends from `1276355770902386dc1465224697e383bff21894` | C2; lanes 14 and 10 | Build and climb must derive source, routed owner, workspace change, first-iteration lineage and diagnosis provenance through the shared campaign-evidence owner. A resumed carried-memory pass remains `in-campaign-carry`; do not infer provenance from loop position or a missing routed owner. |
| #361 extracts shared test fixtures | the reviewed source descends from `f04c86852435a0eb2c47c024761e99140fdfbf0e` | source/reference audit only | This successor changes test helpers, not product evidence semantics. Do not claim a new run capability or checklist fact from its green tests alone. |
| candidate/controller-terminal successor | the reviewed source descends from original `26ec737f74ba8754e91fa7316c359bd0453fa56d` or composed `e3890b7f71fbf0ed92b8a9962c1d880758c6e619` | lanes 24 and 25; deterministic submit-stall verdict | `builder-execution/v4` separates real candidate submissions from controller-terminal events. A real candidate may itself be terminal. Legacy v1–v3 readers use the exact budget-sentinel compatibility rule; they must not drop every terminal row. |
| durable-budget-boundary successor | the reviewed source descends from original `7b289b4bc4ea373648262007c26cd8d8a800b979` or composed `7c64d4a3f0712e16cbce7058c3c0f3a6830586dd` | fixed budget identity; lanes 24 and 25 | `--iteration-budget` is the epoch-spanning authoring/session-call cap, bound under the campaign lock before controller opening. On the composed source, each admitted provider/model call reserves one unit before transport and journals a before/after witness. `--max-iterations` remains the outer-controller cap for one invocation; Builder turn and wall caps are separate. |
| candidate-kind and execution-reader successor | the reviewed source descends from original `408fdcb8edb9752cc5a10fff82b502b5218f6eac` or composed `f6f48666799c0fc6b51c124b47acfd6b88e4ab63` | lane 24; builder tool-usage projection | Current v4 submit rows require a valid explicit kind. The composed reader enumerates every bare/numbered session first and reports gaps, duplicates, malformed JSON and invalid records as unavailable while retaining later valid sessions. Tool-usage and scorecard projections keep raw events, real candidates and controller terminals separate. |
| unresolved budget-lease hold | the reviewed source descends from `34eba00b41eac468c09d5e2768a7aaec02bfc41c` | fixed budget identity; lanes 24 and 25 | A live, malformed, foreign-host or unrecovered `.budget-attempt.lock` blocks both another attempt and a cap mutation. Only a proved-dead same-host holder can be recovered against its before/after witness; a committed reservation is never refunded. |
| run-bound observational safeguards | the reviewed source descends from `05c48ccd83a451fefd07a5695c4e5ca6b54b8888` | safeguard reconciliation; lane 25 | Runtime safeguards write one bounded line to stderr and `safeguards/<runId>/SAFEGUARDS_LOG.txt` through an explicit run context. Logging failure and firing do not change the watched return, throw, case kind, score or route. A missing log is inconclusive. |
| candidate-engine provenance and read-root attestation | the reviewed source descends from `6722808755e51071c292a736bafed301feea5145` | M6; deterministic row H; lane 6 | Candidate engine admission pins host command, identity and declared read-root content, but `registrySource: "admitted"` remains Builder-authored provenance. Unresolved command, file or sandbox-read-root digests block the corresponding claim; execution alone does not create independent authority. |
| per-control census receipts | the reviewed source descends from `dfd7e9c41d896a7ce9ddd2d7cbf08d7b63837fe0` | C6; deterministic row E; lanes 6 and 7 | The census persists exactly one `control-receipt/v1` per declared control. External/differential receipts bind their primary attempt to recorded host evidence by request, source, engine, check, subject, attempt, phase and outcome; hidden controls retain the complete with/without pair. Missing, extra, duplicate or foreign rows refuse. |
| frozen launchd environment | the reviewed source descends from `d060dcf672e889238a3c2faf6948213651b91980` | preparation/runtime identity; lane 25 | The launcher refuses duplicate launcher arguments and environment keys, requires one absolute `HOME` and `PATH`, resolves Bun through that frozen path, and starts `/usr/bin/env -i` with one plist element per byte-preserved argument. This proves construction only unless a run receipt binds the invocation. |
| evidence-bound promotion recovery | the reviewed source descends from `5e1fcd5e81d62136374be38905ec0511cbe1d9b4` | promotion event; deterministic row B; lane 25 | `ana-install-journal/v2` validates canonical paths, candidate fingerprint, promoted evidence identity/digest and the admission pointer before finalising. Ambiguous, foreign, held, drifted or conflicting states preserve the journal and refuse instead of publishing or guessing rollback. |
| controller battery-record join | the reviewed source descends from `7418f9c9146e6216a90efc9fcb4b4d29a715e988` | M2; deterministic row G | A v2 terminal re-reads every admitted battery through `readBatteryJoinSlice`, binds its recorded count to case rows and accepts zero rows only for `skipped-precase`. A missing battery record behind surviving rows, a count mismatch or another zero-row disposition refuses. |
| admitted zero-row metrics projection | the reviewed source descends from `8d7f1d6df36311443e425f573dfcd03d68deec89` | M2; deterministic row G | The default outcome view seeds batteries from the validated terminal admission list before adding case rows. A recorded skip appears as one zero-case battery with null rate/Wilson; an absent controller remains battery-free and a sibling's later rows cannot manufacture a battery. |
| claim-time control receipt revalidation | the reviewed source descends from `0f7e9ff6a2bd4e0308384740c91cd1a8a97517a8` | C6; deterministic row E | Live verification and later claim writing both revalidate the recorded control corpus, per-control receipts and safe host invocation projection, then derive attribution aggregates. Missing or created host joins and stored aggregate drift make discrimination unclaimable; process memory and stored summary maps are not a second owner. |

## Status vocabulary

- `keep`: the historical point names a real current decision after precise wording.
- `split`: one historical point joined facts with different owners, triggers or evidence.
- `merge`: several historical points describe one continuity decision.
- `procedure-only`: useful operator discipline with no product pass/fail owner.
- `instrumentation-limit`: the question is legitimate but current evidence cannot decide it.
- `obsolete`: the mechanism no longer exists and must not remain a requirement.

## Historical 40-point migration ledger

Each legacy ID appears exactly once. `Current home` names the maintained campaign row or
preparation record. `Lane` names the current whole-run review lane that can inspect the
corresponding run evidence; `—` means it is not a run-evidence decision. Current deterministic
rows are `A–I` and the current semantic lanes are the twenty-eight in
`whole-run-investigation/references/review-angles.md`. There is no number map back to the retired
angle numbers: the twelve former angles that kept a direct successor were renumbered when the
catalogue was rewritten, the rest are carried by mechanism under whichever lane owns the question
today, and a `Lane` cell below names that lane by its current number.

| Legacy ID | 2026-08-09 finding | Disposition | Current home | Exact correction or limit | Lane |
|---|---|---|---|---|---|
| B1 | unobservable | procedure-only | preparation note | Operator authority, paid-launch count and stop conditions have no joint product evidence. | — |
| B2 | partly correct | split | fixed source identity; fixed runtime identity | Opening binds source commit/digest/dirty state and Bun/executable digest. Run-root and worktree paths remain preparation facts. | A |
| B3 | partly correct | split | fixed project/request identity; context instrumentation note | Opening persists project, origin, run, epoch and `sha256({prompt, contextDigest})`; it has no standalone context digest or typed fresh/continued altitude. | A |
| B4 | partly correct | split | fixed experiment; rebuild event; climb event | Experiment kind, diff-derived owner and task-condition movement are separate. A build or climb need not have a routed owner. | lanes 14, 20 |
| B5 | unobservable | procedure-only | prediction lineage note; P3; X3 | Product evidence still writes no joined frozen-prediction lineage. Preserve it append-only as operator evidence. | lanes 25, 10 |
| B6 | unobservable | procedure-only | P1; P2 | Trigger, effect, falsifier and deciding evidence are useful, but their freeze is an operator digest rather than a run fact. | lanes 25, 10 |
| B7 | ambiguous | split | all fixed identity rows; M1 | Builder, Built, Review, verifier, thresholds, policy, task count and budget do not simply “match”; record each value and its actual equality rule. | A, H |
| B8 | partly correct | split | fixed source/runtime identity; preparation note | Deterministic runtime, source, provider and lock checks are real. Freshness, launch authority and paid count are not one durable no-turn result. | A, lane 25 |
| B9 | partly correct | procedure-only | validator plus repeated block identities | The validator checks structure, states and citation shape, not fresh-copy provenance or semantic identity joins. | — |
| B10 | partly correct | keep | fixed project identity; opening/registry evidence | Existing project state is observable. A complete typed provider-start boundary and paid-launch counter are not. | A |
| C1 | correct only when triggered | keep | C1 | Fresh bootstrap commits the starter before authoring; a resumed workspace is `N/A`. | C, G |
| C2 | unobservable | instrumentation-limit | native-read instrumentation note | Normal Claude and Codex native reads do not prove that `STARTER.md` was the first workspace read. | B, C |
| C3 | obsolete | obsolete | replaced by C3a-C3d | There is one persistent Builder authoring session. `harness-brief-session.ts` parses kickoff data; it is not a distinct settling session. | D |
| C4 | correct only when triggered | split | C3a; C6 | Exact task count has a static check and a post-fingerprint gate check. | D, E |
| C5 | correct only when triggered | split | C3b; C4 | Tool-specification validity and runtime implementation conformance are different decisions. | D, G |
| C6 | partly correct | split | C3c; C6 | Static corpus validity, executed discrimination and census verdict are separate. `census.json` has no per-control execution rows or direct task-set hash. | E, lanes 6, 7 |
| C7 | ambiguous | split | C3d; C6; C7 | Static verifier wiring, live control discrimination and F2 solvability settle independently. The host verifier/verifier alone owns truth. | F, lanes 6, 7, 1 |
| C8 | correct only when triggered | keep | C4 | `tool-conformance/v4` decides implementation only after the probe runs. Absence remains pending or a typed non-result. | D, G |
| C9 | partly correct | keep | C5 | Fingerprint owns agent, correctnessModel and task-set hashes only. The task-set digest currently concatenates tasks and controls with newline separators rather than length framing. | E |
| C10 | partly correct | merge | C1; C2 | Controller and refused-submit commits may sit between the starter root and first completed candidate; bind the actual base. | C |
| C11 | correct only when triggered | merge | C2; rebuild event | A later rebuild must join predecessor child to later base. No rebuild is `N/A`. | C, lane 14 |
| C12 | partly correct | keep | candidate block identity; validator | Ordinal and commit fields exist. The validator checks citation shape but does not prove the semantic ordinal/commit join. | C |
| C13 | correct only when triggered | merge | C2; deletion event | Continuity and deletion are one committed-tree check; deletion also requires absence from the child tree. | C, lane 14 |
| C14 | partly correct | split | C5; M1; worker-close evidence | Fingerprint owns three hashes. Source, runtime, isolation, policy and worker-close facts live in other evidence and must not be attributed to it. | E, H, lane 22 |
| M1 | correct only when triggered | keep | C7 | F2 exists only after the gate is reached; an earlier block is pending, not failed. | F |
| M2 | partly correct | split | C6; C8 | Control census and adoption have different owners and no combined verdict. | E, lane 24 |
| M3 | partly correct | split | M1; credential instrumentation note | Provider/model/runtime/policy identities are available. OAuth or credential-file path is not a standard case field. | A, H |
| M4 | partly correct | keep | M2; M3 | Normal producers form the four-way partition, but the current JSON boundary accepts any string as a non-result kind unless the caller checks the shared closed set. | lane 25 |
| M5 | correct only when triggered | keep | M4 | Judge 1 has typed valid/invalid/incomplete/off/unavailable states; only complete control-valid evidence can pass. | lane 16 |
| M6 | obsolete | obsolete | — | The component was the Repair Engineer, removed on 2026-09-04 with the repair experiment. Its replacement, the deterministic rebuild advice packet, is derived from recorded case rows and has no diagnosis-coverage denominator to record. | lane 25 |
| M7 | partly correct | split | M6; M7; C8; promotion event; X1 | Claim/refusal, readiness, adoption, promotion and terminal each have an independent trigger and owner. | lanes 24, 25 |
| M8 | partly correct | split | rebuild event; climb event | A rebuild reopens the harness and is measured as a build; climb freezes the harness and changes only the task difficulty level. `census.json` does not directly join the task-set identity. | lanes 14, 20 |
| M9 | partly correct | keep | M2; M3; typed non-result event | Host case evidence owns truth and denominators. Reject an unknown non-result kind at review because the JSON parser alone does not. | lane 25 |
| X1 | partly correct | split | X1; X2 | Typed closure and cross-projection identity agreement are separate. Snapshot command completion does not prove semantic schema/digest agreement. | A, lane 25 |
| X2 | unobservable | procedure-only | P1-P3; X3 | Frozen prediction resolution remains operator-maintained; current run evidence has no complete lineage join. | lanes 25, 10 |
| X3 | partly correct | split | X2; operator learning note | The scorecard is a diagnostic projection. Skill learning is prose and cannot be a product pass. | A, lane 25 |
| X4 | unobservable | procedure-only | X4 | Git diff is observable; positive/hostile commands, gate result and checkpoint are operator receipts. | lane 25 |
| X5 | partly correct | procedure-only | X5 | A zip review is advisory and has no product authority. It is `N/A` when authoring never reaches the required terminal/commit boundary. | lane 25 |
| X6 | partly correct | split | rebuild event; post-run fix event | Diff-derived owner attribution and later live trigger proof are separate; the selected owner label is advisory when it disagrees with the diff. | lanes 14, 25 |
| X7 | unobservable | procedure-only | X1 plus operator closing note | Terminal and budget facts are deterministic. Goal status, fruitful learning and “safe work remains” are operator judgements. | lane 25 |

## What remains in force

The load-bearing product checks remain: exact identities; committed workspace continuity; static
bundle contracts; tool conformance; fingerprint, controls and F2; recorded measurement identity;
the complete case partition; host-owned truth and typed non-results; advisory review status;
claim/refusal and readiness; promotion; typed closure; and fresh-run proof for a later fix.

Operator authority, prediction freezing, command receipts, archive review and goal judgement still
matter as procedure. They must be labelled as such. Native first-read order and credential-source
path remain explicit instrumentation limits. The old distinct brief session is the one claim that
no longer describes the system at all.
