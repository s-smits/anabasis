/**
 * A campaign's moves, as the decision table returns them (`decide.ts`): the one move a log leads
 * to, with its reason, or the campaign's ending; the makers of each; what a comparison's report
 * says of a step, a budget and a full-limit reading; and a move in one line. Split from
 * `decide.ts` on 10 October, when that file passed 800 lines.
 */
import { signP } from "../kernel/compare.ts";
import { validAt } from "../kernel/reports.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import type { Compared } from "./ground.ts";

/** How a campaign ends, as its last event says it. */
export type Ending = "budget" | "stop" | "exam" | "no-room" | "environment" | "operator";

/** The one move a campaign's log leads to, with its reason, or its ending. */
export type Decided =
  /** An Examiner session that drafts the exam of a campaign opened from a prompt (row F53). */
  | { readonly move: "draft"; readonly why: string }
  | { readonly move: "accept"; readonly why: string }
  /** `practice` names the count practice is brought to where it is more than the campaign's. */
  | { readonly move: "prepare"; readonly why: string; readonly practice?: number }
  /** An Examiner session. `room` asks for tasks that leave a harness room (row F52). `answers`
   *  names the operator's word it follows, where it follows one (`pendingWords`). */
  | {
      readonly move: "examine";
      readonly why: string;
      readonly room: boolean;
      readonly answers?: readonly number[];
    }
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
  | {
      readonly move: "end";
      readonly why: string;
      readonly ending: Ending;
      readonly answers?: readonly number[];
    };

/** The share of valid solves at or under which the budget rule takes a budget. */
const HALF = 1 / 2;
export const STEP = "step";
/** What a comparison the table names is of: the last harness a session left, or the starter as a
 *  control on the reference harness. */
export type Fresh = "latest" | "starter";

export const end = (ending: Ending, why: string): Decided => ({ move: "end", ending, why });
export const build = (why: string): Decided => ({ move: "build", why });
export const toBudget = (modelTurns: number | null, why: string): Decided => ({
  move: "budget",
  modelTurns,
  why,
});
export const short = (digest: string): string => digest.slice(0, 8);

/** A report's tally, where it holds one. */
function tallyOf(report: JsonObject): { readonly wins: number; readonly losses: number } | null {
  const scored = asRecord(report.scored);
  return scored !== null && isNumber(scored.wins) && isNumber(scored.losses)
    ? { wins: scored.wins, losses: scored.losses }
    : null;
}

/**
 * Whether the last two of a pair's comparisons, read together, clear `level`: the step and its
 * repeat as one sign test, their wins and losses summed, ties dropped. Until 10 October each had
 * to read a step by itself, which at 0.20 took three wins and no loss twice; on sixteen tasks of
 * which three in four tie that came through 8% of the time for a harness that wins 96% of the
 * tasks it unties, and the operator found the rule too strict ("2-0-4 should climb"). Read
 * together at 0.10 a 2-0 and a 2-0 are a 4-0 (p 0.0625): 31% at a win rate of 0.75 where it was
 * 14%, and a false promotion of two equal harnesses 3.4% an attempt where it was 0.9%, by exact
 * enumeration. Every untied task of either comparison is a fresh solve, so the null holds.
 */
export function readTwice(reports: readonly JsonObject[], level: number): boolean {
  if (reports.length < 2) return false;
  const tallies = reports.slice(-2).map(tallyOf);
  const [first, second] = tallies;
  if (first === null || second === null || first === undefined || second === undefined) return false;
  const wins = first.wins + second.wins;
  const losses = first.losses + second.losses;
  return wins > 0 && signP(wins, losses) <= level;
}

/** Whether one comparison's reading buys the repeat: more wins than losses, and the sign test at
 *  or under `trigger`, which a 2-0 clears at 0.25 and a 1-0 does not. */
export function triggered(report: JsonObject, trigger: number): boolean {
  const tally = tallyOf(report);
  return tally !== null && tally.wins > tally.losses && signP(tally.wins, tally.losses) <= trigger;
}

/**
 * The budget the plan's rule takes from one comparison's report, for the harness on `side`: the
 * longest, of the turns it ran under and the shorter budgets it was read at, at which that
 * harness was valid on at most half its solves. `undefined` where none is, and the tasks then
 * have to change.
 */
export function budgetBy(
  report: JsonObject,
  side: "old" | "fresh",
  ran: number | null,
): number | null | undefined {
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
export function held(report: JsonObject): boolean {
  const scored = asRecord(report.scored);
  return isNumber(scored?.wins) && isNumber(scored.losses) && scored.wins >= scored.losses;
}

/** The task versions a report scored, as the comparison fixed them before its first solve. */
function versionsOf(report: JsonObject): string[] {
  return Array.isArray(report.versions) ? report.versions.filter(isString) : [];
}

/**
 * Whether a reading of the two at the full limit vouches for a step read twice below it: it was
 * made after the second step, which is the reading once more that section 7 asks for, or it was
 * made before and scored every task the two steps scored. On 10 October t-10 promoted a harness
 * on "did not lose at the full limit (comparison g-1)", where g-1 had scored 5 tasks before the
 * Examiner wrote 4 of the 8 the steps were read on: half the step stood on no reading at the full
 * limit at all.
 */
export function vouches(all: readonly Compared[], full: JsonObject, steps: readonly JsonObject[]): boolean {
  const reportedAt = (report: JsonObject): number | null =>
    all.find(({ id }) => id === report.session)?.reported ?? null;
  const at = reportedAt(full);
  if (at !== null && steps.every((step) => (reportedAt(step) ?? Number.POSITIVE_INFINITY) < at)) {
    return true;
  }
  const scored = new Set(versionsOf(full));
  return steps.every((step) => versionsOf(step).every((version) => scored.has(version)));
}

/** A budget in words: so many of the model's turns, or the full limit where that is unlimited. */
export const budgetSaid = (turns: number | null): string =>
  turns === null ? "the full limit" : plural(turns, "turn");

/** A comparison of the latest harness, or of the starter as a control, with the reference one,
 *  under the campaign's setting. */
export const compare = (why: string, noise: "noise" | "alone", fresh: Fresh = "latest"): Decided => ({
  move: "compare",
  fresh,
  reference: "promoted",
  noise: noise === "noise",
  why,
});

/** A decided move in one line, as the campaign's command and its view print it. */
export function decidedLine(decided: Decided): string {
  const named = (harness: string) => (harness.length > 16 ? short(harness) : `the ${harness} harness`);
  const what = {
    draft: () => "an Examiner session, to draft the exam",
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
