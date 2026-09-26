import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import type { Brief } from "../src/correctness-bundle/brief.ts";
import { validateBrief } from "../src/correctness-bundle/brief-validator.ts";
import { judgeSubject } from "../src/review/judge.ts";
import {
  PUBLIC_RESOURCES_TOOL,
  briefPublicResources,
  judgePublicDomainOf,
  judgePublicTaskOf,
  publicResourcesTool,
  readPublicResources,
} from "../src/correctness-bundle/public-resources.ts";
import { normalizeToolsSpec, validateToolsSpec } from "../src/correctness-bundle/tools-spec.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";
import { double } from "./helpers/doubles.ts";

/** A card context with no request and no tools-spec, for cases about the brief's projection. */
const BRIEF_ONLY = {
  publicRequest: null,
  toolContract: null,
  runtimeFacts: {
    capabilities: [],
    maxSubmitAttempts: 1,
    condition: { variant: "shipping", advisorsRemoved: [], toolInterfaceHash: null },
  },
};

const ROOT = mkdtempSync(join(import.meta.dir, ".ana-scratch-public-resources-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const BRIEF: Brief = structuredClone(MATCHING_BRIEF);
/** A brief, or the fragment a case writes to prove an invalid one is ignored. */
function workspaceWithBrief(brief: Partial<Brief>, name: string): string {
  const dir = join(ROOT, name);
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(join(dir, "correctness-model", "brief.json"), JSON.stringify(brief));
  return dir;
}

describe("public brief resources", () => {
  it("keeps protected brief changes out of the public Judge context", () => {
    const context = {
      publicRequest: "build matching assignments",
      toolContract: {
        presets: [],
        declined: { files: "fixture without a shell" },
        tools: [{ name: "bind", kind: "artifact-writer", description: "Prepare assignments." }],
        availableToolNames: ["bind", "submit"],
      },
      runtimeFacts: {
        capabilities: ["web-search:off"],
        maxSubmitAttempts: 3,
        condition: { variant: "shipping", advisorsRemoved: [], toolInterfaceHash: null },
      },
    };
    const publicCard = judgePublicDomainOf(BRIEF, context);
    // The rows carry a field the brief type does not name, so the card must drop protected detail
    // it cannot recognise as well as the detail it can.
    const protectedChanged = judgePublicDomainOf(
      double<Brief>({
        ...BRIEF,
        truthChecks: BRIEF.truthChecks.map((check) => ({ ...check, protected: "different verifier rule" })),
        joins: [{ protected: "different hidden join" }],
      }),
      context,
    );
    expect(protectedChanged).toEqual(publicCard);
    expect(publicCard).toMatchObject({
      publicRequest: "build matching assignments",
      toolContract: { availableToolNames: ["bind", "submit"] },
      runtimeFacts: { capabilities: ["web-search:off"], maxSubmitAttempts: 3 },
    });
    expect(JSON.stringify(publicCard)).not.toContain("different verifier rule");
  });

  it("returns only declared public resources", () => {
    const resources = briefPublicResources(BRIEF);
    expect(resources.map((resource) => resource.name)).toEqual([
      "public-validity-rules",
      "public-rule-decisions",
      "artifact-schema",
      "design-rule-constants",
    ]);
    expect(resources[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(resources);
    expect(serialized).toContain("max-slots-per-part");
    for (const privateField of ["truthChecks", "expectationPath", "predicate", "joins", "gates"]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it("gives the solver the same artifact schema the Judge card carries", () => {
    const schemaResource = briefPublicResources(BRIEF).find(({ name }) => name === "artifact-schema");
    expect(schemaResource?.content).toEqual(judgePublicDomainOf(BRIEF, BRIEF_ONLY).artifactSchema);
    // The card keeps the schema as its own field; the resource list must not repeat it there.
    expect(judgePublicDomainOf(BRIEF, BRIEF_ONLY).publicResources.map(({ name }) => name)).not.toContain(
      "artifact-schema",
    );
  });

  it("keeps brief.decisions coverage notes out of solver and Judge resources", () => {
    // The Judge-only `design-decisions` resource (added after run 69's missed derived-field
    // rules) was an unvalidated Builder free-text surface the solver never saw: a rule only the
    // Judge receives is not a shared public condition, and unvalidated instructions could enter
    // through that field. Decisions describe coverage; both readers get declared rules from
    // truthChecks, designRuleConstants and designRuleSets.
    expect(judgePublicDomainOf(BRIEF, BRIEF_ONLY).publicResources.map(({ name }) => name)).not.toContain(
      "design-decisions",
    );
    expect(briefPublicResources(BRIEF).map(({ name }) => name)).not.toContain("design-decisions");
    // Changing decisions must leave resource digests unchanged for both readers.
    const reworded = structuredClone(BRIEF);
    reworded.decisions = ["a completely different coverage note"];
    expect(judgePublicDomainOf(reworded, BRIEF_ONLY).publicResources).toEqual(
      judgePublicDomainOf(BRIEF, BRIEF_ONLY).publicResources,
    );
    expect(briefPublicResources(reworded)).toEqual(briefPublicResources(BRIEF));
  });

  it("projects public assertions and paths without changing the final Judge digest for protected detail", async () => {
    const withRule = structuredClone(BRIEF);
    const rule = withRule.truthChecks[0];
    if (rule === undefined) throw new Error("fixture lost its first truth check");
    rule.execution.publicInputPaths = ["$.parts"];
    withRule.truthChecks = [rule];
    const resources = briefPublicResources(withRule);
    expect(resources.map((resource) => resource.name)).toEqual([
      "public-validity-rules",
      "public-rule-decisions",
      "artifact-schema",
      "design-rule-constants",
    ]);
    expect(resources[0]?.content).toEqual([{ assertion: rule.assertion, publicInputPaths: ["$.parts"] }]);
    expect(judgePublicDomainOf(withRule, BRIEF_ONLY).publicResources.map(({ name }) => name)).not.toContain(
      "public-validity-rules",
    );
    const serialized = JSON.stringify(resources[0]);
    for (const hidden of [rule.id, "predicate", "expectationPath", "checkId"]) {
      expect(serialized).not.toContain(hidden);
    }

    const protectedChanged = structuredClone(withRule);
    const changed = protectedChanged.truthChecks[0];
    if (changed === undefined) throw new Error("fixture lost its first truth check");
    changed.id = "internal-identity-changed";
    changed.execution.artifactPaths = ["$.assignments[0]"];
    changed.execution.hidden = "none";
    expect(briefPublicResources(protectedChanged)[0]).toEqual(resources[0]);

    const originalTask = judgePublicTaskOf(withRule, {
      taskId: "public-task",
      family: "matching",
      publicInput: { parts: ["alpha"] },
      hidden: [{ checkId: rule.id }],
    });
    const protectedChangedTask = judgePublicTaskOf(protectedChanged, {
      taskId: "public-task",
      family: "matching",
      publicInput: { parts: ["alpha"] },
      hidden: [{ checkId: changed.id }],
    });
    expect(JSON.stringify(protectedChangedTask)).toBe(JSON.stringify(originalTask));

    const judgeDigest = async (brief: Brief, publicTask: typeof originalTask) =>
      judgeSubject(
        {
          pin: "scripted/judge",
          invoke: async (input) => {
            expect(input.publicContext.publicTask).toEqual(publicTask);
            return {
              verdict: true,
              abstained: false,
              rationale: "the public artifact follows the public task",
              rules: [],
              error: null,
              errorKind: null,
              turns: 1,
            };
          },
        },
        {
          subjectId: "public-task",
          publicContext: {
            domain: judgePublicDomainOf(brief, BRIEF_ONLY),
            publicTask,
          },
          submittedArtifact: { assignments: [{ part: "alpha", slot: "s1" }] },
        },
        "battery-case",
      );
    const originalEvidence = await judgeDigest(withRule, originalTask);
    const protectedChangedEvidence = await judgeDigest(protectedChanged, protectedChangedTask);
    if (
      originalEvidence.schema !== "judge-subject/v3" ||
      protectedChangedEvidence.schema !== "judge-subject/v3"
    ) {
      throw new Error("judgeSubject did not return its current digest-bearing schema");
    }
    expect(protectedChangedEvidence.publicContextDigest).toBe(originalEvidence.publicContextDigest);
    expect(protectedChangedEvidence.judgeInputDigest).toBe(originalEvidence.judgeInputDigest);
  });

  it("binds the applicable public rule to each affected Judge task without internal truth detail", () => {
    const brief = structuredClone(BRIEF);
    const rule = brief.truthChecks[0];
    if (rule === undefined) throw new Error("fixture lost its first truth check");
    rule.execution.publicInputPaths = ["$.parts"];
    brief.truthChecks = [rule];
    const taskIds = ["fault-01", "fault-02", "fault-04", "fault-07", "fault-08"];
    const projected = taskIds.map((taskId) =>
      judgePublicTaskOf(brief, {
        taskId,
        family: "fault-isolation",
        publicInput: { parts: ["alpha"] },
        hidden: [{ checkId: rule.id }],
      }),
    );
    expect(projected.map((task) => task.publicValidityRules)).toEqual(
      taskIds.map(() => [{ assertion: rule.assertion, publicInputPaths: ["$.parts"] }]),
    );
    const serialized = JSON.stringify(projected);
    for (const protectedDetail of [rule.id, "predicate", "grounding", "expectation", "checkId"]) {
      expect(serialized).not.toContain(protectedDetail);
    }
  });

  it("publishes applicable rules without relying on hidden marker rows", () => {
    expect(
      judgePublicTaskOf(BRIEF, {
        taskId: "legacy-task",
        family: "matching",
        publicInput: { parts: ["alpha"] },
        hidden: [],
      }),
    ).toEqual({
      taskId: "legacy-task",
      family: "matching",
      publicInput: { parts: ["alpha"] },
      publicValidityRules: BRIEF.truthChecks.map((check) => ({
        assertion: check.assertion,
        publicInputPaths: check.execution.publicInputPaths,
      })),
    });
  });

  // Visibility determines which rule decisions are public. A private row must be absent from
  // both readers; public rules need a separate declaration that both receive.
  it("withholds a private rule decision from the solver and the Judge", () => {
    const withPrivate: Brief = {
      ...BRIEF,
      ruleDecisions: [{ id: "scan-order", visibility: "private", statement: "bind the scarcest slot first" }],
    };
    const serialized = JSON.stringify([
      briefPublicResources(withPrivate),
      judgePublicDomainOf(withPrivate, BRIEF_ONLY),
    ]);
    expect(serialized).not.toContain("scan-order");
    expect(serialized).not.toContain("scarcest");
    expect(briefPublicResources(withPrivate).map(({ name }) => name)).not.toContain("public-rule-decisions");
  });

  // A public rule decision reaches both the solver and the Judge. This shared resource replaces
  // the old decisions resource that only the Judge could read.
  it("gives the solver and the Judge the public rule decisions", () => {
    const resource = briefPublicResources(BRIEF).find(({ name }) => name === "public-rule-decisions");
    if (resource === undefined) throw new Error("the fixture declares one public rule decision");
    expect(resource.content).toEqual([
      {
        id: "binding-completeness",
        visibility: "public",
        families: ["single-part", "two-part"],
        statement:
          "each declared part appears exactly once in assignments, bound to the slot the task's bindings table names for it",
        publicInputPaths: ["$.parts", "$.bindings"],
      },
    ]);
    expect(judgePublicDomainOf(BRIEF, BRIEF_ONLY).publicResources).toContainEqual(resource);
  });

  // Every published resource is a fresh object built from the declared fields. A brief is
  // Builder-authored JSON, so a row may carry a key no type names; returning the authored object
  // would expose those extra bytes to the solver and Judge. Add an undeclared key to each row
  // type and use one marker to detect whether either public producer copies it.
  it("publishes no undeclared field from any brief row", () => {
    const smuggled = "SMUGGLED-REFERENCE-ARTIFACT-BYTES";
    const planted = double<Brief>({
      ...BRIEF,
      ruleDecisions: [{ ...BRIEF.ruleDecisions?.[0], referenceArtifact: smuggled }],
      truthChecks: BRIEF.truthChecks.map((check) => ({
        ...check,
        execution: { ...check.execution, publicInputPaths: ["$.parts"] },
        verifierOutput: smuggled,
      })),
      artifactSchema: BRIEF.artifactSchema.map((field) => ({ ...field, verifierOutput: smuggled })),
      designRuleConstants: BRIEF.designRuleConstants.map((constant) => ({
        ...constant,
        verifierOutput: smuggled,
      })),
      designRuleSets: [
        {
          name: "legal-modes",
          values: ["a", "b"],
          authority: "vendor spec",
          citation: "s.2",
          verifierOutput: smuggled,
        },
      ],
    });
    const published = JSON.stringify([
      briefPublicResources(planted),
      judgePublicDomainOf(planted, BRIEF_ONLY),
    ]);
    expect(published).not.toContain(smuggled);
    expect(published).not.toContain("verifierOutput");
    expect(published).not.toContain("referenceArtifact");
    // Declared fields must still reach the readers; an empty result would pass the checks above.
    expect(published).toContain("binding-completeness");
    expect(published).toContain("max-slots-per-part");
    expect(published).toContain("legal-modes");
    expect(published).toContain("assignments");
  });

  // The validator also refuses undeclared rule-decision fields before public resources are built.
  // This checks admission separately from the field selection exercised above.
  it("refuses a rule-decision row that carries an undeclared field", () => {
    const result = validateBrief({
      ...BRIEF,
      ruleDecisions: [{ ...BRIEF.ruleDecisions?.[0], referenceArtifact: "reference bytes" }],
    });
    if (result.ok) throw new Error("expected the undeclared rule-decision field to be refused");
    expect(result.findings.map((finding) => finding.code)).toContain("brief-decision-undeclared-field");
    expect(validateBrief(BRIEF).ok).toBe(true);
  });

  it("keeps declared value sets in a separate resource", () => {
    const withSets: Brief = {
      ...BRIEF,
      designRuleSets: [
        { name: "legal-modes", values: ["a", "b"], authority: "vendor spec", citation: "s.2" },
      ],
    };
    expect(briefPublicResources(withSets).map((resource) => resource.name)).toEqual([
      "public-validity-rules",
      "public-rule-decisions",
      "artifact-schema",
      "design-rule-constants",
      "design-rule-sets",
    ]);
  });

  it("returns the same JSON from the brief, saved workspace, and solver tool", async () => {
    const dir = workspaceWithBrief(BRIEF, "shared");
    const fromBrief = briefPublicResources(BRIEF);
    expect(JSON.stringify(readPublicResources(dir))).toBe(JSON.stringify(fromBrief));
    const tool = publicResourcesTool(readPublicResources(dir));
    if (tool === null) throw new Error("expected a tool for a brief with constants");
    expect(tool.name).toBe(PUBLIC_RESOURCES_TOOL);
    const result = await tool.execute("call-1", double({}));
    expect(JSON.stringify(result.details)).toBe(JSON.stringify({ resources: fromBrief }));
  });

  it("shows the solver no evaluator vocabulary", () => {
    const dir = workspaceWithBrief(BRIEF, "vocabulary");
    const tool = publicResourcesTool(readPublicResources(dir));
    if (tool === null) throw new Error("expected a tool for a brief with constants");
    for (const word of ["Judge", "census", "verifier", "same bytes", "truth"]) {
      expect(`${tool.label} ${tool.description}`.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  const NO_SURFACE = { artifactSchema: [], designRuleConstants: [], truthChecks: [], ruleDecisions: [] };
  it.each<[string, (name: string) => string]>([
    [
      "a workspace with no brief.json",
      (name) => {
        mkdirSync(join(ROOT, name), { recursive: true });
        return join(ROOT, name);
      },
    ],
    [
      "a brief that declares no public interface",
      (name) => workspaceWithBrief({ ...BRIEF, ...NO_SURFACE }, name),
    ],
    ["a brief that does not yet validate", (name) => workspaceWithBrief({ slug: "broken" }, name)],
    [
      "malformed draft JSON",
      (name) => {
        const dir = workspaceWithBrief(BRIEF, name);
        writeFileSync(join(dir, "correctness-model", "brief.json"), "{");
        return dir;
      },
    ],
  ])("publishes nothing and adds no tool for %s", (label, workspace) => {
    const dir = workspace(label.replaceAll(" ", "-"));
    expect(readPublicResources(dir)).toEqual([]);
    expect(publicResourcesTool(readPublicResources(dir))).toBeNull();
  });

  it("rejects a generated tool with a system-owned name", () => {
    const generatedSpec = {
      presets: [],
      declined: { files: "fixture without a shell" },
      tools: [
        { name: PUBLIC_RESOURCES_TOOL, kind: "reader", description: "a generated copy" },
        { name: "write_rows", kind: "artifact-writer", description: "writes the answer rows" },
      ],
    };
    const validated = validateToolsSpec(generatedSpec);
    if (validated.ok) throw new Error("expected the reserved name to be refused");
    expect(validated.findings.map((finding) => finding.code)).toContain("tools-name-taken");
    const { value, stripped } = normalizeToolsSpec(generatedSpec);
    expect(stripped.map((row) => row.tool.name)).toEqual([PUBLIC_RESOURCES_TOOL]);
    /* SAFETY: normalizeToolsSpec answers `unknown` for the normalised spec; the generated spec
       written above declares a tools list, which is what the expectation reads. */
    expect((value as { tools: { name: string }[] }).tools.map((tool) => tool.name)).toEqual(["write_rows"]);
  });
});
