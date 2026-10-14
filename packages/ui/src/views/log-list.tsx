import { Button, DataTable, NoSignal } from "../components/primitives.tsx";
import { LOG_PAGE_SIZE, type LogPage } from "../models.ts";
import { Filters, Select } from "./controls.tsx";
import { time } from "./format.ts";

/*
 * One page of the log, one line an event: its place, its time, its kind, and the session or solve it
 * belongs to. The server pages it and applies the filters before paging (`LOG_PAGE_SIZE`), as v1's
 * evidence list did, so a long log is never sent whole. An event opens in the inspector.
 *
 * The page shown may be the one before the page asked for, while that one is read: the paging
 * steps from the offset asked for, so that two quick clicks on Next go two pages on, and the table
 * says it is reading once the read is late.
 */

export const ALL = "all";

/** What the list is filtered by, and where it is paged to. */
export interface LogFilters {
  readonly kind: string;
  readonly session: string;
}

export function LogList({
  page,
  offset,
  reading,
  filters,
  onFilters,
  onOffset,
  selected,
  onOpen,
}: {
  /** The page shown, which may be the last one read while `offset` is read. */
  page: LogPage;
  /** The offset asked for. */
  offset: number;
  /** Whether the page asked for has been read for long enough to say so. */
  reading: boolean;
  filters: LogFilters;
  onFilters: (filters: LogFilters) => void;
  onOffset: (offset: number) => void;
  /** The event the inspector shows. */
  selected: number | null;
  onOpen: (index: number) => void;
}) {
  const last = Math.min(page.offset + page.events.length, page.matching);
  const filtered = filters.kind !== ALL || filters.session !== ALL;
  return (
    <>
      <Filters>
        <Select
          label="Kind"
          value={filters.kind}
          onChange={(kind) => onFilters({ ...filters, kind })}
          values={[ALL, ...page.kinds]}
          format={(value) => (value === ALL ? "Every kind" : value)}
        />
        <Select
          label="Session"
          value={filters.session}
          onChange={(session) => onFilters({ ...filters, session })}
          values={[ALL, ...page.sessions]}
          format={(value) => (value === ALL ? "Every session" : value)}
        />
        {filtered ? (
          <Button onClick={() => onFilters({ kind: ALL, session: ALL })}>Clear filters</Button>
        ) : null}
      </Filters>
      {page.events.length === 0 ? (
        <NoSignal title="No matching event">Change the filters or clear them.</NoSignal>
      ) : (
        <div className={`ana-dense ana-log${reading ? " is-reading" : ""}`} aria-busy={reading}>
          <DataTable>
            <thead>
              <tr>
                <th className="ana-num">Event</th>
                <th>At</th>
                <th>Kind</th>
                <th>Session</th>
                <th>Solve</th>
              </tr>
            </thead>
            <tbody>
              {page.events.map((event) => (
                <tr key={event.index} className={event.index === selected ? "is-selected" : undefined}>
                  <td className="ana-num">
                    <button
                      type="button"
                      className="ana-row-select"
                      data-row={event.index}
                      aria-current={event.index === selected ? "true" : undefined}
                      onClick={() => onOpen(event.index)}
                    >
                      #{event.index}
                    </button>
                  </td>
                  {/* Left under its head, in tabular figures: aligned right in the widest column, a
                      time stood against the kind beside it, far from its head (14 October). */}
                  <td>
                    <span className="ana-num">{time(event.at)}</span>
                  </td>
                  <td className="ana-mono">{event.kind}</td>
                  <td className="ana-mono">{event.session ?? ""}</td>
                  <td className="ana-mono">{event.solve ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
      <div className="ana-file-pagination">
        <span role="status">
          {page.matching === 0 ? "0" : `${String(page.offset + 1)}–${String(last)}`} of {page.matching}{" "}
          {page.matching === 1 ? "event" : "events"}
          {reading ? " · reading" : ""}
        </span>
        <Button disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - LOG_PAGE_SIZE))}>
          Previous
        </Button>
        <Button
          disabled={offset + LOG_PAGE_SIZE >= page.matching}
          onClick={() => onOffset(offset + LOG_PAGE_SIZE)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
