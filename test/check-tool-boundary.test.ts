import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { sha256, sha256OfFile } from "../src/meta/digest.ts";
import { canonicalJson } from "../src/meta/stable-json.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { loadCorrectnessModel } from "../src/truth/contracts.ts";
import { evaluateCheckProgram } from "../vendor/correctness-model-bundle/evaluate.ts";
import { checkPublicInputs } from "../vendor/correctness-model-bundle/evaluation-public-task.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";
import { externalChecksOf, type BriefTruthCheck } from "../src/truth/brief.ts";
import { runControls } from "../src/truth/run-controls.ts";
import { discriminationDisclosure } from "../src/truth/discrimination-author-detail.ts";
import {
  type SettledControl,
  TOOL_REFUSED_CODE,
  checkCostRows,
  unexecutedGroundingFindings,
} from "../src/truth/grounding-coverage.ts";

const ROOT = mkdtempSync(join(import.meta.dir, ".ana-scratch-check-tool-boundary-"));
const lifetime = createVerifierLifetime({ root: join(ROOT, "receipts") });
afterAll(async () => {
  expect(await lifetime.close()).toEqual([]);
  rmSync(ROOT, { recursive: true, force: true });
});
function check(id: string): BriefTruthCheck {
  return {
    id,
    assertion: "the selected value meets its public bound",
    execution: {
      families: "all",
      artifactPaths: [`$.${id}`],
      publicInputPaths: [`$.${id}`],
      hidden: "none",
      evidence: { kind: "external", requiredToolIds: ["cat", "cc"] },
    },
  };
}
function host() {
  return createVerifierHost({
    lifetime,
    inventory: Object.fromEntries(
      ["cat", "cc"].map((id) => {
        const path = id === "cat" ? "/bin/cat" : "/usr/bin/cc";
        return [
          id,
          { id, path, digest: sha256OfFile(path), source: "host", kind: "binary", interpreter: null },
        ];
      }),
    ),
  });
}

it.each(["stdin", "files"])(
  "passes projected JSON through the real check process and %s, keeping the accepted digest",
  async (mode) => {
    const dir = join(ROOT, mode);
    mkdirSync(join(dir, "correctness-model"), { recursive: true });
    writeFileSync(
      join(dir, "correctness-model/evaluator.ts"),
      `
    async function run(request, runtime) {
      const artifact = JSON.stringify(request.artifact), task = JSON.stringify(request.publicTask);
      const supplied = ${JSON.stringify(mode)} === "stdin"
        ? [{ stdin: artifact }, { stdin: task }]
        : [{ files: { "input.json": artifact }, args: ["input.json"] }, { files: { "input.json": task }, args: ["input.json"] }];
      const [a, t] = await Promise.all(supplied.map(input => runtime.tools.run({ toolId: "cat", ...input })));
      return a.executed && t.executed && a.stdout === artifact && t.stdout === task &&
        Object.values(request.artifact)[0] === Object.values(request.publicTask.publicInput)[0];
    }
    export const checks = { x: run, y: run };
  `,
    );
    const checks = [check("x"), check("y")];
    // The same real process/host path supports authored tool-assisted algorithms. Its receipts
    // and positive/hostile result are execution evidence, not independent algorithm provenance.
    checks[0]!.execution = {
      ...checks[0]!.execution,
      evidence: { kind: "authored" },
      requiredToolIds: ["cat"],
    };
    const evaluate = evaluateCheckProgram(
      { ...MATCHING_BRIEF, truthChecks: checks },
      await loadCorrectnessModel(dir, lifetime),
    );
    for (const x of [1, 9]) {
      const request = {
        artifact: { x, y: 2 },
        publicTask: { taskId: "t", family: "f", publicInput: { x: 1, y: 2 } },
        hidden: [],
      };
      const verifier = host();
      const scope = verifier.openSubject({
        checks,
        runId: "boundary",
        phase: "battery",
        subjectId: "t",
        attempt: 1,
        ...request,
      });
      try {
        expect((await evaluate(request, { tools: scope.port })).ok).toBe(x === 1);
        const own = checkPublicInputs(checks[0]!, request);
        expect(verifier.evidence()[0]).toMatchObject({
          artifactDigest: sha256(JSON.stringify(request.artifact)),
          artifactInputDigest: sha256(canonicalJson(own.artifact)),
          publicTaskInputDigest: sha256(canonicalJson(own.publicTask)),
        });
        for (const forbidden of [
          JSON.stringify({ x }),
          JSON.stringify(request.artifact),
          "generated input",
        ]) {
          await expect(scope.port.run({ toolId: "cat", checkId: "y", stdin: forbidden })).rejects.toThrow(
            "not a string leaf",
          );
          await expect(
            scope.port.run({ toolId: "cat", checkId: "y", files: { "input.json": forbidden } }),
          ).rejects.toThrow("not a string leaf");
        }
      } finally {
        expect((await scope.close()).cleanup?.state).toBe("complete");
      }
    }
  },
);

it.each([
  ["a", "b"],
  ["b", "a"],
] as const)(
  "keeps compile/run state within check %s before %s under the real wall",
  async (first, second) => {
    const artifact = {
      a: '#include <stdio.h>\nint main(){puts("A");return 0;}\n',
      b: '#include <stdio.h>\nint main(){puts("B");return 0;}\n',
    };
    const verifier = host();
    const scope = verifier.openSubject({
      checks: [check("a"), check("b")],
      runId: "boundary",
      phase: "battery",
      subjectId: "t",
      attempt: 1,
      artifact,
      publicTask: { taskId: "t", family: "f", publicInput: { a: 1, b: 2 } },
    });
    try {
      for (const id of [first, second]) {
        expect((await scope.port.run({ toolId: "cat", checkId: id, args: ["source.c"] })).exitCode).not.toBe(
          0,
        );
        expect((await scope.port.run({ toolId: "cell:program", checkId: id })).executed).toBe(false);
        const source = artifact[id];
        expect(
          (
            await scope.port.run({
              toolId: "cc",
              checkId: id,
              files: { "source.c": source },
              args: ["source.c", "-o", "program"],
            })
          ).exitCode,
        ).toBe(0);
        expect((await scope.port.run({ toolId: "cell:program", checkId: id })).stdout).toBe(
          `${id.toUpperCase()}\n`,
        );
      }
    } finally {
      expect((await scope.close()).cleanup?.state).toBe("complete");
    }
  },
);

it("observes the submitted entrypoint through the complete check process and control census", async () => {
  const dir = join(ROOT, "product");
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(
    join(dir, "correctness-model/evaluator.ts"),
    `
    export const checks = { behavior: async ({ artifact, publicTask }, runtime) => {
      const compiled = await runtime.tools.run({ toolId: "cc", files: artifact.files, args: ["main.c", "-o", "product"] });
      if (compiled.exitCode !== 0) return false;
      const observed = await runtime.tools.run({ toolId: "cell:product" });
      return observed.exitCode === 0 && observed.stdout.trim() === publicTask.publicInput.expected;
    } };
  `,
  );
  const behavior: BriefTruthCheck = {
    id: "behavior",
    assertion: "the submitted entrypoint produces the required value",
    execution: {
      families: "all",
      artifactPaths: ["$.files"],
      publicInputPaths: ["$.expected"],
      hidden: "none",
      evidence: { kind: "authored" },
      requiredToolIds: ["cc"],
    },
  };
  const brief = {
    ...MATCHING_BRIEF,
    joins: [],
    truthChecks: [behavior],
    // The public artifact-schema contract requires this field name.
    artifactSchema: [{ name: "files", "shape": "file map", fileMap: true as const }],
  };
  const task = { taskId: "t", family: "f", publicInput: { expected: "6" }, intendedFeatures: {}, hidden: [] };
  const artifact = (expression: string) => ({
    files: {
      "main.c": '#include <stdio.h>\nint main(){printf("%d\\n", ' + expression + ");return 0;}\n",
      // This valid support source also compiles in the hostile specimen. Compiling it alone
      // cannot attest the submitted entrypoint's behaviour.
      "support.c": "int required_value(){return 6;}\n",
    },
  });
  const corpus = {
    accept: ["2*3", "1+5"].map((value, index) => ({
      id: `a${index}`,
      taskId: "t",
      artifact: artifact(value),
    })),
    reject: [
      {
        id: "wrong-behavior",
        taskId: "t",
        artifact: artifact("5"),
        expectedCheckId: "behavior",
        mutationClass: "wrong-entrypoint-result",
      },
    ],
  };
  const verifier = host();
  const externalChecks = externalChecksOf(brief);
  const evaluate = evaluateCheckProgram(brief, await loadCorrectnessModel(dir, lifetime));
  const settled = new Map<string, SettledControl>();
  const result = await runControls(
    evaluate,
    corpus,
    [task],
    {
      brief,
      externalChecks,
      verifierLifetime: lifetime,
      onSettled: (controlId, observation) => settled.set(controlId, observation),
    },
    verifier,
  );
  expect(result.findings).toEqual([]);
  expect(result).toMatchObject({ claimable: true, acceptsPassed: 2, rejectsFailed: 1, rejectsAttributed: 1 });
  expect(
    unexecutedGroundingFindings({
      brief,
      externalChecks,
      tasks: [task],
      controls: [...corpus.accept, ...corpus.reject],
      settled,
      evidence: verifier.evidence(),
      path: "controls",
    }),
  ).toEqual([]);
  expect(
    verifier.evidence().filter((row) => row.toolId === "cell:product" && row.outcome === "executed"),
  ).toHaveLength(3);
  // An accept whose tool fails inside the cell names the tool and its exit, never its output.
  const broken = await runControls(
    evaluate,
    { accept: [{ id: "a-broken", taskId: "t", artifact: artifact("(") }], reject: [] },
    [task],
    { brief, externalChecks, verifierLifetime: lifetime },
    host(),
  );
  const detail = broken.findings
    .map(discriminationDisclosure)
    .map((d) => (d.class === "authored" ? d.detail : d.note))
    .find((text) => text?.includes("a-broken") === true);
  expect(detail).toContain('on [behavior], where tool runs ended [cc exit 1]: "a-broken"');
  expect(detail).not.toContain("error");
});

it("executes private authored probes and rejects a public-example lookup without narrowing valid implementations", async () => {
  const dir = join(ROOT, "private-probes");
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(
    join(dir, "correctness-model/evaluator.ts"),
    `
    export const checks = { behavior: async ({ artifact, hidden }, runtime) => {
      const probes = hidden[0].expectation.cases.map(x => "if(double_value(" + x + ")!=" + 2*x + ")return 1;").join("");
      const driver = "int double_value(int); int main(){" + probes + "return 0;}";
      const compiled = await runtime.tools.run({ toolId: "cc", files: { ...artifact.files, "driver.c": driver }, args: ["solution.c", "driver.c", "-o", "probe"] });
      return compiled.exitCode === 0 && (await runtime.tools.run({ toolId: "cell:probe" })).exitCode === 0;
    } };
  `,
  );
  const behavior: BriefTruthCheck = {
    id: "behavior",
    assertion: "double_value returns twice its integer input for every value from zero through max",
    execution: {
      families: "all",
      artifactPaths: ["$.files"],
      publicInputPaths: ["$.max"],
      hidden: "required",
      evidence: { kind: "authored" },
      requiredToolIds: ["cc"],
    },
  };
  const brief = { ...MATCHING_BRIEF, joins: [], truthChecks: [behavior] };
  const task = {
    taskId: "private-t",
    family: "f",
    publicInput: { max: 100 },
    intendedFeatures: {},
    hidden: [
      { checkId: "behavior", expectation: { cases: [7, 11] } },
      { checkId: "sibling", expectation: { secret: "sibling-secret" } },
    ],
  };
  const artifact = (expression: string) => ({
    files: { "solution.c": "int double_value(int x){return " + expression + ";}" },
  });
  const corpus = {
    accept: ["x+x", "2*x"].map((value, index) => ({
      id: `private-a${index}`,
      taskId: task.taskId,
      artifact: artifact(value),
    })),
    reject: [
      {
        id: "public-lookup",
        taskId: task.taskId,
        artifact: artifact("x==1?2:x==2?4:0"),
        expectedCheckId: "behavior",
        mutationClass: "public-examples-only",
      },
    ],
  };
  const verifier = host();
  const runner = await loadCorrectnessModel(dir, lifetime);
  const result = await runControls(
    evaluateCheckProgram(brief, runner),
    corpus,
    [task],
    { brief, verifierLifetime: lifetime },
    verifier,
  );
  expect(result.findings).toEqual([]);
  expect(result).toMatchObject({ claimable: true, acceptsPassed: 2, rejectsFailed: 1, rejectsAttributed: 1 });
  expect(verifier.evidence()[0]).toMatchObject({
    inputKind: "authored",
    hiddenInputDigest: sha256(canonicalJson(task.hidden.slice(0, 1))),
    inputPaths: expect.arrayContaining(["authored:derived"]),
  });

  const external: BriefTruthCheck = {
    ...behavior,
    execution: {
      families: "all",
      artifactPaths: ["$.files"],
      publicInputPaths: ["$.max"],
      hidden: "required",
      evidence: { kind: "external", requiredToolIds: ["cc"] },
    },
  };
  const request = {
    artifact: corpus.accept[0]!.artifact,
    publicTask: { taskId: task.taskId, family: task.family, publicInput: task.publicInput },
    hidden: task.hidden,
  };
  const scope = host().openSubject({
    checks: [external],
    runId: "boundary",
    phase: "battery",
    subjectId: task.taskId,
    attempt: 1,
    ...request,
  });
  try {
    await expect(
      evaluateCheckProgram({ ...brief, truthChecks: [external] }, runner)(request, { tools: scope.port }),
    ).rejects.toThrow('file "driver.c" is not a string leaf');
    // The host captured the external contract when the scope opened. Changing the caller's
    // declaration can relax its local guard, but cannot widen that captured cell.
    external.execution = { ...behavior.execution };
    await expect(
      evaluateCheckProgram({ ...brief, truthChecks: [external] }, runner)(request, { tools: scope.port }),
    ).rejects.toThrow('file "driver.c" is not a string leaf');
    await expect(
      scope.port.run({ toolId: "cc", checkId: "behavior", files: { "driver.c": "int main(){return 0;}" } }),
    ).rejects.toThrow('file "driver.c" is not a string leaf');
  } finally {
    await scope.close();
  }
});

// Gate audit 2026-09-25 (docs/gate-audit.md, census-grounding-owed): commented out (unsure): an example whose check made no completed tool run, with no host refusal, no longer refuses adoption at the census
// it("charges a tool the host could not run to the environment, and a run the check never made to the author", () => {
it("charges a tool the host could not run to the environment", () => {
  // Rule 15: a sandbox refusal after its retry is the environment's non-result. Read as a missing
  // call, the Builder was told to call a tool it had called.
  const brief = { ...MATCHING_BRIEF, joins: [], truthChecks: [check("bound")] };
  const externalChecks = [{ checkId: "bound", adapterId: "cc" }];
  const input = (outcome: string) => ({
    brief,
    externalChecks,
    tasks: [{ taskId: "t", family: "f" }],
    controls: [{ id: "a0", taskId: "t" }],
    path: "controls",
    settled: new Map([["a0", { attempt: 2, hostNonResult: outcome === "executed" ? null : outcome }]]),
    evidence: [{ subjectId: "a0", checkId: "bound", toolId: "cc", outcome, attempt: 2 }],
  });
  expect(unexecutedGroundingFindings(input("sandbox"))).toEqual([
    {
      code: TOOL_REFUSED_CODE,
      path: "controls",
      controlIds: ["a0"],
      detail: expect.stringContaining(
        'called tool "cc" for check "bound" and the host could not run it (sandbox)',
      ),
    },
  ]);
  // Gate audit 2026-09-25 (docs/gate-audit.md, census-grounding-owed): commented out (unsure): an example whose check made no completed tool run, with no host refusal, no longer refuses adoption at the census
  // // A timeout stays the author's, but the finding says the call was made rather than asking for one.
  // expect(unexecutedGroundingFindings(input("timeout"))).toEqual([
  //   {
  //     code: "generated-external-grounding-unexecuted",
  //     path: "controls",
  //     controlIds: ["a0"],
  //     detail: expect.stringContaining(
  //       'called tool "cc" for required check "bound" and the run did not complete (timeout)',
  //     ),
  //   },
  // ]);
  // expect(unexecutedGroundingFindings(input("timeout"))[0]!.detail).not.toContain("runtime.tools.run");
  // A tool the host never ran, or ran to completion, yields no row.
  expect(unexecutedGroundingFindings({ ...input("executed"), evidence: [] })).toEqual([]);
  expect(unexecutedGroundingFindings(input("executed"))).toEqual([]);
  // Gate audit 2026-09-25 (docs/gate-audit.md, census-grounding-owed): commented out (unsure): an example whose check made no completed tool run, with no host refusal, no longer refuses adoption at the census
  // // A check that ran the tool for one example and returned early on another is told exactly that.
  // const early = unexecutedGroundingFindings({
  //   ...input("executed"),
  //   tasks: [{ taskId: "t", family: "f" }],
  //   controls: [
  //     { id: "a0", taskId: "t" },
  //     { id: "r0", taskId: "t" },
  //   ],
  //   settled: new Map([
  //     ["a0", { attempt: 2, hostNonResult: null }],
  //     ["r0", { attempt: 2, hostNonResult: null }],
  //   ]),
  // });
  // expect(early).toEqual([
  //   {
  //     code: "generated-external-grounding-unexecuted",
  //     path: "controls",
  //     controlIds: ["r0"],
  //     detail: expect.stringContaining(
  //       '1 example(s) of required check "bound" returned with no run of tool "cc" launched (0 runs), although the check called it for other examples: "r0"',
  //     ),
  //   },
  // ]);
  // // A reject aimed at another check may be refused before the analysis runs; one aimed at this check may not.
  // const aimed = (expectedCheckId: string) =>
  //   unexecutedGroundingFindings({
  //     ...input("executed"),
  //     controls: [
  //       { id: "a0", taskId: "t" },
  //       { id: "r0", taskId: "t", expectedCheckId },
  //     ],
  //     settled: new Map([
  //       ["a0", { attempt: 2, hostNonResult: null }],
  //       ["r0", { attempt: 2, hostNonResult: null }],
  //     ]),
  //   });
  // expect(aimed("geometry")).toEqual([]);
  // expect(aimed("bound").map((finding) => finding.code)).toEqual(["generated-external-grounding-unexecuted"]);
  // // Once one reject aimed at this check completed a run, another may fail before the analysis
  // // (truss 805bcc: a design with no loss path). An accept without a run and a reject whose run
  // // did not complete still owe one.
  // const decided = (extra: { id: string; expectedCheckId?: string; outcome?: string }) =>
  //   unexecutedGroundingFindings({
  //     ...input("executed"),
  //     controls: [
  //       { id: "a0", taskId: "t" },
  //       { id: "r1", taskId: "t", expectedCheckId: "bound" },
  //       { id: "r0", taskId: "t", expectedCheckId: "bound" },
  //       { id: extra.id, taskId: "t", expectedCheckId: extra.expectedCheckId ?? null },
  //     ],
  //     settled: new Map(["a0", "r1", "r0", extra.id].map((id) => [id, { attempt: 2, hostNonResult: null }])),
  //     evidence: [
  //       { subjectId: "a0", checkId: "bound", toolId: "cc", outcome: "executed", attempt: 2 },
  //       { subjectId: "r1", checkId: "bound", toolId: "cc", outcome: "executed", attempt: 2 },
  //       ...(extra.outcome === undefined
  //         ? []
  //         : [{ subjectId: extra.id, checkId: "bound", toolId: "cc", outcome: extra.outcome, attempt: 2 }]),
  //     ],
  //   });
  // expect(decided({ id: "r2", expectedCheckId: "bound" })).toEqual([]);
  // expect(decided({ id: "a1" })).toEqual([
  //   expect.objectContaining({
  //     code: "generated-external-grounding-unexecuted",
  //     detail: expect.stringContaining(
  //       'returned with no run of tool "cc" launched (0 runs), although the check called it for other examples: "a1"',
  //     ),
  //   }),
  // ]);
  // expect(decided({ id: "r2", expectedCheckId: "bound", outcome: "timeout" })).toEqual([
  //   expect.objectContaining({
  //     code: "generated-external-grounding-unexecuted",
  //     detail: expect.stringContaining('the run did not complete (timeout): "r2"'),
  //   }),
  // ]);
});

// Nothing else observes what one check costs: the caller of a check program receives one aggregate
// verdict, and its author receives neither. Truss epoch 4764 declared seven checks that each re-ran
// a nonlinear solver over the same design and paid 441 s for a single gate call.
it("prices each dispatched check, including one that threw, and orders the rows dearest first", async () => {
  const dir = join(ROOT, "cost");
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(
    join(dir, "correctness-model/evaluator.ts"),
    `
    export const checks = {
      slow: async () => { await new Promise((resolve) => setTimeout(resolve, 250)); return true; },
      broken: () => { throw new Error("this check threw"); },
    };
  `,
  );
  const spend = new Map<string, { evaluations: number; totalMs: number }>();
  const run = await loadCorrectnessModel(dir, lifetime, undefined, (checkId, ms) => {
    const row = spend.get(checkId);
    spend.set(checkId, { evaluations: (row?.evaluations ?? 0) + 1, totalMs: (row?.totalMs ?? 0) + ms });
  });
  const request = { artifact: {}, publicTask: { taskId: "t", family: "f", publicInput: {} }, hidden: [] };
  expect(await run("slow", request)).toBe(true);
  // A dispatch that threw still spent its wall time; dropping it would price the cheap checks only.
  await expect(run("broken", request)).rejects.toThrow('check "broken" this check threw');
  expect(await run("slow", request)).toBe(true);
  const rows = checkCostRows(spend, [{ checkId: "slow" }, { checkId: "slow" }, { checkId: "broken" }]);
  expect(rows.map((row) => row.checkId)).toEqual(["slow", "broken"]);
  expect(rows[0]).toMatchObject({ evaluations: 2, toolLaunches: 2 });
  expect(rows[1]).toMatchObject({ evaluations: 1, toolLaunches: 1 });
  expect(rows[0]!.totalMs).toBeGreaterThanOrEqual(500);
});
