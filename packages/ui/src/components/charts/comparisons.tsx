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
} from "../../views/campaign-data.ts";
import { OUTCOMES } from "../../views/outcome.ts";
import { ChartContainer, ChartTooltip } from "../ui/chart.tsx";
import { ChartKey, CountsTable } from "./comparisons-key.tsx";

/*
 * The Campaign pane's one wide chart (the brief of 11 October, section 6): one stacked column a
 * comparison, its scored tasks by outcome, in counts and never joined by a line, since the scored
 * set changes from one comparison to the next. The marks Recharts has no element for are drawn by
 * `Marks` from the chart's own scales: a promotion's divider (its own mark where it was made with
 * `--despite`, and another for a return to the starter), the break where the setting changes, the
 * bracket that ties a repeat to the comparison it repeats, the sessions that ran between two
 * comparisons, and the word over a comparison that has not reported. Nothing animates, and the
 * component is memoised on the reading's arrays, which `live.ts` keeps identical across a poll that
 * did not change them, even where the poll changed something else in the reading.
 *
 * A column is at most `BAR_PX` wide. With fewer than `FEW` comparisons the columns stand together at
 * the left at `FEW_SLOT_PX` each, since spread across a wide card two thin bars read as far apart
 * as two unrelated numbers; with more they share the card's width, and past it the chart scrolls.
 */

/** One column as Recharts stacks it. A control's counts sit under their own keys, so that its
 *  segments are drawn by the quieter series of the same colours. */
type Series = Outcome | `${Outcome}Quiet` | "open";
type Row = { readonly key: string } & Partial<Record<Series, number>>;

interface Props {
  readonly bars: readonly ComparisonBar[];
  readonly promotions: readonly Promotion[];
  readonly names: Readonly<Record<string, string>>;
  /** A comparison chosen, by its move's place in the log. */
  readonly onOpen: (move: number) => void;
}

/** The width a column needs to stay readable; past the card's width the chart scrolls in it. */
const SLOT_PX = 80;
const FEW = 8;
const FEW_SLOT_PX = 96;
const BAR_PX = 48;
/** The y axis's width and the plot's margins beside the columns. */
const AXIS_PX = 36;
const MARGIN = { top: 54, right: 20, bottom: 4, left: 0 } as const;
const KIND_WORD = { candidate: null, repeat: "repeat", control: "control" } as const;
/** Rows above the plot: promotions on the first two, setting breaks on the third, each a label's
 *  height below the one above, so that the second promotion row does not touch a setting's label. */
const PROMOTION_ROW = 46;
const FLAG_ROW_PX = 14;
const SETTING_ROW = 10;
/** About how wide a character of a flag's label is, to turn a flag that would leave the chart. */
const CHAR_PX = 6.4;
/** How far below the plot the marks of the sessions between two comparisons stand. */
const BETWEEN_DROP = 48;
const DIM = "var(--ana-dim)";
const TEXT = "var(--ana-text)";
const FAINT = "var(--ana-faint)";

/** Every outcome twice, a candidate's and a control's, in the stacking order of `OUTCOMES`. */
const SERIES: readonly { readonly key: Series; readonly color: string; readonly quiet: boolean }[] =
  OUTCOMES.flatMap(({ outcome, color }) => [
    { key: outcome, color, quiet: false },
    { key: `${outcome}Quiet` as const, color, quiet: true },
  ]);

/** A column's counts under the keys of its series. */
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

function promotionWord(promotion: Promotion, names: Readonly<Record<string, string>>): string {
  if (promotion.toStarter) return "back to the starter";
  const named = `promoted ${digestText(promotion.harness, names)}`;
  return promotion.despite === null ? named : `${named}, despite`;
}

/** Up to four sessions as one glyph each; more as one glyph and a count. */
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
 * A promotion's divider and its flag, each after the last comparison that began before it. The flag
 * carries the harness's letter alone, and its words, digest and any reason given with `--despite`
 * show on hover. Until 31 October it carried "promoted D (bf461326)", placed by a search over two
 * rows and both sides, and the labels still crossed and left the card at either edge (operator).
 * The flag turns left at the right edge, and a second promotion after the same comparison takes
 * the row below.
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
        <title>{promotion.despite === null ? said : `${said}: ${promotion.despite}`}</title>
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

/** The marks drawn from the chart's scales: dividers, breaks, repeat brackets, sessions, open
 *  columns. Rendered inside the chart, where the scales are known. */
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

/** The tooltip: what the comparison was of, its counts by outcome, the tasks its report left out of
 *  them, its tally and its reading. */
function SlotTooltip({
  active,
  payload,
  slots,
  names,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Row }>;
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

/** The comparisons chart, its legend and a table of the same counts for a screen reader and a
 *  keyboard, whose buttons open a comparison as its column does. */
export const ComparisonsChart = memo(function ComparisonsChart({ bars, promotions, names, onOpen }: Props) {
  const slots = useMemo(() => comparisonSlots(bars), [bars]);
  const byKey = useMemo(() => new Map(slots.map((slot) => [slot.key, slot])), [slots]);
  const rows = useMemo(() => slots.map(rowOf), [slots]);
  const top = Math.max(1, ...slots.map((slot) => (slot.kind === "bar" ? slot.height : 0)));
  // One tick of headroom over the tallest column, for the marks drawn above it.
  const ticks = countTicks(top + 1);
  const packed = bars.length < FEW;
  const frame = packed
    ? { width: slots.length * FEW_SLOT_PX + AXIS_PX + MARGIN.right }
    : { minWidth: slots.length * SLOT_PX + AXIS_PX + MARGIN.right };
  const open = (index: number | string | null | undefined) => {
    const slot = slots[Number(index)];
    if (slot?.kind === "bar") onOpen(slot.bar.move);
  };
  const tick = ({ x, y, index }: XAxisTickContentProps) => {
    const slot = slots[index];
    if (slot?.kind !== "bar") return null;
    // A step is the one reading worth finding at a glance, so its column is named in full ink.
    const step = slot.bar.reading === "step";
    const word = [KIND_WORD[slot.bar.kind], step ? "step" : null].filter((part) => part !== null).join(", ");
    // The chart under the label opens the column its tooltip last pointed at, which after a keyboard
    // or a hover elsewhere is another; the label's click is the label's alone.
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
