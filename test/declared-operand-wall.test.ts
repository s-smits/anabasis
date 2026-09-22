/** Host tool subjects receive the applicable public-input union. Each named check receives only
 * its own declared artifact and public inputs. These cases exercise both boundaries. */
import { describe, expect, it } from "bun:test";

import type { JsonValue } from "../src/meta/json-shape.ts";
import type { Brief, BriefTruthCheck } from "../src/truth/brief.ts";
import type { ControlCorpus } from "../src/truth/controls.ts";
import { runControls as runProductionControls } from "../src/truth/run-controls.ts";
import { evaluationPublicTask } from "../src/truth/task-split.ts";
import type { BuildTask } from "../src/truth/tasks.ts";
import { double } from "./helpers/doubles.ts";
import { evaluateCheckProgram } from "../vendor/correctness-model-bundle/evaluate.ts";
import type { CheckRunner } from "../src/truth/correctness-model-contract.ts";
import type { ToolRunRequest, VerifierRuntime } from "../src/verify/verifier-port.ts";
import { VerifierContractError } from "../vendor/correctness-model-bundle/contract-error.ts";

/** The hostile task: one declared operand and one undeclared field beside it. */
const PUBLIC_INPUT = { laneCount: 4, usb3DataRequired: true };

const CORPUS: ControlCorpus = {
  accept: [{ id: "a-1", taskId: "t-lanes", artifact: { lanes: 4, usb3Enabled: true } }],
  reject: [
    {
      id: "r-1",
      taskId: "t-lanes",
      artifact: { usb3Enabled: false },
      mutationClass: "wrong-value",
      expectedCheckId: "lane-count",
    },
  ],
};

// Boundary discrimination: a task exactly on the cited constant plus an isolating reject
// separates > from >= — the W20 lesson that samples either side cannot.
const CHECK_ID = "charge-fault";

function runControls(
  runner: CheckRunner,
  corpus: ControlCorpus,
  tasks: readonly BuildTask[],
  options: Parameters<typeof runProductionControls>[3],
) {
  return runProductionControls(evaluateCheckProgram(options.brief, runner), corpus, tasks, options);
}

/** JSON parsing treats `__proto__` as an own data property, unlike object literal syntax. */
function json(text: string): JsonValue {
  return /* SAFETY: this file's own literals, parsed to the JSON shape they are written in. */ JSON.parse(
    text,
  ) as JsonValue;
}

function check(overrides: Partial<BriefTruthCheck["execution"]> & { id?: string } = {}): BriefTruthCheck {
  const { id = "lane-count", ...execution } = overrides;
  return double<BriefTruthCheck>({
    id,
    assertion: "the artifact declares the task's lane count",
    execution: {
      families: "all",
      artifactPaths: ["$.lanes", "$.usb3Enabled"],
      publicInputPaths: ["$.laneCount"],
      hidden: "none",
      evidence: { kind: "authored" },
      ...execution,
    },
  });
}

function brief(...checks: BriefTruthCheck[]): Brief {
  return double<Brief>({ correctnessContract: "check-program/v1", slug: "lanes", truthChecks: checks });
}

/** A legacy brief without the required correctnessContract declaration. */
function adopted(...checks: BriefTruthCheck[]): Brief {
  return double<Brief>({ slug: "lanes", truthChecks: checks });
}

const TASK: BuildTask = double<BuildTask>({
  taskId: "t-lanes",
  family: "lane-binding",
  publicInput: PUBLIC_INPUT,
  hidden: [],
});

function projected(theBrief: Brief, publicInput: JsonValue, task: BuildTask = TASK): JsonValue {
  return evaluationPublicTask(theBrief, task, { taskId: "t", family: "f", publicInput }).publicInput;
}

describe("the declared-operand projection", () => {
  it.each<[string, string[], JsonValue, JsonValue]>([
    [
      "keeps a declared leaf and drops the sibling nobody declared",
      ["$.laneCount"],
      PUBLIC_INPUT,
      { laneCount: 4 },
    ],
    [
      "grants the whole subtree a declared parent names",
      ["$.system"],
      { system: { bus: "usb3", lanes: 4 }, unrelated: 1 },
      { system: { bus: "usb3", lanes: 4 } },
    ],
    ["grants everything under $", ["$"], PUBLIC_INPUT, PUBLIC_INPUT],
    [
      "selects nested keys without granting punctuation-bearing lookalikes",
      ["$.system.bus", "$.rails[0]"],
      { system: { bus: 4 }, "system.bus": "ungranted", rails: [5], "rails[0]": "ungranted" },
      { system: { bus: 4 }, rails: [5] },
    ],
    ["an array index cannot select an object key", ["$.rails[0]"], { rails: { "0": 5 } }, { rails: {} }],
    [
      // A declared element therefore reveals its array's length. That is part of the
      // grant, not an accident: checks of an index or the array length can still read those values.
      "keeps an array's length, with the undeclared positions as null",
      ["$.rails[1].v"],
      {
        rails: [
          { v: 3.3, note: "a" },
          { v: 5, note: "b" },
          { v: 12, note: "c" },
        ],
      },
      { rails: [null, { v: 5 }, null] },
    ],
    [
      "unions an overlapping parent and child into the parent's whole subtree",
      ["$.system", "$.system.bus"],
      { system: { bus: "usb3", lanes: 4 }, unrelated: 1 },
      { system: { bus: "usb3", lanes: 4 } },
    ],
    [
      // A model-authored key must land as an OWN property of the projection rather than reaching a
      // prototype. Object.fromEntries defines rather than assigns, so this holds by construction.
      "carries a __proto__ key as an own property",
      ["$.__proto__.polluted"],
      json('{"__proto__": {"polluted": 1}, "other": 2}'),
      json('{"__proto__": {"polluted": 1}}'),
    ],
  ])("%s", (_name, paths, input, expected) => {
    const value = projected(brief(check({ publicInputPaths: paths })), input);
    expect(value).toEqual(expected);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it("unions the paths of every applicable check", () => {
    const walled = brief(check(), check({ id: "usb", publicInputPaths: ["$.usb3DataRequired"] }));
    expect(projected(walled, PUBLIC_INPUT)).toEqual(PUBLIC_INPUT);
  });

  it("grants nothing when no check applies to the task", () => {
    // Fail closed: a task no check evaluates needs no operand. The union is empty, so the correctnessModel
    // receives an empty publicInput rather than the whole task by default.
    const hiddenOnly = check({
      id: "hidden-limit",
      families: ["other-family"],
    });
    expect(projected(brief(hiddenOnly), PUBLIC_INPUT)).toEqual({});
  });

  it("refuses a legacy brief instead of silently granting the whole task", () => {
    expect(() => projected(adopted(check()), PUBLIC_INPUT)).toThrow("unsupported-correctness-contract");
  });

  it("leaves taskId and family readable — no declaration covers them", () => {
    const view = evaluationPublicTask(brief(check()), TASK, {
      taskId: "t-lanes",
      family: "lane-binding",
      publicInput: PUBLIC_INPUT,
    });
    expect<unknown>(view).toEqual({
      taskId: "t-lanes",
      family: "lane-binding",
      publicInput: { laneCount: 4 },
    });
  });
});

/** A correctnessModel that accepts only when the artifact agrees with a public field — the field is the
 *  parameter, so the same code plays a reader of a declared field or an undeclared field. */
function correctnessModelReading(field: "laneCount" | "usb3DataRequired", artifactKey: string) {
  return async (_checkId: string, request: { publicTask: unknown; artifact: unknown }) => {
    // SAFETY: the runner hands this correctnessModel the public task and artifact this file authored.
    const { publicInput } = request.publicTask as { publicInput: Record<string, JsonValue> };
    // SAFETY: as above — the fixture's own accept and reject artifacts.
    const artifact = request.artifact as Record<string, JsonValue>;
    return artifact[artifactKey] === publicInput[field];
  };
}

describe("verification through the wall", () => {
  it("gives each named check only its own public, artifact and hidden operands", async () => {
    const contract = brief(
      check({ artifactPaths: ["$.lanes"], hidden: "required" }),
      check({
        id: "usb",
        artifactPaths: ["$.usb3Enabled"],
        publicInputPaths: ["$.usb3DataRequired"],
        hidden: "required",
      }),
    );
    const seen: unknown[] = [];
    const evaluate = evaluateCheckProgram(contract, async (id, request) => {
      seen.push({ id, ...request });
      return true;
    });
    expect(
      (
        await evaluate({
          publicTask: TASK,
          artifact: CORPUS.accept[0]?.artifact,
          hidden: [
            { checkId: "lane-count", expectation: 4 },
            { checkId: "usb", expectation: true },
          ],
        })
      ).ok,
    ).toBe(true);
    expect(seen).toEqual([
      {
        id: "lane-count",
        publicTask: { taskId: TASK.taskId, family: TASK.family, publicInput: { laneCount: 4 } },
        artifact: { lanes: 4 },
        hidden: [{ checkId: "lane-count", expectation: 4 }],
      },
      {
        id: "usb",
        publicTask: { taskId: TASK.taskId, family: TASK.family, publicInput: { usb3DataRequired: true } },
        artifact: { usb3Enabled: true },
        hidden: [{ checkId: "usb", expectation: true }],
      },
    ]);
  });

  it("lets an external check hand the host its own hidden operand, and nothing another check owns", async () => {
    const requiredToolIds: [string] = ["cat"];
    const external = {
      hidden: "required" as const,
      evidence: { kind: "external" as const, requiredToolIds },
    };
    const contract = brief(
      check({ ...external, artifactPaths: ["$.lanes"] }),
      check({ ...external, id: "usb", artifactPaths: ["$.usb3Enabled"] }),
    );
    const reached: unknown[] = [];
    const runtime: VerifierRuntime = double<VerifierRuntime>({
      tools: {
        run: async (call: ToolRunRequest) => {
          reached.push({ checkId: call.checkId, stdin: call.stdin, files: call.files });
          return { exitCode: 0 };
        },
        abandon: async () => {},
      },
    });
    const hidden = [
      { checkId: "lane-count", expectation: "lane-secret" },
      { checkId: "usb", expectation: "usb-secret" },
    ];
    const evaluateWith = (operand: string) =>
      evaluateCheckProgram(contract, async (id, _request, port) => {
        if (id !== "lane-count") return true;
        await port?.tools.run({
          toolId: "cat",
          checkId: id,
          stdin: operand,
          files: { "operand.txt": operand },
        });
        return true;
      })({ publicTask: TASK, artifact: CORPUS.accept[0]?.artifact, hidden }, runtime);
    expect((await evaluateWith("lane-secret")).ok).toBe(true);
    expect(reached).toEqual([
      { checkId: "lane-count", stdin: "lane-secret", files: { "operand.txt": "lane-secret" } },
    ]);
    for (const foreign of ["usb-secret", "fabricated-operand"]) {
      await expect(evaluateWith(foreign)).rejects.toBeInstanceOf(VerifierContractError);
    }
    expect(reached).toHaveLength(1);
  });

  it("checks the recorded accept and reject without inventing out-of-domain task operands", async () => {
    const seen: unknown[] = [];
    const evaluate = correctnessModelReading("laneCount", "lanes");
    const exec = await runControls(
      async (checkId, request) => {
        seen.push(request.publicTask.publicInput);
        return evaluate(checkId, request);
      },
      CORPUS,
      [TASK],
      { brief: brief(check()) },
    );
    expect(exec.acceptsPassed).toBe(1);
    expect(exec.rejectsFailed).toBe(1);
    expect(exec.rejectsAttributed).toBe(1);
    expect(seen).toEqual([{ laneCount: 4 }, { laneCount: 4 }]);
  });

  it("still evaluates on the operand the check declared", async () => {
    const exec = await runControls(correctnessModelReading("laneCount", "lanes"), CORPUS, [TASK], {
      brief: brief(check()),
    });
    expect(exec.acceptsPassed).toBe(1);
    expect(exec.rejectsFailed).toBe(1);
  });

  // The hostile case: the correctnessModel conditions on usb3DataRequired while its check declares only
  // $.laneCount. Before the wall the field was there and the accept passed. Under the wall the
  // correctnessModel reads undefined, its own accept control stops passing, and the candidate is refused
  // before any battery is paid for. Declaring the path publishes the relation and restores it.
  it("hides the operand no check declared, so a correctnessModel reading it fails its own accept", async () => {
    const exec = await runControls(
      correctnessModelReading("usb3DataRequired", "usb3Enabled"),
      CORPUS,
      [TASK],
      {
        brief: brief(check()),
      },
    );
    expect(exec.acceptsPassed).toBe(0);

    const declared = await runControls(
      correctnessModelReading("usb3DataRequired", "usb3Enabled"),
      CORPUS,
      [TASK],
      {
        brief: brief(check({ publicInputPaths: ["$.laneCount", "$.usb3DataRequired"] })),
      },
    );
    expect(declared.acceptsPassed).toBe(1);
  });

  it("refuses legacy verification before a generated program can read the whole task", async () => {
    await expect(
      runControls(correctnessModelReading("usb3DataRequired", "usb3Enabled"), CORPUS, [TASK], {
        brief: adopted(check()),
      }),
    ).rejects.toThrow("unsupported-correctness-contract");
  });
});

/** The published rule: a fault is raised when the cell reaches the threshold, 60 included. */
const BRIEF: Brief = double<Brief>({
  correctnessContract: "check-program/v1",
  slug: "thermal",
  designRuleConstants: [{ name: "fault-threshold-c", value: 60 }],
  truthChecks: [
    double<BriefTruthCheck>({
      id: CHECK_ID,
      assertion: "the artifact raises a charge fault exactly when the cell reaches 60 C",
      execution: {
        families: "all",
        artifactPaths: ["$.fault"],
        publicInputPaths: ["$.temperature"],
        hidden: "none",
        evidence: { kind: "authored" },
      },
      numericBoundaries: [{ publicInputPath: "$.temperature", constantName: "fault-threshold-c" }],
    }),
  ],
});

const task = (temperature: number): BuildTask =>
  double<BuildTask>({
    taskId: `t-${temperature}`,
    family: "thermal-fault",
    publicInput: { temperature },
    hidden: [],
  });

const TASKS = [task(59), task(60), task(61)];

/** A correctnessModel parameterised by its comparator: the published rule, and the W20 mutation of it. */
function correctnessModel(raisesFault: (temperature: number) => boolean) {
  return async (_checkId: string, request: { publicTask: unknown; artifact: unknown }) => {
    // SAFETY: the runner hands this correctnessModel the public task and artifact this file authored.
    const { temperature } = (request.publicTask as { publicInput: { temperature: number } }).publicInput;
    // SAFETY: as above — the fixture's own accept and reject artifacts.
    return (request.artifact as { fault: boolean }).fault === raisesFault(temperature);
  };
}

const inclusive = correctnessModel((temperature) => temperature >= 60);
const strict = correctnessModel((temperature) => temperature > 60);

const accept = (temperature: number, fault: boolean) => ({
  id: `a-${temperature}`,
  taskId: `t-${temperature}`,
  artifact: { fault },
});

const reject = (temperature: number, fault: boolean, mutationClass: string) => ({
  id: `r-${temperature}`,
  taskId: `t-${temperature}`,
  artifact: { fault },
  mutationClass,
  expectedCheckId: CHECK_ID,
});

/** What W20 shipped: samples strictly either side of the value the rule turns on. */
const EITHER_SIDE: ControlCorpus = {
  accept: [accept(59, false), accept(61, true)],
  reject: [
    reject(59, true, "fault-raised-below-threshold"),
    reject(61, false, "fault-missed-above-threshold"),
  ],
};

/** The same corpus with the boundary itself, and the reject that separates `>=` from `>` there. */
const WITH_BOUNDARY: ControlCorpus = {
  accept: [...EITHER_SIDE.accept, accept(60, true)],
  reject: [...EITHER_SIDE.reject, reject(60, false, "strict-vs-inclusive-boundary")],
};

const run = (evaluate: ReturnType<typeof correctnessModel>, corpus: ControlCorpus) =>
  runControls(evaluate, corpus, TASKS, { brief: BRIEF });

describe("a numeric rule's boundary", () => {
  it("passes its own controls under the comparator the rule publishes", async () => {
    const exec = await run(inclusive, WITH_BOUNDARY);
    expect(exec.acceptsPassed).toBe(3);
    expect(exec.rejectsFailed).toBe(3);
    expect(exec.rejectsAttributed).toBe(3);
    expect(exec.attributedCheckIds[CHECK_ID]).toBe(3);
  });

  it("hides a wrong comparator when every sample stops either side of it", async () => {
    // The W20 result: the mutation is invisible, so the corpus scores it exactly as it scores the
    // published rule. This exposes a gap in the controls: they omit the one value that distinguishes
    // the two comparators.
    const mutated = await run(strict, EITHER_SIDE);
    const published = await run(inclusive, EITHER_SIDE);
    expect(mutated.acceptsPassed).toBe(published.acceptsPassed);
    expect(mutated.rejectsFailed).toBe(published.rejectsFailed);
    expect(mutated).toEqual(published);
  });

  it("catches that comparator once one task sits on the boundary", async () => {
    // Both directions fire at 60: the accept the rule calls valid is rejected, and the reject the
    // rule calls wrong passes. The candidate is refused before a battery is paid for.
    const exec = await run(strict, WITH_BOUNDARY);
    expect(exec.acceptsPassed).toBe(2);
    expect(exec.rejectsFailed).toBe(2);
    expect(exec.attributedCheckIds[CHECK_ID]).toBe(2);
  });
});
