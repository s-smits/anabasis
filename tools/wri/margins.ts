/**
 * Lanes 28 and 29: whether a chain of promotions adds up against the starter, and whether an
 * objective-only step won by more than the reference's own noise.
 *
 * Each promotion is read against its parent, so a chain of them can each win and still fail to beat
 * the starter on tasks that did not choose any of them. A starter read mixes three kinds of task
 * (`starterReads`, `src/campaign/climb.ts`), and only the tasks written after the promotion are new
 * to the promoted harness; those are also written by an Examiner that reads the reference's outcomes
 * (`src/examiner/record.ts`), so they may lean against the reference and not the starter. Summed over a
 * campaign's reads, a reference that loses more than it wins there is what lane 28 separates: margin
 * noise selected for, the Examiner's aim, or a worse harness.
 *
 * A step whose untied tasks all tie on validity is carried by the objective alone, and each of its
 * wins is a margin between two valid answers. Each side read against itself under the same setting,
 * rebuilt from its solves (`pairsReported`), gives on a task whose halves tied on validity the
 * margin two solves of one harness reach by chance there; a win no larger than the wider of the two
 * on its own task is inside that noise (lane 29). A task a side's halves split on validity scores
 * up to 600 points, which no win between valid answers can reach (`WEIGHTS`), so it sets no
 * ceiling. Scores are read under this tree's rule (`differenceOf`). Both decide nothing.
 */
import { ORIGINS, type Origin, starterReads } from "#src/campaign/climb.ts";
import { differenceOf, pointsOf } from "#src/kernel/compare.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { fired, type Index, share, summed, type Trigger, wlt } from "./folds.ts";

const [CHOSEN, BEFORE, AFTER] = ORIGINS;

/** `CHAIN AGAINST THE STARTER` (lane 28): two or more starter reads whose tasks written after their
 *  promotions the reference lost more often than it won, summed over the reads. */
export function chainTrigger(log: Index): Trigger[] {
  const reads = starterReads(log.events);
  if (reads.length < 2) return [];
  const of = (origin: Origin) => summed(reads.map(({ origins }) => origins[origin].whole));
  const after = of(AFTER);
  if (after.losses <= after.wins) return [];
  const each = reads.map(({ session, origins }) => `${session} ${wlt(origins[AFTER].whole)}`);
  const alone = (reading: string) => reads.filter(({ after: read }) => read === reading).length;
  return [
    fired(
      "CHAIN AGAINST THE STARTER",
      `the reference's wins, losses and ties against the starter on tasks written after its promotion, oldest read first: ${each.join(", ")}; summed ${wlt(after)}, on tasks written before and not chosen on ${wlt(of(BEFORE))}, on the tasks that chose the harness ${wlt(of(CHOSEN))}; on the tasks written after alone, ${share(alone("a step"), reads.length)} reads a step and ${String(alone("a step for the starter"))} a step for the starter`,
    ),
  ];
}

/** `MARGINS INSIDE THE NOISE` (lane 29): each step whose untied tasks all tie on validity and more
 *  than half of whose wins are no larger than the wider of the two sides' own differences on the
 *  same task, each side read against itself where its halves tied on validity. A win on a task both
 *  sides repeated exactly is the difference of two repeated answers, where no split of either side
 *  shows noise (`repeatLine`, `src/campaign/climb.ts`), and is not counted inside: until
 *  11 November a win where the A/A alone tied was told as clear of a zero difference only, and 62 of
 *  the 121 objective-only steps on record fired on that count, in 61 of them on tasks the new side
 *  repeated exactly too. The new side's own difference bounds a win as the reference's does, which
 *  the reference's alone left out. */
export function marginTrigger(log: Index): Trigger[] {
  const lines = lastReports(log.events).flatMap((report) => {
    if (report.data.reading !== "step") return [];
    const untied = pairsReported(log.events, report).filter((pair) => differenceOf(pair) !== 0);
    if (untied.length === 0 || untied.some((pair) => pointsOf(pair).validity !== 0)) return [];
    const own = (side: "old" | "fresh") =>
      new Map(
        pairsReported(log.events, report, side)
          .filter((pair) => pointsOf(pair).validity === 0)
          .map((pair) => [pair.task, Math.abs(differenceOf(pair))]),
      );
    const [reference, candidate] = [own("old"), own("fresh")];
    if (reference.size === 0) return [];
    const wins = untied.filter((pair) => differenceOf(pair) > 0);
    const inside = wins.filter(
      (pair) =>
        differenceOf(pair) <= Math.max(reference.get(pair.task) ?? -1, candidate.get(pair.task) ?? -1),
    ).length;
    return inside * 2 > wins.length
      ? [
          `${report.session} won ${share(inside, wins.length)} by no more than the wider of the two sides' own differences on the same task where validity tied`,
        ]
      : [];
  });
  return lines.length > 0 ? [fired("MARGINS INSIDE THE NOISE", lines.join("; "))] : [];
}
