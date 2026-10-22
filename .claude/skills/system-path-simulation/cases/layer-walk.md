# Layer walk

For a change that crosses layers: a new field, a renamed tool, a limit, a refusal. Name the one
value the change moves and follow it from where it is written to where it is last read. No model
runs.

## The layers

| layer | where | its real-thing test |
| --- | --- | --- |
| prompt | rendered from source beside each seat | the seat's own test |
| backend | `src/agent/backends/` | `test/backends.test.ts`, `test/claude-backend.test.ts` |
| tool | the harness's tools, `src/builder/tools.ts`, `src/tools/answer.ts` | `test/harness-tools.test.ts`, `test/command.test.ts` |
| wall and root | `src/tools/command.ts`, `src/wall/seat-root.ts` | `test/command.test.ts`, `test/seat-root.test.ts` |
| a whole solve | `src/solver/run.ts` | `test/solve-run.test.ts`: a solve on pi's faux provider, under the real wall and solve limits |
| a whole session | `src/builder/session.ts` | `test/builder.test.ts` |
| log event | `src/kernel/log.ts` | the writer's test |
| fold | `src/kernel/task.ts`, `src/kernel/condition.ts`, `src/kernel/compare.ts` | `test/campaign.test.ts`, `test/round.test.ts` |
| reader | `tools/runs/`, `tools/wri/read.ts` | `test/runs-*.test.ts` |

## The walk

1. Write the value and the layers it should cross, and which reader shows it last.
2. At each layer run the owning test alone: `bun run test -- test/<file>`.
3. Look hardest where two layers meet. A join is proven only by a test that runs the real writer
   against the real reader. Two tests that each stand in for the other side prove two halves.
4. A join with no such test is the finding. Write the test, or rehearse the round that crosses it
   ([rehearsal](rehearsal.md)) and then write the test.

## Two joins the first rehearsals found by walking

- **A scripted model and the meter.** The meter (`src/kernel/meter.ts`) refuses to run a model
  priced at zero, since a free model would be read as a free solve. pi's faux provider is priced at
  zero. No test met the two together, so the first rehearsal died at its first turn with
  `faux/script has no list price to freeze`.
- **The walled shell and the home.** On 8 October 2026 a relative guide path missed the Builder's
  home, the harness kept its parent's digest, and the round read `no-change`. Shell commands with
  no staged files now start in the seat's home (`runWalled`, `src/tools/command.ts`). The script names the guide
  through `"$HOME/harness/agent/BUILT_AGENTS.md"` (`scriptedBuilder`).

Both were the script's to mend. Both are also what a model meets, which is why they were worth
walking.
