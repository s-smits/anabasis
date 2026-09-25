/**
 * The tools an external check is allowed to name: a declared tool that resolves nowhere is refused
 * by the witness. A check that did name a real installed tool must have run it for its witness to
 * count, and a host outage under it stays the host's.
 *
 * Which owner each refusal reaches is the census gate's projection, pinned once in
 * `solvability-gate.test.ts`; the one gate call kept here proves the refusal that skips F2 reaches
 * the author alone.
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
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
  // BASE_TASKS,
  COMPARING_TOOL,
  type SpecimenSpec,
  codes,
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
  // countingHost,
  // evaluateLog,
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

  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
  // it.concurrent("refuses a self-authored tool before constructing a verifier or running F2 witnesses", async () => {
  //   const written = specimen(externalSpec("authored-tool"));
  //   writeFileSync(join(written.dir, "agent", "authored-tool.sh"), ACCEPTING_TOOL);
  //   const fixture = installUnderCandidate(written, "authored-tool", ACCEPTING_TOOL);
  //   let verifierCreations = 0;
  //   const log = evaluateLog();
  //   const result = await witness(fixture, {
  //     createVerifier: () => {
  //       verifierCreations += 1;
  //       return countingHost(log);
  //     },
  //   });
  //
  //   expect(codes(result)).toEqual(["solvability-tool-self-authored"]);
  //   expect(verifierCreations).toBe(0);
  //   expect(log.calls).toBe(0);
  //   expect(result.evidence).toBeNull();
  // });

  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
  //   it.concurrent("refuses an external check that hands its program to the interpreter as an argument, after the witnesses ran", async () => {
  //     const written = specimen({
  //       ...externalSpec(
  //         "interp",
  //         `
  // export function solve(task) { return { answer: task.publicInput.expected }; }
  // // CHECKS
  // export const checks = { answer: async ({ artifact, publicTask }, runtime) => {
  //   const program = ["import sys", "a = open(sys.argv[1]).read()", "b = open(sys.argv[2]).read()", "sys.exit(0 if a == b else 1)"].join("\\n");
  //   const result = await runtime.tools.run({ toolId: "interp", args: ["-c", program, "actual", "expected"],
  //     files: { actual: artifact.answer, expected: publicTask.publicInput.expected } });
  //   return result.exitCode === 0;
  // } };
  // `,
  //       ),
  //     });
  //     // This stub has no matching source in the candidate, so the known-authored-byte check does not
  //     // flag it. Its recorded arguments are what the program-argument refusal reads.
  //     const fixture = installUnderCandidate(written, "interp", ACCEPTING_TOOL);
  //     const result = await witness(fixture);
  //
  //     expect(codes(result)).toEqual(["solvability-tool-program-argument"]);
  //     expect(result.findings[0]?.detail).toContain("answer (interp, ");
  //     expect(result.evidence?.toolRuns).toBe(BASE_TASKS.length);
  //   });

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

  // Gate audit 2026-09-25 (docs/gate-audit.md, f2-witness-relay): commented out (unsure): a reference solve whose externally grounded check ran no completed tool no longer fails its F2 witness
  // it.concurrent("fails a witness whose applicable external check ran no completed tool", async () => {
  //   // The tool resolves, so the census runs; the evaluator simply never asks the host to run it.
  //   const result = await witness(specimen(externalSpec("answer-tool")), {
  //     createVerifier: () =>
  //       createVerifierHost({
  //         inventory: { "answer-tool": installedTool("answer-tool", ACCEPTING_TOOL) },
  //         requireOsSandbox: false,
  //         lifetime: testLifetime(),
  //       }),
  //   });
  //
  //   expect(codes(result)).toContain("solvability-witness-failed");
  //   expect(failure(result)).toContain(
  //     "externally grounded check(s) [answer] ran no completed tool for this witness",
  //   );
  // });

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
