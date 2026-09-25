/**
 * The diagnosis reader over a small recorded battery.
 *
 * The battery is built from the minimal public shapes a recorded case leaves behind: a
 * `case-trace/v4` trace, the public task card, the solver's registration and the recorded public
 * domain context, beside a protected `verifier.json` the reader must never open. Three things are
 * checked here. The reader is shown every failing solve as addressable steps, with the harness
 * surface the solver ran under and a passing solve of the same family beside it. A reading it records
 * is structured, carries a boundary the controller resolved to a shown step and a falsifier, and has
 * its confidence computed rather than stated. And a change to protected detail alone leaves its
 * prompt byte-identical.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { BEAMS, JOINTS, advicePacket, call, issue } from "./helpers/review-fixtures.ts";
import { tracePointer } from "../src/claim/case-record.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import type { ReadCaseTrace } from "../src/claim/trace-read.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import type { CaseEvidence } from "../src/analyse/iteration-analysis.ts";
import type { ReaderTool, runReaderTurn } from "../src/review/review-reader.ts";
import { adviceIssueId, attachIssueReadings, renderRebuildAdvice } from "../src/author/rebuild-advice.ts";
import {
  type DiagnosisReaderEvidence,
  diagnosableIssues,
  diagnosisPacket,
  readDiagnoses,
} from "../src/review/diagnosis-reader.ts";
import { diagnosisConfidence, recordDiagnosisTool } from "../src/review/diagnosis-tool.ts";
import { batteryCensus, compileSolve } from "../src/review/solve-steps.ts";

const REVIEW = {
  enabled: true as const,
  kind: "claude" as const,
  model: null,
  reasoningEffort: "high",
  source: "operator" as const,
};

type Call = { tool: string; ok: boolean | null; digest?: string; result: string; args?: string };

type Row = { taskId: string; family: string; outcome: "pass" | "fail" | "unaccepted"; calls: Call[] };

/** A failing beams solve: it reads the constants, then the writer refuses the pinned joint. */
const WRITER_REFUSES: Call[] = [
  { tool: "read_constants", ok: true, result: '{"span":12}' },
  { tool: "write_layout", ok: false, result: "unknown support kind 'pinned'", args: '{"support":"pinned"}' },
  { tool: "submit", ok: true, result: "Submitted." },
];

const ROWS: Row[] = [
  { taskId: "beam-span-0001", family: "beams", outcome: "fail", calls: WRITER_REFUSES },
  { taskId: "beam-span-0002", family: "beams", outcome: "fail", calls: WRITER_REFUSES },
  {
    taskId: "beam-span-0003",
    family: "beams",
    outcome: "fail",
    calls: [
      { tool: "read_constants", ok: true, result: '{"span":9}' },
      { tool: "write_layout", ok: false, digest: "same", result: "unknown support kind 'pinned'" },
      { tool: "write_layout", ok: false, digest: "same", result: "unknown support kind 'pinned'" },
      { tool: "write_layout", ok: false, digest: "same", result: "unknown support kind 'pinned'" },
      { tool: "submit", ok: true, result: "Submitted." },
    ],
  },
  {
    taskId: "beam-span-0004",
    family: "beams",
    outcome: "pass",
    calls: [
      { tool: "read_constants", ok: true, result: '{"span":6}' },
      { tool: "write_layout", ok: true, result: "layout written with a fixed support" },
      { tool: "submit", ok: true, result: "Submitted." },
    ],
  },
  {
    taskId: "joint-node-0001",
    family: "joints",
    outcome: "unaccepted",
    calls: [{ tool: "bash", ok: true, result: "installing solver" }],
  },
];

const B = BEAMS.slice(0, 12);

const WRITER_READING = {
  issueIds: [B],
  layer: "tool-contract",
  intervention: "correct",
  boundary: "c01.s2",
  boundaryReading: "write_layout rejects the pinned support the family's public input requires",
  cause: "the writer's support enum omits pinned, so no valid call can express the layout",
  falsifier: "a later beams solve writes a pinned support through write_layout and still fails",
  supporting: ["c01", "c02", "c03"],
  contrast: ["c04.s2"],
};

afterAll(cleanupScratch);

function toolCall(entry: Call, seq: number) {
  const row = {
    seq,
    turn: seq,
    toolName: entry.tool,
    argsDigest: entry.digest ?? `digest-${seq}`,
    isError: entry.ok === null ? null : !entry.ok,
    resultPreview: entry.result,
    timingMs: 1_500,
  };
  // The recorder keeps a call's excerpts only on an error row.
  return entry.ok === false ? { ...row, resultExcerpt: entry.result, argsExcerpt: entry.args ?? "{}" } : row;
}

/** The reader tool a turn double was handed; the reader always registers exactly one. */
function onlyTool(tools: readonly ReaderTool[]): ReaderTool {
  const [tool] = tools;
  if (tool === undefined) throw new Error("the reader registered no tool");
  return tool;
}

function battery() {
  const root = scratchDir("ana-diagnosis-reader-");
  const domain = join(root, "domains", "truss");
  const log = new EvidenceLog(join(domain, "runs", "r2"));
  mkdirSync(join(root, "campaigns", "truss"), { recursive: true });
  log.write("judge/public-context.json", {
    schema: "judge-public-context/v1",
    publicDomain: { domain: "steel roof trusses", hiddenReference: "PRIVATE_DOMAIN" },
  });
  const cases = ROWS.map((row): CaseEvidence => {
    const dir = `cases/${row.taskId}`;
    log.write(`${dir}/trace.json`, {
      schema: "case-trace/v4",
      backend: "codex",
      turns: row.calls.map((_, index) => ({
        assistantPreview: index === row.calls.length - 1 ? "Done." : "",
        stopReason: index === row.calls.length - 1 ? "stop" : "toolUse",
        timingMs: 2_000,
      })),
      toolCalls: row.calls.map((entry, index) => toolCall(entry, index + 1)),
      truncated: false,
      droppedRawEvents: 0,
    });
    log.write(`${dir}/public-task.json`, {
      taskId: row.taskId,
      publicTask: {
        taskId: row.taskId,
        family: row.family,
        publicInput: { span: 12 },
        hidden: "PRIVATE_TASK",
      },
    });
    log.write(`${dir}/built-registration.json`, {
      schema: "built-starter-registration/v2",
      tools: [
        { name: "read_constants", owner: "domain", authority: "read" },
        { name: "write_layout", owner: "domain", authority: "write" },
      ],
    });
    if (row.outcome === "fail") log.write(`${dir}/verifier.json`, { message: "PRIVATE_VERIFIER_A" });
    return {
      taskId: row.taskId,
      family: row.family,
      acceptedSubmit: row.outcome !== "unaccepted",
      truthOk: row.outcome === "unaccepted" ? null : row.outcome === "pass",
      pass: row.outcome === "unaccepted" ? null : row.outcome === "pass",
      runtimeNonResult: null,
      runtimeNonResultKind: null,
      traces: [tracePointer(domain, `runs/r2/${dir}/trace.json`)],
    };
  });
  log.record();
  const measuredDir = join(root, "measured");
  mkdirSync(join(measuredDir, "agent"), { recursive: true });
  writeFileSync(
    join(measuredDir, "agent", "BUILT_AGENTS.md"),
    "Write the layout with write_layout, then submit.\n",
  );
  writeFileSync(
    join(measuredDir, "agent", "tools-spec.json"),
    JSON.stringify({
      presets: ["shell"],
      tools: [
        { name: "write_layout", kind: "artifact-writer", description: "Writes supports as fixed or roller." },
      ],
    }),
  );
  const analysis = { slug: "truss", runId: "r2", cases };
  const advice = advicePacket([
    issue({ count: 3, denominator: 4 }),
    issue({ id: JOINTS, kind: "unaccepted", family: "joints", count: 1, denominator: 1 }),
  ]);
  return { root, log, measuredDir, analysis, advice };
}

/** Run the reader with a turn double that makes the given tool calls and records the prompt. */
async function read(
  fixture: ReturnType<typeof battery>,
  calls: Array<Record<string, JsonValue>> = [],
  closing = "read",
) {
  let sent = "";
  const replies: string[] = [];
  const readerTurn: typeof runReaderTurn = async ({ tools, prompt }) => {
    sent = prompt;
    for (const args of calls) replies.push(await call(onlyTool(tools), args));
    return { pin: "review-pin", text: closing, error: null };
  };
  const evidence = await readDiagnoses({
    repoRoot: fixture.root,
    analysis: fixture.analysis,
    measuredDir: fixture.measuredDir,
    advice: fixture.advice,
    review: REVIEW,
    readerTurn,
  });
  return { evidence, prompt: sent, replies };
}

describe("what the diagnosis reader leaves behind", () => {
  test("its whole closing reading, however long, with no cap cutting the end off", async () => {
    const closing = `Reading.${" The last sentence is the one the next reader needs.".repeat(100)}`;
    const { evidence } = await read(battery(), [], closing);
    expect(closing.length).toBeGreaterThan(4_000);
    expect(evidence.readerText).toBe(closing);
  });
});

describe("what the diagnosis reader is shown", () => {
  test("every failing solve as addressable steps, beside the harness surface and a passing contrast", async () => {
    const { prompt, evidence } = await read(battery());
    expect(prompt).toContain(
      '  s2 write_layout ERR turn 2 1.5s → unknown support kind \'pinned\' | args: {"support":"pinned"}',
    );
    // Three identical refusals in a row are one fact, shown once as a range.
    expect(prompt).toContain("  s2–s4 ×3 write_layout ERR");
    expect(prompt).toContain("  end stop stop; 3 of 24 turns;");
    expect(prompt).toContain("accepted submission: yes");
    expect(prompt).toContain("Showing 3 of 3 failing solves; 1 passing solve(s) of this family to contrast.");
    expect(prompt).toContain("c04 (pass)");
    expect(prompt).toContain("- write_layout [artifact-writer]: Writes supports as fixed or roller.");
    expect(prompt).toContain("Write the layout with write_layout, then submit.");
    expect(prompt).toContain(
      "Tools the solver was registered with: read_constants (domain), write_layout (domain).",
    );
    expect(prompt).toContain("write_layout 6 calls in 4 cases, 5 failed");
    expect(prompt).toContain("steel roof trusses");
    expect(prompt).not.toContain("PRIVATE_");
    // Worst share first: every joints solve failed, three of four beams solves did.
    expect(evidence.offered).toEqual([JOINTS, BEAMS]);
    expect(evidence.withheld).toBe(0);
  });

  test("a change to protected detail alone leaves the prompt byte-identical", async () => {
    const fixture = battery();
    const before = await read(fixture);
    fixture.log.write("cases/beam-span-0001/verifier.json", {
      message: "PRIVATE_VERIFIER_B",
      counterexample: { joint: 3 },
      remedy: "PROTECTED_REPAIR",
    });
    fixture.log.record();
    const after = await read(fixture);
    expect(after.prompt).toBe(before.prompt);
    expect(after.evidence.promptDigest).toBe(before.evidence.promptDigest);
    // The nearest hostile case: a change the solver itself saw does move the digest, so the
    // equality above is not a digest that ignores its input.
    fixture.log.write("cases/beam-span-0001/public-task.json", {
      taskId: "beam-span-0001",
      publicTask: { taskId: "beam-span-0001", family: "beams", publicInput: { span: 13 } },
    });
    fixture.log.record();
    expect((await read(fixture)).evidence.promptDigest).not.toBe(before.evidence.promptDigest);
  });

  test("offers at most six issues and records how many it left out", async () => {
    const families = ["f1", "f2", "f3", "f4", "f5", "f6", "f7"];
    const fixture = {
      ...battery(),
      advice: advicePacket(
        families.map((family) => issue({ id: adviceIssueId("verified-fail", family, null), family })),
      ),
    };
    const { evidence } = await read(fixture);
    expect(evidence.offered).toHaveLength(6);
    expect(evidence.withheld).toBe(1);
  });

  test("offers only standing solve-side issues, never the Judge's disagreements or the environment's", () => {
    const judge = adviceIssueId("judge-failed-verifier-passed", "beams", null);
    const provider = adviceIssueId("non-result", "beams", "provider");
    const offered = diagnosableIssues([
      issue({ id: judge, kind: "judge-failed-verifier-passed" }),
      issue({ id: provider, kind: "non-result", detail: "provider" }),
      issue({ id: JOINTS, kind: "unaccepted", family: "joints", count: 1, denominator: 1 }),
      issue({ count: 1, denominator: 4 }),
      issue({ id: adviceIssueId("verified-fail", "old", null), family: "old", absentBatteries: 2 }),
    ]);
    expect(offered.map((row) => row.id)).toEqual([JOINTS, BEAMS]);
  });
});

describe("what a reading records", () => {
  test("a structured diagnosis whose boundary resolves to the shown step and whose confidence is computed", async () => {
    const fixture = battery();
    const { evidence, replies } = await read(fixture, [WRITER_READING]);
    expect(replies[0]).toBe("recorded for 1 issue(s): high confidence (3 of 3 shown, 1 contrast(s))");
    expect(evidence.diagnoses).toEqual([
      {
        issueIds: [BEAMS],
        cited: { boundary: "c01.s2", supporting: ["c01", "c02", "c03"], contrast: ["c04.s2"] },
        diagnosis: {
          runId: "r2",
          layer: "tool-contract",
          intervention: "correct",
          boundary: { tool: "write_layout", reading: WRITER_READING.boundaryReading },
          cause: WRITER_READING.cause,
          falsifier: WRITER_READING.falsifier,
          support: { cases: 3, shown: 3, matching: 3, contrasts: 1 },
          confidence: "high",
        },
      },
    ]);
    const rendered = renderRebuildAdvice(attachIssueReadings(fixture.advice, evidence));
    expect(rendered).toContain(
      "tool-contract layer, intervention correct. First failure boundary at a call to write_layout",
    );
    expect(rendered).toContain(WRITER_READING.falsifier);
    expect(rendered).not.toContain(WRITER_READING.cause);
  });

  test("a reading at the solve's end resolves to no tool, and one reading may cover two issues", async () => {
    const { evidence } = await read(battery(), [
      {
        ...WRITER_READING,
        issueIds: [B, JOINTS.slice(0, 12)],
        layer: "walls",
        intervention: "raise-wall",
        boundary: "c05.end",
        supporting: ["c05", "c01"],
        contrast: [],
      },
    ]);
    expect(evidence.diagnoses[0]?.issueIds).toEqual([BEAMS, JOINTS]);
    expect(evidence.diagnoses[0]?.diagnosis.boundary.tool).toBeNull();
    expect(evidence.diagnoses[0]?.diagnosis.support).toEqual({
      cases: 2,
      shown: 4,
      matching: 4,
      contrasts: 0,
    });
    expect(evidence.diagnoses[0]?.diagnosis.confidence).toBe("medium");
  });

  test.each([
    ["an issue not offered", { issueIds: ["ffffffffffff"] }, "no offered issue has id ffffffffffff"],
    [
      "a boundary outside the supporting solves",
      { boundary: "c04.s2" },
      "must be a shown step of a solve named in supporting",
    ],
    ["a boundary step that does not exist", { boundary: "c01.s9" }, "must be a shown step"],
    ["a passing solve as support", { supporting: ["c01", "c04"] }, "c04 is not one"],
    [
      "a failing step as contrast",
      { contrast: ["c02.s2"] },
      "contrast c02.s2 is not a shown step of a passing solve",
    ],
    ["the solver layer with a change", { layer: "solver" }, "the solver layer takes intervention none"],
    ["a harness layer with no change", { intervention: "none" }, "the solver layer takes intervention none"],
    [
      "a raised wall outside the walls layer",
      { intervention: "raise-wall" },
      "raise-wall belongs to the walls layer",
    ],
    ["no falsifier", { falsifier: "  " }, "are all required"],
    [
      "a named task",
      { falsifier: "beam-span-0002 passes with a pinned support" },
      "may not name an individual task",
    ],
  ])("refuses %s", async (_name, change, why) => {
    const { evidence, replies } = await read(battery(), [{ ...WRITER_READING, ...change }]);
    expect(replies[0]).toContain(why);
    expect(evidence.diagnoses).toEqual([]);
    expect(evidence.refused).toBe(1);
  });

  // The cause reaches the epoch reviewer and never the author, so its length bounds nothing the
  // author reads; the boundary reading and the falsifier are rendered into the author's advice and
  // keep their ceilings.
  test("a long cause is recorded, while an overlong author-visible reading is still refused", async () => {
    const cause =
      `the writer's support enum omits pinned; ${"so no valid call can express it. ".repeat(30)}`.trim();
    expect(cause.length).toBeGreaterThan(600);
    const { evidence, replies } = await read(battery(), [
      { ...WRITER_READING, boundaryReading: "x".repeat(301) },
      { ...WRITER_READING, cause },
    ]);
    expect(replies[0]).toContain("boundaryReading exceeds 300 characters");
    expect(replies[1]).toContain("recorded for 1 issue(s)");
    expect(evidence.diagnoses[0]?.diagnosis.cause).toBe(cause);
  });

  // An abstention records its issues and its reason and nothing else reads a third field, so a
  // stray one beside them is ignored rather than refused for its form.
  test("an abstention records its issues and its reason, and an issue resolves once", async () => {
    const { evidence, replies } = await read(battery(), [
      {
        issueIds: [B],
        abstainReason: "the shown steps cannot separate the writer from the guide",
        layer: "solver",
      },
      { issueIds: [B], abstainReason: "the shown steps cannot separate the writer from the guide" },
      WRITER_READING,
    ]);
    expect(replies[0]).toBe("abstained for 1 issue(s)");
    expect(replies[1]).toContain("is already diagnosed or explicitly declined");
    expect(replies[2]).toContain("is already diagnosed or explicitly declined");
    expect(evidence.abstentions).toEqual([
      { issueIds: [BEAMS], reason: "the shown steps cannot separate the writer from the guide" },
    ]);
  });

  test("a failed turn keeps its error and discards what its tool calls recorded", async () => {
    const fixture = battery();
    const evidence = await readDiagnoses({
      repoRoot: fixture.root,
      analysis: fixture.analysis,
      measuredDir: fixture.measuredDir,
      advice: fixture.advice,
      review: REVIEW,
      readerTurn: async ({ tools }) => {
        await call(onlyTool(tools), WRITER_READING);
        return { pin: "review-pin", text: "partial", error: "diagnosis-reader turn aborted" };
      },
    });
    expect(evidence.error).toBe("diagnosis-reader turn aborted");
    expect(evidence.diagnoses).toEqual([]);
    expect(evidence.readerText).toBeNull();
  });
});

describe("confidence is how far the reading was sampled", () => {
  test.each([
    [{ cases: 3, shown: 4, matching: 9, contrasts: 1 }, "high"],
    [{ cases: 3, shown: 4, matching: 9, contrasts: 0 }, "medium"],
    [{ cases: 2, shown: 4, matching: 4, contrasts: 0 }, "medium"],
    [{ cases: 2, shown: 6, matching: 6, contrasts: 0 }, "low"],
    [{ cases: 1, shown: 1, matching: 1, contrasts: 1 }, "low"],
  ] as const)("%o reads %s", (support, expected) => {
    expect(diagnosisConfidence(support)).toBe(expected);
  });
});

describe("a solve compiled into steps", () => {
  const WALLS = { maxTurns: 4, solveMinutes: 1 };
  const trace = (calls: Call[], turns: number): ReadCaseTrace => ({
    schema: "case-trace/v4",
    backend: "codex",
    turns: Array.from({ length: turns }, (_, index) => ({
      stopReason: index === turns - 1 ? "length" : "toolUse",
      assistantPreview: index === turns - 1 ? "Still drafting." : "",
      timingMs: 15_000,
    })),
    toolCalls: calls.map((entry, index) => toolCall(entry, index + 1)),
    truncated: false,
    droppedRawEvents: 0,
  });

  test("a long solve keeps its opening, first failures and close, and omitted steps cannot be cited", () => {
    const calls: Call[] = Array.from({ length: 30 }, (_, index) => ({
      tool: index === 10 ? "write_layout" : "bash",
      ok: index !== 10,
      result: `step ${index + 1}`,
    }));
    const solve = compileSolve("c07", "fail", trace(calls, 4), WALLS, "accepted");
    expect(solve.text).toContain("  s11 write_layout ERR");
    expect(solve.text).toContain("… 6 step(s) omitted, not citable");
    expect(solve.refs.has("c07.s11")).toBe(true);
    expect(solve.refs.has("c07.s6")).toBe(false);
    expect(solve.refs.get("c07.end")).toBeNull();
    expect(solve.text).toContain("4 of 4 turns; 1.0 of 1 minutes; turn cap reached; solve wall reached");
    expect(batteryCensus([solve])).toContain("1 reached the turn cap, 1 reached the solve wall.");
  });

  test("a trace is called a prefix only when its capture was truncated, not when raw events were dropped", () => {
    const calls: Call[] = [{ tool: "bash", ok: true, result: "done" }];
    const prefix = "the recorded trace is a prefix";
    const complete = compileSolve("c03", "fail", { ...trace(calls, 1), droppedRawEvents: 3 }, WALLS, "none");
    expect(complete.text).not.toContain(prefix);
    const cut = compileSolve("c04", "fail", { ...trace(calls, 1), truncated: true }, WALLS, "none");
    expect(cut.text).toContain(prefix);
  });

  test("a missing trace compiles to nothing citable", () => {
    const solve = compileSolve("c02", "unaccepted", null, WALLS, "none");
    expect(solve.refs.size).toBe(0);
    expect(solve.text).toBe("c02 (unaccepted): no readable trace, so nothing in it can be cited");
  });
});

describe("the tool alone", () => {
  test("refuses a reading when no solve was shown for the named issue", async () => {
    const fixture = battery();
    const { offers } = diagnosisPacket(
      { analysis: fixture.analysis, repoRoot: fixture.root, measuredDir: fixture.measuredDir },
      [issue({ count: 3, denominator: 4 })],
    );
    const sink: DiagnosisReaderEvidence = {
      schema: "diagnosis-reading/v2",
      slug: "truss",
      runId: "r2",
      readerPin: null,
      promptDigest: null,
      offered: [BEAMS],
      withheld: 0,
      diagnoses: [],
      abstentions: [],
      refused: 0,
      error: null,
      readerText: null,
    };
    const tool = recordDiagnosisTool(offers, [], sink);
    expect(await call(tool, { ...WRITER_READING, issueIds: [JOINTS.slice(0, 12)] })).toContain(
      "no offered issue",
    );
    expect(await call(tool, { ...WRITER_READING, supporting: ["c05"], boundary: "c05.end" })).toContain(
      "c05 is not one",
    );
    expect(sink.refused).toBe(2);
  });
});
