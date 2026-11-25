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

export interface TaskPackage extends Task {
  readonly ruleIds: readonly string[];
  readonly checks: string;
}

interface Passed {
  readonly outcome: "passed";
}
interface Refused {
  readonly outcome: "refused";
  readonly reason: string;
}

interface Folded {
  state: TaskState;
  admitted: boolean;
}

interface TaskSets {
  readonly states: Map<string, TaskState>;
  readonly held: readonly string[];
  readonly released: readonly string[];
}

const LADDER = "ladder";
const TASK_STATES = ["held", "refused", "released", "disputed"] as const;

type TaskState = (typeof TASK_STATES)[number];

const NEXT: Readonly<Record<TaskState, readonly TaskState[]>> = {
  held: ["refused", "released", "disputed"],
  released: ["disputed"],
  refused: [],
  disputed: [],
};

const ONCE_HELD: ReadonlySet<string> = new Set([
  "held",
  "too-hard",
  "admitted",
  "too-easy",
  "wall-bound",
  LADDER,
]);

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
    const cited: unknown = check.citedDecisionIds;
    if (!Array.isArray(cited) || cited.length === 0 || !cited.every(isString)) {
      return `check ${check.id} cites no rule by id`;
    }
    const unlisted = cited.find((id) => !listed.has(id));
    if (unlisted !== undefined) {
      return `check ${check.id} enforces ${unlisted}, which the task does not list`;
    }
    try {
      checkEvaluationRequest(check, { publicTask: task, artifact: null, hidden: task.hidden });
    } catch (error) {
      return `the task gives check ${check.id} nothing to run on: ${errorMessage(error)}`;
    }
  }
  return null;
}

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

export function foldsEvent(kind: EventKind): boolean {
  return kind.startsWith("task.");
}

export function taskStates(events: readonly LogEvent[], upTo = events.length - 1): Map<string, TaskState> {
  return taskSets(events, upTo).states;
}

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

export function heldAtGate(outcome: JsonValue | undefined): boolean {
  return outcome === "passed" || outcome === LADDER;
}

export function admissionsOf(events: readonly LogEvent[]): Map<string, boolean> {
  return new Map(
    taskEventsOf(events).flatMap(({ event: { kind, data } }) =>
      kind === "task.gate" && isString(data.version)
        ? [[data.version, heldAtGate(data.outcome)] as const]
        : [],
    ),
  );
}

function admit(task: Folded, data: JsonObject): string | null {
  if (data.gate !== ADMISSION_RECORD) return null;
  if (task.admitted) return "logs its gate twice";
  task.admitted = heldAtGate(data.outcome);
  return null;
}

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
