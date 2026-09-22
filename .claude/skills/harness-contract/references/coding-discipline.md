
# Coding discipline

Formerly the `harness-builder-coding-discipline` skill; `harness-contract` owns it.

## Before editing

1. Read `AGENTS.md`, the explicit plan, and the relevant source and tests.
2. Trace definitions and consumers. Do not guess an interface.
3. Name the failure and its owner in `src/meta/owner.ts`.
4. Make the smallest coherent edit at that owner.
5. Prove the changed behaviour where a real consumer uses it.

When the edit changes TypeScript types, constructors, boundary parsing,
fallback models, or error shapes, also read
[types-and-structure.md](coding-discipline/types-and-structure.md).

For async callbacks, subprocess cleanup, union handling or external JSON, read
[runtime-boundaries.md](coding-discipline/runtime-boundaries.md).

Port an outside mechanism only when owner, inputs, trust boundary and output contract match
Anabasis. Newer evidence outranks this document.

## Authority

- One owner per decision and one projection per outward view.
- Add a typed hook to an owner before adding a router, phase machine, or classifier.
- Code owns unobservable facts, decisions where the model is the subject, and values that must stay
  byte-identical. Models own the rest.
- `campaigns/`, `domains/`, runs, claims, and admissions are evidence. Fix their producer; do not
  hand-repair output.
- Do not present an absent future component as integrated.

## Size

The explicit plan and Git history track the work.

New or rewritten files stay at or below 800 nonblank lines, and functions at or below 115 —
formatted lines, since `biome format` owns the breaks at `lineWidth` 110. Copied
files remain at arrival size. If a frozen file must grow, split a new file under the same owner or
obtain an explicit operator exception. Create an owner only when decision authority changes.

## Edit and verify

- Preserve unrelated work. Avoid broad formatting. `bun run lint` / `bun run format` own style.
- Add a test that pins changed behaviour and a hostile or negative gate case.
- Run the affected test first through the repository owner:
  `<repo>/scripts/worktree.sh run <absolute-worktree> bun run test -- test/<name>.test.ts`, with
  an absolute path to the script: a relative path exits 127 when the shell's working directory is
  not the checkout root.
- For a normal source push, let pre-push own the one final gate. Run one manual `bun run gate`
  only for stack composition, a no-push integration boundary or a paid run.
- Report what ran and what remains unproven.

A typecheck, generated type, or export is not integration.

### A small rule-changing fix

The useful part of the former `surgical-pr` skill belongs here. Find the deciding owner and
ask whether deleting or loosening its rule is sufficient before adding a compensating mechanism.
Name the bounds that remain and test legitimate work beside the nearest hostile case. Remove
stranded threading, while keeping vocabulary still required to read historical evidence.
An explicit user line budget remains a constraint; do not invent a ten-line ceiling or let line
count displace an honest fix. `simplify` owns reduction and `stack-hop` owns PR placement and
publication under `AGENTS.md`, including keeping a live run's tree unchanged.

## Owner map

| Failure | Likely owner |
|---|---|
| A valid artifact cannot be expressed | `src/solve/draft-store.ts` or public artifact schema |
| A tool exists but backend cannot call it | tool registration or `src/backends/pi-session.ts` |
| Built Harness lacks task data | public projection or solve capability |
| Plausible wrong artifact passes | verifier or reject controls |
| Correct equivalent artifact fails | representation equivalence |
| Provider or sandbox failure changed score | `NonResultKind` in eval runner |
| Candidate used different tasks | the experiment freeze in `src/run/experiment-freeze.ts` |
| Prompt lesson adds another controller | existing session or evidence owner |
| Generated defect repeats across domains | `starters/`, `vendor/`, or Builder prompt |
| Prose rule has no enforcement | move it to a file the run re-reads |

Name the upstream owner before fixing a downstream symptom.

## Change sequence

1. Reproduce with the smallest stable artifact.
2. Record current behaviour.
3. Trace `producer → projection → consumer → decision`.
4. Decide whether enforcement, capability, identity, or reporting is wrong.
5. Patch the earliest owner that can prevent the bad state.
6. Add a positive case and the nearest hostile case.
7. Rerun invalidated consumers and inspect the final Git diff.

## Completion

For a provider dependency upgrade, exercise its real tool, cancellation, compaction and model
selection consumers. Catalogue changes can invalidate an old test effort; preserve the refusal and
use a supported condition for the positive probe. Read runtime versions from installed package
metadata and retire catalogue shims when upstream owns the entry. Carry upstream compatibility
defaults through the actual transport; opt-in endpoint settings are not universal launch flags.

Call a change complete only when a live consumer uses it, the negative proof fires, identities name
the new condition, and the reported claim matches the executed scope.
Otherwise report `present`, `partial`, or awaiting integration.
