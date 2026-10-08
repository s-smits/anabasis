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
import { pairsReported, screeningOrder } from "#src/builder/round.ts";
import { binding, toldOf } from "#src/kernel/binding.ts";
import { signP, sweepOf } from "#src/kernel/compare.ts";
import { type Condition, conditionsOf, settingId } from "#src/kernel/condition.ts";
import { frontierOf, ladder, lastReports, type Stand } from "#src/kernel/ladder.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { taskStates } from "#src/kernel/task.ts";
import { wallShare } from "#src/kernel/wall.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { weight, weightLine } from "#src/review/weight.ts";

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
  readonly wallSeconds: number;
  outcome: string | null;
  kind: string | null;
  seconds: number;
  cpu: number | null;
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

/** A round's test-side solves, apart by what each was for. */
interface Round {
  readonly practice: readonly Solve[];
  readonly screening: readonly Solve[];
  readonly scoring: readonly Solve[];
  readonly counted: readonly Solve[];
  /** Scored versions this round did not admit itself. */
  readonly carried: readonly string[];
  readonly scoredSet: ReadonlySet<string>;
  /** The versions this round admitted. */
  readonly admitted: ReadonlySet<string>;
  /** The parent's solves the log held before the round, which its screening read of the tasks it
   *  placed: the latest so many of each, under the round's own setting. */
  readonly onRecord: readonly Solve[];
  /** Versions admitted on those solves alone, with no screening solve of the round. */
  readonly kept: readonly string[];
  /** Versions the round retired: both of its harnesses passed them. */
  readonly retired: readonly string[];
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
  readonly anchor: ReadonlySet<string>;
  /** Feasible task versions still held outside the anchor, never yet admitted. */
  readonly candidates: readonly string[];
  /** The live pool: those, and the versions a round admitted. Every round screens it again. */
  readonly pool: readonly string[];
  readonly of: (kind: LogEvent["kind"]) => JsonObject[];
}

/** The share of a wall past which a miss is read as bound by it, as v1's climb read it. */
const WALL_BOUND_SHARE = 0.95;
/** A pass under this share of its wall, on few calls, is the lead v1 read for a published recipe. */
const SMALL_WALL_SHARE = 0.05;
const FEW_CALLS = 3;
/** Minutes of silence in the log worth a line. */
const SILENCE_MINUTES = 20;
/** The condition's fields a pair may not differ in: every one but the harness and the task. */
/** The solves a harness screening reads where a report names none: the plan's three. */
const SCREENING_SOLVES = 3;
const PAIRED = ["contract", "model", "effort", "compaction", "verifierTools", "sandbox", "host"] as const;
const DEFECT = "check-defect";
const TOO_HARD = "too hard";
const TEST = "test";
const BUILD_END = "build.finished";
const EXAM_END = "exam.finished";
const EXAM_START = "exam.started";

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
  "TOO HARD": 8,
  "TOO HARD FLAGGED": 8,
  "WITNESSED ON A LATER TRY": 8,
  "WITNESS PAST HALF ITS WALL": 8,
  "CONTROLS REFUSED": 9,
  "CONTROLS NOT ON RECORD": 9,
  "TOO EASY": 10,
  "WALL-BOUND TASKS": 10,
  "RETIRED BY A ROUND": 10,
  "PASSES AT A SMALL WALL SHARE": 11,
  "BRACKETED BY SESSION": 12,
  "EXAMINER BEHIND THE FRONTIER": 12,
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
  "PAIR DIFFERS BEYOND HARNESS": 20,
  "SCORED SET CARRIED": 21,
  "ADMITTED BY": 21,
  "PARENT SIDE ON RECORD": 21,
  "SCREENING RULE NOT ON RECORD": 21,
  "SCREENED OUT OF THE DRAWN ORDER": 21,
  "ADMITTED ON FLAGGED FAILS": 21,
  "NOTHING SCORED": 22,
  "FEW INFORMATIVE PAIRS": 22,
  "SET SHORT": 22,
  "ANCHOR NOT HELD": 23,
  "ANCHOR RATE BY ROUND": 23,
  "FLIPS": 24,
  "HOST CODE MOVED": 20,
  "CHAIN": 25,
  "STEP NOT BUILT ON": 25,
  "NO CANDIDATES HELD": 25,
  "WHAT BINDS": 25,
  "WALL SHARE": 26,
  "WALL-BOUND MISSES": 26,
  "LONG SOLVE, LITTLE CPU": 26,
  "NON-RESULTS": 27,
  "SOLVE NEVER FINISHED": 27,
  "MISSES WITHOUT A VERDICT": 27,
  "SESSION CRASHED": 27,
  "SILENCE": 28,
  "SPEND LED BY A ROLE": 28,
  "DIAGNOSES": 29,
  "REPLAY MOVED THE VERDICT": 29,
  "FLAGGED AND STILL COUNTED": 30,
  "READING MOVES WITHOUT FLAGGED": 30,
  "FLAGGED FAILS BY SIDE": 30,
  "RULINGS AGAINST THE EFFECT": 30,
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
      solves.set(id, {
        id,
        index,
        version: condition?.task ?? "",
        harness: condition?.harness ?? "",
        condition: text(data.condition),
        side: condition?.side ?? "",
        wallSeconds: count(asRecord(data.limits)?.wallSeconds),
        outcome: null,
        kind: null,
        seconds: 0,
        cpu: null,
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
      const cpu = asRecord(data.cpu)?.seconds;
      solve.outcome = text(ending?.outcome);
      solve.kind = isString(ending?.kind) ? ending.kind : null;
      solve.seconds = count(data.seconds);
      solve.cpu = isNumber(cpu) ? cpu : null;
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
    if (build !== undefined && kind === "comparison.reported") {
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
  const states = taskStates(events);
  const anchor = new Set(of("anchor.drawn").flatMap((data) => strings(data.tasks)));
  const feasible = of("task.gate").flatMap((data) =>
    data.gate === 4 && data.outcome === "passed" ? [text(data.version)] : [],
  );
  return {
    events,
    conditions,
    solves: solvesOf(events, conditions),
    verdicts: last("verdict"),
    rulings: last("referee.finding"),
    diagnoses: last("diagnosis.recorded"),
    states,
    builds: buildsOf(events),
    anchor,
    candidates: feasible.filter((version) => states.get(version) === "held" && !anchor.has(version)),
    pool: feasible.filter(
      (version) => ["held", "admitted"].includes(states.get(version) ?? "") && !anchor.has(version),
    ),
    of,
  };
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

/** A round's solves on the test side. A scored task's solves count from its admission on
 *  (`src/builder/round.ts`), so the ones before it screened the task. */
function roundOf(log: Index, build: Build): Round {
  const window = log.solves.filter(
    (solve) => solve.index > build.from && solve.index < build.until && solve.side === TEST,
  );
  const scoredSet = new Set(strings(build.report?.versions));
  const admittedAt = new Map(
    log.events.flatMap(({ kind, data }, index) =>
      kind === "task.state" && data.state === "admitted" && data.session === build.session
        ? [[text(data.version), index] as const]
        : [],
    ),
  );
  const after = (solve: Solve) => solve.index > (admittedAt.get(solve.version) ?? -1);
  const scoring = window.filter((solve) => scoredSet.has(solve.version) && after(solve));
  // What the round placed, and the parent's solves the log already held of those tasks. A round
  // reads the latest so many of them under its own setting before it solves the parent again
  // (`src/builder/round.ts`), so they are screening evidence made outside its window.
  const moved = log.events.flatMap(({ kind, data }) =>
    kind === "task.state" && data.session === build.session ? [data] : [],
  );
  const placed = new Set(moved.map((data) => text(data.version)));
  const own = log.conditions.get(window[0]?.condition ?? "");
  const alike = (solve: Solve) => {
    const ran = log.conditions.get(solve.condition);
    return own !== undefined && ran !== undefined && settingId(ran) === settingId(own);
  };
  const earlier = log.solves.filter(
    (solve) =>
      solve.index < build.from &&
      solve.side === TEST &&
      solve.harness === build.parent &&
      placed.has(solve.version) &&
      (solve.outcome === "pass" || (solve.outcome === "fail" && solve.kind !== "broken-harness")) &&
      alike(solve),
  );
  const read = count(asRecord(build.report?.screening)?.solves) || SCREENING_SOLVES;
  return {
    practice: window.filter((solve) => build.practice.has(solve.version)),
    screening: window.filter((solve) => admittedAt.has(solve.version) && !after(solve)),
    scoring,
    counted: [...scoring, ...window.filter((solve) => log.anchor.has(solve.version))],
    carried: [...scoredSet].filter((version) => !admittedAt.has(version)),
    scoredSet,
    admitted: new Set(admittedAt.keys()),
    onRecord: [...Map.groupBy(earlier, (solve) => solve.version).values()].flatMap((solves) =>
      solves.slice(-read),
    ),
    kept: moved.flatMap((data) =>
      data.state === "admitted" && data.carried === true ? [text(data.version)] : [],
    ),
    retired: moved.flatMap((data) => (data.state === "too-easy" ? [text(data.version)] : [])),
  };
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
  const gates = log.of("task.gate").filter((data) => written.has(text(data.version)));
  const at = (gate: number, outcome: string) =>
    gates.filter((data) => data.gate === gate && data.outcome === outcome);
  const feasible = at(4, "passed").length;
  const refusedAt = countBy(
    gates.filter((data) => data.outcome === "refused"),
    (data) => `gate ${String(count(data.gate))}`,
  );
  // A task no stronger solve passed waits, and is put to the stronger solver again when the
  // harness has moved: it is read by its last such solve, and every failed one is a try.
  const witness = new Map(gates.flatMap((data) => (data.gate === 2 ? [[text(data.version), data]] : [])));
  const hard = [...witness.values()].filter((data) => data.outcome === "too-hard");
  const tried = at(2, "too-hard");
  const everHard = new Set(tried.map((data) => text(data.version)));
  const lifted = [...everHard].filter((version) => witness.get(version)?.outcome === "passed").length;
  const hardKinds = countBy(hard, (data) => text(data.kind) || "unrecorded");
  const told = [...toldOf(log.events).values()];
  const flagged = told.filter((task) => task.word === TOO_HARD && task.flagged).length;
  const witnesses = new Set(at(2, "passed").map((data) => text(data.solve)));
  const slow = log.solves.filter((solve) => witnesses.has(solve.id) && solve.seconds > solve.wallSeconds / 2);
  const controlKinds = countBy(
    at(4, "refused").flatMap((data) =>
      strings(data.kinds).length > 0 ? strings(data.kinds) : ["unrecorded"],
    ),
    (kind) => kind,
  );
  const bare = at(4, "passed").filter((data) => !Array.isArray(data.set)).length;
  const words = countBy(told, (task) => task.word);
  const [easy, bound] = [words["too easy"] ?? 0, words["wall-bound"] ?? 0];
  const screened = easy + bound + (words.scored ?? 0);
  const passed = log.solves.filter((solve) => solve.side === TEST && solve.outcome === "pass");
  const quick = passed.filter((solve) => solve.seconds < solve.wallSeconds * SMALL_WALL_SHARE);
  const sequences = new Set(quick.map((solve) => solve.calls.join(">"))).size;
  // A session's solves run under the harness the campaign stands on. One that stood elsewhere
  // wrote against a solver the campaign has left behind.
  const behind = log.events.flatMap(({ kind, data }, index) => {
    const stood = frontierOf(log.events.slice(0, index));
    if (kind !== EXAM_START || stood === null || data.standsOn === stood) return [];
    return [
      `${text(data.session)} stood on ${isString(data.standsOn) ? short(data.standsOn) : "no named harness"}, and the last step had left ${short(stood)}`,
    ];
  });
  // Tasks a round's two harnesses both passed, and how many of them an earlier round had scored.
  const scoredBefore = new Set<string>();
  const retired = log.builds.flatMap((build) => {
    const round = roundOf(log, build);
    const once = round.retired.filter((version) => scoredBefore.has(version)).length;
    for (const version of round.admitted) scoredBefore.add(version);
    return round.retired.length === 0
      ? []
      : [
          `${build.session}: ${String(round.retired.length)}, ${String(once)} of them admitted by an earlier round`,
        ];
  });
  // A session's words cover the tasks it proposed and the reach tasks it put to the stronger
  // solver again, which it did not propose: both are what its scored words are a share of. Over
  // its proposals alone, a simulated session that wrote two tasks and tried two again read
  // "4 of 2" (2026-10-08).
  const triedAgain = new Map(
    log.of(EXAM_START).map((data) => {
      const [listed, most] = [items(data.reach).length, asRecord(data.limits)?.candidates];
      return [text(data.session), isNumber(most) ? Math.min(listed, most) : listed];
    }),
  );
  const bracketed = log.of(EXAM_END).map((data) => {
    const scored = Object.values(asRecord(data.words) ?? {}).filter((word) => word === "scored").length;
    const put = count(data.proposed) + (triedAgain.get(text(data.session)) ?? 0);
    return `${text(data.session)} ${share(scored, put)}`;
  });
  return [
    ...(proposed.length > 0 && feasible * 2 < proposed.length
      ? [fired("SUPPLY THIN", `${share(feasible, proposed.length)} proposed tasks passed gate 4`)]
      : []),
    ...(Object.keys(refusedAt).length > 0 ? [fired("GATE REFUSED", tally(refusedAt))] : []),
    ...(hard.length > 0
      ? [
          fired(
            "TOO HARD",
            `${share(hard.length, proposed.length)}; ended: ${tally(hardKinds)}${tried.length > everHard.size ? `; ${plural(tried.length - everHard.size, "later try")} failed again` : ""}`,
          ),
        ]
      : []),
    ...(lifted > 0
      ? [
          fired(
            "WITNESSED ON A LATER TRY",
            `${share(lifted, everHard.size)} tasks a stronger solve had failed were passed when tried again`,
          ),
        ]
      : []),
    ...(flagged > 0
      ? [fired("TOO HARD FLAGGED", `${plural(flagged, "task")} closed on a refusal ruled a check defect`)]
      : []),
    ...(slow.length > 0 ? [fired("WITNESS PAST HALF ITS WALL", share(slow.length, witnesses.size))] : []),
    ...(Object.keys(controlKinds).length > 0 ? [fired("CONTROLS REFUSED", tally(controlKinds))] : []),
    ...(bare > 0
      ? [fired("CONTROLS NOT ON RECORD", `${plural(bare, "task")} passed gate 4 with a digest alone`)]
      : []),
    ...(easy > 0 ? [fired("TOO EASY", share(easy, screened))] : []),
    ...(bound > 0 ? [fired("WALL-BOUND TASKS", share(bound, screened))] : []),
    ...(passed.length > 0 && quick.length * 2 > passed.length
      ? [
          fired(
            "PASSES AT A SMALL WALL SHARE",
            `${share(quick.length, passed.length)} test-side passes, in ${plural(sequences, "call sequence")}`,
          ),
        ]
      : []),
    ...(bracketed.length > 0 ? [fired("BRACKETED BY SESSION", bracketed.join("; "))] : []),
    ...(behind.length > 0 ? [fired("EXAMINER BEHIND THE FRONTIER", behind.join("; "))] : []),
    ...(retired.length > 0 ? [fired("RETIRED BY A ROUND", retired.join("; "))] : []),
  ];
}

/**
 * Where the campaign stands and what binds its climb, as `tools/d2/prepare.ts` prints them, or
 * null for a log with no test-side solve to name a setting. The harness is the last step's, or the
 * first session's parent while no round has stepped; the setting is the latest test-side solve's;
 * the rule and the level are the last report's, or the plan's.
 */
function climbOf(log: Index) {
  const latest = log.solves.findLast((solve) => solve.side === TEST);
  const ran = log.conditions.get(latest?.condition ?? "");
  const first = log.builds[0]?.parent ?? log.solves.find((solve) => solve.side === TEST)?.harness;
  const harness = frontierOf(log.events) ?? first;
  if (ran === undefined || harness === undefined) return null;
  const stand: Stand = { harness, setting: settingId(ran) };
  const report = log.builds.findLast((build) => build.report !== null)?.report;
  const asked = asRecord(report?.screening) ?? asRecord(log.of(EXAM_START).at(-1)?.screening);
  const rule = { solves: count(asked?.solves) || SCREENING_SOLVES, fails: count(asked?.fails) || 2 };
  return {
    stand,
    placed: ladder(log.events, stand, rule),
    short: binding(log.events, stand, {
      rule,
      least: sweepOf(count(report?.level) || 0.1),
      limits: ran.limits,
    }),
  };
}

/** Lanes 13 to 19: the harness, which is the Builder's. */
function harnessTriggers(log: Index): Trigger[] {
  return log.builds.flatMap((build) => {
    const { session, finished, parent, calls } = build;
    const round = roundOf(log, build);
    const changed = finished?.changed === true;
    const child = text(finished?.harness);
    const written = [
      ...new Set(calls.flatMap(({ tool, args }) => (tool === "write_file" ? [text(args?.path)] : []))),
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
    const exposed = [...round.scoredSet, ...log.anchor].filter((version) =>
      build.practice.has(version),
    ).length;
    const shell = calls.filter(({ tool }) => tool === "bash").length;
    const lostBefore = new Set(
      round.scoring
        .filter((solve) => solve.harness === parent && solve.outcome === "fail")
        .map((solve) => solve.version),
    );
    const quickWins = round.scoring.filter(
      (solve) =>
        solve.harness !== parent &&
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
              `${session}: ${short(parent)} to ${short(child)}; written by write_file: ${written.join(", ") || "nothing"}`,
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
              `${session}: ${String(quickWins)} passed solves of tasks the parent failed, in few calls`,
            ),
          ]
        : []),
    ];
  });
}

/** Lanes 20 to 25: the comparison, which is the host's. */
function comparisonTriggers(log: Index): Trigger[] {
  const hosts = new Set([...log.conditions.values()].map((condition) => condition.host)).size;
  const reported = log.builds.filter((build) => build.report !== null);
  const perRound = reported.flatMap((build) => {
    const { session, parent } = build;
    const round = roundOf(log, build);
    // The fields, beyond the harness, in which the round's counted solves differ among themselves.
    const ran = round.counted.flatMap((solve) => log.conditions.get(solve.condition) ?? []);
    const moved = PAIRED.filter((field) => ran.some((condition) => condition[field] !== ran[0]?.[field]));
    // The screening evidence of an admitted task: the round's own solves before its admission,
    // and the parent's the log already held, which the round read in place of solving again.
    const reused = round.onRecord.filter((solve) => round.admitted.has(solve.version));
    const failedUnder = (old: boolean) =>
      new Set(
        [...reused, ...round.screening].flatMap((solve) =>
          (solve.harness === parent) === old && solve.outcome === "fail" ? [solve.version] : [],
        ),
      );
    const [byOld, byNew] = [failedUnder(true), failedUnder(false)];
    // The order a round screens in is drawn from the contract's hash and the session's id, so it
    // replays from the log: the tasks that were screened should be the first so many of the draw
    // over the tasks then held outside the anchor.
    const then = taskStates(log.events.slice(0, build.from));
    const feasibleThen = log.events.flatMap(({ kind, data }, index) =>
      index < build.from && kind === "task.gate" && data.gate === 4 && data.outcome === "passed"
        ? [text(data.version)]
        : [],
    );
    // The pool as the round found it: held or admitted, outside the anchor.
    const heldThen = feasibleThen.filter(
      (version) => ["held", "admitted"].includes(then.get(version) ?? "") && !log.anchor.has(version),
    );
    const window = log.solves.filter(
      (solve) => solve.index > build.from && solve.index < build.until && solve.side === TEST,
    );
    const placed = new Set([...round.admitted, ...round.retired]);
    const screenedThen = heldThen.filter(
      (version) => placed.has(version) || window.some((solve) => solve.version === version),
    );
    const contract = log.conditions.get(window[0]?.condition ?? "")?.contract ?? "";
    const drawn = new Set(screeningOrder(heldThen, contract, session).slice(0, screenedThen.length));
    const outOfOrder = screenedThen.filter((version) => !drawn.has(version)).length;
    const defect = (solve: Solve) => log.rulings.get(solve.id)?.ruling === DEFECT;
    // Admitted tasks whose screening fails were every one ruled a check's fault: chosen by the exam.
    const screened = Map.groupBy(
      round.screening.filter((solve) => solve.outcome === "fail"),
      (solve) => solve.version,
    );
    const onFlags = [...screened.values()].filter((fails) => fails.every(defect)).length;
    // A task disputed since, by the Referee or by a person's label, is in no comparison.
    const countedDefects = round.counted.filter(
      (solve) => solve.outcome === "fail" && defect(solve) && log.states.get(solve.version) !== "disputed",
    );
    const underOld = countedDefects.filter((solve) => solve.harness === parent).length;
    const both = [...byOld].filter((version) => byNew.has(version)).length;
    const scored = asRecord(build.report?.scored);
    const informative = count(scored?.wins) + count(scored?.losses);
    const tasks = informative + count(scored?.ties);
    const level = count(build.report?.level);
    // The least clean sweep that clears the report's level, by the report's own test.
    const sweep = Array.from({ length: 64 }, (_, index) => index + 1).find((wins) => signP(wins, 0) <= level);
    // No result with a loss clears on this many informative pairs: the reading rests on a sweep.
    const fragile = signP(Math.max(0, informative - 1), 1) > level;
    const target = build.report?.target;
    const [lacking, unscreened] = [items(build.report?.short).length, items(build.report?.unscreened).length];
    const anchor = asRecord(build.report?.anchor);
    const seen = new Map<string, Set<string>>();
    for (const solve of round.counted.filter((each) => each.outcome === "pass" || each.outcome === "fail")) {
      const key = `${solve.version} ${solve.harness}`;
      seen.set(key, (seen.get(key) ?? new Set()).add(text(solve.outcome)));
    }
    const flips = [...seen.values()].filter((outcomes) => outcomes.size > 1).length;
    return [
      ...(moved.length > 0 ? [fired("PAIR DIFFERS BEYOND HARNESS", `${session}: ${moved.join(", ")}`)] : []),
      ...(round.carried.length > 0
        ? [
            fired(
              "SCORED SET CARRIED",
              `${session}: ${share(round.carried.length, round.scoredSet.size)} scored tasks were admitted outside this round`,
            ),
          ]
        : []),
      ...(round.screening.length > 0 || round.kept.length > 0
        ? [
            fired(
              "ADMITTED BY",
              `${session}: the parent's fails ${String(byOld.size - both)}, the child's ${String(byNew.size - both)}, both ${String(both)}; ${String(screenedThen.length)} of ${plural(heldThen.length, "candidate")} screened${outOfOrder === 0 ? ", the first of the draw" : ""}`,
            ),
          ]
        : []),
      ...(round.onRecord.length > 0
        ? [
            fired(
              "PARENT SIDE ON RECORD",
              `${session}: ${plural(round.onRecord.length, "solve")} of the parent on ${plural(new Set(round.onRecord.map((solve) => solve.version)).size, "task")} were made before the round and read by its screening; ${String(round.kept.length)} admitted on them with no screening solve of the round, ${String(round.retired.length)} retired`,
            ),
          ]
        : []),
      ...(onFlags > 0
        ? [
            fired(
              "ADMITTED ON FLAGGED FAILS",
              `${session}: ${share(onFlags, screened.size)} tasks were admitted on fails all ruled a check defect`,
            ),
          ]
        : []),
      ...(countedDefects.length > 0
        ? [
            fired(
              "FLAGGED FAILS BY SIDE",
              `${session}: ${plural(countedDefects.length, "counted fail")} ruled a check defect, ${String(underOld)} under the parent and ${String(countedDefects.length - underOld)} under the child`,
            ),
          ]
        : []),
      ...(outOfOrder > 0
        ? [
            fired(
              "SCREENED OUT OF THE DRAWN ORDER",
              `${session}: ${share(outOfOrder, screenedThen.length)} screened tasks are not among the first ${String(screenedThen.length)} of the draw over ${plural(heldThen.length, "candidate")}`,
            ),
          ]
        : []),
      ...(round.screening.length > 0 && asRecord(build.report?.screening) === null
        ? [
            fired(
              "SCREENING RULE NOT ON RECORD",
              `${session}: ${plural(round.screening.length, "screening solve")}, and the report names neither how many a harness nor how many fails admit`,
            ),
          ]
        : []),
      ...(scored !== null && tasks === 0
        ? [
            fired(
              "NOTHING SCORED",
              `${session}: no task was scored${isNumber(target) ? `, at a target of ${String(target)}` : ""}; the report reads ${text(build.report?.reading)}`,
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
      ...(lacking + unscreened > 0
        ? [
            fired(
              "SET SHORT",
              `${session}: ${String(lacking)} short of solves, ${String(unscreened)} unscreened`,
            ),
          ]
        : []),
      ...(anchor !== null && anchor.reading !== "held"
        ? [
            fired(
              "ANCHOR NOT HELD",
              `${session}: ${text(anchor.reading)}, ${String(count(anchor.informative))} informative`,
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
    ];
  });
  // One harness on the anchor in more than one round: the same bytes on the same tasks, measured again.
  const anchorRates = new Map<string, string[]>();
  for (const build of reported) {
    const solved = roundOf(log, build).counted.filter((solve) => log.anchor.has(solve.version));
    for (const [harness, some] of Map.groupBy(solved, (solve) => solve.harness)) {
      const passed = some.filter((solve) => solve.outcome === "pass").length;
      anchorRates.set(harness, [
        ...(anchorRates.get(harness) ?? []),
        `${share(passed, some.length)} in ${build.session}`,
      ]);
    }
  }
  const again = [...anchorRates].filter(([, rounds]) => rounds.length > 1);
  const chain = reported.map((build) => {
    const fresh = isString(build.report?.fresh) ? short(build.report.fresh) : "none";
    return `${build.session} ${short(build.parent)}>${fresh} ${text(build.report?.reading)}`;
  });
  const climb = climbOf(log);
  const parents = new Set(log.builds.map((build) => build.parent));
  const steps = reported.filter((build) => build.report?.reading === "step" && build !== log.builds.at(-1));
  const unbuilt = steps.filter((build) => !parents.has(text(build.report?.fresh))).length;
  return [
    ...(hosts > 1
      ? [fired("HOST CODE MOVED", `${String(hosts)} versions of the host's code in one log`)]
      : []),
    ...perRound,
    ...(chain.length > 0 ? [fired("CHAIN", chain.join("; "))] : []),
    ...(unbuilt > 0
      ? [fired("STEP NOT BUILT ON", `${plural(unbuilt, "step")} no later session started from`)]
      : []),
    ...(again.length > 0
      ? [
          fired(
            "ANCHOR RATE BY ROUND",
            again.map(([harness, rounds]) => `${short(harness)}: ${rounds.join(", ")}`).join("; "),
          ),
        ]
      : []),
    ...(log.anchor.size > 0 && log.pool.length === 0
      ? [
          fired(
            "NO CANDIDATES HELD",
            "the pool is empty: no feasible task is held or admitted outside the anchor, so a round has nothing to screen and scores nothing",
          ),
        ]
      : []),
    ...(climb === null ? [] : [fired("WHAT BINDS", `${climb.short.binds}: ${climb.short.why}`)]),
  ];
}

/** Lanes 26 to 28: the solve, its failure and the cost. */
function solveTriggers(log: Index): Trigger[] {
  const done = log.solves.filter((solve) => solve.outcome !== null);
  const missed = done.filter((solve) => solve.outcome === "fail");
  const walled = missed.filter(
    (solve) => solve.kind === "wall-ended" || solve.seconds > solve.wallSeconds * WALL_BOUND_SHARE,
  ).length;
  const wallShares = log.builds.flatMap((build) => {
    const { scoring } = roundOf(log, build);
    const under = (old: boolean) =>
      wallShare(scoring.filter((solve) => (solve.harness === build.parent) === old));
    const [before, after] = [under(true), under(false)];
    return before === null || after === null
      ? []
      : [
          fired(
            "WALL SHARE",
            `${build.session}: median ${percent(before)} under the parent, ${percent(after)} under the child`,
          ),
        ];
  });
  const starved = done.filter(
    (solve) => solve.cpu !== null && solve.seconds > 60 && solve.cpu < solve.seconds * 0.02,
  );
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
  // Non-results by harness in each round: a side whose bad solves are run again is favoured.
  const rerun = log.builds.flatMap((build) => {
    const window = non.filter((solve) => solve.index > build.from && solve.index < build.until);
    const under = window.filter((solve) => solve.harness === build.parent).length;
    return window.length === 0
      ? []
      : [
          `${build.session}: ${String(under)} under the parent, ${String(window.length - under)} under the session's states`,
        ];
  });
  const total = spend.reduce((sum, [, dollars]) => sum + dollars, 0);
  const [[leader, most] = ["", 0]] = spend;
  return [
    ...(walled > 0 ? [fired("WALL-BOUND MISSES", share(walled, missed.length))] : []),
    ...wallShares,
    ...(starved.length > 0 ? [fired("LONG SOLVE, LITTLE CPU", plural(starved.length, "solve"))] : []),
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
  const flagged = new Set(log.builds.flatMap((build) => strings(build.report?.flagged)));
  const standing = [...flagged].filter((version) => !disputed.has(version)).length;
  const ends = [...log.of(BUILD_END), ...log.of(EXAM_END), ...log.of("comparison.reported")];
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
            "FLAGGED AND STILL COUNTED",
            `${plural(standing, "task")} with a fail ruled a check defect stayed in a comparison`,
          ),
        ]
      : []),
    ...log.builds.flatMap((build) => {
      // A report written before the round named the counted reading holds it as its reading.
      const own = build.own;
      const second = asRecord(own?.unflagged);
      const counted = text(own?.counted) || text(own?.reading);
      const settled = asRecord(build.report?.settled);
      return [
        ...(second === null || second.reading === counted
          ? []
          : [
              fired(
                "READING MOVES WITHOUT FLAGGED",
                `${build.session}: ${counted} with ${plural(items(own?.flagged).length, "flagged task")} counted, ${text(second.reading)} without${own?.reading === "flags-decide" ? "; the round claims neither" : ""}`,
              ),
            ]),
        ...(settled === null
          ? []
          : [
              fired(
                "SETTLED BY HAND",
                `${build.session}: ${plural(count(settled.labelled), "fail")} labelled, ${String(count(settled.defects))} a check defect, ${plural(items(settled.disputed).length, "task")} disputed; the round's own report read ${text(own?.reading)}, the settled one reads ${text(build.report?.reading)}`,
              ),
            ]),
      ];
    }),
    // What each report's scored test rests on, set against the Referee's error. A log holds no
    // hand label, so read from here that error is unmeasured (`src/review/weight.ts`).
    ...lastReports(log.events).flatMap((report) => {
      try {
        const read = weight(log.events, pairsReported(log.events, report), {
          level: count(report.data.level),
          measured: null,
        });
        return read.informative === 0
          ? []
          : [fired("RULINGS AGAINST THE EFFECT", `${report.session}: ${weightLine(read)}`)];
      } catch {
        // A round whose solves differ in more than the harness has no pairs to read, and lane 20
        // names it.
        return [];
      }
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
  const climb = climbOf(log);
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
        `${plural(log.builds.length, "Builder session")}, ${plural(log.of(EXAM_START).length, "Examiner session")}, ${plural(log.of("comparison.reported").length, "report")}`,
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
        `states: ${tally(countBy([...log.states.values()], (state) => state))}; anchor ${String(log.anchor.size)}`,
        `${plural(log.candidates.length, "feasible task")} held outside the anchor, for a round to screen`,
        ...(climb === null
          ? []
          : [
              `against ${short(climb.stand.harness)}, where the campaign stands: ${String(climb.placed.pool.stops.length)} of the pool stop it, ${String(climb.placed.pool.clears.length)} it clears, ${String(climb.placed.pool.walled.length)} ended at the wall, ${String(climb.placed.pool.unknown.length)} no solve has placed; ${String(climb.placed.reach.length)} wait for a witness`,
            ]),
      ],
    },
    {
      id: "E",
      title: "case partition",
      lines: [
        `test side: ${partition(TEST)}`,
        `strong side: ${partition("strong")}`,
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
