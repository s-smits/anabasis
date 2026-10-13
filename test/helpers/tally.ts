// A report's tallies as a comparison writes them since 12 October, for tests that write reports by
// hand: the step is read on the frontier's differences in pair wins (`compare.ts`, `stageOf`).

/**
 * The tallies of a report whose scored set is all frontier, each task won or lost by one pair:
 * the scored set, the frontier the step is read on, a retained set nothing was tallied in, and no
 * family named.
 */
export function tallied(wins: number, losses: number, ties: number) {
  const tally = { wins, losses, ties };
  const differences = [
    ...Array.from({ length: wins }, () => 1),
    ...Array.from({ length: losses }, () => -1),
    ...Array.from({ length: ties }, () => 0),
  ];
  return { scored: tally, frontier: { ...tally, differences }, retained: "unmeasured", families: {} };
}
