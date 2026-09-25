import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { required, text } from "./helpers/doubles.ts";
import { MATCHING_BRIEF, MATCHING_TASKS, writeMatchingBuildFixture } from "./helpers/matching-fixture.ts";
import { loadSolvabilityPublicSchema } from "../src/truth/solvability-artifact-schema.ts";
import { EXPERIMENT_FILE } from "../src/author/builder-memory.ts";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  statSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it, afterAll } from "bun:test";
import type { CampaignFeedback } from "../src/author/campaign-types.ts";
import { initWorkspace } from "../src/author/domain-repo.ts";
import {
  BuilderAuthorFeedback,
  FEEDBACK_NAVIGATION,
  authorFindingOverview,
  gateFeedbackFindings,
} from "../src/builder/author-feedback.ts";
import { createCorrectnessCheckTool } from "../src/gate/check-tool.ts";
import {
  semanticFromResult,
  type BuilderCustomToolSemantic,
} from "../src/author/builder-custom-tool-call.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import {
  assertTaskSetMatchesFingerprint,
  ensureBundleSnapshot,
  createBundleSnapshot,
} from "../src/claim/bundle-snapshot.ts";
import { type FingerprintEvidence, fingerprintSlug } from "../src/claim/fingerprint.ts";
import { type JsonObject, asRecord, isString } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  type Gate,
  type PipelineInput,
  clearPreview,
  createValidationMemory,
  previewCandidate,
  submitStages,
} from "../src/gate/validation-pipeline.ts";
import { checkCandidate, conditionKey } from "../src/author/candidate-check.ts";
import { type Brief, controllerValidatedFinding } from "../src/truth/brief.ts";
import type { BuildTask } from "../src/truth/tasks.ts";
import type { ControlCorpus } from "../src/truth/controls.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const scratch: string[] = [];
interface Session {
  /** The scripted adoption gate. */
  gate: Gate;
  feedback?: BuilderAuthorFeedback;
  trialsDir?: string;
  experimentProposalRequired?: true;
  planAdvice?: () => string[];
  /** Extra validation sequence input, e.g. an adopted baseline. */
  validation?: Partial<Pick<PipelineInput, "adoptedDir" | "toolsProbes">>;
}

/** What the census gate returns when the F2 witness ended as an environment non-result: the gate
 *  reached its stage and the host answered, so the rows say nothing about these bytes. */
const HOST_NON_RESULT: CampaignFeedback[] = [
  {
    owner: "environment",
    severity: "blocking",
    claim: "solvability census: 2 of 25 reference solves ended as environment non-results",
    evidence: "protected host evidence",
  },
];

const SNAPSHOT_TOOLS = "export function createDomainHarness(_task) {\n  return { tools: [] };\n}\n";
const SNAPSHOT_VERIFIER = "export function evaluate() {\n  return { ok: true, issues: [] };\n}\n";

interface SeedSlugResult {
  slugDir: string;
  fingerprint: FingerprintEvidence;
}

/** One narrowing for every nested object this test reads, so no assertion is needed. */
function nested(body: JsonObject, key: string): JsonObject {
  const value = asRecord(body[key]);
  if (value === null) throw new Error(`correctness_check result has no ${key} object`);
  return value;
}

/** The group codes the model reads, in the order the overview presents them. */
function codesOf(body: JsonObject): string[] {
  const { groups } = nested(body, "findings");
  if (!Array.isArray(groups)) throw new Error("correctness_check findings carry no group array");
  return groups.map((group) => {
    const code = asRecord(asRecord(group)?.code)?.text;
    return isString(code) ? code : "";
  });
}

afterEach(cleanupScratch);
function workspaceScratch(name: string): string {
  // The production workspace sits below the repository and resolves its admitted dependencies from
  // that root. Keep the test below that root so its imports resolve through the same dependencies.
  return scratchDir(`.ana-scratch-correctness-check-${name}-`, runtimeProcess.cwd());
}

/** A complete workspace: the controller's starter repository, then the fixture over it. */
function workspace(name: string, fixture = true): string {
  const dir = workspaceScratch(name);
  initWorkspace(dir);
  if (fixture) writeMatchingBuildFixture(dir);
  return dir;
}

/** One Builder session's preview state: the remembered outcomes and the tool over them, with a
 *  scripted gate standing in for the adoption gate and no generated-tool probes, so the test owns
 *  what the gate says and the validation sequence owns the rest. */
function session(dir: string, options: Session) {
  const memory = createValidationMemory();
  const trialsDir = options.trialsDir ?? join(dir, "..", `${dir.split("/").pop()}-trials`);
  scratch.push(trialsDir);
  const tool = createCorrectnessCheckTool({
    preview: () =>
      previewCandidate(
        dir,
        {
          slug: "matching",
          exactTasks: 4,
          ...keyIfDefined("experimentProposalRequired", options.experimentProposalRequired),
        },
        {
          input: {
            toolsProbes: () => ({}),
            ...options.validation,
          },
          gates: options.gate,
          trialsDir,
          memory,
        },
      ),
    expectedTasks: 4,
    feedback: options.feedback ?? new BuilderAuthorFeedback(),
    planAdvice: options.planAdvice ?? (() => []),
  });
  let receipt: BuilderCustomToolSemantic | undefined;
  const check = async () => {
    const result = await tool.execute("correctness-check", {});
    receipt = semanticFromResult(result);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("correctness_check returned no text block");
    return parseJsonAs<JsonObject>(block.text);
  };
  return { check, trialsDir, memory, receipt: () => receipt };
}

const GATE_FEEDBACK: CampaignFeedback[] = [
  {
    owner: "tests",
    severity: "blocking",
    claim: 'check "answer" does not require a hidden operand for this family',
    evidence: "task validation",
    findings: [
      controllerValidatedFinding({
        code: "tasks-hidden-operand-unexpected",
        path: "tasks[0].hidden[0]",
        detail: 'check "answer" does not require a hidden operand for this family; remove this row',
      }),
    ],
  },
  {
    owner: "environment",
    severity: "blocking",
    claim: "GATE_AUTHOR_PROSE that the author must not read",
    evidence: "protected host evidence",
  },
  {
    owner: "brief",
    severity: "advisory",
    claim: "advisory only",
    evidence: "representation census",
  },
  {
    owner: "accept-controls",
    severity: "advisory",
    claim: "GATE_AUTHOR_PROSE beside a validated finding",
    evidence: "pre-adoption F2 census",
    findings: [
      controllerValidatedFinding({
        code: "accept-control-copies-reference",
        path: "correctness-model/controls.json",
        detail: "acc-copy carries the reference artifact for its own task",
      }),
    ],
  },
];

/** The body without its per-call stage receipts, whose timings and sources differ between an
 *  executed and a remembered result by design. */
const rowsOf = (body: JsonObject) => ({ ...body, stages: undefined, repeated: undefined });

/** Findings about the candidate itself. A gate outcome containing only these can be cached
 *  for this candidate, because it contains no environment failure. */
const PRODUCT_GATE_FEEDBACK: CampaignFeedback[] = GATE_FEEDBACK.filter((row) => row.owner !== "environment");

it("rechecks changed installed-tool or interpreter bytes, preserves every trial and remembers each condition", async () => {
  const dir = workspace("tool-condition");
  const model = join(dir, "correctness-model");
  const brief = parseJsonAs<Brief>(readFileSync(join(model, "brief.json"), "utf8"));
  const check = brief.truthChecks[1]!;
  check.execution.evidence = { kind: "external", requiredToolIds: ["field-engine"] };
  writeFileSync(join(model, "brief.json"), JSON.stringify(brief));
  const tasks = parseJsonAs<BuildTask[]>(readFileSync(join(model, "tasks.json"), "utf8"));
  for (const task of tasks) {
    for (const row of task.hidden) {
      if (row.checkId === check.id) row.expectation = { kind: "controller-owned-external-verifier" };
    }
  }
  writeFileSync(join(model, "tasks.json"), JSON.stringify(tasks));
  const controls = parseJsonAs<ControlCorpus>(readFileSync(join(model, "controls.json"), "utf8"));
  for (const control of controls.reject) if (control.expectedCheckId === check.id) delete control.hidden;
  writeFileSync(join(model, "controls.json"), JSON.stringify(controls));
  const bin = join(dir, ".toolchain", "bin");
  mkdirSync(bin, { recursive: true });
  const install = (exit: number) => {
    writeFileSync(join(bin, "field-engine"), `#!/bin/sh\nexit ${exit}\n`);
    chmodSync(join(bin, "field-engine"), 0o755);
  };
  install(0);
  const trials: string[] = [];
  const { check: preview, trialsDir } = session(dir, {
    gate: async (_harness, trial) => {
      trials.push(trial);
      return [];
    },
  });
  const first = await preview();
  expect(first.status).toBe("clear");
  expect((await preview()).repeated).toBeDefined();
  install(1);
  const changed = await preview();
  expect(changed.status).toBe("clear");
  expect(changed.snapshotId).toBe(first.snapshotId);
  expect(changed.repeated).toBeUndefined();
  expect(trials).toHaveLength(2);
  expect(new Set(trials).size).toBe(2);
  expect(readdirSync(trialsDir)).toHaveLength(2);
  expect((await preview()).repeated).toBeDefined();
  install(0);
  expect((await preview()).repeated).toBeDefined();
  install(2);
  expect((await preview()).status).toBe("clear");
  expect(trials).toHaveLength(3);
  // The interpreter a script runs under is part of its condition, as it is of the verifier
  // environment hash: a remembered gate run must not answer for interpreter bytes it never ran on.
  const interpreter = join(bin, "field-interp");
  const interpret = (body: string) => {
    writeFileSync(interpreter, `#!/bin/sh\n# ${body}\n`);
    chmodSync(interpreter, 0o755);
  };
  interpret("a");
  writeFileSync(join(bin, "field-engine"), `#!${interpreter}\nexit 0\n`);
  expect((await preview()).repeated).toBeUndefined();
  expect(trials).toHaveLength(4);
  expect((await preview()).repeated).toBeDefined();
  interpret("b");
  const reinterpreted = await preview();
  expect(reinterpreted.repeated).toBeUndefined();
  expect(reinterpreted.snapshotId).toBe(first.snapshotId);
  expect(trials).toHaveLength(5);
});

describe("correctness_check", () => {
  // The description names what runs and what it returns; how the stages stop one another is each
  // stage receipt's to say, so a second account of that order in the description is one to drift.
  it("describes the gates it runs without narrating their stop order", () => {
    const { description } = createCorrectnessCheckTool({
      preview: () => {
        throw new Error("the description needs no preview");
      },
      expectedTasks: 4,
      feedback: new BuilderAuthorFeedback(),
      planAdvice: () => [],
    });
    for (const gate of ["installed tools", "EXPERIMENT.json", "conformance", "control census", "F2"]) {
      expect(description).toContain(gate);
    }
    expect(description).toContain("submit remains the only acceptance path");
    expect(description).not.toMatch(/stops the stages|skips F2|family isolation/);
  });

  it.each(["agent", "evaluator", "controls"] as const)(
    "rebuild preview admits changed bytes: %s",
    async (change) => {
      const adoptedDir = workspace("build-baseline");
      writeBoundRepresentation(
        adoptedDir,
        undefined,
        readFileSync(join(adoptedDir, "agent/tools-spec.json"), "utf8"),
      );
      const dir = workspace(`build-${change}`);
      const file =
        change === "agent"
          ? "agent/BUILT_AGENTS.md"
          : change === "evaluator"
            ? "correctness-model/evaluator.ts"
            : "correctness-model/controls.json";
      const path = join(dir, file);
      writeFileSync(path, readFileSync(path, "utf8") + "\n");
      let gates = 0;
      const { check } = session(dir, {
        validation: { adoptedDir },
        gate: async () => {
          gates++;
          return [];
        },
      });
      const body = await check();
      expect(gates).toBe(1);
      expect(body.status).toBe("clear");
    },
  );

  it("shows what the bytes moved beside a clear result, without refusing the broader move", async () => {
    const adoptedDir = workspace("operation-baseline");
    const schema = loadSolvabilityPublicSchema(adoptedDir, MATCHING_BRIEF.artifactSchema);
    if (!schema.ok || schema.schema === null) throw new Error("fixture schema missing");
    writeBoundRepresentation(
      adoptedDir,
      schema.schema.sha256,
      readFileSync(join(adoptedDir, "agent/tools-spec.json"), "utf8"),
    );
    const dir = workspace("operation-candidate");
    writeFileSync(join(dir, "agent/BUILT_AGENTS.md"), "A changed solving method.");
    const proposal = {
      scope: "product",
      target: { comparator: "at-least", verifiedPasses: 2 },
      gap: "Gap.",
      change: "Change.",
      ...PLAN_FIELDS,
      expectedResult: "Result.",
    };
    writeFileSync(join(dir, EXPERIMENT_FILE), JSON.stringify(proposal));
    const { check } = session(dir, {
      experimentProposalRequired: true,
      validation: { adoptedDir },
      gate: async () => [],
    });
    expect(await check()).toMatchObject({
      status: "clear",
      measuredAs: "harness-intervention: these bytes moved harness against the adopted product",
    });
    const tasks = structuredClone(MATCHING_TASKS);
    // A retained task's changed private expectation moves scoring beside the harness.
    const retained = required(tasks[0], "first task");
    retained.hidden = retained.hidden.map((row) => ({ ...row, expectation: { changed: true } }));
    writeFileSync(join(dir, "correctness-model/tasks.json"), JSON.stringify(tasks));
    expect(await check()).toMatchObject({
      status: "clear",
      measuredAs: expect.stringMatching(
        /^new-baseline: these bytes moved harness and scoring .*no attributable-improvement claim$/,
      ),
    });
  });

  it.each(["correctness-model/tasks.json", "agent/BUILT_AGENTS.md"])(
    "product preview reaches validation with an unreadable baseline %s",
    async (file) => {
      const adoptedDir = workspace("unreadable-baseline");
      const path = join(adoptedDir, file);
      rmSync(path);
      mkdirSync(path);
      const dir = workspace("readable-candidate");
      let gates = 0;
      const { check } = session(dir, {
        validation: { adoptedDir },
        gate: async () => {
          gates++;
          return [];
        },
      });
      expect((await check()).status).toBe("clear");
      expect(gates).toBe(1);
    },
  );

  it("refuses a candidate that fails static validation at the bundle, as submit does, without a gate or a trial", async () => {
    const dir = workspace("blocked", false);
    let gated = false;
    const { check, trialsDir } = session(dir, {
      gate: async () => {
        gated = true;
        return [];
      },
    });
    const body = await check();
    expect(body.status).toBe("findings");
    expect(body.stage).toBe("bundle");
    expect(body.notReached).toEqual(["validation", "conformance", "gates"]);
    expect(gated).toBe(false);
    expect(existsSync(trialsDir)).toBe(false);
    expect(nested(body, "findings").totalFindings).toBeGreaterThan(0);
    expect(nested(body, "truth").verdict).toBe("not-run");
    expect(body.planAdvice).toBeUndefined();
  });

  // The plan's disagreement with the round's rehearsals rides beside the result and refuses nothing.
  it("carries the round plan's advice beside the result without changing it", async () => {
    let advice: string[] = [];
    const { check } = session(workspace("advised", false), {
      gate: async () => [],
      planAdvice: () => advice,
    });
    expect((await check()).planAdvice).toBeUndefined();
    advice = [
      "Advice: rehearsals already passed 2 distinct task(s) (t1, t2) against a target of at most 1 verified passes.",
    ];
    const body = await check();
    expect(body.planAdvice).toEqual(advice);
    expect(body.status).toBe("findings");
    expect(body.stage).toBe("bundle");
  });

  it("reaches the gate on a valid tree, records the trial under trials/<snapshotId> and reports coverage", async () => {
    const dir = workspace("validation sequence-clear");
    const seen: string[] = [];
    const gateTrees: string[] = [];
    const { check, trialsDir } = session(dir, {
      gate: async (_h, iterationDir, tree) => {
        seen.push(iterationDir);
        gateTrees.push(tree);
        writeFileSync(join(iterationDir, "census.json"), JSON.stringify({ findings: [] }));
        return [];
      },
    });
    const first = await check();
    expect(first.status).toBe("clear");
    expect(first.stage).toBe("gates");
    expect(first.notReached).toEqual([]);
    expect(isString(first.nextAction) && first.nextAction.includes("submit")).toBe(true);
    expect(first.nextAction).toContain("harness_inspect coverage");
    expect(first.nextAction).toContain("omitted by both the evaluator and the corpus");
    const coverage = nested(first, "coverage");
    expect(nested(coverage, "controls").accept).toBeGreaterThan(0);
    expect(nested(coverage, "tasks").expected).toBe(4);
    // Every check the brief declares is listed with its grounding, so the author reads what the
    // validation sequence covered rather than inferring it from a clear verdict.
    expect(Array.isArray(coverage.checks) && coverage.checks.length > 0).toBe(true);
    // Census evidence written before the cost rows existed leaves every check's price unstated
    // rather than reading as a check that cost nothing.
    expect(asRecord(Array.isArray(coverage.checks) ? coverage.checks[0] : null)?.censusCost).toBe(null);
    expect(nested(coverage, "solvability").ran).toBe(false);
    // The trial is named by the snapshot it read, so an audit joins it to the submit of the same
    // bytes, and each executed run owns its own directory beneath it.
    expect(isString(first.snapshotId)).toBe(true);
    expect(seen).toEqual([join(trialsDir, text(first.snapshotId), "full-1")]);
    // The gate reads the promoted snapshot submit would adopt for these bytes, never the live tree:
    // tool resolution reads a candidate's `.toolchain` tree only beside `.bundle-snapshots/`.
    const gateTree = gateTrees.join(",");
    expect(gateTree).toBe(join(dir, ".bundle-snapshots", text(first.snapshotId)));
  });

  // An author cannot see what one of its own checks costs: the gate returns one verdict, and truss
  // epoch 4764 spent 441 s on a single gate call without ever learning which of its seven checks
  // was paying for a nonlinear solve. The cost rows are that bill, aggregated over the corpus.
  it("prices every declared check from the census, and leaves a check it never ran unpriced", async () => {
    const dir = workspace("check-cost");
    let priced = "";
    const { check } = session(dir, {
      gate: async (harness, iterationDir) => {
        priced = required(harness.brief.truthChecks[0], "the fixture's first declared check").id;
        writeFileSync(
          join(iterationDir, "census.json"),
          JSON.stringify({
            findings: [],
            checkCost: [{ checkId: priced, evaluations: 12, totalMs: 481_500, toolLaunches: 12 }],
          }),
        );
        return [];
      },
    });
    const body = await check();
    const rows = nested(body, "coverage").checks;
    if (!Array.isArray(rows)) throw new Error("coverage carries no check rows");
    const cost = (id: string) => asRecord(asRecord(rows.find((row) => asRecord(row)?.id === id))?.censusCost);
    expect(cost(priced)).toEqual({ evaluations: 12, seconds: 481.5, toolLaunches: 12 });
    // Every other declared check stays null: it is absent from the census rows, not free.
    const unpriced = rows.filter((row) => asRecord(row)?.id !== priced);
    expect(unpriced.length).toBeGreaterThan(0);
    expect(unpriced.every((row) => asRecord(row)?.censusCost === null)).toBe(true);
  });

  it("runs the gate once per distinct candidate: unchanged bytes return the remembered trial", async () => {
    // An Opus run on 2026-08-23: twelve full validation sequences in one turn, a Sol run 130 on one defect. A
    // repeated check of the same tree must cost nothing and say so. These rows are product-owned;
    // the test below owns a gate that answered with an environment refusal, which is not remembered.
    const dir = workspace("memo");
    let gateCalls = 0;
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { check, trialsDir } = session(dir, {
      feedback: new BuilderAuthorFeedback(),
      gate: async () => {
        gateCalls += 1;
        started.resolve();
        await release.promise;
        return PRODUCT_GATE_FEEDBACK;
      },
    });
    const firstPending = check();
    await started.promise;
    const secondPending = check();
    release.resolve();
    const [first, second] = await Promise.all([firstPending, secondPending]);
    const third = await check();
    expect(gateCalls).toBe(1);
    expect(readdirSync(trialsDir)).toEqual([text(first.snapshotId)]);
    expect(second.repeated).toBe(
      "the workspace and installed-tool bytes are unchanged: conformance and gate rows are remembered, not re-run; bundle and candidate validation were checked again",
    );
    expect(rowsOf(second)).toEqual(rowsOf(first));
    expect(second.stages).toEqual([
      { stage: "bundle", status: "passed", source: "executed", ms: expect.any(Number) },
      { stage: "validation", status: "passed", source: "executed", ms: expect.any(Number) },
      { stage: "conformance", status: "passed", source: "reused", ms: 0 },
      { stage: "gates", status: "refused", source: "reused", ms: 0 },
    ]);
    expect(rowsOf(third)).toEqual(rowsOf(second));
    // A remembered result carries its repeat note and no delta; the changed tree below reads one.
    expect(nested(second, "findings").sinceLast).toBeUndefined();
    // Changed files form a new candidate and receive a fresh trial.
    writeFileSync(join(dir, "correctness-model", "guide.md"), "# changed\n");
    const fourth = await check();
    expect(gateCalls).toBe(2);
    expect(readdirSync(trialsDir).sort()).toEqual([text(first.snapshotId), text(fourth.snapshotId)].sort());
    expect(fourth.repeated).toBeUndefined();
    expect(nested(fourth, "findings").sinceLast).toBe(
      "finding codes against the previous check or submit: 1 carried over, 0 resolved, 0 new",
    );
  });

  it("does not remember a gated outcome the host refused", async () => {
    // run 51 round 2: two generated-tool worker timeouts turned the F2 census into an environment
    // non-result over adopted bytes that passed 25/25 before and after. Remembering that outcome
    // would return a host outage as this tree's verdict for the rest of the session.
    const dir = workspace("host-refused");
    let gateCalls = 0;
    const { check } = session(dir, {
      gate: async () => {
        gateCalls += 1;
        return HOST_NON_RESULT;
      },
    });
    const first = await check();
    expect(first.status).toBe("findings");
    expect(codesOf(first)).toEqual(["gate-environment"]);
    // Gate audit 2026-09-25 (docs/gate-audit.md, preview-attempt-spent): commented out (unsure): a runtime non-result is no verdict on the bytes, so a retry on them should run
    // // The reserved attempt still stands, exactly as it does for a blocked outcome, so the same
    // // tree cannot buy the paid validation sequence again; it is refused instead of answered from memory.
    // const second = await check();
    // expect(gateCalls).toBe(1);
    // expect(second.repeated).toBeUndefined();
    // expect(codesOf(second)).toEqual(["preview-attempt-spent"]);
    // A host outage is no verdict on these bytes, so the same tree runs again rather than reading it back.
    const second = await check();
    expect(gateCalls).toBe(2);
    expect(second.repeated).toBeUndefined();
    expect(codesOf(second)).toEqual(["gate-environment"]);
  });

  it("previews every distinct candidate and answers unchanged bytes from memory", async () => {
    // One was the ceiling until 2026-09-06, three until 2026-09-14 and six for a day; each time a
    // Builder that repaired its findings had to submit blind. Changed bytes now always run.
    const dir = workspace("unbounded");
    let gateCalls = 0;
    const { check } = session(dir, {
      gate: async () => {
        gateCalls += 1;
        return [];
      },
    });
    for (let candidate = 1; candidate <= 8; candidate += 1) {
      writeFileSync(join(dir, "correctness-model", "guide.md"), `# candidate ${candidate}\n`);
      expect((await check()).status).toBe("clear");
      expect(gateCalls).toBe(candidate);
    }
    // Unchanged bytes still answer from memory and spend nothing.
    expect((await check()).repeated).toBeDefined();
    expect(gateCalls).toBe(8);
  });

  it("returns every blocking gate row in the refusal's projection, records it in the store and drops gate prose", async () => {
    const dir = workspace("validation sequence-rows");
    const feedback = new BuilderAuthorFeedback();
    let answer: CampaignFeedback[] = GATE_FEEDBACK;
    const { check, receipt } = session(dir, { feedback, gate: async () => answer });
    const body = await check();
    expect(body.status).toBe("findings");
    expect(body.stage).toBe("gates");
    // An advisory row crosses the author boundary the way a blocking one does: the validated
    // finding keeps its detail, the row that carries none arrives as the gate's name, and the
    // claim beside either stays behind. It used to arrive as a count with nowhere to read it.
    expect(body.advisory).toEqual({
      rows: 2,
      findings: [
        {
          code: "gate-brief",
          path: "submit",
          detail: "this gate produced no controller-validated finding; no public detail is available",
        },
        {
          code: "accept-control-copies-reference",
          path: "correctness-model/controls.json",
          detail: "acc-copy carries the reference artifact for its own task",
        },
      ],
    });
    expect(codesOf(body)).toEqual(["tasks-hidden-operand-unexpected", "gate-environment"]);
    const blocking = GATE_FEEDBACK.filter((row) => row.severity === "blocking");
    const refusal = {
      ...authorFindingOverview(gateFeedbackFindings(blocking)),
      navigation: FEEDBACK_NAVIGATION,
    };
    expect(JSON.stringify(body.findings)).toBe(JSON.stringify(refusal));
    expect(JSON.stringify(body)).not.toContain("GATE_AUTHOR_PROSE");
    // A changed tree reads its three counts against the previous check, as a submit refusal does
    // against the previous submit; the first check carries none.
    expect(nested(body, "findings").sinceLast).toBeUndefined();
    // The durable receipt names why the call ended as it did; the delta rides on it as numbers.
    expect(receipt()).toEqual({
      outcome: "findings",
      stage: "gates",
      findings: 2,
      candidateId: expect.any(String),
      reason: "refused-gates",
      // Which gates refused the tree survives the session on the receipt, never in the text.
      findingCodes: ["gate-environment", "tasks-hidden-operand-unexpected"],
    });
    expect(JSON.stringify(body)).not.toContain("findingCodes");
    answer = [];
    writeFileSync(join(dir, "correctness-model", "guide.md"), "# repaired\n");
    const repaired = await check();
    expect(repaired.status).toBe("clear");
    expect(nested(repaired, "findings").sinceLast).toBe(
      "finding codes against the previous check or submit: 0 carried over, 2 resolved, 0 new",
    );
    expect(receipt()).toMatchObject({
      outcome: "clear",
      reason: "clear",
      carried: 0,
      resolved: 2,
      introduced: 0,
    });
    expect(receipt()?.findingCodes).toBeUndefined();
    const page = feedback.page({ group: 1, field: "detail" });
    expect(page).toMatchObject({ available: true, source: "correctness_check", check: { stage: "gates" } });
    // A later submit refusal replaces the trial page, and the identity says which it is.
    feedback.record(
      { attempt: 1, turn: 3, stage: "gates", commit: "a".repeat(40) },
      gateFeedbackFindings(blocking).slice(0, 1),
    );
    expect(feedback.page()).toMatchObject({
      source: "submit",
      refusal: { attempt: 1, turn: 3 },
      totalFindings: 1,
    });
  });

  // Gate audit 2026-09-25 (docs/gate-audit.md, preview-attempt-spent): commented out (unsure): a runtime non-result is no verdict on the bytes, so a retry on them should run
  // it("keeps the stored rows when a check is blocked or spent, so no code reads as resolved", async () => {
  it("keeps the stored rows when a check is blocked, however often, so no code reads as resolved", async () => {
    // A blocked call used to record zero rows in the store and report every earlier code resolved,
    // though nothing had judged the changed tree.
    const dir = workspace("validation sequence-blocked-store");
    const feedback = new BuilderAuthorFeedback();
    let answer: () => CampaignFeedback[] = () => GATE_FEEDBACK;
    const { check, receipt } = session(dir, { feedback, gate: async () => answer() });
    expect((await check()).status).toBe("findings");
    answer = () => {
      throw new Error("verifier host refused");
    };
    writeFileSync(join(dir, "correctness-model", "guide.md"), "# blocked\n");
    const blocked = await check();
    expect(blocked.status).toBe("blocked");
    expect(nested(blocked, "findings").sinceLast).toBeUndefined();
    expect(nested(blocked, "findings").navigation).toContain("replaced nothing");
    expect(receipt()).not.toHaveProperty("resolved");
    // Gate audit 2026-09-25 (docs/gate-audit.md, preview-attempt-spent): commented out (unsure): a runtime non-result is no verdict on the bytes, so a retry on them should run
    // const spent = await check();
    // expect(codesOf(spent)).toEqual(["preview-attempt-spent"]);
    expect((await check()).status).toBe("blocked");
    expect(receipt()).not.toHaveProperty("resolved");
    expect(feedback.page()).toMatchObject({ available: true, source: "correctness_check", totalFindings: 2 });
    // The next complete result is compared with the last complete one.
    answer = () => [];
    writeFileSync(join(dir, "correctness-model", "guide.md"), "# repaired\n");
    expect(nested(await check(), "findings").sinceLast).toBe(
      "finding codes against the previous check or submit: 0 carried over, 2 resolved, 0 new",
    );
  });

  it("refuses a missing installed tool as a bundle finding where submit would, without spending the gate", async () => {
    const dir = workspace("tool-missing");
    // The campaign test's external-verifier mutation: one check grounded on a tool no `.toolchain`
    // bin directory and no host PATH entry provides, with tasks and controls reconciled.
    const briefPath = join(dir, "correctness-model/brief.json");
    const brief = parseJsonAs<{ truthChecks: JsonObject[] }>(readFileSync(briefPath, "utf8"));
    const check = brief.truthChecks[1];
    if (check === undefined) throw new Error("fixture brief has fewer than two checks");
    const execution = asRecord(check.execution);
    if (execution === null) throw new Error("fixture check has no execution contract");
    execution.evidence = { kind: "external", requiredToolIds: ["field-engine"] };
    writeFileSync(briefPath, JSON.stringify(brief));
    const tasksPath = join(dir, "correctness-model/tasks.json");
    const tasks = parseJsonAs<Array<{ hidden: JsonObject[] }>>(readFileSync(tasksPath, "utf8"));
    for (const task of tasks) {
      for (const row of task.hidden) {
        if (row.checkId === check.id) row.expectation = { kind: "controller-owned-external-verifier" };
      }
    }
    writeFileSync(tasksPath, JSON.stringify(tasks));
    const controlsPath = join(dir, "correctness-model/controls.json");
    const controls = parseJsonAs<{ accept: JsonObject[]; reject: JsonObject[] }>(
      readFileSync(controlsPath, "utf8"),
    );
    for (const control of controls.reject) {
      if (control.expectedCheckId === check.id) Reflect.deleteProperty(control, "hidden");
    }
    writeFileSync(controlsPath, JSON.stringify(controls));
    let gateRan = false;
    const { check: run, trialsDir } = session(dir, {
      gate: async () => {
        gateRan = true;
        return [];
      },
    });
    const body = await run();
    expect(body.status).toBe("findings");
    expect(body.stage).toBe("bundle");
    expect(codesOf(body)).toEqual(["tool-missing"]);
    expect(body.notReached).toEqual(["validation", "conformance", "gates"]);
    expect(gateRan).toBe(false);
    expect(existsSync(trialsDir)).toBe(false);
  });

  it("stops at the bundle stage on an irregular bundle entry and names the stages not reached", async () => {
    const dir = workspace("validation-sequence-candidate");
    symlinkSync(join(dir, "agent", "tools.ts"), join(dir, "agent", "tools-link.ts"));
    let gated = false;
    const { check } = session(dir, {
      gate: async () => {
        gated = true;
        return [];
      },
    });
    const body = await check();
    expect(body.status).toBe("findings");
    expect(body.stage).toBe("bundle");
    expect(body.notReached).toEqual(["validation", "conformance", "gates"]);
    expect(gated).toBe(false);
    expect(JSON.stringify(body.findings)).toContain("non-regular-entry");
  });

  it("reports a gate that threw as blocked on the gate stage", async () => {
    const dir = workspace("validation sequence-throw");
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { check } = session(dir, {
      gate: async () => {
        started.resolve();
        await release.promise;
        throw new Error("verifier host refused");
      },
    });
    const first = check();
    await started.promise;
    const second = check();
    release.resolve();
    const [body, joined] = await Promise.all([first, second]);
    expect(body.status).toBe("blocked");
    expect(body.stage).toBe("gates");
    expect(body.error).toContain("verifier host refused");
    expect(joined.status).toBe("blocked");
    expect(rowsOf(joined)).toEqual(rowsOf(body));
  });

  // Gate audit 2026-09-25 (docs/gate-audit.md, preview-attempt-spent): commented out (unsure): a runtime non-result is no verdict on the bytes, so a retry on them should run
  // it("a blocked outcome spends the snapshot's attempt: the same tree cannot buy the validation sequence again", async () => {
  //   // The uncached paths — a thrown conformance load, a thrown gate, a typed generated-runtime
  //   // non-result — never enter `previews`, so before attempt reservation each repeat re-ran the
  //   // paid validation sequence without reaching any ceiling. The slot is now reserved before the first stage.
  //   const dir = workspace("blocked-repeat");
  //   let gateCalls = 0;
  //   const { check } = session(dir, {
  //     gate: async () => {
  //       gateCalls += 1;
  //       throw new Error("verifier host refused");
  //     },
  //   });
  //   const first = await check();
  //   expect(first.status).toBe("blocked");
  //   const second = await check();
  //   expect(gateCalls).toBe(1);
  //   expect(second.status).toBe("findings");
  //   expect(codesOf(second)).toEqual(["preview-attempt-spent"]);
  //   expect(JSON.stringify(second)).toContain("already spent their preview attempt");
  // });
  //
  // it("distinct blocked snapshots each run once and stay unremembered", async () => {
  //   const dir = workspace("blocked-distinct");
  //   let gateCalls = 0;
  //   const { check } = session(dir, {
  //     gate: async () => {
  //       gateCalls += 1;
  //       throw new Error("verifier host refused");
  //     },
  //   });
  //   expect((await check()).status).toBe("blocked");
  //   expect(codesOf(await check())).toEqual(["preview-attempt-spent"]);
  //   writeFileSync(join(dir, "correctness-model", "guide.md"), "# changed once\n");
  //   expect((await check()).status).toBe("blocked");
  //   expect(gateCalls).toBe(2);
  // });

  it("a blocked outcome is no verdict: the same tree runs the validation sequence again", async () => {
    const dir = workspace("blocked-repeat");
    let gateCalls = 0;
    const { check } = session(dir, {
      gate: async () => {
        gateCalls += 1;
        throw new Error("verifier host refused");
      },
    });
    expect((await check()).status).toBe("blocked");
    const second = await check();
    expect(gateCalls).toBe(2);
    expect(second.status).toBe("blocked");
    expect(second.repeated).toBeUndefined();
  });

  it("records a clear preview only from a preview that returned a complete clear report", async () => {
    // Safeguard 33 used to infer a clear preview from any held run, a submit's own included.
    const dir = workspace("clear-record");
    const { check, memory, trialsDir } = session(dir, { gate: async () => [] });
    const candidate = checkCandidate(dir, { slug: "matching", exactTasks: 4 });
    if (!candidate.ok) throw new Error("fixture candidate refused");
    const key = conditionKey(candidate);
    await submitStages(
      candidate,
      { toolsProbes: () => ({}) },
      { gates: async () => [], memory, runDir: (_clean, label) => join(trialsDir, label) },
    );
    expect(memory.previews.has(key)).toBe(true);
    expect(clearPreview(memory, key)).toBeUndefined();
    expect((await check()).status).toBe("clear");
    expect(clearPreview(memory, key)).toBeDefined();
  });

  it("records no clear preview when admission refused beside clear gates", async () => {
    const dir = workspace("clear-admission-refused");
    writeBoundRepresentation(dir, undefined, readFileSync(join(dir, "agent/tools-spec.json"), "utf8"));
    writeFileSync(join(dir, EXPERIMENT_FILE), "{}");
    const { check, memory } = session(dir, {
      gate: async () => [],
      experimentProposalRequired: true,
      validation: { adoptedDir: dir },
    });
    const body = await check();
    expect(body.stage).toBe("validation");
    expect(clearPreview(memory, text(body.snapshotId))).toBeUndefined();
    expect(memory.previews.has(text(body.snapshotId))).toBe(true);
  });

  it("a cached refusal still returns repeated instead of re-running its stages", async () => {
    const dir = workspace("refused-memo");
    writeBoundRepresentation(dir, undefined, readFileSync(join(dir, "agent/tools-spec.json"), "utf8"));
    writeFileSync(join(dir, EXPERIMENT_FILE), "{}");
    let gateCalls = 0;
    // A continuation whose plan does not parse refuses at admission; the gates still run once
    // beside it, and the executed stages are remembered by condition.
    const { check } = session(dir, {
      gate: async () => {
        gateCalls += 1;
        return [];
      },
      experimentProposalRequired: true,
      validation: { adoptedDir: dir },
    });
    const first = await check();
    expect(first.status).toBe("findings");
    expect(first.stage).toBe("validation");
    expect(gateCalls).toBe(1);
    const second = await check();
    expect(gateCalls).toBe(1);
    expect(second.repeated).toBe(
      "the workspace and installed-tool bytes are unchanged: conformance and gate rows are remembered, not re-run; bundle and candidate validation were checked again",
    );
    expect(rowsOf(second)).toEqual(rowsOf(first));
  });
});

// The candidate snapshot: admission resolves the candidate root and fixes one byte identity,
// and refuses a workspace that moved underneath it.
const SNAPSHOT_SCRATCH = join(import.meta.dir, ".scratch-bundleSnapshot");
let seq = 0;
function snapshotScratch(): string {
  seq += 1;
  const dir = join(SNAPSHOT_SCRATCH, `slug-${seq}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
afterAll(() => rmSync(SNAPSHOT_SCRATCH, { recursive: true, force: true }));

function snapshotSeedSlug(withTasks = true): SeedSlugResult {
  const slugDir = snapshotScratch();
  mkdirSync(join(slugDir, "agent"), { recursive: true });
  mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
  writeFileSync(join(slugDir, "agent/tools.ts"), SNAPSHOT_TOOLS);
  writeFileSync(join(slugDir, "agent/data.sqlite"), Uint8Array.from([0x53, 0x51, 0x4c, 0x00, 0xff]));
  writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), SNAPSHOT_VERIFIER);
  if (withTasks) {
    writeFileSync(join(slugDir, "correctness-model/tasks.json"), JSON.stringify([{ taskId: "t1" }]));
  }
  const fingerprint = fingerprintSlug(slugDir);
  if (!fingerprint.ok) {
    throw new Error(`fixture failed the fingerprint: ${JSON.stringify(fingerprint.findings)}`);
  }
  return { slugDir, fingerprint };
}

describe("createBundleSnapshot / ensureBundleSnapshot (check 1)", () => {
  it("creates a content-addressed, read-only bundle snapshot and reuses it after checking it", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug();
    const bundleSnapshot = createBundleSnapshot(slugDir, fingerprint);
    expect(bundleSnapshot.dir).toBe(join(slugDir, ".bundle-snapshots", bundleSnapshot.id));
    expect(readFileSync(join(bundleSnapshot.dir, "agent/tools.ts"), "utf8")).toBe(SNAPSHOT_TOOLS);
    expect([...readFileSync(join(bundleSnapshot.dir, "agent/data.sqlite"))]).toEqual([
      0x53, 0x51, 0x4c, 0x00, 0xff,
    ]);
    // Read-only: the bundle snapshot is checked again instead of being rewritten.
    const mode = statSync(join(bundleSnapshot.dir, "agent/tools.ts")).mode & 0o777;
    expect(mode & 0o222).toBe(0);
    expect(statSync(join(bundleSnapshot.dir, "agent/data.sqlite")).mode & 0o222).toBe(0);
    // Idempotent: the same fingerprint selects the same checked directory without another copy.
    expect(createBundleSnapshot(slugDir, fingerprint).dir).toBe(bundleSnapshot.dir);
    expect(ensureBundleSnapshot(slugDir, fingerprint).dir).toBe(bundleSnapshot.dir);
    // The gates hand the snapshot itself back in: it is verified in place, never nested under
    // <snapshot>/.bundle-snapshots, so admission continues to use the original workspace as its parent.
    expect(ensureBundleSnapshot(bundleSnapshot.dir, fingerprint).dir).toBe(bundleSnapshot.dir);
    expect(existsSync(join(bundleSnapshot.dir, ".bundle-snapshots"))).toBe(false);
  });

  it("reuses a valid snapshot written under the previous directory name", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug();
    const current = createBundleSnapshot(slugDir, fingerprint);
    const earlierRoot = join(slugDir, ".sealed-bundles");
    renameSync(join(slugDir, ".bundle-snapshots"), earlierRoot);
    const earlier = join(earlierRoot, current.id);

    expect(ensureBundleSnapshot(slugDir, fingerprint).dir).toBe(earlier);
    expect(ensureBundleSnapshot(earlier, fingerprint).dir).toBe(earlier);
  });

  it("a rewrite of the live tree after snapshot creation never reaches the snapshot", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug();
    const bundleSnapshot = createBundleSnapshot(slugDir, fingerprint);
    // A Builder repair can rewrite the original file between attempts.
    writeFileSync(
      join(slugDir, "agent/tools.ts"),
      "export function createDomainHarness() { throw new Error('sabotaged'); }\n",
    );
    const again = ensureBundleSnapshot(slugDir, fingerprint);
    expect(again.dir).toBe(bundleSnapshot.dir);
    expect(readFileSync(join(again.dir, "agent/tools.ts"), "utf8")).toBe(SNAPSHOT_TOOLS);
  });

  it("refuses to snapshot a tree that changed after its fingerprint", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug();
    writeFileSync(join(slugDir, "agent/tools.ts"), `${SNAPSHOT_TOOLS}// drifted\n`);
    expect(() => createBundleSnapshot(slugDir, fingerprint)).toThrow(
      "the executed code would not be the fingerprinted code",
    );
    expect(() => ensureBundleSnapshot(slugDir, fingerprint)).toThrow(/EXECUTED_BUNDLE_DRIFT/);
  });

  it("pins binary SQLite bytes in agentHash and refuses snapshot or task tampering", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug();
    expect(fingerprint.agentFiles.map((file) => file.path)).toContain("data.sqlite");
    const bundleSnapshot = createBundleSnapshot(slugDir, fingerprint);
    const dataPath = join(bundleSnapshot.dir, "agent/data.sqlite");
    chmodSync(dataPath, 0o644);
    writeFileSync(dataPath, Uint8Array.from([0x53, 0x51, 0x4c, 0x01, 0xff]));
    expect(() => ensureBundleSnapshot(slugDir, fingerprint)).toThrow(/agent bundle hashes/);

    // fresh slug: tamper ONLY the bundleSnapshot's tasks.json — the task set has its own hash
    const second = snapshotSeedSlug();
    const cap2 = createBundleSnapshot(second.slugDir, second.fingerprint);
    const tasksPath = join(cap2.dir, "correctness-model/tasks.json");
    chmodSync(tasksPath, 0o644);
    writeFileSync(tasksPath, JSON.stringify([{ taskId: "t1-mutated" }]));
    expect(() => ensureBundleSnapshot(second.slugDir, second.fingerprint)).toThrow(/task identity drifted/);
  });

  it("snapshots a bundle without tasks.json under a no-tasks id and checks it", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug(false);
    expect(fingerprint.taskSetHash).toBeNull();
    const bundleSnapshot = ensureBundleSnapshot(slugDir, fingerprint);
    expect(bundleSnapshot.id.endsWith("-no-tasks")).toBe(true);
    expect(existsSync(join(bundleSnapshot.dir, "correctness-model/tasks.json"))).toBe(false);
    expect(ensureBundleSnapshot(slugDir, fingerprint).dir).toBe(bundleSnapshot.dir);
  });
});

describe("assertTaskSetMatchesFingerprint (conformance-evidence task-set binding, task #29)", () => {
  it("passes when the live correctness-model/tasks.json still matches the fingerprint", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug();
    expect(() =>
      assertTaskSetMatchesFingerprint(slugDir, fingerprint.taskSetHash, "conformance evidence"),
    ).not.toThrow();
  });

  it("refuses a live tasks.json that drifted after promotion — conformance evidence must bind the live task set", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug();
    const bundleSnapshot = createBundleSnapshot(slugDir, fingerprint);
    // Drift the live file after the candidate snapshot was created.
    writeFileSync(join(slugDir, "correctness-model/tasks.json"), JSON.stringify([{ taskId: "t1-drifted" }]));
    // ensureBundleSnapshot re-verifies only the frozen copy, so it does not catch live drift.
    // Conformance evidence binds the live task set and therefore needs its own guard.
    expect(ensureBundleSnapshot(slugDir, fingerprint).dir).toBe(bundleSnapshot.dir);
    expect(() =>
      assertTaskSetMatchesFingerprint(slugDir, fingerprint.taskSetHash, "conformance evidence"),
    ).toThrow(/task identity drifted/);
  });

  it("passes for a no-tasks bundle (null fingerprint, no live tasks.json)", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug(false);
    expect(fingerprint.taskSetHash).toBeNull();
    expect(() =>
      assertTaskSetMatchesFingerprint(slugDir, fingerprint.taskSetHash, "conformance evidence"),
    ).not.toThrow();
  });

  it("refuses a tasks.json that appeared where the fingerprint committed to none", () => {
    const { slugDir, fingerprint } = snapshotSeedSlug(false);
    writeFileSync(join(slugDir, "correctness-model/tasks.json"), JSON.stringify([{ taskId: "sneaked-in" }]));
    expect(() =>
      assertTaskSetMatchesFingerprint(slugDir, fingerprint.taskSetHash, "conformance evidence"),
    ).toThrow(/task identity drifted/);
  });
});
