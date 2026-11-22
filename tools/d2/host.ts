/**
 * What a campaign waits for, each through one host (`Host`), so that a test stands in a host whose
 * sleeps it counts.
 *
 * - **The load, before a solve.** A solve's deadline measures elapsed time. Under load, it may run
 *   out of time on work it would finish on an idle host: one harness has answered the same tasks
 *   more than twice as slowly under a heavy load as under a light one (`docs/transfer.md`). A
 *   solve starts once the one-minute load is at or under the cores, or after `LOOKS` looks, since
 *   several campaigns on one host can hold a solve for well over an hour. The queue waits before
 *   each solve rather than at a move's start, where a comparison of hours would run on whatever came after.
 *   `--loaded` is the operator's word that the solves' times will not be compared.
 * - **The reserve, beside the solves in flight.** A solve waits while others fly and the budget
 *   holds no reserve for it (`affords`), one reserve for every kind of solve.
 * - **The solve slots, shared by every seat.** The same in-flight count holds comparison workers,
 *   and practice to the concurrency the condition records, so that no seat's solves start outside
 *   the comparison's workers and overlap far past it.
 * - **A pause's word**, which starts no further solve while the process it was left for runs, so
 *   that `runs pause` lets the open ones finish (`PAUSE`, `src/campaign/word.ts`).
 * - **A provider's named reset.** A usage limit that names when it lifts is slept out, not a crash:
 *   one login's limit, read as a crash, would end every campaign on it at once (`waitOut`,
 *   `src/solver/run.ts`, which a solve also calls).
 * - **A network that failed a session**, a minute after the first crash and five after the second:
 *   a session begun seconds after another crashed on a failed DNS lookup would only crash again
 *   (`waitCrashed`). The provider's edge, whose 403 page can end a campaign, is on that route; a
 *   refusal the provider's own API writes (credit, a login, a model) gets no wait.
 */
import { CRASHES_IN_A_ROW } from "#src/campaign/decide.ts";
import { crashedRun } from "#src/campaign/ground.ts";
import { affords, flying, inFlight } from "#src/campaign/opening.ts";
import { paused } from "#src/campaign/word.ts";
import { append, read } from "#src/kernel/log.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { waiting, waitOut } from "#src/solver/run.ts";
import { type Seated, solved } from "./round.ts";

/** A host as the waits read it: its one-minute load, its cores, how long a look waits, and, where a
 *  test stands one in, how it sleeps and what its clock reads. `HOST` sleeps on `waiting`'s own timer, which a cancellation
 *  clears, where `Bun.sleep` would hold the process after a cancelled wait until that sleep ran
 *  out. */
export interface Host {
  readonly load: () => number;
  readonly cores: number;
  readonly waitMs: number;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Milliseconds since the epoch, as `Date.now` reads them where it is unset. */
  readonly now?: (() => number) | undefined;
}

/** What the solve queue is put on: who solves, the host where a test stands one in, and `--loaded`. */
interface Queue {
  readonly seated: Seated;
  readonly host?: Host | undefined;
  readonly loaded: boolean;
}

/** This host, looking at its load every half minute. */
export const HOST: Host = {
  load: () => loadavg()[0] ?? 0,
  cores: availableParallelism(),
  waitMs: 30_000,
};

/** The looks at the load before a solve starts all the same: half an hour on `HOST`. */
const LOOKS = 60;
const NETWORK_WAITS_MS = [60_000, 300_000];
const NETWORK =
  /\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|ConnectionRefused|FailedToOpenSocket|Cloudflare)\b/;
const WAITED = "campaign.waited";

// External tests and skills still import this public name.
export { queued as gated };

/** A rehearsal's host: no load, so that only the reserve, the slots and a pause's word hold its
 *  scripted solves, looked at every second. */
const SCRIPTED: Host = { load: () => 0, cores: 1, waitMs: 1000 };

/**
 * `seated` with each solve held at the load, reserve and shared slots, and at a pause's word. A
 * rehearsal's scripts, whose times nobody compares, meet no load but still meet the queue, so that
 * a `runs pause` of a rehearsed campaign lets its open solves finish and stops, as a paid run's
 * does, rather than starting solves after its word and cutting them at its patience.
 */
function queued({ seated, loaded, host = seated === solved ? HOST : SCRIPTED }: Queue, log: string): Seated {
  // A pause left before this process began was for the one it stopped.
  const began = read(log).length;
  const clock = host.now ?? Date.now;
  const pausing = (wallSeconds: number) => paused(read(log), began, clock(), wallSeconds);
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
        // The load is read at every look until the solve starts, since a solve that waited for a
        // slot can begin at a far higher load than it first read. The wait on record is the time
        // slept at a high load alone, without the slot and reserve waits after the load cleared.
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
 * the last crash names one, counted or not, and otherwise, where the network failed it, one wait a
 * crash on record as `for: "network"`. The third ends the campaign on its environment (`CRASHES_IN_A_ROW`,
 * `decide.ts`) and is not waited for. This is asked after every move, and the minute is slept once
 * a crash, not again at each asking until a session ends whole.
 */
export async function waitCrashed(log: string, host: Host = HOST): Promise<void> {
  const events = read(log);
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
