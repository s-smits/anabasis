/**
 * What the controller tells the author between turns.
 *
 * Two mechanisms write into a live session: the Epoch Reviewer on its clock, and the steering
 * line a repeated diagnosis earns. Both must reach the author without carrying protected
 * verifier detail, and neither may end a session that is still making progress.
 */
import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  FRESH_BUILD,
  bundleWithoutGuide,
  commitRoundEntry,
  completeBundle,
  installTool,
  requireExternalVerifier,
  submitOnce,
  submitTool,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { scriptedSession, toolDouble } from "./helpers/doubles.ts";
import type { FixtureSubmitTool } from "./helpers/builder-campaign.ts";
import { MATCHING_OPERATING_GUIDE } from "./helpers/matching-fixture.ts";
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { POLICY } from "../src/critic/policy.ts";
import { workspaceHead } from "../src/author/domain-repo.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { CampaignOutcome, IterationEvidence } from "../src/author/campaign-types.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";

afterAll(cleanupScratch);

describe("the controller's word to a running session", () => {
  /** One blocked attempt per turn, each churning the agent bundle so the fingerprint moves while
   *  the gates repeat their claim. `claimFor` decides whether the diagnosis stays frozen or
   *  alternates. The attempts are split across two campaigns so the trailing run has to survive
   *  the campaign boundary through memory as well as the in-campaign fold. */
  async function churningAttempts(
    prefix: string,
    turnsPerCampaign: readonly number[],
    claimFor: (attempt: number) => string,
  ): Promise<CampaignOutcome[]> {
    const campaignDir = scratchDir(prefix);
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    let attempt = 0;
    submitTexts.length = 0;
    const outcomes: CampaignOutcome[] = [];
    for (const maxTurns of turnsPerCampaign) {
      outcomes.push(
        await runBuilderCampaign(
          {
            campaignDir,
            slug: "matching",
            kickoff: "Build a slot binding harness.",
            expectedTasks: 4,
            maxTurns,
          },
          {
            tools: [],
            toolsProbes: () => ({}),
            open: async (tools) =>
              scriptedSession(async () => {
                attempt += 1;
                // The churn: the agent bundle itself moves every attempt, so each iteration's
                // fingerprint differs from the last while the gates repeat one finding.
                writeFileSync(join(workspace, "agent", "tools.ts"), `export const attempt = ${attempt};\n`);
                const submitted = await submitTool(tools).execute(`submit-${attempt}`, {});
                submitTexts.push(submitted.content.map((part) => part.text).join("\n"));
                return { status: "completed", assistantText: "submitted" };
              }),
            gates: async () => [
              { owner: "tests", severity: "blocking", claim: claimFor(attempt), evidence: "gate.json" },
            ],
          },
        ),
      );
    }
    return outcomes;
  }

  /** What each churning attempt's submit call returned to the model, in attempt order. */
  const submitTexts: string[] = [];

  function attemptRows(outcomes: readonly CampaignOutcome[]): IterationEvidence[] {
    return outcomes.flatMap((outcome) => outcome.iterations);
  }

  it("returns the review of a validated product repair in the correctness_check result, once per changed product", async () => {
    const campaignDir = scratchDir("ana-review-repair-");
    const workspace = join(campaignDir, "workspace");
    const reviewed: string[] = [];
    const plans: Array<string | null> = [];
    const outcome = await runBuilderCampaign(
      { ...FRESH_BUILD, campaignDir, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({ load: async () => [] }),
        gates: async () => [],
        reviewAuthoring: async (root, trigger, experiment) => {
          expect(trigger).toBe("repair");
          expect(root).toContain(".bundle-snapshots");
          reviewed.push(readFileSync(join(root, "agent/BUILT_AGENTS.md"), "utf8"));
          // The snapshot holds the bundle alone; the plan is read from the workspace beside it.
          plans.push(experiment?.gap ?? null);
          return "Public review advice.";
        },
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            installTool(workspace, "field-engine");
            writeFileSync(
              join(workspace, "EXPERIMENT.json"),
              JSON.stringify({
                ...PLAN_FIELDS,
                scope: "product",
                gap: "The writer cannot express a pinned joint.",
                change: "Add pinned joints to the writer.",
                expectedResult: "More accepted submissions.",
                target: { comparator: "at-least", verifiedPasses: 1 },
              }),
            );
            // SAFETY: the campaign mounts this executable tool when gates are supplied.
            const check = tools.find(
              (tool) => (tool as { name?: string }).name === "correctness_check",
            ) as FixtureSubmitTool;
            expect(JSON.stringify(await check.execute("check", {}))).toContain("Public review advice");
            expect(reviewed).toHaveLength(1);
            expect(plans).toEqual(["The writer cannot express a pinned joint."]);
            // Unchanged product bytes: the same clear result, no second review.
            expect(JSON.stringify(await check.execute("same-check", {}))).not.toContain(
              "Public review advice",
            );
            writeFileSync(
              join(workspace, "agent/BUILT_AGENTS.md"),
              `${MATCHING_OPERATING_GUIDE}\nA repaired public instruction.\n`,
            );
            expect(JSON.stringify(await check.execute("repaired-check", {}))).toContain(
              "Public review advice",
            );
            // Acceptance closes authoring; the accepted product is reviewed after its battery.
            expect(JSON.stringify(await submitTool(tools).execute("submit", {}))).not.toContain(
              "Public review advice",
            );
            return { status: "completed" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(reviewed).toHaveLength(2);
    expect(reviewed[1]).toContain("A repaired public instruction.");
    const reviews = readExecutionEvidence(campaignDir)[0]?.authoringReviews;
    expect(reviews?.map((row) => [row.tool, row.adviceChars])).toEqual([
      ["correctness_check", 21],
      ["correctness_check", 21],
    ]);
  });

  it("reviews the live workspace at the next completed tool call once the interval has elapsed, then restarts the clock", async () => {
    const campaignDir = scratchDir("ana-review-clock-");
    const workspace = join(campaignDir, "workspace");
    let reviews = 0;
    const noop = toolDouble({
      name: "noop",
      execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    await runBuilderCampaign(
      { ...FRESH_BUILD, campaignDir, maxTurns: 1 },
      {
        tools: [noop],
        toolsProbes: () => ({}),
        reviewIntervalMs: 300,
        reviewAuthoring: async (root, trigger) => {
          expect(root).toBe(workspace);
          expect(trigger).toBe("backstop");
          reviews += 1;
          await Bun.sleep(150);
          return "Review finished.";
        },
        open: async (tools) =>
          scriptedSession(async ({ signal }) => {
            expect(signal).toBeUndefined();
            // SAFETY: the scripted roster carries the fixture tool this test mounted; only its execute is read.
            const tool = tools.find((row) => (row as { name?: string }).name === "noop") as FixtureSubmitTool;
            await Bun.sleep(350);
            expect(reviews).toBe(0);
            expect(JSON.stringify(await tool.execute("due", {}))).toContain("Review finished.");
            expect(reviews).toBe(1);
            // The clock restarted when the review finished, not when it became due.
            expect(JSON.stringify(await tool.execute("fresh-clock", {}))).not.toContain("Review finished.");
            await Bun.sleep(350);
            await tool.execute("due-again", {});
            expect(reviews).toBe(2);
            return { status: "completed" };
          }),
      },
    );
  });

  it.concurrent("continues a second invocation that repeats one blocked diagnosis instead of stalling", async () => {
    // Runs w26 and w28 each died as authoring-stalled on a single repeat under the deleted
    // exact-tuple variant: changed paths, findings hash and fingerprint all matched here, so this
    // exact scenario used to terminate. A repeated diagnosis now terminates only at the trail
    // ceiling (the churn tests below); one repeat continues.
    const campaignDir = scratchDir("ana-primary-stalled-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    let gateCalls = 0;
    const run = (marker: string) =>
      runBuilderCampaign(
        {
          campaignDir,
          slug: "matching",
          kickoff: "Build a slot binding harness.",
          expectedTasks: 4,
          maxTurns: 1,
        },
        {
          tools: [],
          toolsProbes: () => ({}),
          open: async (tools) =>
            scriptedSession(async () => {
              writeFileSync(join(workspace, "SCRATCHPAD.md"), `${marker}\n`);
              await submitTool(tools).execute(`submit-${marker}`, {});
              return { status: "completed", assistantText: "submitted" };
            }),
          gates: async () => {
            gateCalls += 1;
            return [
              {
                owner: "tests",
                severity: "blocking",
                claim: "the same authoring defect remains",
                evidence: `gate-${gateCalls}.json`,
              },
            ];
          },
        },
      );
    const first = await run("first replay");
    expect(first).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    const outcome = await run("second replay");
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(gateCalls).toBe(2);
    expect(outcome.iterations).toHaveLength(1);
    expect(outcome.iterations[0]?.workspaceChange?.changedPaths).toEqual(
      first.iterations[0]?.workspaceChange?.changedPaths,
    );
    expect(outcome.iterations[0]?.findingsHash).toBe(first.iterations[0]?.findingsHash);
    expect(outcome.iterations[0]?.fingerprint).toEqual(first.iterations[0]?.fingerprint);
  }, 30_000);

  it("tells the author from the second identical diagnosis how often it has repeated, before the ceiling ends the session", async () => {
    // A Sol run on 2026-08-22 recorded one findings hash five rounds in a row on five different trees
    // and read nothing about the repeat: the no-op strike keys on candidate identity, which
    // changed every round, and the ceiling variant speaks only at the end.
    const ceiling = POLICY.loop.stalledFindingsRepeats;
    const outcomes = await churningAttempts(
      "ana-primary-repeat-steered-",
      [3],
      () => "the same authoring defect remains",
    );
    expect(outcomes[0]).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(submitTexts).toHaveLength(3);
    expect(submitTexts[0]).not.toContain("authoring-repeated-findings");
    expect(submitTexts[1]).toContain("authoring-repeated-findings");
    expect(submitTexts[1]).toContain(`repeat 2 of ${ceiling}`);
    expect(submitTexts[2]).toContain(`repeat 3 of ${ceiling}`);
  }, 40_000);

  it("does not steer on a changed diagnosis", async () => {
    await churningAttempts("ana-primary-changed-", [2], (attempt) => `defect ${attempt}`);
    expect(submitTexts).toHaveLength(2);
    expect(submitTexts[1]).not.toContain("authoring-repeated-findings");
  }, 40_000);

  it.concurrent("stops the declared consecutive identical diagnosis even while tree churn moves the fingerprint", async () => {
    // Run w11's recorded shape: one findings hash 14 iterations in a row while every iteration's
    // workspace bytes moved, so the exact-tuple variant (paths AND fingerprint identical) never
    // fired and the round spent $296 on a diagnosis it had already made. The repeat-count variant
    // terminates at the declared ceiling without the fingerprint conjunct. The last attempt runs
    // in a second campaign, so the trailing run is proved to survive the campaign boundary
    // through memory rather than only the in-campaign fold.
    const ceiling = POLICY.loop.stalledFindingsRepeats;
    const outcomes = await churningAttempts(
      "ana-primary-churn-stalled-",
      [ceiling - 1, 1],
      () => "the same authoring defect remains",
    );
    expect(outcomes[0]).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(outcomes[1]).toMatchObject({ buildAdmissible: false, clauses: ["authoring-stalled"] });
    const rows = attemptRows(outcomes);
    expect(rows).toHaveLength(ceiling);
    // The churn was real: consecutive attempts recorded different agent identities, so only the
    // repeat-count variant can have terminated the run.
    expect(new Set(rows.map((row) => row.fingerprint?.agentHash)).size).toBe(ceiling);
    expect(new Set(rows.map((row) => row.findingsHash)).size).toBe(1);
  }, 40_000);

  it.concurrent("does not stall on alternating diagnoses — the repeat variant counts an unbroken run, not a total", async () => {
    // Twice the ceiling in alternating rounds contains no run longer than one, so the ceiling
    // never fires even though EACH hash reaches the ceiling in total — a detector counting
    // totals rather than unbroken runs stops here, and this test is what separates the two.
    // Alternation is (possibly unproductive) movement between two states, not a frozen
    // diagnosis; the budget gate owns that spend, not the stall detector.
    const rounds = POLICY.loop.stalledFindingsRepeats * 2;
    const outcomes = await churningAttempts("ana-primary-alternating-", [rounds - 1, 1], (attempt) =>
      attempt % 2 === 1 ? "alternating defect A" : "alternating defect B",
    );
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    }
    const rows = attemptRows(outcomes);
    expect(rows).toHaveLength(rounds);
    expect(new Set(rows.map((row) => row.findingsHash)).size).toBe(2);
  }, 40_000);

  it.concurrent("continues the primary build when the changed paths repeat but the findings hash changes", async () => {
    const campaignDir = scratchDir("ana-primary-not-stalled-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    let gateCalls = 0;
    const run = (marker: string) =>
      runBuilderCampaign(
        {
          campaignDir,
          slug: "matching",
          kickoff: "Build a slot binding harness.",
          expectedTasks: 4,
          maxTurns: 1,
        },
        {
          tools: [],
          toolsProbes: () => ({}),
          open: async (tools) =>
            scriptedSession(async () => {
              writeFileSync(join(workspace, "SCRATCHPAD.md"), `${marker}\n`);
              await submitTool(tools).execute(`submit-${marker}`, {});
              return { status: "completed", assistantText: "submitted" };
            }),
          gates: async () => {
            gateCalls += 1;
            return gateCalls <= 2
              ? [
                  {
                    owner: "tests",
                    severity: "blocking",
                    claim: `authoring finding ${gateCalls}`,
                    evidence: `gate-${gateCalls}.json`,
                  },
                ]
              : [];
          },
        },
      );
    const first = await run("first finding");
    const second = await run("second finding");
    expect(second).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    const outcome = await run("accepted after changed finding");
    expect(outcome.buildAdmissible).toBe(true);
    expect(gateCalls).toBe(3);
    expect(outcome.iterations.map((row) => row.outcome)).toEqual(["fingerprinted"]);
    expect(second.iterations[0]?.workspaceChange?.changedPaths).toEqual(
      first.iterations[0]?.workspaceChange?.changedPaths,
    );
    expect(second.iterations[0]?.findingsHash).not.toBe(first.iterations[0]?.findingsHash);
    expect(second.iterations[0]?.fingerprint).toEqual(first.iterations[0]?.fingerprint);
  }, 30_000);

  it.concurrent("an unclassified generated-execution finding reaches the Builder only as the generic label", async () => {
    // The record-load refusal path once blanket-marked every unmarked finding controller-validated,
    // which let an unclassified generated finding carry raw detail past the author isolation (run 80
    // review). The isolation must fail closed: the planted marker may never appear in what the model
    // reads, while a controller-authored refusal keeps its repairable detail.
    const campaignDir = scratchDir("ana-isolation-unclassified-");
    const workspace = join(campaignDir, "workspace");
    const MARKER = "planted-marker-9f3a17";
    const refusal = await submitOnce(campaignDir, () => completeBundle(workspace), {
      load: async () => [
        { code: "generated-load-crash", path: "agent/tools.ts", detail: `worker stack: ${MARKER}` },
      ],
    });
    expect(refusal).not.toContain(MARKER);
    expect(refusal).toContain("generated-execution-unclassified");
  });

  it.concurrent("derives the pre-guide legacy condition from completed memory, never from the entry HEAD", async () => {
    // checkCandidate commits before it validates, so a fresh build refused for the missing guide
    // leaves brief-without-guide at HEAD. Reading HEAD on resume handed that build the legacy
    // exemption; only a commit backed by a completed iteration evidence may open it.
    const campaignDir = scratchDir("ana-primary-preguide-");
    const workspace = join(campaignDir, "workspace");
    const first = await submitOnce(campaignDir, () => bundleWithoutGuide(workspace));
    expect(first).toContain("BUILT_AGENTS.md");

    // Interrupted and resumed: brief is at HEAD, guide is not, and no iteration ever completed.
    // The fresh guide requirement must hold.
    const resumed = await submitOnce(campaignDir, () =>
      writeFileSync(join(workspace, "SCRATCHPAD.md"), "resumed\n"),
    );
    expect(resumed).toContain("BUILT_AGENTS.md");

    // A genuinely legacy epoch: the same guide-less commit, but now carried by a completed
    // iteration evidence. The absence becomes the legal legacy condition.
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
});
