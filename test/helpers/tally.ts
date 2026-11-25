// A report's tallies as a comparison writes them, for tests that write reports by
// hand: the step is read on the frontier and retained differences in pair wins together (`compare.ts`, `readsStep`).

/**
 * The tallies of a report whose scored set is all frontier, each task won or lost by one pair, with
 * an empty retained set and no family named.
 */
export function tallied(wins: number, losses: number, ties: number) {
  const tally = { wins, losses, ties };
  const differences = [
    ...Array.from({ length: wins }, () => 1),
    ...Array.from({ length: losses }, () => -1),
    ...Array.from({ length: ties }, () => 0),
  ];
  return {
    scored: { ...tally, differences },
    frontier: { ...tally, differences },
    retained: "unmeasured",
    families: {},
  };
}
