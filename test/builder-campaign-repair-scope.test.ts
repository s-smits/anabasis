/**
 * How much of the bundle a repair may touch.
 *
 * A requested evaluation repair preserves the agent, the public exam and the bound submission
 * schema; a build may reopen all of them. What the accepted bytes moved decides the attribution,
 * not the loop that asked for the round.
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
import { scriptedSession } from "./helpers/doubles.ts";
import { MATCHING_OPERATING_GUIDE } from "./helpers/matching-fixture.ts";
import { POLICY } from "../src/critic/policy.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import { preSessionRefusal } from "../src/run/builder-campaign-preflight.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";

afterAll(cleanupScratch);

describe("the scope a repair round is given", () => {
  it("lets a rebuild through the durable unchanged-candidate ceiling it would otherwise refuse", () => {
    // The reset replaces the counted commit before any session opens; refusing on it made every
    // rebuild of a stalled epoch a permanent stop, since the epoch key derives from the kickoff.
    const commit = "d".repeat(40);
    const memory = {
      clause: null,
      workspaceCommit: commit,
      lastBlockedCandidateId: null,
      lastBlockedCandidateStrikes: 0,
      trailingBlockedFindingsHashes: [],
      trailingBuildFailureHashes: [],
      toolNonResultRefusals: {},
      unchangedCandidateCommits: { [commit]: POLICY.loop.unchangedCandidateStrikes },
      carried: [],
    };
    const base = { campaignDir: "/x", experiment: "build" as const };
    expect(preSessionRefusal(base, memory)).toMatchObject({ clauses: ["authoring-stalled"] });
    expect(preSessionRefusal({ ...base, rebuildReset: "starter" }, memory)).toBeNull();
  });

  it("opens product repair whose findings require public task edits", () => {
    const finding = (path: string) => ({ code: "tasks-undeclared-check", path, detail: "d" });
    const memory = {
      clause: null,
      workspaceCommit: null,
      lastBlockedCandidateId: null,
      lastBlockedCandidateStrikes: 0,
      trailingBlockedFindingsHashes: [],
      trailingBuildFailureHashes: [],
      toolNonResultRefusals: {},
      unchangedCandidateCommits: {},
      carried: [],
    };
    const inputWith = (paths: string[]) => ({
      campaignDir: "/x",
      experiment: "build" as const,
      priorEvidence: {
        digest: "packet",
        kind: "admitted-packet" as const,
        feedback: [
          {
            owner: "correctness-model" as const,
            severity: "blocking" as const,
            claim: "c",
            evidence: "e",
            findings: paths.map(finding),
          },
        ],
      },
    });
    // A task finding directs the repair; it does not freeze the file it needs to change.
    expect(preSessionRefusal(inputWith(["correctness-model/tasks.json#t7"]), memory)).toBeNull();
    expect(
      preSessionRefusal(
        inputWith(["correctness-model/tasks.json#t7", "correctness-model/evaluator.ts"]),
        memory,
      ),
    ).toBeNull();
  });

  // Repair feedback directs the work, while the ordinary gates still judge the complete candidate.
  it.concurrent("keeps broader repair bytes and reports the actual gate finding", async () => {
    const campaignDir = scratchDir("ana-primary-repair-scope-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    let turns = 0;
    let gateCalls = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: 2,
        priorEvidence: {
          kind: "admitted-packet",
          digest: "packet-verifier",
          feedback: [
            {
              owner: "correctness-model",
              severity: "blocking",
              claim: "repair the verifier only",
              evidence: "packet.json",
            },
          ],
        },
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            if (turns === 1) completeBundle(workspace);
            else writeFileSync(join(workspace, "agent/tools.ts"), "// cross-owner rewrite\n");
            const submit = submitTool(tools);
            await submit.execute(`submit-${turns}`, {});
            return { status: "completed", assistantText: "submitted" };
          }),
        gates: async () => {
          gateCalls += 1;
          return [
            {
              owner: "correctness-model",
              severity: "blocking",
              claim: "repair the verifier only",
              evidence: `census-${gateCalls}.json`,
            },
          ];
        },
      },
    );
    expect(gateCalls).toBe(2);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(outcome.iterations[1]?.feedback).toEqual([
      {
        owner: "correctness-model",
        severity: "blocking",
        claim: "repair the verifier only",
        evidence: "census-2.json",
      },
    ]);
    expect(readFileSync(join(workspace, "agent/tools.ts"), "utf8")).toBe("// cross-owner rewrite\n");
  });

  // Run 72 iterations 2-4: a FIRST BUILD's gate refusal routed its findings at the verifier owner,
  // and the next submit was then Git-scope-refused for touching agent/ files — three iterations
  // burned on a candidate nothing had measured. Scope is a property of a round opened on measured
  // prior evidence; gate feedback moves the Builder's focus, never the scope.
  it.concurrent("lets a first build change any file after a gate refusal instead of inventing a repair scope", async () => {
    const campaignDir = scratchDir("ana-primary-firstbuild-scope-");
    const workspace = join(campaignDir, "workspace");
    let turns = 0;
    let gateCalls = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: 2,
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            if (turns === 1) completeBundle(workspace);
            else writeFileSync(join(workspace, "agent/tools.ts"), "// cross-owner rewrite\n");
            const submit = submitTool(tools);
            await submit.execute(`submit-${turns}`, {});
            return { status: "completed", assistantText: "submitted" };
          }),
        gates: async () => {
          gateCalls += 1;
          return [
            {
              owner: "correctness-model",
              severity: "blocking",
              claim: "repair the verifier only",
              evidence: `census-${gateCalls}.json`,
            },
          ];
        },
      },
    );
    expect(gateCalls).toBe(2);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(outcome.iterations[1]).toMatchObject({ repairOwner: null });
  });

  // A bundle refusal still commits. Attribution must retain every edit across the refused and repaired submits.
  it.concurrent("attributes the continuous repair span after a refused submit advances the workspace head", async () => {
    const campaignDir = scratchDir("ana-primary-repair-span-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    let turns = 0;
    let gateCalls = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: 3,
        priorEvidence: {
          kind: "admitted-packet",
          digest: "packet-verifier",
          feedback: [
            {
              owner: "correctness-model",
              severity: "blocking",
              claim: "repair the verifier only",
              evidence: "packet.json",
            },
          ],
        },
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            const submit = submitTool(tools);
            if (turns === 1) {
              completeBundle(workspace);
              await submit.execute("submit-1", {});
            } else {
              // The drift and a bundle break go in together: the refusal commits both without
              // settling, and the follow-up submit's own diff carries only the guide restore.
              writeFileSync(join(workspace, "agent/tools.ts"), "// cross-owner rewrite\n");
              writeFileSync(join(workspace, "agent/BUILT_AGENTS.md"), "");
              await submit.execute("submit-2", {});
              writeFileSync(
                join(workspace, "agent/BUILT_AGENTS.md"),
                `${MATCHING_OPERATING_GUIDE}\nFinal repair note.\n`,
              );
              await submit.execute("submit-3", {});
            }
            return { status: "completed", assistantText: "submitted" };
          }),
        gates: async () => {
          gateCalls += 1;
          return [
            {
              owner: "correctness-model",
              severity: "blocking",
              claim: "repair the verifier only",
              evidence: `census-${gateCalls}.json`,
            },
          ];
        },
      },
    );
    expect(gateCalls).toBe(2);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(outcome.iterations[1]).toMatchObject({
      repairOwner: null,
      workspaceChange: {
        baseCommit: outcome.iterations[0]?.workspaceChange?.baseCommit,
        changedPaths: expect.arrayContaining(["agent/tools.ts", "agent/BUILT_AGENTS.md"]),
      },
      feedback: [
        {
          owner: "correctness-model",
          severity: "blocking",
          claim: "repair the verifier only",
          evidence: "census-2.json",
        },
      ],
    });
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
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a harness.",
        expectedTasks: 4,
        maxTurns: 1,
        experiment: "build",
        priorEvidence: {
          kind: "admitted-packet",
          digest: "packet-tests",
          feedback: [
            {
              owner: "tests",
              severity: "advisory",
              claim: "add harder cases",
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
            for (const path of changed) {
              const file = join(workspace, path);
              writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
            }
            const submit = submitTool(tools);
            await submit.execute("rebuild", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(outcome.iterations[0]).toMatchObject({
      repairOwner: null,
      workspaceChange: { changedPaths: expect.arrayContaining(changed) },
    });
  });

  it.concurrent("retains each refused proposal without treating its wording as candidate progress", async () => {
    const campaignDir = scratchDir("ana-proposal-noop-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    completeBundle(adoptedDir);
    bundleWithoutGuide(workspace);
    const proposals: ReturnType<typeof proposeExperiment>[] = [];
    const refusals: string[] = [];
    let opens = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a harness.",
        expectedTasks: 4,
        maxTurns: POLICY.loop.unchangedCandidateStrikes + 1,
        experiment: "build",
        adoptedDir,
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => {
          throw new Error("malformed candidate must not reach gates");
        },
        open: async (tools): Promise<HostSession> => {
          opens += 1;
          return scriptedSession(async () => {
            for (let index = 0; index <= POLICY.loop.unchangedCandidateStrikes; index += 1) {
              proposals.push(proposeExperiment(workspace, "product", `Public gap hypothesis ${index}.`));
              const reply = await submitTool(tools).execute(`proposal-${index}`, {});
              refusals.push(reply.content[0]?.text ?? "");
            }
            return { status: "completed" };
          });
        },
      },
    );
    expect(opens).toBe(1);
    expect(outcome).toMatchObject({
      buildAdmissible: false,
      clauses: ["authoring-stalled"],
      experimentProposal: proposals.at(-1),
    });
    expect(outcome.iterations).toEqual([]);
    const execution = readExecutionEvidence(campaignDir);
    expect(execution).toHaveLength(1);
    expect(execution[0]?.submits.map((row) => row.experimentProposal)).toEqual(proposals);
    expect(execution[0]?.submits.at(-1)?.terminal).toBe(true);
    expect(refusals[1]).toContain("unchanged candidate and verifier condition");
    expect(refusals[1]).toContain("EXPERIMENT.json and memory edits do not change that condition");
    expect(refusals.at(-1)).toContain("proposal or memory edits do not change that condition");
    expect(refusals.join("\n")).not.toContain("byte-identical tree");
  });

  it.concurrent("admits a model-proposed controls repair without prescribing a task change", async () => {
    const campaignDir = scratchDir("ana-primary-rebuild-unmoved-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    cpSync(join(workspace, "agent"), join(adoptedDir, "agent"), { recursive: true });
    cpSync(join(workspace, "correctness-model"), join(adoptedDir, "correctness-model"), { recursive: true });
    const texts: string[] = [];
    let captured: ReturnType<typeof proposeExperiment> | undefined;
    const outcome = await runBuilderCampaign(
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
          proposeExperiment(workspace, "tasks", "A later background edit is not the submitted proposal.");
          return [];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            const file = join(workspace, "correctness-model/controls.json");
            writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
            const submit = submitTool(tools);
            captured = proposeExperiment(workspace);
            const answer = await submit.execute("rebuild-unmoved", {});
            texts.push(answer.content[0]?.text ?? "");
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(texts.join("\n")).not.toContain("rebuild-evaluation-unmoved");
    expect(outcome.experimentProposal).toEqual(captured);
    expect(outcome.iterations[0]?.experimentProposal).toEqual(captured);
    expect(readExecutionEvidence(campaignDir)[0]?.submits[0]?.experimentProposal).toEqual(captured);
  });
});
