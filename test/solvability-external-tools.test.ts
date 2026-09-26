/**
 * The tools an external check is allowed to name: a declared tool that resolves nowhere is refused
 * by the witness. A check that did name a real installed tool must have run it for its witness to
 * count, and a host outage under it stays the host's.
 *
 * Which owner each refusal reaches is the census gate's projection, pinned once in
 * `solvability-gate.test.ts`; the two gate calls kept here prove that the refusal that skips F2
 * reaches the author alone, and that a pass its tool never produced reaches the evaluator rather
 * than the reference solve.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch } from "./helpers/scratch.ts";
import { readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { type Brief, projectFindingForAuthor } from "../src/truth/brief.ts";
import { VerifierExecutionNonResult } from "../src/truth/verifier-nonresult.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { required } from "./helpers/doubles.ts";
import {
  ACCEPTING_TOOL,
  COMPARING_TOOL,
  type SpecimenSpec,
  codes,
  failure,
  gate,
  installUnderCandidate,
  installedTool,
  specimen,
  statuses,
  testLifetime,
  witness,
} from "./helpers/solvability-specimen.ts";

const NO_ENGINE_VERIFIER = `
export function solve(task) {
  return { answer: task.publicInput.expected };
}
// CHECKS
export const checks = { answer: () => true };
`;

afterAll(cleanupScratch);

describe("the tools an external check is allowed to name", () => {
  const externalSpec = (tool: string, verifier = NO_ENGINE_VERIFIER): SpecimenSpec => ({ verifier, tool });

  it.concurrent("names a declared tool that resolves nowhere and runs no witness against it", async () => {
    // Charging the product a witness per task for a verifier that never started says nothing.
    const fixture = specimen(externalSpec("ana-no-such-tool"));
    const result = await witness(fixture);

    expect(codes(result)).toEqual(["solvability-tool-missing"]);
    expect(result.findings[0]).toMatchObject({ path: "correctness-model/brief.json" });
    expect(result.findings[0]?.detail).toContain("ana-no-such-tool");
    expect(result.evidence).toBeNull();
    // With no evidence the gate reports the refusal alone, not a second census failure beside it.
    expect(await gate(fixture, result)).toMatchObject([
      {
        owner: "correctness-model/evaluator.ts",
        severity: "blocking",
        findings: [{ code: "SOLVABILITY_TOOL_MISSING" }],
      },
    ]);
  });

  it.concurrent("runs a declared authored tool through the real F2 input and verifier path", async () => {
    const written = specimen(
      externalSpec(
        "compare",
        `
export function solve(task) { return { answer: task.publicInput.expected }; }
// CHECKS
export const checks = { answer: async ({ artifact, publicTask }, runtime) => {
  const result = await runtime.tools.run({ toolId: "compare", args: ["actual", "expected"],
    files: { actual: artifact.answer, expected: publicTask.publicInput.expected } });
  return result.exitCode === 0;
} };
`,
      ),
    );
    // Known authored bytes may run with authored semantics; they cannot acquire external algorithm
    // authority by moving under .toolchain.
    writeFileSync(join(written.dir, "agent", "compare.sh"), COMPARING_TOOL);
    const briefPath = join(written.dir, "correctness-model", "brief.json");
    const brief = parseJsonAs<Brief>(readFileSync(briefPath, "utf8"));
    const check = required(brief.truthChecks[0], "the declared answer check");
    check.execution.evidence = { kind: "authored" };
    check.execution.requiredToolIds = ["compare"];
    writeFileSync(briefPath, JSON.stringify(brief));
    const result = await witness(installUnderCandidate(written, "compare", COMPARING_TOOL));

    expect(result.findings).toEqual([]);
    expect(statuses(result)).toEqual(["passed", "passed"]);
    expect(result.evidence?.verifierEnvironmentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.concurrent("fails a witness whose external check passed with no completed run of its tool", async () => {
    // The tool resolves, so the census runs; the evaluator simply never asks the host to run it (R1).
    const fixture = specimen(externalSpec("answer-tool"));
    const result = await witness(fixture, {
      createVerifier: () =>
        createVerifierHost({
          inventory: { "answer-tool": installedTool("answer-tool", ACCEPTING_TOOL) },
          requireOsSandbox: false,
          lifetime: testLifetime(),
        }),
    });

    // The evaluator returned a pass its tool never produced, so the evaluator owns the failure and
    // the sentence, naming only check and tool ids, reaches the author whole.
    const sentence =
      'EXTERNAL_VERDICT_UNGROUNDED: check "answer" passed without a completed run of its required tool "answer-tool"';
    expect(failure(result)).toBe(sentence);
    expect(result.evidence?.cases[0]).toMatchObject({ status: "failed", failure: "ungrounded" });
    expect(result.findings[0]).toMatchObject({
      code: "EXTERNAL_VERDICT_UNGROUNDED",
      path: "correctness-model/evaluator.ts",
      detail: sentence,
      disclosure: { class: "authored" },
    });

    // Through the gate the candidate is refused to the evaluator, never to the reference solve it
    // would otherwise send the Builder to rewrite, and the author reads check and tool ids and
    // counts, with no task identity.
    const cases = required(result.evidence, "census evidence").cases;
    const feedback = await gate(fixture, result);
    expect(feedback).toEqual([
      expect.objectContaining({
        owner: "correctness-model/evaluator.ts",
        severity: "blocking",
        claim: `solvability census: ${cases.length} of ${cases.length} reference solves passed a check that never ran its required tools`,
        findings: [expect.objectContaining({ code: "EXTERNAL_VERDICT_UNGROUNDED", detail: sentence })],
      }),
    ]);
    const authorVisible = JSON.stringify(feedback);
    expect(authorVisible).not.toContain("SOLVABILITY_CENSUS_BLOCKED");
    for (const row of cases) expect(authorVisible).not.toContain(`"${row.taskId}"`);
  });

  it.each(["return true;", 'throw new Error("tool output unavailable");'])(
    "preserves the host outage through isolated evaluation: %s",
    async (completion) => {
      // The host's own missing-executable row is an environment result, whatever the check returns.
      const fixture = specimen(
        externalSpec(
          "answer-tool",
          `
export function solve(task) {
  return { answer: task.publicInput.expected };
}
// CHECKS
export const checks = { answer: async (_request, runtime) => {
  await runtime.tools.run({ toolId: "answer-tool" });
  ${completion}
} };
`,
        ),
      );
      const absent = installedTool("answer-tool", ACCEPTING_TOOL);
      rmSync(absent.path);

      await expect(
        witness(fixture, {
          createVerifier: () =>
            createVerifierHost({
              inventory: { "answer-tool": absent },
              requireOsSandbox: false,
              lifetime: testLifetime(),
            }),
        }),
      ).rejects.toBeInstanceOf(VerifierExecutionNonResult);
    },
  );

  it.concurrent("fails a witness whose runtimeNonResult no host row supports", async () => {
    // A check cannot replace its boolean with an authored environment result.
    const fixture = specimen({
      verifier: `
export function solve(task) { return { answer: task.publicInput.expected }; }
// CHECKS
export const checks = { answer: () => ({ ok: false, resultKind: "runtimeNonResult", nonResultKind: "verifierUnavailable" }) };
`,
    });
    const result = await witness(fixture);

    expect(codes(result)).toContain("solvability-witness-failed");
    expect(failure(result)).toContain("check result must be boolean");
  });

  it.concurrent("marks the generated-controlled pending run count before author projection", async () => {
    const pendingCount = 7;
    const result = await witness(
      specimen(
        externalSpec(
          "answer-tool",
          `
export function solve(task) { return { answer: task.publicInput.expected }; }
// CHECKS
export const checks = { answer: async (_request, runtime) => {
  await runtime.tools.run({ toolId: "answer-tool" });
  for (let index = 0; index < ${String(pendingCount)}; index += 1) {
    void runtime.tools.run({ toolId: "answer-tool" });
  }
  return true;
} };
`,
        ),
      ),
      {
        createVerifier: () =>
          createVerifierHost({
            inventory: { "answer-tool": installedTool("answer-tool", ACCEPTING_TOOL) },
            requireOsSandbox: false,
            lifetime: testLifetime(),
          }),
      },
    );
    const finding = result.findings.find((candidate) => candidate.detail.includes("pending"));

    expect(finding?.disclosure).toMatchObject({
      class: "withheld",
      classification: expect.stringMatching(/^generated-(correctness-model-pending|evaluate-throw)$/),
    });
    const promptBytes = JSON.stringify(
      projectFindingForAuthor(required(finding, "the finding under projection")),
    );
    expect(promptBytes).toContain("generated-execution");
    expect(promptBytes).not.toContain(String(pendingCount));
    expect(promptBytes).not.toContain("run(s) were still pending");
  });
});
