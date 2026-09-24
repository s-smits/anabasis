# Seed a recorded campaign and run one real controller round

**Use this case when:** the question is what one slot (usually the Builder) does from a recorded
position through the real controller: selector, build step, submit, census, solvability, adoption,
measurement and analysis, with the other slots scripted or off. It sits between `live-segment`
(one session, no controller) and `fullrun-conditions` (a whole `fullrun` through the CLI).

This is the shape every steward built by hand between 7 and 10 September: a seed clone with a
bespoke byte verifier, a fabricated product pointer, a `deps.build` interception, a SIGTERM wall,
a `ps` census, a preregistration freeze and a post-actor host panel, each written four times and
each carrying its own setup fault (an absolute toolchain path that invalidated a condition, a
snapshot seed without `conformance.json`, a probe that looked for `.toolchain` in the wrong place).
Four scripts own those pieces now. A condition that hand-writes any of them again is measuring
its own helper.

## The three scripts and the interface they use

| Step | Script | What it owns |
| --- | --- | --- |
| Seed | `scripts/seed-campaign.mts` | clone a recorded campaign into a fresh tree (same slug) or republish its selected product under a new slug in this tree; symlink and absolute-path audit; history, claims and admission carried through the production writers; `seed.json` |
| Run | `scripts/run-condition.mts` | `runFullRun` in this tree over the seeded slug with each slot `live`, a scripted module or `capture`; wall; sampled process census; preregistration digest; `report.json` |
| Probe | `scripts/host-panel.mts` | valid, equivalent and hostile artifacts for one task through `runControls` on the real verifier host; fingerprint before and after; `report.json` |

The interface is `HarnessBuildOptions.builderRuntime` in `src/run/harness-build.ts`. Production binds
`productionBuilderRuntime`; the runner binds a scripted session there, so every byte after the
session's `submit` call is the production path: candidate validation, census, solvability,
publication and selection. The CLI exposes no scripted backend, and `test/full-run-scripted-loop.test.ts`
proves the whole loop with no provider on the uppercase fixture. Read that test before writing
a scripted turn: it is the smallest complete round.

## Procedure

1. **Choose the position from a recorded run** (`past-run-replay`), and state the delta to it in
   one line. Seed with `seed-campaign.mts`. Mode 1 (`--into-root`) keeps the slug and seeds a
   fresh tree for a whole-run condition; mode 2 (`--as-slug`) puts the product into this tree under a fresh
   slug so the controller can continue it here. Read `seed.json`: an escaping symlink or an
   absolute reference to the source root is a refusal, not a warning; `--relocate` changes
   candidate bytes and records both fingerprints, so a relocated seed is a different candidate.
2. **Capture before you spend.** `run-condition.mts --builder capture` opens the seeded slug's
   real epoch, records the system prompt digest, the roster and the first prompt, and throws
   before any provider work. That is the preregistered production projection for this exact
   position, with no path rewriting. Hash it with the predictions.
3. **Write the predictions** (`predictions.mts --hash`) with C and D, the falsifiers and the
   conditions not run. Nothing in them reaches the actor.
4. **Run.** `--builder live` needs `--wall-ms`; `--built` and `--review` stay scripted or off
   unless the question needs them. Bound the round with `--max-iterations` and `--max-builder-turns`.
   The report records the admitted arguments, the rounds, the terminal, the battery run ids, the
   wall state and the sampled descendants still present at close.
5. **Probe the final bytes** with `host-panel.mts` over the accepted snapshot or the selected
   product: one task, a known-correct accept control, small mutations of it. Exit 1 is the
   panel's verdict; read `report.json` for the row that disagreed.
6. **Resolve** every prediction with `predictions.mts --resolve`, and report operational closure,
   semantic verdicts and prediction resolution separately.

## What it proves

A scripted-slot condition proves mechanism: the joins ran and wrote their evidence. A live slot
adds one model's behaviour under the requested pins, which the report records as requested; the
served identity stays whatever the runtime returned. Admission, a compiler exit and a passing
panel each prove their own condition, not domain correctness. A relocated or republished seed is
the same product only for the bytes the fingerprint covers.

## Finish

Report the seed manifest, the capture digest, the condition report and the panel report by path,
the prediction resolutions, and which slots were live, scripted or off.
