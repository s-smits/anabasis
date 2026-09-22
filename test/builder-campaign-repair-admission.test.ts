/**
 * What a repair round is admitted as.
 *
 * Admission binds the accepted bytes to an experiment: a rebuild that moved the battery, a
 * package repair whose suggested file never changed, a resumed round that must keep the edits it
 * was interrupted in. Each is a different recorded scope over the same gate.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  commitRoundEntry,
  completeBundle,
  proposeExperiment,
  submitTool,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { scriptedSession } from "./helpers/doubles.ts";
import { MATCHING_BRIEF, MATCHING_TASKS } from "./helpers/matching-fixture.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import { POLICY } from "../src/critic/policy.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { commitAll, initWorkspace, resetWorkspaceToStarter } from "../src/author/domain-repo.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { BuilderCampaignDeps, BuilderCampaignInput } from "../src/run/builder-campaign.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import { loadSolvabilityPublicSchema } from "../src/truth/solvability-artifact-schema.ts";
const BUILD_A_HARNESS = "Build a harness.";

afterAll(cleanupScratch);

describe("the admission a repair earns", () => {
  it.concurrent("admits a rebuild submit that moves the task battery, with the same adopted baseline present", async () => {
    const campaignDir = scratchDir("ana-primary-rebuild-moved-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    cpSync(join(workspace, "agent"), join(adoptedDir, "agent"), { recursive: true });
    cpSync(join(workspace, "correctness-model"), join(adoptedDir, "correctness-model"), { recursive: true });
    const schema = loadSolvabilityPublicSchema(adoptedDir, MATCHING_BRIEF.artifactSchema);
    if (!schema.ok || schema.schema === null) throw new Error("fixture schema missing");
    writeBoundRepresentation(
      adoptedDir,
      schema.schema.sha256,
      readFileSync(join(adoptedDir, "agent/tools-spec.json"), "utf8"),
    );
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: BUILD_A_HARNESS,
        expectedTasks: 4,
        maxTurns: 1,
        experiment: "build",
        adoptedDir,
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => [],
        open: async (tools) =>
          scriptedSession(async ({ prompt }) => {
            expect(prompt).toContain("no axis, step size, family mix or parent bijection is prescribed");
            expect(prompt).toContain("extra cases on the same rule establish coverage, and a new identifier");
            expect(prompt).toContain("Move one part per experiment");
            expect(prompt).toContain("recorded as a build, and their result credits neither");
            expect(prompt).toContain("Fix a known evaluator defect before claiming a task-only challenge");
            expect(prompt).not.toContain("Keep the previous battery's family composition");
            const file = join(workspace, "correctness-model/tasks.json");
            writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
            const submit = submitTool(tools);
            proposeExperiment(workspace, "tasks");
            await submit.execute("rebuild-moved", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
  });

  // Repairing the package can answer a controls finding without changing controls.json itself.
  it.concurrent("admits a package repair even when the suggested controls file stays unchanged", async () => {
    const campaignDir = scratchDir("ana-controls-unmoved-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const answers: string[] = [];
    const prompts: string[] = [];
    let censusRuns = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: BUILD_A_HARNESS,
        expectedTasks: 4,
        maxTurns: POLICY.loop.unchangedCandidateStrikes + 1,
        experiment: "build",
        priorEvidence: {
          kind: "admitted-packet",
          digest: "packet-controls",
          feedback: [
            {
              owner: "controls",
              severity: "blocking",
              claim: "the reject control set covers no case for this check",
              evidence: "packet.json",
            },
          ],
        },
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => {
          censusRuns += 1;
          return [];
        },
        open: async (tools) =>
          scriptedSession(async ({ prompt }) => {
            prompts.push(prompt);
            const file = join(workspace, "correctness-model/brief.json");
            writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
            const answer = await submitTool(tools).execute("controls-unmoved", {});
            answers.push(answer.content[0]?.text ?? "");
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome).toMatchObject({
      buildAdmissible: true,
      experimentScope: { requested: "build", actual: "build" },
    });
    expect(censusRuns).toBe(1);
    expect(answers).toHaveLength(1);
    expect(answers[0]).not.toContain("controls-unchanged");
    expect(prompts[0]).toContain("- controls (correctness-model/controls.json):");
  });

  // A controls change also reaches the ordinary gates under the same advisory direction.
  it.concurrent("serves controls and evaluator feedback in one submission", async () => {
    const campaignDir = scratchDir("ana-controls-moved-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const answers: string[] = [];
    const prompts: string[] = [];
    let censusRuns = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: BUILD_A_HARNESS,
        expectedTasks: 4,
        maxTurns: 1,
        experiment: "build",
        priorEvidence: {
          kind: "admitted-packet",
          digest: "packet-controls",
          feedback: [
            {
              owner: "correctness-model",
              severity: "blocking",
              claim: "check the evaluator",
              evidence: "packet.json",
            },
            {
              owner: "controls",
              severity: "blocking",
              claim: "the reject control set covers no case for this check",
              evidence: "packet.json",
            },
          ],
        },
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => {
          censusRuns += 1;
          return [];
        },
        open: async (tools) =>
          scriptedSession(async ({ prompt }) => {
            prompts.push(prompt);
            const file = join(workspace, "correctness-model/controls.json");
            writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
            const answer = await submitTool(tools).execute("controls-moved", {});
            answers.push(answer.content[0]?.text ?? "");
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(answers.join("\n")).not.toContain("controls-unchanged");
    expect(censusRuns).toBeGreaterThan(0);
    expect(outcome.iterations).toHaveLength(1);
    expect(outcome.iterations[0]).toMatchObject({ repairOwner: null });
    expect(prompts[0]).toContain("- controls (correctness-model/controls.json):");
    expect(prompts[0]).toContain("- correctness-model (correctness-model/evaluator.ts):");
    // The candidate that reaches the census moved exactly the file its kickoff opened. The
    // promotion side of the same interface — a controls-only evaluation candidate the freeze accepts —
    // is pinned in candidate-promotion.test.ts.
  });

  it.concurrent("admits a coherent broader repair and records build scope", async () => {
    const campaignDir = scratchDir("ana-primary-round-base-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    completeBundle(adoptedDir);
    let turns = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: BUILD_A_HARNESS,
        expectedTasks: 4,
        maxTurns: 2,
        experiment: "build",
        adoptedDir,
        priorEvidence: {
          kind: "admitted-packet",
          digest: "packet-tests",
          feedback: [
            {
              owner: "tests",
              severity: "blocking",
              claim: "repair the tests closure",
              evidence: "packet.json",
            },
          ],
        },
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => [],
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            for (const path of [
              "agent/tools.ts",
              "correctness-model/evaluator.ts",
              "correctness-model/brief.json",
            ]) {
              const file = join(workspace, path);
              writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
            }
            const tasks = structuredClone(MATCHING_TASKS);
            tasks[0]!.publicInput = {
              variant: 7,
              parts: ["alpha"],
              bindings: [{ part: "alpha", slot: "s3" }],
            };
            writeFileSync(join(workspace, "correctness-model/tasks.json"), JSON.stringify(tasks));
            const submit = submitTool(tools);
            proposeExperiment(workspace);
            await submit.execute(`repair-${turns}`, {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome).toMatchObject({
      buildAdmissible: true,
      experimentScope: { requested: "build", actual: "build" },
    });
    expect(outcome.iterations).toHaveLength(1);
    expect(outcome.iterations[0]?.workspaceChange?.changedPaths).toContain("correctness-model/brief.json");
    if (!outcome.buildAdmissible) throw new Error("broader repair was refused");
    expect(
      outcome.experimentScope?.freeze?.clauses.some((clause) => clause.startsWith("evaluation-agent-drift")),
    ).toBe(true);
    expect(
      outcome.experimentScope?.freeze?.clauses.some((clause) =>
        clause.startsWith("evaluation-battery-drift"),
      ),
    ).toBe(true);
  });

  // truss-run1-sol-0830 opened fourteen controller invocations on one campaign and recorded
  // `candidate-unchanged` 21 times on workspace commit 52e0d68c. The round-level refusal binds one
  // invocation, so each relaunch started at zero; the durable per-commit tally is read here, before
  // any session opens, and a relaunch on a campaign already at the ceiling costs no model turn.
  it.concurrent("refuses a campaign whose replayed commit already reached the unchanged-candidate ceiling", async () => {
    const hostileOpen = async (): Promise<HostSession> => {
      throw new Error("a session must never open on a campaign already at the unchanged ceiling");
    };
    const deps: BuilderCampaignDeps = {
      tools: [],
      toolsProbes: () => ({}),
      gates: async () => [],
      open: hostileOpen,
    };
    const campaignDir = scratchDir("ana-unchanged-ceiling-");
    const input: BuilderCampaignInput = {
      campaignDir,
      slug: "matching",
      kickoff: BUILD_A_HARNESS,
      expectedTasks: 4,
      experiment: "build",
    };
    writeFileSync(
      join(campaignDir, "campaign.json"),
      JSON.stringify({
        domain: "matching",
        kickoffHash: hashJsonValue(BUILD_A_HARNESS),
      }),
    );
    const commit = "52e0d68c".padEnd(40, "0");
    for (let ordinal = 1; ordinal <= POLICY.loop.unchangedCandidateStrikes; ordinal += 1) {
      const dir = join(campaignDir, `${String(ordinal).padStart(2, "0")}-matching`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "iteration.json"),
        JSON.stringify({
          ordinal,
          dir,
          outcome: "fingerprinted",
          stage: null,
          focusOwner: null,
          attempts: {},
          findingsHash: null,
          fingerprint: null,
          submissionConditionId: `condition-${ordinal}`,
          feedback: [],
          workspaceChange: { baseCommit: commit, commit, changedPaths: [], deletedPaths: [] },
        }),
      );
    }
    expect(await runBuilderCampaign(input, deps)).toEqual({
      buildAdmissible: false,
      clauses: ["authoring-stalled"],
      iterations: [],
    });
    expect(existsSync(join(campaignDir, "workspace"))).toBe(false);
  });

  // A pre-adoption repair continuation legitimately runs with NO admission packet: its feedback
  // rides in the carried queue and the in-flight build owns the whole tree (the run 72 precedent).
  // The unroutable refusal must read both channels, or every failed-first-build continuation would
  // be refused as ownerless.
  it.concurrent("continues product authoring with carried feedback and no admitted packet", async () => {
    const campaignDir = scratchDir("ana-preadoption-repair-");
    writeFileSync(
      join(campaignDir, "campaign.json"),
      JSON.stringify({ domain: "matching", kickoffHash: hashJsonValue(BUILD_A_HARNESS) }),
    );
    mkdirSync(join(campaignDir, "01-build"));
    writeFileSync(
      join(campaignDir, "01-build", "iteration.json"),
      JSON.stringify({
        outcome: "build-failed",
        submissionConditionId: "condition-1",
        feedback: [
          {
            owner: "instructions",
            severity: "blocking",
            claim: "the operating guide omitted the writer contract",
            evidence: "campaigns/x/01-build/iteration.json",
          },
        ],
      }),
    );
    let opened = false;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: BUILD_A_HARNESS,
        expectedTasks: 4,
        maxTurns: 1,
        experiment: "build",
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (): Promise<HostSession> => {
          opened = true;
          return scriptedSession(async () => {
            return { status: "completed", assistantText: "no submission" };
          });
        },
      },
    );
    expect(opened).toBe(true);
    expect(outcome.buildAdmissible === false && outcome.clauses.includes("repair-unroutable")).toBe(false);
  });

  // Resuming a correction keeps the authored tasks and controls. This test opens a session
  // without submitting, so it checks preservation rather than final change attribution.
  it.concurrent("preserves the resumed public-task repair beside the controls repair", async () => {
    const campaignDir = scratchDir("ana-drift-repair-");
    const adoptedDir = scratchDir("ana-drift-adopted-");
    initWorkspace(join(campaignDir, "workspace"));
    mkdirSync(join(campaignDir, "workspace", "correctness-model"), { recursive: true });
    writeFileSync(
      join(campaignDir, "workspace", "correctness-model", "tasks.json"),
      JSON.stringify({ tasks: [{ taskId: "drifted" }] }),
    );
    mkdirSync(join(adoptedDir, "correctness-model"), { recursive: true });
    writeFileSync(
      join(adoptedDir, "correctness-model", "tasks.json"),
      JSON.stringify({ tasks: [{ taskId: "adopted" }] }),
    );
    const routable = {
      kind: "admitted-packet" as const,
      digest: "packet-1",
      feedback: [
        {
          owner: "tools-spec" as const,
          severity: "blocking" as const,
          claim: "the writer schema omitted a closed set",
          evidence: "campaigns/x/01-build/iteration.json",
        },
      ],
    };
    // Keep both edits on resume: neither tasks nor controls should revert to the adopted copy.
    const repairedControls = JSON.stringify({ controls: ["repair-in-progress"] });
    writeFileSync(join(campaignDir, "workspace", "correctness-model", "controls.json"), repairedControls);
    writeFileSync(
      join(adoptedDir, "correctness-model", "controls.json"),
      JSON.stringify({ controls: ["c1"] }),
    );
    let opened = false;
    await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: BUILD_A_HARNESS,
        expectedTasks: 4,
        maxTurns: 1,
        experiment: "build",
        adoptedDir,
        priorEvidence: routable,
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (): Promise<HostSession> => {
          opened = true;
          return scriptedSession(async () => {
            return { status: "completed", assistantText: "no submission" };
          });
        },
      },
    );
    expect(opened).toBe(true);
    expect(readFileSync(join(campaignDir, "workspace", "correctness-model", "tasks.json"), "utf8")).toBe(
      JSON.stringify({ tasks: [{ taskId: "drifted" }] }),
    );
    expect(readFileSync(join(campaignDir, "workspace", "correctness-model", "controls.json"), "utf8")).toBe(
      repairedControls,
    );
    const log = execTextSync("git", ["log", "--format=%s"], { cwd: join(campaignDir, "workspace") });
    expect(log).not.toContain("controller: rematerialise adopted bundle");
  });

  it("opens product repair on adopted bundles and preserves edits on resume", async () => {
    const campaignDir = scratchDir("ana-evaluation-seed-");
    const adoptedDir = join(campaignDir, "adopted");
    completeBundle(adoptedDir);
    const workspace = join(campaignDir, "workspace");
    const evaluatorPath = "correctness-model/evaluator.ts";
    const original = readFileSync(join(adoptedDir, evaluatorPath), "utf8");
    const repaired = `${original}\n// evaluator correction in progress\n`;
    const controlsPath = "correctness-model/controls.json";
    const originalControls = readFileSync(join(adoptedDir, controlsPath), "utf8");
    const repairedControls = `${originalControls}\n`;
    const input: BuilderCampaignInput = {
      campaignDir,
      slug: "matching",
      kickoff: BUILD_A_HARNESS,
      expectedTasks: 4,
      maxTurns: 1,
      experiment: "build",
      adoptedDir,
      priorEvidence: {
        kind: "admitted-packet",
        digest: "evaluation-seed",
        feedback: [
          {
            owner: "correctness-model",
            severity: "blocking",
            claim: "Correct the evaluator",
            evidence: "packet.json",
          },
        ],
      },
    };
    const repairedPaths = [
      "agent/tools.ts",
      "agent/BUILT_AGENTS.md",
      "correctness-model/tasks.json",
      "correctness-model/brief.json",
      "correctness-model/reference/index.ts",
    ];
    const initial = new Map(
      repairedPaths.map((path) => [path, readFileSync(join(adoptedDir, path), "utf8")]),
    );
    let draft: ReturnType<typeof proposeExperiment> | undefined;
    for (const first of [true, false]) {
      let opened = false;
      await runBuilderCampaign(input, {
        tools: [],
        toolsProbes: () => ({}),
        open: async (): Promise<HostSession> => {
          opened = true;
          if (first) draft = proposeExperiment(workspace);
          else {
            expect(JSON.parse(readFileSync(join(workspace, "EXPERIMENT.json"), "utf8"))).toMatchObject({
              gap: draft?.gap,
            });
          }
          for (const path of repairedPaths) {
            const originalBytes = initial.get(path)!;
            expect(readFileSync(join(workspace, path), "utf8")).toBe(
              first ? originalBytes : originalBytes + "\n",
            );
            writeFileSync(join(workspace, path), originalBytes + "\n");
          }
          expect(readFileSync(join(workspace, evaluatorPath), "utf8")).toBe(first ? original : repaired);
          expect(readFileSync(join(workspace, controlsPath), "utf8")).toBe(
            first ? originalControls : repairedControls,
          );
          writeFileSync(join(workspace, evaluatorPath), repaired);
          writeFileSync(join(workspace, controlsPath), repairedControls);
          const helper = join(workspace, "correctness-model/repair-helper.ts");
          if (!first) expect(readFileSync(helper, "utf8")).toBe("export const repaired = true;\n");
          writeFileSync(helper, "export const repaired = true;\n");
          return scriptedSession(async () => ({ status: "completed", assistantText: "repair in progress" }));
        },
      });
      expect(opened).toBe(true);
    }
    expect(readFileSync(join(adoptedDir, evaluatorPath), "utf8")).toBe(original);
  });
});

/** E2E simulation of the reopen round, standing a few calls before the Builder session: the
 *  previous build authored a full harness in this epoch workspace, the selector has ordered a
 *  capability rebuild, and the campaign prepares the workspace the session opens on. The witness
 *  is the session's own first read of that workspace — the same surface a real model sees. */
describe("e2e: a reopen rebuild opens the session on the previous harness and mounts harness_reset", () => {
  const witness = async (campaignDir: string, rebuildReset: string | undefined, marker: string) => {
    const workspace = join(campaignDir, "workspace");
    const observations: { oldDesign: boolean; uncommitted: boolean; memory: string; tools: string[] }[] = [];
    await expect(
      runBuilderCampaign(
        {
          campaignDir,
          slug: "matching",
          kickoff: BUILD_A_HARNESS,
          expectedTasks: 4,
          experiment: "build",
          ...keyIfDefined("rebuildReset", rebuildReset),
        },
        {
          tools: [],
          toolsProbes: () => ({}),
          // A scripted failed turn is retried on a growing backoff; this test spends none of it.
          waitMs: async () => {},
          open: async (tools) =>
            scriptedSession(async () => {
              observations.push({
                oldDesign: existsSync(join(workspace, "agent/design-notes.ts")),
                uncommitted: existsSync(join(workspace, "agent/uncommitted.ts")),
                memory: readFileSync(join(workspace, "MEMORY.md"), "utf8"),
                // SAFETY: production composition supplies AgentTool-shaped rows; only the name is read.
                tools: tools.map((tool) => (tool as { name?: string }).name ?? "tool"),
              });
              return { status: "failed", errorMessages: [marker] };
            }),
        },
      ),
    ).rejects.toThrow(marker);
    const seen = observations.at(0);
    if (seen === undefined) throw new Error("the session never ran its witness turn");
    return seen;
  };

  it("keeps the old design, the interrupted edit and memory until the Builder chooses a reset scope", async () => {
    const campaignDir = scratchDir("ana-rebuild-reset-e2e-");
    const workspace = join(campaignDir, "workspace");
    // The previous build's harness as its iterations left it, plus one uncommitted edit an
    // interrupted invocation would leave behind.
    initWorkspace(workspace);
    completeBundle(workspace);
    writeFileSync(join(workspace, "agent/design-notes.ts"), "export const oldDesign = 1;\n");
    const memoryPath = join(workspace, "MEMORY.md");
    writeFileSync(memoryPath, `${readFileSync(memoryPath, "utf8")}\nlesson: the matching family saturated\n`);
    commitAll(workspace, "02-matching: fingerprinted");
    writeFileSync(join(workspace, "agent/uncommitted.ts"), "export const interrupted = 1;\n");

    const reopened = await witness(campaignDir, "evidence-a", "stop after reopen witness");
    expect(reopened.oldDesign).toBe(true);
    expect(reopened.uncommitted).toBe(true);
    expect(reopened.memory).toContain("the matching family saturated");
    expect(reopened.tools).toContain("harness_reset");
    // No controller reset commit exists until the Builder calls the tool.
    expect(execTextSync("git", ["-C", workspace, "log", "--format=%s"])).not.toContain("reset to starter");
    // The Builder's own scoped reset then keys on the reopen evidence and keeps the other surface.
    const applied = resetWorkspaceToStarter(workspace, "evidence-a", "agent");
    expect(applied).toBe(true);
    expect(existsSync(join(workspace, "agent/design-notes.ts"))).toBe(false);
    expect(existsSync(join(workspace, "correctness-model/tasks.json"))).toBe(true);
    expect(execTextSync("git", ["-C", workspace, "show", "HEAD~1:agent/design-notes.ts"])).toContain(
      "oldDesign",
    );
  });
});
