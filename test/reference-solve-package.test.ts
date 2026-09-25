import { afterAll, describe, expect, it, spyOn } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import * as processRuntime from "../src/meta/process.ts";
import { bundleEvaluator, bundleReferenceSolve } from "../src/truth/evaluator-process-bundle.ts";
import { makeProbeSolvability } from "../src/truth/solvability.ts";
import { referenceSolveStage } from "../src/truth/reference-solve.ts";
import { loadCorrectnessModel, probeGeneratedCorrectnessModelModule } from "../src/truth/contracts.ts";
import { type VerifierLifetime, createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { evaluateCheckProgram } from "../vendor/correctness-model-bundle/evaluate.ts";
import { type Brief, projectFindingForAuthor } from "../src/truth/brief.ts";
import { typecheckGeneratedModule } from "../src/truth/generated-module-typecheck.ts";

const ROOT = mkdtempSync(join(import.meta.dir, ".ana-scratch-reference-package-"));
const CANARY = "private-evaluator-canary-782204";
const BRIEF: Brief = {
  correctnessContract: "check-program/v1",
  slug: "reference-package",
  domain: "uppercase letters",
  decisions: ["uppercase the public input"],
  gates: ["correct uppercase answer"],
  truthChecks: [
    {
      id: "answer",
      assertion: "The answer is the uppercase public input.",
      execution: {
        families: "all",
        artifactPaths: ["$.answer"],
        publicInputPaths: ["$.input"],
        hidden: "none",
        evidence: { kind: "authored" },
      },
    },
  ],
  joins: [],
  artifactSchema: [{ name: "answer", "shape": "string" }],
  designRuleConstants: [],
};

const TASK = { taskId: "aa", family: "letters", publicInput: { input: "a" } };

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

async function solve(
  dir: string,
  verifierLifetime: VerifierLifetime | undefined,
  timeoutMs?: number,
  executable?: string,
) {
  const stage = await referenceSolveStage({
    slugDir: dir,
    task: TASK,
    timeoutMs,
    executable,
    verifierLifetime,
    producedUnder: "reference-package",
    memory: undefined,
  });
  return stage.outcome;
}

let sequence = 0;
function fixture(
  reference = 'import { answer } from "./nested/algorithm.ts"; export function solve(task) { return { answer: answer(task.publicInput.input) }; }',
) {
  const dir = join(ROOT, String(++sequence));
  mkdirSync(join(dir, "correctness-model/reference/nested"), { recursive: true });
  mkdirSync(join(dir, "agent"));
  writeFileSync(join(dir, "correctness-model/reference/index.ts"), reference);
  writeFileSync(
    join(dir, "correctness-model/reference/nested/algorithm.ts"),
    "export function answer(input: string) { return input.toUpperCase(); }",
  );
  writeFileSync(
    join(dir, "correctness-model/private.ts"),
    `export const canary = ${JSON.stringify(CANARY)};`,
  );
  writeFileSync(
    join(dir, "correctness-model/evaluator.ts"),
    `import { answer } from "./reference/nested/algorithm.ts";
import { canary } from "./private.ts";
export const checks = { answer: (request) => canary.length > 0 && request.artifact.answer === answer(request.publicTask.publicInput.input) };`,
  );
  const lifetime = createVerifierLifetime({ root: join(ROOT, `receipts-${sequence}`) });
  return { dir, lifetime };
}

function completeFixture() {
  const result = fixture();
  const { dir } = result;
  writeFileSync(join(dir, "correctness-model/brief.json"), JSON.stringify(BRIEF));
  writeFileSync(
    join(dir, "correctness-model/tasks.json"),
    JSON.stringify(
      [TASK, { taskId: "bb", family: "other-letters", publicInput: { input: "b" } }].map((task) => ({
        ...task,
        hidden: [],
      })),
    ),
  );
  writeFileSync(
    join(dir, "correctness-model/controls.json"),
    JSON.stringify({
      accept: [
        { id: "accept-aa", taskId: "aa", artifact: { answer: "A" } },
        { id: "accept-bb", taskId: "bb", artifact: { answer: "B" } },
      ],
      reject: [{ id: "reject-aa", taskId: "aa", artifact: { answer: "wrong" }, expectedCheckId: "answer" }],
    }),
  );
  writeFileSync(
    join(dir, "agent/tools-spec.json"),
    JSON.stringify({
      presets: [],
      declined: { files: "structured fixture" },
      tools: [{ name: "write_answer", kind: "artifact-writer", description: "Write the answer." }],
    }),
  );
  writeFileSync(
    join(dir, "agent/BUILT_AGENTS.md"),
    "Write the requested uppercase answer with write_answer, then submit.",
  );
  writeFileSync(
    join(dir, "agent/tools.ts"),
    `import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "typebox";
export function createDomainHarness() { return { tools: [defineDraftTool({ name: "write_answer", label: "Write answer", description: "Write the answer.", executionMode: "sequential", parameters: Type.Object({ answer: Type.String() }), run(params, draft) { draft.setArtifact(params); return { text: "written" }; } })] }; }`,
  );
  return result;
}

describe("public reference package", () => {
  it("throws a host spawn failure instead of recording a module-load finding", async () => {
    const { dir, lifetime } = completeFixture();
    const failing = spyOn(processRuntime, "capturedSpawn").mockImplementation(() => {
      throw new Error("spawn EAGAIN");
    });
    try {
      await expect(probeGeneratedCorrectnessModelModule(dir, undefined, lifetime)).rejects.toThrow(
        "generated evaluator sandbox: could not start: spawn EAGAIN",
      );
    } finally {
      failing.mockRestore();
    }
    writeFileSync(
      join(dir, "correctness-model/evaluator.ts"),
      'throw new Error("authored top-level throw");\nexport const checks = {};',
    );
    const thrown = await probeGeneratedCorrectnessModelModule(dir, undefined, lifetime);
    expect(thrown).toEqual([expect.objectContaining({ code: "generated-module-load" })]);
    // A top-level throw is load-time output of Builder-authored bytes, so it crosses in full.
    expect(thrown.map((finding) => projectFindingForAuthor(finding).detail)).toEqual([
      expect.stringContaining("authored top-level throw"),
    ]);
    expect(lifetime.pendingReceipts()).toEqual([]);
  });

  it("tells the author which import boundary a module crossed, beside the bundler diagnostic", async () => {
    const { dir, lifetime } = completeFixture();
    writeFileSync(
      join(dir, "correctness-model/reference/index.ts"),
      'import { canary } from "../private.ts"; export function solve() { return { answer: canary }; }',
    );
    const [escaped, ...rest] = await probeGeneratedCorrectnessModelModule(dir, undefined, lifetime);
    expect(rest).toEqual([]);
    expect(escaped?.code).toBe("generated-module-load");
    const detail = escaped === undefined ? "" : projectFindingForAuthor(escaped).detail;
    expect(detail).toContain("reference/ is loaded alone");
  });

  it("runs nested helpers through the confined reference process and the actual F2 submission path", async () => {
    const { dir, lifetime } = completeFixture();
    expect(await probeGeneratedCorrectnessModelModule(dir, undefined, lifetime)).toEqual([]);
    expect(await solve(dir, lifetime)).toEqual({
      kind: "artifact",
      artifact: { answer: "A" },
    });
    const evaluate = evaluateCheckProgram(BRIEF, await loadCorrectnessModel(dir, lifetime));
    expect((await evaluate({ publicTask: TASK, artifact: { answer: "A" }, hidden: [] })).ok).toBe(true);
    expect((await evaluate({ publicTask: TASK, artifact: { answer: "wrong" }, hidden: [] })).ok).toBe(false);
    const fingerprint = fingerprintSlug(dir);
    if (!fingerprint.ok) throw new Error(JSON.stringify(fingerprint.findings));
    const result = await makeProbeSolvability({ verifierLifetime: lifetime })({
      slugDir: dir,
      fingerprint,
      operandCommitment: { key: new Uint8Array(32).fill(2), keyId: "reference-test" },
    });
    expect(result.findings).toEqual([]);
    expect(result.evidence?.cases.map((row) => row.status)).toEqual(["passed", "passed"]);
    expect(result.evidence?.cases.every((row) => row.submissionPath !== null)).toBe(true);
    expect(lifetime.pendingReceipts()).toEqual([]);
  });

  it("bundles public and private dependencies separately and rebuilds a changed helper", async () => {
    const { dir, lifetime } = fixture();
    const reference = await bundleReferenceSolve(dir);
    const evaluator = await bundleEvaluator(dir);
    expect(readFileSync(reference.file, "utf8")).not.toContain(CANARY);
    expect(readFileSync(evaluator.file, "utf8")).toContain(CANARY);
    writeFileSync(
      join(dir, "correctness-model/reference/nested/algorithm.ts"),
      "export function answer(input: string) { return input.toLowerCase(); }",
    );
    expect((await bundleReferenceSolve(dir)).digest).not.toBe(reference.digest);
    expect(await solve(dir, lifetime)).toEqual({
      kind: "artifact",
      artifact: { answer: "a" },
    });
  });

  it.each([
    [
      "private parent",
      'import { canary } from "../private.ts"; export function solve() { return canary; }',
      "outside its bundle or public contract: ../private.ts",
    ],
    [
      "private data",
      'import tasks from "../tasks.json"; export function solve() { return tasks; }',
      "outside its bundle or public contract: ../tasks.json",
    ],
    [
      "dynamic import",
      'export async function solve() { return await import("../private.ts"); }',
      'forbidden module loader "import() at line 1"',
    ],
    [
      "absolute import",
      `import { canary } from ${JSON.stringify(join(ROOT, "private.ts"))}; export function solve() { return canary; }`,
      `outside its bundle or public contract: ${join(ROOT, "private.ts")}`,
    ],
  ])("refuses %s before a reference process can run", async (_name, source, refusal) => {
    const { dir } = fixture(source);
    writeFileSync(join(dir, "correctness-model/tasks.json"), JSON.stringify([{ private: CANARY }]));
    await expect(bundleReferenceSolve(dir)).rejects.toThrow(refusal);
  });

  it("refuses a private re-export chain and a symlink even when the evaluator also imports it", async () => {
    const { dir } = fixture(
      'import { canary } from "./nested/relay.ts"; export function solve() { return canary; }',
    );
    writeFileSync(
      join(dir, "correctness-model/reference/nested/relay.ts"),
      'export { canary } from "../../private.ts";',
    );
    await expect(bundleReferenceSolve(dir)).rejects.toThrow("outside its bundle");
    rmSync(join(dir, "correctness-model/reference/nested/relay.ts"));
    symlinkSync("../../private.ts", join(dir, "correctness-model/reference/nested/relay.ts"));
    await expect(bundleReferenceSolve(dir)).rejects.toThrow("unsupported entries");
  });

  it("denies a computed runtime read of private data through the real OS sandbox", async () => {
    const { dir, lifetime } = fixture();
    writeFileSync(
      join(dir, "correctness-model/reference/index.ts"),
      `export async function solve() {
      try { await globalThis["B" + "un"].file(${JSON.stringify(join(dir, "correctness-model/private.ts"))}).text(); return { denied: false }; }
      catch { return { denied: true }; }
    }`,
    );
    expect(await solve(dir, lifetime)).toEqual({
      kind: "artifact",
      artifact: { denied: true },
    });
  });

  it("refuses missing reference entries and missing protected lifetime owners without a fallback", async () => {
    const { dir } = fixture();
    await expect(solve(dir, undefined)).rejects.toThrow("protected verifier lifetime owner");
    rmSync(join(dir, "correctness-model/reference/index.ts"));
    expect(await probeGeneratedCorrectnessModelModule(dir)).toEqual([
      expect.objectContaining({
        code: "reference-solve-entry-missing",
        path: "correctness-model/reference/index.ts",
      }),
    ]);
  });

  it("reports API mistakes in a reachable helper rather than only the entry module", () => {
    const { dir } = completeFixture();
    writeFileSync(
      join(dir, "correctness-model/reference/nested/algorithm.ts"),
      "export function answer(input: string) { return input.nonexistentMember(); }",
    );
    expect(typecheckGeneratedModule(dir, "correctness-model")).toContainEqual(
      expect.objectContaining({ path: "correctness-model/reference/nested/algorithm.ts" }),
    );
  });

  it("distinguishes a missing host runtime from a generated solve timeout and closes both processes", async () => {
    const { dir, lifetime } = fixture("export function solve() { while (true) {} }");
    await expect(solve(dir, lifetime, 1_000, join(dir, "missing-runtime"))).rejects.toMatchObject({
      kind: "reference-solve-host",
      owner: "environment",
    });
    expect(await solve(dir, lifetime, 1_000)).toMatchObject({
      kind: "failure",
      failure: { kind: "generated-solve-timeout", owner: "product" },
    });
    expect(lifetime.pendingReceipts()).toEqual([]);
  });
});
