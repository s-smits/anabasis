/**
 * When a repeated candidate ends the session.
 *
 * A byte-identical resubmit of a refused candidate buys nothing, and three end the session. The
 * counter keys on the controller-owned candidate identity, so note-file churn must not reset it
 * and a typed runtime non-result must not charge it.
 */
import { readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { completeBundle, submitTool } from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { required, scriptedSession } from "./helpers/doubles.ts";
import { generatedExecutionFinding } from "../src/truth/brief.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import { submitProjection } from "../src/author/builder-execution.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";
import type { HostSession } from "../src/backends/pi-session.ts";

afterAll(cleanupScratch);

describe("a candidate the session keeps resubmitting", () => {
  it.concurrent("reuses a refusal when the session returns to an earlier candidate, then accepts changed bytes", async () => {
    const campaignDir = scratchDir("ana-primary-cycle-");
    const workspace = join(campaignDir, "workspace");
    // A → B → A → C. Only A, B and C are distinct trees, so the cycle back to A costs no gate run.
    const scratchpad = ["a", "b", "a", "c"];
    let gateCalls = 0;
    let guide = "";
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: 4,
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools): Promise<HostSession> => {
          let turn = 0;
          return scriptedSession(async () => {
            if (turn === 0) {
              completeBundle(workspace);
              guide = readFileSync(join(workspace, "agent", "BUILT_AGENTS.md"), "utf8");
            }
            writeFileSync(
              join(workspace, "agent", "BUILT_AGENTS.md"),
              `${guide}\n${required(scratchpad[turn], "a scratchpad line for this turn")}\n`,
            );
            turn += 1;
            const submit = submitTool(tools);
            await submit.execute(`submit-${turn}`, {});
            return { status: "completed", assistantText: "submitted" };
          });
        },
        gates: async () => {
          gateCalls += 1;
          return gateCalls < 3
            ? [
                {
                  owner: "tests",
                  severity: "blocking",
                  claim: "the defect remains",
                  evidence: `census-${gateCalls}.json`,
                },
              ]
            : [];
        },
      },
    );
    expect(gateCalls).toBe(3);
    expect(outcome.buildAdmissible).toBe(true);
    expect(outcome.iterations.map((row) => row.outcome)).toEqual([
      "gates-blocked",
      "gates-blocked",
      "fingerprinted",
    ]);
    // The execution record must name the same return. The controller commits before it validates
    // and reverting a file stages a change, so submit 3 settles at a third commit sha over the
    // first tree: keyed on the sha, every submission here reads as a fresh tree, which is how run
    // 35's 141 attempts ending byte-identical to its first went unnamed.
    const record = required(readExecutionEvidence(campaignDir)[0], "one execution record for this session");
    const submits = record.submits;
    expect(submits.map((row) => row.treeFirstSubmittedAsAttempt)).toEqual([null, null, 1, null]);
    expect(submits[2]?.commit).not.toBe(submits[0]?.commit);
    expect(submits[2]?.treeId).toBe(required(submits[0]?.treeId, "the first submission's contract roots"));
    expect(submitProjection(submits)).toMatchObject({ uniqueCandidateTrees: 3, repeatedTreeSubmits: 1 });
  });

  // Run 52 made 17 submissions inside one provider turn, each paying a fresh census and F2 to be
  // told what it had already been told. The strike identity is the candidate contract, not the
  // workspace commit: the note files at the workspace root sit outside both contract roots, so
  // editing MEMORY.md between identical resubmits moves every commit while the candidate stays
  // the same. Keyed by commit, each churned resubmit read as a fresh tree and the ceiling never
  // fired.
  it.concurrent("validates one candidate once and counts strikes across note-file churn", async () => {
    const campaignDir = scratchDir("ana-primary-note-churn-");
    const workspace = join(campaignDir, "workspace");
    let gateCalls = 0;
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 8 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            writeFileSync(join(workspace, "MEMORY.md"), `note for attempt ${turns}\n`);
            const submit = submitTool(tools);
            await submit.execute("submit", {});
            return { status: "completed", assistantText: "submitted" };
          }),
        gates: async () => {
          gateCalls += 1;
          return [
            {
              owner: "tests",
              severity: "blocking",
              claim: "the same task defect remains",
              evidence: `census-${gateCalls}.json`,
            },
          ];
        },
      },
    );
    // Eight turns were available: one validated refusal, three counted strikes, terminal on the
    // third — the note churn neither paid another gate run nor restarted the count, and only the
    // validated settlement landed as iteration evidence.
    expect(gateCalls).toBe(1);
    expect(turns).toBe(4);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["authoring-stalled"] });
    expect(outcome.iterations).toHaveLength(1);
    // The record reads the churn the way the strike counter does: one tree, submitted four times.
    // Keyed on the commit the note moved, it told the Builder its files had changed at every
    // resubmit and counted four distinct trees where the controller had validated one.
    const record = required(readExecutionEvidence(campaignDir)[0], "one execution record for this session");
    expect(record.submits.map((row) => row.workspaceChanged)).toEqual([null, false, false, false]);
    expect(submitProjection(record.submits)).toMatchObject({
      uniqueCandidateTrees: 1,
      unchangedTreeSubmits: 3,
      repeatedTreeSubmits: 3,
    });
  });

  // A relaunch used to reopen the counter at zero, so a session that died mid-streak bought the
  // next invocation a full fresh allowance on the same blocked candidate. The replayed
  // gates-blocked evidence now seeds the counter with the candidate identity and its spent count.
  it.concurrent("continues the strike count across invocations on the same blocked candidate", async () => {
    const campaignDir = scratchDir("ana-primary-strike-resume-");
    const workspace = join(campaignDir, "workspace");
    const blockedGate = async () => [
      {
        owner: "tests" as const,
        severity: "blocking" as const,
        claim: "the same task defect remains",
        evidence: "census.json",
      },
    ];
    const session = (counter: { turns: number }) => async (tools: readonly unknown[]) =>
      scriptedSession(async () => {
        counter.turns += 1;
        completeBundle(workspace);
        const submit = submitTool(tools);
        await submit.execute("submit", {});
        return { status: "completed", assistantText: "submitted" };
      });
    const first = { turns: 0 };
    await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 2 },
      { tools: [], toolsProbes: () => ({}), open: session(first), gates: blockedGate },
    );
    expect(first.turns).toBe(2);
    const resumed = { turns: 0 };
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 6 },
      { tools: [], toolsProbes: () => ({}), open: session(resumed), gates: blockedGate },
    );
    // The seeded identity makes the resumed refusal strike 1; the ceiling ends the second
    // invocation after three turns instead of granting four fresh ones.
    expect(resumed.turns).toBe(3);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["authoring-stalled"] });
  }, 30_000);

  // A typed runtime non-result is an environment fact about one execution, not a verdict on the
  // candidate bytes: cached, it answered every later resubmit of a recovered environment with the
  // stale crash and the session could never complete on those bytes.
  it.concurrent("re-executes a tree whose only refusal was a typed runtime non-result", async () => {
    const campaignDir = scratchDir("ana-primary-nonresult-retry-");
    const workspace = join(campaignDir, "workspace");
    let loads = 0;
    const submits: string[] = [];
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 4 },
      {
        tools: [],
        toolsProbes: () => ({
          load: async () => {
            loads += 1;
            return loads <= 2
              ? [
                  generatedExecutionFinding(
                    {
                      code: "generated-toolset-termination",
                      path: "agent/tools.ts",
                      detail: "generated-tool worker did not settle normally: worker crashed",
                    },
                    "generated-toolset-contract",
                  ),
                ]
              : [];
          },
        }),
        gates: async () => [],
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            submits.push(JSON.stringify(await submitTool(tools).execute("submit", {})));
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    // The same bytes paid for a fresh execution each time instead of reading the cached crash, and
    // the unchanged resubmission after a non-result is not a no-op strike (campaign 199f6a55,
    // 2026-09-08, struck one commit twice for one worker crash).
    expect(loads).toBe(3);
    expect(submits[1]).not.toContain("authoring-noop-submit");
    expect(outcome.buildAdmissible).toBe(true);
  });
});
