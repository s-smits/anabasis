/**
 * The reference solve: the snapshot its witnesses are derived from, and what the generated solve
 * may not do — read the caller's task bodies, share loader state with its child, run in the
 * repository cwd, or leave a descendant behind that writes after the census ends.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { isString } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { SOLVABILITY_POLICY, makeProbeSolvability } from "../src/truth/solvability.ts";
import { VerifierOperationalStop } from "../src/verify/verifier-lifetime.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import {
  BASE_TASKS,
  type Fixture,
  GOOD_VERIFIER,
  OPERAND,
  type SpecimenSpec,
  check,
  codes,
  createSolvabilityStarter,
  failure,
  gate,
  solving,
  specimen,
  statuses,
  testLifetime,
  witness,
} from "./helpers/solvability-specimen.ts";
import { familyFixture } from "./helpers/solvability-families.ts";
import { overrideHost } from "./helpers/host-override.ts";

/** A reference that selects a row from no public inventory, so its membership check fails. */
function subsetFailureFixture(): Fixture {
  const foreign = { targets: [{ pipeId: "P-404", zoneId: "Z1", inspectionUnits: 1 }] };
  const tasks = ["ta", "tb"].map((taskId, index) => {
    const pipe = { pipeId: `P-${String(index + 1)}`, zoneId: "Z1", inspectionUnits: 1 };
    const publicInput = { inventoryPipes: [pipe], zoneScope: [{ zoneId: "Z1" }] };
    return { taskId, family: `family-${String(index)}`, publicInput, hidden: [] };
  });
  const membership = { id: "inventory-membership", roots: ["$.targets"], open: true as const };
  return specimen({
    slug: "subset-selection",
    verifier: `export function solve() { return ${JSON.stringify(foreign)}; }
// CHECKS
export const checks = {
  "inventory-membership": ({ artifact, publicTask }) => artifact.targets.length > 0 && artifact.targets.every(row =>
    publicTask.publicInput.inventoryPipes.some(source => row.pipeId === source.pipeId && row.zoneId === source.zoneId && row.inspectionUnits === source.inspectionUnits)
    && publicTask.publicInput.zoneScope.some(zone => zone.zoneId === row.zoneId))
};`,
    schema: [{ name: "targets", "shape": "selected inventory rows" }],
    checks: [check({ ...membership, inputs: ["$.inventoryPipes", "$.zoneScope"] })],
    tasks,
    accepts: tasks.map((task) => ({ id: `accept-${task.taskId}`, taskId: task.taskId, artifact: foreign })),
    writerRoots: ["targets"],
  });
}

afterAll(cleanupScratch);

describe("solvability tied to the checked bundle snapshot", () => {
  it.concurrent("derives the full witness census from publicInput while ordinary verification still receives hidden", async () => {
    const fixture = specimen({ verifier: GOOD_VERIFIER });
    const result = await witness(fixture);

    expect(result.findings).toEqual([]);
    expect(result.evidence).toMatchObject({
      policy: SOLVABILITY_POLICY,
      correctnessModelHash: fixture.fingerprint.correctnessModelHash,
      taskSetHash: fixture.fingerprint.taskSetHash,
      cases: [
        {
          status: "passed",
          submissionPath: {
            schema: "solvability-submission-path/v1",
            stages: ["writer-tool-schema", "draft-store", "materialise", "submit", "accept"],
            writerCalls: [{ name: "write_answer", callId: "f2-writer-1" }],
            submission: { attempts: 1 },
          },
        },
        { status: "passed", submissionPath: { schema: "solvability-submission-path/v1" } },
      ],
    });
    expect(
      result.evidence?.cases.every(
        (row) =>
          row.artifactDigest === row.submissionPath?.materialization.artifactDigest &&
          row.artifactDigest === row.submissionPath.submission.artifactDigest,
      ),
    ).toBe(true);
  });

  it.concurrent("writes F2 evidence for every case that ran before a cleanup stop", async () => {
    // Three tasks share the four lanes, so all start before tb's cleanup stop: each case that ran
    // keeps its row in task order and the cleanup finding is admitted once.
    const fixture = familyFixture({ answers: ["A", "B"] });
    const lifetime = testLifetime();
    const host = createVerifierHost({ lifetime });
    const opened: string[] = [];
    const result = await witness(fixture, {
      verifierLifetime: lifetime,
      createVerifier: () =>
        overrideHost(
          {
            openSubject(subject) {
              opened.push(subject.subjectId);
              if (subject.subjectId === "self:tb") {
                const lease = lifetime.begin({ role: "evaluator" });
                lease.settle({
                  receiptId: lease.id,
                  exit: null,
                  groupReaped: false,
                  outputComplete: false,
                  timedOut: true,
                });
                lifetime.assertUsable();
              }
              return host.openSubject(subject);
            },
          },
          host,
        ),
    });

    expect(opened.toSorted()).toEqual(["self:ta", "self:tb", "self:tc"]);
    expect(result.evidence?.cases.map((row) => row.taskId)).toEqual(["ta", "tb", "tc"]);
    expect(result.evidence?.cases[1]).toMatchObject({
      status: "non-result",
      nonResultKind: "sandbox",
    });
    expect(result.findings.filter((finding) => finding.code === "verifier-cleanup-pending")).toHaveLength(1);
    await expect(gate(fixture, result, { verifierLifetime: lifetime })).rejects.toBeInstanceOf(
      VerifierOperationalStop,
    );
    const saved = readFileSync(join(fixture.dir, "solvability.json"), "utf8");
    expect(saved).toContain('"taskId": "ta"');
    expect(saved).toContain('"nonResultKind": "sandbox"');
  });

  it.concurrent("persists named program failures and operand commitments in the evaluate-side evidence", async () => {
    const result = await witness(subsetFailureFixture());

    expect(result.evidence?.schema).toBe("solvability/v10");
    expect(result.evidence?.operandCommitmentKeyId).toBe(OPERAND.keyId);
    expect(statuses(result)).toEqual(["failed", "failed"]);
    expect(result.evidence?.cases[0]?.predicateFailures).toMatchObject([
      {
        checkId: "inventory-membership",
        operands: [{ role: "artifact" }, { role: "public-task" }, { role: "hidden" }],
      },
    ]);
    expect(
      result.evidence?.cases[0]?.predicateFailures[0]?.operands.every((operand) =>
        /^[a-f0-9]{64}$/.test(operand.digest),
      ),
    ).toBe(true);
  });

  it.concurrent("F2 hidden commitments: a hard-coded answer failure records only run-keyed HMAC operands", async () => {
    const fixture = specimen({
      verifier: solving(
        'const answers = { ta: "A", tb: "STALE-B" }; return { answer: answers[task.taskId] };',
      ),
    });
    const result = await witness(fixture);

    expect(codes(result)).toContain("solvability-witness-failed");
    expect(statuses(result)).toEqual(["passed", "failed"]);
    const reversibleHiddenDigest = new Bun.CryptoHasher("sha256").update(JSON.stringify("B")).digest("hex");
    const evidenceBytes = JSON.stringify(result.evidence);
    expect(evidenceBytes).not.toContain(reversibleHiddenDigest);
    expect(evidenceBytes).not.toContain(
      Array.from(OPERAND.key, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
    expect(result.evidence?.cases[1]?.predicateFailures[0]?.operands).toContainEqual(
      expect.objectContaining({ role: "hidden", digest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
  });

  it.concurrent("classifies a hidden-bearing generated evaluate throw without making its payload author-safe", async () => {
    const fixture = specimen({
      verifier: `
export function solve(task) { return { answer: task.publicInput.expected }; }
// CHECKS
export const checks = { answer: (request) => { throw new Error(JSON.stringify(request.hidden)); } };
`,
    });
    const result = await witness(fixture);
    const finding = result.findings.find((candidate) => candidate.code === "solvability-witness-failed");

    expect(finding?.detail).toContain('"expectation":"A"');
    expect(finding?.disclosure).toEqual({ class: "withheld", classification: "generated-evaluate-throw" });
    expect(result.evidence?.cases[0]).toMatchObject({
      status: "failed",
      failure: "witness",
      error: expect.stringContaining('"expectation":"A"'),
    });
  });

  it.concurrent("withholds solvability proof when the snapshot changes during otherwise passing witnesses", async () => {
    const fixture = specimen({ verifier: GOOD_VERIFIER });
    const reached: string[] = [];
    const result = await witness(fixture, {
      createSolvabilityStarter: async (options) => {
        const starter = await createSolvabilityStarter(options);
        reached.push(options.task.taskId);
        if (options.task.taskId === "tb") {
          // Controller-side interference after the final writer loads. The evaluator's own
          // filesystem refusal is covered by evaluator-process; this is the later binding.
          const file = join(options.slugDir, "agent", "test-writer-schema.json");
          chmodSync(file, 0o644);
          writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
        }
        return starter;
      },
    });
    const finding = result.findings.find(
      (candidate) => candidate.code === "solvability-bundleSnapshot-drift",
    );

    expect(reached.toSorted()).toEqual(["ta", "tb"]);
    expect(result.evidence).toBeNull();
    expect(finding?.disclosure).toEqual({
      class: "withheld",
      classification: "generated-bundleSnapshot-drift",
    });
    // Drift under the census cannot be told apart from what the candidate's generated code did to
    // the snapshot, so it costs the Builder a strike rather than ending the session as the host's.
    const feedback = await gate(fixture, result);
    expect(feedback).toContainEqual(
      expect.objectContaining({ owner: "correctness-model/evaluator.ts", severity: "blocking" }),
    );
    expect(JSON.stringify(feedback)).toContain("solvability-bundleSnapshot-drift");
    expect(JSON.stringify(feedback)).not.toContain("test-writer-schema.json");
    expect(JSON.stringify(feedback)).not.toContain("tasks.json#");
    expect(readFileSync(join(fixture.dir, "solvability.json"), "utf8")).toContain(
      "solvability-bundleSnapshot-drift",
    );
  });

  it.concurrent("ignores same-id caller task bodies and derives every witness from the verified bundleSnapshot", async () => {
    const fixture = specimen({ verifier: GOOD_VERIFIER });
    const untrustedInput = {
      slugDir: fixture.dir,
      fingerprint: fixture.fingerprint,
      operandCommitment: OPERAND,
      tasks: BASE_TASKS.map((task) => ({
        ...task,
        publicInput: { expected: `ALTERED-${task.taskId}` },
        hidden: [{ checkId: "answer", expectation: `ALTERED-${task.taskId}` }],
      })),
      artifactSchema: [{ name: "falsified", "shape": "string" }],
    };
    const result = await makeProbeSolvability({ verifierLifetime: testLifetime(), createSolvabilityStarter })(
      untrustedInput,
    );

    expect(result.findings).toEqual([]);
    expect(result.evidence?.cases.map((row) => row.artifact)).toEqual([{ answer: "A" }, { answer: "B" }]);
  });
});

describe("what the reference solve may not do", () => {
  it.concurrent("does not share correctnessModel-load globalThis state with the reference-solve child", async () => {
    const globalKey = `__ana_hidden_${String(Date.now())}`;
    const fixture = specimen({
      verifier: `
try {
const { readFileSync } = globalThis["pro" + "cess"]["getBuiltin" + "Module"]("node:fs");
const tasks = JSON.parse(readFileSync(new URL("./tasks.json", import.meta.url), "utf8"));
globalThis[${JSON.stringify(globalKey)}] = tasks[0].hidden[0].expectation;
} catch {}
export function solve() { return { answer: globalThis[${JSON.stringify(globalKey)}] ?? "NO-SHARED-GLOBAL" }; }
// CHECKS
globalThis[${JSON.stringify(globalKey)}] = "A";
export const checks = { answer: (request) => request.artifact?.answer === request.hidden[0]?.expectation };
`,
    });
    const result = await witness(fixture);

    expect(result.evidence?.cases[0]).toMatchObject({
      artifact: { answer: "NO-SHARED-GLOBAL" },
      status: "failed",
    });
    Reflect.deleteProperty(globalThis, globalKey);
  });

  const OBJECT_ANSWER: SpecimenSpec["schema"] = [{ name: "answer", "shape": "object" }];
  const READS_ADJACENT_TASKS = `const { readFileSync } = globalThis["pro" + "cess"]["getBuiltin" + "Module"]("node:fs");
  const tasks = JSON.parse(readFileSync(new URL("./tasks.json", import.meta.url), "utf8"));
  return { answer: tasks[0].hidden[0].expectation };`;

  // One law with four instances: a reference solve that reaches outside the public task it was
  // handed fails every witness, and the failure is the product's own, not the host's.
  it.each([
    {
      forbids: "reads the adjacent correctness-model task data",
      body: READS_ADJACENT_TASKS,
      code: "solvability-reference-solve-isolation",
      failure: "isolation",
      error: /ENOENT|no such file/i,
      classification: null,
    },
    {
      forbids: "replaces a JSON intrinsic",
      body: 'JSON.stringify = () => "falsified"; return { answer: task.publicInput.expected };',
      code: "solvability-witness-failed",
      failure: "witness",
      error: null,
      classification: "generated-solve-throw",
    },
    {
      forbids: "writes to the hidden fields of the task it was handed",
      body: 'task.hidden[0].expectation = "FALSIFIED"; return { answer: "FALSIFIED" };',
      code: "solvability-witness-failed",
      failure: "witness",
      error: null,
      classification: null,
    },
    {
      forbids: "marks its own artifact as solver-provenanced",
      body: "return { answer: { value: task.publicInput.expected, __referenceSolver: true } };",
      code: "solvability-witness-failed",
      failure: "witness",
      error: /__referenceSolver/,
      classification: null,
      schema: OBJECT_ANSWER,
    },
  ])("fails every witness when the reference solve $forbids", async (row) => {
    const result = await witness(
      specimen({ verifier: solving(row.body), ...keyIfDefined("schema", row.schema) }),
    );

    expect(statuses(result)).toEqual(["failed", "failed"]);
    expect(codes(result)).toContain(row.code);
    expect(result.evidence?.cases).toMatchObject([{ failure: row.failure }, { failure: row.failure }]);
    if (row.error !== null) expect(failure(result)).toMatch(row.error);
    if (row.classification !== null) {
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          disclosure: expect.objectContaining({ classification: row.classification }),
        }),
      );
    }
  });

  it.concurrent("runs solve with a scratch cwd rather than the repository cwd", async () => {
    const result = await witness(specimen({ verifier: solving("return { answer: process.cwd() };") }));
    /* SAFETY: a case artifact is `unknown` on the evidence contract. This fixture's reference
       writes a single `answer` field, and the expectation below is what checks it. */
    const childCwd = (result.evidence?.cases[0]?.artifact as { answer?: unknown } | undefined)?.answer;

    expect(isString(childCwd)).toBe(true);
    expect(childCwd).not.toBe(runtimeProcess.cwd());
    expect(String(childCwd)).toContain("ana-reference-");
  });

  it.concurrent("refuses reference descendants before they can start a delayed write", async () => {
    // Both markers live in one registered scratch directory, so the cleanup that removes the
    // directory removes whatever a descendant managed to write into it.
    const marker = join(scratchDir("ana-reference-descendant-"), "landed.txt");
    const armedPrefix = `${marker}.armed`;
    const armedMarkers = BASE_TASKS.map((task) => `${armedPrefix}-${task.taskId}`);
    const descendantScript = `
const fs = require("node:fs");
const [armed, marker] = process.argv.slice(1);
setTimeout(() => fs.writeFileSync(marker, "landed"), 300);
fs.writeFileSync(armed, "armed");
`;
    const fixture = specimen({
      verifier: `
export async function solve(task) {
const childProcess = process.getBuiltinModule("node:child_process");
const fs = process.getBuiltinModule("node:fs");
const armed = ${JSON.stringify(armedPrefix)} + "-" + task.taskId;
const descendant = childProcess.spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}, armed, ${JSON.stringify(marker)}], { stdio: "ignore" });
descendant.unref();
const deadline = Date.now() + 2_000;
while (!fs.existsSync(armed) && Date.now() < deadline) {
  await Bun.sleep(10);
}
if (!fs.existsSync(armed)) throw new Error("descendant did not start before solve returned");
return { answer: task.publicInput.expected };
}
// CHECKS
export const checks = { answer: (request) => request.artifact?.answer === request.hidden[0]?.expectation };
`,
    });
    const result = await witness(fixture);

    expect(statuses(result)).toEqual(["failed", "failed"]);
    expect(armedMarkers.every((armed) => existsSync(armed))).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  const asyncSolve = (body: string) =>
    `\nexport async function solve() { ${body} }\n// CHECKS\nexport const checks = { answer: () => true };\n`;
  // After its ready handshake a child's crash or hang is the generated solve's own; a child that
  // never started because its executable is absent is the host's.
  it.each([
    {
      child: "crashes after ready",
      verifier: asyncSolve("process.exit(17);"),
      options: { referenceSolveTimeoutMs: 2_000 },
      expected: { status: "failed", failure: "witness" },
      finding: { code: "solvability-witness-failed", classification: "generated-solve-crash" },
    },
    {
      // A pending promise alone may leave no event-loop work and let the child exit, which would
      // exercise protocol handling rather than the timeout, so an interval keeps it alive. The
      // 750 ms wall sits well above the child's startup.
      child: "hangs after ready",
      verifier: asyncSolve("return await new Promise(() => { setInterval(() => {}, 60_000); });"),
      options: { referenceSolveTimeoutMs: 750 },
      expected: { status: "failed", failure: "witness" },
      finding: { code: "solvability-witness-failed", classification: "generated-solve-timeout" },
    },
    {
      child: "cannot spawn at all",
      verifier: GOOD_VERIFIER,
      options: { referenceSolveExecutable: join(scratchDir("ana-reference-absent-"), "missing-node-binary") },
      expected: { status: "non-result", nonResultKind: "reference-solve-host" },
      finding: {
        code: "solvability-reference-solve-host-non-result",
        classification: "reference-solve-host",
      },
    },
  ])("classifies a reference child that $child", async ({ verifier, options, expected, finding }) => {
    const result = await witness(specimen({ verifier }), options);

    expect(statuses(result)).toEqual([expected.status, expected.status]);
    const { status: _status, ...row } = expected;
    expect(result.evidence?.cases).toMatchObject([row, row]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: finding.code,
        disclosure: expect.objectContaining({ classification: finding.classification }),
      }),
    );
  });
});
