import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFacetedRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Fragment, type ReactNode, useMemo } from "react";
import { useKept } from "../route.ts";
import { Filters, Search } from "../views/controls.tsx";
import { Choose } from "./picker.tsx";
import { Button, NoSignal } from "./primitives.tsx";
import { matchesTerms } from "./tool-call.tsx";

/*
 * The page's one data table: rows sorted by a column's head, narrowed by a search box and by a
 * choice for each column that offers one, all in the browser over rows already read (TanStack
 * Table). Until 30 October each table filtered by hand with native selects of its own, and none
 * sorted (operator). A table draws `ROWS` rows and the rest on asking, since a log of a few
 * thousand events drawn whole held the page for a second. Its sort, search, ticks and rows drawn
 * are kept across a reload of the view (`useKept`).
 */

const ROWS = 200;

/** One column: its head, its cell, and what it sorts and filters by, where it does. */
export interface Column<Row> {
  readonly id: string;
  readonly head: string;
  readonly cell: (row: Row) => ReactNode;
  /** What the column sorts by; without it the head does not sort. */
  readonly sort?: (row: Row) => string | number | null;
  /** The value its choice narrows by; without it the column has no choice. */
  readonly choice?: (row: Row) => string;
  /** A choice's value in words, and the choice's own name where it differs from the head. */
  readonly words?: (value: string) => string;
  readonly chooser?: string;
  readonly numeric?: boolean;
  readonly className?: string;
}

/** The arrow a sortable head shows: which way it sorts, or that it can. */
function SortMark({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp aria-hidden="true" />;
  if (sorted === "desc") return <ArrowDown aria-hidden="true" />;
  return <ArrowUpDown aria-hidden="true" className="ana-sort-idle" />;
}

/** How many rows hold each value of a choice. */
export function choiceCounts<Row>(rows: readonly Row[], choice: (row: Row) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(choice(row), (counts.get(choice(row)) ?? 0) + 1);
  return counts;
}

export function Table<Row>({
  label,
  rows,
  columns,
  rowKey,
  search,
  placeholder,
  between,
  after,
  selected,
  sorted = [],
}: {
  /** What a row is, plural, as the count and the empty state say it. */
  label: string;
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  /** The text the search box reads of a row; without it there is no search box. */
  search?: (row: Row) => string;
  placeholder?: string;
  /** A divider before a row, drawn only in the list as recorded: no sort, no search, no choice. */
  between?: (row: Row, previous: Row | undefined) => ReactNode;
  after?: ReactNode;
  selected?: (row: Row) => boolean;
  /** The sort the table opens with. */
  sorted?: SortingState;
}) {
  const [sorting, setSorting] = useKept<SortingState>(`${label}.sort`, sorted);
  const [chosen, setChosen] = useKept<ColumnFiltersState>(`${label}.chosen`, []);
  const [query, setQuery] = useKept(`${label}.search`, "");
  const [shown, setShown] = useKept(`${label}.shown`, ROWS);
  const defs = useMemo(
    () =>
      columns.map(
        (column): ColumnDef<Row> => ({
          id: column.id,
          accessorFn: (row) => column.sort?.(row) ?? undefined,
          enableSorting: column.sort !== undefined,
          sortUndefined: "last",
          filterFn: (row, _id, value: readonly string[]) =>
            value.includes(column.choice?.(row.original) ?? ""),
        }),
      ),
    [columns],
  );
  const table = useReactTable({
    // SAFETY: TanStack Table reads `data` and never writes to it.
    data: rows as Row[],
    columns: defs,
    state: { sorting, columnFilters: chosen, globalFilter: query },
    onSortingChange: setSorting,
    onColumnFiltersChange: setChosen,
    globalFilterFn: (row, _id, value: string) =>
      search === undefined || matchesTerms(search(row.original), value),
    getRowId: rowKey,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const narrowed = query.trim() !== "" || chosen.length > 0;
  const recorded = !narrowed && sorting.length === 0;
  const visible = table.getRowModel().rows;
  const choiceOf = (id: string) =>
    // SAFETY: every filter value is set by a `Choose` below, whose ticks are a list of strings.
    (chosen.find((each) => each.id === id)?.value as readonly string[] | undefined) ?? [];
  // A choice every row answers alike would narrow nothing, so it stands only where the rows differ
  // or while it is set.
  const choices = columns.filter(
    ({ id, choice }) =>
      choice !== undefined && (choiceOf(id).length > 0 || new Set(rows.map(choice)).size > 1),
  );
  return (
    <>
      <Filters>
        {search === undefined ? null : (
          <Search value={query} onChange={setQuery} placeholder={placeholder ?? `Search ${label}`} />
        )}
        {choices.map((column) => {
          // A choice offers the values the search and the other choices leave, each with its count,
          // in the order the rows first hold them, and keeps its own ticks while they hold none.
          const choice = column.choice ?? String;
          const ticked = choiceOf(column.id);
          const facet = (table.getColumn(column.id)?.getFacetedRowModel().rows ?? []).map(
            ({ original }) => original,
          );
          const counts = choiceCounts(facet, choice);
          const name = column.chooser ?? column.head;
          return (
            <Choose
              key={column.id}
              label={name}
              chosen={ticked}
              values={[...new Set(rows.map(choice))].filter(
                (each) => ticked.includes(each) || counts.has(each),
              )}
              every={{ label: `Every ${name.toLowerCase()}`, detail: String(facet.length) }}
              format={(each) => column.words?.(each) ?? each}
              detail={(each) => String(counts.get(each) ?? 0)}
              onChange={(next) =>
                table.getColumn(column.id)?.setFilterValue(next.length === 0 ? undefined : next)
              }
            />
          );
        })}
        <span className="ana-filter-count" role="status">
          {narrowed ? `${String(visible.length)} of ${String(rows.length)}` : String(rows.length)} {label}
        </span>
        {narrowed ? (
          <Button
            onClick={() => {
              setQuery("");
              setChosen([]);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </Filters>
      {visible.length === 0 ? (
        <NoSignal title={`No matching ${label}`}>Change the search or clear the filters</NoSignal>
      ) : (
        <div className="ana-table-wrap">
          <table className="ana-table">
            <thead>
              <tr>
                {table.getHeaderGroups()[0]?.headers.map((header) => {
                  const column = columns[header.index];
                  const way = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={column?.numeric === true ? "ana-num" : undefined}
                      aria-sort={way === false ? undefined : way === "asc" ? "ascending" : "descending"}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="ana-sort"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {column?.head}
                          <SortMark sorted={way} />
                        </button>
                      ) : (
                        column?.head
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, shown).map(({ original, index }) => (
                <Fragment key={rowKey(original)}>
                  {recorded ? between?.(original, index === 0 ? undefined : rows[index - 1]) : null}
                  <tr className={selected?.(original) === true ? "is-selected" : undefined}>
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={
                          [column.numeric === true ? "ana-num" : "", column.className ?? ""]
                            .join(" ")
                            .trim() || undefined
                        }
                      >
                        {column.cell(original)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))}
              {recorded && shown >= visible.length ? after : null}
            </tbody>
          </table>
        </div>
      )}
      {visible.length > shown ? (
        <div className="ana-file-pagination">
          <Button onClick={() => setShown(shown + ROWS)}>
            Show {Math.min(ROWS, visible.length - shown)} more
            {visible.length - shown > ROWS ? ` of ${String(visible.length - shown)}` : ""}
          </Button>
        </div>
      ) : null}
    </>
  );
}
