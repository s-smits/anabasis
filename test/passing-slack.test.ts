/**
 * The readout's public slack line: each passing case of the latest admitted battery, read against
 * the comparisons the brief declares, over the solver's accepted artifact and the task's public
 * input. What is pinned is that it says unknown rather than zero when nothing is declared, that a
 * failing case never appears, and that protected detail — verifier output, hidden expectations,
 * reference artifacts, F2 evidence — cannot move a byte of the rendered readout.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { scoringClosureHash } from "../src/claim/scoring-closure.ts";
import { readClimbReadout, renderReadout } from "../src/run/climb-readout.ts";
import { validateBrief } from "../src/truth/brief-validator.ts";
import type { Brief } from "../src/truth/brief.ts";
import type { NumericBoundaryDeclaration } from "../src/truth/numeric-boundary.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const RUN_PIN = "test/pin";
const RUN_ID = "run-slack";

const BOUNDARY = {
  publicInputPath: "$.limits.massKg",
  constantName: "massBudgetKg",
  artifactPath: "$.report.massKg",
  direction: "atMost" as const,
};

type Protected = { verifier: JsonValue; hidden: JsonValue; reference: string; conformance: JsonValue };

const PLAIN: Protected = {
  verifier: { checkReceipts: [{ checkId: "mass", passed: true }] },
  hidden: [{ taskId: "t0", hidden: [{ checkId: "mass", expectation: 2100 }] }],
  reference: "export const designs = { t0: { report: { massKg: 2000 } } };\n",
  conformance: { f2: { solved: 3 } },
};

/** Changed only where the Builder may not look: another per-check result with its own margin,
 *  another hidden expectation, another reference artifact and another F2 record. */
const SHIFTED: Protected = {
  verifier: { checkReceipts: [{ checkId: "mass", passed: true, detail: "margin 9.9 kg below 2170" }] },
  hidden: [{ taskId: "t0", hidden: [{ checkId: "mass", expectation: 1500 }] }],
  reference: "export const designs = { t0: { report: { massKg: 1234.5 } } };\n",
  conformance: { f2: { solved: 2, reference: { massKg: 1234.5 } } },
};

type CaseSpec = { taskId: string; pass: boolean; massKg?: number };

const CASES: CaseSpec[] = [
  { taskId: "t0", pass: true, massKg: 2160.912 },
  { taskId: "t1", pass: true },
  { taskId: "t2", pass: false, massKg: 2190 },
];

afterAll(cleanupScratch);

function brief(boundary: NumericBoundaryDeclaration[]): Brief {
  return {
    slug: "d",
    domain: "d",
    correctnessContract: "check-program/v1",
    decisions: ["covers single-span trusses"],
    gates: ["mass is within the published budget"],
    joins: [],
    artifactSchema: [{ name: "report", "shape": "object", taskConditioned: true }],
    designRuleConstants: [{ name: "massBudgetKg", value: 2171.4, authority: "a", citation: "c" }],
    ruleDecisions: [{ id: "r1", visibility: "public", statement: "mass is at most the budget" }],
    truthChecks: [
      {
        id: "mass",
        assertion: "reported mass is at most the published budget",
        citedDecisionIds: ["r1"],
        numericBoundaries: boundary,
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
}

/** One product tree holding its brief, its protected files and one recorded battery beside them. */
function tree(briefValue: Brief, hidden: Protected = PLAIN): string {
  const root = scratchDir("ana-passing-slack-");
  const model = join(root, "correctness-model");
  mkdirSync(join(model, "reference"), { recursive: true });
  expect(validateBrief(briefValue).findings).toEqual([]);
  writeFileSync(join(model, "brief.json"), JSON.stringify(briefValue));
  writeFileSync(join(model, "tasks.json"), JSON.stringify({ tasks: hidden.hidden }));
  writeFileSync(join(model, "reference", "index.ts"), hidden.reference);
  writeFileSync(join(root, "conformance.json"), JSON.stringify(hidden.conformance));
  const evidence = new EvidenceLog(join(root, "runs", RUN_ID));
  evidence.write("battery.json", {
    runId: RUN_ID,
    backendPin: RUN_PIN,
    thresholdManifestDigest: "digest-a",
    condition: { variant: "shipping" },
    bundleSnapshot: { agentHash: "agent-a", scoringHash: scoringClosureHash(model), taskSetHash: "tasks" },
    execution: { tools: {}, verifierEnvironmentHash: null },
    cases: CASES.map(({ taskId, pass }) => ({ taskId, family: "span", pass, acceptedSubmit: true })),
    measured: { items: [] },
  });
  for (const { taskId, massKg } of CASES) {
    const publicTask = { taskId, family: "span", publicInput: { limits: { massKg: 2171.4 } } };
    evidence.write(`cases/${taskId}/public-task.json`, { taskId, publicTask });
    evidence.write(`cases/${taskId}/artifact.json`, { report: massKg === undefined ? {} : { massKg } });
    evidence.write(`cases/${taskId}/verifier.json`, hidden.verifier);
  }
  evidence.record();
  mkdirSync(join(root, "claims"), { recursive: true });
  writeFileSync(
    join(root, "claims", `${RUN_ID}.json`),
    JSON.stringify({
      schema: "run-claim/v1",
      runId: RUN_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
      claim: { ok: true },
    }),
  );
  return root;
}

const rendered = (root: string) =>
  renderReadout(readClimbReadout(root, RUN_PIN, join(root, "claims")), "choose the next experiment");

const slackLine = (text: string) =>
  text
    .split("\n\n")
    .find(
      (part) => part.includes("slack of the latest") || part.includes("slack against any public limit"),
    ) ?? "";

describe("the passing cases' public slack", () => {
  it("states each passing case's shipped value, limit, direction and signed slack", () => {
    const line = slackLine(rendered(tree(brief([BOUNDARY]))));
    expect(line).toContain("(run-slack, 2 passing)");
    expect(line).toContain("t0: massBudgetKg shipped 2160.912 against at most 2171.4, slack +10.488.");
    expect(line).toContain("t1: massBudgetKg shipped unknown against at most 2171.4, slack unknown.");
    expect(line).toContain("not a verdict and not a difficulty claim");
    // A failing case's shipped answer beside its limit would say where it failed.
    expect(line).not.toContain("t2");
  });

  it("says unknown, never zero, when the brief declares no complete comparison", () => {
    const line = slackLine(
      rendered(tree(brief([{ publicInputPath: "$.limits.massKg", constantName: "massBudgetKg" }]))),
    );
    expect(line).toContain("passed 2 case(s), and their slack against any public limit is unknown");
    expect(line).toContain("declares no numericBoundaries row");
    expect(line).not.toMatch(/slack \+?0\b/);
  });

  it("leaves the readout byte-identical when only protected verifier detail changes", () => {
    const before = rendered(tree(brief([BOUNDARY]), PLAIN));
    const after = rendered(tree(brief([BOUNDARY]), SHIFTED));
    expect(slackLine(before)).toContain("slack +10.488");
    expect(after).toBe(before);
  });
});
