/** Close one controller run: handle stop signals, wait for provider calls and record the terminal. */

import { runtimeProcess } from "../meta/process.ts";
import { ControllerSignalAbort } from "./controller-abort-clause.ts";
import { asError } from "../meta/runtime-values.ts";

interface ProviderReservationBoundary {
  readonly activeReservations: number;
  readonly deniedCause?: Error | null;
  stopNewReservations(cause: Error): void;
  cancelActiveTurns(cause: Error): void;
  waitForIdle(): Promise<void>;
}

type RecordTerminal = (cause: unknown) => void;
type ClosingSignal = "SIGTERM" | "SIGINT";
const CLOSING_SIGNALS: readonly ClosingSignal[] = ["SIGTERM", "SIGINT"];

function installSignalHandlers(action: (signal: ClosingSignal) => void): () => void {
  const installed = CLOSING_SIGNALS.map((signal) => {
    const handler = (): void => action(signal);
    runtimeProcess.on(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of installed) {
      // SAFETY: Bun supports process signals; the local runtime type omits this inherited overload.
      runtimeProcess.removeListener(signal as never, handler);
    }
  };
}

/** Coordinate stop signals, completion of provider calls and terminal recording. */
export class FullRunClosure {
  private primaryCause: Error | null = null;
  private requestedStopCause: Error | null = null;
  private ownedSettlement: Promise<void> | undefined;
  private closed = false;
  private interruptSeen = false;
  private uninstallSignals: () => void = () => {};

  constructor(
    private readonly provider: ProviderReservationBoundary | undefined,
    private readonly recordTerminal: RecordTerminal,
    private readonly settleOwned?: () => Promise<void>,
  ) {}

  install(): void {
    const uninstallSignals = installSignalHandlers((signal) => this.onSignal(signal));
    const atExit = (): void => this.closeAtExit();
    // SAFETY: Bun supports the process `exit` event; the local runtime type omits this overload.
    runtimeProcess.on("exit" as never, atExit);
    this.uninstallSignals = () => {
      uninstallSignals();
      // SAFETY: same overload as the registration above.
      runtimeProcess.removeListener("exit" as never, atExit);
    };
  }

  readonly stopRequested = (): Error | null => this.requestedStopCause;

  /**
   * Settle the provider, then record the terminal — even when settlement itself fails.
   *
   * The active-reservation check used to throw before `close()`. If calls remained active, the
   * controller never reached `closeControllerRun`, leaving no terminal and retaining its lock.
   * Terminal recording now runs in `finally`; signal handlers are removed afterwards, so a
   * SIGTERM during cleanup is still handled instead of ending the process immediately.
   */
  async settleAndClose(cause: unknown): Promise<void> {
    if (this.closed) return;
    this.rememberPrimaryCause(cause);
    try {
      this.provider?.stopNewReservations(
        cause instanceof Error
          ? cause
          : new Error("fullrun is closing; no new provider reservations are admitted"),
      );
      try {
        await this.settleVerifier();
      } catch (settlement) {
        this.rememberPrimaryCause(settlement);
      }
      if (this.provider !== undefined) {
        await this.provider.waitForIdle();
        if (this.provider.activeReservations > 0) {
          throw new Error("provider reservations remained active after run settlement");
        }
      }
      if (cause == null && this.primaryCause !== null) throw this.primaryCause;
    } catch (settlement) {
      // Record a settlement failure if no earlier failure exists. Previously, finally used the
      // original cause, which was null on a successful path, and recorded `completed` even with
      // active reservations. A retry then did nothing because this.closed was already true.
      // rememberPrimaryCause preserves the first non-null cause throughout cleanup.
      this.rememberPrimaryCause(settlement);
      throw this.primaryCause ?? settlement;
    } finally {
      try {
        this.close(cause);
      } finally {
        this.uninstallSignals();
      }
    }
  }

  /**
   * Last chance at process exit. Every ordinary path records through `settleAndClose`; this covers
   * the ones that do not reach it — an exception escaping the signal handler, a rejection that
   * unwinds past the loop's own catch. It cannot cover SIGKILL, which runs no handler at all; the
   * reader's dead-process witness on an opening without a terminal owns that case.
   *
   * An exit handler must not throw, so a failed terminal write here is swallowed: the run is already ending
   * and a thrown error would replace the exit status the caller chose.
   */
  private closeAtExit(): void {
    try {
      this.close(new Error("fullrun exited without recording its controller terminal"));
    } catch {
      // Best effort: a terminal that cannot be written leaves the opening for the dead-process witness.
    }
  }

  private requestStop(cause: Error): void {
    this.requestedStopCause ??= cause;
    this.rememberPrimaryCause(cause);
    this.provider?.stopNewReservations(cause);
    this.provider?.cancelActiveTurns(cause);
  }

  private settleVerifier(): Promise<void> {
    return (this.ownedSettlement ??= Promise.resolve().then(() => this.settleOwned?.()));
  }

  private rememberPrimaryCause(cause: unknown): void {
    if (this.primaryCause !== null || cause === null || cause === undefined) return;
    this.primaryCause = asError(cause);
  }

  private onSignal(signal: ClosingSignal): void {
    // The first Ctrl-C asks every owned child to stop and preserves its terminal evidence. If
    // that settlement stalls, a later Ctrl-C must still let the operator end the controller.
    // Removing only this closure's handlers preserves any embedding runtime's own signal policy.
    if (signal === "SIGINT" && this.interruptSeen) {
      this.uninstallSignals();
      runtimeProcess.kill(runtimeProcess.pid, signal);
      return;
    }
    if (signal === "SIGINT") this.interruptSeen = true;
    // The first shutdown request owns the terminal classification: a provider denial that already
    // stopped the run keeps its cause when the operator's signal arrives during cleanup.
    const providerDenial = this.requestedStopCause === null ? (this.provider?.deniedCause ?? null) : null;
    if (providerDenial !== null) this.requestStop(providerDenial);
    this.requestStop(new ControllerSignalAbort(signal));
    // A verifier may be alive with no provider reservation. Stop it now; the run loop's
    // ordinary unwind still owns terminal publication and awaits this same settlement.
    void this.settleVerifier().catch((cause: unknown) => this.rememberPrimaryCause(cause));
  }

  private close(cause: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.recordTerminal(this.primaryCause ?? cause);
  }
}
