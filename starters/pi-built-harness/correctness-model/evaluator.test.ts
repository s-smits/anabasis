/**
 * Seed tests for the correctness model. These are tracked candidate files for you to extend
 * with domain cases as the correctness model grows. Make them pass before submitting.
 *
 * Run from the workspace root: .toolchain/bun test correctness-model/harness.test.ts correctness-model/evaluator.test.ts
 *
 * It uses the same deciding evaluator, request shape and attribution rule the controller's control census uses: an
 * accept control evaluates under its bound task's hidden rows and must leave no blocking issue; a
 * reject control evaluates under its task rows with its declared overrides and its blocking checks must include
 * expectedCheckId; other checks may fail on it too. The census remains the deciding check (it also requires a
 * reject in every task family). Passing these local tests needs no submission.
 */
import { expect, test } from "bun:test";
import {
  evaluateCheckProgram,
  evaluationPublicTask,
  observedBlockingCheckIds,
  type CheckFn,
  type EvaluationRequest,
} from "@ana/correctness-model-bundle";
import type { VerifierRuntime } from "@ana/correctness-model-prims";
import { checks } from "./evaluator.ts";
import { solve } from "./reference/index.ts";

interface HiddenRow {
  checkId: string;
  expectation: unknown;
}
interface TaskRow {
  taskId: string;
  family: string;
  publicInput: unknown;
  hidden?: HiddenRow[];
}
interface AcceptControl {
  id: string;
  taskId: string;
  artifact: unknown;
}
interface RejectControl extends AcceptControl {
  mutationClass: string;
  expectedCheckId: string;
  hidden?: HiddenRow[];
}

/** The host's own execution receipt. A local probe never fills one in. */
type ProbeEvidence = Awaited<ReturnType<VerifierRuntime["tools"]["run"]>>["evidence"];
// `satisfies` keeps the literal keys, which is what you want while authoring and what stops a
// check id read from tasks.json indexing the object. One typed view over the same value.
const declared: Record<string, CheckFn> = checks;

// For external checks, supply a tools.run double here and test clean, rejecting and non-result
// outcomes. A double checks result handling; correctness_check runs the installed tool on the host.
const noRuntime: VerifierRuntime | undefined = undefined;

// A tools.run stub that accepts every request and returns a benign executed result. It runs no
// tool: its only purpose is to make evaluateCheckProgram apply the host's tool-request contract
// (declared-leaf inputs, check-tool binding, argument shape) to each external check locally. With
// runtime undefined those rules are never exercised, so a request the host will refuse only shows
// up as a correctness_check refusal. This lets that refusal surface here first.
const contractProbeRuntime: VerifierRuntime = {
  tools: {
    run: async () => ({
      executed: true,
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      nonResult: null,
      // SAFETY: nothing reads a probe's evidence. The host writes the real row, and spelling its
      // thirty fields here would bury the request contract this stub exists to exercise.
      evidence: { outcome: "executed" } as ProbeEvidence,
    }),
    abandon: () => {},
  },
};

async function readJson<T>(name: string): Promise<T> {
  // SAFETY: this local test trusts the candidate files to have the declared shape. The controller
  // independently validates them before measurement; this assertion does not perform that check.
  return (await Bun.file(new URL(name, import.meta.url)).json()) as T;
}

const tasks = await readJson<TaskRow[]>("./tasks.json");
const brief = await readJson<Parameters<typeof evaluateCheckProgram>[0]>("./brief.json");
const controls = await readJson<{ accept: AcceptControl[]; reject: RejectControl[] }>("./controls.json");
const taskById = new Map(tasks.map((task) => [task.taskId, task]));
const evaluate = (request: EvaluationRequest, runtime?: VerifierRuntime) =>
  evaluateCheckProgram(brief, (checkId, input, hostRuntime) => {
    const check = declared[checkId];
    if (check === undefined) throw new Error("missing declared check: " + checkId);
    return check(
      input,
      hostRuntime === undefined
        ? undefined
        : {
            tools: { run: (call) => hostRuntime.tools.run({ ...call, checkId }) },
          },
    );
  })(request, runtime);

function publicTaskOf(task: TaskRow): EvaluationRequest["publicTask"] {
  return structuredClone({ taskId: task.taskId, family: task.family, publicInput: task.publicInput });
}
function evaluationTaskOf(task: TaskRow): EvaluationRequest["publicTask"] {
  // Control applicability follows the bound task, including when a reject has its own hidden rows.
  return evaluationPublicTask(brief, task, publicTaskOf(task));
}
function boundTask(control: AcceptControl): TaskRow {
  const bound = taskById.get(control.taskId);
  if (bound === undefined) {
    throw new Error(`${control.id}: taskId ${control.taskId} is not in correctness-model/tasks.json`);
  }
  return bound;
}

/** Four examples at a time, as the control census runs them, with results in input order. Once
 *  `noRuntime` runs an installed compiler or solver, one example can take a minute, and one at a
 *  time a pass over every control costs the sum. */
async function fourAtATime<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  // One iterator shared by the four lanes, so each entry is taken by exactly one of them.
  const queue = items.entries();
  const lane = async (): Promise<void> => {
    for (const [index, item] of queue) results[index] = await run(item);
  };
  await Promise.all([lane(), lane(), lane(), lane()]);
  return results;
}

test.skipIf(
  Boolean(tasks.length === 0 ? "starter placeholder — author correctness-model/tasks.json first" : false),
)("solve returns an artifact evaluate accepts, for every task", async () => {
  const results = await fourAtATime(tasks, async (task) =>
    evaluate(
      {
        publicTask: evaluationTaskOf(task),
        artifact: await solve(publicTaskOf(task)),
        hidden: task.hidden ?? [],
      },
      noRuntime,
    ),
  );
  for (const [index, task] of tasks.entries()) {
    expect(
      results[index]?.ok,
      `${task.taskId}: solve's own artifact must pass evaluate; issues: ${JSON.stringify(results[index]?.issues)}`,
    ).toBe(true);
  }
});

test.skipIf(
  Boolean(
    controls.accept.length === 0
      ? "starter placeholder — author correctness-model/controls.json first"
      : false,
  ),
)("every accept control passes under its task's hidden rows", async () => {
  const results = await fourAtATime(controls.accept, (control) => {
    const bound = boundTask(control);
    return evaluate(
      { publicTask: evaluationTaskOf(bound), artifact: control.artifact, hidden: bound.hidden ?? [] },
      noRuntime,
    );
  });
  for (const [index, control] of controls.accept.entries()) {
    const result = results[index];
    expect(
      result?.ok,
      `${control.id}: an accept control must pass; issues: ${JSON.stringify(result?.issues)}`,
    ).toBe(true);
    expect(
      result === undefined ? undefined : observedBlockingCheckIds(result),
      `${control.id}: an accept control must leave no blocking issue`,
    ).toEqual([]);
  }
});

test.skipIf(
  Boolean(
    controls.reject.length === 0
      ? "starter placeholder — author correctness-model/controls.json first"
      : false,
  ),
)("every reject control fails on its expected blocking check", async () => {
  const results = await fourAtATime(controls.reject, (control) => {
    const bound = boundTask(control);
    return evaluate(
      {
        publicTask: evaluationTaskOf(bound),
        artifact: control.artifact,
        hidden: [
          ...new Map(
            [...(bound.hidden ?? []), ...(control.hidden ?? [])].map((row) => [row.checkId, row]),
          ).values(),
        ],
      },
      noRuntime,
    );
  });
  for (const [index, control] of controls.reject.entries()) {
    const result = results[index];
    expect(result?.ok, `${control.id}: a reject control must fail its evaluate`).toBe(false);
    expect(
      result === undefined ? [] : observedBlockingCheckIds(result),
      `${control.id}: expected blocking check ${control.expectedCheckId} among the blockers; got ${JSON.stringify(result?.issues)}`,
    ).toContain(control.expectedCheckId);
  }
});

test.skipIf(
  Boolean(
    controls.accept.length === 0
      ? "starter placeholder — author correctness-model/controls.json first"
      : false,
  ),
)("every accept control's tool requests satisfy the host tool-request contract", async () => {
  // Runs each accept control under a stub tools.run so the host contract (declared-leaf inputs,
  // check-tool binding, argument shape) is checked locally. It asserts no request is refused; it
  // does not decide pass/fail, so a stub result that a check reads and throws on is ignored. Only
  // a VerifierContractError — the exact refusal correctness_check would return — fails this test.
  for (const control of controls.accept) {
    const bound = boundTask(control);
    try {
      await evaluate(
        { publicTask: evaluationTaskOf(bound), artifact: control.artifact, hidden: bound.hidden ?? [] },
        contractProbeRuntime,
      );
    } catch (cause) {
      if (cause instanceof Error && cause.name === "VerifierContractError") {
        throw new Error(`${control.id}: the host would refuse this check's tool request: ${cause.message}`, {
          cause,
        });
      }
      // A non-contract throw is the stub's empty output reaching a real check; correctness_check
      // exercises that path with the installed tool.
    }
  }
});
