/**
 * What the controller tells the author between turns.
 *
 * The steering line a repeated diagnosis earns must reach the author without carrying protected
 * verifier detail, and it may not end a session that is still making progress. The Epoch
 * Reviewer's word to the same session is `authoring-review.test.ts`'s.
 */
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  bundleWithoutGuide,
  commitRoundEntry,
  completeBundle,
  submitOnce,
  submitTool,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { scriptedSession } from "./helpers/doubles.ts";
import { POLICY } from "../src/critic/policy.ts";
import { workspaceHead } from "../src/author/domain-repo.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { CampaignOutcome, IterationEvidence } from "../src/author/campaign-types.ts";

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
