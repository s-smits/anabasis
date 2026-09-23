# Systems read: the finding register

The companion to [systems-read.md](systems-read.md), which argues the case. This file holds the
findings one at a time so that a reader going to fix one has the symbol, the consumer and the
falsifier in front of them.

Every finding is stated in the frame rule 8 of `AGENTS.md` prescribes: **owner → live consumer →
decision changed → evidence → hostile test**. A finding whose "decision changed" is *none* is not
thereby harmless — several of the worst below change no decision directly and hold veto power over
something else — but it is the first thing to establish, because a mechanism that changes no
decision and guards nothing is the cheapest kind to remove.

Two marks appear throughout. **[verified]** means the claim was re-checked against source in the
turn that composed this register, which matters most for claims of the form "nothing reads this":
`AGENTS.md` holds that a negative capability claim enters a document only with a named symbol, its
call sites and a check run in the same turn. **[relayed]** means one reader measured it in its own
pass and it has not been re-checked. Readers also marked their own confidence, distinguishing *this
does not make sense* from *I do not understand this*; that distinction is preserved, because the
second is a request for context rather than a claim.

---

## 1. The threshold manifest

### 1.1 Five policy rows with no reader sit inside the comparability digest

- **Owner:** `thresholds.frozen.yaml`, parsed and digested by `src/critic/manifest.ts`.
- **Live consumer:** `policyRow` has exactly two production callers, `src/run/climb-history.ts:45`
  and `src/claim/calibration.ts:14`. `frozenRow` has no production caller at all — only `policyRow`
  itself and the five assertions in `test/frozen-manifest-binding.test.ts`. **[verified]**
- **Decision changed:** none directly, and battery comparability indirectly.
  `src/critic/manifest.ts:39` digests the parsed policy — every row — and
  `src/run/climb-battery-admission.ts:345` excludes any battery whose recorded
  `thresholdManifestDigest` differs from the current one. **[verified]**
- **Evidence:** the file has 12 top-level keys, two of them scalars (`frozenOn`, `frozenBefore`),
  leaving 10 policy rows. `additionsBudget`, `netDeletionPerPR`, `oneOwnerPerDecision`,
  `controlCensus` and `controlRecoveryFloor` return no match anywhere across `src`, `tools`, `test`,
  `starters`, `vendor`, `packages` and `.claude`. **[verified]** They are written in a milestone
  vocabulary (`M1`, `M2`, `activeFrom: M4`) that no source file uses. **[relayed]**
- **Hostile test:** change `controlRecoveryFloor.declaredTarget` by a hundredth and confirm that
  every previously recorded battery leaves climb evidence, although no threshold a reader consults
  has moved.
- **Note:** the file's own comment at `:34-38` makes this exact argument one level out — it digests
  parsed rows rather than file bytes so that a comment edit does not exclude every earlier battery.
  The row-level form of the argument was not made.
- **Smaller honest form:** depends entirely on the open question in §6.1. Either mark each row bound
  or declarative and digest only the bound ones, or keep the digest whole and say in the file that
  every row is part of the condition.
- Reached independently by four readers. Two counted the file differently, 12 keys against 11; 12 is
  correct.

### 1.2 `judgeDeAnchoring`: policy for a protocol the contract says not to implement

- **Owner:** `thresholds.frozen.yaml`, rows `commitBeforeSeeingCandidate`,
  `predictionsMustBeFalsifiable`, `predictionsMustBeDisposed`.
- **Live consumer:** one comment, `src/review/review-session.ts:13`, whose job is to say they are
  not implemented. No other match in `src`, `tools`, `test`, `starters`, `vendor`, `packages` or
  `.claude`. **[verified]**
- **Decision changed:** none, except through §1.1's digest — deleting the rows moves a recorded
  condition identity, so the smaller form is not free.
- **Evidence:** `AGENTS.md` states the three describe a rank-2 paired-comparison protocol that is
  not implemented and that nothing should start implementing, while the other two
  (`commitAllTasksInPhaseZero`, `fallbackConfigured`) hold by construction.
- **Hostile test:** delete the three and confirm no test, schema or completeness check fails —
  §6.1's other half.
- **Smaller honest form:** delete the three; state the two construction facts beside the
  construction, where a test can bind them.
- Reached independently by four readers. *This does not make sense.*

### 1.3 `frozenRow` turns a missing manifest into a silent default

- **Owner:** `src/critic/manifest.ts:45`.
- **Live consumer:** `policyRow` at `:73`, and through it both production readers.
- **Decision changed:** every threshold a run applies, when the file is absent or malformed.
- **Evidence:** it catches every failure and returns the empty row, so each reader falls back to its
  own declared default and the run proceeds looking identical. `currentThresholdDigest` does keep an
  `unstated | digest | unavailable` tri-state, so absence is recorded somewhere; the reader could
  not find what acts on `unavailable`. **[relayed]**
- **Hostile test:** truncate the manifest and confirm a run records that it applied defaults rather
  than policy.
- *I do not understand this* — the tri-state suggests the case was considered.

---

## 2. The condition nobody pinned

### 2.1 An unpinned codex slot silently chooses the measured model

- **Owner:** `src/backends/slot-defaults.ts`.
- **Live consumer:** `src/backends/resolve-side.ts:86` and `:104`. **[relayed]**
- **Decision changed:** which model a paid run measures when nothing pinned it.
- **Evidence:** `BACKEND_SLOT_DEFAULTS` holds one kind, `codex`, mapping Builder, Built and review
  alike to `gpt-5.6-luna` at `xhigh`, overriding the codex descriptor's own `defaultModel` of
  `gpt-5.5` at `src/backends/backend-kinds.ts:80`. All three slot entries hold identical values, so
  the per-slot shape buys no distinction today. **[verified]**
- **Hostile test:** launch with no env pins and confirm the opening evidence names a condition no
  table in the contract names. `AGENTS.md` already describes this outcome and instructs a launcher
  to pin explicitly.
- **Smaller honest form:** refuse an unpinned slot at resolve time, the way an out-of-range battery
  size is refused rather than clamped — and on the same grounds, since a silently changed model is a
  larger changed condition than a silently changed size.
- *This does not make sense.* The strongest counter-argument, which the file's comment makes, is
  that a transport upgrade needs one place to land.

---

## 3. Gates that pay no rent

Rule 8 names this failure mode explicitly: *the failure mode actually observed here is not unchecked
action; it is legitimate work blocked by a gate that pays no rent.* All three below share a shape —
the refusal does not stop the bad thing, it does stop the ordinary thing, and the remedy routes
through a less inspectable path.

### 3.1 The 256-byte program-argument refusal

- **Owner:** predicate `programArgument`, `src/verify/self-grounding.ts:50`, constant
  `PROGRAM_ARGUMENT_MAX_BYTES` at `:18`.
- **Live consumer:** stage 4 of `src/truth/solvability.ts`. **[relayed]**
- **Decision changed:** whether an external check is admitted.
- **Evidence:** it refuses a tool argument containing `\r` or `\n`, or longer than 256 bytes, and
  the code's own comment concedes the rule "detects some such cases and proves no provenance".
- **Hostile test:** declare an external check with a long flag or a JSON operand and confirm it is
  refused while an authored program well under 256 bytes passes.
- **Correction to the reader's evidence:** the finding was underpriced, and the section heading above
  — the refusal stops the ordinary thing and not the bad one — does not hold here. `programArgumentChecks`
  opens with `if (!externalCheckIds.has(row.checkId)) continue;`, so an authored check may pass a
  program of any length: the code says so in as many words, "Authored checks may pass program text:
  they claim no independence". What the rule catches is the one shape that makes an independence
  claim false — an `external` check whose deciding bytes travel in argv, so the host attests the
  interpreter and the candidate supplies the logic. And the way out it names is not a less
  inspectable path: `programArgumentRemedy` tells the author to redeclare the check as `"authored"`,
  which is the accurate label and costs only the independence the check could not support anyway.
- **Smaller honest form:** none. The 256 bytes are still arbitrary and still prove no provenance,
  which the comment concedes, but a gate scoped to exactly the claim it protects, offering the
  honest reclassification as its remedy, is a gate paying rent. Keep it.
- *This does not make sense.*

### 3.2 `exportTarget` refuses the ordinary rebuild

- **Owner:** `src/builder/verifier-workshop-export.ts:43`. **[relayed]**
- **Live consumer:** the workshop export path.
- **Decision changed:** whether a Builder may replace a tool it has just rebuilt.
- **Evidence:** it refuses any destination that already exists — file, directory or dangling symlink
  — and tells the Builder to choose a new path or manage the installed version with workspace tools.
  The rent is real, since an attested tool's bytes should not be swapped under an already-hashed
  path. But the case it refuses is build, smoke-test, find wrong, rebuild, re-export, and the remedy
  routes through a bash `rm` in the candidate workspace to the same end state by the route nothing
  hashes.
- **Hostile test:** run the ordinary rebuild cycle and confirm the sanctioned path requires a
  workspace deletion.
- **Smaller honest form:** an explicit replace recording both digests, so the swap becomes evidence
  instead of a workaround.

### 3.3 `scoringHash`'s silent fallback reports the wrong cause

- **Owner:** `src/claim/fingerprint.ts:182`, `scoringClosureHash` in `scoring-closure.ts`.
- **Live consumer:** `src/run/experiment-freeze.ts:155` and `src/gate/experiment-admission.ts:147`,
  `:176`, `:199`. **[relayed]**
- **Decision changed:** whether a round is admitted as a task probe.
- **Evidence:** `scoringClosureHash` returns null from a blanket catch, from any nested
  `tsconfig.json`, `jsconfig.json` or `package.json` anywhere under the package
  (`scoring-closure.ts:72`), or from any import leaving it (`:59`, `:61`). The fallback then widens
  the identity to the whole package minus the battery, which includes `reference/` — and a task
  probe is required to rewrite the reference solve, so base and candidate always differ and
  experiment-freeze throws a message naming drifted bytes.
- **Hostile test:** put a `package.json` under a candidate's `correctness-model/` and confirm the
  next task probe is refused for drift it did not have.
- **Smaller honest form:** return the reason beside the null and record which hash the identity came
  from. The `??` stays; the silence goes.
- *This does not make sense* — the silence, not the fallback.

---

## 4. Silence where a reason belongs

### 4.1 `interpreterDigest` conflates "not applicable" with "unknown"

The only finding in the set that changes a decision in the wrong direction today.

- **Owner:** `src/verify/tool-inventory.ts` computes it.
- **Live consumer:** `movedSinceSnapshot` in `src/verify/host.ts`; `verifier-environment.ts` also
  hashes without one. **[relayed]**
- **Decision changed:** whether a tool is reported as having moved between submit and a later run.
- **Evidence:** it returns `undefined` both for a binary with no shebang and for a script whose
  interpreter could not be found on the cell's search path. `movedSinceSnapshot` then returns `null`
  — nothing moved — whenever the snapshot's digest is `undefined`. So a script whose `python3` was
  unresolvable at submit records as unmoved at every later run, including one where a `python3` has
  since appeared and is now doing the grading.
- **Hostile test:** submit with an unresolvable interpreter, install one, re-run, and confirm the
  drift check reports no movement.
- **Smaller honest form:** read the pair. The entry already carries the distinction, because
  `toolProvenance` sets `kind: "script"` with `interpreter: "python3"`, so
  `kind === "script" && interpreterDigest === undefined` *is* "unresolvable"; nothing reads the pair.
- *This does not make sense*, narrowly. See §6.2.

### 4.2 A safeguard's `fired: 0` cannot distinguish healthy from never-reached

- **Owner:** `SAFEGUARD_INVENTORY`, 14 rows.
- **Live consumer:** `tools/outcome/usage-reader.ts`, at `:17` and `:183`. **[relayed]**
- **Decision changed:** whether a sensor may be retired.
- **Evidence:** the inventory exists so that a sensor can be retired once its shape has a real
  owner, and the reader's own comment concedes a zero cannot distinguish a tree that stayed healthy
  from a branch no recorded run ever reached. The loop is closed on paper and open in fact.
- **Hostile test:** none available — that is the finding.
- **Smaller honest form:** record evaluations as well as firings, so zero-of-N becomes retirement
  evidence rather than silence.
- One reader specifically contradicted the weaker version of this: the sensors *are* read, so "log-only
  evidence nobody reads" is not the finding.

### 4.3 The backstop review pays for a reading and records no product

- **Owner:** `AuthoringReviewClock`.
- **Live consumer:** `reviewIfDue` in `src/run/builder-campaign.ts`. **[relayed]**
- **Decision changed:** how many paid reviews a session buys.
- **Evidence:** a `repair` review calls `read(fingerprint)` then `restart()`; a `backstop` calls only
  `restart()`. The reason is sound — the live workspace is still moving, so there is no snapshot to
  record as read — but the next clear `correctness_check` over substantially that tree buys a second
  paid review of content already read.
- **Smaller honest form:** hash the live tree at backstop time and pass it to `read()`.
- *I do not understand this* — how often a preview follows a backstop closely enough to matter is not
  visible from one ninth of the tree.

---

## 5. Encodings, dead members and fossils

### 5.1 Two vocabularies for one round

- **Owner:** `HarnessExperiment` in `src/critic/types.ts:3-4`; `ExperimentOperation` in
  `src/run/experiment-freeze.ts:41-47`.
- **Decision changed:** attribution of a round.
- **Evidence:** `HarnessExperiment` is `"build" | "climb" | "evaluation"`; `ExperimentOperation` is
  the schema-validated five that `AGENTS.md` calls the frozen operation vocabulary —
  `task-probe | harness-intervention | evaluation-correction | repeat | new-baseline`. **[verified]**
  `climb` and `task-probe` name the same round, `evaluation` and `evaluation-correction` likewise,
  the mapping is by hand, and one condition at `:154-156` tests `actual === "climb"` twice.
  **[relayed]** Only one set is schema-validated.
- **Why this is more than a tidy-up:** `AGENTS.md` records this exact class being removed elsewhere.
  `climb`, `hold-limit` and `ease` were "a second, lossier encoding" of the five band zones, and
  every consumer either re-switched on the zone or tested `=== "climb"`, which is
  `zone === "too-easy"` spelled differently. The class was named, one instance was cut, the other
  still stands with the same word in it.
- **Smaller honest form:** one set, the declared five.

### 5.2 `EvaluatorIndependence` advertises a member nothing produces

- **Owner:** `src/claim/calibration.ts:23`.
- **Evidence:** the union declares four members; `evaluatorIndependence()` at `:54` can return
  `same-model`, `same-family` or `different-family` only, and `"deterministic"` appears nowhere else
  in `src/claim`. A stored `"deterministic"` is refused at claim write. **[verified]**
- **Smaller honest form:** three members. The runtime refusal stays, because recorded JSON is
  external input, but becomes a refusal of an unknown value rather than of a known one.

### 5.3 `JudgeCensusCounts` carries three numbers with one degree of freedom

- **Owner:** `src/claim/judge.ts:19`.
- **Decision changed:** none. `controls` is asserted `=== 0` and `total` is asserted
  `=== controls + battery`, so only `battery` varies. **[relayed]** The shape
  `{controls, battery, total}` is used for `censusSize`, `verdicts` and `abstentions`. **[verified]**
- **Evidence:** the control census was removed and the field kept so that an older record is refused
  rather than read — precisely the superseded-version reader the no-backwards-compatibility rule
  says to delete. Its refusal message is a *string literal* dating the cutover, which is the stale
  provenance problem one layer outside a comment pass.
- **Smaller honest form:** one `battery` count; two assertions gone.

### 5.4 `FRAME_REVISION` is minted and never read back

- **Owner:** `src/run/climb-readout-frame.ts:115`.
- **Live consumer:** `src/run/difficulty-decision.ts:44` writes it into every
  `difficulty-decision/v5` record. **Nothing reads it.** The only other mention across `src`,
  `tools`, `test`, `starters` and `packages` is `test/climb-readout.test.ts:353`, asserting it is 64
  hex characters. **[verified]**
- **Decision changed:** none today. `AGENTS.md` says recording it means "rewording a sentence creates
  a new recorded condition rather than a tidier one", which is true of the recording and of no
  comparison.
- **Smaller honest form:** *not* deletion — a reader. Something that refuses a cross-battery
  comparison whose two records carry different frames is the decision the identity was minted to
  change. See §6.3.
- *I do not understand this one* rather than calling it senseless: the consumer may be analysis
  outside the trees searched.

### 5.5 Fossils

| Fossil | Owner | State |
| --- | --- | --- |
| `phase: "battery-census"` | `src/truth/judge-census.ts:22` | One-member union, constructed once at `:92`, asserted verbatim at three test sites across two files; nothing branches on it. Residue of a member that left when the control census stopped reaching the Judge. **[verified]** |
| `Partial` over a complete table | `src/backends/effort-envs.ts` | `satisfies Partial<Record<BackendKind, …>>` over a table holding all three kinds, a return type of `string \| undefined` the indexing cannot produce, and a live ternary at `resolve-side.ts:101` branching on the impossible arm. **[relayed]** |
| The 23/14 rule split | `tools/oxlint/ana/index.ts` | 37 rules in one flat object, split by a blank line, with about twenty lines of prose explaining the boundary and concluding "read it as the order things arrived in and nothing more". Every rule registers at `error` regardless; the boundary's live consumer is whitespace. **[relayed]** |
| ~~`ANA_WORKSHOP_VM`~~ | `src/builder/vm-workshop-cell.ts` | **[refuted]** The entry claimed the variable appears nowhere but that file, its test and `test/env-baseline.ts`, and therefore that no launcher can select the cell. `tools/vm/provision-workshop-cell.sh` sets it: line 15 documents it and line 217 is the provisioner's closing instruction, `export ANA_WORKSHOP_VM=$NAME`. So the cell is opt-in infrastructure with a sanctioned way in, not a fossil — an operator provisions the VM, exports what the script prints, and the third layer is selected. The line count was wrong too: 398 total, 382 nonblank, not 428. This is the class AGENTS.md calls the most expensive kind to get wrong, and the register got it wrong in exactly the way it warns about — a search that missed one directory, reported as an absence. |
| `maxConcurrency` on the Judge contract | `src/truth/judge-contract.ts:90` | Optional; `judge-census.ts:75` falls back to `JUDGE_MAX_CONCURRENCY` (5). The only assignment anywhere in `src`, `tools` or `test` is `test/judge.test.ts:578`. One reader, one test writer, no production writer. **[relayed]** |
| `authority: "unknown"` | observer rows | Four of five members are written across six emit sites; this one has no producer. **[relayed]** |
| `allowInTypeGuards` | `tools/oxlint/anti-slop/rules/no-runtime-typeof.ts` | Schema entry, default, one read at `:163`, no setter anywhere. The register first filed this under `tools/oxlint/ana/`, which is the repository's own plugin and would have made it dead weight. It is in `anti-slop`, the plugin copied from dmmulroy/anti-slop, so upstream parity is the likely whole reason and the option is a deliberate carry rather than a fossil. Upstream still unchecked. **[relayed, path corrected]** |

### 5.6 `copiedFileLimits`: one number buying two unrelated exemptions

- **Owner:** `tools/loc/source-policy.json`, read by `tools/loc/source-policy.ts`.
- **Decision changed:** both the 800-line file ceiling and the 115-line per-function check, for the
  whole listed file, from a single number.
- **Evidence:** six entries. `src/truth/probes.ts` is listed at 436 and measures 432 nonblank lines
  — four lines of headroom against a ceiling it is nominally exempt from, which restoring a handful
  of comments would spend — because what the entry actually pays for is one long function,
  `makeProbeControls`. Only two of the six numbers exceed 800, which is the tell that the rest are
  not file-ceiling exemptions at all. **[verified; the count was first written as 436, matching the
  budget rather than the file]**
- **Correction to the reader's evidence:** the supporting argument that "the fine instrument already
  exists one directory over, and `tools/loc/complexity-baseline.json` is `{}`" is wrong.
  `complexity-baseline.json` freezes *cyclomatic complexity* exceptions under
  `complexity-policy.ts`, not function *length* under `source-policy.ts`. The file is indeed 3 bytes
  and empty **[verified]**, but it is not the fine instrument for this check. The structural finding
  stands on its own; this supporting claim does not.
- **Smaller honest form:** a per-function baseline keyed by name, leaving the file ceiling to mean
  one thing. `staleCopyLimits` shows the intent is already right — it fails the gate the day a
  listed file passes both ordinary checks — it just cannot see which of the two exemptions is still
  load-bearing.
- **Operational hazard, independent of the finding:** `src/truth/probes.ts` has no headroom. One
  added line there fails `bun run gate`.

### 5.7 Two owners of one list

- **Owner:** `.home`, `.cache` and `.tmp` are created by `src/builder/verifier-workshop-input.ts`
  and listed again as `cellRuntimeRoots` by `src/builder/candidate-isolation.ts`. **[relayed]**
- **Decision changed:** whether a cell write is granted.
- **Evidence:** the failure is quiet. A fourth root gets created and not granted, the cell denies a
  write, and the Builder reads it as the tool failing to build.

---

## 6. Prose carrying an authority its form cannot support

### 6.1 The provider-blocker matcher decides the capability denominator

- **Owner:** `RUNTIME_NON_RESULT_MESSAGE` in `src/truth/runtime-blocker.ts`, built from
  `PROVIDER_BLOCKER_MESSAGE` — 57 top-level alternatives over 1,452 characters.
- **Live consumer:** `pi-built.ts`, `pi-built-child.ts`, `build-agent.ts`, `solve-case.ts`.
  **[relayed]**
- **Decision changed:** whether a case leaves the capability denominator, which design prior 4 makes
  load-bearing.
- **Evidence:** the finding is the asymmetry rather than the regex. The same file holds structured
  signals — `acceptedSubmit`, `toolCalls`, `startedToolCalls`, `completedTurns` — and trusts them
  only to *add* two narrow zero-tool-work exceptions, while unanchored substrings like `quota` and
  `overloaded` are trusted to declare a non-result outright.
- **Smaller honest form:** not a smaller regex. The reason string is already recorded per case, so a
  clause-fire count beside the outcome reports would show which of the 57 ever fire, and on what.
- One owner, one matcher, no reader-side copy — which is right, and is not the finding.

### 6.2 `WRITER_BINDING_SENTENCE` ships the mismatch as prose

- **Owner:** `src/solve/published-margin.ts:38`, appended at `built-starter.ts:593`. **[relayed]**
- **Decision changed:** none — the host rebinds the writer's parameters and execution either way.
- **Evidence:** the Builder cannot observe the rebinding, so it can honestly write "it runs no
  analysis" over a call that returns a margin table. The shipped remedy is a sentence ending "Where
  the description above says otherwise about what this tool runs or returns, this sentence is what
  runs." What changes is that the solver reads a self-contradicting description and must adjudicate
  it, which is rule 13's "teaching agents the mismatch in prose" written down as a constant.
- **Smaller honest form:** the host owns the whole description for a tool whose parameters and
  execution it owns, and the Builder's sentence says what the tool is for in the domain, never what
  it runs; or the gate refuses a description asserting behaviour the binding contradicts. See §8.
- *This does not make sense.*

---

## 7. Shapes that look like duplication and must not be cut

These are the other half of the read, and they belong in a register because the next simplification
pass will find every one of them. Each has a one-line reason that the code cannot state for itself.

| Shape | Why it survives |
| --- | --- |
| `CommandIsolationIdentity`, a two-arm union sharing seven fields | An absent optional field hashes identically to one the guard emitted, so a run that bound no network namespace would produce the same policy hash as one that did. Two walls, one identity, and the recorded confinement becomes unfalsifiable. |
| The regular-file check asked at three moments | The code is already shared; what repeats is the asking. Seatbelt compiles before the child starts, Bubblewrap binds at mount time, the command guard checks a path a shell resolves later — and a path can change between them. |
| Three walls on one escape: Landlock, the `Bun.spawn` property lock, the `bun:ffi` source rule | The Landlock installer itself reaches libc through `ffi.dlopen`, so `bun:ffi` demonstrably reopens `posix_spawn` underneath the property lock. Remove the third and a run records as confined while a generated tool can spawn. |
| Seven ceilings in `src/critic/policy.ts` all equal to 3 | Each has one live consumer in a different module counting a different domain. Collapsed, the first one that must move moves six others in places nobody was editing. |
| `unaccepted` and `non-result` as separate denominators | Collapse them and a dead provider reads as a hard battery. |
| `observedMs` beside the turn's own timing | A single field either claims a duration that never ended or records nothing. The split says "no settled duration, and here is a floor", which is what a SIGTERM'd battery knows. |
| `null` for unknown, never zero | A zero reports an interrupted turn as free and an unmeasured product as not selected — the same wrong answer twice, and a confident one. |
| EPERM from a signal-zero probe read as alive | Reached independently in `src/meta/subprocess.ts:99` and `src/run/campaign-lock.ts:108`, which do not import each other. Read it as "gone" and a working cell is removed under a process still writing into it, while the run records cleanly. |
| `evaluatorEnvironmentStop` and `isAuthoredEvaluatorFailure`, two predicates over one error | Both can be false. The sharp case is a check returning with `pendingTools > 0`, counted by the parent and never read from the child's own account of itself. Collapse them and abandoned tool calls record as a host outage, so a fail becomes no evidence and the denominators move. |
| `VERIFIER_EXECUTION_NON_RESULT_KINDS` as an array with the union derived from it | Remove the array and the union survives compilation while stored JSON loses its only validator. |
| `NEVER_ATTEMPTED_PREFIX` matched by prefix against a free-text field | It is how a reader counts the rows the scheduler wrote for tasks it never scheduled, without re-deriving the five-consecutive rule. Miss them and a battery cut short by one outage reads as a short battery — a denominator wrong in the flattering direction. |
| `src/claim/judge.ts` storing four derivable aggregates and recomputing all of them on read | The stored copy is the wire format out-of-tree readers consume; the 23 `judgeIntegrity` checks are what make consuming it safe. Delete the storage and every reporting tool reinvents the division; delete the check and a hand-edited claim reads as authoritative. |
| `probeIds`, a required field satisfiable with `[]` | It is the single bit separating a demonstration from an argument, and the blocking route hangs off it: a probe-backed harness defect may be admitted blocking on first occurrence, a source-only reading stays advisory. |
| `workerBindingRefusal` checked before the model runs | Submit freezes candidate bytes at one moment; the worker is a child assembled at measure time from those bytes. Move the check after the solve and a whole paid battery is accepted, solved and discarded on a stale receipt. |
| `harnessIdentity` excluding the task set | A task probe rewrites tasks, controls, reference solves and tests together while holding the product fixed. Include them and no probe could ever be read against its own baseline. |
| `case-record.ts` defending one invariant three ways | The failure mode is silence: a dropped row leaves every surviving row valid and the arithmetic self-consistent. Only the count against the planned task set can see it. |
| `src/truth/case-trace-pointer.ts` verifying a trace and not writing it | The battery run directory has one write owner. A verifier writing its own pointer would be a second writer racing the log. |
| Three files for what a public rule is | A malformed row and a check enforcing a decision marked `private` are different failures; the second fails every submission in a family for a rule the solver never had access to. Merge them and the visibility projection and the citation resolution share an owner. |
| The two OS walls as two policies, not one abstraction | Bubblewrap gets deny-default free from the namespace; the Darwin string policy needs explicit path-relocation rules a mount namespace makes moot. Unify them and "an isolation that cannot be established is not one that may be run without" becomes a configuration option. |
| `BUILDER_CAPABILITY_MODES` as one table rather than per-tool declarations | The value is the closure. `verifier_workshop` is the only entry holding read, write and exec together, and that is only visible in the list. |
| The gate's split memory in `validation-pipeline.ts` | One policy applied honestly: identical bytes are settled, intent is not a property of bytes, and a host non-result is never remembered as a verdict. |
| `REPORTING_Z` as the only normal quantile | The binding test does not compare it to a second copy of 1.96; it inverts the standard normal CDF and checks `2Φ(z) − 1` against the declared `confidence: 0.95`. Policy and constant cannot drift without a test failing. |

---

## 8. Seams

Each of these has its other half outside the ninth that found it, so none was settled.

- `linux-bwrap.ts:463` says its identity check and `exact-read-attestation.ts` "are the same few
  lines"; whoever holds the Linux files should say whether the divergence is still intended.
- The `enforcement` tri-state is `guard-denied | os-refused | os-allowed`, but `os-refused` is
  derived on Darwin only and every Linux run records `os-allowed`, because Bubblewrap shows a denied
  path as absent. So the guard-versus-OS disagreement check is structurally inert on one platform,
  and nothing records it as inert rather than clean. Its only located consumer,
  `tools/outcome/builder-tools.ts:240`, tests `=== "os-allowed"` inside a `.find`.
- `AUTHORING_STALL_LIMIT` is `POLICY.loop.buildFailedRounds` re-exported, while the
  `authoring-stalled` terminal is documented as reached from `noopSubmitStrikes` and
  `stalledFindingsRepeats`: three ceilings, one terminal name.
- `BATTERY_PROVIDER_STOP_CONSECUTIVE` has no reader outside its own module and tests, so the Judge
  census's five is a separate spelling of one intent.
- `climb` names three unrelated things: a `HarnessExperiment` route, `POLICY.climb`/`placeOnBand`'s
  band reading, and a `ClimbAction` member that was removed. `authority` likewise names two: an
  epistemic grade on an observer row, and the capability to accept a submission.
- The observation log's producers are in `src` — 30 modules import the emitter — and every located
  reader is in `tools`, matching `ana-observation/v2` by string prefix. No compiler-enforced join
  crosses that line.
- `EVALUATOR_WALL_MS` is `2 × TOOL_TIMEOUT_CEILING_MS`, and both numbers are also published to
  Builders in starter prose. The binding test found checks only that the wall exceeds the ceiling,
  not that the published pair matches.
- The protected-output test that would *prove* rule 4 — change only protected detail, every
  model-visible prompt digest unchanged — was not found in any ninth. Someone holds it, or nobody
  does.
- `familyOf` returning null collapses to `same-model`, the least-independent reading. Whoever owns
  `VENDOR_ALIASES` owns whether an unresolvable pin can ever buy an independence claim.
- `vendor/correctness-model-bundle/evaluate.ts` is the bundle-side dialect of semantics the host
  runs confined; the two should be confirmed to agree on *inapplicability*, which is where a Boolean
  check program usually diverges.
- `harness_trial` charges a measured case and writes under `rehearsals/`; the rehearsal should be
  confirmed excluded from the battery denominators there and not only upstream.

---

## 9. Open questions

Each reader ended on one question whose answer would change its own hardest finding. Three are worth
an operator's attention in their own right.

1. **Is the threshold manifest digest meant to identify declared policy or the executable
   condition?** If declared policy, §1.1 is correct as built and the finding collapses to naming. If
   the executable condition, five blocks hold veto power over climb comparability by accident. A
   second half: does anything executable — a completeness test, a schema — *require* the file to
   carry all five `judgeDeAnchoring` rows? If not, §1.2 is a three-line deletion.
2. **Does any recorded run's opening evidence hold a slot that resolved through
   `BACKEND_SLOT_DEFAULTS` rather than an explicit pin?** If none does, §2.1 is dead weight and the
   repair is deletion. If any does, it is worse than stated, because a measured condition was chosen
   by a fallback.
3. **Does anything outside `src`, `tools`, `test`, `starters` and `packages` read `frame` off a
   `difficulty-decision/v5` record?** Yes makes §5.4 a non-finding. No makes it an identity minted
   for a comparison nothing performs, and the repair is a reader rather than a deletion.
4. Does anything report a script tool whose interpreter could not be resolved? `tool-inventory.ts`
   claims "the run itself then reports" it; a search of `src/truth`, `src/claim` and `src/run` did
   not find the reporter. If it exists, §4.1 drops from a silent pass to a legibility point.
5. Does anything already refuse a Builder tool description that contradicts the host binding? If so,
   §6.2 softens from a contract defect to a redundant paragraph.
6. ~~Is there any launch path that sets `ANA_WORKSHOP_VM`?~~ **Answered: yes.**
   `tools/vm/provision-workshop-cell.sh:217` prints `export ANA_WORKSHOP_VM=$NAME` as its closing
   instruction. The cell has left the fossil table. Worth noting how the question was phrased, since
   it is the reason the error survived to be written down: the register filed the entry as
   **[verified]** and then asked, underneath, whether the thing it had just asserted was true.
7. Has `scoringClosureHash` ever returned null for a bundle that was actually adopted? If the
   recorded corpus holds no null, §3.3 is cosmetic.
8. Is the test that would prove rule 4 implemented anywhere — change only protected verifier detail,
   and every model-visible prompt digest comes out unchanged? No ninth found it, and the rule states
   the test in exactly that executable form. Either someone holds it, or the repository's strongest
   stated invariant is enforced by discipline.
9. Does anything record that the guard-versus-OS disagreement check is structurally inert on Linux?
   `os-refused` is derived on Darwin only, because Bubblewrap shows a denied path as absent, so every
   Linux run records `os-allowed` whether or not the two agreed. A reading that cannot distinguish
   "checked and agreed" from "could not check" is the §4 shape at the platform layer.

---

## 10. How the nine ninths were divided

The split was by file list rather than by architecture, so the slices below are what each reader
found itself holding rather than a designed decomposition. They are recorded because a finding's
reliability depends partly on how much of its subject sat inside one slice.

| Ninth | What it turned out to cover |
| --- | --- |
| 1 | The boundary layer: walls that decide which bytes a process may read, projections that decide which text a model may see, and the counters that decide when the loop stops paying for another round. |
| 2 | The boundary between what the Builder may see and do and what the host decides: authoring walls, the gate's preview and memory, the readings that turn a battery into a number, the verifier process boundary, and the deterministic policy holding the repository itself. |
| 3 | Where the controller stops trusting the model and starts recording facts: how a confined command is walled and identified, and how what happens inside it becomes a typed outcome. |
| 4 | The custody chain: the places where a fact changes hands and someone decides what may still be believed about it. |
| 5 | The boundary between what the system did and what the environment did to it: classifiers, walls, identity records and refusals. |
| 6 | The recording boundary: where something that happened becomes a durable row or an identity a later reader must trust without having been there. |
| 7 | Where a Builder's bytes stop being a draft and become a measured product: the authoring tools, the gate, and the advisory layer that reads the measured tree afterwards. |
| 8 | Where a harness stops being authored bytes and becomes a running thing that gets measured: the generated-tool worker and its bindings, Builder memory across rounds, the conformance and control probes. |
| 9 | The controller's evidence spine and the walls around it: the verifier host, the claim-side aggregate validators, the gate feedback returning to the author, and the telemetry emitter. |

Seven of the nine independently described their slice as *a boundary*, which is either a fact about
this system or a fact about how the files were split. It is worth knowing which before the next read
is organised the same way.
