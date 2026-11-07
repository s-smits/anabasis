# One fact

Most questions that sound like a simulation are one fact a reader already gives. Ask it first.

| the fact | command | writes |
| --- | --- | --- |
| The next move, and what would refuse it | `bun tools/d2/harness-builder.ts --name <name> --dry-run` | nothing |
| The sets a log holds | `bun run runs replay <name>` | nothing |
| Whether a run is alive, and its last act | `bun run runs pulse <name>` | the pulse's state file |
| Supply, and the conditions comparisons ran under | `bun run runs view <name>` | nothing |
| Sessions, parents and readings | `bun tools/wri/wri.ts read --log <log>`, row F and `CHAIN` | nothing |
| Whether the checker stands on its controls | `bun tools/c/accept.ts <pack flags> --name <campaign>` | `checker.read` |
| What a solver of a task would be shown | `bun tools/m0/live-solve.ts <pack flags> --task <id>`, without `--live` | nothing |
| What the host still holds of a run | `bun run runs stop <name>` without `--yes` | nothing |

`tools/d2/prepare.ts` releases practice tasks for good, and `tools/c/accept.ts` appends its reading
(and `contract.frozen` with `--freeze`); run them on a seed.

For a fact no command prints, call the product's readers: `read` (`src/kernel/log.ts`), `taskStates`
and `taskSets` (`src/kernel/task.ts`), `poolOf` (`src/kernel/reports.ts`), `stopRule`
(`src/campaign/admission.ts`) and `conditionsOf` (`src/kernel/condition.ts`). The log holds every
tool call (`solve.call`, `build.call`, `exam.call` with `tool` and `args`), every verdict with its
answer, every solve's condition and every `task.proposed` in full. Prompts are rendered from source
at the receipt's commit.

A fact describes the current state. What a command will do next is a seed and a
[rehearsal](rehearsal.md).
