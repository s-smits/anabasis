import { lstatSync, mkdirSync } from "./filesystem.ts";
import { tmpdir } from "./os.ts";
import { join } from "./path.ts";
import { runtimeProcess } from "./process.ts";
import { sha256 } from "./digest.ts";

export function sshOptions(destination: string): string[] {
  const uid = runtimeProcess.getuid?.();
  const directory = join(tmpdir(), `ana-ssh-${String(uid ?? runtimeProcess.pid)}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || (uid !== undefined && info.uid !== uid)) {
    throw new Error("the SSH control directory must be private and owned by this user");
  }
  const socket = join(directory, sha256(destination).slice(0, 16));
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
