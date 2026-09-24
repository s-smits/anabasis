/**
 * What a campaign charges before it calls a model.
 *
 * ControllerLedger reserves campaign and provider quotas together, before the call. A started
 * call stays charged across interruption and epoch, only an unstarted reservation may be
 * cancelled, and a missing or corrupt budget refuses rather than resets.
 */
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { submitProjection } from "../src/author/builder-execution.ts";
import { FRESH_BUILD, completeBundle, submitTool } from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { scriptedSession } from "./helpers/doubles.ts";
import {
  CampaignBudgetConfigurationError,
  campaignBudgetGate,
  setTurnBudget,
} from "../src/run/campaign-budget.ts";
import { loadBudget } from "../src/run/controller-ledger.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import { readAuthoringAttemptEvidence } from "../src/author/build-attempt-evidence.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";

afterAll(cleanupScratch);

describe("the campaign's provider ledger", () => {
  // Settlements charge the span since the previous settlement, so turns after the last submit —
  // or a whole session that never submitted — used to leave the ledger short of the provider's
  // own turn count.
  it.concurrent("charges the session tail so every completed turn lands in the campaign ledger", async () => {
    const campaignDir = scratchDir("ana-primary-tail-charge-");
    const budget = campaignBudgetGate(campaignDir);
    await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 3 },
      {
        tools: [],
        toolsProbes: () => ({}),
        budget,
        open: async () =>
          scriptedSession(async () => {
            return { status: "completed", assistantText: "still reading the workspace" };
          }),
      },
    );
    expect(loadBudget(campaignDir)).toMatchObject({ turnsUsed: 3, status: "active" });
  });

  it.concurrent("refuses an exhausted budget before opening a persistent Builder session", async () => {
    const campaignDir = scratchDir("ana-primary-budget-boundary-");
    setTurnBudget(campaignDir, 1);
    campaignBudgetGate(campaignDir).startAttempt("builder").complete();
    const before = loadBudget(campaignDir);
    let opened = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 3 },
      {
        tools: [],
        toolsProbes: () => ({}),
        budget: campaignBudgetGate(campaignDir),
        open: async (): Promise<HostSession> => {
          opened += 1;
          throw new Error("an exhausted campaign must not open a provider session");
        },
      },
    );
    expect(outcome).toEqual({ buildAdmissible: false, clauses: ["budget-limited"], iterations: [] });
    expect(opened).toBe(0);
    expect(loadBudget(campaignDir)).toEqual(before);
  });

  it.concurrent("charges one ordinary model call and stops before a second turn", async () => {
    const campaignDir = scratchDir("ana-primary-attempt-gate-");
    setTurnBudget(campaignDir, 1);
    const gate = campaignBudgetGate(campaignDir);
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({}),
        budget: gate,
        attemptGate: gate,
        open: async () =>
          scriptedSession(async () => {
            turns += 1;
            return { status: "completed", assistantText: "still authoring" };
          }),
      },
    );
    expect(turns).toBe(1);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["budget-limited"] });
    expect(loadBudget(campaignDir)).toMatchObject({ turnBudget: 1, turnsUsed: 1, status: "budget_limited" });
  });

  it.concurrent("derives the durable gate when a direct campaign caller omits attemptGate", async () => {
    const campaignDir = scratchDir("ana-primary-implicit-attempt-gate-");
    setTurnBudget(campaignDir, 1);
    const gate = campaignBudgetGate(campaignDir);
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 2 },
      {
        tools: [],
        toolsProbes: () => ({}),
        budget: gate,
        open: async () =>
          scriptedSession(async () => {
            turns += 1;
            return { status: "completed", assistantText: "still authoring" };
          }),
      },
    );
    expect(turns).toBe(1);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["budget-limited"] });
    expect(loadBudget(campaignDir)).toMatchObject({ turnBudget: 1, turnsUsed: 1, status: "budget_limited" });
  });

  it.concurrent("records a failed Builder turn as a non-result and charges its retries", async () => {
    const campaignDir = scratchDir("ana-primary-non-result-");
    const budget = campaignBudgetGate(campaignDir);
    await expect(
      runBuilderCampaign(
        { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4 },
        {
          tools: [],
          toolsProbes: () => ({}),
          // A scripted failed turn is retried on a growing backoff; this test spends none of it.
          waitMs: async () => {},
          open: async () =>
            scriptedSession(async () => {
              return { status: "failed", errorMessages: ["provider unavailable"] };
            }),
          budget,
        },
      ),
    ).rejects.toThrow(/failed \(role builder\).*provider unavailable/);
    expect(readAuthoringAttemptEvidence(campaignDir)).toMatchObject([
      {
        outcome: "non-result",
        terminal: { role: "builder", status: "failed", attribution: null },
        authorCalls: { builder: 1 },
      },
    ]);
    // One authoring turn, four model calls: the failed turn plus the three retries it was given,
    // each reserved through the same durable gate.
    expect(loadBudget(campaignDir)).toMatchObject({ turnsUsed: 4, status: "active" });
  });

  it.concurrent("charges a failed turn after an accepted submit exactly once", async () => {
    const campaignDir = scratchDir("ana-primary-submit-then-fail-");
    setTurnBudget(campaignDir, 1);
    const budget = campaignBudgetGate(campaignDir);
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({}),
        // A scripted failed turn is retried on a growing backoff; this test spends none of it.
        waitMs: async () => {},
        gates: async () => [],
        budget,
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(join(campaignDir, "workspace"));
            await submitTool(tools).execute("submit", {});
            return { status: "failed", errorMessages: ["provider ended after submit"] };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(loadBudget(campaignDir)).toEqual({ turnBudget: 1, turnsUsed: 1, status: "budget_limited" });
  });

  it.concurrent("refuses a narrow finite-budget double before opening a provider session", async () => {
    const campaignDir = scratchDir("ana-primary-narrow-budget-");
    let opened = 0;
    await expect(
      runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD },
        {
          tools: [],
          toolsProbes: () => ({}),
          budget: { status: () => "active" },
          open: async (): Promise<HostSession> => {
            opened += 1;
            throw new Error("narrow budget must fail before opening");
          },
        },
      ),
    ).rejects.toBeInstanceOf(CampaignBudgetConfigurationError);
    expect(opened).toBe(0);
  });

  it.concurrent("fails closed on a claim-only gate row instead of laundering its prose as controller-validated", async () => {
    // A row with no findings has nothing a controller validator produced — only ad hoc prose a
    // gate author wrote. The budget-limited submit path constructs exactly this shape (an
    // "environment" row whose claim is free text, no findings array); it stands in here for any
    // future claim-only row, hostile or not.
    const campaignDir = scratchDir("ana-claim-only-fallback-");
    let submitOutput = "";
    let budgetChecks = 0;
    await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => [],
        open: async (tools) =>
          scriptedSession(async () => {
            const submit = submitTool(tools);
            submitOutput = JSON.stringify(await submit.execute("submit", {}));
            return { status: "completed", assistantText: "submitted" };
          }),
        budget: {
          // The first check is the pre-session boundary. The second simulates the cap becoming
          // exhausted before the same session's submit, preserving coverage of that terminal
          // projection without allowing an already-exhausted campaign to open a provider.
          status: () => (budgetChecks++ === 0 ? "active" : "budget_limited"),
          campaignRoot: campaignDir,
          assertAttemptAvailable: () => {},
          startAttempt: () => ({ beginProviderTurn: () => {}, complete: () => {} }),
        },
      },
    );
    expect(submitOutput).not.toContain("campaign turn budget is spent");
    expect(submitOutput).toContain(
      "gate-environment submit: this gate produced no controller-validated finding; no public detail is available",
    );
  });

  it.concurrent("writes an in-session budget terminal as a typed execution event", async () => {
    const campaignDir = scratchDir("ana-budget-terminal-execution-");
    let budgetChecks = 0;
    await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            await submitTool(tools).execute("submit", {});
            return { status: "completed", assistantText: "submitted" };
          }),
        budget: {
          // The composed budget boundary refuses an already-spent campaign before opening a
          // provider. Start active, then spend the cap before submit so this test exercises the
          // distinct in-session controller-terminal projection.
          status: () => (budgetChecks++ === 0 ? "active" : "budget_limited"),
          campaignRoot: campaignDir,
          assertAttemptAvailable: () => {},
          startAttempt: () => ({ beginProviderTurn: () => {}, complete: () => {} }),
        },
      },
    );
    const execution = readExecutionEvidence(campaignDir);
    expect(execution).toHaveLength(1);
    expect(execution[0]?.submits).toEqual([
      expect.objectContaining({
        kind: "controller-terminal",
        commit: "budget-limited",
        terminal: true,
      }),
    ]);
    expect(submitProjection(execution[0]?.submits ?? []).submitCounts).toEqual({
      raw: 1,
      candidates: 0,
      controllerTerminals: 1,
    });
  });
});
