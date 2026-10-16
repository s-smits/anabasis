/**
 * What move 7 reads its rows from: a campaign's plan, and its log read once (`groundOf`).
 *
 * The table (`decide.ts`) asks one question after another of the same reading of the log: the
 * supply and the gate's refusals of the next comparison (`admission.ts`), every comparison in the
 * order it began, the reference harness and the one a session left that waits to be read, and the
 * pair's last reading. It adds no fold of its own beside the owners it reads.
 *
 * A campaign runs at one setting, recorded once (`campaign.setting`, `tools/d2/setting.ts`), so
 * every comparison of the log is read.
 */
import type { LogEvent } from "../kernel/log.ts";
import { lastReports, latestBuilt, referenceOf } from "../kernel/reports.ts";
import { isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { refusals, supplyOf, type Wanted } from "./admission.ts";

/** What a campaign was set to run by: what move 7 reads beside the log. */
export interface Plan {
  /** Builder sessions before a comparison, after set-up stands, which each session's follows. */
  readonly sessions: number;
  /** The moves without a gain (`stopRule`) and the readings that left nothing to gain
   *  (`roomless`, `decide.ts`) the campaign bears in a row before it ends (`PATIENCE`). */
  readonly patience: number;
  /** Whether the campaign's pack holds a task its log does not. */
  readonly unprepared: boolean;
  /** The practice tasks the campaign is brought to (`--practice`, `tools/d2/prepare.ts`); null
   *  where the caller holds no count, and nothing is released for one. */
  readonly practice: number | null;
  /** The size a comparison is asked for at, as its admission reads it. */
  readonly wanted: Pick<Wanted, "target" | "level" | "trigger">;
  /** The operator's reason to go on past the stop rule, or null. */
  readonly pastStop: string | null;
  /** Whether the campaign opened from a prompt: its exam is then drafted, and no pack holds it. */
  readonly prompted: boolean;
  /** The checks the operator's command admits by name (`--admit`). */
  readonly admits: readonly string[];
  /** The dollars left of the campaign's total and the reserve one solve is held at; null for a
   *  campaign with no total, as a rehearsal's, whose seats are paid nothing. */
  readonly left: { readonly dollars: number; readonly reserve: number } | null;
}

/** One comparison as move 7 reads it: where it began, its two harnesses, and its last report with
 *  where it first reported, both null while it has not. */
interface Compared {
  readonly id: string;
  readonly at: number;
  readonly old: string;
  readonly fresh: string;
  readonly report: JsonObject | null;
  readonly reported: number | null;
}

/** A comparison that reported. */
type Reported = Compared & { readonly report: JsonObject; readonly reported: number };

/** Every comparison of a log that began, in the order they began; one whose start is on record
 *  twice stands where it last began. An old ladder's readings are no comparison of the table's
 *  (`lastReports`, `src/kernel/reports.ts`). */
export function comparisonsOf(events: readonly LogEvent[]): Compared[] {
  const reports = new Map(lastReports(events).map((report) => [report.session, report]));
  const begun = new Map<string, Compared>();
  for (const [at, { kind, data }] of events.entries()) {
    const { session, old, fresh } = data;
    if (kind !== "comparison.started" || !isString(session) || !isString(old) || !isString(fresh)) continue;
    if (data.ladder === true) continue;
    const last = reports.get(session);
    begun.set(session, {
      id: session,
      at,
      old,
      fresh,
      report: last?.data ?? null,
      reported: last?.index ?? null,
    });
  }
  return [...begun.values()].toSorted((one, other) => one.at - other.at);
}

/** A session's ending, whatever its seat: each writes `<seat>.finished` with its id, which a
 *  solve's does not name. Until 16 October the crash rule named the Builder's and
 *  the Examiner's, and three drafts that crashed on a named reset ended three fresh campaigns. */
export const sessionEnded = ({ kind, data }: LogEvent) =>
  kind.endsWith(".finished") && isString(data.session);

/** The sessions in a row, up to the log's end and since the campaign last
 *  ended, that the provider failed before they held out a task or changed a harness, with what
 *  the last session's crash said where it crashed. Such a session held out no task and left no harness because its provider
 *  refused it, not because the domain gave it nothing: on 11 October six Examiner sessions of one
 *  campaign crashed in a row on a provider's session limit, and the campaign ended `no-room`
 *  where the account was out. The table ends such a campaign on its environment after `CRASHES`
 *  of them (`decide.ts`), and the count starts again after that ending, so that the command run
 *  again by the campaign's name goes on once the provider is back. */
export function crashedRun(events: readonly LogEvent[]) {
  // A wait for the provider's named reset starts the count again as an ending does (`waitOut`).
  const since = events.findLastIndex(
    ({ kind, data }) => kind === "campaign.ended" || (kind === "campaign.waited" && data.for === "provider"),
  );
  // A session the host stopped says nothing of the provider, and is passed over: until 14 October
  // a Builder halted as a third crash ended the campaign read as whole, the count went back to
  // nought, and the command exited with no ending on record.
  const sessions = events
    .slice(since + 1)
    .filter((event) => sessionEnded(event) && event.data.ended !== "stopped")
    .toReversed();
  // A session moved the campaign whatever its ending where an Examiner's held a task out: one that
  // did and then lost a turn to the provider is `crashed` with its tasks held (`exam.finished.held`
  // is written whatever `ended` says). A Builder's moved it where its harness is one the campaign
  // goes on from (`latestBuilt`), which a crashed session's is only where it was checkpointed: one
  // that edited and then crashed leaves the next session the same parent, so it counts as a crash.
  const kept = new Set(
    events.slice(since + 1).flatMap(({ kind, data }) => (kind === "build.checkpoint" ? [data.session] : [])),
  );
  const moved = (data: JsonObject) =>
    (Array.isArray(data.held) && data.held.length > 0) ||
    (isNumber(data.tries) && data.tries > 0) ||
    (data.changed === true && (data.ended !== "crashed" || kept.has(data.session)));
  const whole = sessions.findIndex(({ data }) => data.ended !== "crashed" || moved(data));
  const count = whole === -1 ? sessions.length : whole;
  // What the last session's crash said, counted or not: a Builder checkpointed before the
  // provider's limit moved the campaign, and the limit is still the next session's. Until
  // 15 October it was not waited for, and recode-pr169-sonnet's b-2 opened into it and crashed.
  const [last] = sessions;
  return {
    count,
    crash: last?.data.ended === "crashed" && isString(last.data.crash) ? last.data.crash : null,
  };
}

/**
 * What the table's rows are read from, for a log and its plan: the supply folded once, the codes
 * the gate would refuse the next comparison with, the comparisons, the harnesses in question, and
 * the pair's last reading.
 */
export function groundOf(events: readonly LogEvent[], plan: Plan) {
  const supply = supplyOf(events);
  const asked = { ...plan.wanted, patience: plan.patience, pastStop: plan.pastStop ?? undefined };
  const all = comparisonsOf(events);
  const reports = all.filter((each): each is Reported => each.report !== null && each.reported !== null);
  const reference = referenceOf(events);
  const starter = reports.map(({ report }) => report.starter).find(isString) ?? null;
  const latest = latestBuilt(events);
  const waiting = latest === reference ? null : latest;
  const last = reports.at(-1);
  // With no harness waiting, the reading in question is a control's, the starter against the
  // reference, where that is the last comparison made: it says whether the tasks leave the
  // reference room before a Builder session is paid for.
  const control =
    last?.fresh === starter && last.old === reference && starter !== reference ? last : undefined;
  const pair = reports.findLast(({ fresh, old }) => fresh === waiting && old === reference);
  const read = waiting === null ? control : pair;
  return {
    events,
    plan,
    supply,
    /** The codes the gate would refuse the next comparison with (`refusals`). */
    refused: new Set<string>(refusals(supply, asked).map(({ code }) => code)),
    /** Every comparison in the order it began, and those of them that reported. */
    all,
    reports,
    /** The reference harness, null before any comparison or promotion has named it. */
    reference,
    /** The Starter Built Harness, as the reports name it; null before any comparison reported. */
    starter,
    latest,
    /** The harness a session left that is not the reference, which waits to be read against it. */
    waiting,
    /** The last reading of the pair in question: the waiting harness's against the reference, or
     *  with none waiting a control's; null where the pair has none. */
    read: read === undefined ? null : { ...read, control: waiting === null },
  };
}
