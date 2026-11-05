#!/usr/bin/env bun
/**
 * Where a comparison's objective gap sits: how far each side's valid answers stand from the best
 * answer on record for each task, its author's (`bests`, `poolOf`).
 *
 *   bun .claude/skills/comparison-reading/scripts/gap.ts <log.jsonl | campaign name>
 *
 * A task score says which side was better and by how much, and nothing of where either stood. One
 * line a comparison gives, for each side, the median over tasks of a task's median ratio to the
 * best (1.00 is the best, and above it is worse whichever way the objective runs), and on how many
 * tasks that side came within the floor of it (`ROOM`). A task with no best on record, or a measure
 * at or below zero, where a ratio says nothing, is counted and left out.
 *
 * Two jobstat campaigns, at commits 11a330c60 and ca526ad1f, read comparisons of different size in
 * their second comparison. The reference stood at 1.15 and 1.54 times the best and the candidate at
 * 1.13 and 1.02, and no reader in the tree said so: a large gap can be a strong candidate or a weak
 * reference, and this is what tells them apart. It describes and decides nothing, and one solve is
 * weak evidence (rule 6), so a median of a few says little.
 *
 * The ratios come from hidden values, so the output is exam-side: it names no task and goes in no
 * seat's message, pull request or paste. Written on 5 November.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type Paired, ROOM } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { lastReports, pairsReported, poolOf } from "#src/kernel/reports.ts";
import { median } from "#src/meta/tally.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

/** One side of one comparison, read against the best on record. */
export interface SideGap {
  /** The median over tasks of a task's median ratio to the best; null where no task gave one. */
  readonly ratio: number | null;
  readonly atBest: number;
  /** The tasks that gave a ratio. */
  readonly read: number;
  /** The tasks the side answered validly that gave none: no best on record, or a measure at or below zero. */
  readonly unread: number;
}

const USAGE = `usage: gap.ts <log.jsonl | campaign name>

Each comparison's two sides against the best answer on record. The output is exam-side.`;

/** What `pairs` read of `side`, against `bests` by task. */
export function sideGap(
  pairs: readonly Paired[],
  side: "old" | "fresh",
  bests: ReadonlyMap<string, number>,
): SideGap {
  const ratios: number[] = [];
  let unread = 0;
  for (const { task, objective } of pairs) {
    const measures = objective?.[side].filter((measure) => measure !== null) ?? [];
    if (measures.length === 0) continue;
    const best = bests.get(task) ?? 0;
    const own = measures.filter((measure) => measure > 0);
    const ratio = median(
      own.map((measure) => (objective?.direction === "lower" ? measure / best : best / measure)),
    );
    if (best > 0 && ratio !== null) ratios.push(ratio);
    else unread += 1;
  }
  return {
    ratio: median(ratios),
    atBest: ratios.filter((ratio) => ratio <= 1 + ROOM).length,
    read: ratios.length,
    unread,
  };
}

/** One line of a side, or that nothing was read. */
function sideLine({ ratio, atBest, read, unread }: SideGap): string {
  const left = unread === 0 ? "" : `, ${String(unread)} unread`;
  if (ratio === null) return `nothing read${left}`;
  return `${ratio.toFixed(2)} x best, at it on ${String(atBest)} of ${String(read)} tasks${left}`;
}

/** One line a comparison whose report tallied pairs under an objective. */
export function gapLines(events: readonly LogEvent[]): string[] {
  const { bests } = poolOf(events);
  return lastReports(events).flatMap((report) => {
    const pairs = pairsReported(events, report);
    if (!pairs.some(({ objective }) => objective !== undefined)) return [];
    const [old, fresh] = [sideGap(pairs, "old", bests), sideGap(pairs, "fresh", bests)];
    return [`${report.session}  reference ${sideLine(old)}  |  candidate ${sideLine(fresh)}`];
  });
}

if (import.meta.main) {
  await runCommand({ name: "gap", usage: USAGE, positionals: 1 }, async ({ positionals }: CommandArgs) => {
    const lines = gapLines(logEvents(await logAcross(positionals[0] ?? "")));
    console.log(lines.length === 0 ? "no comparison tallied under an objective" : lines.join("\n"));
  });
}
