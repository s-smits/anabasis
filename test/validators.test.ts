import { describe, expect, it } from "bun:test";
import { validateBrief } from "../src/truth/brief-validator.ts";
import { type Brief, applicableTruthChecks, projectFindingForAuthor } from "../src/truth/brief.ts";
import { loadFailureFinding } from "../src/truth/load-fault.ts";
import { normalizeToolsSpec, validateToolsSpec } from "../src/truth/tools-spec.ts";
import { validateTasks } from "../src/truth/tasks.ts";
import { double, required } from "./helpers/doubles.ts";
import { resolveJsonPath } from "../src/meta/json-evidence.ts";
import { checkPublicInputs } from "../vendor/correctness-model-bundle/evaluation-public-task.ts";

function greenBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    correctnessContract: "check-program/v1",
    slug: "s1",
    domain: "catalog",
    decisions: ["catalog choice is a writer decision"],
    gates: ["submit blocks on missing source"],
    truthChecks: ["ghost-ref", "slot-binding"].map((id, index) => {
      const check: Brief["truthChecks"][number] = {
        id,
        assertion: "every reference endpoint joins a declared source entity",
        execution: {
          families: [index === 0 ? "a" : "b"],
          artifactPaths: ["$.good"],
          publicInputPaths: [],
          hidden: "required",
          evidence: { kind: "authored" },
        },
      };
      if (index === 0) check.joinIds = ["parts-to-slots"];
      return check;
    }),
    joins: [
      {
        id: "parts-to-slots",
        description: "declared parts joined to slots by exact id",
        decoyClasses: ["alias-swap", "ghost-entity"],
      },
    ],
    artifactSchema: [{ name: "good", "shape": "boolean flag" }],
    designRuleConstants: [
      {
        name: "max-batch-size",
        value: 220,
        unit: "items",
        authority: "vendor spec",
        citation: "Vendor Spec v2, s.3",
      },
    ],
    ...overrides,
  };
}
const codes = (r: { findings: { code: string }[] }) => r.findings.map((f) => f.code);
const task = (taskId: string, family: string, checkId: string) => ({
  taskId,
  family,
  publicInput: {},
  hidden: [{ checkId, expectation: true }],
});

describe("brief and task contract", () => {
  it("accepts a valid brief", () => {
    expect(validateBrief(greenBrief()).ok).toBe(true);
  });
  it("binds family applicability, required hidden data and complete declared-check coverage", () => {
    const brief = greenBrief();
    const tasks = [task("aa", "a", "ghost-ref"), task("bb", "b", "slot-binding")];
    expect(validateTasks(brief, { tasks }).ok).toBe(true);
    expect(applicableTruthChecks(brief, { family: "a" }).map((check) => check.id)).toEqual(["ghost-ref"]);
    expect(codes(validateTasks(brief, { tasks: [{ ...tasks[0], hidden: [] }, tasks[1]] }))).toContain(
      "tasks-hidden-operand-missing",
    );
    expect(
      codes(
        validateTasks(brief, {
          tasks: [{ ...tasks[0], hidden: [{ checkId: "unknown", expectation: true }] }, tasks[1]],
        }),
      ),
    ).toContain("tasks-undeclared-check");
    const noFamily = validateTasks(brief, {
      tasks: [tasks[0], { ...tasks[1], family: "uncovered", hidden: [] }],
    });
    expect(codes(noFamily)).toEqual(
      expect.arrayContaining(["tasks-no-applicable-checks", "tasks-check-family-unbound"]),
    );
    // "slot-binding" is scoped to family "b"; a battery whose tasks are all "a" never runs it.
    const unbound = validateTasks(brief, {
      tasks: [tasks[0], { ...tasks[1], family: "a", hidden: [{ checkId: "ghost-ref", expectation: true }] }],
    });
    expect(codes(unbound)).toContain("tasks-check-family-unbound");
    expect(unbound.findings.find((f) => f.code === "tasks-check-family-unbound")?.detail).toContain(
      '"slot-binding"',
    );
  });
  it("admits safe task identities and refuses path-like and duplicate ones", () => {
    const brief = greenBrief();
    const second = task("bb", "b", "slot-binding");
    expect(validateTasks(brief, { tasks: [task("aa_1.2-3", "a", "ghost-ref"), second] }).ok).toBe(true);
    for (const id of ["../escape", "x", ".", "..", "has space"]) {
      expect(codes(validateTasks(brief, { tasks: [task(id, "a", "ghost-ref"), second] }))).toContain(
        "tasks-id-unsafe",
      );
    }
    expect(codes(validateTasks(brief, { tasks: [task("bb", "a", "ghost-ref"), second] }))).toContain(
      "tasks-duplicate-id",
    );
  });
  it("names the missing keys of a malformed object row", () => {
    const brief = greenBrief();
    const row = { name: "gamma-m0", value: 1, unit: "-", authority: "EN 1993-1-1" };
    Object.assign(brief, { designRuleConstants: [row] });
    const detail = validateBrief(brief).findings.find((f) => f.path === "designRuleConstants[0]")?.detail;
    expect(detail).toStartWith("missing citation; expected ");
    expect(detail).toContain("got an object with keys [name, value, unit, authority]");
  });
  it("names unexpected execution and evidence keys before the expected shape", () => {
    const brief = greenBrief();
    const check = required(brief.truthChecks[0], "first check");
    Object.assign(check.execution, { numericBoundaries: [] });
    const detail = (path: string) => validateBrief(brief).findings.find((f) => f.path === path)?.detail ?? "";
    expect(detail("truthChecks[0].execution")).toStartWith(
      'unexpected numericBoundaries; expected {"families"',
    );
    expect(detail("truthChecks[0].execution")).toContain('"numericBoundaries" sit beside execution');
    Reflect.deleteProperty(check.execution, "numericBoundaries");
    Object.assign(check.execution.evidence, { requiredToolIds: ["python3"] });
    expect(detail("truthChecks[0].execution.evidence")).toStartWith("unexpected requiredToolIds; expected ");
    check.execution.evidence = { kind: "external", requiredToolIds: ["python3"] };
    expect(detail("truthChecks[0].execution.evidence")).toBe("");
  });
  it("lets a check declare one file of a file map through a quoted key, and projects only that file", () => {
    const brief = greenBrief();
    const check = required(brief.truthChecks[0], "first check");
    check.execution.artifactPaths = ["$.good['main.cpp']"];
    expect(validateBrief(brief).ok).toBe(true);
    check.execution.artifactPaths = ['$["good"]'];
    expect(validateBrief(brief).ok).toBe(true);
    const artifact = { good: { "main.cpp": "loop", "other.h": "secret" } };
    check.execution.artifactPaths = ["$.good['main.cpp']"];
    const publicTask = { taskId: "t", family: "f", publicInput: {} };
    expect(checkPublicInputs(check, { artifact, publicTask }).artifact).toEqual({
      good: { "main.cpp": "loop" },
    });
    expect(resolveJsonPath(artifact, '$.good["main.cpp"]')).toEqual({ found: true, value: "loop" });
    // The quoted step is one key: it never splits into `.main` then `.cpp`.
    expect(resolveJsonPath(artifact, "$.good.main.cpp").found).toBe(false);
    check.execution.artifactPaths = ["$['missing.x']"];
    expect(codes(validateBrief(brief))).toContain("brief-check-artifact-root-undeclared");
    for (const malformed of [
      "$.good['']",
      String.raw`$.good['a\'b']`,
      "$.good['main.cpp'",
      "$.good[main.cpp]",
    ]) {
      check.execution.artifactPaths = [malformed];
      expect(codes(validateBrief(brief))).toContain("brief-check-path-invalid");
    }
  });

  it("binds numeric witnesses, artifact roots and joins to their exact declarations", () => {
    const brief = greenBrief();
    const check = required(brief.truthChecks[0], "first check");
    check.execution.publicInputPaths = ["$.batchSize"];
    check.numericBoundaries = [{ publicInputPath: "$.batchSize", constantName: "max-batch-size" }];
    expect(validateBrief(brief).ok).toBe(true);
    expect(
      codes(validateTasks(brief, { tasks: [task("aa", "a", "ghost-ref"), task("bb", "b", "slot-binding")] })),
    ).toContain("tasks-public-rule-path-missing");
    check.numericBoundaries[0] = { publicInputPath: "$.batchSize", constantName: "missing" };
    expect(codes(validateBrief(brief))).toContain("brief-numeric-boundary-constant-invalid");
    check.numericBoundaries[0] = { publicInputPath: "$.limits.batchSize", constantName: "max-batch-size" };
    expect(validateBrief(brief).ok).toBe(true);
    delete check.numericBoundaries;
    check.execution.artifactPaths = ["$.missing"];
    expect(codes(validateBrief(brief))).toContain("brief-check-artifact-root-undeclared");
    check.execution.artifactPaths = ["$.good"];
    // Gate audit 2026-09-25 (docs/gate-audit.md, brief-artifact-root-unread): commented out (unsure): an
    // artifact root no check declares it reads is refused by static rule; unsure a declared path proves a
    // root is measured, or its absence that it is not.
    // brief.artifactSchema.push({ name: "unused", "shape": "string" });
    // expect(codes(validateBrief(brief))).toContain("brief-artifact-root-unread");
    check.joinIds = ["unknown"];
    expect(codes(validateBrief(brief))).toEqual(
      expect.arrayContaining(["brief-check-join-undeclared", "brief-join-check-ownership-invalid"]),
    );
  });
  it("admits public runtime requirements without giving them verifier authority", () => {
    const brief = greenBrief();
    for (const check of brief.truthChecks) {
      check.execution.hidden = "none";
      check.execution.evidence = { kind: "external", requiredToolIds: ["checker"] };
    }
    expect(validateBrief(brief).ok).toBe(true);
    const tasks = [task("aa", "a", "ghost-ref"), task("bb", "b", "slot-binding")].map((row) => ({
      ...row,
      hidden: [],
    }));
    expect(validateTasks(brief, { tasks }).ok).toBe(true);
    expect(codes(validateTasks(brief, { tasks: [task("aa", "a", "ghost-ref"), tasks[1]] }))).toContain(
      "tasks-hidden-operand-unexpected",
    );
    for (const publicInput of [
      { compilerVersion: "1.2.3" },
      { note: "use compiler 1.2.3" },
      { support: { adapter: "int public_value() { return 4; }" } },
      { runtime: { engine: "requested target", cli: "public interface" } },
    ]) {
      expect(validateTasks(brief, { tasks: [{ ...tasks[0], publicInput }, tasks[1]] }).ok).toBe(true);
    }
    expect(brief.truthChecks.map((check) => check.execution.evidence)).toEqual([
      { kind: "external", requiredToolIds: ["checker"] },
      { kind: "external", requiredToolIds: ["checker"] },
    ]);
  });
  it("names the load failure's owner beside its full diagnostic", () => {
    // Loading runs only Builder-authored bytes, so the diagnostic is authored and crosses in full.
    const project = (detail: string) =>
      projectFindingForAuthor(
        loadFailureFinding(
          { code: "generated-module-load", path: "correctness-model/evaluator.ts", detail },
          "generated-correctness-model-load",
        ),
      );
    const denied = project("xcode-select: error: unable to read data link at '/var/select/developer_dir'");
    expect(denied.path).toBe("correctness-model/evaluator.ts");
    expect(denied.detail).toStartWith("generated-correctness-model-load; the operating system refused");
    expect(denied.detail).toContain("host fault");
    expect(denied.detail).toContain("developer_dir");

    // The bundler's boundary refusal leads with the rule, even for an @ana path.
    const escaped = project(
      "evaluator bundle failed: evaluator import outside its bundle or public contract: @ana/secret-helper",
    );
    expect(escaped.detail).toContain("reference/ is loaded alone");
    expect(escaped.detail).not.toContain("host fault");
    expect(escaped.detail).toContain("@ana/secret-helper");

    // An unrecognised message crosses behind its classification.
    expect(project("boom 0x41").detail).toBe("generated-correctness-model-load: boom 0x41");
  });
  const constant = (name: string, value: number, citation = "section 1") => ({
    name,
    value,
    authority: citation === "" ? "" : "standard",
    citation,
  });
  const join = (id: string, decoyClasses: string[]) => ({ id, description: "d", decoyClasses });
  const field = (overrides: Partial<Brief["artifactSchema"][number]>) => ({
    name: "verdict",
    "shape": "closed",
    ...overrides,
  });
  it.each<[string, Partial<Brief>, { code?: string; path?: string }]>([
    // Gate audit 2026-09-25 (docs/gate-audit.md, brief-constant-uncited): commented out (unsure): a
    // design-rule constant must name an authority and citation; unsure a non-empty string proves the value is
    // right.
    // [
    //   "an uncited constant",
    //   { designRuleConstants: [constant("x", 1, "")] },
    //   { code: "brief-constant-uncited" },
    // ],
    [
      "a duplicate constant name",
      { designRuleConstants: [constant("cap", 1), constant("cap", 2, "section 2")] },
      { code: "brief-duplicate-design-rule-constant" },
    ],
    [
      "a blank constant name",
      { designRuleConstants: [constant(" ", 1)] },
      { code: "brief-design-rule-constant-name-empty" },
    ],
    // Gate audit 2026-09-25 (docs/gate-audit.md, brief-join-no-decoys): commented out (unsure): a join must
    // declare at least one decoy class; unsure it earns a refusal, since no rule asks for a control of any
    // declared class.
    // ["a join without decoys", { joins: [join("j", [])] }, { code: "brief-join-no-decoys" }],
    [
      "a duplicate join id",
      { joins: [...greenBrief().joins, join("parts-to-slots", ["other"])] },
      { code: "brief-duplicate-join-id" },
    ],
    [
      "a duplicate decoy class",
      { joins: [join("parts-to-slots", ["alias-swap", "alias-swap"])] },
      { code: "brief-duplicate-decoy-class" },
    ],
    ["an empty artifact schema", { artifactSchema: [] }, { code: "brief-no-artifact-schema" }],
    [
      "a duplicate artifact field",
      { artifactSchema: [field({ name: "good" }), field({ name: "good" })] },
      { code: "brief-duplicate-artifact-field" },
    ],
    ...["plan.v2", "1plan", "with space"].map((name): [string, Partial<Brief>, { code: string }] => [
      `the unaddressable field name ${JSON.stringify(name)}`,
      { artifactSchema: [field({ name })] },
      { code: "brief-artifact-field-unaddressable" },
    ]),
    ...[[], [{ deep: true }], ["pass", "pass"]].map((values): [string, Partial<Brief>, { code: string }] => [
      `allowedValues ${JSON.stringify(values)}`,
      { artifactSchema: [field({ allowedValues: double<Array<string | number | boolean>>(values) })] },
      { code: "brief-artifact-field-allowed-values-invalid" },
    ]),
  ])("refuses %s", (_name, overrides, finding) => {
    expect(validateBrief(greenBrief(overrides)).findings).toContainEqual(expect.objectContaining(finding));
  });
  it("admits a closed value set", () => {
    const findings = validateBrief(
      greenBrief({ artifactSchema: [field({ allowedValues: ["pass", "fail"] })] }),
    ).findings;
    expect(findings.map((finding) => finding.code)).not.toContain(
      "brief-artifact-field-allowed-values-invalid",
    );
  });
  it("leaves the zero-truth-checks case to brief-no-truth-checks instead of firing per root", () => {
    const found = codes(validateBrief(greenBrief({ truthChecks: [] })));
    expect(found).toContain("brief-no-truth-checks");
    // Gate audit 2026-09-25 (docs/gate-audit.md, brief-artifact-root-unread): commented out (unsure): the
    // unread-root rule this assertion keeps quiet is commented out.
    // expect(found).not.toContain("brief-artifact-root-unread");
  });
  it("a brief in a foreign shape yields shape-mismatch findings naming the fields", () => {
    // Parseable JSON without the required Brief fields.
    const result = validateBrief({
      correctnessContract: "check-program/v1",
      overview: "rostering",
      constraints: ["rest"],
    });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("shape-mismatch");
    expect(result.findings.map((f) => f.path)).toContain("decisions");
  });
  it("a decision row that is not a non-empty string is a named finding", () => {
    // The static type promised string[]; runtime only checked "an array", so blank and object
    // rows validated and then read as prose wherever the coverage map is shown.
    const blank = validateBrief(greenBrief({ decisions: ["fine", "  "] }));
    expect(blank.ok).toBe(false);
    expect(blank.findings.map((f) => f.path)).toContain("decisions[1]");
    const wrongType = validateBrief({ ...greenBrief(), decisions: [{ note: "boxed" }] });
    expect(wrongType.ok).toBe(false);
    expect(wrongType.findings.map((f) => f.path)).toContain("decisions[0]");
  });
  it("non-object briefs are findings too", () => {
    expect(validateBrief(null).ok).toBe(false);
    expect(validateBrief([1, 2]).ok).toBe(false);
    expect(validateBrief("a brief").ok).toBe(false);
  });
  it("broken truth checks, joins, and constants are named by index", () => {
    const result = validateBrief({
      ...greenBrief(),
      truthChecks: ["ghost-ref"],
      joins: [{ id: "j" }],
      designRuleConstants: [{ name: "x", value: 1 }],
    });
    expect(result.findings.map((f) => f.path)).toEqual([
      "truthChecks[0]",
      "joins[0]",
      "designRuleConstants[0]",
    ]);
  });
  it("a battery without a tasks array, and broken tasks/expectations, are findings", () => {
    expect(codes(validateTasks(greenBrief(), { cases: [] }))).toContain("shape-mismatch");
    const result = validateTasks(greenBrief(), {
      tasks: [{ taskId: "t1" }, { taskId: "t2", family: "b", publicInput: {}, hidden: ["ghost-ref"] }],
    });
    expect(result.findings.map((f) => f.path)).toEqual(["tasks[0]", "tasks[1].hidden[0]"]);
  });
  it("rejects duplicate checkIds within one task instead of silently taking the first", () => {
    const brief = greenBrief();
    const result = validateTasks(brief, {
      tasks: [
        {
          taskId: "t1",
          family: "a",
          publicInput: {},
          hidden: [
            { checkId: "ghost-ref", expectation: "PASS" },
            { checkId: "ghost-ref", expectation: "FAIL" },
            { checkId: "slot-binding", expectation: "A" },
          ],
        },
        task("t2", "b", "slot-binding"),
      ],
    });
    expect(codes(result)).toContain("tasks-duplicate-expectation-check");
  });
});

describe("the tool contract agrees with the declared answer representation", () => {
  const spec = (
    presets: string[],
    tools: { name: string; kind: string; description: string; conformanceArguments?: unknown }[] = [],
  ) => ({
    presets,
    tools,
  });
  const writer = [
    { name: "prepare_answer", kind: "artifact-writer", description: "Prepares the submitted answer." },
  ];
  const specCodes = (value: unknown) => validateToolsSpec(value).findings.map((f) => f.code);

  // Candidate recording and runtime loading check the admitted data against the generated files,
  // so the spec owes only a tool that can prepare the answer.
  it("accepts either preparer regardless of the declared answer shape", () => {
    expect(specCodes(spec(["files"]))).toEqual([]);
    expect(specCodes({ ...spec([], writer), declined: { files: "answers are one number" } })).toEqual([]);
  });

  it("still names the missing preparer when a spec has neither", () => {
    expect(specCodes({ ...spec([]), declined: { files: "not this domain" } })).toEqual([
      "tools-artifact-writer-missing",
    ]);
  });

  it("reads a declined default preset and refuses a blank reason", () => {
    expect(specCodes(spec([], writer))).toEqual([]);
    // A blank reason is a shape defect, reported before the contract is read.
    expect(specCodes({ ...spec([], writer), declined: { files: "  " } })).toEqual(["shape-mismatch"]);
    expect(normalizeToolsSpec({ ...spec([], writer), declined: { files: "kept" } }).value).toEqual({
      ...spec([], writer),
      declined: { files: "kept" },
    });
  });

  it("keeps declared conformance arguments and refuses a non-object in their place", () => {
    const [row] = writer;
    if (row === undefined) throw new Error("fixture has a writer row");
    const declared = [{ ...row, conformanceArguments: { code: "ABC" } }];
    expect(specCodes(spec([], declared))).toEqual([]);
    expect(normalizeToolsSpec(spec([], declared)).value).toEqual(spec([], declared));
    expect(specCodes(spec([], [{ ...row, conformanceArguments: "ABC" }]))).toEqual(["shape-mismatch"]);
  });

  it("refuses an unknown key on a tool row", () => {
    const [row] = writer;
    if (row === undefined) throw new Error("fixture has a writer row");
    expect(validateToolsSpec({ presets: [], tools: [{ ...row, standard: true }] }).findings).toEqual([
      expect.objectContaining({ code: "shape-mismatch", path: "tools[0]" }),
    ]);
  });
});
