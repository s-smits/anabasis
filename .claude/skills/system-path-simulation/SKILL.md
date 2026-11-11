---
name: system-path-simulation
description: "Test an uncertain Anabasis path before a real run walks it: read the record (a reader's one fact, a replay of every log, or a synthetic log in memory), rehearse (the real commands on a seed with scripted seats), or seat a model (a live Examiner session or round from a seed, or rounds of paired seats that tune a prompt or term against one count), each runnable before and after a change, and trace what it finds to the owner that should be fixed, simplified or rewritten. Use to test a join, revisit a recorded position, size a comparison, check what a kill or stop leaves, simulate an open stack's changes before it lands, or tune the Examiner's prompt or terms (cases/optimize.md). Not for reading a finished run (whole-run-investigation) or starting a paid campaign (run-management)."
---

# System path simulation

Use this when a path has to work in the real system and no real actor has walked it yet: a change
crosses a join between two commands, a round is about to be sized, or a blocker is suspected. Take
the cheapest option that can decide the question, and stop there.

A campaign's log is its whole state. A **seed** copies it cut at one event, with the checks or
drafted exam, kept harnesses, Builder notes and Examiner home the cut still names (`seedCampaign`,
`tools/runs/seed.ts`), so any recorded position can be restored and run forward. Keep the source: a
drafted-exam rehearsal reads later tasks from it (`draftedSource`), and a stored pack needs its pack
and sweep on disk.

## Three options

| option | what runs | cost | it answers | it cannot say |
| --- | --- | --- | --- | --- |
| **1. Read the record** | this tree's readers over recorded or synthetic events; nothing is written | seconds | what a fold, a reader or a seat's message makes of a pattern | what a command does from the last event |
| **2. Rehearse** | the real commands, wall, verifier and comparison on a seed, with scripted seats and no Referee | minutes, no model | whether the commands join, and what a position of this size can read | what a model does |
| **3. Seat a model** | the real commands with a real model in one or more seats of a seed | dollars | what a model does from a recorded position | a rate: one seat is one sample |

Say which option you stopped at and why the next was unnecessary. Five cases hold the detail:
[synthetic](cases/synthetic.md) for option 1, [rehearsal](cases/rehearsal.md) for option 2,
[live-seat](cases/live-seat.md) for option 3, [before-after](cases/before-after.md) to run any
option at two commits or over an open stack before it lands, and [optimize](cases/optimize.md) to
repeat that over option 3 in rounds.

## Rules

1. **Write the intent and its rival outcomes first**, in a file in the cycle's or the
   investigation's folder under `.ana/wri/`. Before anything runs, state what the change is meant to
   do and two or three outcomes that could each happen (it moves, it does nothing, it moves the
   other way or moves only a guard), each with its count, its threshold and what it would mean for
   the next step, and read the result against all of them. A check the change makes true by
   construction, such as an added sentence appearing or a removed refusal being gone, is a delivery
   check: report it as what reached the seat, never as a prediction that held. An outcome nobody
   wrote down is itself the finding.
2. **Seed late, and only from a real run.** Cut right before the event in question (`runs seed
   --points` lists them), from a log at rest, under the code the run ran unless the code is the
   variable (`--as-ran`), and state in one line how the seed differs from the nearest real position.
3. **Build a position with the campaign's own commands.** Never append or edit a line by hand, or
   put a harness into `states/`; for a position no run reached, cut earlier and run the real command
   with other flags. Hand-built events stay in memory (the synthetic log).
4. **Write only to a seed.** `rehearse` and `live-seat.ts start` require `seed.json`; production
   commands do not, so name seeds `sim-<what>`.
5. **One variable.** Two rehearsals compare when one flag moved; two commits compare on the same
   input. A tuning series fixes its outline before its first round ([optimize](cases/optimize.md),
   step 5).
6. **Change the position, never the prompt**, unless the prompt is the variable. A live seat runs the
   production command with the production prompt, nothing tells the model what you hope for, and
   nothing in the position or the prompt is arranged so that the hoped-for behaviour is the easy one.
7. **Separate the script's faults from the product's.** When a rehearsal strays, first ask whether
   the script chose a bad answer (stale accept controls, which `tools/c/accept.ts` reports).
8. **Say what did not run**, wherever the result is repeated.
9. **A cleared condition lands in its owning test** in `test/`, which fails without the fix. A join
   is proven only by a test that runs the real writer against the real reader; two tests that each
   stub the other side prove two halves, and a join with no such test is the finding.
10. **Clean up**: `/usr/bin/trash .ana/d2/sim-<what>` once the question is answered. `bun run runs
    retire` deletes a seed idle for a day, unless a paid `harness-builder.ts` launch left a receipt
    in it, in which case it archives the seed under `data/runs/` like a run (`unlaunchedSeed`,
    `tools/runs/receipt.ts`).

Readers and `runs seed --from <name>` resolve names across `ANA_HOSTS`. A seat's records stay on its
host, so every script here takes `--host <name>` and runs there at this tree's published commit
(`.claude/skills/main/cli.ts`).

## 1. Read the record

Use the product's own readers, never a parser of your own. Most questions that sound like a
simulation are one fact a reader already gives:

| the fact | command | writes |
| --- | --- | --- |
| The next move, and what would refuse it | `bun tools/d2/harness-builder.ts --name <name> --dry-run` | nothing |
| Whether a run is alive, and its last act | `bun run runs pulse <name>` | the pulse's state file |
| Supply, and the conditions comparisons ran under | `bun run runs view <name>` | nothing |
| Sessions, parents and readings | `bun tools/wri/wri.ts read --log <log>`, row F and `CHAIN` | nothing |
| Whether the checker stands on its controls | `bun tools/c/accept.ts <pack flags> --name <campaign>` | `checker.read`; run it on a seed |
| What the host still holds of a run | `bun run runs stop <name>` without `--yes` | nothing |

For a fact no command prints, call the readers: `read` (`src/kernel/log.ts`), `taskStates` and
`taskSets` (`src/kernel/task.ts`), `poolOf` (`src/kernel/reports.ts`), `stopRule`
(`src/campaign/admission.ts`) and `conditionsOf` (`src/kernel/condition.ts`). The log holds every
tool call, verdict, condition and `task.proposed` in full, but no prompt: what a model saw is
answered by the tree at its receipt's commit.

`bun run runs replay [<name> ...]` asks whether this tree still reads every recorded log. It first
refreshes its copies of the campaigns other hosts hold, then reads those, the worktrees' logs (seeds
included) and this host's archive through the kernel's folds, printing a refusal in the reader's
words with exit 1; a log being appended to can read torn, so run it again. Run it before a commit
that changes `EVENT_KINDS` or a field a fold reads, after a rebase onto a moved stack, and before
seeding from an old campaign, since `seedCampaign` checks only `read` and `taskSets`. What a reader
does with a pattern no log holds yet is [synthetic](cases/synthetic.md).

## 2. Rehearse

`bun run runs seed` then `bun run runs rehearse` on the seed ([rehearsal](cases/rehearsal.md) has the
forms and what each script reads as). Every seat runs a script on pi's faux provider, so the joins
are real and the behaviour is whatever the script says. It skips models and backends, practice
solves, the Referee (a scripted `fail` waits for `tools/d2/settle.ts`), time pressure and admission
(`admitComparison`, `admitSession`), and is marked by `seed.json`, `(a seed)` in the pulse and
`faux/script` as its model. No mode mixes a live Builder with scripted solves.

## 3. Seat a model

It spends money, so it needs the operator's word naming the seats, model, effort and login, and a
size stated first: the seats, each seat's cap and minutes, and the total. Each seat runs under
`scripts/live-seat.ts start` ([live-seat](cases/live-seat.md)).

| seat | seed cut | command | read by |
| --- | --- | --- | --- |
| An Examiner session | where it should start | `tools/d1b/examine.ts --session x-<n> --examiner <model> --examiner-effort <e> ...` | `live-seat.ts read`, `pairs` |
| A round's solves alone | right after a recorded `build.finished` (`--events`) | the round again with that `--session` | its report |
| A round or campaign stretch | before `build.started`, or at rest | the round or `harness-builder.ts`, every seat's model named | the log's readers |
| One solve of a stored sweep | none | `bun tools/m0/live-solve.ts <pack flags> --task <id> --live` | its verdict |

- **The env file is a path**, passed on and never opened, printed or copied.
- **Size the cap from the record**: the dollars per admission (an Examiner) or per solve (a round)
  the record shows at that position, times the count the seat is read at, and some room above; a
  seat that ends at its cap before the count reads nothing.
- **Seats at once.** Both arms of a pair start together on one host, the one with the most free
  cores (`bun run runs hosts --health`), so that they share its load, each on a login with room for
  the whole seat (`bun run runs usage`): a login that reaches its session limit fails every solve in
  flight. Several pairs spread over the hosts `ANA_HOSTS` lists, one pair a host (`--host <name>`),
  least loaded first (`bun run runs loadwatch --once`), so that no pair reads another's load.
- **A seat is one sample.** It proves a path and measures no rate (rule 6 of `AGENTS.md`); whether a
  change moves a count is [optimize](cases/optimize.md)'s question. Nothing returns to the campaign,
  and a seed shows no climb (`AGENTS.md`, section 10, item 9).

## 4. Carry a finding to its culprit

Before patching a blocking condition or an unforeseen outcome, ask three questions. Is it one
instance of a class? Then fix the owner every path runs through and remove the single patches
([simplify](../simplify/SKILL.md), shape H4). Does the mechanism need to exist, with an owner, a live
reader, a decision it changes and evidence (`AGENTS.md`, rule 13)? If not, remove it instead of
repairing it. Did the simulation need special arrangements (an answer scripted to pass, a skipped
layer, several flags, a second attempt), or has the component turned up in two simulations? A path
that cannot be walked simply, or a mechanism that resists a short explanation, suggests an overbuilt
component. Lines to remove go through simplify, a shape to change through
[commit-r](../commit-r/SKILL.md), a whole part through [system-audit](../system-audit/SKILL.md); the
change is proved by [before-after](cases/before-after.md) on the same logs or seed, every reading
unmoved, with its condition in its owning test (rule 9). None of this takes an operator's decision of
`AGENTS.md` section 3, repairs a rule, check or task, or licenses a change the comparison did not
measure.

## The result

1. The question, and the option and case you stopped at.
2. The seed, its source, its cut and its one line of difference; for a change, both commits.
3. The intent, each written outcome and which one the result matched; delivery checks apart.
4. What did not run.
5. Each condition as `blocking`, `cleared` or `accepted-risk` (with who accepted it), naming its
   smallest fix and its deeper culprit with one verdict (fix the owner, remove, rewrite or none) and
   one sentence a reviewer can check, for "none" too.
6. For option 3, the dollars and minutes billed, every started seat counted as spent.
7. The seeds trashed, or kept and why.
