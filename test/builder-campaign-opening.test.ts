/**
 * What the campaign hands its first Builder turn.
 *
 * The opening prompt is a condition identity: what it states, and the tool roster it mounts,
 * decide what the authoring session can even attempt. These read what the controller assembled,
 * not what a Builder did with it.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { FRESH_BUILD, openingPrompt } from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { scriptedSession } from "./helpers/doubles.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import { renderBatteryContract } from "../src/run/climb-readout.ts";

afterAll(cleanupScratch);

describe("the opening a campaign composes", () => {
  it("ends a probe-only campaign at its turn bound, never on a probe budget or no-submit strike", async () => {
    // Operator decision 2026-09-14: reconnaissance is bounded by maxTurns alone.
    const campaignDir = scratchDir("ana-probe-only-campaign-");
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 3 },
      {
        tools: [],
        toolsProbes: () => ({}),
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

    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(turns).toBe(3);
  });

  /**
   * Run 67 opened on a 625-character, two-line prompt with no difficulty guidance. The guidance
   * existed, but only the task-only session received it; the fresh-build path never called the
   * renderer. A renderer unit test could pass while that omission remained. Capture the prompt
   * where the campaign delivers it to the session, then compare it with the renderer's output.
   * This checks delivery of the current guidance and allows its wording to change without
   * duplicating the entire paragraph in this test.
   */
  it.concurrent("opens a fresh build with the first-battery guidance", async () => {
    const prompt = await openingPrompt(FRESH_BUILD);
    expect(prompt).toContain("Task count: exactly 4 tasks.");
    // The guidance quotes the counts of the battery this session was given, not a fixed 25.
    expect(prompt).toContain(renderBatteryContract(4));
    expect(prompt).not.toContain(renderBatteryContract(25));
  });

  it.concurrent("opens a probe round on the range it may choose in, not one size", async () => {
    // The sizing gate sends `minTasks` for a probe round; the session must be told it picks the size,
    // or the Builder authors the upper bound and the probe stops being cheap.
    const prompt = await openingPrompt({ ...FRESH_BUILD, expectedTasks: 10, minTasks: 5 });
    expect(prompt).toContain("Task count: between 5 and 10 tasks — choose the size in that range yourself.");
    expect(prompt).not.toContain("exactly 10 tasks");
    // The pass course names counts for the size the Builder picks, never an "of 10" target.
    expect(prompt).toContain(renderBatteryContract(10, 5));
    expect(prompt).toContain(
      "read the row for the size you pick: 5 tasks — author for about 1, aim 1 to 2, 5 or more finds no limit.",
    );
    expect(prompt).toContain("8 tasks — author for about 1, aim 2 to 4, 7 or more finds no limit");
    expect(prompt).not.toContain("for your chosen size");
    expect(prompt).not.toMatch(/\bof 10\b/);
  });

  it.concurrent("projects carried repair evidence at the composed opening-prompt boundary", async () => {
    const delivered = await openingPrompt({
      ...FRESH_BUILD,
      priorEvidence: {
        kind: "admitted-packet",
        digest: "e".repeat(64),
        feedback: [
          {
            owner: "tests",
            severity: "blocking",
            claim: "RAW_PROTECTED_CLAIM",
            evidence: "RAW_PROTECTED_EVIDENCE",
            findings: [
              { code: "RAW_PROTECTED_CODE", path: "RAW_PROTECTED_PATH", detail: "RAW_PROTECTED_DETAIL" },
            ],
          },
        ],
      },
    });
    expect(delivered).toContain(
      "tests (correctness-model/tasks.json): [blocking] generated-execution-unclassified: a check failed while executing your generated code and carries no public detail; use harness_inspect for static diagnostics, harness_trial for the generated solve path, or verifier_workshop for the correctnessModel path",
    );
    expect(delivered).not.toContain("RAW_PROTECTED");
  });

  it.concurrent("opens the Builder session with the closed authoring tool roster", async () => {
    const campaignDir = scratchDir("ana-primary-roster-");
    let observed = false;
    await expect(
      runBuilderCampaign(
        { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4 },
        {
          tools: [],
          toolsProbes: () => ({}),
          // A scripted failed turn is retried on a growing backoff; this test spends none of it.
          waitMs: async () => {},
          open: async (tools): Promise<HostSession> => {
            observed = true;
            // SAFETY: production composition supplies AgentTool-shaped rows; this assertion reads
            // only the optional name needed to inspect the captured roster.
            const names = tools.map((tool) => (tool as { name?: string }).name);
            expect(names).toEqual(expect.arrayContaining(["harness_inspect", "harness_trial", "submit"]));
            // No adoption gate is supplied, so correctness_check is not registered.
            expect(names).not.toContain("correctness_check");
            return scriptedSession(async () => {
              return { status: "failed", errorMessages: ["stop after bootstrap proof"] };
            });
          },
        },
      ),
    ).rejects.toThrow(/stop after bootstrap proof/);
    expect(observed).toBe(true);
  });
});
