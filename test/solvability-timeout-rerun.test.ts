/**
 * An F2 grading run that timed out beside the other reference tasks runs once more, alone, before
 * the census refuses. Most recorded F2 timeouts were a tool's cost meeting its wall with four lanes
 * sharing the host, so a case that completes when it has the host to itself passes; a tool that
 * times out alone too still refuses, and carries both timings and the host load to the gate.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { join } from "../src/meta/path.ts";
import { VerifierExecutionNonResult } from "../src/correctness-bundle/verifier-nonresult.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { installedTool, specimen, statuses, testLifetime, witness } from "./helpers/solvability-specimen.ts";

const TIMED_VERIFIER = `
export function solve(task) {
  return { answer: task.publicInput.expected };
}
// CHECKS
export const checks = { answer: async ({ artifact }, runtime) => {
  const run = await runtime.tools.run({
    toolId: "answer-tool", args: ["answer"], files: { answer: artifact.answer }, timeoutMs: 1500,
  });
  return run.exitCode === 0;
} };
`;

const SLOW_ALWAYS = "#!/bin/sh\nsleep 6\nexit 0\n";

/** The first run to claim the lock sleeps past its wall; every other run exits 0 at once. `mkdir`
 *  is atomic, so exactly one run in the whole census is slow. */
const slowOnce = (lock: string) => `#!/bin/sh\nif mkdir "${lock}" 2>/dev/null; then sleep 6; fi\nexit 0\n`;

// The wall leaves a loaded test host room to start a shell script, and the slow run sleeps well past it.
const census = (tool: string) =>
  witness(specimen({ verifier: TIMED_VERIFIER, tool: "answer-tool" }), {
    createVerifier: () =>
      createVerifierHost({
        inventory: { "answer-tool": installedTool("answer-tool", tool) },
        requireOsSandbox: false,
        lifetime: testLifetime(),
      }),
  });

afterAll(cleanupScratch);

describe("an F2 grading run that timed out", () => {
  it("passes when the case completes on its rerun alone", async () => {
    const result = await census(slowOnce(join(scratchDir("ana-rerun-lock-"), "claimed")));

    expect(result.findings).toEqual([]);
    expect(statuses(result)).toEqual(["passed", "passed"]);
    // The slow first run, the other task's run, and the rerun; each task asks its own question, so
    // the rerun cannot borrow the other task's answer.
    expect(result.evidence?.toolRuns).toBe(3);
  });

  it("refuses when the rerun alone times out too, carrying both timings and the host load", async () => {
    const { evidence, rerun } = await census(SLOW_ALWAYS).then(
      () => {
        throw new Error("expected the census to refuse on a timeout");
      },
      (caught: unknown) => {
        if (caught instanceof VerifierExecutionNonResult) return caught;
        throw caught;
      },
    );
    expect(evidence).toMatchObject({ phase: "solvability", outcome: "timeout", attempt: 2 });
    expect(rerun?.first).toMatchObject({ outcome: "timeout", attempt: 1, subjectId: evidence.subjectId });
    // No run of the tool on this check completed anywhere in the census.
    expect(rerun?.slowestCompletedMs).toBeNull();
    expect(rerun?.load.cores).toBeGreaterThan(0);
  });
});
