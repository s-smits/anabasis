/**
 * Experiment attribution read off two frozen trees (src/run/experiment-freeze.ts) and the admission
 * rules a declared experiment meets (src/gate/experiment-admission.ts): accepted bytes, not the
 * proposal, decide whether a continuation is a build, an evaluation correction or a task-only
 * climb; an unverified claim of unchanged conditions is recorded as unproven; and every refusal of
 * the declared scope names its code. Each case compares a candidate with a base built from the
 * matching fixture. Their composition through a real submit, census and F2 belongs to
 * experiment-intent.e2e.test.ts.
 */
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { afterAll, expect, it } from "bun:test";
import { double, required } from "./helpers/doubles.ts";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
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
import type { FeedbackOwner } from "../src/author/campaign-types.ts";
import {
  type AdmissionInput,
  admissionFindings,
  experimentOperation,
} from "../src/gate/experiment-admission.ts";
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

const codesOf = (snapshot: CandidateSnapshot, input: AdmissionInput) =>
  admissionFindings(snapshot, input).map((finding) => finding.code);

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

it("reads a base conformance record without its verifier identity as no fixed product", () => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  writeTasks(candidate, movedBattery());
  writeBoundRepresentation(candidate);
  const tasksScope = snapshotOf(candidate, 0, "tasks");
  expect(codesOf(tasksScope, { adoptedDir: base })).toEqual([]);
  const path = join(base, "conformance.json");
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  delete evidence.verifierEnvironmentHash;
  writeFileSync(path, JSON.stringify(evidence));
  expect(experimentFreeze({ kind: "climb", baseDir: base, candidateDir: candidate })).toEqual({
    state: "unproven",
    clauses: [expect.stringContaining("submission-schema-unverifiable")],
  });
  expect(codesOf(tasksScope, { adoptedDir: base })).toEqual(["experiment-scope-mismatch"]);
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
  writeTasks(base, movedBattery());
  bindBaselineRepresentation(base);
  // Another product's reading of the same exam leaves it open to this one.
  const otherProduct = {
    adoptedDir: base,
    priorPublicTaskFingerprints: [productConditionFingerprint("other", measured)],
  };
  const input = {
    adoptedDir: base,
    priorPublicTaskFingerprints: [productConditionFingerprint(productOf(base), measured)],
  };
  expect(codesOf(snapshotOf(candidate), otherProduct)).toEqual([]);
  const repeat = admissionFindings(snapshotOf(candidate), input);
  expect(repeat.map((finding) => finding.code)).toEqual(["climb-battery-repeats-history"]);
  // The refusal names the comparison it made. `publicBatteryFingerprint` hashes the public inputs,
  // so a claim about batteries that moved only their published magnitudes would describe a reading
  // this check cannot take.
  expect(repeat[0]?.detail).toContain("byte-identical to a battery in the admitted history");
  expect(repeat[0]?.detail).not.toContain("magnitudes");
  writeFileSync(join(candidate, GUIDE), "A changed solving method.");
  expect(codesOf(snapshotOf(candidate), input)).toEqual([]);
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

// A round can declare it repaired the reference solve while that file stays byte-identical to the
// one the last round submitted. Nothing else reads the declared change against the snapshot, so
// without this refusal the claimed repair simply never happened and the round is recorded as
// though it had. The refusal is session-local: the author resolves it without new bytes.
it("refuses a change that names only files the accepted bytes left byte-identical", () => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  writeFileSync(join(candidate, GUIDE), "A changed solving method.");
  const codes = (change: string, input: AdmissionInput = { adoptedDir: base }) =>
    codesOf(snapshotOf(candidate, 0, "product", change), input);
  expect(codes("Repaired correctness-model/reference/index.ts to solve rather than look up.")).toEqual([
    "experiment-change-unmoved",
  ]);
  // The battery pair is hashed together and sits outside correctnessModelFiles.
  expect(codes("Rewrote correctness-model/tasks.json.")).toEqual(["experiment-change-unmoved"]);
  // Prose that names no file makes no claim about bytes, a path neither bundle carries proves
  // nothing either way, and one moved file settles it, so naming an unchanged file for context is
  // not a false declaration.
  expect(codes("Repaired the reference solve.")).toEqual([]);
  expect(codes("Rewrote notes/plan.md.")).toEqual([]);
  expect(codes("Rewrote agent/BUILT_AGENTS.md, keeping correctness-model/reference/index.ts fixed.")).toEqual(
    [],
  );
  // Without an adopted baseline there is nothing to compare against.
  expect(codes("Repaired correctness-model/evaluator.ts.", {})).toEqual([]);
});

it("reports every independent proposal refusal at once", () => {
  // A tasks proposal on a moved product that also counts past its battery is wrong twice over.
  // Reporting the scope alone would make the author pay a second check to hear about the target.
  const { base, candidate } = pair();
  writeFileSync(join(candidate, GUIDE), "A changed solving method.");
  const slots = MATCHING_TASKS.length;
  const codes = (scope: "product" | "tasks", passes: number) =>
    codesOf(snapshotOf(candidate, passes, scope), { adoptedDir: base });
  expect(codes("tasks", slots + 1)).toEqual(["experiment-scope-mismatch", "experiment-target-unreachable"]);
  expect(codes("tasks", slots)).toEqual(["experiment-scope-mismatch"]);
  expect(codes("product", slots + 1)).toEqual(["experiment-target-unreachable"]);
  expect(codes("product", slots)).toEqual([]);
});

// A product finding owed by the adopted product cannot be answered by a new battery, whatever scope
// the proposal declares; findings a battery serves, and an evaluation correction answering an
// evaluation finding, owe nothing more.
it.each<[string, "tasks" | "product", FeedbackOwner, "battery" | "controls", string[]]>([
  [
    "a tasks-scope battery change under an evaluation finding",
    "tasks",
    "correctness-model",
    "battery",
    ["experiment-product-repair-required"],
  ],
  [
    "a product-scope battery change under a brief finding",
    "product",
    "brief",
    "battery",
    ["experiment-product-repair-required"],
  ],
  ["a battery change under a finding the battery serves", "tasks", "tests", "battery", []],
  ["a controls correction under an evaluation finding", "product", "correctness-model", "controls", []],
])("asks for an owed product repair: %s", (_title, scope, owner, moved, expected) => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  if (moved === "battery") writeTasks(candidate, movedBattery());
  else touchControls(candidate);
  const feedback = [{ owner, severity: "blocking" as const, claim: "Repair it.", evidence: "admitted.json" }];
  expect(codesOf(snapshotOf(candidate, 0, scope), { adoptedDir: base, feedback })).toEqual(expected);
});

// After a battery that found no limit, a plan that declares a climb must declare a new move for at
// least one family; the comparison is between declarations, not difficulty.
it("refuses a climb after a no-limit battery whose families all repeat the last plan's moves", () => {
  const { base, candidate } = pair();
  bindBaselineRepresentation(base);
  writeTasks(candidate, movedBattery());
  const climb = (change: string) => snapshotOf(candidate, 1, "product", change);
  const plan = required(climb("Earlier magnitudes.").experimentProposal, "plan");
  const lastBattery = { noLimit: true, passed: 3, verified: 3, plan };
  // Hostile: only the magnitudes changed, and every family declares the move it declared before.
  const repeated = admissionFindings(climb("Larger magnitudes."), { adoptedDir: base, lastBattery });
  expect(repeated.map((finding) => finding.code)).toEqual(["climb-battery-repeats-history"]);
  expect(repeated[0]?.detail).toMatch(
    /^The last battery passed 3 of 3 verified cases and found no limit, .* This compares the declared moves, not semantic difficulty/,
  );
  // Positive: one family names a new move.
  const { digest: _digest, ...rest } = {
    ...plan,
    families: plan.families.map((row) => ({ ...row, move: "An earlier choice now forecloses a later one." })),
  };
  const moved = {
    ...climb("Larger magnitudes."),
    experimentProposal: { ...rest, digest: hashJsonValue(rest) },
  };
  expect(codesOf(moved, { adoptedDir: base, lastBattery })).toEqual([]);
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
