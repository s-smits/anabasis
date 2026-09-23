/**
 * Who owns a controller abort.
 *
 * `prepareControllerTerminal` used to name an owner for five error classes and record `null` for
 * everything else. An abort that names nobody costs the reader the owner: the review re-derives it
 * from the free-text reason, and the abort-repeat safeguard reports "no ownership category". Every
 * abort now carries a clause, and the classifier is defined for every input, with
 * `controller-unclassified` as its fallback, so a new failure without a specific mapping stays
 * visible as an unclassified abort instead of becoming null.
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
 * A signal ended the run. Typed so the terminal records `signal-terminated` instead of the plain
 * `Error("fullrun received SIGTERM")` the closure used to raise, which reached the clause map as
 * an unrecognised failure and recorded no owner at all. A wall expiry keeps its own clause: the
 * deadline evidence, not this class, decides that one.
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
