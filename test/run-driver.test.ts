/**
 * Tests for the battery driver: one case row per task, digest-checked evidence pointers,
 * completeness against the task set and separate verified, unaccepted and non-result counts.
 * The shared matching fixture (test/helpers/matching-fixture.ts) uses a scripted solver.
 * This avoids provider calls while exercising the real fingerprint, bundle snapshot,
 * verification and recording paths.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { isString } from "../src/meta/json-shape.ts";
import {
  CaseRecord as CaseRecordStore,
  readCaseRecord,
  verifyTracePointers,
} from "../src/claim/case-record.ts";
import {
  type DriveBatteryResult,
  batteryCondition,
  driveBattery,
  summarizeRun,
} from "../src/run/run-driver.ts";
import { type BuiltRuntimeBoundaryEvidence, type Solver, nonResultOutcome } from "../src/truth/solve.ts";
import type { GeneratedToolBoundaryProbe } from "../src/solve/built-starter.ts";
import {
  MATCHING_TOOLS_SPEC,
  MATCHING_TASKS as TASKS,
  scriptedMatchingSolver as scriptedSolver,
  writeMatchingSlug,
} from "./helpers/matching-fixture.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { SCRIPTED_CONDITION, SCRIPTED_THRESHOLD_DIGEST } from "./helpers/verification-runner-fixtures.ts";
import {
  type BatteryRecord,
  type ControlReceipt,
  batteryDisposition,
  batteryTerminalReason,
  readRecordedBatteryRecord,
} from "../src/truth/battery-record.ts";
import type { ControlCorpus } from "../src/truth/controls.ts";
import { batteryClaimInput, batteryRunEvidence } from "../src/claim/battery-run-evidence.ts";
import { NEVER_ATTEMPTED_PREFIX } from "../src/truth/battery-provider-stop.ts";
import { double } from "./helpers/doubles.ts";
import type { JudgeSession } from "../src/truth/judge-contract.ts";
import { ProviderResourceBudgetExhausted } from "../src/run/provider-resource-budget.ts";
const SCRIPTED_NONE = "scripted/none";
/** A solver block for a case that started no tool call. */
const NO_CALL = { startedToolCalls: 0 };
/** A battery that verified nothing: every map present and empty, the count at zero. */
const NO_FIRING = {
  firedByCheck: {},
  executedByCheck: {},
  blockingByCheck: {},
  applicableByCheck: {},
  verifierVerifiedCount: 0,
};

/** Attach a runtime boundary fixture in the format returned by the Pi Built solver.
 *  This exercises the driver's recorded built-runtime.json pointer. */
function boundarySolver(base: Solver): Solver {
  const boundary: BuiltRuntimeBoundaryEvidence = {
    schema: "built-runtime-boundary/v1",
    modelWorker: {
      workerInstanceId: "00000000-0000-4000-8000-000000000000",
      conditionDigest: "0".repeat(64),
      confinedPid: null,
      controllerPid: runtimeProcess.pid,
      workingDirectory: "/scripted/bundle",
      policyHash: "1".repeat(64),
      bundleDigest: "2".repeat(64),
      modelSelection: null,
      termination: { status: "normal" },
    },
    contractCondition: {
      systemPromptDigest: "3".repeat(64),
      systemPrompt: "scripted system prompt",
      firstTurnTemplateDigest: "4".repeat(64),
      nudgeDigest: "5".repeat(64),
      toolSchemaDigest: "6".repeat(64),
      tools: [],
      operatingGuide: null,
      backendProfileDigest: "7".repeat(64),
      maxTurns: 4,
    },
    generatedTools: {
      schema: "generated-tool-worker/v3",
      workerInstanceId: "00000000-0000-4000-8000-000000000001",
      confinedPid: 1,
      controllerPid: runtimeProcess.pid,
      sourceDigest: "8".repeat(64),
      policyIdentity: "scripted-test",
      policyHash: "9".repeat(64),
      bundleDigest: "a".repeat(64),
      registrationDigest: "b".repeat(64),
      toolSchemaDigest: "6".repeat(64),
      artifactWriterNames: [],
      probe: provedProbe(),
      termination: { status: "normal" },
    },
  };
  return async (task, toolset, submitted) => ({
    ...(await base(task, toolset, submitted)),
    runtimeBoundary: boundary,
  });
}

function writeSlug(slugDir: string): void {
  writeMatchingSlug(slugDir);
  writeFileSync(join(slugDir, "agent/tools-spec.json"), JSON.stringify(MATCHING_TOOLS_SPEC));
}

const SCRATCH_ROOT = mkdtempSync(join(import.meta.dir, ".ana-scratch-rundriver-"));
afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

const provedProbe = (): GeneratedToolBoundaryProbe => ({
  outsideReadRefused: { status: "proved", code: "EPERM" },
  outsideWriteRefused: { status: "proved", code: "EPERM" },
  credentialEnvironmentAbsent: { status: "proved", code: "no credential-shaped environment name" },
  networkRefused: { status: "proved", code: "EACCES" },
  subprocessRefused: { status: "proved", code: "EACCES" },
  runtimeReExecRefused: { status: "proved", code: "namespace-locked" },
});

describe("the battery driver", () => {
  it("binds selected preset tools into the offered tool-interface identity", () => {
    const slugDir = join(SCRATCH_ROOT, "preset-condition");
    writeSlug(slugDir);
    const specFile = join(slugDir, "agent/tools-spec.json");
    const base = {
      presets: [],
      declined: { files: "fixture without a shell" },
      tools: [
        {
          name: "write_domain",
          kind: "artifact-writer",
          description: "Prepare the domain answer.",
        },
      ],
    };
    writeFileSync(specFile, JSON.stringify(base));
    const withoutPreset = batteryCondition(slugDir).toolInterfaceHash;
    writeFileSync(specFile, JSON.stringify({ ...base, presets: ["public-data"] }));
    const withPreset = batteryCondition(slugDir).toolInterfaceHash;
    expect(withoutPreset).toMatch(/^[0-9a-f]{64}$/);
    expect(withPreset).toMatch(/^[0-9a-f]{64}$/);
    expect(withPreset).not.toBe(withoutPreset);
  });

  it("records one case row per task with checked evidence pointers and separate outcome counts", async () => {
    const slugDir = join(SCRATCH_ROOT, "drive");
    writeSlug(slugDir);
    const recordPath = join(SCRATCH_ROOT, "cases-drive.jsonl");
    const { summary } = await driveBattery({
      slug: "matching",
      slugDir,
      runId: "run-drive-1",
      builderId: "ana-run-driver-test",
      recordPath,
      verification: {
        solver: boundarySolver(scriptedSolver(new Set(["t2"]))),
        backendPin: SCRIPTED_NONE,
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: ["web-search:off"],
      },
      isolation: null,
      tasks: TASKS,
    });
    expect(summary).toMatchObject({
      runId: "run-drive-1",
      total: 4,
      verified: 4,
      unaccepted: 0,
      nonResults: 0,
      passed: 3,
    });
    expect(summary.passRate).toBeCloseTo(0.75);
    expect(summary.discrimination).toBe("informative");
    const rows = readCaseRecord(recordPath).map((entry) => entry.row);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.builderId).toBe("ana-run-driver-test");
      expect(row.isolation).toBeNull();
      expect(row.buildInputsHash).toMatch(/^[0-9a-f]{16,}$/);
      // Recompute each pointer digest against the recorded bytes immediately after the run.
      const verdicts = verifyTracePointers(row, slugDir);
      expect(verdicts.length).toBeGreaterThan(0);
      expect(verdicts.every((v) => v.state === "intact")).toBe(true);
      // The solver disclosed a runtime boundary, so the row must point at the recorded evidence
      // that carries the exact solve condition for this case.
      expect(row.traces.map((pointer) => pointer.path)).toContain(
        `runs/run-drive-1/cases/${row.taskId}/built-runtime.json`,
      );
      // Each case row includes the solver start and end times, so duration comparisons
      // across runs do not need to open each battery.json.
      expect(isString(row.solverStartedAt)).toBe(true);
      expect(isString(row.solverEndedAt)).toBe(true);
    }
    const flubbed = rows.find((row) => row.taskId === "t2");
    expect(flubbed).toMatchObject({
      acceptedSubmit: true,
      truthOk: false,
      pass: false,
      runtimeNonResult: null,
    });
  }, 120_000);

  it("summarizes each run of one shared record separately and refuses a duplicated run id", async () => {
    const slugDir = join(SCRATCH_ROOT, "delta");
    writeSlug(slugDir);
    const recordPath = join(SCRATCH_ROOT, "cases-delta.jsonl");
    const base = {
      slug: "matching",
      slugDir,
      builderId: "ana-run-driver-test",
      recordPath,
      isolation: null,
      tasks: TASKS,
    } as const;
    await driveBattery({
      ...base,
      runId: "run-all-fail",
      verification: {
        solver: scriptedSolver(new Set(TASKS.map((t) => t.taskId))),
        backendPin: SCRIPTED_NONE,
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: [],
      },
    });
    await driveBattery({
      ...base,
      runId: "run-all-pass",
      verification: {
        solver: scriptedSolver(),
        backendPin: SCRIPTED_NONE,
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: [],
      },
    });
    // One record holds both runs; each run id summarizes only its own rows.
    const shared = readCaseRecord(recordPath).map((entry) => entry.row);
    const failing = summarizeRun("run-all-fail", shared);
    const passing = summarizeRun("run-all-pass", shared);
    expect(failing.passRate).toBe(0);
    expect(passing.passRate).toBe(1);
    // Uniform results receive explicit all-fail or all-pass labels. Those labels describe
    // the observed battery; they do not by themselves establish a defect or a limit.
    expect(failing.discrimination).toBe("all-fail");
    expect(passing.discrimination).toBe("all-pass");
    // Same runId again would rewrite the run directory and duplicate rows the append-only record
    // could never drop: refused before the battery runs, with the record and its pointers intact.
    const before = readFileSync(join(slugDir, "runs/run-all-pass/battery.json"), "utf8");
    await expect(
      driveBattery({
        ...base,
        runId: "run-all-pass",
        verification: {
          solver: scriptedSolver(new Set(TASKS.map((t) => t.taskId))),
          backendPin: SCRIPTED_NONE,
          condition: SCRIPTED_CONDITION,
          thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
          capabilities: [],
        },
      }),
    ).rejects.toThrow(/already holds rows/);
    expect(readCaseRecord(recordPath)).toHaveLength(shared.length);
    expect(readFileSync(join(slugDir, "runs/run-all-pass/battery.json"), "utf8")).toBe(before);
  }, 120_000);

  /** Two passes, one verified failure (t2) and one typed provider non-result (t2b). */
  const mixedSolver: Solver = (task, toolset, submitted) =>
    task.taskId === "t2b"
      ? Promise.resolve(nonResultOutcome({ kind: "provider", message: "WebSocket closed 1006" }))
      : scriptedSolver(new Set(["t2"]))(task, toolset, submitted);

  it("appends the published verdicts when the Judge phase throws after publication, once", async () => {
    // Astra 0912 i19: 25 verdicts published, the Judge turn exhausted the provider budget, the
    // throw skipped the append and the evidence reader refused the whole run over a record
    // with zero rows. The record must hold the published rows and the original error must
    // reach the caller unchanged.
    const slugDir = join(SCRATCH_ROOT, "unwind");
    writeSlug(slugDir);
    const recordPath = join(SCRATCH_ROOT, "cases-unwind.jsonl");
    const exhausted: JudgeSession = {
      pin: "codex/exhausted-judge",
      invoke: async () => {
        throw new ProviderResourceBudgetExhausted("review", 3, 3);
      },
    };
    const drive = (): Promise<DriveBatteryResult> =>
      driveBattery({
        slug: "matching",
        slugDir,
        runId: "run-unwind-1",
        builderId: "ana-run-driver-test",
        recordPath,
        verification: {
          solver: mixedSolver,
          backendPin: SCRIPTED_NONE,
          condition: SCRIPTED_CONDITION,
          thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
          capabilities: [],
          judge: exhausted,
        },
        isolation: null,
        tasks: TASKS,
      });
    await expect(drive()).rejects.toBeInstanceOf(ProviderResourceBudgetExhausted);
    const rows = readCaseRecord(recordPath).map((entry) => entry.row);
    expect(rows).toHaveLength(4);
    // Every published kind reaches the record: two passes, one verified failure, one provider non-result.
    expect(summarizeRun("run-unwind-1", rows)).toMatchObject({ verified: 3, passed: 2, nonResults: 1 });
    expect(rows.find((row) => row.taskId === "t2b")).toMatchObject({
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "provider",
    });
    // The recorded run id is refused before the battery could run again, so the rows' digest
    // pointers still name the published bytes.
    await expect(drive()).rejects.toThrow(/already holds rows/);
    expect(readCaseRecord(recordPath)).toHaveLength(4);
    for (const row of rows) {
      expect(verifyTracePointers(row, slugDir).every((verdict) => verdict.state === "intact")).toBe(true);
    }
  }, 120_000);

  it("keeps the runner's failure and the record's when the unwind append fails", async () => {
    const slugDir = join(SCRATCH_ROOT, "unwind-held");
    writeSlug(slugDir);
    const recordPath = join(SCRATCH_ROOT, "cases-unwind-held.jsonl");
    const exhausted: JudgeSession = {
      pin: "codex/exhausted-judge",
      invoke: async () => {
        throw new ProviderResourceBudgetExhausted("review", 3, 3);
      },
    };
    const drive = (): Promise<DriveBatteryResult> =>
      driveBattery({
        slug: "matching",
        slugDir,
        runId: "run-unwind-held-1",
        builderId: "ana-run-driver-test",
        recordPath,
        verification: {
          solver: mixedSolver,
          backendPin: SCRIPTED_NONE,
          condition: SCRIPTED_CONDITION,
          thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
          capabilities: [],
          judge: exhausted,
        },
        isolation: null,
        tasks: TASKS,
      });
    // Another writer holds the record, so the unwind cannot append; neither failure may hide the other.
    const held = CaseRecordStore.open(recordPath);
    try {
      const failure = await drive().catch((cause: unknown) => cause);
      if (!(failure instanceof AggregateError)) {
        throw new Error(`expected both failures, got ${String(failure)}`);
      }
      expect(failure.errors[0]).toBeInstanceOf(ProviderResourceBudgetExhausted);
      expect(String(failure.errors[1])).toMatch(/ONE writer/);
    } finally {
      await held.close();
    }
    expect(readCaseRecord(recordPath)).toHaveLength(0);
    // With the record released, the same unwind records the published rows.
    await expect(drive()).rejects.toBeInstanceOf(ProviderResourceBudgetExhausted);
    expect(readCaseRecord(recordPath)).toHaveLength(4);
  }, 120_000);

  it("appends nothing when the runner throws before it published a record", async () => {
    const slugDir = join(SCRATCH_ROOT, "unpublished");
    writeSlug(slugDir);
    const recordPath = join(SCRATCH_ROOT, "cases-unpublished.jsonl");
    await expect(
      driveBattery({
        slug: "matching",
        slugDir,
        runId: "run-unpublished-1",
        builderId: "ana-run-driver-test",
        recordPath,
        verification: {
          solver: scriptedSolver(),
          backendPin: SCRIPTED_NONE,
          condition: SCRIPTED_CONDITION,
          thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
          capabilities: [],
        },
        isolation: null,
        tasks: [{ ...TASKS[0]!, taskId: "../escape" }],
      }),
    ).rejects.toThrow();
    expect(existsSync(recordPath)).toBe(false);
  }, 120_000);

  it("reads battery rows only from the recorded, correctly labelled bytes", async () => {
    const slugDir = join(SCRATCH_ROOT, "tamper");
    writeSlug(slugDir);
    await driveBattery({
      slug: "matching",
      slugDir,
      runId: "run-tamper-1",
      builderId: "ana-run-driver-test",
      recordPath: join(SCRATCH_ROOT, "cases-tamper.jsonl"),
      verification: {
        solver: scriptedSolver(),
        backendPin: SCRIPTED_NONE,
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: [],
      },
      isolation: null,
      tasks: TASKS,
    });
    const runDir = join(slugDir, "runs/run-tamper-1");
    expect(() => readRecordedBatteryRecord(runDir, "run-relabeled")).toThrow(/does not bind runId/);

    const batteryFile = join(runDir, "battery.json");
    // SAFETY: this test created the recorded fixture through driveBattery immediately above.
    const battery = JSON.parse(readFileSync(batteryFile, "utf8")) as { cases: { pass: boolean }[] };
    battery.cases[0]!.pass = !battery.cases[0]!.pass;
    writeFileSync(batteryFile, JSON.stringify(battery));
    expect(() => readRecordedBatteryRecord(runDir, "run-tamper-1")).toThrow(/tampered|changed|ownership/);
  }, 120_000);
});

describe("the censored discrimination flag", () => {
  it("reads no-signal when nothing was scored — never a 0/N claim from non-results alone", () => {
    const summary = summarizeRun("run-empty", []);
    expect(summary.passRate).toBeNull();
    expect(summary.discrimination).toBe("no-signal");
  });
});

// Absorbed from test/battery-run-evidence.test.ts
// ---------------------------------------------------------------------------

const cases = [
  { taskId: "pass", runtimeNonResult: null, runtimeNonResultKind: null },
  { taskId: "fail", runtimeNonResult: null, runtimeNonResultKind: null },
  { taskId: "blocked", runtimeNonResult: "provider unavailable", runtimeNonResultKind: "solver" as const },
  { taskId: "timeout", runtimeNonResult: "verifier timeout", runtimeNonResultKind: "timeout" as const },
  {
    taskId: "tool",
    runtimeNonResult: "declared tool could not be read",
    runtimeNonResultKind: "verifierUnavailable" as const,
  },
];

function claimBattery(
  corpus: ControlCorpus,
  controlReceipts: ControlReceipt[],
  aggregates: Partial<
    Pick<
      BatteryRecord["discrimination"],
      "acceptsPassed" | "rejectsFailed" | "rejectsAttributed" | "attributedCheckIds"
    >
  >,
): BatteryRecord {
  return double<BatteryRecord>({
    terminalReason: "complete",
    capabilities: [],
    buildInputsHash: "h1",
    cases: [],
    discrimination: {
      accepts: corpus.accept.length,
      rejects: corpus.reject.length,
      acceptsPassed: 0,
      rejectsFailed: 0,
      rejectsAttributed: 0,
      attributedCheckIds: {},
      claimable: true,
      findings: [],
      controlReceipts,
      ...aggregates,
    },
    backendPin: SCRIPTED_NONE,
    thresholdManifestDigest: "f".repeat(64),
    truthCheckFiring: NO_FIRING,
    judge: { judge: "off" },
    execution: double<BatteryRecord["execution"]>({}),
    executionEvidence: [],
  });
}

function receipt(
  controlId: string,
  taskId: string,
  kind: "accept" | "reject",
  expectedCheckId: string | null,
): ControlReceipt {
  const fail = kind === "reject";
  return {
    schema: "control-receipt/v2",
    controlId,
    taskId,
    kind,
    expectedOutcome: fail ? "fail" : "pass",
    expectedCheckId,
    observedOutcome: fail ? "fail" : "pass",
    observedBlockingCheckIds: fail ? [expectedCheckId ?? "check"] : [],
    nonResultKind: null,
  };
}

describe("battery run evidence", () => {
  it("projects the claim denominator and one build identity directly from battery cases", () => {
    expect(batteryRunEvidence(cases, "h1", "complete")).toEqual({
      runStatus: {
        state: "terminal",
        reason: "complete",
        verified: 2,
        nonResults: { solver: 1, timeout: 1, verifierUnavailable: 1 },
      },
      staleness: { stale: false, hashes: ["h1"] },
    });
  });

  it("refuses a diagnostic reason without its machine classification", () => {
    expect(() =>
      batteryRunEvidence(
        [{ taskId: "bad", runtimeNonResult: "blocked", runtimeNonResultKind: null }],
        "h1",
        "complete",
      ),
    ).toThrow(/mismatched non-result evidence/);
  });

  it("keeps predictions outside product evidence while projecting accepted and unaccepted cases", () => {
    const battery = double<BatteryRecord>({
      terminalReason: "complete",
      capabilities: [],
      buildInputsHash: "h1",
      cases: [
        {
          taskId: "verified",
          acceptedSubmit: true,
          truthOk: false,
          pass: false,
          runtimeNonResult: null,
          runtimeNonResultKind: null,
          solver: { turns: 1, completedTurns: 1, runtimeIdentities: [] },
        },
        {
          taskId: "unaccepted",
          acceptedSubmit: false,
          truthOk: null,
          pass: false,
          runtimeNonResult: null,
          runtimeNonResultKind: null,
          solver: { turns: 1, completedTurns: 1, runtimeIdentities: [] },
        },
        {
          taskId: "missing",
          acceptedSubmit: false,
          truthOk: null,
          pass: null,
          runtimeNonResult: "provider unavailable",
          runtimeNonResultKind: "solver",
        },
      ],
      discrimination: { claimable: true, findings: [], attributedCheckIds: {}, controlReceipts: [] },
      backendPin: SCRIPTED_NONE,
      thresholdManifestDigest: "f".repeat(64),
      truthCheckFiring: NO_FIRING,
      judge: { judge: "off" },
      execution: double<BatteryRecord["execution"]>({}),
    });
    const projected = batteryClaimInput(
      battery,
      new Map([
        ["verified", ["compile"]],
        ["unaccepted", ["compile"]],
      ]),
      { accept: [], reject: [] },
    );
    expect(projected.evidence.predictions).toBeNull();
    expect(projected.score).toEqual([
      { caseId: "verified", passed: false, truthVerified: true, checkIds: ["compile"] },
      { caseId: "unaccepted", passed: false, truthVerified: false, checkIds: ["compile"] },
    ]);
  });

  it("revalidates recorded receipts and derives claim attribution instead of trusting aggregates", () => {
    const corpus: ControlCorpus = {
      accept: [{ id: "a", taskId: "task", artifact: {} }],
      reject: [
        { id: "r", taskId: "task", artifact: {}, mutationClass: "wrong", expectedCheckId: "intrinsic" },
      ],
    };
    const receipts = [receipt("a", "task", "accept", null), receipt("r", "task", "reject", "intrinsic")];
    const context = corpus;
    const green = batteryClaimInput(
      claimBattery(corpus, receipts, {
        acceptsPassed: 1,
        rejectsFailed: 1,
        rejectsAttributed: 1,
        attributedCheckIds: { intrinsic: 1 },
      }),
      new Map(),
      context,
    );
    expect(green.evidence.discrimination).toMatchObject({
      claimable: true,
      attributedCheckIds: { intrinsic: 1 },
    });

    const omitted = batteryClaimInput(
      claimBattery(corpus, [receipts[0]!], {
        acceptsPassed: 1,
        rejectsFailed: 1,
        rejectsAttributed: 1,
        attributedCheckIds: { intrinsic: 1 },
      }),
      new Map(),
      context,
    );
    expect(omitted.evidence.discrimination).toMatchObject({ claimable: false });
    expect(omitted.evidence.discrimination.findings.map((finding) => finding.code)).toContain(
      "DISCRIMINATION_CONTROL_RECEIPT_INVALID",
    );

    const legacy = claimBattery(corpus, receipts, {
      acceptsPassed: 1,
      rejectsFailed: 1,
      rejectsAttributed: 1,
      attributedCheckIds: { intrinsic: 1 },
    });
    // SAFETY: This fixture deliberately models a legacy saved row that predates controlReceipts.
    delete (legacy.discrimination as { controlReceipts?: unknown }).controlReceipts;
    const legacyProjection = batteryClaimInput(legacy, new Map(), context);
    expect(legacyProjection.evidence.discrimination).toMatchObject({ claimable: false });
    expect(legacyProjection.evidence.discrimination.findings).toContainEqual(
      expect.objectContaining({
        code: "DISCRIMINATION_CONTROL_RECEIPT_INVALID",
        message: expect.stringContaining("saved control receipts are missing"),
      }),
    );

    const duplicate = batteryClaimInput(
      claimBattery(corpus, [...receipts, receipts[1]!], {
        acceptsPassed: 1,
        rejectsFailed: 1,
        rejectsAttributed: 1,
        attributedCheckIds: { intrinsic: 1 },
      }),
      new Map(),
      context,
    );
    expect(duplicate.evidence.discrimination.claimable).toBe(false);

    const mismatched = batteryClaimInput(
      claimBattery(corpus, receipts, {
        acceptsPassed: 1,
        rejectsFailed: 1,
        rejectsAttributed: 0,
        attributedCheckIds: {},
      }),
      new Map(),
      context,
    );
    expect(mismatched.evidence.discrimination.claimable).toBe(false);
    expect(mismatched.evidence.discrimination.findings.map((finding) => finding.code)).toContain(
      "DISCRIMINATION_CONTROL_RECEIPT_INVALID",
    );
  });

  it("attributes a reject to its named check from the control receipt", () => {
    // The receipt no longer copies which tool ran: the host's own evidence rows carry that under
    // the control's subjectId, and grounding-coverage.ts reads them there. What the receipt still
    // establishes is the isolated control failure: this reject failed only the check it names.
    // This fixture does not prove that an external tool executed.
    const corpus: ControlCorpus = {
      accept: [{ id: "a", taskId: "task", artifact: {} }],
      reject: [
        {
          id: "external-reject",
          taskId: "task",
          artifact: {},
          mutationClass: "wrong",
          expectedCheckId: "external",
        },
      ],
    };
    const receipts = [
      receipt("a", "task", "accept", null),
      receipt("external-reject", "task", "reject", "external"),
    ];
    const projected = batteryClaimInput(
      claimBattery(corpus, receipts, {
        acceptsPassed: 1,
        rejectsFailed: 1,
        rejectsAttributed: 1,
        attributedCheckIds: { external: 1 },
      }),
      new Map(),
      corpus,
    );
    expect(projected.evidence.discrimination).toMatchObject({
      claimable: true,
      attributedCheckIds: { external: 1 },
    });
  });
});

describe("battery disposition", () => {
  it("separates a battery refused before any case from one that ran an empty task set", () => {
    // Both record zero rows, and reading the row count cannot tell them apart — which is the
    // inference the field replaces. Only the caller knows whether scheduling happened.
    expect(batteryDisposition("skipped", [])).toBe("skipped-precase");
    expect(batteryDisposition("scheduled", [])).toBe("completed");
  });

  it("names a battery the provider-stop rule cut short", () => {
    // opus-331 recorded terminalReason "complete" for exactly this variant and paired it against
    // one that had run all 25 tasks.
    const rows = [
      { runtimeNonResult: null },
      { runtimeNonResult: "provider error 429" },
      {
        runtimeNonResult: `${NEVER_ATTEMPTED_PREFIX} after 5 consecutive provider non-results (last attempted task "t2")`,
      },
    ];
    expect(batteryDisposition("scheduled", rows)).toBe("provider-stopped");
    expect(batteryDisposition("scheduled", rows.slice(0, 2))).toBe("completed");
  });

  it("records an all-non-result battery as all-non-results instead of complete", () => {
    // opus326 recorded five batteries whose every case was a typed non-result with terminalReason
    // "complete"; the shape lived only in a diagnostic safeguard line until 2026-09-01.
    const dead = [
      { runtimeNonResult: "provider error 429", solver: NO_CALL },
      { runtimeNonResult: "spawn timeout", solver: NO_CALL },
    ];
    expect(batteryTerminalReason("completed", dead)).toBe(
      "all-non-results: none of the 2 cases produced a result",
    );
    // One produced result whose solver started a tool call keeps the battery complete.
    expect(
      batteryTerminalReason("completed", [
        ...dead,
        { runtimeNonResult: null, solver: { startedToolCalls: 1 } },
      ]),
    ).toBe("complete");
    // The two shapes that lived only in diagnostic safeguard lines until 2026-09-02: a completed
    // record with no case row, and one where no case started a tool call.
    expect(batteryTerminalReason("completed", [])).toBe("no-cases: the battery recorded no case row");
    expect(
      batteryTerminalReason("completed", [
        { runtimeNonResult: null, solver: { startedToolCalls: 0 } },
        { runtimeNonResult: null, solver: { startedToolCalls: null } },
      ]),
    ).toBe("no-tool-calls: none of the 2 cases started a tool call");
    expect(batteryTerminalReason("skipped-precase", dead)).toBe(
      "battery skipped: discrimination not claimable",
    );
    expect(
      batteryTerminalReason("provider-stopped", [
        {
          runtimeNonResult: `${NEVER_ATTEMPTED_PREFIX} after 5 consecutive provider non-results`,
          solver: NO_CALL,
        },
        { runtimeNonResult: "provider error 429", solver: NO_CALL },
      ]),
    ).toBe("provider-stopped: 1 of 2 cases were never attempted");
  });
});
