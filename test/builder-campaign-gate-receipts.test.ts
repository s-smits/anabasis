/**
 * What a gate run leaves behind.
 *
 * A refusal is not the only thing a gate run produces: it also spends model and tool work that a
 * later invocation must not buy again. These check that every executed run keeps its own
 * directory, receipt and commit, including the runs no iteration records.
 */
import { cpSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  bundleWithoutGuide,
  commitRoundEntry,
  completeBundle,
  proposeExperiment,
  submitTool,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import type { FixtureSubmitTool } from "./helpers/builder-campaign.ts";
import { required, scriptedSession } from "./helpers/doubles.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import { controllerValidatedFinding } from "../src/truth/brief.ts";
import { workspaceStatus } from "../src/author/domain-repo.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { CampaignOutcome } from "../src/author/campaign-types.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";

afterAll(cleanupScratch);

describe("the evidence a gate run records", () => {
  it("settles the authoring tree at a tool checkpoint, so a host kill between gates loses no bytes", async () => {
    // Epoch 309ad53cab4a died between gates and left only its seed commit: hours of authored bytes
    // in no history. The checkpoint that already saves the execution record now saves the tree too.
    const campaignDir = scratchDir("ana-checkpoint-commit-");
    const workspace = join(campaignDir, "workspace");
    await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async () =>
          scriptedSession(async ({ onEvent }) => {
            writeFileSync(join(workspace, "agent/tools.ts"), "// authored between gates\n");
            onEvent?.({ type: "tool_ended", toolName: "Bash", isError: false });
            // The session then dies without ever reaching submit, which is the whole case.
            return { status: "completed", assistantText: "authored" };
          }),
      },
    );

    // A clean tree over a tracked file means HEAD carries the bytes the session wrote.
    expect(workspaceStatus(workspace).clean).toBe(true);
    expect(readFileSync(join(workspace, "agent/tools.ts"), "utf8")).toBe("// authored between gates\n");
  });

  it("runs the gates beside an admission refusal without writing an iteration or a parity safeguard", async () => {
    // The check reports the same admission refusal submit does, so a clear gate run followed by an
    // admission-only refusal is agreement between the two paths, not safeguard 33's divergence.
    const campaignDir = scratchDir("ana-admission-gated-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    cpSync(workspace, adoptedDir, { recursive: true, filter: (path) => !path.includes("/.git") });
    writeBoundRepresentation(
      adoptedDir,
      undefined,
      readFileSync(join(adoptedDir, "agent/tools-spec.json"), "utf8"),
    );
    const texts: string[] = [];
    const gateDirs: string[] = [];
    const lines: string[] = [];
    const original = console.error;
    console.error = (message?: string) => {
      const line = String(message);
      if (line.includes("33-preview-clear-submit-refused")) lines.push(line);
      else original(line);
    };
    let outcome: CampaignOutcome;
    try {
      outcome = await runBuilderCampaign(
        {
          campaignDir,
          slug: "matching",
          kickoff: "Build a harness.",
          expectedTasks: 4,
          maxTurns: 1,
          experiment: "build",
          adoptedDir,
        },
        {
          tools: [],
          toolsProbes: () => ({}),
          gates: async (_harness, iterationDir) => {
            gateDirs.push(iterationDir);
            return [];
          },
          open: async (tools) =>
            scriptedSession(async () => {
              proposeExperiment(workspace);
              // SAFETY: the toolkit registers correctness_check whenever a gate is mounted; the
              // fixture reads only the name and the execute hook a tool row exposes.
              const check = tools.find(
                (tool) => (tool as { name?: string }).name === "correctness_check",
              ) as FixtureSubmitTool;
              texts.push((await check.execute("check", {})).content[0]?.text ?? "");
              texts.push((await submitTool(tools).execute("submit", {})).content[0]?.text ?? "");
              return { status: "completed", assistantText: "submitted" };
            }),
        },
      );
    } finally {
      console.error = original;
    }
    expect(texts[0]).toContain("rebuild-evaluation-unmoved");
    expect(texts[1]).toContain("rebuild-evaluation-unmoved");
    expect(outcome.buildAdmissible).toBe(false);
    expect(outcome.iterations).toEqual([]);
    expect(gateDirs).toHaveLength(1);
    expect(gateDirs[0]).toContain(join(campaignDir, "trials"));
    expect(lines).toEqual([]);
  });

  it("reports a malformed EXPERIMENT.json beside a broken bundle, with receipts for the work that ran", async () => {
    // The proposal used to be read first and returned alone, with the bundle receipt marked passed
    // although the file contract never ran.
    const campaignDir = scratchDir("ana-proposal-and-bundle-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    completeBundle(adoptedDir);
    const texts: string[] = [];
    await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a harness.",
        expectedTasks: 4,
        maxTurns: 1,
        experiment: "build",
        adoptedDir,
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => {
          throw new Error("a broken bundle must not reach the gates");
        },
        open: async (tools) =>
          scriptedSession(async () => {
            bundleWithoutGuide(workspace);
            writeFileSync(join(workspace, "EXPERIMENT.json"), "{");
            // SAFETY: the toolkit registers correctness_check whenever a gate is mounted; the
            // fixture reads only the name and the execute hook a tool row exposes.
            const check = tools.find(
              (tool) => (tool as { name?: string }).name === "correctness_check",
            ) as FixtureSubmitTool;
            texts.push((await check.execute("check", {})).content[0]?.text ?? "");
            texts.push((await submitTool(tools).execute("submit", {})).content[0]?.text ?? "");
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    const preview = JSON.parse(required(texts[0], "check text"));
    expect(preview).toMatchObject({
      status: "findings",
      stage: "bundle",
      notReached: ["conformance", "gates"],
    });
    expect(preview.stages.map((receipt: { status: string }) => receipt.status)).toEqual([
      "refused",
      "refused",
      "not-run",
      "not-run",
    ]);
    for (const text of texts) {
      expect(text).toContain("experiment-proposal-read");
      expect(text).toContain("BUILT_AGENTS.md");
    }
  });

  it("returns a remembered gate refusal under the commit and proposal of the submit that asked", async () => {
    const campaignDir = scratchDir("ana-remembered-commit-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    cpSync(join(workspace, "agent"), join(adoptedDir, "agent"), { recursive: true });
    cpSync(join(workspace, "correctness-model"), join(adoptedDir, "correctness-model"), { recursive: true });
    const proposals: ReturnType<typeof proposeExperiment>[] = [];
    let gateCalls = 0;
    await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a harness.",
        expectedTasks: 4,
        maxTurns: 2,
        experiment: "build",
        adoptedDir,
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => {
          gateCalls += 1;
          return [
            {
              owner: "correctness-model",
              severity: "blocking",
              claim: "a reject passed",
              evidence: "census.json",
              findings: [
                controllerValidatedFinding({
                  code: "DISCRIMINATION_REJECT_PASSED",
                  path: "correctness-model/controls.json",
                  detail: "a reject passed",
                }),
              ],
            },
          ];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            const file = join(workspace, "correctness-model/controls.json");
            writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
            for (const gap of ["First public gap.", "Second public gap."]) {
              proposals.push(proposeExperiment(workspace, "product", gap));
              await submitTool(tools).execute(gap, {});
            }
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(gateCalls).toBe(1);
    const submits = readExecutionEvidence(campaignDir)[0]?.submits ?? [];
    expect(submits.map((row) => row.experimentProposal)).toEqual(proposals);
    expect(submits[1]?.commit).not.toBe(submits[0]?.commit);
    expect(submits[1]?.commit).toBe(
      Bun.spawnSync(["git", "-C", workspace, "rev-parse", "HEAD"]).stdout.toString().trim(),
    );
    expect(submits[1]?.findingCodes.slice(0, 2)).toEqual([
      "DISCRIMINATION_REJECT_PASSED",
      "authoring-noop-submit",
    ]);
  });

  it("settles an environment-blocked gate run beside a conformance refusal without an iteration", async () => {
    const campaignDir = scratchDir("ana-conformance-env-");
    const workspace = join(campaignDir, "workspace");
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 3 },
      {
        tools: [],
        toolsProbes: () => ({
          load: async () => [
            { code: "generated-load-crash", path: "agent/tools.ts", detail: "worker exited" },
          ],
        }),
        gates: async () => [
          {
            owner: "environment",
            severity: "blocking",
            claim: "the host refused the census",
            evidence: "census.json",
          },
        ],
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            writeFileSync(join(workspace, "correctness-model/attempt.md"), `attempt ${turns}\n`);
            await submitTool(tools).execute(`submit-${turns}`, {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome).toMatchObject({
      buildAdmissible: false,
      clauses: ["environment-blocked"],
      iterations: [],
    });
    expect(turns).toBe(1);
  });

  it("keeps each executed gate run in its own directory: full preview, census-only submit, remembered preview", async () => {
    const campaignDir = scratchDir("ana-run-dirs-");
    const workspace = join(campaignDir, "workspace");
    let probeLoads = 0;
    const gateDirs: string[] = [];
    const texts: string[] = [];
    await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 2 },
      {
        tools: [],
        toolsProbes: () => ({
          load: async () => {
            probeLoads += 1;
            return probeLoads === 1
              ? []
              : [{ code: "generated-load-crash", path: "agent/tools.ts", detail: "worker exited" }];
          },
        }),
        gates: async (_harness, dir, _tree, _stages, scope) => {
          gateDirs.push(dir);
          writeFileSync(
            join(dir, "census.json"),
            JSON.stringify({ findings: scope?.referenceSolve === true ? [] : [{ census: "only" }] }),
          );
          return [];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            // SAFETY: the toolkit registers correctness_check whenever a gate is mounted; the
            // fixture reads only the name and the execute hook a tool row exposes.
            const check = tools.find(
              (tool) => (tool as { name?: string }).name === "correctness_check",
            ) as FixtureSubmitTool;
            texts.push((await check.execute("check-1", {})).content[0]?.text ?? "");
            texts.push((await submitTool(tools).execute("submit", {})).content[0]?.text ?? "");
            texts.push((await check.execute("check-2", {})).content[0]?.text ?? "");
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(gateDirs.map((dir) => dir.split("/").pop())).toEqual(["full-1", "census-1"]);
    expect(new Set(gateDirs.map((dir) => dir.split("/").slice(0, -1).join("/"))).size).toBe(1);
    expect(texts[1]).toContain("refused at bundle");
    const remembered = JSON.parse(required(texts[2], "second check"));
    expect(remembered).toMatchObject({
      status: "clear",
      repeated: expect.any(String),
      coverage: { censusFindings: 0 },
    });
    expect(JSON.parse(readFileSync(join(required(gateDirs[0], "full run"), "census.json"), "utf8"))).toEqual({
      findings: [],
    });
  });

  it("publishes submit's run before its first await, so a preview started meanwhile joins it and spends its attempt", async () => {
    const campaignDir = scratchDir("ana-submit-publishes-");
    const workspace = join(campaignDir, "workspace");
    let probeLoads = 0;
    const loading = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const texts: string[] = [];
    await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 2 },
      {
        tools: [],
        toolsProbes: () => ({
          load: async () => {
            probeLoads += 1;
            loading.resolve();
            await release.promise;
            return [
              {
                code: "generated-toolset-termination",
                path: "agent/tools.ts",
                detail: "the worker did not settle",
              },
            ];
          },
        }),
        gates: async () => {
          throw new Error("a runtime non-result must not reach the gates");
        },
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            // SAFETY: the toolkit registers correctness_check whenever a gate is mounted; the
            // fixture reads only the name and the execute hook a tool row exposes.
            const check = tools.find(
              (tool) => (tool as { name?: string }).name === "correctness_check",
            ) as FixtureSubmitTool;
            const submitting = submitTool(tools).execute("submit-1", {});
            const joining = check.execute("check-1", {});
            await loading.promise;
            release.resolve();
            await Promise.all([submitting, joining]);
            expect(probeLoads).toBe(1);
            texts.push((await check.execute("check-2", {})).content[0]?.text ?? "");
            expect(probeLoads).toBe(1);
            await submitTool(tools).execute("submit-2", {});
            expect(probeLoads).toBe(2);
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(texts[0]).toContain("preview-attempt-spent");
  });
});
