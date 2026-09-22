/** Pi usage at the Built Harness's one-outer-prompt turn boundary. */
import type { Usage } from "@earendil-works/pi-ai";
import type { TurnUsage } from "./backend-types.ts";

interface PiUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function addPiUsageToTotals(totals: PiUsageTotals, usage: Usage): void {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
}

export function piTurnUsage(records: readonly Usage[]): TurnUsage | undefined {
  if (!records.some((usage) => usage.totalTokens !== 0)) return undefined;
  // Mirrors pi-mono packages/coding-agent/src/core/usage-totals.ts. The harness only adds
  // the outer Agent.prompt boundary; it does not maintain a second token-counting rule.
  const totals: PiUsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const usage of records) addPiUsageToTotals(totals, usage);
  return {
    inputTokens: totals.input + totals.cacheRead + totals.cacheWrite,
    outputTokens: totals.output,
    totalTokens: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
    costUsd: totals.cost,
  };
}
