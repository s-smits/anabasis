/**
 * What move 7 reads its rows from: a campaign's plan, and its log as comparisons by setting.
 *
 * The table (`decide.ts`) asks one question after another of the same reading of the log, which
 * is made here once: every comparison in the order it began, the stretches of the log between two
 * records of the setting, the reference harness and the last one a session left, and what the
 * next comparison would be short of. It adds no fold of its own beside the owners it reads: the
 * supply (`admission.ts`), the reports and the reference (`reports.ts`).
 *
 * A setting is recorded once and again at each change (`campaign.setting`), and no reading is
 * carried across two. A campaign returns to a budget, so the comparisons under its setting are
 * those of every stretch of the log that stood under it (`under`).
 */
import type { LogEvent } from "../kernel/log.ts";
import { lastReports, latestBuilt, promoted } from "../kernel/reports.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { stableJson } from "../meta/stable-json.ts";
import { shortOf, supplyOf, type Wanted } from "./admission.ts";

/** What a campaign was set to run by: what move 7 reads beside the log. */
export interface Plan {
  /** The full limit of a solve in the model's own turns, null where they are not limited. */
  readonly limit: number | null;
  /** The shorter budgets a comparison is also read at, in the model's turns. */
  readonly ladder: readonly number[];
  /** Builder sessions before a comparison, after the campaign's first, which follows one. */
  readonly sessions: number;
  /** Whether the campaign's pack holds a task its log does not. */
  readonly unprepared: boolean;
  /** The practice tasks the campaign is brought to (`--practice`, `tools/d2/prepare.ts`), where
   *  the caller holds a count. */
  readonly practice?: number | undefined;
  /** The size a comparison is asked for at, as its admission reads it. */
  readonly wanted: Pick<Wanted, "target" | "level" | "restarted">;
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

/** One stretch of the log between two records of the setting. */
export interface Under {
  /** The model's turns that setting holds a solve to. */
  readonly turns: number | null;
  /** Everything else the record holds, as one text: two stretches that agree in it and in the
   *  turns stood under one setting. */
  readonly rest: string;
  readonly comparisons: readonly Compared[];
}

/** What the table's rows on the comparisons are read from: the log's comparisons by setting, the
 *  two harnesses in question, and what the next comparison would be short of. */
export interface Ground {
  readonly events: readonly LogEvent[];
  readonly plan: Plan;
  readonly all: readonly Compared[];
  readonly settings: readonly Under[];
  /** The comparisons under the campaign's setting, in every stretch of the log that stood under
   *  it, and the model's turns it holds a solve to. */
  readonly here: readonly Compared[];
  readonly turns: number | null;
  /** What the campaign's setting holds beside the model's turns (`Under.rest`). */
  readonly rest: string;
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
const SETTING = "campaign.setting";

/** Every comparison of a log, in the order they began. One a log of 8 October holds by its report
 *  alone stands where it first reported. */
function comparisonsOf(events: readonly LogEvent[]): Compared[] {
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

/** The comparisons under each record of the setting, oldest first. A log with no record is one
 *  setting, and what stands before the first record belongs to it. */
function settingsOf(events: readonly LogEvent[], comparisons: readonly Compared[]): Under[] {
  const records = events.flatMap(({ kind, data }, index) =>
    kind === SETTING
      ? [
          {
            index,
            turns: isNumber(data.modelTurns) ? data.modelTurns : null,
            rest: stableJson({ ...data, modelTurns: null }),
          },
        ]
      : [],
  );
  if (records.length === 0) return [{ turns: null, rest: "", comparisons }];
  return records.map(({ index, turns, rest }, nth) => {
    const next = records[nth + 1]?.index ?? Number.POSITIVE_INFINITY;
    return {
      turns,
      rest,
      comparisons: comparisons.filter(({ at }) => (nth === 0 || at > index) && at < next),
    };
  });
}
/** The comparisons made under the campaign's setting with so many of the model's turns, in every
 *  stretch of the log that stood there. A campaign returns to a budget, and what it read there
 *  the first time still stands: until 2026-10-09 only the last stretch was read, and a budget set
 *  again would have had its comparison made again. */
export function under(
  { settings, rest }: Pick<Ground, "settings" | "rest">,
  turns: number | null,
): Compared[] {
  return settings.flatMap((each) => (each.turns === turns && each.rest === rest ? each.comparisons : []));
}

/** The reported comparisons of `fresh` with `old` among `comparisons`. */
export function pairOf(comparisons: readonly Compared[], fresh: string, old: string | null) {
  return comparisons.flatMap((each) =>
    each.fresh === fresh && each.old === old && each.report !== null ? [each.report] : [],
  );
}

/** The Examiner sessions in a row, up to the log's end, that held out no task. A session that
 *  held one out moved the campaign, however few it wrote: the first campaign run by one command
 *  ended on three sessions that had written four tasks between them (2026-10-09). */
export function idleDrafts(events: readonly LogEvent[]): number {
  const sessions = events.filter(({ kind }) => kind === "exam.finished").toReversed();
  const wrote = sessions.findIndex(({ data }) => Array.isArray(data.held) && data.held.length > 0);
  return wrote === -1 ? sessions.length : wrote;
}

/** What the rows on the comparisons are read from, for a log and its plan. */
export function groundOf(events: readonly LogEvent[], plan: Plan): Ground {
  const all = comparisonsOf(events);
  const settings = settingsOf(events, all);
  const turns = settings.at(-1)?.turns ?? null;
  const rest = settings.at(-1)?.rest ?? "";
  const here = under({ settings, rest }, turns);
  // The share of tasks a comparison left untied was measured under its setting, so the one read
  // is the last that tallied under the campaign's own: none, where it has not stood there yet,
  // and then every task is counted whole. A budget set by the rule is set to untie them.
  const stood = here.findLast(({ report }) => asRecord(report?.scored) !== null)?.report ?? null;
  const starter = all.map(({ report }) => report?.starter).find(isString) ?? null;
  const supply = supplyOf(events, "promoted", stood);
  return {
    events,
    plan,
    all,
    settings,
    here,
    turns,
    rest,
    reference: promoted(events) ?? starter,
    starter,
    latest: latestBuilt(events),
    tasksShort: shortOf(supply, plan.wanted),
    scorable: supply.held,
    drafts: idleDrafts(events),
  };
}
