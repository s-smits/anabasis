/**
 * Other machines that hold worktrees of this repository, reached over ssh: `on <host> <verb ...>`
 * runs any verb of `bun run runs` there, and `hosts` says each one's runs' status, which `status`
 * adds below this machine's own wherever a host is listed.
 *
 *   bun run runs on <host> <verb> [args ...]
 *   bun run runs hosts [--all] [--health]
 *   bun run runs holds <name ...>
 *
 * The hosts are `ANA_HOSTS` in the environment, a JSON list, loaded as the credentials are by Bun's
 * `--env-file` from a file git ignores, so no machine is named in the repository. Each names the
 * host, its ssh destination, the worktree the verb runs in, the Bun there, and the env files there
 * that Bun loads (a path on that machine, never copied). The remote command runs under a login
 * shell, so a campaign it starts finds the tools a login there has, and with `ANA_HOP=1`, under
 * which `hostsOf` lists no host: a verb run on another host reaches no further one, so two
 * machines that list each other do not ask each other's status in a loop. `hosts` asks every host at
 * once and prints each one's rows as they come, under a time limit a host, so a host that is slow or
 * does not answer holds up no other (15 October: asked one after another, a loaded runner held the
 * rows of every host after it).
 *
 * A verb that acts on a run it names goes wherever the run is (`routesOf`): every host is asked
 * before acting, and unavailable hosts and duplicate originals refuse the route. On
 * 20 October a stop of eight runs on two machines took two commands, each naming its host, and a
 * keeper and continue each took the host's name by hand. Readers now use snapshots.ts instead of
 * routing to another reader. The transport prepares a detached controller at the caller's nearest
 * published ancestor for ordinary verbs and skill scripts; all configured paths remain literal shell words.
 * Live records belong to live.ts, shared by usage and placement (22 October 2026).
 */
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { runCaptured } from "#src/meta/subprocess.ts";
import { type Host, hostsOf, hostNamed, configuredRuntime } from "./host-config.ts";
import { quoted, shellPath, sshScript, treeBun } from "./host-command.ts";
import { readControllers } from "./code.ts";
import { CLI, runs } from "./registry.ts";

/** How long `hosts` waits for one host's rows, and a verb for each host's `holds`. */
const HOST_MS = 30_000;
/** The verbs that act on the runs they name: every name `stop` is given, and the first word of the rest. */
const NAMING = new Set(["stop", "continue", "pause", "keep", "copy"]);
/** The options of the verbs in `NAMING` that take no value. Any other option not joined to its value
 *  by `=` takes the next argument as its value. */
const SWITCHES = new Set(["--yes", "--all", "--once", "--json", "--hold", "--here"]);

/** Where a verb runs: here with `here` (none where every name it was given is elsewhere), and on
 *  each host with the words it is sent. */
interface Routes {
  readonly here: readonly string[] | null;
  readonly away: readonly (readonly [Host, readonly string[]])[];
}

/** The ssh command that runs the verb `args` on `host`. */
function scriptCommand(host: Host, script: string, args: readonly string[]): string[] {
  if (
    !/^(tools|\.claude\/skills)\//.test(script) ||
    script.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error("a host script must be a repository-relative tools or skill path");
  }
  const runtime = host.prepared === true ? host : configuredRuntime(host);
  const env = (runtime.envFiles ?? []).map((file) => ` --env-file=${shellPath(file)}`).join("");
  return sshScript(
    host,
    `cd ${shellPath(host.tree)}\nANA_HOP=1 ANA_RUN_CAP=${quoted(String(host.capacity ?? 2))} ${treeBun(runtime.bun)}${env} ${quoted(script)} ${args.map(quoted).join(" ")}`,
  );
}

/** The verb `args` run on `host`, its output this process's, and its exit code. */
export async function verbOn(host: Host, args: readonly string[]): Promise<number> {
  return await scriptOn(host, CLI, args);
}

/** Run a repository script through the same login shell and recursion boundary as a runs verb. */
export async function scriptOn(host: Host, script: string, args: readonly string[]): Promise<number> {
  const io = { stdin: "inherit", stdout: "inherit", stderr: "inherit" } as const;
  const ready = host.prepared === true ? host : (await readControllers([host]))[0];
  if (ready === null || ready === undefined) return 1;
  return await capturedSpawn(scriptCommand(ready, script, args), io).exited;
}

/** `bun run runs on`. */
export async function on(args: readonly string[]): Promise<void> {
  const [name, ...verb] = args;
  runtimeProcess.exitCode = await verbOn(hostNamed(name), verb);
}

/** `bun run runs hosts`: `status`, with its `args`, on every host at once, each printed as it answers. */
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
 *  another verb that acts on a run, and none for the rest. A word is an argument that is neither an
 *  option nor an option's value, before any `--`: `view --level 0.02 r3` names `r3`, and
 *  `continue finished --after finished` names its first `finished` and keeps the second. */
function namedAt(verb: string, args: readonly string[]): number[] {
  const words: number[] = [];
  for (let at = 0; at < args.length && args[at] !== "--"; at += 1) {
    const arg = args[at] ?? "";
    if (!arg.startsWith("-")) words.push(at);
    else if (!arg.includes("=") && !SWITCHES.has(arg)) at += 1;
  }
  return verb === "stop" ? words : words.slice(0, NAMING.has(verb) ? 1 : 0);
}

/** The routes of `verb args`, given the hosts that claim names among those no worktree here holds.
 *  A name nobody claims stays here, where the verb refuses it in its own words. */
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

/** `bun run runs holds <name ...>`: the names among these a worktree here holds, one a line. */
export function holds(names: readonly string[]): void {
  const here = new Set(runs().map(({ name }) => name));
  for (const name of names.filter((one) => here.has(one))) console.log(name);
}

/** The lines the verb `args` prints on each host `ANA_HOSTS` lists, every host asked at once, and
 *  null from a host that fails or does not answer in time, which is said on stderr. */
export async function asked(
  args: readonly string[],
  targets = hostsOf(),
  mode: "prepared" | "configured" = "prepared",
): Promise<{ host: Host; lines: string[] | null; elapsedMs: number }[]> {
  return await askedScript(CLI, args, targets, mode);
}

/** Ask all hosts a script, concurrently and within the same deadline as the runs CLI. */
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
        console.error(
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

/** The host that holds each of `names`, every host `ANA_HOSTS` lists asked at once. */
export async function holders(
  names: readonly string[],
  here: ReadonlySet<string> = new Set(),
): Promise<Map<string, Host>> {
  const held = new Map<string, Host>();
  if (names.length === 0) return held;
  for (const { host, lines } of await asked(["holds", ...names])) {
    // A run held here goes on while a peer is silent: until 30 October one down host refused it.
    if (lines === null && names.every((name) => here.has(name))) {
      console.error(`${host.name}: not checked for another original of ${names.join(", ")}`);
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

/** Find every original before a mutation: a local match cannot hide a remote duplicate. */
export async function routed(verb: string, args: readonly string[]): Promise<Routes> {
  const here = new Set(runs().map(({ name }) => name));
  // `--here` names this machine, as the keeper `keep` starts does: until 29 October it asked every peer
  // first, and one peer that did not answer ended the keeper at its start.
  const names = args.includes("--here") ? [] : namedAt(verb, args).map((at) => args[at] ?? "");
  const held = await holders(names, here);
  const duplicate = names.find((name) => here.has(name) && held.has(name));
  if (duplicate !== undefined) throw new Error(`${duplicate}: more than one original campaign`);
  return routesOf(verb, args, held);
}
