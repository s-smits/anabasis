/** Shell words and transfers at the host boundary, shared by transport and preparation. */
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import type { Host } from "./host-config.ts";
import { sshOptions } from "#src/meta/ssh.ts";
/**
 * `from` copied into `to` with rsync, either of them `<ssh>:<path>` on a host. It compresses what it
 * sends: a campaign's folder is mostly logs and traces, and on 20 October one log of 4.6 MB took
 * 18.6 s to reach the Linux host over Wi-Fi, and 2.5 s with `-z`.
 */
export function rsync(from: string, to: string, ...flags: readonly string[]): string {
  const remote = [from, to].find((side) => !side.startsWith("/") && side.includes(":"));
  const transport =
    remote === undefined
      ? []
      : ["-e", ["ssh", ...sshOptions(remote.split(":")[0] ?? "")].map(quoted).join(" ")];
  return runTextSyncOrThrow(["rsync", "-az", ...transport, ...flags, from, to]);
}

/** The shell text that lists the worktrees of the repository `repo`, a shell word, the main first. */
export const worktreesIn = (repo: string) =>
  `git -C ${repo} worktree list --porcelain | sed -n 's/^worktree //p'`;

export const quoted = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

/** A configured path is one shell word; only a leading ~/ expands on the destination. */
export const shellPath = (path: string) =>
  path.startsWith("~/") ? `"$HOME"/${quoted(path.slice(2))}` : quoted(path);

/**
 * The Bun that runs a tree's code on a host, as shell text evaluated in that tree: the release its
 * `package.json` pins where the host holds it under `~/.bun/releases`, as the check runner picks
 * one, else the configured Bun. A campaign runs under the Bun of the verb that launched it, and on
 * 23 October a fork made through `fresh --host` on the Linux runner ran its verb on that host's
 * default Bun, 1.4.3, while its tree pinned 1.4.4.
 */
export const treeBun = (configured: string) =>
  `"$(p=$(grep -o '"packageManager": *"bun@[^"]*"' package.json 2>/dev/null | sed 's/.*bun@//; s/"$//'); if test -n "$p" && test -x "$HOME/.bun/releases/$p/bin/bun"; then echo "$HOME/.bun/releases/$p/bin/bun"; else echo ${shellPath(configured)}; fi)"`;

/** The ssh command that runs the shell text `script` on `host`, under a login shell there. */
export function sshScript(host: Host, script: string): string[] {
  return ["ssh", ...sshOptions(host.ssh), host.ssh, `exec "$SHELL" -lc ${quoted(script)}`];
}
