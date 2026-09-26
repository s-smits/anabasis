import { jsonPathTokens } from "../../src/meta/json-evidence.ts";
import { isRecord, type JsonValue } from "../../src/meta/json-shape.ts";
import type { Brief, BriefTruthCheck, CheckExecution } from "../../src/correctness-bundle/brief.ts";
import type { PublicTask } from "../../src/correctness-bundle/task-split.ts";
import type { EvaluationRequest } from "../../src/correctness-bundle/correctness-model-contract.ts";

export const CHECK_PROGRAM_CONTRACT = "check-program/v1";

/** An external check names its tools inside its evidence declaration, because the tool is the
 *  instrument deciding it; an authored check names them at the execution level, where they are
 *  ordinary dependencies. Callers that only need to know what has to be installed and hashed ask
 *  here rather than branching on the kind themselves. */
export function requiredToolsOf(execution: CheckExecution): readonly string[] {
  return execution.evidence.kind === "external"
    ? execution.evidence.requiredToolIds
    : (execution.requiredToolIds ?? []);
}

/** Declared family scope decides applicability, and nothing else does. In particular the hidden
 *  operand is not consulted here: a check that declares `hidden: "required"` and has no expectation
 *  for the task is still applicable, and `checkEvaluationRequest` throws when it comes to run it.
 *  The two outcomes have to stay distinguishable, because a check quietly dropped for want of its
 *  operand looks exactly like a check that was never meant to apply, and only one is a defect. */
export function applicableTruthChecks(brief: Brief, task: { family: string }): BriefTruthCheck[] {
  if (brief.correctnessContract !== CHECK_PROGRAM_CONTRACT) {
    throw new Error("unsupported-correctness-contract");
  }
  return brief.truthChecks.filter(
    (check) => check.execution.families === "all" || check.execution.families.includes(task.family),
  );
}

/**
 * Rebuild a value carrying only the declared paths. A declared path grants the value at that path,
 * whole: `$.system` hands over its subtree, which is what a collection predicate naming a root
 * already means. Declaring a parent therefore grants its whole subtree.
 *
 * Two grants are wider than "the declared leaf" and belong to the contract. An array keeps its
 * length, with undeclared positions as null, so an index rule and a cardinality rule both still
 * work: declaring one element reveals its array's length. Absent is distinguishable
 * from present-and-null only where some rule declared the path.
 *
 * Traversal follows the source, so key order is the task's own and the bytes are stable under brief
 * reordering. `Object.fromEntries` defines rather than assigns, so a model-authored `__proto__` key
 * lands as an own property instead of reaching a prototype.
 */
function projectPaths(value: JsonValue, paths: readonly string[][]): JsonValue {
  if (paths.some((path) => path.length === 0)) return value;
  const below = (key: string) => paths.flatMap((path) => (path[0] === key ? [path.slice(1)] : []));
  if (Array.isArray(value)) {
    return value.map((child, index) => {
      const selected = below(`[${index}]`);
      return selected.length === 0 ? null : projectPaths(child, selected);
    });
  }
  if (!isRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const selected = below(`.${key}`);
      return selected.length === 0 ? [] : [[key, projectPaths(child, selected)]];
    }),
  );
}

function projectJsonPaths(value: JsonValue, paths: readonly string[]): JsonValue {
  const parsed = paths.map((path) => {
    const segments = jsonPathTokens(path);
    if (segments === null) throw new Error(`invalid declared JSON path: ${path}`);
    return segments;
  });
  return projectPaths(value, parsed);
}

/** One projection per check, and the check process and its private tool cell both eat it. That is
 *  what keeps the declared paths a wall rather than a note: `evaluate.ts` builds the tool-input
 *  leaves from this same value, so bytes a check may hand an installed tool are bytes it was
 *  already allowed to read, and a wider tool operand cannot be reached around the projection. */
export function checkPublicInputs(
  check: BriefTruthCheck,
  request: Pick<EvaluationRequest, "artifact" | "publicTask">,
): Pick<EvaluationRequest, "artifact" | "publicTask"> {
  return {
    artifact: projectJsonPaths(
      /* SAFETY: accepted artifact bytes are parsed JSON. */ request.artifact as JsonValue,
      check.execution.artifactPaths,
    ),
    publicTask: {
      taskId: request.publicTask.taskId,
      family: request.publicTask.family,
      publicInput: projectJsonPaths(
        /* SAFETY: the committed public task is parsed JSON. */ request.publicTask.publicInput as JsonValue,
        check.execution.publicInputPaths,
      ),
    },
  };
}

/** The union of every applicable check's declared public-input paths, which is what the host opens
 *  a verifier subject with, since the subject spans all of that task's checks. It is deliberately
 *  wider than any one check's view: each check still receives its own narrower projection from
 *  `checkPublicInputs`, so the union bounds the subject without loosening a single check. */
export function evaluationPublicTask<P>(
  brief: Brief,
  task: { family: string },
  view: PublicTask<P>,
): PublicTask<P> {
  const paths = [
    ...new Set(applicableTruthChecks(brief, task).flatMap((check) => check.execution.publicInputPaths)),
  ];
  return {
    taskId: view.taskId,
    family: view.family,
    publicInput: /* SAFETY: the projection rebuilds JSON from the committed JSON view. */ projectJsonPaths(
      view.publicInput as JsonValue,
      paths,
    ) as P,
  };
}
