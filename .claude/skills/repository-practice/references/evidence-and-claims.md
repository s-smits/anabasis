# 9. Status, evidence and claims

Read this before stating an evidence level or claiming a step, mechanism or refusal. This expands
`AGENTS.md` section 9.

Read `attribution-and-proof`, which owns what one reading may show, before any sentence claims that
a harness, a model or a patch improved something. What follows holds for every statement.

## The ladder

The levels are listed in `AGENTS.md` section 9. Each describes the evidence, not the effort: a part
Present in source still needs a test with its nearest hostile case, a replay or a rehearsal to be
Proved without a model, and an event in a real run's log to be Exercised live.

None stands in for the next. `docs/plan.md` keeps each part's level, and a pull request names the
level it moves; keep no second status list anywhere.

## Evidence

```text
events in a campaign's log  >  a fold over the log  >  source and tests  >  a command's printed line
                            >  a pull request's text  >  an agent's account
```

- A prompt assertion proves text, a type a shape, a test the conditions it tested, a rehearsal that
  the path runs; none proves a model behaves better. A suite passing on one operating system says
  nothing of the other's wall.
- A Referee's ruling is a model's output, apart from the verifier's verdict and the environment's
  facts. An agent's report is a lead until checked ("Reviews and subagents", in
  `working-in-the-repository.md`).
- A run is evidence about the code it ran and no other. Read side by side, or triage from, only runs
  whose every launch held the mechanism (`bun run runs source --has <text>` or `--holds <commit>`,
  `ranWith`), named by text its code holds since a restack rewrites commits. A run without it is no
  evidence either way.

Before claiming that a capability is absent ("nothing checks X"), inspect its symbol, callers and a
relevant check in the same turn. An incorrect absence claim can lead later work to add a mechanism
that already exists.

## What may be claimed

| Claim | Requires |
| --- | --- |
| A step | A comparison that read `step`, named with its setting, tasks, solves per side, level, budget and starter. It promotes on one draw, with its A/A beside it; the word stands unqualified once a later fresh reading of the pair holds it |
| No step | The same naming and the test's size: no gain found at this size, nothing about equality |
| A mechanism | The event it writes, in a live run's log, where its trigger occurred |
| A refusal | Its text, which establishes its own condition and nothing about the answers |
| Which part of a harness did it | A standalone comparison against the programs ablation `programs-of:<digest>` |

A step supports a claim under its recorded condition only. `attribution-and-proof` defines the
limits and separate outcome counts. Give every rate its denominator. Results across campaigns
or settings may be described side by side, but cannot establish a measured gain over one another.