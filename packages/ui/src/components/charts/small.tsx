import { memo, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { ComparisonBar, SpendPoint } from "../../models.ts";
import { carriedText, MEASURES } from "../../views/campaign-data.ts";
import { money, time } from "../../views/format.ts";
import { ChartContainer, ChartTooltip } from "../ui/chart.tsx";

/*
 * The Campaign pane's two small charts. Each comparison's won tasks by the measure that carried each,
 * one column a comparison and no line between comparisons, since the scored tasks change from one to
 * the next; and the dollars billed, summed over the moves in log order. Neither animates, and each
 * is memoised on the reading's arrays.
 */

interface CarriedRow {
  readonly key: string;
  readonly validity: number;
  readonly objective: number;
  readonly bill: number;
  readonly bar: ComparisonBar;
}

const ACCENT = "var(--ana-accent)";
const BORDER = "var(--ana-border)";
/** Every column counts won tasks, so each is drawn in the won colour, a measure apart by its
 *  strength: the colours of outcomes mean nothing else (DESIGN.md). */
const STRENGTH = { validity: 1, objective: 0.6, bill: 0.3 } as const satisfies Record<
  (typeof MEASURES)[number],
  number
>;
const MARGIN = { top: 12, right: 16, bottom: 4, left: 0 } as const;

function CarriedTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CarriedRow }>;
}) {
  const row = payload?.[0]?.payload;
  const carried = row?.bar.carried ?? null;
  if (active !== true || row === undefined || carried === null) return null;
  return (
    <div className="ana-chart-tooltip">
      <strong>{row.key}</strong>
      <span className="ana-num">Won on {carriedText(carried.won)}</span>
      <span className="ana-num">Lost on {carriedText(carried.lost)}</span>
    </div>
  );
}

/** The three measures' swatches, named. */
export function CarriedKey() {
  return (
    <ul className="ana-legend-list">
      {MEASURES.map((measure) => (
        <li key={measure}>
          <span
            aria-hidden
            className="ana-swatch"
            style={{ background: ACCENT, opacity: STRENGTH[measure] }}
          />
          <span>{measure}</span>
        </li>
      ))}
    </ul>
  );
}

/** Each reported comparison's won tasks, one column a comparison split by the measure that carried
 *  each win (`carriedBy`). Until 30 October this place held each side's valid share, which read
 *  100% on both sides in every comparison of a campaign that promoted six times on the objective
 *  and the bill; the split says what the wins were made of. Columns stand apart, never joined,
 *  since the scored tasks change from one comparison to the next. */
export const CarriedChart = memo(function CarriedChart({ bars }: { bars: readonly ComparisonBar[] }) {
  const rows: CarriedRow[] = useMemo(
    () => bars.flatMap((bar) => (bar.carried === null ? [] : [{ key: bar.id, ...bar.carried.won, bar }])),
    [bars],
  );
  return (
    <ChartContainer>
      <BarChart accessibilityLayer data={rows} margin={MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="key" interval={0} tickLine={false} axisLine={{ stroke: BORDER }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip
          cursor={{ fill: "var(--ana-card-2)" }}
          isAnimationActive={false}
          content={<CarriedTooltip />}
        />
        {MEASURES.map((measure) => (
          <Bar
            key={measure}
            name={measure}
            dataKey={measure}
            stackId="won"
            fill={ACCENT}
            fillOpacity={STRENGTH[measure]}
            isAnimationActive={false}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
});

function SpendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: SpendPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined) return null;
  return (
    <div className="ana-chart-tooltip">
      <strong>{point.move}</strong>
      <span className="ana-num">{money(point.cumulative)} billed by its end</span>
      <small>{time(point.at)}</small>
    </div>
  );
}

/** The dollars billed over the moves, on an axis of the spend itself. Until 30 October the axis
 *  ran to the campaign's budget, so a campaign $34 into $800 drew a flat line on the floor, and
 *  each step was held to the next move, so the last showed as a hook at the edge; the budget is in
 *  the card's head and the hero. */
export const SpendChart = memo(function SpendChart({ spend }: { spend: readonly SpendPoint[] }) {
  return (
    <ChartContainer>
      <AreaChart accessibilityLayer data={[...spend]} margin={MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="move" tickLine={false} axisLine={{ stroke: BORDER }} minTickGap={16} />
        <YAxis
          domain={[0, "auto"]}
          tickFormatter={(value: number) => `$${value.toFixed(Number.isInteger(value) ? 0 : 2)}`}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <ChartTooltip cursor={{ stroke: BORDER }} isAnimationActive={false} content={<SpendTooltip />} />
        <Area
          dataKey="cumulative"
          type="linear"
          stroke={ACCENT}
          strokeWidth={2}
          fill={ACCENT}
          fillOpacity={0.1}
          isAnimationActive={false}
          dot={{ r: 2, fill: ACCENT, strokeWidth: 0 }}
          activeDot={{ r: 4, fill: ACCENT, stroke: "var(--ana-card)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ChartContainer>
  );
});
