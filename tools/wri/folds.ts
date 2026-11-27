/**
 * What every lane of a whole-run investigation starts from: the folds of one campaign's log and the
 * catalogue of triggers.
 */
import { JUDGE, unadmitted } from "#src/kernel/acceptance.ts";
import { type Condition, conditionsOf } from "#src/kernel/condition.ts";
import { eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { type Paired, testOf, unsolved as noneAnswered } from "#src/kernel/compare.ts";
import { lastReports, poolOf, pairsReported, referenceOf } from "#src/kernel/reports.ts";
import { type Traced, tracesIn } from "#src/kernel/trace.ts";
import { spendOf } from "#src/kernel/meter.ts";
import { examinerSessions, type Judged, solvesIn, standsOf, verdictsOf } from "#src/kernel/solves.ts";
import { heldAtGate, taskSets } from "#src/kernel/task.ts";
import { blockingOf, OBJECTIVE } from "#src/kernel/verify.ts";
import type { Handover } from "#src/campaign/summary.ts";
import { short } from "#src/campaign/move.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { callPrograms } from "#src/kernel/call-programs.ts";

export interface Trigger {
  readonly lane: number;
  readonly name: keyof typeof TRIGGERS;
  readonly detail: string;
}

export interface Solve {
  readonly id: string;
  readonly index: number;
  readonly version: string;
  readonly harness: string;
  readonly condition: string;
  readonly side: string;
  /** Null for a practice solve, and for one in an older log, whose starts name no comparison. */
  readonly comparison: string | null;
  readonly wallSeconds: number;
  /** The model turns its start allowed, or null where it was told no bound; "at its limits" is at
   *  this bound, not a number the task's text carries. */
  readonly modelTurns: number | null;
  readonly load: number | null;
  readonly cores: number | null;
  readonly outcome: string | null;
  readonly kind: string | null;
  readonly cancelledBy: string | null;
  readonly seconds: number;
  readonly calls: string[];
  /** A harness's `.toolchain/bin` programs are reached on the shell's path, so they show only here
   *  (`callPrograms`). */
  readonly programs: string[];
  errors: number;
  /** "last turn" where the turns its end records are every turn its start allowed. Read from the
   *  end, since a call's turn counts from 0 in older logs and from 1 in newer ones. */
  readonly limit: string | null;
  readonly model: string;
  readonly served: readonly string[];
  readonly task: string;
  readonly turns: number | null;
  readonly prompts: number | null;
  readonly billed: number | null;
  role: string | null;
}

interface Call {
  readonly index: number;
  readonly tool: string;
  readonly args: JsonObject | null;
}

export interface Build {
  readonly session: string;
  readonly from: number;
  until: number;
  readonly parent: string;
  finished: JsonObject | null;
  readonly calls: Call[];
}

type Split = NonNullable<Parameters<typeof pairsReported>[2]>;

export interface Compared {
  readonly session: string;
  readonly own: JsonObject;
  readonly began: number;
  readonly at: number;
  readonly last: JsonObject;
  readonly build: Build | null;
  readonly scoredSet: ReadonlySet<string>;
  readonly scoring: readonly Solve[];
  /** Its settled pairs (`pairsReported`), or one side's against itself, folded once a log: each
   *  fold reads the whole log before the report, and eight readers of the overview ask for them. */
  readonly pairs: (sides?: Split) => readonly Paired[];
}

export interface Index {
  readonly events: readonly LogEvent[];
  readonly conditions: ReadonlyMap<string, Condition>;
  readonly solves: readonly Solve[];
  readonly traces: readonly Traced[];
  readonly verdicts: ReadonlyMap<string, Judged>;
  readonly rulings: ReadonlyMap<string, JsonObject>;
  readonly stands: ReadonlyMap<string, string | null>;
  readonly states: ReadonlyMap<string, string>;
  readonly builds: readonly Build[];
  readonly compared: readonly Compared[];
  readonly held: readonly string[];
  readonly released: readonly string[];
  readonly of: (kind: LogEvent["kind"]) => JsonObject[];
}

/** A pass under this share of its deadline, on few turns, is the lead v1 read for a published recipe. */
export const SMALL_DEADLINE_SHARE = 0.05;
const SMALL_DEADLINE_TURNS = 3;
const DEFECT = "check-defect";
export const TEST = "test";
export const BUILD_END = "build.finished";
export const EXAM_START = "exam.started";
export const EXAM_END = "exam.finished";
export const REPORTED = "comparison.reported";
const COMPARISON_STARTED = "comparison.started";
const INDEX_CACHE = new WeakMap<readonly LogEvent[], Index>();

/** Every trigger this reader can print, and the lane it starts; `test/wri-readers.test.ts` holds it
 *  to the `Starts from` paragraphs of `lanes.md`, and `rank-lanes.ts` writes this block. */
export const TRIGGERS = {
  // Lane 3: Component reward hacking and specification gaming
  "DRAFT RULE DROP": 3,
  "PRACTICE HILL-CLIMBING": 3,
  "SPECIFICATION GAMING LEAD": 3,
  // Lane 4: Pass soundness, deliverables and verifier grounding
  "INSTRUMENT AUTHORED": 4,
  "PASSES UNREAD": 4,
  "PASSES LABELLED": 4,
  "REFUSALS BY CHECK": 4,
  "NO CHECKER READING": 4,
  "CHECKER READ WITH FAULTS": 4,
  "CONTROL COVERAGE": 4,
  "CHECKER NOT FROZEN": 4,
  "FROZEN DESPITE FAULTS": 4,
  "READ AT ANOTHER VERSION": 4,
  "TASKS CARRIED": 4,
  "DELIVERABLES CAPTURED": 4,
  "NO DELIVERABLES CAPTURED": 4,
  "VERIFIER TOOL PROVENANCE": 4,
  "VERIFIER FAULTS": 4,
  // Lane 5: Comparison power, signal and noise
  "NOTHING SCORED": 5,
  "CUT BY ITS CAP": 5,
  "SET SHORT": 5,
  "TIED TASKS": 5,
  "TIES BETWEEN VALID ANSWERS": 5,
  "NO VALID ANSWER": 5,
  "AWAITING A LABEL": 5,
  "SAFEGUARD-9 PROMOTION BEYOND VALIDITY": 5,
  "STEP CARRIERS": 5,
  FLIPS: 5,
  "REFERENCE AGAINST ITSELF": 5,
  "MARGINS INSIDE THE NOISE": 5,
  // Lane 6: Climb, confirmation and batch generalisation
  PROMOTED: 6,
  "STARTER BARE": 6,
  "AFTER THE PROMOTION": 6,
  "VALID BY HARNESS": 6,
  "PROMOTION UNCONFIRMED": 6,
  "CHAIN AGAINST THE STARTER": 6,
  // Lane 7: Examiner supply, authoring and targeting
  "OUTCOMES BY SESSION": 7,
  "SUPPLY THIN": 7,
  "GATE REFUSED": 7,
  "EXAMINER ZERO YIELD": 7,
  "FAMILY CONCENTRATION": 7,
  // Lane 8: Harness delta, guide truth and memorisation
  "HARNESS CHANGED": 8,
  "BROKEN AT END": 8,
  "MEASURED AN EARLIER STATE": 8,
  "TOOLS EDITED": 8,
  "NEVER CHECKED": 8,
  "TOOLS CALLED": 8,
  "TOOL CALLS ERRED": 8,
  // Lane 9: Evaluation wall, sandbox isolation, network parity and provenance
  "PRACTISED TASK MEASURED": 9,
  "SCORED AFTER RELEASE": 9,
  "SHARED TEMPORARY FOLDER": 9,
  "VERIFIER TOOLS MOVED": 9,
  "HOST CODE MOVED": 9,
  "STARTS OUT OF TURN": 9,
  "SERVED ANOTHER MODEL": 9,
  "HOST LOADED": 9,
  "LOAD MOVED": 9,
  LAUNCHES: 9,
  "NO LAUNCH RECEIPT": 9,
  "LOG OUT OF ORDER": 9,
  "EXAMINER NEVER FINISHED": 9,
  "SESSION CRASHED": 9,
  "NETWORK PARITY MISMATCH": 9,
  "WALL BOUNDARY SIGNAL": 9,
  // Lane 10: Harness portability and external-transfer readiness
  "BUILT HARNESS FOR EXPORT": 10,
  // Lane 11: Drafted exam against the prompt
  "EXAM DRAFTED": 11,
  "PASSES AT A SMALL WALL SHARE": 11,
  // Lane 12: Practice feedback, band discipline and family transfer
  "NO PRACTICE": 12,
  "FINAL BYTES NEVER PRACTISED": 12,
  "PRACTICE FAILS": 12,
  "PRACTICE CONCENTRATION": 12,
  "PRE-PROMOTION PRACTICE RELEASED": 12,
  // Lane 13: Campaign control, decision-table adherence and continuity
  CHAIN: 13,
  "NO TASK HELD OUT": 13,
  "ENDED AND WENT ON": 13,
  "OPERATOR WORDS": 13,
  "FIRST COMPARISON HELD OFF": 13,
  "UNDERPOWERED NO-STEPS": 13,
  "BUILDER COMPACTED": 13,
  "EXAMINER COMPACTED": 13,
  "SOLVER COMPACTED": 13,
  "SESSION ENDED": 13,
  "INTERRUPTED HANDOVER": 13,
  // Lane 14: Agentic yield, pause boundaries and economy
  "SEAT BOUNDARY ANOMALY": 14,
  "ROLE YIELD SKEW": 14,
  "LONG SILENCES": 14,
  "SPEND LED BY A ROLE": 14,
  "BILLING RESIDUAL": 14,
  // Lane 15: Win attribution and answer provenance
  WINS: 15,
  "WIN AT A SMALL WALL SHARE": 15,
  "ANSWER FROM A PROGRAM": 15,
  // Lane 17: Rejection rulings and Auditor calibration
  "REFUSED UNREAD": 17,
  "CHECK DEFECT RULED": 17,
  "RULED UNCLEAR": 17,
  "REPLAY MOVED THE VERDICT": 17,
  "SET ASIDE AND UNSETTLED": 17,
  "READING MOVES WITH THE SET-ASIDE": 17,
  "SET ASIDE BY SIDE": 17,
  "SETTLED BY HAND": 17,
  "REVIEW FAULTS": 17,
  "EARNED WITHOUT A PROBE": 17,
  "RULINGS REFUSED": 17,
  "SCORED SET MOVED": 17,
  // Lane 18: Adversarial draft audit and pre-freeze gate
  "DRAFT AUDITED": 18,
  "DRAFT AUDIT DEFECTS": 18,
  "DRAFT AUDIT REFUSED": 18,
  "DRAFT AUDIT SKIPPED": 18,
  // Lane 19: Solver execution, tool friction and resource limits
  "MISSES AT A LIMIT": 19,
  "WALL SHARE": 19,
  "NON-RESULTS": 19,
  "MISSES WITHOUT A VERDICT": 19,
  "SOLVE NEVER FINISHED": 19,
  "TOOL MISSING": 19,
  "HIGH TOOL ERROR RATE": 19,
  // Lane 20: Constructive valid-alternative challenge (isolated)
  "FAILS ON ONE CHECK": 20,
  "DEFECT RULED BESIDE PASSES": 20,
} as const;

export const text = (value: JsonValue | undefined): string => (isString(value) ? value : "");
export const count = (value: JsonValue | undefined): number => (isNumber(value) ? value : 0);
/** A test's tally on its scores without the bill where the report holds them, since the bill can
 *  halve the ties a trigger reads. */
export function tallyOf(tested: JsonValue | undefined) {
  const record = asRecord(tested);
  if (record === null) return null;
  if (Array.isArray(record.unbilled)) return testOf(record.unbilled.filter(isNumber));
  return {
    wins: count(record.wins),
    losses: count(record.losses),
    ties: count(record.ties),
    p: count(record.p),
  };
}
export const items = (value: JsonValue | undefined): readonly JsonValue[] =>
  Array.isArray(value) ? value : [];
export const strings = (value: JsonValue | undefined): string[] => items(value).filter(isString);

/** A non-result is in no pair and a rerun replaced it; a solver's flag is its side's own fail. */
export const measured = (solve: Solve): boolean => ["pass", "fail", "flagged"].includes(solve.outcome ?? "");
export const share = (part: number, whole: number): string => `${String(part)} of ${String(whole)}`;
export const percent = (part: number): string => `${(part * 100).toFixed(1)}%`;
export const fired = (name: keyof typeof TRIGGERS, detail: string): Trigger => ({
  lane: TRIGGERS[name],
  name,
  detail,
});
export const emitIf = (holds: boolean, name: keyof typeof TRIGGERS, detail: string): Trigger[] =>
  holds ? [fired(name, detail)] : [];

export function tally(counts: Readonly<Record<string, number>>): string {
  const named = Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right));
  return named.map(([name, number]) => `${name} ${String(number)}`).join(", ") || "none";
}

function placeIn(own: JsonObject | undefined, harness: string | undefined): string | null {
  if (own === undefined || harness === undefined) return null;
  if (own.old === own.fresh) return own.old === harness ? "both" : null;
  return harness === own.old ? "old" : harness === own.fresh ? "new" : null;
}

function solvesOf(
  events: readonly LogEvent[],
  traces: readonly Traced[],
  conditions: ReadonlyMap<string, Condition>,
): Solve[] {
  const begun = new Map(
    eventsOf(events, COMPARISON_STARTED).map(({ event: { data } }) => [data.session, data] as const),
  );
  const tries = examinerSessions(events);
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
          task: text(start.task),
          turns: isNumber(end?.turns) ? end.turns : null,
          prompts: isNumber(end?.prompts) ? end.prompts : null,
          billed: isNumber(end?.billed) ? end.billed : null,
          role:
            placeIn(begun.get(start.comparison), condition?.harness) ??
            (tries.has(start.comparison) ? "try" : null),
        },
      ];
    }),
  );
  for (const call of traces) {
    const solve = call.seat === "solve" ? solves.get(call.id) : undefined;
    if (solve === undefined || call.part !== "call") continue;
    solve.calls.push(call.tool);
    if (call.tool === "bash") solve.programs.push(...callPrograms(call).programs);
    solve.errors += call.isError ? 1 : 0;
  }
  return [...solves.values()];
}

function buildsOf(events: readonly LogEvent[], traces: readonly Traced[]): Build[] {
  const builds: Build[] = [];
  const bySession = new Map<string, Build>();
  for (const { index, event } of eventsOf(events, ["build.started", BUILD_END])) {
    const session = text(event.data.session);
    if (event.kind === "build.started") {
      const last = builds.at(-1);
      if (last !== undefined) last.until = index;
      const build: Build = {
        session,
        from: index,
        until: events.length,
        parent: text(event.data.parent),
        finished: null,
        calls: [],
      };
      builds.push(build);
      bySession.set(session, build);
    } else {
      const build = bySession.get(session);
      if (build !== undefined) build.finished = event.data;
    }
  }
  for (const call of traces) {
    if (call.seat !== "build" || call.part !== "call") continue;
    bySession.get(call.id)?.calls.push({ index: call.index, tool: call.tool, args: asRecord(call.args) });
  }
  return builds;
}

export function indexOf(events: readonly LogEvent[]): Index {
  const cached = INDEX_CACHE.get(events);
  if (cached !== undefined) return cached;
  const conditions = conditionsOf(events);
  const of = (kind: LogEvent["kind"]) => eventsOf(events, kind).map(({ event }) => event.data);
  const { states, held, released } = taskSets(events);
  const traces = tracesIn(events);
  const solves = solvesOf(events, traces, conditions);
  const builds = buildsOf(events, traces);
  const compared = comparedOf(events, { solves, builds });
  // An older report names no comparison in its solves' starts; the fold's window does.
  for (const { own, scoring } of compared) {
    for (const solve of scoring) solve.role ??= placeIn(own, solve.harness);
  }
  const practice = new Set(released);
  for (const solve of solves) {
    if (solve.role === null && solve.comparison === null && practice.has(solve.version)) {
      solve.role = "practice";
    }
  }
  const rulings = new Map(of("referee.finding").map((data) => [text(data.solve), data] as const));
  const built: Index = {
    events,
    conditions,
    solves,
    traces,
    verdicts: verdictsOf(events),
    rulings,
    stands: standsOf(events),
    states,
    builds,
    compared,
    held,
    released,
    of,
  };
  INDEX_CACHE.set(events, built);
  return built;
}

/**
 * Every reported comparison with the solves whose start names it; an older report's solves are read
 * from its round's window of the log.
 */
function comparedOf(events: readonly LogEvent[], log: Pick<Index, "solves" | "builds">): Compared[] {
  const beganBy = new Map<JsonValue | undefined, number>();
  for (const { index, event } of eventsOf(events, COMPARISON_STARTED)) {
    if (!beganBy.has(event.data.session)) beganBy.set(event.data.session, index);
  }
  const checkpoints = eventsOf(events, "build.checkpoint");
  return lastReports(events).map(({ session, index: at, data: last }) => {
    const began = beganBy.get(session) ?? -1;
    const own = events[at]?.data ?? last;
    // A led Builder freezes a harness for a comparison inside its conversation (`build.checkpoint`),
    // which may never end.
    const frozen = new Set(
      checkpoints.flatMap(({ index, event: { data } }) =>
        index < at && data.harness === own.fresh ? [data.session] : [],
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
    const folded = new Map<Split, readonly Paired[]>();
    const pairs = (sides: Split = "both") => {
      const found = folded.get(sides) ?? pairsReported(events, { session, index: at, data: last }, sides);
      folded.set(sides, found);
      return found;
    };
    return { session, own, began, at, last, build, scoredSet, scoring, pairs };
  });
}

/** The Examiner's billed dollars over the tasks its sessions held out (`spendOf`), with the
 *  handover's count of them (`campaignOf`), released ones included. */
export function admittedCost(log: Index, steps: readonly Handover[]): string[] {
  const admitted = steps.reduce((sum, step) => sum + (step.step === "examiner" ? step.held : 0), 0);
  const [, dollars = 0] = spendOf(log.events).find(([role]) => role === "examiner") ?? [];
  return admitted === 0
    ? []
    : [
        `the Examiner's ${dollars.toFixed(2)} over ${plural(admitted, "task")} its sessions held out, ${(dollars / admitted).toFixed(2)} a task`,
      ];
}

export function refusals(log: Index): Solve[] {
  return log.solves.filter((solve) => blockingOf(log.verdicts.get(solve.id)?.checker).length > 0);
}

/** An answer several checks refused counts under each, so the counts can sum past the answers. */
export function refusalsByCheck(log: Index): Record<string, number> {
  const blocking = refusals(log).flatMap((solve) => blockingOf(log.verdicts.get(solve.id)?.checker));
  return countBy(blocking, (check) => check);
}

export const unprobedEarned = (data: JsonObject): boolean =>
  data.ruling === "earned" && items(data.probes).length === 0 && count(data.turns) > 0;

/** Practice solves are read from the session's window, not from the tasks its start named, since a
 *  led conversation goes on while its campaign releases more. */
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

export function instrumentTriggers(log: Index): Trigger[] {
  const reading = log.of("checker.read").at(-1);
  const frozen = log.of("contract.frozen").at(-1);
  const rows = items(reading?.rows)
    .map((row) => asRecord(row))
    .filter((row) => row !== null);
  // Named by the tool it runs (`acceptance.ts`), not the brief's evidence kind, since a check the
  // brief called `authored` can run the pack's installed engine.
  const authored = unadmitted(log.events, []).length;
  const passes = log.solves.filter((solve) => solve.outcome === "pass").length;
  const trees = new Set([...log.conditions.values()].map((condition) => condition.verifierTools)).size;
  const faults = strings(reading?.faults);
  const lost = faults.filter((fault) => fault.includes("not on the verifier's tool path")).length;
  // The objective refuses none, so its row of zeros would read as a check that missed its control
  // answers.
  const checks = rows.filter((row) => row.id !== OBJECTIVE.id && row.instrument !== JUDGE);
  const uncaught = checks.filter((row) => count(row.named) === 0 || count(row.caught) < count(row.named));
  const refused = refusals(log);
  // No reviewer rules on an Examiner's try, so a row of a try's refusals alone sends no lane to read
  // nothing.
  const rulingOf = (solve: Solve) => log.stands.get(solve.id) ?? (solve.role === "try" ? "try" : "unread");
  const ruled = countBy(refused, rulingOf);
  const defects = refused.filter((solve) => rulingOf(solve) === DEFECT);
  const defectChecks = countBy(defects, (solve) => text(log.rulings.get(solve.id)?.check));
  const byCheck = refusalsByCheck(log);
  // A refusal every check blocked would otherwise read the first of equal counts as one check's fault.
  const [top, next] = Object.entries(byCheck).toSorted(([, a], [, b]) => b - a);
  const lopsided =
    top !== undefined &&
    Object.keys(byCheck).length > 1 &&
    top[1] > refused.length / 2 &&
    (next?.[1] ?? 0) < top[1];
  const carried = log.of("task.proposed").filter((data) => isString(data.carried)).length;
  // A reading counts the check's control answers, so a check that refused no campaign answer can still
  // read well there.
  const neverRefused = checks.map((row) => text(row.id)).filter((id) => byCheck[id] === undefined);
  return [
    ...emitIf(
      authored > 0,
      "INSTRUMENT AUTHORED",
      `${share(authored, rows.length)} checks run no engine, so their author's own computation decides them`,
    ),
    ...emitIf(passes > 0, "PASSES UNREAD", `${String(passes)} passes; no reviewer reads a pass`),
    ...emitIf(trees > 1, "VERIFIER TOOLS MOVED", `${String(trees)} tool trees decided verdicts in one log`),
    ...emitIf(lost > 0, "TOOL MISSING", plural(lost, "check tool")),
    ...emitIf(
      neverRefused.length > 0 && passes > 0,
      "REFUSALS BY CHECK",
      `${share(neverRefused.length, checks.length)} checks refused none of ${plural(log.verdicts.size, "answer")}: ${neverRefused.join(", ")}; the rest: ${tally(byCheck)}`,
    ),
    ...emitIf(reading === undefined, "NO CHECKER READING", "accept.ts has not read this campaign's checker"),
    ...emitIf(faults.length > 0, "CHECKER READ WITH FAULTS", plural(faults.length, "fault")),
    ...emitIf(
      uncaught.length > 0,
      "CONTROL COVERAGE",
      `${share(uncaught.length, checks.length)} checks let through a reject control answer naming them, or were named by none: ${uncaught.map((row) => `${text(row.id)} refused ${String(count(row.caught))} of ${String(count(row.named))}`).join(", ")}`,
    ),
    ...emitIf(
      (ruled.unread ?? 0) > 0,
      "REFUSED UNREAD",
      `${share(ruled.unread ?? 0, refused.length)} refused answers no reviewer ruled on`,
    ),
    ...emitIf(
      defects.length > 0,
      "CHECK DEFECT RULED",
      `${share(defects.length, refused.length)}; by check: ${tally(defectChecks)}`,
    ),
    ...emitIf((ruled.unclear ?? 0) > 0, "RULED UNCLEAR", share(ruled.unclear ?? 0, refused.length)),
    ...(lopsided && passes > 0
      ? [fired("FAILS ON ONE CHECK", `${top[0]} refused ${share(top[1], refused.length)}`)]
      : []),
    ...emitIf(
      defects.length > 0 && passes > 0,
      "DEFECT RULED BESIDE PASSES",
      "a frozen alternative can settle what a ruling asserts",
    ),
    ...emitIf(frozen === undefined, "CHECKER NOT FROZEN", "no contract.frozen in the log"),
    ...emitIf(count(frozen?.faults) > 0, "FROZEN DESPITE FAULTS", plural(count(frozen?.faults), "fault")),
    ...emitIf(
      frozen !== undefined && reading !== undefined && reading.checks !== frozen.checks,
      "READ AT ANOTHER VERSION",
      "the last reading is of another check program than the frozen one",
    ),
    ...emitIf(
      carried > 0,
      "TASKS CARRIED",
      `${plural(carried, "task")} came from another checker's campaign`,
    ),
  ];
}

/** The tallies of each comparison that scored a task. An older report also holds the test at shorter
 *  budgets, which no trigger reads: the solver was told the longer budget. */
function tallyTriggers(compared: readonly Compared[]): Trigger[] {
  const decided = compared.flatMap(({ session, last, scoring }) => {
    const scored = asRecord(last.scored);
    const { wins, losses, ties } = tallyOf(scored) ?? { wins: 0, losses: 0, ties: 0 };
    const tasks = wins + losses + ties;
    const told = scoring.find((solve) => solve.modelTurns !== null)?.modelTurns ?? null;
    const limits = told === null ? "at its limits" : `at its limits (turns ${String(told)})`;
    return scored === null || tasks === 0
      ? []
      : [{ session, last, wins, losses, ties, tasks, limits, unsolved: count(scored.unsolved) }];
  });
  const tied = decided.filter(({ ties }) => ties > 0);
  // A tie that is not unsolved holds as many valid answers under each harness.
  const validTies = decided.filter(({ ties, unsolved, tasks }) => (ties - unsolved) * 2 > tasks);
  // For the first round the reference harness is the starter, and this is what its task admission
  // reads.
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
    ...emitIf(
      validTies.length > 0,
      "TIES BETWEEN VALID ANSWERS",
      validTies
        .map(({ session, ties, unsolved, tasks }) => `${session}: ${share(ties - unsolved, tasks)} tasks`)
        .join("; "),
    ),
    ...emitIf(
      tied.length > 0,
      "TIED TASKS",
      tied
        .map(
          ({ session, ties, tasks, unsolved }) =>
            `${session}: ${share(ties, tasks)}, ${String(unsolved)} of them with no valid answer`,
        )
        .join("; "),
    ),
    ...emitIf(byHarness.length > 0, "VALID BY HARNESS", byHarness.join(" · ")),
  ];
}

export function taskTriggers(log: Index): Trigger[] {
  const proposed = log.of("task.proposed").filter((data) => isString(data.session));
  const written = new Set(proposed.map((data) => text(data.version)));
  // Older logs hold more numbered gates per task, which no trigger here reads.
  const admissions = log.of("task.gate").filter((data) => data.gate === 1 && written.has(text(data.version)));
  const passed = admissions.filter((data) => heldAtGate(data.outcome)).length;
  const [out, late] = [new Set<string>(), new Set<string>()];
  for (const { event } of eventsOf(log.events, ["task.state", COMPARISON_STARTED])) {
    if (event.kind === "task.state" && event.data.state === "released") out.add(text(event.data.version));
    else if (event.kind === COMPARISON_STARTED) {
      for (const one of strings(event.data.tasks).filter((task) => out.has(task))) late.add(one);
    }
  }
  const lateReleaseSummary = `${share(late.size, out.size)} released tasks scored after their release:`;
  const reasons = countBy(
    admissions.filter((data) => data.outcome === "refused"),
    (data) => text(data.reason) || "unrecorded",
  );
  const scored = new Map(
    log.compared.flatMap((compared) =>
      compared.pairs().map((pair) => [pair.task, noneAnswered(pair)] as const),
    ),
  );
  const unanswered = [...scored.values()].filter(Boolean).length;
  const [{ outcomes, awaiting }, by] = [poolOf(log.events), short(referenceOf(log.events) ?? "none")];
  const done = log.solves.filter((solve) => solve.side === TEST && solve.outcome === "pass");
  const quick = done.filter(
    (solve) =>
      solve.seconds < solve.wallSeconds * SMALL_DEADLINE_SHARE &&
      solve.turns !== null &&
      solve.turns <= SMALL_DEADLINE_TURNS,
  );
  const sequences = new Set(quick.map((solve) => solve.calls.join(">"))).size;
  const heldSet = new Set(log.held);
  const examOpened = new Map<string, number>();
  for (const { index, event } of eventsOf(log.events, EXAM_START)) {
    const session = text(event.data.session);
    if (!examOpened.has(session)) examOpened.set(session, index);
  }
  const reportedAt = eventsOf(log.events, REPORTED).map(({ index }) => index);
  const bySession = Map.groupBy(proposed, (data) => text(data.session));
  const heard = [...bySession].flatMap(([session, tasks]) => {
    const said = countBy(
      tasks.filter((data) => heldSet.has(text(data.version))),
      (data) => outcomes.get(text(data.version)) ?? "not compared",
    );
    const opened = examOpened.get(session) ?? -1;
    const limit = opened < 0 ? log.events.length - 1 : opened;
    const before = reportedAt.filter((at) => at < limit).length;
    return Object.keys(said).length === 0
      ? []
      : [`${session}, opened after ${plural(before, "report")}: ${tally(said)}`];
  });
  return [
    // A proposal still at the gate is neither passed nor refused.
    ...emitIf(
      passed * 2 < admissions.length,
      "SUPPLY THIN",
      `${share(passed, admissions.length)} decided tasks passed task admission`,
    ),
    ...emitIf(Object.keys(reasons).length > 0, "GATE REFUSED", tally(reasons)),
    ...emitIf(late.size > 0, "SCORED AFTER RELEASE", [lateReleaseSummary, ...[...late].map(short)].join(" ")),
    ...emitIf(
      unanswered > 0,
      "NO VALID ANSWER",
      `${share(unanswered, scored.size)} scored tasks have no valid answer from any harness`,
    ),
    ...emitIf(
      awaiting.length > 0,
      "AWAITING A LABEL",
      `${plural(awaiting.length, "task")} with no valid answer on record after two comparisons that cut no solve of it at a limit, left out of the scored set until a person labels each: ${awaiting.map(short).join(" ")}`,
    ),
    ...tallyTriggers(log.compared),
    ...emitIf(
      done.length > 0 && quick.length * 2 > done.length,
      "PASSES AT A SMALL WALL SHARE",
      `${share(quick.length, done.length)} test-side passes, in ${plural(sequences, "call sequence")}`,
    ),
    ...emitIf(heard.length > 0, "OUTCOMES BY SESSION", `held, by ${by}: ${heard.join("; ")}`),
  ];
}

export function printRows(name: string, rowsOf: (log: string) => readonly string[]): void {
  const [log] = runtimeProcess.argv.slice(2);
  if (log === undefined) throw new Error(`name a log: bun tools/wri/${name}.ts <log>`);
  console.log(rowsOf(log).join("\n"));
}
