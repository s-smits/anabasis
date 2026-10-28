/**
 * What every lane of a whole-run investigation starts from: the folds of one campaign's log, the
 * catalogue of triggers, and the lanes of the exam side.
 *
 * The folds (`indexOf`) read the log once into what the lanes ask of it: each solve with what it
 * ran under and how it ended, each Builder session with the window of the log that is its round,
 * each comparison with the solves it could count, and the last verdict and ruling of each solve.
 * A solve reached its turn bound where its end records as many turns as its start allowed.
 * `TRIGGERS` names only the triggers a live reader can print and the lane each starts, and
 * `fired` makes one. Lanes 1 to 5 read the exam's instrument, which is the pack author's, and
 * lanes 9 to 14 the tasks, which are the Examiner's and the pack's; both sit here, below the
 * lanes of the build side and the host, which `read.ts` keeps with the rows and the overview, and
 * the lanes that read the clock, which are `time.ts`.
 *
 * Split from `read.ts` on 10 October, when that file stood at 1,227 nonblank lines against the
 * size policy's ceiling of 800 (`tools/loc/source-policy.ts`, `7f0add79:docs/plan.md` row F34). The lanes
 * need the folds, so the folds sit below every lane, and the exam side's lanes sit with them so
 * that each of the two files is under the ceiling. Every function keeps the name and the body it
 * had in `read.ts`; `taskTriggers` alone was split at its tallies (`tallyTriggers`), which held it
 * at 147 lines against the policy's 115.
 */
import { unadmitted } from "#src/kernel/acceptance.ts";
import { type Condition, conditionsOf } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { unsolved as noneAnswered } from "#src/kernel/compare.ts";
import { lastReports, poolOf, pairsReported, referenceOf } from "#src/kernel/reports.ts";
import { spendOf, type Traced, traced, tracesIn } from "#src/kernel/trace.ts";
import { type Judged, refusedBy, solvesIn, verdictsOf } from "#src/kernel/solves.ts";
import { heldAtGate, taskSets } from "#src/kernel/task.ts";
import { OBJECTIVE } from "#src/kernel/verify.ts";
import type { Handover } from "#src/campaign/handover.ts";
import { short } from "#src/campaign/move.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";

export interface Trigger {
  readonly lane: number;
  /** The capitalised name a lane's `Starts from` paragraph cites. */
  readonly name: keyof typeof TRIGGERS;
  readonly detail: string;
}

/** One solve as the log holds it: what it ran under, how it ended and what it called. */
export interface Solve {
  readonly id: string;
  readonly index: number;
  readonly version: string;
  readonly harness: string;
  readonly condition: string;
  readonly side: string;
  /** The comparison its start names, or null for a practice solve and for one made before a
   *  start named any (2026-10-09). */
  readonly comparison: string | null;
  readonly wallSeconds: number;
  /** The model's own turns its start held it to, or null where it was told no bound. A report's
   *  tally "at its limits" is at this bound, and t-10 on 10 October was read as at 2 turns where
   *  its solves were told 3: the ladder's rung was taken for the setting. */
  readonly modelTurns: number | null;
  /** The host's one-minute load when it started, and the cores that is a load on; null where its
   *  start holds none, as before 2026-10-09 for the cores. */
  readonly load: number | null;
  readonly cores: number | null;
  readonly outcome: string | null;
  readonly kind: string | null;
  readonly seconds: number;
  readonly calls: string[];
  errors: number;
  /** A limit its ending does not name, or null: "last turn" where the turns its end records are
   *  every turn its start allowed. Read from the end, since a call's turn counted from 0 in logs up
   *  to 22 October and from 1 after, and the end's count from 1 in both (25 October). */
  readonly limit: string | null;
  /** The model its condition asked for, and those its provider named as serving it, if any. */
  readonly model: string;
  readonly served: readonly string[];
}

/** One call of a Builder's tool, at its place in the log. */
interface Call {
  readonly index: number;
  readonly tool: string;
  readonly args: JsonObject | null;
}

/** A Builder session and the window of the log that is its round. */
export interface Build {
  readonly session: string;
  readonly from: number;
  until: number;
  readonly parent: string;
  finished: JsonObject | null;
  readonly calls: Call[];
}

/** A comparison as its reports hold it, with the solves it counted. */
export interface Compared {
  /** The id it reported under: a round's session, or a standalone comparison's own. */
  readonly session: string;
  /** Its own report, which a settling leaves in the log, and where it stands. */
  readonly own: JsonObject;
  /** The log indices where it began and where it reported. */
  readonly began: number;
  readonly at: number;
  /** Its last report: its own, or the one a person's labels settled. */
  readonly last: JsonObject;
  /** The Builder session whose harness it measured, or null for a comparison of none. */
  readonly build: Build | null;
  readonly scoredSet: ReadonlySet<string>;
  /** The test-side solves of its scored tasks under one of its harnesses that it could count. */
  readonly scoring: readonly Solve[];
}

export interface Index {
  readonly events: readonly LogEvent[];
  readonly conditions: ReadonlyMap<string, Condition>;
  readonly solves: readonly Solve[];
  /** Every model turn, tool call and compaction (`tracesIn`). */
  readonly traces: readonly Traced[];
  readonly verdicts: ReadonlyMap<string, Judged>;
  readonly rulings: ReadonlyMap<string, JsonObject>;
  readonly states: ReadonlyMap<string, string>;
  readonly builds: readonly Build[];
  readonly compared: readonly Compared[];
  /** The held-out task versions, and the practice ones. */
  readonly held: readonly string[];
  readonly released: readonly string[];
  readonly of: (kind: LogEvent["kind"]) => JsonObject[];
}

/** A pass under this share of its deadline, on few calls, is the lead v1 read for a published recipe. */
export const SMALL_DEADLINE_SHARE = 0.05;
const DEFECT = "check-defect";
export const TEST = "test";
export const BUILD_END = "build.finished";
export const EXAM_START = "exam.started";
export const EXAM_END = "exam.finished";
export const REPORTED = "comparison.reported";

/** Every trigger this reader can print, and the lane it starts. `lanes.md` names each one in the
 *  `Starts from` paragraph of that lane, and `test/wri-catalogue.test.ts` holds the two together. */
export const TRIGGERS = {
  "INSTRUMENT AUTHORED": 1,
  "PASSES UNREAD": 1,
  "REFUSALS BY CHECK": 1,
  "VERIFIER TOOLS MOVED": 2,
  "TOOL MISSING": 2,
  "NO CHECKER READING": 3,
  "CHECKER READ WITH FAULTS": 3,
  "CONTROL COVERAGE": 3,
  "REFUSED UNREAD": 4,
  "CHECK DEFECT RULED": 4,
  "RULED UNCLEAR": 4,
  "FAILS ON ONE CHECK": 5,
  "DEFECT RULED BESIDE PASSES": 5,
  "CHECKER NOT FROZEN": 3,
  "FROZEN DESPITE FAULTS": 3,
  "READ AT ANOTHER VERSION": 3,
  "TASKS CARRIED": 3,
  "SUPPLY THIN": 9,
  "GATE REFUSED": 9,
  "NO VALID ANSWER": 10,
  "AWAITING A LABEL": 10,
  "TIES BETWEEN VALID ANSWERS": 11,
  "TIED TASKS": 12,
  "PASSES AT A SMALL WALL SHARE": 13,
  "OUTCOMES BY SESSION": 14,
  "HARNESS CHANGED": 15,
  "BROKEN AT END": 15,
  "MEASURED AN EARLIER STATE": 15,
  "NEVER CHECKED": 16,
  "TOOLS CALLED": 16,
  "TOOL CALLS ERRED": 16,
  "TOOLS EDITED": 15,
  "NO PRACTICE": 17,
  "FINAL BYTES NEVER PRACTISED": 17,
  "SESSION ENDED": 17,
  "PRACTICE FAILS": 17,
  "PRACTISED TASK MEASURED": 18,
  "SHELL COMMANDS": 18,
  "WIN AT A SMALL WALL SHARE": 19,
  WINS: 19,
  "ANSWER FROM A PROGRAM": 19,
  "SCORED SET MOVED": 22,
  "NOTHING SCORED": 23,
  "CUT BY ITS CAP": 23,
  "SET SHORT": 23,
  "VALID BY HARNESS": 24,
  "FLIPS": 25,
  "REFERENCE AGAINST ITSELF": 25,
  "HOST CODE MOVED": 21,
  "STARTS OUT OF TURN": 21,
  "SERVED ANOTHER MODEL": 21,
  "CHAIN": 26,
  "NO TASK HELD OUT": 26,
  "WALL SHARE": 29,
  "HOST LOADED": 29,
  "LOAD MOVED": 29,
  "MISSES AT A LIMIT": 29,
  "NON-RESULTS": 30,
  "SOLVE NEVER FINISHED": 30,
  "EXAMINER NEVER FINISHED": 30,
  "MISSES WITHOUT A VERDICT": 30,
  "SESSION CRASHED": 30,
  "LONG SILENCES": 31,
  "SPEND LED BY A ROLE": 31,
  "REPLAY MOVED THE VERDICT": 6,
  "SET ASIDE AND UNSETTLED": 7,
  "READING MOVES WITH THE SET-ASIDE": 7,
  "SET ASIDE BY SIDE": 7,
  "SETTLED BY HAND": 7,
  "REVIEW FAULTS": 7,
  "EARNED WITHOUT A PROBE": 7,
  "RULINGS REFUSED": 7,
  "PROMOTED": 27,
  "STARTER BARE": 27,
  "AFTER THE PROMOTION": 27,
  "SHARED TEMPORARY FOLDER": 27,
  "MOVES ASKED": 28,
  "ENDED AND WENT ON": 28,
  "OPERATOR WORDS": 28,
  "BUILDER COMPACTED": 20,
  "EXAM DRAFTED": 8,
  "LAUNCHES": 32,
  "NO LAUNCH RECEIPT": 32,
  "LOG OUT OF ORDER": 33,
  "SAFEGUARD-8 PROMOTION ON AUTHOR ROOM": 9,
  "SAFEGUARD-9 PROMOTION BEYOND VALIDITY": 11,
} as const;

export const text = (value: JsonValue | undefined): string => (isString(value) ? value : "");
export const count = (value: JsonValue | undefined): number => (isNumber(value) ? value : 0);
export const items = (value: JsonValue | undefined): readonly JsonValue[] =>
  Array.isArray(value) ? value : [];
export const strings = (value: JsonValue | undefined): string[] => items(value).filter(isString);
/** Whether a solve measured its harness: a non-result is in no pair, and a rerun replaced it. A
 *  solver's flag is its side's own fail, as the comparison counts it. */
export const measured = (solve: Solve): boolean => ["pass", "fail", "flagged"].includes(solve.outcome ?? "");
export const share = (part: number, whole: number): string => `${String(part)} of ${String(whole)}`;
export const percent = (part: number): string => `${(part * 100).toFixed(1)}%`;
export const fired = (name: keyof typeof TRIGGERS, detail: string): Trigger => ({
  lane: TRIGGERS[name],
  name,
  detail,
});

function records(value: JsonValue | undefined): JsonObject[] {
  return items(value).flatMap((item) => {
    const record = asRecord(item);
    return record === null ? [] : [record];
  });
}

export function tally(counts: Readonly<Record<string, number>>): string {
  const named = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return named.map(([name, number]) => `${name} ${String(number)}`).join(", ") || "none";
}

/** Each solve as the kernel reads it (`solvesIn`), with what it ran under and the calls it made. */
function solvesOf(
  events: readonly LogEvent[],
  traces: readonly Traced[],
  conditions: ReadonlyMap<string, Condition>,
): Solve[] {
  const solves = new Map(
    solvesIn(events).map(({ id, started, condition: named, ending, start, end }): [string, Solve] => {
      const condition = conditions.get(named);
      const [minute] = items(start.load);
      const limits = asRecord(start.limits);
      const modelTurns = isNumber(limits?.modelTurns) ? limits.modelTurns : null;
      return [
        id,
        {
          id,
          index: started,
          version: condition?.task ?? "",
          harness: condition?.harness ?? "",
          condition: named,
          side: condition?.side ?? "",
          comparison: isString(start.comparison) ? start.comparison : null,
          wallSeconds: count(limits?.wallSeconds),
          modelTurns,
          load: isNumber(minute) ? minute : null,
          cores: isNumber(start.cores) ? start.cores : null,
          outcome: end === null ? null : text(ending?.outcome),
          kind: isString(ending?.kind) ? ending.kind : null,
          seconds: count(end?.seconds),
          calls: [],
          errors: 0,
          limit: modelTurns !== null && count(end?.turns) === modelTurns ? "last turn" : null,
          model: condition?.model ?? "",
          served: items(end?.responseModels).filter(isString),
        },
      ];
    }),
  );
  for (const call of traces) {
    const solve = call.seat === "solve" ? solves.get(call.id) : undefined;
    if (solve === undefined || call.part !== "call") continue;
    solve.calls.push(call.tool);
    solve.errors += call.isError ? 1 : 0;
  }
  return [...solves.values()];
}

function buildsOf(events: readonly LogEvent[]): Build[] {
  const builds: Build[] = [];
  for (const [index, event] of events.entries()) {
    const { kind, data } = event;
    const session = text(data.session);
    if (kind === "build.started") {
      const last = builds.at(-1);
      if (last !== undefined) last.until = index;
      builds.push({
        session,
        from: index,
        until: events.length,
        parent: text(data.parent),
        finished: null,
        calls: [],
      });
    }
    const build = builds.find((each) => each.session === session);
    const call = traced(event, index);
    if (build !== undefined && call?.seat === "build" && call.part === "call") {
      build.calls.push({ index, tool: call.tool, args: asRecord(call.args) });
    }
    if (build !== undefined && kind === BUILD_END) build.finished = data;
  }
  return builds;
}

export function indexOf(events: readonly LogEvent[]): Index {
  const conditions = conditionsOf(events);
  const last = (kind: LogEvent["kind"]) =>
    new Map(events.flatMap((event) => (event.kind === kind ? [[text(event.data.solve), event.data]] : [])));
  const of = (kind: LogEvent["kind"]) => events.flatMap((event) => (event.kind === kind ? [event.data] : []));
  const { states, held, released } = taskSets(events);
  const traces = tracesIn(events);
  const solves = solvesOf(events, traces, conditions);
  const builds = buildsOf(events);
  return {
    events,
    conditions,
    solves,
    traces,
    verdicts: verdictsOf(events),
    rulings: last("referee.finding"),
    states,
    builds,
    compared: comparedOf(events, { solves, builds }),
    held,
    released,
    of,
  };
}

/**
 * Every comparison a log reported, with the solves it could count: the ones whose start names it
 * (`src/campaign/round.ts`). A report written before 2026-10-09 names no setting; its solves are
 * read from its round's own window of the log, as that round counted them.
 */
function comparedOf(events: readonly LogEvent[], log: Pick<Index, "solves" | "builds">): Compared[] {
  return lastReports(events).map(({ session, index: at, data: last }) => {
    const began = events.findIndex(
      ({ kind, data }) => kind === "comparison.started" && data.session === session,
    );
    const own = events[at]?.data ?? last;
    // A comparison the campaign command runs is a session of its own (`g-N`), and the round it
    // measured is the Builder session that left its new harness. Read by name alone, none of the
    // six comparisons of the #107 buffer and recode campaigns had a round, and every trigger of a
    // session's comparison read nothing (2026-10-10).
    // A led Builder freezes a harness for a comparison inside its conversation (`build.checkpoint`),
    // which may never end: v061's g-2 read such a harness of b-1 (21 October).
    const frozen = new Set(
      events.flatMap(({ kind, data }, index) =>
        kind === "build.checkpoint" && index < at && data.harness === own.fresh ? [data.session] : [],
      ),
    );
    const makers = log.builds.filter(
      (each) => each.from < at && (each.finished?.harness === own.fresh || frozen.has(each.session)),
    );
    const build =
      log.builds.find((each) => each.session === session) ??
      makers.find((each) => each.finished?.changed === true) ??
      makers.at(-1) ??
      null;
    const scoredSet = new Set(
      ["versions", "short", "aside", "withdrawn"].flatMap((left) => strings(own[left])),
    );
    const counted = (solve: Solve) =>
      isString(own.setting) ? solve.comparison === session : build !== null && solve.index > build.from;
    const scoring = log.solves.filter(
      (solve) => solve.side === TEST && solve.index < at && scoredSet.has(solve.version) && counted(solve),
    );
    return { session, own, began, at, last, build, scoredSet, scoring };
  });
}

/** The Examiner's billed dollars over the tasks its sessions held out, the solves they asked for
 *  included (`spendOf`); none where no task was held out. The count is the handover's (`campaignOf`,
 *  `src/campaign/handover.ts`), an open session's by its admitted proposals: until 25 October this
 *  reader derived it again from the task admissions. It is every task the Examiner held out, released ones
 *  among them, where row D says the tasks held out now, the pack's among them. */
export function admittedCost(log: Index, steps: readonly Handover[]): string[] {
  const admitted = steps.reduce((sum, step) => sum + (step.step === "examiner" ? step.held : 0), 0);
  const [, dollars = 0] = spendOf(log.events).find(([role]) => role === "examiner") ?? [];
  return admitted === 0
    ? []
    : [
        `the Examiner's ${dollars.toFixed(2)} over ${plural(admitted, "task")} its sessions held out, ${(dollars / admitted).toFixed(2)} a task`,
      ];
}

/** The answers some check refused: a format fault reached no check and is none. */
function refusals(log: Index): Solve[] {
  return log.solves.filter((solve) => refusedBy(log.verdicts.get(solve.id)).length > 0);
}

/** A Builder session's practice solves: the test-side solves of released tasks made in its own window
 *  of the log that name no comparison, as the kernel reads practice (`practiceRan`). Until 20 October
 *  they were the solves of the tasks its start named, and a led conversation goes on while its
 *  campaign releases more: r3's b-1 opened on 1 task and practised 24 solves, of which that set
 *  counted 5. */
export function practiceOf(log: Index, build: Build): Solve[] {
  const released = new Set(log.released);
  return log.solves.filter(
    (solve) =>
      solve.index > build.from &&
      solve.index < build.until &&
      solve.side === TEST &&
      solve.comparison === null &&
      released.has(solve.version),
  );
}

/** Lanes 1 to 5: the exam's instrument, which is the pack author's. */
export function instrumentTriggers(log: Index): Trigger[] {
  const reading = log.of("checker.read").at(-1);
  const frozen = log.of("contract.frozen").at(-1);
  const rows = records(reading?.rows);
  // Named by the tool it runs since 12 October (`acceptance.ts`): until then the brief's evidence
  // kind, and 5 of buffer's 7 `authored` checks ran the pack's installed engine.
  const authored = unadmitted(log.events, []).length;
  const passes = log.solves.filter((solve) => solve.outcome === "pass").length;
  const trees = new Set([...log.conditions.values()].map((condition) => condition.verifierTools)).size;
  const faults = strings(reading?.faults);
  const lost = faults.filter((fault) => fault.includes("not on the verifier's tool path")).length;
  // The objective measures valid answers and refuses none, so the two counts of refusals leave it
  // out: buffer-r3's lane 3 on 20 October read its row of zeros as a check that missed its control answers.
  const checks = rows.filter((row) => row.id !== OBJECTIVE.id);
  const uncaught = checks.filter((row) => count(row.named) === 0 || count(row.caught) < count(row.named));
  const refused = refusals(log);
  const rulingOf = (solve: Solve) => text(log.rulings.get(solve.id)?.ruling) || "unread";
  const ruled = countBy(refused, rulingOf);
  const defects = refused.filter((solve) => rulingOf(solve) === DEFECT);
  const defectChecks = countBy(defects, (solve) => text(log.rulings.get(solve.id)?.check));
  const blocking = refused.flatMap((solve) => refusedBy(log.verdicts.get(solve.id)));
  const byCheck = countBy(blocking, (check) => check);
  // One check refusing most answers, and no other refusing as many: t-10's one refusal on 10
  // October was blocked by all four checks, and the first of four equal counts read as a fault
  // of one check's.
  const [top, next] = Object.entries(byCheck).sort(([, a], [, b]) => b - a);
  const lopsided =
    top !== undefined &&
    new Set(blocking).size > 1 &&
    top[1] > refused.length / 2 &&
    (next?.[1] ?? 0) < top[1];
  const carried = log.of("task.proposed").filter((data) => isString(data.carried)).length;
  // A reading's row counts the check's control answers, not the campaign's answers, so a check that caught
  // its control answers and refused no answer reads well there and is where a pass may show only the shape
  // it checked: 3 of buffer's 7 checks and 5 of recode's 11 on 10 October.
  const neverRefused = checks.map((row) => text(row.id)).filter((id) => byCheck[id] === undefined);
  return [
    ...(authored > 0
      ? [
          fired(
            "INSTRUMENT AUTHORED",
            `${share(authored, rows.length)} checks run no engine, so their author's own computation decides them`,
          ),
        ]
      : []),
    ...(passes > 0 ? [fired("PASSES UNREAD", `${String(passes)} passes; no reviewer reads a pass`)] : []),
    ...(trees > 1
      ? [fired("VERIFIER TOOLS MOVED", `${String(trees)} tool trees decided verdicts in one log`)]
      : []),
    ...(lost > 0 ? [fired("TOOL MISSING", plural(lost, "check tool"))] : []),
    ...(neverRefused.length > 0 && passes > 0
      ? [
          fired(
            "REFUSALS BY CHECK",
            `${share(neverRefused.length, checks.length)} checks refused none of ${plural(log.verdicts.size, "answer")}: ${neverRefused.join(", ")}; the rest: ${tally(byCheck)}`,
          ),
        ]
      : []),
    ...(reading === undefined
      ? [fired("NO CHECKER READING", "accept.ts has not read this campaign's checker")]
      : []),
    ...(faults.length > 0 ? [fired("CHECKER READ WITH FAULTS", plural(faults.length, "fault"))] : []),
    ...(uncaught.length > 0
      ? [
          fired(
            "CONTROL COVERAGE",
            `${share(uncaught.length, checks.length)} checks let through a reject control answer naming them, or were named by none: ${uncaught.map((row) => `${text(row.id)} refused ${String(count(row.caught))} of ${String(count(row.named))}`).join(", ")}`,
          ),
        ]
      : []),
    ...((ruled.unread ?? 0) > 0
      ? [
          fired(
            "REFUSED UNREAD",
            `${share(ruled.unread ?? 0, refused.length)} refused answers no reviewer ruled on`,
          ),
        ]
      : []),
    ...(defects.length > 0
      ? [
          fired(
            "CHECK DEFECT RULED",
            `${share(defects.length, refused.length)}; by check: ${tally(defectChecks)}`,
          ),
        ]
      : []),
    ...((ruled.unclear ?? 0) > 0 ? [fired("RULED UNCLEAR", share(ruled.unclear ?? 0, refused.length))] : []),
    ...(lopsided && passes > 0
      ? [fired("FAILS ON ONE CHECK", `${top[0]} refused ${share(top[1], refused.length)}`)]
      : []),
    ...(defects.length > 0 && passes > 0
      ? [fired("DEFECT RULED BESIDE PASSES", "a frozen alternative can settle what a ruling asserts")]
      : []),
    ...(frozen === undefined ? [fired("CHECKER NOT FROZEN", "no contract.frozen in the log")] : []),
    ...(count(frozen?.faults) > 0
      ? [fired("FROZEN DESPITE FAULTS", plural(count(frozen?.faults), "fault"))]
      : []),
    ...(frozen !== undefined && reading !== undefined && reading.checks !== frozen.checks
      ? [fired("READ AT ANOTHER VERSION", "the last reading is of another check program than the frozen one")]
      : []),
    ...(carried > 0
      ? [fired("TASKS CARRIED", `${plural(carried, "task")} came from another checker's campaign`)]
      : []),
  ];
}

/** The tallies of each comparison that scored a task, as the task lanes read them: the ties and the
 *  spread of the budget (lane 11), the ties (lane 12), and each harness by itself
 *  (`VALID BY HARNESS`, lane 24). A report written before 2026-10-11 also holds the same test
 *  read at shorter budgets (`budgets`), which no trigger reads: the reading was of a solver told
 *  the longer budget (`7f0add79:docs/simplify.md`, A2). */
function tallyTriggers(compared: readonly Compared[]): Trigger[] {
  const decided = compared.flatMap(({ session, last, scoring }) => {
    const scored = asRecord(last.scored);
    const [wins, losses, ties] = [count(scored?.wins), count(scored?.losses), count(scored?.ties)];
    const tasks = wins + losses + ties;
    // The bound its solves were told, named beside "at its limits"; a log of 8 October told its
    // solves none.
    const told = scoring.find((solve) => solve.modelTurns !== null)?.modelTurns ?? null;
    const limits = told === null ? "at its limits" : `at its limits (turns ${String(told)})`;
    return scored === null || tasks === 0
      ? []
      : [{ session, last, wins, losses, ties, tasks, limits, unsolved: count(scored.unsolved) }];
  });
  const tied = decided.filter(({ ties }) => ties > 0);
  // The plan's condition for an objective: more than half of the tasks tie with valid answers on
  // both sides. A tie holds as many valid answers under each harness, so one that is not unsolved
  // is such a tie.
  const validTies = decided.filter(({ ties, unsolved, tasks }) => (ties - unsolved) * 2 > tasks);
  // Each harness by itself: the tasks by how many of their solves were valid, none first. For the
  // plan's first round the reference harness is the starter, and this is what its task admission reads.
  const byHarness = decided.flatMap(({ session, last, limits }) => {
    const census = (found: JsonValue | undefined, at: string) => {
      const valid = asRecord(found);
      const tasks = (side: JsonValue | undefined) =>
        items(side)
          .map((each) => String(count(each)))
          .join("/");
      return valid === null ? [] : [`reference ${tasks(valid.old)}, new ${tasks(valid.fresh)} ${at}`];
    };
    const read = census(last.valid, limits);
    return read.length === 0 ? [] : [`${session}: ${read.join("; ")}`];
  });
  return [
    ...(validTies.length > 0
      ? [
          fired(
            "TIES BETWEEN VALID ANSWERS",
            validTies
              .map(
                ({ session, ties, unsolved, tasks }) => `${session}: ${share(ties - unsolved, tasks)} tasks`,
              )
              .join("; "),
          ),
        ]
      : []),
    ...(tied.length > 0
      ? [
          fired(
            "TIED TASKS",
            tied
              .map(
                ({ session, ties, tasks, unsolved }) =>
                  `${session}: ${share(ties, tasks)}, ${String(unsolved)} of them with no valid answer`,
              )
              .join("; "),
          ),
        ]
      : []),
    ...(byHarness.length > 0 ? [fired("VALID BY HARNESS", byHarness.join(" · "))] : []),
  ];
}

/** Lanes 9 to 14: the tasks, which are the Examiner's and the pack's. */
export function taskTriggers(log: Index): Trigger[] {
  const proposed = log.of("task.proposed").filter((data) => isString(data.session));
  const written = new Set(proposed.map((data) => text(data.version)));
  // One task admission records the shape check and, where available, room solves. Older logs
  // hold more numbered checks per task, which no command runs now and no trigger here reads.
  const admissions = log.of("task.gate").filter((data) => data.gate === 1 && written.has(text(data.version)));
  const passed = admissions.filter((data) => heldAtGate(data.outcome)).length;
  const reasons = countBy(
    admissions.filter((data) => data.outcome === "refused"),
    (data) => text(data.reason) || "unrecorded",
  );
  // Each scored task by its last report: whether any counted solve of either side answered it.
  const scored = new Map(
    lastReports(log.events).flatMap((report) =>
      pairsReported(log.events, report).map((pair) => [pair.task, noneAnswered(pair)] as const),
    ),
  );
  const unanswered = [...scored.values()].filter(Boolean).length;
  const [{ outcomes, awaiting }, by] = [poolOf(log.events), short(referenceOf(log.events) ?? "none")];
  const done = log.solves.filter((solve) => solve.side === TEST && solve.outcome === "pass");
  const quick = done.filter((solve) => solve.seconds < solve.wallSeconds * SMALL_DEADLINE_SHARE);
  const sequences = new Set(quick.map((solve) => solve.calls.join(">"))).size;
  // Each Examiner session's tasks still held at the end, under the reference then, and the reports before it.
  const bySession = Map.groupBy(proposed, (data) => text(data.session));
  const heard = [...bySession].flatMap(([session, tasks]) => {
    const said = countBy(
      tasks.filter((data) => log.held.includes(text(data.version))),
      (data) => outcomes.get(text(data.version)) ?? "not compared",
    );
    const opened = log.events.findIndex(({ kind, data }) => kind === EXAM_START && data.session === session);
    const before = log.events.slice(0, opened).filter(({ kind }) => kind === REPORTED).length;
    return Object.keys(said).length === 0
      ? []
      : [`${session}, opened after ${plural(before, "report")}: ${tally(said)}`];
  });
  return [
    // A proposal still at the gate has passed nothing yet, and failed nothing either: until
    // 28 October it counted as a fail, and N's six pending drafts read as thin supply.
    ...(passed * 2 < admissions.length
      ? [
          fired(
            "SUPPLY THIN",
            `${share(passed, admissions.length)} tasks the gate decided passed task admission; ${share(written.size - admissions.length, written.size)} proposed tasks are still at the gate`,
          ),
        ]
      : []),
    ...(Object.keys(reasons).length > 0 ? [fired("GATE REFUSED", tally(reasons))] : []),
    ...(unanswered > 0
      ? [
          fired(
            "NO VALID ANSWER",
            `${share(unanswered, scored.size)} scored tasks have no valid answer from any harness`,
          ),
        ]
      : []),
    ...(awaiting.length > 0
      ? [
          fired(
            "AWAITING A LABEL",
            `${plural(awaiting.length, "task")} with no valid answer on record after two comparisons that cut no solve of it at a limit, left out of the scored set until a person labels each: ${awaiting.map(short).join(" ")}`,
          ),
        ]
      : []),
    ...tallyTriggers(log.compared),
    ...(done.length > 0 && quick.length * 2 > done.length
      ? [
          fired(
            "PASSES AT A SMALL WALL SHARE",
            `${share(quick.length, done.length)} test-side passes, in ${plural(sequences, "call sequence")}`,
          ),
        ]
      : []),
    ...(heard.length > 0 ? [fired("OUTCOMES BY SESSION", `held, by ${by}: ${heard.join("; ")}`)] : []),
  ];
}
