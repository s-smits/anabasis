/** Conformance opens every task through every generated reader, adviser and writer, once each. */
import { Value } from "typebox/value";
import { isNumber, isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { stableJson } from "../meta/stable-json.ts";
import type { BuiltStarter } from "../solve/built-starter.ts";
import type { GeneratedTaskAccess } from "../solve/task-access-trace.ts";
import { type ContractFinding, controllerValidatedFindings } from "./brief.ts";
import { publicInputPathsByFamily } from "./public-input-paths.ts";
import type { BuildTask } from "./tasks.ts";
import type { ToolSpec, ToolsSpec } from "./tools-spec.ts";
import { GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";

const SCALARS = new Map<string, JsonValue>([
  ["boolean", false],
  ["null", null],
]);

const NO_ACCESS: GeneratedTaskAccess = { events: [], opaqueCopies: 0, truncated: false };

/**
 * One value a JSON schema admits, from const, enum, anyOf/oneOf, type, required, minItems,
 * minLength and minimum; `undefined` when those keywords do not settle one. Pattern and
 * exclusive bounds are not read: `Value.Check` refuses the value and the row declares one instead.
 */
function sample(schema: JsonValue | undefined): JsonValue | undefined {
  if (!isRecord(schema)) return undefined;
  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const alternatives =
    [schema.anyOf, schema.oneOf].find((value) => Array.isArray(value)) ??
    (Array.isArray(schema.type)
      ? schema.type.flatMap((type) => (isString(type) ? [{ ...schema, type }] : []))
      : null);
  if (Array.isArray(alternatives)) return alternatives.map(sample).find((value) => value !== undefined);
  if (!isString(schema.type)) return undefined;
  switch (schema.type) {
    case "object": {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      // A key that is not a string, or one with no sample, is missing from the entries and refuses.
      const entries = required.flatMap((key): [string, JsonValue][] => {
        if (!isString(key)) return [];
        const value = sample(properties[key]);
        return value === undefined ? [] : [[key, value]];
      });
      return entries.length === required.length ? Object.fromEntries(entries) : undefined;
    }
    case "array": {
      const count = isNumber(schema.minItems) ? Math.max(0, Math.ceil(schema.minItems)) : 0;
      const item = count === 0 ? null : sample(schema.items);
      return item === undefined ? undefined : Array.from({ length: count }, () => item);
    }
    case "string":
      return "x".repeat(isNumber(schema.minLength) ? schema.minLength : 0);
    case "integer":
    case "number":
      return isNumber(schema.minimum) ? schema.minimum : 0;
    default:
      return SCALARS.get(schema.type);
  }
}

function accepts(parameters: JsonValue, value: JsonValue | undefined): value is JsonObject {
  if (!isRecord(value)) return false;
  try {
    return Value.Check(
      /* SAFETY: generated parameters cannot carry a TypeBox static type; a schema TypeBox cannot read throws into the catch. */ parameters as never,
      value,
    );
  } catch {
    return false;
  }
}

/** The row's declared arguments, else a sampled object, else the finding that says what to declare. */
function callArguments(
  row: ToolSpec,
  parameters: JsonValue,
): { args: JsonObject } | { finding: ContractFinding } {
  const declared = row.conformanceArguments;
  if (declared !== undefined) {
    return accepts(parameters, declared)
      ? { args: declared }
      : {
          finding: {
            code: "generated-toolset-arguments-invalid",
            path: TOOLS_SPEC_FILE,
            detail: `the conformanceArguments declared for "${row.name}" do not satisfy the parameters agent/tools.ts registers for it; declare one object those parameters accept`,
          },
        };
  }
  const sampled = sample(parameters);
  // An unsampleable tool is a finding, never a silent skip: before 2026-09-15 it was skipped and
  // no task was opened through it, so the probe reported nothing about the one tool it could not
  // call.
  return accepts(parameters, sampled)
    ? { args: sampled }
    : {
        finding: {
          code: "generated-toolset-unprobed",
          path: TOOLS_SPEC_FILE,
          detail: `no argument object could be derived for generated tool "${row.name}", so no task was opened through it; add "conformanceArguments" to its tools-spec.json row with one object its parameters accept, and keep the schema as it is`,
        },
      };
}

/** Public task paths read since `before` that no validated task carries. */
function absentPaths(
  reader: string,
  before: GeneratedTaskAccess,
  after: GeneratedTaskAccess,
  carried: ReadonlySet<string>,
): ContractFinding[] {
  return [...new Set(after.events.slice(before.events.length))].flatMap((path) =>
    carried.has(path)
      ? []
      : [
          {
            code: "task-public-path-absent",
            path: `agent/tools.ts#${reader}`,
            detail: `tool "${reader}" read public task path ${path}, which is absent from every validated task`,
          },
        ],
  );
}

/**
 * Readers and advisers run before writers, so a draft change cannot move an interpreter's access
 * trace. Two refusals have fired in recorded runs: a public path no task carries, which was run
 * 12's misnamed field, and a call that throws.
 *
 * Every row is authored and keeps its detail through the author projection, because an unmarked
 * row arrives as the detail-free unclassified label — pr179 lost 427 of them that way. Repeats
 * across tasks collapse, so a tool broken for every task is one row rather than one per task.
 */
export async function probeTaskInterpreters(
  openStarter: (task: BuildTask) => Promise<BuiltStarter>,
  spec: ToolsSpec,
  tasks: readonly BuildTask[],
): Promise<ContractFinding[]> {
  const interpreters = spec.tools.filter((tool) => tool.kind === "reader" || tool.kind === "advisor");
  const order = [...interpreters, ...spec.tools.filter((tool) => !interpreters.includes(tool))];
  if (order.length === 0) return [];
  // A shared reader doing `wind?.pressure` for a family without wind is correct code.
  const carried = new Set([...publicInputPathsByFamily(tasks).values()].flatMap((paths) => [...paths]));
  const findings: ContractFinding[] = [];
  for (const task of tasks) {
    const starter = await openStarter(task);
    let seen = starter.taskAccess?.() ?? NO_ACCESS;
    findings.push(...absentPaths("createDomainHarness", NO_ACCESS, seen, carried));
    for (const row of order) {
      const tool = starter.tools.find(({ name }) => name === row.name);
      // A declared tool the registration lacks is tools-contract-mismatch's row.
      if (tool?.execute === undefined) continue;
      const call = callArguments(row, tool.parameters);
      if ("finding" in call) {
        findings.push(call.finding);
        continue;
      }
      const failure = await tool
        .execute(
          `conformance-task-${task.taskId}-${row.name}`,
          /* SAFETY: `accepts` checked these arguments against the registered parameters. */ call.args as never,
        )
        .then(
          () => null,
          (cause: unknown) => errorMessage(cause),
        );
      const now = starter.taskAccess?.();
      if (now != null) {
        findings.push(...absentPaths(row.name, seen, now, carried));
        seen = now;
      }
      if (failure !== null) {
        findings.push({
          code: "generated-toolset-throws",
          path: GENERATED_TOOLS_FILE,
          detail: `generated tool "${row.name}" failed during a schema-valid conformance call: ${failure}`,
        });
        break;
      }
    }
  }
  return controllerValidatedFindings([
    ...new Map(findings.map((finding) => [stableJson(finding), finding])).values(),
  ]);
}
