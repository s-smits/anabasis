/**
 * One finite provider-turn budget for one controller run.
 *
 * The unit is one paid outer model turn. It is reserved synchronously before the provider call,
 * so concurrent Built and Review callers cannot overshoot the cap. A reservation is spent even
 * after provider entry, even if the turn fails, aborts or never reports usage. Provider token and cost figures are
 * telemetry only: one missing value makes that aggregate unknown instead of measured zero.
 */
import { capturedStructuredClone } from "../meta/json-runtime.ts";
import type { AgentSession, RunTurnOptions, TurnUsage } from "../backends/backend-types.ts";
import { asRecord, isNumber, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { ControllerLedger, CampaignBudgetExhausted } from "./controller-ledger.ts";

const PROVIDER_RESOURCE_ROLES = ["builder", "built", "review"] as const;
type ProviderResourceRole = (typeof PROVIDER_RESOURCE_ROLES)[number];

type UsageField = keyof TurnUsage;

export type ProviderResourceBudgetSnapshot = JsonObject & {
  schema: "provider-resource-budget/v2";
  cap: number;
  used: number;
  /** Reserved turns which have not completed or been released before provider start. */
  active: number;
  byRole: JsonObject & Record<ProviderResourceRole, number>;
  usage: JsonObject &
    TurnUsage & {
      /** Turns for which the provider emitted a usage object, even when one field was null. */
      reportedTurns: number;
      /** Reserved turns with no usage object yet or at settlement. */
      unreportedTurns: number;
    };
};

type JoinedProviderResourceBudget = {
  opening: ProviderResourceBudgetSnapshot;
  terminal: ProviderResourceBudgetSnapshot;
} | null;

const STOP_CAUSES = new WeakSet<Error>();

export interface ProviderTurnReservation {
  /** Close the narrow pre-start release window immediately before entering provider code. */
  beginProviderTurn(): void;
  complete(usage?: TurnUsage): void;
  /** Release only work known not to have reached the provider start boundary. */
  releaseBeforeStart(): void;
}

const invalidSnapshot = (path: string): Error =>
  new Error(`${path}: not a consistent provider-resource-budget snapshot`);

const isSafeCount = (value: unknown, maximum: number): value is number =>
  validNonNegativeInteger(value) && value <= maximum;

/** Validate one recorded projection before an opening/terminal reader joins it. */
export function assertProviderResourceBudgetSnapshot(
  value: unknown,
  path: string,
): ProviderResourceBudgetSnapshot {
  const row = asRecord(value);
  if (row === null || row.schema !== "provider-resource-budget/v2") throw invalidSnapshot(path);
  const { cap, used, active } = row;
  if (
    !isNumber(cap) ||
    !Number.isSafeInteger(cap) ||
    cap < 1 ||
    !isSafeCount(used, cap) ||
    !isSafeCount(active, used)
  ) {
    throw invalidSnapshot(path);
  }
  return {
    schema: "provider-resource-budget/v2",
    cap,
    used,
    active,
    byRole: assertRoleCounts(row.byRole, used, path),
    usage: assertUsage(row.usage, used, path),
  };
}

/** The three role counts must add up to the used total. */
function assertRoleCounts(
  value: unknown,
  used: number,
  path: string,
): ProviderResourceBudgetSnapshot["byRole"] {
  const byRole = asRecord(value);
  if (byRole === null) throw invalidSnapshot(path);
  const { builder, built, review } = byRole;
  if (
    !validNonNegativeInteger(builder) ||
    !validNonNegativeInteger(built) ||
    !validNonNegativeInteger(review) ||
    builder + built + review !== used
  ) {
    throw invalidSnapshot(path);
  }
  return { builder, built, review };
}

/** Usage totals are null while any turn is unreported; reported plus unreported turns equal
 *  the used total. */
function assertUsage(value: unknown, used: number, path: string): ProviderResourceBudgetSnapshot["usage"] {
  const usage = asRecord(value);
  if (usage === null) throw invalidSnapshot(path);
  const { inputTokens, outputTokens, totalTokens, costUsd, reportedTurns, unreportedTurns } = usage;
  const usageValue = (entry: unknown): entry is number | null =>
    entry === null || (isNumber(entry) && Number.isFinite(entry) && entry >= 0);
  if (!usageValue(inputTokens)) throw invalidSnapshot(path);
  if (!usageValue(outputTokens)) throw invalidSnapshot(path);
  if (!usageValue(totalTokens)) throw invalidSnapshot(path);
  if (!usageValue(costUsd)) throw invalidSnapshot(path);
  if (
    !validNonNegativeInteger(reportedTurns) ||
    !validNonNegativeInteger(unreportedTurns) ||
    reportedTurns + unreportedTurns !== used
  ) {
    throw invalidSnapshot(path);
  }
  const hasTotals = inputTokens !== null || outputTokens !== null || totalTokens !== null || costUsd !== null;
  if (unreportedTurns > 0 && hasTotals) throw invalidSnapshot(path);
  return { inputTokens, outputTokens, totalTokens, costUsd, reportedTurns, unreportedTurns };
}

/** Join the immutable opening and terminal projections at the controller evidence boundary. */
export function joinProviderResourceBudgetEvidence(input: {
  openingPath: string;
  terminalPath: string;
  opening: unknown;
  terminal: unknown;
}): JoinedProviderResourceBudget {
  const { openingPath, terminalPath, opening, terminal } = input;
  if ((opening === undefined || opening === null) && (terminal === undefined || terminal === null)) {
    return null;
  }
  if (opening === undefined || opening === null || terminal === undefined || terminal === null) {
    throw new Error(
      `${terminalPath}: provider resource budget is missing from one side of the opening/terminal join`,
    );
  }
  const start = assertProviderResourceBudgetSnapshot(opening, `${openingPath}: providerResourceBudget`);
  const end = assertProviderResourceBudgetSnapshot(terminal, `${terminalPath}: providerResourceBudget`);
  if (start.active !== 0) {
    throw new Error(
      `${openingPath}: provider resource budget has ${String(start.active)} active reservation(s)`,
    );
  }
  if (start.cap !== end.cap || start.used > end.used) {
    throw new Error(`${terminalPath}: provider resource budget cap or used count disagrees with its opening`);
  }
  if (end.active !== 0) {
    throw new Error(
      `${terminalPath}: provider resource budget has ${String(end.active)} active reservation(s)`,
    );
  }
  for (const role of PROVIDER_RESOURCE_ROLES) {
    if (start.byRole[role] > end.byRole[role]) {
      throw new Error(`${terminalPath}: provider resource budget ${role} count moved backwards`);
    }
  }
  return { opening: start, terminal: end };
}

function validNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

export class ProviderResourceBudgetExhausted extends Error {
  readonly kind = "provider-resource-budget-exhausted" as const;

  constructor(
    readonly role: ProviderResourceRole,
    readonly cap: number,
    readonly used: number,
  ) {
    super(`provider resource budget exhausted before ${role} turn (${String(used)}/${String(cap)} used)`);
    this.name = "ProviderResourceBudgetExhausted";
  }
}

/** A normal terminal snapshot closes the budget against accidental post-terminal provider work. */
export class ProviderResourceBudgetClosed extends Error {
  readonly kind = "provider-resource-budget-closed" as const;

  constructor() {
    super("provider resource budget is closed");
    this.name = "ProviderResourceBudgetClosed";
  }
}

/** Preserve controller-owned budget interruption errors through broad operational catches. */
export function isProviderResourceBudgetInterruption(error: unknown): error is Error {
  return (
    error instanceof ProviderResourceBudgetExhausted || (error instanceof Error && STOP_CAUSES.has(error))
  );
}

/** Validate the cap at construction, before any caller can reserve a paid turn. */
export class ProviderResourceBudget {
  private readonly ledger: ControllerLedger;
  readonly runId: string;
  readonly campaignRoot: string | null;
  private terminal: ProviderResourceBudgetSnapshot | null = null;
  private denied: ProviderResourceBudgetExhausted | null = null;
  private stopCause: Error | null = null;
  private closedCause: ProviderResourceBudgetClosed | null = null;
  private readonly idleWaiters = new Set<() => void>();
  private readonly cancellation = new AbortController();

  /** Explicit controller cancellation; ordinary budget refusal lets active turns finish. */
  get cancellationSignal(): AbortSignal {
    return this.cancellation.signal;
  }

  constructor(
    readonly cap: number,
    binding?: { campaignRoot: string; runId: string },
  ) {
    if (!Number.isSafeInteger(cap) || cap < 1) {
      throw new Error(`provider resource budget cap must be a positive safe integer, got ${String(cap)}`);
    }
    this.ledger = ControllerLedger.open(binding?.campaignRoot);
    this.campaignRoot = this.ledger.root;
    this.runId = binding?.runId ?? crypto.randomUUID();
    try {
      this.ledger.openRun(this.runId, cap);
    } catch (error) {
      this.ledger[Symbol.dispose]();
      throw error;
    }
  }

  assertAvailable(role: ProviderResourceRole): void {
    if (this.stopCause !== null) throw this.stopCause;
    if (this.closedCause !== null) throw this.closedCause;
    const { used } = this.snapshot();
    if (used < this.cap) return;
    const error = new ProviderResourceBudgetExhausted(role, this.cap, used);
    this.denied ??= error;
    throw error;
  }

  reserve(role: ProviderResourceRole): ProviderTurnReservation {
    this.assertAvailable(role);
    const admission = this.ledger.reserveCall(this.runId, role);
    if (!admission.ok) {
      if (admission.scope === "campaign") throw new CampaignBudgetExhausted();
      const error = new ProviderResourceBudgetExhausted(role, admission.cap, admission.used);
      this.denied ??= error;
      throw error;
    }
    let settled = false;
    let started = false;
    return {
      beginProviderTurn: () => {
        if (!settled) {
          this.ledger.beginCall(admission.id);
          started = true;
        }
      },
      complete: (usage) => {
        if (settled) return;
        this.ledger.completeCall(admission.id, usage);
        settled = true;
        started = true;
        this.settleActiveReservation();
      },
      releaseBeforeStart: () => {
        if (settled || started) return;
        this.ledger.cancelCall(admission.id);
        settled = true;
        this.settleActiveReservation();
      },
    };
  }

  /** Refuse future admissions with the first controller-supplied typed cause. */
  stopNewReservations(cause: Error): void {
    if (this.stopCause !== null) return;
    this.stopCause = cause;
    STOP_CAUSES.add(cause);
  }

  cancelActiveTurns(cause: Error): void {
    this.stopNewReservations(cause);
    this.cancellation.abort(this.stopCause);
  }

  get activeReservations(): number {
    return this.snapshot().active;
  }

  /** First refused paid call, exposed read-only so shutdown preserves the original stop cause. */
  get deniedCause(): ProviderResourceBudgetExhausted | null {
    return this.denied;
  }

  /** Resolve after every reservation which existed at or before shutdown has settled. */
  waitForIdle(): Promise<void> {
    if (this.activeReservations === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private settleActiveReservation(): void {
    if (this.activeReservations !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  /** A denied reservation is a typed run failure even if a child translated it to a case non-result. */
  throwIfDenied(): void {
    if (this.denied !== null) throw this.denied;
    if (this.stopCause !== null) throw this.stopCause;
  }

  snapshot(): ProviderResourceBudgetSnapshot {
    if (this.terminal !== null) return capturedStructuredClone(this.terminal);
    const calls = this.ledger.calls(this.runId);
    const byRole = { builder: 0, built: 0, review: 0 } satisfies Record<ProviderResourceRole, number>;
    for (const call of calls) byRole[call.role] += 1;
    const reportedTurns = calls.filter((call) => call.reported === 1).length;
    const aggregate = (field: UsageField): number | null => {
      if (calls.length === 0 || calls.some((call) => call[field] === null)) return null;
      return calls.reduce((sum, call) => sum + (call[field] ?? 0), 0);
    };
    return {
      schema: "provider-resource-budget/v2",
      cap: this.cap,
      used: calls.length,
      active: calls.filter((call) => call.state !== "completed").length,
      byRole,
      usage: {
        inputTokens: aggregate("inputTokens"),
        outputTokens: aggregate("outputTokens"),
        totalTokens: aggregate("totalTokens"),
        costUsd: aggregate("costUsd"),
        reportedTurns,
        unreportedTurns: calls.length - reportedTurns,
      },
    };
  }

  /** Close admissions and record the terminal snapshot only after all active calls have settled. */
  terminalSnapshot(): ProviderResourceBudgetSnapshot {
    if (this.closedCause === null) {
      this.closedCause = new ProviderResourceBudgetClosed();
      STOP_CAUSES.add(this.closedCause);
    }
    const snapshot = this.snapshot();
    if (snapshot.active !== 0) {
      throw new Error(
        `provider resource budget cannot close with ${String(snapshot.active)} active reservation(s)`,
      );
    }
    if (this.terminal === null) {
      this.ledger.closeRun(this.runId);
      this.terminal = capturedStructuredClone(snapshot);
      this.ledger[Symbol.dispose]();
    }
    return snapshot;
  }
}

/** Reserve around one backend-neutral session turn and acknowledge any provider-reported usage. */
export async function runBudgetedAgentTurn(
  session: AgentSession,
  options: RunTurnOptions,
  budget: ProviderResourceBudget | undefined,
  role: ProviderResourceRole,
) {
  options.signal?.throwIfAborted();
  const reservation = budget?.reserve(role);
  let usage: TurnUsage | undefined;
  const signal =
    budget === undefined
      ? options.signal
      : options.signal === undefined
        ? budget.cancellationSignal
        : AbortSignal.any([options.signal, budget.cancellationSignal]);
  try {
    reservation?.beginProviderTurn();
    return await session.runTurn({
      ...options,
      ...keyIfDefined("signal", signal),
      onEvent: (event) => {
        if (event.type === "turn_ended" || event.type === "turn_failed") usage ??= event.usage;
        options.onEvent?.(event);
      },
    });
  } finally {
    reservation?.complete(usage);
  }
}
