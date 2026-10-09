/**
 * Move 7 of a campaign: the one move that follows from its log.
 *
 * A campaign is a loop of moves over one log (`docs/plan.md`, "The process"): the exam is read,
 * tasks are written, a Builder builds, two harnesses are compared, and then something has to say
 * what comes next. Until 2026-10-09 a session said it, by a skill's walk of eight links and with
 * the operator, and the source only named the moves that may start (`nextMoves`, `handover.ts`).
 * This is the plan's decision table as one function: it takes the log and the campaign's plan and
 * returns one move with its reason, or an ending.
 *
 * It decides which move, and nothing of a move's content: what a harness holds, what a task asks
 * and how it is solved stay a model's. It reads what the other owners already read, and adds no
 * fold of its own beside them: the supply and what a comparison is short of (`admission.ts`), the
 * stop rule and the room a report shows (`reports.ts`), the reference harness and the last one a
 * session left.
 *
 * The order it asks in:
 *
 * 1. The exam. A checker nobody has read is read first, and one whose reading holds a fault that
 *    nobody froze ends the campaign: the exam was not accepted.
 * 2. The tasks. A pack's tasks are taken in, practice is released, and a campaign with no task
 *    has some written.
 * 3. The budget, which ends the campaign where less is left than one solve is held at, and the
 *    stop rule, which ends it unless the operator said to go on.
 * 4. A comparison that began and has not reported goes on.
 * 5. After a promotion the budget is set again from the promoted harness's own solves.
 * 6. A step. Read once, it is one draw, and the same two harnesses are compared again with the
 *    reference read against itself. Read again, it is read once at the full limit, where it must
 *    not lose, and then the harness is promoted.
 * 7. No step. Where the reference harness left no room, the budget is set again by the rule, and
 *    where no budget leaves room the tasks have to change. Where neither harness answered, the
 *    budget is lengthened, or other tasks are written. With room, the harness did not help, and
 *    the Builder builds again.
 * 8. Nothing new to compare: the Builder builds. Something new: it is compared once the sessions
 *    before a comparison have run, or tasks are written where the comparison would be short of
 *    them.
 *
 * A setting is recorded once and again at each change (`campaign.setting`), so the comparisons
 * since the last record are the ones under the campaign's setting, and no reading is carried
 * across two.
 *
 * The budget rule is the plan's: the longest budget, of the one a comparison ran under and the
 * shorter ones it was read at, at which the reference harness was valid on at most half its
 * solves. The three shares it and `roomOf` read by are the plan's proposal and the operator's to
 * set.
 */
import type { LogEvent } from "../kernel/log.ts";
import {
  billedAll,
  type Cap,
  lastReports,
  latestBuilt,
  promoted,
  roomOf,
  validAt,
} from "../kernel/reports.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { plural } from "../meta/text.ts";
import { shortOf, supplyOf, type Wanted } from "./admission.ts";

/** How a campaign ends, as its last event says it. */
export type Ending = "budget" | "stop" | "exam" | "no-room" | "environment" | "operator";

/** The one move a campaign's log leads to, with its reason, or its ending. */
export type Decided =
  | { readonly move: "accept"; readonly why: string }
  | { readonly move: "prepare"; readonly why: string }
  /** An Examiner session. `room` asks for tasks that leave a harness room (row F52). */
  | { readonly move: "examine"; readonly why: string; readonly room: boolean }
  | { readonly move: "build"; readonly why: string }
  /** A comparison of `fresh` with `reference`, which is `promoted`, `starter` or a digest. `id`
   *  names one that began and goes on. `noise` reads the reference against itself beside it. */
  | {
      readonly move: "compare";
      readonly why: string;
      readonly fresh: string;
      readonly reference: string;
      readonly noise: boolean;
      readonly id?: string | undefined;
    }
  /** A new setting: the model's turns a solve is held to, null for the campaign's full limit
   *  where that is unlimited. */
  | { readonly move: "budget"; readonly why: string; readonly modelTurns: number | null }
  | { readonly move: "promote"; readonly why: string; readonly harness: string }
  | { readonly move: "end"; readonly why: string; readonly ending: Ending };

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
  /** The size a comparison is asked for at, as its admission reads it. */
  readonly wanted: Pick<Wanted, "target" | "level" | "restarted">;
  /** The operator's reason to go on past the stop rule, where one was given. */
  readonly pastStop?: string | undefined;
  /** The dollars left of the campaign's total and the reserve one solve is held at; null for a
   *  campaign with no total, as a rehearsal's, whose seats are paid nothing. */
  readonly left?: { readonly dollars: number; readonly reserve: number } | null | undefined;
}

/** Who sits in a seat: a model and its effort. */
export interface Seat {
  readonly model: string;
  readonly effort: string;
}

/** What a campaign runs by, as `campaign.opened` records it (`tools/d2/harness-builder.ts`). */
export interface Opening {
  /** The dollars the campaign may bill in all, and the reserve one solve is held at; null for a
   *  rehearsal's, whose seats are paid nothing. */
  readonly budget: Cap | null;
  /** The full limit of a solve in the model's turns, the shorter budgets its comparisons are also
   *  read at, and the Builder sessions before a comparison. */
  readonly limit: number | null;
  readonly ladder: readonly number[];
  readonly sessions: number;
  readonly seats: Readonly<Record<(typeof SEATS)[number], Seat | null>>;
}

/** One comparison as move 7 reads it: where it began, its two harnesses, and its last report. */
interface Compared {
  readonly id: string;
  readonly at: number;
  readonly old: string;
  readonly fresh: string;
  readonly noise: boolean;
  readonly report: JsonObject | null;
  /** Where it first reported; null while it has not. */
  readonly reported: number | null;
}

/** The comparisons made under one record of the campaign's setting. */
interface Under {
  /** The model's turns that setting holds a solve to. */
  readonly turns: number | null;
  readonly comparisons: readonly Compared[];
}

/** What the table's rows on the comparisons are read from: the log's comparisons by setting, the
 *  two harnesses in question, and what the next comparison would be short of. */
interface Ground {
  readonly events: readonly LogEvent[];
  readonly plan: Plan;
  readonly all: readonly Compared[];
  readonly settings: readonly Under[];
  /** The comparisons under the campaign's setting, and the model's turns it holds a solve to. */
  readonly here: readonly Compared[];
  readonly turns: number | null;
  /** The reference harness, null before any comparison or promotion has named it. */
  readonly reference: string | null;
  readonly latest: string | null;
  readonly tasksShort: ReturnType<typeof shortOf>;
  /** The Examiner sessions that ended since the last comparison began. */
  readonly drafts: number;
}

/** The seats a campaign names a model for. The solver's is the setting's (`tools/d2/setting.ts`). */
export const SEATS = ["builder", "examiner", "reviewer"] as const;
/** The Builder sessions before a comparison, after the campaign's first, where nothing names
 *  them: the plan's checkpoint is several sessions and then one comparison. */
export const SESSIONS = 3;
/** The scored tasks of a campaign whose setting names none. */
const TARGET = 12;
/** The share of valid solves at or under which the budget rule takes a budget. */
const HALF = 1 / 2;
/** Tries at tasks that leave room, each an Examiner session and the comparison after it, after
 *  which the tasks could not be made to. */
const DRAFTS = 3;
const STEP = "step";
const STARTED = "comparison.started";
const SETTING = "campaign.setting";
const ROOM = "room";

const end = (ending: Ending, why: string): Decided => ({ move: "end", ending, why });
const build = (why: string): Decided => ({ move: "build", why });
const short = (digest: string): string => digest.slice(0, 8);

/** What a log's last opening holds a campaign to run by, or null where it holds none. */
export function openingOf(events: readonly LogEvent[]): Opening | null {
  const data = events.findLast(({ kind }) => kind === "campaign.opened")?.data;
  if (data === undefined) return null;
  const budget = asRecord(data.budget);
  const seat = (name: (typeof SEATS)[number]): Seat | null => {
    const named = asRecord(asRecord(data.seats)?.[name]);
    return isString(named?.model) && isString(named.effort)
      ? { model: named.model, effort: named.effort }
      : null;
  };
  return {
    budget:
      isNumber(budget?.dollars) && isNumber(budget.reserve)
        ? { dollars: budget.dollars, reserve: budget.reserve }
        : null,
    limit: isNumber(data.limit) ? data.limit : null,
    ladder: Array.isArray(data.ladder) ? data.ladder.filter(isNumber) : [],
    sessions: isNumber(data.sessions) ? data.sessions : SESSIONS,
    seats: { builder: seat("builder"), examiner: seat("examiner"), reviewer: seat("reviewer") },
  };
}

/**
 * What move 7 reads beside a log: the campaign's plan from its opening, the dollars left of its
 * total, the size its setting asks a comparison for, and what only the caller knows. A campaign
 * with no opening on record, as every one before 2026-10-09, runs by the defaults: the full limit
 * its first setting named, no shorter budget, and no total.
 */
export function planOf(
  events: readonly LogEvent[],
  beside: {
    /** Whether the campaign's pack holds a task its log does not. */
    readonly unprepared: boolean;
    readonly level: number;
    /** The tasks to score, where the log's setting names none yet. */
    readonly target?: number | undefined;
    readonly pastStop?: string | undefined;
  },
  opening: Opening | null = openingOf(events),
): Plan {
  const first = events.find(({ kind }) => kind === SETTING)?.data;
  const recorded = events.findLast(({ kind }) => kind === SETTING)?.data;
  const named = Array.isArray(recorded?.tasks) ? recorded.tasks.length : recorded?.target;
  const began = isNumber(first?.modelTurns) ? first.modelTurns : null;
  return {
    limit: opening === null ? began : opening.limit,
    ladder: opening?.ladder ?? [],
    sessions: opening?.sessions ?? SESSIONS,
    unprepared: beside.unprepared,
    wanted: {
      target: isNumber(named) ? named : (beside.target ?? TARGET),
      level: beside.level,
      restarted: [],
    },
    left:
      opening?.budget == null
        ? null
        : { dollars: opening.budget.dollars - billedAll(events), reserve: opening.budget.reserve },
    ...keyIfDefined("pastStop", beside.pastStop),
  };
}

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
    kind === SETTING ? [{ index, turns: isNumber(data.modelTurns) ? data.modelTurns : null }] : [],
  );
  if (records.length === 0) return [{ turns: null, comparisons }];
  return records.map(({ index, turns }, nth) => {
    const next = records[nth + 1]?.index ?? Number.POSITIVE_INFINITY;
    return {
      turns,
      comparisons: comparisons.filter(({ at }) => (nth === 0 || at > index) && at < next),
    };
  });
}

/** The reported comparisons of `fresh` with `old` among `comparisons`. */
function pairOf(comparisons: readonly Compared[], fresh: string, old: string | null) {
  return comparisons.flatMap((each) =>
    each.fresh === fresh && each.old === old && each.report !== null ? [each.report] : [],
  );
}

/** Whether the last two of a pair's comparisons both read a step: a step read again. */
function readTwice(reports: readonly JsonObject[]): boolean {
  return reports.length >= 2 && reports.slice(-2).every(({ reading }) => reading === STEP);
}

/**
 * The budget the plan's rule takes from one comparison's report, for the harness on `side`: the
 * longest, of the turns it ran under and the shorter budgets it was read at, at which that
 * harness was valid on at most half its solves. `undefined` where none is, and the tasks then
 * have to change.
 */
function budgetBy(report: JsonObject, side: "old" | "fresh", ran: number | null): number | null | undefined {
  const rows = (Array.isArray(report.budgets) ? report.budgets : []).flatMap((row) => {
    const turns = asRecord(row)?.turns;
    return isNumber(turns) && (ran === null || turns < ran) ? [turns] : [];
  });
  const whole = validAt(report, side);
  if (whole !== null && whole <= HALF) return ran;
  return rows
    .toSorted((one, other) => other - one)
    .find((turns) => (validAt(report, side, turns) ?? 1) <= HALF);
}

/** Whether the new harness had at least as many wins as losses in a report: it did not lose. */
function held(report: JsonObject): boolean {
  const scored = asRecord(report.scored);
  return isNumber(scored?.wins) && isNumber(scored.losses) && scored.wins >= scored.losses;
}

/** A budget in words: so many of the model's turns, or the full limit where that is unlimited. */
const budgetSaid = (turns: number | null): string =>
  turns === null ? "the full limit" : plural(turns, "turn");

/** A comparison of the latest harness with the reference one, under the campaign's setting. */
const compare = (why: string, noise: "noise" | "alone"): Decided => ({
  move: "compare",
  fresh: "latest",
  reference: "promoted",
  noise: noise === "noise",
  why,
});

/** Tasks, for the reason `why`, where a comparison is short of them: the budget first where the
 *  reference harness passes nearly all, as the table has it. */
function supplied(ground: Ground, last: JsonObject | undefined, why: string): Decided {
  const { turns, drafts } = ground;
  const none = last !== undefined && roomOf(last) === "none";
  const rung = last !== undefined && none ? budgetBy(last, "old", turns) : undefined;
  if (rung === undefined || rung === turns || tried(ground, rung)) {
    return written(drafts, none ? "room" : "tasks", { move: "examine", room: none, why });
  }
  return {
    move: "budget",
    modelTurns: rung,
    why: `${why}, and the reference harness was valid on more than three solves in four: at ${budgetSaid(rung)} it was valid on at most half, so the budget is set again before tasks are written`,
  };
}

/** The Examiner sessions that ended after place `after` of a log. */
function draftsSince(events: readonly LogEvent[], after: number): number {
  return events.filter(({ kind }, index) => kind === "exam.finished" && index > after).length;
}

/** An Examiner session, unless three in a row have already left the campaign where it stands.
 *  Then the campaign ends: on its exam where it wants for tasks, which could not be written, and
 *  on its room where the tasks it has leave none. */
function written(drafts: number, wants: "tasks" | "room", examine: Decided): Decided {
  if (drafts < DRAFTS) return examine;
  const sessions = `${plural(drafts, "Examiner session")} in a row left the campaign where it stood (${examine.why})`;
  return wants === "tasks"
    ? end("exam", `${sessions}: the tasks could not be written`)
    : end("no-room", `${sessions}: the tasks could not be made to leave room`);
}

/** Whether the latest harness was already compared with the reference one under a setting that
 *  held a solve to `turns`: a budget the pair has been read at is not gone back to. */
function tried({ settings, latest, reference }: Ground, turns: number | null): boolean {
  return (
    latest !== null &&
    settings.some((under) => under.turns === turns && pairOf(under.comparisons, latest, reference).length > 0)
  );
}

/** The plan's decision table over a campaign's log: the next move, or the campaign's ending. */
export function decide(events: readonly LogEvent[], plan: Plan): Decided {
  const supply = supplyOf(events);
  if (supply.faults === null) {
    return {
      move: "accept",
      why: "nobody has read the campaign's checker: every control and the do-nothing answer are put to the checks before a solve is paid for",
    };
  }
  if (supply.faults > 0 && !supply.frozen) {
    return end(
      "exam",
      `the checker's last reading holds ${plural(supply.faults, "fault")} and nobody froze it: the exam is not accepted until its author repairs it, or the operator admits each check by name and freezes (tools/c/accept.ts)`,
    );
  }
  if (plan.unprepared) {
    return {
      move: "prepare",
      why: "the pack holds tasks the log does not: each is put to its gate and held out",
    };
  }
  const { left } = plan;
  if (left != null && left.dollars < left.reserve) {
    return end(
      "budget",
      `$${left.dollars.toFixed(2)} of the campaign's budget are left, and one solve is held at $${String(left.reserve)}`,
    );
  }
  if (supply.held + supply.awaiting + supply.released === 0) {
    return written(draftsSince(events, -1), "tasks", {
      move: "examine",
      room: false,
      why: "the campaign holds no task",
    });
  }
  if (supply.released === 0 && supply.held >= 2) {
    return { move: "prepare", why: "no task is released for practice: the contract's draw releases some" };
  }
  if (supply.stop.stop && plan.pastStop === undefined) {
    return end(
      "stop",
      `${plural(supply.stop.sinceStep, "move")} in a row could have shown a gain and showed none: the plan stops the campaign at three`,
    );
  }
  const ground = groundOf(events, plan);
  const open = ground.here.find(({ report }) => report === null);
  if (open !== undefined) {
    return {
      move: "compare",
      id: open.id,
      fresh: open.fresh,
      reference: open.old,
      noise: open.noise,
      why: `comparison ${open.id} began and has not reported: it goes on from its log`,
    };
  }
  return afterPromotion(ground) ?? onStep(ground) ?? onLatest(ground);
}

/** What the rows on the comparisons are read from, for a log and its plan. */
function groundOf(events: readonly LogEvent[], plan: Plan): Ground {
  const all = comparisonsOf(events);
  const settings = settingsOf(events, all);
  const here = settings.at(-1)?.comparisons ?? [];
  // The share of tasks a comparison left untied was measured under its setting. Once the setting
  // was recorded again it says little of the next comparison, as the admission reads it too
  // (`restarts`, `tools/d2/setting.ts`): a budget set by the rule is set to untie them.
  const wanted =
    all.length > 0 && here.length === 0
      ? { ...plan.wanted, restarted: ["the setting was recorded again since the last comparison"] }
      : plan.wanted;
  return {
    events,
    plan,
    all,
    settings,
    here,
    turns: settings.at(-1)?.turns ?? null,
    reference: promoted(events) ?? all.map(({ report }) => report?.starter).find(isString) ?? null,
    latest: latestBuilt(events),
    tasksShort: shortOf(supplyOf(events, "promoted"), wanted),
    drafts: draftsSince(events, all.at(-1)?.at ?? -1),
  };
}

/**
 * Why the plan would not promote `harness` on this log now, or null where it would: a step is
 * promoted once it was read again and did not lose at the full limit. It is the rule move 7
 * promotes by (`onStep`), asked for a harness the operator names (`tools/d2/promote.ts`).
 */
export function unpromoted(events: readonly LogEvent[], plan: Plan, harness: string): string | null {
  const step = onStep({ ...groundOf(events, plan), latest: harness });
  if (step?.move === "promote") return null;
  return step === null
    ? `harness ${short(harness)} has not read a step twice against the reference harness under the campaign's setting`
    : step.why;
}

/** After a promotion the budget rule is applied again, to the promoted harness's own solves: the
 *  budget follows the reference. Null where no promotion waits for it. */
function afterPromotion({ events, all, settings, turns, reference }: Ground): Decided | null {
  const promotedAt = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  if (reference === null || promotedAt <= events.findLastIndex(({ kind }) => kind === SETTING)) return null;
  const read = all.findLast(({ fresh, report }) => fresh === reference && report !== null);
  const report = read?.report ?? null;
  if (read === undefined || report === null) return null;
  const ran = settings.findLast(({ comparisons }) => comparisons.includes(read))?.turns ?? null;
  const rung = budgetBy(report, "fresh", ran);
  if (rung !== undefined) {
    return rung === turns
      ? null
      : {
          move: "budget",
          modelTurns: rung,
          why: `harness ${short(reference)} was promoted, and it was valid on at most half its solves at ${budgetSaid(rung)}: the budget follows the reference`,
        };
  }
  // No budget it was read at leaves the reference failing half its solves: the tasks change, once.
  return draftsSince(events, promotedAt) > 0
    ? null
    : {
        move: "examine",
        room: true,
        why: `harness ${short(reference)} was promoted, and no budget it was read at leaves it failing half its solves: the tasks have to change`,
      };
}

/**
 * The rows of a step that was read again: the reading at the full limit, where the harness must
 * not lose, and the promotion. Null where the latest harness has read no step twice.
 */
function onStep({ plan, settings, here, turns, reference, latest }: Ground): Decided | null {
  if (latest === null || latest === reference) return null;
  const before = settings.at(-2);
  const pair = pairOf(here, latest, reference);
  const full = turns === plan.limit;
  // The reading at the full limit of a step that was read again under a shorter budget.
  if (full && before !== undefined && before.turns !== plan.limit) {
    const last = pair.at(-1);
    if (!readTwice(pairOf(before.comparisons, latest, reference))) return null;
    if (last === undefined) {
      return compare("a step read again is read once at the full limit, where it must not lose", "alone");
    }
    return held(last)
      ? {
          move: "promote",
          harness: latest,
          why: `harness ${short(latest)} read a step twice and did not lose at the full limit`,
        }
      : {
          move: "budget",
          modelTurns: before.turns,
          why: `harness ${short(latest)} read a step twice at a shorter budget and lost at the full limit: it is not promoted, and the campaign returns to that budget`,
        };
  }
  if (!readTwice(pair)) return null;
  return full
    ? {
        move: "promote",
        harness: latest,
        why: `harness ${short(latest)} read a step twice at the full limit`,
      }
    : {
        move: "budget",
        modelTurns: plan.limit,
        why: `harness ${short(latest)} read a step twice: before a promotion it is read once at the full limit`,
      };
}

/** The rows that follow from the latest harness and its last comparison with the reference one. */
function onLatest(ground: Ground): Decided {
  const { events, plan, all, settings, here, reference, latest, tasksShort } = ground;
  if (latest === null || latest === reference) {
    return build("no session has left a harness that is not the reference harness");
  }
  const last = pairOf(here, latest, reference).at(-1);
  if (last !== undefined) return afterComparison(ground, last, latest);
  // A harness that lost its reading at the full limit is not compared again: a new one is built.
  const [before, earlier] = [settings.at(-2), settings.at(-3)];
  const lost =
    before !== undefined &&
    earlier !== undefined &&
    before.turns === plan.limit &&
    readTwice(pairOf(earlier.comparisons, latest, reference)) &&
    pairOf(before.comparisons, latest, reference).some((report) => !held(report));
  if (lost) return build(`harness ${short(latest)} lost at the full limit and is not the reference`);
  const lastAt = all.at(-1)?.at ?? -1;
  const sessions = events.filter(
    ({ kind, data }, index) =>
      kind === "build.finished" && index > lastAt && data.ended !== "killed" && data.ended !== "crashed",
  ).length;
  const needed = all.length === 0 ? 1 : plan.sessions;
  // Under a setting no comparison has run in yet, the harness is read there at once.
  if (here.length > 0 && sessions < needed) {
    return build(
      `${String(sessions)} of ${plural(needed, "Builder session")} before the next comparison have run`,
    );
  }
  if (tasksShort !== null) {
    return supplied(
      ground,
      all.findLast(({ report }) => report !== null)?.report ?? undefined,
      tasksShort === "held"
        ? "the campaign holds fewer tasks to score than a step takes"
        : "the last comparison left too few tasks for the next to untie",
    );
  }
  return compare(
    here.length === 0
      ? `harness ${short(latest)} has not been compared under the campaign's setting`
      : `${plural(sessions, "Builder session")} since the last comparison left harness ${short(latest)}`,
    here.some(({ noise }) => noise) ? "alone" : "noise",
  );
}

/** The table's rows for the last comparison of the latest harness with the reference one. */
function afterComparison(ground: Ground, last: JsonObject, latest: string): Decided {
  const { events, plan, all, here, turns, tasksShort, reference } = ground;
  const id = isString(last.session) ? last.session : "";
  const { reading } = last;
  if (reading === STEP) {
    return compare(
      `comparison ${id} read a step, which is one draw: the same two harnesses are compared again on fresh solves, with the reference read against itself`,
      "noise",
    );
  }
  if (reading === "check-defects") {
    return end(
      "exam",
      `comparison ${id} stopped on its check defects: the check program needs its author before more is spent`,
    );
  }
  if (reading === "starter-unread") {
    return {
      move: "compare",
      fresh: "latest",
      reference: "starter",
      noise: false,
      why: `comparison ${id} cleared its level and the starter was not solved on its tasks: the new harness is compared with the starter`,
    };
  }
  // A comparison of the same two on tasks written since is the answer to a want of tasks or of
  // room, once: three in a row that still leave none end the campaign.
  const reportedAt = all.find(({ report }) => report === last)?.reported ?? Number.POSITIVE_INFINITY;
  const again =
    tasksShort === null &&
    events.some(
      ({ kind, data }, index) => index > reportedAt && kind === "task.gate" && data.outcome === "passed",
    );
  if (reading === "not-scored") {
    if (last.capped === true) {
      return end("budget", `comparison ${id} was cut by its dollar cap before it tallied a task`);
    }
    return again
      ? compare(`comparison ${id} tallied no task, and tasks were written since`, "alone")
      : supplied(ground, last, `comparison ${id} tallied no task`);
  }
  const room = roomOf(last);
  if (room === ROOM) {
    return build(`comparison ${id} read no step with room to gain: harness ${short(latest)} did not help`);
  }
  const unroomed = pairOf(here, latest, reference).filter(
    (report) => report.reading !== STEP && roomOf(report) !== ROOM,
  ).length;
  if (unroomed > DRAFTS) {
    return end(
      "no-room",
      `${plural(unroomed, "comparison")} of harness ${short(latest)} left no room, with tasks written between them: the tasks could not be made to leave room`,
    );
  }
  if (room === "none") {
    const rung = budgetBy(last, "old", turns);
    if (rung !== undefined && rung !== turns && !tried(ground, rung)) {
      return {
        move: "budget",
        modelTurns: rung,
        why: `comparison ${id} read no step, and the reference harness was valid on more than three solves in four: at ${budgetSaid(rung)} it was valid on at most half`,
      };
    }
    if (again) return compare(`comparison ${id} left no room, and tasks were written since`, "alone");
    return written(ground.drafts, "room", {
      move: "examine",
      room: true,
      why: `comparison ${id} read no step, the reference harness was valid on more than three solves in four, and no shorter budget leaves room: the tasks have to change`,
    });
  }
  const longer = [...plan.ladder, ...(plan.limit === null ? [] : [plan.limit])]
    .toSorted((one, other) => one - other)
    .find((rung) => turns !== null && rung > turns);
  // A longer budget only leaves the reference more answers. Where a comparison of the two was
  // already read at the next one and left no room there, no budget of the ladder does.
  const full =
    longer !== undefined &&
    pairOf(all, latest, reference).some((report) => roomOf(report, longer) === "none");
  if (
    !full &&
    turns !== null &&
    (longer !== undefined || plan.limit === null) &&
    !tried(ground, longer ?? null)
  ) {
    return {
      move: "budget",
      modelTurns: longer ?? null,
      why: `comparison ${id} read no step, and neither harness was valid on one solve in four: the budget is lengthened`,
    };
  }
  if (again) {
    return compare(`comparison ${id} left neither harness an answer, and tasks were written since`, "alone");
  }
  if (full) {
    return written(ground.drafts, "room", {
      move: "examine",
      room: true,
      why: `comparison ${id} read no step with neither harness valid on one solve in four, and at ${budgetSaid(longer ?? null)} the reference harness left no room: no budget of the ladder leaves room, and the tasks have to change`,
    });
  }
  return written(ground.drafts, "room", {
    move: "examine",
    room: false,
    why: `comparison ${id} read no step, and neither harness was valid on one solve in four at the full limit: other tasks are written`,
  });
}

/** A decided move in one line, as the campaign's command and its view print it. */
export function decidedLine(decided: Decided): string {
  const named = (harness: string) => (harness.length > 16 ? short(harness) : `the ${harness} harness`);
  const what = {
    accept: () => "read the exam",
    prepare: () => "set the tasks apart",
    examine: () =>
      decided.move === "examine" && decided.room
        ? "an Examiner session, for tasks that leave room"
        : "an Examiner session",
    build: () => "a Builder session",
    compare: () =>
      decided.move === "compare"
        ? `a comparison of ${named(decided.fresh)} with ${named(decided.reference)}${decided.noise ? ", and the reference against itself" : ""}`
        : "",
    budget: () => (decided.move === "budget" ? `the budget is set to ${budgetSaid(decided.modelTurns)}` : ""),
    promote: () => (decided.move === "promote" ? `promote harness ${short(decided.harness)}` : ""),
    end: () => (decided.move === "end" ? `the campaign ends (${decided.ending})` : ""),
  } as const satisfies Record<Decided["move"], () => string>;
  return `${what[decided.move]()}: ${decided.why}`;
}
