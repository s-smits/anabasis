import { useState } from "react";
import { Callout, Section } from "../components/layout.tsx";
import { detailsOf, useLog } from "../live.ts";
import type { PaneProps } from "../route.ts";
import { AnswerIssues, Pending } from "./drill.tsx";
import { useLate } from "./late.ts";
import { ALL, LogList, type LogFilters } from "./log-list.tsx";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";

/*
 * The Log pane (the brief of 11 October, section 7): the log's events a page at a time, filtered by
 * kind and by session (`log-list.tsx`). An event opens in the inspector through the route's
 * `event`; its payload is the exam side's, and the default tier says so there.
 *
 * A page stays on screen while the next page or another filter is read, and the table is marked as
 * reading only once the read is late (`late.ts`): until 14 October each click put a placeholder in
 * the table's place for the frames the server took to answer.
 */

export function LogPane({ reading, navigation }: PaneProps) {
  const [filters, setFilters] = useState<LogFilters>({ kind: ALL, session: ALL });
  const [offset, setOffset] = useState(0);
  const live = useLog(detailsOf(reading), {
    offset: String(offset),
    ...keyIfDefined("kind", filters.kind === ALL ? undefined : filters.kind),
    ...keyIfDefined("session", filters.session === ALL ? undefined : filters.session),
  });
  const late = useLate(live);
  return (
    <Section title="Log">
      {live.data === null ? (
        <Pending live={live} what="the log" />
      ) : (
        <>
          {live.current || live.error === null ? null : (
            <Callout tone="bad">
              <strong>The page could not be read.</strong>
              <p>{live.error}</p>
            </Callout>
          )}
          <AnswerIssues answer={live.data} />
          <LogList
            page={live.data}
            offset={offset}
            reading={late}
            filters={filters}
            onFilters={(next) => {
              setFilters(next);
              setOffset(0);
            }}
            onOffset={setOffset}
            selected={navigation.route.event}
            onOpen={(index) => navigation.push({ event: index, file: null, diff: null })}
          />
        </>
      )}
    </Section>
  );
}
