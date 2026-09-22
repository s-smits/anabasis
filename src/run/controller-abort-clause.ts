/**
 * Who owns a controller abort.
 *
 * Every abort carries a clause, so no reader derives the owner from prose. The classifier is total:
 * a failure without a specific mapping records `controller-unclassified` rather than null.
 *
 * The clause is the owner, never the diagnosis: the failure's own message is recorded beside it in
 * `terminalReason`.
 */
import { BuildAgentTurnNonResult } from "../author/build-agent.ts";
import { EnvironmentRefusal } from "../backends/environment-refusal.ts";
import { RUNTIME_NON_RESULT_MESSAGE } from "../truth/runtime-blocker.ts";
import { errorCode } from "../meta/runtime-values.ts";
import { CampaignBudgetExhausted } from "./campaign-budget.ts";
import { ProviderResourceBudgetExhausted } from "./provider-resource-budget.ts";
import type { ControllerAbortClause } from "./controller-stop-evidence.ts";
import { VerifierOperationalStop } from "../verify/verifier-lifetime.ts";

/** Filesystem codes that mean the host, not the product, could not store the run's evidence. */
const STORAGE_ERROR_CODES = new Set(["ENOSPC", "EDQUOT", "EFBIG", "EROFS"]);

/**
 * A signal ended the run; typed so the terminal records `signal-terminated`. A wall expiry keeps
 * its own clause, decided by the deadline evidence rather than this class.
 */
export class ControllerSignalAbort extends Error {
  readonly kind = "controller-signal-abort" as const;

  constructor(readonly signal: string) {
    super(`fullrun received ${signal}`);
    this.name = "ControllerSignalAbort";
  }
}

/** The environment classes the backends already raise for a provider, credential or sandbox stop. */
function isTypedEnvironmentFailure(failure: unknown): boolean {
  return (
    failure instanceof BuildAgentTurnNonResult ||
    failure instanceof EnvironmentRefusal ||
    failure instanceof VerifierOperationalStop
  );
}

/**
 * The typed owner for one aborted controller run. Order is precedence: a budget stop names its
 * budget even when its message would also match the environment matcher.
 */
export function controllerAbortClause(failure: unknown): ControllerAbortClause {
  if (failure instanceof ProviderResourceBudgetExhausted || failure instanceof CampaignBudgetExhausted) {
    return "budget-limited";
  }
  if (isTypedEnvironmentFailure(failure)) return "environment-blocked";
  if (failure instanceof ControllerSignalAbort) return "signal-terminated";
  const code = errorCode(failure);
  if (code !== undefined && STORAGE_ERROR_CODES.has(code)) return "host-storage-exhausted";
  // A provider, transport or credential message recognised by the shared classifier. Reusing
  // `RUNTIME_NON_RESULT_MESSAGE` keeps environment detection consistent: provider timeouts, 429 and
  // overload capacity refusals, catalogue and login failures all reach the controller as plain
  // errors when they are raised outside a Builder turn wrapper, and the per-case classifier already
  // names exactly those.
  const environmentMessage = failure instanceof Error && RUNTIME_NON_RESULT_MESSAGE.test(failure.message);
  return environmentMessage ? "environment-blocked" : "controller-unclassified";
}
