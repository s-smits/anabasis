import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import { join } from "../src/meta/path.ts";
import { bundleEvaluator } from "../src/truth/evaluator-process-bundle.ts";
import {
  EVALUATOR_WALL_MS,
  evaluateIsolated,
  probeEvaluatorProcess,
} from "../src/truth/evaluator-process.ts";
import { TOOL_TIMEOUT_CEILING_MS, createVerifierHost } from "../src/verify/host.ts";
import { loadCorrectnessModel } from "../src/truth/contracts.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { VerifierContractError } from "../vendor/correctness-model-bundle/contract-error.ts";

const ROOT = mkdtempSync(join(import.meta.dir, ".ana-scratch-evaluator-process-"));
const LIFETIME = createVerifierLifetime({ root: join(ROOT, "lifetime") });
const REQUEST = {
  artifact: { text: "real artifact" },
  publicTask: { taskId: "t", family: "f", publicInput: {} },
  hidden: [],
};
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const SOLVE = "export function solve() { return {}; }";
let seq = 0;
function fixture(body: string) {
  const dir = join(ROOT, String(++seq));
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(
    join(dir, "correctness-model/evaluator.ts"),
    `${SOLVE}\n${body}\nexport const checks = { text: evaluate };`,
  );
  return dir;
}
function hostScope() {
  const host = createVerifierHost({
    lifetime: LIFETIME,
    inventory: {
      cat: {
        id: "cat",
        path: "/bin/cat",
        digest: sha256OfFile("/bin/cat"),
        source: "host",
        kind: "binary",
        interpreter: null,
      },
      sleep: {
        id: "sleep",
        path: "/bin/sleep",
        digest: sha256OfFile("/bin/sleep"),
        source: "host",
        kind: "binary",
        interpreter: null,
      },
    },
  });
  const scope = host.openSubject({
    checks: null,
    runId: "test",
    phase: "battery",
    subjectId: "t",
    attempt: 1,
    artifact: REQUEST.artifact,
    publicTask: REQUEST.publicTask,
  });
  return { host, scope };
}

describe("generated evaluation in a confined child", () => {
  it("runs the live loader with fresh globals and refreshes edited dependency bytes", async () => {
    const dir = fixture(
      'import { expected } from "./value.ts"; let calls = 0; function evaluate() { return ++calls === expected; }',
    );
    const helper = join(dir, "correctness-model/value.ts");
    writeFileSync(helper, "export const expected = 1;");
    writeFileSync(join(dir, "correctness-model/evaluator.test.ts"), 'import { test } from "bun:test";');
    const evaluate = await loadCorrectnessModel(dir, LIFETIME);
    expect(await evaluate("text", REQUEST)).toBe(true);
    expect(await evaluate("text", REQUEST)).toBe(true);
    writeFileSync(helper, "export const expected = 2;");
    expect(await (await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST)).toBe(false);
    expect(await evaluate("text", REQUEST)).toBe(true);
  });

  it("preserves real host evidence and the canonical tool input", async () => {
    const dir = fixture(`async function evaluate(request, runtime) {
      const result = await runtime.tools.run({ toolId: "cat", stdin: request.artifact.text });
      return result.executed && result.stdout === request.artifact.text;
    }`);
    const { host, scope } = hostScope();
    try {
      expect(await (await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST, { tools: scope.port })).toBe(
        true,
      );
    } finally {
      expect((await scope.close()).pendingInvocations).toBe(0);
    }
    expect(host.evidence()).toHaveLength(1);
    expect(host.evidence()[0]).toMatchObject({ outcome: "executed", subjectId: "t" });
  });

  it("hands the tool port inside the request as well as the second argument", async () => {
    const dir = fixture(`async function evaluate({ artifact, runtime }) {
      const result = await runtime.tools.run({ toolId: "cat", stdin: artifact.text });
      return result.executed && result.stdout === artifact.text;
    }`);
    const { scope } = hostScope();
    try {
      expect(await (await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST, { tools: scope.port })).toBe(
        true,
      );
    } finally {
      expect((await scope.close()).pendingInvocations).toBe(0);
    }
  });

  it("names the check and an engine error class, but no class for an authored throw", async () => {
    const engine = fixture(`function evaluate(request, runtime) { return runtime.tools.run({}); }`);
    await expect((await loadCorrectnessModel(engine, LIFETIME))("text", REQUEST)).rejects.toThrow(
      /check "text" TypeError: /,
    );
    const authored = fixture(`function evaluate() { throw new Error("tool said: private stderr"); }`);
    await expect((await loadCorrectnessModel(authored, LIFETIME))("text", REQUEST)).rejects.toThrow(
      'generated evaluator generated: check "text" tool said: private stderr',
    );
  });

  it("allows a check more time than its longest permitted tool run", () => {
    // Run esp32-sol-20260908T214013792Z-23a1bc: a check that ran one tool at the published
    // 600 s maximum exceeded its own 600 s timeout and was charged as an authoring defect.
    expect(EVALUATOR_WALL_MS).toBeGreaterThan(TOOL_TIMEOUT_CEILING_MS);
  });

  it("preserves a host contract refusal even when the generated check catches it", async () => {
    const dir = fixture(`async function evaluate(request, runtime) {
      try { await runtime.tools.run({ toolId: "cat", stdin: "undeclared private test" }); }
      catch { return true; }
      return true;
    }`);
    const { host, scope } = hostScope();
    try {
      await expect(
        (await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST, { tools: scope.port }),
      ).rejects.toBeInstanceOf(VerifierContractError);
    } finally {
      await scope.close();
    }
    expect(host.evidence()).toHaveLength(0);
  });

  it("does not trust a generated exception's contract name or code", async () => {
    const dir = fixture(`function evaluate() {
      throw Object.assign(new Error("private failure"), { name: "VerifierContractError", code: "verifier-tool-input" });
    }`);
    await expect((await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST)).rejects.toMatchObject({
      kind: "generated",
    });
  });

  it("kills a synchronous loop during generated module loading", async () => {
    const dir = fixture("while (true) {} function evaluate() { return true; }");
    await expect(probeEvaluatorProcess(dir, ["text"], 1_000, LIFETIME)).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("kills a loop after a real tool result without losing its evidence", async () => {
    const dir = fixture(`async function evaluate(request, runtime) {
      await runtime.tools.run({ toolId: "cat", stdin: request.artifact.text });
      while (true) {}
    }`);
    const { host, scope } = hostScope();
    try {
      await expect(
        evaluateIsolated(await bundleEvaluator(dir), "text", REQUEST, {
          runtime: { tools: scope.port },
          timeoutMs: 2_000,
          lifetime: LIFETIME,
        }),
      ).rejects.toMatchObject({ kind: "timeout" });
    } finally {
      await scope.close();
    }
    expect(host.evidence()).toHaveLength(1);
    expect(host.evidence()[0]?.outcome).toBe("executed");
  });

  it("cancels an executing check and settles its process before rejecting", async () => {
    const dir = fixture("function evaluate() { while (true) {} }");
    const evaluate = await loadCorrectnessModel(dir, LIFETIME, AbortSignal.timeout(500));
    await expect(evaluate("text", REQUEST)).rejects.toMatchObject({ kind: "timeout" });
    expect(LIFETIME.pendingReceipts()).toEqual([]);
    LIFETIME.assertUsable();
  });

  it("refuses a return with a tool still pending", async () => {
    const dir = fixture(`function evaluate(request, runtime) {
      void runtime.tools.run({ toolId: "sleep", args: ["0.3"] });
      return true;
    }`);
    const { host, scope } = hostScope();
    try {
      await expect(
        (await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST, { tools: scope.port }),
      ).rejects.toThrow("pending tool invocations");
    } finally {
      await scope.close();
    }
    expect(host.evidence()).toHaveLength(1);
  });

  it("keeps authored attribution when the check throws with a tool still pending", async () => {
    const dir = fixture(`function evaluate(request, runtime) {
      void runtime.tools.run({ toolId: "sleep", args: ["0.3"] });
      throw new Error("authored throw after an unawaited run");
    }`);
    const { host, scope } = hostScope();
    try {
      await expect(
        (await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST, { tools: scope.port }),
      ).rejects.toMatchObject({ kind: "pending" });
    } finally {
      await scope.close();
    }
    expect(host.evidence()).toHaveLength(1);
  });

  it("refuses a candidate aggregate verdict in place of a boolean check", async () => {
    const dir = fixture("function evaluate() { return { ok: true, issues: [] }; }");
    await expect((await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST)).rejects.toThrow(
      "must be boolean",
    );
  });

  it("refuses ambient reads outside the bundle even through a computed runtime lookup", async () => {
    const secret = join(ROOT, "private.txt");
    writeFileSync(secret, "private canary");
    const dir = fixture(`async function evaluate() {
      let denied = false;
      try { await globalThis["B" + "un"].file(${JSON.stringify(secret)}).text(); } catch { denied = true; }
      return denied;
    }`);
    expect(await (await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST)).toBe(true);
  });

  it("refuses to embed an outside file during bundling", async () => {
    const secret = join(ROOT, "private.json");
    writeFileSync(secret, '{"key":"private canary"}');
    const dir = fixture(`import secret from ${JSON.stringify(secret)};
      function evaluate() { return secret.key.length > 0; }`);
    await expect(loadCorrectnessModel(dir, LIFETIME)).rejects.toThrow("outside its bundle");
  });

  it.each(["tasks.json", "controls.json", "private-fixture.json"])(
    "refuses transitive JavaScript imports of %s before execution",
    async (name) => {
      const dir = fixture(
        'import { operand } from "./helper.js"; function evaluate() { return operand !== null; }',
      );
      writeFileSync(
        join(dir, "correctness-model/helper.js"),
        `import operand from "./${name}"; export { operand };`,
      );
      writeFileSync(
        join(dir, "correctness-model", name),
        JSON.stringify({ hidden: "other-check-private-operand" }),
      );
      await expect(bundleEvaluator(dir)).rejects.toThrow("cannot import private operand data");
    },
  );

  it("allows a shared reference helper to import its public support data", async () => {
    const dir = fixture(
      'import { expected } from "./reference/helper.js"; function evaluate(request) { return request.artifact.text === expected; }',
    );
    mkdirSync(join(dir, "correctness-model/reference"), { recursive: true });
    writeFileSync(
      join(dir, "correctness-model/reference/helper.js"),
      'import data from "./values.json"; export const expected = data.text;',
    );
    writeFileSync(join(dir, "correctness-model/reference/values.json"), JSON.stringify(REQUEST.artifact));
    expect(await (await loadCorrectnessModel(dir, LIFETIME))("text", REQUEST)).toBe(true);
  });
});
