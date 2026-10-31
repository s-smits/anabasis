import { Button, NoSignal } from "../components/primitives.tsx";
import { matchesTerms } from "../components/tool-call.tsx";
import type { LeftOut, Outcome, TaskCell, TaskGrid, TaskLeftOut, TaskRow } from "../models.ts";
import { shortHash } from "../models.ts";
import { Choose } from "../components/picker.tsx";
import { choiceCounts } from "../components/table.tsx";
import { useKept } from "../route.ts";
import { Filters, Search } from "./controls.tsx";
import { OUTCOMES } from "./outcome.ts";
import type { Share } from "../../../../src/campaign/climb.ts";

/*
 * Every task version against every comparison: one row a task, one column a comparison in the order
 * of the Campaign pane's bars, and a cell what the comparison came to on the task with each side's
 * valid answers over its solves. A cell is tinted with its outcome's colour from `outcome.ts` and
 * says its outcome in a word, so that the grid reads without colour; one the comparison fixed and
 * left out of its tally says why, untinted, as no outcome; one it did not fix says why from the
 * task's state: a practice task is never scored, a refused draft never entered the exam, and a held
 * task the comparison did not draw was not scored. Until 19 October all three read "not scored", and
 * esp32-fresh-opus's grid showed 153 of its 177 rows so, every one a refused draft or a practice
 * task, while each of its 24 held tasks had been scored. Since 30 October such a cell is left blank
 * to the eye and says why to a screen reader only, since the row's own note already names its
 * state and most cells of a long campaign's grid are of this kind. The first column and the head
 * stay in place while the grid scrolls inside its card, so a campaign of twenty comparisons and
 * sixty tasks stays readable.
 */

const STATES = ["held", "released", "refused", "disputed"];
const YES_NO = ["yes", "no"];
const LABEL_WORDS = new Map([
  ["yes", "Waits for a label"],
  ["no", "Does not wait"],
]);
const EXHAUSTED_WORDS = new Map([
  ["yes", "Exhausted"],
  ["no", "Not exhausted"],
]);
const STATE_WORDS = new Map<string, string>();
/** Why a task has no cell in a comparison, where its state says more than that it was not scored. */
const UNSCORED_WORDS = new Map([
  ["released", "practice"],
  ["refused", "not in the exam"],
]);
/** A cell's word: the brief's won, lost, tied or set aside; the tint tells the three ties apart. */
const CELL_WORDS = {
  won: "won",
  lost: "lost",
  tiedEvery: "tied",
  tiedSome: "tied",
  tiedNone: "tied",
  aside: "set aside",
} as const satisfies Record<Outcome, string>;
/** Why a comparison left a task it fixed out of its tally, in a few words. */
const LEFT_OUT_WORDS = {
  disputed: "disputed",
  short: "short of solves",
  withdrawn: "withdrawn",
} as const satisfies Record<keyof LeftOut, string>;

/** Each side's valid answers over its solves, reference first. */
export function countsOf(cell: TaskCell): string {
  const share = ({ valid, solves }: Share) => `${String(valid)}/${String(solves)}`;
  return `${share(cell.old)} · ${share(cell.fresh)}`;
}

/** Why a comparison left a task out, in the words of a cell and of the task's detail. */
export function leftOutWords(cell: TaskLeftOut): string {
  return `left out, ${LEFT_OUT_WORDS[cell.leftOut]}`;
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
        <span>left out</span>
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

/** The grid with its filters; a task's id opens its detail. */
export function TaskGridView({ grid, onOpen }: { grid: TaskGrid; onOpen: (version: string) => void }) {
  const [query, setQuery] = useKept("tasks.search", "");
  const [state, setState] = useKept<readonly string[]>("tasks.state", []);
  const [label, setLabel] = useKept<readonly string[]>("tasks.label", []);
  const [exhausted, setExhausted] = useKept<readonly string[]>("tasks.exhausted", []);
  if (grid.rows.length === 0) {
    return <NoSignal title="No task yet">No task version has been proposed in this campaign</NoSignal>;
  }
  const yesNo = (value: boolean) => (value ? "yes" : "no");
  // Each choice with the value a row holds for it, as the page's tables have them (`table.tsx`): a
  // choice offers what the search and the other choices leave, each with its count.
  const choices = [
    {
      name: "State",
      every: "Every state",
      value: state,
      set: setState,
      of: (row: TaskRow) => row.state,
      words: STATE_WORDS,
    },
    {
      name: "Label",
      every: "All tasks",
      value: label,
      set: setLabel,
      of: (row: TaskRow) => yesNo(row.awaitingLabel),
      words: LABEL_WORDS,
    },
    {
      name: "Exhausted",
      every: "All tasks",
      value: exhausted,
      set: setExhausted,
      of: (row: TaskRow) => yesNo(row.exhausted),
      words: EXHAUSTED_WORDS,
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
              values={(name === "State" ? STATES : YES_NO).filter(
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
