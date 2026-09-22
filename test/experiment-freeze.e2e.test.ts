/**
 * End-to-end tests for experiment attribution (src/run/experiment-freeze.ts and the campaign's use of it):
 * accepted bytes, not the proposal, decide whether a continuation is a build, an evaluation
 * correction or a task-only climb, and an unverified claim of unchanged conditions is recorded as unproven.
 *
 * The static cases read two fixture trees. The repair cases run the campaign's own submit, census
 * and full-task F2 over the adopted product built once in beforeAll. The intent cases over the
 * same product live in experiment-intent.e2e.test.ts, and those over the tool-requiring variant
 * in experiment-intent-tool.e2e.test.ts (see test/helpers/experiment-freeze-products.ts).
 */
import { afterAll, beforeAll, expect, it } from "bun:test";
import { double, required } from "./helpers/doubles.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { readBoundConformance, recordedVerifierEnvironmentHash } from "../src/claim/conformance-evidence.ts";
import {
  candidateExperimentAuthoring,
  candidateExperimentScope,
  experimentFreeze,
} from "../src/run/experiment-freeze.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { productConditionFingerprint, publicBatteryFingerprint } from "../src/run/climb-history.ts";
import { harnessBundleIdentity } from "../src/run/climb-battery-admission.ts";
import type { CandidateSnapshot } from "../src/author/candidate-check.ts";
import { candidateProposalRefusals, experimentOperation } from "../src/gate/experiment-admission.ts";
import { loadValidatedBundle } from "../src/author/candidate-check.ts";
import { MATCHING_BRIEF, MATCHING_TASKS, writeMatchingBuildFixture } from "./helpers/matching-fixture.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import { makeAgentToolsProbes } from "../src/author/agent-tools-session.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import { createVerifierLifetime, closeVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { EXPERIMENT_FILE } from "../src/author/builder-memory.ts";
import { loadSolvabilityPublicSchema } from "../src/truth/solvability-artifact-schema.ts";
import {
  type AdoptedProduct,
  FRESH,
  adoptedCopy,
  buildAdopted,
  censusGates,
  scriptedBuilderTurn,
} from "./helpers/experiment-freeze-products.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
const CORRECTNESS_MODEL_TASKS_JSON = "correctness-model/tasks.json";

afterAll(cleanupScratch);

function pair() {
  const root = scratchDir("repair-experiment-");
  const base = join(root, "base");
  const candidate = join(root, "candidate");
  for (const dir of [base, candidate]) {
    writeMatchingBuildFixture(dir);
    writeFileSync(join(dir, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks: MATCHING_TASKS }));
    writeBoundRepresentation(dir);
  }
  return { base, candidate };
}

/** An evaluator repair the scoring program sees: a new helper module the evaluator imports. A
 *  file nothing imports is not scoring, so writing one alone would repair nothing. */
function repairEvaluator(dir: string, helper = "check-helper.ts"): void {
  writeFileSync(join(dir, "correctness-model", helper), "export const repair = true;\n");
  const evaluator = join(dir, "correctness-model/evaluator.ts");
  writeFileSync(evaluator, `import "./${helper}";\n${readFileSync(evaluator, "utf8")}`);
}

it("records only changed public inputs and refuses drifted attribution", () => {
  const { base, candidate } = pair();
  const tasks = structuredClone(MATCHING_TASKS);
  const first = required(tasks[0], "first task");
  first.taskId = "renamed";
  first.family = "renamed-family";
  first.level = 42;
  required(tasks[1], "second task").publicInput = { changed: true };
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks }));
  const proposal = {
    scope: "tasks" as const,
    target: { comparator: "at-least" as const, verifiedPasses: 0 },
    gap: "Untested interaction.",
    change: "Change public input.",
    expectedResult: "The subset changes.",
  };
  const captured = { ...proposal, digest: hashJsonValue(proposal) };
  const probe = { operation: "task-probe" as const, moved: ["tasks" as const] };
  const authored = candidateExperimentAuthoring(captured, probe, "climb", base, candidate);
  expect(authored.changedTaskIds).toEqual([tasks[1]!.taskId]);
  expect(candidateExperimentAuthoring(captured, probe, "build", base, candidate).changedTaskIds).toBeNull();
  writeFileSync(join(candidate, "agent/tools.ts"), "export const changed = true;");
  expect(() => candidateExperimentAuthoring(captured, probe, "climb", base, candidate)).toThrow(
    "drifted bytes",
  );
});

it("reads a conformance record without its verifier identity as malformed at the final freeze", () => {
  const { base, candidate } = pair();
  const path = join(base, "conformance.json");
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  delete evidence.verifierEnvironmentHash;
  writeFileSync(path, JSON.stringify(evidence));
  expect(experimentFreeze({ kind: "climb", baseDir: base, candidateDir: candidate })).toEqual({
    state: "unproven",
    clauses: [expect.stringContaining("submission-schema-unverifiable")],
  });
});

/** The product identity a recorded battery of this tree would carry. */
function productOf(dir: string): string {
  const fingerprint = fingerprintSlug(dir);
  if (!fingerprint.ok) throw new Error("fixture does not fingerprint");
  return required(
    harnessBundleIdentity(fingerprint, recordedVerifierEnvironmentHash(dir)),
    "product identity",
  );
}

it("refuses a fixed-product return to older public inputs but admits a product repair", () => {
  const { base, candidate } = pair();
  const measured = publicBatteryFingerprint(MATCHING_TASKS);
  // Another product's reading of the same exam leaves it open to this one.
  const otherProduct = {
    adoptedDir: base,
    priorPublicTaskFingerprints: [productConditionFingerprint("other", measured)],
  };
  const priorPublicTaskFingerprints = [productConditionFingerprint(productOf(base), measured)];
  const tasks = structuredClone(MATCHING_TASKS);
  required(tasks[0], "first task").publicInput = { differentCondition: true };
  writeFileSync(join(base, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks }));
  const schema = loadSolvabilityPublicSchema(base, MATCHING_BRIEF.artifactSchema);
  if (!schema.ok || schema.schema === null) throw new Error("fixture schema missing");
  writeBoundRepresentation(base, schema.schema.sha256);
  const snapshot = () => snapshotOf(candidate);
  const input = { adoptedDir: base, priorPublicTaskFingerprints };
  expect(candidateProposalRefusals(snapshot(), otherProduct)).toEqual([]);
  const repeat = candidateProposalRefusals(snapshot(), input);
  expect(repeat.map((finding) => finding.code)).toEqual(["climb-battery-repeats-history"]);
  // The refusal names the comparison it made. `publicBatteryFingerprint` hashes the public inputs,
  // so a claim about batteries that moved only their published magnitudes would describe a reading
  // this check cannot take.
  expect(repeat[0]?.detail).toContain("byte-identical to a battery in the admitted history");
  expect(repeat[0]?.detail).not.toContain("magnitudes");
  writeFileSync(join(candidate, "agent/BUILT_AGENTS.md"), "A changed solving method.");
  expect(candidateProposalRefusals(snapshot(), input)).toEqual([]);
});

it.each(["helper", "hidden", "controls"] as const)(
  "retains evaluation attribution for a %s repair with unchanged public tasks, agent and schemas",
  (kind) => {
    const { base, candidate } = pair();
    if (kind === "helper") repairEvaluator(candidate);
    if (kind === "controls") {
      const path = join(candidate, "correctness-model/controls.json");
      writeFileSync(path, readFileSync(path, "utf8") + "\n");
    }
    if (kind === "hidden") {
      const tasks = structuredClone(MATCHING_TASKS);
      tasks[0]!.hidden[0]!.expectation = { parts: ["corrected"] };
      writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks }));
    }
    writeBoundRepresentation(candidate);
    expect(candidateExperimentScope("build", base, candidate, undefined, "product")).toEqual({
      requested: "build",
      actual: "evaluation",
      freeze: { state: "held", clauses: [] },
    });
  },
);

it.each(["constant", "assertion", "rule", "set", "applicability", "private-rule"] as const)(
  "attributes a %s change through the existing public projections",
  (kind) => {
    const { base, candidate } = pair();
    const brief = structuredClone(MATCHING_BRIEF);
    if (kind === "constant") brief.designRuleConstants[0]!.value = 50;
    if (kind === "assertion") brief.truthChecks[0]!.assertion = "only one assignment is required";
    if (kind === "rule") brief.ruleDecisions![0]!.statement = "parts may remain unassigned";
    if (kind === "private-rule") brief.ruleDecisions![1]!.statement = "try a different search order";
    if (kind === "set") {
      brief.designRuleSets = [
        { name: "allowed-slots", values: ["s3"], authority: "domain brief", citation: "s.1" },
      ];
    }
    if (kind === "applicability") brief.truthChecks[0]!.execution.families = ["another-family"];
    writeFileSync(join(candidate, "correctness-model/brief.json"), JSON.stringify(brief));
    writeBoundRepresentation(candidate);
    const scope = candidateExperimentScope("build", base, candidate, undefined, "product");
    expect(scope.actual).toBe(kind === "private-rule" ? "evaluation" : "build");
    if (kind !== "private-rule") {
      expect(scope.freeze?.clauses).toContainEqual(
        expect.stringContaining("evaluation-public-resources-drift"),
      );
    }
  },
);

it.each(["agent", "exam", "schema", "unreadable", "absent"] as const)(
  "records %s movement or uncertainty as build scope",
  (kind) => {
    const { base, candidate } = pair();
    repairEvaluator(candidate);
    if (kind === "agent") {
      const path = join(candidate, "agent/tools.ts");
      writeFileSync(path, readFileSync(path, "utf8") + "\n// coherent repair\n");
    }
    if (kind === "exam") {
      const tasks = structuredClone(MATCHING_TASKS);
      tasks[0]!.publicInput = { revised: true };
      writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks }));
    }
    if (kind === "schema") writeBoundRepresentation(candidate, "different-schema");
    else writeBoundRepresentation(candidate);
    if (kind === "unreadable") {
      const path = join(base, CORRECTNESS_MODEL_TASKS_JSON);
      rmSync(path);
      mkdirSync(path);
    }
    const scope = candidateExperimentScope(
      "build",
      kind === "absent" ? undefined : base,
      candidate,
      undefined,
      "product",
    );
    expect(scope.requested).toBe("build");
    expect(scope.actual).toBe("build");
    expect(scope.freeze?.state).not.toBe("held");
  },
);

it.each(["tools", "tasks", "absent"] as const)(
  "refuses supplied conformance with %s proof missing or mismatched",
  (kind) => {
    const { base, candidate } = pair();
    const controls = join(candidate, "correctness-model/controls.json");
    writeFileSync(controls, readFileSync(controls, "utf8") + "\n");
    writeBoundRepresentation(candidate);
    const bound = readBoundConformance(candidate);
    if (bound === null) throw new Error("fixture conformance missing");
    const proof =
      kind === "absent"
        ? null
        : { ...bound, [kind === "tools" ? "toolsSpecHash" : "taskSetHash"]: "mismatched" };
    const scope = candidateExperimentScope("build", base, candidate, proof, "product");
    expect(scope.actual).toBe("build");
    expect(scope.freeze?.state).toBe("unproven");
    expect(scope.freeze?.clauses).toContainEqual(expect.stringContaining("submission-schema-unverifiable"));
    // A failed evaluation proof cannot become a held task-only proof through the proposal fallback.
    expect(candidateExperimentScope("build", base, candidate, proof, "product").actual).toBe("build");
  },
);

// ---- Real submit: census and full-task F2 over the adopted product ----

let adopted: AdoptedProduct;
beforeAll(async () => {
  adopted = await buildAdopted(false);
});

it.concurrent.each(["private", "public", "unproven"] as const)(
  "attributes a %s repair from the conformance producer through real submit settlement",
  async (kind) => {
    const root = scratchDir("ana-conformance-attribution-");
    const lifetime = createVerifierLifetime({ root: join(root, "verifier-lifetime") });
    try {
      const { adoptedDir } = adoptedCopy(root, adopted);
      const campaignDir = join(root, "repair");
      const workspace = join(campaignDir, "workspace");
      const session = scriptedBuilderTurn(() => {
        writeFileSync(
          join(workspace, EXPERIMENT_FILE),
          JSON.stringify({
            scope: "product",
            target: { comparator: "at-least", verifiedPasses: 0 },
            gap: "The evaluator needs repair.",
            change: `Repair ${kind}.`,
            expectedResult: "The public exam remains solvable.",
          }),
        );
        repairEvaluator(workspace, "private-repair.ts");
        if (kind === "public") {
          const briefPath = join(workspace, "correctness-model/brief.json");
          const brief = JSON.parse(readFileSync(briefPath, "utf8"));
          brief.truthChecks[0].assertion =
            "The answer is the uppercase public input with whitespace trimmed.";
          writeFileSync(briefPath, JSON.stringify(brief));
        }
      });
      const repaired = await runBuilderCampaign(
        {
          ...FRESH,
          campaignDir,
          experiment: "build",
          adoptedDir,
          priorEvidence: {
            kind: "admitted-packet",
            digest: "private-correction",
            feedback: [
              {
                owner: "correctness-model",
                severity: "blocking",
                claim: "Correct the evaluator",
                evidence: "packet.json",
              },
            ],
          },
        },
        {
          tools: [],
          toolsProbes: kind === "unproven" ? () => ({}) : makeAgentToolsProbes,
          gates: censusGates(lifetime),
          open: session.open,
        },
      );
      if (!repaired.buildAdmissible) throw new Error(JSON.stringify(repaired));
      expect(session.last.prompt).toContain("Choose the next useful experiment");
      expect(session.last.prompt).not.toContain("this first battery is a diagnostic baseline");
      expect(existsSync(join(repaired.acceptedSnapshot, "conformance.json"))).toBe(false);
      expect(existsSync(join(repaired.iterationDir, "conformance.json"))).toBe(kind !== "unproven");
      expect(repaired.experimentScope?.actual).toBe(kind === "private" ? "evaluation" : "build");
      expect(repaired.iterations[0]?.experimentScope).toEqual(repaired.experimentScope);
      if (kind === "private") {
        expect(repaired.experimentScope?.freeze).toEqual({ state: "held", clauses: [] });
      }
      if (kind === "public") {
        expect(repaired.experimentScope?.freeze?.clauses).toContainEqual(
          expect.stringContaining("evaluation-public-resources-drift"),
        );
      }
      if (kind === "unproven") {
        expect(repaired.experimentScope?.freeze?.clauses).toContainEqual(
          expect.stringContaining("submission-schema-unverifiable"),
        );
      }
    } finally {
      await closeVerifierLifetime(lifetime, "clean");
    }
    // Two real campaigns, the shared template build included: 24 s alone on this Mac, past 60 s
    // beside a full gate.
  },
  180_000,
);

function snapshotOf(
  candidate: string,
  verifiedPasses = 0,
  scope: "product" | "tasks" = "product",
  changeText = "Change.",
): CandidateSnapshot {
  const fingerprint = fingerprintSlug(candidate);
  if (!fingerprint.ok) throw new Error("fixture fingerprint refused");
  const proposal = {
    scope,
    target: { comparator: "at-least" as const, verifiedPasses },
    gap: "Gap.",
    change: changeText,
    expectedResult: "Result.",
  };
  // The parts as parsed, validated or not: these cases move bytes a real submit would refuse, and
  // the operation is derived from what the bytes are, so an unreadable part stays null here as the
  // earlier file read left it.
  const { brief, battery, corpus, toolsSpec } = loadValidatedBundle(candidate, { slug: "matching" });
  return double<CandidateSnapshot>({
    snapshotDir: candidate,
    fingerprint,
    bundle: { brief, battery, corpus, toolsSpec },
    verifierEnvironmentHash: null,
    experimentProposal: { ...proposal, digest: hashJsonValue(proposal) },
  });
}

function bindBaselineRepresentation(base: string): void {
  const schema = loadSolvabilityPublicSchema(base, MATCHING_BRIEF.artifactSchema);
  if (!schema.ok || schema.schema === null) throw new Error("fixture schema missing");
  writeBoundRepresentation(base, schema.schema.sha256);
}

it("derives the operation from the dimensions the bytes moved, and refuses only an unreachable target", () => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  const derived = () => experimentOperation(snapshotOf(candidate), base);
  expect(
    candidateProposalRefusals(snapshotOf(candidate, MATCHING_TASKS.length + 1), { adoptedDir: base }).map(
      (finding) => finding.code,
    ),
  ).toEqual(["experiment-target-unreachable"]);
  expect(
    candidateProposalRefusals(snapshotOf(candidate, MATCHING_TASKS.length), { adoptedDir: base }),
  ).toEqual([]);
  expect(derived()).toEqual({ operation: "repeat", moved: [] });
  expect(experimentOperation(snapshotOf(candidate), undefined)).toEqual({
    operation: "new-baseline",
    moved: [],
    unproven: "no adopted baseline",
  });
  writeFileSync(join(candidate, "agent/BUILT_AGENTS.md"), "A changed solving method.");
  expect(derived()).toEqual({ operation: "harness-intervention", moved: ["harness"] });
  const tasks = structuredClone(MATCHING_TASKS);
  required(tasks[0], "first task").publicInput = { differentCondition: true };
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks }));
  // Harness and tasks both moved: a new baseline, which claims no attributable improvement.
  expect(derived()).toEqual({ operation: "new-baseline", moved: ["harness", "tasks"] });
});

// i02 of the 2026-09-20 truss campaign declared a repair to the reference solve while
// correctness-model/reference/index.ts stayed hash e93970a8 across i01, i02 and i03, still reading
// `DESIGNS[task.taskId]`. The claimed repair never happened and no stage read the prose against the
// snapshot. The refusal is session-local: the author resolves it without new bytes.
it("refuses a change that names only files the accepted bytes left byte-identical", () => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  const codes = (change: string) =>
    candidateProposalRefusals(snapshotOf(candidate, MATCHING_TASKS.length, "product", change), {
      adoptedDir: base,
    }).map((finding) => finding.code);
  expect(codes("Repaired correctness-model/reference/index.ts to solve rather than look up.")).toEqual([
    "experiment-change-unmoved",
  ]);
  // Prose that names no file makes no claim about bytes, and a path neither bundle carries
  // proves nothing either way.
  expect(codes("Repaired the reference solve.")).toEqual([]);
  expect(codes("Rewrote notes/plan.md.")).toEqual([]);
  // The battery pair is hashed together and sits outside correctnessModelFiles.
  expect(codes("Rewrote correctness-model/tasks.json.")).toEqual(["experiment-change-unmoved"]);
  writeFileSync(join(candidate, "agent/BUILT_AGENTS.md"), "A changed solving method.");
  // One moved file settles it, so naming an unchanged file for context is not a false declaration.
  expect(codes("Rewrote agent/BUILT_AGENTS.md, keeping correctness-model/reference/index.ts fixed.")).toEqual(
    [],
  );
  expect(codes("Repaired correctness-model/reference/index.ts.")).toEqual(["experiment-change-unmoved"]);
  // Without an adopted baseline there is nothing to compare against.
  expect(
    candidateProposalRefusals(
      snapshotOf(candidate, MATCHING_TASKS.length, "product", "Repaired correctness-model/evaluator.ts."),
      {},
    ),
  ).toEqual([]);
});

it("reports every independent proposal refusal at once", () => {
  // A tasks proposal on a moved product that also counts past its battery used to hear only of the
  // scope, and learned of the target after a second paid check.
  const { base, candidate } = pair();
  writeFileSync(join(candidate, "agent/BUILT_AGENTS.md"), "A changed solving method.");
  const codes = (scope: "product" | "tasks", passes: number) =>
    candidateProposalRefusals(snapshotOf(candidate, passes, scope), { adoptedDir: base }).map(
      (finding) => finding.code,
    );
  expect(codes("tasks", MATCHING_TASKS.length + 1)).toEqual([
    "experiment-scope-mismatch",
    "experiment-target-unreachable",
  ]);
  expect(codes("tasks", MATCHING_TASKS.length)).toEqual(["experiment-scope-mismatch"]);
  expect(codes("product", MATCHING_TASKS.length)).toEqual([]);
});

it("reads a retained task's changed expectations as moving scoring, and an added task as not", () => {
  // Review of 2026-09-14: a retained task's private expectation can change scoring while every
  // public byte looks like a task-only change, so the operation must name it.
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  const tasks = structuredClone(MATCHING_TASKS);
  const added = {
    ...structuredClone(required(tasks[0], "first task")),
    taskId: "added-task",
    publicInput: { differentCondition: true },
  };
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks: [...tasks, added] }));
  expect(experimentOperation(snapshotOf(candidate), base).operation).toBe("task-probe");
  const retained = required(tasks[0], "first task");
  retained.hidden = [
    { checkId: "parts-assigned", expectation: { parts: ["alpha"] } },
    { checkId: "expected-binding", expectation: { pairs: [["alpha", "s4"]] } },
  ];
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks: [...tasks, added] }));
  expect(experimentOperation(snapshotOf(candidate), base).moved).toContain("scoring");
});

// Until 2026-09-21 any changed byte under correctness-model/ read as scoring, so a battery whose
// reference solve was rewritten to solve it could never be a task probe. The scoring program is the
// brief and the evaluator with what it imports; the changed files are still named either way.
it("reads a rewritten reference solve or test as no scoring move, and anything the evaluator executes as scoring", () => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  const derived = () => experimentOperation(snapshotOf(candidate), base);
  const rewrite = (dir: string, file: string, text: string) =>
    writeFileSync(join(dir, "correctness-model", file), text);
  const restore = (file: string) =>
    rewrite(candidate, file, readFileSync(join(base, "correctness-model", file), "utf8"));
  for (const file of ["reference/index.ts", "harness.test.ts"]) {
    rewrite(candidate, file, "export const rewritten = true;\n");
    expect(derived()).toEqual({ operation: "repeat", moved: [], correctnessModelChangedFiles: [file] });
    if (file === "harness.test.ts") rmSync(join(candidate, "correctness-model", file));
    else restore(file);
  }
  rewrite(candidate, "reference/index.ts", "export const rewritten = true;\n");
  const tasks = [
    ...structuredClone(MATCHING_TASKS),
    {
      ...structuredClone(required(MATCHING_TASKS[0], "first task")),
      taskId: "added-task",
      publicInput: { differentCondition: true },
    },
  ];
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks }));
  expect(derived()).toEqual({
    operation: "task-probe",
    moved: ["tasks"],
    correctnessModelChangedFiles: ["reference/index.ts"],
  });
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks: MATCHING_TASKS }));
  restore("reference/index.ts");
  // A module the evaluator imports is scoring wherever it lives, reference/ included.
  const evaluator = readFileSync(join(base, "correctness-model/evaluator.ts"), "utf8");
  for (const dir of [base, candidate]) {
    rewrite(dir, "evaluator.ts", `import "./reference/shared.ts";\n${evaluator}`);
    rewrite(dir, "reference/shared.ts", "export const shared = 1;\n");
  }
  expect(derived()).toEqual({ operation: "repeat", moved: [] });
  rewrite(candidate, "reference/shared.ts", "export const shared = 2;\n");
  expect(derived()).toEqual({
    operation: "evaluation-correction",
    moved: ["scoring"],
    correctnessModelChangedFiles: ["reference/shared.ts"],
  });
  restore("reference/shared.ts");
  rewrite(
    candidate,
    "evaluator.ts",
    `${readFileSync(join(base, "correctness-model/evaluator.ts"), "utf8")}// changed\n`,
  );
  expect(derived()).toEqual({
    operation: "evaluation-correction",
    moved: ["scoring"],
    correctnessModelChangedFiles: ["evaluator.ts"],
  });
  restore("evaluator.ts");
  // Bun compiles every module under this file, though nothing imports it.
  rewrite(candidate, "tsconfig.json", '{"compilerOptions": {"useDefineForClassFields": false}}');
  expect(derived()).toEqual({
    operation: "evaluation-correction",
    moved: ["scoring"],
    correctnessModelChangedFiles: ["tsconfig.json"],
  });
});

it("reads a retained task's expectations and controls as scoring, and certifies no comparison without the baseline proof", () => {
  const { base, candidate } = pair();
  const derived = () => experimentOperation(snapshotOf(candidate), base);
  writeFileSync(join(candidate, "agent/BUILT_AGENTS.md"), "A changed solving method.");
  // Unknown is neither unchanged nor changed: without the bound baseline representation no comparison is certified.
  rmSync(join(base, "conformance.json"));
  expect(derived()).toMatchObject({
    operation: "new-baseline",
    unproven: expect.stringContaining("unreadable"),
  });
  bindBaselineRepresentation(base);
  // A retained task's family selects its applicable checks: reassigning it moves the ruler while
  // every public input stays, so a changed agent beside it cannot read as a harness intervention.
  const reassigned = structuredClone(MATCHING_TASKS);
  required(reassigned[0], "first task").family = "two-part";
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks: reassigned }));
  expect(derived()).toEqual({ operation: "new-baseline", moved: ["harness", "scoring"] });
  const tasks = structuredClone(MATCHING_TASKS);
  const retained = required(tasks[0], "first task");
  retained.hidden = retained.hidden.map((row) => ({ ...row, expectation: { changed: true } }));
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks }));
  // Same public inputs, a changed answer key and a changed agent: two dimensions.
  expect(derived()).toEqual({ operation: "new-baseline", moved: ["harness", "scoring"] });
  writeFileSync(
    join(candidate, "agent/BUILT_AGENTS.md"),
    readFileSync(join(base, "agent/BUILT_AGENTS.md"), "utf8"),
  );
  expect(derived()).toEqual({ operation: "evaluation-correction", moved: ["scoring"] });
  // Renaming every task id keeps the public inputs, so the changed answer key still reads as scoring.
  const renamed = tasks.map((task) => ({ ...task, taskId: `${task.taskId}-renamed` }));
  const renamedControls = JSON.parse(
    readFileSync(join(candidate, "correctness-model/controls.json"), "utf8"),
  );
  for (const row of [...renamedControls.accept, ...renamedControls.reject]) {
    row.taskId = `${row.taskId}-renamed`;
  }
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks: renamed }));
  writeFileSync(join(candidate, "correctness-model/controls.json"), JSON.stringify(renamedControls));
  expect(derived()).toEqual({ operation: "evaluation-correction", moved: ["scoring"] });
  writeFileSync(
    join(candidate, "correctness-model/controls.json"),
    readFileSync(join(base, "correctness-model/controls.json"), "utf8"),
  );
  // A new task brings its own expectations; retained tasks keep theirs, so this is a task probe.
  const probe = [
    ...structuredClone(MATCHING_TASKS),
    { ...structuredClone(retained), taskId: "added-task", publicInput: { differentCondition: true } },
  ];
  writeFileSync(join(candidate, CORRECTNESS_MODEL_TASKS_JSON), JSON.stringify({ tasks: probe }));
  expect(derived()).toEqual({ operation: "task-probe", moved: ["tasks"] });
  const controls = JSON.parse(readFileSync(join(candidate, "correctness-model/controls.json"), "utf8"));
  const bound = required(
    controls.accept.find((row: { taskId: string }) => row.taskId === retained.taskId),
    "retained accept control",
  );
  bound.id = `${bound.id}-renamed`;
  writeFileSync(join(candidate, "correctness-model/controls.json"), JSON.stringify(controls));
  expect(derived()).toEqual({ operation: "new-baseline", moved: ["tasks", "scoring"] });
  writeFileSync(join(candidate, "correctness-model/controls.json"), "{");
  expect(derived()).toMatchObject({
    operation: "new-baseline",
    unproven: expect.stringContaining("unreadable"),
  });
});
