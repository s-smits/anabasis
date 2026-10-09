/**
 * A checker's acceptance: what an imported check program has been seen to do, before any task
 * counts on it.
 *
 * v1's record is why. Its passes were sound, the Judge vetoing 5 of 1,411, and its rejections were
 * not: of 47 rehearsal misses 36 were a check or its instrument refusing a right answer (v1 #124),
 * and 24 of 32 firmware fails were an author's stand-in refusing valid code. This host took a v1
 * check program as it stood, and what it asked of it was each task's own: gate 3 reruns the checks
 * on one accepted answer, and gate 4 puts three reject controls to the checks they name (`task.ts`).
 * Nothing asked the checker as a whole whether every control gets the verdict its author labelled it
 * with, whether a second run agrees, whether every check has been seen both to refuse an answer and
 * to let one pass, and whether every instrument a check names is there to run.
 *
 * Two readings ask what no control of the pack's does (`docs/plan.md`, the correctness model). The
 * do-nothing answer, the smallest the answer format allows, must be rejected on every task: Anchor
 * tests its generated verifiers so, and cites a benchmark on which an agent that did nothing passed
 * 38% of the tasks, because the verifier accepted an empty response. And a check whose author's own
 * computation decides it, with no installed instrument, is a fault until the operator admits it by
 * name: all 32 verified firmware fails in v1 ran on batteries whose instrument a Builder had
 * written, and 24 of them were that stand-in rejecting valid code.
 *
 * This reads and decides nothing: a fault is a sentence for the checker's owner, and what share of
 * faults a checker may carry is the operator's. One thing is not read here. A control tests the
 * faults its author thought of, so controls cannot show that the answers a check refused were
 * wrong; that takes a reading of the refused answers themselves (`src/review/rejections.ts`).
 */
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { pooled } from "../meta/pool.ts";
import type { LogEvent } from "./log.ts";
import {
  applicableTruthChecks,
  type Brief,
  decided,
  requiredToolsOf,
  spelled,
  type Task,
  type Verdict,
  type Verifier,
} from "./verify.ts";

/** A control as v1's `controls.json` labels it: an answer the checks must accept, or an edit of
 *  one that a named check must refuse. */
export interface Control {
  readonly taskId: string;
  readonly answer: JsonValue;
  /** The check that must refuse it; null for an answer that must pass. */
  readonly refusedBy: string | null;
}

/** A control with the checks run on it twice. */
export interface ControlRun extends Control {
  readonly verdicts: readonly [Verdict, Verdict];
}

/** An answer whose verdict is on record: a control's first run, or a stored solve's. */
export interface Graded {
  readonly task: Task;
  readonly verdict: Verdict;
}

/** The do-nothing answer's verdict on one task. */
export interface Idle {
  readonly taskId: string;
  readonly verdict: Verdict;
}

/** What one check has been seen to do. */
export interface CheckReading {
  readonly id: string;
  /** Whether an installed tool decides it or the author's own computation does. */
  readonly instrument: "authored" | "external";
  /** Declared tools the verifier's tool path does not hold. */
  readonly missing: readonly string[];
  /** Answers it applied to and let pass, and answers it refused, controls and stored answers alike. */
  readonly passed: number;
  readonly refused: number;
  /** Reject controls that name it, and how many of those it refused. */
  readonly named: number;
  readonly caught: number;
}

export interface Acceptance {
  readonly checks: readonly CheckReading[];
  /** What stands between the checker and its acceptance, one sentence each. */
  readonly faults: readonly string[];
}

/** A checker by what it is: its contract's hash, and the digest of its program's files. */
export interface Checker {
  readonly contract: string;
  readonly checks: string;
}

/** One answer a log holds a verdict for, under another checker. */
export interface Regraded {
  readonly solve: string;
  readonly task: string;
  /** The verdict the log holds, and the other checker's of the same answer, each as `spelled`. */
  readonly was: string;
  readonly now: string;
}

/** Every control through the checks, twice, `width` at once. A control of a task the pack does not
 *  hold is the caller's error, not the checker's, and a verifier that cannot decide stops the run,
 *  as it stops a gate (`decided`): a wall that is not there is no fault of a check's. */
export function runControls(
  verify: Verifier,
  tasks: readonly Task[],
  controls: readonly Control[],
  width: number,
): Promise<ControlRun[]> {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  return pooled(controls, width, async (control) => {
    const task = byId.get(control.taskId);
    if (task === undefined) {
      throw new Error(`a control names ${control.taskId}, which the pack holds no task for`);
    }
    const first = await decided(verify, task, control.answer);
    return { ...control, verdicts: [first, await decided(verify, task, control.answer)] };
  });
}

/**
 * The do-nothing answer: the smallest value a JSON Schema allows, built from the schema alone. An
 * object holds its required properties and no other, an array its fewest items, a string its
 * fewest characters, a number its minimum or zero; an enumeration gives its first value, and a
 * choice of schemas its first. A keyword outside these is not read, so the value may miss the
 * format, which the caller asks (`answerFormatFault`) before it puts the answer to a check.
 */
export function doNothingAnswer(schema: JsonValue | undefined): JsonValue {
  const held = asRecord(schema);
  if (held === null) return null;
  if (held.const !== undefined) return held.const;
  if (Array.isArray(held.enum)) return held.enum[0] ?? null;
  const choice = [held.anyOf, held.oneOf].find((options) => Array.isArray(options));
  if (Array.isArray(choice)) return doNothingAnswer(choice[0]);
  const type = Array.isArray(held.type) ? held.type[0] : held.type;
  if (type === "object") {
    const properties = asRecord(held.properties) ?? {};
    const required = Array.isArray(held.required) ? held.required.filter(isString) : [];
    return Object.fromEntries(required.map((name) => [name, doNothingAnswer(properties[name])]));
  }
  if (type === "array") {
    return Array.from({ length: isNumber(held.minItems) ? held.minItems : 0 }, () =>
      doNothingAnswer(held.items),
    );
  }
  if (type === "string") return "x".repeat(isNumber(held.minLength) ? held.minLength : 0);
  if (type === "number" || type === "integer") {
    if (isNumber(held.minimum)) return held.minimum;
    return isNumber(held.exclusiveMinimum) ? held.exclusiveMinimum + 1 : 0;
  }
  return type === "boolean" ? false : null;
}

/** The do-nothing answer through every task's checks, `width` at once. */
export function runDoNothing(
  verify: Verifier,
  tasks: readonly Task[],
  answer: JsonValue,
  width: number,
): Promise<Idle[]> {
  return pooled(tasks, width, async (task) => ({
    taskId: task.taskId,
    verdict: await decided(verify, task, answer),
  }));
}

/** The tasks on which the do-nothing answer was not rejected, a sentence each: it passed, or a
 *  check could not run on it, which is no rejection either. */
export function doNothingFaults(idle: readonly Idle[]): string[] {
  return idle.flatMap(({ taskId, verdict }) =>
    verdict.kind === "fail"
      ? []
      : [`the do-nothing answer was not rejected on ${taskId}: ${spelled(verdict)}`],
  );
}

/** Why a control's run is not what its label says, or null when it is. */
export function controlFault({ taskId, refusedBy, verdicts: [first, second] }: ControlRun): string | null {
  const named = refusedBy === null ? `the accept control of ${taskId}` : `a reject control of ${taskId}`;
  if (spelled(first) !== spelled(second)) {
    return `${named} got two verdicts from one answer: ${spelled(first)}, then ${spelled(second)}`;
  }
  if (refusedBy === null) return first.kind === "pass" ? null : `${named} did not pass: ${spelled(first)}`;
  return first.kind === "fail" && first.blocking.includes(refusedBy)
    ? null
    : `${named} names ${refusedBy}, which did not refuse it: ${spelled(first)}`;
}

/** The tools a check names that the verifier's tool path does not hold, a sentence each. A check
 *  whose tool is missing decides nothing, so a caller asks this before it runs a control: put to
 *  the verifier first, such a check stops the run and the missing tool is never named. */
export function toolFaults(brief: Brief, found: (toolId: string) => boolean): string[] {
  return brief.truthChecks.flatMap(({ id, execution }) =>
    requiredToolsOf(execution)
      .filter((tool) => !found(tool))
      .map((tool) => `${id} names ${tool}, which is not on the verifier's tool path`),
  );
}

/**
 * The reading: each check's tallies over the controls and the stored answers, and the faults.
 * `stored` are answers graded elsewhere, a sweep's solves say, and add to what a check has been
 * seen to do without being rerun. `found` says whether the verifier's tool path holds a tool. A
 * verdict that decided nothing, a faulty check's or a non-result, tallies for no check.
 */
export function acceptance(
  brief: Brief,
  tasks: readonly Task[],
  runs: readonly ControlRun[],
  stored: readonly Graded[],
  found: (toolId: string) => boolean,
): Acceptance {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const graded = [
    ...runs.flatMap(({ taskId, verdicts: [verdict] }) => {
      const task = byId.get(taskId);
      return task === undefined ? [] : [{ task, verdict }];
    }),
    ...stored,
  ];
  const checks = brief.truthChecks.map(({ id, execution }): CheckReading => {
    const seen = graded.filter(
      ({ task, verdict }) =>
        (verdict.kind === "pass" || verdict.kind === "fail") &&
        applicableTruthChecks(brief, task).some((check) => check.id === id),
    );
    const refused = seen.filter(({ verdict }) => verdict.kind === "fail" && verdict.blocking.includes(id));
    const naming = runs.filter((run) => run.refusedBy === id);
    return {
      id,
      instrument: execution.evidence.kind,
      missing: requiredToolsOf(execution).filter((tool) => !found(tool)),
      passed: seen.length - refused.length,
      refused: refused.length,
      named: naming.length,
      caught: naming.filter(({ verdicts: [first] }) => first.kind === "fail" && first.blocking.includes(id))
        .length,
    };
  });
  // A check that could not run is the fault, and what it then never refused or passed is not a
  // second one: said so, the remedy reads as another control. v1's gate told a Builder to add a
  // reject when twelve existed and the check's tool could not write its output (a buffer run
  // of 8 October, as its sessions were recounted that day).
  const unrun = new Map(
    graded
      .flatMap(({ verdict }) => (verdict.kind === "faulty" ? [verdict] : []))
      .toReversed()
      .map(({ check, reason }) => [check, reason]),
  );
  const faults = [
    ...runs.flatMap((run) => controlFault(run) ?? []),
    ...checks.flatMap(({ id, missing, passed, refused, caught }) => [
      ...missing.map((tool) => `${id} names ${tool}, which is not on the verifier's tool path`),
      ...(unrun.has(id)
        ? [
            `${id} could not run on an answer, so what it refuses and passes is not read: ${unrun.get(id) ?? ""}`,
          ]
        : [
            ...(refused === 0 ? [`${id} has refused nothing: no control and no stored answer`] : []),
            ...(passed === 0 ? [`${id} has let nothing pass: no control and no stored answer`] : []),
            ...(refused > 0 && caught === 0 ? [`${id} has refused no reject control that names it`] : []),
          ]),
    ]),
  ];
  return { checks, faults };
}

/** The checks their author's own computation decides that the operator has not admitted by name,
 *  a sentence each. An installed instrument needs no word, and a word for it is none. */
export function authoredFaults(checks: readonly CheckReading[], admitted: ReadonlySet<string>): string[] {
  return checks.flatMap(({ id, instrument }) =>
    instrument === "authored" && !admitted.has(id)
      ? [
          `${id} is decided by its author's own computation and no installed instrument: it stands on the operator's word alone (--admit ${id})`,
        ]
      : [],
  );
}

/** The checker the log holds as frozen, by its last `contract.frozen`; null when none is. */
export function frozenChecker(events: readonly LogEvent[]): Checker | null {
  const data = events.findLast(({ kind }) => kind === "contract.frozen")?.data;
  return isString(data?.contract) && isString(data.checks)
    ? { contract: data.contract, checks: data.checks }
    : null;
}

/** Why `own` is not the checker the log froze, or null when it is, or when none is frozen. A frozen
 *  contract changes only through the operator (`contract.ts`), and a repaired check program is
 *  another checker: its campaign is another campaign, with nothing of this one's counted under it. */
export function departure(events: readonly LogEvent[], own: Checker): string | null {
  const frozen = frozenChecker(events);
  if (frozen === null) return null;
  const moved = [
    ...(frozen.contract === own.contract ? [] : ["contract"]),
    ...(frozen.checks === own.checks ? [] : ["check program"]),
  ];
  return moved.length === 0
    ? null
    : `the log froze another ${moved.join(" and ")}; a changed checker takes a campaign of its own`;
}

/** The verdict a `verdict` event holds, when a check gave it. An answer outside the contract's
 *  format reached no check, and a non-result decided nothing: neither is a checker's verdict. */
function loggedVerdict(data: JsonObject): Verdict | null {
  if (data.kind === "pass") return { kind: "pass" };
  if (data.kind === "fail" && Array.isArray(data.blocking) && data.blocking.length > 0) {
    return { kind: "fail", blocking: data.blocking.filter(isString) };
  }
  return data.kind === "faulty" && isString(data.check) && isString(data.reason)
    ? { kind: "faulty", check: data.check, reason: data.reason }
    : null;
}

/**
 * Every answer the log holds a checker's verdict for, graded again by `verify` over `tasks`, a
 * repaired checker's own: the last verdict of each solve beside the repaired checker's of the same
 * bytes, `width` at once. No solve is run, since the log holds each answer whole.
 *
 * It is what a repair costs before it is adopted. A verdict that moves is a task whose state rested
 * on the old checker, and one that stays is a refusal the repair did not touch. A task the repaired
 * pack no longer holds is reported so, and a verifier that cannot decide stops the run (`decided`).
 */
export function regraded(
  events: readonly LogEvent[],
  tasks: readonly Task[],
  verify: Verifier,
  width: number,
): Promise<Regraded[]> {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const last = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "verdict" && isString(data.solve) ? [[data.solve, data]] : [],
    ),
  );
  const held = [...last].flatMap(([solve, data]) => {
    const verdict = loggedVerdict(data);
    return verdict === null || !isString(data.task) || data.answer === undefined
      ? []
      : [{ solve, task: data.task, answer: data.answer, was: spelled(verdict) }];
  });
  return pooled(held, width, async ({ solve, task, answer, was }) => {
    const own = byId.get(task);
    const now = own === undefined ? "no task" : spelled(await decided(verify, own, answer));
    return { solve, task, was, now };
  });
}
