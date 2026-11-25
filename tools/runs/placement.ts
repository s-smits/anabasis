/**
 * One host choice for a fresh campaign, from the same live records as usage: the least occupied
 * machine below its configured capacity, preferring one that has run the pack before, with login
 * admission sharing the keeper's provider reader and capacity rule. A login's runs are spread over
 * the machines first, so one login's limit leaves every machine working. Missing readings refuse
 * placement.
 */
import { runtimeProcess } from "#src/meta/process.ts";
import { asked } from "./hosts.ts";
import { type Host, hostNamed, hostsOf, RUN_CAP } from "./host-config.ts";
import type { Live } from "./live.ts";
import {
  allowedLogins,
  atCap,
  fullOn,
  liveEverywhere,
  noLogin,
  plainOnly,
  type readLogins,
  readNotClosed,
  room,
  tokenOf,
} from "./logins.ts";
import { minuteLoads } from "./load.ts";
import { localCatalogue, remoteRuns } from "./snapshots.ts";

interface Occupancy {
  readonly host: Host | undefined;
  readonly live: number;
  readonly capacity: number;
  readonly familiar?: boolean;
  readonly sameLogin?: number;
  /** Its one-minute load a core when placement read it (`minuteLoads`); undefined where it did not
   *  answer in time. */
  readonly load?: number | undefined;
}

interface FreshHost {
  readonly host: Host | undefined;
  readonly capacity: number;
  readonly projects: readonly (string | null)[];
  readonly load?: number | undefined;
}

const LOAD_WAIT_MS = 5000;

/** A host's load for placement: its one-minute load a core, halved where it carries no live run,
 *  since a run already there will take more of it than its load shows yet (the operator's choice). */
const busyness = ({ load = 0, live }: Occupancy): number => (live === 0 ? load / 2 : load);

/** A batch may narrow the configured pool, but cannot silently add another payer. */
export function loginPool(wanted: string | undefined): string[] {
  const configured = allowedLogins(runtimeProcess.env);
  if (wanted === undefined) return configured;
  const chosen = wanted.split(",").map((login) => login.trim());
  if (chosen.some((login) => login === "" || !configured.includes(login))) {
    throw new Error("--logins must name allowed logins");
  }
  return chosen;
}

/** A capacity is a positive integer, the same default on every unconfigured machine. */
const capacityOf = (value: string | undefined): number => {
  const capacity = Number(value ?? RUN_CAP);
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("ANA_RUN_CAP takes a positive integer");
  }
  return capacity;
};

/** A host with capacity where the login runs least, then the least busy (`busyness`) where every
 *  such host gave its load, then a familiar one, then the least occupied; configured order breaks a
 *  tie. A load that did not come is never read as idle, so then load decides nothing. */
export function leastOccupied(rows: readonly Occupancy[]): Host | undefined {
  const open = rows.filter((row) => row.live < row.capacity);
  const loaded = open.every((row) => row.load !== undefined);
  const chosen = open.toSorted(
    (a, b) =>
      (a.sameLogin ?? 0) - (b.sameLogin ?? 0) ||
      (loaded ? busyness(a) - busyness(b) : 0) ||
      Number(b.familiar ?? false) - Number(a.familiar ?? false) ||
      a.live - b.live,
  )[0];
  if (chosen === undefined) throw new Error("no host has room for a fresh campaign");
  return chosen.host;
}

/** Whether a machine, `undefined` for this one, takes a pack under the reservations of configured hosts. */
export function takes(host: Host | undefined, pack: string): boolean {
  return host?.packs?.includes(pack) ?? !hostsOf().some((one) => one.packs?.includes(pack) === true);
}

/** Reads every machine before an automatic choice: silence is never spare capacity. */
export async function freshHosts(): Promise<FreshHost[]> {
  const known = hostsOf();
  const [answers, { order }] = await Promise.all([
    asked(["catalogue"]),
    minuteLoads([undefined, ...known], LOAD_WAIT_MS),
  ]);
  if (answers.length !== known.length) throw new Error("the host list changed during placement");
  const loadOf = (host: Host | undefined) => order.find((each) => each.host === host)?.share;
  return [
    {
      host: undefined,
      capacity: capacityOf(runtimeProcess.env.ANA_RUN_CAP),
      projects: localCatalogue().map((run) => run.project),
      load: loadOf(undefined),
    },
    ...answers.map(({ host, lines }) => ({
      host,
      capacity: host.capacity ?? RUN_CAP,
      projects: remoteRuns(lines, host).map((run) => run.project),
      load: loadOf(known.find((each) => each.name === host.name)),
    })),
  ];
}

/** The host placement chooses for `pack`, over `counted` and `choices` where a batch has reserved
 *  its earlier packs in them. */
export async function placeFresh(
  pack: string,
  counted?: readonly Live[],
  choices?: readonly FreshHost[],
  login?: string,
): Promise<Host | undefined> {
  const fleet = counted ?? (await freshFleet());
  return leastOccupied(
    (choices ?? (await freshHosts())).map((choice) => {
      const name = choice.host?.name ?? "here";
      const there = fleet.filter((run) => run.host === name);
      const open = takes(choice.host, pack) && fullOn(runtimeProcess.env, login, name, fleet) === null;
      return {
        host: choice.host,
        capacity: open ? choice.capacity : 0,
        live: there.length,
        familiar: choice.projects.includes(`${pack}-fresh`),
        sameLogin: login === undefined ? 0 : there.filter((run) => run.login === login).length,
        load: choice.load,
      };
    }),
  );
}

export async function freshFleet(): Promise<Live[]> {
  const { live, unasked } = await liveEverywhere("configured");
  if (unasked.length > 0) {
    throw new Error(`cannot place a campaign without its live count: ${unasked.join(", ")}`);
  }
  return live;
}

/** Admits a login by the keeper's capacity rule and provider reader, with a fleet-wide cap for each login. */
export async function freshLogin(
  requested: string | undefined,
  live: readonly Live[],
  read: typeof readLogins = readNotClosed,
  allowed = allowedLogins(runtimeProcess.env),
): Promise<string | undefined> {
  const env = runtimeProcess.env;
  if (requested === undefined && allowed.length === 0 && plainOnly(env)) return undefined;
  const full = atCap(env, allowed, live);
  if (requested !== undefined) {
    if (atCap(env, [requested], live).size > 0) {
      throw new Error(`login ${requested} is at its live-run cap across the fleet`);
    }
    // A login the provider refuses outright (a revoked or narrowed token) would fail every seat; a
    // closed window is a wait (rule 15) and still starts.
    const [reading] = tokenOf(env, requested) === undefined ? [] : await read([requested], env);
    if (reading !== undefined && "error" in reading && /messages HTTP 40[13]/.test(reading.error)) {
      throw new Error(`login ${requested} is refused by the provider: ${reading.error}`);
    }
    return requested;
  }
  const candidates = allowed.filter((login) => !full.has(login));
  const chosen = room(await read(candidates, env), allowed, full)[0];
  if (chosen === undefined) {
    throw new Error(noLogin(env, allowed) ?? "no allowed login has room for a fresh campaign");
  }
  return chosen;
}

/** Asks only for key presence; carrying credentials is the operator's. */
export async function loginPresent(host: Host, login: string): Promise<boolean> {
  const [result] = await asked(["active", "--here", "--login", login], [host]);
  if (result?.lines === null || result === undefined) {
    throw new Error(`${host.name}: cannot check login presence`);
  }
  const answer = result.lines.join("\n");
  if (answer !== "true" && answer !== "false") throw new Error(`${host.name}: invalid login presence answer`);
  return answer === "true";
}

/** The host a fresh run of `pack` named `named` goes to, this machine for `here`, refused where it
 *  does not take the pack or carries as many runs of `payer` as it may. */
export function freshHost(
  pack: string,
  fleet: readonly Live[],
  named: string,
  payer: string | undefined,
): Host | undefined {
  const host = named === "here" ? undefined : hostNamed(named);
  const where = host?.name ?? "here";
  const refused = takes(host, pack)
    ? fullOn(runtimeProcess.env, payer, where, fleet)
    : `${where} does not take ${pack}, by the packs ANA_HOSTS reserves`;
  if (refused !== null) throw new Error(refused);
  return host;
}
