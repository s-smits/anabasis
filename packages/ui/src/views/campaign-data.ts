import type { Share } from "../../../../src/builder/climb.ts";
import type { Tally } from "../../../../src/kernel/compare.ts";
import { short } from "../../../../src/builder/move.ts";
import type { ComparisonBar, Outcome, Outcomes } from "../models.ts";
import { OUTCOMES } from "./outcome.ts";

/*
 * What the Campaign pane reads off its `CampaignReading` before it draws: the comparisons chart's
 * slots, its axis and the outcome totals of the legend. Each is a reading of the reading the server
 * sent, never of a log event, so the page and `bun run runs view` agree as far as the contract does.
 * The totals over all comparisons are the page's own, a derived reading listed in the report of
 * 11 October: they count a task once a comparison.
 */

/** One column of the comparisons chart: a comparison, or the break where the setting changes. */
export type Slot =
  | {
      readonly kind: "bar";
      readonly key: string;
      readonly bar: ComparisonBar;
      /** What Recharts stacks: each outcome's count, absent at zero, and the scored tasks of a
       *  comparison with no report yet as one open column. */
      readonly values: Partial<Record<Outcome | "open", number>>;
      /** The column's height in tasks. */
      readonly height: number;
    }
  | { readonly kind: "break"; readonly key: string; readonly setting: string | null };

/** The chart's columns, in the order of `bars`, with a break column before a comparison whose
 *  setting differs from the one before it. A comparison with no report stands at its scored tasks
 *  as one open column, never at zero. */
export function comparisonSlots(bars: readonly ComparisonBar[]): Slot[] {
  return bars.flatMap((bar, at): Slot[] => {
    const before = bars[at - 1];
    const broken = before !== undefined && before.setting !== bar.setting;
    const values: Partial<Record<Outcome | "open", number>> = {};
    const { outcomes } = bar;
    if (outcomes === null) values.open = bar.tasks;
    else {
      for (const { outcome } of OUTCOMES) if (outcomes[outcome] > 0) values[outcome] = outcomes[outcome];
    }
    const height =
      outcomes === null ? bar.tasks : OUTCOMES.reduce((sum, { outcome }) => sum + outcomes[outcome], 0);
    const column: Slot = { kind: "bar", key: bar.id, bar, values, height };
    return broken ? [{ kind: "break", key: `setting-${bar.id}`, setting: bar.setting }, column] : [column];
  });
}

/** The steps an axis of whole tasks may take, so that its ticks are even and at most about five. */
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100] as const;

/** A count axis up to `top`: whole numbers from nought at one even step, its last tick at or above
 *  `top`, and at most about five ticks. Recharts left to itself prints 7, 6, 4, 2, 0 on a column of
 *  seven. */
export function countTicks(top: number): number[] {
  const step = STEPS.find((each) => top / each <= 5) ?? Math.ceil(top / 5);
  const last = Math.max(step, Math.ceil(top / step) * step);
  return Array.from({ length: last / step + 1 }, (_, at) => at * step);
}

/** Each outcome summed over the comparisons that reported. */
export function outcomeTotals(bars: readonly ComparisonBar[]): Outcomes {
  const totals = { won: 0, lost: 0, tiedEvery: 0, tiedSome: 0, tiedNone: 0, aside: 0 };
  for (const { outcomes } of bars) {
    if (outcomes === null) continue;
    for (const { outcome } of OUTCOMES) totals[outcome] += outcomes[outcome];
  }
  return totals;
}

/** The tasks a comparison's report left out of its split, each kind named, or "" for none. */
export function leftOutText({ leftOut }: Pick<ComparisonBar, "leftOut">): string {
  if (leftOut === null) return "";
  const parts = [
    leftOut.disputed > 0 ? `${String(leftOut.disputed)} disputed` : "",
    leftOut.short > 0 ? `${String(leftOut.short)} short of its solves` : "",
    leftOut.withdrawn > 0 ? `${String(leftOut.withdrawn)} withdrawn while it ran` : "",
  ];
  return parts.filter((part) => part !== "").join(", ");
}

/** A tally as wins, losses and ties: "4–0–3". */
export function tallyText(tally: Tally | null): string {
  if (tally === null) return "no tally";
  return `${String(tally.wins)}–${String(tally.losses)}–${String(tally.ties)}`;
}

/** A sign test's p to two places, or "no test". */
export function pText(p: number | null): string {
  return p === null ? "no test" : `p ${p.toFixed(2)}`;
}

/** Valid answers over solves, as a share; null where nothing was solved. */
export function shareOf(share: Share): number | null {
  return share.solves === 0 ? null : share.valid / share.solves;
}

/** A harness as the campaign's own lines name it: "starter", or its digest cut by `short`. */
export function digestText(digest: string | null, starter: string | null): string {
  return digest === null || digest === starter ? "starter" : short(digest);
}
