# Run the actor live on a segment

**Use this case when:** the question is what the real model does from a derived position, over at most fifteen turns, through the production backend — with one directly launched steward per condition. Walk the layers first (`layer-walk`).

Use the run's own backend for the actor under test; do not substitute a subagent or hand-written
provider client for that actor. A subagent has a different system prompt, tool set and model
resolution from the one the run will use, so its own answer is not evidence about the product.

First choose the boundary: a session segment does not reproduce the campaign's continuation,
admission gates or durable submission decisions. For those questions, use
[authoring-comparison](authoring-comparison.md) and the real Builder campaign. This file describes
the session helper; verify its exports, flags and grants at the exact tree before running it.
Historical commands below do not prove that an older helper still matches newer production source.

A steward subagent may own the simulation around that actor: derive or verify its assigned
position, write and hash its prediction note, invoke `run-segment.mts`, wait for it, inspect the
trail and workspace, and append the resolution. Its prompt must say that the production segment is
the measured actor and its own prose is research only. Keep each steward in its assigned scratch
directory, read-only outside it unless the operator separately authorised a source change. For a
batch, use one steward per independent condition; do not ask one steward to coordinate several conditions or
let stewards spawn further agents.

The unit is a **segment**: one seeded start, the production toolkit, and the contiguous stretch of
checkpoints your question covers — three of the twenty rather than all of them. It is not a turn;
inside one step the session runs its own tool-calling loop and decides for itself what to do.

```sh
bun .claude/skills/system-path-simulation/scripts/run-segment.mts \
  --backend claude --effort high --campaign-dir /abs/run-tree/.scratch/segment \
  --max-builder-turns 15 --handover /abs/handover.mts \
  --step builder:/abs/kickoff.txt@4 \
  --step tests:/abs/next-step.txt@3
```

Each `--step` is `role:prompt-file[@turns]`, run in order on **one** session, so the second step
sees what the first did. Roles label the steps; every step uses the same Builder session.
It calls `builderSlot`, `builderSessionOpener`, `campaignBuilderMount` and `runBuilderTurn`, so
the session is the run's session with your prompts in it. `--no-tools` omits the custom roster;
the Claude CLI's search builtin remains governed by the bridge.
`--json` returns the whole segment for a scenario script to assert on.

For a Builder rehearsal, capture both production messages without a provider: call
`runBuilderSession` with an `open` stub that records its system-prompt argument and returns a
session whose `runTurn` records `options.prompt`, then throws a sentinel. Pass the captured system
file as `--system-file` and the first prompt as `--step builder:/abs/first-prompt.txt`. Capture for
the exact condition workspace: the first prompt carries its physical location, which a native
backend may need when its working directory is neutral. Do not reconstruct these strings by hand.
Without `--system-file`, the workspace-card system prompt remains; it does not establish full
production Builder framing. The option applies to the whole segment. The JSON result records the
supplied system bytes and their digest.

The seed copy preserves relative symlinks, so an installed compiler's runtime links stay inside
the copied toolchain. Check the copied workspace's editable-file modes before launching: a frozen
snapshot may retain read-only files. Restore write permission only in the owned authoring copy,
within this round's writable scope; never thaw the saved snapshot.

A tool-bearing OpenRouter segment remains refused in this bounded repair. Its backend-aware mount is now available, but the helper has not cleared that live tool path. Use a scoped fullrun for it.

It records, when supplied by the backend, `runtimeIdentity`, the provider's own
reported spend, the per-tool tally, and a provider failure as a **typed non-result** from the
production classifier, kept apart from a `script-or-setup-fault`.
Null identity or usage stays unavailable; requested pins alone do not attest the served model.

`--effort` and `--campaign-dir` have no defaults. An unstated effort is an unmeasured condition.
The campaign path must be absolute, resolve physically beneath the run tree's `.scratch/`
directory, and be absent or contain only an empty real `workspace/`; this enforces one fresh scratch
condition instead of trusting a warning not to reuse or point at controller-owned campaign evidence. The
isolation binding still requires `repoRoot ⊇ epoch ⊇ workspace`.

Every option-bearing helper uses the same strict parser. Unknown options, duplicate singleton options,
missing values and stray positional values refuse before a backend or output write. Use
`--name=value` when a legitimate value itself begins with `--`.

### The join between stages

- `--max-builder-turns 15` is the whole segment's hard ceiling, steps and continuations together; use a
  smaller positive value when the question needs less, preserving any operator-specified bound.
- `--step role:/abs/file.txt@4` lets that stage take up to four turns. One turn suits a probe with
  one question; a stage that is a piece of work — read, try, check, correct — should be allowed to
  be deliberate, and a one-turn allowance measures haste instead of judgment.
- `--handover /abs/module.mts` runs **between** stages, exporting
  `handover(ctx) → { ok, reason, nextPrompt? }` over `{ index, role, text, turnsSpent, workspace,
  campaignDir, trail }`. A refusal ends the segment as `handover-refused`; a `nextPrompt` replaces
  the next stage's prompt.

The handover module is the point. Production never hands one stage's output straight to the next: a
controller reads it, decides whether the next stage opens, and composes its input. A segment whose
second prompt you wrote by hand has stubbed that join — a second stub, and usually the one under
test. Import the real selector, validator or admission function and let it decide; when it refuses,
the segment stops because production would not have reached the next stage either.

A segment exits non-zero unless every step completed or settled and nothing stopped it early, so a
wrapper cannot read an unfinished segment as a cleared path.

**Ask "what changed" through `scripts/workspace-changes.mts`, not by hand.**
`changedPaths(workspace)` returns every changed path, the same list without the three session note
files (`MEMORY.md`, `SCRATCHPAD.md`, `agent/BUILT_AGENTS.md`, which can change without a product edit), and `diffSha`: the sha256 of HEAD, NUL-delimited raw Git status and the
realised bytes or symlink target at every changed path. It therefore binds staged and untracked
work as well as an unstaged diff, while preserving legal whitespace, newlines and literal arrows in
filenames. The question is otherwise typed three times per condition — in the handover, in each
prediction's caught/missed clause, and again at adjudication — and one hand-written copy mis-sliced
`git status --porcelain`, so a condition's recorded evidence reads `EMORY.md`. That bug belonged to the
operator's script, which is the worst place for it.

Two more inputs bind the segment to its question:

- `--seed-dir /abs/tree` copies a real tree into the segment workspace before the session opens, so
  a seeded position starts from production bytes, and the seed path lands in the evidence. The copy
  then goes through the production `initWorkspace`, because a workspace is a repository with links
  into the tree that made it, not a directory of files — see `cases/seeded-project.md`. A seed
  without `.git` (a `git archive` export, a copied bundle) is committed as the workspace root first;
  otherwise `initWorkspace` lays the starter skeleton over it, which on 2026-09-13 turned a seeded
  adopted product into one-line placeholders and both conditions measured a rebuild from nothing.
  After `initWorkspace` the script digests every seeded regular file again and refuses the segment
  if one moved; the JSON carries `seed.regularFiles`, `seed.rootCommitted` and `seed.verified`.
- The mounted roster is the authoring roster (`tools` in the JSON). `harness_inspect`,
  `harness_trial`, `correctness_check` and `submit` are controller-owned gates and are not mounted
  (`absentGates`), so an actor that reports "no submit tool" reports the segment shape, not a
  behaviour; a question about reaching submit belongs to `cases/authoring-comparison.md`.
- `--predictions /abs/note.md` embeds them verbatim with their sha256, read before the first turn,
  so adjudication can prove the predictions preceded the behaviour.
- The per-turn wall defaults to production's `BUILDER_TURN_SETTLE_MS` (six hours) and lands in
  `budget.turnTimeoutMs`. The old one-hour default interrupted a natural-condition actor on
  2026-09-13 while its control had finished in 21 minutes, so the pair ran under different walls
  and the interrupted turn's retry started over a half-edited workspace. A shorter wall is an
  explicit part of the condition: pass `--timeout-ms` and state it beside the predictions.

Inspect the copy implementation before relying on it for a toolchain: ordinary recursive copy can
rewrite relative symlinks into absolute paths pointing back at the seed. Prove owned destinations
and the final compiler invocation before opening the actor. Preserve the recorded tests and task
count; replacing them to help startup changes the condition.

The JSON output carries a per-turn **trail**: which step ran, its status, how long it took, what
the provider reported it used, and its tool tally. The aggregate says a segment took twelve minutes;
only the row says which turn took them, and a long turn that called nothing is a different
behaviour from a short turn that called forty tools. The trail records tool names and counts, not
the paths a tool touched — forwarding tool arguments is a one-line change in `build-agent.ts`,
which is source and belongs in the stack — so a `missed` verdict cites the tally plus the workspace
state, not a read list.

The continuation a multi-turn stage receives is this script's own sentence, not production's, whose
continuation carries submit refusals a segment has no gate stack to produce. Say which one the
stage saw; `--continue-file` replaces it.

## Write the actor's kickoff the way production writes it

A stubbed model turn needs no prompt. As soon as a real model plays a role, you must hand it a
kickoff, and a freely written kickoff makes the behaviour belong to your prose. Hand it the
production surfaces instead: `scripts/show-prompt-surfaces.mts` prints them from the run tree's
own exports (`--surface system` for the Builder session contract, `--grep term` to ask which
surface carries a sentence), and `scripts/seed-kickoff.mts` assembles the kickoff, from scratch or
at a seeded position. When the position continues a recorded
session, `scripts/position-packet.mts` supplies its history: the last three to five exchanges
copied from the actor's transcript under a labelled summary. A packet from a Builder transcript
may seed only a Builder, because its tool results carry verifier workshop output. Between them,
no simulation needs to retype a byte of model-visible text.

Production's assembly is the template. `directKickoff` emits the label `USER REQUEST (verbatim)`,
the exact one-liner, the context manifest, then the operating instruction; a climb round appends its
difficulty contract. Mirror it:

1. **Carry the real prompt verbatim**, unedited and unparaphrased, under the same label. A
   rewritten prompt makes every finding untransferable, because the paid run will never see that
   text. It is also the operator's standing rule: one short prompt, no hidden plan bolted on.
2. **State the completed stages as settled fact**, in order: "you researched the domain, authored
   the bundle and adopted it at level 0, and it scored 23/25."
3. **State where the actor stands, and the scope rather than the step**: "the only interface you
   may write this round is `correctness-model/tasks.json`" is legitimate because production imposes
   the same scope. "Decide and take your next action now" is not — production leaves the choice of
   action, its timing and its class to the actor.
4. **Say plainly which stages were skipped and that the position was seeded.** An actor that infers
   it was fast-forwarded behaves differently from one told so, and only the second is reproducible.
5. **Append the contract text production appends, byte for byte**, from the real assembler rather
   than retyped.

`scripts/seed-kickoff.mts` makes rules 1, 4 and 5 structural. It runs the real `directKickoff` over
the verbatim one-liner and the real `prepareUserContext` admission, refuses a position block that
does not open with an exact `SIMULATED POSITION` label, and appends position and contract files byte
for byte, including their trailing whitespace:

```sh
bun .claude/skills/system-path-simulation/scripts/seed-kickoff.mts \
  --prompt-file /abs/one-liner.txt --context /abs/public-context \
  --position-file /abs/simulated-position.txt \
  --append-file /abs/difficulty-contract.txt --out /abs/scratch/kickoff.txt
```

Omit `--position-file` for a from-scratch kickoff. The output feeds `run-segment.mts` directly,
paired with `--seed-dir` pointing at the tree the position block claims the actor is standing in.

## Attribute the behaviour to the text that caused it

A behaviour whose text you cannot name has no owner, and an unowned finding cannot be repaired.
The candidate surfaces are the start prompt and workspace card, the kickoff and any appended stage
contract, one controller-derived steering correction, a continuation at a stop or submit boundary,
a tool description or live tool result, and memory carried from an earlier epoch.

**Your seeded position is a surface too, and the one most likely to be yours rather than the
product's.** If the behaviour appears only while your seed text is present, you measured your own
prose. Re-run with that text removed or moved to a different surface: what survives belongs to the
product. The control is required, not optional, for a finding whose position was authored rather
than derived, or that turned on an imperative in the position.

Use `prompt-surface-census` when the candidate surfaces are not obvious; it derives the
model-visible text with the branch that selects each one. Run 69's judge holds were read as a
distrusted verifier when all eight were wrong, because the binding conventions lived only in
`agent/tools.ts` text the judge is never shown: a real finding with the wrong owner is the same as
no finding.

## Finish

Each steward writes its report to the path it was given; the parent checks every material claim
against the named bytes and resolves the prediction note. A censored condition may remain unresolved.
Record started/completed turns separately from tool calls and submissions, and prove process closure
separately from the session's result. A successful abort or disposal does not prove child absence.
