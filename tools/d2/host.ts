/**
 * What a campaign waits for, each through one host (`Host`), so that a test stands in a host whose
 * sleeps it counts.
 *
 * - **The load, before a solve.** A solve's wall counts the clock, so a solve started into a loaded
 *   host reaches walls an idle one would not: on 9 October one harness answered the same seven tasks
 *   in a median of 105 s under a load of 31 and of 40 s under a load of 6 (`docs/transfer.md`). A
 *   solve starts once the one-minute load is at or under the cores, or after `LOOKS` looks: on 15
 *   October, three campaigns on a host of 8 cores held one of them 104 and 107 minutes. Until 12
 *   October the gate was at a move's start, and a comparison of hours ran on whatever came after.
 *   `--loaded` is the operator's word that the solves' times will not be compared.
 * - **The reserve, beside the solves in flight.** A solve waits while others fly and the budget
 *   holds no reserve for it (`affords`); until 14 October each kind of solve held its own.
 * - **The solve slots, shared by every seat.** The same in-flight count holds comparison workers,
 *   practice and admission probes to the concurrency the condition records. On 26 October,
 *   buffer-fresh-opus-v072 showed 13 overlapping admission solves at a recorded concurrency of 4:
 *   each draft and its remaining probes could start together, outside the comparison's workers.
 * - **A provider's named reset.** A usage limit that names when it lifts is slept out, not a crash:
 *   on 12 October one login's limit, an hour and forty minutes from its reset, ended five campaigns
 *   on two hosts at once (`waitOut`, `src/solver/run.ts`, which a solve also calls).
 * - **A network that failed a session**, a minute after the first crash and five after the second:
 *   in buffer-149 on 13 October, Builder session b-2 began 2 s after b-1 crashed on a failed DNS
 *   lookup (`waitCrashed`).
 *
 * Every wait but the reserve's and slots' is on record as `campaign.waited`, so a reader tells
 * the solver's time from the host's, and a provider's starts the crash rule's count again
 * (`crashedRun`). A queued solve leaves on its kill signal without invoking the solving seat.
 * Load, reserve and slot waits are interruptible; a load wait records its elapsed time even when
 * cancellation ends it.
 */
import { CRASHES } from "#src/campaign/decide.ts";
import { crashedRun } from "#src/campaign/ground.ts";
import { affords, flying, inFlight } from "#src/campaign/opening.ts";
import { append, read } from "#src/kernel/log.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { waiting, waitOut } from "#src/solver/run.ts";
import { type Seated, solved } from "./round.ts";

/** A host as the waits read it: its one-minute load, its cores, how long a look waits, and, where a
 *  test stands one in, how it sleeps. `HOST` sleeps on `waiting`'s own timer, which a cancellation
 *  clears: until 25 October it slept on `Bun.sleep`, and a cancelled wait held the process until
 *  that sleep ran out. */
export interface Host {
  readonly load: () => number;
  readonly cores: number;
  readonly waitMs: number;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** What the gate is put on: who solves, the host where a test stands one in, and `--loaded`. */
interface Gate {
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
  /\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|ConnectionRefused|FailedToOpenSocket)\b/;
const WAITED = "campaign.waited";

/**
 * `seated` with each solve held at the load, reserve and shared slots. A rehearsal's scripts, whose
 * times nobody compares and which bill nothing, are seated ungated unless a test stands in a host.
 */
export function gated(
  { seated, loaded, host = seated === solved ? HOST : undefined }: Gate,
  log: string,
): Seated {
  if (host === undefined) return seated;
  return (campaign, given) => {
    const seats = seated(campaign, given);
    return {
      ...seats,
      solve: async (task, harness, kill, comparison) => {
        kill?.throwIfAborted();
        const [since, load] = [Date.now(), host.load()];
        if (!loaded && load > host.cores) {
          console.log(
            `the host's load is ${load.toFixed(1)} on ${String(host.cores)} cores: a solve of ${task.taskId} waits until it is at or under them, at most half an hour, or pass --loaded`,
          );
          let looks = 0;
          do {
            await waiting(host.waitMs, kill, host.sleep);
            looks += 1;
            if (kill?.aborted === true) break;
          } while (looks < LOOKS && host.load() > host.cores);
          append(log, WAITED, {
            task: task.taskId,
            harness: harness.digest,
            ...keyIfDefined("comparison", comparison),
            load,
            cores: host.cores,
            ms: Date.now() - since,
          });
        }
        // Said once, not on record: under a tight total every solve past the first waits its turn.
        if (inFlight(log) > 0 && !affords(log, 1)) {
          console.log(
            `a solve of ${task.taskId} waits for the campaign's reserve while others are in flight`,
          );
        }
        kill?.throwIfAborted();
        while (inFlight(log) >= campaign.limits.concurrency || (inFlight(log) > 0 && !affords(log, 1))) {
          if (kill?.aborted === true) break;
          await waiting(host.waitMs, kill, host.sleep);
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
 * crash on record as `for: "network"`. The third ends the campaign on its environment (`CRASHES`,
 * `decide.ts`) and is not waited for. This is asked after every move, and until 14 October each
 * asking slept the same minute again until a session ended whole.
 */
export async function waitCrashed(log: string, host: Host = HOST): Promise<void> {
  const events = read(log);
  const { count, crash } = crashedRun(events);
  if ((await waitOut(log, crash, host.sleep)) || crash === null || !NETWORK.test(crash)) return;
  if (count === 0 || count >= CRASHES) return;
  const ended = events.findLastIndex(({ kind }) => kind === "exam.finished" || kind === "build.finished");
  if (events.slice(ended + 1).some(({ kind, data }) => kind === WAITED && data.for === "network")) return;
  const ms = NETWORK_WAITS_MS[Math.min(count, NETWORK_WAITS_MS.length) - 1] ?? 0;
  console.log(
    `the network failed the last session: the campaign waits ${String(ms / 60_000)} minutes, then goes on`,
  );
  append(log, WAITED, { for: "network", ms });
  await waiting(ms, undefined, host.sleep);
}
