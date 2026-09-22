---
name: whole-run-investigation
description: "Investigate a live, stalled or completed Anabasis run and turn findings into an evidence-bound fix proposal. Also answers whether a campaign is climbing: how the climb is going, whether the batteries are getting harder, why a difficulty decision keeps repeating, how to climb faster. Reads evidence; does not launch the next experiment."
---

# Whole-Run Investigation

Explain what the run produced, where useful work stopped, and which change the evidence supports.

## The order

**The deterministic read comes first, always, and it chooses the rest.** Eleven local readers cost
nothing but compute, and between them they already name the run's size, its three denominators,
what moved between batteries, which of its own budgets bound it, what each slot was doing and what
the digest flagged. A paid lane opened before that read spends on a question the read would have
answered, or would at least have sharpened, for free. The order was the other way round until
2026-09-19, and it launched thirty-six lanes at a run nobody had looked at.

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs lanes
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs read <runId | campaign dir> \
  --out <absolute review dir> [--all | --lanes 5,yield] [--repo <abs>]
```

With no `--lanes`, `read` sizes the run from its own recorded bytes and reads what that size earns.
Every lane's output is captured to `<review>/<lane>.txt` and the command prints one bounded brief
instead: the run's size and terminal, each lane quoted whole or pointed at, then the digest triggers
and scan findings the snapshot lane raised. **Read the brief, not the lane files** — the whole read
is the size of a paid lane's context — and open a lane file when the brief has made that lane the
question. `wri.mjs brief --out <review>` re-renders it later.

| tier | the run | lanes | semantic lanes to start from |
| --- | --- | --- | --- |
| `probe` | under two hours, or no case has scored yet | the five that read campaign bytes alone | 2 |
| `standard` | a scored battery, under twelve hours and under three epochs | all eleven | 4 |
| `deep` | twelve hours or more, three epochs or more, or three batteries | all eleven | 8 |

The tier is a default and not a gate. `--lanes` and `--all` still select whatever is asked for, a
run the operator calls important earns the lanes its questions need rather than the ones its clock
earns, and the count is where to start rather than a quota to fill. `probe` withholds only the six
lanes that open the measured checkout or an archive, because a battery that scored nothing gives
them nothing to read.

## Choose the lanes the read argued for

Name each semantic lane against a row of the brief: the trigger, the question it settles and the
decision it could change. A lane with no such row is a lane spent on inventory. Take the tier's
count as the opening number and move it for what the brief actually found — a `deep` run whose
brief is quiet earns fewer, and a `standard` run holding one unexplained mechanism may earn more.

Keep at most two whole-run reviews active at once across runs and conditions. A review includes its
Luna sweep and parent deterministic checks; queue further reviews together with both parts. This
limit counts reviewed runs, not the independent lanes within a review (operator decision
2026-09-09). **With several runs to review, finish one before starting the next**: read it, launch
its lanes, then turn to the second. Two half-read runs share one reader's attention and neither
brief gets used.

Read the [question index](CHECKLIST.md) to identify uncertainty, then the
[session index](references/session-index.md) for relevant methods. Load
[core angle bodies](references/review-angles.md) and
[boundary angle bodies](references/review-angles-boundaries.md) only for admitted work; full mode
reads both. These are views of one review, not checklists to complete repeatedly. Targeted work
records considered questions and material omissions. Broad work adds consequential independent
challenges. Full work covers A–I, eight digest verdicts, all 36 numbered angles and both diagnostic
lanes, plus deterministic session 30 when source-ready. Record an inactive lane's result explicitly.
That full sweep is 38 independent semantic sessions before any warranted intelligence or reference
challenge, which is what "all" costs; it is the ceiling, not the default.

Honour an explicit supported model, effort and grouping override through the matching transport.
One independent `gpt-5.6-luna` session at `max` per lane remains the shape of a lane. Keep
deterministic rows with the primary.

## Launch the lanes

With the lanes chosen, `launch` opens exactly those and nothing else:

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs launch \
  --out <absolute review dir> --sessions 4,7,9 --effort max --title <t>
```

`review` is the "all" path, for a run the operator asked to sweep whole: it reads every
deterministic lane, prints the brief and then launches the full sweep — collection, the angle-15
packet, the source delta, the run overview and the detached Luna launch (36 angles plus both
diagnostic lanes, `max`). It prints the brief before it spends, but it does not wait for a reader
to use it, so reach for it only when the answer is already "every lane":

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs review \
  --campaign <absolute campaign dir> --run <runId> --repo <measured-source checkout> --out <absolute review dir>
```

Watch `<review>/lanes/luna-output/summary.json`; when it exists, run `wri.mjs finish --out <review>`.
`finish` validates the reports, scaffolds `archive/` (luna_syntheses.md and digest.md from bytes,
review.json from bytes plus `verdicts.json`, a main_synthesis.md skeleton written once) and runs
the archive validator. The first `finish` writes the `verdicts.json` template; record the states
and reasons there, write main_synthesis.md, and run `finish` again until the archive is valid.
Safeguard rows count firings from the run's `SAFEGUARDS_LOG.txt` and from the launcher stderr named
in `verdicts.safeguards.stderrLog`; with neither file the count is unavailable, never zero. A
`not-fired` row and a complete reconciliation need `verdicts.safeguards.reconciliation`: copy
`safeguardEvidence` from the generated review.json into it with `t0`, `t1` and a reason, so the
adjudication is bound to those exact source, log and stderr bytes and any later change invalidates
it. An independent review appears only from `verdicts.safeguards.independentReviews[<id>]` with a
reason, and a route (`routed`, `held` or `not-routed`) only from `verdicts.safeguards.routes[<id>]`
with a reason; a count proves a firing, not that its owner received it, so a route without that
record is `inconclusive`. Until then the validator refuses the archive rather than reading it as
covered.

Use `wri.mjs collect` then `wri.mjs launch` only when the lanes need direction: `collect` writes
`<review>/overview.json` from recorded bytes (terminal, denominator, budget, versions, task set,
grouped digest triggers, scan findings, census selection) and `<review>/shared-instructions.json`,
the file the primary edits: a `template` of lines carrying `{placeholder}` tokens and a `values`
map filled from the overview. Every lane reads the rendered template as `## Run overview`. Edit
any value, add a value and its token, reorder or drop template lines, and fill the two authored
values `orientation` and `movedVariable` before `launch`; a token without a value refuses the
launch and a line whose value is empty is dropped.
`launch` takes `--lanes N` or `--sessions <spec>`, `--effort`, `--title`, `--notes`, `--context`.
The sections below describe what these commands run, for a manual or partial procedure.

## Bind the run and collect facts

Read `controller/<runId>/opening.json`. Record the full `source.commit`, its first nine hex
characters, request, model slots and dirty disclosure. Inspect that exact source; a missing Git
object is `source-unresolved`. Keep the review procedure's revision separate. Current source
explains an older run only through an ancestry and changed-path check.

One command collects every deterministic view. Point it at the campaign folder or at one
`controller/<runId>` folder; nothing else is required:

```text
bun run review:collect -- <campaign dir | campaign/controller/<runId>>
```

It names the run (the folder's own, or the campaign's latest opening; `--run` selects another),
finds a clean checkout at the run's recorded source commit (the current directory, any worktree of
this repository, or a detached worktree it prepares once under `~/.cache/hb4/wri-source`) and
writes the snapshot under `~/.cache/hb4/wri/<runId>` (`--out` overrides). It prints the run, the
checkout and the snapshot path first. Do not write further collection scripts: a missing view is
reported inside `snapshot-status.json`, and a new deterministic question belongs in
`trace-review.mjs` as another view. The alias calls `trace-review.mjs`; `--all` is the default
standard collection, not all runs or every optional probe. `--help` lists its scope. It makes no
model calls. The private angle-15 packet and reference probes keep their own admission; do not run
model-backed work under a deterministic label. `--diagnostics` also prepares the two native lane
prompts under `<snapshot>/diagnostic-lanes`; omit it for collection alone. Launch those prompts
only within the authorised session budget.

Read `snapshot-status.json`; require `complete: true` and verified view bytes/hashes before
treating the snapshot as complete. Captured errors and unsupported views are unavailable facts.
The manifest builder checks source and snapshot binding again before delegation.

For a run with a predecessor in its lane, also run the source-delta reader; it prints paths and
counts only, never source text:

```text
bun --no-env-file <review-checkout>/.claude/skills/whole-run-investigation/scripts/source-delta.mjs \
  --campaign <absolute campaign dir> --run <runId> --repo <measured-source checkout> \
  [--previous <commit | absolute earlier campaign dir>] [--out <absolute file>]
```

For a run whose lane has an earlier archive under `notes/runs`, run the recurrence reader on the
archive once it is written (states and run ids only, no reason text):

```text
bun --no-env-file <review-checkout>/.claude/skills/whole-run-investigation/scripts/finding-recurrence.mjs \
  --current <absolute notes/runs/<this archive>> --archives <absolute notes/runs> [--lane <key>] [--out <absolute file>]
```

## Make every diagnostic reach a decision

Collection and triage are separate. A clean command exit proves a readable report, not a clean
run. The manifest lists every view's status and triage owner. The primary keeps identities,
denominators, digest and product evolution, and all views without a launched specialist.
Use the two diagnostic lanes below for their distinct questions; sharing a view with the primary
is intentional, but do not ask both to recount it. These named lanes supplement the 36 numbered
angles without renumbering them or merging the isolated angle-15 trace challenge.

| triage owner | inputs to digest | question to settle |
|---|---|---|
| Category and hook yield | `timeline.json` | Which mechanisms actually fired, what did the run spend its time on between them, and what did the next eligible consumer do? |
| Diagnostic follow-through | run `scan`, `builder`, `review-yield` | Are the signals faithful to the underlying work and trace construction, and what did the next eligible consumer actually do with them? |
| Primary | all remaining views and both lane reports | Which findings survive reconciliation, which change a decision, and what remains unsupported? |

Each lane returns a disposition for **every** assigned input: `investigate`, `no-action` or
`unobservable`, with reason and evidence. The report collector refuses omissions and duplicate
input rows; it does not judge their truth. The primary retains these dispositions and covers its
own views in `main_synthesis.md`, grouping related views only when every label is named. Do not
pick two striking numbers and silently drop the other inputs. Read each input, then spend deeper
investigation on at most two distinct consequential mechanisms per lane. A normal successful
example and the nearest failed, absent or censored example test whether a signal describes the
work, a capture limitation or a mistaken assumption. A new contradiction can justify expanding
that bound; say what decision the extra work can change.

An `investigate` disposition must end with a supported explanation, a named unresolved question
and next discriminator, or a proposed change and owner. `no-action` needs a reason from the
contents, such as no eligible opportunity or an upheld safeguard, rather than "script passed".
Missing or legacy-inapplicable inputs stay `unobservable`. Retain useful behaviour as well as
defects; counts and review completion never compel a product change.

Read `digest.md`, default outcome view, `--scan`, `harness-evolution.json`'s `quickRead`, and
`review-yield.md` when supported. The digest's blocks 1c, 2b, 3b, 3c, 4c, 4d, 4e and 5b print a
capitalised trigger row when deeper reading is useful. A missing trigger does not settle the
semantic question or remove a lane from full review. Use Builder tool usage and trace telemetry.
Preserve verified, unaccepted and typed non-result denominators. Candidate submissions and
controller-terminal rows are different events; use their recorded kind or source-specific reader.
Missing older fields are instrumentation limits, not zero use or reconstructed intent.

`trace-review.mjs` writes the hashed `timeline.json` view automatically: elapsed time by phase,
the five longest gaps between consecutive rows with the phase and row each sat behind, prompts by
contract and role, every recorded hook activation with its reason, steering by authority and each
settled iteration. Give the category and hook lane this view. It settles use from rows, not from a
source inventory: a zero means no matching recorded row, never proof of an unused hook, and elapsed
time between two rows is what the run took, not where it was blocked. Keep these inventories
separate:

- File categories: use the measured UI's `FileRef.category` and `fileCategory` classifier
  (`packages/ui/src/models.ts` and `server/files.ts` when present). Count unique run-bound
  files and bytes per declared category, including empty categories and unmatched `other`.
  The UI's `all` is a filter, not a category. File presence proves production, not invocation.
- Runtime categories: enumerate the source's observation types, kinds, contracts, phases,
  authority values, hook types and individual hook labels/trigger sites. Keep historical
  `category` fields under their own recorded schema; do not silently rename them into current
  concepts. Source declarations with no emitter or consumer remain visible.
- Execution: group complete, validated observation rows by those dimensions, with hook states
  separate: registered, activated, suppressed, rejected and unknown where that source supports
  them. Include distinct runs, epochs, iterations, cases and sessions, not just repeated events.
  Use source-bound readers and their totals; never derive zero use from a warning-only view,
  a limited UI page, missing files, malformed rows or unsupported telemetry.

Use `tools/outcome/cli.ts <campaign> <runId> --observations`, the digest, review-yield and
tool-usage readers as inputs; inspect their limits and source applicability before aggregating.
Join by recorded IDs and digests, deduplicating shared files/events across batteries. For each
component retain declared/exposed, eligible opportunities, attempts/activations, completed
outputs, failures/refusals, consumed outputs and changed decisions as distinct counts with
their denominator and evidence pointer. Record available latency, tokens and bytes; unsupported
counts stay null with the missing producer/receipt named. Do not infer an opportunity from an
absent event or infer consumption from an existing output. Check successful paths too.
Preserve the reader commands, source identities and input digests with the census; provide it
in the lane's shared instructions or bounded task notes. Keep its safe totals and adjudication
in `main_synthesis.md`, indexed by the existing `review.json` session/evidence pointers.
Do not edit a recorded snapshot digest to insert new counts. No fifth archive file or new product
telemetry is implied. A missing counter becomes a specific finding at its existing owner.

The digest's arithmetic supplies leads, not semantic verdicts. No shipping rejection does not
make a check useless; constant tool sequences do not prove an answer shortcut; file size and
lexical similarity do not decide product value. Settle a flagged public tool by reading its
description, code and relevant traces. Review yield needs an eligible opportunity, output and
consumer; saturation needs the recorded thresholds and the next selected move.

Prose capture integrity belongs to `classifier/prose-classify.mjs`, which verifies the
execution and sidecar joins before it labels anything and returns `integrity-failure` instead of a
posture when they disagree or a capture receipt is missing; embedding-unavailable stays explicit. Do not
reconstruct capture from private provider transcripts or copy raw prose into run prompts or
archives.

`collect` always runs `classifier/prose-classify.mjs <campaign> --run <runId> --json` into the
required `prose-posture` view; it is not a probe to enable. The pinned local BGE-small embedding labels every captured row with the
nearest of thirteen anchored postures (intro, researching, planning, editing, running-checks,
diagnosing, blocked-environment, workaround, disputing-verifier, uncertain, confident, submitting,
reporting-status). A Codex reasoning summary is a run of bold headlines: each headline is
labelled and the last one labels the row, with the whole path in `segmentClasses`. Each candidate
submit then carries the rows since the previous submit, the dominant class, the last five labels
with a short excerpt each, the reaction (rows and dominant class until the next submit),
`repeatsRefusedPosture` when a refused submit shows the same dominant posture as the previous
refused one, and, when `classifier/posture-priors.json` matches the anchor digest, the corpus
refusal rate for that dominant and last label. Rebuild the priors after any anchor change with
`bun classifier/posture-priors.mjs <campaigns-root>`; a stale file is reported, never applied.

Schema `run-prose-posture/v5` reads the whole run, not the authoring half alone. Four things the
earlier views could not say:

- **`solves`** classifies the Built solver's own words. Each case trace's redacted turn previews
  are read only when their bytes match the digest the case record published, and each case's rows
  join to the kind that case record gave it. `byOutcome` puts the posture of verified, unaccepted
  and typed non-result cases side by side; the run's own denominators, not submit refusals.
- **`evidence`** grades each half `sufficient`, `thin` or `empty` against `EVIDENCE_FLOOR`: two
  rows per class, and at most half of them low-margin. A four-row reading and a four-thousand-row
  reading no longer look alike.
- **Sessions the controller closed as a typed non-result contribute no posture.** Their prose is
  the provider's, not the Builder's: run `truss-opus-20260916T151117729Z-064960` captured exactly
  one row in its second epoch, `You've hit your session limit`, which v4 labelled as reasoning.
  Excluded rows are counted, never silently dropped.
- **`checkedSincePrevious`** answers from the execution record whether any `correctness_check`
  returned between a submit and the one before it. The first anchor set carried a
  `claiming-done-without-evidence` class; the tool record settles that question outright, so no
  embedding is asked to guess at it.

Coverage differs by backend: Codex sessions supply reasoning summaries and messages, Claude
sessions supply messages only because the SDK delivers thinking blocks with empty text, so read
the per-kind counts before comparing conditions. A run with no prose on either side records
`no-prose`; only an integrity failure or a failed command leaves the snapshot incomplete. A label
is a lead for explaining an already-observed refusal, stall or case kind, never a score.

For a live review, capture T0 identities, durable liveness checkpoints, active/completed cases and
budget state; label counts partial. Before synthesis capture T1 separately, refresh counts and
retain findings on unchanged bytes. Mark changed-artifact findings stale and revisit affected
questions only. Do not mix later evidence into T0 denominators.

## Admit useful sessions

The primary settles these rows from evidence. A contradiction may justify a directed question;
a clean inventory does not justify another reader.

| Retired Luna session | Deterministic owner |
|---|---|
| A campaign identity | opening, epoch, backend, request and outcome readers |
| B claim and promotion state | claims, claim stages, epoch and promotion receipts |
| C workspace and Git | committed-tree, ancestry, workspaceChange, starter and public-task transitions |
| D static conformance | snapshot and conformance receipts |
| E fingerprint and gate census | byte hashes, iteration identity and census/F2 join |
| F F2 solvability | solvability receipt and shared typed non-result pointer |
| G case partition | the closed case classifier and denominator arithmetic |
| H runtime identity and isolation | recorded identities, policy evidence, trace hashes and worker runtime rows |
| I served-model attestation | digest block 5b: attested, unattested and no-completed-turn identity rows against the Built pin |

Keep the eight digest verdicts with these facts: discrimination-inertness, submit-stall-shape,
evidence-integrity, solver-process, saturation-ledger, check-informativeness (block 1c),
family-wise-coverage (block 3b) and role-spend-and-censoring (block 4c). Record each considered semantic lane's
question, trigger, consequence, identity, evidence, denominator and disposition. Exhaustive work
records every angle; targeted work records the considered subset. Reuse earlier proof only when
its required identities still match.

Deterministic-first angles (2, 11, 13, 14, 16, 18, 23, 24, 25, 26, 28, 31) start from their
digest block or reader. In full review each lane checks what those facts actually settle;
triggers govern omission only in explicitly targeted work. Distinguish a proved absence of
opportunity from missing instruments or incomplete delivery. Read
provider exhaustion the way AGENTS.md does: explicit exhaustion censors a battery and is a normal
R&D interruption, not a defect; a generic 429, timeout or stall is a failure to investigate.
Block 4c and angle 28 carry that distinction into the report.

The following definitions feed `build-manifest.mjs`. Choose the useful question, not a compulsory
sequence of roles. Combine related reading while keeping distinct verdicts.

| session | Activate when | Required result |
|---|---|---|
| **Product validity** | a green battery supports a broader product claim than its instrument can observe; a required subsystem is replaced by a proxy; or the original request, delivered artifact and deciding operation disagree | Build one evidenced chain: original material obligation → accepted artifact bytes → preprocessing/build/link/runtime operation → deciding observation → supported claim. Separate missing requested work, unenforced cross-subsystem relations and limited instruments. Compilation, host simulation, target execution and hardware operation are separate scopes. Test at least one valid alternative and one plausible wrong artifact through the recorded verifier where the instrument is available; otherwise state the exact unobservable property. Reuse Representation's parity result and the frozen findings of 5/6, 36 and 19/20; do not replace those challenges or read their reports before they are frozen. A tool receipt proves invoked bytes and inputs, not semantic independence. Report one owner and the smallest observation that would reverse the conclusion. This session joins the Product execution, Product coupling and Independent user outcome questions in the checklist; it creates no product-model access, new oracle or score authority. |
| **Representation** | schema, writer, submission, roots or check semantics changed, or a parity/materiality finding exists | Trace public schema through writer, DraftStore, accepted bytes and verifier input; exercise relevant branches and the real F2 submission path. Report expressibility/parity separately from whether each claimed material root can change a truth result. Identify decorative roots for their owner without editing the measured bundle. Do not repeat static receipts or oracle-mutation work. |
| **Mechanism** | a consequential failure is unexplained, non-results repeat, or a public tool's suspected answer shortcut remains unsettled | Follow available information/tools → observed choice → feedback → next action → result. Locate the earliest demonstrated broken link and distinguish work, environment and controller explanations. For a suspect tool read its description, implementation and relevant traces. Collapse repeated symptoms into one mechanism, owner and falsifier. |
| **Strictness and yield** | refusals dominate progress, a strictness terminal fires, candidate conditions repeat, or a wall grant/refusal affects the claim | Compare the exact rule with the required work: does it block legitimate work or permit an unsupported claim? Count time/calls and new recorded facts separately. State the earliest defensible stop and what it would leave unknown. Do not infer difficulty from spend or tighten a stop merely because work was slow. |
| **Effect and history** | a changed result/process, ineffective intervention, repeated mechanism or claimed improvement needs attribution | Use settled treatment, outcome and lineage rows. Explain the causal hypothesis, strongest rival and discriminator; join earlier occurrences to the fixing revision and live opportunities. Separate still-demonstrated, fixed-after-run and unexercised changes. Preserve useful mechanisms as well as failed interventions; never alter scores or experiment identity. |
| **Category and hook yield** | a recorded hook or steering row has no explained consumer, eligible but unused behaviour, repeated suppression/rejection, output without consumption, or a new/changed category or hook awaiting its first usage review; also on an explicit category-use review | Reuse verified primary counts; supplement only the missing fact that can change a decision. Before calling an absent file a capture gap, trace the measured writer's scope: a root observer may serve every battery. Join recorded subjects to the exact terminal cases; filename absence and schema-null fields alone do not prove lost events. Trace declaration → opportunity → trigger → output → actual consumer → next action. Give delivery and useful progress separate verdicts: a prompt-linked event proves neither model use nor benefit. For repeated activations compare the first and nearest same-condition repeat using prompt digests and subsequent actions; say what new information, changed work or prevented failure is evidenced. Repeated refusal alone does not make the hook its cause. Distinguish no opportunity, eligible-unused, suppressed-as-designed, rejected/failed, produced-not-consumed, advisory-only and unobservable. Keep a positive or nearest absent/failed control, and bind introduction/change history to eligible run conditions. Return retain, repair, merge, remove or instrument advice with owner, rival and falsifier. Instrument only when the missing fact changes that choice; do not turn unsupported dimensions into a telemetry wishlist. File presence is not invocation; zero use never justifies deleting a rare hook. Safe totals and evidence paths only; no protected payloads or score changes. |
| **Diagnostic follow-through** | the operator asks for diagnostic triage, a collected signal has no explained next action, reports disagree, or trace/usage coverage may distort the apparent behaviour | Read run `scan`, `builder` and `review-yield`; disposition every input, then select at most two mechanisms by the decision they could change. Reuse verified primary facts instead of repeating a whole trace census. An unsupported CLI view is not absent underlying evidence: inspect the existing measured-source Builder/trace reader and bound execution receipts for the relevant field before leaving that question unobservable. State which facts remain recoverable and which do not. Compare relevant epoch, battery and version records with the reader's actual rows before interpreting an empty join or zero. For a consequential aggregate establish its unit, scope and lifetime before arithmetic: tool attempts, completed calls, model turns and cumulative session usage differ; cached tokens and missing usage are not zero spend. Follow a suspect value from backend event through capture, digest-bound reader and projection to its report. For review yield follow output → attachment → recorded consumer → subsequent action → measured effect; an attached digest is not evidence of a repair. Route same-defect repair closure to angle 35 instead of repeating it. Use a normal instance and nearest failed, absent or censored one. If an accurate scan warning changes no decision, close it briefly and spend the deeper pass on the unresolved mechanism. Return the earliest broken link, one owner, rival, falsifier and next action, or a supported no-action result. Restrict campaign-wide yield to the selected run; keep in-run feedback separate from post-run diagnostics. Do not redo angle 15's private challenge, infer intent from counts, expose protected payloads or rescore cases. |

Honour the operator's explicit model, effort and useful session count. Do not fill a count with
repeated inventory; report when distinct questions are unavailable.
[Codex Luna Swarm](../codex-luna-swarm/SKILL.md) owns transport and collection. State actual tool/web
access, not an assumption based on model name. No coordinator or further delegation.

Pairs 5/6, 7/8 and 19/20 stay mutually blind until both return, using independent methods or samples.
Angle 15 runs alone with its private trace packet. Angle 36 runs alone and freezes its public-only
valid-alternative corpus before reading verifier internals or other oracle reports. Grouping is
an explicit override and must preserve these boundaries; it is never the full-review default.
Keep shared orientation and context free of case verdicts, verifier-derived selection hints and
other challengers' conclusions. Aggregate run facts do not replace a public-only validity argument.

Angles 32/33 are boundary questions; 34/35/36 split useful public feedback, same-defect repair and
valid alternatives from 12/9/6 respectively, whose parents retain confidentiality,
routing/delivery and the independent wrong-artifact corpus. Numbers are never reused: a retired
lane keeps its number and reads `no-opportunity`. `scripts/catalogue-shape.mjs` is the one
declaration of the current shape; the manifest, report, compose and archive validators read it,
and the archive validator refuses an archive written under an older shape.

## Reference-comparison sessions

Use a reference where its domain, executable interface and coverage clarify the result; record a
concrete blocker if it is unavailable, and keep comparisons observational when task or verifier
bytes differ. Resolve its actual clean revision; a default path is not proof that it exists.
Use `--reference <absolute dir>` for a verified alternative location of the
intended reference. Do not substitute another product. Reference results remain diagnostic and
protected: no rescoring or model coaching. These reviewers and blind angles 19/20 do not exchange
reports before returning.

| session | Activate when | Required result |
|---|---|---|
| **Reference contract coverage** | a relevant consumer-hardware reference is resolved and its scope can clarify the product gap | Pair harness families, tools and artifact roots with the reference's actual capabilities. Name absent or unmappable obligations. Different wording or shapes for the same fact are not disagreement; report named coverage pairs rather than a percentage. |
| **Reference verdict comparison** | the reference is resolved, verified cases exist and the accepted artifact can be mapped onto the reference's public entry point | Prove the adapter and that the reference observes the property, then execute on cases and controls. Freeze verdicts before reading run results and verifier source; join the 2×2 with explicit denominators. Use all cases up to 25 or a stated stratified sample. Unmapped/unexecuted properties are unobservable, not wrong. Keep either implementation as a possible cause of disagreement. |

This skill ships no adapter. The one it used to ship mapped a single domain's artifact schema
onto one external tree, refused on every other run, and decided nothing here; the session writes
its own mapping against the reference's public entry point instead. Without a working mapping,
record that gap and omit the verdict session; coverage may still help with zero verified cases.
Add `--consumer-hardware` only when admitting a reference session, not merely because the run is
firmware.

## Prepare authorised delegation

Use one procedure revision for this skill, index, angle bodies and manifest parser. Run:

```text
bun .claude/skills/whole-run-investigation/scripts/build-manifest.mjs --list
bun .claude/skills/whole-run-investigation/scripts/build-manifest.mjs \
  --snapshot <absolute dir> --worktree <measured-source checkout> \
  --auto 36 --diagnostics --out <absolute dir> --transport luna --effort max --stress
```

`--diagnostics` prepares the category/hook and diagnostic-follow-through lanes, without launching
them. With `--sessions` or `--auto N` it adds only missing diagnostic lanes; `N` still counts the
numbered-angle groups, so `--auto N --diagnostics` normally prepares `N + 2` sessions. Include
these two seats in the authorised budget. Native transport writes self-contained prompts for
the current session's agents; this flag creates no coordinator or paid launch authority.

The command above prepares the default full review; it launches nothing without `--launch`.
`--diagnostics` alone is an explicit two-lane diagnostic review. `--sessions 4,7,9` selects separate
targeted lanes; `8-9` or `10+16+21` explicitly groups angles. Optional
`--notes <file>` holds `## orientation` (at most twenty lines) and `## <declared-session>`
directions. `--auto <count>` covers every numbered angle, with at least four groups to preserve the
two isolated lanes and blinded pairs; it does not select
intelligence/reference questions. Read `--help` for current flags; old `--lanes` syntax is retired.
`--launch` requires existing model-spend authority.

For angle 15, first run `scripts/trace-challenge.mjs --campaign <absolute dir> --run <runId>
--out <absolute snapshot dir>/trace-challenge`. Verify complete status and telemetry digest, read
the telemetry, and give only that lane the packet. The leaf reads it; it does not rerun the writer.

Shared instructions bind exact identities, verified controller facts, snapshot paths, assignments,
actual tools and read-only authority. Each leaf gets its exact body inline, no whole catalogue,
no scope expansion and no authority to change controller output or touch `.controller.lock`.
Name source-specific outcome commands and existing helpers instead of asking it to recount facts.
Keep deterministic rows and session 30 outside model tasks. Reports need findings, owner, evidence,
denominators, rivals and limits; assigned headings identify coverage, not additional assignments.

The manifest writes shared instructions, WRI `tasks.json` and transport `luna-tasks.json`.
Preserve exact prompts and launch bindings. Collect through the chosen transport, then run
`scripts/validate-reports.mjs --tasks <absolute tasks.json> --summary <absolute summary.json>`.
Require one terminal result per task and valid prompt/report/workdir identities and headings.
A failed or absent report is missing work; one retry is permitted within the authorised cap.
Historical incomplete launch identity stays explicit.

## Deterministic session 30

For exhaustive review check [CL-F](../run-improvement-campaign/references/system-contract-checklist.md#climb-review-source-readiness).
Reconcile the author-facing `readClimbReadout` → `climbReadout` counts (trees before 2026-09-21:
`readClimbBatteries` → `climbLedgerRows`). An older source may have `--climb-economy`; use its own
recorded view when present. Report missing values,
contradictions and digest mismatches. Absent source support is N/A or unobservable, with no
replacement model session. Interpretation stays with the relevant climb angles.

## Did the tasks move

A battery the provider wrecked scores nothing, so the controller re-decides on the last battery
that did score: on `design-lightweight-steel-trusses-3fd52f9e-28` that produced seven consecutive
"24/25, significantly too easy, climb" decisions all citing the same 2026-09-16 battery. Read the
other channel — the task bytes — when a climb's result is unobservable:

```text
bun .claude/skills/whole-run-investigation/scripts/climb-velocity.mjs <campaign dir> [--json]
bun .claude/skills/whole-run-investigation/classifier/query-complexity.mjs <version dir | query pack> [--json]
```

Both task-side rows come from the authored bytes under `versions/`, so an edge is readable the
moment its later candidate is adopted and before a single case of it has been paid for. Run it when
the version directory appears, not when the claim lands.

Two skills consume this: the campaign loop runs it at every read step once a campaign has two edges,
and [run-climb-lab](../run-climb-lab/SKILL.md) owns what to do when its verdict and the controller's
`ClimbAction` disagree — which they do whenever a battery scores well on tasks that did not move.

Per battery it reports the check-tier histogram (easy, medium, hard, frontier, from the same pinned
bge-small embedding `prose-classify.mjs` uses, one unit per check assertion) and a median structural
row counting applicable checks, declared numeric boundaries, public inputs two checks share,
tool-decided checks, cited rule decisions, artifact roots, inputs and the largest scenario list. Per
edge it says `restated`, `adjusted`, `narrowed`, `widened`, `eased` or `escalated`, with the prose
novelty and how far the published numbers moved. Only `escalated` changes what a solver has to
reason about, and it reads the highest tier a battery's checks reach, so more checks at a tier it
already occupies is `widened`; a battery that fell down the tier order is `eased` and one that
dropped checks is `narrowed`, so a retreat is named rather than reported as `adjusted`. `adjusted` alone says the
published numbers moved and not which way: moving a limit inward is a real climb that runs out at
the feasible edge, and the drift reading measures distance only.

Both of those rows read `brief.json` and `tasks.json` alone, so a third row per edge lists which
other `correctness-model/` files changed digest. It scores nothing and moves no verdict: a digest
cannot separate a new requirement from a reformatted comment. It exists because the truss run
published `minMemberJointClearanceM` in `rules.ts` under an existing check, left `evaluator.ts`
byte-identical, and the edge read `novelty 0.0000 … rules +0` — which reads as a renumbering.

`climb-velocity.mjs` renders that whole reading per battery, so there is no second lane over the
same campaign. `query-complexity.mjs` reads an exported query pack as well as a campaign version,
which is what running it directly is for: a battery compares directly against a reference pack. `coupled` reads the granularity its author declared
at, so compare it within one author's campaign and use the check-tier histogram across authors.
Anchor length rises with tier; every call carries its margin, so a reading near the noise floor is
visible. The tiers are leads for an investigator, never a score input.

## Did the budget bind

`agent/config.yaml` is the one file the Builder writes that nothing inspects again after the gate,
so a battery's outcomes get read against budgets nobody has looked at:

```text
bun .claude/skills/whole-run-investigation/scripts/walls.mjs <campaign dir> [--run <runId>] [--json]
```

Per battery it prints the declared solve, turn, shell and concurrency walls, which of them the
bundle moved from the seeded defaults, the median and maximum share of the solve wall the cases
spent, the median and maximum tool calls, and each case classed `time-bound`, `turn-bound`,
`unstarted`, `submitted` or `no-submit`. A case is `unstarted` when it spent under 30 seconds with
no completed turn, which separates a battery the host never got as far as solving from one that
solved and lost. A case short of every wall is reported by what the record says it did — the solve
was accepted as a submission, or it ended without one. Those were one `ended-early` label until
2026-09-19, which no recorded field carried and which read as a cut solve on the 23 of 25
`de8b40-i02` cases that had simply finished; the other 2 carry the host's own wall sentence, which
the lane now quotes beside the elapsed share.

A turn is one outer prompt carrying an unbounded internal tool loop, so a solver that finishes
without being nudged records one turn however much work it did. The lane therefore states tool
calls rather than a turn share: `de8b40-i02` recorded one or two turns of 24 against 37 to 85 tool
calls per case. `turn-bound` still names the case that actually reached the turn wall.

The reading that changes a decision is usually the negative one: across the recorded truss and
firmware campaigns no bundle ever moved a wall and the median case spent 5 to 9 per cent of its solve
minutes, so nothing about those outcomes is explained by room. When a case does reach a wall, the
lane names it: a case that passed at a wall is fine, and a case that reached one without passing
holds a verdict on a truncated solve.

## Where each slot lost the thread

The timeline lane answers where the wall-clock went. With `--classify` it also answers what each
slot was doing while it went there, using the same pinned BGE-small model `posture` uses:

```text
bun .claude/skills/whole-run-investigation/scripts/timeline.mjs <campaign dir> --run <runId> --classify
bun .claude/skills/whole-run-investigation/classifier/run-narrative.mjs <campaign dir> --run <runId> [--drift-run N]
```

Three slots reach one clock by three routes, none of them an order join. A Builder prose row's
`atMs` is relative to its session, and the session's absolute start is its execution record's last
write minus how long it ran. A solve turn carries no time at all, so a solver unit is placed by its
case's recorded solve window and located by turn inside it. An authoring review's id is a UUIDv7
minted when the review started, so the identity carries the time; each review is attributed to the
Builder session whose window contains it, and one that falls in no window is left out. On campaign
3fd52f9e-4 that attribution reproduced the three, two and one review counts the Builder execution
records had already published for those sessions, from a completely separate file.

The reading is the stretch: five or more consecutive units of one kind, resolved to the phase the
run held at that moment (operator, 2026-09-19 — "five unconfident in a row and we know that
location is off"). The two kinds are separate claims and the lane never merges them. `unreadable`
means the classifier's margin stayed under the floor, so its labels there say nothing about the
model; `adrift` means the classifier read `uncertain`, `blocked-environment`, `disputing-verifier`
or `workaround` five times running. On the corpus to date nearly every stretch is `unreadable`,
which is a statement about the margin on Builder prose and not about the Builder.

The review slot is read for repetition instead of posture, because the thirteen anchors were
written for authoring prose and a reviewer restating a finding nobody acted on is what matters
there. Two claims at cosine 0.93 or above count as one restated finding; on 1264 cross-review pairs
the median was 0.636 and the p95 0.843, while the six highest pairs were all the same defect in
different words, from 0.939 to 0.970.

## Adjudicate and report

Treat reports as research. Check consequential claims against exact source and actual consumers;
reconcile totals with verified readers. Resolve disagreement by what each method can observe:
neither confidence nor abstention wins automatically. Reuse complete, identity-bound execution
results unless a specific uncertainty calls for another check.

When a premise fails, revisit dependent findings and your own earlier claims; name what survives
and falls. Collapse symptoms under their earliest demonstrated owner. Separate source presence,
deterministic proof, live exercise and outcome proof. An unmerged fix can be implemented/tested
without having changed the recorded run. Close weak links a bounded command can decide; retain
unresolved rivals and the next discriminator where the instrument cannot see the property.

Lead with the useful result, material gap, exact source and separate denominators. Index the work
once through [CHECKLIST.md](CHECKLIST.md). Targeted review records admitted rows and material
omissions; exhaustive review records all catalogue rows and session 30 applicability. Name
missing reports and unexecuted checks. Live conclusions use the T1 refresh.

For an extended post-run handoff, distinguish defects that affect a decision and evidence gaps from
recovered friction or expected absence. Each retained proposal names evidence, owner and consumer,
smallest coherent change, expected effect, falsifier and the comparison that could decide it.
Return no repair when the evidence supports a probe or hold. Use
[an independent review packet](references/external-review.md) only when another method can settle
a consequential dispute; do not repeat completed WRI work. The campaign owner selects the next
experiment and its predictions. A review alone authorises no source edits, PR or product launch.

## Durable archive

Exhaustive reviews and requested durable handoffs write exactly four files under
`notes/runs/<runName>/`, which is local and ignored, so an archive is never published:

- `main_synthesis.md`: adjudicated findings, limits, accounting and recommendations.
- `luna_syntheses.md`: accepted reports in manifest order, with only repository whitespace
  normalisation and necessary protected-detail removal.
- `digest.md`: the verified, sanitised deterministic digest.
- `review.json`: `wri-archive/v1` identities, collection/coverage receipts, accounting and advisory
  learning pointers into those four files.

A targeted standalone answer needs no archive unless requested. Start from a template that passes
the current validator; its schema owns the detailed fields. Do not maintain another schema in
prose or add a fifth handoff file.

Preserve frozen predictions and campaign-owned adjudications. WRI can propose a refutation or
experiment, but cannot create campaign events, dependency walks, promotions or closure. Missing
owner receipts leave a prediction advisory and ineligible, with advice, not fabricated evidence.
Every safeguard row is a runtime sensor. Derive the runtime
census from measured source and bind T0/T1 logs; absent instrumentation is unobservable.
Safeguard retirement belongs to its owner.

Check for protected verifier detail, raw prose, counterexamples and reference artifacts before
publication. Retain safe findings and evidence paths; never feed protected material to Builder,
Judge, diagnosis or repair prompts. Archive pointers resolve within the four files.

```text
bun .claude/skills/whole-run-investigation/scripts/validate-archive.mjs \
  --archive <absolute archive dir>
```

Read its exit status directly; a pipe must not turn refusal into success. Resolve errors at their
owning field without inventing evidence. The validator proves shape and bindings, not prose truth.

End durable recommendations with `What to do next`: Patch, Consolidate and Overhaul. Each useful
item names mechanism, owner, evidence and the decision it changes. A section may report no
justified change. Scope follows the problem, not a fixed line count or a ban on necessary files.

For a requested improvement plan, use [the plan questions](references/improvement-plan-questions.md)
to check completeness without buying another review. Explain which earlier changes worked or
failed and what prevents identical-condition repetition. The campaign owner chooses and launches
the next experiment under the user's authority.
