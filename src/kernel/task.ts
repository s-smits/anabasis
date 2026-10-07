/**
 * A task: a package of six parts, scored only after five gates.
 *
 * The statement, the inputs, the rule ids and the family are what the solver reads. The check is a
 * program it never sees, with hidden values only the check's own runs receive. The reject controls
 * come last: three one-fact edits of the answer gate 2 accepted, each of which the check must fail.
 *
 * Gates 1, 3 and 4, shape, determinism and controls, are here; gates 2 and 5, the stronger solve
 * and screening, are the bracket's. A task that clears gates 1 to 4 is feasible, and a feasible task
 * that clears gate 5 is admitted. Each task version's state is a view over the log.
 *
 * Departure from the plan, which hashes statement, inputs, check and controls into the task
 * version at gate 1: the version here also covers the rule ids and the family, since the solver
 * reads both, and leaves out the controls. They do not exist until after gate 2, and neither a solve
 * nor a verdict reads them, so they cannot change a result.
 */
import { sha256OfFile } from "../meta/digest.ts";
import { existsSync } from "../meta/filesystem.ts";
import { type JsonValue, isString } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue, stableJson } from "../meta/stable-json.ts";
import type { Contract } from "./contract.ts";
import type { LogEvent } from "./log.ts";
import { applicableTruthChecks, readBrief, type Task, type Verifier } from "./verify.ts";

/** The task's public part and its hidden values, as the verifier takes them, with the rest. */
export interface TaskPackage extends Task {
  /** What is asked, in the contract's terms. */
  readonly statement: string;
  /** The contract rules the check enforces. */
  readonly ruleIds: readonly string[];
  /** The check program's directory: its `brief.json` and its `evaluator.ts`. */
  readonly checks: string;
}

type Passed = { readonly outcome: "passed" };
type Refused = { readonly outcome: "refused"; readonly reason: string };

/** A gate's outcome. A non-result is the verifier's failure, not the task's, and gate 1 runs none. */
export type GateResult = Passed | Refused | { readonly outcome: "non-result"; readonly reason: string };

/** Reruns of the check on the accepted answer at gate 3. Gate 2 passed it, so each must pass too. */
const DETERMINISM_RUNS = 2;

/** Reject controls a task carries. */
export const CONTROLS = 3;

/**
 * The states of a task version. `wall-bound` is not one of the plan's: under the model pair, a task
 * whose only screening fails ran to the wall is neither too easy nor admitted.
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

/** Where each state may go. Round 0 releases feasible tasks unscreened, so a held task may be released. */
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
): Promise<GateResult> {
  for (let run = 1; run <= DETERMINISM_RUNS; run += 1) {
    const verdict = await verify(task, accepted);
    if (verdict.kind === "non-result") return { outcome: "non-result", reason: verdict.reason };
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
 * changes more only fails for more reasons.
 */
export async function controlsGate(
  verify: Verifier,
  task: Task,
  accepted: JsonValue,
  controls: readonly JsonValue[],
): Promise<GateResult> {
  if (controls.length !== CONTROLS) {
    return { outcome: "refused", reason: `controls: ${controls.length}, not ${CONTROLS}` };
  }
  const answers = [accepted, ...controls].map((answer) => stableJson(answer));
  if (new Set(answers).size < answers.length) {
    return { outcome: "refused", reason: "a control repeats the accepted answer or another control" };
  }
  for (const [index, control] of controls.entries()) {
    const verdict = await verify(task, control);
    if (verdict.kind === "non-result") return { outcome: "non-result", reason: verdict.reason };
    if (verdict.kind === "pass") {
      return { outcome: "refused", reason: `the check passed control ${index + 1}` };
    }
  }
  return { outcome: "passed" };
}

/**
 * Each task version's state, folded from the log: `task.proposed` holds it, a passing `task.gate`
 * clears a gate, and `task.state` moves it. A history that moves a task where it cannot go, or
 * screens a task that is not feasible, is refused, as a torn line is.
 */
export function taskStates(events: readonly LogEvent[]): Map<string, TaskState> {
  const states = new Map<string, TaskState>();
  const cleared = new Map<string, Set<number>>();
  for (const { at, kind, data } of events.filter((event) => event.kind.startsWith("task."))) {
    const version = data.version;
    if (!isString(version)) throw new Error(`${at}: ${kind} names no task version`);
    if (kind === "task.proposed") {
      if (states.has(version)) throw new Error(`${at}: task ${version} is proposed twice`);
      states.set(version, "held");
      cleared.set(version, new Set());
    } else if (kind === "task.gate" && data.outcome === "passed") {
      cleared.get(version)?.add(Number(data.gate));
    } else if (kind === "task.state") {
      const from = states.get(version);
      const to = TASK_STATES.find((state) => state === data.state);
      const feasible = FEASIBLE_GATES.every((gate) => cleared.get(version)?.has(gate) === true);
      if (
        from === undefined ||
        to === undefined ||
        !NEXT[from].includes(to) ||
        (NEEDS_FEASIBLE.has(to) && !feasible)
      ) {
        throw new Error(
          `${at}: task ${version} cannot go from ${from ?? "unproposed"} to ${to ?? "no known state"}`,
        );
      }
      states.set(version, to);
    }
  }
  return states;
}
