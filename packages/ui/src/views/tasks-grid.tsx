import { useState } from "react";
import { Button, NoSignal } from "../components/primitives.tsx";
import { matchesTerms } from "../components/tool-call.tsx";
import type { Outcome, TaskCell, TaskGrid, TaskRow } from "../models.ts";
import { shortHash } from "../models.ts";
import { Filters, Search, Select } from "./controls.tsx";
import { OUTCOMES } from "./outcome.ts";
import type { Share } from "../../../../src/builder/climb.ts";

/*
 * Every task version against every comparison: one row a task, one column a comparison in the order
 * of the Campaign pane's bars, and a cell what the comparison came to on the task with each side's
 * valid answers over its solves. A cell is tinted with its outcome's colour from `outcome.ts` and
 * says its outcome in a word, so that the grid reads without colour; one the comparison did not
 * score says so. The first column and the head stay in place while the grid scrolls inside its
 * card, so a campaign of twenty comparisons and sixty tasks stays readable.
 */

const ALL = "all";
const STATES = [ALL, "held", "released", "refused", "disputed", "ladder"];
const YES_NO = [ALL, "yes", "no"];
const LABEL_WORDS = new Map([
  ["all", "All tasks"],
  ["yes", "Waits for a label"],
  ["no", "Does not wait"],
]);
const EXHAUSTED_WORDS = new Map([
  ["all", "All tasks"],
  ["yes", "Exhausted"],
  ["no", "Not exhausted"],
]);
const STATE_WORDS = new Map([["all", "Every state"]]);
/** A cell's word: the brief's won, lost, tied or set aside; the tint tells the three ties apart. */
const CELL_WORDS = {
  won: "won",
  lost: "lost",
  tiedEvery: "tied",
  tiedSome: "tied",
  tiedNone: "tied",
  aside: "set aside",
} as const satisfies Record<Outcome, string>;

/** Each side's valid answers over its solves, reference first. */
export function countsOf(cell: TaskCell): string {
  const share = ({ valid, solves }: Share) => `${String(valid)}/${String(solves)}`;
  return `${share(cell.old)} · ${share(cell.fresh)}`;
}

/** The outcome's label and colour, as every chart and grid draws it. */
export function outcomeOf(outcome: Outcome): { readonly label: string; readonly color: string } {
  return OUTCOMES.find((each) => each.outcome === outcome) ?? { label: outcome, color: "var(--ana-faint)" };
}

/** What a task's row says under its id: its state and the two readings beside it. */
function taskNote(row: TaskRow): string {
  return [
    row.state,
    ...(row.awaitingLabel ? ["waits for a label"] : []),
    ...(row.exhausted ? ["exhausted"] : []),
    ...(row.retained ? ["retained"] : []),
  ].join(" · ");
}

function Cell({ cell }: { cell: TaskCell | null }) {
  if (cell === null) {
    return (
      <td className="ana-grid-cell is-none" data-outcome="none">
        <span>not scored</span>
      </td>
    );
  }
  const { label, color } = outcomeOf(cell.outcome);
  const counts = countsOf(cell);
  return (
    <td
      className="ana-grid-cell"
      data-outcome={cell.outcome}
      data-counts={counts}
      title={`${label}: reference ${counts.replace(" · ", ", new ")} valid`}
      style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}
    >
      <span>
        <span className="ana-swatch" style={{ background: color }} aria-hidden />
        {CELL_WORDS[cell.outcome]}
      </span>
      <small className="ana-num">{counts}</small>
    </td>
  );
}

/** The grid with its filters; a task's id opens its detail. */
export function TaskGridView({ grid, onOpen }: { grid: TaskGrid; onOpen: (version: string) => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState(ALL);
  const [label, setLabel] = useState(ALL);
  const [exhausted, setExhausted] = useState(ALL);
  if (grid.rows.length === 0) {
    return <NoSignal title="No task yet">No task version has been proposed in this campaign.</NoSignal>;
  }
  const holds = (filter: string, value: boolean) => filter === ALL || (filter === "yes") === value;
  const rows = grid.rows.filter(
    (row) =>
      (state === ALL || row.state === state) &&
      holds(label, row.awaitingLabel) &&
      holds(exhausted, row.exhausted) &&
      matchesTerms(`${row.id ?? ""} ${row.version} ${taskNote(row)}`, query),
  );
  const filtered = query.trim() !== "" || state !== ALL || label !== ALL || exhausted !== ALL;
  return (
    <>
      <Filters>
        <Search value={query} onChange={setQuery} placeholder="Search tasks by id or version" />
        <Select
          label="State"
          value={state}
          onChange={setState}
          values={STATES}
          format={(value) => STATE_WORDS.get(value) ?? value}
        />
        <Select
          label="Label"
          value={label}
          onChange={setLabel}
          values={YES_NO}
          format={(value) => LABEL_WORDS.get(value) ?? value}
        />
        <Select
          label="Exhausted"
          value={exhausted}
          onChange={setExhausted}
          values={YES_NO}
          format={(value) => EXHAUSTED_WORDS.get(value) ?? value}
        />
        {filtered ? (
          <Button
            onClick={() => {
              setQuery("");
              setState(ALL);
              setLabel(ALL);
              setExhausted(ALL);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </Filters>
      <ul className="ana-grid-legend" aria-label="Outcomes">
        {OUTCOMES.map(({ outcome, label: said, color }) => (
          <li key={outcome}>
            <span className="ana-swatch" style={{ background: color }} aria-hidden />
            {said}
          </li>
        ))}
        <li className="ana-faint">Counts: valid of solves, reference · new</li>
      </ul>
      {rows.length === 0 ? (
        <NoSignal title="No matching task">Change the search or clear the filters.</NoSignal>
      ) : (
        <div className="ana-grid-wrap" role="region" aria-label="Tasks by comparison" tabIndex={0}>
          <table className="ana-grid">
            <thead>
              <tr>
                <th className="ana-grid-corner">Tasks ({rows.length})</th>
                {grid.columns.map((column) => (
                  <th
                    key={column.id}
                    className={`ana-grid-col is-${column.kind}`}
                    title={`${shortHash(column.fresh, 8)} against ${shortHash(column.old, 8)}`}
                  >
                    <span>{column.id}</span>
                    <small>
                      {column.kind === "candidate" ? "" : `${column.kind}, `}
                      {column.reading ?? (column.cut ? "cut" : "open")}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.version}>
                  <th scope="row" className="ana-grid-task">
                    <button
                      type="button"
                      className="ana-row-select"
                      data-row={row.version}
                      onClick={() => onOpen(row.version)}
                    >
                      {row.id ?? shortHash(row.version, 8)}
                    </button>
                    <small>{taskNote(row)}</small>
                  </th>
                  {row.cells.map((cell, at) => (
                    <Cell key={grid.columns[at]?.id ?? String(at)} cell={cell} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
