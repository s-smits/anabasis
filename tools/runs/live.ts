/** Live campaigns and simulation seats on one machine, shared by usage and placement. */
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { lastLaunch } from "./receipt.ts";
import { processes, runs, writers } from "./registry.ts";
export interface Live {
  readonly name: string;
  readonly login: string | null;
  readonly host: string;
}

const SEAT = "system-path-simulation/scripts/live-seat.ts";

/** The live seats of the skill `system-path-simulation` on this machine, each by the seed and the
 *  login its own flags name, since a seat keeps no launch receipt. A shell that started one names it
 *  too, so a seed is listed once. */
export function seatsIn(table: readonly string[], host: string): Live[] {
  const seats = table.flatMap((row) => {
    const all = row.trim().split(/\s+/);
    const own = all.slice(0, all.includes("--") ? all.indexOf("--") : all.length);
    const flag = (name: string) => (own.includes(name) ? (own[own.indexOf(name) + 1] ?? null) : null);
    const name = flag("--name");
    return own.some((arg) => arg.endsWith(SEAT)) && own.includes("start") && name !== null
      ? [{ name, login: flag("--login"), host }]
      : [];
  });
  return [...new Map(seats.map((seat) => [seat.name, seat])).values()];
}

/** The runs a process writes on this machine, which `host` names, and the simulations: a seat's
 *  seed is counted on the login the seat names. */
export function liveHere(host = "here"): Live[] {
  const seats = seatsIn(runTextSyncOrThrow(["ps", "-axo", "args="]).split("\n"), host);
  const running = processes();
  const live = runs()
    .filter((run) => !seats.some(({ name }) => name === run.name) && writers(run, running).length > 0)
    .map((run) => ({ name: run.name, login: lastLaunch(run.path)?.login ?? null, host }));
  return [...live, ...seats];
}

/** The runs `host` said it writes, from the lines of its answer to `active --here`, or null where
 *  the answer is no JSON list. */
export function liveOf(host: string, lines: readonly string[] | null): Live[] | null {
  try {
    const said = capturedJsonParse(lines?.join("\n") ?? "");
    if (!Array.isArray(said)) return null;
    return said.map((entry) => {
      const run = asRecord(entry);
      if (run === null || !isString(run.name) || !(run.login === null || isString(run.login))) {
        throw new Error("a live record needs a name and login");
      }
      return { name: run.name, login: run.login, host };
    });
  } catch {
    return null;
  }
}
