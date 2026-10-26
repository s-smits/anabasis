/**
 * One host choice for a fresh campaign (22 October 2026). The scheduled fork used to parse status
 * prose and keep its own caps. Read the same live records as usage, and choose the least occupied
 * machine below its configured capacity, preferring one that has run the pack before. Login
 * admission shares the keeper's provider reader and room rule. Missing readings refuse placement.
 */
import { runtimeProcess } from "#src/meta/process.ts";
import { asked } from "./hosts.ts";
import { type Host, hostsOf } from "./host-config.ts";
import { type Live } from "./live.ts";
import { allowedLogins, atCap, liveEverywhere, readLogins, room } from "./logins.ts";
import { localCatalogue, remoteRuns } from "./snapshots.ts";

interface Occupancy {
  readonly host: Host | undefined;
  readonly live: number;
  readonly capacity: number;
  readonly familiar?: boolean;
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

/** A familiar host with room, then the least occupied; configured order breaks a tie. */
export function leastOccupied(rows: readonly Occupancy[]): Host | undefined {
  const chosen = rows
    .filter((row) => row.live < row.capacity)
    .toSorted((a, b) => Number(b.familiar ?? false) - Number(a.familiar ?? false) || a.live - b.live)[0];
  if (chosen === undefined) throw new Error("no host has room for a fresh campaign");
  return chosen.host;
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
): Promise<Host | undefined> {
  const fleet = counted ?? (await freshFleet());
  return leastOccupied(
    (choices ?? (await freshHosts())).map((choice) => ({
      host: choice.host,
      capacity: choice.capacity,
      live: fleet.filter((run) => run.host === (choice.host?.name ?? "here")).length,
      familiar: choice.projects.includes(`${pack}-fresh`),
    })),
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

/** Reuse the keeper's room rule and provider reader, with a fleet-wide cap for each login. */
export async function freshLogin(
  requested: string | undefined,
  live: readonly Live[],
  read: typeof readLogins = readLogins,
  allowed = allowedLogins(runtimeProcess.env),
): Promise<string> {
  const env = runtimeProcess.env;
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
