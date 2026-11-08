/**
 * Where a run stands, one fold that pulse, alerts, the keeper and view share: a process writing its
 * log outranks the log, and with none a keeper outranks the ending.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { type Life, lifeOf, observationOf, stderrTail } from "./diagnosis.ts";
import { lastLaunch } from "./receipt.ts";
import { HERE, type Run, type Running } from "./registry.ts";

/** A wait a run's process stands in, what for and until when. */
interface Wait {
  readonly for: string;
  readonly until: number;
}

/**
 * Where a run stands. A process that writes the log outranks the log, since an ending is its last
 * line before it exits; with none, a keeper outranks the ending, since it starts the run again.
 * A run written on is waiting, quiet or live; one nothing writes is kept, ended or stopped (paused,
 * killed or dead, which the log does not tell apart).
 */
export type RunState =
  | { readonly kind: "live"; readonly kept: boolean }
  | { readonly kind: "waiting"; readonly kept: boolean; readonly wait: Wait }
  | { readonly kind: "quiet"; readonly kept: boolean; readonly since: number }
  | { readonly kind: "kept" }
  | { readonly kind: "ended"; readonly ending: string }
  | { readonly kind: "stopped" };

/** How long a run written on may go without an event before it reads quiet. */
const QUIET_MS = 20 * 60_000;
/** How long a wait that names no end stands: none is written, and one must not hold a run for good. */
const WAIT_BOUND_MS = 60 * 60_000;

/** The wait `event` records, ending at its reset, after its length from when it was recorded, or
 *  at the bound. A load wait is recorded once it is over, so it names no `for` and is none. */
function waitOf({ at, kind, data }: LogEvent): Wait | null {
  if (kind !== "campaign.waited" || !isString(data.for)) return null;
  const until = isString(data.until)
    ? Date.parse(data.until)
    : Date.parse(at) + (isNumber(data.ms) ? data.ms : WAIT_BOUND_MS);
  return { for: data.for, until };
}

/**
 * Where a run whose log is `events` stands at `now`, given its `life` and the index of its current
 * launch's first event. A wait stands through calls and failed turns, since a seat that runs on
 * after a wait is recorded writes its call and its failed turn, and any other event ends it. Quiet
 * counts from the last event or the end of a wait of this launch, whichever is later.
 *
 * Until 9 November pulse, view, alerts and the keeper each read this their own way: the keeper took a
 * wait from before the current launch, so it could move a run it had just moved again; view called a
 * finished load wait current; and two readers held their own `QUIET_MS`.
 */
export function stateOf(events: readonly LogEvent[], life: Life, now: number, launched = 0): RunState {
  const last = events.at(-1);
  if (!life.writing) {
    if (life.kept) return { kind: "kept" };
    return last?.kind === "campaign.ended" && isString(last.data.ending)
      ? { kind: "ended", ending: last.data.ending }
      : { kind: "stopped" };
  }
  const ends = events.slice(launched).flatMap((event) => waitOf(event)?.until ?? []);
  const at = events.findLastIndex(
    ({ kind, data }) => !kind.endsWith(".call") && !(kind.endsWith(".turn") && data.stopReason === "error"),
  );
  const standing = at >= launched ? events[at] : undefined;
  const wait = standing === undefined ? null : waitOf(standing);
  if (wait !== null && wait.until > now) return { kind: "waiting", kept: life.kept, wait };
  const since = Math.max(Date.parse(last?.at ?? ""), ...ends);
  return now - since > QUIET_MS
    ? { kind: "quiet", kept: life.kept, since }
    : { kind: "live", kept: life.kept };
}

/** The index of the first event of `run`'s current launch, by its newest receipt. */
export function launchedIn(run: Run, events: readonly LogEvent[]): number {
  const kept = lastLaunch(run.path);
  const at =
    kept === undefined ? 0 : events.findIndex((event) => Date.parse(event.at) >= Date.parse(kept.at));
  return at === -1 ? events.length : at;
}

/** Where `run`, whose log is `events`, stands at `now` among the processes `running`. */
export const runState = (
  run: Run,
  events: readonly LogEvent[],
  running: readonly Running[],
  now = Date.now(),
): RunState => stateOf(events, lifeOf(run, running), now, launchedIn(run, events));

/** What a reader says of a run that stands as `state`, with the newest stderr of one nothing writes
 *  or that is quiet. */
export async function runReason(run: Run, state: RunState): Promise<string[]> {
  if (state.kind === "waiting") {
    return [`waiting for ${state.wait.for} until ${new Date(state.wait.until).toISOString()}`];
  }
  if (state.kind === "live" || state.kind === "ended") return [];
  const said =
    state.kind === "quiet"
      ? `quiet since ${new Date(state.since).toISOString()}`
      : `process gone without a campaign ending${state.kind === "kept" ? "; its keeper starts it again" : ""}`;
  const remote = run.archived !== undefined && run.archived !== HERE;
  const stderr = remote ? observationOf(run)?.stderr : await stderrTail(run.path);
  return (stderr ?? "") === "" ? [said] : [said, `newest stderr:\n${String(stderr)}`];
}
