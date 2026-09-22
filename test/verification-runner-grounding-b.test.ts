// External-verifier grounding (C3), second half. Split from verification-runner.test.ts so
// each file finishes within about half a minute under four concurrent tests.

import { type JsonObject } from "../src/meta/json-shape.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { createTraceRecorder } from "../src/backends/trace-capture.ts";
import { verifyRunDir } from "../src/claim/evidence-log.ts";
import { makeVerify } from "../src/truth/verification-runner.ts";
import { type Solver } from "../src/truth/solve.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { double } from "./helpers/doubles.ts";
import {
  ACCEPTS,
  EVALUATOR_SOURCE,
  REJECTS,
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
  TOOL_REJECT,
  TOOL_REJECTS,
  TOOL_RUN_BLOCK,
  TOOL_SCRIPT,
  VERIFIER_EVALUATOR_SOURCE,
  externalSlug,
  installTool,
  markedTasks,
} from "./helpers/verification-runner-external.ts";

afterAll(removeScratchRoot);

describe("makeVerify external-verifier grounding (C3)", () => {
  it.concurrent("does not let a control with a task's id ground that battery task", async () => {
    const collisionSource = VERIFIER_EVALUATOR_SOURCE.replace(
      "  if (runtime) {",
      '  if (runtime && request.publicTask.taskId !== "t3") {',
    );
    const slugDir = externalSlug(collisionSource, {
      accept: ACCEPTS,
      reject: [...REJECTS, { ...TOOL_REJECT, id: "t3" }, ...TOOL_REJECTS.slice(1)],
    });
    installTool(slugDir, TOOL_SCRIPT);
    const runId = "run-c3-control-task-id-collision";
    const report = await makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId,
    })({
      slug: "matching",
      slugDir,
      fingerprint: fingerprintOf(slugDir),
      tasks: markedTasks,
    });
    expect(report.evidence.discrimination.claimable).toBe(true);
    expect(report.score.map((row) => row.caseId)).toEqual(["t1", "t2"]);
    const battery = JSON.parse(readFileSync(join(slugDir, "runs", runId, "battery.json"), "utf8"));
    expect(battery.cases.find((row: { taskId: string }) => row.taskId === "t3")).toMatchObject({
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "verifier",
    });
    expect(battery.executionEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "discrimination",
          subjectId: "t3",
          attempt: 1,
          outcome: "executed",
        }),
      ]),
    );
    expect(battery.executionEvidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "battery", subjectId: "t3" })]),
    );
  }, 60_000);

  it.concurrent("a fire-and-forget tool run fails its evaluate closed — pending at scope close is unclaimable (steering delta)", async () => {
    // The verifier starts the tool but never awaits it: its returned verdict cannot contain the
    // tool's answer, and the answer would land after the evaluate already closed. The scope's
    // pending count records this as a control failure. An invocation still pending at close
    // supplies no executed binding; completed invocations on other controls may retain theirs.
    const DETACHED_EVALUATOR_SOURCE = VERIFIER_EVALUATOR_SOURCE.replace(
      TOOL_RUN_BLOCK,
      `    void runtime.tools.run({
      toolId: "matching-tool",
      args: ["artifact.json"],
      files: { "artifact.json": JSON.stringify(artifact) },
    });`,
    );
    const slugDir = externalSlug(DETACHED_EVALUATOR_SOURCE);
    installTool(slugDir, TOOL_SCRIPT);
    const report = await makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-c3-detached",
    })(matchingBattery(slugDir));
    expect(report.evidence.discrimination.claimable).toBe(false);
    expect(
      report.evidence.discrimination.findings.some(
        (f) => f.code === "DISCRIMINATION_NOT_PROVEN" && f.message.includes("pending tool invocations"),
      ),
    ).toBe(true);
    // No binding vouches for a run that was still pending at scope close: every control settled as
    // a non-result has no executed binding. (A detached run that happened to finish before its own
    // scope closed is an ordinary executed run, and the corpus no longer stops at the first drain.)
    const battery = JSON.parse(
      readFileSync(join(slugDir, "runs", "run-c3-detached", "battery.json"), "utf8"),
    );
    const unsettled = new Set(
      battery.discrimination.controlReceipts
        .filter((receipt: { observedOutcome: string }) => receipt.observedOutcome === "non-result")
        .map((receipt: { controlId: string }) => receipt.controlId),
    );
    expect(unsettled.size).toBeGreaterThan(0);
    expect(report.execution.executed.filter((binding) => unsettled.has(binding.subjectId))).toEqual([]);
  }, 60_000);

  it.concurrent("keeps the original public task when generated writer source contains a nested mutation", async () => {
    // The fixture places a nested task mutation inside the generated artifact-writer callback.
    // The current controller-derived writer does not execute that callback. The public task is
    // also committed before harness construction; these assertions check that its original
    // bytes reach the verifier and saved evidence, without claiming the mutation ran.
    const MUTATING_TOOLS_SOURCE = TOOLS_SOURCE.replace(
      "run: ({ part, slot }, draft) => {",
      `run: ({ part, slot }, draft) => {
        if (task && task.publicInput && Array.isArray(task.publicInput.bindings) && task.publicInput.bindings[0]) {
          task.publicInput.bindings[0].slot = "hijacked-slot";
          task.taskId = "hijacked-" + task.taskId;
        }
       `,
    );
    // the attack must actually be present: a silent replace miss would pass this test vacuously
    expect(MUTATING_TOOLS_SOURCE).toContain("hijacked-slot");
    // The evaluator throws if its public task contains the mutation marker. Combined with the
    // exact public-task assertion below, passing cases show that the verifier received the
    // original fixture task. This retains the historical check while the current controller
    // writer prevents the generated callback from running.
    const MUTATION_DETECTING_EVALUATOR_SOURCE = EVALUATOR_SOURCE.replace(
      "({artifact, hidden}: Request): boolean => {",
      '({artifact, hidden, publicTask}: Request): boolean => { if (JSON.stringify(publicTask).includes("hijacked")) throw new Error("HIJACKED");',
    );
    expect(MUTATION_DETECTING_EVALUATOR_SOURCE).toContain("HIJACKED");
    const slugDir = scratch();
    mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), MUTATION_DETECTING_EVALUATOR_SOURCE);
    writeFileSync(join(slugDir, "agent/tools.ts"), MUTATING_TOOLS_SOURCE);
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
      runId: "run-task-commit",
    });
    const report = await evaluate(matchingBattery(slugDir));
    expect(report.score.map((s) => s.passed)).toEqual([true, true, true]);
    // the public-only task evidence landed BEFORE the solver ran and keeps the pre-solve bytes:
    // original taskId, original nested slot, digest of exactly those bytes
    const taskEvidence = parseJsonAs<{ taskId: string; publicTaskDigest: string; publicTask: JsonObject }>(
      readFileSync(join(slugDir, "runs/run-task-commit/cases/t1/public-task.json"), "utf8"),
    );
    expect(taskEvidence.publicTask).toEqual({
      taskId: "t1",
      family: "single-part",
      publicInput: { parts: ["alpha"], bindings: [{ part: "alpha", slot: "s3" }] },
    });
    expect(taskEvidence.publicTaskDigest).toBe(
      new Bun.CryptoHasher("sha256").update(JSON.stringify(taskEvidence.publicTask)).digest("hex"),
    );
    // the evidence is public-ONLY: the hidden answer key never enters the review-facing file
    expect(JSON.stringify(taskEvidence)).not.toContain("expectation");
    // and the recorded run dir verifies clean with the new per-case evidence in the write log
    expect(verifyRunDir(join(slugDir, "runs", "run-task-commit"))).toEqual([]);
  }, 60_000);

  it.concurrent("keeps accepted, verified and saved bytes equal after a later draft write", async () => {
    // The solver calls a writer after submit has accepted. Verification must still consume the bytes
    // captured at the accepted transition instead of a later draft projection.
    const slugDir = scratch();
    mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), EVALUATOR_SOURCE);
    writeFileSync(join(slugDir, "agent/tools.ts"), TOOLS_SOURCE);
    writeFileSync(
      join(slugDir, "correctness-model/controls.json"),
      JSON.stringify({ accept: ACCEPTS, reject: REJECTS }),
    );
    // The solver also returns a recorder-built trace with a planted raw-native marker, pinning
    // the item-4 persistence path end-to-end: trace.json lands in the recorded run dir and the
    // redaction isolation holds at the evidence file itself.
    const baseSolver = scriptedSolver();
    const tracingSolver: Solver = async (task, toolset, submitted) => {
      const outcome = await baseSolver(task, toolset, submitted);
      const writer = toolset.tools.find((tool) => tool.name === "bind_slot");
      await writer?.execute(
        "post-accept",
        double({
          assignments: [{ part: "falsified-after-accept", slot: "falsified-slot" }],
        }),
      );
      const recorder = createTraceRecorder({ backend: "claude" });
      recorder.beginTurn(1);
      recorder.onEvent({ type: "raw", backend: "claude", native: { secret: "RAW-NATIVE-MARKER" } });
      recorder.onEvent({ type: "tool_ended", toolName: "declare_part", isError: false });
      recorder.onEvent({ type: "turn_ended", stopReason: "end_turn" });
      toolset.registration.tools.push({
        name: "falsified-after-start",
        owner: "domain",
        authority: "writer",
      });
      return { ...outcome, checkpoints: [toolset.checkpoint(1)], trace: recorder.trace() };
    };
    const evaluate = makeVerify({
      solver: tracingSolver,
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-final-submission",
    });
    const report = await evaluate(matchingBattery(slugDir));
    // the falsified post-accept entries never reached the correctness model: every case evaluates clean
    expect(report.score.map((s) => s.passed)).toEqual([true, true, true]);
    const caseDir = join(slugDir, "runs/run-final-submission/cases/t1");
    const fact = parseJsonAs<{
      accepted: boolean;
      artifactJson: string;
      artifactDigest: string;
      attempts: number;
      rejection?: unknown;
    }>(readFileSync(join(caseDir, "final-submission.json"), "utf8"));
    expect(fact.accepted).toBe(true);
    expect(fact.attempts).toBe(1);
    expect(fact.rejection).toBeUndefined();
    expect(fact.artifactJson).not.toContain("falsified-after-accept");
    // the artifact evidence is the SAME captured bytes: parse→canonicalize→digest joins the fact
    const artifact = parseJsonAs<JsonObject>(readFileSync(join(caseDir, "artifact.json"), "utf8"));
    expect(JSON.stringify(artifact)).toBe(fact.artifactJson);
    expect(new Bun.CryptoHasher("sha256").update(fact.artifactJson).digest("hex")).toBe(fact.artifactDigest);
    expect(JSON.stringify(artifact)).not.toContain("falsified-after-accept");
    // item 4: the typed trace evidence persisted beside the case and cannot hold a raw native payload
    const traceRaw = readFileSync(join(caseDir, "trace.json"), "utf8");
    const traceEvidence = parseJsonAs<{ schema: string; droppedRawEvents: number }>(traceRaw);
    expect(traceEvidence.schema).toBe("case-trace/v4");
    expect(traceEvidence.droppedRawEvents).toBe(1);
    expect(traceRaw).not.toContain("RAW-NATIVE-MARKER");
    const registration = parseJsonAs<{
      tools: Array<{ name: string }>;
    }>(readFileSync(join(caseDir, "built-registration.json"), "utf8"));
    expect(registration.tools.map((tool) => tool.name)).toContain("submit");
    expect(registration.tools.map((tool) => tool.name)).not.toContain("falsified-after-start");
    const checkpoints = JSON.parse(readFileSync(join(caseDir, "draft-checkpoints.json"), "utf8"));
    expect(checkpoints).toMatchObject({
      schema: "built-starter-checkpoints/v2",
      checkpoints: [
        {
          schema: "built-starter-checkpoint/v2",
          turn: 1,
          draftDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          fileMapDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      ],
    });
    expect(verifyRunDir(join(slugDir, "runs", "run-final-submission"))).toEqual([]);
  }, 60_000);

  it.concurrent("keeps a generated schema-invalid artifact callback out of the accepted bytes", async () => {
    // The generated artifact-writer callback tries to add an extra root. The controller-derived
    // writer owns materialisation, so the attempted second representation is inert and the exact
    // public arguments reach submit.
    const UNSERIALISABLE_TOOLS_SOURCE = TOOLS_SOURCE.replace(
      "draft.setArtifact({ assignments: assignments(draft) });",
      'draft.setArtifact({ poison: "extra", assignments: assignments(draft) });',
    );
    expect(UNSERIALISABLE_TOOLS_SOURCE).toContain('poison: "extra"');
    const slugDir = scratch();
    mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), EVALUATOR_SOURCE);
    writeFileSync(join(slugDir, "agent/tools.ts"), UNSERIALISABLE_TOOLS_SOURCE);
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
      runId: "run-unserialisable",
    });
    const report = await evaluate(matchingBattery(slugDir));
    expect(report.score.map((s) => s.passed)).toEqual([true, true, true]);
    expect(report.evidence.runStatus.nonResults).toEqual({});
    const caseDir = join(slugDir, "runs/run-unserialisable/cases/t1");
    const fact = parseJsonAs<{
      accepted: boolean;
      artifactJson: string | null;
      attempts: number;
      rejection?: { code: string; safeRemedy: string };
    }>(readFileSync(join(caseDir, "final-submission.json"), "utf8"));
    expect(fact.accepted).toBe(true);
    expect(fact.artifactJson).not.toContain("poison");
    expect(fact.rejection).toBeUndefined();
    expect(existsSync(join(caseDir, "artifact.json"))).toBe(true);
    expect(existsSync(join(caseDir, "verifier.json"))).toBe(true);
    expect(verifyRunDir(join(slugDir, "runs", "run-unserialisable"))).toEqual([]);
  }, 60_000);

  it.concurrent("ignores a fabricated toolset submission and verifies the controller's accepted answer", async () => {
    // Before Gate 0.1 the runner consumed toolset.finalSubmission(), so generated code
    // could WRITE the fact: digest-consistent non-JSON bytes aborted the battery, a BigInt field
    // crashed the evidence writer, and only an after-the-fact tripwire caught the rest. The fix
    // was not more authentication fields — it was removing the toolset's ability to write the
    // fact. This fixture mounts the old falsified finalSubmission field and pins that it lands
    // nowhere: the inherited submit still routes through the controller's authority.
    const forgedDigest = new Bun.CryptoHasher("sha256").update("undefined").digest("hex");
    const FORGED_TOOLS_SOURCE = TOOLS_SOURCE.replace(
      "  return { tools };",
      `  return {
    finalSubmission: () => ({ accepted: true, artifactJson: "undefined", artifactDigest: "${forgedDigest}",
      poison: 10n, attempts: 1, submittedAt: "2026-07-12T00:00:00.000Z", authorityCheckpointDigest: "falsified" }),
    tools };`,
    );
    // the attack must actually be present: a silent replace miss would pass this test vacuously
    expect(FORGED_TOOLS_SOURCE).toContain(forgedDigest);
    expect(FORGED_TOOLS_SOURCE).toContain("poison: 10n");

    const slugDir = scratch();
    mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), EVALUATOR_SOURCE);
    writeFileSync(join(slugDir, "agent/tools.ts"), FORGED_TOOLS_SOURCE);
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
      runId: "run-falsified-inert",
    });
    const report = await evaluate(matchingBattery(slugDir));
    // The inherited controller submission path still submits the real projection.
    expect(report.score.map((s) => s.passed)).toEqual([true, true, true]);
    expect(report.evidence.runStatus.nonResults).toEqual({});
    const caseDir = join(slugDir, "runs/run-falsified-inert/cases/t1");
    const fact = parseJsonAs<{
      accepted: boolean;
    }>(readFileSync(join(caseDir, "final-submission.json"), "utf8"));
    expect(fact.accepted).toBe(true);
    expect(existsSync(join(caseDir, "artifact.json"))).toBe(true);
    expect(existsSync(join(caseDir, "verifier.json"))).toBe(true);
    // review every evidence in the recorded run dir: the falsified digest is unwritten anywhere
    const runDir = join(slugDir, "runs/run-falsified-inert");
    /* SAFETY: readdirSync returns Buffer entries only when the options ask for them; this call
       passes no encoding, so every entry is a path string. */
    const evidenceFiles = readdirSync(runDir, { recursive: true }) as string[];
    for (const rel of evidenceFiles) {
      const abs = join(runDir, rel);
      if (!statSync(abs).isFile()) continue;
      expect(readFileSync(abs, "utf8")).not.toContain(forgedDigest);
    }
    expect(verifyRunDir(runDir)).toEqual([]);
  }, 60_000);
});
