/** A repeated diagnosis on a changed tree is ordinary repair: no in-session strike counts it,
 *  and only the byte-identical resubmit owner still strikes. */
import { describe, expect, it } from "bun:test";
import { runBuilderSession, type BuilderSubmitOutcome } from "../src/author/builder-session.ts";
import { builderExecutionEvidenceWriter } from "../src/author/builder-execution-writer.ts";
import { type BuilderCustomToolSemantic, submitProjection } from "../src/author/builder-execution.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import { mkdirSync, mkdtempSync } from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { readExecutionEvidenceDetails } from "../tools/outcome/builder-execution-facts.ts";
import { double, required, toolDouble } from "./helpers/doubles.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";

type ToolResult = {
  content: Array<{ text: string }>;
  details?: { receipt: BuilderCustomToolSemantic };
  terminate?: boolean;
};
type HostedTool = { name: string; execute(id: string, args: Record<string, JsonValue>): Promise<ToolResult> };

const accepted: BuilderSubmitOutcome = {
  ok: true,
  fingerprint: {
    ok: true,
    slug: "matching",
    agentHash: "a".repeat(64),
    correctnessModelHash: "b".repeat(64),
    scoringHash: "b".repeat(64),
    taskSetHash: "c".repeat(64),
    agentFiles: [],
    correctnessModelFiles: [],
  },
  commit: "d".repeat(40),
  baseCommit: "e".repeat(40),
  changedPaths: [],
  deletedPaths: [],
  snapshotDir: "/controller/snapshot",
  snapshotId: "snapshot",
  engineCondition: null,
  verifierEnvironmentHash: null,
  advisories: [],
  bundle: {
    brief: MATCHING_BRIEF,
    battery: { tasks: [] },
    corpus: { accept: [], reject: [] },
    toolsSpec: { presets: [], tools: [] },
  },
};

function refused(key: string, commit: number, stage: "bundle" | "gates" = "bundle"): BuilderSubmitOutcome {
  return {
    ok: false,
    stage,
    commit: String(commit).padStart(40, "0"),
    findings: [{ code: "missing-bundle-file", path: `correctness-model/${key}.json`, detail: "absent" }],
  };
}

async function session(submissions: readonly BuilderSubmitOutcome[]) {
  const epoch = mkdtempSync(join(tmpdir(), "ana-session-stall-"));
  const workspace = join(epoch, "workspace");
  mkdirSync(workspace);
  const write = builderExecutionEvidenceWriter(epoch);
  const returns: ToolResult[] = [];
  const late: ToolResult[] = [];
  let calls = 0;
  let turns = 0;
  let disposed = 0;
  let lateWrites = 0;
  const outcome = await runBuilderSession(
    {
      slug: "matching",
      kickoff: "Build a slot binding harness.",
      workspace,
      maxTurns: submissions.length + 2,
    },
    {
      tools: [
        toolDouble({
          name: "write",
          async execute() {
            lateWrites += 1;
            return { content: [] };
          },
        }),
      ],
      submit: () => required(submissions[calls++], "scripted submission"),
      onCheckpoint: write,
      onExecution: write,
      open: async (roster): Promise<HostSession> => {
        const tools = double<HostedTool[]>(roster);
        const submit = required(
          tools.find((tool) => tool.name === "submit"),
          "hosted submit",
        );
        const writeTool = required(
          tools.find((tool) => tool.name === "write"),
          "hosted write",
        );
        return {
          backend: "codex",
          async runTurn() {
            turns += 1;
            returns.push(await submit.execute(`submit-${turns}`, {}));
            if (turns === submissions.length) {
              late.push(await submit.execute("late-submit", {}));
              late.push(await writeTool.execute("late-write", {}));
            }
            return { status: "completed", assistantText: "submitted" };
          },
          configure() {},
          sessionId: "pi-test",
          async dispose() {
            disposed += 1;
          },
        };
      },
    },
  );
  const saved = readExecutionEvidenceDetails(epoch);
  expect(saved.unavailable).toEqual([]);
  expect(saved.records).toHaveLength(1);
  return {
    outcome,
    calls,
    turns,
    disposed,
    lateWrites,
    returns,
    late,
    evidence: required(saved.records[0], "saved session"),
  };
}

describe("Builder refusal cycles", () => {
  it.each(["AAAA", "ABABA"])(
    "keeps a session open through repeated diagnoses on changed trees: %s",
    async (sequence) => {
      // Run 9b63f9 alternated diagnoses over 32 changed candidates. Operator decision 2026-09-14:
      // a changed tree with the same diagnosis is repair in progress, not a stall; the submit
      // bound alone closes it.
      const keys = sequence.split("");
      const run = await session([...keys.map((key, index) => refused(key, index + 1)), accepted]);
      expect(run.outcome).toMatchObject({ ok: true, terminal: false, validationAttempts: keys.length + 1 });
      expect(
        run.returns
          .slice(0, keys.length)
          .some((result) => result.content[0]?.text.includes("strike") === true),
      ).toBe(false);
      expect(
        run.returns
          .slice(0, keys.length)
          .some((result) => result.content[0]?.text.includes("This refusal is final") === true),
      ).toBe(false);
      expect(run.evidence.submits.map((attempt) => attempt.terminal)).toEqual(
        keys.map(() => false).concat(false),
      );
      expect(run.evidence.submits.at(-1)?.outcome).toBe("accepted");
      // Only the accepted submit ends the round; a refusal that is not final keeps it open.
      expect(run.returns.map((result) => result.terminate === true)).toEqual(
        keys.map(() => false).concat(true),
      );
      expect(run.evidence.outcome).toBe("recorded");
      expect(run.lateWrites).toBe(0);
      expect(run.disposed).toBe(1);
    },
  );

  it("leaves byte-identical retries to the unchanged-candidate owner", async () => {
    const run = await session([...Array.from({ length: 4 }, () => refused("A", 1)), accepted]);
    expect(run.outcome).toMatchObject({ ok: true, validationAttempts: 5 });
    expect(
      run.returns.slice(0, 4).some((result) => result.content[0]?.text.includes("strike") === true),
    ).toBe(false);
    expect(submitProjection(run.evidence.submits).unchangedTreeSubmits).toBe(3);
  });
});
