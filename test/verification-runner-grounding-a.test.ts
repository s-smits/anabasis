// External-verifier grounding (C3), first half: what becomes of a case when the instrument that
// decides it is an installed tool rather than authored code. A tool run during the battery writes
// its execution evidence onto both the battery and the report, and everything after that is about
// the ways such a run can fail without the case quietly turning into a pass. An authored
// non-Boolean result is rejected as a generated verifier exception before a fabricated aggregate
// can escape; an environment-owned tool failure is retried once and then settled as its own
// non-result receipt, while an author-repairable one is settled at once with no second attempt;
// and a host non-result outranks a correctness model that swallowed it and returned a verdict
// anyway.
//
// Split from verification-runner.test.ts so that each file finishes within about half a minute
// under four concurrent tests.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { makeVerify } from "../src/truth/verification-runner.ts";
import type { ControlReceipt } from "../src/truth/battery-record.ts";
import {
  ACCEPTS,
  EVALUATOR_SOURCE,
  REJECTS,
  TASKS,
  TOOLS_SOURCE,
  fingerprintOf,
  matchingBattery,
  removeScratchRoot,
  scratch,
  scriptedSolver,
  SCRIPTED_CONDITION,
  SCRIPTED_THRESHOLD_DIGEST,
} from "./helpers/verification-runner-fixtures.ts";
import {
  GAMMA_HANGS_TOOL_SCRIPT,
  HANGING_TOOL_SCRIPT,
  SHORT_WALL_EVALUATOR_SOURCE,
  TOOL_ID,
  TOOL_REJECTS,
  TOOL_SCRIPT,
  VERIFIER_EVALUATOR_SOURCE,
  externalSlug,
  installTool,
  markedTasks,
  unreadableToolHost,
} from "./helpers/verification-runner-external.ts";

afterAll(removeScratchRoot);

describe("makeVerify external-verifier grounding (C3)", () => {
  it.concurrent("tool runs during the battery write execution evidence on battery and report", async () => {
    const slugDir = externalSlug(VERIFIER_EVALUATOR_SOURCE);
    installTool(slugDir, TOOL_SCRIPT);
    const evaluate = makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-c3-grounding",
    });
    const report = await evaluate(matchingBattery(slugDir));
    // Discrimination is verified through the SAME tool-backed verifier, and stays claimable.
    expect(report.evidence.discrimination.claimable).toBe(true);
    expect(report.score).toEqual([
      {
        caseId: "t1",
        passed: true,
        truthVerified: true,
        checkIds: ["expected-binding", "ghost-ref", "parts-assigned"],
      },
      {
        caseId: "t2",
        passed: true,
        truthVerified: true,
        checkIds: ["expected-binding", "ghost-ref", "parts-assigned"],
      },
      {
        caseId: "t3",
        passed: true,
        truthVerified: true,
        checkIds: ["expected-binding", "ghost-ref", "parts-assigned"],
      },
    ]);
    // Bindings are subject-bound: every control and every case that ran the tool has its OWN
    // entry, so one run cannot ground the whole run. The host orders rows by phase, subject and
    // attempt whatever the census lane timing, so the comparison is exact.
    // A reject runs only its declared check, so only the rejects naming ghost-ref launch its tool.
    const bySubject = (a: { phase: string; subjectId: string }, b: { phase: string; subjectId: string }) =>
      (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : 0) ||
      (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0);
    expect(report.execution.executed).toEqual(
      ["a1", "r-tool", "r-tool-two-part", "t1", "t2", "t3"]
        .map((subjectId) => ({
          phase: ["t1", "t2", "t3"].includes(subjectId) ? ("battery" as const) : ("discrimination" as const),
          subjectId,
          attempt: 1,
          checkId: "ghost-ref",
          adapterId: TOOL_ID,
        }))
        .sort(bySubject),
    );
    const battery = JSON.parse(readFileSync(join(slugDir, "runs/run-c3-grounding/battery.json"), "utf8"));
    expect(battery.execution).toEqual(report.execution);
    expect(battery.discrimination.controlReceipts).toHaveLength(
      ACCEPTS.length + REJECTS.length + TOOL_REJECTS.length,
    );
    expect(
      battery.discrimination.controlReceipts.every((receipt: ControlReceipt) => !("hidden" in receipt)),
    ).toBe(true);
    // The executed tool's digest is recorded — a compiler upgrade between runs
    // changes the comparison identity — and the evidence says the Builder's own tree supplied it.
    expect(battery.execution.verifierEnvironmentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(battery.execution.tools[TOOL_ID].digest).toMatch(/^[0-9a-f]{64}$/);
    expect(battery.execution.tools[TOOL_ID].source).toBe("workspace-toolchain");
    expect(battery.execution.tools[TOOL_ID]).toMatchObject({ kind: "script", interpreter: "sh" });
    // The firing ledger reads the host's rows for the external check and the verdicts for every
    // check: three verified cases ran the tool, none was blocked, and the control runs do not
    // count.
    expect(battery.truthCheckFiring).toMatchObject({
      verifierVerifiedCount: 3,
      // Every declared check, the external one included: all three cases posed `ghost-ref`.
      applicableByCheck: { "parts-assigned": 3, "expected-binding": 3, "ghost-ref": 3 },
      executedByCheck: { "ghost-ref": 3 },
      blockingByCheck: { "parts-assigned": 0, "expected-binding": 0, "ghost-ref": 0 },
    });
    // The durable per-run record: controls + tasks all verified through the tool, every row
    // check-bound with digests, a host-derived executable digest, a real OS wall, and the
    // host-provided subject join key — list order is never the join.
    expect(battery.executionEvidence.length).toBeGreaterThan(0);
    for (const r of battery.executionEvidence) {
      expect(r.toolId).toBe(TOOL_ID);
      expect(r.checkId).toBe("ghost-ref");
      expect(r.outcome).toBe("executed");
      expect(r.exitCode).toBe(r.subjectId.startsWith("r-tool") ? 3 : 0);
      expect(r.requestDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(r.toolDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(r.filesDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(["darwin-seatbelt/v1", "linux-bwrap/v1"]).toContain(r.sandbox);
      expect(r.sandboxPolicyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.runId).toBe("run-c3-grounding");
      expect(r.artifactDigest).toMatch(/^[0-9a-f]{64}$/);
      // Controls evaluate task-bound through the one request shape, so their rows carry the
      // bound task's digest exactly like battery cases.
      expect(r.publicTaskDigest).toMatch(/^[0-9a-f]{64}$/);
      if (r.phase === "battery") expect(["t1", "t2", "t3"]).toContain(r.subjectId);
      else {
        expect(r.phase).toBe("discrimination");
        expect([
          "a1",
          "r-alias",
          "r-ghost",
          "r-wrongbind",
          "r-alias-two-part",
          "r-wrongbind-two-part",
          "r-tool",
          "r-tool-two-part",
        ]).toContain(r.subjectId);
      }
    }
    // Canonical-artifact binding: the row digests the bytes the RUNNER bound, so a check cannot
    // be scored against a value its author routed to the tool instead.
    const a1 = battery.executionEvidence.find((r: { subjectId: string }) => r.subjectId === "a1");
    expect(a1.artifactDigest).toBe(
      new Bun.CryptoHasher("sha256").update(JSON.stringify(ACCEPTS[0]?.artifact)).digest("hex"),
    );
  }, 60_000);

  it.concurrent("a task-time authored non-Boolean result is rejected as a generated verifier exception", async () => {
    const UNBACKED_TASK_NONRESULT_SOURCE = EVALUATOR_SOURCE.replace(
      "const rows = artifact.assignments;",
      `if (Array.isArray(artifact?.assignments) && artifact.assignments.some((row) => row?.part === "gamma")) {
    return { ok: false, issues: [], resultKind: "runtimeNonResult", nonResultKind: "verifierUnavailable" };
  }
  const rows = artifact.assignments;`,
    );
    const slugDir = scratch();
    mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), UNBACKED_TASK_NONRESULT_SOURCE);
    writeFileSync(join(slugDir, "agent/tools.ts"), TOOLS_SOURCE);
    writeFileSync(
      join(slugDir, "correctness-model/controls.json"),
      JSON.stringify({ accept: ACCEPTS, reject: REJECTS }),
    );
    const evaluate = makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-c3-unbacked-nonresult",
    });
    const report = await evaluate(matchingBattery(slugDir));
    expect(report.score.map((row) => row.caseId)).toEqual(["t1", "t2"]);
    expect(report.evidence.discrimination.claimable).toBe(true);
    const battery = JSON.parse(
      readFileSync(join(slugDir, "runs/run-c3-unbacked-nonresult/battery.json"), "utf8"),
    );
    expect(battery.cases.find((row: { taskId: string }) => row.taskId === "t3")).toMatchObject({
      runtimeNonResultKind: "verifier-throw",
      pass: null,
    });
    expect(battery.executionEvidence.filter((row: { subjectId: string }) => row.subjectId === "t3")).toEqual(
      [],
    );
  }, 60_000);

  it.concurrent("rejects every authored non-Boolean task result before a fabricated aggregate can escape", async () => {
    const ALL_TASKS_UNBACKED_SOURCE = EVALUATOR_SOURCE.replace(
      "const rows = artifact.assignments;",
      // Accept a1 is byte-identical to t1's solution (accepts evaluate under the task's own hidden
      // rows), so the flubbed t1 submission plus t2/t3's s4/s5 slots are the battery-only markers
      // that keep calibration healthy while every measured task is unbacked.
      `if (Array.isArray(artifact?.assignments) && artifact.assignments.some((row) => row?.slot === "s4" || row?.slot === "s5" || row?.slot === "flub-wrong-slot")) {
    return { ok: false, issues: [], resultKind: "runtimeNonResult", nonResultKind: "verifierUnavailable" };
  }
  const rows = artifact.assignments;`,
    );
    const slugDir = scratch();
    mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), ALL_TASKS_UNBACKED_SOURCE);
    writeFileSync(join(slugDir, "agent/tools.ts"), TOOLS_SOURCE);
    writeFileSync(
      join(slugDir, "correctness-model/controls.json"),
      JSON.stringify({ accept: ACCEPTS, reject: REJECTS }),
    );
    const runId = "run-c3-all-unbacked-nonresult";
    // Flub t1 so its accepted submission carries the distinctive flub slot instead of matching
    // accept a1 byte for byte; the non-result fires before verification, so the flub never scores.
    const report = await makeVerify({
      solver: scriptedSolver(new Set(["t1"])),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId,
    })(matchingBattery(slugDir));
    expect(report.score).toEqual([]);
    expect(report.evidence.discrimination.claimable).toBe(true);
    const battery = JSON.parse(readFileSync(join(slugDir, "runs", runId, "battery.json"), "utf8"));
    expect(battery.cases).toHaveLength(TASKS.tasks.length);
    expect(
      battery.cases.every(
        (row: { runtimeNonResultKind: string }) => row.runtimeNonResultKind === "verifier-throw",
      ),
    ).toBe(true);
  }, 60_000);

  it.concurrent("retries one control once for an environment-owned tool failure, then settles it as its own non-result receipt", async () => {
    // One control the host cannot run to a verdict used to stop the whole corpus. Each such
    // control now gets its own non-result receipt; the remaining controls run, and the coverage
    // result decides whether solving starts.
    const slugDir = externalSlug(VERIFIER_EVALUATOR_SOURCE);
    const runId = "run-control-host-refusal";
    const report = await makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId,
      createVerifier: unreadableToolHost,
      toolRetryWaitMs: 0,
    })(matchingBattery(slugDir));
    const runDir = join(slugDir, "runs", runId);
    const battery = JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8"));
    expect(existsSync(join(runDir, "verifier-non-result.json"))).toBe(false);
    const a1 = battery.discrimination.controlReceipts.find(
      (receipt: { controlId: string }) => receipt.controlId === "a1",
    );
    expect(a1).toMatchObject({ observedOutcome: "non-result", nonResultKind: "verifierUnavailable" });
    // The vanished tool refuses every control that runs it, each on its own receipt with the host's
    // kind; the open cells block the claim through the ordinary coverage floor, and the runner
    // stops before solver spend as for any corpus that leaves a cell open.
    const nonResults: Array<{ nonResultKind: string }> = battery.discrimination.controlReceipts.filter(
      (receipt: { observedOutcome: string }) => receipt.observedOutcome === "non-result",
    );
    expect(nonResults.length).toBeGreaterThan(1);
    expect(new Set(nonResults.map((receipt) => receipt.nonResultKind))).toEqual(
      new Set(["verifierUnavailable"]),
    );
    expect(report.evidence.discrimination.findings.map((finding) => finding.code)).not.toContain(
      "DISCRIMINATION_NOT_PROVEN",
    );
    expect(battery.cases).toEqual([]);
    // One fresh execution on the first control, and no third.
    const refusals: Array<{ attempt: number; subjectId: string }> = battery.executionEvidence.filter(
      (row: { phase: string; outcome: string; subjectId: string }) =>
        row.phase === "discrimination" && row.outcome === "verifierUnavailable" && row.subjectId === "a1",
    );
    expect(refusals.map((row) => row.attempt)).toEqual([1, 2]);
  }, 60_000);

  it.concurrent("settles an author-repairable tool failure at once, without a second attempt", async () => {
    // This exercises the no-retry classification for a tool timeout. The fixture tool loops
    // forever, so retrying it with the same input would not help. The timeout remains a typed
    // non-result on the control, and the author can change the tool or its use.
    const slugDir = externalSlug(SHORT_WALL_EVALUATOR_SOURCE);
    installTool(slugDir, HANGING_TOOL_SCRIPT);
    const runId = "run-control-tool-timeout";
    const report = await makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId,
    })(matchingBattery(slugDir));
    const runDir = join(slugDir, "runs", runId);
    expect(existsSync(join(runDir, "verifier-non-result.json"))).toBe(false);
    const battery = JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8"));
    const a1 = battery.discrimination.controlReceipts.find(
      (receipt: { controlId: string }) => receipt.controlId === "a1",
    );
    expect(a1).toMatchObject({ observedOutcome: "non-result", nonResultKind: "timeout" });
    expect(report.evidence.discrimination.claimable).toBe(false);
    expect(
      battery.executionEvidence.filter(
        (row: { outcome: string; subjectId: string }) => row.outcome === "timeout" && row.subjectId === "a1",
      ),
    ).toHaveLength(1);
  }, 60_000);

  it.concurrent("records a task non-result from matching host evidence and retains it outside the verified denominator", async () => {
    // Only t3's artifact contains "gamma", so the controls and t1/t2 complete and the battery keeps
    // two verified cases beside one measured outage. The relay matches the host's own row, so the
    // case is a typed non-result while discrimination remains claimable.
    // A 400 ms limit on the controls can interrupt calibration under suite load before reaching t3.
    // Keep the short limit on the hanging subject; ordinary subjects retain startup time.
    const slugDir = externalSlug(
      SHORT_WALL_EVALUATOR_SOURCE.replace(
        "timeoutMs: 400",
        'timeoutMs: JSON.stringify(artifact).includes("gamma") ? 400 : 10_000',
      ),
    );
    installTool(slugDir, GAMMA_HANGS_TOOL_SCRIPT);
    const runId = "run-c3-backed-nonresult";
    const report = await makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId,
    })(matchingBattery(slugDir));
    expect(report.evidence.discrimination.claimable).toBe(true);
    expect(report.score.map((row) => row.caseId)).toEqual(["t1", "t2"]);
    const battery = JSON.parse(readFileSync(join(slugDir, "runs", runId, "battery.json"), "utf8"));
    expect(battery.cases.find((row: { taskId: string }) => row.taskId === "t3")).toMatchObject({
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "timeout",
    });
    // t3 is a non-result, so its tool run is not a verified execution of the check.
    expect(battery.truthCheckFiring).toMatchObject({
      verifierVerifiedCount: 2,
      executedByCheck: { "ghost-ref": 2 },
    });
    expect(battery.executionEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId,
          phase: "battery",
          subjectId: "t3",
          attempt: 1,
          outcome: "timeout",
        }),
      ]),
    );
  }, 60_000);

  it.concurrent("a host non-result outranks a Correctness Model evaluator that swallows it and returns a verdict", async () => {
    // The tool hangs for t3 and the check ignores that outcome. The host still records the
    // timeout while the controls and the other two cases complete.
    // The short wall stays on the hanging subject alone: a flat 400 ms times t1 and t2 out under
    // gate load.
    const SWALLOWING_EVALUATOR_SOURCE = SHORT_WALL_EVALUATOR_SOURCE.replace(
      "timeoutMs: 400",
      'timeoutMs: JSON.stringify(artifact).includes("gamma") ? 400 : 10_000',
    ).replace("return run.exitCode === 0;", "return run.nonResult ? true : run.exitCode === 0;");
    const slugDir = externalSlug(SWALLOWING_EVALUATOR_SOURCE);
    installTool(slugDir, GAMMA_HANGS_TOOL_SCRIPT);
    const runId = "run-c3-swallowed-outage";
    const report = await makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId,
    })(matchingBattery(slugDir));
    expect(report.score.map((row) => row.caseId)).toEqual(["t1", "t2"]);
    const battery = JSON.parse(readFileSync(join(slugDir, "runs", runId, "battery.json"), "utf8"));
    expect(battery.cases.find((row: { taskId: string }) => row.taskId === "t3")).toMatchObject({
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "timeout",
    });
    // The evaluator's raw verdict cannot add the timed-out case to any verified check count.
    expect(battery.truthCheckFiring).toMatchObject({
      verifierVerifiedCount: 2,
      applicableByCheck: { "parts-assigned": 2, "expected-binding": 2 },
      firedByCheck: { "parts-assigned": 2, "expected-binding": 2 },
      executedByCheck: { "ghost-ref": 2 },
    });
    expect(battery.executionEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId,
          phase: "battery",
          subjectId: "t3",
          attempt: 1,
          outcome: "timeout",
        }),
      ]),
    );
  }, 60_000);

  it.concurrent("refuses a cell file the author supplied rather than the submission's own bytes", async () => {
    // The shim-header shape the tool port exists to close: a check that compiles the artifact
    // against a header its own author wrote judges it in a compile environment the Builder
    // supplied. `files` must match string leaves or JSON from the declared projections; an extra
    // header is refused before launch, and the evaluator's throw is a product finding on the
    // control it happened to.
    const AUTHORED_CELL_SOURCE = VERIFIER_EVALUATOR_SOURCE.replace(
      '      files: { "artifact.json": JSON.stringify(artifact) },',
      '      files: { "artifact.json": JSON.stringify(artifact), "Arduino.h": "#define OK 1" },',
    );
    const slugDir = externalSlug(AUTHORED_CELL_SOURCE);
    installTool(slugDir, TOOL_SCRIPT);
    const report = await makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-c3-authored-cell",
    })(matchingBattery(slugDir));
    expect(report.evidence.discrimination.claimable).toBe(false);
    expect(report.evidence.discrimination.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DISCRIMINATION_NOT_PROVEN",
          message: expect.stringContaining(
            "is not a string leaf or JSON of the declared artifact/public input",
          ),
        }),
      ]),
    );
    // Nothing ran, so nothing grounds anything — and the paid solver loop never started.
    expect(report.execution.executed).toEqual([]);
    expect(report.score).toEqual([]);
  }, 60_000);

  const SELECTIVE_SKIP_SOURCE = VERIFIER_EVALUATOR_SOURCE.replace(
    "  if (runtime) {",
    '  if (runtime && request.publicTask.taskId !== "t3") {',
  );
  /** One battery whose evaluator never runs the tool for t3; returns the scored ids and t3's row. */
  async function runSelectiveSkip(runId: string, flubTaskIds?: ReadonlySet<string>) {
    const slugDir = externalSlug(SELECTIVE_SKIP_SOURCE, {
      accept: ACCEPTS,
      reject: [...REJECTS, ...TOOL_REJECTS],
    });
    installTool(slugDir, TOOL_SCRIPT);
    const report = await makeVerify({
      solver: scriptedSolver(flubTaskIds),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId,
    })({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks: markedTasks });
    const battery = JSON.parse(readFileSync(join(slugDir, "runs", runId, "battery.json"), "utf8"));
    return {
      scored: report.score.map((row) => row.caseId),
      t3: battery.cases.find((row: { taskId: string }) => row.taskId === "t3"),
    };
  }

  it.concurrent("an applicable externally grounded check the evaluator silently skips grades as a typed non-result, never a verified pass", async () => {
    // The same hole from the other side: the evaluator grades one case by its own arithmetic and
    // never runs the declared tool for it. No execution evidence exists for that case, so the
    // host-side outage read has nothing to find, and coverage itself must fail closed at case
    // time. Only t3 skips the tool, so t1/t2 stay verified.
    //
    // The skip is per case, not wholesale: an evaluator that never runs the tool at all now fails
    // the control census first (no reject can be attributed to the external check), so the
    // remaining case-time hole is exactly this selective one. The corpus carries TOOL_REJECTS to
    // satisfy that census, which is why the conforming evaluator source is the base here.
    const { scored, t3: skipped } = await runSelectiveSkip("run-c3-silent-skip");
    expect(scored).toEqual(["t1", "t2"]);
    expect(skipped).toMatchObject({
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "verifier",
    });
    expect(skipped.runtimeNonResult).toContain('"ghost-ref"');
    expect(skipped.runtimeNonResult).toContain("ran no tool for this case");
  }, 60_000);

  it.concurrent("a case that fails a check with complete evidence grades as a truth fail even when a tool run was skipped", async () => {
    // An answer that fails to compile leaves the downstream tool checks no build to run on, and
    // filing those cases as verifier non-results loses a real fail. A skipped run can only
    // withhold a pass, so the failing authored check decides t3.
    const { scored, t3: failed } = await runSelectiveSkip("run-c3-silent-skip-failed", new Set(["t3"]));
    expect(scored).toEqual(["t1", "t2", "t3"]);
    expect(failed).toMatchObject({ truthOk: false, pass: false });
    expect(failed.runtimeNonResult ?? null).toBeNull();
  }, 60_000);
});
