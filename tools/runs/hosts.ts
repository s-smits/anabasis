/**
 * Other machines that hold worktrees of this repository, reached over ssh: `on <host> <verb ...>`
 * runs any verb of `bun run runs` there, and `hosts` says each one's load and its runs' status.
 *
 *   bun run runs on <host> <verb> [args ...]
 *   bun run runs hosts
 *
 * The hosts are `ANA_HOSTS` in the environment, a JSON list, loaded as the credentials are by Bun's
 * `--env-file` from a file git ignores, so no machine is named in the repository. Each names the
 * host, its ssh destination, the worktree the verb runs in, the Bun there, and the env files there
 * that Bun loads (a path on that machine, never copied). The remote command runs under a login
 * shell, so a campaign it starts finds the tools a login there has.
 */
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";

export interface Host {
  readonly name: string;
  readonly ssh: string;
  /** Written into the remote command as is, so `~` names the home there. */
  readonly tree: string;
  readonly bun: string;
  /** The env files there, credentials and this list among them. */
  readonly envFiles?: readonly string[];
}

const hostsOf = (): readonly Host[] => parseJsonAs<Host[]>(runtimeProcess.env.ANA_HOSTS ?? "[]");

const quoted = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

/** The verb `args` on `host`, run to its end with its output here; its exit code. */
async function onHost(host: Host, args: readonly string[]): Promise<number> {
  const env = (host.envFiles ?? []).map((file) => ` --env-file=${file}`).join("");
  const command = `cd ${host.tree} && ${host.bun}${env} tools/runs/cli.ts ${args.map(quoted).join(" ")}`;
  const child = capturedSpawn(
    ["ssh", "-o", "ConnectTimeout=10", host.ssh, `exec "$SHELL" -lc ${quoted(command)}`],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return child.exited;
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
  runtimeProcess.exitCode = await onHost(hostNamed(name), verb);
}

/** `bun run runs hosts`. */
export async function hosts(): Promise<void> {
  const all = hostsOf();
  if (all.length === 0) console.log("no host: ANA_HOSTS names none in this environment");
  for (const host of all) {
    console.log(`── ${host.name}`);
    const code = await onHost(host, ["status"]);
    if (code !== 0) console.log(`  ${host.name} answered with exit ${String(code)}`);
  }
}
