/**
 * A task: a package of five parts, held out once its shape passes one gate.
 *
 * The id, the family and the inputs are what the solver reads; the rule ids are the contract rules
 * the check enforces, which the gate holds it to. The check is a program the solver never sees,
 * with hidden values only the check's own runs receive.
 *
 * A task whose package passes the gate is a held-out task: every comparison may score it
 * (`compare.ts`), and no solve chooses whether it does. It leaves that set three ways. It is
 * released to a Builder as practice, and a practice task is never scored. It is disputed when a
 * check is found at fault on an answer to it, from either set, and is then neither scored nor
 * practised on. Or its package is refused at the gate, and it never was one. Each task version's
 * state is a view over the log.
 *
 * Until 2026-10-09 a task met five gates. Gate 2 was one solve by a stronger solver, whose pass
 * was the witness that the task could be done; gate 3 ran the checks again on that answer; gate 4
 * ran three reject controls its author wrote as edits of it; gate 5 screened it under two
 * harnesses and admitted it when one of them failed it. The plan after the v1 review removes all
 * four (`docs/plan.md`, Phase 2, and `docs/v1.md` for what v1 measured):
 *
 * - No stronger solver proves a task possible. v1's solver matched whatever its author's side
 *   found, and the first live sessions here lost 14 of 25 tasks at gate 2. A task no solve has
 *   answered validly is held out like any other and ties until one does.
 * - The reject controls are the check program's and are read once for it (`tools/c/accept.ts`),
 *   where they were written per task from the stronger solve's answer.
 * - Nothing selects tasks by pass or fail. The comparison pairs every solve of two harnesses on
 *   the stated objective, so a task both harnesses pass can still separate them.
 *
 * A log written before that holds the old gates and the states screening moved a task through:
 * `too-hard`, `admitted`, `too-easy`, `wall-bound`, and the anchor's draw. They are read here as
 * history. A later gate says nothing of a task's shape, and each of those states leaves the task
 * what it was, a held-out task; a refusal one of the later gates led to stands, since its state
 * was logged beside it. No command writes any of them now.
 *
 * Departure from the plan, which hashes statement, inputs, check and controls into the task
 * version: a task carries no statement, since v1's tasks have none and a stand-in would be hashed
 * without a reader; the version covers the family, which the solver reads, and the rule ids, which
 * the gate holds the check to.
 */
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

/** The gate passes or refuses. */
type Passed = { readonly outcome: "passed" };
type Refused = { readonly outcome: "refused"; readonly reason: string };

/** A task version as the fold holds it: its state, and whether its package passed the gate. */
interface Folded {
  state: TaskState;
  gated: boolean;
}

/** What a log holds of its tasks, from the one fold: each version's state, and the two sets every
 *  command of a campaign asks for, in the order their tasks were proposed. */
export interface TaskSets {
  readonly states: Map<string, TaskState>;
  /** The held-out tasks: gated, and neither released, disputed nor refused. */
  readonly held: readonly string[];
  /** The practice tasks. */
  readonly released: readonly string[];
}

export const TASK_STATES = ["held", "refused", "released", "disputed"] as const;

export type TaskState = (typeof TASK_STATES)[number];

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

/** The states a log written before 2026-10-09 moved a held-out task through, and `held` itself,
 *  which returned one from the wall. Each leaves the task held out. */
const ONCE_HELD: ReadonlySet<string> = new Set(["held", "too-hard", "admitted", "too-easy", "wall-bound"]);

/** The gate a package is put to. A log written before 2026-10-09 holds three more a task, which
 *  say nothing of its shape. */
const GATE = 1;

/**
 * The gate, on a package's shape: every part is present, and every rule id is in the contract. A check
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
      ["brief.json", !existsSync(join(task.checks, "brief.json"))],
      ["evaluator.ts", !existsSync(join(task.checks, "evaluator.ts"))],
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
  for (const check of checks) {
    // The brief is the author's, read unchecked: what it cites is proven here before it is trusted.
    const cited: unknown = check.citedDecisionIds;
    if (!Array.isArray(cited) || cited.length === 0 || !cited.every(isString)) {
      return `check ${check.id} cites no rule by id`;
    }
    const unlisted = cited.find((id) => !task.ruleIds.includes(id));
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
 * The task version, taken when the package is proposed and its gate runs: its five parts, with the check
 * program as the sha256 of each of its files by its path under the directory. Every file counts,
 * since the verifier copies them all into each check's cell: both check programs v1 wrote on 7
 * October import `./reference/model.ts`, and a version over `evaluator.ts` alone missed it. A
 * program that does not read, a symlink in it among the reasons, is versioned by why, so the gate's
 * refusal is logged against what was proposed.
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
 * one to its gate twice, moves one where it cannot go, or releases or disputes one whose package
 * never passed, is refused, as a torn line is.
 */
export function taskStates(events: readonly LogEvent[]): Map<string, TaskState> {
  return taskSets(events).states;
}

/** The same fold with the two sets beside the states, so that what is held out and what is
 *  practice are said in one place. */
export function taskSets(events: readonly LogEvent[]): TaskSets {
  const tasks = new Map<string, Folded>();
  for (const event of events) step(tasks, event);
  const inState = (wanted: TaskState) =>
    [...tasks].flatMap(([version, task]) => (task.gated && task.state === wanted ? [version] : []));
  return {
    states: new Map([...tasks].map(([version, task]) => [version, task.state])),
    held: inState("held"),
    released: inState("released"),
  };
}

function step(tasks: Map<string, Folded>, { at, kind, data }: LogEvent): void {
  if (!foldsEvent(kind)) return;
  const version = data.version;
  if (!isString(version)) throw new Error(`${at}: ${kind} names no task version`);
  const task = tasks.get(version);
  if (kind === "task.proposed") {
    if (task !== undefined) throw new Error(`${at}: task ${version} is proposed twice`);
    tasks.set(version, { state: "held", gated: false });
    return;
  }
  if (task === undefined) throw new Error(`${at}: task ${version} is not proposed`);
  const fault = kind === "task.gate" ? gate(task, data) : kind === "task.state" ? move(task, data) : null;
  if (fault !== null) throw new Error(`${at}: task ${version} ${fault}`);
}

/** A `task.gate` event on the task, or why the history may not log it. */
function gate(task: Folded, data: JsonObject): string | null {
  if (data.gate !== GATE) return null;
  if (task.gated) return "logs its gate twice";
  task.gated = data.outcome === "passed";
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
  if (to !== "refused" && to !== "held" && !task.gated) {
    return `cannot go from ${from} to ${to} before its gate passed`;
  }
  task.state = to;
  return null;
}
