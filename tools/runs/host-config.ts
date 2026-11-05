/** Machine identities and capacities come only from ANA_HOSTS (22 October 2026). */
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { hostname } from "#src/meta/os.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { dirname, isAbsolute, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";

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
  /** The check tasks this machine runs at once for the runner; unset, the runner sends it none. */
  readonly checks?: number;
  /** The packs this machine is kept for: it takes no other, and no other machine takes them. */
  readonly packs?: readonly string[];
  /** A controller already prepared by code.ts, never accepted from configuration. */
  readonly prepared?: true;
}

/** What `ANA_HOSTS` says. Set and empty, as a copied `.env.runs.example` leaves it, is unset: no host,
 *  and this machine alone. */
function listedHosts(text: string): JsonValue {
  if (text.trim() === "") return [];
  try {
    return capturedJsonParse(text);
  } catch (error) {
    throw new Error(`ANA_HOSTS is not JSON: ${errorMessage(error)}`, { cause: error });
  }
}

export function hostsOf(): readonly Host[] {
  // A verb another host sent here reaches no further host (`ANA_HOP`, set by `scriptCommand` in
  // hosts.ts), so two machines that list each other do not ask each other in a loop. Until
  // 28 October the sender emptied `ANA_HOSTS` instead, and a keeper started that way inherited the
  // empty list and counted no other machine's runs against a login's cap.
  if (runtimeProcess.env.ANA_HOP === "1") return [];
  const value = listedHosts(runtimeProcess.env.ANA_HOSTS ?? "");
  if (!Array.isArray(value)) throw new Error("ANA_HOSTS takes a JSON list");
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
    return {
      name: host.name,
      ssh: host.ssh,
      tree: host.tree,
      bun: host.bun,
      ...keyIfDefined("envFiles", files),
      ...keyIfDefined("capacity", count("capacity")),
      ...keyIfDefined("checks", count("checks")),
      ...keyIfDefined("packs", packs),
    };
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

/** What says hosts exist that this process did not load: the main worktree's `.env.runs` names
 *  `ANA_HOSTS`, and the environment holds none. A verb that means to reach every host says so
 *  instead of reading one host. Null on a machine with no hosts. Only the key is looked for. */
export function unloadedHosts(repo: string): string | null {
  if (runtimeProcess.env.ANA_HOSTS !== undefined || runtimeProcess.env.ANA_HOP === "1") return null;
  const main = gitMaybe(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (main === null) return null;
  const file = join(dirname(main), ".env.runs");
  return existsSync(file) && /^ANA_HOSTS=/mu.test(readFileSync(file, "utf8"))
    ? `${file} names ANA_HOSTS, and this command did not load it`
    : null;
}

export function hostNamed(name: string | undefined): Host {
  const known = hostsOf();
  const host = known.find((one) => one.name === name);
  if (host === undefined) {
    throw new Error(
      `no host ${name ?? "named"}: ANA_HOSTS names ${known.map((one) => one.name).join(", ") || "none here"}`,
    );
  }
  return host;
}
