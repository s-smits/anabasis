import type { Measures, Tally } from "../../../../src/kernel/compare.ts";
import { short } from "../../../../src/campaign/move.ts";
import type { ComparisonBar, Outcome, Outcomes } from "../models.ts";
import { OUTCOMES } from "./outcome.ts";

// What the Campaign pane reads off its `CampaignReading` before it draws: the chart's slots, its axis
// and the legend's outcome totals. Each reads only what the server sent, so the page and `bun run runs
// view` agree as far as the contract does; the totals count a task once a comparison.

/** The Starter's letter, which it holds by role (`namesOf`), and its name on the page. */
const STARTER_LETTER = "A";
export const STARTER_NAME = "Starter Pack";

export type Slot =
  | {
      readonly kind: "bar";
      readonly key: string;
      readonly bar: ComparisonBar;
      /** What Recharts stacks: each outcome's count, absent at zero, and a comparison with no
       *  report yet as one open column of its scored tasks. */
      readonly values: Partial<Record<Outcome | "open", number>>;
      readonly height: number;
    }
  | { readonly kind: "break"; readonly key: string; readonly setting: string | null };

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100] as const;

export const MEASURES = ["validity", "objective"] as const satisfies readonly (keyof Measures)[];

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

/** A count axis up to `top`: whole numbers from nought at one even step, the last at or above
 *  `top`, about five ticks at most. Recharts left to itself prints 7, 6, 4, 2, 0 on a column of
 *  seven. */
export function countTicks(top: number): number[] {
  const step = STEPS.find((each) => top / each <= 5) ?? Math.ceil(top / 5);
  const last = Math.max(step, Math.ceil(top / step) * step);
  return Array.from({ length: last / step + 1 }, (_, at) => at * step);
}

export function outcomeTotals(bars: readonly ComparisonBar[]): Outcomes {
  const totals = { won: 0, lost: 0, tiedEvery: 0, tiedSome: 0, tiedNone: 0, aside: 0 };
  for (const { outcomes } of bars) {
    if (outcomes === null) continue;
    for (const { outcome } of OUTCOMES) totals[outcome] += outcomes[outcome];
  }
  return totals;
}

export function leftOutText({ leftOut }: Pick<ComparisonBar, "leftOut">): string {
  if (leftOut === null) return "";
  const parts = [
    leftOut.disputed > 0 ? `${String(leftOut.disputed)} disputed` : "",
    leftOut.short > 0 ? `${String(leftOut.short)} short of its solves` : "",
    leftOut.withdrawn > 0 ? `${String(leftOut.withdrawn)} withdrawn while it ran` : "",
  ];
  return parts.filter((part) => part !== "").join(", ");
}

export function tallyText(tally: Tally | null): string {
  if (tally === null) return "no tally";
  return `${String(tally.wins)}–${String(tally.losses)}–${String(tally.ties)}`;
}

/** A sign test's p to three places, or "no test": at two places 0.016 prints as 0.02, the level itself. */
export function pText(p: number | null): string {
  return p === null ? "no test" : `p ${p.toFixed(3)}`;
}

export function carriedText(counts: Measures): string {
  const said = MEASURES.flatMap((measure) =>
    counts[measure] === 0 ? [] : [`${measure} ${String(counts[measure])}`],
  );
  return said.length === 0 ? "none" : said.join(", ");
}

/** A harness as the view, the closing report and promote.ts name it (`calledBy`): the Starter
 *  "Starter A", another its letter and digest's head, "B (f94de8ab)", an unnamed digest its head
 *  alone. Null is the Starter before any event names its digest. */
export function digestText(digest: string | null, names: Readonly<Record<string, string>>): string {
  if (digest === null) return STARTER_NAME;
  const letter = names[digest];
  if (letter === STARTER_LETTER) return STARTER_NAME;
  return letter === undefined ? short(digest) : `${letter} (${short(digest)})`;
}
