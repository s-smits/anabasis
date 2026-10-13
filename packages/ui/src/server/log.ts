/**
 * `GET /api/log?key=&offset=&kind=&session=` and `GET /api/event?key=&index=`: the raw events, a
 * page of `LOG_PAGE_SIZE` with the filters applied before paging, and one event whole, which the
 * exam tier alone answers (`EXAM_ONLY`, refused by the router before this is asked).
 *
 * An event's session is its own `session` field; a solve's events, which name a solve and no
 * session, are the session of the comparison their solve's start names (`solvesIn`), and a
 * practice solve's are none.
 */
import type { EventKind } from "../../../../src/kernel/log.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import { LOG_PAGE_SIZE, type LogEventDetail, type LogPage, type LogRow, type Query } from "../models.ts";
import { type Reading, Unanswerable } from "./context.ts";
import { once, solvedIn } from "./folds.ts";
import { campaignAt } from "./logs.ts";

/** Every event as a row, with the kinds and the sessions the log holds, in the order first met. */
const rowsIn = once((log) => {
  const comparisons = new Map(
    [...solvedIn(log).values()].map(({ id, start }) => [
      id,
      isString(start.comparison) ? start.comparison : null,
    ]),
  );
  const kinds = new Set<EventKind>();
  const sessions = new Set<string>();
  const rows = log.events.map(({ at, kind, data }, index): LogRow => {
    kinds.add(kind);
    const solve = isString(data.solve) ? data.solve : null;
    const own = isString(data.session) ? data.session : null;
    if (own !== null) sessions.add(own);
    return {
      index,
      at,
      kind,
      session: own ?? (solve === null ? null : (comparisons.get(solve) ?? null)),
      solve,
    };
  });
  return { rows, kinds: [...kinds], sessions: [...sessions] };
});

/** A whole number from nothing up, as a URL carries it. */
function counted(value: string | undefined, name: string): number {
  if (value === undefined) return 0;
  const number = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(number)) {
    throw new Unanswerable(400, `${name} is a whole number from 0, and ${value} is not`);
  }
  return number;
}

export function logAnswer(reading: Reading, query: Query<"log">): LogPage {
  const { log, issues } = campaignAt(reading, query.key);
  const offset = counted(query.offset, "offset");
  const { rows, kinds, sessions } = rowsIn(log);
  const matching = rows.filter(
    (row) =>
      (query.kind === undefined || row.kind === query.kind) &&
      (query.session === undefined || row.session === query.session),
  );
  return {
    tier: reading.tier,
    issues,
    events: matching.slice(offset, offset + LOG_PAGE_SIZE),
    offset,
    matching: matching.length,
    hasMore: offset + LOG_PAGE_SIZE < matching.length,
    kinds,
    sessions,
  };
}

export function eventAnswer(reading: Reading, query: Query<"event">): LogEventDetail {
  const { log, issues } = campaignAt(reading, query.key);
  const index = counted(query.index, "index");
  const event = log.events[index];
  if (event === undefined) {
    throw new Unanswerable(
      404,
      `the log holds ${String(log.events.length)} events, and no event ${String(index)}`,
    );
  }
  return { tier: reading.tier, issues, at: event.at, kind: event.kind, data: event.data };
}
