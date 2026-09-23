/**
 * The battery validator: the Builder's own tasks read against its own brief, before anything but
 * the public fields reaches an agent.
 *
 * Every finding names a path, an id, a count or a key shape, so it survives author projection like
 * the brief and controls diagnostics beside it. Unmarked they fail closed to a single
 * `generated-execution-unclassified` label, and a battery then keeps a self-invented task shape
 * through submit after submit, because nothing it is told names the shape it invented.
 *
 * The field gate runs alone — the rules below it read fields it is the only proof of. After it,
 * one pass binds each task to the checks applicable to it, and each rule reads those rows. None of
 * them repairs the candidate: a validator that edited what it read would hide the defect from the
 * session that has to fix it.
 */
import {
  type Brief,
  type ContractFinding,
  type ValidationResult,
  applicableTruthChecks,
  controllerValidatedFindings,
  fieldFinding,
} from "./brief.ts";
import { boundaryWitnessTaskIds, numericBoundaryObligations } from "./numeric-boundary.ts";
import type { HiddenExpectation } from "./hidden-expectation.ts";
import { resolvePredicatePath } from "./predicate.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { GeneratedTask } from "./task-split.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";

/** Shared task-id rule, also used before constructing case paths. The two-character minimum
 *  matches MIN_SCANNABLE_TASK_ID: disclosure scans skip single-character ids because redacting
 *  a single letter would damage ordinary prose. The producer therefore refuses ids that those
 *  scans cannot recognise safely. */
export const SAFE_TASK_ID = /^(?!\.{1,2}$)[A-Za-z0-9._-]{2,}$/;

// Tasks and controls share HiddenExpectation. Re-export it here for callers using BuildTask.
export type { HiddenExpectation } from "./hidden-expectation.ts";

export type BuildTask = GeneratedTask<JsonValue, HiddenExpectation[]> & {
  /** Historical declarations remain readable; actual public conditions own validation. */
  intendedFeatures?: JsonValue;
  difficultyAxes?: JsonValue;
  difficultyAxisPath?: string;
  /** An authored ordinal label. Nothing prescribes or refuses it: the controller reads difficulty
   *  from the measured band, and records the tally beside the decision as a reading. */
  level?: number;
  /** Optional ancestry: the previous task this one follows. The public projection excludes it, and
   *  no authoring path requires a one-to-one parent map. */
  parentTaskId?: string;
};

export interface TaskBattery {
  tasks: BuildTask[];
}

export interface TaskValidationContext {
  /** Battery size from the ask manifest, or its upper bound when `minTasks` opens a range. Check it
   *  while the Builder can still repair the candidate. The census gate repeats the count after
   *  fingerprinting as independent evidence, rather than being the first place a wrong count is
   *  detected. */
  exactTasks?: number | null;
  /** The smallest accepted size when the round leaves the count to the Builder; absent when the ask
   *  states one size. */
  minTasks?: number | null;
  /** True for new authoring, which enforces public variation; a fingerprinted tree keeps its
   *  recorded policy. */
  authoring?: boolean;
}

/** One task bound to its index and to the checks that apply to it, so no rule resolves either
 *  again. The index is the one the findings address, which is the battery's own order. */
interface TaskRow {
  task: BuildTask;
  index: number;
  applicable: ReturnType<typeof applicableTruthChecks>;
}

/** The fields every rule below reads without checking again: a battery of tasks, each with a string
 *  id, a string family, a public input and an array of hidden rows naming a check. */
function fieldFindings(value: unknown): ContractFinding[] {
  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    return [fieldFinding("$", '{"tasks": [...]} with a tasks array', value)];
  }
  return /* SAFETY: the check above returned unless `value.tasks` is an array. */ (
    value.tasks as unknown[]
  ).flatMap((task, i) => {
    if (
      !isRecord(task) ||
      !isString(task.taskId) ||
      !isString(task.family) ||
      !("publicInput" in task) ||
      !Array.isArray(task.hidden)
    ) {
      return [
        fieldFinding(
          `tasks[${i}]`,
          '{"taskId": string, "family": string, "publicInput": any, "hidden": [...]}',
          task,
        ),
      ];
    }
    return /* SAFETY: the branch above returned unless `task.hidden` is an array. */ (
      task.hidden as unknown[]
    ).flatMap((exp, j) =>
      isRecord(exp) && isString(exp.checkId) && "expectation" in exp
        ? []
        : [fieldFinding(`tasks[${i}].hidden[${j}]`, '{"checkId": string, "expectation": any}', exp)],
    );
  });
}

/** Battery-level shape no task walk can decide: the retired label and the requested census. */
function censusFindings(battery: TaskBattery, context: TaskValidationContext): ContractFinding[] {
  const findings: ContractFinding[] = [];
  // A battery-wide difficulty (or the retired rung) labels nothing the controller reads.
  if (Object.hasOwn(battery, "difficulty") || Object.hasOwn(battery, "rung")) {
    findings.push({
      code: "tasks-difficulty-unrequested",
      path: "difficulty",
      detail:
        "remove the top-level difficulty field; the controller reads difficulty from measured results, not from a label",
    });
  }
  if (battery.tasks.length === 0) {
    findings.push({
      code: "tasks-empty",
      path: "tasks",
      detail: "add tasks; an empty task set cannot be verified",
    });
  }
  const exactTasks = context.exactTasks ?? null;
  const minTasks = context.minTasks ?? exactTasks;
  if (
    exactTasks !== null &&
    minTasks !== null &&
    (battery.tasks.length < minTasks || battery.tasks.length > exactTasks)
  ) {
    findings.push({
      code: "tasks-exact-census",
      path: "tasks",
      detail: `the request requires ${minTasks === exactTasks ? `exactly ${exactTasks}` : `between ${minTasks} and ${exactTasks}`} tasks; found ${battery.tasks.length}. Add or remove tasks, and keep inputs and expected values different across rows`,
    });
  }
  return findings;
}

/** Each task's own identity: unique, and spelled so a disclosure scan can recognise it. */
function identityFindings(rows: readonly TaskRow[]): ContractFinding[] {
  const seen = new Set<string>();
  return rows.flatMap(({ task, index }) => {
    const findings: ContractFinding[] = [];
    if (seen.has(task.taskId)) {
      findings.push({
        code: "tasks-duplicate-id",
        path: `tasks[${index}].taskId`,
        detail: `taskId "${task.taskId}" appears twice; give each task a unique id`,
      });
    }
    seen.add(task.taskId);
    if (!SAFE_TASK_ID.test(task.taskId)) {
      findings.push({
        code: "tasks-id-unsafe",
        path: `tasks[${index}].taskId`,
        detail: `taskId "${task.taskId}" is invalid; use at least two characters from letters, numbers, dots, underscores, and hyphens, and do not use "." or ".."`,
      });
    }
    return findings;
  });
}

/** Hidden operands, both directions: a row for a check that wants none, and a missing row for a
 *  check that requires one — absence cannot silently skip a check. */
function hiddenOperandFindings(row: TaskRow, declared: ReadonlySet<string>): ContractFinding[] {
  const { task, index, applicable } = row;
  const findings: ContractFinding[] = [];
  const used = new Set<string>();
  task.hidden.forEach((exp, j) => {
    if (used.has(exp.checkId)) {
      findings.push({
        code: "tasks-duplicate-expectation-check",
        path: `tasks[${index}].hidden[${j}].checkId`,
        detail: `task "${task.taskId}" uses checkId "${exp.checkId}" more than once in hidden; keep one row for each checkId`,
      });
    }
    used.add(exp.checkId);
    if (!declared.has(exp.checkId)) {
      findings.push({
        code: "tasks-undeclared-check",
        path: `tasks[${index}].hidden[${j}].checkId`,
        detail: `"${exp.checkId}" is not a declared brief truth check (hw24 reconciliation class)`,
      });
      return;
    }
    const check = applicable.find((entry) => entry.id === exp.checkId);
    if (check === undefined || check.execution.hidden === "none") {
      findings.push({
        code: "tasks-hidden-operand-unexpected",
        path: `tasks[${index}].hidden[${j}]`,
        detail: `check "${exp.checkId}" does not require a hidden operand for this family; remove this row`,
      });
    }
  });
  for (const check of applicable) {
    if (check.execution.hidden === "required" && !used.has(check.id)) {
      findings.push({
        code: "tasks-hidden-operand-missing",
        path: `tasks[${index}].hidden`,
        detail: `applicable check "${check.id}" requires one hidden operand; absence cannot skip the check`,
      });
    }
  }
  return findings;
}

/** A task no check applies to is never verified by anything. */
function applicabilityFindings(rows: readonly TaskRow[], declared: ReadonlySet<string>): ContractFinding[] {
  return rows.flatMap((row) => [
    ...(row.applicable.length === 0
      ? [
          {
            code: "tasks-no-applicable-checks",
            path: `tasks[${row.index}].family`,
            detail: `task "${row.task.taskId}" has no check declared for family "${row.task.family}"`,
          },
        ]
      : []),
    ...hiddenOperandFindings(row, declared),
  ]);
}

/** A declared public input path no applicable task provides anywhere is a misnamed input. An
 *  optional one (wind, keep-out zones) is absent from some tasks by design and the projection hands
 *  the check what is there, so one provider is enough. */
function declaredPathFindings(rows: readonly TaskRow[]): ContractFinding[] {
  const provided = new Set<string>();
  const unmet = new Map<string, { assertion: string; path: string }>();
  const declared = rows.flatMap(({ task, applicable }) =>
    applicable.flatMap((check) => check.execution.publicInputPaths.map((path) => ({ task, check, path }))),
  );
  for (const { task, check, path } of declared) {
    const key = `${check.id}\u0000${path}`;
    if (resolvePredicatePath(task.publicInput, path).found) {
      provided.add(key);
      unmet.delete(key);
    } else if (!provided.has(key)) unmet.set(key, { assertion: check.assertion, path });
  }
  return [...unmet.values()].map(({ assertion, path }) => ({
    code: "tasks-public-rule-path-missing",
    path: "tasks",
    detail: `applicable public rule "${assertion}" declares ${path}, but no task it applies to provides that exact path`,
  }));
}

/** What the battery as a whole must cover once its families are known. */
function coverageFindings(
  brief: Brief,
  battery: TaskBattery,
  families: ReadonlySet<string>,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  if (battery.tasks.length > 0) {
    // A check scoped to families the battery lacks applies to no task, so nothing ever runs it:
    // the census, F2 and the verifier all read applicability from the tasks that exist.
    for (const check of brief.truthChecks) {
      const scope = check.execution.families;
      if (scope !== "all" && !scope.some((family) => families.has(family))) {
        findings.push({
          code: "tasks-check-family-unbound",
          path: "tasks",
          detail: `truth check "${check.id}" applies only to ${scope.map((family) => `"${family}"`).join(", ")}, and no task has that family, so no task, control or reference solve ever runs it; add a task of that family or scope the check to a family the battery has`,
        });
      }
    }
    if (families.size < 2) {
      findings.push({
        code: "tasks-single-family",
        path: "tasks",
        detail: "one family cannot distinguish capability from memorized shape",
      });
    }
  }
  for (const boundary of numericBoundaryObligations(brief)) {
    if (boundaryWitnessTaskIds(brief, battery.tasks, boundary).size === 0) {
      findings.push({
        code: "tasks-numeric-boundary-missing",
        path: "tasks",
        detail: `truth check "${boundary.checkId}" declares the exact equality boundary ${boundary.publicInputPath} = ${capturedJsonStringify(boundary.value)} from design rule "${boundary.constantName}"; add an applicable task exactly at that value so strict and inclusive implementations differ`,
      });
    }
  }
  return findings;
}

/** A family must vary a shared declared verifier input. The comparison is per declared path, so a
 *  check that declares a coarse path is satisfied by any change inside it; this proves declared
 *  coverage, not semantic dependence or harder decisions, and measurement owns those claims. */
function variationFindings(rows: readonly TaskRow[]): ContractFinding[] {
  const findings: ContractFinding[] = [];
  for (const family of new Set(rows.map(({ task }) => task.family))) {
    const values = rows.flatMap(({ task, applicable }) =>
      task.family === family
        ? [
            new Map(
              applicable
                .flatMap((check) => check.execution.publicInputPaths)
                .flatMap((path) => {
                  const resolved = resolvePredicatePath(task.publicInput, path);
                  return resolved.found ? [[path, canonicalJson(resolved.value)] as const] : [];
                }),
            ),
          ]
        : [],
    );
    // A path the whole family provides, holding two values somewhere in it. The first member's
    // paths are the only candidates: one it lacks is not shared.
    const varied = [...(values[0]?.keys() ?? [])].some(
      (path) =>
        values.every((member) => member.has(path)) &&
        new Set(values.map((member) => member.get(path))).size >= 2,
    );
    if (!varied) {
      findings.push({
        code: "tasks-structural-variation-shortfall",
        path: "tasks",
        owner: "task-curriculum",
        detail: `family "${family}" needs at least two distinct values at one shared publicInput path declared by its applicable truth checks. Vary a condition the verifier uses; labels and undeclared metadata do not qualify. Declared coverage does not prove semantic difficulty`,
      });
    }
  }
  return findings;
}

export function validateTasks(
  brief: Brief,
  value: unknown,
  context: TaskValidationContext = {},
): ValidationResult {
  const malformed = fieldFindings(value);
  if (malformed.length > 0) return { ok: false, findings: controllerValidatedFindings(malformed) };
  const battery =
    /* SAFETY: `fieldFindings` returned nothing, which is the only proof of these fields. */ value as TaskBattery;
  const rows: TaskRow[] = battery.tasks.map((task, index) => ({
    task,
    index,
    applicable: applicableTruthChecks(brief, task),
  }));
  const declared = new Set(brief.truthChecks.map((check) => check.id));
  const findings = [
    ...censusFindings(battery, context),
    ...identityFindings(rows),
    ...applicabilityFindings(rows, declared),
    ...declaredPathFindings(rows),
    ...coverageFindings(brief, battery, new Set(rows.map(({ task }) => task.family))),
    ...(context.authoring === true ? variationFindings(rows) : []),
  ];
  return { ok: findings.length === 0, findings: controllerValidatedFindings(findings) };
}
