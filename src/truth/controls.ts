/**
 * The controls contract, authored by the Builder and checked before adoption. Each requirement here
 * keeps the failure that produced it.
 *
 * A corpus needs both sides. Accepts establish that correct examples pass, and rejects establish
 * that the checks detect a deliberately introduced error, which matters because an accept-only
 * corpus is satisfied by a check that never fails at all.
 *
 * Every reject names the check its mutation must fail, in `expectedCheckId`, and the census runs
 * that check alone on the reject. Counting any blocking failure as discrimination instead lets a
 * reject labelled for a join fail an unrelated schema or empty-input check and still satisfy that
 * join's requirement. A reject that targets a join names both the join and its owning check,
 * because a corpus whose check labels are all covered can still leave every join uncovered, and the
 * incorrect artifacts it then accepts are exactly the ones the joins were there to catch.
 *
 * Each control inherits the required hidden operands of its task, and an explicit override changes
 * only the rows it names. Live outcomes then prove those examples; they never establish an arbitrary
 * dependence on hidden data.
 *
 * This module decides coverage and structure alone. The shared host census (`runControls`) executes
 * the controls and adoption reads those results, so nothing here ranks one candidate corpus against
 * another.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import {
  type ArtifactField,
  type Brief,
  type ContractFinding,
  type ValidationResult,
  applicableTruthChecks,
  controllerValidatedFindings,
  recordView,
  fieldFinding,
} from "./brief.ts";
import type { HiddenExpectation } from "./hidden-expectation.ts";
import { numericBoundaryObligations } from "./numeric-boundary.ts";
import type { PublicTask } from "./task-split.ts";
import { asRecord, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";

export type AcceptControl = {
  id: string;
  /** The battery task this artifact answers. Every control is a coherent (taskId, artifact) pair and
   *  evaluates through the same single path as a measured case, because a taskless artifact is not
   *  established as good or bad relative to any actual problem: a taskless census makes every
   *  task-relative check a no-op, and the judge then self-disables on abstentions it has scored 100
   *  percent correct. */
  taskId: string;
  /** A known-good artifact the verifier must pass. */
  artifact: JsonValue;
};

export type RejectControl = {
  id: string;
  /** The battery task this mutation is verified against (see AcceptControl.taskId). */
  taskId: string;
  /** A known-bad artifact the verifier must fail. */
  artifact: JsonValue;
  /** Optional label for the changed fact (e.g. alias-swap, off-by-one-id, ghost-entity). */
  mutationClass?: string;
  /** When the control targets a declared join's decoy class, name both. */
  targetsJoin?: string;
  decoyClass?: string;
  /** The numeric boundary this reject changes. Boundary and join witnesses are separate rows. */
  targetsBoundary?: {
    publicInputPath: string;
    constantName: string;
  };
  /**
   * The brief truth-check id this mutation must fail, applicable to the reject's task. The host
   * census (`runControls`) runs this check alone on the reject, so an unrelated schema or
   * empty-input failure cannot satisfy it.
   */
  expectedCheckId: string;
  /** Optional hidden operand overrides, merged by check id into the bound task's rows. */
  hidden?: HiddenExpectation[];
};

export type ControlCorpus = {
  accept: AcceptControl[];
  reject: RejectControl[];
};

/** A recorded battery task as the corpus validator sees it: the public view plus hidden rows. */
type ControlTask = PublicTask<unknown> & { hidden?: HiddenExpectation[] };

/** The key of one check-by-family cell. What fills a cell is a declared control; whether the cell
 *  actually holds is the shared census's verdict, and no static path here decides it. */
function ruleCell(checkId: string, family: string): string {
  return capturedJsonStringify([checkId, family]);
}

/** Whether the value carries the two control arrays. This is the shallow admission check alone:
 *  `validateControls` decides whether the rows inside them are usable, and a caller runs both. */
export function isControlCorpus(value: JsonValue): value is ControlCorpus {
  const corpus = asRecord(value);
  return corpus !== null && Array.isArray(corpus.accept) && Array.isArray(corpus.reject);
}

const optionalString = (value: unknown) => value === undefined || isString(value);

/** The one row-shape parse for a corpus. Every control is bound to one recorded task (operator
 *  verdict) and every reject names the check its changed fact must fail, so the coverage
 *  pass and the census below can both assume those two facts instead of re-deriving them. */
function corpusRowFindings(corpus: ControlCorpus): ContractFinding[] {
  const findings: ContractFinding[] = [];
  corpus.accept.forEach((control, i) => {
    const row = recordView(control);
    if (row === null || !isString(row.id) || !isString(row.taskId) || !("artifact" in row)) {
      findings.push(
        fieldFinding(`accept[${i}]`, '{"id": string, "taskId": string, "artifact": any}', control),
      );
    }
  });
  corpus.reject.forEach((control, i) => {
    const row = recordView(control);
    const boundary = row?.targetsBoundary === undefined ? null : recordView(row.targetsBoundary);
    if (
      row === null ||
      !isString(row.id) ||
      !isString(row.taskId) ||
      !("artifact" in row) ||
      !isString(row.expectedCheckId) ||
      !optionalString(row.mutationClass) ||
      !optionalString(row.targetsJoin) ||
      !optionalString(row.decoyClass) ||
      (row.targetsBoundary !== undefined &&
        (boundary === null || !isString(boundary.publicInputPath) || !isString(boundary.constantName)))
    ) {
      findings.push(
        fieldFinding(
          `reject[${i}]`,
          '{"id", "taskId", "artifact", "expectedCheckId"} with optional "mutationClass", "targetsJoin", "decoyClass", "targetsBoundary", "hidden"',
          control,
        ),
      );
    }
  });
  return findings;
}

function bindingFindings(
  corpus: ControlCorpus,
  taskById: ReadonlyMap<string, ControlTask>,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const ids = new Set<string>();
  for (const control of [...corpus.accept, ...corpus.reject]) {
    if (!taskById.has(control.taskId)) {
      findings.push({
        code: "controls-unknown-task",
        path: control.id,
        detail: `example "${control.id}" names taskId ${capturedJsonStringify(control.taskId)}, which is not a task of this battery; bind every example to one recorded battery task`,
      });
    }
    if (ids.has(control.id)) {
      findings.push({
        code: "controls-duplicate-id",
        path: control.id,
        detail: `"${control.id}" appears twice`,
      });
    }
    ids.add(control.id);
  }
  return findings;
}

/** One reject's references resolve against the brief: a declared check, at most one of a join or
 *  a numeric boundary, the join's owning check, and hidden overrides only for hidden checks. */
function rejectReferenceFindings(
  brief: Brief,
  control: RejectControl,
  i: number,
  hiddenRows: readonly HiddenExpectation[] | null,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const check = brief.truthChecks.find((candidate) => candidate.id === control.expectedCheckId);
  if (check === undefined) {
    findings.push({
      code: "controls-reject-unknown-check",
      path: `reject[${i}].expectedCheckId`,
      detail: `incorrect example "${control.id}" names unknown expectedCheckId "${control.expectedCheckId}"`,
    });
  }
  if (control.targetsJoin !== undefined) {
    const owner = brief.truthChecks.find((candidate) =>
      (candidate.joinIds ?? []).includes(control.targetsJoin ?? ""),
    );
    if (!brief.joins.some((join) => join.id === control.targetsJoin)) {
      findings.push({
        code: "controls-unknown-join",
        path: `reject[${i}].targetsJoin`,
        detail: `"${control.targetsJoin}" is not a declared brief join`,
      });
    } else if (check !== undefined && owner?.id !== control.expectedCheckId) {
      findings.push({
        code: "controls-join-check-mismatch",
        path: `reject[${i}].expectedCheckId`,
        detail: `incorrect example "${control.id}" targets join "${control.targetsJoin}", whose check is "${owner?.id ?? "missing"}", but expectedCheckId is "${control.expectedCheckId}"`,
      });
    }
  }
  if (control.targetsBoundary !== undefined) {
    const { publicInputPath, constantName } = control.targetsBoundary;
    const declared = numericBoundaryObligations(brief);
    if (control.targetsJoin !== undefined || control.decoyClass !== undefined) {
      findings.push({
        code: "controls-boundary-join-witness-overloaded",
        path: `reject[${i}].targetsBoundary`,
        detail: `incorrect example "${control.id}" cannot prove a numeric boundary and a join decoy at once; use separate rejects`,
      });
    }
    if (
      !declared.some(
        (row) =>
          row.checkId === control.expectedCheckId &&
          row.publicInputPath === publicInputPath &&
          row.constantName === constantName,
      )
    ) {
      findings.push({
        code: "controls-boundary-check-mismatch",
        path: `reject[${i}].targetsBoundary`,
        detail: `incorrect example "${control.id}" names the boundary ("${control.expectedCheckId}", "${publicInputPath}", "${constantName}"), which is not a declared (expectedCheckId, publicInputPath, constantName) triple; declared: ${declared.map((row) => `("${row.checkId}", "${row.publicInputPath}", "${row.constantName}")`).join(", ") || "none"}`,
      });
    }
  }
  for (const row of hiddenRows ?? []) {
    if (
      brief.truthChecks.some(
        (candidate) => candidate.id === row.checkId && candidate.execution.hidden === "required",
      )
    ) {
      continue;
    }
    findings.push({
      code: "controls-hidden-on-nonhidden-check",
      path: `reject[${i}].hidden`,
      detail: `incorrect example "${control.id}" overrides hidden data for "${row.checkId}", which declares no required hidden operand`,
    });
  }
  return findings;
}

function hiddenFieldFindings(value: JsonValue, path: string): ContractFinding[] {
  if (!Array.isArray(value)) {
    return [fieldFinding(path, '[{"checkId": string, "expectation": any}]', value)];
  }
  const findings: ContractFinding[] = [];
  const checkIds = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !isString(entry.checkId) || !("expectation" in entry)) {
      findings.push(fieldFinding(`${path}[${index}]`, '{"checkId": string, "expectation": any}', entry));
      return;
    }
    if (checkIds.has(entry.checkId)) {
      findings.push({
        code: "controls-hidden-duplicate-check",
        path: `${path}[${index}].checkId`,
        detail: `hidden checkId "${entry.checkId}" appears more than once; keep one row for each checkId`,
      });
    }
    checkIds.add(entry.checkId);
  });
  return findings;
}

/**
 * An accept must carry exactly the declared top-level fields, as a real submission does. Otherwise a
 * representation error keeps it from exercising the correctness checks it was written for: an
 * accept author who invents top-level fields of their own has every accept rejected before a single
 * check runs. This helper does not apply the same check to rejects, where a missing or malformed field
 * can be the deliberate mutation; other validators check reject structure, and the host census
 * requires each reject to fail on its own expectedCheckId.
 */
function acceptSchemaFindings(schema: ArtifactField[], artifact: JsonValue, path: string): ContractFinding[] {
  const declared = schema.map((f) => f.name);
  if (!isRecord(artifact)) {
    return [fieldFinding(`${path}.artifact`, `an object with fields {${declared.join(", ")}}`, artifact)];
  }
  const keys = Object.keys(artifact);
  const missing = declared.filter((name) => !keys.includes(name));
  const undeclared = keys.filter((key) => !declared.includes(key));
  if (missing.length === 0 && undeclared.length === 0) return [];
  return [
    {
      code: "controls-accept-off-schema",
      path: `${path}.artifact`,
      detail: `known-correct artifact must use exactly the artifactSchema fields {${declared.join(", ")}}; missing [${missing.join(", ")}], extra [${undeclared.join(", ")}]`,
    },
  ];
}

/** Shape gate for a list of accept rows, guarding the same crash class as `briefFieldFindings`. F2
 *  runs a reference artifact through it as a one-row list, so the schema rule has one owner rather
 *  than one copy per caller. */
export function validateAcceptControls(value: JsonValue, schema?: ArtifactField[]): ValidationResult {
  if (!Array.isArray(value)) {
    return validated([fieldFinding("$", "a JSON array of accept controls", value)]);
  }
  const findings: ContractFinding[] = [];
  const acceptIds = new Set<string>();
  const rows = /* SAFETY: the check above returned when `!Array.isArray(value)`. */ value as unknown[];
  rows.forEach((control, i) => {
    const row = recordView(control);
    if (row === null || !isString(row.id) || !isString(row.taskId) || !("artifact" in row)) {
      findings.push(fieldFinding(`[${i}]`, '{"id": string, "taskId": string, "artifact": any}', control));
      return;
    }
    if (acceptIds.has(row.id)) {
      findings.push({
        code: "controls-accept-duplicate-id",
        path: `[${i}].id`,
        detail: `known-correct example id "${row.id}" appears more than once; give each example a unique id`,
      });
    }
    acceptIds.add(row.id);
    if (schema) findings.push(...acceptSchemaFindings(schema, row.artifact, `[${i}]`));
  });
  if (findings.length > 0) return validated(findings);
  if (value.length === 0) {
    return {
      ok: false,
      findings: [
        { code: "controls-no-accept", path: "$", detail: "a non-empty JSON array of accept controls" },
      ],
    };
  }
  // Whether these accepts actually pass is the shared host control census's to establish.
  return { ok: true, findings: [] };
}

/** This module analyses declared artifacts without executing generated code, so its findings can
 *  keep their public detail in author feedback. Falling back to the detail-free
 *  `generated-execution-unclassified` label instead hands a repair session the label, an empty
 *  obligation list and nothing to repair, and it returns an empty patch. The controller
 *  classification stays explicit here for that reason. */
const validated = (findings: ContractFinding[]): ValidationResult => ({
  ok: findings.length === 0,
  findings: controllerValidatedFindings(findings),
});

/** Public validity is the rule-by-family matrix, derived from the truth checks and the recorded
 *  task families; controls declare evidence and never declare applicability. Every applicable cell
 *  needs one accept, and each applicable check and each family needs one reject naming it (operator
 *  decision, replacing one reject per cell, which asked a six-check, five-family domain for thirty
 *  rejects). A check no task exercises has a cell on neither side, since both sides are
 *  walked from the recorded tasks. These are declared candidates only: the live census proves their
 *  outcomes. An external check needs the same reject as an authored one, because a recorded tool run
 *  establishes that the tool executed, not that it can reject anything. */
function publicRuleFindings(
  brief: Brief,
  corpus: ControlCorpus,
  tasks: readonly ControlTask[],
  taskById: ReadonlyMap<string, ControlTask>,
): ContractFinding[] {
  const positive = new Set<string>();
  for (const control of corpus.accept) {
    const task = taskById.get(control.taskId);
    if (task === undefined) continue;
    for (const check of applicableTruthChecks(brief, task)) positive.add(ruleCell(check.id, task.family));
  }
  const findings: ContractFinding[] = [];
  const negativeChecks = new Set<string>();
  const negativeFamilies = new Set<string>();
  for (const control of corpus.reject) {
    const task = taskById.get(control.taskId);
    const checkId = control.expectedCheckId;
    if (task === undefined) continue;
    if (!applicableTruthChecks(brief, task).some((check) => check.id === checkId)) {
      findings.push({
        code: "controls-expected-check-inapplicable",
        path: "reject",
        subject: control.id,
        detail: `incorrect example "${control.id}" names check "${checkId}", which does not apply to family "${task.family}" of its task; bind it to a task that check applies to`,
      });
      continue;
    }
    negativeChecks.add(checkId);
    negativeFamilies.add(task.family);
  }
  const required = new Set<string>();
  const missingChecks = new Set<string>();
  const missingFamilies = new Set<string>();
  for (const task of tasks) {
    if (!negativeFamilies.has(task.family)) missingFamilies.add(task.family);
    for (const { id: checkId } of applicableTruthChecks(brief, task)) {
      if (!negativeChecks.has(checkId)) missingChecks.add(checkId);
      const cell = ruleCell(checkId, task.family);
      if (required.has(cell)) continue;
      required.add(cell);
      if (!positive.has(cell)) {
        findings.push({
          code: "controls-public-rule-positive-missing",
          path: "accept",
          detail: `public rule "${checkId}" has no task-bound accept in family "${task.family}"`,
        });
      }
    }
  }
  for (const checkId of missingChecks) {
    findings.push({
      code: "controls-public-rule-negative-missing",
      path: "reject",
      detail: `public rule "${checkId}" has no declared task-bound negative; add one with expectedCheckId "${checkId}" in any family it applies to, built from a known-correct example with one fact changed`,
    });
  }
  for (const family of missingFamilies) {
    findings.push({
      code: "controls-public-rule-negative-missing",
      path: "reject",
      detail: `family "${family}" has no declared task-bound negative; add one bound to a task of that family, built from its known-correct example with one fact changed`,
    });
  }
  return findings;
}

export function validateControls(
  brief: Brief,
  corpus: ControlCorpus,
  tasks: readonly ControlTask[],
): ValidationResult {
  const malformed = corpusRowFindings(corpus);
  if (malformed.length > 0) return validated(malformed);
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const findings: ContractFinding[] = [
    ...bindingFindings(corpus, taskById),
    ...corpus.accept.flatMap((control, i) =>
      acceptSchemaFindings(brief.artifactSchema, control.artifact, `accept[${i}]`),
    ),
  ];
  corpus.reject.forEach((control, i) => {
    const hiddenFindings =
      control.hidden === undefined ? [] : hiddenFieldFindings(control.hidden, `reject[${i}].hidden`);
    const hiddenRows = hiddenFindings.length === 0 && Array.isArray(control.hidden) ? control.hidden : null;
    findings.push(...hiddenFindings, ...rejectReferenceFindings(brief, control, i, hiddenRows));
  });
  findings.push(...publicRuleFindings(brief, corpus, tasks, taskById));
  return validated(findings);
}
