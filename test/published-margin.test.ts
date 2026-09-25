import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { createGeneratedToolStarter } from "../src/solve/generated-tool-worker.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";
import { createSubmissionAuthority, submissionPortOf } from "../src/solve/final-submission.ts";
import { WRITER_BINDING_SENTENCE, readMargins, renderMargins } from "../src/solve/published-margin.ts";
import { publishedMargins } from "../src/truth/numeric-boundary.ts";
import { validateBrief } from "../src/truth/brief-validator.ts";
import type { Brief } from "../src/truth/brief.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const MARGINS = [
  {
    label: "massBudgetKg",
    artifactPath: "$.report.massKg",
    publicInputPath: "$.limits.massKg",
    direction: "atMost" as const,
    families: null,
  },
  {
    label: "spanMinM",
    artifactPath: "$.report.spanM",
    publicInputPath: "$.limits.spanM",
    direction: "atLeast" as const,
    families: ["wide"],
  },
];
const TASK = { limits: { massKg: 2171.4, spanM: 12 } };

const BRIEF: Brief = {
  slug: "d",
  domain: "d",
  correctnessContract: "check-program/v1",
  decisions: ["covers single-span trusses"],
  gates: ["mass is within the published budget"],
  joins: [],
  artifactSchema: [{ name: "report", "shape": "object" }],
  designRuleConstants: [{ name: "massBudgetKg", value: 2171.4, authority: "a", citation: "c" }],
  ruleDecisions: [{ id: "r1", visibility: "public", statement: "mass is at most the budget" }],
  truthChecks: [
    {
      id: "mass",
      assertion: "reported mass is at most the published budget",
      citedDecisionIds: ["r1"],
      numericBoundaries: [
        {
          publicInputPath: "$.limits.massKg",
          constantName: "massBudgetKg",
          artifactPath: "$.report.massKg",
          direction: "atMost",
        },
      ],
      execution: {
        families: "all",
        artifactPaths: ["$.report"],
        publicInputPaths: ["$.limits"],
        hidden: "none",
        evidence: { kind: "authored" },
      },
    },
  ],
};

describe("published margins", () => {
  // The recorded case this exists for: a truss answer of 2026-09-17 reported 2160.912 kg against a
  // published 2171.4 kg limit and passed, while another reported over it and was submitted anyway.
  it("reads a prepared answer against both directions and names the breach", () => {
    const readings = readMargins(MARGINS, "wide", TASK, { report: { massKg: 2180.4, spanM: 14 } });
    expect(readings.map(({ label, breached }) => [label, breached])).toEqual([
      ["massBudgetKg", true],
      ["spanMinM", false],
    ]);
    expect(readings[0]?.slack).toBeCloseTo(-9, 6);
    expect(readings[1]?.slack).toBe(2);
    const table = renderMargins(readings);
    expect(table).toContain("massBudgetKg: BREACHED. Reports 2180.4, at most 2171.4; over by 9");
    expect(table).toContain("spanMinM: 14, at least 12; 2 to spare");
    expect(table).toContain("not yet sendable");
  });

  // A check bound to named families measures only those tasks, so another family reads no table
  // rather than one built from a limit its own check never applies.
  it("applies a family-bound comparison only to its own family", () => {
    expect(readMargins(MARGINS, "narrow", TASK, { report: { massKg: 1, spanM: 1 } })).toHaveLength(1);
  });

  // An unreadable operand is unknown, not a breach: the verifier owns correctness and a missing
  // number must not read as a failure the solver then chases.
  it("reads a missing or non-numeric operand as unchecked", () => {
    const readings = readMargins(MARGINS, "wide", { limits: {} }, { report: { massKg: "heavy", spanM: 14 } });
    expect(readings.every(({ breached, slack }) => !breached && slack === null)).toBe(true);
    const table = renderMargins(readings);
    expect(table).toContain("massBudgetKg: not checked — your answer reports nothing at $.report.massKg.");
    expect(table).toContain("spanMinM: not checked — this task states no limit.");
    expect(table).not.toContain("not yet sendable");
  });

  it("states the host binding without a count, so one registration serves every family", () => {
    // Conformance requires one stable registration across a battery whose families publish
    // different numbers of limits; the confined-worker case below proves the sentence is delivered.
    expect(WRITER_BINDING_SENTENCE).not.toMatch(/\d/);
  });

  it("renders nothing when the harness published no complete boundary", () => {
    expect(renderMargins(readMargins([], "wide", TASK, {}))).toBe("");
  });
});

describe("numeric boundary declarations", () => {
  it("projects a complete boundary into a comparison and keeps an incomplete one unevaluable", () => {
    const complete = validateBrief(BRIEF);
    expect(complete.findings).toEqual([]);
    expect(publishedMargins(BRIEF)).toEqual([MARGINS[0]!]);

    const bare = structuredClone(BRIEF);
    bare.truthChecks[0]!.numericBoundaries = [
      { publicInputPath: "$.limits.massKg", constantName: "massBudgetKg" },
    ];
    expect(validateBrief(bare).findings).toEqual([]);
    expect(publishedMargins(bare)).toEqual([]);
  });

  // Half a comparison is a rule stated half-way, not a narrower rule: the path with no direction
  // says which number to read and never which way it must go.
  it("refuses one half of the pair without the other, and an unknown direction", () => {
    for (const boundary of [
      { publicInputPath: "$.limits.massKg", constantName: "massBudgetKg", artifactPath: "$.report.massKg" },
      { publicInputPath: "$.limits.massKg", constantName: "massBudgetKg", direction: "atMost" },
      {
        publicInputPath: "$.limits.massKg",
        constantName: "massBudgetKg",
        artifactPath: "$.report.massKg",
        direction: "under",
      },
    ]) {
      const brief = structuredClone(BRIEF);
      // SAFETY: the point of the case is a row validateBrief must refuse, which the declared
      // type cannot express; the assertion is how the invalid row reaches the validator.
      brief.truthChecks[0]!.numericBoundaries = [boundary as never];
      expect(validateBrief(brief).findings.map(({ path }) => path)).toContain(
        "truthChecks[0].numericBoundaries",
      );
    }
  });

  it("reports an artifact path that is not a rooted JSON path", () => {
    const brief = structuredClone(BRIEF);
    brief.truthChecks[0]!.numericBoundaries = [
      // SAFETY: an unrooted artifactPath is a string the declared type admits and the validator
      // must reject; `as never` only satisfies the literal-direction field beside it.
      {
        publicInputPath: "$.limits.massKg",
        constantName: "massBudgetKg",
        artifactPath: "report.massKg",
        direction: "atMost",
      } as never,
    ];
    expect(validateBrief(brief).findings.map(({ path }) => path)).toContain(
      "truthChecks[0].numericBoundaries[0].artifactPath",
    );
  });
});

/**
 * The same comparison, run where measurement actually runs it. The in-process starter reads the
 * margins from the controller contract directly; the confined worker reads them from the start
 * frame, and until this case existed nothing put them there — the production solver prepared its
 * answer and was told nothing, while every test of the feature passed.
 */
describe("published margins in the confined worker", () => {
  const MARGIN = {
    label: "massBudgetKg",
    artifactPath: "$.massKg",
    publicInputPath: "$.limits.massKg",
    direction: "atMost" as const,
    families: null,
  };
  const SCHEMA = compilePublicArtifactSchema([{ name: "massKg" }], [{ massKg: 1 }]);
  const TOOLS = `
import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

export function createDomainHarness() {
  return {
    tools: [
      defineDraftTool({
        name: "write_answer", label: "Write answer", description: "prepare the exact public answer",
        parameters: Type.Object({ massKg: Type.Number() }),
        executionMode: "sequential",
        run: (params, draft) => {
          draft.setArtifact(params);
          return { text: "prepared" };
        },
      }),
    ],
  };
}
`;
  afterAll(cleanupScratch);

  async function prepare(massKg: number): Promise<{ text: string; description: string }> {
    // Inside the checkout, because the worker bundle resolves the generated tool's own
    // "@ana/agent-bundle" import from the directory that file sits in.
    const slugDir = scratchDir(".ana-scratch-margin-", import.meta.dir);
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "agent", "tools.ts"), TOOLS);
    const starter = await createGeneratedToolStarter({
      slugDir,
      task: { taskId: "t1", family: "wide", publicInput: { limits: { massKg: 2171.4 } } },
      submission: submissionPortOf(
        createSubmissionAuthority({ maxAttempts: 1, publicArtifactSchema: SCHEMA }),
      ),
      contract: {
        controllerTools: () => [],
        presets: [],
        domainToolAuthorities: [{ name: "write_answer", authority: "artifact-writer" }],
        operatingGuide: "Write the answer with write_answer.",
        publishedMargins: [MARGIN],
      },
      publicArtifactSchema: SCHEMA,
    });
    try {
      // The point of the case: this must be the out-of-process worker, not the in-process
      // fallback, because the start frame is the only way margins reach it.
      if (starter.generatedWorker === undefined) {
        throw new Error("the starter opened no generated-tool worker");
      }
      const writer = starter.tools.find((tool) => tool.name === "write_answer");
      if (writer === undefined) {
        throw new Error(`worker served ${starter.tools.map((tool) => tool.name).join(", ")}`);
      }
      const result = await writer.execute(
        "call-1",
        /* SAFETY: the bound artifact writer takes the public artifact itself, which is what this argument is. */ {
          massKg,
        } as never,
      );
      return {
        text: result.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
        description: writer.description,
      };
    } finally {
      await starter.close?.();
    }
  }

  it("measures the answer a confined solver prepared against the published limit", async () => {
    const breach = await prepare(2180.4);
    expect(breach.text).toContain("massBudgetKg: BREACHED. Reports 2180.4, at most 2171.4; over by 9");
    // The description the solver reads comes from the same binding as the text it gets back: the
    // generated module declared only "prepare the exact public answer", and the host adds what it
    // does with that call. Both survive the worker's registration round trip.
    expect(breach.description).toBe(`prepare the exact public answer ${WRITER_BINDING_SENTENCE}`);
    expect(await prepare(2160.912)).toHaveProperty(
      "text",
      expect.stringContaining("massBudgetKg: 2160.912, at most 2171.4; 10.488 to spare"),
    );
  }, 120_000);
});
