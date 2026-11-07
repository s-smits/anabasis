---
name: compare-systems
description: Compare a built system with a cheap solver against a bare system with a dear solver on one campaign's held-out tasks, outside the campaign's readings. Answers "can Terra with our truss harness reach Opus" and, when asked, how one domain's harnesses stand under one solver. One script joins production primitives and prints one plain reading. Use when the operator asks to compare models, a cheap model against a dear one, harnesses, or "can X reach equal scores".
---

# Compare systems

A harness pays off when a cheap solver inside it matches a dear solver inside the starter. A
campaign cannot read this, since its setting fixes the solver, so this skill reads it on one
campaign's held-out tasks, by default one solve per task and system:

```text
bare  = claude/claude-opus-5-5:medium   inside the starter (A)
built = openai-codex/gpt-6.1-terra:high inside the domain's built harness
```

Terra against Terra is the campaign's own question, run only when named. The reading is a study's
(`studies/README.md`) and reaches no seat.

`scripts/systems.ts` only joins production. Each system opens a seed with its own solver and trial
log (`openCampaign`, as `close.ts --solve` does) and solves through the paid seat under the load
gate (`solved`, `gated`), with the campaign's checks, limits and wall. Candidates are scored against
the baseline by `scored`, `readsStep` without the bill, `detectable` and `carriedBy`; the
`--reviewer` Referee rules each rejection, and one not ruled earned sets its task aside for every
system (`rejectionAside`).

## The procedure

1. **Seed**: `bun run runs seed --from <campaign> --name cmp-<what>`, with `--events N` to cut a
   stored pack before its first release or at a `comparison.started`. The script refuses a folder
   without `seed.json`. The starter is `starter` or `A`; import the built harness with
   `bun tools/d2/import.ts --name cmp-<what> --harness <data/harnesses/<run>/harness>`.
2. **Predict** the winner and its settling count in `.ana/compare/cmp-<what>/prediction.md`.
3. **Read for free**: `--read` draws the tasks and solves nothing. A stored pack's seed takes its
   receipt's four flags:
   ```sh
   bun .claude/skills/compare-systems/scripts/systems.ts --seed cmp-truss \
     --root <root> --sweep <sweep> --cycle <cycle> --bundle <bundle> \
     --baseline bare-opus=claude/claude-opus-5-5:medium@A \
     --candidate built-terra=openai-codex/gpt-6.1-terra:high@<digest of the truss harness> --read
   ```
4. **Solve, on the operator's word**: drop `--read`, add `--cap <dollars>`, `--reviewer <model>` and,
   for a Claude solver, `--login N`, counted by hand against that login's cap. Run under
   `bun --env-file=<.env with the logins>` on one quiet host (truss where the machine rules place
   it). Rerunning solves only what each log lacks.
5. **Clean up**: `/usr/bin/trash .ana/d2/cmp-<what> .ana/compare/cmp-<what>`.

Price solves from earlier `solve.finished.billed` of the same solver and pack. `--solves 2` adds the A/A at twice the price, on the operator's word only.

## How to read it

Report the tasks drawn and which solver's Examiner admitted them; each system alone (valid over
solves, tasks valid on every, some or no solve, fails not ruled earned); one table per solve of
valid share, cost (the whole bill, rulings included), wall time, slowest solve and turns, with no
cost per valid answer; the A/A at two or more solves; and per candidate the wins, losses, ties,
carrying measure, p each way and one verdict: `X is better` (a step without the bill) or `no step
either way`, which is no proof of equality and comes with the smallest winning share this size could
show. Split high wall time into model turns and tool time (`solve.call` carries `ms`).

One solve a side is weak evidence (rule 6). "Reaches equal scores" means only no step either way at
this size, with the detectable share and each system's cost and time beside it.

## Limits

- Tasks were admitted against the campaign's own solver and references.
- The Referee is a model until a person labels it.
- Another campaign's harness meets this contract's format; compare formats first.
- A harness may rely on the host's `python3`, so keep one question on the host it was built on
  (`bun run runs source` shows what a launch found).
- Trial logs hold hidden values: keep them under `.ana/compare/` and out of prompts, pull requests
  and pastes.
