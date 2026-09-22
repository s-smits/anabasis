/** The campaign quota is a projection of the same ledger that admits provider calls. */
import { existsSync, mkdirSync, realpathSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { isFunction } from "../meta/json-shape.ts";
import type { TurnUsage } from "../backends/backend-types.ts";
import {
  ControllerLedger,
  CampaignBudgetExhausted,
  assertCampaignBudget,
  controllerLedgerPath,
  type CampaignBudget,
  type BudgetStatus,
} from "./controller-ledger.ts";
import { readJsonFile } from "../meta/completed-json.ts";

export { CampaignBudgetExhausted, assertCampaignBudget } from "./controller-ledger.ts";
export type { CampaignBudget, BudgetStatus } from "./controller-ledger.ts";

interface ModelAttemptToken {
  beginProviderTurn(): void;
  complete(usage?: TurnUsage): void;
}
export interface ModelAttemptGate {
  readonly campaignRoot: string;
  startAttempt(role: "builder"): ModelAttemptToken;
  assertAttemptAvailable(): void;
}
export interface CampaignBudgetGate {
  status(): BudgetStatus;
}
export interface SavedCampaignBudgetGate extends CampaignBudgetGate, ModelAttemptGate {}
/** Historical reports remain readable without creating or changing controller state. */
export function loadBudget(root: string): CampaignBudget {
  if (existsSync(controllerLedgerPath(root))) {
    using ledger = ControllerLedger.open(root);
    return ledger.campaignBudget();
  }
  const path = join(root, "budget.json");
  return existsSync(path)
    ? assertCampaignBudget(readJsonFile(path), path)
    : { turnBudget: null, turnsUsed: 0, status: "active" };
}

export function setTurnBudget(root: string, cap: number | null): CampaignBudget {
  if (cap !== null && (!Number.isSafeInteger(cap) || cap < 1)) {
    throw new TypeError("turnBudget must be a positive safe integer or null");
  }
  using ledger = ControllerLedger.open(root);
  return ledger.setCampaignCap(cap);
}

export class CampaignBudgetConfigurationError extends Error {
  constructor() {
    super("a campaign budget requires its bound startAttempt and assertAttemptAvailable methods");
    this.name = "CampaignBudgetConfigurationError";
  }
}

/** Refuse an incomplete injected budget before it can silently omit the durable quota. */
export function campaignAttemptGate(
  budget: CampaignBudgetGate | undefined,
): SavedCampaignBudgetGate | undefined {
  if (budget === undefined) return undefined;
  // SAFETY: the canonical methods are checked before the caller receives the spend port.
  const gate = budget as Partial<SavedCampaignBudgetGate>;
  if (
    !isFunction(gate.startAttempt) ||
    !isFunction(gate.assertAttemptAvailable) ||
    gate.campaignRoot === undefined
  ) {
    throw new CampaignBudgetConfigurationError();
  }
  // SAFETY: the guard proved the complete campaign call port.
  return gate as SavedCampaignBudgetGate;
}

/** Direct build callers have no finite run quota; their calls still use the one reservation table. */
export function campaignBudgetGate(root: string, providerRunId?: string): SavedCampaignBudgetGate {
  mkdirSync(root, { recursive: true });
  const campaignRoot = realpathSync(root);
  const runId = providerRunId ?? `authoring-${crypto.randomUUID()}`;
  using initial = ControllerLedger.open(campaignRoot);
  if (providerRunId === undefined) initial.openRun(runId, null);
  else initial.run(runId);
  return {
    campaignRoot,
    status: () => {
      using ledger = ControllerLedger.open(campaignRoot);
      const inFlight = ledger
        .calls(runId)
        .some((call) => call.role === "builder" && call.state !== "completed");
      return inFlight ? "active" : ledger.campaignBudget().status;
    },
    assertAttemptAvailable: () => {
      using ledger = ControllerLedger.open(campaignRoot);
      ledger.campaignBudget();
    },
    startAttempt: () => {
      using ledger = ControllerLedger.open(campaignRoot);
      const admission = ledger.reserveCall(runId, "builder");
      if (!admission.ok) throw new CampaignBudgetExhausted();
      return {
        beginProviderTurn: () => {
          using current = ControllerLedger.open(campaignRoot);
          current.beginCall(admission.id);
        },
        complete: (usage) => {
          using current = ControllerLedger.open(campaignRoot);
          current.completeCall(admission.id, usage);
        },
      };
    },
  };
}
