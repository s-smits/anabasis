/** Live campaigns and simulation seats on one machine, shared by usage and placement. */
import { Type } from "typebox";
import { isString } from "#src/meta/json-shape.ts";
import { looseFlagsOf } from "../d2/campaign-terms.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { lastLaunch } from "./receipt.ts";
import { lifeOf } from "./diagnosis.ts";
import {
  archived,
  flagOf,
  isCampaign,
  ownArgs,
  processes,
  type Run,
  type Running,
  runs,
  SEAT,
} from "./registry.ts";
import { answerOf } from "./hosts.ts";

export interface Live {
  readonly name: string;
  readonly login: string | null;
  readonly host: string;
  /** Set on a kept run between two starts: its keeper lives and no process writes its log. */
  readonly unwritten?: true;
}

/** A peer's answer to `active --here`. */
const LIVE = Type.Array(
  Type.Object({
    name: Type.String(),
    login: Type.Union([Type.String(), Type.Null()]),
    unwritten: Type.Optional(Type.Unknown()),
  }),
);

/** The payer of a run that seats an `openai-codex/` model and names no numbered login: the Codex
 *  CLI's login of the machine it runs on. Each machine signs Codex in on its own, so a cap on it
 *  counts one machine's runs (`fullOn`, `logins.ts`). Until 29 October such a run counted under no
 *  login, and one GPT run a machine was a rule kept by hand. */
export const CODEX = "codex";

/** Whether `flags`, a launch's, seat a model through the Codex CLI's login. */
export function seatsCodex(flags: readonly string[]): boolean {
  return Object.values(looseFlagsOf(flags)).some(
    (value) => isString(value) && value.startsWith("openai-codex/"),
  );
}

/** Who pays a run on `login` with the launch flags `flags`: the login, or the Codex CLI's where it
 *  names none and a seat goes through it. */
export const payerOf = (login: string | undefined, flags: readonly string[]): string | undefined =>
  login ?? (seatsCodex(flags) ? CODEX : undefined);

/** The live seats of the skill `system-path-simulation` among the processes `table`, each by the seed
 *  and the login its own flags name, since a seat keeps no launch receipt. A shell that started one
 *  names it too, so a seed is listed once. */
export function seatsIn(table: readonly { readonly args: readonly string[] }[], host: string): Live[] {
  const seats = table.flatMap(({ args }) => {
    const own = ownArgs(args);
    const flag = (name: string) => flagOf(own, name) ?? null;
    const name = flag("--name");
    return own.some((arg) => arg.endsWith(SEAT)) && own.includes("start") && name !== null
      ? [{ name, login: flag("--login"), host }]
      : [];
  });
  return [...new Map(seats.map((seat) => [seat.name, seat])).values()];
}

/** The runs a process writes or keeps on this machine, which `host` names, and the simulations: a
 *  seat's seed is counted on the login the seat names. A kept run between two starts holds its slot,
 *  since its keeper starts it again there, and says it is `unwritten` (`countedAgainst`). All of it
 *  is read from one table, `running`. */
export function liveHere(host = "here", running = processes()): Live[] {
  const seats = seatsIn(running, host);
  const live = livesOf(
    runs().filter((run) => !seats.some(({ name }) => name === run.name)),
    host,
    running,
  );
  return [...live, ...seats];
}

/** The runs of `found` that a process writes or keeps (`lifeOf`), each on the login its last launch
 *  paid by, on `host`. */
function livesOf(found: readonly Run[], host: string, running: readonly Running[]): Live[] {
  return found.flatMap((run) => {
    const { writing, kept } = lifeOf(run, running);
    if (!writing && !kept) return [];
    const launch = lastLaunch(run.path);
    const login = payerOf(launch?.login, launch?.flags ?? []) ?? null;
    return [{ name: run.name, login, host, ...keysIf(!writing, () => ({ unwritten: true as const })) }];
  });
}

/** The runs `host` wrote or kept when the gather last copied its campaigns into the archive, read
 *  from what each fetch saw there (`lifeOf`), or null where the archive holds none of its copies. A
 *  host that does not answer `active` is counted so, as last seen, instead of halting every start
 *  on the fleet: on 13 November one asleep peer refused a continue of a run on this machine onto a
 *  login with no run anywhere. A run started there since its last gather is not seen. */
export function gatheredOn(host: string, copies: readonly Run[] = archived()): Live[] | null {
  const own = copies.filter((run) => run.archived === host && isCampaign(run));
  return own.length === 0 ? null : livesOf(own, host, []);
}

/** The runs of `live` that count against a start of `name` on their login: every other, but for an
 *  `unwritten` run, an `unwritten` one that sorts after it by name in code-unit order. Every keeper
 *  reads one listing and so one order alike, so where more kept runs wait on a login than its cap,
 *  as after a cap is lowered under them, the first by name start and the rest wait, where each would
 *  otherwise find the login full. A run nothing keeps counts every kept run, which holds its slot. */
export function countedAgainst(live: readonly Live[], name: string): Live[] {
  const kept = live.some((run) => run.name === name && run.unwritten === true);
  return live.filter((run) => run.name !== name && !(kept && run.unwritten === true && run.name > name));
}

/** The runs `host` said it writes, from the lines of its answer to `active --here`, or null where
 *  the answer is no JSON list. */
export function liveOf(host: string, lines: readonly string[] | null): Live[] | null {
  return (
    answerOf(LIVE, lines)?.map(({ name, login, unwritten }) => ({
      name,
      login,
      host,
      ...keysIf(unwritten === true, () => ({ unwritten: true as const })),
    })) ?? null
  );
}
