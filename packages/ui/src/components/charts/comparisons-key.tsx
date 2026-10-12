import type { ReactNode } from "react";
import type { ComparisonBar, Promotion } from "../../models.ts";
import { outcomeTotals, type Slot } from "../../views/campaign-data.ts";
import { OUTCOMES } from "../../views/outcome.ts";

/*
 * What the comparisons chart's colours and marks mean, so that no reader is left to a colour: the
 * six outcomes with their totals over every comparison that reported, then a quieter row with only
 * the marks this campaign's chart draws. Beside it, the same counts as a table a screen reader
 * reads, one row a comparison.
 */

const TEXT = "var(--ana-text)";
const DIM = "var(--ana-dim)";

/** A mark of the chart drawn small enough to stand in a line of text. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden className="ana-glyph" viewBox="0 0 16 12" width="16" height="12">
      {children}
    </svg>
  );
}

export function ChartKey({
  bars,
  slots,
  promotions,
}: {
  bars: readonly ComparisonBar[];
  slots: readonly Slot[];
  promotions: readonly Promotion[];
}) {
  const totals = outcomeTotals(bars);
  const flag = (fill: string, dash?: string) => (
    <Glyph>
      <line x1="2" x2="2" y1="1" y2="12" stroke={TEXT} strokeWidth="1.5" strokeDasharray={dash} />
      <path d="M2 1l7 4l-7 4z" fill={fill} stroke={TEXT} />
    </Glyph>
  );
  const marks: readonly { readonly shown: boolean; readonly label: string; readonly glyph: ReactNode }[] = [
    {
      shown: promotions.some((each) => each.despite === null && !each.toStarter),
      label: "Promotion",
      glyph: flag(TEXT),
    },
    {
      shown: promotions.some((each) => each.despite !== null),
      label: "Promotion despite the rule",
      glyph: flag("var(--ana-card)"),
    },
    {
      shown: promotions.some((each) => each.toStarter),
      label: "Back to the starter",
      glyph: flag(TEXT, "3 2"),
    },
    {
      shown: slots.some((slot) => slot.kind === "break"),
      label: "Setting changed",
      glyph: (
        <Glyph>
          <line x1="8" x2="8" y1="0" y2="12" stroke="var(--ana-faint)" strokeDasharray="1 3" />
        </Glyph>
      ),
    },
    {
      shown: bars.some((bar) => bar.kind === "control"),
      label: "Control, drawn quieter",
      glyph: <span aria-hidden className="ana-swatch is-quiet" />,
    },
    {
      shown: slots.some((slot) => slot.kind === "bar" && slot.bar.repeats !== null),
      label: "Repeat of an earlier comparison",
      glyph: (
        <Glyph>
          <path d="M2 10V4H14V10" fill="none" stroke={DIM} />
        </Glyph>
      ),
    },
    {
      shown: bars.some((bar) => bar.between.examiner.length > 0),
      label: "Examiner session",
      glyph: (
        <Glyph>
          <circle cx="8" cy="6" r="3" fill="none" stroke={DIM} strokeWidth="1.2" />
        </Glyph>
      ),
    },
    {
      shown: bars.some((bar) => bar.between.builder.length > 0),
      label: "Builder session",
      glyph: (
        <Glyph>
          <rect x="5" y="3" width="6" height="6" fill={DIM} />
        </Glyph>
      ),
    },
  ];
  return (
    <div className="ana-comparisons-key">
      <ul className="ana-legend-list" aria-label="Outcomes, tasks over every comparison">
        {OUTCOMES.map(({ outcome, label, color }) => (
          <li key={outcome}>
            <span aria-hidden className="ana-swatch" style={{ background: color }} />
            <span>{label}</span>
            <span className="ana-num" data-outcome={outcome}>
              {totals[outcome]}
            </span>
          </li>
        ))}
        {bars.some((bar) => bar.outcomes === null) ? (
          <li>
            <span aria-hidden className="ana-swatch is-open" />
            <span>No report yet</span>
          </li>
        ) : null}
      </ul>
      <ul className="ana-legend-list is-quiet" aria-label="Marks">
        {marks.flatMap(({ shown, label, glyph }) =>
          shown
            ? [
                <li key={label}>
                  {glyph}
                  <span>{label}</span>
                </li>,
              ]
            : [],
        )}
      </ul>
    </div>
  );
}

/** The chart's counts as a table, for a reader that cannot see it. */
export function CountsTable({ slots }: { slots: readonly Slot[] }) {
  return (
    // A table ignores a width of one pixel, so the box that hides it is a block around it.
    <div className="ana-sr-only">
      <table>
        <caption>Scored tasks by outcome, one row a comparison</caption>
        <thead>
          <tr>
            <th scope="col">Comparison</th>
            {OUTCOMES.map(({ outcome, label }) => (
              <th scope="col" key={outcome}>
                {label}
              </th>
            ))}
            <th scope="col">Reading</th>
          </tr>
        </thead>
        <tbody>
          {slots.flatMap((slot) => {
            if (slot.kind === "break") return [];
            const { bar } = slot;
            const { outcomes } = bar;
            return [
              <tr key={slot.key} data-comparison={bar.id}>
                <th scope="row">{bar.kind === "candidate" ? bar.id : `${bar.id}, ${bar.kind}`}</th>
                {outcomes === null ? (
                  <td colSpan={OUTCOMES.length}>{bar.cut ? "cut before a report" : "no report yet"}</td>
                ) : (
                  OUTCOMES.map(({ outcome }) => <td key={outcome}>{outcomes[outcome]}</td>)
                )}
                <td>{bar.reading ?? "none"}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
