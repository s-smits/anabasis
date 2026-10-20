/**
 * Other machines that hold worktrees of this repository, reached over ssh: `on <host> <verb ...>`
 * runs any verb of `bun run runs` there, and `hosts` says each one's runs' status, which `status`
 * adds below this machine's own wherever a host is listed.
 *
 *   bun run runs on <host> <verb> [args ...]
 *   bun run runs hosts [--all]
 *
 * The hosts are `ANA_HOSTS` in the environment, a JSON list, loaded as the credentials are by Bun's
 * `--env-file` from a file git ignores, so no machine is named in the repository. Each names the
 * host, its ssh destination, the worktree the verb runs in, the Bun there, and the env files there
 * that Bun loads (a path on that machine, never copied). The remote command runs under a login
 * shell, so a campaign it starts finds the tools a login there has, and with `ANA_HOSTS` empty,
 * which Bun keeps over an env file's: a verb run on another host reaches no further one, so two
 * machines that list each other do not ask each other's status in a loop. `hosts` asks every host at
 * once and prints each one's rows as they come, under a time limit a host, so a host that is slow or
 * does not answer holds up no other (15 October: asked one after another, a loaded runner held the
 * rows of every host after it).
 *
 * A verb that acts on a run it names goes wherever the run is (`routesOf`): a name no worktree here
 * holds is asked of every host at once (`holds`), and the verb runs on the host that answers it. On
 * 20 October a stop of eight runs on two machines took two commands, each naming its host, and a
 * keeper, a continue and a view each took the host's name by hand.
 */
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { runs } from "./registry.ts";

/** How long `hosts` waits for one host's rows, and a verb for each host's `holds`. */
const HOST_MS = 30_000;
/** The verbs that act on the runs they name: every name `stop` is given, and the first word of the rest. */
const NAMING = new Set(["stop", "continue", "pause", "keep", "view", "source", "copy"]);

export interface Host {
  readonly name: string;
  readonly ssh: string;
  /** Written into the remote command as is, so `~` names the home there. */
  readonly tree: string;
  readonly bun: string;
  /** The env files there, credentials and this list among them. */
  readonly envFiles?: readonly string[];
}

/** Where a verb runs: here with `here` (none where every name it was given is elsewhere), and on
 *  each host with the words it is sent. */
interface Routes {
  readonly here: readonly string[] | null;
  readonly away: readonly (readonly [Host, readonly string[]])[];
}

export const hostsOf = (): readonly Host[] => parseJsonAs<Host[]>(runtimeProcess.env.ANA_HOSTS ?? "[]");

export const quoted = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

/** The ssh command that runs the shell text `script` on `host`, under a login shell there. */
export function sshScript(host: Host, script: string): string[] {
  return ["ssh", "-o", "ConnectTimeout=10", host.ssh, `exec "$SHELL" -lc ${quoted(script)}`];
}

/** The ssh command that runs the verb `args` on `host`. */
function sshTo(host: Host, args: readonly string[]): string[] {
  const env = (host.envFiles ?? []).map((file) => ` --env-file=${file}`).join("");
  return sshScript(
    host,
    `cd ${host.tree} && ANA_HOSTS='[]' ${host.bun}${env} tools/runs/cli.ts ${args.map(quoted).join(" ")}`,
  );
}

export function hostNamed(name: string | undefined): Host {
  const known = hostsOf();
  const host = known.find((one) => one.name === name);
  if (host === undefined) {
    throw new Error(`no host ${String(name)}: ANA_HOSTS names ${known.map((one) => one.name).join(", ")}`);
  }
  return host;
}

/** The verb `args` run on `host`, its output this process's, and its exit code. */
export async function verbOn(host: Host, args: readonly string[]): Promise<number> {
  const io = { stdin: "inherit", stdout: "inherit", stderr: "inherit" } as const;
  return await capturedSpawn(sshTo(host, args), io).exited;
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
  await Promise.all(
    all.map(async (host) => {
      const io = { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: HOST_MS } as const;
      const child = capturedSpawn(sshTo(host, ["status", ...args]), io);
      const [rows, errors, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const late =
        child.signalCode === null
          ? `answered with exit ${String(code)}`
          : `no answer in ${String(HOST_MS / 1000)} s`;
      console.log(`── ${host.name}\n${rows}${errors}${code === 0 ? "" : `  ${host.name} ${late}`}`.trimEnd());
    }),
  );
}

/** The runs `verb args` names: every name a stop is given, the first word of another verb that acts
 *  on a run, and none for the rest. */
const namedBy = (verb: string, args: readonly string[]) =>
  verb === "stop" ? args.filter((arg) => !arg.startsWith("-")) : args.slice(0, NAMING.has(verb) ? 1 : 0);

/** The routes of `verb args`, given the hosts that claim names among those no worktree here holds.
 *  A name nobody claims stays here, where the verb refuses it in its own words. */
export function routesOf(verb: string, args: readonly string[], held: ReadonlyMap<string, Host>): Routes {
  const names = namedBy(verb, args);
  const rest = args.filter((arg) => !names.includes(arg));
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

/** The host that holds each of `names`, every host `ANA_HOSTS` lists asked at once. */
export async function holders(names: readonly string[]): Promise<Map<string, Host>> {
  const held = new Map<string, Host>();
  if (names.length === 0) return held;
  await Promise.all(
    hostsOf().map(async (host) => {
      const io = { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: HOST_MS } as const;
      const child = capturedSpawn(sshTo(host, ["holds", ...names]), io);
      const [said, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      if (code !== 0) console.error(`${host.name} did not say which runs it holds (exit ${String(code)})`);
      for (const name of said.split("\n").filter((one) => names.includes(one))) {
        const other = held.get(name);
        if (other !== undefined) {
          throw new Error(`${name} names a campaign on ${other.name} and on ${host.name}`);
        }
        held.set(name, host);
      }
    }),
  );
  return held;
}

/** The routes of `verb args` on this machine and the hosts that hold the names no worktree here holds. */
export async function routed(verb: string, args: readonly string[]): Promise<Routes> {
  const here = new Set(runs().map(({ name }) => name));
  return routesOf(verb, args, await holders(namedBy(verb, args).filter((name) => !here.has(name))));
}
