---
name: compare-systems
description: Compare a built system with a cheap solver against a bare system with a dear solver, on one campaign's held-out tasks, one solve a task and system, outside the campaign's readings. Answers "can Terra with our truss harness reach Opus", and, when asked, how the harnesses of one domain stand under one solver. One script joins production primitives (a seed, the campaign's paid solve in a trial log, the comparison's tally and step rule) and prints one plain reading. Use when the operator asks to compare models, a cheap model against a dear one, harnesses, or "can X reach equal scores".
---

# Compare systems

Building a harness pays off when a cheap solver in it does what a dear solver does in the starter.
This skill measures that. A **system** is a solver in a harness (`AGENTS.md`, section 14): a **bare
system** has the starter, a **built system** a harness a Builder wrote. The default reading is

```text
bare  = claude/claude-opus-5-5:medium   inside the starter (A)
built = openai-codex/gpt-6.1-terra:high inside the domain's built harness
```

on every held-out task of one campaign, **one solve a task and system**. A campaign cannot make this
reading, because its setting fixes the solver and its comparisons set two harnesses under that one
solver (`AGENTS.md`, section 6). Terra in the starter against Terra in the built harness is that
campaign question again: run it only when the operator asks for it by name.

It promotes nothing and moves no campaign. Its readings are a study's (`studies/README.md`), never
a campaign's step, and they go into no seat's message.

## What it reuses

`scripts/systems.ts` only joins what the campaign already does. Each system opens a **seed** of the
campaign with its own solver and its own trial log (`openCampaign`, the path `close.ts --solve`
takes), and solves through the campaign's paid seat held at the host's load (`solved`, `gated`), so
every solve has the campaign's checks, limits and wall. Each candidate is scored against the
baseline with the comparison's own functions: the tally and the sign-flip test (`scored`), the step
rule with the bill and without it (`readsStep`), the least detectable shift (`detectable`) and the
measure that carried each task (`carriedBy`). The checks give each answer its verdict, and the
Referee `--reviewer` names rules every rejection before it counts: one ruled earned is a fail, and
one ruled a check defect or unclear, or left unruled, sets its task aside for every system
(`rejectionAside`).

## The procedure

1. **Seed the campaign.** `bun run runs seed --from <campaign> --name cmp-<what>`, or for a stored
   pack `--events N` cut before its first release, so every task is still held. The script refuses
   a folder without `seed.json`, so a real campaign is never written. The bare system needs nothing
   more: every seed holds the starter, named `starter` or `A`. Written out, the starter is
   `data/harnesses/starter/bare-harness` in the main checkout, beside every campaign's handover and
   behind the wall of every Builder, Examiner and solve, since the wall refuses the repository's
   worktrees; `writeStarter` (`src/harness/starter.ts`) writes it again. Import the domain's harness
   into the seed for the built system: `bun tools/d2/import.ts --name cmp-<what> --harness <data/harnesses/<run>/harness>`.
2. **Write the prediction first**, in `.ana/compare/cmp-<what>/prediction.md`: which system wins,
   and the count that settles it.
3. **Read for free.** `--read` opens every system and harness, draws the tasks and solves nothing.
   A seed of a stored pack names it by the four flags its launch receipt holds:
   ```sh
   bun .claude/skills/compare-systems/scripts/systems.ts --seed cmp-truss \
     --root <root> --sweep <sweep> --cycle <cycle> --bundle <bundle> \
     --baseline bare-opus=claude/claude-opus-5-5:medium@A \
     --candidate built-terra=openai-codex/gpt-6.1-terra:high@<digest of the truss harness> --read
   ```
   A harness is `starter` (or `A`), `promoted`, or a whole digest or a letter the seed keeps.
4. **Solve, on the operator's word.** The same command with `--cap <dollars>`, `--reviewer <model>`,
   `--login N` for a Claude solver (the login `CLAUDE_CODE_OAUTH_TOKEN<N>`, counted by hand against
   its most), and without `--read`. Run it from a checkout whose `.env` holds the logins, with
   `bun --env-file=<that .env>`, on one quiet host; truss runs where the operator's machine rules put
   it. It stops starting solves at the cap. Run it again to go on: each system solves only what its
   own log is still short of.
5. **Clean up.** Move the seed and its trial logs to the Trash once the reading is recorded:
   `/usr/bin/trash .ana/d2/cmp-<what> .ana/compare/cmp-<what>`.

**Size and price.** Solves are tasks times `--solves` times systems. Price them from the bills of
earlier solves under the same solver on the same pack (`solve.finished.billed`). On the truss pack
`round4-veryhard`, Opus 5.5 at medium in the starter billed $0.63 a solve on average (115 solves,
`truss-141-m3`), and Terra at high $0.08 on the truss campaigns it solved (54 solves), so 25 tasks
once each cost about $16 and $2. `--solves 4` adds the A/A, the baseline read against itself on halves
of its solves mirrored in time, at four times the price; take it only on the operator's word.

## How to read it

1. **The tasks.** How many of the seed's held-out tasks were drawn, and under which solver its
   Examiner gated them.
2. **One block a system, on its own.** Valid solves of all solves; tasks where every, some or no
   solve was valid; fails the Referee did not rule earned.
   **One table for all systems**, on averages a solve: valid solves, cost, wall time, the slowest
   solve and model turns. The cost is the log's whole bill over the solves, the Referee's rulings
   included, so it runs a little over the solves' own. Show the table with the verdict, and quote no
   cost per valid answer. When a system's time is high, split its calls into the model's turns and
   the tools it ran (`solve.call` carries `ms`): a harness whose own programs search up to a
   deadline fills the wall (Terra in the truss harness: 28.1 of 28.6 minutes a solve on 28 October),
   and a slower system is then a harness cost, not a slower model.
3. **The A/A**, only at four solves or more.
4. **One block a candidate.** Wins, losses and ties against the baseline; which measure carried the
   untied tasks (validity, the objective, or the bill alone); p each way; and one verdict:
   - `X is better`: a step at the level, with the bill and without it, as a campaign reads one.
   - `no step either way`: this size found no difference. It is **no proof of equality**, and the
     line gives the smallest share of untied tasks a side must win for this size to show it.

At one solve a task, each task's result rests on one solve a side, and one solve is weak evidence
(`AGENTS.md`, rule 6): say so beside the reading. "Reaches equal scores" is said only as: no step
either way, at this size, with that detectable share, and each system's average cost and time a
solve beside it.

## Limits

- **Selection.** The tasks were gated under the campaign's own solver against its references. A
  system with that solver, or that campaign's reference harness, met their selection first.
- **No person's labels.** The Referee is a model, and its rulings stand until a person labels them.
- **Another campaign's harness** is read under this campaign's contract and answer format. A
  harness built for another exam of the same domain may lose on the format alone.
- **Hidden values.** The trial logs hold them. Keep them under `.ana/compare/`, and keep their
  content out of prompts, pull requests and pastes (`AGENTS.md`, section 5).
