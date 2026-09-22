/**
 * A control census that ends in a verifier non-result.
 *
 * The census reaches no verdict, so the question is who owns the failure. A crash inside the
 * declared tool is the evaluator author's and repairable; a pre-spawn sandbox refusal is the
 * environment's and never reaches the author, along with the host's reason, which may quote it.
 */
import { mkdirSync, readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { OPUS_SANDBOX, TRUSS_CRASH } from "./helpers/builder-campaign.ts";
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

async function settle(name: string, evidence: VerifierExecutionEvidence) {
  const iterationDir = join(ROOT, name);
  mkdirSync(join(iterationDir, "workspace"), { recursive: true });
  const gate = makeCensusGate({
    probeControls: async () => {
      throw new VerifierExecutionNonResult(evidence);
    },
    expectedTasks: 25,
  });
  const feedback = await gate(harness(), iterationDir, join(iterationDir, "workspace"));
  const read = (file: string) => JSON.parse(readFileSync(join(iterationDir, file), "utf8"));
  return { feedback, recorded: read("verifier-non-result.json"), census: read("census.json") };
}

describe("a census that ends in a verifier non-result", () => {
  it("gives the evaluator's author a repairable finding, and an ordinary fail verdict", async () => {
    const { feedback, recorded, census } = await settle("truss", TRUSS_CRASH);
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.owner).toBe("correctness-model");
    expect(feedback[0]?.severity).toBe("blocking");
    const finding = feedback[0]?.findings?.[0];
    expect(finding?.code).toBe("tool-crash");
    // The evaluator is what the author changes now: the run's arguments, files and timeout are
    // written there, and there is no registry file to repair.
    expect(finding?.path).toBe("correctness-model/evaluator.ts");
    expect(finding?.detail).toContain("node checker.js contract");
    expect(finding?.detail).toContain('control "accept-span-alternate-topology"');
    expect(finding?.detail).toContain('check "design-contract"');
    // The host's process facts cross; the tool's own output stays protected with the stderr tail.
    expect(finding?.detail).toContain('outcome "crash"');
    expect(finding?.detail).toContain("exit 1, 66 ms, 0 stdout bytes, 786 stderr bytes");
    expect(finding?.detail).toContain("(attempt 1)");
    expect(finding?.detail).not.toContain("Cannot find module");
    expect(recorded.stderrTail).toContain("Cannot find module");
    // The host's own cell facts cross: what the cell held and which variables the tool received.
    expect(finding?.detail).toContain("cwd, TMPDIR and HOME are one private scratch directory");
    expect(finding?.detail).toContain("environment variables received: PATH, TMPDIR, HOME.");
    expect(finding?.detail).toContain(`sandbox "${TRUSS_CRASH.sandbox}"`);
    // The census refuses this candidate as repairable. The underlying tool execution remains
    // a non-result; this census verdict is not a failed solve or a capability observation.
    expect(census.verdict).toBe("fail");
    // The protected file stays bound by digest even though the verdict no longer points at it.
    expect(census.verifierNonResultEvidence?.path).toBe("verifier-non-result.json");
    expect(census.verifierNonResultEvidence?.sha256).toEqual(expect.any(String));
  });

  it("keeps the host's reason protected, because it may quote the tool", async () => {
    const { feedback, recorded } = await settle("crash-reason", {
      ...TRUSS_CRASH,
      nonResultReason: 'tool "truss-contract-checker" died (exit 1); stderr tail: Error: Cannot find module',
    });
    expect(feedback[0]?.findings?.[0]?.detail).not.toContain("Cannot find module");
    expect(recorded.nonResultReason).toContain("Cannot find module");
  });

  it("gives no cell advice when no process ever started", async () => {
    // sol-fix 2026-08-22 rounds 13-14: the author saw a refusal it never had the chance to write
    // an output for, plus advice about reading an exit code that never existed.
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

  it("codes each no-completed-run family separately, so a reader can group failures by mechanism", async () => {
    // run25-sol-0830 recorded eleven of these under one code: crashes at exits 42 to 82, a
    // pre-start refusal and a 60 s timeout. The repairs differ, so the label a reader groups by
    // has to differ too. Only the author-owned kinds reach a finding at all; the wall's own kinds
    // settle on the environment below.
    const code = async (name: string, evidence: VerifierExecutionEvidence) =>
      (await settle(name, evidence)).feedback[0]?.findings?.[0]?.code;
    expect(await code("family-crash", TRUSS_CRASH)).toBe("tool-crash");
    expect(await code("family-timeout", { ...TRUSS_CRASH, outcome: "timeout", timedOut: true })).toBe(
      "tool-timeout",
    );
  });

  it("names the tool in the claim and not the outcome kind, so one dead tool keeps one stall identity", async () => {
    const crash = await settle("claim-crash", TRUSS_CRASH);
    const timeout = await settle("claim-timeout", { ...TRUSS_CRASH, outcome: "timeout", timedOut: true });
    const other = await settle("claim-other", { ...TRUSS_CRASH, toolId: "fwcheck" });
    expect(crash.feedback[0]?.claim).toBe(
      'control census: runs of tool "truss-contract-checker" reached no completed run',
    );
    expect(timeout.feedback[0]?.claim).toBe(crash.feedback[0]?.claim);
    expect(other.feedback[0]?.claim).not.toBe(crash.feedback[0]?.claim);
  });

  it("retries an unreadable tool once, then settles it on the environment", async () => {
    // `verifierUnavailable` is the host's own: the executable could not be read at all, which no
    // evaluator edit repairs. Billing it to the author sent a paid session to rewrite the
    // evaluator in answer to a host outage.
    const iterationDir = join(ROOT, "candidate-retry");
    mkdirSync(join(iterationDir, "workspace"), { recursive: true });
    let probeCalls = 0;
    const gate = makeCensusGate({
      probeControls: async () => {
        probeCalls += 1;
        throw new VerifierExecutionNonResult({ ...TRUSS_CRASH, outcome: "verifierUnavailable" });
      },
      expectedTasks: 25,
      toolRetryWaitMs: 0,
    });
    const feedback = await gate(harness(), iterationDir, join(iterationDir, "workspace"));
    expect(probeCalls).toBe(2);
    expect(feedback.map((row) => row.owner)).toEqual(["environment"]);
    expect(feedback[0]?.severity).toBe("blocking");
    expect(feedback[0]?.claim).toContain('tool "truss-contract-checker" (verifierUnavailable), twice');
    // No author finding rides along: an environment row carries no repairable path.
    expect(feedback[0]?.findings ?? []).toHaveLength(0);
    const census = JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8"));
    expect(census.verdict).toMatchObject({
      kind: "non-result",
      evidence: { path: "environment-non-result.json", sha256: expect.any(String) },
    });
    const record = JSON.parse(readFileSync(join(iterationDir, "environment-non-result.json"), "utf8"));
    expect(record).toMatchObject({ outcome: "verifierUnavailable" });
    expect(record.stderrTail).toContain("Cannot find module");
  });

  it("retries a sandbox non-result once, then attributes it to the environment", async () => {
    // w37-opus: a pre-spawn wall refusal. The author cannot install the OS mechanism, so
    // this kind takes the same route as an unreadable tool — one retry, then the environment.
    const iterationDir = join(ROOT, "candidate-sandbox-repeat");
    mkdirSync(join(iterationDir, "workspace"), { recursive: true });
    let probeCalls = 0;
    const gate = makeCensusGate({
      probeControls: async () => {
        probeCalls += 1;
        throw new VerifierExecutionNonResult(OPUS_SANDBOX);
      },
      expectedTasks: 25,
      toolRetryWaitMs: 0,
    });
    const feedback = await gate(harness(), iterationDir, join(iterationDir, "workspace"));
    expect(probeCalls).toBe(2);
    expect(feedback.map((row) => row.owner)).toEqual(["environment"]);
  });

  it("charges an author-owned kind immediately, with no retry", async () => {
    // The hostile side of the retry above: a crash is the author's, so a second probe would spend
    // a whole census on a failure the first one already attributed.
    const iterationDir = join(ROOT, "author-kind-no-retry");
    mkdirSync(join(iterationDir, "workspace"), { recursive: true });
    let probeCalls = 0;
    const gate = makeCensusGate({
      probeControls: async () => {
        probeCalls += 1;
        throw new VerifierExecutionNonResult(TRUSS_CRASH);
      },
      expectedTasks: 25,
    });
    const feedback = await gate(harness(), iterationDir, join(iterationDir, "workspace"));
    expect(probeCalls).toBe(1);
    expect(feedback.map((row) => row.owner)).toEqual(["correctness-model"]);
  });

  it("names no task when the solvability census met the failure", async () => {
    const { feedback } = await settle("solvability", {
      ...TRUSS_CRASH,
      phase: "solvability",
      subjectId: "t17",
    });
    expect(feedback[0]?.owner).toBe("correctness-model");
    expect(feedback[0]?.findings?.[0]?.detail).not.toContain("t17");
  });

  it("drains a reference solve still running past the wall before the retry starts", async () => {
    // The controls met a transient wall refusal at once while F2 ran on past the census wall; the
    // retry used to start beside the abandoned F2 and overlap its tool cells.
    const iterationDir = join(ROOT, "drain-before-retry");
    mkdirSync(join(iterationDir, "workspace"), { recursive: true });
    let referenceDone = false;
    let solves = 0;
    const probeStarts: boolean[] = [];
    const gate = makeCensusGate({
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
      expectedTasks: 25,
      toolRetryWaitMs: 0,
      censusWallMs: 30,
    });
    expect(await gate(harness(), iterationDir, join(iterationDir, "workspace"))).toEqual([]);
    expect(probeStarts).toEqual([false, true]);
  });

  const referenceBlocked: CampaignFeedback = {
    owner: "correctness-model",
    severity: "blocking",
    claim: "full-task reference solve blocked",
    evidence: "solvability.json",
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
    const iterationDir = join(ROOT, "refused-beside-reference");
    mkdirSync(join(iterationDir, "workspace"), { recursive: true });
    const gate = makeCensusGate({
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
      expectedTasks: 25,
    });
    const feedback = await gate(harness(), iterationDir, join(iterationDir, "workspace"));
    expect(feedback.map((row) => row.owner)).toEqual([
      "environment",
      "correctness-model",
      "correctness-model",
    ]);
    expect(codesOf(feedback)).toEqual(["DISCRIMINATION_REJECT_PASSED", "SOLVABILITY_CENSUS_BLOCKED"]);
    const census = JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8"));
    expect(census.verdict).toMatchObject({ kind: "non-result" });
    expect(census.blocking).toHaveLength(3);
  });

  it("keeps completed reference rows beside a control census that threw", async () => {
    const iterationDir = join(ROOT, "thrown-beside-reference");
    mkdirSync(join(iterationDir, "workspace"), { recursive: true });
    const gate = makeCensusGate({
      probeControls: async () => {
        throw new VerifierExecutionNonResult(TRUSS_CRASH);
      },
      solvability: async () => [referenceBlocked],
      expectedTasks: 25,
    });
    const feedback = await gate(harness(), iterationDir, join(iterationDir, "workspace"));
    expect(codesOf(feedback)).toEqual(["tool-crash", "SOLVABILITY_CENSUS_BLOCKED"]);
  });

  it("keeps the exact reason out of model-visible text", async () => {
    const reason = "the cell denied /usr/local/lib/node_modules during preparation";
    const { feedback, recorded } = await settle("protection", { ...TRUSS_CRASH, nonResultReason: reason });
    expect(recorded.nonResultReason).toBe(reason);
    expect(JSON.stringify(feedback)).not.toContain(reason);
  });
});
