/** Invocation boundary for an experiment that must keep the adopted product byte-identical: the
 *  agent, the correctness model and the task battery, so the cross-condition comparison that
 *  launches under this policy measures the copied battery and nothing else. */
import type { FullRunArgs } from "./launch-arguments.ts";
import type { NextMove } from "./next-move.ts";

/** Unknown future moves fail the exhaustive switch instead of becoming silently eligible. */
export function fixedProductBoundary(
  policy: FullRunArgs["productPolicy"],
  move: NextMove["move"],
): string | null {
  if (policy !== "fixed") return null;
  switch (move) {
    case "measure":
    case "stop":
      return null;
    case "build":
    case "rebuild":
      return `fixed-product-boundary: --product-policy fixed permits measure or stop; the selector chose ${move}, which changes the product or its battery and requires a separately authorised invocation`;
  }
}
