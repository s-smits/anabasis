/**
 * The per-tool ceiling on refused control censuses.
 *
 * A tool that never completes a run hands back one repairable finding per turn. The tree changes
 * every time, so no candidate identity repeats and the no-op strike counter cannot see it. The
 * tool id is the thing that does repeat.
 */
import { cpSync, mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { TRUSS_CRASH, completeBundle, submitTool } from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { scriptedSession } from "./helpers/doubles.ts";
import { POLICY } from "../src/critic/policy.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import { CandidateMemory } from "../src/gate/candidate-memory.ts";
import { resumeCampaignMemory } from "../src/author/campaign-memory.ts";
import { chargedTrialRunDirs, replayNonResultRefusals } from "../src/author/tool-non-result.ts";
import type { AgentToolsProbes } from "../src/author/agent-tools-session.ts";

afterAll(cleanupScratch);

describe("a campaign whose tool keeps reaching no completed run", () => {
  /** One campaign whose test gate writes a copy of TRUSS_CRASH for the tool named on that turn.
   *  No host process runs here. `null` leaves only the gate refusal, with no tool non-result row.
   *  Turns past the list get their own fresh tool id, so nothing accumulates by accident. */
  const runSealing = async (
    perTurn: readonly (string | null)[],
    toolsProbes: () => AgentToolsProbes = () => ({}),
  ) => {
    const campaignDir = scratchDir("ana-tool-non-result-ceiling-");
    const workspace = join(campaignDir, "workspace");
    const submits: string[] = [];
    let turns = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a harness.",
        expectedTasks: 4,
        maxTurns: perTurn.length,
      },
      {
        tools: [],
        toolsProbes,
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            // A different tree every turn, exactly as run 25 rewrote the evaluator each round: the
            // no-op counter sees no repeat, so this ceiling is the only one that can fire.
            writeFileSync(join(workspace, "correctness-model/attempt.md"), `attempt ${turns}\n`);
            const result = await submitTool(tools).execute(`submit-${turns}`, {});
            submits.push(JSON.stringify(result));
            return { status: "completed", assistantText: "submitted" };
          }),
        gates: async (_harness, iterationDir) => {
          const toolId = perTurn[turns - 1] === undefined ? `tool-${turns}` : perTurn[turns - 1];
          if (toolId !== null) {
            writeFileSync(
              join(iterationDir, "verifier-non-result.json"),
              `${JSON.stringify({ ...TRUSS_CRASH, toolId })}\n`,
            );
          }
          return [
            {
              owner: "correctness-model" as const,
              severity: "blocking" as const,
              claim: "the control census did not settle",
              evidence: "census.json",
            },
          ];
        },
      },
    );
    return { outcome, turns, submits, campaignDir };
  };

  it("settles the campaign on verifier-required at the declared ceiling, naming the tool and the count", async () => {
    expect(POLICY.loop.toolNonResultRefusals).toBe(3);
    const { outcome, turns, submits } = await runSealing(["fwcheck", "fwcheck", "fwcheck", "fwcheck"]);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["verifier-required"] });
    // Four turns were available; the third refusal ended the campaign.
    expect(turns).toBe(3);
    // Below the ceiling the author is told the count run 25 never had, and only public identities
    // cross: the tool id and the two numbers.
    expect(submits[1]).toContain("tool-non-result-repeat");
    expect(submits[1]).toContain("attempt 2 of 3");
    expect(submits[2]).toContain("tool-non-result-ceiling");
    expect(submits[2]).toContain("fwcheck");
    expect(submits[2]).toContain("3 refused census run(s)");
  });

  it("charges a gate run executed beside a conformance refusal, though no iteration records it", async () => {
    const refusing = () => ({
      load: async () => [{ code: "generated-load-crash", path: "agent/tools.ts", detail: "worker exited" }],
    });
    const { outcome, turns, submits } = await runSealing(
      ["fwcheck", "fwcheck", "fwcheck", "fwcheck"],
      refusing,
    );
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["verifier-required"], iterations: [] });
    expect(turns).toBe(3);
    expect(submits[2]).toContain("tool-non-result-ceiling");
  });

  it("keeps a separate count per tool id, so two broken tools do not add up to one ceiling", async () => {
    const { outcome, turns } = await runSealing(["fwcheck", "fwcheck", "simcheck", "simcheck"]);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(turns).toBe(4);
  });

  it("charges nothing for a refusal that recorded no no-result record", async () => {
    // An ordinary reject is a verdict the census did not like. It is the Builder's to repair, and
    // it says nothing about whether the tool completes a run.
    const { outcome, turns } = await runSealing([null, null, null, null]);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(turns).toBe(4);
  });

  it("replays charges made beside a conformance refusal, so a relaunch keeps the count", async () => {
    const refusing = () => ({
      load: async () => [{ code: "generated-load-crash", path: "agent/tools.ts", detail: "worker exited" }],
    });
    const first = await runSealing(["fwcheck", "fwcheck"], refusing);
    expect(first.outcome).toMatchObject({ clauses: ["iterations-exhausted"], iterations: [] });
    const resumed = resumeCampaignMemory(first.campaignDir, "matching", hashJsonValue("Build a harness."));
    expect(resumed.toolNonResultRefusals).toEqual({ fwcheck: 2 });
  });

  it("counts a charged run once when an iteration holds its copy, and skips uncharged preview runs", () => {
    const campaignDir = scratchDir("ana-charge-replay-");
    const record = (dir: string, toolId: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "verifier-non-result.json"), `${JSON.stringify({ ...TRUSS_CRASH, toolId })}\n`);
    };
    const charged = join(campaignDir, "trials", "condition-a", "full-1");
    const previewOnly = join(campaignDir, "trials", "condition-a", "full-2");
    const legacy = join(campaignDir, "01-matching");
    const copy = join(campaignDir, "02-matching");
    record(charged, "fwcheck");
    record(previewOnly, "fwcheck");
    record(legacy, "fwcheck");
    const memory = new CandidateMemory({
      lastBlockedCandidateId: null,
      lastBlockedCandidateStrikes: 0,
      toolNonResultRefusals: {},
    });
    expect(memory.chargeToolNonResult(charged)?.count).toBe(1);
    expect(memory.chargeToolNonResult(charged)).toBeNull();
    cpSync(charged, copy, { recursive: true });
    const counts = replayNonResultRefusals([legacy, copy, ...chargedTrialRunDirs(campaignDir)]);
    expect(chargedTrialRunDirs(campaignDir)).toEqual([charged]);
    expect(counts).toEqual({ fwcheck: 2 });
    // A memory rebuilt from the replay continues the count where the session left it.
    const rebuilt = new CandidateMemory({
      lastBlockedCandidateId: null,
      lastBlockedCandidateStrikes: 0,
      toolNonResultRefusals: counts,
    });
    record(join(campaignDir, "trials", "condition-b", "census-1"), "fwcheck");
    expect(rebuilt.chargeToolNonResult(join(campaignDir, "trials", "condition-b", "census-1"))).toMatchObject(
      { count: 3, terminal: true },
    );
  });

  it("continues the count across invocations, so a relaunch cannot buy the ceiling again", async () => {
    // Run 25's eleven records were spread over four controller invocations of one campaign.
    const first = await runSealing(["fwcheck", "fwcheck"]);
    expect(first.outcome).toMatchObject({ clauses: ["iterations-exhausted"] });
    const resumed = resumeCampaignMemory(first.campaignDir, "matching", hashJsonValue("Build a harness."));
    expect(resumed.toolNonResultRefusals).toEqual({ fwcheck: 2 });
  });
});
