/**
 * A task: a package of six parts, scored only after five gates.
 *
 * The statement, the inputs, the rule ids and the family are what the solver reads. The check is a
 * program it never sees, with hidden values only the check's own runs receive. The reject controls
 * come last: three one-fact edits of the answer gate 2 accepted, each naming the check it must fail.
 *
 * Gate 1 checks the package's shape, gate 2 is a pass by the stronger condition, gate 3 reruns the
 * check on that pass, and gate 4 runs the controls. A task that clears gates 1 to 4 is feasible, and
 * gate 5 screens it: it is admitted when at least one of the two harnesses fails it under the test
 * condition. Screening only chooses what is scored, so its solves never count in a score. Each task
 * version's state is a view over the log.
 *
 * The gates run in order and a gate that does not pass ends them: gate n passes only after gates 1 to
 * n - 1 have, and no gate is logged after one that did not pass. The task stays held until a state
 * event moves it, and it can never be feasible, so `refused` or `too-hard` is where it can go. A
 * reviewer's probe logged the four gates in reverse and then refused gate 3, and the old fold, which
 * kept a set of cleared gates, still admitted the task.
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
import { type JsonObject, type JsonValue, isString } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue, stableJson } from "../meta/stable-json.ts";
import { answerFormatFault, type Contract } from "./contract.ts";
import type { EventKind, LogEvent } from "./log.ts";
import type { Counted } from "./solve.ts";
import {
  applicableTruthChecks,
  checkProgramFiles,
  decided,
  readBrief,
  type Task,
  type Verifier,
} from "./verify.ts";

/** The task's public part and its hidden values, as the verifier takes them, with the rest. */
export interface TaskPackage extends Task {
  /** What is asked, in the contract's terms. */
  readonly statement: string;
  /** The contract rules the check enforces. */
  readonly ruleIds: readonly string[];
  /** The check program's directory: its `brief.json`, its `evaluator.ts` and whatever they read. */
  readonly checks: string;
}

/** A reject control: an edit of the accepted answer, and the check it must fail. v1 tied each of
 *  its reject controls to one check the same way, by the `expectedCheckId` of its `controls.json`. */
export interface RejectControl {
  readonly answer: JsonValue;
  readonly expectedCheckId: string;
}

/** A gate passes or refuses. A verifier's non-result is neither: it stops the run (see `decided`). */
type Passed = { readonly outcome: "passed" };
type Refused = { readonly outcome: "refused"; readonly reason: string };

/** A task version as the fold holds it: its state, how many gates it passed in order, and whether a
 *  gate that did not pass ended them. */
interface Folded {
  state: TaskState;
  passed: number;
  ended: boolean;
}

/** The fold so far: each task version, and the versions the anchor drew, null until it is drawn. */
interface Fold {
  readonly tasks: Map<string, Folded>;
  drawn: Set<string> | null;
}

/** Gate 5's outcome. A task the stronger condition failed never reaches it: gate 2 marks it too hard. */
export type Screening = "admitted" | "too-easy" | "wall-bound";

/** Reruns of the check on the accepted answer at gate 3. Gate 2 passed it, so each must pass too. */
const DETERMINISM_RUNS = 2;

/** Reject controls a task carries. */
export const CONTROLS = 3;

/** The gates logged as `task.gate`. Gate 5 is screening, and its outcome is the state it logs. */
const LOGGED_GATES = 4;

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
 * though only once the anchor is drawn and never one the draw named: `anchor.drawn` lists the task
 * versions it drew, and the fold refuses a release of any of them. A released task is never scored:
 * the comparison, when it is built, refuses one.
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

/** States only a feasible task reaches, one that passed every logged gate. */
const NEEDS_FEASIBLE: ReadonlySet<TaskState> = new Set(["too-easy", "wall-bound", "admitted", "released"]);

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
  }
  return null;
}

/**
 * The task version, taken when the package is proposed and gate 1 runs: its five parts, with the check
 * program as the sha256 of each of its files by its path under the directory. Every file counts,
 * since the verifier copies them all into each check's cell: both check programs v1 wrote on 7
 * October import `./reference/model.ts`, and a version over `evaluator.ts` alone missed it. A
 * program that does not read, a symlink in it among the reasons, is versioned by why, so gate 1's
 * refusal is logged against what was proposed.
 */
export function taskVersion(task: TaskPackage): string {
  const { checks, ...parts } = task;
  let program: JsonValue;
  try {
    program = Object.fromEntries(
      checkProgramFiles(checks).map((file) => [file, sha256OfFile(join(checks, file))]),
    );
  } catch (error) {
    program = { unreadable: errorMessage(error) };
  }
  return hashJsonValue({ ...parts, checks: program });
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
 * Gate 4: three controls, each an edit of the accepted answer in the contract's format and no two
 * alike, and each failed by the check it names. Failing is not enough: a reviewer's probe passed the
 * gate on three junk answers, which every check fails for a reason no control was written to test.
 * A control outside the format is refused before any check reads it, since a check that throws on a
 * malformed answer is a verifier non-result, which would stop the run over the Examiner's mistake.
 * Whether an edit changes exactly one fact is the Examiner's to get right. A pass names the
 * controls by their digest.
 */
export async function controlsGate(
  contract: Contract,
  verify: Verifier,
  task: Task,
  accepted: JsonValue,
  controls: readonly RejectControl[],
): Promise<(Passed & { readonly controls: string }) | Refused> {
  const refused = (reason: string): Refused => ({ outcome: "refused", reason });
  if (controls.length !== CONTROLS) return refused(`controls: ${controls.length}, not ${CONTROLS}`);
  const answers = [accepted, ...controls.map((control) => control.answer)].map((answer) =>
    stableJson(answer),
  );
  if (new Set(answers).size < answers.length) {
    return refused("a control repeats the accepted answer or another control");
  }
  const malformed = controls.findIndex((control) => answerFormatFault(contract, control.answer) !== null);
  if (malformed !== -1) return refused(`control ${malformed + 1} does not follow the answer format`);
  for (const [index, { answer, expectedCheckId }] of controls.entries()) {
    const verdict = await decided(verify, task, answer);
    if (verdict.kind === "pass") return refused(`the check passed control ${index + 1}`);
    if (!verdict.blocking.includes(expectedCheckId)) {
      return refused(`control ${index + 1} failed ${verdict.blocking.join(", ")}, not ${expectedCheckId}`);
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

/** Whether the task states read an event of this kind. The log folds these as they are appended,
 *  so that no append can leave it unreadable. */
export function foldsEvent(kind: EventKind): boolean {
  return kind === "anchor.drawn" || kind.startsWith("task.");
}

/**
 * Each task version's state, folded from the log: `task.proposed` holds it, a passing `task.gate`
 * clears the next gate, and `task.state` moves it. A history that moves a task where it cannot go,
 * screens a task that is not feasible, logs its gates out of order or after one did not pass, passes
 * gate 4 on no named control set, draws a task not yet feasible into the anchor, or releases a task
 * before `anchor.drawn` or one the anchor drew, is refused, as a torn line is.
 */
export function taskStates(events: readonly LogEvent[]): Map<string, TaskState> {
  const fold: Fold = { tasks: new Map(), drawn: null };
  for (const event of events) step(fold, event);
  return new Map([...fold.tasks].map(([version, task]) => [version, task.state]));
}

function step(fold: Fold, { at, kind, data }: LogEvent): void {
  if (kind === "anchor.drawn") {
    draw(fold, at, data);
    return;
  }
  if (!foldsEvent(kind)) return;
  const version = data.version;
  if (!isString(version)) throw new Error(`${at}: ${kind} names no task version`);
  const task = fold.tasks.get(version);
  if (kind === "task.proposed") {
    if (task !== undefined) throw new Error(`${at}: task ${version} is proposed twice`);
    fold.tasks.set(version, { state: "held", passed: 0, ended: false });
    return;
  }
  if (task === undefined) throw new Error(`${at}: task ${version} is not proposed`);
  const fault =
    kind === "task.gate" ? gate(task, data) : kind === "task.state" ? move(fold, version, task, data) : null;
  if (fault !== null) throw new Error(`${at}: task ${version} ${fault}`);
}

function draw(fold: Fold, at: string, data: JsonObject): void {
  const versions = data.tasks;
  if (!Array.isArray(versions) || !versions.every(isString)) {
    throw new Error(`${at}: anchor.drawn names no task versions`);
  }
  const unfit = versions.find((version) => fold.tasks.get(version)?.passed !== LOGGED_GATES);
  if (unfit !== undefined) throw new Error(`${at}: task ${unfit} is drawn before it is feasible`);
  const released = versions.find((version) => fold.tasks.get(version)?.state === "released");
  if (released !== undefined) throw new Error(`${at}: task ${released} is drawn after its release`);
  fold.drawn = new Set([...(fold.drawn ?? []), ...versions]);
}

/** A `task.gate` event on the task, or why the history may not log it. */
function gate(task: Folded, data: JsonObject): string | null {
  const number = Number(data.gate);
  if (task.state !== "held" || task.ended) return `logs gate ${number} after its gates ended`;
  if (number !== task.passed + 1 || number > LOGGED_GATES) {
    return `logs gate ${number} out of order, after passing ${task.passed}`;
  }
  if (data.outcome !== "passed") {
    task.ended = true;
    return null;
  }
  if (number === LOGGED_GATES && !isString(data.controls)) return "passed gate 4 on no named control set";
  task.passed = number;
  return null;
}

/** A `task.state` event on the task, or why the history may not log it. */
function move(fold: Fold, version: string, task: Folded, data: JsonObject): string | null {
  const to = TASK_STATES.find((state) => state === data.state);
  const feasible = task.passed === LOGGED_GATES;
  if (to === undefined || !NEXT[task.state].includes(to) || (NEEDS_FEASIBLE.has(to) && !feasible)) {
    return `cannot go from ${task.state} to ${to ?? "no known state"}`;
  }
  if (to === "released" && fold.drawn === null) return "is released before the anchor is drawn";
  if (to === "released" && fold.drawn?.has(version) === true) {
    return "is an anchor task, so it is never released";
  }
  task.state = to;
  return null;
}
