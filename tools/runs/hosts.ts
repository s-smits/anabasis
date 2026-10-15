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
 */
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";

/** How long `hosts` waits for one host's rows. */
const HOST_MS = 90_000;

export interface Host {
  readonly name: string;
  readonly ssh: string;
  /** Written into the remote command as is, so `~` names the home there. */
  readonly tree: string;
  readonly bun: string;
  /** The env files there, credentials and this list among them. */
  readonly envFiles?: readonly string[];
}

export const hostsOf = (): readonly Host[] => parseJsonAs<Host[]>(runtimeProcess.env.ANA_HOSTS ?? "[]");

const quoted = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

/** The ssh command that runs the verb `args` on `host`. */
function sshTo(host: Host, args: readonly string[]): string[] {
  const env = (host.envFiles ?? []).map((file) => ` --env-file=${file}`).join("");
  const command = `cd ${host.tree} && ANA_HOSTS='[]' ${host.bun}${env} tools/runs/cli.ts ${args.map(quoted).join(" ")}`;
  return ["ssh", "-o", "ConnectTimeout=10", host.ssh, `exec "$SHELL" -lc ${quoted(command)}`];
}

function hostNamed(name: string | undefined): Host {
  const known = hostsOf();
  const host = known.find((one) => one.name === name);
  if (host === undefined) {
    throw new Error(`usage: bun run runs on <${known.map((one) => one.name).join("|")}> <verb> ...`);
  }
  return host;
}

/** `bun run runs on`. */
export async function on(args: readonly string[]): Promise<void> {
  const [name, ...verb] = args;
  const io = { stdin: "inherit", stdout: "inherit", stderr: "inherit" } as const;
  runtimeProcess.exitCode = await capturedSpawn(sshTo(hostNamed(name), verb), io).exited;
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
