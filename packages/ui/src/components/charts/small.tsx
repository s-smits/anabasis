import { memo, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { ComparisonBar, SpendPoint } from "../../models.ts";
import { carriedText, MEASURES } from "../../views/campaign-data.ts";
import { money, time } from "../../views/format.ts";
import { ChartContainer, ChartTooltip } from "../ui/chart.tsx";

/*
 * Two compact charts for the Campaign pane: a stacked bar chart breaking down each comparison's
 * won tasks by the measure that carried them (without connecting lines, since the evaluated task
 * set varies across comparisons), and a cumulative spend chart ordered by log move. Both disable
 * animations and memoise on their input arrays.
 */

interface CarriedRow {
  readonly key: string;
  readonly validity: number;
  readonly objective: number;
  readonly bar: ComparisonBar;
}

const ACCENT = "var(--ana-accent)";
const BORDER = "var(--ana-border)";
/** Opacity levels distinguishing validity from objective wins within the single accent colour so
 *  outcome colours retain their dedicated meaning (see `DESIGN.md`). */
const STRENGTH = { validity: 1, objective: 0.6 } as const satisfies Record<(typeof MEASURES)[number], number>;
const MARGIN = { top: 12, right: 16, bottom: 4, left: 0 } as const;

function CarriedTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: CarriedRow }[];
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

/** Renders the legend swatches for the win-carrying measures. */
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

/** Stacked bar chart of won tasks per reported comparison, split by the measure that carried each
 *  win (`carriedBy`). Showing the measure breakdown instead of per-side validity rates reveals
 *  whether gains came from validity or from the objective once validity saturates. Bars remain
 *  disconnected because the evaluated task set changes between comparisons. */
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
  payload?: readonly { payload?: SpendPoint }[];
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

/** Plots cumulative billed cost across moves on an auto-scaled y-axis. Scaling to the full
 *  campaign budget would compress early spend into a flat line along the floor; the budget cap is
 *  shown separately in the card header and hero summary. */
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
