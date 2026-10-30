#!/usr/bin/env bun
/**
 * Show the held-out pool and task set a comparison would select now.
 *
 *   bun .claude/skills/comparison-reading/scripts/draw.ts <log.jsonl | campaign name>
 *     [--target <n>] [--level <n>]
 *
 * Use this to inspect a held-short refusal or a draw below its target. poolOf supplies the pool;
 * scoredSet selects tasks under the frozen contract. tasksByEpoch groups frontier tasks, while
 * comparisonFloor, refusals, supplyOf and sizeLines explain admission and sample size. The default
 * target and level come from planOn, as in the run view; flags override them for this inspection.
 *
 * Output contains counts and refusal codes, without task identities. Stored-pack tasks have no
 * admission epoch in tasksByEpoch, so they do not enter the epoch-based draw. This reports the
 * production behaviour rather than constructing another draw.
 *
 * Written on 30 October, when AGENTS.md section 7 moved into comparison-reading.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { comparisonFloor, refusals, supplyOf } from "#src/campaign/admission.ts";
import { tasksByEpoch } from "#src/campaign/climb.ts";
import { scoredSet } from "#src/campaign/round.ts";
import { frozenChecker } from "#src/kernel/acceptance.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { keyIfNotNull } from "#src/meta/optional-key.ts";
import { poolOf } from "#src/kernel/reports.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { plural } from "#src/meta/text.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { planOn } from "#tools/runs/view.ts";

const USAGE = `usage: draw.ts <log.jsonl | campaign name> [--target <n>] [--level <n>]

The held-out pool by its parts, the set the next comparison would score, and admission's reading.`;

/** What a comparison starting now on `events` would score at `target`, and the pool it draws from. */
export function drawOf(events: readonly LogEvent[], target: number, contract: string) {
  const pool = poolOf(events);
  const { tasks, retained } = scoredSet(events, target, contract);
  const epochs = tasksByEpoch(events);
  // Each scored frontier task by the epoch task admission held it in, newest first.
  const byEpoch = epochs
    .map((epoch, at) => ({
      nth: at + 1,
      drawn: epoch.filter((task) => tasks.includes(task) && !retained.includes(task)).length,
    }))
    .toReversed()
    .filter(({ drawn }) => drawn > 0);
  return {
    pool: {
      scorable: pool.scorable.length,
      frontier: pool.frontier.length,
      exhausted: pool.exhausted.length,
      retained: pool.retained.length,
      awaiting: pool.awaiting.length,
      practiceFrontier: pool.practiceFrontier.length,
    },
    scored: tasks.length - retained.length,
    retained: retained.length,
    byEpoch,
    epochs: epochs.length,
  };
}

/** The lines this script prints for `events`. */
export function drawLines(
  events: readonly LogEvent[],
  values: { target?: number; level?: number } = {},
): string[] {
  const plan = planOn(events);
  const target = values.target ?? plan.wanted.target;
  const level = values.level ?? plan.wanted.level;
  const drawn = drawOf(events, target, frozenChecker(events)?.contract ?? "");
  const { pool } = drawn;
  const refused = refusals(supplyOf(events), { target, level, pastStop: plan.pastStop ?? undefined });
  return [
    `held-out pool: ${String(pool.scorable)} scorable (${String(pool.frontier)} frontier, ${String(pool.retained)} retained, of which ${String(pool.exhausted)} exhausted), ${String(pool.awaiting)} awaiting task review and left out; ${String(pool.practiceFrontier)} on the reference's own frontier for practice`,
    `next comparison at target ${String(target)}: ${plural(drawn.scored, "frontier task")} and ${plural(drawn.retained, "retained task")} (one for every three frontier)`,
    `frontier by epoch, newest first: ${drawn.byEpoch.map(({ nth, drawn: count }) => `epoch ${String(nth)} of ${String(drawn.epochs)}: ${String(count)}`).join(", ") || "none from task admission"}`,
    `admission at level ${String(level)}: a floor of ${String(comparisonFloor(level))} frontier tasks; ${refused.length === 0 ? "no refusal" : `refused ${refused.map(({ code }) => code).join(", ")}`}`,
    ...sizeLines(drawn.scored, { level }),
  ];
}

if (import.meta.main) {
  await runCommand(
    { name: "draw", usage: USAGE, options: { target: "int", level: "text" }, positionals: 1 },
    async (args: CommandArgs) => {
      const [named = ""] = args.positionals;
      const level = args.value("level");
      const target = args.int("target");
      console.log(
        drawLines(logEvents(await logAcross(named)), {
          ...keyIfNotNull("target", target),
          ...keyIfNotNull("level", level === null ? null : Number(level)),
        }).join("\n"),
      );
    },
  );
}
