/**
 * What move 7 reads its rows from: a campaign's plan, and its log as comparisons.
 *
 * The table (`decide.ts`) asks one question after another of the same reading of the log, which
 * is made here once: every comparison in the order it began, the reference harness and the last
 * one a session left, and what the next comparison would be short of. It adds no fold of its own
 * beside the owners it reads: the supply (`admission.ts`), the reports and the reference
 * (`reports.ts`).
 *
 * A campaign runs at one setting, recorded once (`campaign.setting`, `tools/d2/setting.ts`), so
 * every comparison of the log is read. Until 11 October a setting could be set again, and a
 * campaign walked a ladder of shorter budgets and returned to one, so the comparisons since the
 * last record were read apart (`docs/simplify.md`, package A).
 */
import type { LogEvent } from "../kernel/log.ts";
import { lastReports, latestBuilt, promoted } from "../kernel/reports.ts";
import { isString, type JsonObject } from "../meta/json-shape.ts";
import { shortOf, supplyOf, type Wanted } from "./admission.ts";

/** What a campaign was set to run by: what move 7 reads beside the log. */
export interface Plan {
  /** Builder sessions before a comparison, after the campaign's first, which follows one. */
  readonly sessions: number;
  /** The moves without a gain, idle Examiner sessions and comparisons without room the campaign
   *  bears in a row before it ends (`PATIENCE`). */
  readonly patience: number;
  /** Whether the campaign's pack holds a task its log does not. */
  readonly unprepared: boolean;
  /** The practice tasks the campaign is brought to (`--practice`, `tools/d2/prepare.ts`), where
   *  the caller holds a count. */
  readonly practice?: number | undefined;
  /** The size a comparison is asked for at, as its admission reads it. */
  readonly wanted: Pick<Wanted, "target" | "level" | "trigger">;
  /** The operator's reason to go on past the stop rule, where one was given. */
  readonly pastStop?: string | undefined;
  /** Whether the campaign opened from a prompt: its exam is then drafted, and no pack holds it. */
  readonly prompted?: boolean | undefined;
  /** The checks the operator's command admits by name (`--admit`). */
  readonly admits?: readonly string[] | undefined;
  /** The dollars left of the campaign's total and the reserve one solve is held at; null for a
   *  campaign with no total, as a rehearsal's, whose seats are paid nothing. */
  readonly left?: { readonly dollars: number; readonly reserve: number } | null | undefined;
}

/** One comparison as move 7 reads it: where it began, its two harnesses, and its last report. */
export interface Compared {
  readonly id: string;
  readonly at: number;
  readonly old: string;
  readonly fresh: string;
  readonly noise: boolean;
  readonly report: JsonObject | null;
  /** Where it first reported; null while it has not. */
  readonly reported: number | null;
}

/** What the table's rows on the comparisons are read from: the log's comparisons by setting, the
 *  two harnesses in question, and what the next comparison would be short of. */
export interface Ground {
  readonly events: readonly LogEvent[];
  readonly plan: Plan;
  readonly all: readonly Compared[];
  /** The reference harness, null before any comparison or promotion has named it. */
  readonly reference: string | null;
  /** The Starter Built Harness, as the reports name it; null before any comparison reported. */
  readonly starter: string | null;
  readonly latest: string | null;
  readonly tasksShort: ReturnType<typeof shortOf>;
  /** The held-out tasks a comparison may score: the ones not waiting for a person's label. */
  readonly scorable: number;
  /** The Examiner sessions in a row, up to the log's end, that held out no task. */
  readonly drafts: number;
}

const STARTED = "comparison.started";

/** Every comparison of a log, in the order they began. One a log of 8 October holds by its report
 *  alone stands where it first reported. */
export function comparisonsOf(events: readonly LogEvent[]): Compared[] {
  const reports = new Map(lastReports(events).map((report) => [report.session, report]));
  const begun = new Map<string, Compared>();
  for (const [at, { kind, data }] of events.entries()) {
    const { session, old, fresh } = data;
    if (kind !== STARTED || !isString(session) || !isString(old) || !isString(fresh)) continue;
    begun.set(session, {
      id: session,
      at,
      old,
      fresh,
      noise: data.noise === true,
      report: reports.get(session)?.data ?? null,
      reported: reports.get(session)?.index ?? null,
    });
  }
  for (const [id, { index, data }] of reports) {
    if (begun.has(id) || !isString(data.old) || !isString(data.fresh)) continue;
    begun.set(id, {
      id,
      at: index,
      old: data.old,
      fresh: data.fresh,
      noise: false,
      report: data,
      reported: index,
    });
  }
  return [...begun.values()].toSorted((one, other) => one.at - other.at);
}

/** The reported comparisons of `fresh` with `old` among `comparisons`. */
export function pairOf(comparisons: readonly Compared[], fresh: string, old: string | null) {
  return comparisons.flatMap((each) =>
    each.fresh === fresh && each.old === old && each.report !== null ? [each.report] : [],
  );
}

/** The Examiner sessions in a row, up to the log's end, that ended whole and held out no task. A
 *  session that held one out moved the campaign, however few it wrote: the first campaign run by
 *  one command ended on three sessions that had written four tasks between them (2026-10-09). A
 *  session the provider failed is not idle: it was given no chance to write (`crashedRun`). */
export function idleDrafts(events: readonly LogEvent[]): number {
  const sessions = events
    .filter(({ kind, data }) => kind === "exam.finished" && (data.ended !== "crashed" || moved(data)))
    .toReversed();
  const wrote = sessions.findIndex(({ data }) => moved(data));
  return wrote === -1 ? sessions.length : wrote;
}

/** Whether a session moved the campaign whatever its ending: an Examiner's held a task out, or a
 *  Builder's changed its harness. A session that did and then lost a turn to the provider is
 *  `crashed` with its tasks held (`exam.finished.held` is written whatever `ended` says). */
function moved(data: JsonObject): boolean {
  return (Array.isArray(data.held) && data.held.length > 0) || data.changed === true;
}

/** The Builder and Examiner sessions in a row, up to the log's end and since the campaign last
 *  ended, that the provider failed before they held out a task or changed a harness, with what
 *  the last crash said. Such a session held out no task and left no harness because its provider
 *  refused it, not because the domain gave it nothing: on 11 October six Examiner sessions of one campaign crashed in a row on a provider's
 *  session limit, each under a new id within minutes, and the campaign ended `no-room` with "the
 *  tasks could not be written", where the account was out (buffer pr193 on the operator's host);
 *  another lost a Builder session the same way (buffer-a). The table ends such a campaign on its
 *  environment after `CRASHES` of them (`decide.ts`), and the count starts again after that
 *  ending, so that the command run again by the campaign's name goes on once the provider is
 *  back. */
export function crashedRun(events: readonly LogEvent[]) {
  // A wait for the provider's named reset starts the count again as an ending does (`waitOut`).
  const since = events.findLastIndex(
    ({ kind, data }) => kind === "campaign.ended" || (kind === "campaign.waited" && data.for === "provider"),
  );
  const sessions = events
    .slice(since + 1)
    .filter(({ kind }) => kind === "exam.finished" || kind === "build.finished")
    .toReversed();
  const whole = sessions.findIndex(({ data }) => data.ended !== "crashed" || moved(data));
  const count = whole === -1 ? sessions.length : whole;
  const crash = sessions[0]?.data.crash;
  return { count, crash: count > 0 && isString(crash) ? crash : null };
}

/** What the rows on the comparisons are read from, for a log and its plan. */
export function groundOf(events: readonly LogEvent[], plan: Plan): Ground {
  const all = comparisonsOf(events);
  const starter = all.map(({ report }) => report?.starter).find(isString) ?? null;
  const supply = supplyOf(events);
  return {
    events,
    plan,
    all,
    reference: promoted(events) ?? starter,
    starter,
    latest: latestBuilt(events),
    tasksShort: shortOf(supply, plan.wanted),
    scorable: supply.held,
    drafts: idleDrafts(events),
  };
}
