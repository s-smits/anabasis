import { useState } from "react";
import { ExamSide } from "../components/exam-side.tsx";
import { Callout, Section } from "../components/layout.tsx";
import { Disclosure } from "../components/primitives.tsx";
import { TriggerList } from "../components/triggers.tsx";
import { detailsOf, useLog } from "../live.ts";
import type { CampaignReading } from "../models.ts";
import type { PaneProps } from "../route.ts";
import { AnswerIssues, Pending } from "./drill.tsx";
import { useLate } from "./late.ts";
import { ALL, LogList, type LogFilters } from "./log-list.tsx";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import { plural } from "../../../../src/meta/text.ts";

/*
 * The Log pane (the brief of 11 October, section 7): the whole-run reader's rows and triggers
 * collapsed at the top (`overview`, `tools/wri/read.ts`), then the log's events a page at a time,
 * filtered by kind and by session (`log-list.tsx`). An event opens in the inspector through the
 * route's `event`; its payload is the exam side's, and the default tier says so there.
 *
 * A page stays on screen while the next page or another filter is read, and the table is marked as
 * reading only once the read is late (`late.ts`): until 14 October each click put a placeholder in
 * the table's place for the frames the server took to answer.
 */

/** The reader's rows and triggers, one click away; in the default tier, one quiet line for the
 *  exam side's triggers it holds back. */
function Reader({ reader }: { reader: CampaignReading["reader"] }) {
  return (
    <Disclosure
      title={`The reader: ${String(reader.rows.length)} rows, ${String(reader.triggers.length)} triggers`}
    >
      <dl className="ana-reader-rows">
        {reader.rows.map((row) => (
          <div key={row.id}>
            <dt>
              {row.id} · {row.title}
            </dt>
            <dd>
              {row.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <TriggerList triggers={reader.triggers} none="No trigger fired." />
      {reader.withheld === 0 ? null : (
        <ExamSide what={`${plural(reader.withheld, "trigger")} of its lanes 1 to 12, which name checks`} />
      )}
    </Disclosure>
  );
}

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
      <Reader reader={reading.reader} />
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
