/**
 * The `context` tool over its five sources, and the one wall it must hold: a document is built from
 * public data, the Builder's own notes or the solver's own record of a passing solve, so a change
 * confined to protected verifier detail leaves every answer byte-identical.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { sha256 } from "../src/meta/digest.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { scoringClosureHash } from "../src/claim/scoring-closure.ts";
import { type ContextBinding, createContextTool, RehearsalTraces } from "../src/builder/context-tool.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import { readClimbBatteries } from "../src/run/climb-history.ts";
import { measuredSolverTraces } from "../src/run/solver-traces.ts";

/** A brief publishing one limit, `$.limits.massKg`, that the artifact reports at `$.report.massKg`. */
const BRIEF = {
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

/** One recorded battery: t0 passed, t1 failed, t2 was a non-result, and t3 passed with no artifact
 *  recorded. Each case carries a solver trace, its submitted artifact and the protected files a run
 *  records beside it, filled from `secret`; the product's hidden tasks and reference are too. */
const PIN = "test/pin";
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ana-context-tool-"));
  scratch.push(dir);
  return dir;
};

function binding(overrides: Partial<ContextBinding> = {}): ContextBinding {
  const workspace = tmp();
  writeFileSync(
    join(workspace, "MEMORY.md"),
    "# Memory\nRisk: the frontier family passed every rehearsal.\n",
  );
  writeFileSync(
    join(workspace, "EXPERIMENT.json"),
    '{"target":{"comparator":"at-most","verifiedPasses":2}}\n',
  );
  mkdirSync(join(workspace, "starter-pack"));
  writeFileSync(
    join(workspace, "starter-pack", "difficulty-ladder.md"),
    "- frontier — the rehearsal fails\n",
  );
  return {
    round: "Round 3 of this run.\nThe last battery: every frontier task passed.",
    workspace,
    rehearsals: new RehearsalTraces(),
    user: EMPTY_USER_CONTEXT,
    ...overrides,
  };
}

async function ask(bound: ContextBinding, args: Record<string, JsonValue>) {
  const result = await createContextTool(bound).execute("context", {
    question: "which rehearsal passed",
    decides: "the next battery",
    ...args,
  });
  const block = result.content[0];
  return { text: block?.type === "text" ? block.text : "", details: result.details };
}

describe("the context tool", () => {
  it("cites matching lines across sources, best match first, and records what was asked", async () => {
    const bound = binding();
    bound.rehearsals.add("traces/rehearsal-1/t4", "the passing rehearsal of t4", [
      "t4: rehearsal passed in 3 of 120 solve minutes",
    ]);
    const { text, details } = await ask(bound, { question: "frontier rehearsal passed" });
    expect(text.split("\n")).toEqual([
      "Citations 1-4 of 4 over 5 document(s), best match first. Page an id for the surrounding lines.",
      "[workspace/MEMORY.md:L2] Risk: the frontier family passed every rehearsal.",
      "[round/opening:L2] The last battery: every frontier task passed.",
      "[workspace/starter-pack/difficulty-ladder.md:L1] - frontier — the rehearsal fails",
      "[traces/rehearsal-1/t4:L1] t4: rehearsal passed in 3 of 120 solve minutes",
    ]);
    expect(details).toMatchObject({
      question: "frontier rehearsal passed",
      decides: "the next battery",
      depth: "cited",
      documents: 5,
      cited: 4,
      receipt: { outcome: "completed", resultDigest: sha256(text) },
    });
  });

  it("lists documents, pages one exactly, and scopes to one source", async () => {
    const bound = binding();
    const overview = (await ask(bound, { depth: "overview", source: "workspace" })).text;
    expect(overview).toBe(
      [
        "documents 1-3 of 3:",
        "- workspace/EXPERIMENT.json (workspace): EXPERIMENT.json",
        "- workspace/MEMORY.md (workspace): MEMORY.md",
        "- workspace/starter-pack/difficulty-ladder.md (workspace): starter-pack/difficulty-ladder.md",
      ].join("\n"),
    );
    const page = (await ask(bound, { depth: "page", id: "workspace/MEMORY.md", offset: 2 })).text;
    expect(page).toBe(
      "workspace/MEMORY.md MEMORY.md — lines 2-3 of 3\n\nRisk: the frontier family passed every rehearsal.\n",
    );
  });

  it("refuses an id it does not hold, a page without one, and a question with nothing to match", async () => {
    const bound = binding();
    await expect(ask(bound, { depth: "page", id: "../../etc/passwd" })).rejects.toThrow(/unknown context id/);
    await expect(ask(bound, { depth: "page" })).rejects.toThrow(/depth page requires id/);
    await expect(ask(bound, { question: "is it ok" })).rejects.toThrow(/names no word/);
  });

  it("answers a question with no matching line by naming the documents it asked", async () => {
    const { text } = await ask(binding(), { question: "photovoltaic", source: "round" });
    expect(text).toBe(
      "No line shares enough of the terms photovoltaic. Documents asked:\ndocuments 1-1 of 1:\n- round/opening (round): this round's opening context",
    );
  });
});

function recordedTree(secret: string): string {
  const tree = tmp();
  const runId = "r1";
  const model = join(tree, "correctness-model");
  mkdirSync(join(model, "reference"), { recursive: true });
  writeFileSync(join(model, "brief.json"), JSON.stringify(BRIEF));
  writeFileSync(join(model, "tasks.json"), JSON.stringify({ tasks: [{ taskId: "t0", hidden: [secret] }] }));
  writeFileSync(join(model, "reference", "index.ts"), `export const designs = ${JSON.stringify(secret)};\n`);
  const evidence = new EvidenceLog(join(tree, "runs", runId));
  evidence.write("battery.json", {
    runId,
    backendPin: PIN,
    thresholdManifestDigest: "digest-a",
    condition: { variant: "shipping" },
    bundleSnapshot: { agentHash: "agent-a", scoringHash: scoringClosureHash(model) },
    execution: { tools: {}, verifierEnvironmentHash: null },
    cases: [
      { taskId: "t0", pass: true, acceptedSubmit: true },
      { taskId: "t1", pass: false, acceptedSubmit: true },
      { taskId: "t2", pass: null, acceptedSubmit: true },
      { taskId: "t3", pass: true, acceptedSubmit: true },
    ],
    measured: { items: [] },
  });
  evidence.write("f2.json", { referenceArtifact: secret });
  for (const taskId of ["t0", "t1", "t2", "t3"]) {
    evidence.write(`cases/${taskId}/trace.json`, {
      turns: [{ turn: 1, timingMs: 90_000, costUsd: 0.25, assistantPreview: `solving ${taskId}` }],
      toolCalls: [{ turn: 1, toolName: "bash", timingMs: 4_000, resultPreview: "wrote answer.json" }],
      verifierStdout: `${secret} in the trace`,
    });
    evidence.write(`cases/${taskId}/public-task.json`, {
      taskId,
      family: "frame",
      publicTaskDigest: `digest-${taskId}`,
      publicTask: { taskId, family: "frame", publicInput: { limits: { massKg: 2171.4 } } },
    });
    if (taskId !== "t3") {
      evidence.write(`cases/${taskId}/artifact.json`, { report: { massKg: 2160.912 } });
    }
    evidence.write(`cases/${taskId}/verifier.json`, {
      stdout: secret,
      issues: [secret],
      checks: [{ checkId: "mass", ok: true, detail: secret }],
    });
    evidence.write(`cases/${taskId}/oracle.json`, { expectation: secret });
    evidence.write(`cases/${taskId}/judge.json`, { verdict: "fail", reason: secret });
  }
  evidence.record();
  mkdirSync(join(tree, "claims"));
  writeFileSync(
    join(tree, "claims", `${runId}.json`),
    JSON.stringify({
      schema: "run-claim/v1",
      runId,
      createdAt: "2026-09-20T00:00:00.000Z",
      claim: { ok: true },
    }),
  );
  return tree;
}

/** The traces source over `tree`, with `afterAdmission` run between reading the battery history and
 *  listing the documents: the history is read once per round, so bytes can change in between. */
async function tracesOf(
  tree: string,
  afterAdmission: (caseDir: string) => void = () => {},
): Promise<{ ids: string[]; text: string; artifact: string }> {
  const { admitted } = readClimbBatteries(tree, PIN, join(tree, "claims"));
  afterAdmission(join(tree, "runs", "r1", "cases", "t0"));
  const docs = measuredSolverTraces(tree, admitted);
  const bound = binding({ traces: () => docs });
  const artifactId = "traces/r1/t0/artifact";
  return {
    ids: docs.map((doc) => doc.id),
    text: (await ask(bound, { depth: "page", id: "traces/r1/t0" })).text,
    artifact: docs.some((doc) => doc.id === artifactId)
      ? (await ask(bound, { depth: "page", id: artifactId })).text
      : "",
  };
}

describe("the round plan document", () => {
  it("is offered on a continuation that binds one, and absent otherwise", async () => {
    const bound = binding({ plan: () => "Round plan (experiment-plan/v2, tasks scope): target at-most 2." });
    const page = (await ask(bound, { depth: "page", id: "round/plan" })).text;
    expect(page).toBe(
      "round/plan the round plan and its evidence — lines 1-1 of 1\n\nRound plan (experiment-plan/v2, tasks scope): target at-most 2.",
    );
    await expect(ask(binding(), { depth: "page", id: "round/plan" })).rejects.toThrow(/unknown context id/);
  });
});

describe("the traces source", () => {
  it("offers each passing case's solve and recorded artifact, and never a failing one or a non-result", async () => {
    const { ids, text, artifact } = await tracesOf(recordedTree("secret-verifier-a"));
    expect(ids).toEqual(["traces/r1/t0", "traces/r1/t0/artifact", "traces/r1/t3"]);
    expect(text).toContain("t0 in r1: passed in 1.5 of 120 solve minutes (1%), 1 tool call, $0.25.");
    expect(text).toContain("turn 1 call bash 4s: wrote answer.json");
    const [served = "", margins] = artifact.split("\n\nPublished limits");
    const [head, , ...body] = served.split("\n");
    expect(head).toStartWith(
      "traces/r1/t0/artifact the artifact the passing solve of t0 submitted in battery r1",
    );
    expect(JSON.parse(body.join("\n"))).toEqual({
      runId: "r1",
      publicTask: { taskId: "t0", family: "frame", publicInput: { limits: { massKg: 2171.4 } } },
      submittedArtifact: { report: { massKg: 2160.912 } },
    });
    // The solver's own margin lines, against the limit the brief it was scored under publishes.
    expect(margins).toBe(
      ", measured on the artifact this solve submitted:\n- massBudgetKg: 2160.912, at most 2171.4; 10.488 to spare (0.4830063553%).",
    );
  });

  it("states no margin once the brief no longer matches the battery's scoring program", async () => {
    const tree = recordedTree("s");
    writeFileSync(
      join(tree, "correctness-model", "brief.json"),
      JSON.stringify({ ...BRIEF, gates: ["moved"] }),
    );
    const { artifact } = await tracesOf(tree);
    expect(artifact).toContain('"massKg": 2160.912');
    expect(artifact).not.toContain("Published limits");
  });

  // Rule 4's mechanical test: change only protected verifier detail and the answer must not move.
  it("gives byte-identical answers when only protected verifier detail differs", async () => {
    const a = await tracesOf(recordedTree("secret-verifier-a"));
    const b = await tracesOf(recordedTree("secret-verifier-b"));
    expect(sha256(b.text)).toBe(sha256(a.text));
    expect(sha256(b.artifact)).toBe(sha256(a.artifact));
    expect(a.artifact).not.toBe("");
    expect(`${a.text}${a.artifact}`).not.toContain("secret-verifier");
  });

  it("offers no artifact whose bytes changed or went missing after they were recorded", async () => {
    const tampered = await tracesOf(recordedTree("s"), (caseDir) =>
      writeFileSync(join(caseDir, "artifact.json"), '{"design":{"members":["forged"]}}'),
    );
    expect(tampered.ids).toEqual(["traces/r1/t0", "traces/r1/t3"]);
    const missing = await tracesOf(recordedTree("s"), (caseDir) => rmSync(join(caseDir, "artifact.json")));
    expect(missing.ids).toEqual(["traces/r1/t0", "traces/r1/t3"]);
  });
});
