/** Terminal codes for the controller loop and their meaning to callers. The CLI uses them
 *  for exit status, and launchers can read them from recorded terminals. Keep that interpretation
 *  separate from full-run-round.ts, which decides when a round should end.
 *  This module recognises those decisions without making another one. */
import type { CampaignClause } from "../author/campaign-types.ts";

/**
 * The terminal codes callers recognise. A reason starts with a code, optionally followed by a
 * colon and prose describing the round's evidence. Readers that act on an ending, including the
 * CLI's exit-status handler, use the code so editing the explanation does not change behaviour.
 * Only `completed` says the run settled the question it was launched to
 * answer; `stopped` preserves the deciding reason but still stopped short of success.
 */
const LOOP_TERMINAL_CODES = [
  "completed",
  "stopped",
  "fixed-product-boundary",
  "build-failed",
  "candidate-held",
  "budget-limited",
  "environment-blocked",
  "operator-interrupted",
] as const;

export type LoopTerminalCode = (typeof LOOP_TERMINAL_CODES)[number];

/** Why a round's build step ended without a candidate to measure: a refused campaign's one clause,
 *  a candidate identical to its round's entry tree, or a move the fixed-product policy refuses. */
export type BuildClause = CampaignClause | "candidate-unchanged" | "fixed-product-boundary";

/** The terminal each build clause ends the run with. Null lets the round retry within the shared
 *  unresolved-authoring allowance, because a Builder session is stochastic and one bad round is
 *  not a verdict on the product; a clause whose next round would fail the same way ends at once. */
export const CLAUSE_ENDINGS = {
  "campaign-binding-mismatch": "build-failed",
  "improvement-memory-missing": "build-failed",
  "authoring-stalled": "build-failed",
  "environment-blocked": "environment-blocked",
  "budget-limited": "budget-limited",
  "fixed-product-boundary": "fixed-product-boundary",
  "iterations-exhausted": null,
  "no-progress": null,
  "candidate-unchanged": null,
} as const satisfies Record<BuildClause, LoopTerminalCode | null>;

/** Whether a recorded string names a build clause, for readers of recorded iteration rows. */
export function isBuildClause(value: string): value is BuildClause {
  return Object.hasOwn(CLAUSE_ENDINGS, value);
}

/** The code a terminal string carries, or null when it carries none — an unrecognised ending is
 *  not silently read as a success. */
export function loopTerminalCode(terminal: string | null): LoopTerminalCode | null {
  if (terminal === null) return null;
  const head = terminal.split(":", 1)[0];
  return LOOP_TERMINAL_CODES.find((code) => code === head) ?? null;
}

/**
 * The process status for an ending, so a caller can act on it without parsing prose.
 *
 * Zero means the run settled the question it was launched to answer: only `completed` does. One
 * means it did not, and an ending no code names is never read as
 * a success. Two is reserved for an abort, which never reaches here.
 *
 * `operator-interrupted` gets status 3. The operator may have asked for N rounds and received
 * exactly N, while the campaign's question remains unresolved. A zero would let
 * `fullrun --max-iterations 3 && deploy` deploy after an unfinished campaign. Status 1 would
 * make an ordinary `--max-iterations 1` rehearsal indistinguishable from a failed run.
 * The separate code stops the command chain while allowing a rehearsal script to accept it
 * on purpose. The round cap only reaches here when it caused the ending: full-run.ts reads the
 * loop's own terminal first, so a run that completes on its last permitted round keeps its zero.
 */
export function fullRunExitStatus(terminal: string | null): 0 | 1 | 3 {
  const code = loopTerminalCode(terminal);
  if (code === "completed") return 0;
  return code === "operator-interrupted" ? 3 : 1;
}
