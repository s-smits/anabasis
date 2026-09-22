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
    // esp32 -4/-5: the codex thread-open fatal was thrown rather than settled as a failed turn,
    // so it skipped every classifier and recorded a bare abort. Same rule as openBuildSession: a
    // recognised transport failure becomes the typed non-result; code and configuration errors
    // still throw unchanged.
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

/** Session construction is part of the attempted author call. A recognised transport failure
 * before `runTurn` still produces no candidate, so record it through the same non-result path
 * for later classification. Programming and configuration errors are rethrown unchanged. */
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
