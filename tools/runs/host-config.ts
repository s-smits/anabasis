/** Machine identities and capacities come only from ANA_HOSTS. */
import { existsSync } from "#src/meta/filesystem.ts";
import { mainTree } from "#src/meta/git.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { hostname } from "#src/meta/os.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";

export const RUN_CAP = 2;

export const RUNNER_SLOTS = ".cache/ana-runner";

export interface Host {
  readonly name: string;
  readonly ssh: string;
  readonly tree: string;
  readonly bun: string;
  readonly envFiles?: readonly string[];
  readonly capacity?: number;
  readonly checks?: number;
  /** The packs this machine is kept for: it takes no other, and no other machine takes them. */
  readonly packs?: readonly string[];
  readonly settings?: Readonly<Record<string, string>>;
  readonly exclude?: readonly string[];
  readonly prepared?: true;
}

export interface Bench {
  readonly name: string;
  readonly host: Host | undefined;
  readonly store: string;
  readonly sitting: string;
  readonly packs: readonly string[];
  readonly minPromo?: number;
}

export const CARRIED: readonly string[] = ["ANA_KEEP", "ANA_LOGINS", "ANA_LOGIN_RUNS", "ANA_LOGIN_SUBS"];

function settingsOf(name: string, value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const entries = Object.entries(asRecord(value) ?? { "": null });
  for (const [key, one] of entries) {
    if (!isString(one)) throw new Error(`${name}: settings takes an object of strings`);
    if (!CARRIED.includes(key)) {
      throw new Error(`${name}: settings takes ${CARRIED.join(", ")}, and not ${key}`);
    }
  }
  return Object.fromEntries(entries.flatMap(([key, one]) => (isString(one) ? [[key, one] as const] : [])));
}

function listed(text: string, name = "ANA_HOSTS"): readonly JsonValue[] {
  if (text.trim() === "") return [];
  try {
    const value = capturedJsonParse(text);
    if (Array.isArray(value)) return value;
  } catch (error) {
    throw new Error(`${name} is not JSON (.env.runs.example): ${errorMessage(error)}`, { cause: error });
  }
  throw new Error(`${name} takes a JSON list (.env.runs.example)`);
}

/** Whether this verb is kept to this machine: sent here by another host (`ANA_HOP`, set by
 *  `scriptCommand` in `hosts.ts`) or asked for here alone (`cli.ts`). It reaches no further host,
 *  so two machines that list each other never loop; the sender does not empty `ANA_HOSTS`, since a
 *  keeper would inherit that and count no other machine's runs against a login's cap. */
export const isLocalOnly = (
  env: Readonly<Record<string, string | undefined>> = runtimeProcess.env,
): boolean => env.ANA_HOP === "1";

export const checkHost = (): string | undefined => runtimeProcess.env.ANA_CHECK_HOST;

export const checkSlots = (host: Host): number => host.checks ?? 2;

export interface Place {
  readonly remote?: string;
  readonly slots: number;
}

export const NO_VERDICT: ReadonlySet<number> = new Set([255, 75, 69]);

export function checkPlaces(root: string, jobs: number | undefined): readonly Place[] {
  return (checkHost()?.trim() ?? "") === "" ? fleetPlaces(root, jobs) : [{ slots: jobs ?? 1 }];
}

export function fleetPlaces(root: string, jobs: number | undefined): readonly Place[] {
  const hosts = hostsFor(root).map((host) => ({ name: host.name, checks: checkSlots(host) }));
  if (hosts.length === 0) return [{ slots: jobs ?? 1 }];
  const dealt = new Map(hosts.map((host) => [host, 0]));
  for (let left = jobs ?? Infinity; left > 0 && [...dealt].some(([host, slots]) => slots < host.checks); ) {
    for (const [host, slots] of dealt) {
      if (left > 0 && slots < host.checks) {
        dealt.set(host, slots + 1);
        left -= 1;
      }
    }
  }
  return [...dealt].flatMap(([host, slots]) => (slots === 0 ? [] : [{ remote: host.name, slots }]));
}

export const namedPlaces = (places: readonly Place[]): string =>
  places.map(({ remote, slots }) => `${remote ?? "here"} (${String(slots)})`).join(", ");

export const placeEnv = ({ remote }: Place): Readonly<Record<string, string>> =>
  remote === undefined ? {} : { ANA_CHECK_HOST: remote, ANA_RUNNER_SPARE_HELD: "1" };

export interface Seat {
  readonly place: Place;
  readonly index: number;
  readonly leave: () => boolean;
}

export interface Spreading<T> {
  readonly run: (task: T, seat: Seat) => Promise<"done" | "elsewhere">;
  readonly qualify?: (seat: Seat) => Promise<string | null>;
  readonly halt?: () => boolean;
  readonly startsAlone?: (task: T) => boolean;
}

export async function spread<T>(
  places: readonly Place[],
  tasks: readonly T[],
  { run, qualify, halt = () => false, startsAlone = () => false }: Spreading<T>,
): Promise<{ unrun: T[]; refused: string[] }> {
  const live = new Set(places);
  const leave = (place: Place) => () => {
    const others = [...live].some((other) => other !== place);
    if (others) live.delete(place);
    return others;
  };
  const seats = places.flatMap((place) => Array.from({ length: place.slots }, () => place));
  const firsts = places.map((place) => ({
    place,
    index: seats.indexOf(place),
    leave: leave(place),
  }));
  const refusals = qualify === undefined ? [] : await Promise.all(firsts.map(qualify));
  const refused = refusals.filter((why) => why !== null);
  for (const [at, why] of refusals.entries()) if (why !== null) live.delete(places[at] ?? { slots: 0 });
  const busy = new Set<number>();
  const queue = tasks.map((task, order) => ({ task, order }));
  const running = new Set<Promise<void>>();
  const room = (place: Place) => seats.filter((one, index) => one === place && !busy.has(index)).length;
  const free = () =>
    seats.flatMap((place, index) => (live.has(place) && !busy.has(index) ? [{ place, index }] : []));
  const take = (task: T) => {
    if (!startsAlone(task)) return free().toSorted((one, other) => room(other.place) - room(one.place))[0];
    return running.size === 0 ? free()[0] : undefined;
  };
  try {
    await dispatch();
  } catch (error) {
    await Promise.allSettled(running);
    throw error;
  }
  return { unrun: queue.map(({ task }) => task), refused };

  async function dispatch(): Promise<void> {
    for (;;) {
      const head = queue[0];
      if (head === undefined || halt() || live.size === 0) {
        if (running.size === 0) break;
        await Promise.race(running);
        continue;
      }
      const open = take(head.task);
      if (open === undefined) {
        if (running.size === 0) break;
        await Promise.race(running);
        continue;
      }
      queue.shift();
      busy.add(open.index);
      const seat = { ...open, leave: leave(open.place) };
      const task: Promise<void> = run(head.task, seat).then((said) => {
        busy.delete(open.index);
        running.delete(task);
        if (said === "done") return;
        live.delete(open.place);
        const above = queue.findIndex((other) => other.order > head.order);
        queue.splice(above === -1 ? queue.length : above, 0, head);
      });
      running.add(task);
    }
  }
}

export function hostsOf(text = runtimeProcess.env.ANA_HOSTS ?? ""): readonly Host[] {
  if (isLocalOnly()) return [];
  const value = listed(text);
  const names = new Set<string>();
  return value.map((entry) => {
    const host = asRecord(entry);
    if (host === null || !isString(host.name) || !isSafePathSegment(host.name) || host.name === "here") {
      throw new Error("each ANA_HOSTS entry needs a safe, unique name other than here");
    }
    if (names.has(host.name.toLowerCase())) throw new Error(`ANA_HOSTS repeats ${host.name}`);
    names.add(host.name.toLowerCase());
    if (!isString(host.ssh) || host.ssh.startsWith("-") || /\s/.test(host.ssh) || host.ssh === "") {
      throw new Error(`${host.name}: ssh takes one destination`);
    }
    if (!isString(host.tree) || host.tree === "" || !isString(host.bun) || host.bun === "") {
      throw new Error(`${host.name}: tree and bun are required`);
    }
    if (!isAbsolute(host.tree) && !host.tree.startsWith("~/")) {
      throw new Error(`${host.name}: tree takes an absolute path or ~/path`);
    }
    const files = host.envFiles;
    if (files !== undefined && (!Array.isArray(files) || !files.every(isString))) {
      throw new Error(`${host.name}: envFiles takes a list of paths`);
    }
    const name = host.name;
    const count = (key: "capacity" | "checks"): number | undefined => {
      const given = host[key];
      if (given === undefined) return undefined;
      if (!isNumber(given) || !Number.isSafeInteger(given) || given < 1) {
        throw new Error(`${name}: ${key} takes a positive integer`);
      }
      return given;
    };
    const packs = host.packs;
    if (
      packs !== undefined &&
      (!Array.isArray(packs) || !packs.every(isString) || !packs.every(isSafePathSegment))
    ) {
      throw new Error(`${host.name}: packs takes a list of pack names`);
    }
    const { exclude } = host;
    if (exclude !== undefined && (!Array.isArray(exclude) || !exclude.every(isString))) {
      throw new Error(`${host.name}: exclude takes a list of tool names`);
    }
    return {
      name: host.name,
      ssh: host.ssh,
      tree: host.tree,
      bun: host.bun,
      ...keyIfDefined("envFiles", files),
      ...keyIfDefined("capacity", count("capacity")),
      ...keyIfDefined("checks", count("checks")),
      ...keyIfDefined("packs", packs),
      ...keyIfDefined("settings", settingsOf(host.name, host.settings)),
      ...keyIfDefined("exclude", exclude),
    };
  });
}

export const envRunsFile = (root: string): string => join(mainTree(root), ".env.runs");

/** Reads selected keys from the main worktree's `.env.runs` with Bun's own `--env-file` parser, so
 *  standalone commands (`bun run wri`, the check router) share fleet and bench config without
 *  loading `.env`. */
function readEnvRuns(root: string, keys: readonly string[]): Record<string, string | undefined> {
  const file = envRunsFile(root);
  if (!existsSync(file)) return {};
  const env = Object.fromEntries(Object.entries(runtimeProcess.env).filter(([name]) => !keys.includes(name)));
  const expr = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, process.env[k] ?? ""]))))`;
  const raw = runTextSyncOrThrow([capturedExecPath, `--env-file=${file}`, "-e", expr], { cwd: root, env });
  const parsed = asRecord(capturedJsonParse(raw)) ?? {};
  return Object.fromEntries(
    keys.map((key) => [key, isString(parsed[key]) && parsed[key] !== "" ? parsed[key] : undefined]),
  );
}

export function hostsFor(root: string): readonly Host[] {
  if ((runtimeProcess.env.ANA_HOSTS ?? "") !== "") return hostsOf();
  return hostsOf(readEnvRuns(root, ["ANA_HOSTS"]).ANA_HOSTS ?? "");
}

export function benchesForRoot(root: string): readonly Bench[] {
  if ((runtimeProcess.env.EVAL_RUNNER ?? "") !== "") return benchesOf();
  const fromFile = readEnvRuns(root, ["ANA_HOSTS", "EVAL_RUNNER"]);
  if (fromFile.EVAL_RUNNER === undefined) return [];
  return benchesOf({
    ...runtimeProcess.env,
    ANA_HOSTS:
      (runtimeProcess.env.ANA_HOSTS ?? "") === "" ? fromFile.ANA_HOSTS : runtimeProcess.env.ANA_HOSTS,
    EVAL_RUNNER: fromFile.EVAL_RUNNER,
  });
}

export function configuredRuntime(host: Host) {
  const rooted = (path: string) =>
    isAbsolute(path) || path.startsWith("~/") ? path : `${host.tree}/${path}`;
  return {
    bun: host.bun.includes("/") ? rooted(host.bun) : host.bun,
    envFiles: [...new Set([".env", ...(host.envFiles ?? [".env.runs"])].map(rooted))],
  };
}
export const ownName = (): string => hostname().replace(/\..*$/u, "");

export function benchesOf(env: Readonly<Record<string, string | undefined>> = runtimeProcess.env): Bench[] {
  const value = listed(env.EVAL_RUNNER ?? "", "EVAL_RUNNER");
  const known = hostsOf(env.ANA_HOSTS ?? "");
  const names = new Set<string>();
  return value.flatMap((entry): Bench[] => {
    const { name, host = "here", store, sitting, packs, minPromo } = asRecord(entry) ?? {};
    const given = (word: unknown): word is string => isString(word) && word !== "";
    if (!given(name) || !isSafePathSegment(name) || !given(host) || !given(store) || !given(sitting)) {
      throw new Error("each EVAL_RUNNER entry needs a safe name, a store and a sitting command");
    }
    if (names.has(name)) throw new Error(`EVAL_RUNNER repeats ${name}`);
    names.add(name);
    if (!Array.isArray(packs) || packs.length === 0 || !packs.every(isString)) {
      throw new Error(`${name}: packs takes a list of the packs whose runs it reads`);
    }
    if (minPromo !== undefined && (!isNumber(minPromo) || !Number.isSafeInteger(minPromo) || minPromo < 0)) {
      throw new Error(`${name}: minPromo takes a non-negative integer`);
    }
    if (host !== "here" && isLocalOnly(env)) return [];
    // A relative store or sitting is read from the home folder of its machine.
    const home = (path: string) => (isAbsolute(path) || path.startsWith("~/") ? path : `~/${path}`);
    const on = host === "here" ? undefined : hostNamed(host, known);
    return [
      {
        name,
        host: on,
        store: home(store),
        sitting: home(sitting),
        packs,
        ...keyIfDefined("minPromo", minPromo),
      },
    ];
  });
}

export function hostNamed(name: string | undefined, known = hostsOf()): Host {
  const host = known.find((one) => one.name === name);
  if (host === undefined) {
    throw new Error(
      `no host ${name ?? "named"}: ANA_HOSTS names ${known.map((one) => one.name).join(", ") || "none here"}`,
    );
  }
  return host;
}
