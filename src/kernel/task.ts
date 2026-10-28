/**
 * Examiner task admission checks a package's shape, then runs room solves under the reference harness.
 *
 * The id, the family and the inputs are what the solver reads; the rule ids are the contract rules
 * the check enforces, which the shape check holds it to. The check is a program the solver never sees,
 * with hidden values only the check's own runs receive.
 *
 * A draft is held out when its shape check passes and its room solves leave room (`src/examiner/write.ts`).
 * Every comparison may score it (`compare.ts`). It leaves that set three ways. It is
 * released to a Builder as practice, and a practice task is never scored. It is disputed when a
 * check is found at fault on an answer to it, from either set, and is then neither scored nor
 * practised on. Or task admission refuses the draft, and it never was one. Each task version's
 * state is a view over the log.
 *
 * A log of 14 to 16 October may hold a draft held for the ladder by task admission, a fixed set read only
 * after a promotion: its admission outcome and its state are `ladder`. The ladder was retired on
 * 16 October (`src/examiner/write.ts`), and such a task is read as held out.
 *
 * Room solves use the campaign's solver, never a stronger one. v1's solver matched whatever its
 * author's side found, and the first live sessions here lost 14 of 25 tasks at an admission test
 * of one stronger solve (`7f0add79:docs/plan.md`, Phase 2; `docs/v1.md`). Up to three reference
 * solves now refuse a draft that leaves no room: it needs variation in validity, a known valid
 * answer where the reference never answers, or an objective gap. Both harnesses later solve the
 * same scored tasks under one compute budget. Reject control answers belong to the check program
 * and are read once for it (`tools/c/accept.ts`), rather than written per task.
 *
 * A log written before 9 October holds four later admission tests (a stronger solve, the checks run again
 * on its answer, three reject control answers, and a screening under two harnesses) and the states
 * screening moved a task through: `too-hard`, `admitted`, `too-easy`, `wall-bound`, and the
 * anchor's draw. They are read here as history. A later admission test says nothing of a task's shape, and
 * each of those states leaves the task what it was, a held-out task; a refusal one of the later
 * admission tests led to stands, since its state was logged beside it. No command writes any of them now.
 *
 * Departure from the plan, which hashes statement, inputs, check and control answers into the task
 * version: a task carries no statement, since v1's tasks have none and a stand-in would be hashed
 * without a reader; the version covers the family, which the solver reads, and the rule ids, which
 * the shape check holds the check to.
 */
import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";
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
type Passed = { readonly outcome: "passed" };
type Refused = { readonly outcome: "refused"; readonly reason: string };

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

/** The task admission's outcome, and the state, of a task held for the ladder until 16 October. */
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
      ["brief.json", !existsSync(join(task.checks, "brief.json"))],
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
 * The task version, taken when the package is proposed and its task admission runs: its five parts,
 * with the check program as the sha256 of each of its files by its path under the directory. Every
 * file counts, since the verifier copies them all into each check's cell: both check programs v1 wrote
 * on 7 October import `./reference/model.ts`, and a version over `evaluator.ts` alone missed it. A
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
    [...tasks].flatMap(([version, task]) => (task.admitted && task.state === wanted ? [version] : []));
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
    tasks.set(version, { state: "held", admitted: false });
    return;
  }
  if (task === undefined) throw new Error(`${at}: task ${version} is not proposed`);
  const fault = kind === "task.gate" ? admit(task, data) : kind === "task.state" ? move(task, data) : null;
  if (fault !== null) throw new Error(`${at}: task ${version} ${fault}`);
}

/** Whether a task admission's outcome held its task out: `passed`, or `ladder` in a log of 14 to
 *  16 October. Every reader of a task admission's outcome asks this, so that an old ladder task is held out
 *  to each of them alike (16 October: the draw, the epochs and the Examiner's counts read `passed`
 *  alone, and such a task was held and never drawn). */
export function heldAtGate(outcome: JsonValue | undefined): boolean {
  return outcome === "passed" || outcome === LADDER;
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
