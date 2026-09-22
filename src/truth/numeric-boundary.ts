import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { Brief, BriefTruthCheck, ContractFinding } from "./brief.ts";
import { applicableTruthChecks, fieldFinding, finding, jsonPathFinding } from "./brief.ts";
import { isNumber, isRecord, isString } from "../meta/json-shape.ts";
import { resolvePredicatePath } from "./predicate.ts";
import type { MarginDirection, PublishedMargin } from "../solve/published-margin.ts";

const DIRECTIONS = ["atMost", "atLeast"] as const;

/**
 * Where a rule turns on a numeric constant. `publicInputPath` and `constantName` say which limit
 * and where this task states it; the optional pair says what it bounds. Declared together, the two
 * halves make one comparison the harness can run on a prepared answer with no hidden operand, which
 * `readMargins` does. Optional because a limit whose bounded quantity the artifact does not report
 * has nothing to name.
 */
export type NumericBoundaryDeclaration = {
  publicInputPath: string;
  constantName: string;
  /** Where the artifact reports the bounded value. Declared with `direction` or not at all. */
  artifactPath?: string;
  direction?: MarginDirection;
};

type NumericBoundaryObligation = NumericBoundaryDeclaration & {
  checkId: string;
  value: number;
};

type BoundaryTask = {
  taskId: string;
  family: string;
  publicInput: unknown;
  hidden?: readonly { checkId: string }[];
};

function completeBoundary(
  boundary: NumericBoundaryDeclaration,
): boundary is NumericBoundaryDeclaration &
  Required<Pick<NumericBoundaryDeclaration, "artifactPath" | "direction">> {
  return boundary.artifactPath !== undefined && boundary.direction !== undefined;
}

/**
 * The comparisons the Built Harness can show its solver: every complete boundary, projected onto the
 * families its own check applies to. A check bound to named families only measures those tasks, so a
 * family the check never runs on reads no table rather than a wrong one.
 */
export function publishedMargins(brief: Brief): PublishedMargin[] {
  return brief.truthChecks.flatMap((check) =>
    (check.numericBoundaries ?? []).filter(completeBoundary).map((boundary) => ({
      label: boundary.constantName,
      artifactPath: boundary.artifactPath,
      publicInputPath: boundary.publicInputPath,
      direction: boundary.direction,
      families: check.execution.families === "all" ? null : [...check.execution.families],
    })),
  );
}

/** `artifactPath` and `direction` complete the comparison, so one without the other is a
 *  half-stated rule rather than a narrower one. */
function declaresBoundary(boundary: unknown): boolean {
  if (!isRecord(boundary) || !isString(boundary.publicInputPath) || !isString(boundary.constantName)) {
    return false;
  }
  const keys = Object.keys(boundary);
  if (keys.some((key) => !["publicInputPath", "constantName", "artifactPath", "direction"].includes(key))) {
    return false;
  }
  if (keys.length === 2) return true;
  return (
    keys.length === 4 &&
    isString(boundary.artifactPath) &&
    isString(boundary.direction) &&
    DIRECTIONS.includes(
      /* SAFETY: isString narrowed `direction` above; `includes` is the membership test this line is asking. */ boundary.direction as MarginDirection,
    )
  );
}

/** The shape pass for an optional truth-check boundary declaration. */
export function numericBoundaryFieldFindings(check: unknown, checkIndex: number): ContractFinding[] {
  if (!isRecord(check) || check.numericBoundaries === undefined) return [];
  if (
    Array.isArray(check.numericBoundaries) &&
    check.numericBoundaries.length > 0 &&
    check.numericBoundaries.every(declaresBoundary)
  ) {
    return [];
  }
  return [
    fieldFinding(
      `truthChecks[${checkIndex}].numericBoundaries`,
      'an optional array of {"publicInputPath": string, "constantName": string} with the optional pair "artifactPath": string and "direction": "atMost" | "atLeast", both present or both absent',
      check.numericBoundaries,
    ),
  ];
}

/** Semantic binding of boundary declarations to public operands and cited numeric constants. */
export function numericBoundaryFindings(
  brief: Brief,
  check: BriefTruthCheck,
  checkIndex: number,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const keys = new Set<string>();
  for (const [boundaryIndex, boundary] of (check.numericBoundaries ?? []).entries()) {
    const base = `truthChecks[${checkIndex}].numericBoundaries[${boundaryIndex}]`;
    const key = capturedJsonStringify([boundary.publicInputPath, boundary.constantName]);
    if (keys.has(key)) {
      findings.push(
        finding("brief-numeric-boundary-duplicate", base, "each numeric boundary declaration must be unique"),
      );
    }
    keys.add(key);
    findings.push(
      ...jsonPathFinding(boundary.publicInputPath, `${base}.publicInputPath`, "numeric boundary path"),
    );
    if (boundary.artifactPath !== undefined) {
      findings.push(
        ...jsonPathFinding(boundary.artifactPath, `${base}.artifactPath`, "numeric boundary artifact path"),
      );
    }
    const constant = brief.designRuleConstants.find((candidate) => candidate.name === boundary.constantName);
    if (constant === undefined || !isNumber(constant.value)) {
      findings.push(
        finding(
          "brief-numeric-boundary-constant-invalid",
          `${base}.constantName`,
          `numeric boundary must name a declared designRuleConstants entry with a numeric value, got ${capturedJsonStringify(boundary.constantName)}`,
        ),
      );
    }
  }
  return findings;
}

/** Validated numeric boundary declarations projected onto their cited numeric value. */
export function numericBoundaryObligations(brief: Brief): NumericBoundaryObligation[] {
  const constants = new Map(
    brief.designRuleConstants.flatMap((constant) =>
      isNumber(constant.value) ? [[constant.name, constant.value] as const] : [],
    ),
  );
  return brief.truthChecks.flatMap((check) =>
    (check.numericBoundaries ?? []).flatMap((boundary) => {
      const value = constants.get(boundary.constantName);
      return value === undefined ? [] : [{ checkId: check.id, ...boundary, value }];
    }),
  );
}

/** Tasks that exercise one check at the declared equality value. */
export function boundaryWitnessTaskIds(
  brief: Brief,
  tasks: readonly BoundaryTask[],
  boundary: NumericBoundaryObligation,
): ReadonlySet<string> {
  return new Set(
    tasks.flatMap((task) => {
      if (!applicableTruthChecks(brief, task).some((check) => check.id === boundary.checkId)) return [];
      const value = resolvePredicatePath(task.publicInput, boundary.publicInputPath);
      return value.found && value.value === boundary.value ? [task.taskId] : [];
    }),
  );
}
