import { memo, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  type DotItemDotProps,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { keyIfDefined } from "../../../../../src/meta/optional-key.ts";
import type { ComparisonBar, SpendPoint } from "../../models.ts";
import { shareOf } from "../../views/campaign-data.ts";
import { money, time } from "../../views/format.ts";
import { ChartContainer, ChartTooltip } from "../ui/chart.tsx";

/*
 * The Campaign pane's two small charts. Each side's share of valid answers in each comparison, as
 * two dots a comparison and no line between comparisons, since the scored tasks change from one to
 * the next; and the dollars billed, summed over the moves in log order, against the campaign's
 * total. Neither animates, and each is memoised on the reading's arrays.
 */

interface ShareRow {
  readonly key: string;
  readonly old: number | null;
  readonly fresh: number | null;
  readonly bar: ComparisonBar;
}

const ACCENT = "var(--ana-accent)";
const BORDER = "var(--ana-border)";
const SIDES = [
  { side: "old", label: "Reference", color: "var(--ana-out-tied-every)", shift: -4 },
  { side: "fresh", label: "New harness", color: ACCENT, shift: 4 },
] as const;
const MARGIN = { top: 12, right: 16, bottom: 4, left: 0 } as const;
const PERCENT = (value: number) => `${String(Math.round(value * 100))}%`;

function ShareTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ShareRow }>;
}) {
  const row = payload?.[0]?.payload;
  const valid = row?.bar.valid ?? null;
  if (active !== true || row === undefined || valid === null) return null;
  return (
    <div className="ana-chart-tooltip">
      <strong>{row.key}</strong>
      {SIDES.map(({ side, label }) => (
        <span key={side} className="ana-num">
          {label}: {valid[side].valid} of {valid[side].solves} solves valid
        </span>
      ))}
    </div>
  );
}

/** The two sides' dots, named. */
export function ShareKey() {
  return (
    <ul className="ana-legend-list">
      {SIDES.map(({ side, label, color }) => (
        <li key={side}>
          <span aria-hidden className="ana-swatch is-dot" style={{ background: color }} />
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Each side's valid share in each comparison that reported. */
export const ValidShareChart = memo(function ValidShareChart({ bars }: { bars: readonly ComparisonBar[] }) {
  const rows: ShareRow[] = useMemo(
    () =>
      bars.flatMap((bar) =>
        bar.valid === null
          ? []
          : [{ key: bar.id, old: shareOf(bar.valid.old), fresh: shareOf(bar.valid.fresh), bar }],
      ),
    [bars],
  );
  return (
    <ChartContainer>
      <LineChart accessibilityLayer data={rows} margin={MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="key" interval={0} tickLine={false} axisLine={{ stroke: BORDER }} />
        <YAxis
          domain={[0, 1]}
          ticks={[0, 0.5, 1]}
          tickFormatter={PERCENT}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <ChartTooltip cursor={{ stroke: BORDER }} isAnimationActive={false} content={<ShareTooltip />} />
        {SIDES.map(({ side, label, color, shift }) => (
          <Line
            key={side}
            name={label}
            dataKey={side}
            stroke="none"
            isAnimationActive={false}
            activeDot={false}
            dot={({ cx, cy, index }: DotItemDotProps) =>
              cx === undefined || cy === undefined ? null : (
                <circle
                  key={`${side}-${String(index)}`}
                  cx={cx + shift}
                  cy={cy}
                  r={4.5}
                  fill={color}
                  stroke="var(--ana-card)"
                  strokeWidth={2}
                />
              )
            }
          />
        ))}
      </LineChart>
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

/** The dollars billed over the moves, against the campaign's total where it has one. */
export const SpendChart = memo(function SpendChart({
  spend,
  budget,
}: {
  spend: readonly SpendPoint[];
  budget: number | null;
}) {
  const last = spend.at(-1)?.cumulative ?? 0;
  const ceiling = Math.max(budget ?? 0, last) * 1.08 || 1;
  // Under its budget the axis reads in halves of it; past it, Recharts picks the ticks.
  const halves = budget !== null && budget > 0 && last <= budget ? [0, budget / 2, budget] : undefined;
  return (
    <ChartContainer>
      <AreaChart accessibilityLayer data={[...spend]} margin={MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="move" tickLine={false} axisLine={{ stroke: BORDER }} minTickGap={16} />
        <YAxis
          domain={[0, ceiling]}
          {...keyIfDefined("ticks", halves)}
          tickFormatter={(value: number) => `$${value.toFixed(0)}`}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        {budget === null ? null : (
          <ReferenceLine
            y={budget}
            stroke="var(--ana-dim)"
            strokeDasharray="4 3"
            label={{ value: `budget ${money(budget)}`, position: "insideTopRight", fill: "var(--ana-dim)" }}
          />
        )}
        <ChartTooltip cursor={{ stroke: BORDER }} isAnimationActive={false} content={<SpendTooltip />} />
        <Area
          dataKey="cumulative"
          type="stepAfter"
          stroke={ACCENT}
          strokeWidth={2}
          fill={ACCENT}
          fillOpacity={0.1}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 4, fill: ACCENT, stroke: "var(--ana-card)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ChartContainer>
  );
});
