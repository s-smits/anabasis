import { memo, type MouseEvent, type ReactNode, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  type XAxisTickContentProps,
  YAxis,
} from "recharts";
import { keyIfDefined } from "../../../../../src/meta/optional-key.ts";
import type { ComparisonBar, Outcome, Promotion } from "../../models.ts";
import {
  comparisonSlots,
  countTicks,
  digestText,
  leftOutText,
  pText,
  type Slot,
  tallyText,
} from "../../views/campaign-data.ts";
import { OUTCOMES } from "../../views/outcome.ts";
import { ChartContainer, ChartTooltip } from "../ui/chart.tsx";
import { ChartKey, CountsTable } from "./comparisons-key.tsx";

/*
 * Wide stacked bar chart for the Campaign pane. Each comparison is shown as one stacked column of
 * scored task counts broken down by outcome, without connecting lines between columns because the
 * evaluated task set changes from one comparison to the next. Custom annotations that Recharts
 * does not provide natively are rendered by `Marks` using the chart's own scales: promotion
 * dividers (with distinct symbols for `--despite` overrides and returns to the starter), setting
 * change breaks, repeat brackets linking repeated comparisons, intervening Examiner and Builder
 * sessions, and status labels above open or cut comparisons. Animations are disabled, and the
 * component is memoised on the reading arrays, which `live.ts` preserves by reference across polls
 * whenever those arrays are unchanged.
 *
 * Each bar is capped at `BAR_PX` wide. When fewer than `FEW` comparisons exist, columns pack on
 * the left at `FEW_SLOT_PX` per slot so that two bars do not drift far apart across a wide card;
 * with more comparisons they share the card width and scroll horizontally once they exceed it.
 */

/** Series keys stacked by Recharts. Control (A/A) counts use dedicated quiet keys so their
 *  segments render at reduced opacity in the same outcome colours. */
type Series = Outcome | `${Outcome}Quiet` | "open";
type Row = { readonly key: string } & Partial<Record<Series, number>>;

interface Props {
  readonly bars: readonly ComparisonBar[];
  readonly promotions: readonly Promotion[];
  readonly names: Readonly<Record<string, string>>;
  /** Opens the selected comparison by its move index in the log. */
  readonly onOpen: (move: number) => void;
}

/** Minimum slot width per comparison before the chart container scrolls horizontally. */
const SLOT_PX = 80;
const FEW = 8;
const FEW_SLOT_PX = 96;
const BAR_PX = 48;
/** Width reserved for the y-axis and plot margins surrounding the columns. */
const AXIS_PX = 36;
const MARGIN = { top: 54, right: 20, bottom: 4, left: 0 } as const;
const KIND_WORD = { candidate: null, repeat: "repeat", control: "control" } as const;
/** Vertical offsets above the plot area: promotions occupy the upper two rows and setting breaks
 *  occupy the third, spaced so the lower promotion row does not collide with setting labels. */
const PROMOTION_ROW = 46;
const FLAG_ROW_PX = 14;
const SETTING_ROW = 10;
/** Approximate character width in pixels, used to flip a flag leftward near the right edge. */
const CHAR_PX = 6.4;
/** Vertical offset below the plot area for intervening session markers. */
const BETWEEN_DROP = 48;
const DIM = "var(--ana-dim)";
const TEXT = "var(--ana-text)";
const FAINT = "var(--ana-faint)";

/** Pairs each outcome with both a candidate series and a quieter control series in `OUTCOMES` stacking order. */
const SERIES: readonly { readonly key: Series; readonly color: string; readonly quiet: boolean }[] =
  OUTCOMES.flatMap(({ outcome, color }) => [
    { key: outcome, color, quiet: false },
    { key: `${outcome}Quiet` as const, color, quiet: true },
  ]);

/** Maps a comparison slot into a Recharts data row keyed by its active series. */
function rowOf(slot: Slot): Row {
  if (slot.kind === "break") return { key: slot.key };
  const quiet = slot.bar.kind === "control";
  const row: Partial<Record<Series, number>> = { ...keyIfDefined("open", slot.values.open) };
  for (const { outcome } of OUTCOMES) {
    const count = slot.values[outcome];
    if (count === undefined) continue;
    const series: Series = quiet ? `${outcome}Quiet` : outcome;
    row[series] = count;
  }
  return { key: slot.key, ...row };
}

/** Formats the hover summary for a promotion flag, including the promoted harness, any `--despite`
 *  reason, and whether its starter confirmation comparison has confirmed the gain. */
function promotionWord(promotion: Promotion, names: Readonly<Record<string, string>>): string {
  if (promotion.toStarter) return "back to the starter";
  const named = `promoted ${digestText(promotion.harness, names)}`;
  const despite = promotion.despite === null ? "" : `, despite: ${promotion.despite}`;
  const tally = promotion.againstStarter;
  const starter =
    tally === null
      ? "; not yet read against the starter"
      : `; against the starter ${tallyText(tally)}, ${promotion.confirmed ? "confirmed" : "not confirmed"}`;
  return `${named}${despite}${starter}`;
}

/** Renders up to four intervening sessions as individual glyphs, or compact glyphs with counts above four. */
function sessionGlyphs(x: number, y: number, examiner: number, builder: number): ReactNode[] {
  const glyph = (kind: "examiner" | "builder", at: number) =>
    kind === "examiner" ? (
      <circle key={`e${String(at)}`} cx={at} cy={y} r={3} fill="none" stroke={DIM} strokeWidth={1.2} />
    ) : (
      <rect key={`b${String(at)}`} x={at - 3} y={y - 3} width={6} height={6} fill={DIM} />
    );
  if (examiner + builder <= 4) {
    const kinds = [
      ...Array.from({ length: examiner }, () => "examiner" as const),
      ...Array.from({ length: builder }, () => "builder" as const),
    ];
    const start = x - ((kinds.length - 1) * 9) / 2;
    return kinds.map((kind, at) => glyph(kind, start + at * 9));
  }
  const parts: ReactNode[] = [];
  let at = x - 16;
  for (const [kind, count] of [
    ["examiner", examiner],
    ["builder", builder],
  ] as const) {
    if (count === 0) continue;
    parts.push(
      glyph(kind, at),
      <text key={`${kind}-n`} x={at + 6} y={y + 3.5} className="ana-comparisons-mark-text">
        {count}
      </text>,
    );
    at += 22;
  }
  return parts;
}

/**
 * Renders each promotion's vertical divider and flag after the last comparison begun before it.
 * Each flag displays only the short harness letter to avoid overlapping neighbours or clipping at
 * the chart edges; the full summary, digest, and any `--despite` reason appear on hover. Flags
 * near the right edge flip leftward, and a second promotion at the same position drops to the row
 * below.
 */
function promotionFlags(
  promotions: readonly Promotion[],
  names: Readonly<Record<string, string>>,
  frame: {
    readonly at: (after: string, position: "start" | "end") => number;
    readonly first: string | undefined;
    readonly top: number;
    readonly bottom: number;
    readonly right: number;
  },
): ReactNode[] {
  const drawn = promotions.flatMap((promotion) => {
    const after = promotion.afterComparison ?? frame.first;
    if (after === undefined) return [];
    const word = names[promotion.harness] ?? "?";
    const at = frame.at(after, promotion.afterComparison === null ? "start" : "end");
    return [{ promotion, word, at }];
  });
  return drawn.map(({ promotion, word, at }, index) => {
    const row = Math.min(drawn.slice(0, index).filter((each) => Math.abs(each.at - at) < 1).length, 1);
    const side = at + 12 + word.length * CHAR_PX > frame.right ? -1 : 1;
    const flagTop = frame.top - PROMOTION_ROW + row * FLAG_ROW_PX;
    const said = promotionWord(promotion, names);
    return (
      <g key={`promotion-${String(promotion.index)}`}>
        <title>{said}</title>
        <line
          x1={at}
          x2={at}
          y1={flagTop}
          y2={frame.bottom}
          stroke={TEXT}
          strokeOpacity={0.7}
          strokeWidth={1.5}
          strokeDasharray={promotion.toStarter ? "5 4" : undefined}
        />
        <path
          d={`M${String(at)} ${String(flagTop)}l${String(7 * side)} 4l${String(-7 * side)} 4z`}
          fill={promotion.despite === null ? TEXT : "var(--ana-card)"}
          stroke={TEXT}
        />
        <text
          x={at + 11 * side}
          y={flagTop + 8}
          textAnchor={side > 0 ? "start" : "end"}
          className="ana-comparisons-mark-text is-strong"
        >
          {word}
        </text>
      </g>
    );
  });
}

/** Renders custom SVG annotations (promotion dividers, setting breaks, repeat brackets,
 *  intervening sessions, and open/cut labels) inside the chart where Recharts scales are available. */
function Marks({
  slots,
  promotions,
  names,
}: {
  slots: readonly Slot[];
  promotions: readonly Promotion[];
  names: Readonly<Record<string, string>>;
}) {
  const x = useXAxisScale();
  const y = useYAxisScale();
  const plot = usePlotArea();
  if (x === undefined || y === undefined || plot === undefined) return null;
  const top = plot.y;
  const bottom = plot.y + plot.height;
  const bars = slots.flatMap((slot) => (slot.kind === "bar" ? [slot] : []));
  const first = bars[0]?.key;
  const marks: ReactNode[] = [];
  for (const slot of slots) {
    const middle = x(slot.key, { position: "middle" }) ?? 0;
    if (slot.kind === "break") {
      marks.push(
        <g key={slot.key} className="ana-comparisons-break">
          <title>{`The setting changes here, to ${slot.setting ?? "none recorded"}`}</title>
          <line
            x1={middle}
            x2={middle}
            y1={top - SETTING_ROW + 4}
            y2={bottom}
            stroke={FAINT}
            strokeDasharray="1 4"
          />
          <text x={middle} y={top - SETTING_ROW} textAnchor="middle" className="ana-comparisons-mark-text">
            setting
          </text>
        </g>,
      );
      continue;
    }
    const { bar } = slot;
    const start = x(slot.key, { position: "start" }) ?? middle;
    const { examiner, builder } = bar.between;
    if (examiner.length + builder.length > 0) {
      marks.push(
        <g key={`${slot.key}-between`}>
          <title>
            {[
              examiner.length > 0 ? `Examiner ${examiner.join(", ")}` : "",
              builder.length > 0 ? `Builder ${builder.join(", ")}` : "",
            ]
              .filter((part) => part !== "")
              .join("; ")}
          </title>
          {sessionGlyphs(
            Math.max(start, middle - 34),
            bottom + BETWEEN_DROP,
            examiner.length,
            builder.length,
          )}
        </g>,
      );
    }
    if (bar.outcomes === null) {
      marks.push(
        <text
          key={`${slot.key}-open`}
          x={middle}
          y={(y(slot.height) ?? bottom) - 6}
          textAnchor="middle"
          className="ana-comparisons-mark-text"
        >
          {bar.cut ? "cut" : "open"}
        </text>,
      );
    }
    const repeated = bars.find((each) => each.key === bar.repeats);
    if (repeated !== undefined) {
      const from = x(repeated.key, { position: "middle" }) ?? middle;
      const level = Math.min(y(repeated.height) ?? bottom, y(slot.height) ?? bottom) - 10;
      marks.push(
        <path
          key={`${slot.key}-repeat`}
          d={`M${String(from)} ${String(level + 5)}V${String(level)}H${String(middle)}V${String(level + 5)}`}
          fill="none"
          stroke={DIM}
        >
          <title>{`${bar.id} repeats ${repeated.key}`}</title>
        </path>,
      );
    }
  }
  marks.push(
    ...promotionFlags(promotions, names, {
      at: (after, position) => x(after, { position }) ?? 0,
      first,
      top,
      bottom,
      right: plot.x + plot.width + MARGIN.right,
    }),
  );
  return <g className="ana-comparisons-marks">{marks}</g>;
}

/** Tooltip for a comparison column showing the paired harnesses, outcome counts, excluded tasks,
 *  win/loss/tie tally, and statistical reading. */
function SlotTooltip({
  active,
  payload,
  slots,
  names,
}: {
  active?: boolean;
  payload?: readonly { payload?: Row }[];
  slots: ReadonlyMap<string, Slot>;
  names: Readonly<Record<string, string>>;
}) {
  const key = payload?.[0]?.payload?.key;
  const slot = key === undefined ? undefined : slots.get(key);
  if (active !== true || slot?.kind !== "bar") return null;
  const { bar } = slot;
  const tally = bar.tally;
  const left = leftOutText(bar);
  return (
    <div className="ana-chart-tooltip ana-comparisons-tooltip">
      <strong>
        {bar.id}
        {KIND_WORD[bar.kind] === null ? "" : `, ${KIND_WORD[bar.kind] ?? ""}`}
      </strong>
      <small>
        {digestText(bar.fresh, names)} against {digestText(bar.old, names)}
        {bar.repeats === null ? "" : `, repeating ${bar.repeats}`}
      </small>
      {bar.outcomes === null ? (
        <span>
          {bar.cut ? "Cut before a report" : "No report yet"}: {bar.solved} of {bar.begun} solves ended
        </span>
      ) : (
        <ul className="ana-legend-list">
          {OUTCOMES.map(({ outcome, label, color }) => (
            <li key={outcome}>
              <span aria-hidden className="ana-swatch" style={{ background: color }} />
              <span>{label}</span>
              <span className="ana-num">{bar.outcomes?.[outcome] ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
      {left === "" ? null : (
        <span>
          Left out of {bar.tasks} fixed: {left}
        </span>
      )}
      <span className="ana-num">
        {tally === null
          ? "No tally"
          : `${String(tally.wins)} won, ${String(tally.losses)} lost, ${String(tally.ties)} tied`}
        {` · ${bar.reading ?? "no reading"} · level ${bar.level.toFixed(2)} · ${pText(bar.p)}`}
      </span>
    </div>
  );
}

/** Renders the comparisons bar chart together with its legend and keyboard-accessible counts table.
 *  Reserves one vertical tick above the tallest bar for overhead brackets, highlights `step` ticks
 *  in full ink, and stops tick click propagation so clicking a tick opens its own comparison. */
export const ComparisonsChart = memo(function ComparisonsChart({ bars, promotions, names, onOpen }: Props) {
  const slots = useMemo(() => comparisonSlots(bars), [bars]);
  const byKey = useMemo(() => new Map(slots.map((slot) => [slot.key, slot])), [slots]);
  const rows = useMemo(() => slots.map(rowOf), [slots]);
  const ticks = countTicks(Math.max(1, ...slots.map((slot) => (slot.kind === "bar" ? slot.height : 0))) + 1);
  const frame =
    bars.length < FEW
      ? { width: slots.length * FEW_SLOT_PX + AXIS_PX + MARGIN.right }
      : { minWidth: slots.length * SLOT_PX + AXIS_PX + MARGIN.right };
  const open = (index: number | string | null | undefined) => {
    const slot = slots[Number(index)];
    if (slot?.kind === "bar") onOpen(slot.bar.move);
  };
  const tick = ({ x, y, index }: XAxisTickContentProps) => {
    const slot = slots[index];
    if (slot?.kind !== "bar") return null;
    const step = slot.bar.reading === "step";
    const word = [KIND_WORD[slot.bar.kind], step ? "step" : null].filter((part) => part !== null).join(", ");
    const openLabel = (event: MouseEvent) => {
      event.stopPropagation();
      onOpen(slot.bar.move);
    };
    return (
      <g className="ana-comparisons-tick" onClick={openLabel}>
        <text
          x={Number(x)}
          y={Number(y) + 12}
          textAnchor="middle"
          fill={step ? TEXT : DIM}
          className={step ? "is-step" : undefined}
        >
          {slot.bar.id}
        </text>
        {word === "" ? null : (
          <text
            x={Number(x)}
            y={Number(y) + 26}
            textAnchor="middle"
            className={step ? "ana-comparisons-mark-text is-strong" : "ana-comparisons-mark-text"}
          >
            {word}
          </text>
        )}
      </g>
    );
  };
  return (
    <>
      <div className="ana-comparisons-scroll">
        <div className="ana-comparisons-frame" style={frame}>
          <ChartContainer>
            <BarChart
              accessibilityLayer
              data={rows}
              margin={MARGIN}
              barCategoryGap="20%"
              onClick={(state) => open(state.activeTooltipIndex)}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="key"
                interval={0}
                tickLine={false}
                axisLine={{ stroke: "var(--ana-border)" }}
                height={64}
                tick={tick}
              />
              <YAxis
                allowDecimals={false}
                domain={[0, ticks.at(-1) ?? 1]}
                ticks={ticks}
                interval={0}
                tickLine={false}
                axisLine={false}
                width={AXIS_PX}
              />
              <ChartTooltip
                cursor={{ fill: "var(--ana-border-soft)" }}
                isAnimationActive={false}
                content={<SlotTooltip slots={byKey} names={names} />}
              />
              {SERIES.map(({ key, color, quiet }) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="tasks"
                  fill={color}
                  fillOpacity={quiet ? 0.4 : 1}
                  stroke="var(--ana-card)"
                  strokeWidth={2}
                  maxBarSize={BAR_PX}
                  isAnimationActive={false}
                  className="ana-comparisons-bar"
                />
              ))}
              <Bar
                dataKey="open"
                stackId="tasks"
                fill="transparent"
                stroke={FAINT}
                strokeDasharray="3 3"
                maxBarSize={BAR_PX}
                isAnimationActive={false}
                className="ana-comparisons-bar"
              />
              <Marks slots={slots} promotions={promotions} names={names} />
            </BarChart>
          </ChartContainer>
        </div>
      </div>
      <ChartKey bars={bars} slots={slots} promotions={promotions} />
      <CountsTable slots={slots} onOpen={onOpen} />
    </>
  );
});
