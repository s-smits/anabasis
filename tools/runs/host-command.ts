/** Shell words and transfers at the host boundary, shared by transport and preparation. */
import { runtimeProcess } from "#src/meta/process.ts";
import { sshOptions } from "#src/meta/ssh.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import type { Host } from "./host-config.ts";

/** The word that begins the status line `sshScript` ends a command's stderr with. */
const STATUS = "ana-exit";

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

/** The ssh command that runs the shell text `script` on `host`, under a login shell there. Its
 *  status ends its stderr as a line of its own: on 23 October Tailscale SSH on the macOS runner
 *  reported every command as exiting 0, and a preparation that refused a commit read as one
 *  that printed no tree. */
export function sshScript(host: Host, script: string): string[] {
  const status = `s=$?; printf '\\n${STATUS} %s\\n' "$s" >&2; exit "$s"`;
  return ["ssh", ...sshOptions(host.ssh), host.ssh, `"$SHELL" -lc ${quoted(script)}; ${status}`];
}

/** The exit code an `sshScript` command reported with its stderr, and that stderr without the
 *  line; ssh's own where none came back, as when the connection failed. */
export function remoteEnd(code: number | null, stderr: string): { code: number | null; stderr: string } {
  const found = new RegExp(`\\n${STATUS} (\\d+)\\n$`).exec(stderr);
  return found === null ? { code, stderr } : { code: Number(found[1]), stderr: stderr.slice(0, found.index) };
}

/** The exit code of an `sshScript` command whose stderr passes on as it comes, all but the tail
 *  that can hold its status line. */
export async function passedOn(child: {
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}): Promise<number> {
  const tail = `\n${STATUS} 255\n`.length;
  const decoder = new TextDecoder();
  let held = "";
  for await (const chunk of child.stderr) {
    held += decoder.decode(chunk, { stream: true });
    runtimeProcess.stderr.write(held.slice(0, -tail));
    held = held.slice(-tail);
  }
  const end = remoteEnd(await child.exited, held);
  runtimeProcess.stderr.write(end.stderr);
  return end.code ?? 1;
}

/** `script` run on `host` and its stdout, throwing with its stderr where it did not exit 0. */
export function remoteText(host: Host, script: string, options: Parameters<typeof runSync>[1] = {}): string {
  const result = runSync(sshScript(host, script), options);
  const end = remoteEnd(result.exitCode, decodeOutput(result.stderr));
  if (end.code !== 0 || result.cappedAt !== null) {
    throw new Error(`${host.name}: exited ${String(end.code)}: ${end.stderr.trim()}`);
  }
  return decodeOutput(result.stdout);
}
