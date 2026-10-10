/**
 * What every lane of a whole-run investigation starts from: the folds of one campaign's log, the
 * catalogue of triggers, and the lanes of the exam side.
 *
 * The folds (`indexOf`) read the log once into what the lanes ask of it: each solve with what it
 * ran under and how it ended, each Builder session with the window of the log that is its round,
 * each comparison with the solves it could count, and the last verdict and ruling of each solve. `TRIGGERS` names every trigger a reader can print and the lane it starts, and
 * `fired` makes one. Lanes 1 to 6 read the exam's instrument, which is the pack author's, and
 * lanes 7 to 12 the tasks, which are the Examiner's and the pack's; both sit here, below the
 * lanes of the build side and the host, which `read.ts` keeps with the rows and the overview, and
 * the lanes that read the clock, which are `time.ts`.
 *
 * Split from `read.ts` on 10 October, when that file stood at 1,227 nonblank lines against the
 * size policy's ceiling of 800 (`tools/loc/source-policy.ts`, `docs/plan.md` row F34). The lanes
 * need the folds, so the folds sit below every lane, and the exam side's lanes sit with them so
 * that each of the two files is under the ceiling. Every function keeps the name and the body it
 * had in `read.ts`; `taskTriggers` alone was split at its tallies (`tallyTriggers`), which held it
 * at 147 lines against the policy's 115.
 */
import { type Condition, conditionsOf } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import {
  awaitingLabel,
  billedAll,
  lastReports,
  outcomesOf,
  pairsReported,
  unsolved as noneAnswered,
} from "#src/kernel/reports.ts";
import { taskSets } from "#src/kernel/task.ts";
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
  outcome: string | null;
  kind: string | null;
  seconds: number;
  readonly calls: string[];
  errors: number;
  /** Whether the provider named the model that served it. */
  attested: boolean;
}

/** One call of a Builder's tool, at its place in the log. */
interface Call {
  readonly index: number;
  readonly tool: string;
  readonly args: JsonObject | null;
}

/** A Builder session, the window of the log that is its round, and the round's report. */
export interface Build {
  readonly session: string;
  readonly from: number;
  until: number;
  readonly parent: string;
  readonly practice: ReadonlySet<string>;
  finished: JsonObject | null;
  /** The round's last report: its own, or the one a person's labels settled. */
  report: JsonObject | null;
  /** The round's own report, which a settling leaves in the log. */
  own: JsonObject | null;
  readonly calls: Call[];
}

/** A comparison as its reports hold it, with the solves it counted. */
export interface Compared {
  /** The id it reported under: a round's session, or a checkpoint's own. */
  readonly session: string;
  /** Its own report, which a settling leaves in the log, and where it stands. */
  readonly own: JsonObject;
  readonly at: number;
  /** Its last report: its own, or the one a person's labels settled. */
  readonly last: JsonObject;
  /** The Builder session it followed, or null for a comparison with none. */
  readonly build: Build | null;
  readonly scoredSet: ReadonlySet<string>;
  /** The test-side solves of its scored tasks under one of its harnesses that it could count. */
  readonly scoring: readonly Solve[];
}

export interface Index {
  readonly events: readonly LogEvent[];
  readonly conditions: ReadonlyMap<string, Condition>;
  readonly solves: readonly Solve[];
  readonly verdicts: ReadonlyMap<string, JsonObject>;
  readonly rulings: ReadonlyMap<string, JsonObject>;
  readonly states: ReadonlyMap<string, string>;
  readonly builds: readonly Build[];
  readonly compared: readonly Compared[];
  /** The held-out task versions, and the practice ones. */
  readonly held: readonly string[];
  readonly released: readonly string[];
  readonly of: (kind: LogEvent["kind"]) => JsonObject[];
}

/** A pass under this share of its wall, on few calls, is the lead v1 read for a published recipe. */
export const SMALL_WALL_SHARE = 0.05;
const DEFECT = "check-defect";
export const TEST = "test";
export const BUILD_END = "build.finished";
export const EXAM_END = "exam.finished";
export const REPORTED = "comparison.reported";

/** Every trigger this reader can print, and the lane it starts. `lanes.md` names each one in the
 *  `Starts from` paragraph of that lane, and `test/wri-catalogue.test.ts` holds the two together. */
export const TRIGGERS = {
  "INSTRUMENT AUTHORED": 1,
  "PASSES UNREAD": 1,
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
  "CHECKER NOT FROZEN": 6,
  "FROZEN DESPITE FAULTS": 6,
  "READ AT ANOTHER VERSION": 6,
  "TASKS CARRIED": 6,
  "SUPPLY THIN": 7,
  "GATE REFUSED": 7,
  "NO VALID ANSWER": 8,
  "AWAITING A LABEL": 8,
  "TIES BETWEEN VALID ANSWERS": 9,
  "TIED TASKS": 10,
  "PASSES AT A SMALL WALL SHARE": 11,
  "OUTCOMES BY SESSION": 12,
  "HARNESS CHANGED": 13,
  "BROKEN AT END": 13,
  "MEASURED AN EARLIER STATE": 13,
  "NEVER CHECKED": 14,
  "TOOLS CALLED": 14,
  "TOOL CALLS ERRED": 14,
  "TOOLS EDITED": 15,
  "NO PRACTICE": 16,
  "FINAL BYTES NEVER PRACTISED": 16,
  "SESSION ENDED": 16,
  "PRACTICE FAILS": 17,
  "PRACTISED TASK MEASURED": 18,
  "SHELL COMMANDS": 18,
  "WIN AT A SMALL WALL SHARE": 19,
  "SCORED SET MOVED": 21,
  "NOTHING SCORED": 22,
  "CUT BY ITS CAP": 22,
  "FEW INFORMATIVE PAIRS": 22,
  "SET SHORT": 22,
  "VALID BY HARNESS": 23,
  "FLIPS": 24,
  "REFERENCE AGAINST ITSELF": 24,
  "HOST CODE MOVED": 20,
  "CHAIN": 25,
  "STEP NOT REPEATED": 25,
  "NO TASK HELD OUT": 25,
  "WALL SHARE": 26,
  "HOST LOADED": 26,
  "LOAD MOVED": 26,
  "MISSES AT A LIMIT": 26,
  "NON-RESULTS": 27,
  "SOLVE NEVER FINISHED": 27,
  "EXAMINER NEVER FINISHED": 27,
  "MISSES WITHOUT A VERDICT": 27,
  "SESSION CRASHED": 27,
  "LONG SILENCES": 28,
  "SPEND LED BY A ROLE": 28,
  "REPLAY MOVED THE VERDICT": 29,
  "SET ASIDE AND UNSETTLED": 30,
  "READING MOVES WITH THE SET-ASIDE": 30,
  "SET ASIDE BY SIDE": 30,
  "SETTLED BY HAND": 30,
  "REVIEW FAULTS": 30,
  "EARNED WITHOUT A PROBE": 30,
} as const;

export const text = (value: JsonValue | undefined): string => (isString(value) ? value : "");
export const count = (value: JsonValue | undefined): number => (isNumber(value) ? value : 0);
export const items = (value: JsonValue | undefined): readonly JsonValue[] =>
  Array.isArray(value) ? value : [];
export const strings = (value: JsonValue | undefined): string[] => items(value).filter(isString);
export const short = (digest: string): string => digest.slice(0, 8);
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

function solvesOf(events: readonly LogEvent[], conditions: ReadonlyMap<string, Condition>): Solve[] {
  const solves = new Map<string, Solve>();
  for (const [index, { kind, data }] of events.entries()) {
    const id = text(data.solve);
    if (kind === "solve.started") {
      const condition = conditions.get(text(data.condition));
      const [minute] = items(data.load);
      const limits = asRecord(data.limits);
      solves.set(id, {
        id,
        index,
        version: condition?.task ?? "",
        harness: condition?.harness ?? "",
        condition: text(data.condition),
        side: condition?.side ?? "",
        comparison: isString(data.comparison) ? data.comparison : null,
        wallSeconds: count(limits?.wallSeconds),
        modelTurns: isNumber(limits?.modelTurns) ? limits.modelTurns : null,
        load: isNumber(minute) ? minute : null,
        cores: isNumber(data.cores) ? data.cores : null,
        outcome: null,
        kind: null,
        seconds: 0,
        calls: [],
        errors: 0,
        attested: false,
      });
    }
    const solve = solves.get(id);
    if (solve !== undefined && kind === "solve.call") {
      solve.calls.push(text(data.tool));
      solve.errors += data.isError === true ? 1 : 0;
    }
    if (solve !== undefined && kind === "solve.finished") {
      const ending = asRecord(data.ending);
      solve.outcome = text(ending?.outcome);
      solve.kind = isString(ending?.kind) ? ending.kind : null;
      solve.seconds = count(data.seconds);
      solve.attested = items(data.responseModels).length > 0;
    }
  }
  return [...solves.values()];
}

function buildsOf(events: readonly LogEvent[]): Build[] {
  const builds: Build[] = [];
  for (const [index, { kind, data }] of events.entries()) {
    const session = text(data.session);
    if (kind === "build.started") {
      const last = builds.at(-1);
      if (last !== undefined) last.until = index;
      builds.push({
        session,
        from: index,
        until: events.length,
        parent: text(data.parent),
        practice: new Set(strings(data.tasks)),
        finished: null,
        report: null,
        own: null,
        calls: [],
      });
    }
    const build = builds.find((each) => each.session === session);
    if (build !== undefined && kind === "build.call") {
      build.calls.push({ index, tool: text(data.tool), args: asRecord(data.args) });
    }
    if (build !== undefined && kind === BUILD_END) build.finished = data;
    if (build !== undefined && kind === REPORTED) {
      build.own ??= data;
      build.report = data;
    }
  }
  return builds;
}

export function indexOf(events: readonly LogEvent[]): Index {
  const conditions = conditionsOf(events);
  const last = (kind: LogEvent["kind"]) =>
    new Map(events.flatMap((event) => (event.kind === kind ? [[text(event.data.solve), event.data]] : [])));
  const of = (kind: LogEvent["kind"]) => events.flatMap((event) => (event.kind === kind ? [event.data] : []));
  const { states, held, released } = taskSets(events);
  const solves = solvesOf(events, conditions);
  const builds = buildsOf(events);
  return {
    events,
    conditions,
    solves,
    verdicts: last("verdict"),
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
 * (`src/builder/round.ts`). A report written before 2026-10-09 names no setting; its solves are
 * read from its round's own window of the log, as that round counted them.
 */
function comparedOf(events: readonly LogEvent[], log: Pick<Index, "solves" | "builds">): Compared[] {
  return lastReports(events).map(({ session, data: last }) => {
    const at = events.findIndex(({ kind, data }) => kind === REPORTED && data.session === session);
    const own = events[at]?.data ?? last;
    const build = log.builds.find((each) => each.session === session) ?? null;
    const scoredSet = new Set(
      ["versions", "short", "aside", "withdrawn"].flatMap((left) => strings(own[left])),
    );
    const counted = (solve: Solve) =>
      isString(own.setting) ? solve.comparison === session : build !== null && solve.index > build.from;
    const scoring = log.solves.filter(
      (solve) => solve.side === TEST && solve.index < at && scoredSet.has(solve.version) && counted(solve),
    );
    return { session, own, at, last, build, scoredSet, scoring };
  });
}

/** The events each role's dollars are in, as `billedAll` reads them: what it was billed where it
 *  ended, and the turns of a session that never ended. */
const ROLE_EVENTS = {
  solver: ["solve.started", "solve.finished", "solve.turn"],
  builder: ["build.started", BUILD_END, "build.turn"],
  examiner: ["exam.started", EXAM_END, "exam.turn"],
  referee: ["referee.finding"],
  // A seat until 11 October (`docs/simplify.md`, E1): a log of before holds what it billed.
  diagnoser: ["diagnosis.recorded"],
} as const;

/** Billed dollars by role, the largest first, counted as the campaign's own budget counts them:
 *  a session a stop cut has no end record, and its turns were read as nothing. Buffer's Examiner
 *  session x-1 read 0.00 against $1.68 billed, and the builder's share of the campaign read 71.3%
 *  where it was 42.2% (2026-10-10). */
export function spendOf(log: Index): [string, number][] {
  const spent = (kinds: readonly string[]) =>
    billedAll(log.events.filter(({ kind }) => kinds.includes(kind)));
  return Object.entries(ROLE_EVENTS)
    .map(([role, kinds]): [string, number] => [role, spent(kinds)])
    .sort(([, a], [, b]) => b - a);
}

/** The answers some check refused: a format fault reached no check and is none. */
function refusals(log: Index): Solve[] {
  return log.solves.filter((solve) => {
    const verdict = log.verdicts.get(solve.id);
    return verdict?.kind === "fail" && items(verdict.blocking).length > 0;
  });
}

/** A Builder session's practice solves: the test-side solves of its practice tasks made in its own
 *  window of the log. */
export function practiceOf(log: Index, build: Build): Solve[] {
  return log.solves.filter(
    (solve) =>
      solve.index > build.from &&
      solve.index < build.until &&
      solve.side === TEST &&
      build.practice.has(solve.version),
  );
}

/** Lanes 1 to 6: the exam's instrument, which is the pack author's. */
export function instrumentTriggers(log: Index): Trigger[] {
  const reading = log.of("checker.read").at(-1);
  const frozen = log.of("contract.frozen").at(-1);
  const rows = records(reading?.rows);
  const authored = rows.filter((row) => row.instrument === "authored").length;
  const passes = log.solves.filter((solve) => solve.outcome === "pass").length;
  const trees = new Set([...log.conditions.values()].map((condition) => condition.verifierTools)).size;
  const faults = strings(reading?.faults);
  const lost = faults.filter((fault) => fault.includes("not on the verifier's tool path")).length;
  const uncaught = rows.filter((row) => count(row.named) === 0 || count(row.caught) < count(row.named));
  const refused = refusals(log);
  const rulingOf = (solve: Solve) => text(log.rulings.get(solve.id)?.ruling) || "unread";
  const ruled = countBy(refused, rulingOf);
  const defects = refused.filter((solve) => rulingOf(solve) === DEFECT);
  const defectChecks = countBy(defects, (solve) => text(log.rulings.get(solve.id)?.check));
  const blocking = refused.flatMap((solve) => strings(log.verdicts.get(solve.id)?.blocking));
  // One check refusing most answers, and no other refusing as many: t-10's one refusal on 10
  // October was blocked by all four checks, and the first of four equal counts read as a fault
  // of one check's.
  const [top, next] = Object.entries(countBy(blocking, (check) => check)).sort(([, a], [, b]) => b - a);
  const lopsided =
    top !== undefined &&
    new Set(blocking).size > 1 &&
    top[1] > refused.length / 2 &&
    (next?.[1] ?? 0) < top[1];
  const carried = log.of("task.proposed").filter((data) => isString(data.carried)).length;
  return [
    ...(authored > 0
      ? [
          fired(
            "INSTRUMENT AUTHORED",
            `${share(authored, rows.length)} checks decide by their author's own computation`,
          ),
        ]
      : []),
    ...(passes > 0 ? [fired("PASSES UNREAD", `${String(passes)} passes; no reviewer reads a pass`)] : []),
    ...(trees > 1
      ? [fired("VERIFIER TOOLS MOVED", `${String(trees)} tool trees decided verdicts in one log`)]
      : []),
    ...(lost > 0 ? [fired("TOOL MISSING", plural(lost, "check tool"))] : []),
    ...(reading === undefined
      ? [fired("NO CHECKER READING", "accept.ts has not read this campaign's checker")]
      : []),
    ...(faults.length > 0 ? [fired("CHECKER READ WITH FAULTS", plural(faults.length, "fault"))] : []),
    ...(uncaught.length > 0
      ? [
          fired(
            "CONTROL COVERAGE",
            `${share(uncaught.length, rows.length)} checks refused no reject control naming them`,
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
 *  spread of the budget (lane 9), the ties (lane 10), and each harness by itself
 *  (`VALID BY HARNESS`, lane 23). A report written before 2026-10-11 also holds the same test
 *  read at shorter budgets (`budgets`), which no trigger reads: the reading was of a solver told
 *  the longer budget (`docs/simplify.md`, A2). */
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
  // plan's first round the reference harness is the starter, and this is what its gate reads.
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

/** Lanes 7 to 12: the tasks, which are the Examiner's and the pack's. */
export function taskTriggers(log: Index): Trigger[] {
  const proposed = log.of("task.proposed").filter((data) => isString(data.session));
  const written = new Set(proposed.map((data) => text(data.version)));
  // A task meets one gate, the shape of its package. A log written before 2026-10-09 holds three
  // more a task, which no command runs now and no trigger here reads.
  const gates = log.of("task.gate").filter((data) => data.gate === 1 && written.has(text(data.version)));
  const passed = gates.filter((data) => data.outcome === "passed").length;
  const reasons = countBy(
    gates.filter((data) => data.outcome === "refused"),
    (data) => text(data.reason) || "unrecorded",
  );
  // Each scored task by its last report: whether any counted solve of either side answered it.
  const scored = new Map(
    lastReports(log.events).flatMap((report) =>
      pairsReported(log.events, report).map((pair) => [pair.task, noneAnswered(pair)] as const),
    ),
  );
  const unanswered = [...scored.values()].filter(Boolean).length;
  const outcomes = outcomesOf(log.events);
  const awaiting = awaitingLabel(log.events).filter((version) => log.held.includes(version));
  const done = log.solves.filter((solve) => solve.side === TEST && solve.outcome === "pass");
  const quick = done.filter((solve) => solve.seconds < solve.wallSeconds * SMALL_WALL_SHARE);
  const sequences = new Set(quick.map((solve) => solve.calls.join(">"))).size;
  // What became of each Examiner session's held-out tasks, by the one outcome its author hears.
  const bySession = Map.groupBy(proposed, (data) => text(data.session));
  const heard = [...bySession].flatMap(([session, tasks]) => {
    const said = countBy(
      tasks.filter((data) => log.held.includes(text(data.version))),
      (data) => outcomes.get(text(data.version)) ?? "not compared",
    );
    return Object.keys(said).length === 0 ? [] : [`${session}: ${tally(said)}`];
  });
  return [
    ...(proposed.length > 0 && passed * 2 < proposed.length
      ? [fired("SUPPLY THIN", `${share(passed, proposed.length)} proposed tasks passed the gate`)]
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
    ...(heard.length > 0 ? [fired("OUTCOMES BY SESSION", heard.join("; "))] : []),
  ];
}
