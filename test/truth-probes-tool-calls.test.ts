/**
 * The calls the conformance probe makes into each declared tool: the arguments it derives from a
 * parameter schema, the ones a spec declares for it, what a failing call means, and what the
 * presets compose. Every case opens a real worker over a written slug, so a tool the probe cannot
 * exercise is observable as a row rather than as silence.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { makeAgentToolsProbes } from "../src/author/agent-tools-session.ts";
import { CONFORMANCE_PROBE_POLICY } from "../src/claim/conformance-evidence.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";
import type { ToolsSpec } from "../src/truth/tools-spec.ts";
import { SCHEMA, SPEC, TASK, TOOLS_SOURCE, probeConformance, probeSlugs } from "./helpers/probe-slug.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const { writeSlug, conform } = probeSlugs(scratchDir(".ana-scratch-probes-calls-", import.meta.dir));
afterAll(cleanupScratch);

/** declare_part with a pattern the argument sampler cannot read. */
const PATTERNED_SOURCE = TOOLS_SOURCE.replace(
  "parameters: Type.Object({ name: Type.String() })",
  'parameters: Type.Object({ name: Type.String({ pattern: "^[A-Z]{3}$" }) })',
);

describe("the arguments the conformance probe derives", () => {
  it.concurrent("refuses a tool whose declared parameters the probe cannot satisfy instead of skipping it", async () => {
    // The sampler derives "" for a plain string; a pattern it cannot read would otherwise leave
    // declare_part silently unexercised on every task.
    expect(PATTERNED_SOURCE).not.toBe(TOOLS_SOURCE);
    const findings = await conform("conform-unprobed", [TASK], { tools: PATTERNED_SOURCE });
    expect(findings.filter((f) => f.code === "generated-toolset-unprobed")).toEqual([
      expect.objectContaining({
        path: "agent/tools-spec.json",
        detail: expect.stringContaining('"declare_part"'),
      }),
    ]);
    expect(findings.some((f) => f.code === "generated-toolset-throws")).toBe(false);
  });

  it.concurrent("opens tasks through a patterned tool with its declared arguments and refuses arguments it rejects", async () => {
    // The remedy for an unsampleable pattern is a declared example, never a looser schema.
    const slugDir = writeSlug("conform-declared-arguments", { tools: PATTERNED_SOURCE });
    const declaring = (conformanceArguments: Record<string, string>): ToolsSpec => ({
      ...SPEC,
      tools: SPEC.tools.map((tool) =>
        tool.name === "declare_part" ? { ...tool, conformanceArguments } : tool,
      ),
    });
    await expect(probeConformance(slugDir, declaring({ name: "ABC" }), [TASK], SCHEMA)).resolves.toEqual([]);
    const invalid = await probeConformance(slugDir, declaring({ name: "abc" }), [TASK], SCHEMA);
    expect(invalid.map((f) => [f.code, f.path])).toEqual([
      ["generated-toolset-arguments-invalid", "agent/tools-spec.json"],
    ]);
  });

  it.concurrent("executes the draft-tool producer's nullable integer type array", async () => {
    const source = TOOLS_SOURCE.replace(
      "parameters: Type.Object({ name: Type.String() }),",
      "parameters: Type.Object({ name: Type.Union([Type.Integer(), Type.Null()]) }),",
    )
      .replace("name }: { name: string }", "name }: { name: number | null }")
      .replace("[...parts(draft), name]", "[...parts(draft), String(name)]");
    expect(source).toContain("name: Type.Union([Type.Integer(), Type.Null()])");
    await expect(conform("conform-nullable-integer", [TASK], { tools: source })).resolves.toEqual([]);
  });

  // A tool the probe derives no arguments for has opened no task, so it is a row rather than a skip.
  it.concurrent.each([
    ["empty", "[]"],
    ["unsupported", '["date"]'],
  ])("names a tool whose %s type array derives no arguments", async (name, schema) => {
    const source = TOOLS_SOURCE.replace(
      "parameters: Type.Object({ name: Type.String() }),",
      `parameters: Type.Object({ name: Type.Unsafe({ type: ${schema} }) }),`,
    );
    expect(source).toContain(`name: Type.Unsafe({ type: ${schema} })`);
    const findings = await conform(`conform-${name}-type-array`, [TASK], { tools: source });
    expect(findings.map((f) => f.code)).toEqual(["generated-toolset-unprobed"]);
  });
});

describe("what a probed call's failure means", () => {
  it.concurrent("still refuses a declared-argument call that throws", async () => {
    const source = TOOLS_SOURCE.replace(
      "parameters: Type.Object({ name: Type.String() })",
      "parameters: Type.Object({ name: Type.Number({ exclusiveMinimum: 0 }) })",
    )
      .replace("name }: { name: string }", "name }: { name: number }")
      .replace(
        'draft.setValue("parts", [...parts(draft), name]);',
        'if (name > 0) throw new Error("declare_part is broken");',
      );
    expect(source).toContain("declare_part is broken");
    const spec: ToolsSpec = {
      ...SPEC,
      tools: SPEC.tools.map((tool) =>
        tool.name === "declare_part" ? { ...tool, conformanceArguments: { name: 2 } } : tool,
      ),
    };
    const findings = await conform("conform-declared-throws", [TASK], { tools: source, spec });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "generated-toolset-throws",
        detail: expect.stringContaining("declare_part is broken"),
      }),
    );
  });

  it.concurrent("reports a writer that breaks the draft contract as a build finding", async () => {
    // A plain writer calling setArtifact is legal-looking generated code whose call the draft
    // store refuses. Conformance must catch it before fingerprinting.
    const source = TOOLS_SOURCE.replace(
      'draft.setValue("parts", [...parts(draft), name]);',
      'draft.setValue("parts", [...parts(draft), name]);\n        draft.setArtifact({ assignments: [] });',
    );
    const findings = await conform("conform-contract-refusal", [TASK], { tools: source });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "generated-toolset-throws",
        path: "agent/tools.ts",
        detail: expect.stringContaining("artifact-writer"),
      }),
    );
  });

  it.concurrent("allows an ordinary domain error during an artifact-writer probe", async () => {
    const source = TOOLS_SOURCE.replace(
      "const next = [...assignments(draft), { part, slot }];",
      'if (part.length === 0) throw new Error("unknown part id");\n        const next = [...assignments(draft), { part, slot }];',
    );
    await expect(conform("conform-domain-error", [TASK], { tools: source })).resolves.toEqual([]);
  });

  // A result the frame protocol cannot carry is that call's failure, not the worker's: the probe
  // refuses the tool that returns it and the session stays open, so the remaining probes are still
  // observed. Ending the worker instead would record a termination beside the throw, which a paid
  // solve reads as an environment non-result.
  it.concurrent("refuses a tool whose result cannot be framed, without ending the worker", async () => {
    const source = TOOLS_SOURCE.replace(
      'return { text: "declared " + name };',
      'return { text: "declared " + name, details: "x".repeat(3_000_000) };',
    );
    const findings = await conform("conform-worker-failure", [TASK], { tools: source });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "generated-toolset-throws",
        disclosure: { class: "authored" },
      }),
    );
    expect(findings.map(({ code }) => code)).not.toContain("generated-toolset-termination");
  });
});

describe("the presets the probe composes, and the pack that binds them", () => {
  it.concurrent("composes controller SQL without generated files and refuses legacy generated readers", async () => {
    const selected: ToolsSpec = { ...SPEC, presets: ["public-data"] };
    await expect(conform("conform-data-active", [TASK], { spec: selected })).resolves.toEqual([]);
    await expect(conform("conform-data-missing", [TASK], { spec: selected })).resolves.toEqual([]);

    const stale = writeSlug("conform-data-stale");
    writeFileSync(join(stale, "agent/data.sqlite"), "fake sqlite fixture");
    writeFileSync(
      join(stale, "agent/controller-data-reader.ts"),
      'throw new Error("generated reader must never load");',
    );
    const staleFindings = await probeConformance(stale, SPEC, [TASK], SCHEMA);
    expect(staleFindings.map((finding) => finding.code)).toContain("generated-module-load");
  });

  it.concurrent("conforms the deferred Pi files preset through the common worker", async () => {
    const filesSource = `
export function createDomainHarness(_task) {
  return { tools: [] };
}
`;
    const fileSchema = compilePublicArtifactSchema([{ name: "files" }], [{ files: {} }]);
    await expect(
      conform("conform-files", [TASK], {
        tools: filesSource,
        spec: { presets: ["files"], tools: [] },
        schema: fileSchema,
      }),
    ).resolves.toEqual([]);
  });

  it.concurrent("binds tool conformance to one slug directory", async () => {
    const tools = makeAgentToolsProbes(writeSlug("pack"));
    await expect(tools.conformance?.(SPEC, [TASK], SCHEMA)).resolves.toMatchObject({
      findings: [],
      probePolicy: CONFORMANCE_PROBE_POLICY,
      worker: {
        schema: "generated-tool-worker/v3",
        generatedSourceDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        workerPolicyIdentity: expect.stringMatching(/^[0-9a-f]{64}$/),
        registrationDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        toolSchemaDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(CONFORMANCE_PROBE_POLICY).toContain("falsifier-conformance/v24:worker-protocol-v2");
    expect(CONFORMANCE_PROBE_POLICY).toContain("public-schema-derived-writer");
    expect(CONFORMANCE_PROBE_POLICY).toContain("tool-description-parity");
  }, 30_000);
});
