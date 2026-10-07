/**
 * A task: a package of six parts, scored only after five gates.
 *
 * The statement, the inputs, the rule ids and the family are what the solver reads. The check is a
 * program it never sees, with hidden values only the check's own runs receive. The reject controls
 * come last: three one-fact edits of the answer gate 2 accepted, each of which the check must fail.
 *
 * Gate 1 checks the package's shape, gate 2 is a pass by the stronger condition, gate 3 reruns the
 * check on that pass, and gate 4 runs the controls. A task that clears gates 1 to 4 is feasible, and
 * gate 5 screens it: it is admitted when at least one of the two harnesses fails it under the test
 * condition. Screening only chooses what is scored, so its solves never count in a score. Each task
 * version's state is a view over the log.
 *
 * The pair is the model pair: the one thing the stronger condition changes is the solver. The budget
 * pair is cut as a bracket, since on truss no test-side solve passed within one budget and it
 * admitted every task that reached it; cost stays a reported column.
 *
 * Departure from the plan, which hashes statement, inputs, check and controls into the task
 * version at gate 1: the version here also covers the rule ids and the family, since the solver
 * reads both, and leaves out the controls. They do not exist until after gate 2, and neither a solve
 * nor a verdict reads them, so they cannot change a result. Gate 4 logs their digest instead, so an
 * admission names the control set it rested on.
 */
import { sha256OfFile } from "../meta/digest.ts";
import { existsSync } from "../meta/filesystem.ts";
import { type JsonValue, isString } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue, stableJson } from "../meta/stable-json.ts";
import type { Contract } from "./contract.ts";
import type { LogEvent } from "./log.ts";
import type { Counted } from "./solve.ts";
import { applicableTruthChecks, decided, readBrief, type Task, type Verifier } from "./verify.ts";

/** The task's public part and its hidden values, as the verifier takes them, with the rest. */
export interface TaskPackage extends Task {
  /** What is asked, in the contract's terms. */
  readonly statement: string;
  /** The contract rules the check enforces. */
  readonly ruleIds: readonly string[];
  /** The check program's directory: its `brief.json` and its `evaluator.ts`. */
  readonly checks: string;
}

/** A gate passes or refuses. A verifier's non-result is neither: it stops the run (see `decided`). */
type Passed = { readonly outcome: "passed" };
type Refused = { readonly outcome: "refused"; readonly reason: string };

/** Gate 5's outcome. A task the stronger condition failed never reaches it: gate 2 marks it too hard. */
export type Screening = "admitted" | "too-easy" | "wall-bound";

/** Reruns of the check on the accepted answer at gate 3. Gate 2 passed it, so each must pass too. */
const DETERMINISM_RUNS = 2;

/** Reject controls a task carries. */
export const CONTROLS = 3;

/**
 * The states of a task version. `wall-bound` is not one of the plan's: a task whose only screening
 * fails ended at the wall is neither too easy nor admitted. Whether it may be admitted is the
 * operator's decision 21, held until the sweep's non-passes are counted by kind.
 */
export const TASK_STATES = [
  "held",
  "refused",
  "too-hard",
  "too-easy",
  "wall-bound",
  "admitted",
  "released",
  "disputed",
  "stale",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/**
 * Where each state may go. Round 0 releases feasible tasks unscreened, so a held task may be released,
 * though only once the anchor is drawn, so no anchor task is ever released. A released task is never
 * scored: the comparison, when it is built, refuses one.
 */
const NEXT: Readonly<Record<TaskState, readonly TaskState[]>> = {
  held: ["refused", "too-hard", "too-easy", "wall-bound", "admitted", "released", "stale"],
  admitted: ["released", "disputed", "stale"],
  refused: [],
  "too-hard": [],
  "too-easy": [],
  "wall-bound": [],
  released: [],
  disputed: [],
  stale: [],
};

/** States only a feasible task reaches, and the gates that make it feasible. */
const NEEDS_FEASIBLE: ReadonlySet<TaskState> = new Set(["too-easy", "wall-bound", "admitted", "released"]);
const FEASIBLE_GATES = [1, 2, 3, 4];

/**
 * Gate 1, shape: every part but the controls is present, and every rule id is in the contract. A check
 * program none of whose checks applies to the family would pass any answer, and a check that
 * enforces a rule the task does not list holds the solver to a rule it was never shown.
 */
export function packageGate(contract: Contract, task: TaskPackage): Passed | Refused {
  const reason = packageFault(contract, task);
  return reason === null ? { outcome: "passed" } : { outcome: "refused", reason };
}

function packageFault(contract: Contract, task: TaskPackage): string | null {
  const absent = (
    [
      ["statement", task.statement.trim() === ""],
      ["family", task.family.trim() === ""],
      ["inputs", task.publicInput === null],
      ["rule ids", task.ruleIds.length === 0],
      ["brief.json", !existsSync(join(task.checks, "brief.json"))],
      ["evaluator.ts", !existsSync(join(task.checks, "evaluator.ts"))],
    ] as const
  ).find(([, missing]) => missing);
  if (absent !== undefined) return `no ${absent[0]}`;
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
  }
  return null;
}

/**
 * The task version, taken when the package is proposed and gate 1 runs: its five parts, with the
 * check program as the digests of its two files. A package missing one still has a version, so its
 * refusal is logged against what was proposed.
 */
export function taskVersion(task: TaskPackage): string {
  const { checks, ...parts } = task;
  const digest = (file: string) => {
    const path = join(checks, file);
    return existsSync(path) ? sha256OfFile(path) : null;
  };
  return hashJsonValue({ ...parts, brief: digest("brief.json"), evaluator: digest("evaluator.ts") });
}

/** Gate 3: the check returns the pass gate 2 gave the accepted answer, on each of two more runs. */
export async function determinismGate(
  verify: Verifier,
  task: Task,
  accepted: JsonValue,
): Promise<Passed | Refused> {
  for (let run = 1; run <= DETERMINISM_RUNS; run += 1) {
    const verdict = await decided(verify, task, accepted);
    if (verdict.kind === "fail") {
      return {
        outcome: "refused",
        reason: `run ${run} failed the accepted answer on ${verdict.blocking.join(", ")}`,
      };
    }
  }
  return { outcome: "passed" };
}

/**
 * Gate 4: three controls, each an edit of the accepted answer and no two alike, and the check fails
 * every one. Whether an edit changes exactly one fact is the Examiner's to get right; a control that
 * changes more only fails for more reasons. A pass names the controls by their digest.
 */
export async function controlsGate(
  verify: Verifier,
  task: Task,
  accepted: JsonValue,
  controls: readonly JsonValue[],
): Promise<(Passed & { readonly controls: string }) | Refused> {
  if (controls.length !== CONTROLS) {
    return { outcome: "refused", reason: `controls: ${controls.length}, not ${CONTROLS}` };
  }
  const answers = [accepted, ...controls].map((answer) => stableJson(answer));
  if (new Set(answers).size < answers.length) {
    return { outcome: "refused", reason: "a control repeats the accepted answer or another control" };
  }
  for (const [index, control] of controls.entries()) {
    if ((await decided(verify, task, control)).kind === "pass") {
      return { outcome: "refused", reason: `the check passed control ${index + 1}` };
    }
  }
  return { outcome: "passed", controls: hashJsonValue(controls) };
}

/**
 * Gate 5: each harness's solve under the test condition. A task is admitted when at least one fails,
 * and is wall-bound when every fail ended at the wall.
 */
export function screen(tests: readonly [Counted, Counted]): Screening {
  const fails = tests.flatMap((solve) => (solve.outcome === "fail" ? [solve.kind] : []));
  if (fails.length === 0) return "too-easy";
  return fails.every((kind) => kind === "wall-ended") ? "wall-bound" : "admitted";
}

/**
 * Each task version's state, folded from the log: `task.proposed` holds it, a passing `task.gate`
 * clears a gate, and `task.state` moves it. A history that moves a task where it cannot go, screens
 * a task that is not feasible, passes gate 4 on no named control set, or releases a task before
 * `anchor.drawn`, is refused, as a torn line is.
 */
export function taskStates(events: readonly LogEvent[]): Map<string, TaskState> {
  const tasks = new Map<string, { state: TaskState; readonly cleared: Set<number> }>();
  let anchored = false;
  for (const { at, kind, data } of events) {
    if (kind === "anchor.drawn") anchored = true;
    if (!kind.startsWith("task.")) continue;
    const version = data.version;
    if (!isString(version)) throw new Error(`${at}: ${kind} names no task version`);
    const task = tasks.get(version);
    if (kind === "task.proposed") {
      if (task !== undefined) throw new Error(`${at}: task ${version} is proposed twice`);
      tasks.set(version, { state: "held", cleared: new Set() });
      continue;
    }
    if (task === undefined) throw new Error(`${at}: task ${version} is not proposed`);
    if (kind === "task.gate" && data.outcome === "passed") {
      const gate = Number(data.gate);
      if (gate === 4 && !isString(data.controls)) {
        throw new Error(`${at}: task ${version} passed gate 4 on no named control set`);
      }
      task.cleared.add(gate);
    } else if (kind === "task.state") {
      const to = TASK_STATES.find((state) => state === data.state);
      const feasible = FEASIBLE_GATES.every((gate) => task.cleared.has(gate));
      if (to === undefined || !NEXT[task.state].includes(to) || (NEEDS_FEASIBLE.has(to) && !feasible)) {
        throw new Error(`${at}: task ${version} cannot go from ${task.state} to ${to ?? "no known state"}`);
      }
      if (to === "released" && !anchored) {
        throw new Error(`${at}: task ${version} is released before the anchor is drawn`);
      }
      task.state = to;
    }
  }
  return new Map([...tasks].map(([version, task]) => [version, task.state]));
}
