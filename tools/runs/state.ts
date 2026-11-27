/**
 * Where a run stands, one fold that pulse, alerts, the keeper and view share: a process writing its
 * log outranks the log, and with none a keeper outranks the environment's ending and no other.
 */
import { pauseSince } from "#src/campaign/signal.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { endingOf } from "#src/kernel/reports.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { hasText } from "#src/meta/text.ts";
import { type Life, lifeOf, observationOf, stderrTail } from "./diagnosis.ts";
import { lastLaunch } from "./receipt.ts";
import { HERE, type Run, type Running } from "./registry.ts";

interface Wait {
  readonly for: string;
  readonly until: number;
}

/**
 * Where a run stands. A process that writes the log outranks the log, since an ending is its last
 * line before it exits; with none, a keeper outranks no ending or the environment's, since it starts
 * the run again, and an ending of the campaign's own outranks a keeper, which leaves it, so that two
 * keepers of one run do not each read the other's and go on past `budget` or `stop`.
 * A run written on is waiting, quiet or live; one nothing writes is kept, ended or stopped: by a
 * pause where this launch was left one (`pauseSince`), which every reader then says instead of a lost
 * process, so that pulse does not warn that a run paused on purpose has lost its process, and
 * otherwise killed or dead, which the log does not tell apart. A kept run names the environment's
 * ending where its log ends on one, so that `alerts` says it once.
 */
export type RunState =
  | { readonly kind: "live"; readonly kept: boolean }
  | { readonly kind: "waiting"; readonly kept: boolean; readonly wait: Wait }
  | { readonly kind: "quiet"; readonly kept: boolean; readonly since: number }
  | { readonly kind: "kept"; readonly ending?: typeof GOES_ON }
  | { readonly kind: "ended"; readonly ending: string }
  | { readonly kind: "stopped"; readonly pause?: { readonly at: string; readonly why: string } };

/** The one ending a keeper goes on past: the environment's, which a provider's failure or a cut
 *  conversation writes (rule 15). Every other ending is the campaign's own. */
export const GOES_ON = "environment";

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
 */
export function stateOf(events: readonly LogEvent[], life: Life, now: number, launched = 0): RunState {
  if (!life.writing) {
    const ending = endingOf(events);
    if (ending === null) {
      const pause = pauseSince(events, launched);
      if (pause !== undefined) {
        return {
          kind: "stopped",
          pause: { at: pause.at, why: isString(pause.data.why) ? pause.data.why : "a pause" },
        };
      }
    }
    if (life.kept && ending === GOES_ON) return { kind: "kept", ending };
    if (life.kept && ending === null) return { kind: "kept" };
    if (ending !== null) return { kind: "ended", ending };
    return { kind: "stopped" };
  }
  const ends = events.slice(launched).flatMap((event) => waitOf(event)?.until ?? []);
  const at = events.findLastIndex(
    ({ kind, data }) => !kind.endsWith(".call") && !(kind.endsWith(".turn") && data.stopReason === "error"),
  );
  const standing = at >= launched ? events[at] : undefined;
  const wait = standing === undefined ? null : waitOf(standing);
  if (wait !== null && wait.until > now) return { kind: "waiting", kept: life.kept, wait };
  const since = Math.max(Date.parse(events.at(-1)?.at ?? ""), ...ends);
  return now - since > QUIET_MS
    ? { kind: "quiet", kept: life.kept, since }
    : { kind: "live", kept: life.kept };
}

export function launchedIn(run: Run, events: readonly LogEvent[]): number {
  const kept = lastLaunch(run.path);
  const at =
    kept === undefined ? 0 : events.findIndex((event) => Date.parse(event.at) >= Date.parse(kept.at));
  return at === -1 ? events.length : at;
}

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
  if (state.kind === "stopped" && state.pause !== undefined) {
    return [`stopped by a pause left at ${state.pause.at} (${state.pause.why})`];
  }
  const said =
    state.kind === "quiet"
      ? `quiet since ${new Date(state.since).toISOString()}`
      : `process gone without a campaign ending${state.kind === "kept" ? "; its keeper starts it again" : ""}`;
  const remote = run.archived !== undefined && run.archived !== HERE;
  const stderr = remote ? observationOf(run)?.stderr : await stderrTail(run.path);
  return hasText(stderr) ? [said, `newest stderr:\n${stderr}`] : [said];
}
