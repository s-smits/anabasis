/**
 * What a campaign waits for, each through one host (`Host`) so a test can count its sleeps: the
 * load before a solve (a solve's deadline is elapsed time, so it starts once the one-minute load is
 * at or under the cores, or after `LOOKS` looks; `--loaded` says the times will not be compared);
 * the reserve beside solves in flight (`affords`); the solve slots every seat shares; a pause's
 * word (`PAUSE`, `src/campaign/word.ts`), so `runs pause` lets open solves finish; a provider's
 * named reset, slept out rather than read as a crash (`waitOut`, `src/solver/run.ts`); and a
 * network that failed a session, a minute after the first crash and five after the second
 * (`waitCrashed`). A refusal the provider's own API writes gets no wait.
 */
import { CRASHES_IN_A_ROW } from "#src/campaign/decide.ts";
import { crashedRun } from "#src/campaign/ground.ts";
import { affords, flying, inFlight } from "#src/campaign/opening.ts";
import { PAUSE, paused } from "#src/campaign/word.ts";
import { append, eachEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { waiting, waitOut } from "#src/solver/run.ts";
import { type Seated, solved } from "./round.ts";

/** `HOST` sleeps on `waiting`'s own timer, which a cancellation clears, where `Bun.sleep` would
 *  hold the process after a cancelled wait until it ran out. */
export interface Host {
  readonly load: () => number;
  readonly cores: number;
  readonly waitMs: number;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
}

interface Queue {
  readonly seated: Seated;
  readonly host?: Host | undefined;
  readonly loaded: boolean;
}

export const HOST: Host = {
  load: () => loadavg()[0] ?? 0,
  cores: availableParallelism(),
  waitMs: 30_000,
};

/** Half an hour at `HOST`'s 30-second look. */
const LOOKS = 60;
const PAUSE_POLL_MS = 5000;
const NETWORK_WAITS_MS = [60_000, 300_000];
const NETWORK =
  /\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|ConnectionRefused|FailedToOpenSocket|Cloudflare)\b/;
const WAITED = "campaign.waited";

// `.claude/skills/compare-systems/scripts/systems.ts` imports this name.
export { queued as gated };

/** A rehearsal's host: no load, so only the reserve, the slots and a pause's word hold its scripted
 *  solves, looked at every second. */
const SCRIPTED: Host = { load: () => 0, cores: 1, waitMs: 1000 };

/**
 * A pause word left since `began`, while `paused` reads it in force. A rehearsal's scripts meet it
 * as a paid run's solves do, so a `runs pause` of a rehearsed campaign lets its open solves finish
 * rather than starting solves after the word.
 */
function isPaused(log: string, began: number, now: number, wallSeconds: number): boolean {
  let hasPause = false;
  eachEvent(
    log,
    ({ data }, index) => {
      if (index >= began && data.word === PAUSE) hasPause = true;
    },
    (kind) => kind !== "campaign.word",
  );
  return hasPause && paused(read(log), began, now, wallSeconds);
}

function queued(
  { seated, loaded, host = seated === solved ? HOST : SCRIPTED }: Queue,
  log: string,
  began = read(log).length,
): Seated {
  const clock = host.now ?? Date.now;
  const pausing = (wallSeconds: number) => isPaused(log, began, clock(), wallSeconds);
  return (campaign, given) => {
    const seats = seated(campaign, given);
    return {
      ...seats,
      solve: async (task, harness, kill, comparison) => {
        kill?.throwIfAborted();
        // Said once, not on record: under a tight total every solve past the first waits its turn.
        if (inFlight(log) > 0 && !affords(log, 1)) {
          console.log(
            `a solve of ${task.taskId} waits for the campaign's reserve while others are in flight`,
          );
        }
        // The load is read at every look, since a solve that waited for a slot can begin at a far
        // higher load than it first read. The wait on record is the time slept at a high load alone.
        let [looks, load, ms] = [0, 0, 0];
        for (;;) {
          const [now, flown] = [loaded || looks >= LOOKS ? 0 : host.load(), inFlight(log)];
          const full =
            flown >= campaign.limits.concurrency ||
            (flown > 0 && !affords(log, 1)) ||
            pausing(campaign.limits.wallSeconds);
          if (kill?.aborted === true || (now <= host.cores && !full)) break;
          if (now > host.cores && (looks += 1) === 1) {
            load = now;
            console.log(
              `the host's load is ${load.toFixed(1)} on ${String(host.cores)} cores: a solve of ${task.taskId} waits until it is at or under them, at most half an hour, or pass --loaded`,
            );
          }
          const slept = clock();
          await waiting(host.waitMs, kill, host.sleep);
          if (now > host.cores) ms += clock() - slept;
        }
        if (looks > 0) {
          append(log, WAITED, {
            task: task.taskId,
            harness: harness.digest,
            ...keyIfDefined("comparison", comparison),
            load,
            cores: host.cores,
            ms,
          });
        }
        kill?.throwIfAborted();
        return flying(log, () => seats.solve(task, harness, kill, comparison));
      },
    };
  };
}

/**
 * The wait after the sessions in a row that crashed (`crashedRun`): to the provider's reset where
 * the last crash names one, and otherwise, for a network failure, one `for: "network"` wait per
 * crash. The third crash ends the campaign (`CRASHES_IN_A_ROW`, `decide.ts`) and is not waited for;
 * asked after every move, it sleeps once per crash.
 */
export async function waitCrashed(log: string, host: Host = HOST): Promise<void> {
  const events = read(log, TRACE_KINDS);
  const { count, crash } = crashedRun(events);
  if ((await waitOut(log, crash, host.sleep)) || crash === null || !NETWORK.test(crash)) return;
  if (count === 0 || count >= CRASHES_IN_A_ROW) return;
  const ended = events.findLastIndex(({ kind }) => kind === "exam.finished" || kind === "build.finished");
  if (events.slice(ended + 1).some(({ kind, data }) => kind === WAITED && data.for === "network")) return;
  const ms = NETWORK_WAITS_MS[Math.min(count, NETWORK_WAITS_MS.length) - 1] ?? 0;
  console.log(
    `the network failed the last session: the campaign waits ${String(ms / 60_000)} minutes, then goes on`,
  );
  append(log, WAITED, { for: "network", ms });
  await waiting(ms, undefined, host.sleep);
}

/** Wait while an active or reached pause holds this process, returning whether any wait ran. */
export async function waitPaused(
  log: string,
  began: number,
  wallSeconds: number,
  options: {
    readonly host?: Host | undefined;
    readonly signal?: AbortSignal | undefined;
    readonly within?: (<T>(work: () => Promise<T>) => Promise<T>) | undefined;
  } = {},
): Promise<boolean> {
  const { host = HOST, signal, within = (work) => work() } = options;
  const waitMs = Math.min(host.waitMs, PAUSE_POLL_MS);
  const clock = host.now ?? Date.now;
  const shouldWait = () => signal?.aborted !== true && isPaused(log, began, clock(), wallSeconds);
  let waited = false;
  while (shouldWait()) {
    waited = true;
    await within(() => waiting(waitMs, signal, host.sleep));
  }
  return waited;
}
