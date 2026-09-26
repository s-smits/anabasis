/**
 * A control census that ends in a verifier non-result.
 *
 * The census reaches no verdict, so the question is who owns the failure. A crash or timeout
 * inside the declared tool is the evaluator author's and repairable at once; an unreadable tool or
 * a pre-spawn wall refusal is the environment's, retried once and then settled there without
 * reaching the author. The host's reason may quote the tool, so it stays in protected evidence.
 */
import { mkdirSync, readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { OPUS_SANDBOX, TRUSS_CRASH, blockingRow } from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { double } from "./helpers/doubles.ts";
import { controllerValidatedFinding } from "../src/truth/brief.ts";
import { makeCensusGate } from "../src/run/census-gate.ts";
import type { VerifierExecutionEvidence } from "../src/verify/verifier-port.ts";
import type { BuiltHarness, CampaignFeedback } from "../src/author/campaign-types.ts";
import { TOOL_REFUSED_CODE } from "../src/truth/grounding-coverage.ts";
import { VerifierExecutionNonResult } from "../src/truth/verifier-nonresult.ts";

afterAll(cleanupScratch);

const ROOT = scratchDir("ana-census-engine-");

function harness(): BuiltHarness {
  return double({
    brief: {
      truthChecks: [
        {
          id: "design-contract",
          execution: {
            families: "all",
            artifactPaths: ["$.artifact"],
            publicInputPaths: [],
            hidden: "none",
            evidence: { kind: "external", requiredToolIds: ["truss-contract-checker"] },
          },
        },
      ],
    },
    battery: { tasks: Array.from({ length: 25 }, (_, i) => ({ taskId: `t${i}` })) },
    corpus: {
      accept: [{ id: "accept-span-alternate-topology", taskId: "t0" }],
      reject: [{ id: "r-contract", taskId: "t1", expectedCheckId: "design-contract" }],
    },
  });
}

/** Runs one census gate in its own iteration directory and returns what it settled and recorded. */
async function runGate(name: string, options: Omit<Parameters<typeof makeCensusGate>[0], "expectedTasks">) {
  const iterationDir = join(ROOT, name);
  mkdirSync(join(iterationDir, "workspace"), { recursive: true });
  const gate = makeCensusGate({ expectedTasks: 25, toolRetryWaitMs: 0, ...options });
  const feedback = await gate(harness(), iterationDir, join(iterationDir, "workspace"));
  const read = (file: string) => JSON.parse(readFileSync(join(iterationDir, file), "utf8"));
  return { feedback, read };
}

async function settle(name: string, evidence: VerifierExecutionEvidence) {
  const { feedback, read } = await runGate(name, {
    probeControls: async () => {
      throw new VerifierExecutionNonResult(evidence);
    },
  });
  return { feedback, recorded: read("verifier-non-result.json"), census: read("census.json") };
}

describe("a census that ends in a verifier non-result", () => {
  it("gives the evaluator's author a repairable finding, and an ordinary fail verdict", async () => {
    const { feedback, recorded, census } = await settle("truss", TRUSS_CRASH);
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ owner: "correctness-model/evaluator.ts", severity: "blocking" });
    const finding = feedback[0]?.findings?.[0];
    expect(finding?.code).toBe("tool-crash");
    // The run's arguments, files and timeout are written in the evaluator; no registry file exists.
    expect(finding?.path).toBe("correctness-model/evaluator.ts");
    for (const fact of [
      "node checker.js contract",
      'control "accept-span-alternate-topology"',
      'check "design-contract"',
      // The host's process and cell facts cross; the tool's own output stays protected.
      'outcome "crash"',
      "exit 1, 66 ms, 0 stdout bytes, 786 stderr bytes",
      "(attempt 1)",
      "cwd, TMPDIR and HOME are one private scratch directory",
      "environment variables received: PATH, TMPDIR, HOME.",
      `sandbox "${TRUSS_CRASH.sandbox}"`,
    ]) {
      expect(finding?.detail).toContain(fact);
    }
    expect(finding?.detail).not.toContain("Cannot find module");
    expect(recorded.stderrTail).toContain("Cannot find module");
    // The census refuses this candidate as repairable; the tool execution itself stays a
    // non-result, bound by digest, and is not a failed solve or a capability observation.
    expect(census.verdict).toBe("fail");
    expect(census.verifierNonResultEvidence?.path).toBe("verifier-non-result.json");
    expect(census.verifierNonResultEvidence?.sha256).toEqual(expect.any(String));
  });

  it.each([
    'tool "truss-contract-checker" died (exit 1); stderr tail: Error: Cannot find module',
    "the cell denied /usr/local/lib/node_modules during preparation",
  ])("keeps the host's reason protected, because it may quote the tool: %s", async (reason) => {
    const { feedback, recorded } = await settle(`reason-${reason.length}`, {
      ...TRUSS_CRASH,
      nonResultReason: reason,
    });
    expect(recorded.nonResultReason).toBe(reason);
    expect(JSON.stringify(feedback)).not.toContain(reason);
  });

  it("gives the author the host's over-cap reason, which carries byte counts and no tool byte", async () => {
    const reason =
      'tool "truss-contract-checker" wrote 2590112 stdout bytes, over the 1048576 the host reads; print only what the check reads';
    const { feedback } = await settle("over-cap", {
      ...TRUSS_CRASH,
      outcome: "protocol",
      exitCode: 0,
      stdoutBytes: 2_590_112,
      nonResultReason: reason,
    });
    expect(feedback[0]).toMatchObject({ owner: "correctness-model/evaluator.ts", severity: "blocking" });
    expect(feedback[0]?.findings?.[0]?.code).toBe("tool-no-result");
    expect(feedback[0]?.findings?.[0]?.detail).toContain(`outcome "protocol": ${reason}.`);
  });

  it("gives no cell advice when no process ever started", async () => {
    const { feedback } = await settle("never-started", {
      ...TRUSS_CRASH,
      durationMs: 0,
      exitCode: null,
      signal: null,
      stderrBytes: 0,
      stderrTail: "",
    });
    const detail = feedback[0]?.findings?.[0]?.detail ?? "";
    expect(detail).toContain("never started");
    expect(detail).toContain("The host refused the request before starting a process");
    expect(detail).not.toContain("Cell facts:");
  });

  it("codes each mechanism separately while the claim names only the tool, so one dead tool keeps one stall identity", async () => {
    const crash = await settle("claim-crash", TRUSS_CRASH);
    const timeout = await settle("claim-timeout", { ...TRUSS_CRASH, outcome: "timeout", timedOut: true });
    const other = await settle("claim-other", { ...TRUSS_CRASH, toolId: "fwcheck" });
    expect(crash.feedback[0]?.findings?.[0]?.code).toBe("tool-crash");
    expect(timeout.feedback[0]?.findings?.[0]?.code).toBe("tool-timeout");
    expect(crash.feedback[0]?.claim).toBe(
      'control census: runs of tool "truss-contract-checker" reached no completed run',
    );
    expect(timeout.feedback[0]?.claim).toBe(crash.feedback[0]?.claim);
    expect(other.feedback[0]?.claim).not.toBe(crash.feedback[0]?.claim);
  });

  it.each([
    [
      "an unreadable tool on the environment after one retry",
      { ...TRUSS_CRASH, outcome: "verifierUnavailable" as const },
      2,
      "environment",
    ],
    ["a pre-spawn wall refusal on the environment after one retry", OPUS_SANDBOX, 2, "environment"],
    // The hostile side: a crash is the author's, so a second probe would buy nothing.
    ["a crash on the author at once", TRUSS_CRASH, 1, "correctness-model/evaluator.ts"],
  ] as const)("settles %s", async (name, evidence, probes, owner) => {
    let probeCalls = 0;
    const { feedback, read } = await runGate(`retry-${name}`, {
      probeControls: async () => {
        probeCalls += 1;
        throw new VerifierExecutionNonResult(evidence);
      },
    });
    expect(probeCalls).toBe(probes);
    expect(feedback.map((row) => row.owner)).toEqual([owner]);
    if (owner !== "environment") return;
    // An environment row names the host step it stopped on, with no repairable path, and the
    // census records a non-result.
    expect(feedback[0]?.severity).toBe("blocking");
    expect(feedback[0]?.claim).toContain(`tool "${evidence.toolId}" (${evidence.outcome}), twice`);
    expect((feedback[0]?.findings ?? []).map((found) => [found.code, found.path])).toEqual([
      [evidence.outcome === "sandbox" ? "tool-wall-refusal" : "tool-unavailable", "environment"],
    ]);
    expect(read("census.json").verdict).toMatchObject({
      kind: "non-result",
      evidence: { path: "environment-non-result.json", sha256: expect.any(String) },
    });
    expect(read("environment-non-result.json")).toMatchObject({ outcome: evidence.outcome });
  });

  it("names no task when the solvability census met the failure", async () => {
    const { feedback } = await settle("solvability", {
      ...TRUSS_CRASH,
      phase: "solvability",
      subjectId: "t17",
    });
    expect(feedback[0]?.owner).toBe("correctness-model/evaluator.ts");
    expect(feedback[0]?.findings?.[0]?.detail).not.toContain("t17");
  });

  it("drains a reference solve still running past the wall before the retry starts", async () => {
    let referenceDone = false;
    let solves = 0;
    const probeStarts: boolean[] = [];
    const { feedback } = await runGate("drain-before-retry", {
      probeControls: async () => {
        probeStarts.push(referenceDone);
        if (probeStarts.length === 1) throw new VerifierExecutionNonResult(OPUS_SANDBOX);
        return { findings: [] };
      },
      solvability: async () => {
        solves += 1;
        if (solves === 1) {
          await Bun.sleep(45);
          referenceDone = true;
        }
        return [];
      },
      censusWallMs: 30,
    });
    expect(feedback).toEqual([]);
    expect(probeStarts).toEqual([false, true]);
  });

  const referenceBlocked: CampaignFeedback = {
    ...blockingRow("correctness-model/evaluator.ts", "full-task reference solve blocked", "solvability.json"),
    findings: [
      controllerValidatedFinding({
        code: "SOLVABILITY_CENSUS_BLOCKED",
        path: "correctness-model/reference/index.ts",
        detail: "one task failed",
      }),
    ],
  };
  const codesOf = (feedback: readonly CampaignFeedback[]) =>
    feedback.flatMap((row) => (row.findings ?? []).map((finding) => finding.code));

  it("keeps completed reference rows and other control findings beside a control census the host refused", async () => {
    const { feedback, read } = await runGate("refused-beside-reference", {
      probeControls: async () => ({
        findings: [
          {
            code: TOOL_REFUSED_CODE,
            path: "correctness-model/evaluator.ts",
            detail: "the host refused tool fwcheck twice",
          },
          {
            code: "DISCRIMINATION_REJECT_PASSED",
            path: "correctness-model/controls.json",
            detail: "a reject passed",
          },
        ],
      }),
      solvability: async () => [referenceBlocked],
    });
    expect(feedback.map((row) => row.owner)).toEqual([
      "environment",
      "correctness-model/evaluator.ts",
      "correctness-model/evaluator.ts",
    ]);
    expect(codesOf(feedback)).toEqual([
      TOOL_REFUSED_CODE,
      "DISCRIMINATION_REJECT_PASSED",
      "SOLVABILITY_CENSUS_BLOCKED",
    ]);
    const census = read("census.json");
    expect(census.verdict).toMatchObject({ kind: "non-result" });
    expect(census.blocking).toHaveLength(3);
  });

  it("keeps completed reference rows beside a control census that threw", async () => {
    const { feedback } = await runGate("thrown-beside-reference", {
      probeControls: async () => {
        throw new VerifierExecutionNonResult(TRUSS_CRASH);
      },
      solvability: async () => [referenceBlocked],
    });
    expect(codesOf(feedback)).toEqual(["tool-crash", "SOLVABILITY_CENSUS_BLOCKED"]);
  });
});
