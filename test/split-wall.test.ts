/**
 * The split build's wall as a break-it check (S2): run the same scripted round twice, changing only
 * what one side may not see, and every text the other side reads must come out byte-identical.
 *
 * The OS wall (candidate-isolation-guard.test.ts) keeps the Harness Builder's file tools out of
 * correctness-model/ and answer/. This file is the other half: every controller surface the Harness
 * Builder reads — its system prompt and openings, harness_inspect's readiness, task, feedback and
 * coverage, harness_trial, the context tool, correctness_check, submit and the workspace files the
 * controller writes for it — over two correctness models that differ in everything private: the
 * hidden expectations and check ids, the private rule, the evaluator and reference source, the
 * controls, the answer agent's notes and scratch, and a census finding's detail. The reverse run
 * varies a finding on agent/ and reads what the answer agent sees.
 *
 * Content-addressed identities (a candidate, snapshot or condition id, a commit, the accepted
 * correctnessModel hash prefix) and wall-clock readings are normalised before the comparison: they
 * are hashes and clocks over the whole candidate, which name it without carrying any of its
 * content. The trial's verdict is the one fact rule 4 lets cross, so both models grade the trial
 * task alike.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { Type } from "typebox";
import type { CampaignFeedback } from "../src/author/campaign-types.ts";
import type { PiTool } from "../src/backends/pi-session.ts";
import {
  BUNDLE_SNAPSHOT_DIRECTORY,
  EARLIER_BUNDLE_SNAPSHOT_DIRECTORY,
} from "../src/claim/bundle-snapshot.ts";
import { controllerValidatedFindings } from "../src/correctness-bundle/brief.ts";
import { type Solver, withSolverBuiltStarterFactory } from "../src/correctness-bundle/solve.ts";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join, relative } from "../src/meta/path.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import { createBuiltStarter } from "../src/solve/built-starter.ts";
import { defineDraftTool } from "../src/solve/draft-tool.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { FRESH_BUILD } from "./helpers/builder-campaign.ts";
import { double, required, scriptedSession } from "./helpers/doubles.ts";
import {
  MATCHING_ACCEPTS,
  MATCHING_BRIEF,
  MATCHING_EVALUATOR_SOURCE,
  MATCHING_OPERATING_GUIDE,
  MATCHING_REFERENCE_SOURCE,
  MATCHING_REJECTS,
  MATCHING_TASKS,
  MATCHING_TOOLS_SOURCE,
  MATCHING_TOOLS_SPEC,
  padToCalibrationFloor,
} from "./helpers/matching-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const HOUR = 3_600_000;
const WRITER = "write_answer";
/** The fixture's second check, which a variant renames everywhere the correctness model names it. */
const RENAMED_CHECK = "expected-binding";
/** The answer pass after which the stub gate stops refusing the correctness model. */
const REVISED = "revised";

type Role = "answer" | "harness";

/** Everything one variant puts where only its own side may look. */
interface Variant {
  marker: string;
  checkId: string;
}

const PRIVATE_A: Variant = { marker: "private-alpha 41.7 kN at node 3", checkId: RENAMED_CHECK };
const PRIVATE_B: Variant = { marker: "private-bravo 9.2 kN at node 7", checkId: "slot-binding-exact" };

afterAll(cleanupScratch);

/** A correctness model that grades every answer as the fixture's does, carrying the variant in
 *  every private place: check ids, hidden expectations, the private rule, both sources, controls,
 *  notes and scratch. */
function writeAnswerHalf(workspace: string, { marker, checkId }: Variant): void {
  const rename = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll(RENAMED_CHECK, checkId));
  const brief = rename({
    ...MATCHING_BRIEF,
    ruleDecisions: MATCHING_BRIEF.ruleDecisions?.map((rule) =>
      rule.visibility === "private" ? { ...rule, statement: `${rule.statement}; ${marker}` } : rule,
    ),
  });
  const tasks = rename(
    MATCHING_TASKS.map((task) => ({
      ...task,
      hidden: task.hidden.map((row) => ({
        ...row,
        expectation: { ...double<object>(row.expectation), note: marker },
      })),
    })),
  );
  const tagged = <T extends { id: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, id: `${row.id}-${checkId}` }));
  const controls = rename({
    accept: tagged(padToCalibrationFloor("accept", MATCHING_ACCEPTS)),
    reject: tagged(padToCalibrationFloor("reject", MATCHING_REJECTS)),
  });
  const model = join(workspace, "correctness-model");
  mkdirSync(join(model, "reference"), { recursive: true });
  mkdirSync(join(workspace, "answer"), { recursive: true });
  writeFileSync(join(model, "brief.json"), JSON.stringify(brief));
  writeFileSync(join(model, "tasks.json"), JSON.stringify(tasks));
  writeFileSync(join(model, "controls.json"), JSON.stringify(controls));
  writeFileSync(
    join(model, "evaluator.ts"),
    `// ${marker}\n${MATCHING_EVALUATOR_SOURCE.replaceAll(RENAMED_CHECK, checkId)}`,
  );
  writeFileSync(join(model, "reference/index.ts"), `${MATCHING_REFERENCE_SOURCE}\n// ${marker}\n`);
  writeFileSync(join(model, "NOTES.md"), `${marker}\n`);
  writeFileSync(join(workspace, "answer/search.log"), `${marker}\n`);
}

function writeHarnessHalf(workspace: string): void {
  writeFileSync(join(workspace, "agent/tools.ts"), MATCHING_TOOLS_SOURCE);
  writeFileSync(join(workspace, "agent/BUILT_AGENTS.md"), MATCHING_OPERATING_GUIDE);
  writeFileSync(join(workspace, "agent/tools-spec.json"), JSON.stringify(MATCHING_TOOLS_SPEC));
}

/** The measured Built solver's stand-in: it binds the one public part to its public slot. */
function bindingSolver(): Solver {
  const solver: Solver = async (task, toolset) => {
    const input = double<{ bindings: Array<{ part: string; slot: string }> }>(task.publicInput);
    const byName = new Map(toolset.tools.map((tool) => [tool.name, tool]));
    const tool = (name: string) => required(byName.get(name), `a registered ${name}`);
    await tool(WRITER).execute(WRITER, double({ assignments: input.bindings }), undefined);
    await tool("submit").execute("submit", double({}), undefined);
    return { turns: 1, completedTurns: 1, errors: [], toolCalls: 2, startedToolCalls: 2 };
  };
  return withSolverBuiltStarterFactory(solver, async (_slugDir, task, submission, schema) =>
    createBuiltStarter(
      task,
      () => ({
        tools: [
          defineDraftTool({
            name: WRITER,
            label: "Write answer",
            description: "Write the complete structured answer.",
            executionMode: "sequential",
            parameters: Type.Object({ assignments: Type.Unknown() }),
            run(params, draft) {
              draft.setArtifact(double(params));
              return { text: "answer written" };
            },
          }),
        ],
      }),
      submission,
      {
        domainToolAuthorities: [{ name: WRITER, authority: "artifact-writer" }],
        publicArtifactSchema: schema,
      },
    ),
  );
}

async function call(
  tools: readonly PiTool[],
  name: string,
  args: Record<string, string> = {},
): Promise<string> {
  const tool = required(
    tools.find((candidate) => candidate.name === name),
    `a mounted ${name}`,
  );
  const result = await double<{
    execute(id: string, args: Record<string, string>): Promise<{ content: { text?: string }[] }>;
  }>(tool).execute(name, args);
  return result.content.map((part) => part.text ?? "").join("\n");
}

/** Every file the Harness Builder's file tools can open: the workspace outside its wall and `.git`,
 *  and outside the bundle snapshots, which the guard denies as measured evidence
 *  (candidate-isolation-guard.test.ts). */
function readableFiles(workspace: string) {
  const walled = new Set([
    "correctness-model",
    "answer",
    ".git",
    BUNDLE_SNAPSHOT_DIRECTORY,
    EARLIER_BUNDLE_SNAPSHOT_DIRECTORY,
  ]);
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = relative(workspace, path);
      if (walled.has(rel)) continue;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.set(rel, readFileSync(path, "utf8"));
    }
  };
  walk(workspace);
  return files;
}

/** Hashes, clocks and the round's scratch directory name the whole candidate, or the test's own
 *  run, without carrying any of its content. */
function normalised(text: string): string {
  return text
    .replaceAll(/\/[^\s"]*\/ana-split-wall-[^/\s"]+/g, "<scratch>")
    .replaceAll(/[0-9a-f]{12,64}/g, "<hex>")
    .replaceAll(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>")
    .replaceAll(/("\w*(?:[mM]s|Seconds|Minutes|minutes)":)\d+(?:\.\d+)?/g, "$1<n>")
    .replaceAll(/\b\d+(?:\.\d+)? ?ms\b/g, "<n>ms");
}

/**
 * One split round over a variant: the answer agent writes its half, the Harness Builder reads every
 * surface it has and submits, the stub gate refuses the correctness model until the answer agent
 * revises it, and the round ends accepted. Returns what each side read, in order.
 */
async function splitRound(answerSide: Variant, harnessFinding: string) {
  const campaignDir = scratchDir("ana-split-wall-");
  const workspace = join(campaignDir, "workspace");
  const read: Record<Role, string[]> = { answer: [], harness: [] };
  const harnessReads = async (tools: readonly PiTool[]) => {
    const seen = read.harness;
    seen.push(await call(tools, "harness_inspect", { action: "readiness" }));
    seen.push(await call(tools, "harness_inspect", { action: "task", taskId: "t1" }));
    seen.push(await call(tools, "harness_inspect", { action: "coverage" }));
    seen.push(await call(tools, "harness_trial", { taskId: "t1" }));
    seen.push(
      await call(tools, "context", {
        question: "what is this round",
        decides: "where to start",
        source: "round",
      }),
    );
    seen.push(await call(tools, "correctness_check"));
    seen.push(await call(tools, "harness_inspect", { action: "feedback" }));
    for (const [path, text] of readableFiles(workspace)) seen.push(`${path}\n${text}`);
    seen.push(await call(tools, "submit"));
  };
  const answerReads = async (tools: readonly PiTool[]) => {
    read.answer.push(await call(tools, "correctness_check"));
    read.answer.push(await call(tools, "harness_inspect", { action: "feedback" }));
  };
  const passes: Record<Role, number> = { answer: 0, harness: 0 };
  const open = async (opened: readonly PiTool[], systemPrompt: string) => {
    const role: Role = systemPrompt.startsWith("You are the answer agent") ? "answer" : "harness";
    read[role].push(systemPrompt);
    let tools = opened;
    return scriptedSession(
      async ({ prompt }) => {
        passes[role] += 1;
        read[role].push(prompt);
        if (role === "answer") {
          // The first pass writes the answer half; a later one is the revision the gate asks for.
          if (passes.answer === 1) {
            writeAnswerHalf(workspace, answerSide);
          } else {
            writeFileSync(
              join(workspace, "correctness-model/NOTES.md"),
              `${answerSide.marker}\n${REVISED}\n`,
            );
          }
          if (existsSync(join(workspace, "agent/tools-spec.json"))) await answerReads(tools);
        } else {
          writeHarnessHalf(workspace);
          await harnessReads(tools);
        }
        return { status: "completed", assistantText: "done" };
      },
      () => {},
      (next) => {
        tools = next;
      },
    );
  };
  const revised = () => readFileSync(join(workspace, "correctness-model/NOTES.md"), "utf8").includes(REVISED);
  const refused: CampaignFeedback = {
    owner: "correctness-model/evaluator.ts",
    severity: "blocking",
    claim: `the reference solve fails a check: ${answerSide.marker}`,
    evidence: "census.json",
    findings: controllerValidatedFindings([
      { code: "reference-solve-failed", path: "census.json", detail: answerSide.marker },
    ]),
  };
  const thin: CampaignFeedback = {
    owner: "correctness-model/tasks.json",
    severity: "advisory",
    claim: `a family is thin: ${answerSide.marker}`,
    evidence: "census.json",
  };
  // Validated, so its detail reaches the side that owns agent/ and the reverse case varies
  // something that side reads.
  const long: CampaignFeedback = {
    owner: "agent/BUILT_AGENTS.md",
    severity: "advisory",
    claim: `the guide is long: ${harnessFinding}`,
    evidence: "guide.json",
    findings: controllerValidatedFindings([
      { code: "guide-too-long", path: "agent/BUILT_AGENTS.md", detail: harnessFinding },
    ]),
  };
  const gates = async () => (revised() ? [thin, long] : [refused, thin, long]);
  const outcome = await runBuilderCampaign(
    { campaignDir, ...FRESH_BUILD },
    {
      tools: [],
      answer: { tools: [], wallMs: HOUR },
      toolsProbes: () => ({}),
      waitMs: async () => {},
      builtSolver: () => bindingSolver(),
      verifierLifetime: createVerifierLifetime({ root: join(campaignDir, ".verifier") }),
      gates,
      open,
    },
  );
  return { outcome, read };
}

describe("the split build's wall, broken from each side", () => {
  it("shows the Harness Builder byte-identical texts over two correctness models that differ in everything private", async () => {
    const a = await splitRound(PRIVATE_A, "the same agent finding");
    const b = await splitRound(PRIVATE_B, "the same agent finding");
    expect(a.outcome.buildAdmissible).toBe(true);
    expect(b.outcome.buildAdmissible).toBe(true);
    // The round reached every surface twice: before the hand-back and after the revision.
    expect(a.read.harness.length).toBeGreaterThan(20);
    expect(a.read.harness.map(normalised)).toEqual(b.read.harness.map(normalised));
    const harness = a.read.harness.join("\n");
    for (const marker of [PRIVATE_A.marker, PRIVATE_A.checkId, "private-alpha"]) {
      expect(harness).not.toContain(marker);
    }
    // The variants did reach the side that owns them.
    expect(a.read.answer.join("\n")).toContain(PRIVATE_A.marker);
  }, 120_000);

  it("shows the answer agent byte-identical findings over two different findings on agent/", async () => {
    const a = await splitRound(PRIVATE_A, "agent-only detail one");
    const b = await splitRound(PRIVATE_A, "agent-only detail two");
    expect(a.read.answer.map(normalised)).toEqual(b.read.answer.map(normalised));
    expect(a.read.answer.join("\n")).not.toContain("agent-only detail");
    expect(a.read.harness.join("\n")).toContain("agent-only detail one");
  }, 120_000);
});
