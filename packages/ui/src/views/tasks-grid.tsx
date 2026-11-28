import { Button, NoSignal } from "../components/primitives.tsx";
import { matchesTerms } from "../components/tool-call.tsx";
import {
  type LeftOut,
  type Outcome,
  type Share,
  shortHash,
  type TaskCell,
  type TaskGrid,
  type TaskDraw,
  type TaskLeftOut,
  type TaskRow,
} from "../models.ts";
import { Choose } from "../components/picker.tsx";
import { choiceCounts } from "../components/table.tsx";
import { useKept } from "../route.ts";
import { Filters, Search } from "./controls.tsx";
import { OUTCOMES } from "./outcome.ts";

// Every task version against every comparison, columns in the order of the Campaign pane's bars, each
// cell what the comparison came to on the task with each side's valid answers over its solves. A cell
// is tinted from `outcome.ts` and says its outcome in a word, so the grid reads without colour; a task
// fixed but left out of the tally says why, untinted. A cell the comparison did not fix is blank to the
// eye and says why to a screen reader only (practice, a refused draft, or a held task not drawn), since
// the row's note already names its state. The first column and the head stay put while the grid scrolls
// in its card.

export const AWAITING = "needs human review";

const STATES = ["held", "released", "refused", "disputed"];
const YES_NO = ["yes", "no"];
const LABEL_WORDS = new Map([
  ["yes", "Needs human review"],
  ["no", "No review needed"],
]);
export const STATE_WORDS = new Map<string, string>([
  ["held", "held-out"],
  ["released", "practice"],
  ["refused", "rejected"],
  ["disputed", "quarantined"],
]);
const UNSCORED_WORDS = new Map([
  ["released", "practice"],
  ["refused", "not in the exam"],
]);
/** A cell's word: won, lost, tied or needs review; the tint tells the three ties apart. */
const CELL_WORDS = {
  won: "won",
  lost: "lost",
  tiedEvery: "tied",
  tiedSome: "tied",
  tiedNone: "tied",
  aside: "needs review",
} as const satisfies Record<Outcome, string>;
const LEFT_OUT_WORDS = {
  disputed: "disputed",
  short: "short of solves",
  withdrawn: "withdrawn",
} as const satisfies Record<keyof LeftOut, string>;

export function countsOf(cell: TaskCell): string {
  const share = ({ valid, solves }: Share) => `${String(valid)}/${String(solves)}`;
  return `${share(cell.old)} · ${share(cell.fresh)}`;
}

export function leftOutWords(cell: TaskLeftOut): string {
  return `excluded, ${LEFT_OUT_WORDS[cell.leftOut]}`;
}

export function outcomeOf(outcome: Outcome): { readonly label: string; readonly color: string } {
  return OUTCOMES.find((each) => each.outcome === outcome) ?? { label: outcome, color: "var(--ana-faint)" };
}

export function drawWords(draw: TaskDraw | null): string[] {
  if (draw === null || draw.place === "frontier") return [];
  if (draw.place === "retained") return ["regression check"];
  return [...(draw.awaitingLabel ? [AWAITING] : []), ...(draw.doubted ? ["quarantined"] : [])];
}

function taskNote(row: TaskRow): string {
  return [STATE_WORDS.get(row.state) ?? row.state, ...drawWords(row.draw)].join(" · ");
}

function Cell({ cell, state }: { cell: TaskCell | TaskLeftOut | null; state: TaskRow["state"] }) {
  if (cell === null) {
    // A held task the comparison did not draw keeps a faint dash, so that it reads apart from practice.
    const words = UNSCORED_WORDS.get(state);
    return (
      <td
        className={words === undefined ? "ana-grid-cell is-none is-undrawn" : "ana-grid-cell is-none"}
        data-outcome="none"
        title={words === undefined ? "not drawn in this comparison" : undefined}
      >
        <span className="ana-sr-only">{words ?? "not scored"}</span>
      </td>
    );
  }
  if ("leftOut" in cell) {
    return (
      <td className="ana-grid-cell is-left-out" data-outcome="left-out" data-left-out={cell.leftOut}>
        <span>excluded</span>
        <small>{LEFT_OUT_WORDS[cell.leftOut]}</small>
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

export function TaskGridView({ grid, onOpen }: { grid: TaskGrid; onOpen: (version: string) => void }) {
  const [query, setQuery] = useKept("tasks.search", "");
  const [state, setState] = useKept<readonly string[]>("tasks.state", []);
  const [label, setLabel] = useKept<readonly string[]>("tasks.label", []);
  if (grid.rows.length === 0) {
    return <NoSignal title="No task yet">No task version has been proposed in this campaign</NoSignal>;
  }
  // Each choice with the value a row holds for it, as in `table.tsx`: a choice offers what the search
  // and the other choices leave, each with its count.
  const choices = [
    {
      name: "Pool",
      every: "All pools",
      value: state,
      set: setState,
      of: (row: TaskRow) => row.state,
      words: STATE_WORDS,
    },
    {
      name: "Human review",
      every: "All tasks",
      value: label,
      set: setLabel,
      of: (row: TaskRow) => (drawWords(row.draw).includes(AWAITING) ? "yes" : "no"),
      words: LABEL_WORDS,
    },
  ];
  const searched = grid.rows.filter((row) =>
    matchesTerms(`${row.id ?? ""} ${row.version} ${taskNote(row)}`, query),
  );
  const leaving = (skip: string | null) =>
    searched.filter((row) =>
      choices.every(({ name, value, of }) => name === skip || value.length === 0 || value.includes(of(row))),
    );
  const rows = leaving(null);
  const filtered = query.trim() !== "" || choices.some(({ value }) => value.length > 0);
  return (
    <>
      <Filters>
        <Search value={query} onChange={setQuery} placeholder="Search tasks by id or version" />
        {choices.map(({ name, every, value, set, of, words }) => {
          // As in `table.tsx`, a choice every task answers alike stands only while it is set.
          if (value.length === 0 && new Set(grid.rows.map(of)).size < 2) return null;
          const left = leaving(name);
          const counts = choiceCounts(left, of);
          return (
            <Choose
              key={name}
              label={name}
              chosen={value}
              onChange={set}
              values={(name === "Pool" ? STATES : YES_NO).filter(
                (each) => value.includes(each) || counts.has(each),
              )}
              every={{ label: every, detail: String(left.length) }}
              format={(each) => words.get(each) ?? each}
              detail={(each) => String(counts.get(each) ?? 0)}
            />
          );
        })}
        {filtered ? (
          <Button
            onClick={() => {
              setQuery("");
              for (const { set } of choices) set([]);
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
        <NoSignal title="No matching task">Change the search or clear the filters</NoSignal>
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
                    <Cell key={grid.columns[at]?.id ?? String(at)} cell={cell} state={row.state} />
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
