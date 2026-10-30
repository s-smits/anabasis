/**
 * One host choice for a fresh campaign (22 October 2026). The scheduled fork used to parse status
 * prose and keep its own caps. Read the same live records as usage, and choose the least occupied
 * machine below its configured capacity, preferring one that has run the pack before. Login
 * admission shares the keeper's provider reader and capacity rule. Missing readings refuse placement.
 *
 * A login's runs are spread over the machines before anything else decides (26 October 2026). On
 * that day one login paid for both runs on one runner, and when it met its five-hour limit at 15:34Z
 * that runner stood idle for two hours while two other logins had capacity. The host chosen is the one where
 * the run's login has the fewest live runs, so one login's limit leaves every machine working.
 *
 * A machine may be kept for some packs (`packs` in `ANA_HOSTS`, 27 October 2026). The operator kept
 * the M1 for one truss campaign, and an automatic choice put a buffer campaign there the same day,
 * because only a session's memory held the rule. A machine that lists packs takes no other pack, and
 * a pack some machine lists goes to no machine that does not, whether chosen here or named by `--host`.
 *
 * A GPT run is paid by the Codex CLI's login of its machine (`CODEX`, `live.ts`), at most one a
 * machine unless `ANA_LOGIN_RUNS` names `codex:N` (29 October 2026). A machine that carries as many
 * takes no other GPT run, chosen here or named by `--host` (`fullOn`): until then the operator's
 * rule of one a machine was kept by hand, and only GPT runs' names showed which they were.
 */
import { runtimeProcess } from "#src/meta/process.ts";
import { asked } from "./hosts.ts";
import { type Host, hostNamed, hostsOf } from "./host-config.ts";
import type { Live } from "./live.ts";
import { allowedLogins, atCap, fullOn, liveEverywhere, plainOnly, readLogins, room } from "./logins.ts";
import { localCatalogue, remoteRuns } from "./snapshots.ts";

interface Occupancy {
  readonly host: Host | undefined;
  readonly live: number;
  readonly capacity: number;
  readonly familiar?: boolean;
  /** Live runs on this host that the new run's login pays for. */
  readonly sameLogin?: number;
}

interface FreshHost {
  readonly host: Host | undefined;
  readonly capacity: number;
  readonly projects: readonly (string | null)[];
}

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

/** A capacity is a positive integer, with the same default on every unconfigured machine. */
const capacityOf = (value: string | undefined): number => {
  const capacity = Number(value ?? "2");
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("ANA_RUN_CAP takes a positive integer");
  }
  return capacity;
};

/** A host with capacity where the login runs least, then a familiar one, then the least occupied;
 *  configured order breaks a tie. */
export function leastOccupied(rows: readonly Occupancy[]): Host | undefined {
  const chosen = rows
    .filter((row) => row.live < row.capacity)
    .toSorted(
      (a, b) =>
        (a.sameLogin ?? 0) - (b.sameLogin ?? 0) ||
        Number(b.familiar ?? false) - Number(a.familiar ?? false) ||
        a.live - b.live,
    )[0];
  if (chosen === undefined) throw new Error("no host has room for a fresh campaign");
  return chosen.host;
}

/** Whether a machine, `undefined` for this one, takes a pack under the reservations of `known`. */
export function takes(host: Host | undefined, pack: string, known = hostsOf()): boolean {
  return host?.packs?.includes(pack) ?? !known.some((one) => one.packs?.includes(pack) === true);
}

/** Read every machine before making an automatic choice; silence is never spare capacity. */
export async function freshHosts(): Promise<FreshHost[]> {
  const known = hostsOf();
  const answers = await asked(["catalogue"]);
  if (answers.length !== known.length) throw new Error("the host list changed during placement");
  return [
    {
      host: undefined,
      capacity: capacityOf(runtimeProcess.env.ANA_RUN_CAP),
      projects: localCatalogue().map((run) => run.project),
    },
    ...answers.map(({ host, lines }) => ({
      host,
      capacity: host.capacity ?? 2,
      projects: remoteRuns(lines, host).map((run) => run.project),
    })),
  ];
}

/** The same placement rule serves a single launch and a batch's reserved observations. */
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
      };
    }),
  );
}

/** Refuse incomplete counts before selecting a login or preparing launch source. */
export async function freshFleet(): Promise<Live[]> {
  const { live, unasked } = await liveEverywhere("configured");
  if (unasked.length > 0) {
    throw new Error(`cannot place a campaign without its live count: ${unasked.join(", ")}`);
  }
  return live;
}

/** Reuse the keeper's capacity rule and provider reader, with a fleet-wide cap for each login. */
export async function freshLogin(
  requested: string | undefined,
  live: readonly Live[],
  read: typeof readLogins = readLogins,
  allowed = allowedLogins(runtimeProcess.env),
): Promise<string | undefined> {
  const env = runtimeProcess.env;
  if (requested === undefined && allowed.length === 0 && plainOnly(env)) return undefined;
  const full = atCap(env, allowed, live);
  if (requested !== undefined) {
    if (atCap(env, [requested], live).size > 0) {
      throw new Error(`login ${requested} is at its live-run cap across the fleet`);
    }
    return requested;
  }
  const candidates = allowed.filter((login) => !full.has(login));
  const chosen = room(await read(candidates, env), allowed, full)[0];
  if (chosen === undefined) throw new Error("no allowed login has room for a fresh campaign");
  return chosen;
}

/** Ask only for key presence. Credential carriage belongs to the operator. */
export async function loginPresent(host: Host, login: string): Promise<boolean> {
  // This narrow endpoint uses the shared read controller, before exact launch preparation.
  const [result] = await asked(["active", "--here", "--login", login], [host]);
  if (result?.lines === null || result === undefined) {
    throw new Error(`${host.name}: cannot check login presence`);
  }
  const answer = result.lines.join("\n");
  if (answer !== "true" && answer !== "false") throw new Error(`${host.name}: invalid login presence answer`);
  return answer === "true";
}

/** The host a fresh run of `pack` goes to: chosen where `named` is undefined, this machine for
 *  `here`, and refused where it does not take the pack or carries as many runs of `payer` as it may. */
export async function freshHost(
  pack: string,
  fleet: readonly Live[],
  named: string | undefined,
  payer: string | undefined,
): Promise<Host | undefined> {
  const host =
    named === undefined
      ? await placeFresh(pack, fleet, undefined, payer)
      : named === "here"
        ? undefined
        : hostNamed(named);
  const where = host?.name ?? "here";
  const refused = takes(host, pack)
    ? fullOn(runtimeProcess.env, payer, where, fleet)
    : `${where} does not take ${pack}, by the packs ANA_HOSTS reserves`;
  if (refused !== null) throw new Error(refused);
  return host;
}
