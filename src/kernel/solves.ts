/**
 * Pure folds over a campaign log's solve attempts, conditions, verdicts, Referee rulings, and
 * human settlement labels.
 */
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { type FileManifest, manifestOf } from "./answer-files.ts";
import { type Condition, conditionsOf, type Limits, limitsIn } from "./condition.ts";
import { eventsOf, type LogEvent } from "./log.ts";
import type { Verdict } from "./verify.ts";

/** One solve attempt from `solve.started` to `solve.finished` (null fields while still open). */
export interface Solve {
  readonly id: string;
  readonly started: number;
  readonly finished: number | null;
  readonly condition: string;
  readonly ending: JsonObject | null;
  readonly start: JsonObject;
  readonly end: JsonObject | null;
}

/** A solve paired with the verified condition recorded for it. */
export interface Ran extends Solve {
  readonly under: Condition;
}

interface Ended {
  readonly finished: number;
  readonly end: JsonObject;
}

type Stands = ReadonlyMap<string, string | null>;
type Checked = Pick<Solve, "id" | "ending">;

/** Last logged verdict for one solve's submitted answer. */
export interface Judged {
  readonly solve: string;
  readonly task: string | null;
  readonly answer: JsonValue | undefined;
  readonly files?: readonly FileManifest[];
  readonly kind: string;
  readonly fault: string | null;
  readonly checker: Verdict | null;
}

const EXAMINER_STARTS = ["exam.started", "draft.started"] as const;

/** Every solve attempt in log start order. */
export function solvesIn(events: readonly LogEvent[], upTo = events.length - 1): Solve[] {
  const solves = new Map<string, Solve>();
  for (const {
    index,
    event: { data },
  } of eventsOf(events, "solve.started", upTo)) {
    if (!isString(data.solve)) continue;
    solves.set(data.solve, {
      id: data.solve,
      started: index,
      finished: null,
      condition: isString(data.condition) ? data.condition : "",
      ending: null,
      start: data,
      end: null,
    });
  }
  for (const {
    index,
    event: { data },
  } of eventsOf(events, "solve.finished", upTo)) {
    const started = isString(data.solve) ? solves.get(data.solve) : undefined;
    if (started !== undefined && index > started.started) {
      solves.set(started.id, { ...started, finished: index, ending: asRecord(data.ending), end: data });
    }
  }
  return [...solves.values()];
}

/** Session ids of Examiner writing and drafting sessions (`exam.started`, `draft.started`). */
export function examinerSessions(
  events: readonly LogEvent[],
  upTo = events.length - 1,
): Set<JsonValue | undefined> {
  return new Set(
    EXAMINER_STARTS.flatMap((kind) => eventsOf(events, kind, upTo).map(({ event }) => event.data.session)),
  );
}

/** Every solve except Examiner probes (`try_reference` / legacy `try_task`). */
export function countedSolves(events: readonly LogEvent[], upTo = events.length - 1): Solve[] {
  const sessions = examinerSessions(events, upTo);
  return solvesIn(events, upTo).filter(({ start }) => !sessions.has(start.comparison));
}

/** Counted solves paired with their verified condition, omitting any solve whose opened harness
 *  disagreed with its condition. */
export function ranUnder(
  events: readonly LogEvent[],
  solves = countedSolves(events),
  upTo = events.length - 1,
): Ran[] {
  if (solves.length === 0) return [];
  const conditions = conditionsOf(events, new Set(solves.map(({ condition }) => condition)), upTo);
  return solves.flatMap((solve) => {
    const under = conditions.get(solve.condition);
    const opened = solve.end?.harness;
    return under === undefined || (isString(opened) && opened !== under.harness) ? [] : [{ ...solve, under }];
  });
}

/** Practice solves: test-side counted solves that belong to no comparison (rule 3 boundary). */
export function practiceRan(events: readonly LogEvent[]): Ran[] {
  const uncompared = countedSolves(events).filter(({ start }) => start.comparison === undefined);
  return ranUnder(events, uncompared).filter(({ under }) => under.side === "test");
}

/** Model, effort, and limits of the last test-side solve started in `events`, or null before any. */
export function solverLast(
  events: readonly LogEvent[],
): { readonly model: string; readonly effort: string; readonly limits: Limits } | null {
  const tested = new Map(
    eventsOf(events, "condition.recorded").flatMap(({ event: { data } }) => {
      const condition = asRecord(data.condition);
      return isString(data.id) && condition?.side === "test" ? [[data.id, condition] as const] : [];
    }),
  );
  const started = eventsOf(events, "solve.started").findLast(
    ({ event: { data } }) => isString(data.condition) && tested.has(data.condition),
  )?.event.data.condition;
  const ran = isString(started) ? tested.get(started) : undefined;
  const limits = limitsIn(ran?.limits);
  return ran !== undefined && isString(ran.model) && isString(ran.effort) && limits !== null
    ? { model: ran.model, effort: ran.effort, limits }
    : null;
}

/** Finished solves from `solves`, ordered by `finished` event index. */
export function ended<Each extends Solve>(solves: readonly Each[]): (Each & Ended)[] {
  return solves
    .flatMap((s) =>
      s.finished !== null && s.end !== null ? [{ ...s, finished: s.finished, end: s.end }] : [],
    )
    .toSorted((a, b) => a.finished - b.finished);
}

/** True for pass, false for fail or malformed flag, null for non-result or unfinished solve. */
export function passed({ ending }: Pick<Solve, "ending">): boolean | null {
  if (ending?.outcome === "pass") return true;
  return ending?.outcome === "fail" || ending?.outcome === "flagged" ? false : null;
}

/** True when `ending` is a check rejection (adjudicated by the Referee, rule 8). */
export function rejected(ending: JsonObject | null | undefined): boolean {
  return ending?.outcome === "fail" && ending.kind === "rejected";
}

/** Last Referee ruling per solve (null when the Referee session ended without ruling). */
export function rulingsOf(events: readonly LogEvent[]): Map<string, string | null> {
  return new Map(
    eventsOf(events, "referee.finding").flatMap(({ event: { data } }) =>
      isString(data.solve) ? [[data.solve, isString(data.ruling) ? data.ruling : null] as const] : [],
    ),
  );
}

/** Provider error from the last Referee finding touching any of `solves`, or null. */
export function refereeErrorOf(events: readonly LogEvent[], solves: readonly string[]): string | null {
  const wanted = new Set(solves);
  const error = eventsOf(events, "referee.finding").findLast(
    ({ event: { data } }) => isString(data.solve) && wanted.has(data.solve) && isString(data.error),
  )?.event.data.error;
  return isString(error) ? error : null;
}

/** Human labels per solve from each settled comparison's last `comparison.reported` event:
 *  rejection labels (`"labels"`, default) or sampled pass labels (`"passes"`). */
export function labelsIn(
  events: readonly LogEvent[],
  field: "labels" | "passes" = "labels",
): Map<string, string> {
  const last = new Map(
    eventsOf(events, "comparison.reported").flatMap(({ event: { data } }) =>
      isString(data.session) ? [[data.session, data] as const] : [],
    ),
  );
  return new Map(
    [...last.values()].flatMap((data) =>
      Object.entries(asRecord(asRecord(data.settled)?.[field]) ?? {}).flatMap(([solve, label]) =>
        isString(label) ? [[solve, label] as const] : [],
      ),
    ),
  );
}

/** Effective rejection standing per solve: human label overrides Referee ruling (rule 8). */
export function standsOf(events: readonly LogEvent[]): Map<string, string | null> {
  return new Map([...rulingsOf(events), ...labelsIn(events)]);
}

/** True when `solve` is a rejection not yet established as `earned` (`standsOf`). */
export function rejectionAside(
  events: readonly LogEvent[],
  solve: Checked,
  stands: Stands | null = null,
): boolean {
  return rejected(solve.ending) && (stands ?? standsOf(events)).get(solve.id) !== "earned";
}

/** Last `verdict` event recorded for each solve. */
export function verdictsOf(events: readonly LogEvent[]): Map<string, Judged> {
  const found = new Map<string, Judged>();
  for (const {
    event: { data },
  } of eventsOf(events, "verdict")) {
    if (!isString(data.solve)) continue;
    found.set(data.solve, {
      solve: data.solve,
      task: isString(data.task) ? data.task : null,
      answer: data.answer,
      ...keyIfDefined("files", data.files === undefined ? undefined : manifestOf(data.files)),
      kind: isString(data.kind) ? data.kind : "",
      fault: isString(data.fault) ? data.fault : null,
      checker: checkerVerdict(data),
    });
  }
  return found;
}

/** Parse the checker's verdict and objective measure from a `verdict` event payload. */
export function checkerVerdict(data: JsonObject): Verdict | null {
  if (data.kind === "pass") {
    return {
      kind: "pass",
      ...keyIfDefined("objective", isNumber(data.objective) ? data.objective : undefined),
    };
  }
  if (data.kind === "fail" && Array.isArray(data.blocking) && data.blocking.length > 0) {
    return { kind: "fail", blocking: data.blocking.filter(isString) };
  }
  return data.kind === "faulty" && isString(data.check) && isString(data.reason)
    ? { kind: "faulty", check: data.check, reason: data.reason }
    : null;
}
