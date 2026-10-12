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
 */
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
}

/** What the gate is put on: who solves, the host a test stands in where it does, and whether the
 *  operator said `--loaded`. */
interface Gate {
  readonly seated: Seated;
  readonly host?: Host | undefined;
  readonly loaded: boolean;
}

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
