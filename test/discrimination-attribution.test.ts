/**
 * What a control census attributes, and what it refuses to attribute.
 *
 * `test/control-receipts.test.ts` owns the receipt each control leaves and the totals computed
 * from it. This file owns the questions before that: which task's view a control evaluates
 * against, what happens when the corpus names a task that does not exist, and what the census
 * reports when the evaluator throws, the host refuses the tool request, or the evaluator
 * abandons a tool run it started. Each of those used to end the census or, worse, pass silently.
 */

import { chmodSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { sha256OfFile } from "../src/meta/digest.ts";
import type { Brief } from "../src/truth/brief.ts";
import type { EvaluationRequest } from "../src/truth/correctness-model-contract.ts";
import type { EvaluatorFn } from "../src/truth/contracts.ts";
import type { ControlCorpus } from "../src/truth/controls.ts";
import { discriminationDisclosure } from "../src/truth/discrimination-author-detail.ts";
import { runControls } from "../src/truth/run-controls.ts";
import {
  VERIFIER_CONTRACT_HINTS,
  VerifierContractError,
} from "../vendor/correctness-model-bundle/contract-error.ts";
import { evaluateCheckProgram } from "../vendor/correctness-model-bundle/evaluate.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import type {
  CorrectnessModelIssue,
  CorrectnessModelResult,
} from "../src/verify/correctness-model-result.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { double } from "./helpers/doubles.ts";
import {
  BRIEF,
  TASKS,
  controlFlag,
  removeScratchRoot,
  scratch,
} from "./helpers/verification-runner-fixtures.ts";

// Every control binds a battery task by taskId; runControls evaluates it against that task's
// committed public view, through the same request shape measured cases use.
const controlTask = { taskId: "t-ctl", family: "controls", publicInput: {}, hidden: [] };
const accept = { id: "a1", taskId: "t-ctl", artifact: { ok: true }, authoredBy: "accept-controls" };
/** The reject the error-handling cases pair with a broken accept: it must still be evaluated. */
const reject = {
  id: "r-join",
  taskId: "t-ctl",
  artifact: { bad: true },
  mutationClass: "ghost-entity",
  expectedCheckId: "parts-assigned",
};

afterAll(removeScratchRoot);

const errIssue = (checkId: string): CorrectnessModelIssue => ({
  checkId,
  message: `${checkId} failed`,
});
const truth = (issues: CorrectnessModelIssue[]): CorrectnessModelResult => ({
  ok: issues.length === 0,
  issues,
  checkReceipts: [],
});

describe("which task a control is evaluated against", () => {
  it.concurrent("passes the bound task's committed public view and nothing else", async () => {
    const seen: EvaluationRequest[] = [];
    const recording: EvaluatorFn = (request) => {
      seen.push({ ...request });
      return truth([]);
    };
    // The lone accept must pass, so the only fact under test is the request shape.
    await runControls(recording, { accept: [accept], reject: [] }, [controlTask], { brief: BRIEF });
    // Exactly the measured-case shape: publicTask, artifact, hidden, and no mode discriminant.
    expect(seen).toEqual([
      {
        publicTask: { taskId: "t-ctl", family: "controls", publicInput: {} },
        artifact: { ok: true },
        hidden: [],
      },
    ]);
  });

  it.concurrent("evaluates a reject against its declared task, not the first task in the battery", async () => {
    let seenPublicTask: EvaluationRequest["publicTask"] | null = null;
    const evaluate: EvaluatorFn = (request) => {
      seenPublicTask = request.publicTask;
      return controlFlag(request.artifact, "ok") ? truth([]) : truth([errIssue("parts-assigned")]);
    };
    const task = { taskId: "t-17", family: "f", publicInput: { joints: 3 }, hidden: [] };
    const execution = await runControls(
      evaluate,
      { accept: [accept], reject: [{ ...reject, id: "r-taskbound", taskId: "t-17" }] },
      [controlTask, task],
      {
        brief: {
          ...BRIEF,
          // Only the check the reject names, so every declared check has its reject.
          truthChecks: BRIEF.truthChecks
            .filter((check) => check.id === "parts-assigned")
            .map((check) => ({
              ...check,
              execution: { ...check.execution, publicInputPaths: ["$"] },
            })),
        },
      },
    );
    expect<unknown>(seenPublicTask).toEqual({ taskId: "t-17", family: "f", publicInput: { joints: 3 } });
    expect(execution).toMatchObject({ rejectsFailed: 1, rejectsAttributed: 1, claimable: true });
  });

  it.concurrent("refuses a control naming an unknown task rather than evaluating it without one", async () => {
    const evaluated: unknown[] = [];
    const recording: EvaluatorFn = (request) => {
      evaluated.push(request);
      return truth([]);
    };
    const execution = await runControls(
      recording,
      { accept: [{ ...accept, id: "a-stray", taskId: "t-gone" }], reject: [] },
      [controlTask],
      { brief: BRIEF },
    );
    expect(evaluated).toEqual([]);
    expect(execution.claimable).toBe(false);
    expect(execution.findings.map((finding) => finding.code)).toContain("DISCRIMINATION_NOT_PROVEN");
  });
});

describe("the attribution tally", () => {
  it.concurrent("records a check named '__proto__' as an own count the claim gate can read", async () => {
    // checkIds are model-authored. On a plain {} accumulator, attributedCheckIds["__proto__"] ?? 0
    // reads Object.prototype and the write no-ops through the __proto__ setter, so the attribution
    // is silently lost and the claim gate's zero-attribution read fails open.
    const evaluate: EvaluatorFn = ({ artifact }) =>
      controlFlag(artifact, "bad") ? truth([errIssue("__proto__")]) : truth([]);
    const execution = await runControls(
      evaluate,
      { accept: [accept], reject: [{ ...reject, id: "r-proto", expectedCheckId: "__proto__" }] },
      [controlTask],
      { brief: BRIEF },
    );
    // A variable key, not a "__proto__" literal member access: the count must be an OWN property.
    const protoKey = "__proto__";
    expect(execution.rejectsAttributed).toBe(1);
    expect(Object.hasOwn(execution.attributedCheckIds, protoKey)).toBe(true);
    expect(execution.attributedCheckIds[protoKey]).toBe(1);
  });

  it.concurrent("attributes below-minimum and foreign-row rejects to the real check program's parent check", async () => {
    // The F1 dive's two mutation classes, run through evaluateCheckProgram rather than a lambda:
    // the reference rows live on the bound task's public input, the one reference controls and
    // measured cases share.
    const contract: Brief = {
      slug: "subset-controls",
      correctnessContract: "check-program/v1",
      domain: "bounded selection",
      decisions: ["select a bounded inventory subset"],
      gates: ["the selected subset must contain at least one exact public row"],
      truthChecks: [
        {
          id: "selection-valid",
          assertion: "selected rows form a non-empty bounded exact inventory subset",
          execution: {
            families: "all",
            artifactPaths: ["$.targets"],
            publicInputPaths: ["$.inventoryPipes", "$.zoneScope"],
            hidden: "none",
            evidence: { kind: "authored" },
          },
        },
      ],
      joins: [],
      artifactSchema: [{ name: "targets", "shape": "selected rows" }],
      designRuleConstants: [],
    };
    const subsetTask = {
      taskId: "t-subset",
      family: "bounded-selection",
      publicInput: {
        inventoryPipes: [{ pipeId: "P-1", zoneId: "Z1", inspectionUnits: 0 }],
        zoneScope: [{ zoneId: "Z1" }],
      },
      hidden: [],
    };
    const base = { targets: [{ pipeId: "P-1", zoneId: "Z1", inspectionUnits: 0 }] };
    const corpus: ControlCorpus = {
      accept: [{ id: "accept-subset", taskId: "t-subset", artifact: base }],
      reject: [
        {
          id: "reject-below-minimum",
          taskId: "t-subset",
          artifact: { ...base, targets: [] },
          mutationClass: "below-minimum-selection",
          expectedCheckId: "selection-valid",
        },
        {
          id: "reject-foreign-row",
          taskId: "t-subset",
          artifact: { ...base, targets: [{ pipeId: "P-404", zoneId: "Z1", inspectionUnits: 0 }] },
          mutationClass: "foreign-row",
          expectedCheckId: "selection-valid",
        },
      ],
    };
    const evaluate = evaluateCheckProgram(contract, (_checkId, request) => {
      const artifact = double<{
        targets: Array<{ pipeId: string; zoneId: string; inspectionUnits: number }>;
      }>(request.artifact);
      const input = double<typeof subsetTask.publicInput>(request.publicTask.publicInput);
      return (
        artifact.targets.length > 0 &&
        artifact.targets.every(
          (row) =>
            input.inventoryPipes.some(
              (candidate) =>
                candidate.pipeId === row.pipeId &&
                candidate.zoneId === row.zoneId &&
                candidate.inspectionUnits === row.inspectionUnits,
            ) && input.zoneScope.some((zone) => zone.zoneId === row.zoneId),
        )
      );
    });
    const execution = await runControls(evaluate, corpus, [subsetTask], { brief: contract });
    expect(execution).toMatchObject({
      acceptsPassed: 1,
      rejectsFailed: 2,
      rejectsAttributed: 2,
      claimable: true,
    });
    expect(execution.attributedCheckIds["selection-valid"]).toBe(2);
  });
});

describe("a control the census could not decide", () => {
  it.concurrent("turns an evaluator throw into a finding on that control, never a dead census", async () => {
    // The -004 "entities is not iterable" class: it throws on the accept and evaluates the reject.
    const throwing: EvaluatorFn = ({ artifact }) => {
      if (controlFlag(artifact, "ok")) throw new TypeError("entities is not iterable");
      return truth([errIssue("parts-assigned")]);
    };
    const execution = await runControls(throwing, { accept: [accept], reject: [reject] }, [controlTask], {
      brief: BRIEF,
    });
    expect(execution.claimable).toBe(false);
    const finding = execution.findings.find((row) => row.message.includes('"a1"'));
    if (finding === undefined) throw new Error("missing thrown-control finding");
    expect(finding.code).toBe("DISCRIMINATION_NOT_PROVEN");
    expect(finding.message).toContain("entities is not iterable");
    expect(finding.message).toContain("Repair the evaluator exception and rerun the controls");

    // The author reads which example threw and where to reproduce it, never the throw text.
    const disclosure = discriminationDisclosure(finding);
    expect(disclosure).toMatchObject({ class: "withheld", classification: "generated-evaluate-throw" });
    const authorDetail = disclosure.class === "withheld" ? disclosure.note : undefined;
    expect(authorDetail).toContain('1 example in the host\'s confined check cell: "a1"');
    expect(authorDetail).toContain("correctness-model/evaluator.test.ts");
    expect(authorDetail).not.toContain("entities is not iterable");
    // One throwing control does not poison the rest of the corpus.
    expect(execution.rejectsAttributed).toBe(1);
  });

  it.concurrent("names the examples, the violated request rule and its remedy once for a host refusal", async () => {
    // The accepts' external check makes an ill-formed tool request; the host refuses it with the
    // public tool-input contract error, exactly as the confined cell would.
    const refusing: EvaluatorFn = ({ artifact }) => {
      if (controlFlag(artifact, "ok")) {
        throw new VerifierContractError(
          "verifier-tool-input",
          "stdin is not a string leaf of the artifact or public task",
        );
      }
      return truth([errIssue("parts-assigned")]);
    };
    const execution = await runControls(
      refusing,
      { accept: [accept, { ...accept, id: "a2" }], reject: [reject] },
      [controlTask],
      { brief: BRIEF },
    );
    expect(execution.claimable).toBe(false);
    // Two examples breaking one request rule read as one row naming both.
    const [finding, ...others] = execution.findings.filter((row) => row.code === "DISCRIMINATION_NOT_PROVEN");
    if (finding === undefined) throw new Error("missing contract-refusal finding");
    expect(others).toEqual([]);
    expect(finding.message).toContain('"a2": tool run refused: stdin is not a string leaf');

    // The classification stays the contract code, so the payload-free path keeps its hint.
    const disclosure = discriminationDisclosure(finding);
    expect(disclosure).toMatchObject({ class: "withheld", classification: "verifier-tool-input" });
    const authorDetail = disclosure.class === "withheld" ? disclosure.note : undefined;
    expect(authorDetail).toContain("refused the tool run of 2 examples");
    expect(authorDetail).toContain('Examples: "a1", "a2"');
    expect(authorDetail).toContain("stdin is not a string leaf of the artifact or public task");
    expect(authorDetail).toContain(VERIFIER_CONTRACT_HINTS["verifier-tool-input"]);
    expect(authorDetail).toContain("correctness-model/evaluator.test.ts");
    // The host's "tool run refused: " prefix is not repeated inside the author sentence.
    expect(authorDetail).not.toContain("tool run refused:");
    expect(execution.rejectsAttributed).toBe(1);
  });

  it.concurrent("cancels a tool run the evaluator abandoned and reports the host's own outcome", async () => {
    const toolPath = join(scratch(), "slow-tool");
    writeFileSync(toolPath, "#!/bin/sh\nwhile :; do :; done\n");
    chmodSync(toolPath, 0o755);
    const verifier = createVerifierHost({
      lifetime: createVerifierLifetime({ root: join(scratch(), "lifetime") }),
      inventory: {
        engine: {
          id: "engine",
          path: toolPath,
          digest: sha256OfFile(toolPath),
          source: "host",
          kind: "binary",
          interpreter: null,
        },
      },
      requireOsSandbox: false,
    });
    // The evaluator starts the tool, never awaits it, and returns a failing verdict. The run is
    // still in flight when evaluate returns, so nothing it eventually says was read.
    const fabricated: EvaluatorFn = (_request, runtime) => {
      if (!runtime) throw new Error("test requires the runner-owned verifier scope");
      // oxlint-disable-next-line typescript/no-floating-promises -- hostile evaluator deliberately abandons the host tool invocation.
      void runtime.tools.run({ toolId: "engine", checkId: "parts-assigned" });
      return { ok: false, issues: [], checkReceipts: [] };
    };
    const execution = await runControls(
      fabricated,
      { accept: [accept], reject: [] },
      [{ ...controlTask, hidden: TASKS.tasks[0]!.hidden }],
      { brief: BRIEF, runId: "control-pending" },
      verifier,
    );
    expect(execution.controlReceipts.map((row) => [row.observedOutcome, row.nonResultKind])).toEqual([
      ["non-result", "crash"],
    ]);
    expect(execution.findings.map((row) => row.code)).not.toContain("EXTERNAL_RESULT_UNBOUND");
    expect(verifier.evidence()).toEqual([
      expect.objectContaining({
        runId: "control-pending",
        phase: "discrimination",
        subjectId: "a1",
        attempt: 1,
        outcome: "crash",
        signal: "SIGTERM",
      }),
    ]);
  });
});
