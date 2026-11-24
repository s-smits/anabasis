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

/** The live campaigns a machine carries where nothing configures its capacity. */
export const RUN_CAP = 2;

/** Where in a host's home the check runner keeps its slots, one clone with its packages a sending
 *  machine and slot (`onHost`, tools/runtime/router/run.ts), which `runs retire` clears once idle. */
export const RUNNER_SLOTS = ".cache/ana-runner";

export interface Host {
  readonly name: string;
  readonly ssh: string;
  /** Absolute, or ~/path. Its leading home marker expands; the remainder stays literal. */
  readonly tree: string;
  readonly bun: string;
  /** The env files there, credentials and this list among them. */
  readonly envFiles?: readonly string[];
  /** Live campaigns or simulation seats this machine may carry. */
  readonly capacity?: number;
  /** The check tasks this machine runs at once for the runner; unset, two. */
  readonly checks?: number;
  /** The packs this machine is kept for: it takes no other, and no other machine takes them. */
  readonly packs?: readonly string[];
  /** This host's own values of what a verb carries, over the shared ones; an empty one sends none. */
  readonly settings?: Readonly<Record<string, string>>;
  /** The `ANA_TOOLS` rows this machine keeps outside the table: reported, and never changed. */
  readonly exclude?: readonly string[];
  /** A controller already prepared by code.ts, never accepted from configuration. */
  readonly prepared?: true;
}

/** One outside benchmark: the machine that rolls it (undefined for this one), its score store and
 *  sitting command there, absolute or under `~/` where it was given relative, the packs whose
 *  runs it reads, and optional minimum promotions before automatic WRI regression analysis. */
export interface Bench {
  readonly name: string;
  readonly host: Host | undefined;
  readonly store: string;
  readonly sitting: string;
  readonly packs: readonly string[];
  readonly minPromo?: number;
}

/** What every remote verb carries from this machine's environment, and all an entry's `settings` may
 *  name: `ANA_HOSTS` stays here, since a peer holding it would gather every host's records. */
export const CARRIED: readonly string[] = ["ANA_KEEP", "ANA_LOGINS", "ANA_LOGIN_RUNS", "ANA_LOGIN_SUBS"];

/** An entry's `settings`: an object of strings, and only of what is carried. */
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

/** What the list setting `name` lists (`.env.runs.example`), refused as a plain error, which the CLI
 *  reads as a refusal. Set and empty, as a copied example leaves it, is unset: nothing listed, and
 *  for `ANA_HOSTS` this machine alone. */
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

/** Whether this verb is kept to this machine: one another host sent here (`ANA_HOP`, set by
 *  `scriptCommand` in hosts.ts), or one asked for here alone (`cli.ts`). It reaches no further
 *  host, so two machines that list each other do not ask each other in a loop, rather than the
 *  sender emptying `ANA_HOSTS`, which a keeper would inherit and so count no other machine's runs
 *  against a login's cap. */
export const isLocalOnly = (
  env: Readonly<Record<string, string | undefined>> = runtimeProcess.env,
): boolean => env.ANA_HOP === "1";

/** Where a check runs (`auto`, `here` or a host's name), as `ANA_CHECK_HOST` says; undefined where it
 *  is unset. */
export const checkHost = (): string | undefined => runtimeProcess.env.ANA_CHECK_HOST;

/** The check tasks `host` takes at once from the check runner and a landing: its `checks`, or two. */
export const checkSlots = (host: Host): number => host.checks ?? 2;

/** The hosts `text` lists, by default the environment's `ANA_HOSTS`: none for a verb kept here. */
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

/** The machine settings' file, `.env.runs`, which lies in the main worktree and in no other. */
export const envRunsFile = (root: string): string => join(mainTree(root), ".env.runs");

/** Reads selected keys from the main worktree's `.env.runs` via Bun's own `--env-file` parser so
 *  standalone commands (`bun run wri`, check router) share fleet/bench config without loading `.env`. */
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

/**
 * The hosts for a command run in `root` that loaded no env file: the environment's `ANA_HOSTS` where
 * it holds a list, else the one in the main worktree's `.env.runs`, where the bun router finds it for
 * a check task (`tools/runtime/router/bun`).
 */
export function hostsFor(root: string): readonly Host[] {
  if ((runtimeProcess.env.ANA_HOSTS ?? "") !== "") return hostsOf();
  return hostsOf(readEnvRuns(root, ["ANA_HOSTS"]).ANA_HOSTS ?? "");
}

/** The benchmarks for a standalone command run in `root` that loaded no env file (`bun run wri`):
 *  uses `EVAL_RUNNER`/`ANA_HOSTS` from the current environment when set, else from `.env.runs`. */
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
    // Bun implicitly loaded the configured checkout's .env before controllers moved elsewhere.
    envFiles: [...new Set([".env", ...(host.envFiles ?? [".env.runs"])].map(rooted))],
  };
}
/** This machine's own name, its short hostname: what `fresh` ends a run's name with when it runs
 *  here, and what `move` reads as `here`. */
export const ownName = (): string => hostname().replace(/\..*$/u, "");

/** The benchmarks `EVAL_RUNNER` lists (`.env.runs.example`), none where unset. An older value that
 *  names one machine alone, as `ABLATION_HOST` did, is refused as not JSON. A verb kept to this
 *  machine (`isLocalOnly`) reads local benchmarks alone rather than rejecting unconfigured hosts. */
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
