/**
 * Validate the Builder's brief before any candidate code executes. This module checks field types,
 * declared check inputs, join ownership, artifact roots and rule citations, and it is the last place
 * a malformed brief can be refused cheaply: everything after it spends a worker or a paid turn on
 * the assumption that the contract it declares is the contract it has.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import {
  type Brief,
  type ContractFinding,
  type ValidationResult,
  finding,
  fieldFinding,
  jsonPathFinding,
  recordView,
} from "./brief.ts";
import { jsonPathTokens } from "../meta/json-evidence.ts";
import { citedDecisionIdFindings, ruleDecisionFieldFindings } from "./rule-decisions.ts";
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type JsonObject,
  type JsonValue,
} from "../meta/json-shape.ts";
import { numericBoundaryFieldFindings, numericBoundaryFindings } from "./numeric-boundary.ts";

/**
 * Exactly what the shape pass proves: the named fields are present with the right container kind,
 * and nothing at all about their elements. Naming that intermediate state lets the six element walks
 * below read the parsed JSON values directly instead of asserting each container back down from the
 * contract type.
 */
type BriefRecord = JsonObject & {
  slug: string;
  domain: string;
  decisions: JsonValue[];
  gates: JsonValue[];
  truthChecks: JsonValue[];
  joins: JsonValue[];
  artifactSchema: JsonValue[];
  designRuleConstants: JsonValue[];
  designRuleSets?: JsonValue[];
  ruleDecisions?: JsonValue[];
};

const EXECUTION_KEYS = [
  "families",
  "artifactPaths",
  "publicInputPaths",
  "hidden",
  "evidence",
  "requiredToolIds",
];
const EXECUTION_CONTRACT =
  '{"families", "artifactPaths", "publicInputPaths", "hidden", "evidence"} with optional authored "requiredToolIds"; check fields such as "numericBoundaries" sit beside execution';

function distinctStrings(value: unknown, emptiness: "nonempty" | "may-be-empty"): boolean {
  return (
    Array.isArray(value) &&
    (emptiness === "may-be-empty" || value.length > 0) &&
    value.every((entry) => isString(entry) && entry.trim() !== "") &&
    new Set(value).size === value.length
  );
}

/** One shape finding per malformed execution field; unknown keys are part of the shape. */
function checkExecutionFieldFindings(value: unknown, path: string): ContractFinding[] {
  if (!isRecord(value) || Object.keys(value).some((key) => !EXECUTION_KEYS.includes(key))) {
    return [fieldFinding(path, EXECUTION_CONTRACT, value, EXECUTION_KEYS)];
  }
  const findings: ContractFinding[] = [];
  if (value.families !== "all" && !distinctStrings(value.families, "nonempty")) {
    findings.push(
      fieldFinding(`${path}.families`, '"all" or a non-empty distinct family list', value.families),
    );
  }
  if (!distinctStrings(value.artifactPaths, "nonempty")) {
    findings.push(
      fieldFinding(`${path}.artifactPaths`, "a non-empty list of distinct rooted paths", value.artifactPaths),
    );
  }
  if (!distinctStrings(value.publicInputPaths, "may-be-empty")) {
    findings.push(
      fieldFinding(`${path}.publicInputPaths`, "a list of distinct rooted paths", value.publicInputPaths),
    );
  }
  if (value.hidden !== "none" && value.hidden !== "required") {
    findings.push(fieldFinding(`${path}.hidden`, '"none" or "required"', value.hidden));
  }
  const evidence = recordView(value.evidence);
  const evidenceKeys = evidence?.kind === "external" ? ["kind", "requiredToolIds"] : ["kind"];
  const closed = evidence !== null && Object.keys(evidence).every((key) => evidenceKeys.includes(key));
  const authored = closed && evidence.kind === "authored";
  const external =
    closed && evidence.kind === "external" && distinctStrings(evidence.requiredToolIds, "nonempty");
  if (!authored && !external) {
    findings.push(
      fieldFinding(
        `${path}.evidence`,
        '{"kind":"authored"} or {"kind":"external","requiredToolIds":[...]}',
        value.evidence,
        evidenceKeys,
      ),
    );
  }
  if (
    Object.hasOwn(value, "requiredToolIds") &&
    (!authored || !distinctStrings(value.requiredToolIds, "nonempty"))
  ) {
    findings.push(
      fieldFinding(
        `${path}.requiredToolIds`,
        "a non-empty distinct tool list beside authored evidence; external evidence carries its own list",
        value.requiredToolIds,
      ),
    );
  }
  return findings;
}

function briefFieldFindings(value: JsonObject): ContractFinding[] {
  if (value.correctnessContract !== "check-program/v1") {
    return [
      finding(
        "unsupported-correctness-contract",
        "correctnessContract",
        "check-program/v1 is the only contract: each truth check is one named boolean function",
      ),
    ];
  }
  const findings: ContractFinding[] = [];
  for (const field of ["slug", "domain"] as const) {
    if (!isString(value[field])) findings.push(fieldFinding(field, "a string", value[field]));
  }
  for (const field of [
    "decisions",
    "gates",
    "truthChecks",
    "joins",
    "artifactSchema",
    "designRuleConstants",
  ] as const) {
    if (!Array.isArray(value[field])) findings.push(fieldFinding(field, "an array", value[field]));
  }
  if (value.designRuleSets !== undefined && !Array.isArray(value.designRuleSets)) {
    findings.push(fieldFinding("designRuleSets", "an array (optional)", value.designRuleSets));
  }
  if (value.ruleDecisions !== undefined && !Array.isArray(value.ruleDecisions)) {
    findings.push(fieldFinding("ruleDecisions", "an array (optional)", value.ruleDecisions));
  }
  if (findings.length > 0) return findings;
  // SAFETY: the loops above found every BriefRecord field present with the right container kind.
  const brief = value as BriefRecord;
  // The static type promises string[], but nothing checked the entries, so a brief whose decision
  // rows were objects or blank strings still validated. Decisions are the coverage map, which means
  // each row has to be a note a reader can actually read.
  brief.decisions.forEach((entry, i) => {
    if (!isString(entry) || entry.trim() === "") {
      findings.push(fieldFinding(`decisions[${i}]`, "a non-empty string", entry));
    }
  });
  findings.push(...ruleDecisionFieldFindings(brief.ruleDecisions ?? []));
  findings.push(
    ...artifactSchemaFieldFindings(brief),
    ...truthCheckFieldFindings(brief),
    ...joinFieldFindings(brief),
    ...designRuleFieldFindings(brief),
  );
  return findings;
}

/** Shape of each declared artifact root: its name and shape strings, and the optional marks the
 *  census reads as boundaries. */
function artifactSchemaFieldFindings(brief: BriefRecord): ContractFinding[] {
  const findings: ContractFinding[] = [];
  brief.artifactSchema.forEach((field, i) => {
    if (!isRecord(field) || !isString(field.name) || !isString(field["shape"])) {
      findings.push(fieldFinding(`artifactSchema[${i}]`, '{"name": string, "shape": string}', field));
    } else if (field.allowedValues !== undefined && !Array.isArray(field.allowedValues)) {
      findings.push(
        fieldFinding(`artifactSchema[${i}].allowedValues`, "an array (optional)", field.allowedValues),
      );
    } else if (field.taskConditioned !== undefined && field.taskConditioned !== true) {
      // The literal true alone, as `fileMap` is declared: the family census reads this mark as a
      // boundary, and a truthy string or a 1 would silently move a root the author never meant to
      // declare material.
      findings.push(
        fieldFinding(
          `artifactSchema[${i}].taskConditioned`,
          "the literal true (optional)",
          field.taskConditioned,
        ),
      );
    } else if (
      field.openMapPaths !== undefined &&
      (!Array.isArray(field.openMapPaths) ||
        field.openMapPaths.some((path) => !isString(path) || path.trim() === ""))
    ) {
      findings.push(
        fieldFinding(
          `artifactSchema[${i}].openMapPaths`,
          "an array of non-empty dotted paths (optional)",
          field.openMapPaths,
        ),
      );
    }
  });
  return findings;
}

/** Shape of each truth check: identity, assertion, execution block and declared ids, with the
 *  superseded deciding fields refused by name rather than ignored, so a brief still carrying one is
 *  told what replaced it instead of validating with a field nothing reads. */
function truthCheckFieldFindings(brief: BriefRecord): ContractFinding[] {
  const findings: ContractFinding[] = [];
  brief.truthChecks.forEach((check, i) => {
    if (!isRecord(check) || !isString(check.id) || check.id.trim() === "" || !isString(check.assertion)) {
      findings.push(
        fieldFinding(`truthChecks[${i}]`, "a check with non-empty id, assertion and execution", check),
      );
      return;
    }
    for (const old of ["predicate", "grounding", "publicInputPaths"]) {
      if (Object.hasOwn(check, old)) {
        findings.push(
          finding(
            "unsupported-correctness-contract",
            `truthChecks[${i}].${old}`,
            "execution and the named program are the only authority; remove this deciding field",
          ),
        );
      }
    }
    findings.push(...checkExecutionFieldFindings(check.execution, `truthChecks[${i}].execution`));
    if (
      check.joinIds !== undefined &&
      (!Array.isArray(check.joinIds) ||
        !check.joinIds.every(isString) ||
        new Set(check.joinIds).size !== check.joinIds.length)
    ) {
      findings.push(
        fieldFinding(`truthChecks[${i}].joinIds`, "an array of distinct join ids", check.joinIds),
      );
    }
    findings.push(...citedDecisionIdFindings(check, i), ...numericBoundaryFieldFindings(check, i));
  });
  return findings;
}

/** Shape of each join row. */
function joinFieldFindings(brief: BriefRecord): ContractFinding[] {
  const findings: ContractFinding[] = [];
  brief.joins.forEach((join, i) => {
    if (
      !isRecord(join) ||
      !isString(join.id) ||
      !isString(join.description) ||
      !Array.isArray(join.decoyClasses)
    ) {
      findings.push(
        fieldFinding(`joins[${i}]`, '{"id": string, "description": string, "decoyClasses": string[]}', join),
      );
    }
  });
  return findings;
}

/** Shape of the design-rule sets and constants: each row cited, each set name declared once. */
function designRuleFieldFindings(brief: BriefRecord): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const seenSetNames = new Set<string>();
  (brief.designRuleSets ?? []).forEach((set, i) => {
    if (
      !isRecord(set) ||
      !isString(set.name) ||
      !Array.isArray(set.values) ||
      set.values.length === 0 ||
      !set.values.every((entry) => isNumber(entry) || isString(entry)) ||
      (set.unit !== undefined && !isString(set.unit)) ||
      !isString(set.authority) ||
      !isString(set.citation)
    ) {
      findings.push(
        fieldFinding(
          `designRuleSets[${i}]`,
          '{"name": string, "values": non-empty (string|number)[], "unit"?: string, "authority": string, "citation": string}',
          set,
        ),
      );
      return;
    }
    if (seenSetNames.has(set.name)) {
      findings.push(fieldFinding(`designRuleSets[${i}].name`, "a unique design-rule set name", set.name));
    }
    seenSetNames.add(set.name);
  });
  brief.designRuleConstants.forEach((constant, i) => {
    if (
      !isRecord(constant) ||
      !isString(constant.name) ||
      (!isNumber(constant.value) && !isString(constant.value)) ||
      (constant.unit !== undefined && !isString(constant.unit)) ||
      !isString(constant.authority) ||
      !isString(constant.citation)
    ) {
      findings.push(
        fieldFinding(
          `designRuleConstants[${i}]`,
          '{"name": string, "value": number|string, "authority": string, "citation": string}',
          constant,
        ),
      );
    }
  });
  return findings;
}

/** The truth-check pass, and the artifact roots those checks declared they read, where "$" includes
 *  the whole artifact. A declaration makes a value available to a check; it does not prove the check
 *  uses it. Only paths that input validation accepted are added here, so the unread-root check below
 *  reads exactly the same selections this pass approved. */
function truthCheckFindings(brief: Brief) {
  const findings: ContractFinding[] = [];
  const checkIds = new Set<string>();
  const artifactRoots = new Set(brief.artifactSchema.map((field) => field.name));
  const readRoots = new Set<string>();
  brief.truthChecks.forEach((check, i) => {
    if (checkIds.has(check.id)) {
      findings.push(
        finding("brief-duplicate-check-id", `truthChecks[${i}].id`, `"${check.id}" declared twice`),
      );
    }
    checkIds.add(check.id);
    findings.push(...numericBoundaryFindings(brief, check, i));
    for (const [index, path] of check.execution.publicInputPaths.entries()) {
      findings.push(
        ...jsonPathFinding(
          path,
          `truthChecks[${i}].execution.publicInputPaths[${index}]`,
          "public input path",
        ),
      );
    }
    for (const [index, path] of check.execution.artifactPaths.entries()) {
      const fieldPath = `truthChecks[${i}].execution.artifactPaths[${index}]`;
      if (jsonPathTokens(path) === null) {
        findings.push(...jsonPathFinding(path, fieldPath, "artifact path"));
        continue;
      }
      const root = /^\$\.([^.[\]]+)/.exec(path)?.[1] ?? null;
      if (path !== "$" && (root === null || !artifactRoots.has(root))) {
        findings.push(
          finding(
            "brief-check-artifact-root-undeclared",
            fieldPath,
            "artifact paths must read a declared artifactSchema root",
          ),
        );
      } else readRoots.add(root ?? "$");
    }
    for (const joinId of check.joinIds ?? []) {
      if (!brief.joins.some((join) => join.id === joinId)) {
        findings.push(
          finding("brief-check-join-undeclared", `truthChecks[${i}].joinIds`, `undeclared join ${joinId}`),
        );
      }
    }
  });
  return { findings, readRoots };
}

/** Each join is owned by exactly one check and carries distinct decoy classes, which is what makes
 *  its discrimination evidence about the join rather than about label completeness. */
function joinFindings(brief: Brief): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const joinOwners = new Map<string, string[]>();
  for (const check of brief.truthChecks) {
    for (const joinId of check.joinIds ?? []) {
      const ids = joinOwners.get(joinId) ?? [];
      ids.push(check.id);
      joinOwners.set(joinId, ids);
    }
  }
  const joinIds = new Set<string>();
  brief.joins.forEach((join, i) => {
    if (joinIds.has(join.id)) {
      findings.push(
        finding("brief-duplicate-join-id", `joins[${i}].id`, `join id "${join.id}" is declared twice`),
      );
    }
    joinIds.add(join.id);
    const owners = joinOwners.get(join.id) ?? [];
    if (owners.length !== 1) {
      findings.push(
        finding(
          "brief-join-check-ownership-invalid",
          `joins[${i}].id`,
          `join "${join.id}" must be owned by exactly one named truth check, got [${owners.join(", ")}]`,
        ),
      );
    }
    if (join.decoyClasses.length === 0) {
      findings.push(
        finding(
          "brief-join-no-decoys",
          `joins[${i}].decoyClasses`,
          `join "${join.id}" declares no decoy classes — discrimination would prove label completeness, not join soundness`,
        ),
      );
    }
    if (new Set(join.decoyClasses).size !== join.decoyClasses.length) {
      findings.push(
        finding(
          "brief-duplicate-decoy-class",
          `joins[${i}].decoyClasses`,
          `join "${join.id}" repeats a decoy class — one control must not satisfy duplicate obligations`,
        ),
      );
    }
  });
  return findings;
}

/** Each declared artifact root must be addressable, declared once, read by some check, and — where
 *  it closes a value set — carry distinct scalar allowed values. */
function artifactSchemaFindings(brief: Brief, readRoots: ReadonlySet<string>): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const fieldNames = new Set<string>();
  brief.artifactSchema.forEach((field, i) => {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field.name)) {
      findings.push(
        finding(
          "brief-artifact-field-unaddressable",
          `artifactSchema[${i}].name`,
          `field name ${capturedJsonStringify(field.name)} cannot be used in a check path; use letters, numbers, underscores, or hyphens and start with a letter or underscore`,
        ),
      );
    }
    if (fieldNames.has(field.name)) {
      findings.push(
        finding(
          "brief-duplicate-artifact-field",
          `artifactSchema[${i}].name`,
          `"${field.name}" declared twice`,
        ),
      );
    }
    fieldNames.add(field.name);
    // A root no check reads measures nothing. In run 80 the schema declared firmware source roots
    // and the reference solve filled them, while every check read only the derived summary, so
    // replacing or omitting every source file was accepted 25 of 25. Refuse such a root before F2
    // executes. A check selecting the whole artifact ("$") covers every root, and where no checks
    // exist at all, brief-no-truth-checks already reports that failure without a duplicate here.
    if (brief.truthChecks.length > 0 && !readRoots.has("$") && !readRoots.has(field.name)) {
      findings.push(
        finding(
          "brief-artifact-root-unread",
          `artifactSchema[${i}].name`,
          `no truth check reads any path under artifactSchema field "${field.name}" — an agent may write anything there, or omit it entirely, and still pass every check, so the field measures nothing; declare a truth check over it or drop it from the artifact schema`,
        ),
      );
    }
    if (field.allowedValues === undefined) return;
    const scalar = (value: JsonValue) =>
      isString(value) || isBoolean(value) || (isNumber(value) && Number.isFinite(value));
    const encodedValues = field.allowedValues.map((value) => capturedJsonStringify(value));
    if (
      field.allowedValues.length === 0 ||
      !field.allowedValues.every(scalar) ||
      new Set(encodedValues).size !== encodedValues.length
    ) {
      findings.push(
        finding(
          "brief-artifact-field-allowed-values-invalid",
          `artifactSchema[${i}].allowedValues`,
          `field "${field.name}" allowedValues must be a non-empty set of distinct JSON scalars (string, finite number, or boolean)`,
        ),
      );
    }
  });
  return findings;
}

/** Design-rule constants are named once and cited to an external authority. */
function designRuleConstantFindings(brief: Brief): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const constantNames = new Set<string>();
  brief.designRuleConstants.forEach((constant, i) => {
    if (constant.name.trim() === "") {
      findings.push(
        finding(
          "brief-design-rule-constant-name-empty",
          `designRuleConstants[${i}].name`,
          "design-rule constant names must be non-empty so predicate bindings are explicit",
        ),
      );
    } else if (constantNames.has(constant.name)) {
      findings.push(
        finding(
          "brief-duplicate-design-rule-constant",
          `designRuleConstants[${i}].name`,
          `design-rule constant name ${capturedJsonStringify(constant.name)} is declared twice; first-match lookup would make truth depend on array order`,
        ),
      );
    }
    constantNames.add(constant.name);
    if (!constant.authority.trim() || !constant.citation.trim()) {
      findings.push(
        finding(
          "brief-constant-uncited",
          `designRuleConstants[${i}]`,
          `"${constant.name}" has no external authority/citation — the hw22 wrong-rule-content class`,
        ),
      );
    }
  });
  return findings;
}

export function validateBrief(value: unknown): ValidationResult {
  const fieldFindings = isRecord(value)
    ? briefFieldFindings(value)
    : [fieldFinding("$", "a JSON object with the brief fields", value)];
  if (fieldFindings.length > 0) return { ok: false, findings: fieldFindings };
  // SAFETY: briefFieldFindings found every field and every walked element of its declared type.
  const brief = value as Brief;
  const checks = truthCheckFindings(brief);
  const findings: ContractFinding[] = [];
  if (brief.truthChecks.length === 0) {
    findings.push(
      finding(
        "brief-no-truth-checks",
        "truthChecks",
        "add at least one check that can return a clear result",
      ),
    );
  }
  findings.push(...checks.findings, ...joinFindings(brief));
  if (brief.artifactSchema.length === 0) {
    findings.push(
      finding(
        "brief-no-artifact-schema",
        "artifactSchema",
        "artifactSchema is empty; declare one output shape for the examples, correctnessModel, and tools to share",
      ),
    );
  }
  findings.push(...artifactSchemaFindings(brief, checks.readRoots), ...designRuleConstantFindings(brief));
  return { ok: findings.length === 0, findings };
}
