import { isString, type JsonValue } from "../meta/json-shape.ts";

/**
 * The closed set of typed abort owners a controller terminal may record.
 *
 * Every abort carries one, so no reader infers the owner from prose; an abort without a known owner
 * gets `controller-unclassified` beside its reason string. A terminal recording an abort under no
 * clause or a retired one is refused.
 */
const CONTROLLER_ABORT_CLAUSES = [
  "environment-blocked",
  "budget-limited",
  "signal-terminated",
  "host-storage-exhausted",
  "controller-unclassified",
] as const;

export type ControllerAbortClause = (typeof CONTROLLER_ABORT_CLAUSES)[number];

export type SavedStopClause = {
  /** Null exactly on a completed run. */
  clause: ControllerAbortClause | null;
  reason: string;
};

type SavedStopTerminal = {
  outcome?: JsonValue;
  terminalReason?: JsonValue;
  abortClause?: JsonValue;
};

function isControllerAbortClause(value: JsonValue | undefined): value is ControllerAbortClause {
  return isString(value) && CONTROLLER_ABORT_CLAUSES.some((clause) => clause === value);
}

/**
 * Validate the typed stop owner and the human reason at the recorded terminal boundary. An abort's
 * reason leads with its own clause, so `loopTerminalCode` resolves the two clauses that are also
 * terminal codes (`environment-blocked`, `budget-limited`) straight off a recorded terminal.
 */
export function savedStopClause(
  terminalPath: string,
  terminal: SavedStopTerminal,
  expectedReason: string,
): SavedStopClause {
  const clause = terminal.abortClause;
  const reason = terminal.terminalReason;
  if (terminal.outcome === "completed" && clause === null && reason === expectedReason) {
    return { clause: null, reason };
  }
  if (
    terminal.outcome === "aborted" &&
    isControllerAbortClause(clause) &&
    isString(reason) &&
    reason.startsWith(`${clause}: `)
  ) {
    return { clause, reason };
  }
  throw new Error(`${terminalPath}: outcome, terminalReason and abortClause disagree`);
}
