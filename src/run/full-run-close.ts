import { fullrunLine } from "../observe/run-observer.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import {
  type BuilderExecutionInvocation,
  closeOpenBuilderExecutionRecords,
} from "./builder-execution-closure.ts";
import {
  type ControllerRunState,
  prepareControllerTerminal,
  writeControllerTerminal,
} from "./controller-evidence.ts";
import type { FullRunLaunch } from "./full-run-launch.ts";
import { VerifierOperationalStop } from "../verify/verifier-lifetime.ts";

/**
 * Close the authoring records this run left open.
 *
 * A Builder session writes `in-flight` first and settles the same record when it returns. A session
 * that never returns — the host killed it, its provider stopped mid-turn — leaves that snapshot as
 * the final state, so its record still reads `in-flight` long after the campaign has stopped. The
 * controller knows the invocation closed, so it says so here.
 *
 * The invocation comes straight from the terminal write this run has just made, so the records
 * name the exact run and the exact closing time. Scanning controller state again instead selects
 * whichever opening it finds, which can be an abandoned sibling, and then these records stay open.
 */
function closeOpenAuthoringRecords(
  repoRoot: string,
  projectId: string,
  invocation: BuilderExecutionInvocation,
): void {
  try {
    closeOpenBuilderExecutionRecords(campaignDir(repoRoot, projectId), invocation);
  } catch {
    // The terminal is already written and owns the run's outcome; a failure to close another
    // owner's records must not replace it. The reader reports a surviving `in-flight` record.
  }
}

/** Record the controller ending and release its campaign lock even when writing fails. */
export function closeControllerRun(
  repoRoot: string,
  launch: FullRunLaunch,
  state: ControllerRunState,
  cause: unknown,
): void {
  let finalRecord: ReturnType<typeof prepareControllerTerminal> | null = null;
  const pending = state.verifierLifetime?.pendingReceipts() ?? [];
  const failure =
    cause ?? (pending.length > 0 ? new VerifierOperationalStop("unsettled-children", pending) : null);
  try {
    // A run that died before any round opened it has a reason and nowhere to put it: a terminal is
    // only prepared beside an opening. Opening it here is what gives that reason somewhere to go,
    // and before this every such abort left the run unrecorded.
    try {
      state.openIfUnopened?.();
    } catch {
      // The opening is best effort at this point: the run is already ending, and the cause below
      // is the fact worth keeping. A campaign that cannot be opened keeps the older behaviour —
      // an unrecorded run whose reason survives only on stderr.
    }
    if (state.opening !== null) {
      finalRecord = prepareControllerTerminal({
        repoRoot,
        projectId: launch.project.id,
        opening: state.opening,
        iterations: state.iterations,
        absentSteps: state.absentSteps,
        failure,
        ...keyIfDefined(
          "verifierCleanup",
          pending.length > 0
            ? { state: "pending" as const, receiptIds: pending }
            : state.verifierSettled === true
              ? { state: "complete" as const }
              : undefined,
        ),
        ...keyIfDefined("providerBudget", state.providerBudget ?? undefined),
        ...keyIfDefined("readClimb", state.readClimb),
      });
    }
  } finally {
    try {
      if (finalRecord !== null) {
        const closedAt = writeControllerTerminal(finalRecord, {
          token: launch.campaignLockToken,
          ownedAtRecord: launch.ownsLock(),
        });
        const runId = state.opening?.runId;
        if (runId !== undefined) closeOpenAuthoringRecords(repoRoot, launch.project.id, { runId, closedAt });
        const d = finalRecord.denominator;
        const close =
          finalRecord.outcome === "completed" ? "closed normally" : "closed after an interruption";
        fullrunLine(
          `${launch.project.id}: run ${state.opening?.runId ?? "?"} ${close}. Result: ${finalRecord.terminalReason}. Last iteration: ${finalRecord.iterations.at(-1)?.runId ?? "none"}. Cases: ${
            d.state === "recorded"
              ? `${d.verified} verified / ${d.unaccepted} had no accepted answer / ${d.nonResults} could not run / ${d.total} total`
              : d.state.replaceAll("-", " ")
          }. Evidence: ${finalRecord.path}`,
        );
      }
    } finally {
      launch.release();
    }
  }
}
