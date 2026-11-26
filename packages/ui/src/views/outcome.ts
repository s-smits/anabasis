import type { Outcome } from "../models.ts";

/**
 * The six things a scored task comes to, in the one order, label and colour every chart, grid and
 * legend uses (the `--ana-out-*` tokens of `styles.css`); wherever an outcome is drawn, its label
 * or count stands beside the colour.
 */
export const OUTCOMES: readonly {
  readonly outcome: Outcome;
  readonly label: string;
  readonly color: string;
}[] = [
  { outcome: "won", label: "Won", color: "var(--ana-out-won)" },
  { outcome: "lost", label: "Lost", color: "var(--ana-out-lost)" },
  { outcome: "tiedEvery", label: "Tied, reference always valid", color: "var(--ana-out-tied-every)" },
  { outcome: "tiedSome", label: "Tied, reference sometimes valid", color: "var(--ana-out-tied-some)" },
  { outcome: "tiedNone", label: "Tied, reference never valid", color: "var(--ana-out-tied-none)" },
  { outcome: "aside", label: "Set aside for a label", color: "var(--ana-out-aside)" },
];
