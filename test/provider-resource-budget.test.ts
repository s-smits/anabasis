import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { campaignBudgetGate, setTurnBudget } from "../src/run/campaign-budget.ts";
import { CampaignBudgetExhausted, loadBudget } from "../src/run/controller-ledger.ts";
import type {
  AgentSession,
  AgentTurnResult,
  RunTurnOptions,
  TurnUsage,
} from "../src/backends/backend-types.ts";
import { runModelAttempt } from "../src/author/build-agent.ts";
import {
  ProviderResourceBudget,
  ProviderResourceBudgetExhausted,
  ProviderResourceBudgetClosed,
  assertProviderResourceBudgetSnapshot,
  joinBudgetEvidence,
  runBudgetedAgentTurn,
} from "../src/run/provider-resource-budget.ts";

const USAGE: TurnUsage = {
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  costUsd: null,
};

function session(run: (options: RunTurnOptions) => Promise<AgentTurnResult>): AgentSession {
  return {
    backend: "codex",
    runTurn: run,
    async dispose() {},
  };
}

/** A campaign budget row both sides of a join can carry unchanged. */
const idleBudget = { turnBudget: null, turnsUsed: 0, status: "active" as const };

describe("the full-run provider resource budget", () => {
  it("counts one outer turn per role and keeps provider-null usage unknown", () => {
    const budget = new ProviderResourceBudget(4);
    budget.reserve("builder").complete(USAGE);
    budget.reserve("built").complete({ ...USAGE, costUsd: 0.25 });
    budget.reserve("review").complete();

    expect(budget.snapshot()).toEqual({
      schema: "provider-resource-budget/v2",
      cap: 4,
      used: 3,
      active: 0,
      byRole: { builder: 1, built: 1, review: 1 },
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        reportedTurns: 2,
        unreportedTurns: 1,
      },
    });
  });

  it("reserves concurrently without exceeding the cap and refuses further turns", async () => {
    const budget = new ProviderResourceBudget(2);
    const entered: string[] = [];
    const turn = (name: string) =>
      runBudgetedAgentTurn(
        session(async () => {
          entered.push(name);
          await Promise.resolve();
          return { status: "completed" };
        }),
        { prompt: name },
        budget,
        "review",
      );

    const results = await Promise.allSettled([turn("a"), turn("b"), turn("c")]);
    expect(entered.sort()).toEqual(["a", "b"]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(2);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.any(ProviderResourceBudgetExhausted),
    });
    expect(budget.snapshot()).toMatchObject({ used: 2, byRole: { review: 2 } });
    expect(() => budget.throwIfDenied()).toThrow(ProviderResourceBudgetExhausted);
  });

  it("does not refund a failed or aborted provider turn", async () => {
    const budget = new ProviderResourceBudget(2);
    await expect(
      runBudgetedAgentTurn(
        session(async (options) => {
          options.onEvent?.({ type: "turn_failed", errorMessage: "provider 529", usage: USAGE });
          throw new Error("provider 529");
        }),
        { prompt: "fail" },
        budget,
        "built",
      ),
    ).rejects.toThrow("provider 529");
    await runBudgetedAgentTurn(
      session(async (options) => {
        options.onEvent?.({ type: "turn_ended", stopReason: "aborted" });
        return { status: "completed" };
      }),
      { prompt: "abort" },
      budget,
      "builder",
    );
    expect(budget.snapshot()).toMatchObject({
      used: 2,
      byRole: { builder: 1, built: 1, review: 0 },
      usage: { reportedTurns: 1, unreportedTurns: 1 },
    });
  });

  it("refuses new turns with the supplied cause while an active turn finishes", async () => {
    class RunStopped extends Error {
      readonly kind = "test-run-stopped" as const;
    }
    const budget = new ProviderResourceBudget(3);
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let laterStarts = 0;
    const activeTurn = runBudgetedAgentTurn(
      session(async () => {
        entered.resolve();
        await finish.promise;
        return { status: "completed" };
      }),
      { prompt: "active" },
      budget,
      "built",
    );
    await entered.promise;
    expect(budget.activeReservations).toBe(1);
    const stopped = new RunStopped("deadline elapsed");
    budget.stopNewReservations(stopped);
    let idleResolved = false;
    const idle = budget.waitForIdle().then(() => (idleResolved = true));
    await Promise.resolve();
    expect(idleResolved).toBe(false);
    await expect(
      runBudgetedAgentTurn(
        session(async () => {
          laterStarts += 1;
          return { status: "completed" };
        }),
        { prompt: "later" },
        budget,
        "review",
      ),
    ).rejects.toBe(stopped);
    expect(() => budget.assertAvailable("builder")).toThrow(stopped);
    expect(() => budget.throwIfDenied()).toThrow(stopped);
    expect(laterStarts).toBe(0);
    expect(budget.snapshot()).toMatchObject({ used: 1, active: 1 });
    finish.resolve();
    await activeTurn;
    await idle;
    expect(idleResolved).toBe(true);
    expect(budget.snapshot()).toMatchObject({ used: 1, active: 0 });
  });

  it("releases a reservation before startup and finishes the idle wait once", async () => {
    const budget = new ProviderResourceBudget(1);
    const reservation = budget.reserve("builder");
    const idle = budget.waitForIdle();
    expect(budget.snapshot()).toMatchObject({ used: 1, active: 1, byRole: { builder: 1 } });
    reservation.releaseBeforeStart();
    reservation.releaseBeforeStart();
    reservation.complete();
    await idle;
    expect(budget.snapshot()).toMatchObject({ used: 0, active: 0, byRole: { builder: 0 } });
  });

  it("refuses terminal snapshots and evidence joins until active reservations finish", () => {
    const budget = new ProviderResourceBudget(2);
    const opening = budget.snapshot();
    const reservation = budget.reserve("review");
    const active = budget.snapshot();
    expect(() => budget.terminalSnapshot()).toThrow(/cannot close with 1 active reservation/);
    expect(() =>
      joinBudgetEvidence({
        openingPath: "opening.json",
        terminalPath: "terminal.json",
        opening: { budget: idleBudget, providerResourceBudget: opening },
        terminal: { budget: idleBudget, providerResourceBudget: active },
      }),
    ).toThrow(/terminal.json: provider resource budget has 1 active reservation/);
    reservation.complete();
    expect(budget.terminalSnapshot()).toMatchObject({ used: 1, active: 0 });
    expect(() => budget.reserve("built")).toThrow(ProviderResourceBudgetClosed);
    const stopped = new Error("controller stopped after closure");
    budget.stopNewReservations(stopped);
    expect(() => budget.assertAvailable("review")).toThrow(stopped);
  });

  it("completes a used Builder reservation when its usage reporter throws", async () => {
    const budget = new ProviderResourceBudget(2);
    const reporterFailure = new Error("usage reporter failed");
    await expect(
      runModelAttempt(
        undefined,
        "builder",
        async () => "ok",
        budget,
        () => {
          throw reporterFailure;
        },
      ),
    ).rejects.toBe(reporterFailure);
    await budget.waitForIdle();
    expect(budget.snapshot()).toMatchObject({
      used: 1,
      active: 0,
      byRole: { builder: 1 },
      usage: { reportedTurns: 0, unreportedTurns: 1 },
    });
  });

  it("joins the Builder campaign gate without charging the provider budget twice", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-joined-budget-"));
    setTurnBudget(root, 1);
    const budget = new ProviderResourceBudget(2, { campaignRoot: root, runId: "one" });
    const gate = campaignBudgetGate(root, budget.runId);
    await expect(
      runModelAttempt(
        gate,
        "builder",
        async () => {
          expect(gate.status()).toBe("active");
          expect(loadBudget(root).turnsUsed).toBe(1);
          return "ok";
        },
        budget,
      ),
    ).resolves.toBe("ok");
    expect(gate.status()).toBe("budget_limited");
    await expect(
      runModelAttempt(
        gate,
        "builder",
        async () => {
          throw new Error("unreached provider");
        },
        budget,
      ),
    ).rejects.toThrow(CampaignBudgetExhausted);
    expect(budget.snapshot()).toMatchObject({ used: 1, byRole: { builder: 1 } });
    budget.reserve("review").complete(USAGE);
    expect(budget.terminalSnapshot()).toMatchObject({ used: 2, active: 0 });
    expect(loadBudget(root).turnsUsed).toBe(1);
  });

  it("reserves across independent connections without overshooting either quota", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-concurrent-budget-"));
    setTurnBudget(root, 1);
    const first = new ProviderResourceBudget(2, { campaignRoot: root, runId: "shared" });
    const second = new ProviderResourceBudget(2, { campaignRoot: root, runId: "shared" });
    const held = first.reserve("builder");
    expect(() => second.reserve("builder")).toThrow(CampaignBudgetExhausted);
    held.releaseBeforeStart();
    expect(loadBudget(root).turnsUsed).toBe(0);
    const admitted = second.reserve("builder");
    admitted.beginProviderTurn();
    admitted.releaseBeforeStart();
    admitted.complete(USAGE);
    first.reserve("built").complete();
    expect(() => second.reserve("review")).toThrow(ProviderResourceBudgetExhausted);
    expect(first.terminalSnapshot()).toMatchObject({ used: 2, byRole: { builder: 1, built: 1, review: 0 } });
    expect(second.terminalSnapshot()).toMatchObject({ used: 2, active: 0 });
    expect(loadBudget(root).turnsUsed).toBe(1);
  });

  it("carries historical campaign spend into later runs and keeps missing usage unknown", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-inherited-budget-"));
    setTurnBudget(root, 3);
    campaignBudgetGate(root).startAttempt("builder").complete();
    const first = new ProviderResourceBudget(2, { campaignRoot: root, runId: "first-epoch" });
    first.reserve("builder").complete();
    first.terminalSnapshot();
    const next = new ProviderResourceBudget(2, { campaignRoot: root, runId: "next-epoch" });
    next.reserve("builder").complete(USAGE);
    expect(() => next.reserve("builder")).toThrow(CampaignBudgetExhausted);
    expect(loadBudget(root)).toEqual({ turnBudget: 3, turnsUsed: 3, status: "budget_limited" });
    next.reserve("review").complete();
    expect(next.terminalSnapshot()).toMatchObject({
      usage: { inputTokens: null, reportedTurns: 1, unreportedTurns: 1 },
    });
  });

  it("refuses a Builder gate bound to another campaign before reserving a call", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-budget-binding-"));
    const budget = new ProviderResourceBudget(2, { campaignRoot: root, runId: "bound" });
    const other = mkdtempSync(join(tmpdir(), "ana-budget-other-"));
    await expect(
      runModelAttempt(campaignBudgetGate(other), "builder", async () => "unreached", budget),
    ).rejects.toThrow(/same controller ledger/);
    expect(budget.terminalSnapshot().used).toBe(0);
    expect(loadBudget(other).turnsUsed).toBe(0);
  });

  it("rejects invalid caps and damaged evidence rows", () => {
    expect(() => new ProviderResourceBudget(0)).toThrow(/positive safe integer/);
    expect(() => new ProviderResourceBudget(Number.POSITIVE_INFINITY)).toThrow(/positive safe integer/);
    const valid = new ProviderResourceBudget(1).snapshot();
    const { active: _active, ...missingActive } = valid;
    expect(() => assertProviderResourceBudgetSnapshot(missingActive, "opening.json")).toThrow(
      /not a consistent provider-resource-budget/,
    );
    expect(() => assertProviderResourceBudgetSnapshot({ ...valid, active: 1 }, "opening.json")).toThrow(
      /not a consistent provider-resource-budget/,
    );
    const { active: _legacyActive, ...legacy } = { ...valid, schema: "provider-resource-budget/v1" as const };
    expect(() => assertProviderResourceBudgetSnapshot(legacy, "legacy-opening.json")).toThrow(
      /not a consistent provider-resource-budget/,
    );
    expect(() =>
      assertProviderResourceBudgetSnapshot(
        { ...valid, schema: "provider-resource-budget/v1" },
        "legacy-terminal.json",
      ),
    ).toThrow(/not a consistent provider-resource-budget/);
    expect(
      joinBudgetEvidence({
        openingPath: "legacy-opening.json",
        terminalPath: "legacy-terminal.json",
        opening: { budget: idleBudget, providerResourceBudget: null },
        terminal: { budget: idleBudget, providerResourceBudget: null },
      }).providerResourceBudget,
    ).toBeNull();
    expect(() =>
      assertProviderResourceBudgetSnapshot(
        {
          schema: "provider-resource-budget/v2",
          cap: 2,
          used: 1,
          active: 0,
          byRole: { builder: 1, built: 1, review: 0 },
          usage: {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            costUsd: null,
            reportedTurns: 0,
            unreportedTurns: 1,
          },
        },
        "terminal.json",
      ),
    ).toThrow(/not a consistent provider-resource-budget/);
  });
});
