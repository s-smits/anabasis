/**
 * What every lane of a whole-run investigation starts from: the folds of one campaign's log, the
 * catalogue of triggers, and the lanes of the exam side.
 *
 * The folds (`indexOf`) read the log once into what the lanes ask of it: each solve with what it
 * ran under and how it ended, each Builder session with the window of the log that is its round,
 * each comparison with the solves it could count, and the last verdict and ruling of each solve.
 * A solve reached its turn bound where its end records as many turns as its start allowed.
 * `TRIGGERS` names only the triggers a live reader can print and the lane each starts, and
 * `fired` makes one. Lanes 1 to 4 read the exam's instrument, which is the pack author's, and
 * lanes 7 to 11 the tasks, which are the Examiner's and the pack's; both sit here, below the
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
import { flipP, unsolved as noneAnswered } from "#src/kernel/compare.ts";
import { lastReports, poolOf, pairsReported, referenceOf } from "#src/kernel/reports.ts";
import { SEATS, type Traced, traced, traceKind, tracesIn } from "#src/kernel/trace.ts";
import { spendOf } from "#src/kernel/meter.ts";
import { type Judged, solvesIn, verdictsOf } from "#src/kernel/solves.ts";
import { heldAtGate, taskSets } from "#src/kernel/task.ts";
import { blockingOf, OBJECTIVE } from "#src/kernel/verify.ts";
import type { Handover } from "#src/campaign/handover.ts";
import { short } from "#src/campaign/move.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { runtimeProcess } from "#src/meta/process.ts";
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
  /** Who cancelled a killed solve (`CancellationOrigin`, `src/kernel/solve.ts`), or null. */
  readonly cancelledBy: string | null;
  readonly seconds: number;
  readonly calls: string[];
  /** The program each of its `bash` calls ran first, past `cd` and assignments: a harness's
   *  `.toolchain/bin` programs are reached on the shell's path, so they show only here. */
  readonly programs: string[];
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
/** What a reader of no seat's words reads a large log without. */
export const NO_TRACES: ReadonlySet<LogEvent["kind"]> = new Set(
  SEATS.flatMap((seat) => [traceKind(seat, "call"), traceKind(seat, "turn")]),
);
const DEFECT = "check-defect";
export const TEST = "test";
export const BUILD_END = "build.finished";
export const EXAM_START = "exam.started";
export const EXAM_END = "exam.finished";
export const REPORTED = "comparison.reported";
/** Words that open a shell segment and run nothing themselves. */
const SHELL_WORDS = new Set(["if", "then", "elif", "else", "fi", "while", "until", "do", "done", "esac"]);
/** Words whose segment names no program: `cd` runs no harness's program, and a `for` or `case` head none. */
const NO_PROGRAM = new Set(["cd", "for", "case", "select"]);
/** A heredoc's body, kept to the rest of its first line, and never a here-string; and text in quotes. Both are data. */
const HEREDOC = /(?<!<)<<-?\s*(['"]?)(\w+)\1([^\n]*)(?:\n(?:[^\n]*\n)*?[ \t]*\2[ \t]*(?=\n|$)|[\s\S]*$)/g;
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
/** What ends a shell segment: a line, a list or a pipe, a subshell or a substitution. */
const SEGMENT = /\n|&&|\|\||\|&|(?<![<>&])&(?![>&])|[|;()`]/;

/** Every trigger this reader can print, and the lane it starts. `lanes.md` names each one in the
 *  `Starts from` paragraph of that lane, and `test/wri-catalogue.test.ts` holds the two together. */
export const TRIGGERS = {
  "INSTRUMENT AUTHORED": 1,
  "PASSES UNREAD": 1,
  "REFUSALS BY CHECK": 1,
  "VERIFIER TOOLS MOVED": 1,
  "TOOL MISSING": 24,
  "NO CHECKER READING": 1,
  "CHECKER READ WITH FAULTS": 1,
  "CONTROL COVERAGE": 1,
  "REFUSED UNREAD": 3,
  "CHECK DEFECT RULED": 3,
  "RULED UNCLEAR": 3,
  "FAILS ON ONE CHECK": 4,
  "DEFECT RULED BESIDE PASSES": 4,
  "CHECKER NOT FROZEN": 1,
  "FROZEN DESPITE FAULTS": 1,
  "READ AT ANOTHER VERSION": 1,
  "TASKS CARRIED": 1,
  "SUPPLY THIN": 7,
  "GATE REFUSED": 7,
  "NO VALID ANSWER": 9,
  "AWAITING A LABEL": 9,
  "TIES BETWEEN VALID ANSWERS": 8,
  "TIED TASKS": 9,
  "PASSES AT A SMALL WALL SHARE": 10,
  "OUTCOMES BY SESSION": 11,
  "HARNESS CHANGED": 12,
  "BROKEN AT END": 12,
  "MEASURED AN EARLIER STATE": 12,
  "NEVER CHECKED": 13,
  "TOOLS CALLED": 13,
  "TOOL CALLS ERRED": 13,
  "TOOLS EDITED": 12,
  "NO PRACTICE": 14,
  "FINAL BYTES NEVER PRACTISED": 14,
  "SESSION ENDED": 14,
  "PRACTICE FAILS": 14,
  "PRACTISED TASK MEASURED": 12,
  "WIN AT A SMALL WALL SHARE": 15,
  WINS: 16,
  "ANSWER FROM A PROGRAM": 15,
  "SCORED SET MOVED": 5,
  "NOTHING SCORED": 18,
  "CUT BY ITS CAP": 18,
  "SET SHORT": 18,
  "VALID BY HARNESS": 19,
  "PROMOTION UNCONFIRMED": 19,
  "CHAIN AGAINST THE STARTER": 28,
  "MARGINS INSIDE THE NOISE": 29,
  "STEP CARRIERS": 17,
  "FLIPS": 20,
  "REFERENCE AGAINST ITSELF": 20,
  "HOST CODE MOVED": 26,
  "STARTS OUT OF TURN": 24,
  "SERVED ANOTHER MODEL": 24,
  "CHAIN": 21,
  "NO TASK HELD OUT": 21,
  "WALL SHARE": 24,
  "HOST LOADED": 24,
  "LOAD MOVED": 24,
  "MISSES AT A LIMIT": 24,
  "NON-RESULTS": 24,
  "SOLVE NEVER FINISHED": 24,
  "EXAMINER NEVER FINISHED": 24,
  "MISSES WITHOUT A VERDICT": 24,
  "SESSION CRASHED": 24,
  "LONG SILENCES": 25,
  "SPEND LED BY A ROLE": 25,
  "REPLAY MOVED THE VERDICT": 3,
  "SET ASIDE AND UNSETTLED": 5,
  "READING MOVES WITH THE SET-ASIDE": 5,
  "SET ASIDE BY SIDE": 5,
  "SETTLED BY HAND": 5,
  "REVIEW FAULTS": 5,
  "EARNED WITHOUT A PROBE": 5,
  "RULINGS REFUSED": 5,
  "PROMOTED": 22,
  "STARTER BARE": 22,
  "AFTER THE PROMOTION": 22,
  "SHARED TEMPORARY FOLDER": 22,
  "ENDED AND WENT ON": 23,
  "OPERATOR WORDS": 23,
  "BUILDER COMPACTED": 25,
  "EXAM DRAFTED": 6,
  "LAUNCHES": 26,
  "NO LAUNCH RECEIPT": 26,
  "LOG OUT OF ORDER": 26,
  "SAFEGUARD-8 PROMOTION ON AUTHOR ROOM": 7,
  "SAFEGUARD-9 PROMOTION BEYOND VALIDITY": 8,
} as const;

export const text = (value: JsonValue | undefined): string => (isString(value) ? value : "");
export const count = (value: JsonValue | undefined): number => (isNumber(value) ? value : 0);
/** A test's tally as its step is read: on its scores without the bill where the report holds them
 *  (since 26 October), else as tallied. On 1 November lane 11 found the ties trigger silent on g-3,
 *  9 of 18 tied with the bill and 14 of 18 without it. */
export function tallyOf(tested: JsonValue | undefined) {
  const record = asRecord(tested);
  if (record === null) return null;
  const unbilled = Array.isArray(record.unbilled) ? record.unbilled.filter(isNumber) : null;
  if (unbilled === null) {
    return {
      wins: count(record.wins),
      losses: count(record.losses),
      ties: count(record.ties),
      p: count(record.p),
    };
  }
  const signed = (sign: number) => unbilled.filter((one) => Math.sign(one) === sign).length;
  return { wins: signed(1), losses: signed(-1), ties: signed(0), p: flipP(unbilled) };
}
export const items = (value: JsonValue | undefined): readonly JsonValue[] =>
  Array.isArray(value) ? value : [];
export const strings = (value: JsonValue | undefined): string[] => items(value).filter(isString);
/**
 * Every program one shell command names: each segment's first word that is no assignment and no shell
 * word, its path dropped. Until 5 November this read the first program of the first line alone, so
 * "through bash: none" could be said of a solve whose command ran a harness's programs on its later
 * lines or past a pipe (landing review of 5 November).
 */
const commandWords = (command: string): string[] =>
  command
    .replaceAll(HEREDOC, "$3")
    .replaceAll(QUOTED, "''")
    .split(SEGMENT)
    .flatMap((segment) => {
      const parts = segment.trim().split(/\s+/);
      const word = parts.find((part) => !/^\w+=/.test(part) && !SHELL_WORDS.has(part)) ?? "";
      return /^[\w./+-]+$/.test(word) && !NO_PROGRAM.has(word) ? [word.replace(/^.*\//, "")] : [];
    });

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
  const named = Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right));
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
          cancelledBy: isString(ending?.cancelledBy) ? ending.cancelledBy : null,
          seconds: count(end?.seconds),
          calls: [],
          programs: [],
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
    if (call.tool === "bash") solve.programs.push(...commandWords(text(asRecord(call.args)?.command)));
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
  return log.solves.filter((solve) => blockingOf(log.verdicts.get(solve.id)?.checker).length > 0);
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
  const blocking = refused.flatMap((solve) => blockingOf(log.verdicts.get(solve.id)?.checker));
  const byCheck = countBy(blocking, (check) => check);
  // One check refusing most answers, and no other refusing as many: t-10's one refusal on 10
  // October was blocked by all four checks, and the first of four equal counts read as a fault
  // of one check's.
  const [top, next] = Object.entries(byCheck).toSorted(([, a], [, b]) => b - a);
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
 *  spread of the budget (lane 8), the ties (lane 9), and each harness by itself
 *  (`VALID BY HARNESS`, lane 19). A report written before 2026-10-11 also holds the same test
 *  read at shorter budgets (`budgets`), which no trigger reads: the reading was of a solver told
 *  the longer budget (`7f0add79:docs/simplify.md`, A2). */
function tallyTriggers(compared: readonly Compared[]): Trigger[] {
  const decided = compared.flatMap(({ session, last, scoring }) => {
    const scored = asRecord(last.scored);
    const { wins, losses, ties } = tallyOf(scored) ?? { wins: 0, losses: 0, ties: 0 };
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
  // One gate reading records the shape check and, until 1 November, the room solves. Older logs
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
    // A proposal still at the gate is neither passed nor refused: until 28 October it counted as refused.
    ...(passed * 2 < admissions.length
      ? [fired("SUPPLY THIN", `${share(passed, admissions.length)} decided tasks passed task admission`)]
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

/** A reader's command line: `bun tools/wri/<name>.ts <log>`. */
export function printRows(name: string, rowsOf: (log: string) => readonly string[]): void {
  const [log] = runtimeProcess.argv.slice(2);
  if (log === undefined) throw new Error(`name a log: bun tools/wri/${name}.ts <log>`);
  console.log(rowsOf(log).join("\n"));
}
