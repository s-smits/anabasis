import { describe, expect, it } from "bun:test";
import type { Brief } from "../src/truth/brief.ts";
import type { EvaluatorFn } from "../src/truth/contracts.ts";
import type { ControlCorpus } from "../src/truth/controls.ts";
import { EvaluatorProcessFailure } from "../src/truth/evaluator-process.ts";
import { inLanes, runControls } from "../src/truth/run-controls.ts";
import {
  type SettledControl,
  TOOL_REFUSED_CODE,
  unexecutedGroundingFindings,
} from "../src/truth/grounding-coverage.ts";
import { VerifierOperationalStop } from "../src/verify/verifier-lifetime.ts";
import { checkReceiptSet, totalsMatchRecorded } from "../src/truth/control-receipts.ts";
import type { ControlReceipt } from "../src/truth/battery-record.ts";
import type { BuildTask } from "../src/truth/tasks.ts";
import type {
  EvaluationScopeHandle,
  ExecutedCheckBinding,
  VerifierExecutionEvidence,
  VerifierHostHandle,
  VerifierSubject,
} from "../src/verify/verifier-port.ts";
import type {
  CorrectnessModelIssue,
  CorrectnessModelResult,
} from "../src/verify/correctness-model-result.ts";
import { isRecord } from "../src/meta/json-shape.ts";
import { double } from "./helpers/doubles.ts";

const BRIEF: Brief = {
  slug: "receipt-fixture",
  domain: "receipt fixture",
  correctnessContract: "check-program/v1",
  decisions: ["apply checks"],
  gates: ["blocking checks"],
  truthChecks: [
    {
      id: "intrinsic-check",
      assertion: "the artifact is valid",
      execution: {
        families: "all",
        artifactPaths: ["$"],
        publicInputPaths: [],
        hidden: "none",
        evidence: { kind: "authored" },
      },
    },
  ],
  joins: [],
  artifactSchema: [],
  designRuleConstants: [],
};

const TASK: BuildTask = {
  taskId: "task-1",
  family: "fixture-family",
  publicInput: {},
  hidden: [],
};

const accept = { id: "accept-1", taskId: TASK.taskId, artifact: { valid: true } };

const EXTERNAL_BRIEF: Brief = {
  ...BRIEF,
  truthChecks: [
    {
      id: "external-check",
      assertion: "the host checker accepts the artifact",
      execution: {
        families: "all",
        artifactPaths: ["$"],
        publicInputPaths: [],
        hidden: "none",
        evidence: { kind: "external", requiredToolIds: ["checker"] },
      },
    },
  ],
};

const EXTERNAL_CORPUS: ControlCorpus = {
  accept: [accept],
  reject: [
    {
      id: "reject-external",
      taskId: TASK.taskId,
      artifact: { bad: true },
      mutationClass: "external-reject",
      expectedCheckId: "external-check",
    },
  ],
};

const ISSUE = (checkId: string): CorrectnessModelIssue => ({
  checkId,
  message: `${checkId} is wrong`,
});

const verdict = (issues: CorrectnessModelIssue[] = []): CorrectnessModelResult => ({
  ok: issues.length === 0,
  issues,
  checkReceipts: [],
});

function isBadArtifact(value: unknown): boolean {
  return isRecord(value) && value.bad === true;
}

function item<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`fixture item ${String(index)} is missing`);
  return value;
}

function intrinsicCorpus(reject: ControlCorpus["reject"][number]): ControlCorpus {
  return { accept: [accept], reject: [reject] };
}

const intrinsicEvaluate: EvaluatorFn = ({ artifact }) =>
  isBadArtifact(artifact) ? verdict([ISSUE("intrinsic-check")]) : verdict();

/**
 * A fake verifier host that models one tool call. It chooses an exit code from the subject's
 * artifact and records the row the runner reads through `evidence()` and `executedBindings()`.
 * No executable runs here. The supplied `outcome` tests precedence: an "executed" row keeps
 * the evaluator's verdict; another outcome replaces that verdict with a non-result.
 */
function fakeToolHost(
  outcomeFor: (attempt: number) => VerifierExecutionEvidence["outcome"] = () => "executed",
  pendingInvocations = 0,
): VerifierHostHandle {
  const evidence: VerifierExecutionEvidence[] = [];
  const executed: ExecutedCheckBinding[] = [];
  return {
    openSubject(subject: VerifierSubject): EvaluationScopeHandle {
      return {
        port: {
          abandon() {},
          async run(request) {
            const bad = isBadArtifact(subject.artifact);
            const outcome = outcomeFor(subject.attempt);
            const row = double<VerifierExecutionEvidence>({
              toolId: request.toolId,
              checkId: request.checkId,
              requestId: `req-${subject.subjectId}-${String(subject.attempt)}`,
              runId: "receipt-run",
              phase: subject.phase,
              subjectId: subject.subjectId,
              attempt: subject.attempt,
              outcome,
            });
            evidence.push(row);
            if (outcome === "executed") {
              executed.push({
                phase: subject.phase,
                subjectId: subject.subjectId,
                attempt: subject.attempt,
                checkId: request.checkId,
                adapterId: request.toolId,
              });
            }
            const code = bad ? 1 : 0;
            return {
              executed: outcome === "executed",
              exitCode: outcome === "executed" ? code : null,
              signal: null,
              timedOut: outcome === "timeout",
              stdout: "",
              stderr: "",
              nonResult:
                outcome === "executed"
                  ? null
                  : { kind: outcome, message: `tool did not complete: ${outcome}` },
              evidence: row,
            };
          },
        },
        async close() {
          return { pendingInvocations };
        },
      };
    },
    executedBindings: () => executed,
    tools: () => ({}),
    evidence: () => evidence,
  };
}

/** This fixture uses the tool's exit code to decide the reject; its accept runs no tool. */
const externalEvaluate: EvaluatorFn = async ({ artifact }, runtime) => {
  if (!isBadArtifact(artifact)) return verdict();
  if (runtime === undefined) throw new Error("missing verifier runtime");
  const run = await runtime.tools.run({ toolId: "checker", checkId: "external-check" });
  return run.exitCode === 0 ? verdict() : verdict([ISSUE("external-check")]);
};

describe("control receipts", () => {
  it("settles every started lane and starts no further item after one throws", async () => {
    // The census gate retries a verifier non-result thrown from a lane; before this, Promise.all
    // returned at the first rejection while three siblings kept running and admitting new items.
    const started: number[] = [];
    let running = 0;
    const thrown = inLanes(
      [0, 1, 2, 3, 4, 5, 6, 7],
      4,
      async (lane) => {
        started.push(lane);
        running += 1;
        await Bun.sleep(lane === 0 ? 10 : 100);
        running -= 1;
        if (lane === 0) throw new Error("verifier non-result");
        return item;
      },
      () => false,
    );
    await expect(thrown).rejects.toThrow("verifier non-result");
    expect(running).toBe(0);
    expect(started.toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("saves an exact authored check result and calculates the summary totals from it", async () => {
    const corpus = intrinsicCorpus({
      id: "reject-1",
      taskId: TASK.taskId,
      artifact: { bad: true },
      mutationClass: "wrong-value",
      expectedCheckId: "intrinsic-check",
    });
    const execution = await runControls(intrinsicEvaluate, corpus, [TASK], {
      brief: BRIEF,
    });
    const receipt = execution.controlReceipts.find((row) => row.controlId === "reject-1");
    expect(receipt).toMatchObject({
      schema: "control-receipt/v2",
      kind: "reject",
      expectedOutcome: "fail",
      expectedCheckId: "intrinsic-check",
      observedOutcome: "fail",
      observedBlockingCheckIds: ["intrinsic-check"],
    });
    expect(execution).toMatchObject({
      rejectsFailed: 1,
      rejectsAttributed: 1,
      attributedCheckIds: { "intrinsic-check": 1 },
      claimable: true,
    });
  });

  it("refuses a wrong check and multiple blocking checks instead of counting either attribution", async () => {
    const wrong = await runControls(
      ({ artifact }) => (isBadArtifact(artifact) ? verdict([ISSUE("other-check")]) : verdict()),
      intrinsicCorpus({
        id: "reject-wrong",
        taskId: TASK.taskId,
        artifact: { bad: true },
        mutationClass: "wrong-check",
        expectedCheckId: "intrinsic-check",
      }),
      [TASK],
      { brief: BRIEF },
    );
    expect(wrong.claimable).toBe(false);
    expect(wrong.rejectsAttributed).toBe(0);
    expect(wrong.controlReceipts[1]?.observedBlockingCheckIds).toEqual(["other-check"]);

    const multiple = await runControls(
      ({ artifact }) =>
        isBadArtifact(artifact) ? verdict([ISSUE("intrinsic-check"), ISSUE("other-check")]) : verdict(),
      intrinsicCorpus({
        id: "reject-multiple",
        taskId: TASK.taskId,
        artifact: { bad: true },
        mutationClass: "multiple-blocking-checks",
        expectedCheckId: "intrinsic-check",
      }),
      [TASK],
      { brief: BRIEF },
    );
    // A cascade that includes the expected check is attributed: the check rejected it.
    expect(multiple.claimable).toBe(true);
    expect(multiple.rejectsAttributed).toBe(1);
    expect(multiple.controlReceipts[1]?.observedBlockingCheckIds).toEqual(["intrinsic-check", "other-check"]);
  });

  it("records current hidden checks once and refuses a duplicated saved receipt", async () => {
    const hidden = [{ checkId: "intrinsic-check", expectation: { answer: 7 } }];
    const task = { ...TASK, hidden };
    const corpus = intrinsicCorpus({
      id: "reject-hidden",
      taskId: TASK.taskId,
      artifact: { bad: true },
      mutationClass: "hidden-mismatch",
      expectedCheckId: "intrinsic-check",
      hidden,
    });
    const hiddenBrief: Brief = {
      ...BRIEF,
      truthChecks: BRIEF.truthChecks.map((check) => ({
        ...check,
        execution: { ...check.execution, hidden: "required" },
      })),
    };
    const observed: unknown[] = [];
    const execution = await runControls(
      ({ artifact, hidden: suppliedHidden }) => {
        observed.push(suppliedHidden);
        return isBadArtifact(artifact) ? verdict([ISSUE("intrinsic-check")]) : verdict();
      },
      corpus,
      [task],
      { brief: hiddenBrief },
    );
    const receipt = item(execution.controlReceipts, 1);
    expect(execution).toMatchObject({ claimable: true });
    expect(observed).toEqual([hidden, hidden]);
    expect(receipt).toMatchObject({ schema: "control-receipt/v2" });
    expect(checkReceiptSet(corpus, execution.controlReceipts).findings).toEqual([]);

    const savedAccept = item(execution.controlReceipts, 0);
    expect(
      checkReceiptSet({ accept: [accept], reject: [] }, [savedAccept, savedAccept]).findings.map(
        (finding) => finding.message,
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining("more than one receipt")]));
  });

  it("refuses missing, falsified, duplicate and private fields in saved control receipts", async () => {
    const corpus = intrinsicCorpus({
      id: "reject-persisted",
      taskId: TASK.taskId,
      artifact: { bad: true },
      mutationClass: "persisted",
      expectedCheckId: "intrinsic-check",
    });
    const execution = await runControls(intrinsicEvaluate, corpus, [TASK], {
      brief: BRIEF,
    });
    // SAFETY: JSON.stringify/parse returns the same receipt row vocabulary; the next two mutations
    // deliberately add a hostile field and falsify an id to exercise the saved JSON reader.
    const rows = JSON.parse(JSON.stringify(execution.controlReceipts)) as ControlReceipt[];
    Object.assign(item(rows, 0), { hiddenOperand: { answer: "recorded" } });
    item(rows, 1).controlId = "falsified-control";
    const { findings } = checkReceiptSet(corpus, rows);
    expect(findings.map((finding) => finding.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("invalid shape"),
        expect.stringContaining("does not name a declared control"),
        expect.stringContaining("has no receipt"),
      ]),
    );
    expect(checkReceiptSet(corpus, undefined).findings.map((finding) => finding.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("missing or are not a list")]),
    );
    // SAFETY: JSON.parse returns the same receipt vocabulary immediately above; the rows are
    // mutated only to exercise the saved JSON reader's field validation.
    const malformedRows = JSON.parse(JSON.stringify(execution.controlReceipts)) as ControlReceipt[];
    malformedRows[0] = {
      ...item(malformedRows, 0),
      observedOutcome: "pass",
      observedBlockingCheckIds: ["intrinsic-check"],
    };
    expect(checkReceiptSet(corpus, malformedRows).findings.map((finding) => finding.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("invalid shape")]),
    );
    expect(
      checkReceiptSet(corpus, [
        ...execution.controlReceipts,
        item(execution.controlReceipts, 0),
      ]).findings.map((finding) => finding.message),
    ).toEqual(expect.arrayContaining([expect.stringContaining("more than one receipt")]));
  });

  it("attributes an external reject to the tool run the host recorded for it", async () => {
    const verifier = fakeToolHost();
    const execution = await runControls(
      externalEvaluate,
      EXTERNAL_CORPUS,
      [TASK],
      {
        brief: EXTERNAL_BRIEF,
        runId: "receipt-run",
        externalChecks: [{ checkId: "external-check", adapterId: "checker" }],
      },
      verifier,
    );
    expect(execution).toMatchObject({
      claimable: true,
      rejectsAttributed: 1,
      attributedCheckIds: { "external-check": 1 },
    });
    expect(item(execution.controlReceipts, 1)).toMatchObject({
      controlId: "reject-external",
      observedOutcome: "fail",
      observedBlockingCheckIds: ["external-check"],
    });
    // The binding is per subject and per check: nothing else may be read as grounding this reject.
    expect(verifier.executedBindings()).toEqual([
      {
        phase: "discrimination",
        subjectId: "reject-external",
        attempt: 1,
        checkId: "external-check",
        adapterId: "checker",
      },
    ]);
  });

  it("lets a host-measured non-result outrank the verdict the evaluator returned", async () => {
    const verifier = fakeToolHost(() => "timeout");
    const discrimination = await runControls(
      externalEvaluate,
      EXTERNAL_CORPUS,
      [TASK],
      {
        brief: EXTERNAL_BRIEF,
        runId: "receipt-run",
        externalChecks: [{ checkId: "external-check", adapterId: "checker" }],
      },
      verifier,
    );
    // The evaluator returned a blocking issue for "external-check"; the host row says the run never
    // completed, and that fact settles the reject as its own non-result receipt. An author-owned
    // kind spends no second attempt, and the corpus keeps running: the accept keeps its verdict.
    expect(
      discrimination.controlReceipts.map((receipt) => [
        receipt.controlId,
        receipt.observedOutcome,
        receipt.nonResultKind,
      ]),
    ).toEqual([
      ["accept-1", "pass", null],
      ["reject-external", "non-result", "timeout"],
    ]);
    expect(verifier.evidence().map((row) => row.attempt)).toEqual([1]);
    // No floor was requested, so the settled receipt is the only trace: the reject stays in the
    // declared count, and nothing failed or was attributed.
    expect(discrimination).toMatchObject({ rejects: 1, rejectsFailed: 0, rejectsAttributed: 0 });
    expect(discrimination.findings.map((finding) => finding.code)).not.toContain("DISCRIMINATION_NOT_PROVEN");
  });

  it("spends one fresh execution on an environment-owned host refusal, then settles the control", async () => {
    const verifier = fakeToolHost(() => "sandbox");
    const discrimination = await runControls(
      externalEvaluate,
      EXTERNAL_CORPUS,
      [TASK],
      {
        brief: EXTERNAL_BRIEF,
        runId: "receipt-run",
        externalChecks: [{ checkId: "external-check", adapterId: "checker" }],
      },
      verifier,
    );
    expect(discrimination.controlReceipts.map((receipt) => receipt.nonResultKind)).toEqual([null, "sandbox"]);
    // A control with no verdict witnesses no cell: one no-verdict row keeps the claim open.
    expect(discrimination.findings.map((finding) => finding.code)).toEqual([
      "DISCRIMINATION_PROBE_NO_VERDICT",
    ]);
    expect(discrimination.claimable).toBe(false);
    expect(verifier.evidence().map((row) => [row.subjectId, row.attempt])).toEqual([
      ["reject-external", 1],
      ["reject-external", 2],
    ]);
  });

  it.each([
    ["timeout", "generated-external-grounding-unexecuted"],
    ["crash", "generated-external-grounding-unexecuted"],
    ["throw", "generated-external-grounding-unexecuted"],
    ["executed", null],
    ["sandbox", TOOL_REFUSED_CODE],
  ] as const)(
    "grounds a sandbox refusal retried as %s on the attempt the runner settled",
    async (retry, code) => {
      // Grounding that read the first matching host row would charge a retry that timed out,
      // crashed or threw to the environment through attempt 1's sandbox row.
      const verifier = fakeToolHost((attempt) =>
        attempt === 1 ? "sandbox" : retry === "throw" ? "executed" : retry,
      );
      let calls = 0;
      const evaluate: EvaluatorFn = async (request, runtime) => {
        calls += 1;
        if (retry === "throw" && calls === 2) throw new Error("authored failure before the tool call");
        return externalEvaluate(request, runtime);
      };
      const settled = new Map<string, SettledControl>();
      await runControls(
        evaluate,
        { accept: [], reject: EXTERNAL_CORPUS.reject },
        [TASK],
        {
          brief: EXTERNAL_BRIEF,
          runId: "receipt-run",
          externalChecks: [{ checkId: "external-check", adapterId: "checker" }],
          toolRetryWaitMs: 0,
          onSettled: (controlId, observation) => settled.set(controlId, observation),
        },
        verifier,
      );
      expect(settled.get("reject-external")?.attempt).toBe(2);
      const findings = unexecutedGroundingFindings({
        brief: EXTERNAL_BRIEF,
        tasks: [TASK],
        controls: EXTERNAL_CORPUS.reject,
        settled,
        externalChecks: [{ checkId: "external-check", adapterId: "checker" }],
        evidence: verifier.evidence(),
        path: "controls",
      });
      expect(findings.map((finding) => finding.code)).toEqual(code === null ? [] : [code]);
    },
  );

  it("a stop in one lane buys no fresh execution for a sandbox refusal in another", async () => {
    const verifier = fakeToolHost(() => "sandbox");
    const stopping = {
      ...item(EXTERNAL_CORPUS.reject, 0),
      id: "reject-stopping",
      artifact: { bad: true, stop: true },
    };
    const evaluate: EvaluatorFn = async (input, runtime) => {
      if (isRecord(input.artifact) && input.artifact.stop === true) {
        throw new VerifierOperationalStop("unsettled-children", ["receipt"]);
      }
      await Bun.sleep(20);
      return externalEvaluate(input, runtime);
    };
    const discrimination = await runControls(
      evaluate,
      { accept: [], reject: [stopping, item(EXTERNAL_CORPUS.reject, 0)] },
      [TASK],
      {
        brief: EXTERNAL_BRIEF,
        runId: "receipt-run",
        externalChecks: [{ checkId: "external-check", adapterId: "checker" }],
        toolRetryWaitMs: 0,
      },
      verifier,
    );
    expect(discrimination.claimable).toBe(false);
    expect(verifier.evidence().map((row) => [row.subjectId, row.attempt])).toEqual([["reject-external", 1]]);
  });

  it("admits the unbound-run and cleanup findings in corpus order, whichever lane settles first", async () => {
    // Pushing the unbound-run finding while the lanes were still racing, and the stop's cleanup
    // finding before ordered admission, would make their order follow lane
    // timing. Here the stopping control comes first in the corpus and settles last.
    const verifier = fakeToolHost(() => "executed", 1);
    const stopping = {
      ...item(EXTERNAL_CORPUS.reject, 0),
      id: "reject-stopping",
      artifact: { bad: true, stop: true },
    };
    const evaluate: EvaluatorFn = async (input, runtime) => {
      if (isRecord(input.artifact) && input.artifact.stop === true) {
        await Bun.sleep(30);
        throw new VerifierOperationalStop("unsettled-children", ["receipt"]);
      }
      return externalEvaluate(input, runtime);
    };
    const discrimination = await runControls(
      evaluate,
      { accept: [], reject: [stopping, item(EXTERNAL_CORPUS.reject, 0)] },
      [TASK],
      {
        brief: EXTERNAL_BRIEF,
        runId: "receipt-run",
        externalChecks: [{ checkId: "external-check", adapterId: "checker" }],
        toolRetryWaitMs: 0,
      },
      verifier,
    );
    const admitted = discrimination.findings
      .filter(
        (finding) =>
          finding.code === "EXTERNAL_RESULT_UNBOUND" || finding.message.includes("cleanup is pending"),
      )
      .map((finding) =>
        finding.code === "EXTERNAL_RESULT_UNBOUND"
          ? /control "([^"]+)"/.exec(finding.message)?.[1]
          : "cleanup",
      );
    expect(admitted).toEqual(["cleanup", "reject-external"]);
    expect(discrimination.claimable).toBe(false);
  });

  it.each(["generated", "protocol"] as const)(
    "lets a host-measured non-result outrank a child %s error",
    async (kind) => {
      // Sol run 23a1bc: the tool wall expired, the evaluate threw, and
      // the throw was recorded as an author exception while the host's timeout row went unread.
      const verifier = fakeToolHost(() => "timeout");
      const throwingEvaluate: typeof externalEvaluate = async (request, runtime) => {
        await externalEvaluate(request, runtime);
        throw new EvaluatorProcessFailure(kind, "tool output unavailable");
      };
      const discrimination = await runControls(
        throwingEvaluate,
        EXTERNAL_CORPUS,
        [TASK],
        {
          brief: EXTERNAL_BRIEF,
          runId: "receipt-run",
          externalChecks: [{ checkId: "external-check", adapterId: "checker" }],
        },
        verifier,
      );
      // The accept ran no tool, so its throw stays the author's; the reject's host row wins.
      expect(discrimination.controlReceipts.map((receipt) => receipt.nonResultKind)).toEqual([
        "verifier-throw",
        "timeout",
      ]);
      expect(discrimination.findings.map((finding) => finding.message)).not.toContain(
        expect.stringContaining("ended as timeout"),
      );
    },
  );

  it("refuses a saved receipt whose observed outcome its declared control contradicts", () => {
    const corpus = intrinsicCorpus({
      id: "reject-mode",
      taskId: TASK.taskId,
      artifact: { bad: true },
      mutationClass: "wrong-value",
      expectedCheckId: "intrinsic-check",
    });
    const receipts: ControlReceipt[] = [
      {
        schema: "control-receipt/v2",
        controlId: accept.id,
        taskId: TASK.taskId,
        kind: "accept",
        expectedOutcome: "pass",
        expectedCheckId: null,
        observedOutcome: "fail",
        observedBlockingCheckIds: ["intrinsic-check"],
        nonResultKind: null,
      },
      {
        schema: "control-receipt/v2",
        controlId: "reject-mode",
        taskId: TASK.taskId,
        kind: "reject",
        expectedOutcome: "fail",
        expectedCheckId: "intrinsic-check",
        observedOutcome: "fail",
        observedBlockingCheckIds: ["intrinsic-check"],
        nonResultKind: null,
      },
    ];
    // A rejected accept cannot be filed as a matched receipt.
    expect(checkReceiptSet(corpus, receipts)).toEqual({
      findings: [
        expect.objectContaining({ message: expect.stringContaining("does not satisfy its expected pass") }),
      ],
      totals: null,
    });
  });

  // A claim compares its recorded summary against totals recalculated from the receipts.
  it("matches a recorded discrimination summary against recalculated totals", () => {
    const derived = {
      acceptsPassed: 2,
      rejectsFailed: 3,
      rejectsAttributed: 3,
      attributedCheckIds: { "intrinsic-check": 2, "second-check": 1 },
    };
    const stored = { ...derived, accepts: 2, rejects: 3, claimable: true };
    expect(totalsMatchRecorded(stored, derived)).toBe(true);
    // Key order in the recorded map does not change the comparison.
    expect(
      totalsMatchRecorded(
        { ...stored, attributedCheckIds: { "second-check": 1, "intrinsic-check": 2 } },
        derived,
      ),
    ).toBe(true);
    for (const wrong of [
      { ...stored, acceptsPassed: 1 },
      { ...stored, attributedCheckIds: { "intrinsic-check": 2 } },
      { ...stored, attributedCheckIds: { "intrinsic-check": 2, "second-check": 1, extra: 0 } },
    ]) {
      expect(totalsMatchRecorded(wrong, derived)).toBe(false);
    }
    // A missing, fractional, negative or unreadable field refuses rather than reading as zero.
    for (const malformed of [
      null,
      "totals",
      { ...stored, rejectsFailed: undefined },
      { ...stored, rejectsFailed: 3.5 },
      { ...stored, rejectsAttributed: -1 },
      { ...stored, attributedCheckIds: null },
      { ...stored, attributedCheckIds: { "intrinsic-check": "2", "second-check": 1 } },
    ]) {
      expect(totalsMatchRecorded(malformed, derived)).toBe(false);
    }
  });

  it("compares a check attributed to '__proto__' as the ordinary count it is", () => {
    // checkIds are model-authored. The derived tally has a null prototype, so a count under
    // "__proto__" is an own property rather than a write that no-ops through the setter — and the
    // comparison has to read it that way too. A whole-record stableJson refuses a null-prototype
    // object outright, so a comparison built on it would lose this count.
    const protoKey = "__proto__";
    const attributedCheckIds: Record<string, number> = Object.create(null);
    attributedCheckIds[protoKey] = 1;
    attributedCheckIds["intrinsic-check"] = 2;
    const derived = { acceptsPassed: 1, rejectsFailed: 3, rejectsAttributed: 3, attributedCheckIds };
    expect(Object.hasOwn(derived.attributedCheckIds, protoKey)).toBe(true);
    expect(
      totalsMatchRecorded(
        {
          acceptsPassed: 1,
          rejectsFailed: 3,
          rejectsAttributed: 3,
          attributedCheckIds: JSON.parse('{"__proto__":1,"intrinsic-check":2}'),
        },
        derived,
      ),
    ).toBe(true);
    expect(
      totalsMatchRecorded(
        {
          acceptsPassed: 1,
          rejectsFailed: 3,
          rejectsAttributed: 3,
          attributedCheckIds: JSON.parse('{"__proto__":2,"intrinsic-check":2}'),
        },
        derived,
      ),
    ).toBe(false);
  });
});
