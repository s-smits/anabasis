/**
 * Experiment attribution read off two frozen trees (src/run/experiment-freeze.ts) and the operation
 * admission derives from them (src/gate/experiment-admission.ts): accepted bytes, not the proposal,
 * decide whether a continuation is a build, an evaluation correction or a task-only climb, and an
 * unverified claim of unchanged conditions is recorded as unproven. Each case compares a candidate
 * with a base built from the matching fixture. Their composition through a real submit, census and
 * F2 belongs to experiment-intent.e2e.test.ts.
 */
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { afterAll, expect, it } from "bun:test";
import { double, required } from "./helpers/doubles.ts";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { readBoundConformance } from "../src/claim/conformance-evidence.ts";
import {
  candidateExperimentAuthoring,
  candidateExperimentScope,
  experimentFreeze,
} from "../src/run/experiment-freeze.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import type { CandidateSnapshot } from "../src/author/candidate-check.ts";
import { experimentOperation } from "../src/gate/experiment-admission.ts";
import { loadValidatedBundle } from "../src/author/candidate-check.ts";
import { MATCHING_BRIEF, MATCHING_TASKS, writeMatchingBuildFixture } from "./helpers/matching-fixture.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import { loadSolvabilityPublicSchema } from "../src/truth/solvability-artifact-schema.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const TASKS_JSON = "correctness-model/tasks.json";
const CONTROLS_JSON = "correctness-model/controls.json";
const GUIDE = "agent/BUILT_AGENTS.md";

afterAll(cleanupScratch);

/** A controls-only correction: the calibration corpus moves, the scoring program does not. */
const touchControls = (dir: string) =>
  writeFileSync(join(dir, CONTROLS_JSON), readFileSync(join(dir, CONTROLS_JSON), "utf8") + "\n");

/** Two byte-identical matching trees, each with a bound representation. */
function pair() {
  const root = scratchDir("repair-experiment-");
  const base = join(root, "base");
  const candidate = join(root, "candidate");
  for (const dir of [base, candidate]) {
    writeMatchingBuildFixture(dir);
    writeFileSync(join(dir, TASKS_JSON), JSON.stringify({ tasks: MATCHING_TASKS }));
    writeBoundRepresentation(dir);
  }
  return { base, candidate };
}

/** Bind the base's conformance to the schema the candidate's accept controls compile, so an
 *  unchanged candidate keeps the adopted submission condition. */
function bindBaselineRepresentation(base: string): void {
  const schema = loadSolvabilityPublicSchema(base, MATCHING_BRIEF.artifactSchema);
  if (!schema.ok || schema.schema === null) throw new Error("fixture schema missing");
  writeBoundRepresentation(base, schema.schema.sha256);
}

const writeTasks = (dir: string, tasks: unknown[]) =>
  writeFileSync(join(dir, TASKS_JSON), JSON.stringify({ tasks }));

/** The matching battery with the first task's public input moved: a new public condition. */
function movedBattery() {
  const tasks = structuredClone(MATCHING_TASKS);
  required(tasks[0], "first task").publicInput = { differentCondition: true };
  return tasks;
}

/** An evaluator repair the scoring program sees: a new helper module the evaluator imports. A
 *  file nothing imports is not scoring, so writing one alone would repair nothing. */
function repairEvaluator(dir: string): void {
  writeFileSync(join(dir, "correctness-model/check-helper.ts"), "export const repair = true;\n");
  const evaluator = join(dir, "correctness-model/evaluator.ts");
  writeFileSync(evaluator, `import "./check-helper.ts";\n${readFileSync(evaluator, "utf8")}`);
}

/** A captured proposal, bound by its digest. */
function proposalOf(scope: "product" | "tasks", passes: number, change: string) {
  const proposal = {
    scope,
    target: { comparator: "at-least" as const, verifiedPasses: passes },
    gap: "Gap.",
    change,
    ...PLAN_FIELDS,
    expectedResult: "Result.",
  };
  return { ...proposal, digest: hashJsonValue(proposal) };
}

function snapshotOf(
  candidate: string,
  passes = 0,
  scope: "product" | "tasks" = "product",
  change = "Change.",
): CandidateSnapshot {
  const fingerprint = fingerprintSlug(candidate);
  if (!fingerprint.ok) throw new Error("fixture fingerprint refused");
  // The parts as parsed, validated or not: these cases move bytes a real submit would refuse, and
  // the operation is derived from what the bytes are.
  const { brief, battery, corpus, toolsSpec } = loadValidatedBundle(candidate, { slug: "matching" });
  return double<CandidateSnapshot>({
    snapshotDir: candidate,
    fingerprint,
    bundle: { brief, battery, corpus, toolsSpec },
    verifierEnvironmentHash: null,
    experimentProposal: proposalOf(scope, passes, change),
  });
}

it("records only changed public inputs and refuses drifted attribution", () => {
  const { base, candidate } = pair();
  const tasks = structuredClone(MATCHING_TASKS);
  const first = required(tasks[0], "first task");
  first.taskId = "renamed";
  first.family = "renamed-family";
  first.level = 42;
  required(tasks[1], "second task").publicInput = { changed: true };
  writeTasks(candidate, tasks);
  const captured = proposalOf("tasks", 0, "Change public input.");
  const probe = { operation: "task-probe" as const, moved: ["tasks" as const] };
  expect(candidateExperimentAuthoring(captured, probe, "climb", base, candidate).changedTaskIds).toEqual([
    required(tasks[1], "second task").taskId,
  ]);
  expect(candidateExperimentAuthoring(captured, probe, "build", base, candidate).changedTaskIds).toBeNull();
  writeFileSync(join(candidate, "agent/tools.ts"), "export const changed = true;");
  expect(() => candidateExperimentAuthoring(captured, probe, "climb", base, candidate)).toThrow(
    "drifted bytes",
  );
});

it("binds a fresh build's plan with no baseline, and still refuses a missing one for a climb", () => {
  // A fresh build has no adopted product, so its first battery's plan is recorded to be scored
  // with a null baseline rather than aborting the run.
  const { candidate } = pair();
  const absent = join(scratchDir("ana-no-adopted-"), "domain");
  const captured = proposalOf("tasks", 1, "Author the first battery.");
  const fresh = { operation: "new-baseline" as const, moved: [], unproven: "no adopted baseline" };
  expect(candidateExperimentAuthoring(captured, fresh, "build", absent, candidate)).toMatchObject({
    actual: "build",
    baseline: null,
    changedTaskIds: null,
  });
  expect(() => candidateExperimentAuthoring(captured, fresh, "climb", absent, candidate)).toThrow(
    "positively fingerprinted",
  );
});

it("reads a base conformance record without its verifier identity as no fixed product", () => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  writeTasks(candidate, movedBattery());
  writeBoundRepresentation(candidate);
  const path = join(base, "conformance.json");
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  delete evidence.verifierEnvironmentHash;
  writeFileSync(path, JSON.stringify(evidence));
  expect(experimentFreeze({ kind: "climb", baseDir: base, candidateDir: candidate })).toEqual({
    state: "unproven",
    clauses: [expect.stringContaining("submission-schema-unverifiable")],
  });
});

it.each(["helper", "hidden", "controls"] as const)(
  "retains evaluation attribution for a %s repair with unchanged public tasks, agent and schemas",
  (kind) => {
    const { base, candidate } = pair();
    if (kind === "helper") repairEvaluator(candidate);
    if (kind === "controls") touchControls(candidate);
    if (kind === "hidden") {
      const tasks = structuredClone(MATCHING_TASKS);
      required(required(tasks[0], "first task").hidden[0], "hidden row").expectation = {
        parts: ["corrected"],
      };
      writeTasks(candidate, tasks);
    }
    writeBoundRepresentation(candidate);
    expect(candidateExperimentScope("build", base, candidate, undefined, "product")).toEqual({
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
    if (kind === "private-rule") {
      expect(scope).toEqual({ actual: "evaluation", freeze: { state: "held", clauses: [] } });
      return;
    }
    expect(scope.actual).toBe("build");
    expect(scope.freeze?.clauses).toContainEqual(
      expect.stringContaining("evaluation-public-resources-drift"),
    );
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
    if (kind === "exam") writeTasks(candidate, movedBattery());
    writeBoundRepresentation(candidate, kind === "schema" ? "different-schema" : undefined);
    if (kind === "unreadable") {
      const path = join(base, TASKS_JSON);
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
    expect(scope.actual).toBe("build");
    expect(scope.freeze?.state).not.toBe("held");
  },
);

it.each(["tools", "tasks", "absent"] as const)(
  "refuses supplied conformance with %s proof missing or mismatched",
  (kind) => {
    const { base, candidate } = pair();
    touchControls(candidate);
    writeBoundRepresentation(candidate);
    const bound = required(readBoundConformance(candidate), "fixture conformance");
    const proof =
      kind === "absent"
        ? null
        : { ...bound, [kind === "tools" ? "toolsSpecHash" : "taskSetHash"]: "mismatched" };
    // A failed evaluation proof cannot become a held task-only proof through the proposal fallback.
    const scope = candidateExperimentScope("build", base, candidate, proof, "product");
    expect(scope.actual).toBe("build");
    expect(scope.freeze?.state).toBe("unproven");
    expect(scope.freeze?.clauses).toContainEqual(expect.stringContaining("submission-schema-unverifiable"));
  },
);

it("derives the operation from the dimensions the bytes moved", () => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  const derived = () => experimentOperation(snapshotOf(candidate), base);
  expect(derived()).toEqual({ operation: "repeat", moved: [] });
  expect(experimentOperation(snapshotOf(candidate), undefined)).toEqual({
    operation: "new-baseline",
    moved: [],
    unproven: "no adopted baseline",
  });
  writeFileSync(join(candidate, GUIDE), "A changed solving method.");
  expect(derived()).toEqual({ operation: "harness-intervention", moved: ["harness"] });
  writeTasks(candidate, movedBattery());
  // Harness and tasks both moved: a new baseline, which claims no attributable improvement.
  expect(derived()).toEqual({ operation: "new-baseline", moved: ["harness", "tasks"] });
});

// The scoring program is the brief and the evaluator with everything it imports, not every byte
// under correctness-model/. Reading the whole directory as scoring would mean a battery whose
// reference solve was rewritten to solve rather than look up could never be a task probe. The
// changed files are named either way.
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
  const added = {
    ...structuredClone(required(MATCHING_TASKS[0], "first task")),
    taskId: "added-task",
    publicInput: { differentCondition: true },
  };
  writeTasks(candidate, [...structuredClone(MATCHING_TASKS), added]);
  expect(derived()).toEqual({
    operation: "task-probe",
    moved: ["tasks"],
    correctnessModelChangedFiles: ["reference/index.ts"],
  });
  writeTasks(candidate, MATCHING_TASKS);
  restore("reference/index.ts");
  // A module the evaluator imports is scoring wherever it lives, reference/ included.
  const evaluator = readFileSync(join(base, "correctness-model/evaluator.ts"), "utf8");
  for (const dir of [base, candidate]) {
    rewrite(dir, "evaluator.ts", `import "./reference/shared.ts";\n${evaluator}`);
    rewrite(dir, "reference/shared.ts", "export const shared = 1;\n");
  }
  expect(derived()).toEqual({ operation: "repeat", moved: [] });
  const scoring = (file: string): ReturnType<typeof experimentOperation> => ({
    operation: "evaluation-correction",
    moved: ["scoring"],
    correctnessModelChangedFiles: [file],
  });
  rewrite(candidate, "reference/shared.ts", "export const shared = 2;\n");
  expect(derived()).toEqual(scoring("reference/shared.ts"));
  restore("reference/shared.ts");
  rewrite(
    candidate,
    "evaluator.ts",
    `${readFileSync(join(base, "correctness-model/evaluator.ts"), "utf8")}// changed\n`,
  );
  expect(derived()).toEqual(scoring("evaluator.ts"));
  restore("evaluator.ts");
  // Bun compiles every module under this file, though nothing imports it.
  rewrite(candidate, "tsconfig.json", '{"compilerOptions": {"useDefineForClassFields": false}}');
  expect(derived()).toEqual(scoring("tsconfig.json"));
});

it("reads a retained task's expectations and controls as scoring, and certifies no comparison without the baseline proof", () => {
  const { base, candidate } = pair();
  const derived = () => experimentOperation(snapshotOf(candidate), base);
  writeFileSync(join(candidate, GUIDE), "A changed solving method.");
  // Unknown is neither unchanged nor changed: without the bound baseline representation no
  // comparison is certified.
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
  writeTasks(candidate, reassigned);
  expect(derived()).toEqual({ operation: "new-baseline", moved: ["harness", "scoring"] });
  const tasks = structuredClone(MATCHING_TASKS);
  const retained = required(tasks[0], "first task");
  retained.hidden = retained.hidden.map((row) => ({ ...row, expectation: { changed: true } }));
  writeTasks(candidate, tasks);
  // Same public inputs, a changed answer key and a changed agent: two dimensions.
  expect(derived()).toEqual({ operation: "new-baseline", moved: ["harness", "scoring"] });
  writeFileSync(join(candidate, GUIDE), readFileSync(join(base, GUIDE), "utf8"));
  expect(derived()).toEqual({ operation: "evaluation-correction", moved: ["scoring"] });
  // Renaming every task id keeps the public inputs, so the changed answer key still reads as scoring.
  const renamedControls = JSON.parse(readFileSync(join(candidate, CONTROLS_JSON), "utf8"));
  for (const row of [...renamedControls.accept, ...renamedControls.reject]) {
    row.taskId = `${row.taskId}-renamed`;
  }
  writeTasks(
    candidate,
    tasks.map((task) => ({ ...task, taskId: `${task.taskId}-renamed` })),
  );
  writeFileSync(join(candidate, CONTROLS_JSON), JSON.stringify(renamedControls));
  expect(derived()).toEqual({ operation: "evaluation-correction", moved: ["scoring"] });
  writeFileSync(join(candidate, CONTROLS_JSON), readFileSync(join(base, CONTROLS_JSON), "utf8"));
  // A new task brings its own expectations; retained tasks keep theirs, so this is a task probe.
  const added = {
    ...structuredClone(retained),
    taskId: "added-task",
    publicInput: { differentCondition: true },
  };
  writeTasks(candidate, [...structuredClone(MATCHING_TASKS), added]);
  expect(derived()).toEqual({ operation: "task-probe", moved: ["tasks"] });
  const controls = JSON.parse(readFileSync(join(candidate, CONTROLS_JSON), "utf8"));
  const bound = required(
    controls.accept.find((row: { taskId: string }) => row.taskId === retained.taskId),
    "retained accept control",
  );
  bound.id = `${bound.id}-renamed`;
  writeFileSync(join(candidate, CONTROLS_JSON), JSON.stringify(controls));
  expect(derived()).toEqual({ operation: "new-baseline", moved: ["tasks", "scoring"] });
  writeFileSync(join(candidate, CONTROLS_JSON), "{");
  expect(derived()).toMatchObject({
    operation: "new-baseline",
    unproven: expect.stringContaining("unreadable"),
  });
});
