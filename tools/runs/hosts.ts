/**
 * Other machines that hold worktrees of this repository, reached over ssh: `on` runs any verb
 * there, `hosts` gives each host's `status`, and `holds` says which names a worktree here holds.
 * The hosts are `ANA_HOSTS`, a JSON list loaded by Bun's `--env-file` from a file git ignores, so
 * no machine is named in the repository. The remote command runs under a login shell with
 * `ANA_HOP=1`, under which `hostsOf` lists no host, so two machines that list each other never ask
 * each other in a loop. Every host is asked at once under a time limit, so a slow one holds up no
 * other.
 *
 *   bun run runs on <host> <verb> [args ...]
 *   bun run runs hosts [--all] [--health [--here]]
 *   bun run runs holds <name ...>
 */
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { capturedSpawn, runtimeProcess, warn } from "#src/meta/process.ts";
import { runCaptured } from "#src/meta/subprocess.ts";
import { CARRIED, type Host, hostsOf, hostNamed, configuredRuntime, RUN_CAP } from "./host-config.ts";
import { quoted, shellPath, sshScript, treeBun } from "./host-command.ts";
import { readControllers } from "./code.ts";
import { CLI, runs } from "./registry.ts";
import { scanText } from "../secrets/rules.ts";

/** How long `hosts` waits for one host's rows, and a verb for each host's `holds`. */
const HOST_MS = 30_000;
/** The verbs that act on the runs they name: every name `stop` is given, and the first word of the rest. */
export const NAMING = new Set(["stop", "continue", "pause", "keep", "copy"]);
/** The options of the verbs in `NAMING` that take no value; any other option not joined by `=`
 *  takes the next argument. */
const SWITCHES = new Set(["--yes", "--all", "--json", "--hold", "--here"]);

interface Routes {
  readonly here: readonly string[] | null;
  readonly away: readonly (readonly [Host, readonly string[]])[];
}

/**
 * What a verb on `host` is told, whatever its own files say: this machine's shared settings, the
 * entry's own over them, an empty value sending none, and its capacity. It goes with the verb, so a
 * keeper the verb starts inherits it and no peer holds a copy to drift, which could leave every login
 * on a peer allowed and uncapped. A value that looks like a credential is refused, naming its key alone.
 */
export function carriedTo(host: Host): Readonly<Record<string, string>> {
  const shared = CARRIED.map((key) => [key, runtimeProcess.env[key] ?? ""] as const);
  const merged = {
    ...Object.fromEntries(shared),
    ...host.settings,
    ANA_RUN_CAP: String(host.capacity ?? RUN_CAP),
  };
  const sent = Object.entries(merged).filter(([, value]) => value !== "");
  for (const [key, value] of sent) {
    if (scanText(key, value).length > 0) {
      throw new Error(`${host.name}: the value of ${key} looks like a credential, and none travels`);
    }
  }
  return Object.fromEntries(sent);
}

function scriptCommand(host: Host, script: string, args: readonly string[]): string[] {
  if (
    !/^(tools|\.claude\/skills)\//.test(script) ||
    script.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error("a host script must be a repository-relative tools or skill path");
  }
  const runtime = host.prepared === true ? host : configuredRuntime(host);
  const env = (runtime.envFiles ?? []).map((file) => ` --env-file=${shellPath(file)}`).join("");
  const carried = Object.entries(carriedTo(host)).map(([key, value]) => `${key}=${quoted(value)} `);
  return sshScript(
    host,
    `cd ${shellPath(host.tree)}\n${carried.join("")}ANA_HOP=1 ${treeBun(runtime.bun)}${env} ${quoted(script)} ${args.map(quoted).join(" ")}`,
  );
}

export async function verbOn(host: Host, args: readonly string[]): Promise<number> {
  return await scriptOn(host, CLI, args);
}

export async function scriptOn(host: Host, script: string, args: readonly string[]): Promise<number> {
  const io = { stdin: "inherit", stdout: "inherit", stderr: "inherit" } as const;
  const ready = host.prepared === true ? host : (await readControllers([host]))[0];
  if (ready === null || ready === undefined) return 1;
  return await capturedSpawn(scriptCommand(ready, script, args), io).exited;
}

export async function on(args: readonly string[]): Promise<void> {
  const [name, ...verb] = args;
  runtimeProcess.exitCode = await verbOn(hostNamed(name), verb);
}

export async function hosts(args: readonly string[]): Promise<void> {
  const all = hostsOf();
  if (all.length === 0) console.log("no host: ANA_HOSTS names none in this environment");
  const started = performance.now();
  const ready = await readControllers(all);
  await Promise.all(
    all.map(async (host, index) => {
      const controller = ready[index];
      if (controller === null || controller === undefined) {
        console.log(
          `${host.name}: controller unavailable (${((performance.now() - started) / 1000).toFixed(1)} s)`,
        );
        return;
      }
      const said = await runCaptured(scriptCommand(controller, CLI, ["status", ...args]), {
        timeout: HOST_MS,
      });
      const late =
        said.signal === null
          ? `answered with exit ${String(said.exitCode)}`
          : `no answer in ${String(HOST_MS / 1000)} s`;
      console.log(
        `── ${host.name} (${((performance.now() - started) / 1000).toFixed(1)} s)\n${said.stdout}${said.stderr}${said.exitCode === 0 ? "" : `  ${host.name} ${late}`}`.trimEnd(),
      );
    }),
  );
}

/** Where in `args` the runs `verb` acts on are named: every word a stop is given, the first word of
 *  another verb in `NAMING`, and none for the rest. A word is an argument that is neither an option
 *  nor an option's value, before any `--`. */
function namedAt(verb: string, args: readonly string[]): number[] {
  const words: number[] = [];
  for (let at = 0; at < args.length && args[at] !== "--"; at += 1) {
    const arg = args[at] ?? "";
    if (!arg.startsWith("-")) words.push(at);
    else if (!arg.includes("=") && !SWITCHES.has(arg)) at += 1;
  }
  return verb === "stop" ? words : words.slice(0, NAMING.has(verb) ? 1 : 0);
}

/** The runs `verb args` names, by `namedAt`. */
export function namedIn(verb: string, args: readonly string[]): string[] {
  return namedAt(verb, args).map((at) => args[at] ?? "");
}

/** The routes of `verb args`, given the hosts that claim names no worktree here holds. A name
 *  nobody claims stays here, where the verb refuses it in its own words. */
function routesOf(verb: string, args: readonly string[], held: ReadonlyMap<string, Host>): Routes {
  const at = namedAt(verb, args);
  const names = at.map((index) => args[index] ?? "");
  const rest = args.filter((_, index) => !at.includes(index));
  const away = [...new Set(names.flatMap((name) => held.get(name) ?? []))].map(
    (host) => [host, [verb, ...names.filter((name) => held.get(name) === host), ...rest]] as const,
  );
  const here = names.filter((name) => !held.has(name));
  return { here: names.length === 0 || here.length > 0 ? [...here, ...rest] : null, away };
}

export function holds(names: readonly string[]): void {
  const here = new Set(runs().map(({ name }) => name));
  for (const name of names.filter((one) => here.has(one))) console.log(name);
}

/** The lines the verb `args` prints on each host `ANA_HOSTS` lists, all asked at once, and null
 *  from a host that fails or does not answer in time, which is said on stderr. */
export async function asked(
  args: readonly string[],
  targets = hostsOf(),
  mode: "prepared" | "configured" = "prepared",
): Promise<{ host: Host; lines: string[] | null; elapsedMs: number }[]> {
  return await askedScript(CLI, args, targets, mode);
}

/** What a peer's lines answer where they are JSON that `schema` holds, else null. Extra keys pass,
 *  so a newer tree's answer stays readable; an older tree's that lacks a part reads as null. */
export function answerOf<S extends TSchema>(schema: S, lines: readonly string[] | null): Static<S> | null;
export function answerOf(schema: TSchema, lines: readonly string[] | null): JsonValue | null {
  if (lines === null) return null;
  try {
    const value = capturedJsonParse(lines.join("\n"));
    return Value.Check(schema, value) ? value : null;
  } catch {
    return null;
  }
}

export async function askedScript(
  script: string,
  args: readonly string[],
  all = hostsOf(),
  mode: "prepared" | "configured" = "prepared",
): Promise<{ host: Host; lines: string[] | null; elapsedMs: number }[]> {
  const started = performance.now();
  const ready = mode === "configured" ? all : await readControllers(all);
  return await Promise.all(
    all.map(async (host, index) => {
      const controller = ready[index];
      if (controller === null || controller === undefined) {
        return { host, lines: null, elapsedMs: Math.round(performance.now() - started) };
      }
      const { stdout, exitCode, signal } = await runCaptured(scriptCommand(controller, script, args), {
        timeout: HOST_MS,
      });
      const elapsedMs = Math.round(performance.now() - started);
      if (exitCode !== 0) {
        warn(
          `${host.name} did not answer ${args[0] ?? ""} (${signal === null ? `exit ${String(exitCode)}` : "timed out"}, ${(elapsedMs / 1000).toFixed(1)} s)`,
        );
      }
      return {
        host,
        lines: exitCode === 0 ? stdout.split("\n").filter((line) => line !== "") : null,
        elapsedMs,
      };
    }),
  );
}

export async function holders(
  names: readonly string[],
  here: ReadonlySet<string>,
): Promise<Map<string, Host>> {
  const held = new Map<string, Host>();
  if (names.length === 0) return held;
  for (const { host, lines } of await asked(["holds", ...names])) {
    // A run held here goes on while a peer is silent, rather than one down host refusing it.
    if (lines === null && names.every((name) => here.has(name))) {
      warn(`${host.name}: not checked for another original of ${names.join(", ")}`);
      continue;
    }
    if (lines === null) throw new Error(`${host.name}: cannot locate a campaign without its answer`);
    for (const name of lines.filter((one) => names.includes(one))) {
      const other = held.get(name);
      if (other !== undefined) {
        throw new Error(`${name} names a campaign on ${other.name} and on ${host.name}`);
      }
      held.set(name, host);
    }
  }
  return held;
}

/** Asks every host before a mutation, since a local match cannot hide a remote duplicate. */
export async function routed(verb: string, args: readonly string[]): Promise<Routes> {
  const here = new Set(runs().map(({ name }) => name));
  // `--here` names this machine, as the keeper `keep` starts does, so that a peer that does not
  // answer cannot end the keeper at its start.
  const names = args.includes("--here") ? [] : namedIn(verb, args);
  const held = await holders(names, here);
  const duplicate = names.find((name) => here.has(name) && held.has(name));
  if (duplicate !== undefined) throw new Error(`${duplicate}: more than one original campaign`);
  return routesOf(verb, args, held);
}
