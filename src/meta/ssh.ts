/**
 * Every ssh connection to a host the runs verbs or the check runner make, with a private, reusable
 * control socket for each destination. BatchMode keeps a connection that would ask for a password from
 * waiting for an answer nobody gives. The check runner reads these through its `hosts.js` since
 * 29 October, when it dropped a list of its own.
 */
import { lstatSync, mkdirSync } from "./filesystem.ts";
import { tmpdir } from "./os.ts";
import { join } from "./path.ts";
import { runtimeProcess } from "./process.ts";
import { sha256 } from "./digest.ts";

/** The short socket name also fits macOS's Unix socket limit under its long temp root. */
export function sshOptions(destination: string): string[] {
  const uid = runtimeProcess.getuid?.();
  const directory = join(tmpdir(), `ana-ssh-${String(uid ?? runtimeProcess.pid)}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || (uid !== undefined && info.uid !== uid)) {
    throw new Error("the SSH control directory must be private and owned by this user");
  }
  const socket = join(directory, sha256(destination).slice(0, 16));
  // ssh refuses a control socket of 104 bytes or more and adds 17 while it makes one, so under a deeper
  // temp root each connection goes alone rather than failing: the check runner's oracle run of
  // 29 October refused every connection under a scratch root.
  const control =
    new TextEncoder().encode(socket).length + 17 < 104
      ? ["-o", "ControlMaster=auto", "-o", "ControlPersist=300", "-o", `ControlPath=${socket}`]
      : ["-o", "ControlPath=none"];
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=20",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    ...control,
  ];
}
