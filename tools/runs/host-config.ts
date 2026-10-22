/** Machine identities and capacities come only from ANA_HOSTS (22 October 2026). */
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { isAbsolute } from "#src/meta/path.ts";
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
  /** A controller already prepared by code.ts, never accepted from configuration. */
  readonly prepared?: true;
}

export function hostsOf(): readonly Host[] {
  const value = capturedJsonParse(runtimeProcess.env.ANA_HOSTS ?? "[]");
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
    const capacity = host.capacity;
    if (capacity !== undefined && (!isNumber(capacity) || !Number.isSafeInteger(capacity) || capacity < 1)) {
      throw new Error(`${host.name}: capacity takes a positive integer`);
    }
    return {
      name: host.name,
      ssh: host.ssh,
      tree: host.tree,
      bun: host.bun,
      ...keyIfDefined("envFiles", files),
      ...keyIfDefined("capacity", capacity),
    };
  });
}

export function configuredRuntime(host: Host) {
  const rooted = (path: string) =>
    isAbsolute(path) || path.startsWith("~/") ? path : host.tree + "/" + path;
  return {
    bun: host.bun.includes("/") ? rooted(host.bun) : host.bun,
    // Bun implicitly loaded the configured checkout's .env before controllers moved elsewhere.
    envFiles: [...new Set([".env", ...(host.envFiles ?? [".env.runs"])].map(rooted))],
  };
}
export function hostNamed(name: string | undefined): Host {
  const known = hostsOf();
  const host = known.find((one) => one.name === name);
  if (host === undefined) {
    throw new Error(`no host ${String(name)}: ANA_HOSTS names ${known.map((one) => one.name).join(", ")}`);
  }
  return host;
}
