# A systems read of the tree

Nine readers took 43 files each — all 387 source files carrying comments — and judged every comment
against what the code cannot say for itself. Reading a file for *why* rather than *what* leaves you
holding an argument about it, so each reader was then asked what in its ninth makes most sense and
what makes least, with the reasoning spelled out for the second. This document is the composition of
those nine answers. A companion register, `docs/systems-read-findings.md`, kept locally
rather than published, holds every individual finding in the `owner → live consumer → decision changed → evidence → hostile
test` frame that rule 8 of `AGENTS.md` prescribes.

Read it as research, not as evidence. Each reader measured its own numbers by grep and file read in
one pass, and lane reports are research by the repository's own rule. Where a claim was reached by
more than one reader independently, or where it asserts that nothing reads something, it was
re-checked against source in the composing turn; the register marks which. The rest is relayed.

Two defects in the reports themselves are worth stating up front, because they are the measure of
how much to trust the rest. Two readers counted the same file differently — 12 top-level keys in
`thresholds.frozen.yaml` against 11 — and the first is right: 12 keys, of which `frozenOn` and
`frozenBefore` are scalars, leaving 10 policy rows. And one reader supported a correct structural
finding with a wrong fact, arguing that a fine instrument for function length already exists in
`tools/loc/complexity-baseline.json`. That file freezes cyclomatic complexity, not function length;
the two are different checks in different policy files. The finding survives, the evidence for it
did not.

## What makes most sense: a principle the tree lives by and never states

Seven of the nine readers defended a distinction that looks like duplication, and every one of them
gave the same reason for it. **The merged form has a state that reads as the good state.**

The purest instance is `CommandIsolationIdentity`, a two-arm union whose arms share seven fields.
The obvious cut is one shape with the Bubblewrap and Seatbelt fields made optional. The reason that
is wrong is a fact about hashing rather than about types: an absent optional field hashes identically
to one the guard did emit, so a run that bound no network namespace would produce the same policy
hash as one that did. Two different walls would claim one identity, and the recorded confinement
becomes unfalsifiable exactly where it matters. The same argument appears in time rather than in
types around the regular-file check, which is asked at three separate moments because Seatbelt
compiles a profile before the child starts, Bubblewrap binds at mount time, and the command guard
checks a path a shell will resolve later. The code is already shared; what repeats is the asking,
and it repeats because the path can change between those moments.

The strongest version carries its own proof. Three walls close process spawn for a generated tool —
a Landlock ruleset on Linux, non-writable redefinitions of `Bun.spawn` and `Bun.which` on macOS, and
a source rule refusing `bun:ffi` — and the third reads as belt-and-braces until you notice that the
Landlock installer itself reaches libc through `ffi.dlopen`. So `bun:ffi` demonstrably reopens
`posix_spawn` underneath a JavaScript property lock, and removing the source rule as duplication
would let a run record as confined while a generated tool can spawn.

The evidence layer runs on the same principle. Collapse `unaccepted` into `non-result` and a dead
provider reads as a hard battery. Replace a `null` that means unknown with a zero and an interrupted
turn reports as free while an unmeasured product reports as not selected — the same wrong answer
twice, and a confident one. Keep one duration field instead of `observedMs` beside the turn's own
timing and every interrupted solve becomes untimed, which is the same shape as a fast one. Read
EPERM from a signal-zero probe as "gone" rather than "exists and is untouchable" and a verifier's
working cell is removed under a process still writing into it, while the run records cleanly. Seven
ceilings in `src/critic/policy.ts` all equal 3 and beg for a single `RETRY_LIMIT`; each has one live
consumer in a different module counting a different domain, so the first one that needed to move
would move six others in six places nobody was editing.

That is the design principle the code actually lives by, and it is nowhere in `AGENTS.md`. Rule 8
says to spend complexity only when it changes a useful decision. This is its necessary inverse:
**refuse a collapse the type-checker would accept whenever the merged state is indistinguishable
from the healthy one.** Every reader found it independently, and none of them found it written down.

Two smaller patterns deserve the same protection. `REPORTING_Z` is the only normal quantile in the
tree, and what makes it a real single owner is not that it is declared once but that
`test/frozen-manifest-binding.test.ts` does not compare it to a second copy of 1.96 — it inverts the
standard normal CDF and checks that `2Φ(z) − 1` equals the `confidence: 0.95` in
`thresholds.frozen.yaml`. Declared policy and executable constant cannot drift without a test
failing, which is what "declared policy" ought to mean throughout and mostly only means by
convention. And `src/claim/judge.ts` stores four derivable aggregates and then recomputes every one
of them on read across 23 call sites, throwing on mismatch. That is not the duplication rule 8
forbids: the stored copy is the wire format out-of-tree readers consume without re-implementing the
arithmetic, and the check is what makes consuming it safe. Delete the storage and every reporting
tool reinvents the division; delete the check and a hand-edited claim reads as authoritative.

## What makes least sense

### A file that is declared policy and a condition identity at once

Four readers reached `thresholds.frozen.yaml` from four directions, which makes it the strongest
cross-lane result in the set, and it was re-verified rather than relayed. The file has 12 top-level
keys, two of them scalars, leaving 10 policy rows. `policyRow` has exactly two production callers,
`src/run/climb-history.ts:45` and `src/claim/calibration.ts:14`. `frozenRow` has none at all outside
its own module and the five assertions in `test/frozen-manifest-binding.test.ts`. Five rows —
`additionsBudget`, `netDeletionPerPR`, `oneOwnerPerDecision`, `controlCensus` and
`controlRecoveryFloor` — have zero readers anywhere across `src`, `tools`, `test`, `starters`,
`vendor`, `packages` and `.claude`. `judgeDeAnchoring` has exactly one, and it is a comment.

Dead configuration would be a small finding, and this is not dead. `src/critic/manifest.ts:39`
digests the parsed policy — every row, including the five nothing reads — and
`src/run/climb-battery-admission.ts:345` excludes any battery whose recorded digest differs from the
current one. So those five rows change no decision directly while holding veto power over battery
comparability: move `controlRecoveryFloor.declaredTarget` by a hundredth and every earlier battery
drops out of climb evidence although no threshold moved. What makes this sharp rather than pedantic
is that the file's own comment anticipates exactly this hazard one level further out. It digests
parsed rows rather than file bytes precisely so that a comment edit does not exclude every battery
recorded before it. The row-level form of that argument is the same argument, and it was not made.

The question both readers ended on is the right one to put to an operator, because the two answers
imply opposite repairs. **Is the manifest digest meant to identify declared policy, or the
executable condition?** If declared policy, the file is built correctly, the unbound rows are the
point, and the complaint collapses to naming. If the executable condition, five blocks hold a veto
by accident.

`judgeDeAnchoring` is the sharpest instance because the contract settles it in advance. `AGENTS.md`
states that three of its five rows describe a rank-2 paired-comparison protocol that is not
implemented, and that nothing should start implementing them. So this is a declaration the contract
says will never acquire a reader, sitting inside the digest that gates comparability, with its only
live consumer being a comment whose job is to warn you off it. One reader supplied the part the
others missed: deleting the rows *moves* the digest, so the smaller form is not free.

### The condition nobody pinned

The single finding with the largest blast radius is that an unpinned codex slot silently chooses the
model a paid run measures. `src/backends/slot-defaults.ts` maps every codex slot — Builder, Built
and review alike — to `gpt-5.6-luna` at `xhigh`, overriding the codex descriptor's own
`defaultModel` of `gpt-5.5`. Verified: the table holds exactly one kind, and all three slot entries
hold identical values, so the per-slot shape buys no distinction today.

The repository supplies its own counter-argument. An out-of-range battery size fails rather than
being clamped, on the stated grounds that a silently changed size is a silently changed measurement
condition — and the model is a far larger condition variable than the size. `AGENTS.md` already
names the hazard and tells a launcher to pin explicitly, which is an instruction where the other
case is a refusal. The smaller honest form is to refuse an unpinned slot at resolve time, the way
the turn budget is refused.

### Gates that pay no rent

Rule 8 records that the failure mode actually observed here is not unchecked action but legitimate
work blocked by a gate that pays no rent. Three readers found live instances, and all three share a
shape worth naming: **the refusal does not stop the bad thing, it does stop the ordinary thing, and
the remedy routes through a less inspectable path.**

Stage 4 of `src/correctness-bundle/solvability.ts` refuses an external check whose tool argument holds a newline
or exceeds 256 bytes, while the code's own comment concedes the rule "detects some such cases and
proves no provenance". It therefore refuses a long flag or a JSON operand, and 256 bytes is ample
for an authored program anyway. `exportTarget` refuses any destination that already exists, which is
sound for an already-hashed path, except that the case it refuses is the ordinary one — build a
checker in the workshop cell, smoke-test it, find it wrong, rebuild, re-export — and the remedy
routes the Builder through a bash `rm` in the candidate workspace to reach the same end state by the
route nothing hashes.

The subtlest is a silence rather than a refusal. `scoringClosureHash` returns null from a blanket
catch, or from any nested `package.json` anywhere under the package, and `src/claim/fingerprint.ts`
then falls back to a hash of the whole package including `reference/`. But a task probe is *required*
to rewrite the reference solve, so under that fallback base and candidate always differ, and
experiment-freeze throws a message naming drifted bytes when the cause was an unreadable closure. A
Builder installing tools could plausibly create the trigger, and the operator would be told the
wrong thing about why.

### Silence where a reason belongs

That last case generalises, and four readers hit it at four layers. **The tree is scrupulous about
`null` meaning unknown inside its data and loses that discipline at its boundaries.**

One instance changes a decision in the wrong direction today, which makes it the only finding in the
whole set that is actively wrong rather than merely inert. `interpreterDigest` returns `undefined`
both for a binary with no shebang and for a script whose interpreter could not be resolved on the
cell's search path, and `movedSinceSnapshot` reads that `undefined` as *nothing moved*. So a script
whose `python3` was unresolvable at submit records as unmoved at every later run — including one
where a `python3` has since appeared and is now doing the grading. The tell that this is oversight
rather than design is that the entry already carries the distinction, since `toolProvenance` sets
`kind: "script"` with `interpreter: "python3"`; the pair already says "unresolvable", and nothing
reads the pair.

The same shape recurs without the teeth. `frozenRow` catches every failure and returns the empty
row, so a missing or malformed manifest leaves every reader on its own declared default and the run
proceeds looking identical. The safeguard inventory's 14 rows exist so that a sensor can be retired
once its shape has a real owner, and the reader's own comment concedes that `fired: 0` cannot
distinguish a healthy tree from a branch no recorded run ever reached — the retirement loop is
closed on paper and open in fact.

### A second, lossier encoding — the class already fixed once

`HarnessExperiment` is `"build" | "climb" | "evaluation"` and sits beside the schema-validated
five-member `ExperimentOperation`. Both verified. `climb` and `task-probe` name the same round,
`evaluation` and `evaluation-correction` likewise, the mapping between them is by hand, and only one
of the two sets is schema-validated.

What lifts this above a tidy-up is that `AGENTS.md` records this exact defect being diagnosed and
removed elsewhere: `climb`, `hold-limit` and `ease` were "a second, lossier encoding" of the five
band zones, and every consumer either re-switched on the zone or tested `=== "climb"`, which is
`zone === "too-easy"` spelled differently. The class was named, one instance was cut, and the other
is still standing with the same word in it. Alongside it sit two unions advertising a member nothing
produces — `EvaluatorIndependence` declares four and `evaluatorIndependence()` can return three,
with a validator existing to reject the fourth at claim write — and `JudgeCensusCounts`, which
carries three numbers with one degree of freedom because `controls` is asserted zero. That last one
is kept so an older record is refused rather than read, which is precisely the superseded-version
reader the no-backwards-compatibility rule says to delete.

### Prose carrying an authority its form cannot support

Two readers found this at opposite ends of the system, and it is the same finding twice.

`PROVIDER_BLOCKER_MESSAGE` is 57 top-level alternatives over 1,452 characters, and what it decides
is whether a case leaves the capability denominator — which design prior 4 makes load-bearing. The
finding is the asymmetry rather than the regex. The same file holds structured signals
(`acceptedSubmit`, `toolCalls`, `startedToolCalls`, `completedTurns`) and trusts them only to *add*
two narrow exceptions, while unanchored substrings like `quota` and `overloaded` are trusted to
declare a non-result outright. Providers really do report failures as prose, so the smaller honest
form is not a smaller regex: the reason string is already recorded per case, so counting which
clauses ever fire, beside the outcome, would show which of the 57 earn their place.

At the other end, the host rebinds an artifact-writer's parameters and execution, the Builder cannot
observe that, and so the Builder can honestly write "it runs no analysis" over a call that returns a
margin table. The shipped remedy is `WRITER_BINDING_SENTENCE`, appended to the Builder's own
description and ending "Where the description above says otherwise about what this tool runs or
returns, this sentence is what runs." The binding happens either way, so the sentence changes no
decision. What it changes is that the solver reads a self-contradicting description and has to
adjudicate it, which is rule 13's "teaching agents the mismatch in prose" shipped as a constant.

### An identity minted for a comparison nothing performs

`FRAME_REVISION` hashes the climb readout's frame and is written into every `difficulty-decision/v6`
record. Verified: nothing reads it back. Its only other mention in `src`, `tools`, `test`, `starters`
or `packages` is a test asserting the hash is 64 hex characters. The contract's claim that rewording
a sentence "creates a new recorded condition rather than a tidier one" is true as far as recording
goes, and no comparison is refused on the difference. The repair here is a reader rather than a
deletion — something that refuses a cross-battery comparison whose two records carry different
frames, which is the decision the identity was minted to change.

### Fossils

Each costs a reader a question that has no answer. `phase: "battery-census"` is a one-member union
constructed once and asserted verbatim in three test sites, with nothing branching on it — residue
of a member that left when the control census stopped reaching the Judge. `effort-envs.ts` carries
`satisfies Partial<Record<BackendKind, …>>` over a table holding all three kinds, a return type of
`string | undefined` that the indexing cannot produce, and a live ternary branching on the
impossible arm. `tools/oxlint/ana/index.ts` splits 37 rules into 23, a blank line, and 14, with some
twenty lines of prose explaining the boundary before concluding "read it as the order things arrived
in and nothing more" — the boundary's live consumer is whitespace in an object literal. And
`src/builder/vm-workshop-cell.ts` is 428 lines with a live importer and a dedicated test, gated on
`ANA_WORKSHOP_VM`, which was verified to appear nowhere but that file, its own test, and
`test/env-baseline.ts`, which strips it. In a paid detached run the third isolation layer cannot be
selected.

## Where to start

Only one of these is wrong in the wrong direction today, and it is small: read the
`kind`/`interpreterDigest` pair in `movedSinceSnapshot` instead of the digest alone. The unpinned
slot is next, because it decides what a paid run measures and the repository already refuses the
analogous case for battery size. The threshold manifest is the largest structural finding but cannot
be repaired before the operator answers what the digest is for, since the two answers imply opposite
work. The three rent-free gates are each a small fix with a known trigger. The dead union members,
the fossils and the second experiment vocabulary are one batch.

## What this method does and does not show

Reading every comment in a file is an unusually good way to find the places where a system's
intentions and its behaviour have parted company, because a comment is where the intention was
written down and the code is what happened next. It is a poor way to find anything whose defect is
invisible from inside one file, and the readers said so repeatedly: each ended by naming seams whose
other half lay in another ninth. It also cannot see a defect nobody commented on.

The nine open questions the readers ended on are kept in the register, because several of them are
decision-changing for someone with more context than a reader of 43 files. Three are worth an
operator's attention on their own: whether the threshold digest identifies declared policy or the
executable condition; whether any recorded run's opening evidence holds a slot that resolved through
`BACKEND_SLOT_DEFAULTS` rather than an explicit pin; and whether anything outside the trees searched
reads `frame` off a `difficulty-decision/v6` record.
