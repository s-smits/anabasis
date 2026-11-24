/**
 * The Examiner's gate checks a task package's shape (`src/examiner/write.ts`).
 *
 * The oldest logs hold four later admission tests (a stronger solve, the checks run again
 * on its answer, three reject control answers, and a screening under two harnesses) and the states
 * screening moved a task through: `too-hard`, `admitted`, `too-easy`, `wall-bound`, and the
 * anchor's draw. They are read here as history. A later admission test says nothing of a task's shape, and
 * each of those states leaves the task what it was, a held-out task; a refusal one of the later
 * admission tests led to stands, since its state was logged beside it. No command writes any of them now.
 */
import { CHECK_BRIEF, EVALUATOR_FILE } from "../meta/bundle-layout.ts";
import { existsSync } from "../meta/filesystem.ts";
import { type JsonObject, type JsonValue, isString } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { Contract } from "./contract.ts";
import type { EventKind, LogEvent } from "./log.ts";
import {
  applicableTruthChecks,
  checkEvaluationRequest,
  checkProgramFiles,
  checkProgramVersion,
  readBrief,
  type Task,
} from "./verify.ts";

/** The task's public part and its hidden values, as the verifier takes them, with the rest. */
export interface TaskPackage extends Task {
  /** The contract rules the check enforces. */
  readonly ruleIds: readonly string[];
  /** The check program's directory: its `brief.json`, its `evaluator.ts` and whatever they read. */
  readonly checks: string;
}

/** The shape check passes or refuses. */
interface Passed {
  readonly outcome: "passed";
}
interface Refused {
  readonly outcome: "refused";
  readonly reason: string;
}

/** A task version as the fold holds it: its state, and whether its package passed task admission. */
interface Folded {
  state: TaskState;
  admitted: boolean;
}

/** What a log holds of its tasks, from the one fold: each version's state, and the two sets every
 *  command of a campaign asks for, in the order their tasks were proposed. */
interface TaskSets {
  readonly states: Map<string, TaskState>;
  /** The held-out tasks: admitted, and neither released, disputed nor refused. */
  readonly held: readonly string[];
  /** The practice tasks. */
  readonly released: readonly string[];
}

/** The task admission's outcome, and the state, of a task held for the retired ladder. */
const LADDER = "ladder";
const TASK_STATES = ["held", "refused", "released", "disputed"] as const;

type TaskState = (typeof TASK_STATES)[number];

/**
 * Where each state may go. A held-out task may be released for practice, and a check defect shows
 * wherever a task is solved, so a task may be disputed from either set: in v1, 36 of 47 rehearsal
 * misses were check defects, so practice is where most will show. Nothing follows a dispute or a
 * refusal.
 */
const NEXT: Readonly<Record<TaskState, readonly TaskState[]>> = {
  held: ["refused", "released", "disputed"],
  released: ["disputed"],
  refused: [],
  disputed: [],
};

/** The states a log written before 2026-10-09 moved a held-out task through, `held` itself, which
 *  returned one after a deadline, and the ladder's. Each leaves the task held out. */
const ONCE_HELD: ReadonlySet<string> = new Set([
  "held",
  "too-hard",
  "admitted",
  "too-easy",
  "wall-bound",
  LADDER,
]);

/** The recorded task admission number. A log written before 2026-10-09 holds three more a task, which
 *  say nothing of its shape. */
const ADMISSION_RECORD = 1;
interface TaskEvent {
  readonly index: number;
  readonly event: LogEvent;
}
const TASK_EVENT_CACHE = new WeakMap<
  readonly LogEvent[],
  { readonly length: number; readonly last: LogEvent | undefined; readonly list: readonly TaskEvent[] }
>();

function taskEventsOf(events: readonly LogEvent[]): readonly TaskEvent[] {
  const [last, cached] = [events.at(-1), TASK_EVENT_CACHE.get(events)];
  if (cached?.length === events.length && cached.last === last) return cached.list;
  const list: TaskEvent[] = [];
  for (const [index, event] of events.entries()) {
    if (foldsEvent(event.kind)) list.push({ index, event });
  }
  TASK_EVENT_CACHE.set(events, { length: events.length, last, list });
  return list;
}

/**
 * The shape check: every part is present, and every rule id is in the contract. A check
 * program none of whose checks applies to the family would pass any answer, and a check that
 * enforces a rule the task does not list holds the solver to a rule it was never shown. A check that
 * declares a hidden value of its own must find one in the task, and a declared path must read.
 */
export function packageGate(contract: Contract, task: TaskPackage): Passed | Refused {
  const reason = packageFault(contract, task);
  return reason === null ? { outcome: "passed" } : { outcome: "refused", reason };
}

function packageFault(contract: Contract, task: TaskPackage): string | null {
  const absent = (
    [
      ["family", task.family.trim() === ""],
      ["inputs", task.publicInput === null],
      ["rule ids", task.ruleIds.length === 0],
      [CHECK_BRIEF, !existsSync(join(task.checks, CHECK_BRIEF))],
      [EVALUATOR_FILE, !existsSync(join(task.checks, EVALUATOR_FILE))],
    ] as const
  ).find(([, missing]) => missing);
  if (absent !== undefined) return `no ${absent[0]}`;
  try {
    checkProgramFiles(task.checks);
  } catch (error) {
    return errorMessage(error);
  }
  const rules = new Set(contract.rules.map((rule) => rule.id));
  const unknown = task.ruleIds.find((id) => !rules.has(id));
  if (unknown !== undefined) return `rule ${unknown} is not in the contract`;
  let checks: ReturnType<typeof applicableTruthChecks>;
  try {
    checks = applicableTruthChecks(readBrief(task.checks), task);
  } catch (error) {
    return `the check's brief does not read: ${errorMessage(error)}`;
  }
  if (checks.length === 0) return `no check applies to family ${task.family}`;
  const listed = new Set(task.ruleIds);
  for (const check of checks) {
    // The brief is the author's, read unchecked: what it cites is proven here before it is trusted.
    const cited: unknown = check.citedDecisionIds;
    if (!Array.isArray(cited) || cited.length === 0 || !cited.every(isString)) {
      return `check ${check.id} cites no rule by id`;
    }
    const unlisted = cited.find((id) => !listed.has(id));
    if (unlisted !== undefined) {
      return `check ${check.id} enforces ${unlisted}, which the task does not list`;
    }
    // A check that needs a hidden value of its own and finds none cannot run, and the verifier
    // reads that as its own failure, which stops a run: the task's fault is caught here instead.
    try {
      checkEvaluationRequest(check, { publicTask: task, artifact: null, hidden: task.hidden });
    } catch (error) {
      return `the task gives check ${check.id} nothing to run on: ${errorMessage(error)}`;
    }
  }
  return null;
}

/**
 * The task version, taken when the package is proposed and its task admission runs: its five parts,
 * with the check program as the sha256 of each of its files by its path under the directory. Every
 * file counts, since the verifier copies them all into each check's cell: a check program may import
 * a helper beside `evaluator.ts`, which a version over that file alone would miss. A
 * program that does not read, a symlink in it among the reasons, is versioned by why, so task
 * admission's refusal is logged against what was proposed.
 */
export function taskVersion(task: TaskPackage): string {
  const { checks, ...parts } = task;
  let program: JsonValue;
  try {
    program = checkProgramVersion(checks);
  } catch (error) {
    program = { unreadable: errorMessage(error) };
  }
  return hashJsonValue({ ...parts, checks: program });
}

/** Whether the task states read an event of this kind. The log folds these as they are appended,
 *  so that no append can leave it unreadable. */
export function foldsEvent(kind: EventKind): boolean {
  return kind.startsWith("task.");
}

/**
 * Each task version's state, folded from the log: `task.proposed` holds it, a passing `task.gate`
 * makes it a held-out task, and `task.state` moves it. A history that proposes a task twice, puts
 * one to its task admission twice, moves one where it cannot go, or releases or disputes one whose package
 * never passed, is refused, as a line that is no event is.
 */
export function taskStates(events: readonly LogEvent[]): Map<string, TaskState> {
  return taskSets(events).states;
}

/** The same fold with the two sets beside the states, so that what is held out and what is
 *  practice are said in one place. */
export function taskSets(events: readonly LogEvent[], upTo = events.length - 1): TaskSets {
  const tasks = new Map<string, Folded>();
  for (const { index, event } of taskEventsOf(events)) {
    if (index > upTo) break;
    step(tasks, event);
  }
  const states = new Map<string, TaskState>();
  const held: string[] = [];
  const released: string[] = [];
  for (const [version, { state, admitted }] of tasks) {
    states.set(version, state);
    if (admitted && state === "held") held.push(version);
    else if (admitted && state === "released") released.push(version);
  }
  return { states, held, released };
}

function step(tasks: Map<string, Folded>, { at, kind, data }: LogEvent): void {
  const version = data.version;
  if (!isString(version)) throw new Error(`${at}: ${kind} names no task version`);
  const task = tasks.get(version);
  if (kind === "task.proposed") {
    if (task !== undefined) throw new Error(`${at}: task ${version} is proposed twice`);
    tasks.set(version, { state: "held", admitted: false });
    return;
  }
  if (task === undefined) throw new Error(`${at}: task ${version} is not proposed`);
  const fault = kind === "task.gate" ? admit(task, data) : kind === "task.state" ? move(task, data) : null;
  if (fault !== null) throw new Error(`${at}: task ${version} ${fault}`);
}

/** Whether a task admission's outcome held its task out: `passed`, or `ladder` in an old log. Every
 *  reader of a task admission's outcome asks this, so that an old ladder task is held out to each
 *  of them alike, and never held by one reader and left undrawn by another. */
export function heldAtGate(outcome: JsonValue | undefined): boolean {
  return outcome === "passed" || outcome === LADDER;
}

/** Each admitted task version, held (true) or refused (false) as its last `task.gate` reads. */
export function admissionsOf(events: readonly LogEvent[]): Map<string, boolean> {
  return new Map(
    taskEventsOf(events).flatMap(({ event: { kind, data } }) =>
      kind === "task.gate" && isString(data.version)
        ? [[data.version, heldAtGate(data.outcome)] as const]
        : [],
    ),
  );
}

/** A `task.gate` event on the task, or why the history may not log it. */
function admit(task: Folded, data: JsonObject): string | null {
  if (data.gate !== ADMISSION_RECORD) return null;
  if (task.admitted) return "logs its gate twice";
  task.admitted = heldAtGate(data.outcome);
  return null;
}

/** A `task.state` event on the task, or why the history may not log it. */
function move(task: Folded, data: JsonObject): string | null {
  const named = isString(data.state) ? data.state : "";
  const to = ONCE_HELD.has(named) ? "held" : TASK_STATES.find((state) => state === named);
  const from = task.state;
  if (to === undefined || (to === "held" ? from !== "held" : !NEXT[from].includes(to))) {
    return `cannot go from ${from} to ${to === undefined ? "no known state" : named}`;
  }
  if (to !== "refused" && to !== "held" && !task.admitted) {
    return `cannot go from ${from} to ${to} before its gate passed`;
  }
  task.state = to;
  return null;
}
