#!/usr/bin/env bun
/**
 * How many GitHub Actions runs each workflow started over a window, split by the event that started
 * it, with the first run each made in the window.
 *
 *   bun .claude/skills/local-checks/scripts/actions.ts [--hours 24]
 *
 * A workflow younger than the window shows a first run after its start, so its count is read against
 * the hours it existed. On 30 October 2026 the last day held 113 runs of `mergeable.yml`, 49 of
 * `stacked.yml` in its first 15.5 hours and 4 of `ci.yml`; #543 moved the first two here.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { ghOrThrow } from "#tools/runtime/pulls.ts";

interface Run {
  readonly workflowName: string;
  readonly event: string;
  readonly createdAt: string;
}

/** One line a workflow, most runs first: its count, its count by event, and its first run. */
function tally(runs: readonly Run[]): string[] {
  const names = [...new Set(runs.map((run) => run.workflowName))];
  const rows = names.map((name) => {
    const own = runs.filter((run) => run.workflowName === name);
    const events = [...new Set(own.map((run) => run.event))].map(
      (event) => `${event} ${String(own.filter((run) => run.event === event).length)}`,
    );
    const first = own.map((run) => run.createdAt).sort()[0] ?? "";
    return {
      count: own.length,
      line: `${String(own.length)} ${name} (${events.join(", ")}; first ${first})`,
    };
  });
  return [
    ...rows.sort((a, b) => b.count - a.count).map((row) => row.line),
    `${String(runs.length)} runs in all`,
  ];
}

if (import.meta.main) {
  await runCommand(
    { name: "actions", usage: "actions.ts [--hours 24]", options: { hours: "int" } },
    (args: CommandArgs) => {
      const since = new Date(Date.now() - (args.int("hours") ?? 24) * 3_600_000).toISOString();
      const listed = ghOrThrow(runtimeProcess.cwd(), [
        "run",
        "list",
        "--limit",
        "1000",
        "--created",
        `>=${since}`,
        "--json",
        "workflowName,event,createdAt",
      ]);
      console.log([`since ${since}`, ...tally(parseJsonAs<Run[]>(listed))].join("\n"));
    },
  );
}
