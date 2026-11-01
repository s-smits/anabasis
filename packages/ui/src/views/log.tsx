import { Callout, Section } from "../components/layout.tsx";
import { type Column, Table } from "../components/table.tsx";
import { detailsOf, useLog } from "../live.ts";
import type { CampaignReading, Tier, TimelineGroup, TimelineRow } from "../models.ts";
import type { Navigation, PaneProps } from "../route.ts";
import { AnswerIssues, enter, Pending } from "./drill.tsx";
import { duration, time } from "./format.ts";

/*
 * The Log pane: the campaign as a timeline, one line a thing that happened, newest first, with a
 * session's and a solve's turns and calls counted into its own line (`server/log.ts`). Until
 * 30 October it listed every raw event, three in four a model's turn or call, and on the default
 * tier an event opened to nothing (operator). A line opens where its detail lives: its move, its
 * solve or its task. The exam tier also opens a line's first event raw in the inspector.
 */

const GROUPS: ReadonlyMap<string, string> = new Map<TimelineGroup, string>([
  ["campaign", "Campaign"],
  ["session", "Sessions and comparisons"],
  ["solve", "Solves"],
  ["task", "Tasks"],
  ["harness", "Harnesses"],
  ["wait", "Waits"],
]);

/** Where a line's detail lives: the move it starts, or the last move of its session that a
 *  campaign line such as "Move: build" follows; else its solve or its task. */
function opener(row: TimelineRow, reading: CampaignReading, navigation: Navigation): (() => void) | null {
  const move = reading.moves.findLast(
    ({ index, id }) =>
      index === row.index || (row.group === "campaign" && id === row.session && index < row.index),
  );
  if (move !== undefined) return () => navigation.push({ pane: "moves", move: move.index, solve: null });
  const { solve, task } = row;
  if (row.group === "solve" && solve !== null) {
    return () => enter(navigation, { pane: "moves", move: null, solve });
  }
  if (row.group === "task" && task !== null) {
    return () => navigation.push({ pane: "tasks", task, solve: null });
  }
  return null;
}

function columnsOf(
  reading: CampaignReading,
  navigation: Navigation,
  tier: Tier,
): readonly Column<TimelineRow>[] {
  const raw: Column<TimelineRow> = {
    id: "event",
    head: "Event",
    numeric: true,
    sort: (row) => row.index,
    cell: (row) => (
      <button
        type="button"
        className="ana-row-select"
        data-row={row.index}
        title="Open the raw event"
        onClick={() => navigation.push({ event: row.index, file: null, diff: null })}
      >
        #{row.index}
      </button>
    ),
  };
  return [
    ...(tier === "exam" ? [raw] : []),
    {
      id: "at",
      head: "At",
      sort: (row) => row.index,
      cell: (row) => <span className="ana-num">{time(row.at)}</span>,
    },
    {
      id: "what",
      head: "What happened",
      className: "ana-log-what",
      choice: (row) => row.group,
      chooser: "Kind",
      words: (group) => GROUPS.get(group) ?? group,
      cell: (row) => {
        const open = opener(row, reading, navigation);
        return open === null ? (
          row.what
        ) : (
          <button type="button" className="ana-row-select" onClick={open}>
            {row.what}
          </button>
        );
      },
    },
    {
      id: "session",
      head: "Session",
      className: "ana-mono",
      sort: (row) => row.session,
      choice: (row) => row.session ?? "",
      words: (session) => (session === "" ? "No session" : session),
      cell: (row) => row.session ?? "",
    },
    {
      id: "ran",
      head: "Ran",
      numeric: true,
      sort: (row) => (row.until === null ? null : Date.parse(row.until) - Date.parse(row.at)),
      cell: (row) => (row.until === null ? "" : duration(row.at, row.until)),
    },
  ];
}

export function LogPane({ reading, navigation }: PaneProps) {
  const live = useLog(detailsOf(reading));
  return (
    <Section title="Log">
      {live.data === null ? (
        <Pending live={live} what="the log" />
      ) : (
        <>
          {live.current || live.error === null ? null : (
            <Callout tone="bad">
              <strong>The log could not be read again</strong>
              <p>{live.error}</p>
            </Callout>
          )}
          <AnswerIssues answer={live.data} />
          <div className="ana-dense ana-log">
            <Table
              label="lines"
              rows={live.data.rows}
              columns={columnsOf(reading, navigation, live.data.tier)}
              rowKey={(row) => String(row.index)}
              search={(row) => `${row.what} ${row.session ?? ""} ${row.solve ?? ""} ${row.task ?? ""}`}
              placeholder={`Search ${String(live.data.events)} events by what happened, session, solve or task`}
              selected={(row) => row.index === navigation.route.event}
              sorted={[{ id: "at", desc: true }]}
            />
          </div>
        </>
      )}
    </Section>
  );
}
