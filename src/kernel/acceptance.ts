import { Pointer } from "typebox/value";
import { asRecord, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { pooled } from "../meta/pool.ts";
import type { AnswerFile } from "./answer-files.ts";
import { gainOver, GAP_FLOOR, objectiveRuleOf } from "./compare.ts";
import { answerFormatFault, type Contract } from "./contract.ts";
import { eventsOf, type LogEvent } from "./log.ts";
import {
  applicableTruthChecks,
  type Brief,
  decided,
  decides,
  faultyOf,
  OBJECTIVE,
  objectiveOf,
  requiredToolsOf,
  scoresOf,
  spelled,
  type Task,
  type Verdict,
  type Verifier,
} from "./verify.ts";

export const AUTHOR = "author";

export interface Control {
  readonly taskId: string;
  readonly answer: JsonValue;
  readonly refusedBy: string | null;
  readonly files?: readonly AnswerFile[];
}

interface ControlAnswerRun extends Control {
  readonly verdicts: readonly [Verdict, Verdict];
}

interface Idle {
  readonly taskId: string;
  readonly verdict: Verdict;
}

export type ToolAvailability = boolean | "pack" | "host";

interface CheckReading {
  readonly id: string;
  readonly instrument: string;
  readonly missing: readonly string[];
  readonly passed: number;
  readonly refused: number;
  readonly named: number;
  readonly caught: number;
}

export interface Checker {
  readonly contract: string;
  readonly checks: string;
}

export interface Read {
  readonly verify: Verifier;
  readonly brief: Brief;
  readonly contract: Contract;
  readonly tasks: readonly Task[];
  readonly controls: readonly Control[];
  readonly found: (toolId: string) => ToolAvailability;
  readonly width: number;
  readonly probes?: false;
}

interface Probe {
  readonly run: ControlAnswerRun;
  readonly task: Task;
  readonly files: readonly AnswerFile[] | undefined;
}

type SchemaHandler = (
  held: Record<string, JsonValue | undefined>,
  smallest: (inner: JsonValue | undefined) => JsonValue,
) => JsonValue;

const NO_FILES: readonly AnswerFile[] = [];
const when = (holds: boolean, text: string) => (holds ? [text] : []);

const BY_TYPE = new Map<string, SchemaHandler>([
  [
    "object",
    (held, smallest) => {
      const properties = asRecord(held.properties) ?? {};
      const required = Array.isArray(held.required) ? held.required.filter(isString) : [];
      return Object.fromEntries(required.map((name) => [name, smallest(properties[name])]));
    },
  ],
  [
    "array",
    (held, smallest) =>
      Array.from({ length: isNumber(held.minItems) ? held.minItems : 0 }, () => smallest(held.items)),
  ],
  ["string", (held) => "x".repeat(isNumber(held.minLength) ? held.minLength : 0)],
  [
    "number",
    (held) =>
      isNumber(held.minimum) ? held.minimum : isNumber(held.exclusiveMinimum) ? held.exclusiveMinimum + 1 : 0,
  ],
  ["boolean", () => false],
]);

function doNothingAnswer(
  schema: JsonValue | undefined,
  root: JsonValue | undefined = schema,
  following: readonly string[] = [],
): JsonValue {
  const held = asRecord(schema);
  if (held === null) return null;
  const smallest = (inner: JsonValue | undefined) => doNothingAnswer(inner, root, following);
  if (isString(held.$ref) && held.$ref.startsWith("#")) {
    return following.includes(held.$ref)
      ? null
      : doNothingAnswer(asRecord(Pointer.Get(root, held.$ref.slice(1))), root, [...following, held.$ref]);
  }
  if (held.const !== undefined) return held.const;
  if (Array.isArray(held.enum)) return held.enum[0] ?? null;
  const choice = [held.anyOf, held.oneOf].find((options) => Array.isArray(options));
  if (Array.isArray(choice)) return smallest(choice[0]);
  const rawType = Array.isArray(held.type) ? held.type[0] : held.type;
  const handler = BY_TYPE.get(rawType === "integer" ? "number" : isString(rawType) ? rawType : "");
  return handler === undefined ? null : handler(held, smallest);
}

async function probeSensitivity(given: Read, probes: readonly Probe[]) {
  if (probes.length === 0) return { results: [], allValid: false, blind: false };
  const results = (
    await pooled(probes, given.width, async ({ run, task, files }) => ({
      run,
      verdict: await given.verify(task, run.answer, undefined, files),
    }))
  ).filter(({ verdict }) => verdict.kind !== "non-result");
  const rule = objectiveRuleOf(given.brief.objective) ?? { direction: "higher" };
  const allValid =
    results.length > 0 &&
    results.every(
      ({ verdict }) =>
        verdict.kind === "pass" || (verdict.kind === "faulty" && verdict.check === OBJECTIVE.id),
    );
  const blind =
    results.length > 0 &&
    results.every(
      ({ run, verdict }) =>
        verdict.kind === "pass" &&
        Math.abs(gainOver(rule, objectiveOf(verdict), objectiveOf(run.verdicts[0]))) < GAP_FLOOR,
    );
  return { results, allValid, blind };
}

function flatRubricNotes(brief: Brief, verdicts: readonly Verdict[]): string[] {
  return (brief.objective?.items ?? []).flatMap(({ id }) => {
    const seen = verdicts.flatMap((verdict) => {
      const value = scoresOf(verdict)?.[id];
      return value === undefined ? [] : [value];
    });
    if (seen.length < 2) return [];
    const span = Math.max(...seen) - Math.min(...seen);
    return when(
      span < GAP_FLOOR,
      `rubric item ${id} stayed within ${String(GAP_FLOOR * 100)}% (near ${String(seen[0])}) across all ${String(seen.length)} passing control and sensitivity probes`,
    );
  });
}

async function deliverableReading(
  given: Read,
  byId: ReadonlyMap<string, Task>,
  accepted: readonly ControlAnswerRun[],
) {
  const stripped = await probeSensitivity(
    given,
    accepted.flatMap((run) => {
      const task = run.files && run.files.length > 0 ? byId.get(run.taskId) : undefined;
      return task === undefined ? [] : [{ run, task, files: NO_FILES }];
    }),
  );
  const faultyStrips = stripped.results.flatMap(({ run, verdict }) => {
    const fault = faultyOf(verdict);
    return fault === null
      ? []
      : [
          `removing deliverable files caused ${fault.check === OBJECTIVE.id ? OBJECTIVE.id : `check ${fault.check}`} to fault on ${run.taskId}: ${fault.reason}`,
        ];
  });
  const partialStrips = stripped.allValid
    ? []
    : stripped.results.flatMap(({ run, verdict }) =>
        when(
          verdict.kind === "pass",
          `the accept control of ${run.taskId} still passed with all deliverable files removed`,
        ),
      );
  return {
    results: stripped.results,
    faults: when(
      stripped.blind,
      "deliverable files had no effect on any accept control: with all deliverables removed, every accept control passed and measured within the comparison's floor of its own measure, so no check or objective reads them",
    ),
    notes: [
      ...faultyStrips,
      ...partialStrips,
      ...when(
        stripped.allValid && !stripped.blind,
        "every validity check passed when each example's deliverable files were removed: only the objective read deliverables, so validity checks ignore submitted files",
      ),
    ],
  };
}

async function probeReading(
  given: Read,
  byId: ReadonlyMap<string, Task>,
  runs: readonly ControlAnswerRun[],
): Promise<{ readonly faults: readonly string[]; readonly notes: readonly string[] }> {
  const { tasks } = given;
  const accepted = runs.filter(
    ({ refusedBy, verdicts: [first] }) => refusedBy === null && first.kind === "pass",
  );
  const others = (run: ControlAnswerRun, as: (other: Task) => Task | null) =>
    tasks.flatMap((other) => {
      const task = other.taskId === run.taskId ? null : as(other);
      return task === null ? [] : [{ run, task, files: run.files }];
    });

  const { results: swaps } = await probeSensitivity(
    given,
    accepted.flatMap((run) => others(run, (other) => other)),
  );
  const byRun = Map.groupBy(swaps, ({ run }) => run);
  const [swapped, partialSwaps, faultySwaps]: [string[], string[], string[]] = [[], [], []];
  for (const run of accepted) {
    const own = byRun.get(run) ?? [];
    const passed = own.filter(({ verdict }) => verdict.kind === "pass").length;
    if (own.length > 0 && passed === own.length) {
      swapped.push(
        `the accept control of ${run.taskId} passed every other example: its checks do not bind to the task`,
      );
    } else if (passed > 0) {
      partialSwaps.push(
        `the accept control of ${run.taskId} also passed ${String(passed)} of ${String(own.length)} other examples`,
      );
    }
    const fault = own.map(({ verdict }) => faultyOf(verdict)).find((one) => one !== null);
    if (fault !== undefined) {
      faultySwaps.push(
        `the accept control of ${run.taskId} faulted ${fault.check} on another example: ${fault.reason}`,
      );
    }
  }

  const hiddenOf = (task: Task) => capturedJsonStringify(task.hidden ?? null);
  const carried = tasks.length > 1 && tasks.every(({ hidden }) => hidden !== null);
  const identicalHidden = carried && accepted.length > 0 && new Set(tasks.map(hiddenOf)).size === 1;
  const hidden = await probeSensitivity(
    given,
    carried && !identicalHidden
      ? accepted.flatMap((run) => {
          const own = byId.get(run.taskId);
          return own === undefined
            ? []
            : others(run, (other) =>
                hiddenOf(other) === hiddenOf(own) ? null : { ...own, hidden: other.hidden },
              );
        })
      : [],
  );
  const deliverables = await deliverableReading(given, byId, accepted);
  const allVerdicts = [
    ...accepted.map(({ verdicts: [first] }) => first),
    ...swaps.map(({ verdict }) => verdict),
    ...hidden.results.map(({ verdict }) => verdict),
    ...deliverables.results.map(({ verdict }) => verdict),
  ];

  return {
    faults: [
      ...swapped,
      ...when(
        hidden.blind,
        "hidden values had no effect on any accept control: with another example's hidden values in place of its own, every accept control passed and measured within the comparison's floor of its own measure, so no check or objective is decided by them",
      ),
      ...deliverables.faults,
    ],
    notes: [
      ...partialSwaps,
      ...faultySwaps,
      ...when(
        identicalHidden,
        "every example carries identical hidden values, so hidden-value sensitivity could not be probed",
      ),
      ...when(
        hidden.allValid && !hidden.blind,
        "every validity check passed when each example's hidden values were swapped with another's: only the objective read hidden values, so validity checks test public properties alone",
      ),
      ...deliverables.notes,
      ...flatRubricNotes(given.brief, allVerdicts),
    ],
  };
}

export function doNothingFaults(idle: readonly Idle[]): string[] {
  return idle.flatMap(({ taskId, verdict }) =>
    when(verdict.kind !== "fail", `the do-nothing answer was not rejected on ${taskId}: ${spelled(verdict)}`),
  );
}

function controlFault({ taskId, refusedBy, verdicts: [first, second] }: ControlAnswerRun): string | null {
  const named = refusedBy === null ? `the accept control of ${taskId}` : `a reject control of ${taskId}`;
  if (spelled(first) !== spelled(second)) {
    return `${named} got two verdicts from one answer: ${spelled(first)}, then ${spelled(second)}`;
  }
  if (refusedBy === null) return first.kind === "pass" ? null : `${named} did not pass: ${spelled(first)}`;
  return first.kind === "fail" && first.blocking.includes(refusedBy)
    ? null
    : `${named} names ${refusedBy}, which did not refuse it: ${spelled(first)}`;
}

function acceptance(
  brief: Brief,
  byId: ReadonlyMap<string, Task>,
  runs: readonly ControlAnswerRun[],
  found: (toolId: string) => ToolAvailability,
): { readonly checks: readonly CheckReading[]; readonly faults: readonly string[] } {
  const graded = runs.flatMap(({ taskId, verdicts: [verdict] }) => {
    const task = byId.get(taskId);
    return task === undefined ? [] : [{ task, verdict }];
  });
  const toolInfo = (tools: readonly string[]) => ({
    instrument: tools.filter((tool) => found(tool) === true || found(tool) === "pack").join(", ") || AUTHOR,
    missing: tools.filter((tool) => found(tool) === false),
  });
  const applicable = new Map(
    [...byId.values()].map((task) => [
      task.taskId,
      new Set(applicableTruthChecks(brief, task).map(({ id }) => id)),
    ]),
  );
  const checks: CheckReading[] = [
    ...brief.truthChecks.map(({ id, execution }) => {
      const seen = graded.filter(
        ({ task, verdict }) => decides(verdict) && applicable.get(task.taskId)?.has(id) === true,
      );
      const refused = seen.filter(({ verdict }) => verdict.kind === "fail" && verdict.blocking.includes(id));
      const naming = runs.filter((run) => run.refusedBy === id);
      return {
        id,
        ...toolInfo(requiredToolsOf(execution)),
        passed: seen.length - refused.length,
        refused: refused.length,
        named: naming.length,
        caught: naming.filter(({ verdicts: [first] }) => first.kind === "fail" && first.blocking.includes(id))
          .length,
      };
    }),
    ...(brief.objective === undefined
      ? []
      : [
          {
            id: OBJECTIVE.id,
            ...toolInfo(brief.objectiveTools ?? []),
            passed: graded.filter(({ verdict }) => objectiveOf(verdict) !== null).length,
            refused: 0,
            named: 0,
            caught: 0,
          },
        ]),
  ];
  const unrun = new Map<string, string>();
  for (const { verdict } of graded) {
    const fault = faultyOf(verdict);
    if (fault !== null && !unrun.has(fault.check)) unrun.set(fault.check, fault.reason);
  }
  const faults = [
    ...runs.flatMap((run) => controlFault(run) ?? []),
    ...checks.flatMap(({ id, missing, passed, refused, caught }) => {
      const missingFaults = missing.map(
        (tool) => `${id} names ${tool}, which is not on the verifier's tool path`,
      );
      const err = unrun.get(id);
      if (err !== undefined) {
        return [
          ...missingFaults,
          id === OBJECTIVE.id
            ? `${id} could not be measured on a valid answer: ${err}`
            : `${id} could not run on an answer, so what it refuses and passes is not read: ${err}`,
        ];
      }
      const detail =
        id === OBJECTIVE.id
          ? when(passed === 0, `${id} has measured nothing in this reading`)
          : [
              ...when(refused === 0, `${id} has refused nothing in this reading`),
              ...when(passed === 0, `${id} has let nothing pass in this reading`),
              ...when(refused > 0 && caught === 0, `${id} has refused no reject control that names it`),
            ];
      return [...missingFaults, ...detail];
    }),
  ];
  return { checks, faults };
}

export async function readChecker(given: Read) {
  const { verify, brief, tasks, width } = given;
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const runs: ControlAnswerRun[] = await pooled(given.controls, width, async (control) => {
    const task = byId.get(control.taskId);
    if (task === undefined) {
      throw new Error(`a control names ${control.taskId}, which the pack holds no task for`);
    }
    const first = await decided(verify, task, control.answer, control.files);
    return { ...control, verdicts: [first, await decided(verify, task, control.answer, control.files)] };
  });
  const idle = doNothingAnswer(given.contract.answerFormat);
  const unformed = answerFormatFault(given.contract.answerFormat, idle);
  const rejected: Idle[] =
    unformed === null
      ? await pooled(tasks, width, async (task) => ({
          taskId: task.taskId,
          verdict: await decided(verify, task, idle),
        }))
      : [];
  const { checks, faults } = acceptance(brief, byId, runs, given.found);
  const probed = given.probes === false ? { faults: [], notes: [] } : await probeReading(given, byId, runs);
  return {
    runs,
    checks,
    faults: [...faults, ...(unformed === null ? doNothingFaults(rejected) : []), ...probed.faults],
    notes: [
      ...when(
        unformed !== null,
        `the do-nothing answer ${capturedJsonStringify(idle)} does not follow the answer format (${String(unformed)}), so the format refuses it before any check reads it: the host builds it from the schema's types, required properties, minimums, least lengths and counts, first enumerated or constant values, first choices and local references, and reads no other keyword`,
      ),
      ...probed.notes,
    ],
    idle,
    unformed,
    rejected,
  };
}

export function authoredFaults(checks: readonly CheckReading[], admitted: ReadonlySet<string>): string[] {
  return checks.flatMap(({ id, instrument }) =>
    when(
      instrument === AUTHOR && !admitted.has(id),
      `${id} is decided by its author's own computation and no installed instrument: it stands on the operator's word alone (--admit ${id})`,
    ),
  );
}

export function unadmitted(events: readonly LogEvent[], admitted?: readonly unknown[]): string[] {
  const reading = eventsOf(events, "checker.read").at(-1)?.event.data;
  const kept = new Set(admitted ?? (Array.isArray(reading?.admitted) ? reading.admitted : []));
  return (Array.isArray(reading?.rows) ? reading.rows : []).flatMap((row) => {
    const { id, instrument } = asRecord(row) ?? {};
    return isString(id) && instrument === AUTHOR && !kept.has(id) ? [id] : [];
  });
}

export function frozenChecker(events: readonly LogEvent[]): Checker | null {
  const data = eventsOf(events, "contract.frozen").at(-1)?.event.data;
  return isString(data?.contract) && isString(data.checks)
    ? { contract: data.contract, checks: data.checks }
    : null;
}

export function departure(events: readonly LogEvent[], own: Checker): string | null {
  const frozen = frozenChecker(events);
  if (frozen === null) return null;
  const moved = [
    ...when(frozen.contract !== own.contract, "contract"),
    ...when(frozen.checks !== own.checks, "check program"),
  ];
  return moved.length === 0
    ? null
    : `the log froze another ${moved.join(" and ")}; a changed checker takes a campaign of its own`;
}
