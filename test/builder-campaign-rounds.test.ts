/**
 * What a round hands the Builder, what it tells a running session, and what the accepted bytes
 * are admitted as.
 *
 * The opening prompt and the mounted roster are a condition identity, so these read what the
 * controller assembled rather than what a Builder did with it. While the session runs, the
 * controller's own words are the projected repair evidence, which fails closed to a generic label;
 * the Epoch Reviewer's word to the same session is `authoring-review.test.ts`'s. Admission then binds the accepted bytes to an experiment: what
 * the bytes moved decides the scope, never the loop that asked for the round, and a reopened or
 * resumed workspace keeps the edits it was interrupted in.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  FRESH_BUILD,
  blockingRow,
  bundleWithoutGuide,
  commitRoundEntry,
  completeBundle,
  namedTool,
  openingPrompt,
  proposeExperiment,
  replyText,
  submitOnce,
  submitTool,
  submittingSession,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { scriptedSession } from "./helpers/doubles.ts";
import { MATCHING_BRIEF, MATCHING_OPERATING_GUIDE, MATCHING_TASKS } from "./helpers/matching-fixture.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import {
  commitAll,
  initWorkspace,
  resetWorkspaceToStarter,
  workspaceHead,
  workspaceStatus,
} from "../src/author/domain-repo.ts";
import type { CampaignFeedback } from "../src/author/campaign-types.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { BuilderCampaignDeps, BuilderCampaignInput } from "../src/run/builder-campaign.ts";
import { renderBatteryContract } from "../src/run/climb-readout.ts";
import { loadSolvabilityPublicSchema } from "../src/truth/solvability-artifact-schema.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";

afterAll(cleanupScratch);

const BARE = { tools: [], toolsProbes: () => ({}) } satisfies Pick<
  BuilderCampaignDeps,
  "tools" | "toolsProbes"
>;
const packet = (digest: string, feedback: CampaignFeedback[]) => ({
  kind: "admitted-packet" as const,
  digest,
  feedback,
});
const touch = (workspace: string, ...paths: string[]) => {
  for (const path of paths) {
    const file = join(workspace, path);
    writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
  }
};
/** A round-entry workspace plus an adopted copy of its agent and correctness-model trees. */
function adoptedRound(prefix: string) {
  const campaignDir = scratchDir(prefix);
  const workspace = join(campaignDir, "workspace");
  commitRoundEntry(workspace);
  const adoptedDir = join(campaignDir, "adopted");
  cpSync(join(workspace, "agent"), join(adoptedDir, "agent"), { recursive: true });
  cpSync(join(workspace, "correctness-model"), join(adoptedDir, "correctness-model"), { recursive: true });
  return { campaignDir, workspace, adoptedDir };
}

describe("the opening a round composes", () => {
  it("ends a probe-only campaign at its turn bound, never on a probe budget or no-submit strike", async () => {
    const campaignDir = scratchDir("ana-probe-only-campaign-");
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 3 },
      {
        ...BARE,
        open: async () =>
          scriptedSession(async ({ onEvent }) => {
            turns += 1;
            for (let index = 0; index < 40; index += 1) {
              onEvent?.({ type: "tool_ended", toolName: "Bash", isError: false });
            }
            return { status: "completed", assistantText: "checked the toolchain" };
          }),
      },
    );
    expect(outcome).toMatchObject({ buildAdmissible: false, clause: "iterations-exhausted" });
    expect(turns).toBe(3);
  });

  it("serves one round contract to the opening and harness_inspect, ahead of the advice, on the closed roster with the plan view", async () => {
    // The contract has one owner and two readers; comparing both against what the round actually
    // served, rather than against the renderer, is what catches the readers drifting apart.
    const campaignDir = scratchDir("ana-contract-readers-");
    const note = "the prior battery verified 21 of 25";
    let delivered = "";
    let served = "";
    let roster: string[] = [];
    let plan = "";
    await expect(
      runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD, advisoryNote: note },
        {
          ...BARE,
          waitMs: async () => {},
          open: async (tools) =>
            scriptedSession(async ({ prompt }) => {
              delivered = prompt;
              // SAFETY: production composition supplies AgentTool-shaped rows; only the name is read.
              roster = tools.map((tool) => (tool as { name?: string }).name ?? "");
              const inspected = await namedTool(tools, "harness_inspect").execute("inspect-1", {
                action: "readiness",
              });
              served = inspected.content[0]?.text ?? "{}";
              const page = await namedTool(tools, "context").execute("context-1", {
                question: "what does the round plan need",
                decides: "whether to write EXPERIMENT.json",
                depth: "page",
                id: "round/plan",
              });
              plan = page.content[0]?.text ?? "";
              return { status: "failed", errorMessages: ["stop after prompt proof"] };
            }),
        },
      ),
    ).rejects.toThrow(/stop after prompt proof/);
    const contract: string = JSON.parse(served).contract ?? "";
    expect(contract).toContain("Task count: exactly 4 tasks.");
    expect(contract).toContain(renderBatteryContract(4));
    expect(delivered).toContain(contract);
    expect(delivered).not.toContain(renderBatteryContract(25));
    expect(delivered.indexOf("Task count: exactly 4 tasks.")).toBeLessThan(delivered.indexOf(note));
    expect(roster).toEqual(expect.arrayContaining(["harness_inspect", "harness_trial", "submit"]));
    // No adoption gate is supplied, so correctness_check is not registered.
    expect(roster).not.toContain("correctness_check");
    // A first round scores its rehearsals only against a plan it was shown how to write.
    expect(plan).toContain("Round plan: EXPERIMENT.json is not written yet. Write EXPERIMENT.json as");
  });

  it.concurrent("opens a probe round on the range it may choose in, not one size", async () => {
    const prompt = await openingPrompt({ ...FRESH_BUILD, expectedTasks: 10, minTasks: 5 });
    expect(prompt).toContain("Task count: between 5 and 10 tasks — choose the size in that range yourself.");
    expect(prompt).not.toContain("exactly 10 tasks");
    expect(prompt).toContain(renderBatteryContract(10, 5));
    expect(prompt).toContain(
      "read the row for the size you pick: 5 tasks — author for about 1, aim 1 to 2, 5 or more finds no limit.",
    );
    expect(prompt).toContain("8 tasks — author for about 1, aim 2 to 4, 7 or more finds no limit");
    expect(prompt).not.toContain("for your chosen size");
    expect(prompt).not.toMatch(/\bof 10\b/);
  });

  it.concurrent("projects carried repair evidence at the opening boundary without its raw detail", async () => {
    const raw = {
      ...blockingRow("tests", "RAW_PROTECTED_CLAIM", "RAW_PROTECTED_EVIDENCE"),
      findings: [{ code: "RAW_PROTECTED_CODE", path: "RAW_PROTECTED_PATH", detail: "RAW_PROTECTED_DETAIL" }],
    };
    const delivered = await openingPrompt({ ...FRESH_BUILD, priorEvidence: packet("e".repeat(64), [raw]) });
    expect(delivered).toContain(
      "tests (correctness-model/tasks.json): [blocking] generated-execution-unclassified: a check failed while executing your generated code and carries no public detail; use harness_inspect for static diagnostics, harness_trial for the generated solve path, or verifier_workshop for the correctnessModel path",
    );
    expect(delivered).not.toContain("RAW_PROTECTED");
  });
});

describe("the controller's word to a running session", () => {
  it.concurrent("replaces an unclassified generated finding with the generic label in the submit reply", async () => {
    const campaignDir = scratchDir("ana-isolation-unclassified-");
    const marker = "planted-marker-9f3a17";
    const refusal = await submitOnce(campaignDir, () => completeBundle(join(campaignDir, "workspace")), {
      load: async () => [
        { code: "generated-load-crash", path: "agent/tools.ts", detail: `worker stack: ${marker}` },
      ],
    });
    expect(refusal).not.toContain(marker);
    expect(refusal).toContain("generated-execution-unclassified");
  });

  it.concurrent("derives the pre-guide legacy condition from completed memory, never from the entry HEAD", async () => {
    // Submit commits before it validates, so a fresh build refused for the missing guide leaves
    // brief-without-guide at HEAD; only a commit backed by a completed iteration opens the exemption.
    const campaignDir = scratchDir("ana-primary-preguide-");
    const workspace = join(campaignDir, "workspace");
    expect(await submitOnce(campaignDir, () => bundleWithoutGuide(workspace))).toContain("BUILT_AGENTS.md");
    const resumed = await submitOnce(campaignDir, () =>
      writeFileSync(join(workspace, "SCRATCHPAD.md"), "resumed\n"),
    );
    expect(resumed).toContain("BUILT_AGENTS.md");
    const completedDir = join(campaignDir, "01-matching");
    mkdirSync(completedDir, { recursive: true });
    writeFileSync(
      join(completedDir, "iteration.json"),
      JSON.stringify({
        outcome: "gates-blocked",
        feedback: [],
        workspaceChange: { commit: workspaceHead(workspace) },
      }),
    );
    const legacy = await submitOnce(campaignDir, () =>
      writeFileSync(join(workspace, "SCRATCHPAD.md"), "legacy repair\n"),
    );
    expect(legacy).not.toContain("BUILT_AGENTS.md");
  });

  it("settles the authoring tree at a tool checkpoint, so a host kill between gates loses no bytes", async () => {
    const campaignDir = scratchDir("ana-checkpoint-commit-");
    const workspace = join(campaignDir, "workspace");
    await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1 },
      {
        ...BARE,
        open: async () =>
          scriptedSession(async ({ onEvent }) => {
            writeFileSync(join(workspace, "agent/tools.ts"), "// authored between gates\n");
            onEvent?.({ type: "tool_ended", toolName: "Bash", isError: false });
            return { status: "completed", assistantText: "authored" };
          }),
      },
    );
    // A clean tree over a tracked file means HEAD carries the bytes the session wrote.
    expect(workspaceStatus(workspace).clean).toBe(true);
    expect(readFileSync(join(workspace, "agent/tools.ts"), "utf8")).toBe("// authored between gates\n");
  });
});

describe("the admission a repair earns", () => {
  it.concurrent("attributes the whole repair span after a refused submit, with no repair owner narrowing it", async () => {
    // Repair feedback directs the work while the ordinary gates judge the whole candidate: a
    // cross-owner edit is kept, and a bundle refusal that commits mid-span loses none of it.
    const campaignDir = scratchDir("ana-primary-repair-span-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    let gateCalls = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        ...FRESH_BUILD,
        maxTurns: 3,
        priorEvidence: packet("packet-verifier", [
          blockingRow("correctness-model", "repair the verifier only", "packet.json"),
        ]),
      },
      {
        ...BARE,
        gates: async () => {
          gateCalls += 1;
          return [blockingRow("correctness-model", "repair the verifier only", `census-${gateCalls}.json`)];
        },
        open: async (tools) => {
          let turns = 0;
          return scriptedSession(async () => {
            turns += 1;
            const submit = submitTool(tools);
            if (turns === 1) {
              completeBundle(workspace);
              await submit.execute("submit-1", {});
              return { status: "completed", assistantText: "submitted" };
            }
            // The drift and a bundle break go in together: the refusal commits both without
            // settling, and the follow-up submit's own diff carries only the guide restore.
            writeFileSync(join(workspace, "agent/tools.ts"), "// cross-owner rewrite\n");
            rmSync(join(workspace, "agent/BUILT_AGENTS.md"));
            await submit.execute("submit-2", {});
            writeFileSync(
              join(workspace, "agent/BUILT_AGENTS.md"),
              `${MATCHING_OPERATING_GUIDE}\nFinal repair note.\n`,
            );
            await submit.execute("submit-3", {});
            return { status: "completed", assistantText: "submitted" };
          });
        },
      },
    );
    expect(gateCalls).toBe(2);
    expect(outcome).toMatchObject({ buildAdmissible: false, clause: "iterations-exhausted" });
    expect(outcome.iterations[1]).toMatchObject({
      workspaceChange: {
        baseCommit: outcome.iterations[0]?.workspaceChange?.baseCommit,
        changedPaths: expect.arrayContaining(["agent/tools.ts", "agent/BUILT_AGENTS.md"]),
      },
      feedback: [blockingRow("correctness-model", "repair the verifier only", "census-2.json")],
    });
    expect(readFileSync(join(workspace, "agent/tools.ts"), "utf8")).toBe("// cross-owner rewrite\n");
  });

  it.concurrent("keeps prior evidence advisory during a rebuild instead of narrowing the whole bundle", async () => {
    const campaignDir = scratchDir("ana-primary-rebuild-scope-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const changed = [
      "correctness-model/brief.json",
      "correctness-model/tasks.json",
      "agent/BUILT_AGENTS.md",
      "agent/tools-spec.json",
      "agent/tools.ts",
    ];
    const advisory: CampaignFeedback = {
      owner: "tests",
      severity: "advisory",
      claim: "add harder cases",
      evidence: "packet.json",
    };
    const session = submittingSession(() => touch(workspace, ...changed));
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        ...FRESH_BUILD,
        maxTurns: 1,
        experiment: "build",
        priorEvidence: packet("packet-tests", [advisory]),
      },
      { ...BARE, gates: async () => [], open: session.open },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(outcome.iterations[0]).toMatchObject({
      workspaceChange: { changedPaths: expect.arrayContaining(changed) },
    });
  });

  it.concurrent("admits a model-proposed controls repair and records the proposal captured at submit", async () => {
    const { campaignDir, workspace, adoptedDir } = adoptedRound("ana-primary-controls-repair-");
    let captured: ReturnType<typeof proposeExperiment> | undefined;
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1, experiment: "build", adoptedDir },
      {
        ...BARE,
        gates: async () => {
          proposeExperiment(workspace, "tasks", "A later background edit is not the submitted proposal.");
          return [];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            touch(workspace, "correctness-model/controls.json");
            captured = proposeExperiment(workspace);
            await replyText(submitTool(tools), "controls-repair");
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(outcome.experimentProposal).toEqual(captured);
    expect(outcome.iterations[0]?.experimentProposal).toEqual(captured);
    expect(readExecutionEvidence(campaignDir)[0]?.submits[0]?.experimentProposal).toEqual(captured);
  });

  it.concurrent("admits a rebuild that moves the task battery, and leaves the route to the Builder", async () => {
    const { campaignDir, workspace, adoptedDir } = adoptedRound("ana-primary-rebuild-moved-");
    const schema = loadSolvabilityPublicSchema(adoptedDir, MATCHING_BRIEF.artifactSchema);
    if (!schema.ok || schema.schema === null) throw new Error("fixture schema missing");
    writeBoundRepresentation(
      adoptedDir,
      schema.schema.sha256,
      readFileSync(join(adoptedDir, "agent/tools-spec.json"), "utf8"),
    );
    let prompt = "";
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1, experiment: "build", adoptedDir },
      {
        ...BARE,
        gates: async () => [],
        open: async (tools) =>
          scriptedSession(async (turn) => {
            prompt = turn.prompt;
            touch(workspace, "correctness-model/tasks.json");
            proposeExperiment(workspace, "tasks");
            await submitTool(tools).execute("rebuild-moved", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    for (const sentence of [
      "no axis, step size, family mix or parent bijection is prescribed",
      "extra cases on the same rule establish coverage, a new identifier",
      "Move one part per experiment",
      "recorded as a build, and their result credits neither",
      "fix a known evaluator defect before claiming a task-only challenge",
    ]) {
      expect(prompt).toContain(sentence);
    }
    expect(prompt).not.toContain("Keep the previous battery's family composition");
  });

  it.concurrent("serves every carried owner and admits a package repair whose suggested files never moved", async () => {
    // Repairing the package can answer a controls or evaluator finding without touching either file.
    const campaignDir = scratchDir("ana-package-repair-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    let censusRuns = 0;
    let prompt = "";
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        ...FRESH_BUILD,
        maxTurns: 1,
        experiment: "build",
        priorEvidence: packet("packet-controls", [
          blockingRow("correctness-model", "check the evaluator", "packet.json"),
          blockingRow("controls", "the reject control set covers no case for this check", "packet.json"),
        ]),
      },
      {
        ...BARE,
        gates: async () => {
          censusRuns += 1;
          return [];
        },
        open: async (tools) =>
          scriptedSession(async (turn) => {
            prompt = turn.prompt;
            touch(workspace, "correctness-model/brief.json");
            await submitTool(tools).execute("package-repair", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome).toMatchObject({
      buildAdmissible: true,
      experimentScope: { actual: "build", freeze: null },
    });
    expect(censusRuns).toBe(1);
    expect(prompt).toContain("- controls (correctness-model/controls.json):");
    expect(prompt).toContain("- correctness-model (correctness-model/evaluator.ts):");
  });

  it.concurrent("admits a coherent broader repair and records build scope with the drift it froze", async () => {
    const campaignDir = scratchDir("ana-primary-round-base-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    completeBundle(adoptedDir);
    const session = submittingSession(() => {
      touch(workspace, "agent/tools.ts", "correctness-model/evaluator.ts", "correctness-model/brief.json");
      const tasks = structuredClone(MATCHING_TASKS);
      tasks[0]!.publicInput = { variant: 7, parts: ["alpha"], bindings: [{ part: "alpha", slot: "s3" }] };
      writeFileSync(join(workspace, "correctness-model/tasks.json"), JSON.stringify(tasks));
      proposeExperiment(workspace);
    });
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        ...FRESH_BUILD,
        maxTurns: 2,
        experiment: "build",
        adoptedDir,
        priorEvidence: packet("packet-tests", [
          blockingRow("tests", "repair the tests closure", "packet.json"),
        ]),
      },
      { ...BARE, gates: async () => [], open: session.open },
    );
    if (!outcome.buildAdmissible) throw new Error("broader repair was refused");
    expect(outcome.experimentScope?.actual).toBe("build");
    expect(outcome.iterations).toHaveLength(1);
    expect(outcome.iterations[0]?.workspaceChange?.changedPaths).toContain("correctness-model/brief.json");
    const clauses = outcome.experimentScope?.freeze?.clauses ?? [];
    expect(clauses.some((clause) => clause.startsWith("evaluation-agent-drift"))).toBe(true);
    expect(clauses.some((clause) => clause.startsWith("evaluation-battery-drift"))).toBe(true);
  });

  it("opens product repair on the adopted bundle once and preserves in-flight edits on resume", async () => {
    const campaignDir = scratchDir("ana-evaluation-seed-");
    const adoptedDir = join(campaignDir, "adopted");
    completeBundle(adoptedDir);
    const workspace = join(campaignDir, "workspace");
    const paths = [
      "agent/tools.ts",
      "agent/BUILT_AGENTS.md",
      "correctness-model/tasks.json",
      "correctness-model/brief.json",
      "correctness-model/reference/index.ts",
      "correctness-model/evaluator.ts",
      "correctness-model/controls.json",
    ];
    const initial = paths.map((path) => [path, readFileSync(join(adoptedDir, path), "utf8")] as const);
    const input: BuilderCampaignInput = {
      campaignDir,
      ...FRESH_BUILD,
      maxTurns: 1,
      experiment: "build",
      adoptedDir,
      priorEvidence: packet("evaluation-seed", [
        blockingRow("correctness-model", "Correct the evaluator", "packet.json"),
      ]),
    };
    const helper = join(workspace, "correctness-model/repair-helper.ts");
    let draft: ReturnType<typeof proposeExperiment> | undefined;
    for (const first of [true, false]) {
      let opened = false;
      await runBuilderCampaign(input, {
        ...BARE,
        open: async () => {
          opened = true;
          if (first) {
            draft = proposeExperiment(workspace);
          } else {
            expect(JSON.parse(readFileSync(join(workspace, "EXPERIMENT.json"), "utf8"))).toMatchObject({
              gap: draft?.gap,
            });
          }
          for (const [path, original] of initial) {
            expect(readFileSync(join(workspace, path), "utf8")).toBe(first ? original : `${original}\n`);
            writeFileSync(join(workspace, path), `${original}\n`);
          }
          if (!first) expect(readFileSync(helper, "utf8")).toBe("export const repaired = true;\n");
          writeFileSync(helper, "export const repaired = true;\n");
          return scriptedSession(async () => ({ status: "completed", assistantText: "repair in progress" }));
        },
      });
      expect(opened).toBe(true);
    }
    // The adopted bundle itself stays immutable.
    for (const [path, original] of initial) {
      expect(readFileSync(join(adoptedDir, path), "utf8")).toBe(original);
    }
  });

  it("reopens a rebuild on the previous harness, mounts harness_reset, and resets only when the Builder asks", async () => {
    // The witness is the session's own first read of the workspace, the surface a real model sees.
    const campaignDir = scratchDir("ana-rebuild-reset-e2e-");
    const workspace = join(campaignDir, "workspace");
    initWorkspace(workspace);
    completeBundle(workspace);
    writeFileSync(join(workspace, "agent/design-notes.ts"), "export const oldDesign = 1;\n");
    const memoryPath = join(workspace, "MEMORY.md");
    writeFileSync(memoryPath, `${readFileSync(memoryPath, "utf8")}\nlesson: the matching family saturated\n`);
    commitAll(workspace, "02-matching: fingerprinted");
    writeFileSync(join(workspace, "agent/uncommitted.ts"), "export const interrupted = 1;\n");
    const seen: { oldDesign: boolean; uncommitted: boolean; memory: string; tools: string[] }[] = [];
    await expect(
      runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD, experiment: "build", resetKey: "evidence-a" },
        {
          ...BARE,
          waitMs: async () => {},
          open: async (tools) =>
            scriptedSession(async () => {
              seen.push({
                oldDesign: existsSync(join(workspace, "agent/design-notes.ts")),
                uncommitted: existsSync(join(workspace, "agent/uncommitted.ts")),
                memory: readFileSync(memoryPath, "utf8"),
                // SAFETY: production composition supplies AgentTool-shaped rows; only the name is read.
                tools: tools.map((tool) => (tool as { name?: string }).name ?? "tool"),
              });
              return { status: "failed", errorMessages: ["stop after reopen witness"] };
            }),
        },
      ),
    ).rejects.toThrow("stop after reopen witness");
    expect(seen[0]).toMatchObject({
      oldDesign: true,
      uncommitted: true,
      tools: expect.arrayContaining(["harness_reset"]),
    });
    expect(seen[0]?.memory).toContain("the matching family saturated");
    // No controller reset commit exists until the Builder calls the tool.
    expect(execTextSync("git", ["-C", workspace, "log", "--format=%s"])).not.toContain("reset to starter");
    expect(resetWorkspaceToStarter(workspace, "evidence-a", "agent")).toBe(true);
    expect(existsSync(join(workspace, "agent/design-notes.ts"))).toBe(false);
    expect(existsSync(join(workspace, "correctness-model/tasks.json"))).toBe(true);
    expect(execTextSync("git", ["-C", workspace, "show", "HEAD~1:agent/design-notes.ts"])).toContain(
      "oldDesign",
    );
  });
});
