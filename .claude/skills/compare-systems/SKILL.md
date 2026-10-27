---
name: compare-systems
description: Compare whole solving systems, each a solver inside a harness, on one campaign's held-out tasks, outside the campaign's readings. Answers whether a cheaper solver inside a built harness reaches what a dearer solver reaches inside the starter, and how the harnesses of one domain stand against each other. One script joins production primitives (a seed, the campaign's paid solve in a trial log, the comparison's tally and step rule) and prints one plain reading. Use when the operator asks to compare harnesses, solvers, a cheap model against a dear one, or "can X reach equal scores".
---

# Compare systems

A campaign compares two harnesses under one solver, because its setting fixes the solver
(`AGENTS.md`, section 6). This skill compares **systems**: a solver inside a harness, with both
allowed to differ. Two questions it answers:

- Does a cheaper solver inside a harness its campaign built reach what a dearer solver reaches
  inside the starter? For example `openai-codex/gpt-6.1-terra` inside the promoted harness against
  `claude/claude-opus-5-5` inside the starter.
- How do the harnesses of one domain stand against each other, under one solver?

It promotes nothing and moves no campaign. Its readings are a study's (`studies/README.md`), never
a campaign's step, and they go into no seat's message.

## What it reuses

`scripts/systems.ts` only joins what the campaign already does. Each system opens a **seed** of the
campaign with its own solver and its own trial log (`openCampaign`, the path `close.ts --solve`
takes). It solves through the campaign's paid seat, held at the host's load (`solved`, `gated`), so
every solve has the campaign's checks, limits and wall. It reads each log with the log's folds and
scores each candidate against the baseline with the comparison's own functions: the tally and the sign-flip test (`scored`), the
step rule with the bill and without it (`readsStep`), the least detectable shift (`detectable`) and
the measure that carried each task (`carriedBy`).

Both of a comparison's judges rule every solve. The campaign's checks give each answer its verdict,
and the Referee `--reviewer` names rules every rejection before it counts: one ruled earned is a
fail, and one ruled a check defect or unclear, or left unruled, sets its task aside for every system
(`rejectionAside`), as a comparison's does. At four solves or more the baseline is read against
itself on halves of its solves mirrored in time, the comparison's A/A, which should read no step.

For two harnesses under the campaign's own solver, where the reading feeds a decision about that
campaign, the production checkpoint on a seed reads the same pair with its terms in the log
(`tools/d2/import.ts`, then `tools/d2/checkpoint.ts --reference <digest>`, as
`studies/transitivity/README.md` does).

## The procedure

1. **Seed the campaign.** `bun run runs seed --from <campaign> --name cmp-<what>`. The script refuses
   a folder without `seed.json`, so a real campaign is never written. It reads a campaign that opened
   from a prompt, which every fresh run is.
2. **Write the prediction first**, in `.ana/compare/cmp-<what>/prediction.md`: which system wins, and
   the count that settles it. A comparison whose result will be cited gets a protocol under
   `studies/<name>/README.md` before its first solve.
3. **Read for free.** `--read` opens every system and harness, draws the tasks and solves nothing:
   ```sh
   bun .claude/skills/compare-systems/scripts/systems.ts --seed cmp-<what> \
     --baseline dear=claude/claude-opus-5-5:high@starter \
     --candidate cheap=openai-codex/gpt-6.1-terra:high@promoted --read
   ```
   A seed of a campaign over a stored pack, such as the truss benchmark `round4-veryhard`, names
   that pack by the four flags its launch receipt holds (`--root --sweep --cycle --bundle`).
   A system is `name=model:effort@harness`: a solver at an effort, inside a harness. A harness is
   `starter`, `promoted`, or a whole digest or a letter the seed keeps. A harness from another campaign or
   a handover is first imported into the seed, `bun tools/d2/import.ts --name cmp-<what> --harness
   <dir>`, which copies its programs into a tree beside it, links `.toolchain` to that tree, keeps
   every link as it is, and refuses a harness that does not reopen under its digest. Every run
   checks that each kept harness still reopens under its digest (`keptAs`). The **baseline**
   is the system to beat; each **candidate** (one or more `--candidate`) is read against it.
4. **Solve, on the operator's word.** The same command with `--cap <dollars>`, `--reviewer <model>`
   and without `--read`. It is a paid run (`AGENTS.md`, section 10). The size is tasks times solves
   times systems: 22 tasks, 4 solves and 2 systems are 176 solves, and a Referee session for each
   rejection. Run it from the main checkout, where the logins are,
   on one quiet host. It stops starting solves at the cap. Run it again to go on: each system solves
   only what its own log is still short of, and the Referee rules what is still unruled.
5. **Clean up.** Move the seed and its trial logs to the Trash once the reading is recorded:
   `/usr/bin/trash .ana/d2/cmp-<what> .ana/compare/cmp-<what>`.

## How to read it

The reading prints three blocks.

1. **The tasks.** How many of the seed's held-out tasks were drawn, and under which solver its
   Examiner gated them.
2. **One block a system, on its own.** Valid solves of all solves; tasks where every, some or no solve
   was valid; how many fails were rejections the Referee did not rule earned; dollars billed, per
   solve and per valid answer.
3. **The A/A**, at four solves or more: the baseline's two halves read as two systems. A step there
   is a false positive by construction.
4. **One block a candidate.** Its wins, losses and ties against the baseline; which measure carried the untied
   tasks (validity, the objective, or the bill alone); p in each direction; and one verdict:
   - `X is better`: a step at the level, with the bill and without it, as a campaign reads one.
   - `no step either way`: this size found no difference. It is **no proof of equality**. The line
     gives the smallest share of untied tasks a side must win for this size to show it four times in
     five. "Equal scores" may be claimed only to that resolution.

Say "reaches equal scores" only as: no step either way, at this size, with that detectable share,
and the dollars per valid answer of each system beside it.

## Limits

- **Selection.** The tasks were gated under the campaign's own solver against its references. A
  system with that solver, or that campaign's reference harness, met their selection first. Draw from a
  campaign whose solver is neither system's where the comparison must be fair to both.
- **No person's labels.** The Referee is a model, and its rulings stand until a person labels them;
  the pair block counts the tasks set aside on its rulings.
- **Another campaign's harness** is read under this campaign's contract and answer format. A
  harness built for another exam of the same domain may lose on the format alone.
- **Hidden values.** The trial logs hold them. Keep them under `.ana/compare/`, and keep their
  content out of prompts, pull requests and pastes, as a campaign's log is kept (`AGENTS.md`,
  section 5).
