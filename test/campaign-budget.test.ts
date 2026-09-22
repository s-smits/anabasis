/** Both quota policies consume the same durable provider-call reservation. */
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import {
  CampaignBudgetExhausted,
  campaignBudgetGate,
  loadBudget,
  setTurnBudget,
} from "../src/run/campaign-budget.ts";
import { ControllerLedger } from "../src/run/controller-ledger.ts";
import { ProviderResourceBudget } from "../src/run/provider-resource-budget.ts";
import { joinControllerBudgetEvidence } from "../src/run/campaign-budget-evidence.ts";
const tmp = () => mkdtempSync(join(tmpdir(), "ana-campaign-budget-"));

describe("the campaign spend budget", () => {
  it("refuses a budget join whose two sides are not both the recorded schema", () => {
    const row = { turnBudget: 2, turnsUsed: 1, status: "active" as const };
    const opening = { schema: "campaign-opening/v2" as const, budget: row };
    const terminal = { schema: "campaign-terminal/v2" as const, budget: row };
    expect(joinControllerBudgetEvidence("opening", "terminal", opening, terminal)).toEqual(row);
    // A spend below the opening snapshot is the same run disagreeing with itself.
    expect(() =>
      joinControllerBudgetEvidence("opening", "terminal", opening, {
        ...terminal,
        budget: { ...row, turnsUsed: 0 },
      }),
    ).toThrow(/budget spend is lower than the opening snapshot/);
    expect(() =>
      joinControllerBudgetEvidence("opening", "terminal", opening, { schema: "campaign-terminal/v3" }),
    ).toThrow(/opening and terminal budget evidence versions disagree/);
  });

  it("reads historical rows without creating state and refuses to continue them", () => {
    const root = tmp();
    expect(loadBudget(root)).toEqual({ turnBudget: null, turnsUsed: 0, status: "active" });
    expect(existsSync(join(root, "controller.sqlite"))).toBe(false);
    writeFileSync(
      join(root, "budget.json"),
      JSON.stringify({ turnBudget: 5, turnsUsed: 3, status: "active", decided: true, timeUsedSeconds: 1736 }),
    );
    expect(loadBudget(root).turnsUsed).toBe(3);
    expect(() => campaignBudgetGate(root)).toThrow(/predates the controller ledger/);
    expect(existsSync(join(root, "controller.sqlite"))).toBe(false);
  });

  it("settles one call idempotently and lets the in-flight Builder finish at its cap", () => {
    const root = tmp();
    setTurnBudget(root, 1);
    const first = campaignBudgetGate(root);
    const token = first.startAttempt("builder");
    expect(first.status()).toBe("active");
    expect(loadBudget(root).status).toBe("budget_limited");
    expect(() => campaignBudgetGate(root).startAttempt("builder")).toThrow(CampaignBudgetExhausted);
    token.complete();
    token.complete();
    expect(first.status()).toBe("budget_limited");
    expect(loadBudget(root).turnsUsed).toBe(1);
  });

  it("preserves spend when a cap is raised, lowered or removed", () => {
    const root = tmp();
    for (let i = 0; i < 4; i += 1) campaignBudgetGate(root).startAttempt("builder").complete();
    expect(setTurnBudget(root, 3)).toEqual({ turnBudget: 3, turnsUsed: 4, status: "budget_limited" });
    expect(setTurnBudget(root, 10)).toEqual({ turnBudget: 10, turnsUsed: 4, status: "active" });
    expect(setTurnBudget(root, null)).toEqual({ turnBudget: null, turnsUsed: 4, status: "active" });
  });

  it("refuses damaged historical spend and unresolved leases before creating a counter", () => {
    for (const value of [
      "not json",
      ...[
        { turnBudget: 5, turnsUsed: -1, status: "active" },
        { turnBudget: 5, turnsUsed: 1.5, status: "active" },
        { turnBudget: 1, turnsUsed: 1, status: "active" },
      ].map((row) => JSON.stringify(row)),
    ]) {
      const root = tmp();
      writeFileSync(join(root, "budget.json"), value);
      expect(() => loadBudget(root)).toThrow();
      expect(() => campaignBudgetGate(root)).toThrow();
      expect(existsSync(join(root, "controller.sqlite"))).toBe(false);
      expect(existsSync(join(root, ".budget-attempt.lock"))).toBe(false);
    }
    const root = tmp();
    for (const cap of [0, -1, 1.5, Infinity]) expect(() => setTurnBudget(root, cap)).toThrow(TypeError);
    writeFileSync(join(root, ".budget-attempt.lock"), "unresolved historical call");
    expect(() => setTurnBudget(root, 4)).toThrow(/predates the controller ledger/);
    expect(existsSync(join(root, "controller.sqlite"))).toBe(false);
  });

  it("refuses missing, replaced and corrupted ledgers instead of resetting spend", () => {
    for (const damaged of ["missing-db", "missing-identity", "replaced-db", "corrupt-db"]) {
      const root = tmp();
      setTurnBudget(root, 1);
      campaignBudgetGate(root).startAttempt("builder").complete();
      const path = join(root, damaged === "missing-identity" ? "budget.json" : "controller.sqlite");
      renameSync(path, path + ".saved");
      if (damaged === "corrupt-db") writeFileSync(path, "corrupted database");
      if (damaged === "replaced-db") {
        const other = tmp();
        setTurnBudget(other, 100);
        writeFileSync(path, readFileSync(join(other, "controller.sqlite")));
      }
      expect(() => loadBudget(root)).toThrow();
      expect(() => campaignBudgetGate(root)).toThrow();
    }
  });

  it("keeps a killed started call charged when the campaign enters a new run", async () => {
    const root = tmp();
    setTurnBudget(root, 2);
    const module = new URL("../src/run/provider-resource-budget.ts", import.meta.url).href;
    const child = Bun.spawn({
      cmd: [
        Bun.argv[0]!,
        "--no-env-file",
        "-e",
        "import { ProviderResourceBudget } from " +
          JSON.stringify(module) +
          '; const budget = new ProviderResourceBudget(3, { campaignRoot: Bun.argv.at(-1), runId: "interrupted" }); budget.reserve("builder").beginProviderTurn(); console.log("started"); await Bun.sleep(600000);',
        root,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const output = await child.stdout.getReader().read();
      expect(new TextDecoder().decode(output.value)).toContain("started");
    } finally {
      child.kill("SIGKILL");
      await child.exited;
    }
    using recorded = ControllerLedger.open(root);
    expect(recorded.calls("interrupted")).toMatchObject([
      { role: "builder", state: "started", reported: 0, costUsd: null },
    ]);
    const next = new ProviderResourceBudget(3, { campaignRoot: root, runId: "next-epoch" });
    next.reserve("builder").complete();
    expect(() => next.reserve("builder")).toThrow(CampaignBudgetExhausted);
    expect(next.terminalSnapshot()).toMatchObject({ used: 1, usage: { costUsd: null } });
    expect(loadBudget(root)).toEqual({ turnBudget: 2, turnsUsed: 2, status: "budget_limited" });
  });

  it("serialises independent processes at either quota without overshoot", async () => {
    const module = new URL("../src/run/provider-resource-budget.ts", import.meta.url).href;
    for (const [campaignCap, runCap] of [
      [2, 3],
      [3, 2],
    ] as const) {
      const root = tmp();
      setTurnBudget(root, campaignCap);
      const owner = new ProviderResourceBudget(runCap, { campaignRoot: root, runId: "shared" });
      const children = Array.from({ length: 4 }, () =>
        Bun.spawn({
          cmd: [
            Bun.argv[0]!,
            "--no-env-file",
            "-e",
            "import { ProviderResourceBudget } from " +
              JSON.stringify(module) +
              "; const budget = new ProviderResourceBudget(" +
              runCap +
              ', { campaignRoot: Bun.argv.at(-1), runId: "shared" }); try { const call = budget.reserve("builder"); call.beginProviderTurn(); call.complete(); console.log("admitted"); } catch (error) { if (!["CampaignBudgetExhausted", "ProviderResourceBudgetExhausted"].includes(error.name)) throw error; console.log("refused"); }',
            root,
          ],
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const results = await Promise.all(
        children.map(async (child) => ({
          code: await child.exited,
          out: await new Response(child.stdout).text(),
          err: await new Response(child.stderr).text(),
        })),
      );
      expect(
        results.every((result) => result.code === 0),
        JSON.stringify(results),
      ).toBe(true);
      expect(results.filter((result) => result.out.trim() === "admitted")).toHaveLength(2);
      expect(owner.terminalSnapshot().used).toBe(2);
      expect(loadBudget(root).turnsUsed).toBe(2);
    }
  });
});
