/**
 * The Referee's session options stay separate because campaign callers import this contract.
 * The session itself belongs to `referee.ts`: the naming pass of 28 October folded its sole-caller
 * wrapper there, keeping the deadline and cancellation on the same session as the ruling tools.
 */
import type { Api, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";

/** Who reads, and on what. */
export interface Reader {
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  /** The backends, built for one session on the home its model process keeps its state in. */
  readonly models: (home: string, shutdown: AbortSignal) => Models;
  /** Seconds one session may run; half an hour when the caller names none. */
  readonly wallSeconds?: number;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}
