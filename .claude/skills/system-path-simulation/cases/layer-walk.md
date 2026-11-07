# Layer walk

For a change that crosses layers, such as a new field, a renamed tool, a limit or a refusal: name the
one value it moves and follow it from its writer to its last reader, running each layer's owning
test. No model runs.

| layer | where | owning test |
| --- | --- | --- |
| prompt | rendered from source beside each seat | the seat's own test |
| backend | `src/agent/backends/` | `test/backends.test.ts`, `test/claude-backend.test.ts` |
| tool | the harness's tools, `src/builder/tools.ts`, `src/tools/answer.ts` | `test/harness-tools.test.ts`, `test/command.test.ts` |
| wall and root | `src/tools/command.ts`, `src/wall/seat-root.ts` | `test/command.test.ts`, `test/seat-root.test.ts` |
| a whole solve | `src/solver/run.ts` | `test/solve-run.test.ts` (faux provider, real wall and limits) |
| a whole session | `src/builder/session.ts` | `test/builder.test.ts` |
| log event | `src/kernel/log.ts` | the writer's test |
| fold | `src/kernel/task.ts`, `src/kernel/condition.ts`, `src/kernel/compare.ts` | `test/campaign.test.ts`, `test/round.test.ts` |
| reader | `tools/runs/`, `tools/wri/read.ts` | `test/runs-*.test.ts` |

1. Write down the value, the layers it should cross and the reader that shows it last.
2. Run each owning test alone: `bun run test -- test/<file>`.
3. Look hardest at the joins. A join is proven only by a test that runs the real writer against the
   real reader; two tests that each stub the other side prove two halves.
4. A join with no such test is the finding. Write the test, or [rehearse](rehearsal.md) the path and
   then write it.

Joins of this kind are often met first by a script and later by a model. A meter that refuses a
model with no list price stopped the first rehearsal on pi's zero-priced faux provider, and a
relative guide path once left the Builder's edit outside its home.
