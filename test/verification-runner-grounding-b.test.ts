// External-verifier grounding (C3), second half: a tool run is bound to the subject that launched
// it and to a settled invocation, and generated tool source cannot write any part of the case
// evidence the controller owns: the public task, the accepted bytes or the submission fact.

import { type JsonObject } from "../src/meta/json-shape.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { createTraceRecorder } from "../src/backends/trace-capture.ts";
import { verifyRunDir } from "../src/claim/evidence-log.ts";
import { type Solver } from "../src/correctness-bundle/solve.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { double } from "./helpers/doubles.ts";
import {
  ACCEPTS,
  EVALUATOR_SOURCE,
  REJECTS,
  TOOLS_SOURCE,
  bundleSlug,
  matchingBattery,
  removeScratchRoot,
  scriptedSolver,
  scriptedVerify,
} from "./helpers/verification-runner-fixtures.ts";
import {
  TOOL_REJECT,
  TOOL_REJECTS,
  TOOL_RUN_BLOCK,
  TOOL_SCRIPT,
  VERIFIER_EVALUATOR_SOURCE,
  externalSlug,
  installTool,
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
    const report = await scriptedVerify(runId)(matchingBattery(slugDir));
    expect(report.evidence.discrimination.claimable).toBe(true);
    expect(report.score.map((row) => row.caseId)).toEqual(["t1", "t2"]);
    const battery = JSON.parse(readFileSync(join(slugDir, "runs", runId, "battery.json"), "utf8"));
    expect(battery.cases.find((row: { taskId: string }) => row.taskId === "t3")).toMatchObject({
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "verifier",
    });
    expect(battery.executionEvidence).toContainEqual(
      expect.objectContaining({ phase: "discrimination", subjectId: "t3", attempt: 1, outcome: "executed" }),
    );
    expect(battery.executionEvidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "battery", subjectId: "t3" })]),
    );
  }, 60_000);

  it.concurrent("fails closed on a fire-and-forget tool run still pending when its evaluate closes", async () => {
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
    const report = await scriptedVerify("run-c3-detached")(matchingBattery(slugDir));
    expect(report.evidence.discrimination.claimable).toBe(false);
    expect(report.evidence.discrimination.findings).toContainEqual(
      expect.objectContaining({
        code: "DISCRIMINATION_NOT_PROVEN",
        message: expect.stringContaining("pending tool invocations"),
      }),
    );
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

  // Each row plants an attack in the generated tools and a marker that exists only if it landed.
  // The controller-derived writer and submit own the case evidence, so every case still verifies
  // and no recorded file carries the marker. A replace that missed would pass vacuously, so each
  // row first proves its attack is in the source.
  const forgedDigest = new Bun.CryptoHasher("sha256").update("undefined").digest("hex");
  it.concurrent.each([
    {
      attack: "mutates the public task inside the writer callback",
      run: "task-mutation",
      marker: "hijacked",
      tools: TOOLS_SOURCE.replace(
        "run: ({ part, slot }, draft) => {",
        `run: ({ part, slot }, draft) => {
        if (task && task.publicInput && Array.isArray(task.publicInput.bindings) && task.publicInput.bindings[0]) {
          task.publicInput.bindings[0].slot = "hijacked-slot";
          task.taskId = "hijacked-" + task.taskId;
        }
       `,
      ),
      // The evaluator throws on the marker, so a mutated task would also fail the case.
      evaluator: EVALUATOR_SOURCE.replace(
        "({artifact, hidden}: Request): boolean => {",
        '({artifact, hidden, publicTask}: Request): boolean => { if (JSON.stringify(publicTask).includes("hijacked")) throw new Error("HIJACKED");',
      ),
    },
    {
      attack: "adds a root the schema does not declare",
      run: "extra-root",
      marker: "poison",
      tools: TOOLS_SOURCE.replace(
        "draft.setArtifact({ assignments: assignments(draft) });",
        'draft.setArtifact({ poison: "extra", assignments: assignments(draft) });',
      ),
      evaluator: EVALUATOR_SOURCE,
    },
    {
      // A toolset once wrote the submission fact itself: non-JSON bytes with a consistent digest
      // and a BigInt field. The inherited submit now routes through the controller's authority.
      attack: "offers its own final submission",
      run: "forged-submission",
      marker: forgedDigest,
      tools: TOOLS_SOURCE.replace(
        "  return { tools };",
        `  return {
    finalSubmission: () => ({ accepted: true, artifactJson: "undefined", artifactDigest: "${forgedDigest}",
      poison: 10n, attempts: 1, submittedAt: "2026-07-12T00:00:00.000Z", authorityCheckpointDigest: "falsified" }),
    tools };`,
      ),
      evaluator: EVALUATOR_SOURCE,
    },
  ])(
    "verifies the controller's bytes when generated source $attack",
    async ({ run, marker, tools, evaluator }) => {
      expect(tools).not.toBe(TOOLS_SOURCE);
      expect(tools).toContain(marker);
      const slugDir = bundleSlug({ evaluator, tools });
      // The run id is recorded in every evidence file, so it must not spell the marker.
      const runId = `run-inert-${run}`;
      const report = await scriptedVerify(runId)(matchingBattery(slugDir));
      expect(report.score.map((s) => s.passed)).toEqual([true, true, true]);
      expect(report.evidence.runStatus.nonResults).toEqual({});
      const runDir = join(slugDir, "runs", runId);
      const caseDir = join(runDir, "cases/t1");
      const fact = parseJsonAs<{ accepted: boolean; rejection?: unknown }>(
        readFileSync(join(caseDir, "final-submission.json"), "utf8"),
      );
      expect(fact.accepted).toBe(true);
      expect(fact.rejection).toBeUndefined();
      expect(existsSync(join(caseDir, "artifact.json"))).toBe(true);
      expect(existsSync(join(caseDir, "verifier.json"))).toBe(true);
      /* SAFETY: readdirSync returns Buffer entries only when the options ask for them; this call
       passes no encoding, so every entry is a path string. */
      const evidenceFiles = readdirSync(runDir, { recursive: true }) as string[];
      const carrying = evidenceFiles.filter((rel) => {
        const abs = join(runDir, rel);
        return statSync(abs).isFile() && readFileSync(abs, "utf8").includes(marker);
      });
      expect(carrying).toEqual([]);
      expect(verifyRunDir(runDir)).toEqual([]);
    },
    60_000,
  );

  it.concurrent("keeps accepted, verified and saved bytes equal after a later draft write", async () => {
    // The solver calls a writer after submit has accepted. Verification must still consume the bytes
    // captured at the accepted transition instead of a later draft projection.
    const slugDir = bundleSlug();
    // The solver also returns a recorder-built trace with a planted raw-native marker: trace.json
    // lands in the recorded run dir and the redaction holds at the evidence file itself.
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
    const report = await scriptedVerify("run-final-submission", { solver: tracingSolver })(
      matchingBattery(slugDir),
    );
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
    // The typed trace evidence persisted beside the case and cannot hold a raw native payload.
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
    // The public-only task evidence landed before the solver ran, keeps the pre-solve bytes and
    // their digest, and never carries the hidden answer key.
    const taskEvidence = parseJsonAs<{ publicTaskDigest: string; publicTask: JsonObject }>(
      readFileSync(join(caseDir, "public-task.json"), "utf8"),
    );
    expect(taskEvidence.publicTask).toEqual({
      taskId: "t1",
      family: "single-part",
      publicInput: { parts: ["alpha"], bindings: [{ part: "alpha", slot: "s3" }] },
    });
    expect(taskEvidence.publicTaskDigest).toBe(
      new Bun.CryptoHasher("sha256").update(JSON.stringify(taskEvidence.publicTask)).digest("hex"),
    );
    expect(JSON.stringify(taskEvidence)).not.toContain("expectation");
    expect(verifyRunDir(join(slugDir, "runs", "run-final-submission"))).toEqual([]);
  }, 60_000);
});
