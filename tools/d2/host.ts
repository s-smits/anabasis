/**
 * The host a campaign's solves start into, and the gate each solve waits at.
 *
 * A solve's wall counts the clock, so what starts into a loaded host reaches walls an idle one
 * would not, and slows every run beside it: on 9 October one harness answered the same seven tasks
 * in a median of 105 s under a load of 31 and of 40 s under a load of 6 (`docs/transfer.md`). Until
 * 11 October the launcher refused such a launch once; from then until 12 October the campaign
 * command waited before a move that solves, so a comparison of hours that began on a quiet host
 * ran on whatever came after (finding 17). The gate is now at each solve's start, and each wait is
 * on record (`campaign.waited`), so a reader can tell the solver's time from the host's.
 *
 * The provider is waited for the same way. A usage limit whose message names when it resets is a
 * wait, not a crash: on 12 October one account's limit, naming a reset an hour and forty minutes
 * on, ended five campaigns on two hosts at once, three by the crash rule after three one-turn
 * Examiner sessions each and two by a comparison that threw (`waitOut`).
 */
import { resetOf } from "#src/backends/claude.ts";
import { append } from "#src/kernel/log.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { type Seated, solved } from "./round.ts";

/** A host as a solve's start reads it: its one-minute load, its cores, and how long the gate
 *  waits before it looks again. */
export interface Host {
  readonly load: () => number;
  readonly cores: number;
  readonly waitMs: number;
  /** How the campaign sleeps out a provider's named reset (`waitOut`); `Bun.sleep` unless a test
   *  stands in. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** What the gate is put on: who solves, the host a test stands in where it does, and whether the
 *  operator said `--loaded`. */
interface Gate {
  readonly seated: Seated;
  readonly host?: Host | undefined;
  readonly loaded: boolean;
}

/** The longest wait for a provider's named reset: a session window's, five hours, and some. A reset
 *  further on (a week's limit) is no wait, and the campaign ends on its environment as before. */
const RESET_MOST_MS = 6 * 3_600_000;
/** After the named minute, so that the first call is not made in the minute the limit lifts. */
const RESET_MARGIN_MS = 60_000;

/** This host, with half a minute between two looks at the load. */
export const HOST: Host = { load: () => loadavg()[0] ?? 0, cores: availableParallelism(), waitMs: 30_000 };

/**
 * `seated` with each solve held until the host's load is at or under its cores. A solve that
 * waited is said once as it waits, and recorded in `log` before it starts: the task, the harness,
 * the comparison it is for where one asks, the load it first read and how long it waited. `loaded`
 * (`--loaded` on the campaign command) seats the solves ungated, the operator's word that their
 * times will not be compared, and so are a rehearsal's scripts, whose times nobody compares,
 * unless a test stands in a host for them.
 */
export function gated(on: Gate, log: string): Seated {
  const { seated, loaded, host = seated === solved ? HOST : undefined } = on;
  if (loaded || host === undefined) return seated;
  return (campaign, given) => {
    const seats = seated(campaign, given);
    return {
      ...seats,
      solve: async (task, harness, kill, comparison) => {
        const [since, load] = [Date.now(), host.load()];
        if (load > host.cores) {
          console.log(
            `the host's load is ${load.toFixed(1)} on ${String(host.cores)} cores: a solve of ${task.taskId} waits until it is at or under them, or pass --loaded`,
          );
          for (let now = load; now > host.cores; now = host.load()) await Bun.sleep(host.waitMs);
          append(log, "campaign.waited", {
            task: task.taskId,
            harness: harness.digest,
            ...keyIfDefined("comparison", comparison),
            load,
            cores: host.cores,
            ms: Date.now() - since,
          });
        }
        return seats.solve(task, harness, kill, comparison);
      },
    };
  };
}

/**
 * Whether the campaign waited out the provider limit `said` names: where its reset is named and at
 * most `RESET_MOST_MS` on, the wait is recorded in `log` (`campaign.waited`, `for: "provider"`),
 * said once, and slept to a minute past the reset. The crash rule counts no session before it
 * (`crashedRun`), so the campaign goes on where it stood, unattended as it was. The campaign asks
 * after a move that threw, with what it threw, and after each move, with what the last session the
 * crash rule counts said.
 */
export async function waitOut(
  log: string,
  said: string | null,
  sleep: (ms: number) => Promise<void> = Bun.sleep,
  now = new Date(),
): Promise<boolean> {
  const reset = said === null ? null : resetOf(said, now);
  const ms = reset === null ? Number.NaN : reset.getTime() - now.getTime() + RESET_MARGIN_MS;
  if (!(ms > 0 && ms <= RESET_MOST_MS + RESET_MARGIN_MS) || reset === null) return false;
  console.log(
    `the provider's limit resets at ${reset.toISOString()}: the campaign waits for it, then goes on`,
  );
  append(log, "campaign.waited", { for: "provider", until: reset.toISOString(), ms });
  await sleep(ms);
  return true;
}
