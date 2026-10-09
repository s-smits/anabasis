/**
 * The deterministic read of one campaign's log for a whole-run investigation: six rows of
 * identities the primary reviewer settles, and the triggers that say which of the thirty lanes of
 * `.claude/skills/whole-run-investigation/references/lanes.md` have something to read.
 *
 * v1's readers walked a campaign folder of some forty record kinds: claims, promotions, epochs,
 * batteries, case records, Builder executions, reviews. v2 keeps one append-only log, and everything
 * a lane starts from is a fold of it, so this file replaces v1's thirteen readers and reads nothing
 * else: no harness state, no pack, no file beside the log.
 *
 * A trigger is a capitalised name, the lane it starts and one line of counts. It says a lane has
 * something to read and never what the answer is: a lane that contradicts its trigger from the
 * bytes has done its job. A trigger that did not fire says this arithmetic found nothing, and not
 * that the property is absent. No trigger carries an answer, a task's text or a hidden value.
 */
import { signP } from "#src/kernel/compare.ts";
import { type Condition, conditionsOf } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { awaitingLabel, lastReports, outcomesOf } from "#src/kernel/reports.ts";
import { taskSets } from "#src/kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";

export interface Trigger {
  readonly lane: number;
  /** The capitalised name a lane's `Starts from` paragraph cites. */
  readonly name: keyof typeof TRIGGERS;
  readonly detail: string;
}

export interface Row {
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
}

export interface Overview {
  readonly rows: readonly Row[];
  readonly triggers: readonly Trigger[];
}

/** One solve as the log holds it: what it ran under, how it ended and what it called. */
interface Solve {
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
  /** The host's one-minute load when it started, and the cores that is a load on; null where its
   *  start holds none, as before 2026-10-09 for the cores. */
  readonly load: number | null;
  readonly cores: number | null;
  outcome: string | null;
  kind: string | null;
  seconds: number;
  /** The CPU seconds of its commands, or null where the log holds none whole: a command cut at its
   *  timeout or by an abort ends unmeasured (`src/solve/command.ts`), and the sum of the others is
   *  then a floor and no reading. */
  cpu: number | null;
  /** How many of its commands ended with their CPU time unmeasured. */
  unmeasured: number;
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
interface Build {
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
interface Compared {
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

interface Index {
  readonly events: readonly LogEvent[];
  readonly conditions: ReadonlyMap<string, Condition>;
  readonly solves: readonly Solve[];
  readonly verdicts: ReadonlyMap<string, JsonObject>;
  readonly rulings: ReadonlyMap<string, JsonObject>;
  readonly diagnoses: ReadonlyMap<string, JsonObject>;
  readonly states: ReadonlyMap<string, string>;
  readonly builds: readonly Build[];
  readonly compared: readonly Compared[];
  /** The held-out task versions, and the practice ones. */
  readonly held: readonly string[];
  readonly released: readonly string[];
  readonly of: (kind: LogEvent["kind"]) => JsonObject[];
}

/** The share of a wall past which a miss is read as bound by it, as v1's climb read it. */
const WALL_BOUND_SHARE = 0.95;
/** A pass under this share of its wall, on few calls, is the lead v1 read for a published recipe. */
const SMALL_WALL_SHARE = 0.05;
const FEW_CALLS = 3;
/** The median ratio between the largest and the smallest use of a unit, over repeated solves of
 *  one harness on one task, from which a budget in that unit splits two such solves about as often
 *  as not. */
const SPREAD_WORTH_A_LINE = 1.5;
/** The units a budget on record may name: the two a budget is given in today, and the two that
 *  were units until 2026-10-09 (`src/kernel/compare.ts`), which the first campaigns' reports hold. */
const RECORDED_UNITS = ["turns", "prompts", "cpu", "seconds"] as const;
/** The factor between the loads two comparisons ran under from which they are read as made on
 *  different hosts, and the load under which no factor is worth a line: a load of four moves no
 *  wall on a host of four cores or more. On 2026-10-09 one harness answered the same tasks in a
 *  median of 105 s under a load of 31 and of 40 s under a load of 6. */
const LOAD_MOVED = 2;
const LOAD_WORTH_A_LINE = 4;
/** Minutes of silence in the log worth a line. */
const SILENCE_MINUTES = 20;
const DEFECT = "check-defect";
const TEST = "test";
const BUILD_END = "build.finished";
const EXAM_END = "exam.finished";
const EXAM_START = "exam.started";
const REPORTED = "comparison.reported";
/** The Builder tools that write one named file: pi's two, and the one tool sessions had before them. */
const FILE_WRITERS: ReadonlySet<string> = new Set(["write", "edit", "write_file"]);

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
  "USE OF THE BUDGET SPREADS": 9,
  "TIED TASKS": 10,
  "TALLY BY BUDGET": 10,
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
  "BELOW THE STARTER": 23,
  "STARTER UNREAD": 23,
  "FLIPS": 24,
  "REFERENCE AGAINST ITSELF": 24,
  "HOST CODE MOVED": 20,
  "CHAIN": 25,
  "STEP NOT REPEATED": 25,
  "NO TASK HELD OUT": 25,
  "WALL SHARE": 26,
  "HOST LOADED": 26,
  "LOAD MOVED": 26,
  "WALL-BOUND MISSES": 26,
  "LONG SOLVE, LITTLE CPU": 26,
  "CPU UNMEASURED": 26,
  "NON-RESULTS": 27,
  "SOLVE NEVER FINISHED": 27,
  "EXAMINER NEVER FINISHED": 27,
  "MISSES WITHOUT A VERDICT": 27,
  "SESSION CRASHED": 27,
  "SILENCE": 28,
  "SPEND LED BY A ROLE": 28,
  "DIAGNOSES": 29,
  "REPLAY MOVED THE VERDICT": 29,
  "SET ASIDE AND UNSETTLED": 30,
  "READING MOVES WITH THE SET-ASIDE": 30,
  "SET ASIDE BY SIDE": 30,
  "SETTLED BY HAND": 30,
  "REVIEW FAULTS": 30,
  "EARNED WITHOUT A PROBE": 30,
} as const;

const text = (value: JsonValue | undefined): string => (isString(value) ? value : "");
const count = (value: JsonValue | undefined): number => (isNumber(value) ? value : 0);
const items = (value: JsonValue | undefined): readonly JsonValue[] => (Array.isArray(value) ? value : []);
const strings = (value: JsonValue | undefined): string[] => items(value).filter(isString);
const short = (digest: string): string => digest.slice(0, 8);
const share = (part: number, whole: number): string => `${String(part)} of ${String(whole)}`;
const percent = (part: number): string => `${(part * 100).toFixed(1)}%`;
const fired = (name: keyof typeof TRIGGERS, detail: string): Trigger => ({
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

function tally(counts: Readonly<Record<string, number>>): string {
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
      solves.set(id, {
        id,
        index,
        version: condition?.task ?? "",
        harness: condition?.harness ?? "",
        condition: text(data.condition),
        side: condition?.side ?? "",
        comparison: isString(data.comparison) ? data.comparison : null,
        wallSeconds: count(asRecord(data.limits)?.wallSeconds),
        load: isNumber(minute) ? minute : null,
        cores: isNumber(data.cores) ? data.cores : null,
        outcome: null,
        kind: null,
        seconds: 0,
        cpu: null,
        unmeasured: 0,
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
      const cpu = asRecord(data.cpu);
      solve.outcome = text(ending?.outcome);
      solve.kind = isString(ending?.kind) ? ending.kind : null;
      solve.seconds = count(data.seconds);
      solve.unmeasured = count(cpu?.unmeasured);
      solve.cpu = isNumber(cpu?.seconds) && solve.unmeasured === 0 ? cpu.seconds : null;
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

function indexOf(events: readonly LogEvent[]): Index {
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
    diagnoses: last("diagnosis.recorded"),
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

/** Metered dollars by role, the largest first. */
function spendOf(log: Index): [string, number][] {
  const spent = (kind: LogEvent["kind"]) => log.of(kind).reduce((sum, data) => sum + count(data.metered), 0);
  return Object.entries({
    solver: spent("solve.finished"),
    builder: spent(BUILD_END),
    examiner: spent(EXAM_END),
    referee: spent("referee.finding"),
    diagnoser: spent("diagnosis.recorded"),
  }).sort(([, a], [, b]) => b - a);
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
function practiceOf(log: Index, build: Build): Solve[] {
  return log.solves.filter(
    (solve) =>
      solve.index > build.from &&
      solve.index < build.until &&
      solve.side === TEST &&
      build.practice.has(solve.version),
  );
}

/** Lanes 1 to 6: the exam's instrument, which is the pack author's. */
function instrumentTriggers(log: Index): Trigger[] {
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
  const [top] = Object.entries(countBy(blocking, (check) => check)).sort(([, a], [, b]) => b - a);
  const lopsided = top !== undefined && new Set(blocking).size > 1 && top[1] > refused.length / 2;
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

/** Lanes 7 to 12: the tasks, which are the Examiner's and the pack's. */
function taskTriggers(log: Index): Trigger[] {
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
  const outcomes = outcomesOf(log.events);
  const unanswered = [...outcomes.values()].filter((outcome) => outcome === "no-valid-answer").length;
  const awaiting = awaitingLabel(log.events).filter((version) => log.held.includes(version));
  const decided = log.compared.flatMap(({ session, last }) => {
    const scored = asRecord(last.scored);
    const [wins, losses, ties] = [count(scored?.wins), count(scored?.losses), count(scored?.ties)];
    const tasks = wins + losses + ties;
    return scored === null || tasks === 0
      ? []
      : [{ session, last, wins, losses, ties, tasks, unsolved: count(scored.unsolved) }];
  });
  const tied = decided.filter(({ ties }) => ties > 0);
  // The plan's condition for an objective: more than half of the tasks tie with valid answers on
  // both sides. A tie holds as many valid answers under each harness, so one that is not unsolved
  // is such a tie.
  const validTies = decided.filter(({ ties, unsolved, tasks }) => (ties - unsolved) * 2 > tasks);
  const spreading = decided.flatMap(({ session, last }) => {
    const units = Object.entries(asRecord(last.spread) ?? {}).flatMap(([unit, value]) => {
      const [middle, most] = [asRecord(value)?.median, asRecord(value)?.most];
      return isNumber(middle) && isNumber(most) && middle >= SPREAD_WORTH_A_LINE
        ? [`${unit} x${middle.toFixed(1)} at the median and x${most.toFixed(1)} at most`]
        : [];
    });
    return units.length === 0 ? [] : [`${session}: ${units.join(", ")}`];
  });
  /** A budget as a report names it: its units, each with its most. */
  const budgetOf = (row: JsonObject) =>
    RECORDED_UNITS.flatMap((unit) => (isNumber(row[unit]) ? [`${unit} ${String(row[unit])}`] : [])).join(
      ", ",
    );
  const byBudget = decided.flatMap(({ session, last, wins, losses, ties }) => {
    const read = items(last.budgets).flatMap((budget) => {
      const row = asRecord(budget) ?? {};
      // A report written before 2026-10-09 says how many scored tasks a CPU budget could not be
      // read on, and so left out. No budget is given in CPU since, and no report holds the count.
      const unread = count(row.unread);
      return [
        `${budgetOf(row)}: ${String(count(row.wins))}-${String(count(row.losses))}-${String(count(row.ties))}${unread === 0 ? "" : `, ${String(unread)} unread`}`,
      ];
    });
    return read.length === 0
      ? []
      : [`${session}: ${String(wins)}-${String(losses)}-${String(ties)} at its limits; ${read.join("; ")}`];
  });
  // Each harness by itself: the tasks by how many of their solves were valid, none first. For the
  // plan's first round the reference harness is the starter, and this is what its gate reads.
  const byHarness = decided.flatMap(({ session, last }) => {
    const census = (found: JsonValue | undefined, at: string) => {
      const valid = asRecord(found);
      const tasks = (side: JsonValue | undefined) =>
        items(side)
          .map((each) => String(count(each)))
          .join("/");
      return valid === null ? [] : [`reference ${tasks(valid.old)}, new ${tasks(valid.fresh)} ${at}`];
    };
    const read = [
      ...census(last.valid, "at its limits"),
      ...items(last.budgets).flatMap((budget) => {
        const row = asRecord(budget) ?? {};
        return census(row.valid, `at ${budgetOf(row)}`);
      }),
    ];
    return read.length === 0 ? [] : [`${session}: ${read.join("; ")}`];
  });
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
            `${share(unanswered, outcomes.size)} scored tasks have no valid answer from any harness`,
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
    ...(spreading.length > 0 ? [fired("USE OF THE BUDGET SPREADS", spreading.join("; "))] : []),
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
    ...(byBudget.length > 0 ? [fired("TALLY BY BUDGET", byBudget.join("; "))] : []),
    ...(byHarness.length > 0 ? [fired("VALID BY HARNESS", byHarness.join(" · "))] : []),
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

/** Lanes 13 to 19: the harness, which is the Builder's. */
function harnessTriggers(log: Index): Trigger[] {
  return log.builds.flatMap((build) => {
    const { session, finished, parent, calls } = build;
    const compared = log.compared.find((each) => each.build === build);
    const round = {
      practice: practiceOf(log, build),
      scoring: compared?.scoring ?? [],
      scoredSet: compared?.scoredSet ?? new Set<string>(),
    };
    const changed = finished?.changed === true;
    const child = text(finished?.harness);
    // pi's `write` and `edit` since 2026-10-09, and `write_file` in the sessions before it.
    const written = [
      ...new Set(calls.flatMap(({ tool, args }) => (FILE_WRITERS.has(tool) ? [text(args?.path)] : []))),
    ];
    const toolFiles = written.filter((path) => path.includes("tools"));
    // A practice solve's condition names the state it ran under, so the log says by digest whether
    // the harness that was measured is one the Builder tried: an edit made with the shell leaves no
    // call to count, and a digest misses none.
    const practisedUnder = new Set(round.practice.map((solve) => solve.harness));
    const lastPractice = round.practice.at(-1);
    const fresh = log.solves.filter((solve) => changed && solve.harness === child && solve.side === TEST);
    const erring = fresh.filter((solve) => solve.errors > 0).length;
    const ended = finished === null ? "never finished" : text(finished.ended);
    const failed = round.practice.filter((solve) => solve.outcome === "fail");
    const earned = failed.filter((fail) => log.rulings.get(fail.id)?.ruling === "earned").length;
    // A fail followed by a pass of the same task: under other bytes it may be the change answering
    // the fail, and under the same bytes it is the solver's variance and answers nothing.
    const laterPass = (fail: Solve, same: boolean) =>
      round.practice.some(
        (later) =>
          later.version === fail.version &&
          later.index > fail.index &&
          later.outcome === "pass" &&
          (later.harness === fail.harness) === same,
      );
    const answered = failed.filter((fail) => laterPass(fail, false)).length;
    const flipped = failed.filter((fail) => laterPass(fail, true)).length;
    const exposed = [...round.scoredSet].filter((version) => build.practice.has(version)).length;
    const shell = calls.filter(({ tool }) => tool === "bash").length;
    // The comparison is made against the reference harness, which need not be the one the session
    // started from. A report written before 2026-10-09 names none: it compared with its parent.
    const reference = text(compared?.own.old) || parent;
    const lostBefore = new Set(
      round.scoring
        .filter((solve) => solve.harness === reference && solve.outcome === "fail")
        .map((solve) => solve.version),
    );
    const quickWins = round.scoring.filter(
      (solve) =>
        solve.harness === child &&
        solve.outcome === "pass" &&
        lostBefore.has(solve.version) &&
        solve.seconds < solve.wallSeconds * SMALL_WALL_SHARE &&
        solve.calls.length <= FEW_CALLS,
    ).length;
    return [
      ...(changed
        ? [
            fired(
              "HARNESS CHANGED",
              `${session}: ${short(parent)} to ${short(child)}; written by its file tools: ${written.join(", ") || "nothing"}`,
            ),
          ]
        : []),
      ...(isString(finished?.broken)
        ? [
            fired(
              child === "" ? "BROKEN AT END" : "MEASURED AN EARLIER STATE",
              `${session}: what the session left does not open`,
            ),
          ]
        : []),
      ...(changed && !calls.some(({ tool }) => tool === "check_harness")
        ? [fired("NEVER CHECKED", `${session}: no check_harness call`)]
        : []),
      ...(fresh.length > 0
        ? [
            fired(
              "TOOLS CALLED",
              `${session}: ${tally(
                countBy(
                  fresh.flatMap((solve) => solve.calls),
                  (tool) => tool,
                ),
              )}`,
            ),
          ]
        : []),
      ...(erring * 4 > fresh.length
        ? [
            fired(
              "TOOL CALLS ERRED",
              `${session}: in ${share(erring, fresh.length)} solves under the new harness`,
            ),
          ]
        : []),
      ...(toolFiles.length > 0 ? [fired("TOOLS EDITED", `${session}: ${toolFiles.join(", ")}`)] : []),
      ...(changed && lastPractice === undefined
        ? [fired("NO PRACTICE", `${session}: the harness changed and no practice solve ran`)]
        : []),
      ...(changed && child !== "" && lastPractice !== undefined && !practisedUnder.has(child)
        ? [
            fired(
              "FINAL BYTES NEVER PRACTISED",
              `${session}: no practice solve ran under ${short(child)}, the harness measured; the last ran under ${short(lastPractice.harness)}`,
            ),
          ]
        : []),
      ...(ended === "finished" ? [] : [fired("SESSION ENDED", `${session}: ${ended}`)]),
      ...(failed.length > 0
        ? [
            fired(
              "PRACTICE FAILS",
              `${session}: ${plural(failed.length, "fail")}, ${String(earned)} ruled earned; the same task passed later under changed bytes ${String(answered)}, under the same bytes ${String(flipped)}`,
            ),
          ]
        : []),
      ...(exposed > 0
        ? [
            fired(
              "PRACTISED TASK MEASURED",
              `${session}: ${plural(exposed, "task")} both practised and measured`,
            ),
          ]
        : []),
      ...(shell > 0 ? [fired("SHELL COMMANDS", `${session}: ${plural(shell, "command")} to read`)] : []),
      ...(quickWins > 0
        ? [
            fired(
              "WIN AT A SMALL WALL SHARE",
              `${session}: ${String(quickWins)} passed solves of tasks the reference harness failed, in few calls`,
            ),
          ]
        : []),
    ];
  });
}

/** Lanes 20 to 25: the comparison, which is the host's. */
function comparisonTriggers(log: Index): Trigger[] {
  const hosts = new Set([...log.conditions.values()].map((condition) => condition.host)).size;
  const perComparison = log.compared.flatMap(({ session, own, last, scoring }) => {
    // The rejections that set a task aside: not ruled a true fail, on a task the report names.
    const aside = new Set(strings(own.aside));
    const open = scoring.filter(
      (solve) =>
        solve.kind === "rejected" &&
        aside.has(solve.version) &&
        log.rulings.get(solve.id)?.ruling !== "earned",
    );
    const underOld = open.filter((solve) => solve.harness === own.old).length;
    const scored = asRecord(last.scored);
    const informative = count(scored?.wins) + count(scored?.losses);
    const tasks = informative + count(scored?.ties);
    const level = count(last.level);
    // The least clean sweep that clears the report's level, by the report's own test.
    const sweep = Array.from({ length: 64 }, (_, index) => index + 1).find((wins) => signP(wins, 0) <= level);
    // No result with a loss clears on this many informative pairs: the reading rests on a sweep.
    const fragile = signP(Math.max(0, informative - 1), 1) > level;
    const asked = last.tasks;
    const lacking = items(last.short).length;
    const against = asRecord(last.against);
    // The tasks a comparison scores are fixed at its start, before any solve. One that reported
    // other tasks than it began with lost them on the way: to a dispute, or short of their solves.
    const began = log.events.find(
      ({ kind, data }) => kind === "comparison.started" && data.session === session,
    )?.data;
    const fixed = strings(began?.tasks);
    const moved = fixed.filter((version) => !strings(last.versions).includes(version)).length;
    const seen = new Map<string, Set<string>>();
    for (const solve of scoring.filter((each) => each.outcome === "pass" || each.outcome === "fail")) {
      const key = `${solve.version} ${solve.harness}`;
      seen.set(key, (seen.get(key) ?? new Set()).add(text(solve.outcome)));
    }
    const flips = [...seen.values()].filter((outcomes) => outcomes.size > 1).length;
    const noise = asRecord(last.noise);
    return [
      ...(moved > 0
        ? [
            fired(
              "SCORED SET MOVED",
              `${session}: ${share(moved, fixed.length)} tasks it began with are not in its tally`,
            ),
          ]
        : []),
      ...(open.length > 0
        ? [
            fired(
              "SET ASIDE BY SIDE",
              `${session}: ${plural(open.length, "rejection")} set ${plural(aside.size, "task")} aside, ${String(underOld)} under the reference harness and ${String(open.length - underOld)} under the others`,
            ),
          ]
        : []),
      ...(scored !== null && tasks === 0
        ? [
            fired(
              "NOTHING SCORED",
              `${session}: no task was scored${isNumber(asked) ? `, of ${String(asked)} asked for` : ""}; the report reads ${text(last.reading)}`,
            ),
          ]
        : []),
      ...(last.capped === true
        ? [
            fired(
              "CUT BY ITS CAP",
              scored === null
                ? `${session}: the dollar cap ended it before it was read`
                : `${session}: the dollar cap ended the starter's solves; its test stands, unread against the starter`,
            ),
          ]
        : []),
      ...(scored !== null && tasks > 0 && level > 0 && fragile
        ? [
            fired(
              "FEW INFORMATIVE PAIRS",
              `${session}: ${share(informative, tasks)} tasks tell the harnesses apart; at level ${String(level)} the least sweep that clears is ${String(sweep ?? 0)}-0, and no result with a loss clears on ${plural(informative, "pair")}`,
            ),
          ]
        : []),
      ...(lacking > 0 ? [fired("SET SHORT", `${session}: ${String(lacking)} short of solves`)] : []),
      ...(against !== null && count(against.wins) < count(against.losses)
        ? [
            fired(
              "BELOW THE STARTER",
              `${session}: ${String(count(against.wins))} won and ${String(count(against.losses))} lost against the starter; the report reads ${text(last.reading)}`,
            ),
          ]
        : []),
      ...(last.reading === "starter-unread"
        ? [
            fired(
              "STARTER UNREAD",
              `${session}: its test clears its level and the starter has not its solves on every tallied task`,
            ),
          ]
        : []),
      ...(flips > 0
        ? [
            fired(
              "FLIPS",
              `${session}: ${share(flips, seen.size)} task and harness pairs both passed and failed`,
            ),
          ]
        : []),
      ...(noise === null
        ? []
        : [
            fired(
              "REFERENCE AGAINST ITSELF",
              `${session}: ${String(count(noise.wins))} won, ${String(count(noise.losses))} lost and ${String(count(noise.ties))} tied between two samples of the reference harness${Math.min(signP(count(noise.wins), count(noise.losses)), signP(count(noise.losses), count(noise.wins))) <= level ? ", which reads a step where none can be" : ""}`,
            ),
          ]),
    ];
  });
  const chain = log.compared.map(({ session, own, last, build }) => {
    const fresh = isString(last.fresh) ? short(last.fresh) : "none";
    // A report written before 2026-10-09 names no reference harness: it compared with its parent.
    return `${session} ${short(text(own.old) || (build?.parent ?? ""))}>${fresh} ${text(last.reading)}`;
  });
  // A step is repeated once on fresh solves before anything is promoted: a second comparison of
  // the same two harnesses.
  const sidesOf = ({ own, last }: Compared) => `${text(own.old)} ${text(last.fresh)}`;
  const steps = log.compared.filter(({ last }) => last.reading === "step");
  const unrepeated = steps.filter(
    (step) => !log.compared.some((other) => other !== step && sidesOf(other) === sidesOf(step)),
  ).length;
  return [
    ...(hosts > 1
      ? [fired("HOST CODE MOVED", `${String(hosts)} versions of the host's code in one log`)]
      : []),
    ...perComparison,
    ...(chain.length > 0 ? [fired("CHAIN", chain.join("; "))] : []),
    ...(unrepeated > 0
      ? [
          fired(
            "STEP NOT REPEATED",
            `${plural(unrepeated, "step")} no second comparison of the same two harnesses has repeated`,
          ),
        ]
      : []),
    ...(log.states.size > 0 && log.held.length === 0
      ? [fired("NO TASK HELD OUT", "no task is held out, so a comparison has nothing to score")]
      : []),
  ];
}

/** Lanes 26 to 28: the solve, its failure and the cost. */
function solveTriggers(log: Index): Trigger[] {
  const done = log.solves.filter((solve) => solve.outcome !== null);
  const missed = done.filter((solve) => solve.outcome === "fail");
  const walled = missed.filter(
    (solve) => solve.kind === "wall-ended" || solve.seconds > solve.wallSeconds * WALL_BOUND_SHARE,
  ).length;
  const wallShares = log.compared.flatMap(({ session, own, scoring }) => {
    // The median share of its wall a harness's solves used, or null for none under a wall. v1 read
    // this share as the measure that moves on every battery and leads a fail (lane 26).
    const under = (harness: JsonValue | undefined) =>
      median(
        scoring.flatMap((solve) =>
          solve.harness === harness && solve.wallSeconds > 0 ? [solve.seconds / solve.wallSeconds] : [],
        ),
      );
    const [before, after] = [under(own.old), under(own.fresh)];
    return before === null || after === null || own.old === own.fresh
      ? []
      : [
          fired(
            "WALL SHARE",
            `${session}: median ${percent(before)} under the reference harness, ${percent(after)} under the new`,
          ),
        ];
  });
  // The one-minute load each comparison's solves started under. A wall counts the clock, so the
  // same wall holds less work on a loaded host: a comparison made there reaches walls an idle host
  // would not, and two comparisons under different loads were not made under one budget, whatever
  // their settings say.
  const loads = log.compared.flatMap(({ session, scoring }) => {
    const at = scoring.flatMap((solve) => (solve.load === null ? [] : [solve.load]));
    const middle = median(at);
    const cores = scoring.findLast((solve) => solve.cores !== null)?.cores ?? null;
    return middle === null ? [] : [{ session, middle, most: Math.max(...at), cores }];
  });
  const loaded = loads.flatMap(({ session, middle, most, cores }) =>
    cores !== null && middle > cores
      ? [
          fired(
            "HOST LOADED",
            `${session}: load ${middle.toFixed(1)} at the median and ${most.toFixed(1)} at most when its solves started, on ${plural(cores, "core")}`,
          ),
        ]
      : [],
  );
  const middles = loads.map(({ middle }) => middle);
  const [calmest, busiest] = [Math.min(...middles), Math.max(...middles)];
  const moved = loads.length > 1 && busiest >= LOAD_WORTH_A_LINE && busiest >= calmest * LOAD_MOVED;
  const starved = done.filter(
    (solve) => solve.cpu !== null && solve.seconds > 60 && solve.cpu < solve.seconds * 0.02,
  );
  // A solve with a command cut before its CPU time was read has a floor for its CPU and no
  // reading. A comparison's report sums what was measured, so a budget or a spread in `cpu` is
  // read low on these solves.
  const cut = done.filter((solve) => solve.unmeasured > 0);
  const cutBy = log.compared.flatMap(({ session, scoring }) => {
    const mine = scoring.filter((solve) => solve.unmeasured > 0).length;
    return mine === 0 ? [] : [`${session}: ${share(mine, scoring.length)} of its solves`];
  });
  // An Examiner session writes its ending as a Builder's does; one with a start and no ending
  // was cut, or is still running.
  const examined = new Set(log.of(EXAM_END).map((data) => text(data.session)));
  const unended = log.of(EXAM_START).flatMap((data) => {
    const session = text(data.session);
    return examined.has(session) ? [] : [session];
  });
  const non = done.filter((solve) => solve.outcome === "non-result");
  const unjudged = countBy(
    missed.filter((solve) => solve.kind !== "rejected"),
    (solve) => solve.kind ?? "unkinded",
  );
  const ends = [...log.of(BUILD_END), ...log.of(EXAM_END)];
  const crashed = ends.filter((data) => isString(data.crash) || data.ended === "crashed");
  const times = log.events.map((event) => Date.parse(event.at));
  const gaps = times.flatMap((at, index) =>
    at - (times[index - 1] ?? at) > SILENCE_MINUTES * 60_000 ? [index] : [],
  );
  const spend = spendOf(log);
  // Non-results by harness in each comparison: a side whose bad solves are run again is favoured.
  const rerun = log.compared.flatMap(({ session, own, scoring }) => {
    const mine = scoring.filter((solve) => solve.outcome === "non-result");
    const under = mine.filter((solve) => solve.harness === own.old).length;
    return mine.length === 0
      ? []
      : [
          `${session}: ${String(under)} under the reference harness, ${String(mine.length - under)} under the others`,
        ];
  });
  const total = spend.reduce((sum, [, dollars]) => sum + dollars, 0);
  const [[leader, most] = ["", 0]] = spend;
  return [
    ...(walled > 0 ? [fired("WALL-BOUND MISSES", share(walled, missed.length))] : []),
    ...wallShares,
    ...loaded,
    ...(moved
      ? [
          fired(
            "LOAD MOVED",
            `median load when each comparison's solves started: ${loads.map(({ session, middle }) => `${session} ${middle.toFixed(1)}`).join("; ")}`,
          ),
        ]
      : []),
    ...(starved.length > 0 ? [fired("LONG SOLVE, LITTLE CPU", plural(starved.length, "solve"))] : []),
    ...(cut.length > 0
      ? [
          fired(
            "CPU UNMEASURED",
            [
              `${share(cut.length, done.length)} finished solves cut a command before its CPU time was read`,
              ...cutBy,
            ].join("; "),
          ),
        ]
      : []),
    ...(non.length > 0
      ? [
          fired(
            "NON-RESULTS",
            [
              `${share(non.length, done.length)}; ${tally(countBy(non, (solve) => solve.kind ?? "unkinded"))}`,
              ...rerun,
            ].join("; "),
          ),
        ]
      : []),
    ...(log.solves.length > done.length
      ? [fired("SOLVE NEVER FINISHED", plural(log.solves.length - done.length, "solve"))]
      : []),
    ...(unended.length > 0 ? [fired("EXAMINER NEVER FINISHED", unended.join(", "))] : []),
    ...(Object.keys(unjudged).length > 0 ? [fired("MISSES WITHOUT A VERDICT", tally(unjudged))] : []),
    ...(crashed.length > 0
      ? [fired("SESSION CRASHED", crashed.map((data) => text(data.session)).join(", "))]
      : []),
    ...(gaps.length > 0
      ? [
          fired(
            "SILENCE",
            `${plural(gaps.length, "gap")} over ${String(SILENCE_MINUTES)} minutes, the first before ${log.events[gaps[0] ?? 0]?.at ?? ""}`,
          ),
        ]
      : []),
    ...(total > 0 && leader !== "solver" && most > total / 2
      ? [fired("SPEND LED BY A ROLE", `${leader}: ${percent(most / total)} of metered dollars`)]
      : []),
  ];
}

/** Lanes 29 and 30: the review loop. */
function reviewTriggers(log: Index): Trigger[] {
  const diagnoses = [...log.diagnoses.values()];
  const abstained = diagnoses.filter((data) => isString(data.abstain)).length;
  const owners = countBy(
    diagnoses.filter((data) => isString(data.owner)),
    (data) => text(data.owner),
  );
  const moved = [...log.rulings].filter(([solve, data]) => {
    const replay = asRecord(data.replay);
    return replay !== null && replay.kind !== log.verdicts.get(solve)?.kind;
  }).length;
  const disputed = new Set(
    [...log.states].flatMap(([version, state]) => (state === "disputed" ? [version] : [])),
  );
  // The tasks a comparison set aside that no settling has decided since.
  const waiting = new Set(
    log.compared.flatMap(({ last }) => (asRecord(last.settled) === null ? strings(last.aside) : [])),
  );
  const standing = [...waiting].filter((version) => !disputed.has(version)).length;
  const ends = [...log.of(BUILD_END), ...log.of(EXAM_END), ...log.of(REPORTED)];
  const faults = ends.reduce((sum, data) => sum + items(data.reviewFaults).length, 0);
  const unprobed = [...log.rulings.values()].filter(
    (data) => data.ruling === "earned" && items(data.probes).length === 0 && count(data.turns) > 0,
  ).length;
  return [
    ...(diagnoses.length > 0
      ? [
          fired(
            "DIAGNOSES",
            `${String(diagnoses.length)}, ${String(abstained)} abstained; owners: ${tally(owners)}`,
          ),
        ]
      : []),
    ...(moved > 0 ? [fired("REPLAY MOVED THE VERDICT", plural(moved, "ruling"))] : []),
    ...(standing > 0
      ? [
          fired(
            "SET ASIDE AND UNSETTLED",
            `${plural(standing, "task")} left out of a comparison on a rejection no person has labelled`,
          ),
        ]
      : []),
    ...log.compared.flatMap(({ session, own, last }) => {
      // The tally were every rejection that set a task aside to stand, beside the one without them.
      const [counted, scored] = [asRecord(own.counted), asRecord(own.scored)];
      const level = count(own.level);
      const clears = (tested: JsonObject) => count(tested.p) <= level;
      const settled = asRecord(last.settled);
      return [
        ...(counted === null || scored === null || clears(counted) === clears(scored)
          ? []
          : [
              fired(
                "READING MOVES WITH THE SET-ASIDE",
                `${session}: ${String(count(scored.wins))}-${String(count(scored.losses))} without the ${plural(items(own.aside).length, "task")} set aside, ${String(count(counted.wins))}-${String(count(counted.losses))} were their rejections to stand, and only one of the two clears its level`,
              ),
            ]),
        ...(settled === null
          ? []
          : [
              fired(
                "SETTLED BY HAND",
                `${session}: ${plural(count(settled.labelled), "rejection")} labelled, ${String(count(settled.defects))} a check defect, ${plural(items(settled.disputed).length, "task")} disputed and ${String(items(settled.restored).length)} restored; the comparison's own report read ${text(own.reading)}, the settled one reads ${text(last.reading)}`,
              ),
            ]),
      ];
    }),
    ...(faults > 0 ? [fired("REVIEW FAULTS", plural(faults, "reviewer failure"))] : []),
    ...(unprobed > 0 ? [fired("EARNED WITHOUT A PROBE", share(unprobed, log.rulings.size))] : []),
  ];
}

/** Rows A to F: the identities every finding binds to. */
function rowsOf(log: Index): Row[] {
  const conditions = [...log.conditions.values()];
  const distinct = (pick: (condition: Condition) => string) => String(new Set(conditions.map(pick)).size);
  const frozen = log.of("contract.frozen").at(-1);
  const proposals = log.of("task.proposed");
  const having = (field: string) => String(proposals.filter((data) => isString(data[field])).length);
  const done = log.solves.filter((solve) => solve.outcome !== null);
  const partition = (side: string) =>
    tally(
      countBy(
        done.filter((solve) => solve.side === side),
        (solve) => `${solve.outcome ?? ""} ${solve.kind ?? ""}`.trim(),
      ),
    );
  const sessions = log.builds.map((build) => {
    const child = isString(build.finished?.harness) ? short(build.finished.harness) : "none";
    const ended = text(build.finished?.ended) || "never";
    return `${build.session}: ${short(build.parent)} > ${child}, ended ${ended}, ${String(count(build.finished?.practiceSolves))} practice solves, reading ${text(build.report?.reading) || "none"}`;
  });
  return [
    {
      id: "A",
      title: "campaign and log",
      lines: [
        `${plural(log.events.length, "event")}, ${log.events[0]?.at ?? ""} to ${log.events.at(-1)?.at ?? ""}`,
        `${plural(log.builds.length, "Builder session")}, ${plural(log.of(EXAM_START).length, "Examiner session")}, ${plural(log.of(REPORTED).length, "report")}`,
        `metered dollars: ${spendOf(log)
          .map(([role, dollars]) => `${role} ${dollars.toFixed(2)}`)
          .join(", ")}`,
      ],
    },
    {
      id: "B",
      title: "checker identity",
      lines: [
        frozen === undefined
          ? "not frozen"
          : `frozen: contract ${short(text(frozen.contract))}, check program ${short(text(frozen.checks))}`,
        `${plural(log.of("checker.read").length, "reading")}; contracts among conditions: ${distinct((condition) => condition.contract)}`,
      ],
    },
    {
      id: "C",
      title: "conditions",
      lines: [
        `${plural(conditions.length, "condition")}: ${tally(countBy(conditions, (condition) => `${condition.side} ${condition.model}`))}`,
        `host code ${distinct((condition) => condition.host)}, sandbox ${distinct((condition) => condition.sandbox)}, verifier tools ${distinct((condition) => condition.verifierTools)}, harnesses ${distinct((condition) => condition.harness)}`,
        `${share(done.filter((solve) => !solve.attested).length, done.length)} finished solves name no response model`,
      ],
    },
    {
      id: "D",
      title: "task sets",
      lines: [
        `${plural(proposals.length, "task")}: ${having("session")} written by a session, ${having("carried")} carried, the rest the pack's`,
        `states: ${tally(countBy([...log.states.values()], (state) => state))}`,
        `${plural(log.held.length, "task")} held out, for a comparison to score; ${String(log.released.length)} released for practice`,
      ],
    },
    {
      id: "E",
      title: "case partition",
      lines: [
        `test side: ${partition(TEST)}`,
        // A log written before 2026-10-09 holds solves of a stronger condition, which no comparison counts.
        ...(done.some((solve) => solve.side === "strong") ? [`strong side: ${partition("strong")}`] : []),
        `${plural(log.solves.length - done.length, "solve")} never finished`,
      ],
    },
    { id: "F", title: "sessions and the harness chain", lines: sessions },
  ];
}

/** The rows and the triggers of one log. */
export function overview(events: readonly LogEvent[]): Overview {
  const log = indexOf(events);
  return {
    rows: rowsOf(log),
    triggers: [
      ...instrumentTriggers(log),
      ...taskTriggers(log),
      ...harnessTriggers(log),
      ...comparisonTriggers(log),
      ...solveTriggers(log),
      ...reviewTriggers(log),
    ],
  };
}

/** The overview as the brief prints it: each row, then each trigger on a line of its own. */
export function rendered({ rows, triggers }: Overview): string {
  return [
    ...rows.flatMap((row) => [`${row.id}. ${row.title}`, ...row.lines.map((line) => `   ${line}`)]),
    "",
    ...triggers.map((trigger) => `${trigger.name} (lane ${String(trigger.lane)}): ${trigger.detail}`),
  ].join("\n");
}
