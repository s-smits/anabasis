import type { ToolRunResult } from "../src/verify/verifier-port.ts";
import { expect, test } from "bun:test";
import type { Brief, BriefTruthCheck } from "../src/truth/brief.ts";
import { validateBrief } from "../src/truth/brief-validator.ts";
import type { EvaluationRequest, CheckRunner } from "../src/truth/correctness-model-contract.ts";
import { evaluateCheckProgram, checkEvaluationRequest } from "../vendor/correctness-model-bundle/evaluate.ts";
import { checkProgramFailureDetails, resolvePredicatePath } from "../src/truth/predicate.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";
import { double } from "./helpers/doubles.ts";
import { numbersWithin, multisetMatches } from "../vendor/correctness-model-prims/index.ts";

const request: EvaluationRequest = {
  publicTask: { taskId: "t", family: "f", publicInput: { target: 4, other: "private-to-another-check" } },
  artifact: { answer: 4, ungranted: "not an operand" },
  hidden: [],
};

function check(id: string, paths = ["$.answer"]): BriefTruthCheck {
  return {
    id,
    assertion: "the answer satisfies the declared condition",
    execution: {
      families: "all",
      artifactPaths: paths,
      publicInputPaths: ["$.target"],
      hidden: "none",
      evidence: { kind: "authored" },
    },
  };
}
function brief(checks: BriefTruthCheck[] = [check("answer")]): Brief {
  return {
    ...MATCHING_BRIEF,
    joins: [],
    artifactSchema: [{ name: "answer", "shape": "number" }],
    truthChecks: checks,
  };
}
test("one authored algorithm decides both valid and plausible wrong answers", async () => {
  const algorithm: CheckRunner = (_id, input) => {
    const artifact = double<{ answer: number }>(input.artifact);
    const task = double<{ target: number }>(input.publicTask.publicInput);
    return artifact.answer * artifact.answer === task.target * task.target;
  };
  const evaluate = evaluateCheckProgram(brief(), algorithm);
  expect((await evaluate(request)).ok).toBe(true);
  expect((await evaluate({ ...request, artifact: { answer: -4 } })).ok).toBe(true);
  const failed = await evaluate({ ...request, artifact: { answer: 3 } });
  expect(failed).toMatchObject({
    ok: false,
    issues: [{ checkId: "answer", message: "Declared check failed." }],
  });
  expect(failed.checkReceipts).toEqual([
    expect.objectContaining({ checkId: "answer", passed: false, artifactInputDigest: expect.any(String) }),
  ]);
});

test("every applicable program runs after a failed check and the host records its id", async () => {
  const calls: string[] = [];
  const result = await evaluateCheckProgram(brief([check("a"), check("b")]), (id) => {
    calls.push(id);
    return false;
  })(request);
  expect(calls).toEqual(["a", "b"]);
  expect(result.issues.map((issue) => issue.checkId)).toEqual(["a", "b"]);
  expect(result.checkReceipts?.map((row) => row.checkId)).toEqual(["a", "b"]);
});

test("a check cannot read another check's artifact, public input or hidden operand", async () => {
  const a = check("a");
  a.execution.hidden = "required";
  const b = check("b", ["$.ungranted"]);
  b.execution.publicInputPaths = ["$.other"];
  b.execution.hidden = "required";
  const inputs: EvaluationRequest[] = [];
  await evaluateCheckProgram(brief([a, b]), (_id, input) => {
    inputs.push(input);
    return true;
  })({
    ...request,
    hidden: [
      { checkId: "a", expectation: 1 },
      { checkId: "b", expectation: 2 },
    ],
  });
  expect(inputs[0]).toEqual({
    publicTask: { taskId: "t", family: "f", publicInput: { target: 4 } },
    artifact: { answer: 4 },
    hidden: [{ checkId: "a", expectation: 1 }],
  });
  expect(inputs[1]).toEqual({
    publicTask: { taskId: "t", family: "f", publicInput: { other: "private-to-another-check" } },
    artifact: { ungranted: "not an operand" },
    hidden: [{ checkId: "b", expectation: 2 }],
  });
});

test("input clones prevent one callback from changing a later check or its digest", async () => {
  const original = structuredClone(request);
  const inputs: EvaluationRequest[] = [];
  const result = await evaluateCheckProgram(brief([check("a"), check("b")]), (id, input) => {
    if (id === "a") double<{ answer: number }>(input.artifact).answer = 999;
    else inputs.push(input);
    return true;
  })(original);
  expect(original).toEqual(request);
  expect(inputs[0]?.artifact).toEqual({ answer: 4 });
  expect(result.checkReceipts?.[0]?.artifactInputDigest).toBe(result.checkReceipts?.[1]?.artifactInputDigest);
});

test("family scope is explicit and absence of required hidden data cannot skip a check", async () => {
  const hidden = check("hidden");
  hidden.execution.hidden = "required";
  const elsewhere = check("elsewhere");
  elsewhere.execution.families = ["other"];
  const calls: string[] = [];
  const evaluate = evaluateCheckProgram(brief([hidden, elsewhere]), (id) => {
    calls.push(id);
    return true;
  });
  await expect(evaluate(request)).rejects.toThrow("check-hidden-operand-missing");
  expect(calls).toEqual([]);
  expect((await evaluate({ ...request, hidden: [{ checkId: "hidden", expectation: null }] })).ok).toBe(true);
  expect(calls).toEqual(["hidden"]);
  expect(() =>
    checkEvaluationRequest(hidden, {
      ...request,
      hidden: [
        { checkId: "hidden", expectation: 1 },
        { checkId: "hidden", expectation: 1 },
      ],
    }),
  ).toThrow();
});

test("non-Boolean authored output cannot manufacture an aggregate verdict", async () => {
  await expect(
    evaluateCheckProgram(
      brief(),
      double<CheckRunner>(() => ({ ok: true, issues: [] })),
    )(request),
  ).rejects.toThrow("check-result-not-boolean");
});

test("a tool request must belong to the selected check and declared tool", async () => {
  const external = check("compile");
  external.execution.evidence = { kind: "external", requiredToolIds: ["cc"] };
  let calls = 0;
  const runtime = {
    tools: {
      run: async () => {
        calls++;
        return double<ToolRunResult>({ exitCode: 0 });
      },
      abandon: () => {},
    },
  };
  for (const call of [
    { checkId: "other", toolId: "cc" },
    { checkId: "compile", toolId: "python" },
  ]) {
    await expect(
      evaluateCheckProgram(brief([external]), async (_id, _input, port) => {
        await port!.tools.run({ ...call, args: [] });
        return true;
      })(request, runtime),
    ).rejects.toThrow("check-tool-binding-invalid");
  }
  expect(calls).toBe(0);
  await evaluateCheckProgram(brief([external]), async (_id, _input, port) => {
    await port!.tools.run({ checkId: "compile", toolId: "cc", args: [] });
    return true;
  })(request, runtime);
  expect(calls).toBe(1);
  await evaluateCheckProgram(brief([external]), async (_id, _input, port) => {
    await port!.tools.run({ checkId: "compile", toolId: "cell:program", args: [] });
    return true;
  })(request, runtime);
  expect(calls).toBe(2);
  await expect(
    evaluateCheckProgram(brief([external]), async (_id, _input, port) => {
      await port!.tools.run({ checkId: "other", toolId: "cell:program", args: [] });
      return true;
    })(request, runtime),
  ).rejects.toThrow("check-tool-binding-invalid");
});

test("local runtime doubles obey the host's declared operand boundary before any tool call", async () => {
  const external = check("compile");
  external.execution.evidence = { kind: "external", requiredToolIds: ["cc"] };
  external.execution.hidden = "required";
  const input = {
    ...request,
    artifact: { answer: "public source", ungranted: "sibling operand" },
    hidden: [
      { checkId: "compile", expectation: "hidden operand" },
      { checkId: "other", expectation: "foreign operand" },
    ],
  };
  let calls = 0;
  const runtime = {
    tools: {
      run: async () => {
        calls++;
        return double<ToolRunResult>({ exitCode: 0 });
      },
      abandon: () => {},
    },
  };
  const invoke = (operand: string, files: boolean) =>
    evaluateCheckProgram(brief([external]), async (checkId, _input, port) => {
      await port!.tools.run({
        checkId,
        toolId: "cc",
        ...(files ? { files: { "input": operand } } : { stdin: operand }),
      });
      return true;
    })(input, runtime);
  const projected = checkEvaluationRequest(external, input);
  for (const files of [false, true]) {
    // The host grants a check its own hidden operand, so the double does too.
    for (const operand of [
      "public source",
      "hidden operand",
      JSON.stringify(projected.artifact),
      JSON.stringify(projected.publicTask),
    ]) {
      expect((await invoke(operand, files)).ok).toBe(true);
    }
    const before = calls;
    for (const operand of ["foreign operand", "sibling operand", "invented operand", JSON.stringify(input)]) {
      await expect(invoke(operand, files)).rejects.toThrow("not a string leaf");
    }
    expect(calls).toBe(before);
  }
});

test("new manifests refuse legacy algorithms and malformed execution declarations", () => {
  expect(validateBrief(MATCHING_BRIEF).ok).toBe(true);
  expect(validateBrief({ ...MATCHING_BRIEF, correctnessContract: undefined }).findings[0]?.code).toBe(
    "unsupported-correctness-contract",
  );
  for (const old of ["predicate", "grounding", "publicInputPaths"]) {
    const value = structuredClone(MATCHING_BRIEF);
    Object.assign(value.truthChecks[0]!, { [old]: {} });
    expect(validateBrief(value).findings.some((f) => f.code === "unsupported-correctness-contract")).toBe(
      true,
    );
  }
  for (const execution of [
    { families: [] },
    { artifactPaths: [] },
    { publicInputPaths: ["not-rooted"] },
    { evidence: { kind: "external", requiredToolIds: [] } },
    { hidden: "optional" },
    { surprise: true },
  ]) {
    const value = structuredClone(MATCHING_BRIEF);
    Object.assign(value.truthChecks[0]!.execution, execution);
    expect(validateBrief(value).ok).toBe(false);
  }
});

test("authored execution checks its declared tools and keeps the authored evidence type", async () => {
  const authored = check("answer");
  authored.execution.requiredToolIds = ["python3"];
  expect(validateBrief(brief([authored])).ok).toBe(true);
  let calls = 0;
  const runtime = {
    tools: {
      run: async () => {
        calls++;
        return double<ToolRunResult>({ exitCode: 0 });
      },
      abandon: () => {},
    },
  };
  const evaluate = (toolId: string) =>
    evaluateCheckProgram(brief([authored]), async (checkId, _input, port) => {
      return (await port!.tools.run({ checkId, toolId, args: [] })).exitCode === 0;
    })(request, runtime);
  expect((await evaluate("python3")).ok).toBe(true);
  await expect(evaluate("undeclared")).rejects.toThrow("check-tool-binding-invalid");
  expect(calls).toBe(1);
  expect(authored.execution.evidence).toEqual({ kind: "authored" });
  for (const requiredToolIds of [[], ["python3", "python3"], [""]]) {
    expect(
      validateBrief({
        ...brief([authored]),
        truthChecks: [{ ...authored, execution: { ...authored.execution, requiredToolIds } }],
      }).ok,
    ).toBe(false);
  }
  authored.execution.evidence = { kind: "external", requiredToolIds: ["cc"] };
  expect(validateBrief(brief([authored])).ok).toBe(false);
});

test("failure commitments use completed check receipts without rerunning a program", async () => {
  let calls = 0;
  const value = brief();
  const result = await evaluateCheckProgram(value, () => {
    calls++;
    return false;
  })(request);
  const detail = checkProgramFailureDetails(
    value,
    request,
    { key: new Uint8Array(32), keyId: "run" },
    result.checkReceipts,
  );
  expect(calls).toBe(1);
  expect(detail[0]?.operands.map((row) => row.role)).toEqual(["artifact", "public-task", "hidden"]);
});

test("mathematical helpers remain directly callable", () => {
  expect(numbersWithin(2, 2.01, { absolute: 0.02 })).toBe(true);
  expect(numbersWithin(2, 3, { absolute: 0.02 })).toBe(false);
  expect(multisetMatches([1, 2], [2, 1], Object.is)).toBe(true);
  expect(multisetMatches([1, 1], [1, 2], Object.is)).toBe(false);
});

test("offers finite comparison helpers without changing the domain's units or tolerance", () => {
  expect(numbersWithin(16.857142857142858, 16.857143, { absolute: 0.01 })).toBe(true);
  expect(numbersWithin(1001, 1000, { relative: 0.002 })).toBe(true);
  expect(numbersWithin(1, 2)).toBe(false);
  for (const value of [NaN, Infinity, -Infinity]) {
    expect(numbersWithin(value, value)).toBe(false);
    expect(numbersWithin(1, 1, { absolute: value })).toBe(false);
  }
  expect(numbersWithin(1, 1, { relative: -1 })).toBe(false);
  expect(numbersWithin(Number.MAX_VALUE, -Number.MAX_VALUE, { relative: 1.5 })).toBe(false);
  expect(multisetMatches(["a", "a"], ["a", "b"], (a, b) => a === b)).toBe(false);
  expect(multisetMatches([], [], (a, b) => a === b)).toBe(true);
});

test("rooted path lookup refuses malformed text instead of reading a different value", () => {
  const input = { target: [4], "target[0]": 99 };
  expect(resolvePredicatePath(input, "$.target[0]")).toEqual({ found: true, value: 4 });
  for (const path of [
    "target",
    "garbage.target[0]",
    "$.target[0]trailing",
    "$.target[00]",
    "$.target[-1]",
    "",
  ]) {
    expect(resolvePredicatePath(input, path).found).toBe(false);
  }
});
