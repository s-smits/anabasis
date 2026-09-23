/** Reserve Builder calls and classify known provider and transport failures. */
import type { TurnUsage } from "../backends/backend-types.ts";
import { runtimeNonResultReason } from "../truth/runtime-blocker.ts";
import type { ModelAttemptGate } from "../run/campaign-budget.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { errorMessage } from "../meta/runtime-values.ts";

/** Reserve one model call against the campaign budget. If the shared classifier recognises a
 * thrown transport failure, return it to the caller as a typed turn non-result. */
export async function runModelAttempt<T>(
  gate: ModelAttemptGate | undefined,
  role: "builder",
  operation: () => Promise<T>,
  providerBudget?: ProviderResourceBudget,
  reportedUsage?: () => TurnUsage | undefined,
): Promise<T> {
  if (
    providerBudget !== undefined &&
    gate !== undefined &&
    providerBudget.campaignRoot !== gate.campaignRoot
  ) {
    throw new Error("Builder campaign and provider quotas must belong to the same controller ledger");
  }
  const reservation = providerBudget === undefined ? gate?.startAttempt(role) : providerBudget.reserve(role);
  try {
    reservation?.beginProviderTurn();
    return await operation();
  } catch (error) {
    if (error instanceof BuildAgentTurnNonResult) throw error;
    // A transport fatal thrown rather than settled as a failed turn — a codex thread-open refusal
    // is the usual one — passes every classifier by and records a bare abort that belongs to
    // nobody. The rule is the same one openBuildSession applies: a recognised transport failure
    // becomes the typed non-result, while code and configuration errors still throw unchanged,
    // because those are defects here rather than in the environment.
    const message = errorMessage(error);
    if (runtimeNonResultReason([message]) === null) throw error;
    throw new BuildAgentTurnNonResult(role, "failed", [message]);
  } finally {
    let usage: TurnUsage | undefined;
    try {
      usage = reportedUsage?.();
    } finally {
      // Usage is telemetry, so a reporter failure must not strand an active paid reservation.
      reservation?.complete(usage);
    }
  }
}

/** A provider or runtime failure with no candidate text. The outer classifier determines its cause. */
export class BuildAgentTurnNonResult extends Error {
  readonly kind = "turn-non-result" as const;

  constructor(
    readonly role: "builder",
    readonly status: "failed" | "aborted",
    readonly errorMessages: readonly string[],
    readonly turns = 1,
  ) {
    super(
      `build agent turn ${status} (role ${role}): ${errorMessages.join("; ") || "no error recorded"} — turn produced no build output; owner adjudicated by the outer classifier`,
    );
    this.name = "BuildAgentTurnNonResult";
  }
}

/** Session construction is part of the attempted author call, not a step before it: a recognised
 *  transport failure raised before `runTurn` is reached still leaves the round with no candidate,
 *  so it travels the same non-result path and stays available for later classification. Programming
 *  and configuration errors are rethrown unchanged. */
export async function openBuildSession<T>(open: () => Promise<T>): Promise<T> {
  try {
    return await open();
  } catch (error) {
    if (error instanceof BuildAgentTurnNonResult) throw error;
    const message = errorMessage(error);
    if (runtimeNonResultReason([message]) !== null) {
      throw new BuildAgentTurnNonResult("builder", "failed", [message]);
    }
    throw error;
  }
}
